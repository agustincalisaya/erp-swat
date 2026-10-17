import "server-only";

/**
 * @module comprobantes-repositorio.service
 * @description Capa de dominio de HU-G3 (spec_modulo_G.md §9.5) — repositorio
 * digital de los `ComprobanteFiscal` ya emitidos por HU-B7, de mostrador y de
 * la tienda web. SOLO LECTURA (G3-1/G3-5): no emite, no copia, no corrige ni
 * da de baja comprobantes; la reversión es siempre una Nota de Crédito nueva
 * (B7/E13). No escribe `AuditLog` ni emite eventos: no hay cambio de estado.
 *
 * Estructura (§9.5, reutilización por HU-G4):
 *  - `construirWhereComprobantes` + `consultarComprobantes`: núcleo SIN
 *    paginar, con proyección parametrizable. HU-G4 lo reutiliza con su propia
 *    proyección fiscal para el libro completo, sin pasar por la API paginada.
 *  - `listarComprobantes`: versión paginada para `GET /api/tesoreria/comprobantes`.
 *  - `obtenerDetalleComprobante` / `obtenerComprobanteParaPdf`: un comprobante
 *    por `id`, con su original y sus Notas de Crédito.
 *
 * Datos del modelo (schema.prisma, `ComprobanteFiscal`): no tiene canal,
 * cliente ni fecha de emisión propios. Canal y cliente salen de
 * `pedido_venta`; la fecha de emisión es `created_at` (decisión de negocio 2).
 * Tampoco tiene número fiscal propio: se usa la misma convención con la que
 * HU-B7 arma el QR (`numero_venta`, y `NC-<numero_venta>` para la Nota de
 * Crédito, `comprobante-fiscal.service.ts:86,245`). El vínculo NC ↔ original
 * sale SIEMPRE de `comprobante_original_id` (G3-4), nunca del número.
 *
 * `ComprobanteFiscal` no tiene soft delete; se listan también los
 * comprobantes de pedidos anulados, porque el documento fiscal emitido sigue
 * existiendo (su reversión es una NC).
 */

import type { CanalVenta, Prisma, TipoComprobanteVenta } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { rangoDiasNegocio } from "@/lib/utils/fecha-negocio";
import {
  SELECT_DETALLE_PDF,
  detallePdfDePedido,
  type ComprobanteFiscalPdf,
} from "@/lib/services/ecommerce/comprobante-web-pdf";

// ──────────────────────────────────────────────────────────────────────────────
// Permiso (spec_modulo_G.md §9.1 / G3-6) — punto de verdad para rutas y página
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_LEER_COMPROBANTES = "tesoreria:leer_comprobantes";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

/** Filtros combinables de G3-2 (sin paginación). */
export interface FiltrosComprobantes {
  /** DNI exacto, con o sin puntos, o nombre (parcial, sin distinguir mayúsculas). */
  cliente?: string;
  /** Día de Argentina `AAAA-MM-DD`, incluido. */
  fecha_desde?: string;
  /** Día de Argentina `AAAA-MM-DD`, incluido. */
  fecha_hasta?: string;
  tipo?: TipoComprobanteVenta;
  canal?: CanalVenta;
}

export interface FiltrosListadoComprobantes extends FiltrosComprobantes {
  page: number;
  page_size: number;
}

/** Comprobante vinculado (original de una NC, o NC de un original). */
export interface ComprobanteVinculado {
  comprobante_id: string;
  tipo_comprobante: TipoComprobanteVenta;
  numero: string;
}

export interface ComprobanteResumen {
  comprobante_id: string;
  numero: string;
  tipo_comprobante: TipoComprobanteVenta;
  canal: CanalVenta;
  /** Solo DNI y nombre; sin cliente → `{ dni: null, nombre: "Consumidor final" }`. */
  cliente: { dni: string | null; nombre: string };
  /** `created_at` del comprobante, ISO 8601 (instante UTC). */
  fecha_emision: string;
  /** `Decimal` serializado con `.toFixed(2)` — nunca `number`. */
  monto_total: string;
  es_simulado: boolean;
  comprobante_original: ComprobanteVinculado | null;
  notas_credito: ComprobanteVinculado[];
}

export interface ComprobanteDetalle extends ComprobanteResumen {
  cae_simulado: string;
}

export interface ListadoComprobantes {
  registros: ComprobanteResumen[];
  total: number;
  page: number;
  page_size: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Núcleo sin paginar (reutilizable por HU-G4)
// ──────────────────────────────────────────────────────────────────────────────

/** Orden estable de G3-2: más recientes primero, desempate por `id`. */
export const ORDEN_COMPROBANTES = [{ created_at: "desc" }, { id: "desc" }] satisfies Prisma.ComprobanteFiscalOrderByWithRelationInput[];

const CONSUMIDOR_FINAL = "Consumidor final";

/**
 * Período de emisión en hora de Argentina, ambos días incluidos
 * (`[desde 00:00 AR, hasta+1 00:00 AR)`). Con un solo extremo, el rango queda
 * abierto del otro lado.
 */
function filtroEmision(desde?: string, hasta?: string): Prisma.DateTimeFilter | undefined {
  if (!desde && !hasta) return undefined;
  try {
    const rango = rangoDiasNegocio(desde ?? hasta!, hasta ?? desde!);
    return { ...(desde && { gte: rango.desde }), ...(hasta && { lt: rango.hasta }) };
  } catch (error) {
    if (error instanceof RangeError) throw new ServiceError("FILTRO_INVALIDO", error.message);
    throw error;
  }
}

/**
 * DNI exacto, con o sin puntos: se quitan puntos, espacios y guiones y, si
 * quedan solo dígitos, se filtra por `dni` (que `Cliente` guarda sin puntos).
 * Si no, nombre parcial sin distinguir mayúsculas con el texto original.
 */
function filtroCliente(cliente?: string): Prisma.ClienteWhereInput | undefined {
  const texto = cliente?.trim();
  if (!texto) return undefined;
  const dni = texto.replace(/[.\s-]/g, "");
  return /^\d+$/.test(dni) ? { dni } : { nombre: { contains: texto, mode: "insensitive" } };
}

/** `where` de G3-2. Lo comparten el listado, su conteo y HU-G4. */
export function construirWhereComprobantes(filtros: FiltrosComprobantes): Prisma.ComprobanteFiscalWhereInput {
  const created_at = filtroEmision(filtros.fecha_desde, filtros.fecha_hasta);
  const cliente = filtroCliente(filtros.cliente);
  const pedido_venta: Prisma.PedidoVentaWhereInput = {
    ...(filtros.canal && { canal: filtros.canal }),
    ...(cliente && { cliente }),
  };
  return {
    ...(filtros.tipo && { tipo_comprobante: filtros.tipo }),
    ...(created_at && { created_at }),
    ...(Object.keys(pedido_venta).length > 0 && { pedido_venta }),
  };
}

/**
 * Consulta base SIN paginar: aplica los filtros y el orden de G3-2 con la
 * proyección que pida el llamador. `paginacion` es opcional para que la
 * versión paginada no duplique el `where` ni el orden.
 */
export async function consultarComprobantes<S extends Prisma.ComprobanteFiscalSelect>(
  filtros: FiltrosComprobantes,
  select: S,
  paginacion: { skip?: number; take?: number } = {},
): Promise<Prisma.ComprobanteFiscalGetPayload<{ select: S }>[]> {
  return prisma.comprobanteFiscal.findMany({
    where: construirWhereComprobantes(filtros),
    orderBy: ORDEN_COMPROBANTES,
    select,
    ...paginacion,
  }) as Promise<Prisma.ComprobanteFiscalGetPayload<{ select: S }>[]>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Proyección del repositorio (listado y detalle)
// ──────────────────────────────────────────────────────────────────────────────

const SELECT_VINCULADO = {
  id: true,
  tipo_comprobante: true,
  pedido_venta: { select: { numero_venta: true } },
} satisfies Prisma.ComprobanteFiscalSelect;

const SELECT_RESUMEN = {
  id: true,
  tipo_comprobante: true,
  es_simulado: true,
  monto_total: true,
  comprobante_original_id: true,
  created_at: true,
  pedido_venta: {
    select: {
      numero_venta: true,
      canal: true,
      // Minimización de datos (G3-2): solo DNI y nombre del cliente.
      cliente: { select: { dni: true, nombre: true } },
    },
  },
  comprobante_original: { select: SELECT_VINCULADO },
  notas_credito: { select: SELECT_VINCULADO, orderBy: ORDEN_COMPROBANTES },
} satisfies Prisma.ComprobanteFiscalSelect;

const SELECT_COMPLETO = {
  ...SELECT_RESUMEN,
  cae_simulado: true,
  qr_data_url: true,
} satisfies Prisma.ComprobanteFiscalSelect;

/**
 * HU-B10 (spec_modulo_B.md §2.10) — lo del detalle más los ítems y pagos del
 * pedido y la fecha del original, solo para el PDF. Sigue siendo una única
 * lectura (`findUnique`).
 */
const SELECT_PDF = {
  ...SELECT_COMPLETO,
  pedido_venta: { select: SELECT_DETALLE_PDF },
  comprobante_original: { select: { ...SELECT_VINCULADO, created_at: true } },
} satisfies Prisma.ComprobanteFiscalSelect;

type FilaResumen = Prisma.ComprobanteFiscalGetPayload<{ select: typeof SELECT_RESUMEN }>;
type FilaVinculada = Prisma.ComprobanteFiscalGetPayload<{ select: typeof SELECT_VINCULADO }>;

/** Número visible del comprobante, con la convención de HU-B7 (ver docstring del módulo). */
export function numeroComprobante(tipo: TipoComprobanteVenta, numeroVenta: string): string {
  return tipo === "NOTA_CREDITO" ? `NC-${numeroVenta}` : numeroVenta;
}

function aVinculado(fila: FilaVinculada): ComprobanteVinculado {
  return {
    comprobante_id: fila.id,
    tipo_comprobante: fila.tipo_comprobante,
    numero: numeroComprobante(fila.tipo_comprobante, fila.pedido_venta.numero_venta),
  };
}

function aResumen(fila: FilaResumen): ComprobanteResumen {
  const cliente = fila.pedido_venta.cliente;
  return {
    comprobante_id: fila.id,
    numero: numeroComprobante(fila.tipo_comprobante, fila.pedido_venta.numero_venta),
    tipo_comprobante: fila.tipo_comprobante,
    canal: fila.pedido_venta.canal,
    cliente: cliente ? { dni: cliente.dni, nombre: cliente.nombre } : { dni: null, nombre: CONSUMIDOR_FINAL },
    fecha_emision: fila.created_at.toISOString(),
    monto_total: fila.monto_total.toFixed(2),
    es_simulado: fila.es_simulado,
    comprobante_original: fila.comprobante_original ? aVinculado(fila.comprobante_original) : null,
    notas_credito: fila.notas_credito.map(aVinculado),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API pública del repositorio
// ──────────────────────────────────────────────────────────────────────────────

/** Listado paginado en base para `GET /api/tesoreria/comprobantes` (G3-1/G3-2). */
export async function listarComprobantes(filtros: FiltrosListadoComprobantes): Promise<ListadoComprobantes> {
  const where = construirWhereComprobantes(filtros);
  const [filas, total] = await Promise.all([
    consultarComprobantes(filtros, SELECT_RESUMEN, {
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
    }),
    prisma.comprobanteFiscal.count({ where }),
  ]);
  return { registros: filas.map(aResumen), total, page: filtros.page, page_size: filtros.page_size };
}

async function buscarComprobante<S extends typeof SELECT_COMPLETO>(id: string, select: S) {
  const fila = await prisma.comprobanteFiscal.findUnique({ where: { id }, select });
  if (!fila) throw new ServiceError("COMPROBANTE_NO_ENCONTRADO", "No se encontró el comprobante solicitado");
  return fila as Prisma.ComprobanteFiscalGetPayload<{ select: S }>;
}

/** Detalle de un comprobante con su original (si es NC) y sus NC (si es original) — G3-4. */
export async function obtenerDetalleComprobante(id: string): Promise<ComprobanteDetalle> {
  const fila = await buscarComprobante(id, SELECT_COMPLETO);
  return { ...aResumen(fila), cae_simulado: fila.cae_simulado };
}

/**
 * DTO para `generarComprobanteFiscalPdf` (G3-3). Entrega el CAE y el QR tal
 * como los persistió HU-B7; la validez del QR la controla el generador de PDF.
 * HU-B10 suma número de venta, ítems, pagos y la fecha del original.
 */
export async function obtenerComprobanteParaPdf(id: string): Promise<ComprobanteFiscalPdf> {
  const fila = await buscarComprobante(id, SELECT_PDF);
  const resumen = aResumen(fila);
  const original = fila.comprobante_original;
  return {
    ...detallePdfDePedido(fila.pedido_venta),
    numero: resumen.numero,
    tipo: resumen.tipo_comprobante,
    canal: resumen.canal,
    fecha_emision: resumen.fecha_emision,
    monto: resumen.monto_total,
    cae_simulado: fila.cae_simulado,
    qr_data_url: fila.qr_data_url,
    es_simulado: fila.es_simulado,
    cliente: resumen.cliente,
    comprobante_original: original
      ? {
          numero: numeroComprobante(original.tipo_comprobante, original.pedido_venta.numero_venta),
          tipo: original.tipo_comprobante,
          numero_venta: original.pedido_venta.numero_venta,
          fecha_emision: original.created_at.toISOString(),
        }
      : null,
  };
}
