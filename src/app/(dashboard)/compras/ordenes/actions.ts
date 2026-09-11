"use server";

/**
 * @module actions — órdenes de compra (HU-H3, spec_modulo_H.md §2.4 / §2.5)
 * @description Server Actions equivalentes a `POST /api/ordenes-compra` y
 * `PATCH /api/ordenes-compra/[id]/estado`, para los formularios de gestión
 * operados por Comprador / Supervisor de Compras.
 *
 * Wrappers finos (spec §1): resuelven sesión + permiso GRANULAR, parsean con
 * Zod, invocan la MISMA función de servicio que el Route Handler y devuelven
 * el shape plano `{ data, error }` definido en spec §2 (mismo shape que el
 * Route Handler equivalente). Está prohibido reimplementar lógica de negocio
 * acá — toda regla vive en `orden-compra.service.ts`.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  CambiarEstadoOrdenCompraSchema,
  CrearOrdenCompraSchema,
  EditarItemsOrdenCompraSchema,
  OrdenCompraIdSchema,
} from "@/lib/schemas/ordenes-compra.schema";
import {
  cambiarEstadoOrdenCompra,
  crearOrdenCompra,
  editarItemsOrdenCompra,
  PERMISO_CREAR_ORDEN_COMPRA,
  PERMISO_POR_ACCION_ORDEN_COMPRA,
  type OrdenCompraCreada,
  type OrdenCompraEstadoCambiado,
  type OrdenCompraItemsEditados,
} from "@/lib/services/proveedores/orden-compra.service";

const ORDENES_PATH = "/compras/ordenes";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

/** Server Action equivalente a `POST /api/ordenes-compra` (spec §2.4). */
export async function crearOrdenCompraAction(
  input: unknown,
): Promise<ActionResult<OrdenCompraCreada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_CREAR_ORDEN_COMPRA))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_CREAR_ORDEN_COMPRA}"`);
  }

  const parsed = CrearOrdenCompraSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await crearOrdenCompra(parsed.data, session.userId);
    revalidatePath(ORDENES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[crearOrdenCompraAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Server Action equivalente a `PATCH /api/ordenes-compra/[id]/estado` (spec §2.5). */
export async function cambiarEstadoOrdenCompraAction(
  ordenCompraId: unknown,
  input: unknown,
): Promise<ActionResult<OrdenCompraEstadoCambiado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = OrdenCompraIdSchema.safeParse(ordenCompraId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = CambiarEstadoOrdenCompraSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const permiso = PERMISO_POR_ACCION_ORDEN_COMPRA[parsed.data.accion];
  if (!(await usuarioTienePermiso(session.userId, permiso))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${permiso}" para ${parsed.data.accion} una orden`);
  }

  try {
    const data = await cambiarEstadoOrdenCompra(parsedId.data, parsed.data, session.userId);
    revalidatePath(ORDENES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[cambiarEstadoOrdenCompraAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a `PUT /api/ordenes-compra/[id]/items` (HU-H3
 * CA2). Reemplazo total de los ítems de una orden en BORRADOR. El precio lo
 * resuelve el servicio — este wrapper no lo toca.
 */
export async function editarItemsOrdenCompraAction(
  ordenCompraId: unknown,
  input: unknown,
): Promise<ActionResult<OrdenCompraItemsEditados>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_CREAR_ORDEN_COMPRA))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_CREAR_ORDEN_COMPRA}"`);
  }

  const parsedId = OrdenCompraIdSchema.safeParse(ordenCompraId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = EditarItemsOrdenCompraSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await editarItemsOrdenCompra(parsedId.data, parsed.data, session.userId);
    revalidatePath(ORDENES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[editarItemsOrdenCompraAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
