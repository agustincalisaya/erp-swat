/**
 * @module route — PATCH /api/inventario/variantes/[id]/reclasificar-devuelto
 * @description HU-A9 (spec_modulo_A.md §2.8) — Reclasificación de una unidad
 * en estado `DEVUELTO`: `APTO` → `DISPONIBLE` (reincorpora stock) o
 * `NO_APTO` → `BAJA_MERMA` (motivo obligatorio). Bajo el umbral
 * (`UMBRAL_BAJA_MERMA_UNIDADES`) persiste directo; sobre el umbral crea una
 * `ReclasificacionSolicitud` en `PENDIENTE_APROBACION` (sin tocar stock).
 *
 * Decisión de implementación sobre `[id]` vs `variante_sku_id` del body:
 * siguiendo el patrón de `variantes/[id]/baja`, el `[id]` de la URL es
 * AUTORITATIVO — el body debe traer `variante_sku_id` (lo exige
 * `ReclasificarDevueltoSchema`, compartido con la Server Action) y si no
 * coincide con la ruta se rechaza con 400 VALIDATION_ERROR (integridad
 * path/body, evita reclasificar una variante distinta de la apuntada).
 *
 * Gateado con `withPermission("inventario:reclasificar")` (ADMINISTRADOR +
 * ENCARGADO_DEPOSITO). Toda la lógica transaccional vive en el service.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR /
 * MOTIVO_REQUERIDO · 401 UNAUTHORIZED · 403 FORBIDDEN · 404
 * VARIANTE_NO_ENCONTRADA / DEPOSITO_NO_ENCONTRADO / STOCK_DEPOSITO_NO_ENCONTRADO ·
 * 409 ESTADO_INVALIDO_PARA_RECLASIFICACION · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withPermission } from "@/lib/auth/with-permission";
import { ReclasificarDevueltoSchema } from "@/lib/schemas/inventario.schema";
import { reclasificarDevuelto } from "@/lib/services/inventario/reclasificacion.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withPermission(
  "inventario:reclasificar",
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = z.string().uuid("El ID de variante es inválido").safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const parsed = ReclasificarDevueltoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Datos inválidos",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    if (parsed.data.variante_sku_id !== parsedId.data) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "La variante del cuerpo no coincide con la variante de la ruta",
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await reclasificarDevuelto(
        { ...parsed.data, variante_sku_id: parsedId.data },
        session.userId,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (error) {
      if (error instanceof ServiceError) {
        let status = 400;
        switch (error.code) {
          case "ESTADO_INVALIDO_PARA_RECLASIFICACION":
            status = 409;
            break;
          case "VARIANTE_NO_ENCONTRADA":
          case "DEPOSITO_NO_ENCONTRADO":
          case "STOCK_DEPOSITO_NO_ENCONTRADO":
            status = 404;
            break;
          default:
            status = 400;
        }
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status },
        );
      }
      console.error("[PATCH /api/inventario/variantes/[id]/reclasificar-devuelto] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);