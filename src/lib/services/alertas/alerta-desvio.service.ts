/**
 * HU-D6 (Módulo D) — Servicio de alertas de indicadores críticos
 * (spec_modulo_D.md §8.2, task_relos.md D2–D8, D17–D20, D26).
 *
 * Núcleo de HU-D6: reevalúa un indicador (stock de una variante en un depósito,
 * o el % de egresos sobre ingresos de un mes) y aplica la transición de su
 * `AlertaDesvio` (crear, cambiar de nivel, resolver o nada). Las reglas son
 * puras y viven en `alerta-desvio.reglas.ts`; acá solo hay lectura de datos,
 * transacción y emisión.
 *
 * Garantías:
 *  - Cada evaluación corre en su propia `$transaction`. La unicidad de la
 *    alerta activa la da `clave_activa @unique`: el alta usa `createMany` con
 *    `skipDuplicates` (`INSERT … ON CONFLICT DO NOTHING`, D18), que no aborta
 *    la transacción ante una carrera; los cambios de nivel y la resolución son
 *    `updateMany` condicionados por `id`, `estado = ACTIVA` y la severidad
 *    leída. Si una escritura no afecta filas (otro proceso se adelantó), se
 *    relee y se vuelve a decidir.
 *  - Los eventos `alerta_desvio:*` se emiten DESPUÉS del COMMIT y solo si hubo
 *    cambio real; un no-op no deja fila, auditoría ni notificación. Un fallo al
 *    emitir se loguea y no rompe al llamador.
 *  - Siempre se relee la base (stock y resumen de HU-G14): nunca se confía en
 *    cantidades o montos de un payload.
 *  - Si HU-G14 o los umbrales fallan, no se toca ninguna alerta (D7).
 *  - Ningún DELETE físico (RULES Regla 1); las consultas filtran `is_active`.
 *
 * Dependencias inyectables (`DependenciasAlertas`) con default real, para los
 * tests de integración: el resumen mensual, los umbrales, el reloj y el emisor.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type {
  AlertaDesvioCreadaPayload,
  AlertaDesvioDetallePayload,
  AlertaDesvioNivelCambiadoPayload,
  AlertaDesvioResueltaPayload,
  OrigenReevaluacionAlerta,
} from "@/lib/events/event-types";
import {
  clasificarEgresos,
  clasificarStock,
  construirClaveActiva,
  construirReferenciaEgresos,
  construirReferenciaStock,
  decidirTransicion,
  esMesVigente,
  parsearReferenciaEgresos,
  referenciaEgresosDeDiaIso,
  valorComparable,
  type IndicadorAlerta,
  type SeveridadAlerta,
  type Transicion,
  type UmbralesEgresosValores,
} from "@/lib/services/alertas/alerta-desvio.reglas";
import { obtenerUmbralesEgresos } from "@/lib/services/sistema/configuracion.service";
import { obtenerResumenMensual } from "@/lib/services/tesoreria/reporte-mensual.service";
import type { ObtenerResumenMensual } from "@/lib/services/tesoreria/reporte-mensual.types";
import { diaNegocioIso } from "@/lib/utils/fecha-negocio";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type EventoAlertaDesvio =
  | { nombre: "alerta_desvio:creada"; payload: AlertaDesvioCreadaPayload }
  | { nombre: "alerta_desvio:nivel_cambiado"; payload: AlertaDesvioNivelCambiadoPayload }
  | { nombre: "alerta_desvio:resuelta"; payload: AlertaDesvioResueltaPayload };

export interface DependenciasAlertas {
  /** Resumen mensual de HU-G14 (contrato del PR 0, D4/D16). */
  obtenerResumenMensual: ObtenerResumenMensual;
  /** Umbrales vigentes del % de egresos (getter estricto D.4, D24). */
  obtenerUmbralesEgresos: () => Promise<UmbralesEgresosValores>;
  /** Reloj: define el mes en curso (D5) y la fecha de las transiciones. */
  ahora: () => Date;
  /** Emisor post-COMMIT. Por defecto, el bus de dominio. */
  emitir: (evento: EventoAlertaDesvio) => void;
}

export interface OpcionesEvaluacion {
  /** D20: `EVENTO` (por defecto) o `REEVALUACION_PANEL`. */
  origen?: OrigenReevaluacionAlerta;
  /** Actor del evento de origen (D9); `null` = proceso automático (por defecto). */
  usuarioId?: string | null;
  dependencias?: Partial<DependenciasAlertas>;
}

export interface ResultadoEvaluacionStock {
  referencia: string;
  /** `null` si no existe la fila de stock activa. */
  cantidad: number | null;
  punto_pedido: number | null;
  severidad: SeveridadAlerta | null;
  transicion: Transicion;
  /** Alerta ACTIVA después de la evaluación, si quedó alguna. */
  alerta_activa_id: string | null;
}

export type ResultadoEvaluacionEgresos =
  | {
      estado: "EVALUADO";
      referencia: string;
      /** `null` = no calculable (ingresos ≤ 0, D2/criterio 5). */
      porcentaje: number | null;
      severidad: SeveridadAlerta | null;
      umbral_aplicado: number | null;
      transicion: Transicion;
      alerta_activa_id: string | null;
    }
  | {
      /** Mes que no es el vigente: solo se resuelve su alerta activa, sin consultar HU-G14 (D5). */
      estado: "MES_NO_VIGENTE";
      referencia: string;
      transicion: Transicion;
      alerta_activa_id: null;
    }
  | {
      /** HU-G14 o los umbrales fallaron: ninguna alerta se modificó (D7). */
      estado: "ERROR_FUENTE";
      referencia: string;
      codigo_error: string;
    };

/** Valor vigente de una alerta ACTIVA para el panel (D19). */
export type ValorVigenteAlerta =
  | { indicador: "STOCK_BAJO_PUNTO_PEDIDO"; cantidad_actual: number | null; punto_pedido: number | null }
  | { indicador: "EGRESOS_SOBRE_INGRESOS"; porcentaje_egresos: number | null; umbral_aplicado: number | null };

export interface ResultadoReevaluacionPanel {
  /** Estado del mes en curso para la línea del panel, aunque no haya alerta. */
  egresos_mes_actual: ResultadoEvaluacionEgresos;
  /** true si HU-G14 o los umbrales fallaron: el panel muestra el snapshot y el aviso. */
  fuente_egresos_fallo: boolean;
  /** Por `alerta_id` de cada alerta que sigue ACTIVA tras la reevaluación. */
  valores_vigentes: Record<string, ValorVigenteAlerta>;
  /** Alertas de stock que no se pudieron reevaluar (error de base): conservan su estado. */
  alertas_stock_con_error: string[];
}

// ── Dependencias por defecto ──────────────────────────────────────────────────

/** Diagnóstico seguro: código de `ServiceError` o Prisma; nunca el mensaje ni datos. */
function codigoDiagnostico(error: unknown, porDefecto: string): string {
  const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof codigo === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(codigo) ? codigo : porDefecto;
}

function emitirEnBus(evento: EventoAlertaDesvio): void {
  switch (evento.nombre) {
    case "alerta_desvio:creada":
      domainEventBus.emit(evento.nombre, evento.payload);
      return;
    case "alerta_desvio:nivel_cambiado":
      domainEventBus.emit(evento.nombre, evento.payload);
      return;
    case "alerta_desvio:resuelta":
      domainEventBus.emit(evento.nombre, evento.payload);
      return;
  }
}

const DEPENDENCIAS_REALES: DependenciasAlertas = {
  obtenerResumenMensual,
  obtenerUmbralesEgresos,
  ahora: () => new Date(),
  emitir: emitirEnBus,
};

function resolverDependencias(opciones: OpcionesEvaluacion): DependenciasAlertas {
  return { ...DEPENDENCIAS_REALES, ...opciones.dependencias };
}

/** Emite post-COMMIT. Nunca lanza: un listener roto no revierte ni rompe al llamador. */
function emitirSeguro(deps: DependenciasAlertas, evento: EventoAlertaDesvio | null): void {
  if (!evento) return;
  try {
    deps.emitir(evento);
  } catch (error) {
    console.error("[alerta-desvio.service] Falló la emisión del evento:", {
      evento: evento.nombre,
      alerta_id: evento.payload.alerta_id,
      codigo_error: codigoDiagnostico(error, "ERROR_EMISION_EVENTO"),
    });
  }
}

// ── Núcleo de transición ──────────────────────────────────────────────────────

/**
 * Detalle de la evaluación. `undefined` = "no se conoce, conservar el snapshot
 * anterior" (por ejemplo, un mes terminado se resuelve sin consultar HU-G14);
 * `null` = valor conocido vacío (porcentaje no calculable).
 */
interface DetalleEvaluacion {
  cantidad_actual?: number | null;
  punto_pedido?: number | null;
  porcentaje_egresos?: number | null;
  umbral_aplicado?: number | null;
}

interface ObjetivoAlerta {
  indicador: IndicadorAlerta;
  referencia: string;
  variante_sku_id: string | null;
  deposito_id: string | null;
}

interface ContextoTransicion {
  origen: OrigenReevaluacionAlerta;
  usuarioId: string | null;
  instante: Date;
}

interface ResultadoTransicion {
  transicion: Transicion;
  evento: EventoAlertaDesvio | null;
  alertaActivaId: string | null;
}

const SELECCION_ALERTA = {
  id: true,
  severidad: true,
  estado: true,
  cantidad_actual: true,
  punto_pedido: true,
  porcentaje_egresos: true,
  umbral_aplicado: true,
} as const;

type AlertaLeida = Prisma.AlertaDesvioGetPayload<{ select: typeof SELECCION_ALERTA }>;

function decimalONull(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : Number(valor.toString());
}

/** Columnas de detalle a escribir: solo las conocidas (`undefined` no se toca). */
function columnasDetalle(detalle: DetalleEvaluacion) {
  return {
    ...(detalle.cantidad_actual !== undefined && { cantidad_actual: detalle.cantidad_actual }),
    ...(detalle.punto_pedido !== undefined && { punto_pedido: detalle.punto_pedido }),
    ...(detalle.porcentaje_egresos !== undefined && { porcentaje_egresos: detalle.porcentaje_egresos }),
    ...(detalle.umbral_aplicado !== undefined && { umbral_aplicado: detalle.umbral_aplicado }),
  };
}

/** Detalle del evento: lo nuevo conocido sobre el snapshot anterior. */
function detallePayload(
  origen: OrigenReevaluacionAlerta,
  anterior: AlertaLeida | null,
  detalle: DetalleEvaluacion,
): AlertaDesvioDetallePayload {
  const elegir = (nuevo: number | null | undefined, previo: number | null) => (nuevo === undefined ? previo : nuevo);
  return {
    origen,
    cantidad_actual: elegir(detalle.cantidad_actual, anterior?.cantidad_actual ?? null),
    punto_pedido: elegir(detalle.punto_pedido, anterior?.punto_pedido ?? null),
    porcentaje_egresos: elegir(detalle.porcentaje_egresos, decimalONull(anterior?.porcentaje_egresos ?? null)),
    umbral_aplicado: elegir(detalle.umbral_aplicado, decimalONull(anterior?.umbral_aplicado ?? null)),
  };
}

/** Máximo de relecturas ante carreras; en la práctica alcanza con una. */
const MAX_INTENTOS_TRANSICION = 3;

/**
 * Aplica la transición dentro del `tx` del llamador (D8, D18). No emite: devuelve
 * el evento para emitirlo después del COMMIT.
 */
async function aplicarTransicionTx(
  tx: Prisma.TransactionClient,
  objetivo: ObjetivoAlerta,
  nueva: SeveridadAlerta | null,
  detalle: DetalleEvaluacion,
  contexto: ContextoTransicion,
): Promise<ResultadoTransicion> {
  const claveActiva = construirClaveActiva(objetivo.indicador, objetivo.referencia);
  const base = {
    indicador: objetivo.indicador,
    referencia: objetivo.referencia,
    fecha: contexto.instante.toISOString(),
    usuario_id: contexto.usuarioId,
  };

  for (let intento = 0; intento < MAX_INTENTOS_TRANSICION; intento += 1) {
    const actual: AlertaLeida | null = await tx.alertaDesvio.findFirst({
      where: { clave_activa: claveActiva, estado: "ACTIVA", is_active: true, deleted_at: null },
      select: SELECCION_ALERTA,
    });
    const transicion = decidirTransicion(actual, nueva);

    if (transicion === "NADA") {
      return { transicion, evento: null, alertaActivaId: actual?.id ?? null };
    }

    if (transicion === "CREAR" && nueva !== null) {
      const id = randomUUID();
      const { count } = await tx.alertaDesvio.createMany({
        data: [
          {
            id,
            indicador: objetivo.indicador,
            referencia: objetivo.referencia,
            clave_activa: claveActiva,
            severidad: nueva,
            estado: "ACTIVA",
            variante_sku_id: objetivo.variante_sku_id,
            deposito_id: objetivo.deposito_id,
            ...columnasDetalle(detalle),
          },
        ],
        skipDuplicates: true,
      });
      if (count === 1) {
        return {
          transicion,
          alertaActivaId: id,
          evento: {
            nombre: "alerta_desvio:creada",
            payload: {
              ...base,
              evento_id: randomUUID(),
              alerta_id: id,
              severidad_anterior: null,
              severidad_nueva: nueva,
              detalle: detallePayload(contexto.origen, null, detalle),
            },
          },
        };
      }
      continue; // Otro proceso creó la activa: se relee y se decide de nuevo.
    }

    if (transicion === "CAMBIAR_NIVEL" && actual !== null && nueva !== null) {
      const { count } = await tx.alertaDesvio.updateMany({
        where: { id: actual.id, estado: "ACTIVA", severidad: actual.severidad, is_active: true },
        data: { severidad: nueva, ...columnasDetalle(detalle) },
      });
      if (count === 1) {
        return {
          transicion,
          alertaActivaId: actual.id,
          evento: {
            nombre: "alerta_desvio:nivel_cambiado",
            payload: {
              ...base,
              evento_id: randomUUID(),
              alerta_id: actual.id,
              severidad_anterior: actual.severidad,
              severidad_nueva: nueva,
              detalle: detallePayload(contexto.origen, actual, detalle),
            },
          },
        };
      }
      continue;
    }

    if (transicion === "RESOLVER" && actual !== null) {
      // Un único UPDATE cambia estado, clave_activa y resuelta_at juntos (D18).
      // D28: el detalle NO se toca: la RESUELTA conserva el último desvío real;
      // el evento sí lleva los valores vigentes al resolver.
      const { count } = await tx.alertaDesvio.updateMany({
        where: { id: actual.id, estado: "ACTIVA", severidad: actual.severidad, is_active: true },
        data: {
          estado: "RESUELTA",
          clave_activa: null,
          resuelta_at: contexto.instante,
        },
      });
      if (count === 1) {
        return {
          transicion,
          alertaActivaId: null,
          evento: {
            nombre: "alerta_desvio:resuelta",
            payload: {
              ...base,
              evento_id: randomUUID(),
              alerta_id: actual.id,
              severidad_anterior: actual.severidad,
              severidad_nueva: null,
              detalle: detallePayload(contexto.origen, actual, detalle),
            },
          },
        };
      }
      continue;
    }
  }

  throw new ServiceError(
    "ALERTA_CONCURRENCIA_AGOTADA",
    `No se pudo aplicar la transición de ${claveActiva} tras ${MAX_INTENTOS_TRANSICION} intentos`,
  );
}

function contextoDe(opciones: OpcionesEvaluacion, deps: DependenciasAlertas): ContextoTransicion {
  return {
    origen: opciones.origen ?? "EVENTO",
    usuarioId: opciones.usuarioId ?? null,
    instante: deps.ahora(),
  };
}

// ── Stock ─────────────────────────────────────────────────────────────────────

/**
 * Reevalúa la alerta de stock de una variante en un depósito (D2, D17). Relee
 * `StockDeposito` dentro de la transacción; sin fila activa, la clasificación
 * es `null` (resuelve una alerta activa si la hubiera).
 */
export async function evaluarStock(
  { varianteSkuId, depositoId }: { varianteSkuId: string; depositoId: string },
  opciones: OpcionesEvaluacion = {},
): Promise<ResultadoEvaluacionStock> {
  const deps = resolverDependencias(opciones);
  const contexto = contextoDe(opciones, deps);
  const referencia = construirReferenciaStock(varianteSkuId, depositoId);

  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const stock = await tx.stockDeposito.findFirst({
      where: { variante_sku_id: varianteSkuId, deposito_id: depositoId, is_active: true, deleted_at: null },
      select: { cantidad: true, punto_pedido: true },
    });
    const severidad = stock ? clasificarStock(stock) : null;
    const detalle: DetalleEvaluacion = stock
      ? { cantidad_actual: stock.cantidad, punto_pedido: stock.punto_pedido }
      : {};
    const transicion = await aplicarTransicionTx(
      tx,
      { indicador: "STOCK_BAJO_PUNTO_PEDIDO", referencia, variante_sku_id: varianteSkuId, deposito_id: depositoId },
      severidad,
      detalle,
      contexto,
    );
    return { stock, severidad, transicion };
  });

  emitirSeguro(deps, resultado.transicion.evento);
  return {
    referencia,
    cantidad: resultado.stock?.cantidad ?? null,
    punto_pedido: resultado.stock?.punto_pedido ?? null,
    severidad: resultado.severidad,
    transicion: resultado.transicion.transicion,
    alerta_activa_id: resultado.transicion.alertaActivaId,
  };
}

// ── Egresos ───────────────────────────────────────────────────────────────────

/**
 * Reevalúa la alerta de egresos de un mes (D2, D4, D5, D7, D26).
 *  - Mes vigente (hoy de negocio en Argentina): consulta HU-G14 y los umbrales,
 *    clasifica y aplica la transición.
 *  - Otro mes: resuelve su alerta activa si existe, SIN consultar HU-G14; si no
 *    hay, no hace nada (un evento de un mes pasado no crea alertas).
 *  - Si HU-G14 o los umbrales fallan: log seguro, ninguna alerta se toca y se
 *    devuelve `ERROR_FUENTE` (no lanza).
 *
 * @throws {ServiceError} PERIODO_INVALIDO — año o mes fuera de rango
 */
export async function evaluarEgresos(
  { anio, mes }: { anio: number; mes: number },
  opciones: OpcionesEvaluacion = {},
): Promise<ResultadoEvaluacionEgresos> {
  const deps = resolverDependencias(opciones);
  let referencia: string;
  try {
    referencia = construirReferenciaEgresos(anio, mes);
  } catch (error) {
    if (error instanceof RangeError) throw new ServiceError("PERIODO_INVALIDO", error.message);
    throw error;
  }
  const contexto = contextoDe(opciones, deps);
  const objetivo: ObjetivoAlerta = {
    indicador: "EGRESOS_SOBRE_INGRESOS",
    referencia,
    variante_sku_id: null,
    deposito_id: null,
  };

  if (!esMesVigente(referencia, diaNegocioIso(contexto.instante))) {
    const transicion = await prisma.$transaction((tx: Prisma.TransactionClient) =>
      aplicarTransicionTx(tx, objetivo, null, {}, contexto),
    );
    emitirSeguro(deps, transicion.evento);
    return { estado: "MES_NO_VIGENTE", referencia, transicion: transicion.transicion, alerta_activa_id: null };
  }

  let porcentajeDto: number | null;
  let umbrales: UmbralesEgresosValores;
  try {
    const resumen = await deps.obtenerResumenMensual(anio, mes, { incluir_desglose_gastos: false });
    porcentajeDto = resumen.porcentaje_egresos_sobre_ingresos;
    umbrales = await deps.obtenerUmbralesEgresos();
  } catch (error) {
    const codigo = codigoDiagnostico(error, "ERROR_FUENTE_EGRESOS");
    console.error("[alerta-desvio.service] No se pudo evaluar el % de egresos; las alertas no se modifican:", {
      referencia,
      codigo_error: codigo,
    });
    return { estado: "ERROR_FUENTE", referencia, codigo_error: codigo };
  }

  const porcentaje = valorComparable(porcentajeDto);
  const clasificacion = clasificarEgresos(porcentaje, umbrales);
  const detalle: DetalleEvaluacion = {
    porcentaje_egresos: porcentaje,
    umbral_aplicado: clasificacion?.umbral_aplicado ?? null,
  };
  const transicion = await prisma.$transaction((tx: Prisma.TransactionClient) =>
    aplicarTransicionTx(tx, objetivo, clasificacion?.severidad ?? null, detalle, contexto),
  );
  emitirSeguro(deps, transicion.evento);
  return {
    estado: "EVALUADO",
    referencia,
    porcentaje,
    severidad: clasificacion?.severidad ?? null,
    umbral_aplicado: clasificacion?.umbral_aplicado ?? null,
    transicion: transicion.transicion,
    alerta_activa_id: transicion.alertaActivaId,
  };
}

// ── Apertura del panel ────────────────────────────────────────────────────────

/**
 * Reevaluación previa al listado del panel (D7, D19, D20). Origen
 * `REEVALUACION_PANEL` y `usuario_id = null` en todos los eventos:
 *  (a) egresos del mes en curso;
 *  (b) resuelve las alertas de egresos ACTIVAS de otros meses;
 *  (c) relee cada alerta de stock ACTIVA (no crea alertas de stock nuevas).
 * Un fallo de HU-G14 no impide (b) ni (c) y no modifica alertas de egresos.
 */
export async function reevaluarAlertasAlAbrirPanel(
  opciones: Pick<OpcionesEvaluacion, "dependencias"> = {},
): Promise<ResultadoReevaluacionPanel> {
  const deps = resolverDependencias(opciones);
  const evaluacion: OpcionesEvaluacion = { origen: "REEVALUACION_PANEL", usuarioId: null, dependencias: deps };
  const valoresVigentes: Record<string, ValorVigenteAlerta> = {};

  // (a) Mes en curso.
  const referenciaHoy = referenciaEgresosDeDiaIso(diaNegocioIso(deps.ahora()));
  const { anio, mes } = parsearReferenciaEgresos(referenciaHoy)!;
  const egresosMesActual = await evaluarEgresos({ anio, mes }, evaluacion);
  if (egresosMesActual.estado === "EVALUADO" && egresosMesActual.alerta_activa_id) {
    valoresVigentes[egresosMesActual.alerta_activa_id] = {
      indicador: "EGRESOS_SOBRE_INGRESOS",
      porcentaje_egresos: egresosMesActual.porcentaje,
      umbral_aplicado: egresosMesActual.umbral_aplicado,
    };
  }

  // (b) Egresos activos de otros meses.
  const egresosAnteriores = await prisma.alertaDesvio.findMany({
    where: {
      indicador: "EGRESOS_SOBRE_INGRESOS",
      estado: "ACTIVA",
      is_active: true,
      deleted_at: null,
      referencia: { not: referenciaHoy },
    },
    select: { referencia: true },
  });
  for (const { referencia } of egresosAnteriores) {
    const periodo = parsearReferenciaEgresos(referencia);
    if (!periodo) {
      console.error("[alerta-desvio.service] Referencia de egresos inválida en una alerta activa:", { referencia });
      continue;
    }
    await evaluarEgresos(periodo, evaluacion);
  }

  // (c) Stock activo: se relee cada combinación.
  const alertasStock = await prisma.alertaDesvio.findMany({
    where: { indicador: "STOCK_BAJO_PUNTO_PEDIDO", estado: "ACTIVA", is_active: true, deleted_at: null },
    select: { id: true, variante_sku_id: true, deposito_id: true },
  });
  const alertasStockConError: string[] = [];
  for (const alerta of alertasStock) {
    if (!alerta.variante_sku_id || !alerta.deposito_id) {
      console.error("[alerta-desvio.service] Alerta de stock activa sin variante o depósito:", { alerta_id: alerta.id });
      alertasStockConError.push(alerta.id);
      continue;
    }
    try {
      const resultado = await evaluarStock(
        { varianteSkuId: alerta.variante_sku_id, depositoId: alerta.deposito_id },
        evaluacion,
      );
      if (resultado.alerta_activa_id) {
        valoresVigentes[resultado.alerta_activa_id] = {
          indicador: "STOCK_BAJO_PUNTO_PEDIDO",
          cantidad_actual: resultado.cantidad,
          punto_pedido: resultado.punto_pedido,
        };
      }
    } catch (error) {
      console.error("[alerta-desvio.service] No se pudo reevaluar una alerta de stock; conserva su estado:", {
        alerta_id: alerta.id,
        codigo_error: codigoDiagnostico(error, "ERROR_REEVALUACION_STOCK"),
      });
      alertasStockConError.push(alerta.id);
    }
  }

  return {
    egresos_mes_actual: egresosMesActual,
    fuente_egresos_fallo: egresosMesActual.estado === "ERROR_FUENTE",
    valores_vigentes: valoresVigentes,
    alertas_stock_con_error: alertasStockConError,
  };
}
