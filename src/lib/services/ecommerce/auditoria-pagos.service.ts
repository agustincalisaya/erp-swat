/**
 * @module auditoria-pagos.service
 * @description HU-E6 (spec_modulo_E.md §2.6) — log de auditoría de pagos
 * online. Servicio de SOLO LECTURA del módulo E sobre `TransaccionPagoLog`
 * (detalle operativo) con el mismo patrón que HU-B6
 * (`lib/services/ventas/auditoria-ventas.service.ts`): filtro de dominio fijo,
 * permiso revalidado como defensa en profundidad. La cadena SHA-256 vive
 * EXCLUSIVAMENTE en `AuditLog` (Módulo D): `TransaccionPagoLog` no tiene
 * cadena propia.
 *
 * Doble permiso sobre el mismo endpoint:
 *  - AUDITOR (`auditoria:leer_forense`) → acceso completo.
 *  - ADMIN_ECOMMERCE (`ecommerce:solicitar_acceso_log_pagos`) → SOLO con una
 *    solicitud aprobada y no expirada; si no,
 *    `403 ACCESO_LOG_PAGOS_NO_APROBADO` (más restrictivo que el patrón A/B).
 *
 * R3: la lectura de un dato de facturación cifrado por un Auditor emite
 * `ecommerce:acceso_dato_cifrado_auditado` EXACTAMENTE UNA vez por lectura.
 * El Administrador E-commerce NUNCA ve el campo cifrado, ni con acceso
 * aprobado.
 *
 * R4: la solicitud/aprobación se persiste en `AccesoLogPagos`; la expiración
 * se lee de `ConfiguracionSistema` (`ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS`).
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decrypt } from "@/lib/crypto/aes";
import { calcularHashEncadenado, HASH_GENESIS } from "@/lib/crypto/hash-chain";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import type { ServerSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { AccesoDatoCifradoAuditadoPayload } from "@/lib/events/event-types";
import { obtenerConfiguracion } from "@/lib/services/sistema/configuracion.service";
import type { ListarLogPagosQuery } from "@/lib/schemas/ecommerce.schema";

export const PERMISO_AUDITORIA_LEER_FORENSE = "auditoria:leer_forense";
export const PERMISO_SOLICITAR_ACCESO_LOG_PAGOS = "ecommerce:solicitar_acceso_log_pagos";
/** Parámetro de configuración con los días de validez del acceso aprobado (R4). */
export const CLAVE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS = "ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS";

export type NivelAccesoLogPagos = "AUDITOR" | "ADMIN_ECOMMERCE";

/**
 * Acciones de `AuditLog` propias del dominio HU-E6 — usadas por
 * `verificarIntegridadLogPagos()` para contar solo sus registros sobre la
 * cadena global. Deben coincidir con `audit-log.listener.ts`.
 */
const ACCIONES_LOG_PAGOS: readonly string[] = [
  "TRANSACCION_PAGO_REGISTRADA",
  "ACCESO_DATO_CIFRADO_AUDITADO",
];

/**
 * `fecha_hasta` extendida a las 23:59:59.999 UTC del día indicado — mismo
 * criterio y mismo huso que `finDeDia()` de HU-A6/B6 (duplicado por módulo,
 * no compartido).
 */
export function finDeDia(fecha: Date): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), 23, 59, 59, 999),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface RegistroLogPagos {
  transaccion_id: string;
  pedido_venta_id: string;
  monto: number;
  estado_pago: string;
  timestamp: Date;
}

export interface ListadoLogPagos {
  items: RegistroLogPagos[];
  total: number;
  page: number;
}

export interface ResultadoVerificacionLogPagos {
  integra: boolean;
  /** Cantidad de eventos de HU-E6 verificados antes de terminar (o de la ruptura). */
  registros_verificados: number;
  primer_registro_divergente_id?: string;
  hash_esperado?: string;
  hash_almacenado?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Gate de acceso (R2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve el acceso de un usuario al log de pagos.
 *  - `auditoria:leer_forense` → `"AUDITOR"` (completo).
 *  - `ecommerce:solicitar_acceso_log_pagos` + solicitud aprobada y vigente →
 *    `"ADMIN_ECOMMERCE"`.
 *  - permiso de solicitud SIN aprobación vigente → lanza
 *    `ACCESO_LOG_PAGOS_NO_APROBADO`.
 *  - ningún permiso → lanza `FORBIDDEN`.
 *
 * @throws {ServiceError} FORBIDDEN | ACCESO_LOG_PAGOS_NO_APROBADO
 */
export async function resolverAccesoLogPagos(usuarioId: string): Promise<NivelAccesoLogPagos> {
  if (await usuarioTienePermiso(usuarioId, PERMISO_AUDITORIA_LEER_FORENSE)) return "AUDITOR";

  if (!(await usuarioTienePermiso(usuarioId, PERMISO_SOLICITAR_ACCESO_LOG_PAGOS))) {
    throw new ServiceError(
      "FORBIDDEN",
      "No tenés el permiso requerido para consultar el log de auditoría de pagos",
    );
  }

  const acceso = await accesoAprobadoVigente(usuarioId);
  if (!acceso) {
    throw new ServiceError(
      "ACCESO_LOG_PAGOS_NO_APROBADO",
      "El acceso al log de pagos requiere una solicitud aprobada y vigente",
    );
  }
  return "ADMIN_ECOMMERCE";
}

/**
 * Solicitud APROBADA, activa y no expirada del usuario, si existe. Un
 * `expira_en` nulo se trata como acceso sin vencimiento; con valor, debe ser
 * futuro (spec §2.6: un acceso expirado es "no aprobado").
 */
export async function accesoAprobadoVigente(
  usuarioId: string,
): Promise<{ id: string; expira_en: Date | null } | null> {
  const ahora = new Date();
  return prisma.accesoLogPagos.findFirst({
    where: {
      solicitante_id: usuarioId,
      estado: "APROBADO",
      is_active: true,
      OR: [{ expira_en: null }, { expira_en: { gt: ahora } }],
    },
    orderBy: { aprobada_en: "desc" },
    select: { id: true, expira_en: true },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Lectura: obtenerLogPagos (R2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista `TransaccionPagoLog` paginado y filtrado, solo si la sesión resuelve
 * acceso (Auditor o Administrador E-commerce aprobado). El campo cifrado
 * `datos_facturacion_cifrados` NUNCA se selecciona: no viaja en la respuesta
 * para ningún nivel.
 *
 * @throws {ServiceError} FORBIDDEN | ACCESO_LOG_PAGOS_NO_APROBADO
 */
export async function obtenerLogPagos(
  filtros: ListarLogPagosQuery,
  sesion: ServerSession,
): Promise<ListadoLogPagos> {
  // ── Defensa en profundidad: el Route Handler revalida, acá se corta antes
  //    de tocar la base si no hay acceso ──
  await resolverAccesoLogPagos(sesion.userId);

  const where: Prisma.TransaccionPagoLogWhereInput = {};
  if (filtros.estado_pago) where.estado_pago = filtros.estado_pago;
  if (filtros.fecha_desde || filtros.fecha_hasta) {
    where.created_at = {
      ...(filtros.fecha_desde ? { gte: filtros.fecha_desde } : {}),
      ...(filtros.fecha_hasta ? { lte: finDeDia(filtros.fecha_hasta) } : {}),
    };
  }

  const [registros, total] = await Promise.all([
    prisma.transaccionPagoLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
      select: {
        id: true,
        monto: true,
        estado_pago: true,
        created_at: true,
        pedido_venta_ecommerce: { select: { pedido_venta_id: true } },
      },
    }),
    prisma.transaccionPagoLog.count({ where }),
  ]);

  return {
    items: registros.map((r) => ({
      transaccion_id: r.id,
      pedido_venta_id: r.pedido_venta_ecommerce.pedido_venta_id,
      monto: r.monto.toNumber(),
      estado_pago: r.estado_pago,
      timestamp: r.created_at,
    })),
    total,
    page: filtros.page,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. R3: lectura auditada del dato de facturación cifrado
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Descifra `datos_facturacion_cifrados` de UNA transacción y emite
 * `ecommerce:acceso_dato_cifrado_auditado` EXACTAMENTE UNA vez por lectura.
 * Reservado al Auditor: el Administrador E-commerce no puede llegar acá ni con
 * acceso aprobado.
 *
 * @throws {ServiceError} FORBIDDEN | TRANSACCION_NO_ENCONTRADA
 */
export async function decryptAndAuditBilling(
  transaccionId: string,
  auditorId: string,
): Promise<Record<string, unknown>> {
  if (!(await usuarioTienePermiso(auditorId, PERMISO_AUDITORIA_LEER_FORENSE))) {
    throw new ServiceError(
      "FORBIDDEN",
      "El acceso al dato de facturación cifrado está reservado al rol Auditor",
    );
  }

  const registro = await prisma.transaccionPagoLog.findUnique({
    where: { id: transaccionId },
    select: { datos_facturacion_cifrados: true, datos_facturacion_iv: true },
  });
  if (!registro) {
    throw new ServiceError("TRANSACCION_NO_ENCONTRADA", "No existe la transacción de pago indicada");
  }

  const claro = decrypt({
    ciphertext: registro.datos_facturacion_cifrados,
    iv: registro.datos_facturacion_iv,
  });

  // Una sola emisión por lectura. Sin transacción de negocio: se publica
  // directo, enmascarando fallos del listener (nunca revierten la lectura).
  // El payload no transporta el valor descifrado.
  const payload: AccesoDatoCifradoAuditadoPayload = {
    transaccion_id: transaccionId,
    usuario_auditor_id: auditorId,
    timestamp: new Date().toISOString(),
  };
  try {
    domainEventBus.emit("ecommerce:acceso_dato_cifrado_auditado", payload);
  } catch (error) {
    console.error("[HU-E6] Falló la publicación de ecommerce:acceso_dato_cifrado_auditado:", {
      transaccion_id: transaccionId,
      error: error instanceof Error ? error.message : "error desconocido",
    });
  }

  return JSON.parse(claro) as Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Integridad: verificarIntegridadLogPagos (divergencia Backlog↔spec)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recalcula los hashes SHA-256 de TODA la cadena global de `AuditLog` y
 * reporta el primer punto de ruptura; cuenta solo los eventos de HU-E6. Mismo
 * criterio que `verificarCadenaHashesVentas()` (HU-B6): la cadena es única y
 * global, así que filtrar antes de encadenar daría falsos positivos apenas
 * haya un evento de otro módulo intercalado. No chequea permisos: el gate vive
 * en `obtenerLogPagos()`.
 */
export async function verificarIntegridadLogPagos(): Promise<ResultadoVerificacionLogPagos> {
  const registros = await prisma.auditLog.findMany({
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      usuario_id: true,
      accion: true,
      tabla_afectada: true,
      registro_id: true,
      ip: true,
      valor_anterior: true,
      valor_nuevo: true,
      hash_anterior: true,
      hash_actual: true,
    },
  });

  let hashAnteriorEsperado = HASH_GENESIS;
  let registrosLogPagosVerificados = 0;

  for (const registro of registros) {
    if (registro.hash_anterior !== hashAnteriorEsperado) {
      return {
        integra: false,
        registros_verificados: registrosLogPagosVerificados,
        primer_registro_divergente_id: registro.id,
        hash_esperado: hashAnteriorEsperado,
        hash_almacenado: registro.hash_anterior,
      };
    }

    const hashActualEsperado = calcularHashEncadenado(
      {
        usuario_id: registro.usuario_id,
        accion: registro.accion,
        tabla_afectada: registro.tabla_afectada,
        registro_id: registro.registro_id,
        ip: registro.ip,
        valor_anterior: registro.valor_anterior,
        valor_nuevo: registro.valor_nuevo,
      },
      hashAnteriorEsperado,
    );

    if (registro.hash_actual !== hashActualEsperado) {
      return {
        integra: false,
        registros_verificados: registrosLogPagosVerificados,
        primer_registro_divergente_id: registro.id,
        hash_esperado: hashActualEsperado,
        hash_almacenado: registro.hash_actual,
      };
    }

    if (ACCIONES_LOG_PAGOS.includes(registro.accion)) {
      registrosLogPagosVerificados++;
    }
    hashAnteriorEsperado = registro.hash_actual;
  }

  return { integra: true, registros_verificados: registrosLogPagosVerificados };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. R4: solicitud y aprobación de acceso
// ──────────────────────────────────────────────────────────────────────────────

/** Días de validez del acceso aprobado, leídos de `ConfiguracionSistema`. */
async function obtenerDiasExpiracionAcceso(): Promise<number> {
  const { valor } = await obtenerConfiguracion(CLAVE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS);
  const dias = Number(valor);
  if (!Number.isInteger(dias) || dias <= 0) {
    throw new ServiceError(
      "CONFIGURACION_INVALIDA",
      `${CLAVE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS} debe ser un entero positivo (valor actual: "${valor}")`,
    );
  }
  return dias;
}

/**
 * Registra una solicitud de acceso PENDIENTE del Administrador E-commerce. El
 * solicitante sale siempre de la sesión (nunca del body).
 */
export async function solicitarAccesoLogPagos(
  usuarioId: string,
  motivo?: string,
): Promise<{ id: string; estado: "PENDIENTE" }> {
  const solicitud = await prisma.accesoLogPagos.create({
    data: {
      solicitante_id: usuarioId,
      estado: "PENDIENTE",
      motivo_solicitud: motivo ?? null,
    },
    select: { id: true },
  });
  return { id: solicitud.id, estado: "PENDIENTE" };
}

/**
 * Aprueba una solicitud de acceso (solo Auditor). Registra `aprobador_id` y
 * `expira_en = now + N días` desde `ConfiguracionSistema`.
 *
 * @throws {ServiceError} SOLICITUD_NO_ENCONTRADA | CONFIGURACION_INVALIDA
 */
export async function aprobarAccesoLogPagos(
  solicitudId: string,
  auditorId: string,
): Promise<{ id: string; estado: "APROBADO"; expira_en: Date }> {
  const existente = await prisma.accesoLogPagos.findUnique({
    where: { id: solicitudId },
    select: { id: true },
  });
  if (!existente) {
    throw new ServiceError("SOLICITUD_NO_ENCONTRADA", "No existe la solicitud de acceso indicada");
  }

  const dias = await obtenerDiasExpiracionAcceso();
  const expiraEn = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

  const actualizada = await prisma.accesoLogPagos.update({
    where: { id: solicitudId },
    data: {
      estado: "APROBADO",
      aprobador_id: auditorId,
      aprobada_en: new Date(),
      expira_en: expiraEn,
      motivo_rechazo: null,
      is_active: true,
    },
    select: { id: true, expira_en: true },
  });

  return { id: actualizada.id, estado: "APROBADO", expira_en: actualizada.expira_en ?? expiraEn };
}
