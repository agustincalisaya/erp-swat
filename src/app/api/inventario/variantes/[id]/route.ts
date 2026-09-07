import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { EditarVarianteOperativaSchema } from "@/lib/schemas/inventario.schema";
import {
  editarVarianteOperativa,
  usuarioPuedeEditarVariante,
} from "@/lib/services/inventario/variante.service";
import { ServiceError } from "@/lib/errors/service-error";

function resolverIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export const PATCH = withAuth(async (req: NextRequest, session) => {
  const { pathname } = req.nextUrl;
  const varianteId = pathname.split("/").pop() as string; // [id] SÍ es el último segmento acá (a diferencia de .../[id]/baja)

  const autorizado = await usuarioPuedeEditarVariante(session.userId);
  if (!autorizado) {
    return NextResponse.json(
      { data: null, error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para editar variantes" } },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = EditarVarianteOperativaSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos", fieldErrors: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const ip = resolverIp(req);

  try {
    const variante = await editarVarianteOperativa(varianteId, parsed.data, session.userId, ip);
    return NextResponse.json({ data: variante, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "VARIANTE_NO_ENCONTRADA" ? 404
        : err.code === "EAN_QR_DUPLICADO" ? 409
        : err.code === "PROVEEDOR_NO_ENCONTRADO" ? 404
        : 400;
      return NextResponse.json({ data: null, error: { code: err.code, message: err.message } }, { status });
    }
    console.error("[PATCH /api/inventario/variantes/[id]] Error inesperado:", err);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
  }
});
