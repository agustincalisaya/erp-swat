/**
 * @file src/app/api/cron/check-pruebas-vencidas/route.ts
 * @description API Route de Cron — HU-A10 (spec_modulo_A.md §2.9).
 *
 * Responsabilidad: liberar las `Reserva` cuya `fecha_expiracion` ya pasó
 * (TTL persistido por reserva — HU-A10 Rev. 3; 72 h por defecto),
 * devolviendo el stock atómicamente al estado DISPONIBLE. Toda la lógica
 * transaccional vive en `reserva.service.ts` (`liberarReservasVencidas()`);
 * este handler solo autentica el request del orquestador y delega.
 *
 * Nota histórica: este cron también detectaba LegajoPrueba «En Prueba»
 * vencidos (HU-A3). Esa funcionalidad fue cancelada por decisión del
 * Product Owner en la Sprint Review del 21/08/2026 y su código fue
 * eliminado; el nombre de la ruta se conserva para no romper la
 * configuración externa del orquestador de cron y por estar referenciado en
 * el comentario del modelo `Reserva` en `schema.prisma`.
 *
 * Método: POST (spec_modulo_A.md §2.9). No se expone GET.
 *
 * Seguridad:
 *  - POST protegido por el header `Authorization: Bearer <CRON_SECRET>`.
 *  - CRON_SECRET se configura en `.env` y en el gestor de secretos del
 *    orquestador de cron (Vercel Cron Jobs, GitHub Actions, cron-job.org, etc.).
 *
 * Invocación manual (desarrollo):
 *   curl -X POST -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/check-pruebas-vencidas
 *
 * Invocación programada (producción — ejemplo Vercel):
 *   vercel.json → { "crons": [{ "path": "/api/cron/check-pruebas-vencidas", "schedule": "0 8 * * *" }] }
 *
 * @see prisma/schema.prisma → model Reserva
 * @see src/lib/services/inventario/reserva.service.ts → liberarReservasVencidas()
 *
 * HU-E4 (Gate 3, A1): después de la liberación de reservas corre, de forma
 * independiente, el mantenimiento de cupones (`ejecutarMantenimientoCupones()`)
 * vía `ejecutarMantenimientoProgramado()`: si una falla, la otra corre igual.
 * El status de la respuesta lo sigue decidiendo la liberación de reservas.
 *
 * HU-E5 (D10): tercera tarea independiente, la baja lógica de carritos web
 * abandonados; su resultado va en `mantenimiento_carritos`.
 *
 * @see src/lib/services/ecommerce/mantenimiento-programado.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { ejecutarMantenimientoProgramado } from "@/lib/services/ecommerce/mantenimiento-programado";

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  // ── 2. Liberación de Reservas con TTL vencido (RESERVADO → DISPONIBLE) ───────
  // ── 3. HU-E4: mantenimiento de cupones, independiente del paso 2 ────────────
  // ── 4. HU-E5: baja de carritos abandonados, independiente de los anteriores ──
  const { reservas, cupones, carritos, recordatorios_hu_e13, vencimientos_hu_e13, retries_hu_e13 } =
    await ejecutarMantenimientoProgramado(ahora);

  const mantenimientoCupones = cupones.ok
    ? {
        ok: true,
        total_aplicaciones_liberadas: cupones.valor.aplicaciones_liberadas.length,
        total_cupones_dados_de_baja: cupones.valor.cupones_dados_de_baja.length,
      }
    : { ok: false, error: "Error en el mantenimiento de cupones." };
  if (cupones.ok && (cupones.valor.aplicaciones_liberadas.length > 0 || cupones.valor.cupones_dados_de_baja.length > 0)) {
    console.warn(
      `[CRON][check-pruebas-vencidas] 🎟️ Cupones: ${cupones.valor.aplicaciones_liberadas.length} aplicación(es) liberada(s), ` +
        `${cupones.valor.cupones_dados_de_baja.length} cupón(es) dado(s) de baja.`,
    );
  }

  const mantenimientoCarritos = carritos.ok
    ? { ok: true, total_desactivados: carritos.valor.total_desactivados }
    : { ok: false, error: "Error en la baja de carritos abandonados." };
  if (carritos.ok && carritos.valor.total_desactivados > 0) {
    console.warn(
      `[CRON][check-pruebas-vencidas] 🛒 Carritos abandonados: ${carritos.valor.total_desactivados} carrito(s) dado(s) de baja.`,
    );
  }

  const mantenimientoHuE13 = {
    recordatorios: recordatorios_hu_e13.ok
      ? { ok: true, ...recordatorios_hu_e13.valor }
      : { ok: false, error: "Error en recordatorios HU-E13" },
    vencimientos: vencimientos_hu_e13.ok
      ? { ok: true, ...vencimientos_hu_e13.valor }
      : { ok: false, error: "Error en vencimientos HU-E13" },
    retries: retries_hu_e13.ok
      ? { ok: true, ...retries_hu_e13.valor }
      : { ok: false, error: "Error en retries HU-E13" },
  };

  if (!reservas.ok) {
    // El error ya quedó logueado por `ejecutarMantenimientoProgramado()`.
    return NextResponse.json(
      {
        ok: false,
        ejecutado_at: ahora.toISOString(),
        error: "Error al liberar reservas vencidas.",
        mantenimiento_cupones: mantenimientoCupones,
        mantenimiento_carritos: mantenimientoCarritos,
        mantenimiento_hu_e13: mantenimientoHuE13,
      },
      { status: 500 },
    );
  }

  const resultado = reservas.valor;
  if (resultado.total_liberadas === 0) {
    console.log(
      `[CRON][check-pruebas-vencidas] ✅ Sin reservas vencidas. ` +
        `(fecha_expiracion <= ${resultado.umbral})`,
    );
  } else {
    console.warn(
      `[CRON][check-pruebas-vencidas] 🔓 ${resultado.total_liberadas} reserva(s) liberada(s) por TTL vencido: ` +
        resultado.liberadas.map((r) => r.reserva_id).join(", "),
    );
  }

  return NextResponse.json(
    {
      ok: true,
      ejecutado_at: ahora.toISOString(),
      umbral_reservado: resultado.umbral,
      total_reservas_liberadas: resultado.total_liberadas,
      mantenimiento_cupones: mantenimientoCupones,
      mantenimiento_carritos: mantenimientoCarritos,
      mantenimiento_hu_e13: mantenimientoHuE13,
    },
    { status: 200 },
  );
}
