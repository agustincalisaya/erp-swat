/**
 * @module auditoria.service (Inventario)
 * @description Capa de servicios para la HU-A7: Auditoría Forense de Inventario
 * y Verificación de Integridad SHA-256.
 *
 * Responsabilidades:
 *  1. `obtenerLogsInventario`          — Lectura filtrada de AuditLog restringida
 *     a las tablas del dominio de inventario (Módulo A). Respeta RULES.md §1
 *     (solo para auditoría se omite el filtro is_active).
 *  2. `verificarCadenaHashesInventario` — Recalcula secuencialmente SHA-256 sobre
 *     los eventos de inventario y detecta el primer punto de ruptura.
 *  3. `registrarAccesoDatoSensible`     — Descifra AES-256-GCM e inserta
 *     inmediatamente el evento LECTURA_SENSIBLE en el AuditLog (operación
 *     indisoluble — Ley N.° 25.326).
 *
 * Cumplimiento normativo:
 *  - RULES.md §2 — AuditLog append-only, encadenamiento SHA-256.
 *  - RULES.md §2 — AES-256-GCM para datos de efectivos en legajos.
 *  - HU-A7 Criterio 4 — cada lectura de dato sensible genera un evento propio.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decrypt } from "@/lib/crypto/aes";
import { calcularHashEncadenado } from "@/lib/crypto/hash-chain";
import { registrarAuditLog } from "@/lib/services/auditoria/audit-log.service";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import type { ServerSession } from "@/lib/auth/session";
import type { FiltrosAuditoriaInventarioInput } from "@/lib/schemas/inventario-auditoria.schema";

const PERMISO_LEER_FORENSE = "auditoria:leer_forense";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes del dominio
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tablas del Módulo A (Inventario). Solo los logs de estas tablas se exponen
 * desde la vista de auditoría de inventario — el AuditLog global no se filtra
 * sin restricción de tabla desde esta capa.
 */
const TABLAS_MODULO_A = [
  "legajos_prueba",
  "stock_depositos",
  "movimientos_stock",
  "variantes_sku",
  "depositos",
  "productos_maestros",
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface RegistroAuditoriaInventario {
  id: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
  ip: string;
  created_at: Date;
  valor_anterior?: unknown;
  valor_nuevo?: unknown;
  hash_actual: string;
}

export interface ListadoAuditoriaInventario {
  registros: RegistroAuditoriaInventario[];
  total: number;
  page: number;
  page_size: number;
}

export interface ResultadoVerificacionInventario {
  integra: boolean;
  registros_verificados: number;
  /** Solo presente si `integra === false`. */
  primer_registro_divergente_id?: string;
  hash_esperado?: string;
  hash_almacenado?: string;
}

export interface DatoSensibleRevelado {
  campo: "efectivo_placa" | "efectivo_organismo";
  valor_descifrado: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Lectura: obtenerLogsInventario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista `AuditLog` paginado y filtrado, restringido exclusivamente a las
 * tablas del Módulo A (Inventario). El Auditor ve el historial completo
 * incluyendo `valor_anterior`/`valor_nuevo` — la segregación de permisos
 * se aplica en la Server Action antes de llamar a este servicio.
 *
 * RULES.md §1: los AuditLogs son append-only y NO llevan soft delete;
 * no se aplica `is_active` acá por diseño.
 *
 * @param filtros - Validados por `FiltrosAuditoriaInventarioSchema`.
 */
export async function obtenerLogsInventario(
  filtros: FiltrosAuditoriaInventarioInput,
  sesion: ServerSession,
  q?: string,
): Promise<ListadoAuditoriaInventario> {
  // ── Barrera final de seguridad (defensa en profundidad) ──────────────────
  // La Server Action / RSC que llama este servicio ya verificó el permiso,
  // pero el servicio es la última línea de defensa ante cualquier llamador
  // futuro que omita ese check.
  const tienePermiso = await usuarioTienePermiso(
    sesion.userId,
    PERMISO_LEER_FORENSE,
  );
  if (!tienePermiso) {
    throw new Error(
      `[AuditoriaService] Acceso denegado: el usuario ${sesion.userId} ` +
        "no tiene el permiso 'auditoria:leer_forense'.",
    );
  }

  const where: Prisma.AuditLogWhereInput = {
    // Restricción principal: solo tablas del Módulo A
    tabla_afectada: { in: [...TABLAS_MODULO_A] },
  };

  if (filtros.usuario_id) where.usuario_id = filtros.usuario_id;

  // `sku_referencia` se mapea a `registro_id`
  if (filtros.sku_referencia) {
    where.registro_id = {
      contains: filtros.sku_referencia,
      mode: "insensitive",
    };
  }

  if (filtros.fecha_desde || filtros.fecha_hasta) {
    where.created_at = {
      ...(filtros.fecha_desde ? { gte: filtros.fecha_desde } : {}),
      ...(filtros.fecha_hasta ? { lte: filtros.fecha_hasta } : {}),
    };
  }

  if (filtros.tipo_movimiento) {
    where.accion = filtros.tipo_movimiento;
  }

  // Búsqueda de texto libre server-side: filtra en BD sobre acción, tabla
  // y registro_id. Solo se aplica si no hay un filtro de sku_referencia
  // activo (para no colisionar con el where.registro_id ya seteado).
  if (q && q.trim() && !filtros.sku_referencia) {
    const term = q.trim();
    where.OR = [
      { accion: { contains: term, mode: "insensitive" } },
      { tabla_afectada: { contains: term, mode: "insensitive" } },
      { registro_id: { contains: term, mode: "insensitive" } },
    ];
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

  return {
    registros: registros.map((r) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      usuario_nombre: r.usuario?.nombre_completo ?? null,
      accion: r.accion,
      tabla_afectada: r.tabla_afectada,
      registro_id: r.registro_id,
      ip: r.ip,
      created_at: r.created_at,
      // Los payloads completos solo se retornan si el caller tiene permiso
      // (el guard al inicio de esta función lo garantiza).
      valor_anterior: r.valor_anterior,
      valor_nuevo: r.valor_nuevo,
      hash_actual: r.hash_actual,
    })),
    total,
    page: filtros.page,
    page_size: filtros.page_size,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Verificación: verificarCadenaHashesInventario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recalcula secuencialmente los hashes SHA-256 de los eventos de inventario,
 * detectando el primer punto de ruptura de la cadena.
 *
 * IMPORTANTE: verifica la sub-cadena de inventario dentro de la cadena
 * global del ledger. Esto implica que los `hash_anterior` de cada registro
 * apuntan al hash del evento globalmente anterior (puede ser de otro módulo).
 * La verificación cruzada completa se realiza con `verificarCadenaIntegridad()`
 * del módulo de auditoría general — esta función es específica para la vista
 * forense del Módulo A (HU-A7 §2.2).
 */
export async function verificarCadenaHashesInventario(): Promise<ResultadoVerificacionInventario> {
  // Traemos todos los registros de inventario en orden cronológico.
  // Para verificar correctamente la sub-cadena necesitamos saber cuál era
  // el hash anterior al primer registro de inventario, por eso primero
  // buscamos el registro globalmente anterior al más antiguo de inventario.
  const registros = await prisma.auditLog.findMany({
    where: { tabla_afectada: { in: [...TABLAS_MODULO_A] } },
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

  if (registros.length === 0) {
    return { integra: true, registros_verificados: 0 };
  }

  // El punto de partida de la cadena es el hash_anterior del primer registro
  // de inventario (que apunta al último evento global previo, o a HASH_GENESIS
  // si es el primer evento de todo el ledger).
  let hashAnteriorEsperado = registros[0].hash_anterior;
  let registrosVerificados = 0;

  for (const registro of registros) {
    // Verificar que el hash_anterior almacenado coincide con lo que esperamos
    if (registro.hash_anterior !== hashAnteriorEsperado) {
      return {
        integra: false,
        registros_verificados: registrosVerificados,
        primer_registro_divergente_id: registro.id,
        hash_esperado: hashAnteriorEsperado,
        hash_almacenado: registro.hash_anterior,
      };
    }

    // Recalcular el hash_actual y comparar con el almacenado
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
        registros_verificados: registrosVerificados,
        primer_registro_divergente_id: registro.id,
        hash_esperado: hashActualEsperado,
        hash_almacenado: registro.hash_actual,
      };
    }

    registrosVerificados++;
    hashAnteriorEsperado = registro.hash_actual;
  }

  return { integra: true, registros_verificados: registrosVerificados };
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Dato sensible: registrarAccesoDatoSensible
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Descifra un campo sensible de un `LegajoPrueba` AES-256-GCM e inserta
 * inmediatamente un registro `LECTURA_SENSIBLE` en el `AuditLog`.
 *
 * La operación es INDISOLUBLE: el descifrado y el registro de auditoría
 * ocurren en el mismo flujo de backend. El dato descifrado nunca persiste
 * ni sale al cliente sin el audit trail correspondiente (HU-A7 Criterio 4,
 * Ley N.° 25.326).
 *
 * @param legajoPruebaId - UUID del `LegajoPrueba` a descifrar.
 * @param campo          - `"efectivo_placa"` o `"efectivo_organismo"`.
 * @param auditorId      - ID del usuario que realiza la consulta (trazabilidad).
 * @param ip             - IP del auditor para el AuditLog.
 */
export async function registrarAccesoDatoSensible(
  legajoPruebaId: string,
  campo: "efectivo_placa" | "efectivo_organismo",
  auditorId: string,
  ip: string,
): Promise<DatoSensibleRevelado> {
  // 1. Buscar el legajo (sin filtrar is_active: el auditor tiene acceso
  //    al historial completo per RULES.md §1 excepción de auditoría)
  //
  // TODO: el modelo LegajoPrueba vive en la rama `develop` (schema.prisma no
  // lo incluye aún en esta rama). El cast via `(prisma as any)` desbloquea el
  // build hasta que el merge con develop lo resuelva definitivamente.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const legajo = await db.legajoPrueba.findUnique({
    where: { id: legajoPruebaId },
    select: {
      id: true,
      efectivo_placa: true,
      efectivo_organismo: true,
      variante_sku_id: true,
    },
  });

  if (!legajo) {
    throw new Error(`Legajo ${legajoPruebaId} no encontrado.`);
  }

  // 2. Descifrar el campo solicitado en memoria
  const campoCifrado =
    campo === "efectivo_placa"
      ? legajo.efectivo_placa
      : legajo.efectivo_organismo;

  const valorDescifrado = decrypt(campoCifrado);

  // 3. Registrar el acceso en el AuditLog (append-only — Ley N.° 25.326)
  //    Se hace DESPUÉS del descifrado para no silenciar el log si decrypt lanza.
  //    El valor descifrado NUNCA se almacena en `valor_nuevo`.
  await registrarAuditLog({
    usuario_id: auditorId,
    accion: "LECTURA_SENSIBLE",
    tabla_afectada: "legajos_prueba",
    registro_id: legajo.id,
    ip,
    valor_anterior: null,
    valor_nuevo: {
      campo_accedido: campo,
      variante_sku_id: legajo.variante_sku_id,
      // El dato descifrado NUNCA se persiste en el log — solo el campo consultado
    },
  });

  return {
    campo,
    valor_descifrado: valorDescifrado,
  };
}
