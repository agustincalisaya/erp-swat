/**
 * @module route — POST/GET /api/proveedores
 * @description HU-H1 §2.1 — Alta de proveedor (201/409) y listado operativo
 * (200). Wrappers finos (spec §1): resuelven sesión + permiso granular
 * (`proveedores:crear` / `proveedores:leer`), validan con Zod, delegan en
 * `proveedor.service.ts` y mapean al shape `{ data, error }`. NINGUNA regla
 * de negocio vive acá.
 *
 * Respuestas POST: 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 409 CUIT_DUPLICADO · 500 INTERNAL_ERROR.
 * Respuestas GET: 200 OK · 400 VALIDATION_ERROR (filtro `estado` inválido) ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  CrearProveedorSchema,
  FiltrosListadoProveedoresSchema,
} from "@/lib/schemas/proveedores.schema";
import {
  crearProveedor,
  listarProveedores,
  PERMISO_CREAR,
  PERMISO_LEER,
} from "@/lib/services/proveedores/proveedor.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  CUIT_DUPLICADO: 409,
};

function errorJson(code: string, message: string, status: number) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const POST = withPermission(PERMISO_CREAR, async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const parsed = CrearProveedorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Datos inválidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await crearProveedor(parsed.data);
    return NextResponse.json({ data: resultado, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
    }
    console.error("[POST /api/proveedores] Error inesperado:", err);
    return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
  }
});

export const GET = withPermission(PERMISO_LEER, async (req: NextRequest) => {
  const url = new URL(req.url);
  const estadoRaw = url.searchParams.get("estado") ?? undefined;

  const filtros = FiltrosListadoProveedoresSchema.safeParse({ estado: estadoRaw });
  if (!filtros.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: filtros.error.issues[0]?.message ?? "Filtro de estado inválido",
        },
      },
      { status: 400 },
    );
  }

  try {
    const proveedores = await listarProveedores(filtros.data);
    return NextResponse.json({ data: { proveedores }, error: null }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/proveedores] Error inesperado:", err);
    return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
  }
});