"use server";

import { getServerSession } from "@/lib/auth/session";
import type { z } from "zod";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { CategoriaGastoIdSchema, CrearCategoriaGastoSchema, EditarCategoriaGastoSchema, DarDeBajaCategoriaGastoSchema } from "@/lib/schemas/categoria-gasto.schema";
import { crearCategoriaGasto, editarCategoriaGasto, darDeBajaCategoriaGasto, PERMISO_GESTIONAR_CATEGORIAS_GASTO, type CategoriaGastoListado } from "@/lib/services/tesoreria/categoria-gasto.service";

type ActionResult = { data: CategoriaGastoListado; error: null } | { data: null; error: { code: string; message: string } };
const fallo = (code: string, message: string): ActionResult => ({ data: null, error: { code, message } });

async function acceso(): Promise<string | ActionResult> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CATEGORIAS_GASTO))) return fallo("FORBIDDEN", "Acceso denegado");
  return session.userId;
}

async function ejecutar<T>(
  schema: z.ZodType<T>,
  input: unknown,
  operacion: (data: T, usuarioId: string) => Promise<CategoriaGastoListado>,
  usuarioIdAutorizado?: string,
): Promise<ActionResult> {
  const usuarioId = usuarioIdAutorizado ?? await acceso();
  if (typeof usuarioId !== "string") return usuarioId;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  try { return { data: await operacion(parsed.data, usuarioId), error: null }; }
  catch (error) {
    if (error instanceof ServiceError) return fallo(error.code, error.message);
    console.error("[HU-G12 actions] Error inesperado:", error);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}

export async function crearCategoriaGastoAction(input: unknown): Promise<ActionResult> {
  return ejecutar(CrearCategoriaGastoSchema, input, crearCategoriaGasto);
}
export async function editarCategoriaGastoAction(id: unknown, input: unknown): Promise<ActionResult> {
  const usuarioId = await acceso();
  if (typeof usuarioId !== "string") return usuarioId;
  const parsedId = CategoriaGastoIdSchema.safeParse(id);
  if (!parsedId.success) return fallo("VALIDATION_ERROR", "ID inválido");
  return ejecutar(EditarCategoriaGastoSchema, input, (data, userId) => editarCategoriaGasto(parsedId.data, data, userId), usuarioId);
}
export async function darDeBajaCategoriaGastoAction(id: unknown, input: unknown): Promise<ActionResult> {
  const usuarioId = await acceso();
  if (typeof usuarioId !== "string") return usuarioId;
  const parsedId = CategoriaGastoIdSchema.safeParse(id);
  if (!parsedId.success) return fallo("VALIDATION_ERROR", "ID inválido");
  return ejecutar(DarDeBajaCategoriaGastoSchema, input, (data, userId) => darDeBajaCategoriaGasto(parsedId.data, data, userId), usuarioId);
}
