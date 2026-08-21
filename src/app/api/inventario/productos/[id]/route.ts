/**
 * @module route — PATCH /api/inventario/productos/[id]
 * @description HU-A1 — Baja lógica de Producto Maestro (task_relos.md
 * sección 5.3). `producto_maestro_id` se toma del segmento `[id]` de la URL
 * (mismo patrón que `auth/roles/[id]/permisos/route.ts` y
 * `productos/[id]/variantes/generar/route.ts`), no del body. Gateado con
 * `withAuth`, sin `withPermission` granular — mismo criterio que el resto de
 * Módulo A (ver docstring de `stock/umbrales/route.ts`).
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { DesactivarProductoMaestroSchema } from "@/lib/schemas/inventario.schema";
import { desactivarProductoMaestro } from "@/lib/services/inventario/producto.service";
import { ServiceError } from "@/lib/errors/service-error";

export const PATCH = withAuth(async (req: NextRequest, session) => {
  const { pathname } = req.nextUrl;
  const productoMaestroId = pathname.split("/").pop() as string;

  const body = await req.json().catch(() => ({}));
  const parsed = DesactivarProductoMaestroSchema.safeParse(body ?? {});

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
    const producto = await desactivarProductoMaestro(productoMaestroId, parsed.data, session.userId);
    return NextResponse.json({ data: producto, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "PRODUCTO_MAESTRO_NO_ENCONTRADO" ? 404 : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[PATCH /api/inventario/productos/[id]] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
