import "server-only";

/**
 * @module comprobante-fiscal.service
 * @description Alcance MÍNIMO de HU-B7 (spec_modulo_B.md §2.7), extraído
 * dentro de esta rama de HU-B1 porque el comprobante se emite dentro de la
 * MISMA transacción de cobro de mostrador (docs/tasks/task_relos.md §0.2/§0.3)
 * — B1 no puede dejar ninguna venta facturada sin su comprobante.
 *
 * Cubre ÚNICAMENTE: generación de CAE simulado (14 dígitos, determinístico) +
 * QR simulado (codificado 100% local, sin llamada de red) + persistencia en
 * `ComprobanteFiscal` con `es_simulado: true`. NO implementa la máquina de
 * estados de facturación parcial/remitos (`RESERVADO → FACTURADO` parcial,
 * `FACTURADO ⇄ REMITO_EMITIDO`, cierre a `CERRADO`) — eso es responsabilidad
 * exclusiva de la futura rama de HU-B7 completa (task §0.3).
 *
 * Directiva del PO (nota inicial de spec_modulo_B.md): SIN integración real
 * con AFIP bajo ninguna circunstancia — CAE y QR son enteramente locales.
 *
 * `emitirComprobanteFiscal()` recibe un `Prisma.TransactionClient` externo a
 * propósito: participa en la MISMA `$transaction` que crea el `PedidoVenta` +
 * `PedidoVentaItem` + `VentaMedioPago` en `venta-mostrador.service.ts` (nunca
 * abre la suya propia) — reutilizable tal cual por HU-B7 cuando esa rama
 * exista, pasándole su propio `tx`.
 */

import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { TipoComprobanteVenta, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

/**
 * CUIT del emisor simulado — no existe hoy en el schema ninguna entidad de
 * "Empresa"/configuración de la organización emisora (relevamiento
 * confirmado: sin `model Empresa` ni campo equivalente en todo el proyecto).
 * Constante de placeholder, mismo criterio que el resto de valores
 * "pendientes de validar" del módulo — documentado en
 * `docs/tasks/task_relos.md`. Formato válido de CUIT (11 dígitos), sin
 * pretender ser un CUIT real.
 */
const CUIT_EMISOR_SIMULADO = "30000000007";

export interface ComprobanteFiscalEmitido {
  comprobante_id: string;
  tipo_comprobante: TipoComprobanteVenta;
  cae_simulado: string;
  qr_data_url: string;
  es_simulado: true;
}

/**
 * Genera un CAE simulado de 14 dígitos, determinístico: hash SHA-256 de
 * `pedido_venta_id + timestamp`, truncado a los primeros 14 dígitos
 * numéricos del hex convertido a `BigInt`. NO proviene de ninguna
 * autorización externa (spec §2.7) — nunca usar como constancia fiscal
 * válida fuera del sistema.
 */
function generarCaeSimulado(pedidoVentaId: string, timestamp: string): string {
  const hash = createHash("sha256").update(`${pedidoVentaId}:${timestamp}`).digest("hex");
  const numerico = BigInt(`0x${hash.slice(0, 16)}`) % BigInt("100000000000000");
  return numerico.toString().padStart(14, "0");
}

/**
 * Construye el payload de datos típico de un comprobante electrónico
 * argentino (CUIT emisor, tipo y número de comprobante, importe, CAE) y lo
 * codifica como QR local (`data:image/png;base64,...`), sin llamada de red
 * (spec §2.7). `numero_venta` hace las veces de "número de comprobante" —
 * el schema de este módulo no modela punto de venta/numeración fiscal
 * propia, separada del número de venta interno (`PedidoVenta.numero_venta`),
 * documentado como simplificación en `docs/tasks/task_relos.md`.
 */
async function generarQrSimulado(params: {
  cuitEmisor: string;
  tipoComprobante: TipoComprobanteVenta;
  numeroVenta: string;
  montoTotal: number;
  caeSimulado: string;
}): Promise<string> {
  const payload = {
    ver: 1,
    simulado: true,
    cuitEmisor: params.cuitEmisor,
    tipoComprobante: params.tipoComprobante,
    numeroComprobante: params.numeroVenta,
    importe: params.montoTotal,
    moneda: "PES",
    cae: params.caeSimulado,
  };
  // Codificación 100% local (librería `qrcode`, sin llamada de red).
  return QRCode.toDataURL(JSON.stringify(payload), { errorCorrectionLevel: "M" });
}

/**
 * Emite un comprobante fiscal simulado y lo persiste en `ComprobanteFiscal`
 * (`es_simulado: true`, sin bloque de soft delete — spec §3.4: la única
 * entidad del módulo sin baja lógica en absoluto, su reversión es siempre
 * una Nota de Crédito nueva).
 *
 * Reutilizable por HU-B7 a futuro (facturación parcial de HU-B3): recibe
 * `pedido_venta_id` / `tipo_comprobante` / `monto_total` como parámetros
 * explícitos, sin acoplarse a la forma completa de un `PedidoVenta` de venta
 * de mostrador.
 */
export async function emitirComprobanteFiscal(
  tx: Prisma.TransactionClient,
  params: {
    pedido_venta_id: string;
    numero_venta: string;
    tipo_comprobante: TipoComprobanteVenta;
    monto_total: number;
    emitido_por_id: string;
  },
): Promise<ComprobanteFiscalEmitido> {
  const comprobanteId = randomUUID();
  const timestamp = new Date().toISOString();
  const caeSimulado = generarCaeSimulado(params.pedido_venta_id, timestamp);
  const qrDataUrl = await generarQrSimulado({
    cuitEmisor: CUIT_EMISOR_SIMULADO,
    tipoComprobante: params.tipo_comprobante,
    numeroVenta: params.numero_venta,
    montoTotal: params.monto_total,
    caeSimulado,
  });

  await tx.comprobanteFiscal.create({
    data: {
      id: comprobanteId,
      pedido_venta_id: params.pedido_venta_id,
      tipo_comprobante: params.tipo_comprobante,
      cae_simulado: caeSimulado,
      qr_data_url: qrDataUrl,
      es_simulado: true,
      monto_total: params.monto_total,
      emitido_por_id: params.emitido_por_id,
    },
  });

  return {
    comprobante_id: comprobanteId,
    tipo_comprobante: params.tipo_comprobante,
    cae_simulado: caeSimulado,
    qr_data_url: qrDataUrl,
    es_simulado: true,
  };
}

export interface EmitirNotaCreditoReintegroInput {
  reintegro_id: string;
  pedido_venta_id: string;
  comprobante_original_id: string;
  emitido_por_id: string;
}

export type NotaCreditoReintegroResultado = {
  resultado: "CREADO" | "YA_EXISTENTE";
  nota_credito_id: string;
  comprobante_original_id: string;
  pedido_venta_id: string;
  monto_total: number;
};

type PedidoNotaCreditoBloqueado = {
  id: string;
  numero_venta: string;
  canal: "MOSTRADOR" | "WEB";
  estado: "RESERVADO" | "FACTURADO" | "REMITO_EMITIDO" | "CERRADO" | "ANULADO";
  total: Prisma.Decimal;
  is_active: boolean;
  deleted_at: Date | null;
};

type ReintegroNotaCreditoBloqueado = {
  id: string;
  pedido_venta_id: string;
  monto_total: Prisma.Decimal;
  nota_credito_id: string | null;
};

export async function emitirNotaCreditoReintegroPedidoWebTx(
  tx: Prisma.TransactionClient,
  input: EmitirNotaCreditoReintegroInput,
): Promise<NotaCreditoReintegroResultado> {
  const pedidos = await tx.$queryRaw<PedidoNotaCreditoBloqueado[]>`
    SELECT id, numero_venta, canal, estado, total, is_active, deleted_at
    FROM pedidos_venta
    WHERE id = ${input.pedido_venta_id}
    FOR UPDATE
  `;
  const pedido = pedidos[0];
  if (!pedido || pedido.canal !== "WEB" || pedido.estado !== "FACTURADO") {
    throw new ServiceError("PEDIDO_NO_APTO_NOTA_CREDITO", "El pedido no admite una Nota de Crédito HU-E13");
  }

  const reintegros = await tx.$queryRaw<ReintegroNotaCreditoBloqueado[]>`
    SELECT id, pedido_venta_id, monto_total, nota_credito_id
    FROM reintegros_pedido_web
    WHERE id = ${input.reintegro_id}
    FOR UPDATE
  `;
  const reintegro = reintegros[0];
  if (!reintegro || reintegro.pedido_venta_id !== pedido.id) {
    throw new ServiceError("REINTEGRO_INCOMPATIBLE", "El reintegro no pertenece al pedido indicado");
  }

  const original = await tx.comprobanteFiscal.findUnique({ where: { id: input.comprobante_original_id } });
  if (
    !original ||
    original.pedido_venta_id !== pedido.id ||
    original.tipo_comprobante === TipoComprobanteVenta.NOTA_CREDITO
  ) {
    throw new ServiceError("COMPROBANTE_ORIGINAL_INVALIDO", "El comprobante original no es válido para el reintegro");
  }
  if (!reintegro.monto_total.equals(pedido.total) || !original.monto_total.equals(pedido.total)) {
    throw new ServiceError("MONTO_REINTEGRO_INVALIDO", "El reintegro debe ser total");
  }

  if (reintegro.nota_credito_id) {
    const existente = await tx.comprobanteFiscal.findUnique({ where: { id: reintegro.nota_credito_id } });
    if (
      !existente ||
      existente.tipo_comprobante !== TipoComprobanteVenta.NOTA_CREDITO ||
      existente.pedido_venta_id !== pedido.id ||
      existente.comprobante_original_id !== original.id ||
      !existente.monto_total.equals(pedido.total)
    ) {
      throw new ServiceError("NOTA_CREDITO_INCONSISTENTE", "La Nota de Crédito vinculada no cumple el contrato HU-E13");
    }
    return {
      resultado: "YA_EXISTENTE",
      nota_credito_id: existente.id,
      comprobante_original_id: original.id,
      pedido_venta_id: pedido.id,
      monto_total: existente.monto_total.toNumber(),
    };
  }

  const notaCreditoId = randomUUID();
  const timestamp = new Date().toISOString();
  const caeSimulado = generarCaeSimulado(pedido.id, timestamp);
  const qrDataUrl = await generarQrSimulado({
    cuitEmisor: CUIT_EMISOR_SIMULADO,
    tipoComprobante: TipoComprobanteVenta.NOTA_CREDITO,
    numeroVenta: `NC-${pedido.numero_venta}`,
    montoTotal: pedido.total.toNumber(),
    caeSimulado,
  });

  await tx.comprobanteFiscal.create({
    data: {
      id: notaCreditoId,
      pedido_venta_id: pedido.id,
      tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO,
      cae_simulado: caeSimulado,
      qr_data_url: qrDataUrl,
      es_simulado: true,
      monto_total: pedido.total,
      emitido_por_id: input.emitido_por_id,
      comprobante_original_id: original.id,
    },
  });
  const vinculo = await tx.reintegroPedidoWeb.updateMany({
    where: { id: reintegro.id, pedido_venta_id: pedido.id, nota_credito_id: null },
    data: { nota_credito_id: notaCreditoId },
  });
  if (vinculo.count !== 1) {
    throw new ServiceError("REINTEGRO_MODIFICADO", "El reintegro cambió durante la emisión de la Nota de Crédito");
  }

  return {
    resultado: "CREADO",
    nota_credito_id: notaCreditoId,
    comprobante_original_id: original.id,
    pedido_venta_id: pedido.id,
    monto_total: pedido.total.toNumber(),
  };
}

export async function emitirNotaCreditoReintegroPedidoWeb(
  input: EmitirNotaCreditoReintegroInput,
): Promise<NotaCreditoReintegroResultado> {
  return prisma.$transaction((tx) => emitirNotaCreditoReintegroPedidoWebTx(tx, input));
}

export interface ComprobanteFiscalConsultado {
  comprobante_id: string;
  pedido_venta_id: string;
  tipo_comprobante: TipoComprobanteVenta;
  cae_simulado: string;
  qr_data_url: string;
  es_simulado: boolean;
  monto_total: number;
}

/**
 * Consulta de un comprobante ya emitido (spec §2.7; task_relos.md §0.3 —
 * único endpoint pendiente de esta HU, la emisión ya quedó resuelta en
 * HU-B1). Sin lógica de negocio más allá de la búsqueda: el comprobante es
 * inmutable desde su emisión (spec §3.4, sin bloque de soft-delete), no hay
 * nada que recalcular ni derivar acá — el Route Handler solo mapea el
 * resultado/excepción (task §3.4).
 */
export async function obtenerComprobantePorId(id: string): Promise<ComprobanteFiscalConsultado> {
  const comprobante = await prisma.comprobanteFiscal.findUnique({ where: { id } });
  if (!comprobante) {
    throw new ServiceError("COMPROBANTE_NO_ENCONTRADO", "No se encontró el comprobante solicitado");
  }

  return {
    comprobante_id: comprobante.id,
    pedido_venta_id: comprobante.pedido_venta_id,
    tipo_comprobante: comprobante.tipo_comprobante,
    cae_simulado: comprobante.cae_simulado,
    qr_data_url: comprobante.qr_data_url,
    es_simulado: comprobante.es_simulado,
    monto_total: comprobante.monto_total.toNumber(),
  };
}
