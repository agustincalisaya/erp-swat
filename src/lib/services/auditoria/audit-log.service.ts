/**
 * @module audit-log.service
 * @description Servicio de Ledger de Auditoría Forense (append-only, SHA-256
 * encadenado) — D.3 (spec_modulo_D.md §4).
 *
 * Cumplimiento normativo:
 *  - RULES.md §2 — cada acción que modifica el sistema queda registrada,
 *    encadenada por SHA-256 (`lib/crypto/hash-chain.ts`).
 *  - spec_modulo_D.md §4.1 — `audit_logs` es append-only: `registrarAuditLog`
 *    es la ÚNICA función de este archivo que escribe (`prisma.auditLog.create`).
 *    `listarAuditLog()` y `verificarCadenaIntegridad()` son estrictamente de
 *    lectura — ninguna de las dos invoca `prisma.auditLog.create()` ni
 *    ninguna otra mutación, bajo ningún concepto.
 *  - spec_modulo_D.md §4.3 — regla de segregación de funciones: sin el
 *    permiso `auditoria:leer_forense`, `listarAuditLog()` fuerza el filtro
 *    `usuario_id` a la sesión actual, descartando cualquier valor recibido.
 *    Esta decisión vive acá (no en el Route Handler) para que cualquier
 *    otro punto de entrada futuro reciba la misma garantía sin reimplementarla.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calcularHashEncadenado, HASH_GENESIS } from "@/lib/crypto/hash-chain";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import type { ServerSession } from "@/lib/auth/session";
import type { FiltrosAuditoriaInput } from "@/lib/schemas/auditoria.schema";

const PERMISO_LEER_FORENSE = "auditoria:leer_forense";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface RegistrarAuditLogParams {
  usuario_id: string | null;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
  ip: string;
  valor_anterior?: unknown;
  valor_nuevo?: unknown;
}

export interface RegistroAuditLog {
  id: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
  ip: string;
  created_at: Date;
  /** Solo presentes si quien consulta tiene `auditoria:leer_forense` (ver `listarAuditLog`). */
  valor_anterior?: unknown;
  valor_nuevo?: unknown;
}

export interface ListadoAuditLog {
  registros: RegistroAuditLog[];
  total: number;
  page: number;
  page_size: number;
}

export type ResultadoVerificacionCadena =
  | { integra: true; registros_verificados: number }
  | {
      integra: false;
      registros_verificados: number;
      primer_registro_divergente_id: string;
      hash_esperado: string;
      hash_almacenado: string;
    };

// ──────────────────────────────────────────────────────────────────────────────
// Escritura — ÚNICA función de este archivo que inserta en AuditLog
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Inserta un nuevo registro en el Ledger de Auditoría, calculando su
 * `hash_actual` encadenado con el `hash_actual` del registro más reciente
 * (o `HASH_GENESIS` si el ledger está vacío).
 *
 * Riesgo de concurrencia reconocido (spec_modulo_D.md §4.2): el `findFirst`
 * + `create` no son atómicos entre sí frente a dos inserciones concurrentes,
 * lo que podría producir un `hash_anterior` incorrecto en una carrera. Se
 * acepta como trade-off de Sprint actual — el volumen de escritura concurrente
 * de este proyecto (ERP interno, equipo reducido) hace el riesgo remoto, y
 * `verificarCadenaIntegridad()` lo detectaría de todos modos si ocurriera.
 *
 * @param params - Datos del evento a auditar.
 * @param tx - Cliente de transacción del llamador, si corresponde (para que
 *             el log se cree/revierta junto con la operación principal).
 */
export async function registrarAuditLog(
  params: RegistrarAuditLogParams,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;

  const ultimoRegistro = await db.auditLog.findFirst({
    orderBy: { created_at: "desc" },
    select: { hash_actual: true },
  });
  const hashAnterior = ultimoRegistro?.hash_actual ?? HASH_GENESIS;

  const valorAnterior = params.valor_anterior ?? null;
  const valorNuevo = params.valor_nuevo ?? null;

  const hashActual = calcularHashEncadenado(
    {
      usuario_id: params.usuario_id,
      accion: params.accion,
      tabla_afectada: params.tabla_afectada,
      registro_id: params.registro_id,
      ip: params.ip,
      valor_anterior: valorAnterior,
      valor_nuevo: valorNuevo,
    },
    hashAnterior,
  );

  await db.auditLog.create({
    data: {
      usuario_id: params.usuario_id,
      accion: params.accion,
      tabla_afectada: params.tabla_afectada,
      registro_id: params.registro_id,
      ip: params.ip,
      valor_anterior: valorAnterior as Prisma.InputJsonValue | undefined,
      valor_nuevo: valorNuevo as Prisma.InputJsonValue | undefined,
      hash_anterior: hashAnterior,
      hash_actual: hashActual,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Lectura — listarAuditLog
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista `AuditLog` paginado y filtrado, aplicando la regla de segregación
 * de funciones ANTES de tocar la base (spec_modulo_D.md §4.3):
 *
 * - Con `auditoria:leer_forense`: se respetan los filtros tal como llegan,
 *   incluyendo `usuario_id` de un tercero.
 * - Sin ese permiso: `usuario_id` se fuerza server-side a la sesión actual,
 *   descartando cualquier valor recibido en `filtros.usuario_id` — y
 *   `valor_anterior`/`valor_nuevo` se omiten de la respuesta (decisión
 *   confirmada: Personal Operativo ve el resumen de su propio historial,
 *   no el detalle completo del payload, ni siquiera del propio).
 *
 * @param filtros - Validados por `FiltrosAuditoriaSchema`.
 * @param sesion - Sesión autenticada que ejecuta la consulta.
 */
export async function listarAuditLog(
  filtros: FiltrosAuditoriaInput,
  sesion: ServerSession,
): Promise<ListadoAuditLog> {
  const tienePermisoAmpliado = await usuarioTienePermiso(sesion.userId, PERMISO_LEER_FORENSE);

  const usuarioIdEfectivo = tienePermisoAmpliado ? filtros.usuario_id : sesion.userId;

  const where: Prisma.AuditLogWhereInput = {};
  if (usuarioIdEfectivo) where.usuario_id = usuarioIdEfectivo;
  if (filtros.tabla_afectada) where.tabla_afectada = filtros.tabla_afectada;
  if (filtros.registro_id) where.registro_id = filtros.registro_id;
  if (filtros.accion) where.accion = filtros.accion;
  if (filtros.fecha_desde || filtros.fecha_hasta) {
    where.created_at = {
      ...(filtros.fecha_desde ? { gte: filtros.fecha_desde } : {}),
      ...(filtros.fecha_hasta ? { lte: filtros.fecha_hasta } : {}),
    };
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
    registros: registros.map((registro) => ({
      id: registro.id,
      usuario_id: registro.usuario_id,
      usuario_nombre: registro.usuario?.nombre_completo ?? null,
      accion: registro.accion,
      tabla_afectada: registro.tabla_afectada,
      registro_id: registro.registro_id,
      ip: registro.ip,
      created_at: registro.created_at,
      ...(tienePermisoAmpliado
        ? { valor_anterior: registro.valor_anterior, valor_nuevo: registro.valor_nuevo }
        : {}),
    })),
    total,
    page: filtros.page,
    page_size: filtros.page_size,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lectura — verificarCadenaIntegridad
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recorre TODO `AuditLog` ordenado por `created_at asc`, recalculando el
 * hash encadenado de cada fila con `calcularHashEncadenado()` (misma función
 * que usa `registrarAuditLog` — nunca una segunda implementación del
 * algoritmo) y comparándolo contra lo persistido. Ante la primera
 * discrepancia, se detiene de inmediato y reporta esa fila — no continúa
 * evaluando el resto (spec_modulo_D.md §4.4: una vez rota la cadena,
 * cualquier hash posterior es sospechoso por definición).
 *
 * Recorrido estrictamente secuencial (no paralelo) — el orden de la cadena
 * importa.
 *
 * No aplica ningún permiso acá: el gate de `auditoria:verificar_cadena` es
 * responsabilidad del Route Handler (`withPermission`), no de este service.
 */
export async function verificarCadenaIntegridad(): Promise<ResultadoVerificacionCadena> {
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
  let registrosVerificados = 0;

  for (const registro of registros) {
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

    const cadenaRota =
      registro.hash_anterior !== hashAnteriorEsperado || registro.hash_actual !== hashActualEsperado;

    if (cadenaRota) {
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
