import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { withPermission, usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { interpretarMesReporte } from "./reporte-mensual.periodo";
import { PERMISO_LEER_DESGLOSE_GASTOS } from "./reporte-mensual.service";
import { exportarReporteMensual, PERMISO_EXPORTAR_REPORTES, type FormatoReporte } from "./reporte-mensual.export.service";

const ERRORES: Record<string, { status: number; message: string }> = {
  VALIDATION_ERROR: { status: 400, message: "Seleccioná un mes válido (AAAA-MM)." },
  REPORTE_BLOQUES_NO_DISPONIBLES: { status: 503, message: "No se pudo completar la exportación. Intentá nuevamente más tarde." },
  REPORTE_AUDITORIA_NO_CONFIRMADA: { status: 503, message: "No se pudo registrar la exportación. Intentá nuevamente más tarde." },
};

export function crearDescargaReporteMensual(formato: FormatoReporte) {
  const autorizado = withPermission(PERMISO_EXPORTAR_REPORTES, async (req, session) => {
    const valores = req.nextUrl.searchParams.getAll("mes");
    const periodo = valores.length === 1 ? interpretarMesReporte(valores[0]) : null;
    if (!periodo) throw new ServiceError("VALIDATION_ERROR", "Seleccioná un mes válido (AAAA-MM).");
    const incluir_desglose_gastos = await usuarioTienePermiso(session.userId, PERMISO_LEER_DESGLOSE_GASTOS);
    const { bytes } = await exportarReporteMensual(periodo.anio, periodo.mes, { incluir_desglose_gastos }, formato, session.userId);
    const extension = formato.toLowerCase();
    const nombre = `reporte-mensual-${periodo.mesIso}.${extension}`;
    return new NextResponse(Buffer.from(bytes), { status: 200, headers: {
      "Content-Type": formato === "CSV" ? "text/csv; charset=utf-8" : "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    } });
  });
  return async (req: NextRequest, ctx: unknown): Promise<NextResponse> => {
    let respuesta: NextResponse;
    try {
      respuesta = await autorizado(req, ctx);
    } catch (error) {
      const conocido = error instanceof ServiceError && Object.hasOwn(ERRORES, error.code);
      respuesta = NextResponse.json({ data: null, error: conocido
        ? { code: error.code, message: ERRORES[error.code].message }
        : { code: "INTERNAL_ERROR", message: "No se pudo generar el archivo. Intentá nuevamente más tarde." },
      }, { status: conocido ? ERRORES[error.code].status : 500 });
    }
    respuesta.headers.set("Cache-Control", "private, no-store");
    respuesta.headers.set("X-Content-Type-Options", "nosniff");
    return respuesta;
  };
}
