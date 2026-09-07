import "server-only";

import { Prisma, type EstadoOrdenCompra } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma, ejecutarConReintentoDeConflicto } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { RegistrarRecepcionInput } from "@/lib/schemas/recepciones.schema";
import { registrarIngresoStockTx } from "@/lib/services/inventario/movimiento.service";
import { registrarEvaluacionDesdeRecepcion } from "@/lib/services/proveedores/evaluacion.service";
import { calcularPayloadHashRecepcion } from "@/lib/services/proveedores/recepcion-idempotencia";
import {
  construirPayloadRecepcionRegistrada,
  determinarEstadoFisicoOrden,
  FILTRO_ACUMULADO_RECEPCIONES_ACTIVAS,
} from "@/lib/services/proveedores/recepcion-reglas";

export const PERMISO_REGISTRAR_RECEPCION = "recepciones:registrar";

const ESTADOS_RECEPCION_HABILITADOS: EstadoOrdenCompra[] = [
  "CONFIRMADA",
  "RECEPCION_PARCIAL",
];

const RECEPCION_RESULTADO_SELECT = {
  id: true,
  orden_compra_id: true,
  deposito_destino_id: true,
  fecha_recepcion: true,
  movimiento_stock: { select: { id: true } },
  orden_compra: { select: { numero_orden: true, estado: true } },
} satisfies Prisma.RecepcionSelect;

type RecepcionResultadoDb = Prisma.RecepcionGetPayload<{
  select: typeof RECEPCION_RESULTADO_SELECT;
}>;

export interface RecepcionRegistrada {
  recepcion_id: string;
  orden_compra_id: string;
  numero_orden: string;
  deposito_destino_id: string;
  fecha_recepcion: string;
  estado_orden_compra: EstadoOrdenCompra;
  movimiento_stock_id: string | null;
  idempotente: boolean;
  evaluacion_proveedor: "REGISTRADA" | "FALLO" | "NO_REEJECUTADA";
}

export type RegistrarRecepcionServiceInput = RegistrarRecepcionInput & {
  /** Siempre proviene del path del endpoint; el body no puede sobreescribirlo. */
  orden_compra_id: string;
};

interface ResultadoTransaccion {
  recepcion: RecepcionResultadoDb;
  creada: boolean;
  estadoAnterior: "CONFIRMADA" | "RECEPCION_PARCIAL";
  estadoNuevo: "RECEPCION_PARCIAL" | "RECIBIDA_COMPLETA";
  itemsStock: Array<{
    variante_sku_id: string;
    cantidad: number;
    estado_destino: string;
    cantidad_resultante: number;
  }>;
}

function asegurarMismaIntencion(payloadHashExistente: string, payloadHash: string): void {
  if (payloadHashExistente !== payloadHash) {
    throw new ServiceError(
      "CLAVE_IDEMPOTENCIA_REUTILIZADA",
      "La clave de idempotencia ya fue utilizada con un payload diferente",
    );
  }
}

function mapearResultado(
  recepcion: RecepcionResultadoDb,
  idempotente: boolean,
  evaluacion: RecepcionRegistrada["evaluacion_proveedor"],
): RecepcionRegistrada {
  return {
    recepcion_id: recepcion.id,
    orden_compra_id: recepcion.orden_compra_id,
    numero_orden: recepcion.orden_compra.numero_orden,
    deposito_destino_id: recepcion.deposito_destino_id,
    fecha_recepcion: recepcion.fecha_recepcion.toISOString(),
    estado_orden_compra: recepcion.orden_compra.estado,
    movimiento_stock_id: recepcion.movimiento_stock?.id ?? null,
    idempotente,
    evaluacion_proveedor: evaluacion,
  };
}

async function resolverRepeticion(
  claveIdempotencia: string,
  payloadHash: string,
): Promise<RecepcionRegistrada | null> {
  const existente = await prisma.recepcion.findUnique({
    where: { clave_idempotencia: claveIdempotencia },
    select: { ...RECEPCION_RESULTADO_SELECT, payload_hash: true },
  });
  if (!existente) return null;
  asegurarMismaIntencion(existente.payload_hash, payloadHash);
  return mapearResultado(existente, true, "NO_REEJECUTADA");
}

/**
 * Registra una recepción física completa o parcial. HU-H4 gobierna en la
 * misma transacción la recepción, sus ítems/discrepancias, el stock aceptado,
 * el movimiento (si corresponde) y el estado físico de la orden.
 */
interface DependenciasRecepcion {
  registrarEvaluacion: typeof registrarEvaluacionDesdeRecepcion;
}

const DEPENDENCIAS_RECEPCION: DependenciasRecepcion = {
  registrarEvaluacion: registrarEvaluacionDesdeRecepcion,
};

/** Punto inyectable para comprobar aisladamente fallos post-commit. */
export async function registrarRecepcionConDependencias(
  input: RegistrarRecepcionServiceInput,
  usuarioId: string,
  dependencias: DependenciasRecepcion,
): Promise<RecepcionRegistrada> {
  const payloadHash = calcularPayloadHashRecepcion(input.orden_compra_id, input);
  const repeticion = await resolverRepeticion(input.clave_idempotencia, payloadHash);
  if (repeticion) return repeticion;

  let resultado: ResultadoTransaccion;
  try {
    resultado = await ejecutarConReintentoDeConflicto(() =>
      prisma.$transaction(
        async (tx): Promise<ResultadoTransaccion> => {
          const existente = await tx.recepcion.findUnique({
            where: { clave_idempotencia: input.clave_idempotencia },
            select: { ...RECEPCION_RESULTADO_SELECT, payload_hash: true },
          });
          if (existente) {
            asegurarMismaIntencion(existente.payload_hash, payloadHash);
            return {
              recepcion: existente,
              creada: false,
              estadoAnterior: "RECEPCION_PARCIAL",
              estadoNuevo: existente.orden_compra.estado === "RECIBIDA_COMPLETA"
                ? "RECIBIDA_COMPLETA"
                : "RECEPCION_PARCIAL",
              itemsStock: [],
            };
          }

          const orden = await tx.ordenCompra.findFirst({
            where: { id: input.orden_compra_id, is_active: true, deleted_at: null },
            select: {
              id: true,
              numero_orden: true,
              estado: true,
              items: {
                where: { is_active: true, deleted_at: null },
                select: {
                  id: true,
                  variante_sku_id: true,
                  cantidad_solicitada: true,
                },
              },
            },
          });
          if (!orden) {
            throw new ServiceError("ORDEN_NO_ENCONTRADA", "La orden de compra indicada no existe");
          }
          if (!ESTADOS_RECEPCION_HABILITADOS.includes(orden.estado)) {
            throw new ServiceError(
              "ORDEN_NO_RECEPCIONABLE",
              `La orden ${orden.numero_orden} no admite recepciones en estado ${orden.estado}`,
            );
          }

          const deposito = await tx.deposito.findFirst({
            where: { id: input.deposito_destino_id, is_active: true, deleted_at: null },
            select: { id: true },
          });
          if (!deposito) {
            throw new ServiceError("DEPOSITO_NO_ENCONTRADO", "El depósito destino no existe o está inactivo");
          }

          const itemOrdenPorId = new Map(orden.items.map((item) => [item.id, item]));
          for (const item of input.items) {
            if (!itemOrdenPorId.has(item.orden_compra_item_id)) {
              throw new ServiceError(
                "ITEM_NO_PERTENECE_A_ORDEN",
                "Uno de los ítems recibidos no pertenece a la orden de compra activa",
              );
            }
          }

          const acumulados = await tx.recepcionItem.groupBy({
            by: ["orden_compra_item_id"],
            where: {
              orden_compra_item_id: { in: orden.items.map((item) => item.id) },
              ...FILTRO_ACUMULADO_RECEPCIONES_ACTIVAS,
            },
            _sum: { cantidad_recibida: true },
          });
          const recibidoPrevio = new Map(
            acumulados.map((item) => [item.orden_compra_item_id, item._sum.cantidad_recibida ?? 0]),
          );

          for (const item of input.items) {
            const itemOrden = itemOrdenPorId.get(item.orden_compra_item_id)!;
            const pendiente = itemOrden.cantidad_solicitada - (recibidoPrevio.get(itemOrden.id) ?? 0);
            if (item.cantidad_recibida > pendiente) {
              throw new ServiceError(
                "CANTIDAD_EXCEDE_PENDIENTE",
                `La cantidad recibida supera el pendiente del ítem ${itemOrden.id}`,
              );
            }
          }

          const recibidoEnEstaOperacion = new Map(
            input.items.map((item) => [item.orden_compra_item_id, item.cantidad_recibida]),
          );
          const estadoNuevo = determinarEstadoFisicoOrden(
            orden.items.map((item) => ({
              cantidad_solicitada: item.cantidad_solicitada,
              cantidad_recibida_previa: recibidoPrevio.get(item.id) ?? 0,
              cantidad_recibida_actual: recibidoEnEstaOperacion.get(item.id) ?? 0,
            })),
          );
          const recepcionId = randomUUID();

          await tx.recepcion.create({
            data: {
              id: recepcionId,
              orden_compra_id: orden.id,
              deposito_destino_id: input.deposito_destino_id,
              clave_idempotencia: input.clave_idempotencia,
              payload_hash: payloadHash,
              numero_remito_proveedor: input.numero_remito_proveedor ?? null,
              recibida_por_id: usuarioId,
              observaciones: input.observaciones ?? null,
              items: {
                create: input.items.map((item) => ({
                  orden_compra_item_id: item.orden_compra_item_id,
                  cantidad_recibida: item.cantidad_recibida,
                  cantidad_aceptada: item.cantidad_aceptada,
                  discrepancias: { create: item.discrepancias },
                })),
              },
            },
          });

          const aceptadoPorVariante = new Map<string, number>();
          for (const item of input.items) {
            if (item.cantidad_aceptada === 0) continue;
            const varianteId = itemOrdenPorId.get(item.orden_compra_item_id)!.variante_sku_id;
            aceptadoPorVariante.set(
              varianteId,
              (aceptadoPorVariante.get(varianteId) ?? 0) + item.cantidad_aceptada,
            );
          }

          let itemsStock: ResultadoTransaccion["itemsStock"] = [];
          if (aceptadoPorVariante.size > 0) {
            const movimiento = await registrarIngresoStockTx(
              tx,
              {
                deposito_destino_id: input.deposito_destino_id,
                comprobante_referencia: recepcionId,
                items: [...aceptadoPorVariante].map(([variante_sku_id, cantidad]) => ({
                  variante_sku_id,
                  cantidad,
                  estado_destino: "DISPONIBLE" as const,
                })),
              },
              usuarioId,
              { recepcionId },
            );
            itemsStock = movimiento.items.map((item) => ({
              variante_sku_id: item.variante_sku_id,
              cantidad: item.cantidad,
              estado_destino: item.estado_destino,
              cantidad_resultante: item.stock_resultante.cantidad,
            }));
          }

          const cambioEstado = await tx.ordenCompra.updateMany({
            where: {
              id: orden.id,
              estado: orden.estado,
              is_active: true,
              deleted_at: null,
            },
            data: { estado: estadoNuevo },
          });
          if (cambioEstado.count !== 1) {
            throw new ServiceError(
              "CONFLICTO_CONCURRENCIA",
              "La orden cambió durante la recepción; reintentá la operación",
            );
          }

          const recepcion = await tx.recepcion.findUniqueOrThrow({
            where: { id: recepcionId },
            select: RECEPCION_RESULTADO_SELECT,
          });
          return {
            recepcion,
            creada: true,
            estadoAnterior: orden.estado as "CONFIRMADA" | "RECEPCION_PARCIAL",
            estadoNuevo,
            itemsStock,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    const esColisionIdempotencia =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (esColisionIdempotencia) {
      const repeticionConcurrente = await resolverRepeticion(input.clave_idempotencia, payloadHash);
      if (repeticionConcurrente) return repeticionConcurrente;
    }
    throw error;
  }

  if (!resultado.creada) {
    return mapearResultado(resultado.recepcion, true, "NO_REEJECUTADA");
  }

  domainEventBus.emit("recepcion:registrada", construirPayloadRecepcionRegistrada({
    recepcion_id: resultado.recepcion.id,
    orden_compra_id: resultado.recepcion.orden_compra_id,
    numero_orden: resultado.recepcion.orden_compra.numero_orden,
    deposito_destino_id: resultado.recepcion.deposito_destino_id,
    recibida_por_id: usuarioId,
    fecha_recepcion: resultado.recepcion.fecha_recepcion,
    estado_anterior_oc: resultado.estadoAnterior,
    estado_nuevo_oc: resultado.estadoNuevo,
  }));

  if (resultado.recepcion.movimiento_stock) {
    domainEventBus.emit("inventario:ingreso_stock_registrado", {
      movimiento_id: resultado.recepcion.movimiento_stock.id,
      deposito_destino_id: resultado.recepcion.deposito_destino_id,
      items: resultado.itemsStock,
      usuario_id: usuarioId,
    });
  }

  let estadoEvaluacion: RecepcionRegistrada["evaluacion_proveedor"] = "REGISTRADA";
  try {
    await dependencias.registrarEvaluacion(resultado.recepcion.id, usuarioId);
  } catch (error) {
    estadoEvaluacion = "FALLO";
    console.error("[HU-H4] Falló la evaluación post-commit de la recepción", {
      recepcion_id: resultado.recepcion.id,
      orden_compra_id: resultado.recepcion.orden_compra_id,
      error,
    });
  }

  return mapearResultado(resultado.recepcion, false, estadoEvaluacion);
}

export async function registrarRecepcion(
  input: RegistrarRecepcionServiceInput,
  usuarioId: string,
): Promise<RecepcionRegistrada> {
  return registrarRecepcionConDependencias(
    input,
    usuarioId,
    DEPENDENCIAS_RECEPCION,
  );
}

export async function listarDepositosParaRecepcion() {
  return prisma.deposito.findMany({
    where: { is_active: true, deleted_at: null },
    select: { id: true, nombre: true, tipo: true },
    orderBy: { nombre: "asc" },
  });
}

export async function listarOrdenesRecepcionables() {
  const ordenes = await prisma.ordenCompra.findMany({
    where: {
      estado: { in: ESTADOS_RECEPCION_HABILITADOS },
      is_active: true,
      deleted_at: null,
    },
    select: {
      id: true,
      numero_orden: true,
      estado: true,
      proveedor: { select: { razon_social: true } },
      items: {
        where: { is_active: true, deleted_at: null },
        select: {
          id: true,
          cantidad_solicitada: true,
          variante_sku: {
            select: {
              sku: true,
              producto_maestro: { select: { nombre: true } },
            },
          },
          recepcion_items: {
            where: {
              is_active: true,
              deleted_at: null,
              recepcion: { is_active: true, deleted_at: null },
            },
            select: { cantidad_recibida: true },
          },
        },
      },
    },
    orderBy: { created_at: "asc" },
  });

  return ordenes.map((orden) => ({
    orden_compra_id: orden.id,
    numero_orden: orden.numero_orden,
    estado: orden.estado,
    proveedor: orden.proveedor.razon_social,
    items: orden.items.map((item) => {
      const cantidadRecibida = item.recepcion_items.reduce(
        (total, recepcion) => total + recepcion.cantidad_recibida,
        0,
      );
      return {
        orden_compra_item_id: item.id,
        sku: item.variante_sku.sku,
        producto: item.variante_sku.producto_maestro.nombre,
        cantidad_solicitada: item.cantidad_solicitada,
        cantidad_recibida: cantidadRecibida,
        cantidad_pendiente: Math.max(0, item.cantidad_solicitada - cantidadRecibida),
      };
    }),
  })).filter((orden) => orden.items.some((item) => item.cantidad_pendiente > 0));
}
