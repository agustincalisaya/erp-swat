/**
 * HU-E4 (Gate 3, A1) — Pasada de mantenimiento que comparten el cron
 * `POST /api/cron/check-pruebas-vencidas` y el script `npm run job:reservas`.
 *
 * Corre primero la liberación de reservas vencidas de Módulo A (sin cambios) y
 * después, de forma independiente, el mantenimiento de cupones de E4: si una
 * falla, la otra corre igual y el error se loguea. Las tareas se inyectan para
 * poder probar ese aislamiento.
 *
 * HU-E5 (task_relos.md D10): tercera tarea, la baja lógica de carritos web
 * abandonados, con el mismo aislamiento respecto de las otras dos.
 */
import "server-only";

import {
  desactivarCarritosAbandonados,
  type ResultadoCarritosAbandonados,
} from "@/lib/services/ecommerce/carrito-abandonado.service";
import { ejecutarMantenimientoCupones, type ResultadoMantenimientoCupones } from "@/lib/services/ecommerce/cupon.service";
import {
  procesarRecordatoriosRetiroHuE13,
  procesarRetriesRefundHuE13,
  procesarVencimientosRetiroHuE13,
  type ResultadoRecordatoriosHuE13,
  type ResultadoRetriesHuE13,
  type ResultadoVencimientosHuE13,
} from "@/lib/services/ecommerce/mantenimiento-hu-e13.service";
import { liberarReservasVencidas, type LiberacionTtlResultado } from "@/lib/services/inventario/reserva.service";

export type ResultadoTarea<T> = { ok: true; valor: T } | { ok: false; error: unknown };

export interface TareasMantenimiento {
  liberarReservasVencidas: (ahora: Date) => Promise<LiberacionTtlResultado>;
  ejecutarMantenimientoCupones: () => Promise<ResultadoMantenimientoCupones>;
  desactivarCarritosAbandonados: (ahora: Date) => Promise<ResultadoCarritosAbandonados>;
  procesarRecordatoriosRetiroHuE13?: (ahora: Date) => Promise<ResultadoRecordatoriosHuE13>;
  procesarVencimientosRetiroHuE13?: (ahora: Date) => Promise<ResultadoVencimientosHuE13>;
  procesarRetriesRefundHuE13?: (ahora: Date) => Promise<ResultadoRetriesHuE13>;
}

export interface ResultadoMantenimientoProgramado {
  reservas: ResultadoTarea<LiberacionTtlResultado>;
  cupones: ResultadoTarea<ResultadoMantenimientoCupones>;
  carritos: ResultadoTarea<ResultadoCarritosAbandonados>;
  recordatorios_hu_e13: ResultadoTarea<ResultadoRecordatoriosHuE13>;
  vencimientos_hu_e13: ResultadoTarea<ResultadoVencimientosHuE13>;
  retries_hu_e13: ResultadoTarea<ResultadoRetriesHuE13>;
}

const TAREAS: TareasMantenimiento = {
  liberarReservasVencidas,
  ejecutarMantenimientoCupones,
  desactivarCarritosAbandonados,
  procesarRecordatoriosRetiroHuE13,
  procesarVencimientosRetiroHuE13,
  procesarRetriesRefundHuE13,
};

async function ejecutarAislada<T>(nombre: string, tarea: () => Promise<T>): Promise<ResultadoTarea<T>> {
  try {
    return { ok: true, valor: await tarea() };
  } catch (error) {
    console.error(`[mantenimiento] Error en ${nombre}:`, error);
    return { ok: false, error };
  }
}

export async function ejecutarMantenimientoProgramado(
  ahora: Date = new Date(),
  tareas: TareasMantenimiento = TAREAS,
): Promise<ResultadoMantenimientoProgramado> {
  const reservas = await ejecutarAislada("la liberación de reservas vencidas", () => tareas.liberarReservasVencidas(ahora));
  const cupones = await ejecutarAislada("el mantenimiento de cupones", () => tareas.ejecutarMantenimientoCupones());
  const carritos = await ejecutarAislada("la baja de carritos abandonados", () => tareas.desactivarCarritosAbandonados(ahora));
  const recordatoriosHuE13 = await ejecutarAislada("los recordatorios de retiro HU-E13", () =>
    tareas.procesarRecordatoriosRetiroHuE13?.(ahora) ?? Promise.resolve({ procesados: 0, recordatorios_emitidos: 0, errores: [] }));
  const vencimientosHuE13 = await ejecutarAislada("los vencimientos de retiro HU-E13", () =>
    tareas.procesarVencimientosRetiroHuE13?.(ahora) ?? Promise.resolve({ procesados: 0, vencidos: 0, refunds_iniciados: 0, errores: [] }));
  const retriesHuE13 = await ejecutarAislada("los retries de refund HU-E13", () =>
    tareas.procesarRetriesRefundHuE13?.(ahora) ?? Promise.resolve({ procesados: 0, refunds_reintentados: 0, errores: [] }));
  return {
    reservas,
    cupones,
    carritos,
    recordatorios_hu_e13: recordatoriosHuE13,
    vencimientos_hu_e13: vencimientosHuE13,
    retries_hu_e13: retriesHuE13,
  };
}
