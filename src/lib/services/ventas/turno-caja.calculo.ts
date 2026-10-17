/**
 * HU-B2 (Módulo B) — Funciones puras de cálculo del cierre de turno de caja
 * con arqueo ciego (task_relos.md §6.2). Sin acceso a Prisma ni a ningún
 * I/O: reciben los datos ya leídos/sumados y devuelven un número o boolean.
 * `turno-caja.service.ts` es el único llamador en producción.
 *
 * Mismo criterio que `evaluacion.calculo.ts` (HU-H5): contrato público,
 * testeado unitariamente el día 1.
 */

// Import relativo con extensión explícita (`allowImportingTsExtensions` en
// tsconfig.json) — no el alias `@/lib/...` — a propósito: este módulo debe
// poder importarse y ejecutarse tal cual bajo el test runner nativo de Node
// (`node --experimental-strip-types --test`, `package.json#scripts.test`),
// que no resuelve alias de `tsconfig.json`. Mismo motivo por el que
// `evaluacion.calculo.ts` importa sus constantes de la misma forma.
import { UMBRAL_DIFERENCIA_ARQUEO } from "./turno-caja.constants.ts";

/**
 * `saldo_esperado` (task §6.2 punto 2): fondo fijo inicial declarado en la
 * apertura más el total de ventas en efectivo cobradas durante el turno.
 * `totalVentasEfectivo` ya viene sumado por el llamador (agregación de
 * `VentaMedioPago.importe` vía Prisma) — esta función no conoce el schema.
 */
export function calcularSaldoEsperado(
  fondoFijoInicial: number,
  totalVentasEfectivo: number,
): number {
  return redondearDosDecimales(fondoFijoInicial + totalVentasEfectivo);
}

/**
 * `diferencia` (task §6.2 punto 3): puede ser negativa (el Cajero contó de
 * más) o positiva (contó de menos) — ninguna de las dos ramas es "buena" ni
 * "mala" per se, el umbral se evalúa siempre sobre el valor absoluto.
 */
export function calcularDiferencia(
  saldoEsperado: number,
  conteoFisicoDeclarado: number,
): number {
  return redondearDosDecimales(saldoEsperado - conteoFisicoDeclarado);
}

/**
 * `TurnoCaja.saldo_esperado`/`diferencia` son `Decimal(12, 2)` — se redondea
 * acá, en la función pura, para que el valor devuelto al llamador (payload
 * de respuesta HTTP, evento de dominio) sea byte-idéntico al que termina
 * persistido, evitando artefactos de punto flotante (ej. `1499.9999999998`)
 * en cualquiera de los dos.
 */
function redondearDosDecimales(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * `JUSTIFICACION_REQUERIDA` (task §6.2 punto 4): la diferencia, en valor
 * absoluto, supera `UMBRAL_DIFERENCIA_ARQUEO` y no vino `justificacion` (o
 * vino vacía/solo espacios — un string en blanco no es una justificación
 * real).
 */
export function requiereJustificacion(
  diferencia: number,
  justificacion: string | undefined,
): boolean {
  const excedeUmbral = Math.abs(diferencia) > UMBRAL_DIFERENCIA_ARQUEO;
  const sinJustificar = !justificacion || justificacion.trim().length === 0;
  return excedeUmbral && sinJustificar;
}
