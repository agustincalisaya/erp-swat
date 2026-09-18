/**
 * @module route — GET /api/ventas/cuentas-corrientes/[cliente_id]
 * @description HU-B5 §2.1 — Consulta de la cuenta corriente de un cliente
 * (`{ cliente_id, limite_credito_autorizado, saldo_actual, disponible }`).
 * Wrapper fino (spec §1): sesión + permiso `ventas:gestionar_cuenta_corriente`,
 * valida el path param y delega en `consultarCuentaCorriente()`. Sin lógica
 * de negocio acá.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 CUENTA_CORRIENTE_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ClienteCuentaCorrienteIdSchema } from "@/lib/schemas/ventas.schema";
import {
  consultarCuentaCorriente,
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
} from "@/lib/services/ventas/cuenta-corriente.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ cliente_id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CUENTA_CORRIENTE_NO_ENCONTRADA: 404,
};

export const GET = withPermission(
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
  async (_req: NextRequest, _session, rawContext) => {
    const { cliente_id } = await (rawContext as Context).params;
    const parsedId = ClienteCuentaCorrienteIdSchema.safeParse(cliente_id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    try {
      const cuenta = await consultarCuentaCorriente(parsedId.data);
      return NextResponse.json({ data: cuenta, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[GET /api/ventas/cuentas-corrientes/[cliente_id]] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
