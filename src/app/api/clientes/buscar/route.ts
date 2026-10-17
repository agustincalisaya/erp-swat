/**
 * @module route — GET /api/clientes/buscar
 * @description HU-C7 (spec_modulo_C.md §2.7) — Consulta unificada de un
 * cliente por DNI: contacto + direcciones + canal preferido + resumen de
 * historial de compras en UNA sola llamada. Wrapper fino (spec §1): resuelve
 * sesión + permiso granular (`withPermission`), valida el QUERY STRING con
 * Zod, delega en `cliente.service.ts` y mapea el resultado/excepción al shape
 * `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * El DNI llega por query string (`?dni=30123456`), NO por path param — de ahí
 * que esta ruta sea estática (`/api/clientes/buscar`) y no tenga `[id]`; por
 * eso el handler OMITE el tercer argumento `context` de `withPermission`
 * (es opcional: sin segmento dinámico no hay `params` que resolver).
 *
 * DELIBERADAMENTE NO HAY SERVER ACTION (spec §2.7): es una consulta
 * disparada por un formulario de búsqueda del POS, no una mutación de UI; el
 * único consumidor es HTTP.
 *
 * Estados: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN (sin `clientes:leer`) · 404 CLIENTE_NO_ENCONTRADO ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { BuscarClientePorDniQuerySchema } from "@/lib/schemas/clientes.schema";
import { consultarClientePorDni, PERMISO_LEER } from "@/lib/services/clientes/cliente.service";

/** Único código de negocio con status propio en este endpoint. */
const STATUS_POR_CODIGO: Record<string, number> = {
  CLIENTE_NO_ENCONTRADO: 404,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const GET = withPermission(PERMISO_LEER, async (req: NextRequest) => {
  const parsed = BuscarClientePorDniQuerySchema.safeParse({
    dni: req.nextUrl.searchParams.get("dni"),
  });

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
    const resultado = await consultarClientePorDni(parsed.data.dni);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
    }
    // Nunca se filtra el detalle de la DB ni el stack al cliente.
    console.error("[GET /api/clientes/buscar] Error inesperado:", err);
    return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
  }
});
