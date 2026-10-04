/**
 * @module route — GET /api/tienda/fotos/[archivo]
 * @description HU-E11 (spec_modulo_E.md §2.11; task_relos.md D2, D24, D27) —
 * sirve, sin sesión y en solo lectura, las fotos que guardó el Adapter de
 * disco. `archivo` debe ser `<uuid>.<jpg|png|webp>` (nombre generado por el
 * servidor) y la ruta resuelta debe quedar dentro de `CATALOGO_FOTOS_DIR`;
 * cualquier otra cosa es 404. Una foto dada de baja se sigue sirviendo (no se
 * consulta la base, D24). `Content-Type` por extensión; nombres inmutables.
 */
import { NextResponse, type NextRequest } from "next/server";
import { obtenerAlmacenamientoImagenes } from "@/lib/services/ecommerce/almacenamiento-imagenes.local.adapter";
import { respuestaError } from "@/lib/services/ecommerce/respuesta-tienda";

type Ctx = { params: Promise<{ archivo: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { archivo } = await ctx.params;
  try {
    const imagen = await obtenerAlmacenamientoImagenes().leerImagen(archivo);
    if (!imagen) {
      return NextResponse.json(
        { data: null, error: { code: "FOTO_WEB_NO_ENCONTRADA", message: "La foto no existe" } },
        { status: 404 },
      );
    }
    return new NextResponse(Buffer.from(imagen.contenido), {
      status: 200,
      headers: {
        "content-type": imagen.contentType,
        "content-length": String(imagen.contenido.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return respuestaError(err, "GET /api/tienda/fotos/[archivo]");
  }
}
