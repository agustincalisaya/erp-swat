/**
 * @module route — GET /api/proveedores/auditoria
 * @description HU-H6 (Módulo H) — Consulta de eventos de auditoría del
 * dominio proveedores, con verificación opcional de integridad de la cadena
 * SHA-256 (Módulo D). Wrapper fino: resuelve auth+permiso vía
 * `withPermission` (mismo mecanismo que TODO Route Handler existente del
 * proyecto — nunca se esquiva, ver decisión de cierre de T16-T19), valida
 * query params con Zod, delega en `listarEventosDeDominioProveedores()`
 * (T1-T11) y opcionalmente `verificarIntegridadParaRango()` (T12-T15).
 * NINGUNA regla de negocio vive acá.
 *
 * Shape de error: `{ data: null, error: { code, message } }` — el shape
 * REAL y único del proyecto (confirmado contra `with-permission.ts`,
 * `lista-precios/route.ts` y `verificar-cadena/route.ts`), NO el
 * `{ codigo, mensaje, detalles }` en español que proponía la Spec original
 * sin haber verificado contra `with-permission.ts` — mismo tipo de vacío ya
 * encontrado con `ACCIONES_DOMINIO_PROVEEDORES` en T1-T11. 401/403 salen
 * con el shape fijo de `withPermission` (`UNAUTHORIZED`/`FORBIDDEN`); 400/500
 * de este archivo usan `VALIDATION_ERROR`/`INTERNAL_ERROR`, mismos códigos
 * que ya usan `lista-precios/route.ts` y `verificar-cadena/route.ts` — no
 * se inventan códigos nuevos.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { withPermission } from "@/lib/auth/with-permission";
import {
  ACCIONES_DOMINIO_PROVEEDORES,
  listarEventosDeDominioProveedores,
} from "@/lib/services/proveedores/auditoria-proveedores.service";
import { verificarIntegridadParaRango } from "@/lib/services/proveedores/auditoria-integridad.service";

// ──────────────────────────────────────────────────────────────────────────────
// Auxiliares de respuesta (T17) — shape real del proyecto, no el de la Spec original
// ──────────────────────────────────────────────────────────────────────────────

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ data: null, error: { code, message, ...extra } }, { status });
}

function okResponse(data: unknown): NextResponse {
  return NextResponse.json({ data, error: null }, { status: 200 });
}

// ──────────────────────────────────────────────────────────────────────────────
// Validación de query params (T18) — schema cerrado, verbatim
// ──────────────────────────────────────────────────────────────────────────────

export const ConsultarAuditoriaProveedoresQuerySchema = z
  .object({
    proveedor_id: z.string().uuid().optional(),
    tipo_evento: z.enum(ACCIONES_DOMINIO_PROVEEDORES).optional(),
    usuario_id: z.string().uuid().optional(),
    fecha_desde: z.coerce.date().optional(),
    fecha_hasta: z.coerce.date().optional(),
    verificar_integridad: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .default("false"),
    pagina: z.coerce.number().int().positive().default(1),
    por_pagina: z.coerce.number().int().positive().max(50).default(20),
  })
  .refine((data) => !data.fecha_desde || !data.fecha_hasta || data.fecha_desde <= data.fecha_hasta, {
    message: "fecha_desde debe ser anterior o igual a fecha_hasta",
  });

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/proveedores/auditoria (T19)
// ──────────────────────────────────────────────────────────────────────────────

export const GET = withPermission("auditoria:leer_historico", async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const parsed = ConsultarAuditoriaProveedoresQuerySchema.safeParse(Object.fromEntries(searchParams));

  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Parámetros de consulta inválidos.", 400, {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { proveedor_id, tipo_evento, usuario_id, fecha_desde, fecha_hasta, verificar_integridad, pagina, por_pagina } =
    parsed.data;

  let resultado;
  try {
    resultado = await listarEventosDeDominioProveedores(
      { proveedor_id, tipo_evento, usuario_id, fecha_desde, fecha_hasta },
      { pagina, por_pagina },
    );
  } catch (err) {
    console.error("[GET /api/proveedores/auditoria] Error listando eventos:", err);
    return errorResponse("INTERNAL_ERROR", "Error interno del servidor", 500);
  }

  let verificacion_integridad = null;
  if (verificar_integridad) {
    try {
      verificacion_integridad = await verificarIntegridadParaRango(resultado.items);
    } catch (err) {
      console.error("[GET /api/proveedores/auditoria] Error verificando integridad:", err);
      return errorResponse("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  }

  // La sanitización de `valor_anterior`/`valor_nuevo` ya viene aplicada desde
  // `listarEventosDeDominioProveedores()` (T1-T11) — no se repite acá.
  return okResponse({
    items: resultado.items,
    paginacion: resultado.paginacion,
    verificacion_integridad,
  });
});
