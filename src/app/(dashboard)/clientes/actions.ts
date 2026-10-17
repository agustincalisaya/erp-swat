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
import {
  CrearClienteSchema,
  AgregarDireccionClienteSchema,
  ActualizarCanalContactoSchema,
  ActualizarSegmentoClienteSchema,
  BajaClienteSchema,
  EditarClienteSchema,
  EditarDireccionClienteSchema,
  esErrorClienteCamposNoEditables,
} from "@/lib/schemas/clientes.schema";
import {
  actualizarCanalContacto as actualizarCanalContactoService,
  actualizarSegmentoCliente as actualizarSegmentoClienteService,
  agregarDireccionCliente as agregarDireccionClienteService,
  bajaCliente as bajaClienteService,
  crearCliente as crearClienteService,
  editarCliente as editarClienteService,
  editarDireccionCliente as editarDireccionClienteService,
  PERMISO_BAJA,
  PERMISO_CREAR,
  PERMISO_EDITAR,
  PERMISO_GESTIONAR_SEGMENTO,
  type CanalContactoActualizado,
  type ClienteCreado,
  type ClienteDadoDeBaja,
  type ClienteEditado,
  type DireccionAgregada,
  type DireccionEditada,
  type SegmentoActualizado,
} from "@/lib/services/clientes/cliente.service";

export type {
  ClienteCreado,
  ClienteDadoDeBaja,
  ClienteEditado,
  DireccionAgregada,
  DireccionEditada,
  CanalContactoActualizado,
  SegmentoActualizado,
};

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

/**
 * Server Action equivalente a
 * `PATCH /api/clientes/[id]/canal-contacto` (HU-C9, spec_modulo_C.md §2.3).
 * Wrapper fino: sesión + permiso granular `clientes:editar`, parseo Zod,
 * invocación de la MISMA función de servicio que el Route Handler y mapeo a
 * `{ data, error }`. Ninguna regla de negocio vive acá.
 *
 * `clienteId` llega como ARGUMENTO explícito (el `[id]` del path en la ruta
 * equivalente) y NUNCA se lee del input parseado: el body no es fuente de
 * verdad del cliente. Un `cliente_id` espurio en `input` se descarta en el
 * parseo.
 */
export async function actualizarCanalContacto(
  clienteId: string,
  input: unknown,
): Promise<ActionResult<CanalContactoActualizado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_EDITAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_EDITAR}"`);
  }

  const parsed = ActualizarCanalContactoSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await actualizarCanalContactoService(clienteId, parsed.data, session.userId);
    revalidatePath(`/clientes/${clienteId}`);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[actualizarCanalContactoAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a `PATCH /api/clientes/[id]/segmento`
 * (HU-C8, spec_modulo_C.md §2.8). Wrapper fino: sesión + permiso granular
 * `clientes:gestionar_segmento` (DISTINTO de `clientes:editar`), parseo Zod,
 * invocación de la MISMA función de servicio que el Route Handler y mapeo a
 * `{ data, error }`. Ninguna regla de negocio vive acá.
 *
 * `clienteId` llega como ARGUMENTO explícito (el `[id]` del path en la ruta
 * equivalente) y NUNCA se lee del input parseado: el body no es fuente de
 * verdad del cliente. Un `cliente_id` espurio en `input` se descarta en el
 * parseo.
 */
export async function actualizarSegmentoCliente(
  clienteId: string,
  input: unknown,
): Promise<ActionResult<SegmentoActualizado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_SEGMENTO))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_GESTIONAR_SEGMENTO}"`);
  }

  const parsed = ActualizarSegmentoClienteSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await actualizarSegmentoClienteService(clienteId, parsed.data, session.userId);
    revalidatePath(`/clientes/${clienteId}`);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[actualizarSegmentoClienteAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a `PATCH /api/clientes/[id]` (HU-C2). Wrapper
 * fino: sesión + permiso granular `clientes:editar`, parseo Zod, invocación de
 * la MISMA función de servicio que el Route Handler y mapeo a `{ data, error }`.
 * Ninguna regla de negocio vive acá.
 *
 * `clienteId` llega como ARGUMENTO explícito y NUNCA se lee del input. Un
 * `dni` en `input` se rechaza con `CAMPOS_NO_EDITABLES` (mismo código que el 422
 * del Route Handler).
 */
export async function editarCliente(
  clienteId: string,
  input: unknown,
): Promise<ActionResult<ClienteEditado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_EDITAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_EDITAR}"`);
  }

  const parsed = EditarClienteSchema.safeParse(input);
  if (!parsed.success) {
    if (esErrorClienteCamposNoEditables(parsed.error)) {
      return fallo("CAMPOS_NO_EDITABLES", "El DNI de un cliente no se puede editar");
    }
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await editarClienteService(clienteId, parsed.data, session.userId);
    revalidatePath(`/clientes/${clienteId}`);
    revalidatePath(CLIENTES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[editarClienteAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a
 * `PATCH /api/clientes/[id]/direcciones/[direccionId]` (HU-C2). Wrapper fino:
 * sesión + permiso granular `clientes:editar`, parseo Zod, invocación de la
 * MISMA función de servicio que el Route Handler y mapeo a `{ data, error }`.
 * `clienteId` y `direccionId` llegan como ARGUMENTOS explícitos (los path
 * params de la ruta equivalente), nunca del input.
 */
export async function editarDireccionCliente(
  clienteId: string,
  direccionId: string,
  input: unknown,
): Promise<ActionResult<DireccionEditada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_EDITAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_EDITAR}"`);
  }

  const parsed = EditarDireccionClienteSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await editarDireccionClienteService(
      clienteId,
      direccionId,
      parsed.data,
      session.userId,
    );
    revalidatePath(`/clientes/${clienteId}`);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[editarDireccionClienteAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a `PATCH /api/clientes/[id]/baja` (HU-C6,
 * spec_modulo_C.md §2.6). Wrapper fino: sesión + permiso granular
 * `clientes:baja` (solo Administrador de CRM), parseo Zod (motivo obligatorio),
 * invocación de la MISMA función de servicio que el Route Handler y mapeo a
 * `{ data, error }`. Ninguna regla de negocio vive acá.
 *
 * `clienteId` llega como ARGUMENTO explícito y NUNCA se lee del input. Un
 * cliente inexistente o ya dado de baja devuelve `CLIENTE_NO_ENCONTRADO`.
 */
export async function bajaCliente(
  clienteId: string,
  input: unknown,
): Promise<ActionResult<ClienteDadoDeBaja>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_BAJA))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_BAJA}"`);
  }

  const parsed = BajaClienteSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await bajaClienteService(clienteId, session.userId, parsed.data.deletion_reason);
    revalidatePath(`/clientes/${clienteId}`);
    revalidatePath(CLIENTES_PATH);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[bajaClienteAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
