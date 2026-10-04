/**
 * HU-E5 (criterio 5; docs/tasks/task_relos.md D4) — regla pura del corte de
 * carritos abandonados. Sin Prisma ni `server-only`: se prueba con `node --test`.
 *
 * Un carrito está abandonado si su última actividad (`carritos_web.updated_at`)
 * es ESTRICTAMENTE anterior al corte: sin actividad por MÁS del plazo
 * (spec E §2.1). Uno tocado justo en el corte todavía no lo está.
 */

const DIA_MS = 86_400_000;

export function calcularFechaCorteAbandono(ahora: Date, plazoDias: number): Date {
  if (!Number.isInteger(plazoDias) || plazoDias <= 0) {
    throw new RangeError(`El plazo de carrito abandonado debe ser un entero positivo de días (recibido: ${plazoDias})`);
  }
  if (Number.isNaN(ahora.getTime())) throw new RangeError("La fecha de referencia es inválida");
  return new Date(ahora.getTime() - plazoDias * DIA_MS);
}
