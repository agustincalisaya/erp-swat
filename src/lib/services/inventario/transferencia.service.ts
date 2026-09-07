import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  CrearTransferenciaInput,
  ConfirmarRecepcionTransferenciaInput,
} from "@/lib/schemas/inventario.schema";
import type { FiltrosHistorialTransferenciasInput } from "@/lib/schemas/inventario.schema";

/** HU-A11 (multi-ítem) — línea despachada al crear la transferencia. */
export interface TransferenciaCreadaItem {
  variante_sku_id: string;
  cantidad: number;
}

export interface TransferenciaCreada {
  transferencia_id: string;
  remito_id: string;
  estado: "EN_TRANSITO";
  items: TransferenciaCreadaItem[];
  deposito_origen_id: string;
  deposito_destino_id: string;
}

export interface VarianteTransferible {
  id: string;
  sku: string;
  nombre: string;
  detalle: string;
}

/** HU-A11 — línea (`TransferenciaStockItem`) dentro de una fila del listado de remitos pendientes. */
export interface TransferenciaItemListado {
  id: string;
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  cantidad: number;
  cantidad_recibida: number;
  estado_item: "PENDIENTE" | "RECIBIDO_PARCIAL" | "RECIBIDO_TOTAL";
}

/**
 * HU-A11 (multi-ítem) — fila rica de un remito para `RecepcionesPendientesPanel.tsx`
 * (`listarTransferenciasPendientes()`): expone todos los ítems para permitir
 * recepción parcial por ítem. Distinta de `TransferenciaListado` (abajo) —
 * esa es la vista legada de un solo ítem por fila que sigue consumiendo
 * `HistorialTransferencias.tsx` (HU-A5, fuera de alcance de HU-A11).
 */
export interface TransferenciaRemitoListado {
  id: string;
  numero_remito: string;
  deposito_origen: string;
  deposito_destino: string;
  items: TransferenciaItemListado[];
  items_count: number;
  cantidad_total: number;
  estado: "EN_TRANSITO" | "PARCIAL" | "RECIBIDA";
  despachada_at: string;
  recibida_at: string | null;
}

const TRANSFERENCIA_REMITO_SELECT = {
  id: true,
  numero_remito: true,
  estado: true,
  despachada_at: true,
  recibida_at: true,
  deposito_origen: { select: { nombre: true } },
  deposito_destino: { select: { nombre: true } },
  items: {
    where: { is_active: true },
    select: {
      id: true,
      cantidad: true,
      cantidad_recibida: true,
      estado_item: true,
      variante_sku: { select: { id: true, sku: true, producto_maestro: { select: { nombre: true } } } },
    },
  },
} satisfies Prisma.TransferenciaStockSelect;

type TransferenciaRemitoDb = Prisma.TransferenciaStockGetPayload<{ select: typeof TRANSFERENCIA_REMITO_SELECT }>;

function mapearTransferenciaRemito(transferencia: TransferenciaRemitoDb): TransferenciaRemitoListado {
  const items: TransferenciaItemListado[] = transferencia.items.map((item) => ({
    id: item.id,
    variante_sku_id: item.variante_sku.id,
    sku: item.variante_sku.sku,
    producto_nombre: item.variante_sku.producto_maestro.nombre,
    cantidad: item.cantidad,
    cantidad_recibida: item.cantidad_recibida,
    estado_item: item.estado_item,
  }));

  return {
    id: transferencia.id,
    numero_remito: transferencia.numero_remito,
    deposito_origen: transferencia.deposito_origen.nombre,
    deposito_destino: transferencia.deposito_destino.nombre,
    items,
    items_count: items.length,
    cantidad_total: items.reduce((acumulado, item) => acumulado + item.cantidad, 0),
    estado: transferencia.estado,
    despachada_at: transferencia.despachada_at.toISOString(),
    recibida_at: transferencia.recibida_at?.toISOString() ?? null,
  };
}

/**
 * Vista legada de un solo ítem por fila (contrato de HU-A5, congelado —
 * `HistorialTransferencias.tsx` está fuera de alcance de HU-A11 y sigue
 * esperando `sku`/`producto_nombre`/`cantidad` escalares). Un remito
 * multi-ítem (HU-A11) se resume acá: con 1 ítem se muestran sus datos
 * reales (comportamiento idéntico al de antes de HU-A11); con más de 1 se
 * resume como "`N` productos" / cantidad total, mismo criterio que
 * `HistorialMovimientos.tsx`.
 */
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

function resumirItemsComoLegado(items: TransferenciaItemListado[]): { sku: string; producto_nombre: string; cantidad: number } {
  if (items.length === 1) {
    return { sku: items[0].sku, producto_nombre: items[0].producto_nombre, cantidad: items[0].cantidad };
  }
  return {
    sku: "—",
    producto_nombre: `${items.length} productos`,
    cantidad: items.reduce((acumulado, item) => acumulado + item.cantidad, 0),
  };
}

function mapearTransferenciaLegado(transferencia: TransferenciaRemitoDb): TransferenciaListado {
  const remito = mapearTransferenciaRemito(transferencia);
  const resumen = resumirItemsComoLegado(remito.items);
  return {
    id: remito.id,
    numero_remito: remito.numero_remito,
    sku: resumen.sku,
    producto_nombre: resumen.producto_nombre,
    deposito_origen: remito.deposito_origen,
    deposito_destino: remito.deposito_destino,
    cantidad: resumen.cantidad,
    estado: remito.estado as "EN_TRANSITO" | "RECIBIDA",
    despachada_at: remito.despachada_at,
    recibida_at: remito.recibida_at,
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

/** HU-A11: "pendiente" ahora incluye PARCIAL — un remito con recepción parcial sigue teniendo ítems pendientes. */
export async function listarTransferenciasPendientes(): Promise<TransferenciaRemitoListado[]> {
  const transferencias = await prisma.transferenciaStock.findMany({
    where: { estado: { in: ["EN_TRANSITO", "PARCIAL"] }, is_active: true, deleted_at: null },
    select: TRANSFERENCIA_REMITO_SELECT,
    orderBy: [{ despachada_at: "desc" }, { id: "desc" }],
  });
  return transferencias.map(mapearTransferenciaRemito);
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
      select: TRANSFERENCIA_REMITO_SELECT,
      orderBy: [{ recibida_at: "desc" }, { id: "desc" }],
      skip: (filtros.page - 1) * HISTORIAL_PAGE_SIZE,
      take: HISTORIAL_PAGE_SIZE,
    }),
    prisma.transferenciaStock.count({ where }),
  ]);

  return {
    registros: registros.map(mapearTransferenciaLegado),
    total,
    page: filtros.page,
    page_size: HISTORIAL_PAGE_SIZE,
  };
}

/**
 * HU-A11 (multi-ítem) — Despacha una transferencia en lote: una cabecera
 * `TransferenciaStock` + un `TransferenciaStockItem` por ítem del carrito
 * (todos en `PENDIENTE`), y la cabecera `MovimientoStock` compañera con sus
 * propios ítems espejo (`estado_origen: DISPONIBLE`, `estado_destino:
 * EN_TRANSITO`). Todo en una única transacción — si el stock de origen no
 * alcanza para cualquier ítem, el lote completo se revierte.
 */
export async function crearTransferencia(
  input: CrearTransferenciaInput,
  usuarioId: string,
): Promise<TransferenciaCreada> {
  const transferenciaId = randomUUID();
  const numeroRemito = `TR-${transferenciaId}`;

  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const [origen, destino] = await Promise.all([
      tx.deposito.findFirst({
        where: { id: input.deposito_origen_id, is_active: true, deleted_at: null },
        select: { id: true },
      }),
      tx.deposito.findFirst({
        where: { id: input.deposito_destino_id, is_active: true, deleted_at: null },
        select: { id: true },
      }),
    ]);
    if (!origen) throw new ServiceError("DEPOSITO_ORIGEN_NO_ENCONTRADO", "El depósito origen no existe o está inactivo");
    if (!destino) throw new ServiceError("DEPOSITO_DESTINO_NO_ENCONTRADO", "El depósito destino no existe o está inactivo");

    const varianteIds = [...new Set(input.items.map((item) => item.variante_sku_id))];
    const variantesActivas = await tx.varianteSKU.findMany({
      where: { id: { in: varianteIds }, is_active: true, deleted_at: null },
      select: { id: true },
    });
    const idsActivos = new Set(variantesActivas.map((v) => v.id));
    const varianteFaltante = varianteIds.find((id) => !idsActivos.has(id));
    if (varianteFaltante) {
      throw new ServiceError("VARIANTE_NO_ENCONTRADA", `La variante ${varianteFaltante} no existe o está inactiva`);
    }

    const itemsTransferencia: Prisma.TransferenciaStockItemCreateManyTransferenciaInput[] = [];
    const itemsMovimiento: Prisma.MovimientoStockItemCreateManyMovimientoInput[] = [];

    for (const item of input.items) {
      const decremento = await tx.stockDeposito.updateMany({
        where: {
          variante_sku_id: item.variante_sku_id,
          deposito_id: input.deposito_origen_id,
          is_active: true,
          deleted_at: null,
          cantidad: { gte: item.cantidad },
        },
        data: { cantidad: { decrement: item.cantidad } },
      });
      if (decremento.count === 0) {
        throw new ServiceError(
          "STOCK_INSUFICIENTE",
          `Stock disponible insuficiente en el depósito origen para la variante ${item.variante_sku_id}`,
        );
      }

      itemsTransferencia.push({ variante_sku_id: item.variante_sku_id, cantidad: item.cantidad });
      itemsMovimiento.push({
        variante_sku_id: item.variante_sku_id,
        cantidad: item.cantidad,
        estado_origen: "DISPONIBLE",
        estado_destino: "EN_TRANSITO",
      });
    }

    const transferencia = await tx.transferenciaStock.create({
      data: {
        id: transferenciaId,
        numero_remito: numeroRemito,
        deposito_origen_id: input.deposito_origen_id,
        deposito_destino_id: input.deposito_destino_id,
        despachada_por_id: usuarioId,
        items: { createMany: { data: itemsTransferencia } },
      },
    });
    const movimiento = await tx.movimientoStock.create({
      data: {
        deposito_origen_id: input.deposito_origen_id,
        deposito_destino_id: input.deposito_destino_id,
        tipo_movimiento: "TRANSFERENCIA",
        comprobante_referencia: numeroRemito,
        registrado_por_id: usuarioId,
        items: { createMany: { data: itemsMovimiento } },
      },
    });
    return { transferencia, movimiento_id: movimiento.id };
  });

  domainEventBus.emit("stock:transferencia_iniciada", {
    transferencia_id: resultado.transferencia.id,
    remito_id: resultado.transferencia.numero_remito,
    movimiento_id: resultado.movimiento_id,
    deposito_origen_id: input.deposito_origen_id,
    deposito_destino_id: input.deposito_destino_id,
    items: input.items,
    usuario_id: usuarioId,
  });
  return {
    transferencia_id: resultado.transferencia.id,
    remito_id: resultado.transferencia.numero_remito,
    estado: "EN_TRANSITO",
    items: input.items,
    deposito_origen_id: input.deposito_origen_id,
    deposito_destino_id: input.deposito_destino_id,
  };
}

/** HU-A11 — línea de la respuesta de una confirmación de recepción (total o parcial). */
export interface RecepcionConfirmadaItem {
  transferencia_item_id: string;
  variante_sku_id: string;
  cantidad_recibida_ahora: number;
  cantidad_recibida_acumulada: number;
  cantidad: number;
  estado_item: "RECIBIDO_PARCIAL" | "RECIBIDO_TOTAL";
}

export interface RecepcionConfirmada {
  transferencia_id: string;
  estado: "PARCIAL" | "RECIBIDA";
  recibida_at: string | null;
  items: RecepcionConfirmadaItem[];
}

/**
 * HU-A11 — Confirma la recepción de una `TransferenciaStock`, total o
 * parcial, según cuánto se recibió de cada `TransferenciaStockItem`
 * (`input.items`, ya validado por `ConfirmarRecepcionTransferenciaSchema`:
 * array no vacío, `cantidad_recibida` siempre positiva — los ítems que el
 * usuario dejó en 0 en el panel ni siquiera llegan acá, quedan pendientes
 * sin acción explícita). Todo en una única transacción:
 *
 *  1. Carga la cabecera y sus ítems activos. Cabecera inexistente/inactiva/
 *     ya `RECIBIDA` → error; el resto de la validación es por ítem.
 *  2. Por cada entrada de `input.items`: valida que el `transferencia_item_id`
 *     pertenezca a esta transferencia y que `cantidad_recibida` no supere lo
 *     pendiente de ese ítem (nunca confiar en el máximo que ya validó la UI).
 *     Actualiza `cantidad_recibida`/`estado_item` con un `updateMany`
 *     condicionado sobre el acumulado leído (blindaje contra una recepción
 *     concurrente del mismo ítem) e incrementa el `StockDeposito` destino
 *     por la porción recibida ahora.
 *  3. Crea UNA cabecera `MovimientoStock` (tipo TRANSFERENCIA) con un
 *     `MovimientoStockItem` por cada ítem tocado en esta llamada — solo por
 *     la porción efectivamente recibida ahora, no por el acumulado total.
 *  4. Recalcula el estado de la cabecera mirando TODOS sus ítems (tocados y
 *     no tocados en esta llamada): `RECIBIDA` si todos quedaron
 *     `RECIBIDO_TOTAL`, si no `PARCIAL` (siempre hay al menos un ítem que
 *     avanzó de `PENDIENTE`, por el array no vacío del schema).
 *
 * FUERA de la transacción: emite `stock:transferencia_recepcion_confirmada`.
 *
 * @throws {ServiceError} TRANSFERENCIA_NO_ENCONTRADA / TRANSFERENCIA_INACTIVA / TRANSFERENCIA_YA_RECIBIDA
 * @throws {ServiceError} DEPOSITO_ORIGEN_NO_ENCONTRADO / DEPOSITO_DESTINO_NO_ENCONTRADO
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA — la variante de algún ítem se dio de baja entre el despacho y la recepción
 * @throws {ServiceError} ITEM_NO_ENCONTRADO — el `transferencia_item_id` no pertenece a esta transferencia
 * @throws {ServiceError} CANTIDAD_EXCEDE_PENDIENTE
 * @throws {ServiceError} ITEM_RECEPCION_CONCURRENTE — el ítem fue tocado por otra confirmación en simultáneo
 * @throws {ServiceError} STOCK_DESTINO_INACTIVO
 */
export async function confirmarRecepcionTransferencia(
  input: ConfirmarRecepcionTransferenciaInput,
  usuarioId: string,
): Promise<RecepcionConfirmada> {
  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const transferencia = await tx.transferenciaStock.findFirst({
      where: { id: input.transferencia_id },
    });
    if (!transferencia) throw new ServiceError("TRANSFERENCIA_NO_ENCONTRADA");
    if (!transferencia.is_active || transferencia.deleted_at) throw new ServiceError("TRANSFERENCIA_INACTIVA");
    if (transferencia.estado === "RECIBIDA") {
      throw new ServiceError("TRANSFERENCIA_YA_RECIBIDA", "La transferencia ya fue recibida por completo");
    }

    const [origen, destino] = await Promise.all([
      tx.deposito.findFirst({ where: { id: transferencia.deposito_origen_id, is_active: true, deleted_at: null }, select: { id: true } }),
      tx.deposito.findFirst({ where: { id: transferencia.deposito_destino_id, is_active: true, deleted_at: null }, select: { id: true } }),
    ]);
    if (!origen) throw new ServiceError("DEPOSITO_ORIGEN_NO_ENCONTRADO", "El depósito origen ya no está activo");
    if (!destino) throw new ServiceError("DEPOSITO_DESTINO_NO_ENCONTRADO", "El depósito destino ya no está activo");

    const todosLosItems = await tx.transferenciaStockItem.findMany({
      where: { transferencia_id: input.transferencia_id, is_active: true },
    });
    const itemsPorId = new Map(todosLosItems.map((item) => [item.id, item]));

    // Blindaje de integridad (mismo criterio que el código single-ítem
    // anterior): una variante pudo darse de baja lógica entre el despacho y
    // la recepción — no se incrementa stock de una variante ya inactiva.
    const varianteIdsAReceber = [...new Set(input.items.map((entrada) => itemsPorId.get(entrada.transferencia_item_id)?.variante_sku_id).filter((id): id is string => !!id))];
    const variantesActivas = await tx.varianteSKU.findMany({
      where: { id: { in: varianteIdsAReceber }, is_active: true, deleted_at: null },
      select: { id: true },
    });
    const idsVariantesActivas = new Set(variantesActivas.map((v) => v.id));
    const varianteInactiva = varianteIdsAReceber.find((id) => !idsVariantesActivas.has(id));
    if (varianteInactiva) {
      throw new ServiceError("VARIANTE_NO_ENCONTRADA", `La variante ${varianteInactiva} ya no está activa`);
    }

    const itemsMovimiento: Prisma.MovimientoStockItemCreateManyMovimientoInput[] = [];
    const itemsActualizados: RecepcionConfirmadaItem[] = [];
    // id → estado_item final, arranca en el estado actual de cada ítem y se
    // pisa con el nuevo estado de los que esta llamada efectivamente toca —
    // necesario para recalcular el estado de la cabecera al final mirando
    // la foto completa (tocados + no tocados).
    const estadoFinalPorItem = new Map(todosLosItems.map((item) => [item.id, item.estado_item]));

    for (const entrada of input.items) {
      const item = itemsPorId.get(entrada.transferencia_item_id);
      if (!item) {
        throw new ServiceError(
          "ITEM_NO_ENCONTRADO",
          `El ítem ${entrada.transferencia_item_id} no pertenece a esta transferencia`,
        );
      }

      const pendiente = item.cantidad - item.cantidad_recibida;
      if (entrada.cantidad_recibida > pendiente) {
        throw new ServiceError(
          "CANTIDAD_EXCEDE_PENDIENTE",
          `La cantidad a recibir del ítem ${item.id} (${entrada.cantidad_recibida}) supera lo pendiente (${pendiente})`,
        );
      }

      const nuevaAcumulada = item.cantidad_recibida + entrada.cantidad_recibida;
      const nuevoEstadoItem: "RECIBIDO_PARCIAL" | "RECIBIDO_TOTAL" =
        nuevaAcumulada === item.cantidad ? "RECIBIDO_TOTAL" : "RECIBIDO_PARCIAL";

      // Guarda condicionada sobre el `cantidad_recibida` leído: blinda contra
      // una segunda confirmación concurrente tocando el mismo ítem.
      const cambio = await tx.transferenciaStockItem.updateMany({
        where: { id: item.id, cantidad_recibida: item.cantidad_recibida },
        data: { cantidad_recibida: nuevaAcumulada, estado_item: nuevoEstadoItem },
      });
      if (cambio.count === 0) {
        throw new ServiceError(
          "ITEM_RECEPCION_CONCURRENTE",
          `El ítem ${item.id} fue modificado por otra recepción concurrente`,
        );
      }

      const stockDestino = await tx.stockDeposito.findUnique({
        where: {
          variante_sku_id_deposito_id: {
            variante_sku_id: item.variante_sku_id,
            deposito_id: transferencia.deposito_destino_id,
          },
        },
        select: { id: true, is_active: true, deleted_at: true },
      });
      if (stockDestino && (!stockDestino.is_active || stockDestino.deleted_at)) {
        throw new ServiceError("STOCK_DESTINO_INACTIVO", "El registro de stock destino está inactivo y requiere reactivación explícita");
      }
      if (stockDestino) {
        await tx.stockDeposito.update({
          where: { id: stockDestino.id },
          data: { cantidad: { increment: entrada.cantidad_recibida } },
        });
      } else {
        await tx.stockDeposito.create({
          data: {
            variante_sku_id: item.variante_sku_id,
            deposito_id: transferencia.deposito_destino_id,
            cantidad: entrada.cantidad_recibida,
          },
        });
      }

      itemsMovimiento.push({
        variante_sku_id: item.variante_sku_id,
        cantidad: entrada.cantidad_recibida,
        estado_origen: "EN_TRANSITO",
        estado_destino: "DISPONIBLE",
      });

      itemsActualizados.push({
        transferencia_item_id: item.id,
        variante_sku_id: item.variante_sku_id,
        cantidad_recibida_ahora: entrada.cantidad_recibida,
        cantidad_recibida_acumulada: nuevaAcumulada,
        cantidad: item.cantidad,
        estado_item: nuevoEstadoItem,
      });
      estadoFinalPorItem.set(item.id, nuevoEstadoItem);
    }

    const movimiento = await tx.movimientoStock.create({
      data: {
        deposito_origen_id: transferencia.deposito_origen_id,
        deposito_destino_id: transferencia.deposito_destino_id,
        tipo_movimiento: "TRANSFERENCIA",
        comprobante_referencia: transferencia.numero_remito,
        registrado_por_id: usuarioId,
        items: { createMany: { data: itemsMovimiento } },
      },
    });

    // `input.items` no vacío (schema) garantiza que al menos un ítem dejó de
    // estar PENDIENTE acá — nunca hace falta contemplar "cabecera sigue en
    // EN_TRANSITO porque no se tocó nada".
    const todosTotal = [...estadoFinalPorItem.values()].every((estado) => estado === "RECIBIDO_TOTAL");
    const nuevoEstadoCabecera: "PARCIAL" | "RECIBIDA" = todosTotal ? "RECIBIDA" : "PARCIAL";
    const recibidaAt = nuevoEstadoCabecera === "RECIBIDA" ? new Date() : null;

    await tx.transferenciaStock.update({
      where: { id: input.transferencia_id },
      data: {
        estado: nuevoEstadoCabecera,
        ...(recibidaAt ? { recibida_por_id: usuarioId, recibida_at: recibidaAt } : {}),
      },
    });

    return {
      transferencia,
      movimiento_id: movimiento.id,
      estado_cabecera: nuevoEstadoCabecera,
      recibida_at: recibidaAt,
      items: itemsActualizados,
    };
  });

  domainEventBus.emit("stock:transferencia_recepcion_confirmada", {
    transferencia_id: resultado.transferencia.id,
    remito_id: resultado.transferencia.numero_remito,
    movimiento_id: resultado.movimiento_id,
    deposito_origen_id: resultado.transferencia.deposito_origen_id,
    deposito_destino_id: resultado.transferencia.deposito_destino_id,
    items: resultado.items.map((item) => ({
      variante_sku_id: item.variante_sku_id,
      cantidad_recibida: item.cantidad_recibida_ahora,
      estado_item: item.estado_item,
    })),
    estado_transferencia: resultado.estado_cabecera,
    usuario_id: usuarioId,
    recibida_at: resultado.recibida_at?.toISOString() ?? null,
  });

  return {
    transferencia_id: input.transferencia_id,
    estado: resultado.estado_cabecera,
    recibida_at: resultado.recibida_at?.toISOString() ?? null,
    items: resultado.items,
  };
}

export async function darDeBajaTransferencia(transferenciaId: string, usuarioId: string, motivo: string) {
  const deletedAt = new Date();
  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const transferencia = await tx.transferenciaStock.findFirst({ where: { id: transferenciaId } });
    if (!transferencia) throw new ServiceError("TRANSFERENCIA_NO_ENCONTRADA");
    if (!transferencia.is_active || transferencia.deleted_at) throw new ServiceError("TRANSFERENCIA_INACTIVA");
    if (transferencia.estado === "EN_TRANSITO" || transferencia.estado === "PARCIAL") {
      // HU-A11: PARCIAL todavía tiene ítems EN_TRANSITO (no todo lo
      // despachado se recibió) — mismo motivo por el que EN_TRANSITO ya
      // estaba bloqueado.
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
