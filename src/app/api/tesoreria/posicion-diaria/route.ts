/**
 * @module route — /api/tesoreria/posicion-diaria
 * @description HU-G7 §9.8 (G7-1..G7-10) — posición diaria consolidada de
 * Tesorería. Wrapper fino, mismo patrón que `/api/tesoreria/cuentas-propias`:
 * sesión + permiso GRANULAR vía HOF, validación con Zod y delegación en el
 * servicio de dominio. NINGUNA regla de negocio vive acá.
 *
 *  - `GET  ?dia=AAAA-MM-DD` → `tesoreria:leer_reportes` (posición del día;
 *    por defecto, el día de negocio de Argentina).
 *  - `POST`                 → `tesoreria:registrar_saldo_diario` (registro
 *    append-only de un saldo diario; solo Tesorero Central).
 *
 * La respuesta NUNCA expone CBU ni alias: las cuentas se identifican por
 * nombre/ID (el servicio no descifra). Dinero serializado como `string`.
 *
 * Respuestas: 200 OK · 201 CREATED · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  DiaIsoSchema,
  RegistrarSaldoDiarioSchema,
} from "@/lib/schemas/posicion-diaria.schema";
import {
  obtenerPosicionDiaria,
  PERMISO_LEER_REPORTES,
  PERMISO_REGISTRAR_SALDO_DIARIO,
  registrarSaldoDiario,
} from "@/lib/services/tesoreria/posicion-diaria.service";
import { diaNegocioIso } from "@/lib/utils/fecha-negocio";

export const GET = withPermission(
  PERMISO_LEER_REPORTES,
  async (req: NextRequest) => {
    // `?dia` se valida con el MISMO schema que el POST: formato AAAA-MM-DD,
    // día calendario real y no futuro respecto del día de negocio argentino
    // (G7-2). Sin esta validación un `?dia=foo` llegaba al servicio y
    // terminaba en 500 en vez de 400.
    const diaRaw = req.nextUrl.searchParams.get("dia") ?? diaNegocioIso();
    const diaParseado = DiaIsoSchema.safeParse(diaRaw);
    if (!diaParseado.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: diaParseado.error.issues[0]?.message ?? "Día inválido",
          },
        },
        { status: 400 },
      );
    }

    try {
      const posicion = await obtenerPosicionDiaria(diaParseado.data);
      return NextResponse.json({ data: posicion, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[GET /api/tesoreria/posicion-diaria] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);

export const POST = withPermission(
  PERMISO_REGISTRAR_SALDO_DIARIO,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = RegistrarSaldoDiarioSchema.safeParse(body);
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
      const registrado = await registrarSaldoDiario(parsed.data, session.userId);
      return NextResponse.json({ data: registrado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[POST /api/tesoreria/posicion-diaria] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
