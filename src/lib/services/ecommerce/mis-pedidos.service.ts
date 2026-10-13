import "server-only";

import type { EstadoEcommerce, EstadoReintegroPedidoWeb, Prisma, PrismaClient, TipoComprobanteVenta } from "@prisma/client";
import QRCode from "qrcode";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

type OpcionesConsulta = { db?: Pick<PrismaClient, "pedidoVenta" | "auditLog">; ahora?: Date };
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

// E7 desactiva la extensión al anular una orden impaga; el pedido base puede
// estar activo o dado de baja según el camino previo. Otras bajas se excluyen.
const VISIBILIDAD_PEDIDO_E9 = {
  OR: [
    { is_active: true, deleted_at: null, ecommerce: { is: VISIBILIDAD_EXTENSION_E9 } },
    {
      estado: "ANULADO",
      is_active: true,
      deleted_at: null,
      ecommerce: { is: {
        estado_ecommerce: "ANULADO",
        is_active: false,
        deleted_at: { not: null },
        deleted_by: { not: null },
        deletion_reason: { not: null },
      } },
    },
    {
      estado: "ANULADO",
      is_active: false,
      deleted_at: { not: null },
      deleted_by: { not: null },
      deletion_reason: { not: null },
      ecommerce: { is: {
        estado_ecommerce: "ANULADO",
        is_active: false,
        deleted_at: { not: null },
        deleted_by: { not: null },
        deletion_reason: { not: null },
      } },
    },
  ],
} satisfies Prisma.PedidoVentaWhereInput;

const ACCIONES_ESTADO = [
  "CREATE", "PAGO_CONFIRMADO", "PAGO_RECHAZADO", "PEDIDO_TOMADO",
  "PEDIDO_LISTO_PARA_RETIRO", "PEDIDO_ENTREGADO", "ecommerce:orden_anulada",
  "PEDIDO_PAGADO_CANCELADO", "PEDIDO_VENCIDO_SIN_RETIRO",
] as const;

const ESTADO_POR_ACCION: Record<(typeof ACCIONES_ESTADO)[number], EstadoEcommerce> = {
  CREATE: "PAGO_PENDIENTE",
  PAGO_CONFIRMADO: "PAGO_CONFIRMADO",
  PAGO_RECHAZADO: "PAGO_RECHAZADO",
  PEDIDO_TOMADO: "EN_PREPARACION",
  PEDIDO_LISTO_PARA_RETIRO: "LISTO_PARA_RETIRO",
  PEDIDO_ENTREGADO: "ENTREGADO",
  "ecommerce:orden_anulada": "ANULADO",
  PEDIDO_PAGADO_CANCELADO: "CANCELADO",
  PEDIDO_VENCIDO_SIN_RETIRO: "VENCIDO_SIN_RETIRO",
};

function campoTexto(valor: Prisma.JsonValue | null, campo: string): string | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const dato = valor[campo];
  return typeof dato === "string" ? dato : null;
}

async function obtenerHistorialEstados(
  db: Pick<PrismaClient, "auditLog">,
  pedidoId: string,
  extensionId: string,
): Promise<{ estado: EstadoEcommerce; fecha: string }[]> {
  const registros = await db.auditLog.findMany({
    where: {
      accion: { in: [...ACCIONES_ESTADO] },
      OR: [
        { tabla_afectada: "pedidos_venta_ecommerce", registro_id: extensionId,
          accion: { in: ["CREATE", "PAGO_CONFIRMADO", "PAGO_RECHAZADO", "PEDIDO_TOMADO", "PEDIDO_LISTO_PARA_RETIRO", "PEDIDO_ENTREGADO"] } },
        { tabla_afectada: "pedidos_venta", registro_id: pedidoId, accion: "ecommerce:orden_anulada" },
        { tabla_afectada: "pedidos_venta_ecommerce", accion: { in: ["PEDIDO_PAGADO_CANCELADO", "PEDIDO_VENCIDO_SIN_RETIRO"] },
          valor_nuevo: { path: ["pedido_venta_id"], equals: pedidoId } },
      ],
    },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    select: { accion: true, tabla_afectada: true, registro_id: true, created_at: true, valor_nuevo: true },
  });
  return registros.flatMap((registro) => {
    if (!Object.hasOwn(ESTADO_POR_ACCION, registro.accion) ||
      !(registro.created_at instanceof Date) || !Number.isFinite(registro.created_at.getTime())) return [];
    const accion = registro.accion as keyof typeof ESTADO_POR_ACCION;
    const estado = ESTADO_POR_ACCION[accion];
    const nuevo = campoTexto(registro.valor_nuevo, "estado_ecommerce");
    if (nuevo !== estado) return [];
    if (accion === "CREATE" && campoTexto(registro.valor_nuevo, "pedido_venta_id") !== pedidoId) return [];
    if (accion === "PEDIDO_PAGADO_CANCELADO" || accion === "PEDIDO_VENCIDO_SIN_RETIRO") {
      if (campoTexto(registro.valor_nuevo, "pedido_venta_id") !== pedidoId) return [];
    } else if (accion === "ecommerce:orden_anulada") {
      if (registro.tabla_afectada !== "pedidos_venta" || registro.registro_id !== pedidoId) return [];
    } else if (registro.tabla_afectada !== "pedidos_venta_ecommerce" || registro.registro_id !== extensionId) return [];
    return [{ estado, fecha: registro.created_at.toISOString() }];
  });
}

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

export interface ComprobanteWebDescargable {
  numero: string;
  tipo: TipoComprobanteVenta;
  fecha_emision: string;
  monto: number;
  cae_simulado: string;
  qr_data_url: string;
  es_simulado: boolean;
}

export interface PedidoWebDetalle extends Omit<PedidoWebResumen, "cantidad_items"> {
  historial_estados: { estado: EstadoEcommerce; fecha: string }[];
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
    ...VISIBILIDAD_PEDIDO_E9,
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
      ...VISIBILIDAD_PEDIDO_E9,
    },
    select: {
      id: true,
      numero_venta: true,
      created_at: true,
      total: true,
      ecommerce: {
        select: {
          id: true,
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

  const historialEstados = await obtenerHistorialEstados(db, pedido.id, pedido.ecommerce.id);

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
    historial_estados: historialEstados,
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

/** Resuelve el único comprobante original desde un pedido web visible del cliente. */
export async function obtenerComprobanteOriginalWebCliente(
  clienteId: string,
  pedidoId: string,
  { db = prisma }: OpcionesConsulta = {},
): Promise<ComprobanteWebDescargable> {
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
      numero_venta: true,
      comprobantes: {
        where: { tipo_comprobante: { not: "NOTA_CREDITO" } },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        take: 2,
        select: {
          tipo_comprobante: true,
          created_at: true,
          monto_total: true,
          cae_simulado: true,
          qr_data_url: true,
          es_simulado: true,
        },
      },
    },
  });
  // La ausencia, la falta de propiedad y un original ambiguo son indistinguibles.
  const originales = pedido?.comprobantes.filter((comprobante) => comprobante.tipo_comprobante !== "NOTA_CREDITO") ?? [];
  if (!pedido || originales.length !== 1) {
    throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido solicitado no existe");
  }
  const comprobante = originales[0]!;
  return {
    numero: pedido.numero_venta,
    tipo: comprobante.tipo_comprobante,
    fecha_emision: comprobante.created_at.toISOString(),
    monto: comprobante.monto_total.toNumber(),
    cae_simulado: comprobante.cae_simulado,
    qr_data_url: comprobante.qr_data_url,
    es_simulado: comprobante.es_simulado,
  };
}
