/**
 * @module route — PATCH /api/inventario/variantes/[id]/baja
 * @description HU-A6 — Baja lógica (Soft Delete) de `VarianteSKU` con modal
 * de justificación (spec_modulo_A.md §2.5/§3.5). Reemplaza el stub GET 501
 * anterior.
 *
 * Gateado con `withAuth` (401 sin sesión) + verificación de rol activo
 * (`ADMINISTRADOR`/`ENCARGADO_DEPOSITO`) vía `usuarioPuedeBajarVariante()`
 * (decisión D2 — no se usa `withPermission("inventario:operar")` porque el
 * seed solo otorga ese permiso a `ENCARGADO_DEPOSITO` y bloquearía a
 * `ADMINISTRADOR`). El `variante_id` se toma del segmento `[id]` de la URL
 * (posición `len-2` del pathname, decisión D7 — `[id]` no es el último
 * segmento en `[id]/baja`), no del body. La IP se resuelve con el mismo
 * patrón `resolverIp()` del resto de los route handlers (decisión D1):
 * `x-forwarded-for` (primer valor) → `x-real-ip` → `"unknown"`.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR (Zod) /
 * MOTIVO_REQUERIDO (stock > 0 sin motivo) · 403 FORBIDDEN · 404
 * VARIANTE_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { BajaLogicaVarianteSchema } from "@/lib/schemas/inventario.schema";
import {
  darDeBajaVariante,
  usuarioPuedeBajarVariante,
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
  const segmentos = pathname.split("/");
  const varianteId = segmentos[segmentos.length - 2] as string;

  const autorizado = await usuarioPuedeBajarVariante(session.userId);
  if (!autorizado) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "No tenés el permiso requerido para dar de baja variantes",
        },
      },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BajaLogicaVarianteSchema.safeParse(body ?? {});

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

  const ip = resolverIp(req);

  try {
    const variante = await darDeBajaVariante(
      varianteId,
      session.userId,
      parsed.data.deletion_reason,
      ip,
    );
    return NextResponse.json({ data: variante, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "VARIANTE_NO_ENCONTRADA" ? 404 : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[PATCH /api/inventario/variantes/[id]/baja] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});