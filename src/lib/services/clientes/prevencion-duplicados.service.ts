import "server-only";
import type { PrismaClient } from "@prisma/client";
import { ServiceError } from "@/lib/errors/service-error";
import { nombresSimilares } from "./duplicados";

export interface DatosPrevencionAlta {
  dni: string;
  nombre?: string;
  telefono?: string;
  email?: string;
}

export interface CandidatoPreventivo {
  cliente_id: string;
  dni: string;
  nombre: string;
  is_active: boolean;
}

const normalizarTelefono = (valor: string) => valor.replace(/\D/g, "");

export function esPosibleCoincidencia(
  entrada: DatosPrevencionAlta,
  cliente: { nombre: string; telefono: string | null; email: string | null },
): boolean {
  const nombre = entrada.nombre?.trim();
  const telefono = normalizarTelefono(entrada.telefono ?? "");
  const email = entrada.email?.trim().toLowerCase();
  return Boolean(
    (nombre && nombresSimilares(nombre, cliente.nombre)) ||
    (telefono && telefono === normalizarTelefono(cliente.telefono ?? "")) ||
    (email && email === cliente.email?.trim().toLowerCase()),
  );
}

/** Consulta de solo lectura. Incluye DNI inactivo y nunca cambia clientes. */
export async function consultarPrevencionAlta(db: PrismaClient, entrada: DatosPrevencionAlta) {
  if (!/^\d{7,8}$/.test(entrada.dni)) {
    throw new ServiceError("VALIDATION_ERROR", "El DNI debe tener 7 u 8 dígitos");
  }
  const existente = await db.cliente.findUnique({
    where: { dni: entrada.dni }, select: { id: true, is_active: true },
  });
  if (existente) return { existente, posibles: [] as CandidatoPreventivo[] };

  if (!entrada.nombre?.trim() && !entrada.telefono?.trim() && !entrada.email?.trim()) {
    return { existente: null, posibles: [] as CandidatoPreventivo[] };
  }
  const clientes = await db.cliente.findMany({
    where: { dni: { not: entrada.dni } },
    select: { id: true, dni: true, nombre: true, telefono: true, email: true, is_active: true },
  });
  return {
    existente: null,
    posibles: clientes.filter((cliente) => esPosibleCoincidencia(entrada, cliente))
      .slice(0, 20).map(({ id, dni, nombre, is_active }) => ({ cliente_id: id, dni, nombre, is_active })),
  };
}
