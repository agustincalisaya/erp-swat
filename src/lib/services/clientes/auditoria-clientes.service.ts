/** HU-C10: lectura acotada de asientos de Cliente en el ledger central. */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import type { FiltrosAuditoriaClientesInput } from "@/lib/schemas/auditoria-clientes.schema";
import { ACCIONES_AUDITORIA_CLIENTES, construirFiltroAuditoriaClientes, construirFiltroNombreCliente, valoresVisiblesAuditoriaCliente } from "./auditoria-clientes.reglas";

export const PERMISO_LEER_AUDITORIA_CLIENTES = "clientes:leer_auditoria";

export type RegistroAuditoriaCliente = {
  id: string;
  cliente_id: string | null;
  cliente_nombre_actual: string | null;
  cliente_dni_actual: string | null;
  usuario_id: string | null;
  usuario_nombre: string | null;
  accion: (typeof ACCIONES_AUDITORIA_CLIENTES)[number];
  created_at: Date;
  valor_anterior?: unknown;
  valor_nuevo?: unknown;
};

export type ListadoAuditoriaClientes = {
  registros: RegistroAuditoriaCliente[];
  total: number;
  page: number;
  page_size: number;
  puede_ver_cambios: boolean;
};

export type ResponsableAuditoriaCliente = { id: string; nombre_completo: string };

async function exigirPermiso(usuarioId: string): Promise<void> {
  if (!await usuarioTienePermiso(usuarioId, PERMISO_LEER_AUDITORIA_CLIENTES)) {
    throw new ServiceError("FORBIDDEN", "No tenés permiso para consultar la auditoría de clientes");
  }
}

export async function listarAuditoriaClientes(
  filtros: FiltrosAuditoriaClientesInput,
  usuarioId: string,
): Promise<ListadoAuditoriaClientes> {
  await exigirPermiso(usuarioId);
  const asignacionAuditor = await prisma.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId,
      is_active: true,
      deleted_at: null,
      rol: { nombre: "AUDITOR", is_active: true, deleted_at: null },
    },
    select: { id: true },
  });
  const puedeVerCambios = asignacionAuditor !== null;
  const clientesCoincidentes = filtros.cliente_nombre
    ? await prisma.cliente.findMany({
      where: construirFiltroNombreCliente(filtros.cliente_nombre),
      select: { id: true },
    })
    : [];
  const where = construirFiltroAuditoriaClientes(filtros, clientesCoincidentes.map((cliente) => cliente.id));
  const [filas, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
      include: { usuario: { select: { nombre_completo: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const ids = [...new Set(filas.map((fila) => fila.registro_id).filter((id): id is string => !!id))];
  // La ficha actual es una ayuda de lectura, nunca un valor histórico del asiento.
  const clientes = ids.length ? await prisma.cliente.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, dni: true },
  }) : [];
  const clientePorId = new Map(clientes.map((cliente) => [cliente.id, cliente]));

  return {
    registros: filas.map((fila) => {
      const cliente = fila.registro_id ? clientePorId.get(fila.registro_id) : undefined;
      return {
        id: fila.id,
        cliente_id: fila.registro_id,
        cliente_nombre_actual: cliente?.nombre ?? null,
        cliente_dni_actual: cliente?.dni ?? null,
        usuario_id: fila.usuario_id,
        usuario_nombre: fila.usuario?.nombre_completo ?? null,
        accion: fila.accion as RegistroAuditoriaCliente["accion"],
        created_at: fila.created_at,
        ...valoresVisiblesAuditoriaCliente(puedeVerCambios, fila.valor_anterior, fila.valor_nuevo),
      };
    }),
    total,
    page: filtros.page,
    page_size: filtros.page_size,
    puede_ver_cambios: puedeVerCambios,
  };
}

/** Solo personas que aparecen como responsables de asientos del alcance HU-C10. */
export async function listarResponsablesAuditoriaClientes(usuarioId: string): Promise<ResponsableAuditoriaCliente[]> {
  await exigirPermiso(usuarioId);
  const filas = await prisma.auditLog.groupBy({
    where: construirFiltroAuditoriaClientes({ modulo: "clientes", page: 1, page_size: 25 }),
    by: ["usuario_id"],
  });
  const ids = filas.map((fila) => fila.usuario_id).filter((id): id is string => !!id);
  if (!ids.length) return [];
  return prisma.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre_completo: true },
    orderBy: { nombre_completo: "asc" },
  });
}
