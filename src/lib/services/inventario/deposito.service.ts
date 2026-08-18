import "server-only";

import { prisma } from "@/lib/db/prisma";

export interface DepositoActivo {
  id: string;
  nombre: string;
  tipo: string;
}

/**
 * Lista los depósitos activos disponibles como destino de operaciones de
 * inventario (ingreso por escaneo, transferencias, etc.).
 */
export async function listarDepositosActivos(): Promise<DepositoActivo[]> {
  return prisma.deposito.findMany({
    where: { is_active: true, deleted_at: null },
    select: { id: true, nombre: true, tipo: true },
    orderBy: { nombre: "asc" },
  });
}
