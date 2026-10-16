/**
 * @module route — /api/tesoreria/cuentas-propias
 * @description HU-G5 §9.7 (G5-1/G5-3) — cuentas bancarias y cajas propias.
 * Wrapper fino, mismo patrón que `/api/tesoreria/comprobantes`: sesión + permiso
 * GRANULAR vía HOF, validación con Zod y delegación en el servicio de dominio.
 * NINGUNA regla de negocio vive acá.
 *
 *  - `GET`  → `tesoreria:leer_cuentas_bancarias` (listado enmascarado).
 *  - `POST` → `tesoreria:gestionar_cuentas_bancarias` (alta).
 *
 * El CBU/alias nunca viaja en claro por el `GET` (el servicio enmascara a los
 * últimos 4 caracteres). El revelado explícito tiene su propia ruta
 * (`/[id]/revelar`) con un permiso distinto.
 *
 * Respuestas: 200 OK · 201 CREATED · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearCuentaPropiaSchema } from "@/lib/schemas/cuenta-propia.schema";
import {
  crearCuentaPropia,
  listarCuentasPropias,
  PERMISO_GESTIONAR_CUENTAS_BANCARIAS,
  PERMISO_LEER_CUENTAS_BANCARIAS,
} from "@/lib/services/tesoreria/cuenta-propia.service";
import { ServiceError } from "@/lib/errors/service-error";

export const GET = withPermission(
  PERMISO_LEER_CUENTAS_BANCARIAS,
  async (_req: NextRequest, session) => {
    try {
      const cuentas = await listarCuentasPropias(session.userId);
      return NextResponse.json({ data: cuentas, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[GET /api/tesoreria/cuentas-propias] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);

export const POST = withPermission(
  PERMISO_GESTIONAR_CUENTAS_BANCARIAS,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = CrearCuentaPropiaSchema.safeParse(body);
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
      const creada = await crearCuentaPropia(parsed.data, session.userId);
      return NextResponse.json({ data: creada, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[POST /api/tesoreria/cuentas-propias] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
