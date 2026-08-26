/**
 * @module route — POST /api/inventario/movimientos/ingreso
 * @description HU-2 — Registro REST de ingreso de mercadería, pensado para
 * integración directa de dispositivos de escaneo dedicados (hardware
 * externo) que no pasan por el panel web. Reemplaza el stub GET 501
 * anterior (Hallazgo 2).
 *
 * Reutiliza el mismo `registrarIngresoStock()` de
 * `lib/services/inventario/movimiento.service.ts` que usa la Server Action
 * (`(dashboard)/inventario/movimientos/actions.ts`) — una sola
 * implementación de la mutación transaccional de stock para ambos caminos,
 * sin lógica de negocio duplicada.
 *
 * Gateado con `withAuth` (401 sin sesión) + verificación de rol activo
 * (`ADMINISTRADOR`/`ENCARGADO_DEPOSITO`) vía `usuarioPuedeRegistrarIngresoStock()`
 * (Hallazgo 1, mismo punto de verdad que la página y las Server Actions) —
 * no se usa `withPermission("inventario:operar")` porque el seed solo
 * otorga ese permiso a `ENCARGADO_DEPOSITO` y bloquearía a `ADMINISTRADOR`
 * (mismo criterio que `variantes/[id]/baja/route.ts`, HU-A6).
 *
 * Respuestas `{ data, error }`: 201 Created · 400 VALIDATION_ERROR (Zod) /
 * STOCK_INSUFICIENTE · 401 UNAUTHORIZED · 403 FORBIDDEN · 404
 * VARIANTE_NO_ENCONTRADA / DEPOSITO_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { RegistrarIngresoPorEscaneoSchema } from "@/lib/schemas/inventario.schema";
import {
  registrarIngresoStock,
  usuarioPuedeRegistrarIngresoStock,
} from "@/lib/services/inventario/movimiento.service";
import { ServiceError } from "@/lib/errors/service-error";

export async function GET() {
  return NextResponse.json(
    {
      data: null,
      error: { code: "METHOD_NOT_ALLOWED", message: "Usá POST para registrar un ingreso." },
    },
    { status: 405 },
  );
}

export const POST = withAuth(async (req: NextRequest, session) => {
  const autorizado = await usuarioPuedeRegistrarIngresoStock(session.userId);
  if (!autorizado) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "No tenés el permiso requerido para registrar ingresos de mercadería",
        },
      },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RegistrarIngresoPorEscaneoSchema.safeParse(body);

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
    const resultado = await registrarIngresoStock(parsed.data, session.userId);
    return NextResponse.json({ data: resultado, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = ["VARIANTE_NO_ENCONTRADA", "DEPOSITO_NO_ENCONTRADO"].includes(err.code)
        ? 404
        : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[POST /api/inventario/movimientos/ingreso] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } },
      { status: 500 },
    );
  }
});
