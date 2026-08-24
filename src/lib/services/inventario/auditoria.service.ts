/**
 * @module auditoria.service (Inventario)
 * @description Capa de servicios para la HU-A7: Auditoría Forense de Inventario
 * y Verificación de Integridad SHA-256.
 *
 * Responsabilidades:
 *  1. `obtenerLogsInventario`           — Lectura filtrada de AuditLog
 *     restringida a las tablas del Módulo A. Respeta RULES.md §1
 *     (AuditLogs son append-only, sin filtro is_active).
 *  2. `verificarCadenaHashesInventario` — Recalcula secuencialmente SHA-256
 *     sobre los eventos de inventario y detecta el primer punto de ruptura.
 *
 * Cumplimiento normativo:
 *  - RULES.md §2 — AuditLog append-only, encadenamiento SHA-256.
 *  - HU-A7 CA 3 — verificación forense que no confía en los valores almacenados.
 *  - HU-A7 CA 4 — ninguna función expone UPDATE o DELETE sobre el ledger.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
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
 * desde la vista de auditoría de inventario.
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

// ──────────────────────────────────────────────────────────────────────────────
// 1. Lectura: obtenerLogsInventario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista `AuditLog` paginado y filtrado, restringido exclusivamente a las
 * tablas del Módulo A (Inventario).
 *
 * Barrera de seguridad: verifica permiso `auditoria:leer_forense` antes de
 * ejecutar cualquier query — defensa en profundidad ante callers futuros.
 *
 * @param filtros - Validados por `FiltrosAuditoriaInventarioSchema`.
 * @param sesion  - Sesión del usuario autenticado.
 * @param q       - Búsqueda libre (máx. 100 chars), filtrada en Prisma.
 */
export async function obtenerLogsInventario(
  filtros: FiltrosAuditoriaInventarioInput,
  sesion: ServerSession,
  q?: string,
): Promise<ListadoAuditoriaInventario> {
  // ── Barrera final de seguridad (defensa en profundidad) ──────────────────
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

  // Búsqueda de texto libre server-side — solo si no hay sku_referencia activo
  if (q && q.trim() && !filtros.sku_referencia) {
    const term = q.trim();
    where.OR = [
      { accion: { contains: term, mode: "insensitive" } },
      { tabla_afectada: { contains: term, mode: "insensitive" } },
      { registro_id: { contains: term, mode: "insensitive" } },
    ];
  }

  // Filtro por módulo: `filtros.tabla_afectada` limita dentro del dominio A
  if (filtros.tabla_afectada) {
    where.tabla_afectada = filtros.tabla_afectada;
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
 * No confía en los valores almacenados: reconstruye `hash_actual` en memoria
 * usando un acumulador local. Detecta dos clases de tamper:
 *  - `hash_anterior` manipulado en BD
 *  - payload del registro alterado
 */
export async function verificarCadenaHashesInventario(): Promise<ResultadoVerificacionInventario> {
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

  // El punto de partida es el hash_anterior del primer registro de inventario
  // (apunta al último evento global previo, o a HASH_GENESIS si es el primero).
  let hashAnteriorEsperado = registros[0].hash_anterior;
  let registrosVerificados = 0;

  for (const registro of registros) {
    // Check 1: el hash_anterior almacenado debe coincidir con el acumulador
    if (registro.hash_anterior !== hashAnteriorEsperado) {
      return {
        integra: false,
        registros_verificados: registrosVerificados,
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
// Re-exportar registrarAuditLog para uso interno del módulo A
// (append-only — CA 4: ningún caso de uso expone UPDATE/DELETE)
// ──────────────────────────────────────────────────────────────────────────────
export { registrarAuditLog };
