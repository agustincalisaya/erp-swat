/**
 * @module route — POST /api/ventas/[id]/override-descuento
 * @description HU-B4 §2.4 — Override de descuento fuera de margen y cambio
 * manual de precio sobre un `PedidoVentaItem` en espera de aprobación.
 * Wrapper fino (spec §1): resuelve sesión + permiso granular
 * `ventas:aplicar_descuento_margen` (el Cajero invoca la ruta para
 * solicitar), valida `id` de path + body con Zod, delega en
 * `autorizarOverrideDescuento()` y mapea el resultado/excepción. NINGUNA
 * regla de negocio vive acá.
 *
 * Gate de un único permiso a nivel de endpoint (docs/tasks/HU-B4.md §1.3):
 * la validación de que quien AUTORIZA tenga `ventas:autorizar_excepcion_descuento`
 * ocurre dentro del servicio, contra `supervisor_credencial.usuario_id` — no
 * hay código real de HU-B6 con el que contrastar un patrón de doble gate
 * (`GET /api/ventas/auditoria` no está implementado), y `withPermission()`
 * solo acepta un único código de permiso.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN / SIN_PERMISO_AUTORIZACION · 404 PEDIDO_VENTA_NO_ENCONTRADO ·
 * 409 TRANSICION_INVALIDA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  AutorizarOverrideDescuentoSchema,
  PedidoVentaIdSchema,
} from "@/lib/schemas/ventas.schema";
import {
  autorizarOverrideDescuento,
  PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN,
} from "@/lib/services/ventas/pedido-venta.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PEDIDO_VENTA_NO_ENCONTRADO: 404,
  TRANSICION_INVALIDA: 409,
  SIN_PERMISO_AUTORIZACION: 403,
};

export const POST = withPermission(
  PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = PedidoVentaIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = AutorizarOverrideDescuentoSchema.safeParse(body);
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

    // Dispositivo de origen (spec §4) — mismo mecanismo ya usado por
    // `usuario:sesion_iniciada` (`src/app/api/auth/login/route.ts`): header
    // `User-Agent` del request, sin precedente de un campo llamado
    // literalmente "dispositivo" en el proyecto.
    const dispositivo = req.headers.get("user-agent") ?? "unknown";

    try {
      const resultado = await autorizarOverrideDescuento(
        parsedId.data,
        parsed.data,
        session.userId,
        dispositivo,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/ventas/[id]/override-descuento] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
