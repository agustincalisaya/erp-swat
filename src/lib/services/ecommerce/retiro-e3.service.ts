import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap, MotivoRetiroRechazado } from "@/lib/events/event-types";
import type { ValidarRetiroInput } from "@/lib/schemas/retiro-e3.schema";
import { registrarEntregaTotalPedidoVentaTx } from "@/lib/services/ventas/pedido-venta.service";

/** Motivo interno: ningún valor aportado por el operador integra el error. */
export class RetiroRechazadoError extends Error {
  readonly motivo: MotivoRetiroRechazado;
  readonly pedido_venta_id?: string;
  readonly pedido_venta_ecommerce_id?: string;

  constructor(
    motivo: MotivoRetiroRechazado,
    ids?: { pedido_venta_id: string; pedido_venta_ecommerce_id: string },
  ) {
    super("No fue posible validar el retiro");
    this.name = "RetiroRechazadoError";
    this.motivo = motivo;
    this.pedido_venta_id = ids?.pedido_venta_id;
    this.pedido_venta_ecommerce_id = ids?.pedido_venta_ecommerce_id;
  }
}

export interface RetiroValidadoInterno {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
}

interface PedidoBloqueado {
  id: string;
  cliente_id: string | null;
  numero_venta: string;
  canal: string;
  estado: string;
  is_active: boolean;
  deleted_at: Date | null;
}

interface ExtensionBloqueada {
  id: string;
  pedido_venta_id: string;
  estado_ecommerce: string;
  codigo_qr_retiro: string | null;
  plazo_retiro_vencimiento: Date | null;
  is_active: boolean;
  deleted_at: Date | null;
}

interface ItemBloqueado {
  id: string;
  cantidad: number;
  cantidad_facturada: number;
  cantidad_entregada: number;
}

interface ClienteBloqueado {
  id: string;
  dni: string;
  is_active: boolean;
  deleted_at: Date | null;
}

/** Prelectura sin locks: obtiene solamente el ID necesario para bloquear primero la venta. */
export async function resolverPedidoVentaIdPorQr(
  db: Pick<Prisma.TransactionClient, "pedidoVentaEcommerce">,
  qr_token: string,
): Promise<string> {
  const extension = await db.pedidoVentaEcommerce.findUnique({
    where: { codigo_qr_retiro: qr_token },
    select: { pedido_venta_id: true },
  });
  if (!extension) throw new RetiroRechazadoError("TOKEN_NO_RESUELTO");
  return extension.pedido_venta_id;
}

/**
 * Núcleo T4. El llamador mantiene vivo el mismo tx y sus locks al continuar
 * con la entrega T5. No autoriza a actuar después de cerrar esta transacción.
 */
export async function validarRetiroBajoLocksTx(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
  input: ValidarRetiroInput,
): Promise<RetiroValidadoInterno> {
  const pedidos = await tx.$queryRaw<PedidoBloqueado[]>`
    SELECT id, cliente_id, numero_venta, canal, estado, is_active, deleted_at
    FROM pedidos_venta
    WHERE id = ${pedidoVentaId}
    FOR UPDATE
  `;
  const pedido = pedidos[0];
  if (!pedido || pedido.id !== pedidoVentaId || pedido.canal !== "WEB" ||
      !pedido.is_active || pedido.deleted_at !== null) {
    throw new RetiroRechazadoError("PEDIDO_NO_OPERABLE");
  }
  if (pedido.estado !== "FACTURADO") {
    throw new RetiroRechazadoError("ESTADO_NO_LISTO");
  }

  const extensiones = await tx.$queryRaw<ExtensionBloqueada[]>`
    SELECT id, pedido_venta_id, estado_ecommerce, codigo_qr_retiro,
           plazo_retiro_vencimiento, is_active, deleted_at
    FROM pedidos_venta_ecommerce
    WHERE pedido_venta_id = ${pedidoVentaId}
    FOR UPDATE
  `;
  const extension = extensiones[0];
  if (!extension || extension.pedido_venta_id !== pedido.id) {
    throw new RetiroRechazadoError("PEDIDO_NO_OPERABLE");
  }
  const ids = { pedido_venta_id: pedido.id, pedido_venta_ecommerce_id: extension.id };
  if (!extension.is_active || extension.deleted_at !== null) {
    throw new RetiroRechazadoError("PEDIDO_NO_OPERABLE", ids);
  }
  if (extension.estado_ecommerce !== "LISTO_PARA_RETIRO" ||
      extension.codigo_qr_retiro === null || extension.codigo_qr_retiro !== input.qr_token) {
    throw new RetiroRechazadoError("ESTADO_NO_LISTO", ids);
  }

  // Igual que E12: lock de ítems activos en orden estable, antes del Cliente.
  const items = await tx.$queryRaw<ItemBloqueado[]>`
    SELECT id, cantidad, cantidad_facturada, cantidad_entregada
    FROM pedido_venta_items
    WHERE pedido_venta_id = ${pedidoVentaId}
      AND is_active = true
      AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  `;
  // B exige que no haya líneas inactivas en una venta ya facturada.
  const totalItems = await tx.pedidoVentaItem.count({ where: { pedido_venta_id: pedidoVentaId } });
  if (items.length === 0 || items.length !== totalItems || items.some((item) =>
    item.cantidad <= 0 || item.cantidad_facturada !== item.cantidad ||
    item.cantidad_entregada !== 0 || item.cantidad_entregada > item.cantidad_facturada
  )) {
    throw new ServiceError("ESTADO_INCONSISTENTE", "Los ítems no admiten una entrega total");
  }

  if (!pedido.cliente_id) {
    throw new RetiroRechazadoError("CLIENTE_NO_OPERABLE", ids);
  }
  const clientes = await tx.$queryRaw<ClienteBloqueado[]>`
    SELECT id, dni, is_active, deleted_at
    FROM clientes
    WHERE id = ${pedido.cliente_id}
    FOR UPDATE
  `;
  const cliente = clientes[0];
  if (!cliente || cliente.id !== pedido.cliente_id ||
      !cliente.is_active || cliente.deleted_at !== null) {
    throw new RetiroRechazadoError("CLIENTE_NO_OPERABLE", ids);
  }

  // El reloj se toma tras adquirir todos los locks, nunca antes de esperar.
  const ahora = new Date();
  if (extension.plazo_retiro_vencimiento !== null &&
      extension.plazo_retiro_vencimiento.getTime() < ahora.getTime()) {
    throw new RetiroRechazadoError("PLAZO_VENCIDO", ids);
  }
  if (cliente.dni !== input.dni) {
    throw new RetiroRechazadoError("DNI_NO_COINCIDE", ids);
  }

  return {
    pedido_venta_id: pedido.id,
    pedido_venta_ecommerce_id: extension.id,
    numero_venta: pedido.numero_venta,
  };
}

/**
 * Entrada componible: T4 solo valida; T5 podrá continuar bajo los mismos locks
 * mediante el callback y decidir el commit de B/E en esta única transacción.
 */
export async function conRetiroValidadoTx<T>(
  input: ValidarRetiroInput,
  continuar: (tx: Prisma.TransactionClient, retiro: RetiroValidadoInterno) => Promise<T>,
): Promise<T> {
  const pedidoVentaId = await resolverPedidoVentaIdPorQr(prisma, input.qr_token);
  return prisma.$transaction(async (tx) => {
    const retiro = await validarRetiroBajoLocksTx(tx, pedidoVentaId, input);
    return continuar(tx, retiro);
  });
}

/** Resultado interno de la entrega; el DTO HTTP se definirá en T7. */
export interface RetiroEntregadoInterno extends RetiroValidadoInterno {
  estado: "ENTREGADO";
}

/** Un fallo síncrono del bus no revierte B/E ni expone el error ajeno. */
function emitirEventoRetiroSeguro<K extends keyof DomainEventMap>(
  nombre: K,
  payload: DomainEventMap[K],
): void {
  try {
    domainEventBus.emit(nombre, payload);
  } catch {
    console.error("[HU-E3] Falló la publicación de un evento de retiro");
  }
}

/**
 * Continuación T5 del agregado ya validado y bloqueado por T4. No abre otra
 * transacción: el helper comercial B y la transición E comparten este tx.
 */
export async function completarRetiroValidadoTx(
  tx: Prisma.TransactionClient,
  retiro: RetiroValidadoInterno,
  qr_token: string,
): Promise<RetiroEntregadoInterno> {
  await registrarEntregaTotalPedidoVentaTx(tx, retiro.pedido_venta_id);

  const cambio = await tx.pedidoVentaEcommerce.updateMany({
    where: {
      id: retiro.pedido_venta_ecommerce_id,
      pedido_venta_id: retiro.pedido_venta_id,
      is_active: true,
      deleted_at: null,
      estado_ecommerce: "LISTO_PARA_RETIRO",
      codigo_qr_retiro: qr_token,
    },
    data: { estado_ecommerce: "ENTREGADO", codigo_qr_retiro: null },
  });
  if (cambio.count !== 1) {
    throw new RetiroRechazadoError("ESTADO_NO_LISTO", {
      pedido_venta_id: retiro.pedido_venta_id,
      pedido_venta_ecommerce_id: retiro.pedido_venta_ecommerce_id,
    });
  }

  return { ...retiro, estado: "ENTREGADO" };
}

/** Entrega total Click & Collect en un solo commit B/E, sin eventos hasta T6. */
export async function validarYEntregarRetiro(
  input: ValidarRetiroInput,
  actorId: string,
): Promise<RetiroEntregadoInterno> {
  let resultado: RetiroEntregadoInterno;
  try {
    resultado = await conRetiroValidadoTx(input, (tx, retiro) =>
      completarRetiroValidadoTx(tx, retiro, input.qr_token));
  } catch (error) {
    if (error instanceof RetiroRechazadoError) {
      emitirEventoRetiroSeguro("ecommerce:retiro_rechazado", {
        evento_id: randomUUID(),
        actor_id: actorId,
        motivo: error.motivo,
        timestamp: new Date().toISOString(),
        ...(error.pedido_venta_id && error.pedido_venta_ecommerce_id ? {
          pedido_venta_id: error.pedido_venta_id,
          pedido_venta_ecommerce_id: error.pedido_venta_ecommerce_id,
        } : {}),
      });
    }
    throw error;
  }

  emitirEventoRetiroSeguro("ecommerce:pedido_entregado", {
    evento_id: randomUUID(),
    pedido_venta_id: resultado.pedido_venta_id,
    pedido_venta_ecommerce_id: resultado.pedido_venta_ecommerce_id,
    actor_id: actorId,
    estado_anterior: "LISTO_PARA_RETIRO",
    estado_nuevo: "ENTREGADO",
    timestamp: new Date().toISOString(),
  });
  return resultado;
}
