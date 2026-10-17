"use server";

/**
 * @module actions — integraciones (Módulo F, HU-F1)
 * @description Server Actions del panel de administración del Conector de
 * Mercado Pago. Cada acción re-valida en el borde servidor (sesión + permiso
 * `integraciones:administrar_conector` + Zod) aunque el origen sea un
 * formulario del Server Component, delega en `conector-pago.service.ts` y
 * revalida la ruta. Los errores se devuelven por query param (la UI los
 * muestra enmascarados; nunca se filtra el stack).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { BajaConectorSchema, CrearConectorMercadoPagoSchema } from "@/lib/schemas/integraciones.schema";
import {
  crearConector,
  darDeBajaConector,
  ejecutarHealthCheck,
  PERMISO_ADMINISTRAR_CONECTOR,
} from "@/lib/services/integraciones/conector-pago.service";

const BASE = "/administracion/integraciones";

function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre);
  return typeof valor === "string" ? valor : "";
}

/** Sesión + permiso; redirige con el código de error si no autoriza. */
async function exigirAdministrador(): Promise<{ userId: string }> {
  const session = await getServerSession();
  if (!session) redirect(`${BASE}?error=UNAUTHORIZED`);
  if (!(await usuarioTienePermiso(session.userId, PERMISO_ADMINISTRAR_CONECTOR))) {
    redirect(`${BASE}?error=FORBIDDEN`);
  }
  return { userId: session.userId };
}

function codigoDeError(err: unknown): string {
  return err instanceof ServiceError ? err.code : "INTERNAL_ERROR";
}

/** Alta del Conector (spec F §2.1.1). */
export async function crearConectorMercadoPago(formData: FormData): Promise<void> {
  const { userId } = await exigirAdministrador();

  const parsed = CrearConectorMercadoPagoSchema.safeParse({
    nombre: campo(formData, "nombre"),
    entorno: campo(formData, "entorno"),
    access_token: campo(formData, "access_token"),
    public_key: campo(formData, "public_key"),
    webhook_secret: campo(formData, "webhook_secret"),
  });
  if (!parsed.success) redirect(`${BASE}?error=VALIDATION_ERROR`);

  try {
    await crearConector(parsed.data, userId);
    revalidatePath(BASE);
  } catch (err) {
    console.error("[crearConectorMercadoPago] Error:", codigoDeError(err));
    redirect(`${BASE}?error=${encodeURIComponent(codigoDeError(err))}`);
  }
  redirect(`${BASE}?ok=creado`);
}

/** Health-check de un Conector (spec F §2.1.2). */
export async function ejecutarHealthCheckAction(formData: FormData): Promise<void> {
  await exigirAdministrador();

  const conectorId = campo(formData, "conector_id");
  if (!conectorId) redirect(`${BASE}?error=VALIDATION_ERROR`);

  try {
    await ejecutarHealthCheck(conectorId);
    revalidatePath(BASE);
  } catch (err) {
    console.error("[ejecutarHealthCheckAction] Error:", codigoDeError(err));
    redirect(`${BASE}?error=${encodeURIComponent(codigoDeError(err))}`);
  }
  redirect(`${BASE}?ok=health_check`);
}

/** Baja lógica de un Conector (spec F §2.1.5). */
export async function darDeBajaConectorAction(formData: FormData): Promise<void> {
  const { userId } = await exigirAdministrador();

  const conectorId = campo(formData, "conector_id");
  const parsed = BajaConectorSchema.safeParse({ deletion_reason: campo(formData, "deletion_reason") });
  if (!conectorId || !parsed.success) redirect(`${BASE}?error=VALIDATION_ERROR`);

  try {
    await darDeBajaConector(conectorId, userId, parsed.data.deletion_reason);
    revalidatePath(BASE);
  } catch (err) {
    console.error("[darDeBajaConectorAction] Error:", codigoDeError(err));
    redirect(`${BASE}?error=${encodeURIComponent(codigoDeError(err))}`);
  }
  redirect(`${BASE}?ok=baja`);
}
