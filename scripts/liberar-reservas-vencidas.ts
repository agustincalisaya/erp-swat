/**
 * HU-A10 / HU-E1 (D4) — Job de liberación de Reservas vencidas, ejecutable
 * por npm sin depender de un orquestador externo ni de `npm run dev`.
 *
 *   npm run job:reservas         → una pasada y termina.
 *   npm run job:reservas:watch   → una pasada cada 60 s (o JOB_RESERVAS_INTERVALO_SEG).
 *
 * Invoca EXACTAMENTE la misma función que el cron HTTP
 * (`POST /api/cron/check-pruebas-vencidas`): `liberarReservasVencidas()` de
 * Módulo A — no reimplementa ninguna transición de stock. Corre con
 * `node --conditions=react-server --import tsx` (mismo mecanismo que el seed y
 * los `test:integration:*`) para poder importar código con `server-only`.
 *
 * HU-E4 (Gate 3, A1): después corre, de forma independiente, el mantenimiento
 * de cupones (`ejecutarMantenimientoProgramado()`, el mismo que usa el cron):
 * si una tarea falla, la otra corre igual y el error se loguea.
 *
 * HU-E5 (D10): tercera tarea, la baja lógica de carritos web abandonados
 * (`ECOMMERCE_CARRITO_ABANDONADO_DIAS`), con su propia línea de log.
 */
import "dotenv/config";
import { domainEventBus, listenersRegistrados } from "@/lib/events/domain-event-bus";
import { esperarAnulacionesPendientes } from "@/lib/events/listeners/anulacion-orden.listener";
import { ejecutarMantenimientoProgramado } from "@/lib/services/ecommerce/mantenimiento-programado";
import { prisma } from "@/lib/db/prisma";

const modoWatch = process.argv.includes("--watch");
const intervaloSeg = Number(process.env.JOB_RESERVAS_INTERVALO_SEG ?? 60);

/** Los listeners se registran por import dinámico: se espera a que estén
 * suscriptos antes de liberar, para no perder el asiento RESERVA_LIBERADA ni
 * la anulación automática de la orden web (HU-E7, D3). */
async function esperarListenerAuditoria(): Promise<void> {
  await listenersRegistrados;
  if (domainEventBus.listenerCount("stock:reserva_liberada") > 0) return;
  console.warn("[job:reservas] El listener de auditoría no quedó registrado: los eventos no se auditarán.");
}

async function pasada(): Promise<void> {
  const { reservas, cupones, carritos } = await ejecutarMantenimientoProgramado(new Date());
  const ahora = new Date().toISOString();
  if (reservas.ok) {
    const resultado = reservas.valor;
    if (resultado.total_liberadas === 0) {
      console.log(`[job:reservas] ${ahora} — sin reservas vencidas.`);
    } else {
      console.log(
        `[job:reservas] ${ahora} — ${resultado.total_liberadas} reserva(s) liberada(s): ` +
          resultado.liberadas.map((r) => r.reserva_id).join(", "),
      );
    }
  }
  if (cupones.ok) {
    console.log(
      `[job:reservas] ${ahora} — cupones: ${cupones.valor.aplicaciones_liberadas.length} aplicación(es) liberada(s), ` +
        `${cupones.valor.cupones_dados_de_baja.length} cupón(es) dado(s) de baja.`,
    );
  }
  if (carritos.ok) {
    console.log(
      `[job:reservas] ${ahora} — carritos abandonados: ${carritos.valor.total_desactivados} carrito(s) dado(s) de baja.`,
    );
  }
  // Los errores ya los logueó `ejecutarMantenimientoProgramado()`.
  if (!reservas.ok || !cupones.ok || !carritos.ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  await esperarListenerAuditoria();
  await pasada();
  if (!modoWatch) {
    // HU-E7: las anulaciones automáticas por TTL corren en el listener (asíncrono).
    await esperarAnulacionesPendientes();
    // Deja drenar la cola serializada del ledger (`registrarAuditLog`) antes de salir.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await prisma.$disconnect();
    return;
  }
  console.log(`[job:reservas] modo watch: cada ${intervaloSeg} s (Ctrl+C para cortar).`);
  setInterval(() => {
    pasada().catch((error: unknown) => console.error("[job:reservas] Error en la pasada:", error));
  }, intervaloSeg * 1000);
}

main().catch(async (error: unknown) => {
  console.error("[job:reservas] Error:", error);
  process.exitCode = 1;
  await prisma.$disconnect();
});
