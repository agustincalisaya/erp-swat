import "server-only";

import type { EstadoEcommerce, EstadoReintegroPedidoWeb, Prisma, PrismaClient, TipoComprobanteVenta } from "@prisma/client";
import QRCode from "qrcode";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

type OpcionesConsulta = { db?: Pick<PrismaClient, "pedidoVenta">; ahora?: Date };
type OpcionesListado = OpcionesConsulta & { pagina?: number; porPagina?: number };

const VISIBILIDAD_EXTENSION_E9 = {
  OR: [
    { is_active: true, deleted_at: null },
    {
      is_active: false,
      deleted_at: { not: null },
      estado_ecommerce: { in: ["CANCELADO", "VENCIDO_SIN_RETIRO"] },
    },
  ],
} satisfies Prisma.PedidoVentaEcommerceWhereInput;

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
  /** Comprobante fiscal original; una Nota de Crédito nunca lo reemplaza (SPEC §2.13.16.3). */
  comprobante: ComprobanteWeb | null;
  /** NC HU-E13 vinculada al original, o `null`. */
  nota_credito: ComprobanteWeb | null;
  /** `deletion_reason` y `deleted_at` de la extensión, solo en terminales HU-E13 (SPEC §2.13.16.2). */
  motivo: string | null;
  fecha_terminacion: string | null;
  /** Estado agregado de `ReintegroPedidoWeb`; `null` sin saga. */
  reintegro_estado: EstadoReintegroPedidoWeb | null;
}

const ESTADOS_TERMINALES_HU_E13: readonly EstadoEcommerce[] = ["CANCELADO", "VENCIDO_SIN_RETIRO"];

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
    ecommerce: { is: VISIBILIDAD_EXTENSION_E9 },
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
      ecommerce: { is: VISIBILIDAD_EXTENSION_E9 },
    },
    select: {
      id: true,
      numero_venta: true,
      created_at: true,
      total: true,
      ecommerce: {
        select: {
          estado_ecommerce: true,
          plazo_retiro_vencimiento: true,
          codigo_qr_retiro: true,
          deleted_at: true,
          deletion_reason: true,
        },
      },
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
      // Mismo criterio de original que la saga (T07): el único comprobante
      // no-NC del pedido. `take: 2` detecta ambigüedad sin depender del orden.
      comprobantes: {
        where: { tipo_comprobante: { not: "NOTA_CREDITO" } },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        take: 2,
        select: { id: true, tipo_comprobante: true, monto_total: true, created_at: true },
      },
      // La NC HU-E13 sale del vínculo único de la saga, nunca de "cualquier NC
      // del pedido": un original admite otras NC ajenas a HU-E13 (§2.13.5).
      reintegro_web: {
        select: {
          estado: true,
          nota_credito: {
            select: {
              pedido_venta_id: true,
              comprobante_original_id: true,
              tipo_comprobante: true,
              monto_total: true,
              created_at: true,
            },
          },
        },
      },
    },
  });
  if (!pedido?.ecommerce) {
    throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido solicitado no existe");
  }

  const { estado_ecommerce: estado, plazo_retiro_vencimiento: plazo, codigo_qr_retiro: token } = pedido.ecommerce;
  const listo = estado === "LISTO_PARA_RETIRO" && (!plazo || plazo >= ahora);
  const qr = listo && token ? await QRCode.toDataURL(token, { errorCorrectionLevel: "M" }) : null;
  const terminal = ESTADOS_TERMINALES_HU_E13.includes(estado);
  const originales = pedido.comprobantes.filter((comprobante) => comprobante.tipo_comprobante !== "NOTA_CREDITO");
  const original = originales.length === 1 ? originales[0]! : null;
  const nc = pedido.reintegro_web?.nota_credito ?? null;
  const notaCredito = original && nc &&
    nc.tipo_comprobante === "NOTA_CREDITO" &&
    nc.pedido_venta_id === pedido.id &&
    nc.comprobante_original_id === original.id
    ? nc
    : null;
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
    comprobante: original ? comprobanteDto(original) : null,
    nota_credito: notaCredito ? comprobanteDto(notaCredito) : null,
    motivo: terminal ? pedido.ecommerce.deletion_reason ?? null : null,
    fecha_terminacion: terminal ? pedido.ecommerce.deleted_at?.toISOString() ?? null : null,
    reintegro_estado: pedido.reintegro_web?.estado ?? null,
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
      ecommerce: { is: VISIBILIDAD_EXTENSION_E9 },
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
