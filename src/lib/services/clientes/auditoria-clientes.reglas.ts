import type { Prisma } from "@prisma/client";
import type { FiltrosAuditoriaClientesInput } from "../../schemas/auditoria-clientes.schema.ts";

export const ACCIONES_AUDITORIA_CLIENTES = ["CREATE", "UPDATE", "DELETE_LOGICO"] as const;

/** El alcance se fija antes del conteo y la paginación; no depende del navegador. */
export function construirFiltroAuditoriaClientes(
  filtros: FiltrosAuditoriaClientesInput,
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {
    tabla_afectada: "clientes",
    accion: { in: filtros.accion ? [filtros.accion] : [...ACCIONES_AUDITORIA_CLIENTES] },
  };
  if (filtros.cliente_id) where.registro_id = filtros.cliente_id;
  if (filtros.usuario_id) where.usuario_id = filtros.usuario_id;
  if (filtros.fecha_desde || filtros.fecha_hasta) {
    where.created_at = {
      ...(filtros.fecha_desde ? { gte: filtros.fecha_desde } : {}),
      ...(filtros.fecha_hasta ? {
        lte: new Date(Date.UTC(
          filtros.fecha_hasta.getUTCFullYear(),
          filtros.fecha_hasta.getUTCMonth(),
          filtros.fecha_hasta.getUTCDate(), 23, 59, 59, 999,
        )),
      } : {}),
    };
  }
  return where;
}
