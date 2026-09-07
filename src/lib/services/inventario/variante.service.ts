/**
 * @module variante.service
 * @description HU-A6 — Baja lógica (Soft Delete) de `VarianteSKU` con modal
 * de justificación (spec_modulo_A.md §2.5/§3.5/§4, spec_modulo_D.md §4).
 *
 * Cumplimiento normativo:
 *  - RULES.md §1 — Soft Delete estricto: solo lectura de `is_active: true`,
 *    ningún DELETE físico en este archivo. La baja es un `UPDATE` de los 4
 *    campos de soft delete (`is_active`, `deleted_at`, `deleted_by`,
 *    `deletion_reason`) — nunca se tocan `StockDeposito` ni
 *    `MovimientoStock` como efecto colateral (se preservan para trazabilidad).
 *  - spec_modulo_A.md §4 — el evento se emite DESPUÉS de que la operación
 *    resuelva exitosamente, nunca dentro de una transacción. Este service no
 *    escribe `AuditLog` directamente: emite al bus y `audit-log.listener.ts`
 *    reacciona (patrón unificado, ver docstring de ese listener).
 *
 * Autorización (decisión D2): los roles activos `ADMINISTRADOR` y
 * `ENCARGADO_DEPOSITO` pueden dar de baja variantes — verificado vía
 * `usuarioPuedeBajarVariante()`, exportada para que route handler y Server
 * Action compartan el mismo punto de verdad. No se usa
 * `withPermission("inventario:operar")` porque el seed solo otorga ese
 * permiso a `ENCARGADO_DEPOSITO` y dejaría fuera a `ADMINISTRADOR`.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { ListarVariantesInput, EditarVarianteOperativaInput } from "@/lib/schemas/inventario.schema";

export interface VariantePorProducto {
  id: string;
  talle: string;
  color: string;
  genero: string;
  modelo: string;
  sku: string;
}

/**
 * task_cali_selector_umbrales.md — sección 3: tercer nivel del selector
 * jerárquico (Depósito → Producto → Variante). Lista **todas** las
 * `VarianteSKU` activas de un `ProductoMaestro`, sin filtrar por si ya
 * tienen `StockDeposito` en el depósito elegido — mismo criterio que
 * `listarProductosConVariantes()` en `producto.service.ts`.
 */
export async function listarVariantesPorProducto(
  productoMaestroId: string,
): Promise<VariantePorProducto[]> {
  return prisma.varianteSKU.findMany({
    where: {
      producto_maestro_id: productoMaestroId,
      is_active: true,
    },
    select: {
      id: true,
      talle: true,
      color: true,
      genero: true,
      modelo: true,
      sku: true,
    },
    orderBy: [{ talle: "asc" }, { color: "asc" }],
  });
}

/** Roles con autorización vigente para dar de baja variantes (decisión D2). */
const ROLES_AUTORIZADOS_BAJA_VARIANTE = ["ADMINISTRADOR", "ENCARGADO_DEPOSITO"] as const;

/** Resultado de `darDeBajaVariante()` — solo los 4 campos de soft delete. */
export interface VarianteDadaDeBaja {
  id: string;
  is_active: boolean;
  /** Nullable en el schema real (`VarianteSKU.deleted_at DateTime?`); tras el update siempre trae fecha. */
  deleted_at: Date | null;
  deletion_reason: string | null;
}

/**
 * Verifica si el usuario tiene al menos un rol activo autorizado para dar de
 * baja variantes (`ADMINISTRADOR` o `ENCARGADO_DEPOSITO`), con la relación
 * `UsuarioRol → Rol` activa en ambos niveles (mismo patrón de
 * `usuarioTienePermiso()` en `lib/auth/with-permission.ts`).
 *
 * @param usuarioId - `usuario_id` de la sesión autenticada.
 */
export async function usuarioPuedeBajarVariante(usuarioId: string): Promise<boolean> {
  const match = await prisma.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId,
      is_active: true,
      rol: {
        is_active: true,
        nombre: { in: [...ROLES_AUTORIZADOS_BAJA_VARIANTE] },
      },
    },
    select: { id: true },
  });

  return match !== null;
}

/**
 * Baja lógica de una `VarianteSKU`, consciente del stock remanente:
 *  - stock total = `SUM(StockDeposito.cantidad)` sobre registros ACTIVOS de
 *    la variante (nulo → 0, decisión D10);
 *  - si el stock es 0 → baja directa y silenciosa (`deletion_reason = null`);
 *  - si el stock es > 0 y no hay `motivo` → `ServiceError("MOTIVO_REQUERIDO")`
 *    SIN tocar la base (defensa en profundidad, R3);
 *  - el `UPDATE` solo toca los 4 campos de soft delete, y el evento
 *    `inventario:variante_baja_logica` se emite DESPUÉS del update — nunca
 *    dentro de `prisma.$transaction` (regla de emisión, spec A §4). La
 *    mutación es de una sola tabla, no requiere transacción.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA | MOTIVO_REQUERIDO
 */
export async function darDeBajaVariante(
  varianteId: string,
  usuarioId: string,
  motivo?: string,
  ip = "unknown",
): Promise<VarianteDadaDeBaja> {
  const variante = await prisma.varianteSKU.findFirst({
    where: { id: varianteId, is_active: true },
    select: { id: true },
  });

  if (!variante) {
    throw new ServiceError(
      "VARIANTE_NO_ENCONTRADA",
      `No se encontró una variante activa con id ${varianteId}.`,
    );
  }

  // Un único aggregate por baja (spec A §3.5): stock activo previo al update.
  const stockTotal =
    (
      await prisma.stockDeposito.aggregate({
        where: { variante_sku_id: varianteId, is_active: true },
        _sum: { cantidad: true },
      })
    )._sum.cantidad ?? 0;

  if (stockTotal > 0 && !motivo?.trim()) {
    throw new ServiceError(
      "MOTIVO_REQUERIDO",
      "La variante tiene stock remanente en depósito: el motivo de baja es obligatorio.",
    );
  }

  const varianteDadaDeBaja = await prisma.varianteSKU.update({
    where: { id: varianteId },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: usuarioId,
      deletion_reason: motivo?.trim() || null,
    },
    select: { id: true, is_active: true, deleted_at: true, deletion_reason: true },
  });

  // Emisión POST-operación: `AuditLog` lo escribe exclusivamente el listener.
  domainEventBus.emit("inventario:variante_baja_logica", {
    variante_sku_id: varianteDadaDeBaja.id,
    usuario_id: usuarioId,
    deletion_reason: varianteDadaDeBaja.deletion_reason,
    stock_total_al_momento: stockTotal,
    ip,
  });

  return varianteDadaDeBaja;
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-A6 Ajustes — UI de Variantes (listado paginado + reporte inactivo)
// Funciones NUEVAS de solo lectura (add-only): no alteran la lógica aprobada
// `darDeBajaVariante()` ni ningún otro export existente de este archivo
// (criterio 8 — el backend de baja queda byte-idéntico).
// ──────────────────────────────────────────────────────────────────────────────

/** Tamaño de página fijo del listado de variantes (R2: máx. 10 por página). */
const PAGE_SIZE = 10;

/** Fila del listado paginado de `VarianteSKU` (vista Variantes, HU-A6). */
export interface VariantePaginada {
  id: string;
  sku: string;
  talle: string;
  color: string;
  genero: string;
  modelo: string;
  producto: string;
  stockTotal: number;
  deleted_at: Date | null;
  deleted_by: string | null;
  deleted_by_nombre: string | null;
  deletion_reason: string | null;
}

/** Resultado completo de `listarVariantesPaginadas()` — shape para el RSC. */
export interface ListadoVariantesPaginado {
  variantes: VariantePaginada[];
  total: number;
  page: number;
  page_size: number;
  tab: "activas" | "inactivas";
}

/**
 * Listado paginado de `VarianteSKU` según la pestaña activa (solo lectura).
 *
 * Cumplimiento normativo:
 *  - RULES.md §1 — los SELECT filtran inactivos por defecto; la pestaña
 *    "Inactivas" es el reporte de inventario inactivo del Criterio 2, bajo
 *    excepción documentada en `docs/specs/excepcion-criterio2-inactivas-variantes.md`
 *    (alcance SOLO LECTURA: ninguna mutación acá).
 *  - Búsqueda general parcial case-insensitive sobre `sku`, `talle`, `color`,
 *    `genero` y `modelo` (R3); combinable con `producto_maestro_id` (nunca
 *    por SKU) y ambos aplican sobre la pestaña activa.
 *  - Una única `Promise.all([findMany + count])` con el mismo `where` para
 *    consistencia del conteo; stock remanente = suma de `cantidad` sobre
 *    `StockDeposito` ACTIVOS (mismo criterio que `darDeBajaVariante` y el
 *    page.tsx anterior), agregado con reduce JS (10 filas/pág, una query).
 *  - `deleted_by` → `nombre_completo` resuelto con una 2ª query batch
 *    (`usuario.findMany`), evitando N+1 (no existe relación directa, decisión
 *    D9); si el id no resuelve → `null` y el render muestra "—" (escenario
 *    "Missing operator name").
 *
 * @param f - Filtros ya validados por `ListarVariantesSchema` (fallback del
 *            RSC cuando el safeParse falla: `parse({})`).
 */
export async function listarVariantesPaginadas(
  f: ListarVariantesInput,
): Promise<ListadoVariantesPaginado> {
  const where: Prisma.VarianteSKUWhereInput = {
    is_active: f.tab === "activas",
    ...(f.producto_maestro_id ? { producto_maestro_id: f.producto_maestro_id } : {}),
  };

  const q = f.q?.trim();
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { talle: { contains: q, mode: "insensitive" } },
      { color: { contains: q, mode: "insensitive" } },
      { genero: { contains: q, mode: "insensitive" } },
      { modelo: { contains: q, mode: "insensitive" } },
    ];
  }

  const skip = (f.page - 1) * PAGE_SIZE;

  const [variantes, total] = await Promise.all([
    prisma.varianteSKU.findMany({
      where,
      skip,
      take: PAGE_SIZE,
      orderBy: { sku: "asc" },
      select: {
        id: true,
        sku: true,
        talle: true,
        color: true,
        genero: true,
        modelo: true,
        deleted_at: true,
        deleted_by: true,
        deletion_reason: true,
        producto_maestro: { select: { nombre: true } },
        stock_depositos: {
          where: { is_active: true },
          select: { cantidad: true },
        },
      },
    }),
    prisma.varianteSKU.count({ where }),
  ]);

  // Resolución batch de `deleted_by` → `nombre_completo` (evita N+1).
  const deletedByIds = [
    ...new Set(variantes.map((v) => v.deleted_by).filter((id): id is string => Boolean(id))),
  ];
  let nombresPorId = new Map<string, string>();
  if (deletedByIds.length > 0) {
    const usuarios = await prisma.usuario.findMany({
      where: { id: { in: deletedByIds } },
      select: { id: true, nombre_completo: true },
    });
    nombresPorId = new Map(usuarios.map((u) => [u.id, u.nombre_completo]));
  }

  return {
    variantes: variantes.map((v) => ({
      id: v.id,
      sku: v.sku,
      talle: v.talle,
      color: v.color,
      genero: v.genero,
      modelo: v.modelo,
      producto: v.producto_maestro.nombre,
      stockTotal: v.stock_depositos.reduce((acumulado, stock) => acumulado + stock.cantidad, 0),
      deleted_at: v.deleted_at,
      deleted_by: v.deleted_by,
      deleted_by_nombre: v.deleted_by ? (nombresPorId.get(v.deleted_by) ?? null) : null,
      deletion_reason: v.deletion_reason,
    })),
    total,
    page: f.page,
    page_size: PAGE_SIZE,
    tab: f.tab,
  };
}

/**
 * Productos Maestro ACTIVOS para poblar el `ComboboxFiltrable` del filtro por
 * nombre (R3 — nunca por SKU). Solo lectura, ordenado por nombre.
 */
export async function listarProductosMaestroParaFiltro(): Promise<
  { id: string; nombre: string }[]
> {
  return prisma.productoMaestro.findMany({
    where: { is_active: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-A8 — editarVarianteOperativa
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA | PROVEEDOR_NO_ENCONTRADO | EAN_QR_DUPLICADO
 */
export async function editarVarianteOperativa(
  varianteId: string,
  input: EditarVarianteOperativaInput,
  usuarioId: string,
  ip = "unknown",
) {
  const actual = await prisma.varianteSKU.findFirst({
    where: { id: varianteId, is_active: true },
  });
  if (!actual) {
    throw new ServiceError("VARIANTE_NO_ENCONTRADA", `No se encontró una variante activa con id ${varianteId}.`);
  }

  const camposModificados = Object.keys(input) as (keyof EditarVarianteOperativaInput)[];
  if (camposModificados.length === 0) {
    return { id: actual.id, campos_modificados: [], updated_at: actual.updated_at };
  }

  if (input.proveedor_id !== undefined) {
    const proveedor = await prisma.proveedor.findFirst({
      where: { id: input.proveedor_id, is_active: true },
      select: { id: true },
    });
    if (!proveedor) {
      throw new ServiceError("PROVEEDOR_NO_ENCONTRADO", `No se encontró un Proveedor activo con id ${input.proveedor_id}.`);
    }
  }

  const valorAnterior: Record<string, unknown> = {};
  const valorNuevo: Record<string, unknown> = {};
  for (const campo of camposModificados) {
    valorAnterior[campo] = actual[campo as keyof typeof actual];
    valorNuevo[campo] = input[campo];
  }

  let actualizada;
  try {
    actualizada = await prisma.varianteSKU.update({
      where: { id: varianteId },
      data: input,
    });
  } catch (err) {
    if (esErrorPrismaP2002(err)) {
      throw new ServiceError("EAN_QR_DUPLICADO", `El código EAN-13 "${input.ean_qr}" ya está en uso por otra variante activa.`);
    }
    throw err;
  }

  domainEventBus.emit("inventario:variante_actualizada", {
    variante_sku_id: actualizada.id,
    usuario_id: usuarioId,
    campos_modificados: camposModificados,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo,
    ip,
  });

  return { id: actualizada.id, campos_modificados: camposModificados, updated_at: actualizada.updated_at };
}

/** Roles autorizados para editar atributos operativos de variante — misma lista que producto.service.ts, duplicada a propósito (add-only, no se toca darDeBajaVariante ni su const privada). */
const ROLES_AUTORIZADOS_EDITAR_VARIANTE = ["ADMINISTRADOR", "ENCARGADO_DEPOSITO"] as const;

export async function usuarioPuedeEditarVariante(usuarioId: string): Promise<boolean> {
  const match = await prisma.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId,
      is_active: true,
      rol: { is_active: true, nombre: { in: [...ROLES_AUTORIZADOS_EDITAR_VARIANTE] } },
    },
    select: { id: true },
  });
  return match !== null;
}

function esErrorPrismaP2002(err: unknown): boolean {
  return (
    err instanceof PrismaRuntime.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-A8 — buscarVariantesActivas (búsqueda liviana para combobox)
// ──────────────────────────────────────────────────────────────────────────────

export interface VarianteActivaResumen {
  id: string;
  sku: string;
  talle: string;
  color: string;
  genero: string;
  modelo: string;
  producto_nombre: string;
}

export async function buscarVariantesActivas(query: string): Promise<VarianteActivaResumen[]> {
  const texto = query.trim();
  if (texto.length < 2) return [];

  const variantes = await prisma.varianteSKU.findMany({
    where: {
      is_active: true,
      OR: [
        { sku: { contains: texto, mode: "insensitive" } },
        { talle: { contains: texto, mode: "insensitive" } },
        { color: { contains: texto, mode: "insensitive" } },
        { genero: { contains: texto, mode: "insensitive" } },
        { modelo: { contains: texto, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      sku: true,
      talle: true,
      color: true,
      genero: true,
      modelo: true,
      producto_maestro: { select: { nombre: true } },
    },
    orderBy: { sku: "asc" },
    take: 10,
  });

  return variantes.map((v) => ({
    id: v.id,
    sku: v.sku,
    talle: v.talle,
    color: v.color,
    genero: v.genero,
    modelo: v.modelo,
    producto_nombre: v.producto_maestro.nombre,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-A8 — obtenerVarianteParaEdicion
// ──────────────────────────────────────────────────────────────────────────────

export interface VarianteParaEdicion {
  id: string;
  sku: string;
  ean_qr: string | null;
  proveedor_id: string | null;
  talle: string;
  color: string;
  genero: string;
  modelo: string;
  producto_nombre: string;
}

/**
 * Trae una `VarianteSKU` activa por id, con los campos editables de
 * `EditarVarianteOperativaSchema` más `id`/`sku`/`talle`/`color`/`genero`/
 * `modelo`/`producto_nombre` de solo lectura para contexto de display en el
 * formulario (mismo criterio de "solo lectura de contexto" que ya usa
 * `buscarVariantesActivas()`). Distinta de esa función: esta es "una por
 * id", no búsqueda por texto.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA
 */
export async function obtenerVarianteParaEdicion(id: string): Promise<VarianteParaEdicion> {
  const variante = await prisma.varianteSKU.findFirst({
    where: { id, is_active: true },
    select: {
      id: true,
      sku: true,
      ean_qr: true,
      proveedor_id: true,
      talle: true,
      color: true,
      genero: true,
      modelo: true,
      producto_maestro: { select: { nombre: true } },
    },
  });

  if (!variante) {
    throw new ServiceError("VARIANTE_NO_ENCONTRADA", `No se encontró una variante activa con id ${id}.`);
  }

  return {
    id: variante.id,
    sku: variante.sku,
    ean_qr: variante.ean_qr,
    proveedor_id: variante.proveedor_id,
    talle: variante.talle,
    color: variante.color,
    genero: variante.genero,
    modelo: variante.modelo,
    producto_nombre: variante.producto_maestro.nombre,
  };
}
