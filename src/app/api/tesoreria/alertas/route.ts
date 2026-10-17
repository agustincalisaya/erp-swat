/**
 * @module route — GET /api/tesoreria/alertas
 * @description HU-D6 (task_relos.md D7, D12, D19) — listado del panel de
 * alertas. Wrapper fino: `withPermission("alertas:leer")` (Gerente y
 * Administrador), valida la query con `FiltrosPanelAlertasSchema` y delega en
 * `obtenerPanelAlertas()`, que reevalúa antes de listar (mismo servicio que la
 * página). Un fallo de HU-G14 no es error HTTP: sale en
 * `data.fuente_egresos.estado = "NO_DISPONIBLE"` con las alertas sin modificar.
 *
 * Query: `estado` (activas | resueltas | todas, default activas) · `nivel`
 * (critica | advertencia | informativa, opcional) · `page` (≥ 1) ·
 * `page_size` (1–100, default 25).
 *
 * Respuestas `{ data, error }`: 200 OK (`data.alertas`, `data.paginacion`,
 * `data.umbrales`, `data.fuente_egresos`) · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 405 METHOD_NOT_ALLOWED · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { FiltrosPanelAlertasSchema } from "@/lib/schemas/alertas-desvio.schema";
import { obtenerPanelAlertas } from "@/lib/services/alertas/alerta-desvio.panel.service";
import { PERMISO_ALERTAS_LEER } from "@/lib/services/alertas/alerta-desvio.presentacion";

function metodoNoPermitido() {
  return NextResponse.json(
    { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "Usá GET para consultar las alertas." } },
    { status: 405 },
  );
}

export const POST = metodoNoPermitido;
export const PUT = metodoNoPermitido;
export const PATCH = metodoNoPermitido;
export const DELETE = metodoNoPermitido;

export const GET = withPermission(PERMISO_ALERTAS_LEER, async (req: NextRequest) => {
  const parsed = FiltrosPanelAlertasSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Los filtros enviados no son válidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const panel = await obtenerPanelAlertas(parsed.data);
    return NextResponse.json({ data: panel, error: null }, { status: 200 });
  } catch (err) {
    const codigo = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
    console.error("[GET /api/tesoreria/alertas] Error inesperado:", {
      codigo_error: typeof codigo === "string" && /^[A-Z0-9_]{2,64}$/.test(codigo) ? codigo : "ERROR_INESPERADO",
    });
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
