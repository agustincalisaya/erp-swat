import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus, listenersRegistrados } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { CrearCategoriaGastoInput, EditarCategoriaGastoInput, DarDeBajaCategoriaGastoInput } from "@/lib/schemas/categoria-gasto.schema";
import type { CategoriaGastoDatos } from "@/lib/events/event-types";

export const PERMISO_GESTIONAR_CATEGORIAS_GASTO = "tesoreria:gestionar_categorias_gasto";
export const PERMISO_GESTIONAR_GASTOS = "tesoreria:gestionar_gastos";

const seleccion = {
  id: true, nombre: true, descripcion: true, is_active: true,
  deleted_at: true, deleted_by: true, deletion_reason: true,
  created_at: true, updated_at: true,
} as const;

export interface CategoriaGastoListado {
  id: string;
  nombre: string;
  descripcion: string | null;
  is_active: boolean;
  deleted_at: string | null;
  deletion_reason: string | null;
  updated_at: string;
}

export function normalizarNombre(nombre: string): string {
  return nombre.trim().toLowerCase();
}

function duplicada(): ServiceError {
  return new ServiceError("CATEGORIA_GASTO_DUPLICADA", "Ya existe una categoría con ese nombre");
}

export function esP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function datos(fila: { nombre: string; descripcion: string | null; is_active: boolean; deletion_reason: string | null }): CategoriaGastoDatos {
  return { nombre: fila.nombre, descripcion: fila.descripcion, is_active: fila.is_active, deletion_reason: fila.deletion_reason };
}

function serializar(fila: Prisma.CategoriaGastoGetPayload<{ select: typeof seleccion }>): CategoriaGastoListado {
  return {
    id: fila.id, nombre: fila.nombre, descripcion: fila.descripcion,
    is_active: fila.is_active, deleted_at: fila.deleted_at?.toISOString() ?? null,
    deletion_reason: fila.deletion_reason, updated_at: fila.updated_at.toISOString(),
  };
}

/** La vista administrativa puede incluir bajas; el selector G13 siempre recibe solo activas. */
export async function listarCategoriasGasto(incluirInactivas = false): Promise<CategoriaGastoListado[]> {
  const filas = await prisma.categoriaGasto.findMany({
    where: incluirInactivas ? {} : { is_active: true },
    orderBy: { nombre_normalizado: "asc" }, select: seleccion,
  });
  return filas.map(serializar);
}

export async function listarCategoriasActivasParaGasto(): Promise<Pick<CategoriaGastoListado, "id" | "nombre">[]> {
  return prisma.categoriaGasto.findMany({
    where: { is_active: true }, orderBy: { nombre_normalizado: "asc" },
    select: { id: true, nombre: true },
  });
}

export async function crearCategoriaGasto(input: CrearCategoriaGastoInput, usuarioId: string): Promise<CategoriaGastoListado> {
  const nombre = input.nombre.trim();
  const nombre_normalizado = normalizarNombre(nombre);
  if (await prisma.categoriaGasto.findUnique({ where: { nombre_normalizado }, select: { id: true } })) throw duplicada();
  let fila;
  try {
    fila = await prisma.categoriaGasto.create({
      data: { nombre, nombre_normalizado, descripcion: input.descripcion?.trim() || null }, select: seleccion,
    });
  } catch (error) {
    if (esP2002(error)) throw duplicada();
    throw error;
  }
  await listenersRegistrados;
  domainEventBus.emit("categoria_gasto:creada", {
    categoria_gasto_id: fila.id, usuario_id: usuarioId,
    valor_anterior: null, valor_nuevo: datos(fila),
  });
  return serializar(fila);
}

export async function editarCategoriaGasto(id: string, input: EditarCategoriaGastoInput, usuarioId: string): Promise<CategoriaGastoListado> {
  let resultado;
  try {
    resultado = await prisma.$transaction(async (tx) => {
      const actual = await tx.categoriaGasto.findUnique({ where: { id }, select: seleccion });
      if (!actual) throw new ServiceError("CATEGORIA_GASTO_NO_ENCONTRADA", "La categoría no existe");
      if (!actual.is_active) throw new ServiceError("CATEGORIA_GASTO_YA_DADA_DE_BAJA", "La categoría está dada de baja");
      const nombre = input.nombre === undefined ? actual.nombre : input.nombre.trim();
      const descripcion = input.descripcion === undefined ? actual.descripcion : input.descripcion.trim() || null;
      const nombre_normalizado = normalizarNombre(nombre);
      if (nombre === actual.nombre && descripcion === actual.descripcion) return { fila: actual, anterior: null };
      if (nombre_normalizado !== normalizarNombre(actual.nombre)) {
        const existente = await tx.categoriaGasto.findUnique({ where: { nombre_normalizado }, select: { id: true } });
        if (existente && existente.id !== id) throw duplicada();
      }
      const cambio = await tx.categoriaGasto.updateMany({
        where: { id, is_active: true }, data: { nombre, nombre_normalizado, descripcion },
      });
      if (!cambio.count) throw new ServiceError("CATEGORIA_GASTO_YA_DADA_DE_BAJA", "La categoría está dada de baja");
      const fila = await tx.categoriaGasto.findUniqueOrThrow({ where: { id }, select: seleccion });
      return { fila, anterior: datos(actual) };
    });
  } catch (error) {
    if (esP2002(error)) throw duplicada();
    throw error;
  }
  if (resultado.anterior) {
    await listenersRegistrados;
    domainEventBus.emit("categoria_gasto:editada", {
      categoria_gasto_id: id, usuario_id: usuarioId,
      valor_anterior: resultado.anterior, valor_nuevo: datos(resultado.fila),
    });
  }
  return serializar(resultado.fila);
}

export async function darDeBajaCategoriaGasto(id: string, input: DarDeBajaCategoriaGastoInput, usuarioId: string): Promise<CategoriaGastoListado> {
  const resultado = await prisma.$transaction(async (tx) => {
    const actual = await tx.categoriaGasto.findUnique({ where: { id }, select: seleccion });
    if (!actual) throw new ServiceError("CATEGORIA_GASTO_NO_ENCONTRADA", "La categoría no existe");
    if (!actual.is_active) throw new ServiceError("CATEGORIA_GASTO_YA_DADA_DE_BAJA", "La categoría ya fue dada de baja");
    const cambio = await tx.categoriaGasto.updateMany({
      where: { id, is_active: true },
      data: { is_active: false, deleted_at: new Date(), deleted_by: usuarioId, deletion_reason: input.deletion_reason.trim() },
    });
    if (!cambio.count) throw new ServiceError("CATEGORIA_GASTO_YA_DADA_DE_BAJA", "La categoría ya fue dada de baja");
    const fila = await tx.categoriaGasto.findUniqueOrThrow({ where: { id }, select: seleccion });
    return { fila, anterior: datos(actual) };
  });
  await listenersRegistrados;
  domainEventBus.emit("categoria_gasto:dada_de_baja", {
    categoria_gasto_id: id, usuario_id: usuarioId,
    valor_anterior: resultado.anterior, valor_nuevo: datos(resultado.fila),
  });
  return serializar(resultado.fila);
}
