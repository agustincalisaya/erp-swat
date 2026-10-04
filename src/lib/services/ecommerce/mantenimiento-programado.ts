/**
 * HU-E4 (Gate 3, A1) — Pasada de mantenimiento que comparten el cron
 * `POST /api/cron/check-pruebas-vencidas` y el script `npm run job:reservas`.
 *
 * Corre primero la liberación de reservas vencidas de Módulo A (sin cambios) y
 * después, de forma independiente, el mantenimiento de cupones de E4: si una
 * falla, la otra corre igual y el error se loguea. Las tareas se inyectan para
 * poder probar ese aislamiento.
 */
import "server-only";

import { ejecutarMantenimientoCupones, type ResultadoMantenimientoCupones } from "@/lib/services/ecommerce/cupon.service";
import { liberarReservasVencidas, type LiberacionTtlResultado } from "@/lib/services/inventario/reserva.service";

export type ResultadoTarea<T> = { ok: true; valor: T } | { ok: false; error: unknown };

export interface TareasMantenimiento {
  liberarReservasVencidas: (ahora: Date) => Promise<LiberacionTtlResultado>;
  ejecutarMantenimientoCupones: () => Promise<ResultadoMantenimientoCupones>;
}

export interface ResultadoMantenimientoProgramado {
  reservas: ResultadoTarea<LiberacionTtlResultado>;
  cupones: ResultadoTarea<ResultadoMantenimientoCupones>;
}

const TAREAS: TareasMantenimiento = { liberarReservasVencidas, ejecutarMantenimientoCupones };

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
  return { reservas, cupones };
}
