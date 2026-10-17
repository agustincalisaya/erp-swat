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
 * Serialización del ledger (spec_modulo_D.md §4.2; HU-E13 T18, PLAN §9.4).
 *
 * Leer el último hash e insertar el siguiente no es atómico: dos escrituras
 * que leen el mismo `hash_anterior` bifurcan la cadena SHA-256 (evidencia:
 * filas 157/158 y 159/160 del ledger, 2026-09-03, HU-H4; y la bifurcación
 * servidor + proceso de test detectada en T17). El servidor Next y
 * `job:reservas` son procesos distintos que escriben el mismo ledger, así que
 * la frontera de corrección es PostgreSQL, no la memoria del proceso:
 *
 *   BEGIN → pg_advisory_xact_lock(CLAVE fija del ledger) → [deduplicación]
 *         → último registro (created_at DESC, id DESC) → SHA-256 → INSERT → COMMIT
 *
 * El commit (o el rollback) libera el lock: un fallo antes del commit no deja
 * fila parcial ni lock tomado.
 *
 * `colaLedger` se conserva SOLO como optimización local: evita que las
 * escrituras de un mismo proceso compitan entre sí por el lock y por
 * conexiones del pool. No es necesaria para la corrección. Un fallo puntual no
 * rompe la cola (el `.catch(() => {})` va sobre la continuación, no sobre el
 * valor devuelto al llamador).
 */
let colaLedger: Promise<unknown> = Promise.resolve();

/**
 * Clave advisory fija y exclusiva del ledger AuditLog: un único orden total
 * para todos los appends, nunca derivada de pedido, usuario, tabla o acción.
 * Forma de dos int4 ('AUDI', 'TLOG'): ocupa un espacio de claves distinto del
 * de las claves bigint de un argumento (p. ej. `hashtext(...)::bigint` de
 * Pick & Pack), así que no puede colisionar con ellas.
 */
export const CLAVE_ADVISORY_LEDGER_AUDITLOG = [0x41554449, 0x544c4f47] as const;

/** Margen de la transacción de append: incluye la espera del lock bajo contención multiproceso. */
const OPCIONES_TRANSACCION_LEDGER = { maxWait: 10_000, timeout: 20_000 } as const;

type IdentidadIdempotente = Pick<RegistrarAuditLogParams, "accion" | "tabla_afectada" | "registro_id">;

/**
 * Inserta un nuevo registro en el Ledger de Auditoría, calculando su
 * `hash_actual` encadenado con el `hash_actual` del registro más reciente
 * (o `HASH_GENESIS` si el ledger está vacío).
 *
 * Cada append corre en su propia transacción PostgreSQL bajo el advisory lock
 * del ledger (ver arriba), así que dos procesos nunca leen el mismo
 * `hash_anterior`. Si el llamador pasa `tx`, el append (y el lock) viven en esa
 * transacción y se confirman o revierten con ella; hoy ningún llamador lo hace
 * (`audit-log.listener.ts` siempre llama sin `tx`). Un llamador con `tx` no
 * debe estar él mismo dentro de la cola (no hay reentrancia).
 *
 * @param params - Datos del evento a auditar.
 * @param tx - Cliente de transacción del llamador, si corresponde (para que
 *             el log se cree/revierta junto con la operación principal).
 */
export async function registrarAuditLog(
  params: RegistrarAuditLogParams,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const ejecucion = colaLedger.then(async () => {
    if (tx) {
      await anexarRegistroAuditLog(tx, params, null);
      return;
    }
    await prisma.$transaction((t) => anexarRegistroAuditLog(t, params, null), OPCIONES_TRANSACCION_LEDGER);
  });
  colaLedger = ejecucion.catch(() => {});
  return ejecucion;
}

/**
 * Append idempotente por identidad lógica `accion + tabla_afectada +
 * registro_id`. La búsqueda del hecho existente ocurre DENTRO del mismo lock y
 * transacción que el INSERT: dos procesos que auditan el mismo hecho a la vez
 * producen exactamente una fila (uno recibe `CREADO`, el otro `YA_EXISTENTE`).
 */
export async function registrarAuditLogIdempotente(
  params: RegistrarAuditLogParams,
): Promise<"CREADO" | "YA_EXISTENTE"> {
  const ejecucion = colaLedger.then(() =>
    prisma.$transaction((t) => anexarRegistroAuditLog(t, params, params), OPCIONES_TRANSACCION_LEDGER));
  colaLedger = ejecucion.catch(() => {});
  return ejecucion;
}

async function anexarRegistroAuditLog(
  tx: Prisma.TransactionClient,
  params: RegistrarAuditLogParams,
  identidad: IdentidadIdempotente | null,
): Promise<"CREADO" | "YA_EXISTENTE"> {
  const [claveA, claveB] = CLAVE_ADVISORY_LEDGER_AUDITLOG;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${claveA}::int4, ${claveB}::int4)`;

  if (identidad) {
    const existente = await tx.auditLog.findFirst({
      where: {
        accion: identidad.accion,
        tabla_afectada: identidad.tabla_afectada,
        registro_id: identidad.registro_id,
      },
      select: { id: true },
    });
    if (existente) return "YA_EXISTENTE";
  }

  // Orden total determinista: el mismo que recorre `verificarCadenaIntegridad()` al revés.
  const ultimoRegistro = await tx.auditLog.findFirst({
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    select: { hash_actual: true, created_at: true },
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

  // `created_at` (fuera del hash) conserva la semántica de Prisma (instante
  // UTC, milisegundos), pero se toma bajo el lock y con el reloj de PostgreSQL,
  // común a todos los procesos. Si cae en el mismo milisegundo que el anterior,
  // avanza 1 ms: `created_at` es estrictamente creciente y el orden por
  // `created_at, id` coincide con el orden real de la cadena.
  const [{ ahora }] = await tx.$queryRaw<{ ahora: Date }[]>`
    SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS ahora
  `;
  const createdAt = ultimoRegistro && ahora.getTime() <= ultimoRegistro.created_at.getTime()
    ? new Date(ultimoRegistro.created_at.getTime() + 1)
    : ahora;

  await tx.auditLog.create({
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
      created_at: createdAt,
    },
  });
  return "CREADO";
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
// Lectura — opciones de filtro dinámicas (task de filtros Acción/Usuario)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Valores DISTINCT de `AuditLog.accion` realmente presentes en el ledger,
 * para poblar el `<select>` de "Acción" en `FiltrosAuditoria` — nunca un
 * enum hardcodeado, así una acción nueva aparece sola en cuanto se registra
 * el primer evento con ese valor.
 */
export async function listarAccionesDistintas(): Promise<string[]> {
  const filas = await prisma.auditLog.findMany({
    distinct: ["accion"],
    select: { accion: true },
    orderBy: { accion: "asc" },
  });

  return filas.map((fila) => fila.accion);
}

export interface UsuarioParaFiltro {
  id: string;
  nombre_completo: string;
}

/**
 * Todos los `Usuario` del sistema (activos o no — el ledger forense debe
 * seguir siendo filtrable por un usuario ya dado de baja) para poblar el
 * combobox de "Usuario" en `FiltrosAuditoria`. Solo se llama cuando quien
 * consulta tiene `auditoria:leer_forense` (gate en `page.tsx`) — sin ese
 * permiso, la regla de segregación de `listarAuditLog()` fuerza igual el
 * filtro a la sesión actual, así que exponer esta lista no tendría sentido.
 */
export async function listarUsuariosParaFiltro(): Promise<UsuarioParaFiltro[]> {
  return prisma.usuario.findMany({
    select: { id: true, nombre_completo: true },
    orderBy: { nombre_completo: "asc" },
  });
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
  // Mismo orden total que el append (created_at, id), en sentido ascendente.
  const registros = await prisma.auditLog.findMany({
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
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
