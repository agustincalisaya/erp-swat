import "server-only";

import { type EstadoEcommerce, type Prisma, type TipoActorReintegro } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import { compensarVentaPagada } from "@/lib/services/inventario/compensacion-venta.service";
import { registrarContraAsiento } from "@/lib/services/tesoreria/ingreso-tesoreria.service";
import { emitirNotaCreditoReintegroPedidoWeb } from "@/lib/services/ventas/comprobante-fiscal.service";
import { obtenerUsuarioCanalWebId } from "@/lib/services/ecommerce/usuario-canal-web";

export const MOTIVO_VENCIMIENTO_RETIRO = "Plazo de retiro vencido";

type ContextoCausaReintegro =
  | { causa: "CANCELACION_CLIENTE"; cliente_web_cuenta_id: string; motivo: string }
  | { causa: "CANCELACION_ADMIN"; usuario_id: string; motivo: string }
  | { causa: "VENCIMIENTO" };

export type IniciarReintegroPedidoWebInput = { pedido_venta_id: string } & ContextoCausaReintegro;

export interface InicioReintegroPedidoWebResultado {
  resultado: "CREADO" | "REUTILIZADO";
  reintegro_id: string;
  pedido_venta_id: string;
  estado_ecommerce: "CANCELADO" | "VENCIDO_SIN_RETIRO";
  estado_reintegro: "PENDIENTE";
  compensaciones_stock: number;
}

export interface ContinuacionLocalReintegroResultado {
  resultado: "PASOS_LOCALES_COMPLETOS" | "PENDIENTE_INGRESO_ORIGINAL";
  reintegro_id: string;
  pedido_venta_id: string;
  nota_credito_id: string;
  contra_asiento_ingreso_id: string | null;
  compensaciones_completas: number;
  compensaciones_totales: number;
  estado_reintegro: "PENDIENTE";
}

type PedidoBloqueado = {
  id: string;
  numero_venta: string;
  cliente_id: string | null;
  canal: "MOSTRADOR" | "WEB";
  estado: string;
  total: Prisma.Decimal;
  is_active: boolean;
  deleted_at: Date | null;
};

type ExtensionBloqueada = {
  id: string;
  pedido_venta_id: string;
  estado_ecommerce: EstadoEcommerce;
  mercadopago_payment_id: string | null;
  codigo_qr_retiro: string | null;
  plazo_retiro_vencimiento: Date | null;
  fecha_pago_confirmado: Date | null;
  is_active: boolean;
  deleted_at: Date | null;
};

type ItemVentaBloqueado = {
  id: string;
  variante_sku_id: string;
  cantidad: number;
  cantidad_facturada: number;
  cantidad_entregada: number;
  reserva_id: string | null;
  reserva_variante_sku_id: string;
  deposito_id: string;
  reserva_cantidad: number;
  fecha_fin_reserva: Date | null;
};

function validarMotivo(input: IniciarReintegroPedidoWebInput): void {
  if (input.causa !== "VENCIMIENTO" && input.motivo.trim().length === 0) {
    throw new ServiceError("MOTIVO_REQUERIDO", "El motivo es obligatorio");
  }
}

function destinoPorCausa(causa: ContextoCausaReintegro["causa"]): "CANCELADO" | "VENCIDO_SIN_RETIRO" {
  return causa === "VENCIMIENTO" ? "VENCIDO_SIN_RETIRO" : "CANCELADO";
}

function estadosPermitidos(causa: ContextoCausaReintegro["causa"]): EstadoEcommerce[] {
  if (causa === "CANCELACION_CLIENTE") return ["PAGO_CONFIRMADO"];
  if (causa === "CANCELACION_ADMIN") return ["PAGO_CONFIRMADO", "EN_PREPARACION", "LISTO_PARA_RETIRO"];
  return ["LISTO_PARA_RETIRO"];
}

async function validarEvidenciaVentaTx(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
  item: ItemVentaBloqueado,
): Promise<void> {
  if (
    !item.reserva_id ||
    item.fecha_fin_reserva === null ||
    item.variante_sku_id !== item.reserva_variante_sku_id ||
    item.cantidad <= 0 ||
    item.cantidad_facturada !== item.cantidad ||
    item.cantidad_entregada !== 0 ||
    item.reserva_cantidad !== item.cantidad
  ) {
    throw new ServiceError("EVIDENCIA_STOCK_INCONSISTENTE", "No puede determinarse la restitución de stock del pedido");
  }
  const movimientos = await tx.movimientoStock.findMany({
    where: {
      venta_id: pedidoVentaId,
      deposito_origen_id: item.deposito_id,
      tipo_movimiento: "EGRESO",
      comprobante_referencia: `RESERVA-CONFIRMADA-${item.reserva_id}`,
      is_active: true,
      deleted_at: null,
    },
    include: { items: true },
    take: 2,
  });
  const movimiento = movimientos[0];
  if (
    movimientos.length !== 1 ||
    !movimiento ||
    movimiento.items.length !== 1 ||
    movimiento.items[0]?.variante_sku_id !== item.variante_sku_id ||
    movimiento.items[0].cantidad !== item.cantidad ||
    movimiento.items[0].estado_origen !== "RESERVADO" ||
    movimiento.items[0].estado_destino !== "VENDIDO"
  ) {
    throw new ServiceError("EVIDENCIA_STOCK_INCONSISTENTE", "No existe una venta de stock inequívoca para el pedido");
  }
}

export async function iniciarReintegroPedidoWebPaso0(
  input: IniciarReintegroPedidoWebInput,
): Promise<InicioReintegroPedidoWebResultado> {
  validarMotivo(input);
  const eventoTerminal: {
    valor:
      | { nombre: "ecommerce:pedido_cancelado"; payload: DomainEventMap["ecommerce:pedido_cancelado"] }
      | { nombre: "ecommerce:pedido_vencido_sin_retiro"; payload: DomainEventMap["ecommerce:pedido_vencido_sin_retiro"] }
      | null;
  } = { valor: null };
  const resultado: InicioReintegroPedidoWebResultado = await prisma.$transaction(async (tx) => {
    const pedidos = await tx.$queryRaw<PedidoBloqueado[]>`
      SELECT id, numero_venta, cliente_id, canal, estado, total, is_active, deleted_at
      FROM pedidos_venta
      WHERE id = ${input.pedido_venta_id}
      FOR UPDATE
    `;
    const pedido = pedidos[0];
    if (!pedido || pedido.canal !== "WEB") {
      throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido web no existe");
    }
    if (pedido.estado !== "FACTURADO") {
      throw new ServiceError("TRANSICION_INVALIDA", "El pedido no está facturado");
    }

    const extensiones = await tx.$queryRaw<ExtensionBloqueada[]>`
      SELECT id, pedido_venta_id, estado_ecommerce, mercadopago_payment_id,
             codigo_qr_retiro, plazo_retiro_vencimiento, fecha_pago_confirmado,
             is_active, deleted_at
      FROM pedidos_venta_ecommerce
      WHERE pedido_venta_id = ${pedido.id}
      FOR UPDATE
    `;
    const extension = extensiones[0];
    if (!extension) {
      throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido web no existe");
    }

    const items = await tx.$queryRaw<ItemVentaBloqueado[]>`
      SELECT pvi.id, pvi.variante_sku_id, pvi.cantidad, pvi.cantidad_facturada,
             pvi.cantidad_entregada, pvi.reserva_id,
             r.variante_sku_id AS reserva_variante_sku_id,
             r.deposito_id, r.cantidad AS reserva_cantidad, r.fecha_fin_reserva
      FROM pedido_venta_items pvi
      JOIN reservas r ON r.id = pvi.reserva_id
      WHERE pvi.pedido_venta_id = ${pedido.id}
        AND pvi.is_active = true
        AND pvi.deleted_at IS NULL
      ORDER BY pvi.created_at ASC, pvi.id ASC
      FOR UPDATE OF pvi, r
    `;
    const totalItems = await tx.pedidoVentaItem.count({ where: { pedido_venta_id: pedido.id } });
    if (items.length === 0 || items.length !== totalItems) {
      throw new ServiceError("EVIDENCIA_STOCK_INCONSISTENTE", "Los ítems del pedido no tienen evidencia completa");
    }

    const reintegroExistente = await tx.reintegroPedidoWeb.findUnique({
      where: { pedido_venta_id: pedido.id },
      include: { compensaciones_stock: true },
    });
    const destino = destinoPorCausa(input.causa);
    if (reintegroExistente) {
      if (extension.estado_ecommerce !== destino || extension.is_active || extension.deleted_at === null) {
        throw new ServiceError("REINTEGRO_INCONSISTENTE", "La saga no coincide con el estado terminal del pedido");
      }
      return {
        resultado: "REUTILIZADO",
        reintegro_id: reintegroExistente.id,
        pedido_venta_id: pedido.id,
        estado_ecommerce: destino,
        estado_reintegro: "PENDIENTE",
        compensaciones_stock: reintegroExistente.compensaciones_stock.length,
      };
    }
    if (extension.estado_ecommerce === "CANCELADO" || extension.estado_ecommerce === "VENCIDO_SIN_RETIRO") {
      throw new ServiceError("REINTEGRO_INCONSISTENTE", "El pedido terminal no tiene una saga durable");
    }
    if (!pedido.is_active || pedido.deleted_at !== null || !extension.is_active || extension.deleted_at !== null) {
      throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido web no está operable");
    }
    if (!estadosPermitidos(input.causa).includes(extension.estado_ecommerce)) {
      throw new ServiceError("TRANSICION_INVALIDA", "El estado del pedido no admite la operación solicitada");
    }

    const ahora = new Date();
    if (input.causa === "VENCIMIENTO" &&
        (!extension.plazo_retiro_vencimiento || extension.plazo_retiro_vencimiento.getTime() >= ahora.getTime())) {
      throw new ServiceError("PLAZO_NO_VENCIDO", "El plazo de retiro todavía no venció");
    }
    if (!extension.mercadopago_payment_id || !extension.fecha_pago_confirmado) {
      throw new ServiceError("EVIDENCIA_PAGO_INCONSISTENTE", "El pedido no tiene evidencia de pago confirmado");
    }
    const logsPago = await tx.transaccionPagoLog.findMany({
      where: {
        OR: [
          { pedido_venta_ecommerce_id: extension.id },
          { mercadopago_payment_id: extension.mercadopago_payment_id },
        ],
      },
      select: {
        pedido_venta_ecommerce_id: true,
        mercadopago_payment_id: true,
        estado_pago: true,
        monto: true,
      },
    });
    const pagoAprobado = logsPago.some((log) =>
      log.pedido_venta_ecommerce_id === extension.id &&
      log.mercadopago_payment_id === extension.mercadopago_payment_id &&
      log.estado_pago === "APROBADO" &&
      log.monto.equals(pedido.total)
    );
    const evidenciaContradictoria = logsPago.some((log) =>
      log.pedido_venta_ecommerce_id !== extension.id ||
      log.mercadopago_payment_id !== extension.mercadopago_payment_id ||
      log.estado_pago === "RECHAZADO" ||
      (log.estado_pago === "APROBADO" && !log.monto.equals(pedido.total)) ||
      !["APROBADO", "PENDIENTE", "RECHAZADO"].includes(log.estado_pago)
    );
    if (evidenciaContradictoria) {
      throw new ServiceError("EVIDENCIA_PAGO_INCONSISTENTE", "La evidencia registrada del pago es contradictoria");
    }
    if (!pagoAprobado) {
      const mediosPago = await tx.ventaMedioPago.findMany({
        where: { pedido_venta_id: pedido.id, is_active: true, deleted_at: null },
        select: { medio: true, importe: true, referencia: true },
        take: 2,
      });
      const medio = mediosPago[0];
      if (
        mediosPago.length !== 1 ||
        !medio ||
        medio.medio !== "MERCADO_PAGO" ||
        medio.referencia !== extension.mercadopago_payment_id ||
        !medio.importe.equals(pedido.total)
      ) {
        throw new ServiceError("EVIDENCIA_PAGO_INCONSISTENTE", "El pedido legacy no tiene evidencia durable inequívoca del pago");
      }
    }
    const comprobantesOriginales = await tx.comprobanteFiscal.findMany({
      where: { pedido_venta_id: pedido.id, tipo_comprobante: { not: "NOTA_CREDITO" } },
      select: { id: true, monto_total: true },
      take: 2,
    });
    if (comprobantesOriginales.length !== 1 || !comprobantesOriginales[0]!.monto_total.equals(pedido.total)) {
      throw new ServiceError("EVIDENCIA_FISCAL_INCONSISTENTE", "El pedido no tiene un comprobante fiscal total inequívoco");
    }
    for (const item of items) await validarEvidenciaVentaTx(tx, pedido.id, item);

    const cuentaNotificable = pedido.cliente_id
      ? await tx.cuentaClienteWeb.findUnique({
          where: { cliente_id: pedido.cliente_id },
          select: { id: true, is_active: true, deleted_at: true },
        })
      : null;
    const clienteWebCuentaId = cuentaNotificable?.is_active && !cuentaNotificable.deleted_at
      ? cuentaNotificable.id
      : null;

    let motivo: string;
    let actorTipo: TipoActorReintegro;
    let solicitadoPorId: string | null;
    let deletedBy: string;
    if (input.causa === "CANCELACION_CLIENTE") {
      const cuenta = await tx.cuentaClienteWeb.findFirst({
        where: {
          id: input.cliente_web_cuenta_id,
          cliente_id: pedido.cliente_id ?? "",
          is_active: true,
          deleted_at: null,
        },
        select: { id: true },
      });
      if (!cuenta) throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido web no existe");
      motivo = input.motivo.trim();
      actorTipo = "CLIENTE_WEB";
      solicitadoPorId = null;
      deletedBy = await obtenerUsuarioCanalWebId(tx);
    } else if (input.causa === "CANCELACION_ADMIN") {
      const usuario = await tx.usuario.findFirst({
        where: { id: input.usuario_id, is_active: true, deleted_at: null },
        select: { id: true },
      });
      if (!usuario) throw new ServiceError("ACTOR_INVALIDO", "El usuario interno no está activo");
      motivo = input.motivo.trim();
      actorTipo = "USUARIO";
      solicitadoPorId = usuario.id;
      deletedBy = usuario.id;
    } else {
      motivo = MOTIVO_VENCIMIENTO_RETIRO;
      actorTipo = "SISTEMA";
      solicitadoPorId = null;
      deletedBy = await obtenerUsuarioCanalWebId(tx);
    }

    const cambio = await tx.pedidoVentaEcommerce.updateMany({
      where: {
        id: extension.id,
        pedido_venta_id: pedido.id,
        estado_ecommerce: extension.estado_ecommerce,
        is_active: true,
        deleted_at: null,
      },
      data: {
        estado_ecommerce: destino,
        codigo_qr_retiro: null,
        is_active: false,
        deleted_at: ahora,
        deleted_by: deletedBy,
        deletion_reason: motivo,
      },
    });
    if (cambio.count !== 1) {
      throw new ServiceError("TRANSICION_INVALIDA", "El pedido cambió durante la operación");
    }

    const reintegro = await tx.reintegroPedidoWeb.create({
      data: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: extension.mercadopago_payment_id,
        monto_total: pedido.total,
        motivo,
        solicitado_por_tipo: actorTipo,
        solicitado_por_id: solicitadoPorId,
        compensaciones_stock: {
          create: items.map((item) => ({
            pedido_venta_item_id: item.id,
            variante_sku_id: item.variante_sku_id,
            deposito_id: item.deposito_id,
            cantidad: item.cantidad,
            clave_idempotencia: `HU-E13:STOCK:${pedido.id}:${item.id}`,
          })),
        },
      },
      include: { compensaciones_stock: true },
    });

    if (input.causa === "VENCIMIENTO") {
      eventoTerminal.valor = {
        nombre: "ecommerce:pedido_vencido_sin_retiro",
        payload: {
          evento_id: reintegro.id,
          pedido_venta_id: pedido.id,
          pedido_venta_ecommerce_id: extension.id,
          reintegro_id: reintegro.id,
          numero_venta: pedido.numero_venta,
          cliente_web_cuenta_id: clienteWebCuentaId,
          actor_tipo: "SISTEMA",
          actor_id: null,
          motivo,
          estado_anterior: "LISTO_PARA_RETIRO",
          estado_nuevo: "VENCIDO_SIN_RETIRO",
          timestamp: ahora.toISOString(),
        },
      };
    } else {
      eventoTerminal.valor = {
        nombre: "ecommerce:pedido_cancelado",
        payload: {
          evento_id: reintegro.id,
          pedido_venta_id: pedido.id,
          pedido_venta_ecommerce_id: extension.id,
          reintegro_id: reintegro.id,
          numero_venta: pedido.numero_venta,
          cliente_web_cuenta_id: clienteWebCuentaId,
          actor_tipo: input.causa === "CANCELACION_CLIENTE" ? "CLIENTE_WEB" : "USUARIO",
          actor_id: input.causa === "CANCELACION_CLIENTE" ? input.cliente_web_cuenta_id : input.usuario_id,
          motivo,
          estado_anterior: extension.estado_ecommerce as "PAGO_CONFIRMADO" | "EN_PREPARACION" | "LISTO_PARA_RETIRO",
          estado_nuevo: "CANCELADO",
          timestamp: ahora.toISOString(),
        },
      };
    }

    return {
      resultado: "CREADO",
      reintegro_id: reintegro.id,
      pedido_venta_id: pedido.id,
      estado_ecommerce: destino,
      estado_reintegro: "PENDIENTE",
      compensaciones_stock: reintegro.compensaciones_stock.length,
    };
  });
  if (eventoTerminal.valor) {
    try {
      domainEventBus.emit(eventoTerminal.valor.nombre, eventoTerminal.valor.payload);
    } catch {
      console.error("[HU-E13] Falló la publicación del evento terminal post-commit");
    }
  }
  return resultado;
}

export async function continuarPasosLocalesReintegroPedidoWeb(
  reintegroId: string,
): Promise<ContinuacionLocalReintegroResultado> {
  const reintegro = await prisma.reintegroPedidoWeb.findUnique({
    where: { id: reintegroId },
    select: {
      id: true,
      pedido_venta_id: true,
      estado: true,
      solicitado_por_id: true,
      motivo: true,
      nota_credito_id: true,
      contra_asiento_ingreso_id: true,
    },
  });
  if (!reintegro) throw new ServiceError("REINTEGRO_NO_ENCONTRADO", "La saga de reintegro no existe");
  if (reintegro.estado !== "PENDIENTE") {
    throw new ServiceError("REINTEGRO_NO_PENDIENTE", "La saga no admite pasos locales");
  }
  const actorId = reintegro.solicitado_por_id ?? await obtenerUsuarioCanalWebId();
  const original = await prisma.comprobanteFiscal.findMany({
    where: { pedido_venta_id: reintegro.pedido_venta_id, tipo_comprobante: { not: "NOTA_CREDITO" } },
    select: { id: true },
    take: 2,
  });
  if (original.length !== 1) {
    throw new ServiceError("EVIDENCIA_FISCAL_INCONSISTENTE", "No existe un comprobante original inequívoco");
  }

  const notaCredito = await emitirNotaCreditoReintegroPedidoWeb({
    reintegro_id: reintegro.id,
    pedido_venta_id: reintegro.pedido_venta_id,
    comprobante_original_id: original[0]!.id,
    emitido_por_id: actorId,
  });

  const compensaciones = await prisma.reintegroStockCompensacion.findMany({
    where: { reintegro_id: reintegro.id },
    orderBy: [{ pedido_venta_item_id: "asc" }],
    select: { id: true, movimiento_stock_id: true },
  });
  for (const compensacion of compensaciones) {
    if (compensacion.movimiento_stock_id) continue;
    await compensarVentaPagada({
      reintegro_id: reintegro.id,
      compensacion_id: compensacion.id,
      registrado_por_id: actorId,
      motivo: reintegro.motivo,
    });
  }
  const compensacionesCompletas = await prisma.reintegroStockCompensacion.count({
    where: { reintegro_id: reintegro.id, movimiento_stock_id: { not: null }, completed_at: { not: null } },
  });
  if (compensacionesCompletas !== compensaciones.length) {
    throw new ServiceError("COMPENSACIONES_INCOMPLETAS", "El stock del reintegro todavía no está completo");
  }

  let contraAsientoId = reintegro.contra_asiento_ingreso_id;
  if (contraAsientoId) {
    const contraExistente = await prisma.contraAsientoIngreso.findUnique({
      where: { id: contraAsientoId },
      select: { pedido_venta_id: true },
    });
    if (!contraExistente || contraExistente.pedido_venta_id !== reintegro.pedido_venta_id) {
      throw new ServiceError("REINTEGRO_INCONSISTENTE", "El contra-asiento vinculado no pertenece al pedido");
    }
  }
  if (!contraAsientoId) {
    const contraAsiento = await registrarContraAsiento({
      pedido_venta_id: reintegro.pedido_venta_id,
      monto: notaCredito.monto_total,
      motivo: reintegro.motivo,
    });
    if (contraAsiento.resultado === "INGRESO_ORIGINAL_NO_ENCONTRADO") {
      await prisma.reintegroPedidoWeb.updateMany({
        where: { id: reintegro.id, estado: "PENDIENTE", contra_asiento_ingreso_id: null },
        data: { ultimo_error_codigo: "INGRESO_ORIGINAL_NO_ENCONTRADO", proximo_reintento_at: null },
      });
      return {
        resultado: "PENDIENTE_INGRESO_ORIGINAL",
        reintegro_id: reintegro.id,
        pedido_venta_id: reintegro.pedido_venta_id,
        nota_credito_id: notaCredito.nota_credito_id,
        contra_asiento_ingreso_id: null,
        compensaciones_completas: compensacionesCompletas,
        compensaciones_totales: compensaciones.length,
        estado_reintegro: "PENDIENTE",
      };
    }
    contraAsientoId = contraAsiento.contra_asiento_id;
    const vinculo = await prisma.reintegroPedidoWeb.updateMany({
      where: { id: reintegro.id, estado: "PENDIENTE", contra_asiento_ingreso_id: null },
      data: {
        contra_asiento_ingreso_id: contraAsientoId,
        ultimo_error_codigo: null,
        proximo_reintento_at: null,
      },
    });
    if (vinculo.count !== 1) {
      const actual = await prisma.reintegroPedidoWeb.findUnique({
        where: { id: reintegro.id },
        select: { contra_asiento_ingreso_id: true },
      });
      if (actual?.contra_asiento_ingreso_id !== contraAsientoId) {
        throw new ServiceError("REINTEGRO_INCONSISTENTE", "La saga vinculó otro contra-asiento");
      }
    }
  }

  return {
    resultado: "PASOS_LOCALES_COMPLETOS",
    reintegro_id: reintegro.id,
    pedido_venta_id: reintegro.pedido_venta_id,
    nota_credito_id: notaCredito.nota_credito_id,
    contra_asiento_ingreso_id: contraAsientoId,
    compensaciones_completas: compensacionesCompletas,
    compensaciones_totales: compensaciones.length,
    estado_reintegro: "PENDIENTE",
  };
}

export async function iniciarYContinuarReintegroPedidoWeb(
  input: IniciarReintegroPedidoWebInput,
): Promise<{ inicio: InicioReintegroPedidoWebResultado; pasos_locales: ContinuacionLocalReintegroResultado }> {
  const inicio = await iniciarReintegroPedidoWebPaso0(input);
  const pasosLocales = await continuarPasosLocalesReintegroPedidoWeb(inicio.reintegro_id);
  return { inicio, pasos_locales: pasosLocales };
}
