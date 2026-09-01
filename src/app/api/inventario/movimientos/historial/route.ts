/**
 * @module route — GET /api/inventario/movimientos/historial
 * @description HU-A11 (spec_modulo_A.md §2.10) — Historial operativo de
 * movimientos: consulta paginada de solo lectura sobre `MovimientoStock`,
 * accesible por el rol Encargado de Depósito bajo el permiso
 * `inventario:movimientos:leer_historico`. Distinta de la Consola de
 * Auditoría Forense (HU-A6/Módulo D, permiso `auditoria:leer_historico`):
 * este endpoint no expone ni calcula hashes de integridad.
 *
 * Capa delgada: valida `searchParams` con `HistorialMovimientosQuerySchema` y
 * delega toda la lógica de query en `listarHistorialMovimientos()` de
 * `movimiento.service.ts`. Ninguna llamada a Prisma vive en este archivo.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR (Zod) · 401
 * UNAUTHORIZED · 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { HistorialMovimientosQuerySchema } from "@/lib/schemas/inventario.schema";
import { listarHistorialMovimientos } from "@/lib/services/inventario/movimiento.service";

export const GET = withPermission(
  "inventario:movimientos:leer_historico",
  async (req: NextRequest) => {
    const parsed = HistorialMovimientosQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );

    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Parámetros de consulta inválidos",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await listarHistorialMovimientos(parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      console.error("[GET /api/inventario/movimientos/historial] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
