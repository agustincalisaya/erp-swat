/**
 * HU-E11 — POST: subida de una foto del contenido web (spec_modulo_E.md
 * §2.11; task_relos.md D2, D6, D8, D22). `multipart/form-data` con `archivo`
 * (File) y `es_principal` opcional ("true" | "false"). El cuerpo se lee con
 * tope (máximo configurado + 64 KB) antes de parsearlo; el formato se valida
 * por firma de bytes y el tamaño real en el servicio.
 *
 * Respuestas `{ data, error }`: 201 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PRODUCTO_WEB_NO_ENCONTRADO · 409 LIMITE_FOTOS_ALCANZADO ·
 * 422 ARCHIVO_VACIO | ARCHIVO_DEMASIADO_GRANDE | FORMATO_IMAGEN_NO_ADMITIDO ·
 * 500 INTERNAL_ERROR (incluye configuración inválida y falta de CATALOGO_FOTOS_DIR).
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { SubirFotoMultipartSchema } from "@/lib/schemas/ecommerce.schema";
import { subirFotoProducto } from "@/lib/services/ecommerce/foto-web.service";
import { formDataAObjeto, leerMultipartConTope, MARGEN_MULTIPART_BYTES } from "@/lib/services/ecommerce/lectura-multipart";
import {
  parsearProductoWebId,
  respuestaErrorCatalogo,
  respuestaValidacionCatalogo,
} from "@/lib/services/ecommerce/respuesta-catalogo";
import { MENSAJE_ERROR_IMAGEN } from "@/lib/services/ecommerce/validacion-imagen";
import { obtenerFotoTamanoMaxBytes } from "@/lib/services/sistema/configuracion.service";

type Contexto = { params: Promise<{ producto_web_id: string }> };
const RUTA = "POST /api/ecommerce/catalogo/[producto_web_id]/fotos";

function errorValidacion(message: string) {
  return NextResponse.json(
    { data: null, error: { code: "VALIDATION_ERROR", message, fieldErrors: {}, formErrors: [message] } },
    { status: 400 },
  );
}

export const POST = withPermission(PERMISO_GESTIONAR_CATALOGO, async (req: NextRequest, session, context) => {
  const id = parsearProductoWebId((await (context as Contexto).params).producto_web_id);
  if (!id.success) return respuestaValidacionCatalogo(id.error);
  try {
    const lectura = await leerMultipartConTope(req, (await obtenerFotoTamanoMaxBytes()) + MARGEN_MULTIPART_BYTES);
    if (!lectura.ok) {
      if (lectura.motivo === "EXCEDE_TOPE") {
        // El cuerpo no se consumió entero: `Connection: close` evita que el
        // cliente reutilice un socket con bytes pendientes.
        const respuesta = respuestaErrorCatalogo(
          new ServiceError("ARCHIVO_DEMASIADO_GRANDE", MENSAJE_ERROR_IMAGEN.ARCHIVO_DEMASIADO_GRANDE),
          RUTA,
        );
        respuesta.headers.set("connection", "close");
        return respuesta;
      }
      return errorValidacion(
        lectura.motivo === "NO_MULTIPART"
          ? "El cuerpo debe ser multipart/form-data con el campo archivo"
          : "El cuerpo multipart no es válido",
      );
    }
    const campos = SubirFotoMultipartSchema.safeParse(formDataAObjeto(lectura.form));
    if (!campos.success) return respuestaValidacionCatalogo(campos.error);

    const archivo = new Uint8Array(await campos.data.archivo.arrayBuffer());
    const data = await subirFotoProducto(id.data, archivo, campos.data.es_principal, session.userId);
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) {
    return respuestaErrorCatalogo(error, RUTA);
  }
});
