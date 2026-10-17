"use server";

/**
 * @module actions — pos (HU-B4/HU-B1, spec_modulo_B.md §2.1/§2.4)
 * @description Server Actions equivalentes a
 * `POST /api/ventas/[id]/override-descuento` (HU-B4) y `POST /api/ventas`
 * (HU-B1, `registrarVentaMostradorAction`, agregada en esta rama —
 * docs/tasks/task_relos.md §1).
 *
 * Wrapper fino (spec §1): resuelve sesión + permiso GRANULAR, parsea con
 * Zod, invoca la MISMA función de servicio que el Route Handler equivalente
 * y devuelve el shape plano `{ data, error }`. Está prohibido reimplementar
 * lógica de negocio acá — toda regla vive en `pedido-venta.service.ts` /
 * `venta-mostrador.service.ts`.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  AutorizarOverrideDescuentoSchema,
  PedidoVentaIdSchema,
  RegistrarVentaMostradorSchema,
} from "@/lib/schemas/ventas.schema";
import {
  autorizarOverrideDescuento,
  PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN,
  type OverrideDescuentoAutorizado,
} from "@/lib/services/ventas/pedido-venta.service";
import {
  registrarVentaMostrador,
  PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR,
  type VentaMostradorRegistrada,
} from "@/lib/services/ventas/venta-mostrador.service";

const PEDIDOS_PATH = "/ventas/pedidos";
const POS_PATH = "/ventas/pos";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

/** Server Action equivalente a `POST /api/ventas/[id]/override-descuento` (spec §2.4). */
export async function autorizarOverrideDescuentoAction(
  pedidoVentaId: string,
  input: unknown,
): Promise<ActionResult<OverrideDescuentoAutorizado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN}"`);
  }

  const parsedId = PedidoVentaIdSchema.safeParse(pedidoVentaId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido");
  }

  const parsed = AutorizarOverrideDescuentoSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  // Mismo mecanismo que el Route Handler equivalente y que
  // `usuario:sesion_iniciada` (login) — header `User-Agent` del request.
  const dispositivo = (await headers()).get("user-agent") ?? "unknown";

  try {
    const resultado = await autorizarOverrideDescuento(
      parsedId.data,
      parsed.data,
      session.userId,
      dispositivo,
    );
    revalidatePath(`${PEDIDOS_PATH}/${parsedId.data}`);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[autorizarOverrideDescuentoAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}

/** Server Action equivalente a `POST /api/ventas` (HU-B1, spec §2.1). */
export async function registrarVentaMostradorAction(
  input: unknown,
): Promise<ActionResult<VentaMostradorRegistrada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR}"`);
  }

  const parsed = RegistrarVentaMostradorSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const resultado = await registrarVentaMostrador(session.userId, parsed.data);
    revalidatePath(POS_PATH);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[registrarVentaMostradorAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}
