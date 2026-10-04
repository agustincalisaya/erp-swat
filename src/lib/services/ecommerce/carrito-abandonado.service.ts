/**
 * HU-E5 (criterio 5; docs/tasks/task_relos.md D4, D5, D10) — baja lógica de
 * carritos web sin actividad por más de `ECOMMERCE_CARRITO_ABANDONADO_DIAS`.
 *
 * - Nunca DELETE: `is_active = false`, `deleted_at = ahora`, `deleted_by = null`
 *   (actor del sistema), `deletion_reason = "ABANDONADO"`. Los ítems no se tocan.
 * - Carritos de cuenta y de visitante. El de cuenta libera el índice único
 *   parcial `carritos_web_cuenta_activa_key`: la cuenta puede armar uno nuevo.
 * - No es un evento de negocio auditable (spec E §2.1): sin evento ni asiento;
 *   el resultado lo informan el cron y el script.
 * - Lo corre el coordinador `mantenimiento-programado.ts` como tercera tarea.
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { calcularFechaCorteAbandono } from "@/lib/services/ecommerce/carrito-abandonado.reglas";
import { obtenerPlazoCarritoAbandonadoDias } from "@/lib/services/sistema/configuracion.service";

export const MOTIVO_CARRITO_ABANDONADO = "ABANDONADO";

export interface ResultadoCarritosAbandonados {
  total_desactivados: number;
  carrito_ids: string[];
}

/**
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CONFIGURACION_INVALIDA
 */
export async function desactivarCarritosAbandonados(ahora: Date): Promise<ResultadoCarritosAbandonados> {
  const corte = calcularFechaCorteAbandono(ahora, await obtenerPlazoCarritoAbandonadoDias());
  const vencidos = { is_active: true, deleted_at: null, updated_at: { lt: corte } } as const;

  return prisma.$transaction(async (tx) => {
    const candidatos = await tx.carritoWeb.findMany({ where: vencidos, select: { id: true } });
    if (candidatos.length === 0) return { total_desactivados: 0, carrito_ids: [] };

    const ids = candidatos.map((c) => c.id);
    // Se repite la condición: un carrito tocado entre la lectura y el UPDATE
    // (actividad nueva) no se da de baja.
    await tx.carritoWeb.updateMany({
      where: { id: { in: ids }, ...vencidos },
      data: { is_active: false, deleted_at: ahora, deleted_by: null, deletion_reason: MOTIVO_CARRITO_ABANDONADO },
    });
    const desactivados = await tx.carritoWeb.findMany({
      where: { id: { in: ids }, is_active: false, deleted_at: ahora, deletion_reason: MOTIVO_CARRITO_ABANDONADO },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return { total_desactivados: desactivados.length, carrito_ids: desactivados.map((c) => c.id) };
  });
}
