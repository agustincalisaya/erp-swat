/**
 * @file src/app/api/cron/check-pruebas-vencidas/route.ts
 * @description API Route de Cron — HU-A10 (spec_modulo_A.md §2.9).
 *
 * Responsabilidad: liberar las `Reserva` cuyo TTL (72 h) haya vencido,
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
 */

import { NextRequest, NextResponse } from "next/server";
import {
  liberarReservasVencidas,
  TTL_RESERVA_DEFAULT_HORAS,
} from "@/lib/services/inventario/reserva.service";

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
  try {
    const resultado = await liberarReservasVencidas(ahora);

    if (resultado.total_liberadas === 0) {
      console.log(
        `[CRON][check-pruebas-vencidas] ✅ Sin reservas vencidas. ` +
          `(umbral TTL ${resultado.ttl_horas}h: ${resultado.umbral})`,
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
        ttl_reservado_horas: resultado.ttl_horas,
        umbral_reservado: resultado.umbral,
        total_reservas_liberadas: resultado.total_liberadas,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[CRON] Error al liberar reservas vencidas:", error);
    return NextResponse.json(
      {
        ok: false,
        ejecutado_at: ahora.toISOString(),
        ttl_reservado_horas: TTL_RESERVA_DEFAULT_HORAS,
        error: "Error al liberar reservas vencidas.",
      },
      { status: 500 },
    );
  }
}
