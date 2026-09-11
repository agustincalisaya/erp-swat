"use server";

/**
 * @module actions — proveedores (HU-H1, spec_modulo_H.md §2.1 / §2.2)
 * @description Server Actions equivalentes a `POST /api/proveedores`,
 * `PATCH /api/proveedores/[id]/estado`, `PATCH /api/proveedores/[id]/baja`
 * y `PATCH /api/proveedores/[id]`, para los formularios de gestión
 * operados por Comprador / Supervisor de Compras.
 *
 * Wrappers finos (spec §1): resuelven sesión + permiso GRANULAR, parsean con
 * Zod, invocan la MISMA función de servicio que el Route Handler y devuelven
 * el shape plano `{ data, error }`. Está prohibido reimplementar lógica de
 * negocio acá — toda regla vive en `proveedor.service.ts`.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  CambiarEstadoProveedorSchema,
  CrearProveedorSchema,
  DarDeBajaProveedorSchema,
  EditarProveedorSchema,
  esErrorCamposNoEditables,
  ProveedorIdSchema,
} from "@/lib/schemas/proveedores.schema";
import {
  cambiarEstadoProveedor as cambiarEstadoProveedorService,
  crearProveedor as crearProveedorService,
  darDeBajaProveedor as darDeBajaProveedorService,
  editarProveedor as editarProveedorService,
  PERMISO_BAJA,
  PERMISO_CREAR,
  PERMISO_EDITAR,
  PERMISO_HOMOLOGAR,
  type ProveedorCreado,
  type ProveedorDadoDeBaja,
  type ProveedorEditado,
  type ProveedorEstadoCambiado,
} from "@/lib/services/proveedores/proveedor.service";

const PROVEEDORES_PATH = "/compras/proveedores";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

/** Server Action equivalente a `POST /api/proveedores` (spec §2.1). */
export async function crearProveedor(
  input: unknown,
): Promise<ActionResult<ProveedorCreado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_CREAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_CREAR}"`);
  }

  const parsed = CrearProveedorSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await crearProveedorService(parsed.data);
    revalidatePath(PROVEEDORES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[crearProveedorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Server Action equivalente a `PATCH /api/proveedores/[id]/estado` (spec §2.2). */
export async function cambiarEstadoProveedor(
  proveedorId: unknown,
  input: unknown,
): Promise<ActionResult<ProveedorEstadoCambiado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = ProveedorIdSchema.safeParse(proveedorId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = CambiarEstadoProveedorSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_HOMOLOGAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_HOMOLOGAR}"`);
  }

  try {
    const data = await cambiarEstadoProveedorService(parsedId.data, parsed.data, session.userId);
    revalidatePath(PROVEEDORES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[cambiarEstadoProveedorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Server Action equivalente a `PATCH /api/proveedores/[id]/baja` (Regla N.° 1). */
export async function darDeBajaProveedor(
  proveedorId: unknown,
  input: unknown,
): Promise<ActionResult<ProveedorDadoDeBaja>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = ProveedorIdSchema.safeParse(proveedorId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = DarDeBajaProveedorSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_BAJA))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_BAJA}"`);
  }

  try {
    const data = await darDeBajaProveedorService(parsedId.data, parsed.data, session.userId);
    revalidatePath(PROVEEDORES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[darDeBajaProveedorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Server Action equivalente a `PATCH /api/proveedores/[id]` (edición de legajo). */
export async function editarProveedor(
  proveedorId: unknown,
  input: unknown,
): Promise<ActionResult<ProveedorEditado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = ProveedorIdSchema.safeParse(proveedorId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = EditarProveedorSchema.safeParse(input);
  if (!parsed.success) {
    // `cuit`/`estado` en el payload → 422 CAMPOS_NO_EDITABLES (D7), no un
    // VALIDATION_ERROR genérico.
    if (esErrorCamposNoEditables(parsed.error)) {
      return fallo(
        "CAMPOS_NO_EDITABLES",
        "El CUIT y el estado del proveedor no se pueden editar en el legajo",
      );
    }
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_EDITAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_EDITAR}"`);
  }

  try {
    const data = await editarProveedorService(parsedId.data, parsed.data, session.userId);
    revalidatePath(PROVEEDORES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[editarProveedorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
