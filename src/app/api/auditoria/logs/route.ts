/**
 * @module route — GET /api/auditoria/logs
 * @description D.3 — Consola de Auditoría Forense, listado filtrable
 * (spec_modulo_D.md §4.3, task_cali_auditoria_forense.md §3.1).
 *
 * Sin gate de permiso acá a nivel de acceso: cualquier usuario autenticado
 * puede llamar este endpoint (para consultar SU PROPIO historial). La regla
 * de segregación de funciones — forzar `usuario_id` a la sesión sin el
 * permiso `auditoria:leer_forense` — vive en `listarAuditLog()`
 * (`lib/services/auditoria/audit-log.service.ts`), no acá.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { FiltrosAuditoriaSchema } from "@/lib/schemas/auditoria.schema";
import { listarAuditLog } from "@/lib/services/auditoria/audit-log.service";

export const GET = withAuth(async (req: NextRequest, session) => {
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = FiltrosAuditoriaSchema.safeParse(queryParams);

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Los filtros enviados no son válidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await listarAuditLog(parsed.data, session);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/auditoria/logs] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
