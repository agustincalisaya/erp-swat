import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { EditarProductoMaestroSchema } from "@/lib/schemas/inventario.schema";
import {
  editarProductoMaestro,
  usuarioPuedeEditarProductoMaestro,
} from "@/lib/services/inventario/producto.service";
import { ServiceError } from "@/lib/errors/service-error";

export const PATCH = withAuth(async (req: NextRequest, session) => {
  const { pathname } = req.nextUrl;
  const segmentos = pathname.split("/");
  const productoMaestroId = segmentos[segmentos.length - 2] as string; // [id] no es el último segmento en .../[id]/editar

  const autorizado = await usuarioPuedeEditarProductoMaestro(session.userId);
  if (!autorizado) {
    return NextResponse.json(
      { data: null, error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para editar el catálogo" } },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = EditarProductoMaestroSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos", fieldErrors: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  try {
    const producto = await editarProductoMaestro(productoMaestroId, parsed.data, session.userId);
    return NextResponse.json({ data: producto, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "PRODUCTO_MAESTRO_NO_ENCONTRADO" ? 404
        : err.code === "PRODUCTO_MAESTRO_NOMBRE_DUPLICADO" ? 409
        : 400;
      return NextResponse.json({ data: null, error: { code: err.code, message: err.message } }, { status });
    }
    console.error("[PATCH /api/inventario/productos/[id]/editar] Error inesperado:", err);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
  }
});
