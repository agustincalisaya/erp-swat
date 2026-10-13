import "server-only";

import type { EstadoReintegroPedidoWeb, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

const ESTADOS_CANCELABLES = ["PAGO_CONFIRMADO", "EN_PREPARACION", "LISTO_PARA_RETIRO"] as const;
const ESTADOS_TERMINALES_HU_E13 = ["CANCELADO", "VENCIDO_SIN_RETIRO"] as const;

const FILTRO_PEDIDOS_PAGADOS = {
  pedido_venta: { is: { canal: "WEB", is_active: true, deleted_at: null } },
  OR: [
    {
      is_active: true,
      deleted_at: null,
      estado_ecommerce: { in: [...ESTADOS_CANCELABLES] },
    },
    {
      is_active: false,
      deleted_at: { not: null },
      estado_ecommerce: { in: [...ESTADOS_TERMINALES_HU_E13] },
    },
  ],
} satisfies Prisma.PedidoVentaEcommerceWhereInput;

export interface PedidoPagadoAdminFila {
  pedido_venta_id: string;
  numero: string;
  fecha: string;
  total: string;
  estado_ecommerce: (typeof ESTADOS_CANCELABLES)[number] | (typeof ESTADOS_TERMINALES_HU_E13)[number];
  plazo_retiro_vencimiento: string | null;
  reintegro: null | {
    estado: EstadoReintegroPedidoWeb;
    tiene_intento_pendiente: boolean;
  };
  acciones: {
    cancelar_pedido: boolean;
    reintentar_reintegro: boolean;
  };
}

export interface PedidosPagadosAdminPagina {
  items: PedidoPagadoAdminFila[];
  total: number;
  page: number;
  page_size: number;
}

export async function listarPedidosPagadosAdmin(
  opciones: { page?: number; page_size?: number; db?: Pick<PrismaClient, "pedidoVentaEcommerce"> } = {},
): Promise<PedidosPagadosAdminPagina> {
  const page = opciones.page ?? 1;
  const pageSize = opciones.page_size ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ServiceError("PAGINACION_INVALIDA", "Paginación inválida");
  }
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw new ServiceError("PAGINACION_INVALIDA", "Paginación inválida");
  const db = opciones.db ?? prisma;
  const [total, filas] = await Promise.all([
    db.pedidoVentaEcommerce.count({ where: FILTRO_PEDIDOS_PAGADOS }),
    db.pedidoVentaEcommerce.findMany({
      where: FILTRO_PEDIDOS_PAGADOS,
      orderBy: [{ created_at: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        estado_ecommerce: true,
        plazo_retiro_vencimiento: true,
        pedido_venta: { select: { id: true, numero_venta: true, created_at: true, total: true } },
        reintegro_pago: {
          select: {
            estado: true,
            intentos_refund: {
              where: { estado: "PENDIENTE" },
              take: 1,
              select: { estado: true },
            },
          },
        },
      },
    }),
  ]);
  return {
    items: filas.map((fila) => {
      const tieneIntentoPendiente = (fila.reintegro_pago?.intentos_refund.length ?? 0) > 0;
      const cancelarPedido = ESTADOS_CANCELABLES.includes(fila.estado_ecommerce as (typeof ESTADOS_CANCELABLES)[number]);
      return {
        pedido_venta_id: fila.pedido_venta.id,
        numero: fila.pedido_venta.numero_venta,
        fecha: fila.pedido_venta.created_at.toISOString(),
        total: fila.pedido_venta.total.toFixed(2),
        estado_ecommerce: fila.estado_ecommerce as PedidoPagadoAdminFila["estado_ecommerce"],
        plazo_retiro_vencimiento: fila.plazo_retiro_vencimiento?.toISOString() ?? null,
        reintegro: fila.reintegro_pago ? {
          estado: fila.reintegro_pago.estado,
          tiene_intento_pendiente: tieneIntentoPendiente,
        } : null,
        acciones: {
          cancelar_pedido: cancelarPedido,
          reintentar_reintegro: fila.reintegro_pago?.estado === "RECHAZADO" && !tieneIntentoPendiente,
        },
      };
    }),
    total,
    page,
    page_size: pageSize,
  };
}
