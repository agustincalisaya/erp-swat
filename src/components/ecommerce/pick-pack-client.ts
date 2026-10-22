/**
 * @module pick-pack-client
 * @description HU-E12 T09 — capa de cliente fina para la consola Pick&Pack.
 *
 * Contiene los tipos JSON de los DTOs T08, los wrappers `fetch` contra los
 * Route Handlers y la lógica pura testeable (gestión de `scan_id`, mensajes
 * de error, formateo). No duplica lógica de dominio: el backend sigue siendo
 * la fuente de verdad para estado, progreso e idempotencia.
 */

// Ruta relativa con extensión: módulo puro también importado por tests de Node (patrón de `evaluacion.calculo.ts`).
import { formatearFechaHoraNegocio } from "../../lib/utils/fecha-negocio.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos JSON (espejo de los DTOs del servicio — las fechas viajan serializadas)
// ──────────────────────────────────────────────────────────────────────────────

export interface VariantePreparacionJson {
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  talle?: string | null;
  color?: string | null;
  modelo?: string | null;
}

export interface LineaPreparacionJson {
  pedido_venta_item_id: string;
  variante: VariantePreparacionJson;
  cantidad_requerida: number;
  cantidad_confirmada: number;
  completa: boolean;
}

export interface ProgresoPreparacionJson {
  total_requerido: number;
  total_confirmado: number;
  porcentaje: number;
  completo: boolean;
}

/** Ítem de cola — proyección base, sin datos de pago (spec E §6.3 E14-2). */
export interface ItemColaPreparacionJson {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  /** HU-E14: solo el nombre; `null` = cliente no disponible. */
  cliente_nombre: string | null;
  fecha_pago_confirmado: string | null;
  prioridad_manual: number | null;
  estado_ecommerce: string;
  operador_asignado_id: string | null;
  /** HU-E14: suma de cantidades de ítems vigentes. */
  unidades_totales: number;
  lineas: LineaPreparacionJson[];
  progreso: ProgresoPreparacionJson;
}

/** Espejo del enum Prisma `MedioPagoVenta` (este módulo no importa Prisma). */
export type MedioPagoVentaJson =
  | "EFECTIVO"
  | "TRANSFERENCIA"
  | "E_CHEQ"
  | "MERCADO_PAGO"
  | "TARJETA"
  | "CUENTA_CORRIENTE";

/** HU-E14: `total` congelado como string de 2 decimales y medios registrados. */
export interface PagoColaPreparacionJson {
  total: string;
  medios: MedioPagoVentaJson[];
}

/** Ítem con pago — el servidor lo entrega solo con `ecommerce:leer_historial_ordenes`. */
export interface ItemColaPreparacionConPagoJson extends ItemColaPreparacionJson {
  pago: PagoColaPreparacionJson;
}

/** La UI decide por la presencia de la clave en el JSON, nunca por permiso. */
export function tieneDatosPago(
  item: ItemColaPreparacionJson | ItemColaPreparacionConPagoJson,
): item is ItemColaPreparacionConPagoJson {
  return "pago" in item;
}

export interface ColaPreparacionJson {
  items: Array<ItemColaPreparacionJson | ItemColaPreparacionConPagoJson>;
  total: number;
  page: number;
  page_size: number;
}

export interface ResultadoTomarJson {
  pedido_venta_id: string;
  operador_asignado_id: string;
  cambio_realizado: boolean;
}

export interface ResultadoPrioridadJson {
  pedido_venta_id: string;
  prioridad_manual: number | null;
  prioridad_anterior: number | null;
  cambio_realizado: boolean;
}

export interface ResultadoConfirmarJson {
  pedido_venta_item_id: string;
  variante_sku_id: string;
  scan_id: string;
  cantidad_confirmada: number;
  progreso: ProgresoPreparacionJson;
  idempotente: boolean;
  cambio_realizado: boolean;
}

export interface ResultadoCompletarJson {
  pedido_venta_id: string;
  estado_ecommerce: string;
  transicion_realizada: boolean;
  cambio_realizado: boolean;
  idempotente: boolean;
  plazo_retiro_vencimiento: string | null;
  progreso: ProgresoPreparacionJson;
}

export interface ResultadoRetiroJson {
  pedido_venta_id: string;
  numero: string;
  estado: "ENTREGADO";
}

// ──────────────────────────────────────────────────────────────────────────────
// Respuesta API uniforme `{ data, error }`
// ──────────────────────────────────────────────────────────────────────────────

export interface RespuestaApi<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: { code: string; message: string } | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function llamarApi<T>(
  fetchFn: FetchLike,
  url: string,
  init?: RequestInit,
): Promise<RespuestaApi<T>> {
  const respuesta = await fetchFn(url, init);
  let cuerpo: { data?: T | null; error?: { code: string; message: string } | null } = {};
  try {
    cuerpo = (await respuesta.json()) as typeof cuerpo;
  } catch {
    // Respuesta sin cuerpo JSON — se reporta como error genérico abajo.
  }
  return {
    ok: respuesta.ok && !cuerpo.error,
    status: respuesta.status,
    data: cuerpo.data ?? null,
    error: cuerpo.error ?? null,
  };
}

const fetchNativo: FetchLike = (url, init) => fetch(url, init);

// ──────────────────────────────────────────────────────────────────────────────
// Endpoints T08
// ──────────────────────────────────────────────────────────────────────────────

export function obtenerColaPreparacion(
  page: number,
  pageSize: number,
  fetchFn: FetchLike = fetchNativo,
): Promise<RespuestaApi<ColaPreparacionJson>> {
  return llamarApi(fetchFn, `/api/ecommerce/preparacion?page=${page}&page_size=${pageSize}`);
}

export function tomarPedidoApi(
  pedidoVentaId: string,
  fetchFn: FetchLike = fetchNativo,
): Promise<RespuestaApi<ResultadoTomarJson>> {
  return llamarApi(fetchFn, `/api/ecommerce/preparacion/${pedidoVentaId}/tomar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function cambiarPrioridadApi(
  pedidoVentaId: string,
  prioridad: number | null,
  fetchFn: FetchLike = fetchNativo,
): Promise<RespuestaApi<ResultadoPrioridadJson>> {
  return llamarApi(fetchFn, `/api/ecommerce/preparacion/${pedidoVentaId}/prioridad`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prioridad_manual: prioridad }),
  });
}

export function completarPreparacionApi(
  pedidoVentaId: string,
  fetchFn: FetchLike = fetchNativo,
): Promise<RespuestaApi<ResultadoCompletarJson>> {
  return llamarApi(fetchFn, `/api/ecommerce/preparacion/${pedidoVentaId}/completar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function confirmarScanApi(
  pedidoVentaId: string,
  scanId: string,
  codigo: string,
  fetchFn: FetchLike = fetchNativo,
): Promise<RespuestaApi<ResultadoConfirmarJson>> {
  return llamarApi(fetchFn, `/api/ecommerce/preparacion/${pedidoVentaId}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scan_id: scanId, codigo }),
  });
}

/** E3: el token y DNI viajan únicamente en el body POST. */
export function validarRetiroApi(
  qr_token: string,
  dni: string,
  fetchFn: FetchLike = fetchNativo,
): Promise<RespuestaApi<ResultadoRetiroJson>> {
  return llamarApi(fetchFn, "/api/ecommerce/preparacion/validar-retiro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ qr_token, dni }),
  });
}

/** Nunca usa el mensaje o motivo recibido del servidor para un rechazo sensible. */
export function mensajeErrorRetiro(status: number): string {
  if (status === 400) return "Revisá el QR y el DNI ingresados.";
  if (status === 401) return "Tu sesión expiró. Volvé a iniciar sesión.";
  if (status === 403) return "No tenés permisos para validar retiros.";
  if (status === 422) return "No fue posible validar el retiro";
  if (status === 0) return "Sin conexión con el servidor. Reintentá.";
  return "Ocurrió un error interno. Reintentá más tarde.";
}

// ──────────────────────────────────────────────────────────────────────────────
// Escaneo con retry técnico — el MISMO scan_id se conserva entre reintentos
// de la misma lectura física (idempotencia backend); una lectura física nueva
// siempre genera un scan_id nuevo (cada llamada a `ejecutarEscaneo` crea uno).
// ──────────────────────────────────────────────────────────────────────────────

export interface OpcionesEscaneo {
  /** Reintentos adicionales ante fallo de red/timeout (default 2). */
  reintentos?: number;
  fetchFn?: FetchLike;
  /** Inyectable para tests — en producción es `crypto.randomUUID`. */
  generarUuid?: () => string;
}

export interface ResultadoEscaneo extends RespuestaApi<ResultadoConfirmarJson> {
  /** Fallo de transporte (fetch rechazó), sin respuesta HTTP. */
  errorRed: boolean;
}

export async function ejecutarEscaneo(
  pedidoVentaId: string,
  codigo: string,
  opciones: OpcionesEscaneo = {},
): Promise<ResultadoEscaneo> {
  const {
    reintentos = 2,
    fetchFn = fetchNativo,
    generarUuid = () => crypto.randomUUID(),
  } = opciones;

  // El scan_id nace con la lectura física y NO se regenera en reintentos.
  const scanId = generarUuid();
  let ultimoError: unknown = null;

  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const resultado = await confirmarScanApi(pedidoVentaId, scanId, codigo, fetchFn);
      return { ...resultado, errorRed: false };
    } catch (error) {
      ultimoError = error;
    }
  }

  return {
    ok: false,
    status: 0,
    data: null,
    error: {
      code: "ERROR_RED",
      message:
        ultimoError instanceof Error ? ultimoError.message : "No se pudo contactar al servidor.",
    },
    errorRed: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mensajes de error seguros — nunca expone stack/SQL/PII ni datos del
// scan_id original (SCAN_ID_CONFLICTO es deliberadamente genérico).
// ──────────────────────────────────────────────────────────────────────────────

const MENSAJES_409: Record<string, string> = {
  CODIGO_NO_PERTENECE_PEDIDO: "El producto escaneado no pertenece a este pedido.",
  CANTIDAD_YA_COMPLETA: "La cantidad requerida de este producto ya fue completada.",
  SCAN_ID_CONFLICTO: "Conflicto de escaneo. Reintentá la lectura.",
  PEDIDO_YA_TOMADO: "Otro operador ya tomó este pedido.",
  CONCURRENCIA_ASIGNACION: "Otro operador ya tomó este pedido.",
  PEDIDO_NO_ASIGNADO: "El pedido no está asignado a tu usuario.",
  ESTADO_INVALIDO: "El pedido no está en un estado operable.",
  PREPARACION_INCOMPLETA: "Todavía faltan unidades por confirmar.",
  CODIGO_NO_RESUELTO: "El código escaneado no corresponde a un producto registrado.",
};

export function mensajeErrorPickPack(status: number, code?: string | null): string {
  if (status === 400) return "Los datos enviados no son válidos.";
  if (status === 401) return "Tu sesión expiró. Volvé a iniciar sesión.";
  if (status === 403) return "No tenés permisos para esta operación.";
  if (status === 404) return "El pedido ya no está disponible.";
  if (status === 409) {
    return (code && MENSAJES_409[code]) ?? "Conflicto operativo. Reintentá.";
  }
  if (status === 0) return "Sin conexión con el servidor. Reintentá.";
  return "Error interno. Intentá nuevamente.";
}

// ──────────────────────────────────────────────────────────────────────────────
// Formateo
// ──────────────────────────────────────────────────────────────────────────────

/** Registros legacy: no inventar fecha a partir de created_at. */
export const TEXTO_FECHA_PAGO_LEGACY = "Fecha de pago no disponible (registro anterior)";

export function formatearFechaPagoConfirmado(iso: string | null): string {
  if (!iso) return TEXTO_FECHA_PAGO_LEGACY;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return TEXTO_FECHA_PAGO_LEGACY;
  return formatearFechaHoraNegocio(fecha);
}

/** HU-E14 (spec E §6.3): etiqueta fija cuando el cliente no puede resolverse. */
export const TEXTO_CLIENTE_NO_DISPONIBLE = "Cliente no disponible";

export function formatearClienteCola(nombre: string | null): string {
  return nombre ?? TEXTO_CLIENTE_NO_DISPONIBLE;
}

export function formatearUnidades(unidades: number): string {
  return unidades === 1 ? "1 unidad" : `${unidades} unidades`;
}

export const ETIQUETA_MEDIO_PAGO: Record<MedioPagoVentaJson, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  E_CHEQ: "E-Cheq",
  MERCADO_PAGO: "Mercado Pago",
  TARJETA: "Tarjeta",
  CUENTA_CORRIENTE: "Cuenta corriente",
};

export const TEXTO_SIN_MEDIO_PAGO = "Sin medio registrado";

/** Lista de medios unida con coma; un valor desconocido se muestra crudo. */
export function formatearMediosPago(medios: string[]): string {
  if (medios.length === 0) return TEXTO_SIN_MEDIO_PAGO;
  return medios
    .map((m) => ETIQUETA_MEDIO_PAGO[m as MedioPagoVentaJson] ?? m)
    .join(", ");
}

const formatoMoneda = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

/** `total` llega como string decimal del servidor; solo se formatea. */
export function formatearTotalPago(total: string): string {
  return formatoMoneda.format(Number(total));
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  PAGO_CONFIRMADO: "Pendiente de toma",
  EN_PREPARACION: "En preparación",
  LISTO_PARA_RETIRO: "Listo para retiro",
};

export function formatearEstadoEcommerce(estado: string): string {
  return ETIQUETAS_ESTADO[estado] ?? estado;
}

export function formatearPlazoRetiro(iso: string | null): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return formatearFechaHoraNegocio(fecha);
}

/** Cantidad pendiente de una línea — nunca negativa. */
export function cantidadPendiente(linea: LineaPreparacionJson): number {
  return Math.max(0, linea.cantidad_requerida - linea.cantidad_confirmada);
}

/**
 * Aplica un `ResultadoConfirmarJson` sobre el ítem de cola en memoria:
 * acredita la cantidad confirmada a la línea afectada y reemplaza el
 * progreso global por el que devolvió el backend (source of truth).
 */
export function aplicarResultadoScan(
  pedido: ItemColaPreparacionJson,
  resultado: ResultadoConfirmarJson,
): ItemColaPreparacionJson {
  return {
    ...pedido,
    progreso: resultado.progreso,
    lineas: pedido.lineas.map((linea) =>
      linea.pedido_venta_item_id === resultado.pedido_venta_item_id
        ? {
            ...linea,
            cantidad_confirmada: resultado.cantidad_confirmada,
            completa: resultado.cantidad_confirmada >= linea.cantidad_requerida,
          }
        : linea,
    ),
  };
}

/** Descripción legible de una línea para el feedback de scan. */
export function describirLinea(linea: LineaPreparacionJson): string {
  const partes = [linea.variante.producto_nombre];
  const atributos = [linea.variante.talle, linea.variante.color, linea.variante.modelo]
    .filter(Boolean)
    .join(" · ");
  return atributos ? `${partes[0]} (${atributos})` : partes[0];
}
