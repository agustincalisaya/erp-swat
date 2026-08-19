/**
 * @file src/app/api/cron/check-pruebas-vencidas/route.ts
 * @description API Route de Cron unificada — HU-A3 + Criterio 5 (RESERVADO).
 *
 * Responsabilidades:
 *  1. Detectar LegajoPrueba «En Prueba» cuya `fecha_inicio_prueba` supere el
 *     plazo máximo (PLAZO_DIAS_PRUEBA = 30 días) y emitir alertas simuladas.
 *  2. Liberar Reservas cuyo TTL (TTL_RESERVADO_HORAS = 72 h) haya vencido,
 *     devolviendo el stock atómicamente al estado DISPONIBLE.
 *
 * Diseño preparatorio para Módulo F (Notificaciones):
 *  - `notificarVendedor()` es el punto de extensión. Hoy imprime por consola;
 *    en el Sprint del Módulo F se reemplaza por el cliente email/SMS/push
 *    sin modificar el flujo de este cron.
 *
 * Seguridad:
 *  - GET protegido por el header `Authorization: Bearer <CRON_SECRET>`.
 *  - CRON_SECRET se configura en `.env` y en el gestor de secretos del
 *    orquestador de cron (Vercel Cron Jobs, GitHub Actions, cron-job.org, etc.).
 *  - Los campos `efectivo_placa` y `efectivo_organismo` se descifran en
 *    memoria solo para el log; NUNCA se exponen en la respuesta HTTP.
 *
 * Invocación manual (desarrollo):
 *   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/check-pruebas-vencidas
 *
 * Invocación programada (producción — ejemplo Vercel):
 *   vercel.json → { "crons": [{ "path": "/api/cron/check-pruebas-vencidas", "schedule": "0 8 * * *" }] }
 *
 * @see prisma/schema.prisma → model LegajoPrueba, model Reserva
 * @see src/lib/services/inventario/legajo-prueba.service.ts
 * @see docs/specs/spec_modulo_A_HU3.md
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { decrypt } from "@/lib/crypto/aes";

// ──────────────────────────────────────────────────────────────────────────────
// Configuración del cron
// ──────────────────────────────────────────────────────────────────────────────

/** Plazo máximo de prueba en días. Pasado este límite, el legajo se considera vencido. */
const PLAZO_DIAS_PRUEBA = 30;

/** TTL de una Reserva en horas. Pasado este límite, el stock se libera automáticamente. */
const TTL_RESERVADO_HORAS = 72;

// ──────────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────────

interface LegajoVencidoAlerta {
  legajo_id: string;
  sku: string;
  dias_en_prueba: number;
  /** Placa descifrada — solo para log interno, nunca sale en response HTTP */
  efectivo_placa_decifrada: string;
  /** Organismo descifrado — solo para log interno, nunca sale en response HTTP */
  efectivo_organismo_decifrado: string;
  registrado_por_id: string;
  fecha_inicio_prueba: Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Simulador de notificación (stub preparatorio para Módulo F)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Simula el envío de una alerta al vendedor responsable del legajo.
 *
 * En Sprint 1: imprime por consola (logger) simulando el canal de notificación.
 * En Módulo F: este cuerpo se reemplazará por la llamada al cliente de
 * email/SMS/push correspondiente sin cambiar la firma ni el flujo del cron.
 *
 * @param alerta - Datos del legajo vencido ya descifrados en memoria.
 */
async function notificarVendedor(alerta: LegajoVencidoAlerta): Promise<void> {
  // TODO (Módulo F): reemplazar console.warn por cliente de notificaciones real.
  // Ejemplo futuro:
  //   await emailClient.send({
  //     to: await resolverEmailVendedor(alerta.registrado_por_id),
  //     template: "legajo_vencido",
  //     data: { legajo_id: alerta.legajo_id, sku: alerta.sku, dias: alerta.dias_en_prueba },
  //   });

  console.warn(
    `[CRON][check-pruebas-vencidas] ⚠️  ALERTA DE LEGAJO VENCIDO` +
    `\n  legajo_id        : ${alerta.legajo_id}` +
    `\n  SKU              : ${alerta.sku}` +
    `\n  Organismo        : ${alerta.efectivo_organismo_decifrado}` +
    // La placa se enmascara en el log para respetar la Ley 25.326.
    // Solo se registran los últimos 4 caracteres como referencia de trazabilidad.
    `\n  Placa (parcial)  : ***-${alerta.efectivo_placa_decifrada.slice(-4)}` +
    `\n  Días en prueba   : ${alerta.dias_en_prueba} (máx. permitido: ${PLAZO_DIAS_PRUEBA})` +
    `\n  Inicio prueba    : ${alerta.fecha_inicio_prueba.toISOString()}` +
    `\n  Registrado por   : ${alerta.registrado_por_id}` +
    `\n  → Notificación simulada al vendedor responsable. (Módulo F pendiente)`
  );
}

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
  // BLOQUE 1 — Legajos de prueba vencidos (EN_PRUEBA → alerta)
  // ──────────────────────────────────────────────────────────────────────────

  // ── 2. Calcular el umbral de vencimiento ────────────────────────────────────
  const umbralPrueba = new Date(ahora);
  umbralPrueba.setDate(umbralPrueba.getDate() - PLAZO_DIAS_PRUEBA);

  // ── 3. Consultar legajos vencidos ───────────────────────────────────────────
  // Criterio: activos, sin fecha_fin_prueba, con fecha_inicio_prueba anterior
  // al umbral de vencimiento.
  let legajosVencidos;
  try {
    legajosVencidos = await prisma.legajoPrueba.findMany({
      where: {
        is_active:        true,
        deleted_at:       null,
        fecha_fin_prueba: null,                    // aún en prueba
        fecha_inicio_prueba: { lt: umbralPrueba }, // superó el plazo
      },
      include: {
        variante_sku: {
          select: { sku: true, talle: true, color: true },
        },
      },
      orderBy: { fecha_inicio_prueba: "asc" },
    });
  } catch (dbError) {
    console.error("[CRON][check-pruebas-vencidas] Error al consultar la BD (legajos):", dbError);
    return NextResponse.json(
      { error: "Error interno al consultar legajos vencidos." },
      { status: 500 }
    );
  }

  // ── 4. Procesar y notificar ─────────────────────────────────────────────────
  const alertas: Omit<LegajoVencidoAlerta, "efectivo_placa_decifrada" | "efectivo_organismo_decifrado">[] = [];

  if (legajosVencidos.length === 0) {
    console.log(
      `[CRON][check-pruebas-vencidas] ✅ Sin legajos vencidos. ` +
      `(umbral: ${umbralPrueba.toISOString()})`
    );
  } else {
    console.log(
      `[CRON][check-pruebas-vencidas] ⚠️  Se encontraron ${legajosVencidos.length} legajo(s) vencido(s).`
    );
  }

  for (const legajo of legajosVencidos) {
    const diasEnPrueba = Math.floor(
      (ahora.getTime() - legajo.fecha_inicio_prueba.getTime()) / (1000 * 60 * 60 * 24)
    );

    let placaDecifrada = "[error de descifrado]";
    let organismoDecifrado = "[error de descifrado]";

    try {
      placaDecifrada     = decrypt(legajo.efectivo_placa);
      organismoDecifrado = decrypt(legajo.efectivo_organismo);
    } catch (cryptoError) {
      // Si la clave cambió o el dato está corrupto, no interrumpimos el cron:
      // notificamos igual con los marcadores de error y registramos el incidente.
      console.error(
        `[CRON] Error al descifrar legajo ${legajo.id}:`,
        cryptoError
      );
    }

    const alerta: LegajoVencidoAlerta = {
      legajo_id:                    legajo.id,
      sku:                          legajo.variante_sku.sku,
      dias_en_prueba:               diasEnPrueba,
      efectivo_placa_decifrada:     placaDecifrada,
      efectivo_organismo_decifrado: organismoDecifrado,
      registrado_por_id:            legajo.registrado_por_id,
      fecha_inicio_prueba:          legajo.fecha_inicio_prueba,
    };

    await notificarVendedor(alerta);

    // Acumulamos para el resumen de respuesta (sin datos sensibles)
    alertas.push({
      legajo_id:           alerta.legajo_id,
      sku:                 alerta.sku,
      dias_en_prueba:      alerta.dias_en_prueba,
      registrado_por_id:   alerta.registrado_por_id,
      fecha_inicio_prueba: alerta.fecha_inicio_prueba,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BLOQUE 2 — Reservas con TTL vencido (RESERVADO → DISPONIBLE)
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
    // Error al consultar la BD — no interrumpe la respuesta (legajos ya procesados).
    console.error("[CRON] Error al consultar reservas vencidas:", reservaQueryError);
  }

  // ── 5. Respuesta JSON (sin datos personales descifrados) ────────────────────
  return NextResponse.json(
    {
      ok:                    true,
      ejecutado_at:          ahora.toISOString(),
      // --- Legajos En Prueba ---
      plazo_dias_prueba:     PLAZO_DIAS_PRUEBA,
      umbral_prueba:         umbralPrueba.toISOString(),
      total_legajos_vencidos: alertas.length,
      legajos_alertados:     alertas,
      // --- Reservas TTL ---
      ttl_reservado_horas:      TTL_RESERVADO_HORAS,
      umbral_reservado:         umbralReservado.toISOString(),
      total_reservas_liberadas: reservadosLiberados,
    },
    { status: 200 }
  );
}
