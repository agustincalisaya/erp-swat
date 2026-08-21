/**
 * @module route — POST /api/inventario/productos/[id]/variantes/generar
 * @description HU-A1 — Generación en lote de Variantes SKU mediante producto
 * cartesiano talle × color × género (task_relos.md sección 6.2). Expone vía
 * REST la misma lógica de servicio usada por el Server Action equivalente
 * (`app/(dashboard)/inventario/productos/actions.ts`) — no reimplementa
 * nada, delega directo en `generarVariantesMatriz()` de `producto.service.ts`.
 *
 * `producto_maestro_id` se toma del segmento `[id]` de la URL, no del body
 * (mismo patrón que `auth/roles/[id]/permisos/route.ts` y
 * `auth/usuarios/[id]/estado/route.ts`): la ruta es la fuente de verdad del
 * recurso sobre el que se opera.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { GenerarVariantesMatrizSchema } from "@/lib/schemas/inventario.schema";
import { generarVariantesMatriz } from "@/lib/services/inventario/producto.service";
import { ServiceError } from "@/lib/errors/service-error";

export const POST = withAuth(async (req: NextRequest, session) => {
  const { pathname } = req.nextUrl;
  const productoMaestroId = pathname.split("/").slice(-3, -2)[0];

  const body = await req.json().catch(() => ({}));
  const parsed = GenerarVariantesMatrizSchema.safeParse({
    ...(body ?? {}),
    producto_maestro_id: productoMaestroId,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Los datos enviados no son válidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await generarVariantesMatriz(parsed.data, session.userId);
    return NextResponse.json({ data: resultado, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status =
        err.code === "PRODUCTO_MAESTRO_NO_ENCONTRADO" || err.code === "PRODUCTO_MAESTRO_INACTIVO"
          ? 404
          : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error(
      "[POST /api/inventario/productos/[id]/variantes/generar] Error inesperado:",
      err,
    );
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
