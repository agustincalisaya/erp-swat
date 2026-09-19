/**
 * @module route — POST /api/ventas
 * @description HU-B1 §2.1 — Venta de mostrador con cobro multimedio. Wrapper
 * fino (spec §1): resuelve sesión + permiso granular
 * `ventas:registrar_venta_mostrador`, valida el body con Zod, delega en
 * `registrarVentaMostrador()` y mapea el resultado/excepción al shape
 * `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * Respuestas: 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 CLIENTE_NO_ENCONTRADO / VARIANTE_NO_ENCONTRADA /
 * DEPOSITO_NO_ENCONTRADO · 422 SIN_TURNO_ABIERTO / STOCK_INSUFICIENTE ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { RegistrarVentaMostradorSchema } from "@/lib/schemas/ventas.schema";
import {
  registrarVentaMostrador,
  PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR,
} from "@/lib/services/ventas/venta-mostrador.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  SIN_TURNO_ABIERTO: 422,
  CLIENTE_NO_ENCONTRADO: 404,
  VARIANTE_NO_ENCONTRADA: 404,
  DEPOSITO_NO_ENCONTRADO: 404,
  STOCK_INSUFICIENTE: 422,
};

export const POST = withPermission(
  PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = RegistrarVentaMostradorSchema.safeParse(body);
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
      const resultado = await registrarVentaMostrador(session.userId, parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/ventas] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
