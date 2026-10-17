/**
 * @module route — POST /api/tesoreria/ingresos-web/reprocesar
 * @description HU-G11 §2.6 — Reproceso manual de un ingreso web: recupera una
 * falla del listener re-invocando `registrarIngresoWeb` a partir del
 * `PedidoVentaEcommerce` ya confirmado. Wrapper fino: sesión + permiso
 * `tesoreria:leer_ingresos_web`, body validado con Zod y delegación en el
 * service. Idempotente: repetir el mismo pedido es un no-op (200 con
 * `data: null`), nunca un error.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ReprocesarIngresoWebSchema } from "@/lib/schemas/ingresos-web.schema";
import {
  PERMISO_LEER_INGRESOS_WEB,
  reprocesarIngresoWeb,
} from "@/lib/services/tesoreria/ingreso-tesoreria.service";
import { ServiceError } from "@/lib/errors/service-error";

export const POST = withPermission(
  PERMISO_LEER_INGRESOS_WEB,
  async (req: NextRequest) => {
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const parsed = ReprocesarIngresoWebSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "El body enviado no es válido",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await reprocesarIngresoWeb(parsed.data.pedido_venta_id);
      // `null` = no-op idempotente (ya registrado, o pedido sin pago
      // confirmado): es un resultado válido, no un error.
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[POST /api/tesoreria/ingresos-web/reprocesar] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
