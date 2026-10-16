/**
 * @module route — GET /api/tesoreria/comprobantes/[id]/pdf
 * @description HU-G3 §9.5 (G3-3) — Descarga en PDF de cualquier comprobante
 * del repositorio, con el CAE y el QR que persistió HU-B7, la leyenda
 * `SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP`, canal, cliente y original.
 * Reutiliza el renderizado de HU-E9 (`generarComprobanteFiscalPdf`); la
 * descarga del Cliente Web (`/api/tienda/mis-pedidos/[id]/comprobante/descargar`)
 * no cambia. Un QR persistido inválido es un dato histórico a corregir: se
 * responde 422 y nunca un PDF sin QR. Solo GET (G3-5).
 *
 * `?disposicion=inline` responde `Content-Disposition: inline` para verlo en
 * el navegador ("Ver PDF" de la vista de detalle); sin el parámetro, o con
 * `attachment`, se descarga. Un valor desconocido es 400.
 *
 * Respuestas: 200 application/pdf · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 COMPROBANTE_NO_ENCONTRADO · 422 COMPROBANTE_QR_INVALIDO ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  ComprobanteRepositorioIdSchema,
  PdfComprobanteQuerySchema,
} from "@/lib/schemas/comprobantes-repositorio.schema";
import {
  generarComprobanteFiscalPdf,
  QrFiscalInvalidoError,
} from "@/lib/services/ecommerce/comprobante-web-pdf";
import {
  obtenerComprobanteParaPdf,
  PERMISO_LEER_COMPROBANTES,
} from "@/lib/services/tesoreria/comprobantes-repositorio.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  COMPROBANTE_NO_ENCONTRADO: 404,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const GET = withPermission(
  PERMISO_LEER_COMPROBANTES,
  async (req: NextRequest, _session, rawContext) => {
    const { id } = await (rawContext as Context).params;

    const parsedId = ComprobanteRepositorioIdSchema.safeParse(id);
    if (!parsedId.success) {
      return errorJson("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido", 400);
    }
    const parsedQuery = PdfComprobanteQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    if (!parsedQuery.success) {
      return errorJson("VALIDATION_ERROR", parsedQuery.error.issues[0]?.message ?? "Disposición inválida", 400);
    }
    const disposicion = parsedQuery.data.disposicion === "inline" ? "inline" : "attachment";

    try {
      const comprobante = await obtenerComprobanteParaPdf(parsedId.data);
      const pdf = await generarComprobanteFiscalPdf(comprobante);
      const numeroSeguro = comprobante.numero.replace(/[^A-Za-z0-9-]/g, "-");
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${disposicion}; filename="comprobante-${numeroSeguro}.pdf"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (err) {
      if (err instanceof QrFiscalInvalidoError) {
        return errorJson(
          "COMPROBANTE_QR_INVALIDO",
          "El QR fiscal archivado de este comprobante no es válido; hay que corregir el dato histórico",
          422,
        );
      }
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      console.error("[GET /api/tesoreria/comprobantes/[id]/pdf] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
