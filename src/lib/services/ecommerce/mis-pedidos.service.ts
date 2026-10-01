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
  id: string;
  tipo: TipoComprobanteVenta;
  cae_simulado: string;
  es_simulado: boolean;
  fecha: string;
}

export interface PedidoWebDetalle extends Omit<PedidoWebResumen, "cantidad_items"> {
  items: {
    id: string;
    producto: string;
    sku: string;
    talle: string;
    color: string;
    cantidad: number;
    precio_unitario: number;
  }[];
  plazo_retiro_vencimiento: string | null;
  qr_data_url: string | null;
  qr_inconsistente: boolean;
  comprobante: ComprobanteWeb | null;
}

function comprobanteDto(comprobante: {
  id: string;
  tipo_comprobante: TipoComprobanteVenta;
  cae_simulado: string;
  es_simulado: boolean;
  created_at: Date;
}): ComprobanteWeb {
  return {
    id: comprobante.id,
    tipo: comprobante.tipo_comprobante,
    cae_simulado: comprobante.cae_simulado,
    es_simulado: comprobante.es_simulado,
    fecha: comprobante.created_at.toISOString(),
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

  // Mis pedidos es una consulta histórica explícita: incluye bajas lógicas propias, nunca pedidos de otro cliente.
  const where = { cliente_id: clienteId, canal: "WEB" as const, ecommerce: { isNot: null } };
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
    where: { id: pedidoId, cliente_id: clienteId, canal: "WEB", ecommerce: { isNot: null } },
    select: {
      id: true,
      numero_venta: true,
      created_at: true,
      total: true,
      ecommerce: { select: { estado_ecommerce: true, plazo_retiro_vencimiento: true, codigo_qr_retiro: true } },
      items: {
        orderBy: { created_at: "asc" },
        select: {
          id: true,
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
        select: { id: true, tipo_comprobante: true, cae_simulado: true, es_simulado: true, created_at: true },
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
      id: item.id,
      producto: item.variante_sku.producto_maestro.nombre,
      sku: item.variante_sku.sku,
      talle: item.variante_sku.talle,
      color: item.variante_sku.color,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario.toNumber(),
    })),
    plazo_retiro_vencimiento: plazo?.toISOString() ?? null,
    qr_data_url: qr,
    qr_inconsistente: listo && !token,
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
      ecommerce: { isNot: null },
      comprobantes: { some: { id: comprobanteId } },
    },
    select: {
      comprobantes: {
        where: { id: comprobanteId },
        select: { id: true, tipo_comprobante: true, cae_simulado: true, es_simulado: true, created_at: true },
      },
    },
  });
  const comprobante = pedido?.comprobantes[0];
  if (!comprobante) {
    throw new ServiceError("COMPROBANTE_NO_ENCONTRADO", "El comprobante solicitado no existe");
  }
  return comprobanteDto(comprobante);
}
