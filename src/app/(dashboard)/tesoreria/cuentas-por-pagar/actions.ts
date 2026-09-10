"use server";

/**
 * @module actions — tesorería / cuentas por pagar (HU-G10)
 * @description Server Actions de la consola de Tesorería: cargar los
 * comprobantes VIGENTES de una Cuenta por Pagar y registrar su pago
 * (`DEFINITIVA → PAGADA`).
 *
 * Wrappers finos (spec §1, mismo patrón que
 * `compras/comprobantes/actions.ts`): resuelven sesión + permiso GRANULAR,
 * parsean con Zod e invocan la MISMA función de servicio que usa
 * `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar`. Ninguna regla de
 * negocio vive acá.
 */

import { revalidatePath } from "next/cache";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import {
  CuentaPorPagarIdSchema,
  MarcarPagadaSchema,
} from "@/lib/schemas/cuentas-por-pagar.schema";
import { listarComprobantesPorOrdenCompra } from "@/lib/services/proveedores/comprobante-proveedor.service";
import {
  marcarCuentaPorPagarPagada,
  PERMISO_LEER_CUENTAS_POR_PAGAR,
  PERMISO_PAGAR_CUENTA_POR_PAGAR,
  type CuentaPorPagarPagada,
} from "@/lib/services/tesoreria/cuenta-por-pagar.service";

/**
 * `ActionResult` local de este módulo. Mismo shape plano que
 * `compras/comprobantes/actions.ts` (`{ data, error }`), EXTENDIDO con
 * `details?: unknown` en la variante de error: HU-G10 necesita propagar
 * `error.details` del `COMPROBANTE_PROVEEDOR_REQUERIDO` (detalle por
 * comprobante) y los `fieldErrors` de Zod al formulario, sin perder el
 * contrato `{ code, message }` que el resto del proyecto ya consume.
 */
export type ActionResult<T> =
  | { data: T; error: null }
  | {
      data: null;
      error: { code: string; message: string; details?: unknown };
    };

/** Proyección mínima de un comprobante vigente para el checklist del form. */
export interface ComprobanteVigente {
  id: string;
  tipo: string;
  numero_comprobante: string;
  monto_total: string;
  fecha_emision: Date;
}

function fallo(
  code: string,
  message: string,
  details?: unknown,
): { data: null; error: { code: string; message: string; details?: unknown } } {
  return {
    data: null,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
}

/**
 * Comprobantes VIGENTES (`is_active`) de la Orden de Compra dueña de la
 * Cuenta por Pagar indicada. Insumo del checklist "comprobantes a imputar"
 * del formulario de pago.
 */
export async function obtenerComprobantesDeCuentaAction(
  cuentaPorPagarId: string,
): Promise<ActionResult<ComprobanteVigente[]>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = CuentaPorPagarIdSchema.safeParse(cuentaPorPagarId);
  if (!parsedId.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsedId.error.issues[0]?.message ?? "ID inválido",
    );
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_LEER_CUENTAS_POR_PAGAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_LEER_CUENTAS_POR_PAGAR}"`);
  }

  try {
    const cuenta = await prisma.cuentaPorPagar.findUnique({
      where: { id: parsedId.data },
      select: { orden_compra_id: true },
    });
    if (!cuenta) {
      return fallo(
        "CUENTA_POR_PAGAR_NO_ENCONTRADA",
        "La cuenta por pagar indicada no existe",
      );
    }

    // `listarComprobantesPorOrdenCompra` filtra `is_active: true` por defecto:
    // solo comprobantes vigentes (los anulados no se pueden imputar).
    const comprobantes = await listarComprobantesPorOrdenCompra(cuenta.orden_compra_id);
    const data: ComprobanteVigente[] = comprobantes.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      numero_comprobante: c.numero_comprobante,
      monto_total: c.monto_total,
      fecha_emision: c.fecha_emision,
    }));
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[obtenerComprobantesDeCuentaAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a
 * `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar` (spec §2.4 + HU-G10).
 * `cuentaPorPagarId` viaja como argumento explícito de la action (equivale
 * al path param `[id]`), nunca en el payload de datos.
 */
export async function registrarPagoCuentaPorPagarAction(
  cuentaPorPagarId: string,
  input: unknown,
): Promise<ActionResult<CuentaPorPagarPagada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = CuentaPorPagarIdSchema.safeParse(cuentaPorPagarId);
  if (!parsedId.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsedId.error.issues[0]?.message ?? "ID inválido",
    );
  }

  const parsed = MarcarPagadaSchema.safeParse(input);
  if (!parsed.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Datos inválidos",
      parsed.error.flatten().fieldErrors,
    );
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_PAGAR_CUENTA_POR_PAGAR))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_PAGAR_CUENTA_POR_PAGAR}"`);
  }

  try {
    const resultado = await marcarCuentaPorPagarPagada(
      parsedId.data,
      parsed.data,
      session.userId,
    );
    revalidatePath("/tesoreria/cuentas-por-pagar");
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[registrarPagoCuentaPorPagarAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
