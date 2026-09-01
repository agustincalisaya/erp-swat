/**
 * @module route — GET /api/inventario/depositos/[id]/productos
 * @description HU-A5 ampliada (Sprint 2) — Consola de Depósito: listado
 * paginado server-side de las variantes con stock configurado en un depósito,
 * con buscador de texto libre (spec_modulo_A.md §2.6 /
 * task_HU-A5-ampliacion.md §2).
 *
 * Capa delgada: compone `{ deposito_id: params.id, ...searchParams }`, valida
 * con `ListarProductosPorDepositoQuerySchema` y delega TODA la lógica de query
 * (filtro `OR` server-side con `contains`/`mode: "insensitive"`, paginación,
 * cálculo de `total_paginas`) en `listarProductosPorDeposito()` de
 * `stock.service.ts`. Ninguna llamada a Prisma vive en este archivo.
 *
 * Gateado con `withAuth` (solo sesión), sin `withPermission` granular — mismo
 * criterio que el resto de los Route Handlers de consulta de Módulo A (ver
 * docstring de `stock/umbrales/route.ts`): no existe un permiso RBAC de
 * lectura de inventario en `prisma/seed.ts`. Deuda técnica de RBAC reportada
 * como hallazgo transversal, no exclusivo de esta task.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR (Zod) · 401
 * UNAUTHORIZED · 404 DEPOSITO_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ListarProductosPorDepositoQuerySchema } from "@/lib/schemas/inventario.schema";
import { listarProductosPorDeposito } from "@/lib/services/inventario/stock.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: NextRequest, _session, rawContext) => {
  const { id } = await (rawContext as Context).params;

  const parsed = ListarProductosPorDepositoQuerySchema.safeParse({
    deposito_id: id,
    ...Object.fromEntries(req.nextUrl.searchParams),
  });

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
    const resultado = await listarProductosPorDeposito(parsed.data);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "DEPOSITO_NO_ENCONTRADO" ? 404 : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[GET /api/inventario/depositos/[id]/productos] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
