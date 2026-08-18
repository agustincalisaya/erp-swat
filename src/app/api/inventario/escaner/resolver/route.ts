/**
 * HU-2 — Sección 5.1: resolución rápida de un código escaneado (EAN-13,
 * Code128 o QR serializado) contra el catálogo activo de `VarianteSKU`.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ResolverCodigoEscaneoSchema } from "@/lib/schemas/inventario.schema";
import { resolverCodigoEscaneo } from "@/lib/services/inventario/movimiento.service";

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const parsed = ResolverCodigoEscaneoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Datos inválidos",
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await resolverCodigoEscaneo(parsed.data);

    if (!resultado) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VARIANTE_NO_ENCONTRADA",
            message: "Código no registrado en catálogo activo",
          },
        },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/inventario/escaner/resolver] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } },
      { status: 500 },
    );
  }
});
