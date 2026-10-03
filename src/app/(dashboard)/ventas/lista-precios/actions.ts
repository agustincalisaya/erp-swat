"use server";

/**
 * @module actions — lista-precios (HU-B9, spec_modulo_B.md §2.9)
 * @description Server Actions equivalentes a
 * `POST /api/ventas/lista-precios/versiones` y
 * `GET /api/ventas/lista-precios/sugerencia/[variante_sku_id]`.
 *
 * Wrappers finos (spec §1): sesión + permiso GRANULAR, parseo Zod, misma
 * función de servicio que el Route Handler equivalente y shape plano
 * `{ data, error }`. Sin lógica de negocio acá — vive en
 * `lista-precio-venta.service.ts`. Sufijo `Action` para no chocar con las
 * funciones homónimas del servicio (patrón HU-B4/B5). Sin pantalla todavía
 * (API primero, decisión de la task §6): no hay ruta que revalidar.
 */
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { CrearVersionListaPrecioVentaSchema, VarianteSkuIdSchema } from "@/lib/schemas/ventas.schema";
import {
  obtenerSugerenciaPrecio,
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
  publicarVersionListaPrecioVenta,
  type SugerenciaPrecioVenta,
  type VersionListaPrecioVentaPublicada,
} from "@/lib/services/ventas/lista-precio-venta.service";

export type ActionError = { code: string; message: string; details?: unknown };
export type ActionResult<T> = { data: T; error: null } | { data: null; error: ActionError };

function fallo(code: string, message: string, details?: unknown): { data: null; error: ActionError } {
  return { data: null, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

async function verificarAcceso(): Promise<{ userId: string } | { data: null; error: ActionError }> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS}"`);
  }
  return { userId: session.userId };
}

/** Server Action equivalente a `POST /api/ventas/lista-precios/versiones`. */
export async function publicarVersionListaPrecioVentaAction(
  input: unknown,
): Promise<ActionResult<VersionListaPrecioVentaPublicada>> {
  const acceso = await verificarAcceso();
  if (!("userId" in acceso)) return acceso;

  const parsed = CrearVersionListaPrecioVentaSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    return { data: await publicarVersionListaPrecioVenta(parsed.data, acceso.userId), error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[publicarVersionListaPrecioVentaAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}

/** Server Action equivalente a `GET /api/ventas/lista-precios/sugerencia/[variante_sku_id]`. */
export async function obtenerSugerenciaPrecioAction(
  varianteSkuId: string,
): Promise<ActionResult<SugerenciaPrecioVenta>> {
  const acceso = await verificarAcceso();
  if (!("userId" in acceso)) return acceso;

  const parsedId = VarianteSkuIdSchema.safeParse(varianteSkuId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido");
  }

  try {
    return { data: await obtenerSugerenciaPrecio(parsedId.data), error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[obtenerSugerenciaPrecioAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}
