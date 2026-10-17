/**
 * HU-D6 (Módulo D) — Reglas puras de alertas de indicadores críticos
 * (spec_modulo_D.md §8.2, task_relos.md D1, D2, D5, D12, D26).
 *
 * Módulo 100 % puro: sin Prisma, sin `server-only`, sin eventos, sin
 * configuración y sin reloj (el "hoy" de negocio entra por parámetro). Lo
 * consume `alerta-desvio.service.ts` y se testea con el runner nativo de Node
 * (`node --experimental-strip-types --test`), que no resuelve alias de
 * `tsconfig.json`: por eso no importa nada con `@/...`.
 *
 * Los enums de Prisma se reflejan como uniones de literales locales; el único
 * import es `import type` (se borra al ejecutar) y solo sirve para que `tsc`
 * falle si las uniones se desalinean del schema.
 */
import type {
  EstadoAlertaDesvio,
  IndicadorAlertaDesvio,
  SeveridadAlertaDesvio,
} from "@prisma/client";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type SeveridadAlerta = "CRITICA" | "ADVERTENCIA" | "INFORMATIVA";
export type IndicadorAlerta = "STOCK_BAJO_PUNTO_PEDIDO" | "EGRESOS_SOBRE_INGRESOS";
export type EstadoAlerta = "ACTIVA" | "RESUELTA";

/** Falla el typecheck si una unión local no coincide exactamente con su enum de Prisma. */
type MismosValores<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AfirmarVerdadero<T extends true> = T;
type _SeveridadAlineada = AfirmarVerdadero<MismosValores<SeveridadAlerta, SeveridadAlertaDesvio>>;
type _IndicadorAlineado = AfirmarVerdadero<MismosValores<IndicadorAlerta, IndicadorAlertaDesvio>>;
type _EstadoAlineado = AfirmarVerdadero<MismosValores<EstadoAlerta, EstadoAlertaDesvio>>;

/** Umbrales del % de egresos sobre ingresos (enteros por D24; la regla no lo exige). */
export interface UmbralesEgresosValores {
  informativa: number;
  advertencia: number;
  critica: number;
}

export interface LecturaStock {
  cantidad: number;
  punto_pedido: number | null | undefined;
}

export interface ClasificacionEgresos {
  severidad: SeveridadAlerta;
  umbral_aplicado: number;
}

/** Alerta activa (o la última encontrada) de un indicador y una referencia. */
export interface AlertaVigente {
  severidad: SeveridadAlerta;
  estado: EstadoAlerta;
}

export type Transicion = "CREAR" | "CAMBIAR_NIVEL" | "RESOLVER" | "NADA";

export type DetalleAlerta =
  | { indicador: "STOCK_BAJO_PUNTO_PEDIDO"; cantidad_actual: number; punto_pedido: number }
  | {
      indicador: "EGRESOS_SOBRE_INGRESOS";
      porcentaje_egresos: number | null | undefined;
      umbral_aplicado: number | null | undefined;
    };

// ── Clasificación ─────────────────────────────────────────────────────────────

/**
 * Nivel de stock (D1, D2). Solo se controla con `punto_pedido > 0`: un punto
 * de pedido 0, ausente o no finito significa "sin control" y nunca alerta,
 * ni siquiera con stock en cero (difiere de spec D6-2/D6-4, decisión D1).
 * `cantidad <= 0` → CRITICA; `0 < cantidad <= punto_pedido` → ADVERTENCIA.
 */
export function clasificarStock({ cantidad, punto_pedido }: LecturaStock): SeveridadAlerta | null {
  if (punto_pedido === null || punto_pedido === undefined) return null;
  if (!Number.isFinite(punto_pedido) || punto_pedido <= 0) return null;
  if (cantidad <= 0) return "CRITICA";
  if (cantidad <= punto_pedido) return "ADVERTENCIA";
  return null;
}

/**
 * Valor del porcentaje que se compara contra los umbrales (D26). Hoy devuelve
 * `porcentaje_egresos_sobre_ingresos` tal cual viene del DTO de HU-G14; es el
 * ÚNICO lugar donde se ajustaría un redondeo si el Cluster 3 lo indica.
 * `null` = no calculable.
 */
export function valorComparable(porcentaje: number | null | undefined): number | null {
  if (porcentaje === null || porcentaje === undefined || !Number.isFinite(porcentaje)) return null;
  return porcentaje;
}

/**
 * Nivel de egresos (D2): el del umbral más alto alcanzado, con comparación
 * inclusiva (`>=`). Por debajo del umbral informativo o con porcentaje no
 * calculable → `null`.
 */
export function clasificarEgresos(
  porcentaje: number | null | undefined,
  umbrales: UmbralesEgresosValores,
): ClasificacionEgresos | null {
  const valor = valorComparable(porcentaje);
  if (valor === null) return null;
  if (valor >= umbrales.critica) return { severidad: "CRITICA", umbral_aplicado: umbrales.critica };
  if (valor >= umbrales.advertencia) return { severidad: "ADVERTENCIA", umbral_aplicado: umbrales.advertencia };
  if (valor >= umbrales.informativa) return { severidad: "INFORMATIVA", umbral_aplicado: umbrales.informativa };
  return null;
}

// ── Transiciones ──────────────────────────────────────────────────────────────

/**
 * Qué hacer con la alerta de un indicador y una referencia (D3, D8). Una
 * alerta RESUELTA es histórico: no cuenta como activa, así que un cruce
 * nuevo crea otro episodio.
 */
export function decidirTransicion(actual: AlertaVigente | null, nueva: SeveridadAlerta | null): Transicion {
  const activa = actual !== null && actual.estado === "ACTIVA" ? actual : null;
  if (activa === null) return nueva === null ? "NADA" : "CREAR";
  if (nueva === null) return "RESOLVER";
  return activa.severidad === nueva ? "NADA" : "CAMBIAR_NIVEL";
}

/** Ascenso a CRITICA desde otro nivel o desde "sin alerta" (insumo de D11). */
export function esEscaladaACritica(
  severidadAnterior: SeveridadAlerta | null,
  severidadNueva: SeveridadAlerta | null,
): boolean {
  return severidadNueva === "CRITICA" && severidadAnterior !== "CRITICA";
}

const RANGO_SEVERIDAD: Record<SeveridadAlerta, number> = {
  INFORMATIVA: 1,
  ADVERTENCIA: 2,
  CRITICA: 3,
};

/** Orden CRITICA > ADVERTENCIA > INFORMATIVA: positivo si `a` es más grave que `b`, 0 si son iguales. */
export function compararSeveridad(a: SeveridadAlerta, b: SeveridadAlerta): number {
  return RANGO_SEVERIDAD[a] - RANGO_SEVERIDAD[b];
}

// ── Referencias y claves ──────────────────────────────────────────────────────

const REFERENCIA_EGRESOS = /^(\d{4})-(\d{2})$/;
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Referencia de stock: `variante_sku_id:deposito_id`. */
export function construirReferenciaStock(varianteSkuId: string, depositoId: string): string {
  return `${varianteSkuId}:${depositoId}`;
}

/**
 * Referencia de egresos: `AAAA-MM` (mes argentino, dos dígitos).
 *
 * @throws {RangeError} si el año no es un entero de 4 cifras o el mes no está entre 1 y 12
 */
export function construirReferenciaEgresos(anio: number, mes: number): string {
  if (!Number.isInteger(anio) || anio < 1000 || anio > 9999) {
    throw new RangeError(`El año debe ser un entero de 4 cifras (valor recibido: ${anio})`);
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new RangeError(`El mes debe ser un entero de 1 a 12 (valor recibido: ${mes})`);
  }
  return `${anio}-${String(mes).padStart(2, "0")}`;
}

/** Valor de `clave_activa` mientras la alerta está ACTIVA: `indicador:referencia`. */
export function construirClaveActiva(indicador: IndicadorAlerta, referencia: string): string {
  return `${indicador}:${referencia}`;
}

/** `AAAA-MM` → `{ anio, mes }`; `null` si el formato es inválido o el mes no está entre 1 y 12. */
export function parsearReferenciaEgresos(referencia: string): { anio: number; mes: number } | null {
  const coincidencia = REFERENCIA_EGRESOS.exec(referencia);
  if (!coincidencia) return null;
  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  if (mes < 1 || mes > 12) return null;
  return { anio, mes };
}

/**
 * `AAAA-MM-DD` (día de negocio, ej. `diaNegocioIso()` o la `fecha` de un
 * gasto) → `AAAA-MM`.
 *
 * @throws {RangeError} si no es un día `AAAA-MM-DD` con mes de 1 a 12
 */
export function referenciaEgresosDeDiaIso(diaIso: string): string {
  const coincidencia = DIA_ISO.exec(diaIso);
  const referencia = coincidencia ? `${coincidencia[1]}-${coincidencia[2]}` : "";
  if (parsearReferenciaEgresos(referencia) === null) {
    throw new RangeError(`Se esperaba un día AAAA-MM-DD (valor recibido: "${diaIso}")`);
  }
  return referencia;
}

/**
 * ¿La referencia de egresos es el mes en curso? (D5). `diaIsoHoy` es el día
 * de negocio de hoy en Argentina, calculado por el llamador. Una referencia
 * mal formada nunca es vigente.
 */
export function esMesVigente(referencia: string, diaIsoHoy: string): boolean {
  return parsearReferenciaEgresos(referencia) !== null && referencia === referenciaEgresosDeDiaIso(diaIsoHoy);
}

// ── Presentación ──────────────────────────────────────────────────────────────

/** Un decimal con coma, sin `Intl` ni locale (D12, D26). */
function unDecimal(valor: number): string {
  return valor.toFixed(1).replace(".", ",");
}

/** Entero tal cual; si trae decimales, un decimal con coma. */
function numeroCorto(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : unDecimal(valor);
}

/**
 * Detalle de la alerta para el panel (D12): «Stock 0 (punto de pedido 5)» o
 * «78,4% (umbral 70%)»; sin umbral aplicado, solo el porcentaje; porcentaje no
 * calculable → «No calculable».
 */
export function formatearDetalleAlerta(detalle: DetalleAlerta): string {
  if (detalle.indicador === "STOCK_BAJO_PUNTO_PEDIDO") {
    return `Stock ${detalle.cantidad_actual} (punto de pedido ${detalle.punto_pedido})`;
  }
  const valor = valorComparable(detalle.porcentaje_egresos);
  if (valor === null) return "No calculable";
  const porcentaje = `${unDecimal(valor)}%`;
  const umbral = detalle.umbral_aplicado;
  return umbral === null || umbral === undefined || !Number.isFinite(umbral)
    ? porcentaje
    : `${porcentaje} (umbral ${numeroCorto(umbral)}%)`;
}
