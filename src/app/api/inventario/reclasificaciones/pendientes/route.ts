/**
 * @module route — GET /api/inventario/reclasificaciones/pendientes
 * @description HU-A9 (spec_modulo_A.md §3.8) — Listado de solicitudes de
 * reclasificación en `PENDIENTE_APROBACION` para la sección de aprobación
 * Admin. Devuelve variante y depósito resueltos (sin joins en el cliente).
 *
 * Gateado con `withPermission("inventario:reclasificar_aprobar")` — permiso
 * exclusivo de ADMINISTRADOR.
 *
 * Respuestas `{ data, error }`: 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { listarSolicitudesPendientes } from "@/lib/services/inventario/reclasificacion.service";

export const GET = withPermission("inventario:reclasificar_aprobar", async () => {
  try {
    const solicitudes = await listarSolicitudesPendientes();
    return NextResponse.json({ data: solicitudes, error: null }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/inventario/reclasificaciones/pendientes] Error inesperado:", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});