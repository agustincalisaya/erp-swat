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
import { calcularHashEncadenado, HASH_GENESIS } from "@/lib/crypto/hash-chain";
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
 *
 * `transferencias_stock` agregada en la ronda de corrección post-HU-A7
 * (descubierto verificando FIX 4 con datos reales, no estaba en el
 * relevamiento original): sin ella, el WHERE base de
 * `obtenerLogsInventario()` excluía TODO evento de transferencia antes
 * siquiera de llegar al filtro de `tipo_movimiento` — "Transferencia"
 * daba 0 resultados pase lo que pase, incluso ya con el mapeo de acciones
 * corregido. Son movimientos de inventario reales (AC2 de la HU: "todos
 * los movimientos de stock e inventario"), quedaban afuera por omisión,
 * no por decisión de diseño.
 *
 * `reservas` agregada en la misma ronda, tras confirmar que
 * `transferencias_stock` no era el único hueco: es la 7ª y última tabla
 * de Módulo A en `schema.prisma` (modelo `Reserva`). A diferencia de
 * `transferencias_stock`, acá NO hay ningún evento real siendo silenciado
 * — no existe ningún emisor de dominio que escriba `tabla_afectada:
 * "reservas"` (confirmado por grep en `audit-log.listener.ts` y en
 * `event-types.ts`), y la tabla `Reserva` en sí está vacía: la
 * funcionalidad de negocio de Reservas todavía no está construida, no
 * solo su auditoría. Se agrega igual por completitud de dominio — cuando
 * exista esa funcionalidad, empieza a filtrar sin tocar este archivo de
 * nuevo — pero hoy es un no-op verificado (0 filas en `Reserva`, 0 en
 * `AuditLog` para esa tabla).
 */
const TABLAS_MODULO_A = [
  "stock_depositos",
  "movimientos_stock",
  "variantes_sku",
  "depositos",
  "productos_maestros",
  "transferencias_stock",
  "reservas",
] as const;

/**
 * Ronda de corrección post-HU-A7 (TC-HU7-07) — FIX 4: `AuditLog.accion` NO
 * usa los mismos literales que el enum `tipo_movimiento` del filtro. El
 * listener (`audit-log.listener.ts`) escribe `TRANSFERENCIA_DESPACHADA` /
 * `TRANSFERENCIA_RECIBIDA` (nunca `"TRANSFERENCIA"` a secas) y
 * `DELETE_LOGICO` (nunca `"DELETE"`). Antes de este mapeo, el filtro hacía
 * `where.accion = filtros.tipo_movimiento` (igualdad exacta) y esas dos
 * opciones devolvían 0 resultados aunque los eventos existieran.
 *
 * Mapa explícito en vez de `accion LIKE 'TRANSFERENCIA%'`: más preciso a
 * propósito — un futuro `TRANSFERENCIA_CANCELADA` (u otra variante que no
 * deba contar como "Transferencia" en este filtro) no cae adentro por
 * accidente solo por compartir el prefijo.
 */
const ACCIONES_POR_TIPO_MOVIMIENTO: Record<string, string[]> = {
  INGRESO: ["INGRESO"],
  CREATE: ["CREATE"],
  UPDATE: ["UPDATE"],
  TRANSFERENCIA: ["TRANSFERENCIA_DESPACHADA", "TRANSFERENCIA_RECIBIDA"],
  DELETE: ["DELETE_LOGICO"],
};

/**
 * Ronda de corrección post-HU-A7 (TC-HU7-06) — FIX 1: `fecha_hasta` llegaba
 * al `lte` sin normalizar, así que quedaba anclada a las 00:00:00.000 del
 * día elegido (mismo criterio de `z.coerce.date()` que usa `fecha_desde`,
 * que interpreta "YYYY-MM-DD" como medianoche UTC) — un rango con la MISMA
 * fecha en Desde y Hasta cubría un instante, no el día completo, y daba 0
 * resultados falsos aunque hubiera eventos ese día.
 *
 * Ancla en UTC deliberadamente (no `Date` local del server) — tiene que
 * coincidir con el mismo huso horario implícito que ya usa `fecha_desde`,
 * o el rango se corre un día en un server que no corra en UTC.
 */
function finDeDia(fecha: Date): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), 23, 59, 59, 999),
  );
}

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

  // FIX 3 (TC-HU7-05) — `sku_referencia` buscaba con ILIKE directo sobre
  // `registro_id`, que según la tabla afectada guarda un UUID (el del
  // movimiento, la variante o el producto), NUNCA el código de SKU legible
  // — el código real (ej. "CAMPOL-POLICIA-M-AZUL-HOMBRE") no existía en
  // ningún lado consultable por ese camino.
  //
  // Decisión de diseño (opción "a" del hallazgo, acotada a lo que el
  // modelo de datos permite resolver de forma limpia): antes de armar el
  // filtro, se resuelve el término contra el código real en las dos tablas
  // donde "SKU" tiene sentido de negocio —`VarianteSKU.sku` y
  // `ProductoMaestro.codigo_producto`— y se traduce a los `registro_id`
  // que corresponden. `movimientos_stock` es el caso más común en la
  // práctica (un Auditor buscando "los movimientos de esta variante") y el
  // más indirecto: su `registro_id` es el UUID del propio
  // `MovimientoStock`, no el de la variante, así que hace falta un segundo
  // salto (variante → movimientos que la referencian) para poder filtrar
  // por SKU ahí también.
  //
  // `stock_depositos` y `depositos` quedan fuera de este join a propósito:
  // no tienen un código de SKU/producto propio que resolver (`depositos`
  // ni siquiera es un concepto de catálogo), forzarlo ahí sería inventar
  // una relación que el negocio no pidió.
  //
  // Fallback explícito: si el término no matchea ningún código real, se
  // conserva el ILIKE crudo sobre `registro_id` — preserva el
  // comportamiento ya validado en TC-HU7-05 para quien busca pegando un
  // fragmento de un identificador interno a mano.
  if (filtros.sku_referencia) {
    const termino = filtros.sku_referencia.trim();

    const [variantesCoincidentes, productosCoincidentes] = await Promise.all([
      prisma.varianteSKU.findMany({
        where: { sku: { contains: termino, mode: "insensitive" } },
        select: { id: true },
      }),
      prisma.productoMaestro.findMany({
        where: { codigo_producto: { contains: termino, mode: "insensitive" } },
        select: { id: true },
      }),
    ]);

    const varianteIds = variantesCoincidentes.map((v) => v.id);
    const productoIds = productosCoincidentes.map((p) => p.id);

    const movimientosCoincidentes = varianteIds.length
      ? await prisma.movimientoStock.findMany({
          where: { variante_sku_id: { in: varianteIds } },
          select: { id: true },
        })
      : [];
    const movimientoIds = movimientosCoincidentes.map((m) => m.id);

    const registroIdsResueltos = [...varianteIds, ...productoIds, ...movimientoIds];

    where.registro_id = registroIdsResueltos.length
      ? { in: registroIdsResueltos }
      : { contains: termino, mode: "insensitive" };
  }

  if (filtros.fecha_desde || filtros.fecha_hasta) {
    where.created_at = {
      ...(filtros.fecha_desde ? { gte: filtros.fecha_desde } : {}),
      ...(filtros.fecha_hasta ? { lte: finDeDia(filtros.fecha_hasta) } : {}),
    };
  }

  if (filtros.tipo_movimiento) {
    where.accion = { in: ACCIONES_POR_TIPO_MOVIMIENTO[filtros.tipo_movimiento] };
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
 * Recalcula secuencialmente los hashes SHA-256 de TODO el ledger `AuditLog`
 * (sin filtrar por tabla) y detecta el primer punto de ruptura de la cadena.
 *
 * Punto crítico de diseño (ronda de corrección post-HU-A7): `registrarAuditLog()`
 * encadena cada evento contra el último registro de TODA la tabla `AuditLog`
 * — usuarios, roles, sesiones e inventario comparten una única cadena global,
 * nunca una cadena separada por módulo (ver `audit-log.service.ts`). Filtrar
 * primero por `TABLAS_MODULO_A` y recién ahí encadenar las filas filtradas
 * entre sí (como hacía la versión anterior de esta función) produce falsos
 * positivos de "ruptura" apenas hay un evento de otro módulo (ej. un login)
 * intercalado cronológicamente entre dos eventos de inventario — situación
 * habitual en uso real. La verificación tiene que recorrer la cadena
 * completa, igual que `verificarCadenaIntegridad()` de Módulo D
 * (`audit-log.service.ts`) — el filtro de Módulo A se aplica solo para
 * contar cuántos de los eventos ya verificados como íntegros pertenecen al
 * dominio de inventario, nunca para decidir adyacencia de hashes.
 *
 * No confía en los valores almacenados: reconstruye `hash_actual` en memoria
 * usando un acumulador local. Detecta dos clases de tamper:
 *  - `hash_anterior` manipulado en BD
 *  - payload del registro alterado
 */
export async function verificarCadenaHashesInventario(): Promise<ResultadoVerificacionInventario> {
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

  const tablasModuloA: readonly string[] = TABLAS_MODULO_A;
  let hashAnteriorEsperado = HASH_GENESIS;
  let registrosModuloAVerificados = 0;

  for (const registro of registros) {
    // Check 1: el hash_anterior almacenado debe coincidir con el acumulador
    if (registro.hash_anterior !== hashAnteriorEsperado) {
      return {
        integra: false,
        registros_verificados: registrosModuloAVerificados,
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
        registros_verificados: registrosModuloAVerificados,
        primer_registro_divergente_id: registro.id,
        hash_esperado: hashActualEsperado,
        hash_almacenado: registro.hash_actual,
      };
    }

    if (tablasModuloA.includes(registro.tabla_afectada)) {
      registrosModuloAVerificados++;
    }
    hashAnteriorEsperado = registro.hash_actual;
  }

  return { integra: true, registros_verificados: registrosModuloAVerificados };
}
