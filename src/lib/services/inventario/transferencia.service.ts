import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { CrearTransferenciaInput } from "@/lib/schemas/inventario.schema";
import type { FiltrosHistorialTransferenciasInput } from "@/lib/schemas/inventario.schema";

export interface TransferenciaCreada {
  transferencia_id: string;
  remito_id: string;
  estado: "EN_TRANSITO";
  cantidad: number;
  deposito_origen_id: string;
  deposito_destino_id: string;
}

export interface VarianteTransferible {
  id: string;
  sku: string;
  nombre: string;
  detalle: string;
}

export interface TransferenciaListado {
  id: string;
  numero_remito: string;
  sku: string;
  producto_nombre: string;
  deposito_origen: string;
  deposito_destino: string;
  cantidad: number;
  estado: "EN_TRANSITO" | "RECIBIDA";
  despachada_at: string;
  recibida_at: string | null;
}

export interface HistorialTransferenciasListado {
  registros: TransferenciaListado[];
  total: number;
  page: number;
  page_size: number;
}

const TRANSFERENCIA_LISTADO_SELECT = {
  id: true,
  numero_remito: true,
  cantidad: true,
  estado: true,
  despachada_at: true,
  recibida_at: true,
  variante_sku: { select: { sku: true, producto_maestro: { select: { nombre: true } } } },
  deposito_origen: { select: { nombre: true } },
  deposito_destino: { select: { nombre: true } },
} satisfies Prisma.TransferenciaStockSelect;

type TransferenciaListadoDb = Prisma.TransferenciaStockGetPayload<{ select: typeof TRANSFERENCIA_LISTADO_SELECT }>;

function mapearTransferencia(transferencia: TransferenciaListadoDb): TransferenciaListado {
  return {
    id: transferencia.id,
    numero_remito: transferencia.numero_remito,
    sku: transferencia.variante_sku.sku,
    producto_nombre: transferencia.variante_sku.producto_maestro.nombre,
    deposito_origen: transferencia.deposito_origen.nombre,
    deposito_destino: transferencia.deposito_destino.nombre,
    cantidad: transferencia.cantidad,
    estado: transferencia.estado,
    despachada_at: transferencia.despachada_at.toISOString(),
    recibida_at: transferencia.recibida_at?.toISOString() ?? null,
  };
}

export async function listarVariantesTransferibles(): Promise<VarianteTransferible[]> {
  const variantes = await prisma.varianteSKU.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      producto_maestro: { is_active: true, deleted_at: null },
    },
    select: {
      id: true,
      sku: true,
      talle: true,
      color: true,
      producto_maestro: { select: { nombre: true } },
    },
    orderBy: { sku: "asc" },
  });
  return variantes.map((variante) => ({
    id: variante.id,
    sku: variante.sku,
    nombre: variante.producto_maestro.nombre,
    detalle: `${variante.talle} · ${variante.color}`,
  }));
}

export async function listarTransferenciasPendientes(): Promise<TransferenciaListado[]> {
  const transferencias = await prisma.transferenciaStock.findMany({
    where: { estado: "EN_TRANSITO", is_active: true, deleted_at: null },
    select: TRANSFERENCIA_LISTADO_SELECT,
    orderBy: [{ despachada_at: "desc" }, { id: "desc" }],
  });
  return transferencias.map(mapearTransferencia);
}

const HISTORIAL_PAGE_SIZE = 10;

function inicioDiaArgentina(fecha: string): Date {
  return new Date(`${fecha}T00:00:00-03:00`);
}

export async function listarTransferenciasRecibidas(
  filtros: FiltrosHistorialTransferenciasInput,
): Promise<HistorialTransferenciasListado> {
  const where: Prisma.TransferenciaStockWhereInput = {
    estado: "RECIBIDA",
    is_active: true,
    deleted_at: null,
  };

  if (filtros.remito) {
    where.numero_remito = { contains: filtros.remito, mode: "insensitive" };
  }
  if (filtros.desde || filtros.hasta) {
    const hastaExclusivo = filtros.hasta ? inicioDiaArgentina(filtros.hasta) : null;
    if (hastaExclusivo) hastaExclusivo.setUTCDate(hastaExclusivo.getUTCDate() + 1);
    where.recibida_at = {
      ...(filtros.desde ? { gte: inicioDiaArgentina(filtros.desde) } : {}),
      ...(hastaExclusivo ? { lt: hastaExclusivo } : {}),
    };
  }

  const [registros, total] = await Promise.all([
    prisma.transferenciaStock.findMany({
      where,
      select: TRANSFERENCIA_LISTADO_SELECT,
      orderBy: [{ recibida_at: "desc" }, { id: "desc" }],
      skip: (filtros.page - 1) * HISTORIAL_PAGE_SIZE,
      take: HISTORIAL_PAGE_SIZE,
    }),
    prisma.transferenciaStock.count({ where }),
  ]);

  return {
    registros: registros.map(mapearTransferencia),
    total,
    page: filtros.page,
    page_size: HISTORIAL_PAGE_SIZE,
  };
}

export async function crearTransferencia(
  input: CrearTransferenciaInput,
  usuarioId: string,
): Promise<TransferenciaCreada> {
  const transferenciaId = randomUUID();
  const numeroRemito = `TR-${transferenciaId}`;

  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const [variante, origen, destino] = await Promise.all([
      tx.varianteSKU.findFirst({
        where: { id: input.variante_sku_id, is_active: true, deleted_at: null },
        select: { id: true },
      }),
      tx.deposito.findFirst({
        where: { id: input.deposito_origen_id, is_active: true, deleted_at: null },
        select: { id: true },
      }),
      tx.deposito.findFirst({
        where: { id: input.deposito_destino_id, is_active: true, deleted_at: null },
        select: { id: true },
      }),
    ]);

    if (!variante) throw new ServiceError("VARIANTE_NO_ENCONTRADA", "La variante no existe o está inactiva");
    if (!origen) throw new ServiceError("DEPOSITO_ORIGEN_NO_ENCONTRADO", "El depósito origen no existe o está inactivo");
    if (!destino) throw new ServiceError("DEPOSITO_DESTINO_NO_ENCONTRADO", "El depósito destino no existe o está inactivo");

    const decremento = await tx.stockDeposito.updateMany({
      where: {
        variante_sku_id: input.variante_sku_id,
        deposito_id: input.deposito_origen_id,
        is_active: true,
        deleted_at: null,
        cantidad: { gte: input.cantidad },
      },
      data: { cantidad: { decrement: input.cantidad } },
    });
    if (decremento.count === 0) {
      throw new ServiceError("STOCK_INSUFICIENTE", "Stock disponible insuficiente en el depósito origen");
    }

    const transferencia = await tx.transferenciaStock.create({
      data: {
        id: transferenciaId,
        numero_remito: numeroRemito,
        variante_sku_id: input.variante_sku_id,
        deposito_origen_id: input.deposito_origen_id,
        deposito_destino_id: input.deposito_destino_id,
        cantidad: input.cantidad,
        despachada_por_id: usuarioId,
      },
    });
    const movimiento = await tx.movimientoStock.create({
      data: {
        variante_sku_id: input.variante_sku_id,
        deposito_origen_id: input.deposito_origen_id,
        deposito_destino_id: input.deposito_destino_id,
        tipo_movimiento: "TRANSFERENCIA",
        estado_origen: "DISPONIBLE",
        estado_destino: "EN_TRANSITO",
        cantidad: input.cantidad,
        comprobante_referencia: numeroRemito,
        registrado_por_id: usuarioId,
      },
    });
    return { transferencia, movimiento_id: movimiento.id };
  });

  domainEventBus.emit("stock:transferencia_iniciada", {
    transferencia_id: resultado.transferencia.id,
    remito_id: resultado.transferencia.numero_remito,
    movimiento_id: resultado.movimiento_id,
    variante_sku_id: input.variante_sku_id,
    deposito_origen_id: input.deposito_origen_id,
    deposito_destino_id: input.deposito_destino_id,
    cantidad: input.cantidad,
    usuario_id: usuarioId,
  });
  return {
    transferencia_id: resultado.transferencia.id,
    remito_id: resultado.transferencia.numero_remito,
    estado: "EN_TRANSITO",
    cantidad: input.cantidad,
    deposito_origen_id: input.deposito_origen_id,
    deposito_destino_id: input.deposito_destino_id,
  };
}

export async function confirmarRecepcionTransferencia(transferenciaId: string, usuarioId: string) {
  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const transferencia = await tx.transferenciaStock.findFirst({
      where: { id: transferenciaId },
    });
    if (!transferencia) throw new ServiceError("TRANSFERENCIA_NO_ENCONTRADA");
    if (!transferencia.is_active || transferencia.deleted_at) throw new ServiceError("TRANSFERENCIA_INACTIVA");

    const [variante, origen, destino, stockDestino] = await Promise.all([
      tx.varianteSKU.findFirst({ where: { id: transferencia.variante_sku_id, is_active: true, deleted_at: null }, select: { id: true } }),
      tx.deposito.findFirst({ where: { id: transferencia.deposito_origen_id, is_active: true, deleted_at: null }, select: { id: true } }),
      tx.deposito.findFirst({ where: { id: transferencia.deposito_destino_id, is_active: true, deleted_at: null }, select: { id: true } }),
      tx.stockDeposito.findUnique({
        where: { variante_sku_id_deposito_id: { variante_sku_id: transferencia.variante_sku_id, deposito_id: transferencia.deposito_destino_id } },
        select: { id: true, is_active: true, deleted_at: true },
      }),
    ]);
    if (!variante) throw new ServiceError("VARIANTE_NO_ENCONTRADA", "La variante ya no está activa");
    if (!origen) throw new ServiceError("DEPOSITO_ORIGEN_NO_ENCONTRADO", "El depósito origen ya no está activo");
    if (!destino) throw new ServiceError("DEPOSITO_DESTINO_NO_ENCONTRADO", "El depósito destino ya no está activo");
    if (stockDestino && (!stockDestino.is_active || stockDestino.deleted_at)) {
      throw new ServiceError("STOCK_DESTINO_INACTIVO", "El registro de stock destino está inactivo y requiere reactivación explícita");
    }

    const recibidaAt = new Date();
    const cambio = await tx.transferenciaStock.updateMany({
      where: { id: transferenciaId, estado: "EN_TRANSITO", is_active: true, deleted_at: null },
      data: { estado: "RECIBIDA", recibida_por_id: usuarioId, recibida_at: recibidaAt },
    });
    if (cambio.count === 0) throw new ServiceError("TRANSFERENCIA_YA_RECIBIDA", "La transferencia ya fue recibida");

    if (stockDestino) {
      await tx.stockDeposito.update({
        where: { id: stockDestino.id },
        data: { cantidad: { increment: transferencia.cantidad } },
      });
    } else {
      await tx.stockDeposito.create({ data: {
        variante_sku_id: transferencia.variante_sku_id,
        deposito_id: transferencia.deposito_destino_id,
        cantidad: transferencia.cantidad,
      } });
    }
    const movimiento = await tx.movimientoStock.create({
      data: {
        variante_sku_id: transferencia.variante_sku_id,
        deposito_origen_id: transferencia.deposito_origen_id,
        deposito_destino_id: transferencia.deposito_destino_id,
        tipo_movimiento: "TRANSFERENCIA",
        estado_origen: "EN_TRANSITO",
        estado_destino: "DISPONIBLE",
        cantidad: transferencia.cantidad,
        comprobante_referencia: transferencia.numero_remito,
        registrado_por_id: usuarioId,
      },
    });
    return { transferencia, recibida_at: recibidaAt, movimiento_id: movimiento.id };
  });

  domainEventBus.emit("stock:transferencia_recibida", {
    transferencia_id: resultado.transferencia.id,
    remito_id: resultado.transferencia.numero_remito,
    movimiento_id: resultado.movimiento_id,
    variante_sku_id: resultado.transferencia.variante_sku_id,
    deposito_origen_id: resultado.transferencia.deposito_origen_id,
    deposito_destino_id: resultado.transferencia.deposito_destino_id,
    cantidad: resultado.transferencia.cantidad,
    usuario_id: usuarioId,
    recibida_at: resultado.recibida_at.toISOString(),
  });
  return { transferencia_id: transferenciaId, estado: "RECIBIDA" as const, recibida_at: resultado.recibida_at.toISOString() };
}

export async function darDeBajaTransferencia(transferenciaId: string, usuarioId: string, motivo: string) {
  const deletedAt = new Date();
  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const transferencia = await tx.transferenciaStock.findFirst({ where: { id: transferenciaId } });
    if (!transferencia) throw new ServiceError("TRANSFERENCIA_NO_ENCONTRADA");
    if (!transferencia.is_active || transferencia.deleted_at) throw new ServiceError("TRANSFERENCIA_INACTIVA");
    if (transferencia.estado === "EN_TRANSITO") {
      throw new ServiceError("TRANSFERENCIA_EN_TRANSITO", "No puede darse de baja un remito con mercadería en tránsito");
    }
    const cambio = await tx.transferenciaStock.updateMany({
      where: { id: transferenciaId, estado: "RECIBIDA", is_active: true, deleted_at: null },
      data: { is_active: false, deleted_at: deletedAt, deleted_by: usuarioId, deletion_reason: motivo },
    });
    if (cambio.count === 0) throw new ServiceError("TRANSFERENCIA_INACTIVA");
    return { id: transferenciaId, is_active: false as const, deleted_at: deletedAt };
  });

  domainEventBus.emit("stock:transferencia_baja_logica", {
    transferencia_id: transferenciaId,
    usuario_id: usuarioId,
    deletion_reason: motivo,
    deleted_at: deletedAt.toISOString(),
  });
  return resultado;
}
