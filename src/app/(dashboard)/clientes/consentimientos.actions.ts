"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ClienteIdConsentimientoSchema, RegularizarConsentimientoSchema, TransicionConsentimientoSchema } from "@/lib/schemas/consentimientos.schema";
import { esAdministradorCrmActivo, PERMISO_GESTIONAR_CONSENTIMIENTO, regularizarConsentimientoCliente, transicionarConsentimientoCliente } from "@/lib/services/clientes/consentimiento.service";

export async function regularizarConsentimiento(clienteId: string, input: unknown) {
  const fallo = (code: string, message: string) => ({ data: null, error: { code, message } });
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CONSENTIMIENTO))) {
    return fallo("FORBIDDEN", "No tenés permiso para gestionar consentimientos");
  }
  if (!ClienteIdConsentimientoSchema.safeParse(clienteId).success) return fallo("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado");
  const parsed = RegularizarConsentimientoSchema.safeParse(input);
  if (!parsed.success) return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  try {
    const data = await regularizarConsentimientoCliente(clienteId, parsed.data, session.userId);
    revalidatePath(`/clientes/${clienteId}`);
    return { data, error: null };
  } catch (error) {
    if (error instanceof ServiceError) return fallo(error.code, error.message);
    console.error("[regularizarConsentimiento] Error inesperado:", error);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Wrapper C4 etapa 3: el servicio vuelve a comprobar permiso y rol bajo bloqueo. */
export async function registrarTransicionConsentimiento(clienteId: string, input: unknown) {
  const fallo = (code: string, message: string) => ({ data: null, error: { code, message } });
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CONSENTIMIENTO))) {
    return fallo("FORBIDDEN", "No tenés permiso para gestionar consentimientos");
  }
  if (!ClienteIdConsentimientoSchema.safeParse(clienteId).success) return fallo("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado");
  const parsed = TransicionConsentimientoSchema.safeParse(input);
  if (!parsed.success) return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  if ((parsed.data.operacion === "EJECUTAR_REVOCACION" || parsed.data.operacion === "RECHAZAR_SOLICITUD" ||
    parsed.data.operacion === "NUEVA_ACEPTACION") && !(await esAdministradorCrmActivo(session.userId))) {
    return fallo("FORBIDDEN", "Esta operación requiere el rol Administrador CRM activo");
  }
  try {
    const data = await transicionarConsentimientoCliente(clienteId, parsed.data, session.userId);
    revalidatePath(`/clientes/${clienteId}`);
    return { data, error: null };
  } catch (error) {
    if (error instanceof ServiceError) return fallo(error.code, error.message);
    console.error("[registrarTransicionConsentimiento] Error inesperado:", error);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
