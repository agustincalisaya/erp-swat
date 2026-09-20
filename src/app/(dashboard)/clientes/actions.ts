"use server";

/**
 * @module actions — clientes (HU-C1, spec_modulo_C.md §2.1)
 * @description Server Action equivalente a `POST /api/clientes`, para el
 * formulario de alta operado por Vendedor / Administrador de CRM.
 *
 * Wrapper fino (spec §1): resuelve sesión + permiso granular, parsea con
 * Zod, invoca la MISMA función de servicio que el Route Handler y devuelve
 * el shape plano `{ data, error }`. Está prohibido reimplementar lógica de
 * negocio acá — toda regla vive en `cliente.service.ts`.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { CrearClienteSchema, AgregarDireccionClienteSchema } from "@/lib/schemas/clientes.schema";
import {
  agregarDireccionCliente as agregarDireccionClienteService,
  crearCliente as crearClienteService,
  PERMISO_CREAR,
  PERMISO_EDITAR,
  type ClienteCreado,
  type DireccionAgregada,
} from "@/lib/services/clientes/cliente.service";

export type { ClienteCreado, DireccionAgregada };

const CLIENTES_PATH = "/clientes";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

/** Server Action equivalente a `POST /api/clientes` (spec §2.1). */
export async function crearCliente(
  input: unknown,
): Promise<ActionResult<ClienteCreado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_CREAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_CREAR}"`);
  }

  const parsed = CrearClienteSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await crearClienteService(parsed.data, session.userId);
    revalidatePath(CLIENTES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[crearClienteAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a `POST /api/clientes/[id]/direcciones`
 * (HU-C3, spec_modulo_C.md §2.3). Wrapper fino: sesión + permiso granular
 * `clientes:editar`, parseo Zod, invocación de la MISMA función de servicio
 * que el Route Handler y mapeo a `{ data, error }`. Ninguna regla de negocio
 * vive acá.
 *
 * `clienteId` llega como ARGUMENTO explícito (el `[id]` del path en la
 * ruta equivalente) y NUNCA se lee del input parseado: el body no es fuente
 * de verdad del cliente. Un `cliente_id` espurio en `input` se descarta en
 * el parseo.
 */
export async function agregarDireccionCliente(
  clienteId: string,
  input: unknown,
): Promise<ActionResult<DireccionAgregada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_EDITAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_EDITAR}"`);
  }

  const parsed = AgregarDireccionClienteSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await agregarDireccionClienteService(clienteId, parsed.data, session.userId);
    revalidatePath(`/clientes/${clienteId}`);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[agregarDireccionClienteAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
