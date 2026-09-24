import type { Prisma } from "@prisma/client";
import type { FiltrosAuditoriaClientesInput } from "../../schemas/auditoria-clientes.schema.ts";

export const ACCIONES_AUDITORIA_CLIENTES = ["CREATE", "UPDATE", "DELETE_LOGICO"] as const;

/** Incluye clientes activos e inactivos para conservar la consulta histórica. */
export function construirFiltroNombreCliente(nombre: string): Prisma.ClienteWhereInput {
  return { nombre: { contains: nombre, mode: "insensitive" } };
}

/** El resumen de CRM no incluye las claves de detalle, tampoco en JSON. */
export function valoresVisiblesAuditoriaCliente(
  puedeVerCambios: boolean,
  valorAnterior: unknown,
  valorNuevo: unknown,
) {
  return puedeVerCambios
    ? { valor_anterior: valorAnterior, valor_nuevo: valorNuevo }
    : {};
}

/** El alcance se fija antes del conteo y la paginación; no depende del navegador. */
export function construirFiltroAuditoriaClientes(
  filtros: FiltrosAuditoriaClientesInput,
  clientesCoincidentes: string[] = [],
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {
    tabla_afectada: "clientes",
    accion: { in: filtros.accion ? [filtros.accion] : [...ACCIONES_AUDITORIA_CLIENTES] },
  };
  if (filtros.cliente_nombre) where.registro_id = { in: clientesCoincidentes };
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
