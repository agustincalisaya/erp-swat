/**
 * @module route — POST/GET /api/clientes/[id]/direcciones
 * @description HU-C3 §2.3 — Alta (`POST`) y listado (`GET`) de las
 * direcciones (facturación / envío) de un cliente. Wrappers finos (spec §1):
 * resuelven sesión + permiso granular, validan el body con Zod, delegan en
 * `cliente.service.ts` y mapean el resultado/excepción al shape
 * `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * `cliente_id` llega SIEMPRE por el path param `[id]` — NUNCA en el body
 * (spec §2.3). Un `cliente_id` espurio en el payload se descarta
 * silenciosamente en el parseo (el schema no es `.strict()`), y este handler
 * jamás lo lee: el único cliente posible es el del path.
 *
 * POST — 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 *        403 FORBIDDEN · 404 CLIENTE_NO_ENCONTRADO (inexistente o inactivo)
 *        · 422 DIRECCION_FACTURACION_REQUERIDA · 500 INTERNAL_ERROR.
 * GET  — 200 OK · 401 · 403 · 500.
 */
import { NextResponse, type NextRequest } from "next/server";
import { usuarioTienePermiso, withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { AgregarDireccionClienteSchema } from "@/lib/schemas/clientes.schema";
import {
  agregarDireccionCliente,
  listarDireccionesCliente,
  PERMISO_EDITAR,
  PERMISO_LEER,
} from "@/lib/services/clientes/cliente.service";

type Context = { params: Promise<{ id: string }> };

/**
 * Ver direcciones dadas de baja lógica es privilegio de Auditoría
 * (RULES.md Regla N.° 1). Mismo bypass que
 * `comprobantes-proveedor/route.ts` y `ordenes-compra/[id]/comprobantes/route.ts`.
 */
const PERMISO_AUDITORIA = "auditoria:leer_forense";

const STATUS_POR_CODIGO: Record<string, number> = {
  CLIENTE_NO_ENCONTRADO: 404,
  DIRECCION_FACTURACION_REQUERIDA: 422,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const POST = withPermission(
  PERMISO_EDITAR,
  async (req: NextRequest, session, rawContext) => {
    // Next.js 16: `params` es una Promise (se espera, no se asume shape).
    const { id } = await (rawContext as Context).params;

    const body = await req.json().catch(() => null);
    const parsed = AgregarDireccionClienteSchema.safeParse(body);
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
      const resultado = await agregarDireccionCliente(id, parsed.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      // Nunca se filtra el detalle de la DB ni el stack al cliente.
      console.error("[POST /api/clientes/[id]/direcciones] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);

export const GET = withPermission(
  PERMISO_LEER,
  async (_req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;

    try {
      const incluirInactivas = await usuarioTienePermiso(session.userId, PERMISO_AUDITORIA);
      const direcciones = await listarDireccionesCliente(id, { incluirInactivas });
      return NextResponse.json({ data: { direcciones }, error: null }, { status: 200 });
    } catch (err) {
      console.error("[GET /api/clientes/[id]/direcciones] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
