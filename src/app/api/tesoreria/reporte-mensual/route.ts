import { NextResponse, type NextRequest } from "next/server";
import { withPermission, usuarioTienePermiso } from "@/lib/auth/with-permission";
import { cargarReporteMensual } from "@/lib/services/tesoreria/reporte-mensual.pantalla";
import { interpretarMesReporte } from "@/lib/services/tesoreria/reporte-mensual.periodo";
import { PERMISO_LEER_DESGLOSE_GASTOS, PERMISO_LEER_REPORTES } from "@/lib/services/tesoreria/reporte-mensual.service";

export const GET = withPermission(PERMISO_LEER_REPORTES, async (req: NextRequest, session) => {
  const valores = req.nextUrl.searchParams.getAll("mes");
  const periodo = valores.length <= 1 ? interpretarMesReporte(valores[0]) : null;
  if (!periodo) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Seleccioná un mes válido (AAAA-MM)." } },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    const incluir_desglose_gastos = await usuarioTienePermiso(session.userId, PERMISO_LEER_DESGLOSE_GASTOS);
    const reporte = await cargarReporteMensual(periodo.anio, periodo.mes, { incluir_desglose_gastos });
    return NextResponse.json({ data: reporte, error: null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "No se pudo cargar el reporte mensual." } },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
});
