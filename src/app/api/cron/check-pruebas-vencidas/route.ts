/**
 * @file src/app/api/cron/check-pruebas-vencidas/route.ts
 * @description API Route de Cron — Criterio 5 (RESERVADO).
 *
 * Responsabilidades:
 *  1. Liberar Reservas cuyo TTL (TTL_RESERVADO_HORAS = 72 h) haya vencido,
 *     devolviendo el stock atómicamente al estado DISPONIBLE.
 *
 * Nota histórica: este cron también detectaba LegajoPrueba «En Prueba»
 * vencidos (HU-A3). Esa funcionalidad fue cancelada por decisión del
 * Product Owner en la Sprint Review del 21/08/2026 y su código fue
 * eliminado; el nombre de la ruta se conserva para no romper la
 * configuración externa del orquestador de cron.
 *
 * Seguridad:
 *  - GET protegido por el header `Authorization: Bearer <CRON_SECRET>`.
 *  - CRON_SECRET se configura en `.env` y en el gestor de secretos del
 *    orquestador de cron (Vercel Cron Jobs, GitHub Actions, cron-job.org, etc.).
 *
 * Invocación manual (desarrollo):
 *   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/check-pruebas-vencidas
 *
 * Invocación programada (producción — ejemplo Vercel):
 *   vercel.json → { "crons": [{ "path": "/api/cron/check-pruebas-vencidas", "schedule": "0 8 * * *" }] }
 *
 * @see prisma/schema.prisma → model Reserva
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// ──────────────────────────────────────────────────────────────────────────────
// Configuración del cron
// ──────────────────────────────────────────────────────────────────────────────

/** TTL de una Reserva en horas. Pasado este límite, el stock se libera automáticamente. */
const TTL_RESERVADO_HORAS = 72;

// ──────────────────────────────────────────────────────────────────────────────
// Handler GET
// ──────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── 1. Autenticación por secret compartido ──────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret) {
    // En desarrollo sin CRON_SECRET configurada se permite el acceso para
    // facilitar la evaluación local. En producción DEBE configurarse.
    if (process.env.NODE_ENV === "production") {
      console.error("[CRON] CRON_SECRET no configurada en producción — request rechazado.");
      return NextResponse.json({ error: "CRON_SECRET no configurada." }, { status: 500 });
    }
    console.warn("[CRON] CRON_SECRET no configurada. Acceso permitido solo en desarrollo.");
  } else {
    const expectedHeader = `Bearer ${cronSecret}`;
    if (authHeader !== expectedHeader) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const ahora = new Date();

  // ──────────────────────────────────────────────────────────────────────────
  // Reservas con TTL vencido (RESERVADO → DISPONIBLE)
  // Criterio 5: si fecha_inicio_reserva < now - 72h → liberar stock atómico.
  // ──────────────────────────────────────────────────────────────────────────

  const umbralReservado = new Date(ahora);
  umbralReservado.setHours(umbralReservado.getHours() - TTL_RESERVADO_HORAS);

  let reservadosLiberados = 0;

  try {
    // Buscar reservas activas cuyo TTL haya vencido
    const reservasVencidas = await prisma.reserva.findMany({
      where: {
        is_active:            true,
        deleted_at:           null,
        fecha_fin_reserva:    null,                        // aún activa (no confirmada ni liberada)
        fecha_inicio_reserva: { lt: umbralReservado },     // TTL superado
      },
      select: {
        id:              true,
        variante_sku_id: true,
        deposito_id:     true,
        cantidad:        true,
        motivo:          true,
        registrado_por_id: true,
        variante_sku:    { select: { sku: true } },
      },
      orderBy: { fecha_inicio_reserva: "asc" },
    });

    if (reservasVencidas.length === 0) {
      console.log(
        `[CRON][check-pruebas-vencidas] ✅ Sin reservas vencidas. ` +
        `(umbral TTL ${TTL_RESERVADO_HORAS}h: ${umbralReservado.toISOString()})`
      );
    } else {
      console.log(
        `[CRON][check-pruebas-vencidas] 🔓 Se liberarán ${reservasVencidas.length} reserva(s) por TTL vencido.`
      );
    }

    for (const reserva of reservasVencidas) {
      try {
        await prisma.$transaction(async (tx) => {
          // a) Reintegrar la cantidad al StockDeposito disponible (RESERVADO → DISPONIBLE)
          //    updateMany condicionado — patrón CAS para evitar race conditions.
          const updateStock = await tx.stockDeposito.updateMany({
            where: {
              variante_sku_id: reserva.variante_sku_id,
              deposito_id:     reserva.deposito_id,
              is_active:       true,
            },
            data: { cantidad: { increment: reserva.cantidad } },
          });

          if (updateStock.count === 0) {
            // El StockDeposito no existe — situación anómala, loguear y abortar.
            throw new Error(
              `StockDeposito no encontrado para variante=${reserva.variante_sku_id} / deposito=${reserva.deposito_id}`
            );
          }

          // b) Registrar MovimientoStock de reintegro (inmutable — nunca se actualiza)
          await tx.movimientoStock.create({
            data: {
              variante_sku_id:        reserva.variante_sku_id,
              deposito_origen_id:     reserva.deposito_id,
              tipo_movimiento:        "INGRESO",
              estado_origen:          "RESERVADO",
              estado_destino:         "DISPONIBLE",
              cantidad:               reserva.cantidad,
              comprobante_referencia: `CRON-LIBERACION-RESERVA-${reserva.id}`,
              // El cron actúa como agente del sistema — se usa el ID del registrador original
              // para mantener la cadena de trazabilidad. Alternativa: un usuario "SISTEMA" fijo.
              registrado_por_id: reserva.registrado_por_id,
            },
          });

          // c) Cerrar la reserva (soft-close: fecha_fin_reserva = now, no DELETE físico)
          await tx.reserva.update({
            where: { id: reserva.id },
            data:  { fecha_fin_reserva: ahora },
          });
        });

        console.warn(
          `[CRON][check-pruebas-vencidas] 🔓 RESERVA LIBERADA por TTL` +
          `\n  reserva_id      : ${reserva.id}` +
          `\n  SKU             : ${reserva.variante_sku.sku}` +
          `\n  cantidad        : ${reserva.cantidad}` +
          `\n  motivo_reserva  : ${reserva.motivo ?? "(sin motivo registrado)"}` +
          `\n  → Stock reintegrado atómicamente a DISPONIBLE.`
        );

        reservadosLiberados++;
      } catch (txError) {
        // Una transacción fallida no aborta el resto — continúa con las demás reservas.
        console.error(
          `[CRON] Error al liberar reserva ${reserva.id}:`,
          txError
        );
      }
    }
  } catch (reservaQueryError) {
    // Error al consultar la BD — no interrumpe la respuesta.
    console.error("[CRON] Error al consultar reservas vencidas:", reservaQueryError);
  }

  // ── Respuesta JSON ───────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      ok:                    true,
      ejecutado_at:          ahora.toISOString(),
      // --- Reservas TTL ---
      ttl_reservado_horas:      TTL_RESERVADO_HORAS,
      umbral_reservado:         umbralReservado.toISOString(),
      total_reservas_liberadas: reservadosLiberados,
    },
    { status: 200 }
  );
}
