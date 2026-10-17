/**
 * @module auditoria-ventas.service
 * @description HU-B6 (spec_modulo_B.md §2.6; docs/tasks/task_HU-B6.md) —
 * Log forense de Módulo B (anulaciones, descuentos fuera de margen, cambios
 * de precio y excepciones de crédito). Servicio de SOLO LECTURA contra
 * `AuditLog`, con el mismo patrón que HU-A6
 * (`lib/services/inventario/auditoria.service.ts`): filtro de dominio fijo,
 * permiso revalidado como defensa en profundidad. No usa ni agrega nada en
 * Módulo D (`listarEventosPorDominio` nunca existió).
 *
 * Dos niveles de acceso sobre el mismo endpoint:
 *  - AUDITOR (`auditoria:leer_forense`, incluido MASTER): ve todo el dominio
 *    y puede pedir `verificar_integridad`. Tiene precedencia sobre
 *    `ventas:leer_log_operativo` (decisión 6).
 *  - SUPERVISOR (`ventas:leer_log_operativo`): ve solo los eventos donde es
 *    autorizante (`AuditLog.usuario_id`) o solicitante
 *    (`valor_nuevo.usuario_solicitante_id`, JSON), en UNA sola query con `OR`
 *    y paginación en base (decisión 4). Nunca puede verificar integridad.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calcularHashEncadenado, HASH_GENESIS } from "@/lib/crypto/hash-chain";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import type { ServerSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";
import type { ConsultarAuditoriaVentasQuery } from "@/lib/schemas/ventas.schema";

export const PERMISO_AUDITORIA_LEER_FORENSE = "auditoria:leer_forense";
export const PERMISO_VENTAS_LEER_LOG_OPERATIVO = "ventas:leer_log_operativo";

export type NivelAccesoAuditoriaVentas = "AUDITOR" | "SUPERVISOR";

/**
 * Mapeo `tipo_evento` (contrato del query) → `AuditLog.accion` real
 * (confirmado contra `audit-log.listener.ts`). Constante interna, no expuesta.
 *
 * `ANULACION_PEDIDO` es un PLACEHOLDER: §2.8 no tiene código todavía. Si al
 * implementarla el `accion` real resulta ser otro (probablemente
 * `DELETE_LOGICO`), corregir el mapeo entonces — no se agrega ahora porque
 * ese valor es genérico de todo el proyecto (decisión 5).
 */
const ACCION_POR_TIPO_EVENTO: Record<string, string[]> = {
  "venta:anulacion_pedido": ["ANULACION_PEDIDO"],
  "venta:descuento_fuera_margen": ["DESCUENTO_FUERA_MARGEN"],
  "venta:cambio_precio_manual": ["CAMBIO_PRECIO_MANUAL"],
  "venta:excepcion_credito_resuelta": ["EXCEPCION_CREDITO_APROBADA", "EXCEPCION_CREDITO_RECHAZADA"],
};

const TODAS_LAS_ACCIONES_MODULO_B: readonly string[] = Object.values(ACCION_POR_TIPO_EVENTO).flat();

/**
 * `fecha_hasta` extendida a las 23:59:59.999 UTC del día indicado — mismo
 * criterio y mismo huso que `finDeDia()` de HU-A6 (decisión 9).
 */
function finDeDia(fecha: Date): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), 23, 59, 59, 999),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface RegistroAuditoriaVentas {
  id: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
  ip: string;
  created_at: Date;
  /** Visibles para Auditor Y Supervisor (decisión 8). */
  valor_anterior: unknown;
  valor_nuevo: unknown;
  hash_actual: string;
}

export interface ResultadoVerificacionVentas {
  integra: boolean;
  /** Cantidad de eventos de Módulo B verificados antes de terminar (o de la ruptura). */
  registros_verificados: number;
  /** Solo presente si `integra === false`. */
  primer_registro_divergente_id?: string;
  hash_esperado?: string;
  hash_almacenado?: string;
}

export interface ListadoAuditoriaVentas {
  registros: RegistroAuditoriaVentas[];
  total: number;
  page: number;
  page_size: number;
  verificacion_integridad?: ResultadoVerificacionVentas;
}

// ──────────────────────────────────────────────────────────────────────────────
// Gate de acceso
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve el nivel de acceso de un usuario a este log. `auditoria:leer_forense`
 * tiene precedencia sobre `ventas:leer_log_operativo` (decisión 6): un MASTER
 * con ambos cuenta como AUDITOR. `null` si no tiene ninguno de los dos.
 */
export async function resolverNivelAccesoAuditoriaVentas(
  usuarioId: string,
): Promise<NivelAccesoAuditoriaVentas | null> {
  if (await usuarioTienePermiso(usuarioId, PERMISO_AUDITORIA_LEER_FORENSE)) return "AUDITOR";
  if (await usuarioTienePermiso(usuarioId, PERMISO_VENTAS_LEER_LOG_OPERATIVO)) return "SUPERVISOR";
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Lectura: obtenerLogsVentas
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista `AuditLog` paginado, restringido a las acciones de Módulo B.
 *
 * @throws ServiceError `FORBIDDEN` — la sesión no tiene ninguno de los dos permisos.
 * @throws ServiceError `VERIFICACION_INTEGRIDAD_NO_DISPONIBLE` — un Supervisor
 *   pidió `verificar_integridad`; se corta ANTES de cualquier consulta.
 */
export async function obtenerLogsVentas(
  filtros: ConsultarAuditoriaVentasQuery,
  sesion: ServerSession,
): Promise<ListadoAuditoriaVentas> {
  // ── Defensa en profundidad: el Route Handler ya validó, se revalida acá ──
  const nivel = await resolverNivelAccesoAuditoriaVentas(sesion.userId);
  if (nivel === null) {
    throw new ServiceError(
      "FORBIDDEN",
      "No tenés el permiso requerido para consultar el log de auditoría de ventas",
    );
  }

  if (filtros.verificar_integridad && nivel !== "AUDITOR") {
    throw new ServiceError(
      "VERIFICACION_INTEGRIDAD_NO_DISPONIBLE",
      "La verificación de integridad de la cadena SHA-256 está reservada al rol Auditor",
    );
  }

  // Cada condición que necesita un OR propio va como elemento de `AND`, para
  // que el OR de `pedido_venta_id` y el de alcance del Supervisor no se pisen.
  const condiciones: Prisma.AuditLogWhereInput[] = [];

  // Filtro de dominio fijo (por `accion`, no por `tabla_afectada`).
  const where: Prisma.AuditLogWhereInput = {
    accion: {
      in: filtros.tipo_evento
        ? ACCION_POR_TIPO_EVENTO[filtros.tipo_evento]
        : [...TODAS_LAS_ACCIONES_MODULO_B],
    },
    AND: condiciones,
  };

  if (filtros.usuario_id) where.usuario_id = filtros.usuario_id;

  // `pedido_venta_id` no siempre es `registro_id` (decisión 10): en descuento
  // y cambio de precio sí; en excepción de crédito `registro_id` es la
  // operación de cuenta corriente y el pedido vive en `valor_nuevo` (JSON).
  if (filtros.pedido_venta_id) {
    condiciones.push({
      OR: [
        { registro_id: filtros.pedido_venta_id },
        { valor_nuevo: { path: ["pedido_venta_id"], equals: filtros.pedido_venta_id } },
      ],
    });
  }

  if (filtros.fecha_desde || filtros.fecha_hasta) {
    where.created_at = {
      ...(filtros.fecha_desde ? { gte: filtros.fecha_desde } : {}),
      ...(filtros.fecha_hasta ? { lte: finDeDia(filtros.fecha_hasta) } : {}),
    };
  }

  // Alcance del Supervisor: UNA query con OR (autorizante = columna real;
  // solicitante = path JSON), paginada en base — no dos queries + merge en
  // memoria (decisión 4). El path JSON simplemente no matchea en los tipos
  // de evento que no tienen `usuario_solicitante_id`.
  if (nivel === "SUPERVISOR") {
    condiciones.push({
      OR: [
        { usuario_id: sesion.userId },
        { valor_nuevo: { path: ["usuario_solicitante_id"], equals: sesion.userId } },
      ],
    });
  }

  const [registros, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
      include: { usuario: { select: { nombre_completo: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const listado: ListadoAuditoriaVentas = {
    registros: registros.map((r) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      usuario_nombre: r.usuario?.nombre_completo ?? null,
      accion: r.accion,
      tabla_afectada: r.tabla_afectada,
      registro_id: r.registro_id,
      ip: r.ip,
      created_at: r.created_at,
      valor_anterior: r.valor_anterior,
      valor_nuevo: r.valor_nuevo,
      hash_actual: r.hash_actual,
    })),
    total,
    page: filtros.page,
    page_size: filtros.page_size,
  };

  if (filtros.verificar_integridad) {
    listado.verificacion_integridad = await verificarCadenaHashesVentas();
  }

  return listado;
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Verificación: verificarCadenaHashesVentas
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recalcula los hashes SHA-256 de TODA la cadena global de `AuditLog` y
 * reporta el primer punto de ruptura; el conteo `registros_verificados`
 * incluye solo los eventos de Módulo B. Mismo criterio que
 * `verificarCadenaHashesInventario()` (HU-A6): la cadena es única y global
 * (`registrarAuditLog()` encadena contra el último registro de toda la
 * tabla), así que filtrar antes de encadenar daría falsos positivos apenas
 * haya un evento de otro módulo intercalado. El dominio se aplica solo para
 * contar. No recibe parámetros ni chequea permisos: el gate vive en
 * `obtenerLogsVentas()`.
 */
export async function verificarCadenaHashesVentas(): Promise<ResultadoVerificacionVentas> {
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
  let registrosModuloBVerificados = 0;

  for (const registro of registros) {
    // Check 1: el hash_anterior almacenado debe coincidir con el acumulador
    if (registro.hash_anterior !== hashAnteriorEsperado) {
      return {
        integra: false,
        registros_verificados: registrosModuloBVerificados,
        primer_registro_divergente_id: registro.id,
        hash_esperado: hashAnteriorEsperado,
        hash_almacenado: registro.hash_anterior,
      };
    }

    // Check 2: recalcular hash_actual y comparar con el almacenado
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
        registros_verificados: registrosModuloBVerificados,
        primer_registro_divergente_id: registro.id,
        hash_esperado: hashActualEsperado,
        hash_almacenado: registro.hash_actual,
      };
    }

    if (TODAS_LAS_ACCIONES_MODULO_B.includes(registro.accion)) {
      registrosModuloBVerificados++;
    }
    hashAnteriorEsperado = registro.hash_actual;
  }

  return { integra: true, registros_verificados: registrosModuloBVerificados };
}
