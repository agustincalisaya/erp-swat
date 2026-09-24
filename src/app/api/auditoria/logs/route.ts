/**
 * @module route — GET /api/auditoria/logs
 * @description D.3 — Consola de Auditoría Forense, listado filtrable
 * (spec_modulo_D.md §4.3, task_cali_auditoria_forense.md §3.1).
 *
 * El modo general mantiene el acceso al historial propio de cualquier usuario
 * autenticado y la segregación de `listarAuditLog()`. El modo `modulo=clientes`
 * exige `clientes:leer_auditoria` y delega en el filtro fijo de HU-C10.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth, usuarioTienePermiso } from "@/lib/auth/with-permission";
import { FiltrosAuditoriaSchema } from "@/lib/schemas/auditoria.schema";
import { listarAuditLog } from "@/lib/services/auditoria/audit-log.service";
import { FiltrosAuditoriaClientesSchema } from "@/lib/schemas/auditoria-clientes.schema";
import {
  listarAuditoriaClientes,
  PERMISO_LEER_AUDITORIA_CLIENTES,
} from "@/lib/services/clientes/auditoria-clientes.service";
import { ServiceError } from "@/lib/errors/service-error";

export const GET = withAuth(async (req: NextRequest, session) => {
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  if (req.nextUrl.searchParams.getAll("modulo").includes("clientes")) {
    // HU-C10: el permiso y el dominio se validan en el servidor; la ruta
    // general y su regla de historial propio siguen intactas.
    if (!await usuarioTienePermiso(session.userId, PERMISO_LEER_AUDITORIA_CLIENTES)) {
      return NextResponse.json(
        { data: null, error: { code: "FORBIDDEN", message: "No tenés el permiso requerido" } },
        { status: 403 },
      );
    }
    const parsedClientes = FiltrosAuditoriaClientesSchema.safeParse(queryParams);
    if (!parsedClientes.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: "Los filtros enviados no son válidos",
          fieldErrors: parsedClientes.error.flatten().fieldErrors } },
        { status: 400 },
      );
    }
    try {
      const resultado = await listarAuditoriaClientes(parsedClientes.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError && err.code === "FORBIDDEN") {
        return NextResponse.json(
          { data: null, error: { code: "FORBIDDEN", message: err.message } },
          { status: 403 },
        );
      }
      console.error("[GET /api/auditoria/logs?modulo=clientes] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  }
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
