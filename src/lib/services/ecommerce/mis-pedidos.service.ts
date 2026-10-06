import "server-only";

import type { EstadoEcommerce, PrismaClient, TipoComprobanteVenta } from "@prisma/client";
import QRCode from "qrcode";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

type OpcionesConsulta = { db?: Pick<PrismaClient, "pedidoVenta">; ahora?: Date };
type OpcionesListado = OpcionesConsulta & { pagina?: number; porPagina?: number };

export interface PedidoWebResumen {
  id: string;
  numero: string;
  fecha: string;
  total: number;
  estado: EstadoEcommerce;
  cantidad_items: number;
}

export interface ComprobanteWeb {
  tipo: TipoComprobanteVenta;
  fecha_emision: string;
  monto: number;
}

export interface PedidoWebDetalle extends Omit<PedidoWebResumen, "cantidad_items"> {
  items: {
    producto: string;
    sku: string;
    talle: string;
    color: string;
    cantidad: number;
    precio_unitario: number;
  }[];
  plazo_retiro_vencimiento: string | null;
  qr_data_url: string | null;
  comprobante: ComprobanteWeb | null;
}

function comprobanteDto(comprobante: {
  tipo_comprobante: TipoComprobanteVenta;
  monto_total: { toNumber(): number };
  created_at: Date;
}): ComprobanteWeb {
  return {
    tipo: comprobante.tipo_comprobante,
    fecha_emision: comprobante.created_at.toISOString(),
    monto: comprobante.monto_total.toNumber(),
  };
}

export async function listarPedidosWebCliente(
  clienteId: string,
  { db = prisma, pagina = 1, porPagina = 20 }: OpcionesListado = {},
): Promise<{ pedidos: PedidoWebResumen[]; total: number; pagina: number; por_pagina: number }> {
  if (!Number.isSafeInteger(pagina) || pagina < 1 || !Number.isSafeInteger(porPagina) || porPagina < 1 || porPagina > 50) {
    throw new ServiceError("PAGINACION_INVALIDA", "Paginación inválida");
  }
  if (!Number.isSafeInteger((pagina - 1) * porPagina)) {
    throw new ServiceError("PAGINACION_INVALIDA", "Paginación inválida");
  }

  const where = {
    cliente_id: clienteId,
    canal: "WEB" as const,
    is_active: true,
    deleted_at: null,
    ecommerce: { is: { is_active: true, deleted_at: null } },
  };
  const [pedidos, total] = await Promise.all([
    db.pedidoVenta.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      select: {
        id: true,
        numero_venta: true,
        created_at: true,
        total: true,
        ecommerce: { select: { estado_ecommerce: true } },
        _count: { select: { items: true } },
      },
    }),
    db.pedidoVenta.count({ where }),
  ]);
  return {
    pedidos: pedidos.map((pedido) => ({
      id: pedido.id,
      numero: pedido.numero_venta,
      fecha: pedido.created_at.toISOString(),
      total: pedido.total.toNumber(),
      estado: pedido.ecommerce!.estado_ecommerce,
      cantidad_items: pedido._count.items,
    })),
    total,
    pagina,
    por_pagina: porPagina,
  };
}

export async function obtenerPedidoWebCliente(
  clienteId: string,
  pedidoId: string,
  { db = prisma, ahora = new Date() }: OpcionesConsulta = {},
): Promise<PedidoWebDetalle> {
  const pedido = await db.pedidoVenta.findFirst({
    where: {
      id: pedidoId,
      cliente_id: clienteId,
      canal: "WEB",
      is_active: true,
      deleted_at: null,
      ecommerce: { is: { is_active: true, deleted_at: null } },
    },
    select: {
      id: true,
      numero_venta: true,
      created_at: true,
      total: true,
      ecommerce: { select: { estado_ecommerce: true, plazo_retiro_vencimiento: true, codigo_qr_retiro: true } },
      items: {
        orderBy: { created_at: "asc" },
        select: {
          cantidad: true,
          precio_unitario: true,
          variante_sku: {
            select: {
              sku: true,
              talle: true,
              color: true,
              producto_maestro: { select: { nombre: true } },
            },
          },
        },
      },
      comprobantes: {
        orderBy: { created_at: "desc" },
        take: 1,
        select: { tipo_comprobante: true, monto_total: true, created_at: true },
      },
    },
  });
  if (!pedido?.ecommerce) {
    throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido solicitado no existe");
  }

  const { estado_ecommerce: estado, plazo_retiro_vencimiento: plazo, codigo_qr_retiro: token } = pedido.ecommerce;
  const listo = estado === "LISTO_PARA_RETIRO" && (!plazo || plazo >= ahora);
  const qr = listo && token ? await QRCode.toDataURL(token, { errorCorrectionLevel: "M" }) : null;
  return {
    id: pedido.id,
    numero: pedido.numero_venta,
    fecha: pedido.created_at.toISOString(),
    total: pedido.total.toNumber(),
    estado,
    items: pedido.items.map((item) => ({
      producto: item.variante_sku.producto_maestro.nombre,
      sku: item.variante_sku.sku,
      talle: item.variante_sku.talle,
      color: item.variante_sku.color,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario.toNumber(),
    })),
    plazo_retiro_vencimiento: plazo?.toISOString() ?? null,
    qr_data_url: qr,
    comprobante: pedido.comprobantes[0] ? comprobanteDto(pedido.comprobantes[0]) : null,
  };
}

export async function obtenerComprobanteWebCliente(
  clienteId: string,
  pedidoId: string,
  comprobanteId: string,
  { db = prisma }: OpcionesConsulta = {},
): Promise<ComprobanteWeb> {
  const pedido = await db.pedidoVenta.findFirst({
    where: {
      id: pedidoId,
      cliente_id: clienteId,
      canal: "WEB",
      is_active: true,
      deleted_at: null,
      ecommerce: { is: { is_active: true, deleted_at: null } },
      comprobantes: { some: { id: comprobanteId } },
    },
    select: {
      comprobantes: {
        where: { id: comprobanteId },
        select: { tipo_comprobante: true, monto_total: true, created_at: true },
      },
    },
  });
  const comprobante = pedido?.comprobantes[0];
  if (!comprobante) {
    throw new ServiceError("COMPROBANTE_NO_ENCONTRADO", "El comprobante solicitado no existe");
  }
  return comprobanteDto(comprobante);
}
