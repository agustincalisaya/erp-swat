/**
 * HU-D6 (Módulo D) — Disparadores de reevaluación (task_relos.md D6, D17).
 *
 * Traduce el payload de cada evento de dominio escuchado a los "objetivos" que
 * hay que reevaluar: meses de egresos (`{ anio, mes }`) o combinaciones de stock
 * (`{ varianteSkuId, depositoId }`). Módulo puro: sin Prisma, sin
 * `server-only`, sin reloj; lo usa `alerta-desvio.listener.ts` y se testea con
 * el runner nativo de Node (imports relativos con extensión `.ts`).
 *
 * Nunca lanza: un payload o una fecha inválidos producen una lista vacía. Los
 * objetivos salen sin duplicados. Ninguna cantidad del payload decide nada: el
 * servicio siempre relee la base.
 */
import type {
  CuentaPorPagarEstadoCambiadoPayload,
  GastoOperativoCreadoPayload,
  GastoOperativoDadoDeBajaPayload,
  GastoOperativoEditadoPayload,
  IngresoStockRegistradoPayload,
  ReclasificacionDevueltoPayload,
  ReservaCongeladaPayload,
  ReservaLiberadaPayload,
  TransferenciaStockPayload,
  TransferenciaStockRecepcionConfirmadaPayload,
  UmbralCriticoAlcanzadoPayload,
} from "../../events/event-types.ts";
import { parsearReferenciaEgresos, referenciaEgresosDeDiaIso } from "./alerta-desvio.reglas.ts";
import { diaCalendarioUtc, diaNegocioIso } from "../../utils/fecha-negocio.ts";

export interface ObjetivoEgresos {
  anio: number;
  mes: number;
}

export interface ObjetivoStock {
  varianteSkuId: string;
  depositoId: string;
}

// ── Utilidades ────────────────────────────────────────────────────────────────

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function esTextoNoVacio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

/** Corre `fn` y convierte cualquier excepción (payload malformado) en lista vacía. */
function sinLanzar<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

function egresosDeDiaIso(diaIso: unknown): ObjetivoEgresos[] {
  if (typeof diaIso !== "string" || !DIA_ISO.test(diaIso)) return [];
  try {
    const periodo = parsearReferenciaEgresos(referenciaEgresosDeDiaIso(diaIso));
    return periodo ? [periodo] : [];
  } catch {
    return [];
  }
}

function unicosEgresos(objetivos: ObjetivoEgresos[]): ObjetivoEgresos[] {
  const vistos = new Map<string, ObjetivoEgresos>();
  for (const o of objetivos) vistos.set(`${o.anio}-${o.mes}`, o);
  return [...vistos.values()];
}

function unicosStock(objetivos: ObjetivoStock[]): ObjetivoStock[] {
  const vistos = new Map<string, ObjetivoStock>();
  for (const o of objetivos) {
    if (esTextoNoVacio(o.varianteSkuId) && esTextoNoVacio(o.depositoId)) {
      vistos.set(`${o.varianteSkuId}:${o.depositoId}`, o);
    }
  }
  return [...vistos.values()];
}

function itemsDeDeposito(depositoId: unknown, items: unknown): ObjetivoStock[] {
  if (!esTextoNoVacio(depositoId) || !Array.isArray(items)) return [];
  return unicosStock(
    items.map((item: { variante_sku_id?: unknown }) => ({
      varianteSkuId: item?.variante_sku_id as string,
      depositoId,
    })),
  );
}

// ── Egresos ───────────────────────────────────────────────────────────────────

/** `gasto_operativo:creado`: el mes de la `fecha` del gasto (`AAAA-MM-DD`). */
export function objetivosGastoCreado(payload: GastoOperativoCreadoPayload): ObjetivoEgresos[] {
  return sinLanzar(() => egresosDeDiaIso(payload.fecha));
}

/** `gasto_operativo:dado_de_baja`: el mes de la `fecha` del gasto. */
export function objetivosGastoDadoDeBaja(payload: GastoOperativoDadoDeBajaPayload): ObjetivoEgresos[] {
  return sinLanzar(() => egresosDeDiaIso(payload.fecha));
}

/**
 * `gasto_operativo:editado`: el mes de `valor_anterior.fecha` y el de
 * `valor_nuevo.fecha` (D6), una sola vez si coinciden. Si falta
 * `valor_nuevo`, se usa la `fecha` suelta (que lleva el valor nuevo).
 */
export function objetivosGastoEditado(payload: GastoOperativoEditadoPayload): ObjetivoEgresos[] {
  return sinLanzar(() =>
    unicosEgresos([
      ...egresosDeDiaIso(payload.valor_anterior?.fecha),
      ...egresosDeDiaIso(payload.valor_nuevo?.fecha ?? payload.fecha),
    ]),
  );
}

/**
 * `cuenta_por_pagar:estado_cambiado`: solo `accion = PAGAR`, el mes de
 * `fecha_pago`. Viaja como ISO (`toISOString()`), pero puede representar dos
 * cosas: un instante real (la API sin fecha usa "ahora") o un día de
 * calendario a medianoche UTC (el formulario envía `AAAA-MM-DD`). Se evalúan
 * los dos meses posibles —el del día argentino y el del día UTC— sin
 * duplicar: reevaluar un mes de más es inocuo (el servicio relee la verdad),
 * perder el correcto no.
 */
export function objetivosCuentaPorPagar(payload: CuentaPorPagarEstadoCambiadoPayload): ObjetivoEgresos[] {
  return sinLanzar(() => {
    if (payload.accion !== "PAGAR" || !esTextoNoVacio(payload.fecha_pago)) return [];
    if (DIA_ISO.test(payload.fecha_pago)) return egresosDeDiaIso(payload.fecha_pago);
    const instante = new Date(payload.fecha_pago);
    if (Number.isNaN(instante.getTime())) return [];
    return unicosEgresos([
      ...egresosDeDiaIso(diaNegocioIso(instante)),
      ...egresosDeDiaIso(diaCalendarioUtc(instante)),
    ]);
  });
}

// ── Stock ─────────────────────────────────────────────────────────────────────

/** `stock:umbral_critico_alcanzado` (alerta del Módulo A). */
export function objetivosUmbralCritico(payload: UmbralCriticoAlcanzadoPayload): ObjetivoStock[] {
  return sinLanzar(() => unicosStock([{ varianteSkuId: payload.variante_sku_id, depositoId: payload.deposito_id }]));
}

/** `inventario:ingreso_stock_registrado`: cada ítem en el depósito destino (todos suman o restan). */
export function objetivosIngresoStock(payload: IngresoStockRegistradoPayload): ObjetivoStock[] {
  return sinLanzar(() => itemsDeDeposito(payload.deposito_destino_id, payload.items));
}

/** `stock:transferencia_iniciada`: cada ítem en el depósito ORIGEN (decremento). */
export function objetivosTransferenciaIniciada(payload: TransferenciaStockPayload): ObjetivoStock[] {
  return sinLanzar(() => itemsDeDeposito(payload.deposito_origen_id, payload.items));
}

/** `stock:transferencia_recepcion_confirmada`: cada ítem en el depósito DESTINO (incremento). */
export function objetivosTransferenciaRecepcion(
  payload: TransferenciaStockRecepcionConfirmadaPayload,
): ObjetivoStock[] {
  return sinLanzar(() => itemsDeDeposito(payload.deposito_destino_id, payload.items));
}

/** `stock:reserva_congelada`: decremento de la variante en el depósito de la reserva. */
export function objetivosReservaCongelada(payload: ReservaCongeladaPayload): ObjetivoStock[] {
  return sinLanzar(() => unicosStock([{ varianteSkuId: payload.variante_sku_id, depositoId: payload.deposito_id }]));
}

/** `stock:reclasificacion_devuelto`: solo `estado_destino = DISPONIBLE` reincorpora stock (D17). */
export function objetivosReclasificacionDevuelto(payload: ReclasificacionDevueltoPayload): ObjetivoStock[] {
  return sinLanzar(() =>
    payload.estado_destino === "DISPONIBLE"
      ? unicosStock([{ varianteSkuId: payload.variante_sku_id, depositoId: payload.deposito_id }])
      : [],
  );
}

/**
 * `stock:reserva_liberada`: el motivo `VENTA` no cambia `StockDeposito.cantidad`
 * y se ignora. Para el resto, el payload no trae depósito: devuelve el
 * `reserva_id` que el listener relee para obtener variante y depósito (D17).
 */
export function reservasALiberar(payload: ReservaLiberadaPayload): string[] {
  return sinLanzar(() =>
    payload.motivo_liberacion !== "VENTA" && esTextoNoVacio(payload.reserva_id) ? [payload.reserva_id] : [],
  );
}
