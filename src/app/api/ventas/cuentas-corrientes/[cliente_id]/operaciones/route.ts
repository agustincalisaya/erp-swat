/**
 * @module route — POST /api/ventas/cuentas-corrientes/[cliente_id]/operaciones
 * @description HU-B5 §2.2 — Registro de una operación a cuenta corriente.
 * Wrapper fino (spec §1): sesión + permiso `ventas:gestionar_cuenta_corriente`,
 * valida path param + body con Zod, delega en
 * `registrarOperacionCuentaCorriente()` y mapea resultado/excepción.
 *
 * Operación dentro del límite → 201 `{ operacion_id, estado: "APROBADA" }`.
 * Operación que excede el límite → la operación RETENIDA YA está persistida;
 * el servicio lanza `LIMITE_CREDITO_EXCEDIDO` y esta ruta responde 422 con
 * `error.details.operacion_id` (precedente HU-G10: `details` solo se propaga
 * en las rutas que lo piden explícitamente).
 *
 * Respuestas: 201 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 CUENTA_CORRIENTE_NO_ENCONTRADA / PEDIDO_VENTA_NO_ENCONTRADO ·
 * 422 LIMITE_CREDITO_EXCEDIDO / PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE /
 * PEDIDO_VENTA_NO_OPERABLE · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  ClienteCuentaCorrienteIdSchema,
  RegistrarOperacionCuentaCorrienteSchema,
} from "@/lib/schemas/ventas.schema";
import {
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
  registrarOperacionCuentaCorriente,
} from "@/lib/services/ventas/cuenta-corriente.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ cliente_id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CUENTA_CORRIENTE_NO_ENCONTRADA: 404,
  PEDIDO_VENTA_NO_ENCONTRADO: 404,
  PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE: 422,
  PEDIDO_VENTA_NO_OPERABLE: 422,
  LIMITE_CREDITO_EXCEDIDO: 422,
};

export const POST = withPermission(
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
  async (req: NextRequest, _session, rawContext) => {
    const { cliente_id } = await (rawContext as Context).params;
    const parsedId = ClienteCuentaCorrienteIdSchema.safeParse(cliente_id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = RegistrarOperacionCuentaCorrienteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Datos inválidos",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await registrarOperacionCuentaCorriente(parsedId.data, parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          {
            data: null,
            error: {
              code: err.code,
              message: err.message,
              ...(err.details !== undefined ? { details: err.details } : {}),
            },
          },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/ventas/cuentas-corrientes/[cliente_id]/operaciones] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
