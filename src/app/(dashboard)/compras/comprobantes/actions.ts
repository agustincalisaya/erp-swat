"use server";

/**
 * @module actions — comprobantes (HU-H9, spec_modulo_H.md §2.7)
 * @description Server Actions equivalentes a
 * `POST /api/ordenes-compra/[id]/comprobantes`,
 * `PATCH /api/comprobantes-proveedor/[id]/anular` y
 * `GET /api/comprobantes-proveedor`, para los formularios de gestión
 * operados por Comprador / Supervisor de Compras.
 *
 * Wrappers finos (spec §1): resuelven sesión + permiso GRANULAR, parsean con
 * Zod, invocan la MISMA función de servicio que el Route Handler y devuelven
 * el shape plano `{ data, error }`. Está prohibido reimplementar lógica de
 * negocio acá — toda regla vive en `comprobante-proveedor.service.ts`.
 *
 * `orden_compra_id` es un argumento explícito de la action (equivale al path
 * param `[id]` del Route Handler), nunca parte del payload de datos.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  AnularComprobanteProveedorSchema,
  ComprobanteOrdenCompraIdSchema,
  ComprobanteProveedorIdSchema,
  FiltrosListadoComprobantesProveedorSchema,
  RegistrarComprobanteProveedorSchema,
} from "@/lib/schemas/comprobantes-proveedor.schema";
import {
  anularComprobanteProveedor as anularComprobanteProveedorService,
  listarComprobantesProveedor as listarComprobantesProveedorService,
  registrarComprobanteProveedor as registrarComprobanteProveedorService,
  PERMISO_ANULAR,
  PERMISO_CREAR,
  PERMISO_LEER,
  type ComprobanteProveedorAnulado,
  type ComprobanteProveedorRegistrado,
  type ListadoComprobantesProveedor,
} from "@/lib/services/proveedores/comprobante-proveedor.service";

const PERMISO_AUDITORIA = "auditoria:leer_forense";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(
  code: string,
  message: string,
): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

/** Revalida la vista de detalle de la OC (donde vive la card de comprobantes). */
function revalidarOrden(ordenCompraId: string): void {
  revalidatePath(`/compras/ordenes/${ordenCompraId}`);
}

/** Server Action equivalente a `POST /api/ordenes-compra/[id]/comprobantes` (spec §2.7). */
export async function registrarComprobanteProveedor(
  ordenCompraId: unknown,
  input: unknown,
): Promise<ActionResult<ComprobanteProveedorRegistrado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = ComprobanteOrdenCompraIdSchema.safeParse(ordenCompraId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = RegistrarComprobanteProveedorSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_CREAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_CREAR}"`);
  }

  try {
    const data = await registrarComprobanteProveedorService(
      parsedId.data,
      parsed.data,
      session.userId,
    );
    revalidarOrden(parsedId.data);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[registrarComprobanteProveedorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Server Action equivalente a `PATCH /api/comprobantes-proveedor/[id]/anular` (Regla N.° 1). */
export async function anularComprobanteProveedor(
  comprobanteId: unknown,
  input: unknown,
  ordenCompraId?: string,
): Promise<ActionResult<ComprobanteProveedorAnulado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = ComprobanteProveedorIdSchema.safeParse(comprobanteId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = AnularComprobanteProveedorSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_ANULAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_ANULAR}"`);
  }

  try {
    const data = await anularComprobanteProveedorService(
      parsedId.data,
      parsed.data,
      session.userId,
    );
    if (ordenCompraId) revalidarOrden(ordenCompraId);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[anularComprobanteProveedorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Server Action equivalente a `GET /api/comprobantes-proveedor` (insumo HU-G10). */
export async function listarComprobantesProveedor(
  filtros: unknown,
): Promise<ActionResult<ListadoComprobantesProveedor>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsed = FiltrosListadoComprobantesProveedorSchema.safeParse(filtros ?? {});
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Filtros inválidos");
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_LEER))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_LEER}"`);
  }

  try {
    const incluirAnulados = await usuarioTienePermiso(session.userId, PERMISO_AUDITORIA);
    const data = await listarComprobantesProveedorService(parsed.data, { incluirAnulados });
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[listarComprobantesProveedorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
