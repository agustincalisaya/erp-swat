/**
 * @module route — POST /api/auditoria/verificar-cadena
 * @description D.3 — Verificación de integridad de la cadena de hashes
 * (spec_modulo_D.md §4.4, task_cali_auditoria_forense.md §3.2).
 *
 * Gateado por `auditoria:verificar_cadena` (rol Auditor) — distinto de
 * `auditoria:leer_forense`. `withPermission` rechaza con 403 antes de
 * ejecutar el recorrido si falta el permiso.
 *
 * Sin timeout corto: recorre TODO `AuditLog` (§3.2 punto 6 de la tarea) —
 * Next.js Route Handlers en Node runtime no tienen timeout por defecto que
 * corte esto a mitad de camino; no se configura ninguno acá deliberadamente.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { verificarCadenaIntegridad } from "@/lib/services/auditoria/audit-log.service";

export const POST = withPermission("auditoria:verificar_cadena", async (_req: NextRequest) => {
  try {
    const resultado = await verificarCadenaIntegridad();
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/auditoria/verificar-cadena] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
