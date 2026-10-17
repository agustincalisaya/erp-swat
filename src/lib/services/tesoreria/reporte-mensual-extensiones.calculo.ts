/**
 * @module reporte-mensual-extensiones.calculo
 * @description HU-G15 (Sprint 5, Cluster 6) — funciones puras de los bloques
 * adicionales del reporte mensual: «Egresos por proveedor» y «Comparación con
 * el mes anterior» (`spec_modulo_G.md` §9.10). El servicio
 * `reporte-mensual-extensiones.service.ts` obtiene los datos (pagos del mes y
 * `obtenerResumenMensual` de HU-G14) y arma los bloques con estas funciones.
 *
 * Módulo PURO: sin `server-only`, sin Prisma en tiempo de ejecución y sin alias
 * `@/...`, para testearlo con `node --experimental-strip-types --test` (imports
 * relativos con extensión `.ts`, mismo patrón que `fecha-negocio.ts`).
 *
 * Decisiones de cálculo (task de HU-G15, §0.5 y §0.7; se repiten acá porque el
 * task no se versiona):
 * - Dinero: siempre `BigInt` de centavos a partir de strings `-?\d+\.\d{2}`
 *   (el `Importe` del DTO del PR 0). Nunca `number`. Otro formato → `RangeError`.
 * - Variación: importe = actual − anterior; porcentaje = variación ÷ |anterior|
 *   × 100 con 1 decimal, redondeo half-up sobre el valor absoluto con el signo
 *   aplicado después (el empate se aleja de cero, como `ROUND_HALF_UP` de
 *   Decimal). Anterior = 0 → porcentaje `null`, mostrado «—».
 * - Mes de un pago: `diaDeVigencia(fecha_pago)` de `fecha-negocio.ts`.
 *   Medianoche UTC exacta = día calendario (lo que guarda la UI con
 *   `z.coerce.date()` sobre `AAAA-MM-DD`); cualquier otro valor = instante en
 *   hora de Argentina (la API sin fecha guarda `new Date()`). HU-G14 usa la
 *   misma regla para que los totales cuadren.
 * - Proveedores: se agrupa por `proveedor_id` (la razón social no es única),
 *   total descendente, desempate por razón social sin distinguir mayúsculas y
 *   por `proveedor_id`. La cantidad cuenta pagos (cuentas por pagar pagadas),
 *   no comprobantes (rige el Backlog). Los proveedores y órdenes de compra con
 *   baja lógica no se filtran: son datos históricos de pagos (excepción
 *   justificada a RULES §1).
 * - Celdas (contrato `BloqueReporte.filas`: «ya formateadas como texto»):
 *   es-AR sin símbolo de moneda («1.234,50»), variaciones con «+» explícito si
 *   son positivas y sin signo en cero, porcentajes «+12,5 %», «—» cuando no se
 *   puede calcular. Las razones sociales van tal cual: el escape del CSV es del
 *   exportador del Cluster 3.
 */

import { diaDeVigencia, rangoMesNegocio } from "../../utils/fecha-negocio.ts";
import type { BloqueReporte, Importe } from "./reporte-mensual.types.ts";

// Sin literales `0n`: el `target` del proyecto (ES2017) no los admite.
const CERO = BigInt(0);
const DOS = BigInt(2);
const DIEZ = BigInt(10);
const CIEN = BigInt(100);
const MIL = BigInt(1000);

const IMPORTE = /^-?\d+\.\d{2}$/;
const PORCENTAJE = /^-?\d+\.\d$/;

/** Texto de una celda que no se puede calcular (porcentaje con mes anterior en cero). */
export const SIN_DATO = "—";

export const CLAVE_EGRESOS_POR_PROVEEDOR = "egresos_por_proveedor";
export const CLAVE_COMPARACION_MES_ANTERIOR = "comparacion_mes_anterior";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

export interface PeriodoMes {
  anio: number;
  /** 1 a 12. */
  mes: number;
}

/** Una cuenta por pagar pagada en el mes, ya atribuida a su proveedor (vía la orden de compra). */
export interface PagoProveedor {
  proveedor_id: string;
  razon_social: string;
  monto: Importe;
}

export interface EgresoPorProveedor {
  proveedor_id: string;
  razon_social: string;
  total_pagado: Importe;
  cantidad_pagos: number;
}

/** Totales de un mes tomados tal cual del `ResumenMensualDto` de HU-G14. */
export interface TotalesMes extends PeriodoMes {
  /** `ingresos.total`. */
  ingresos: Importe;
  /** `egresos.total`. */
  egresos: Importe;
  /** `resultado_neto`. */
  resultado_neto: Importe;
}

export interface Variacion {
  /** actual − anterior, `-?\d+\.\d{2}`. */
  importe: Importe;
  /** `-?\d+\.\d` (1 decimal, sin «-0.0»); `null` si el mes anterior es cero. */
  porcentaje: string | null;
}

// ── Período ───────────────────────────────────────────────────────────────────

/**
 * Valida el período con la misma regla que `rangoMesNegocio`.
 *
 * @throws {RangeError} si el año o el mes no son válidos
 */
function validarPeriodo(anio: number, mes: number): void {
  rangoMesNegocio(anio, mes);
}

/**
 * Mes anterior al indicado; enero pasa a diciembre del año anterior.
 *
 * @throws {RangeError} si el período o su mes anterior no son válidos
 */
export function mesAnterior(anio: number, mes: number): PeriodoMes {
  validarPeriodo(anio, mes);
  const anterior = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  validarPeriodo(anterior.anio, anterior.mes);
  return anterior;
}

/**
 * «Septiembre 2026».
 *
 * @throws {RangeError} si el período no es válido
 */
export function etiquetaMes(anio: number, mes: number): string {
  validarPeriodo(anio, mes);
  return `${MESES[mes - 1]} ${anio}`;
}

/**
 * `true` si la `fecha_pago` de una cuenta por pagar corresponde al mes
 * indicado, según `diaDeVigencia` (ver la cabecera del módulo).
 *
 * @throws {RangeError} si el período o la fecha no son válidos
 */
export function fechaPagoEnMes(fecha: Date, anio: number, mes: number): boolean {
  validarPeriodo(anio, mes);
  if (Number.isNaN(fecha.getTime())) {
    throw new RangeError("La fecha de pago no es una fecha válida");
  }
  return diaDeVigencia(fecha).slice(0, 7) === `${anio}-${String(mes).padStart(2, "0")}`;
}

// ── Dinero ────────────────────────────────────────────────────────────────────

/**
 * `"1234.50"` → `123450n`.
 *
 * @throws {RangeError} si el valor no tiene la forma `-?\d+\.\d{2}`
 */
export function importeACentavos(importe: string): bigint {
  if (typeof importe !== "string" || !IMPORTE.test(importe)) {
    throw new RangeError(`El importe debe tener la forma -?\\d+.\\d{2} (valor recibido: ${String(importe)})`);
  }
  return BigInt(importe.replace(".", ""));
}

/** `123450n` → `"1234.50"`; `-5n` → `"-0.05"`. */
export function centavosAImporte(centavos: bigint): Importe {
  const absoluto = centavos < CERO ? -centavos : centavos;
  const decimales = String(absoluto % CIEN).padStart(2, "0");
  return `${centavos < CERO ? "-" : ""}${absoluto / CIEN}.${decimales}`;
}

/**
 * Variación del mes actual contra el anterior (ver la cabecera del módulo).
 *
 * @throws {RangeError} si algún importe no tiene la forma `-?\d+\.\d{2}`
 */
export function calcularVariacion(actual: Importe, anterior: Importe): Variacion {
  const centavosAnterior = importeACentavos(anterior);
  const diferencia = importeACentavos(actual) - centavosAnterior;
  if (centavosAnterior === CERO) {
    return { importe: centavosAImporte(diferencia), porcentaje: null };
  }

  // Décimas de punto porcentual: |diferencia| × 100 × 10 ÷ |anterior|, half-up.
  const base = centavosAnterior < CERO ? -centavosAnterior : centavosAnterior;
  const numerador = (diferencia < CERO ? -diferencia : diferencia) * MIL;
  let decimas = numerador / base;
  if ((numerador % base) * DOS >= base) decimas += BigInt(1);

  const signo = diferencia < CERO && decimas > CERO ? "-" : "";
  return {
    importe: centavosAImporte(diferencia),
    porcentaje: `${signo}${decimas / DIEZ}.${decimas % DIEZ}`,
  };
}

// ── Formato de celdas (es-AR) ─────────────────────────────────────────────────

function conPuntosDeMiles(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * `"1234.50"` → «1.234,50»; `"-1234.50"` → «-1.234,50». Con `conSigno`, un
 * positivo lleva «+» (variaciones); el cero nunca lleva signo.
 *
 * @throws {RangeError} si el importe no tiene la forma `-?\d+\.\d{2}`
 */
export function formatearImporte(importe: Importe, conSigno = false): string {
  const centavos = importeACentavos(importe);
  const absoluto = centavos < CERO ? -centavos : centavos;
  const signo = centavos < CERO ? "-" : conSigno && centavos > CERO ? "+" : "";
  return `${signo}${conPuntosDeMiles(String(absoluto / CIEN))},${String(absoluto % CIEN).padStart(2, "0")}`;
}

/**
 * `"12.5"` → «+12,5 %»; `"-3.0"` → «-3,0 %»; `"0.0"` → «0,0 %»; `null` → «—».
 *
 * @throws {RangeError} si el porcentaje no tiene la forma `-?\d+\.\d`
 */
export function formatearPorcentaje(porcentaje: string | null): string {
  if (porcentaje === null) return SIN_DATO;
  if (typeof porcentaje !== "string" || !PORCENTAJE.test(porcentaje)) {
    throw new RangeError(`El porcentaje debe tener la forma -?\\d+.\\d (valor recibido: ${String(porcentaje)})`);
  }
  const decimas = BigInt(porcentaje.replace(".", ""));
  const absoluto = decimas < CERO ? -decimas : decimas;
  const signo = decimas < CERO ? "-" : decimas > CERO ? "+" : "";
  return `${signo}${conPuntosDeMiles(String(absoluto / DIEZ))},${absoluto % DIEZ} %`;
}

// ── Egresos por proveedor ─────────────────────────────────────────────────────

const COMPARADOR_RAZON_SOCIAL = new Intl.Collator("es", { sensitivity: "accent" });

/**
 * Agrupa por `proveedor_id`, suma en centavos y cuenta los pagos. Orden: total
 * descendente; empate por razón social ascendente sin distinguir mayúsculas;
 * empate final por `proveedor_id` ascendente.
 *
 * @throws {RangeError} si algún monto no tiene la forma `-?\d+\.\d{2}`
 */
export function agruparPagosPorProveedor(pagos: readonly PagoProveedor[]): EgresoPorProveedor[] {
  const porProveedor = new Map<string, { razon_social: string; centavos: bigint; cantidad: number }>();
  for (const pago of pagos) {
    const centavos = importeACentavos(pago.monto);
    const acumulado = porProveedor.get(pago.proveedor_id);
    if (acumulado) {
      acumulado.centavos += centavos;
      acumulado.cantidad += 1;
    } else {
      porProveedor.set(pago.proveedor_id, { razon_social: pago.razon_social, centavos, cantidad: 1 });
    }
  }

  return [...porProveedor.entries()]
    .sort(([idA, a], [idB, b]) => {
      if (a.centavos !== b.centavos) return a.centavos > b.centavos ? -1 : 1;
      const porNombre = COMPARADOR_RAZON_SOCIAL.compare(a.razon_social, b.razon_social);
      if (porNombre !== 0) return porNombre;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map(([proveedor_id, a]) => ({
      proveedor_id,
      razon_social: a.razon_social,
      total_pagado: centavosAImporte(a.centavos),
      cantidad_pagos: a.cantidad,
    }));
}

/**
 * Bloque «Egresos por proveedor», en el orden recibido (el de
 * `agruparPagosPorProveedor`). Sin pagos, el bloque va igual con `filas: []`.
 */
export function armarBloqueEgresosPorProveedor(egresos: readonly EgresoPorProveedor[]): BloqueReporte {
  return {
    clave: CLAVE_EGRESOS_POR_PROVEEDOR,
    titulo: "Egresos por proveedor",
    columnas: ["Proveedor", "Total pagado ($)", "Cantidad de pagos"],
    filas: egresos.map((e) => [e.razon_social, formatearImporte(e.total_pagado), String(e.cantidad_pagos)]),
  };
}

// ── Comparación con el mes anterior ───────────────────────────────────────────

/**
 * Bloque «Comparación con el mes anterior»: Ingresos, Egresos y Resultado neto
 * de ambos meses, con la variación en importe y en porcentaje.
 *
 * @throws {RangeError} si algún período o importe no es válido
 */
export function armarBloqueComparacion(actual: TotalesMes, anterior: TotalesMes): BloqueReporte {
  const fila = (concepto: string, campo: "ingresos" | "egresos" | "resultado_neto"): string[] => {
    const variacion = calcularVariacion(actual[campo], anterior[campo]);
    return [
      concepto,
      formatearImporte(anterior[campo]),
      formatearImporte(actual[campo]),
      formatearImporte(variacion.importe, true),
      formatearPorcentaje(variacion.porcentaje),
    ];
  };

  return {
    clave: CLAVE_COMPARACION_MES_ANTERIOR,
    titulo: "Comparación con el mes anterior",
    columnas: [
      "Concepto",
      etiquetaMes(anterior.anio, anterior.mes),
      etiquetaMes(actual.anio, actual.mes),
      "Variación ($)",
      "Variación (%)",
    ],
    filas: [
      fila("Ingresos", "ingresos"),
      fila("Egresos", "egresos"),
      fila("Resultado neto", "resultado_neto"),
    ],
  };
}
