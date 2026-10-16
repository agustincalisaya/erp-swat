import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ConsultaLibroIvaSchema } from "@/lib/schemas/libro-iva.schema";
import { auditarExportacionLibroIva } from "@/lib/events/libro-iva-auditoria";
import { consultarLibroIva } from "./libro-iva.service";
import { nombreArchivoLibro, serializarLibro } from "./libro-iva.reglas";
import { PERMISO_EXPORTAR_LIBRO_IVA, type TipoLibroIva } from "./libro-iva.constants";

const STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  LIBRO_IVA_DATOS_INVALIDOS: 422,
  LIBRO_IVA_AUDITORIA_NO_CONFIRMADA: 503,
};

/** Ambas rutas comparten autorización, errores seguros y política no-store. */
export function crearDescargaLibroIva(tipo: TipoLibroIva) {
  const autorizado = withPermission(PERMISO_EXPORTAR_LIBRO_IVA, async (req, session) => {
    const parsed = ConsultaLibroIvaSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success || req.nextUrl.searchParams.getAll("mes").length !== 1 || req.nextUrl.searchParams.getAll("formato").length > 1) {
      throw new ServiceError("VALIDATION_ERROR", "Seleccioná un mes válido (AAAA-MM).");
    }
    const periodo = parsed.data.mes;
    const formato = parsed.data.formato ?? "txt";
    const libro = await consultarLibroIva(tipo, periodo);
    if (formato === "json") return NextResponse.json({ data: libro, error: null });
    const contenido = formato === "pdf"
      ? Buffer.from(await (await import("./libro-iva.pdf")).generarLibroIvaPdf(libro))
      : serializarLibro(libro.filas);
    await auditarExportacionLibroIva({ usuario_id: session.userId, periodo, tipo_libro: tipo, formato: formato === "pdf" ? "PDF" : "TXT" });
    const nombre = nombreArchivoLibro(tipo, periodo, formato);
    return new NextResponse(contenido, {
      status: 200,
      headers: {
        "Content-Type": formato === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre.ascii}"; filename*=UTF-8''${encodeURIComponent(nombre.visible)}`,
      },
    });
  });
  return async (req: NextRequest, ctx: unknown): Promise<NextResponse> => {
    let respuesta: NextResponse;
    try {
      respuesta = await autorizado(req, ctx);
    } catch (error) {
      const conocido = error instanceof ServiceError && Object.hasOwn(STATUS, error.code);
      respuesta = NextResponse.json({ data: null, error: conocido
        ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
        : { code: "INTERNAL_ERROR", message: "No se pudo generar el archivo. Intentá nuevamente más tarde." },
      }, { status: conocido ? STATUS[error.code] : 500 });
      // No loguear el error original: Prisma puede incluir valores personales.
    }
    respuesta.headers.set("Cache-Control", "private, no-store");
    respuesta.headers.set("X-Content-Type-Options", "nosniff");
    return respuesta;
  };
}
