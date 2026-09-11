/**
 * @module route — POST /api/inventario/productos
 * @description HU-A1 — Alta de Producto Maestro (task_relos.md sección 6.1).
 * Expone vía REST la misma lógica de servicio usada por el Server Action
 * equivalente (`app/(dashboard)/inventario/productos/actions.ts`) — no
 * reimplementa nada, delega directo en `crearProductoMaestro()` de
 * `producto.service.ts`.
 *
 * Mismo patrón que `auth/usuarios/route.ts`: gateado con `withAuth` (sesión
 * requerida), sin `withPermission` granular — Módulo A todavía no tiene
 * ningún permiso "inventario:*" wireado a un Route Handler en este sprint
 * (ver docstring de `stock/umbrales/route.ts`).
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { CrearProductoMaestroSchema } from "@/lib/schemas/inventario.schema";
import { crearProductoMaestro } from "@/lib/services/inventario/producto.service";
import { ServiceError } from "@/lib/errors/service-error";

export async function GET() {
  return NextResponse.json({ message: "En construcción" }, { status: 501 });
}

export const POST = withAuth(async (req: NextRequest, session) => {
  const body = await req.json().catch(() => null);
  const parsed = CrearProductoMaestroSchema.safeParse(body);

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
    const producto = await crearProductoMaestro(parsed.data, session.userId);
    return NextResponse.json({ data: producto, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status: 400 },
      );
    }

    console.error("[POST /api/inventario/productos] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
