"use server";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { CrearGastoOperativoSchema, EditarGastoOperativoSchema, DarDeBajaGastoOperativoSchema, GastoOperativoIdSchema } from "@/lib/schemas/gasto-operativo.schema";
import { crearGastoOperativo, editarGastoOperativo, darDeBajaGastoOperativo, PERMISO_GESTIONAR_GASTOS, type GastoOperativoListado } from "@/lib/services/tesoreria/gasto-operativo.service";

type Resultado = { data: GastoOperativoListado; error: null } | { data: null; error: { code: string; message: string } };
const fallo = (code: string, message: string): Resultado => ({ data: null, error: { code, message } });
async function ejecutar(id: unknown | null, input: unknown, modo: "crear" | "editar" | "baja"): Promise<Resultado> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_GASTOS))) return fallo("FORBIDDEN", "Acceso denegado");
  const parsedId = modo === "crear" ? null : GastoOperativoIdSchema.safeParse(id);
  if (parsedId && !parsedId.success) return fallo("VALIDATION_ERROR", "ID inválido");
  const schema = modo === "crear" ? CrearGastoOperativoSchema : modo === "editar" ? EditarGastoOperativoSchema : DarDeBajaGastoOperativoSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  try {
    if (modo === "crear") return { data: await crearGastoOperativo(CrearGastoOperativoSchema.parse(input), session.userId), error: null };
    const gastoId = GastoOperativoIdSchema.parse(id);
    if (modo === "editar") return { data: await editarGastoOperativo(gastoId, EditarGastoOperativoSchema.parse(input), session.userId), error: null };
    return { data: await darDeBajaGastoOperativo(gastoId, DarDeBajaGastoOperativoSchema.parse(input), session.userId), error: null };
  } catch (error) {
    if (error instanceof ServiceError) return fallo(error.code, error.message);
    console.error("[HU-G13 actions] Error inesperado:", error);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}
export async function crearGastoOperativoAction(input: unknown) { return ejecutar(null, input, "crear"); }
export async function editarGastoOperativoAction(id: unknown, input: unknown) { return ejecutar(id, input, "editar"); }
export async function darDeBajaGastoOperativoAction(id: unknown, input: unknown) { return ejecutar(id, input, "baja"); }
