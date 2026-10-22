/**
 * HU-G7 (Módulo G, spec_modulo_G.md §9.8) — Funciones PURAS de la posición
 * diaria consolidada de Tesorería. Sin acceso a Prisma-client ni a ningún I/O:
 * reciben listas YA leídas y arman el cálculo. `posicion-diaria.service.ts` es
 * su único llamador en producción.
 *
 * Import relativo con extensión explícita y SIN `import "server-only"` — a
 * propósito, mismo criterio que `cuenta-por-pagar.calculo.ts`: este módulo debe
 * poder importarse tal cual bajo el test runner nativo de Node
 * (`node --experimental-strip-types --test`, `package.json#scripts.test`), que
 * no resuelve el alias `@/…` ni la condición `react-server` de `server-only`.
 *
 * TODO el dinero corre en `Prisma.Decimal` (`plus`/`minus`/`times`/`div`/
 * `toDecimalPlaces(2)`); NUNCA se llama `.toNumber()` — un cálculo monetario no
 * debe pasar por IEEE-754 (design ADR-3).
 */

import { Prisma } from "@prisma/client";
import { diaCalendarioUtc, inicioDiaUtc, rangoDiasNegocio } from "../../utils/fecha-negocio.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Cortes temporales (design ADR-2): DOS convenciones de fecha distintas.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Corte de los `SaldoDiarioCuenta`: `fecha` es una "fecha-solo" a medianoche
 * UTC (`inicioDiaUtc`), así que el corte es la medianoche UTC del día elegido.
 */
export function corteSaldoDia(diaIso: string): Date {
  return inicioDiaUtc(diaIso);
}

/**
 * Corte de la caja virtual: `IngresoTesoreria.fecha` y
 * `ContraAsientoIngreso.created_at` son INSTANTES reales, así que el límite es
 * la medianoche de Argentina del día SIGUIENTE al elegido (semiabierto
 * `[…, hasta)`), es decir `rangoDiasNegocio(diaIso, diaIso).hasta`.
 */
export function corteCajaHasta(diaIso: string): Date {
  return rangoDiasNegocio(diaIso, diaIso).hasta;
}

// ──────────────────────────────────────────────────────────────────────────────
// G7-3 — Último saldo vigente por cuenta
// ──────────────────────────────────────────────────────────────────────────────

/** Asiento mínimo necesario para elegir el saldo vigente de una cuenta. */
export interface AsientoSaldo {
  id: string;
  cuenta_id: string;
  fecha: Date;
  created_at: Date;
  saldo: Prisma.Decimal;
}

export interface SaldoVigente {
  cuenta_id: string;
  saldo: Prisma.Decimal;
  fecha: Date;
}

/**
 * G7-3 — último asiento con `fecha <= inicioDiaUtc(diaIso)` por cuenta,
 * ordenado `fecha desc, created_at desc, id desc` (design ADR-4: un mismo día
 * puede tener varias filas —prevalece la última— y NO hay `@@unique`). Devuelve
 * un `Map` clave `cuenta_id`; una cuenta sin fila hasta el corte simplemente NO
 * aparece en el mapa (nunca se presume cero).
 */
export function elegirSaldoVigente(
  asientos: AsientoSaldo[],
  diaIso: string,
): Map<string, SaldoVigente> {
  const corte = corteSaldoDia(diaIso);
  const vigentes = new Map<string, SaldoVigente>();

  const dentroDelCorte = asientos
    .filter((asiento) => asiento.fecha.getTime() <= corte.getTime())
    .sort((a, b) => {
      const porFecha = b.fecha.getTime() - a.fecha.getTime();
      if (porFecha !== 0) return porFecha;
      const porCreatedAt = b.created_at.getTime() - a.created_at.getTime();
      if (porCreatedAt !== 0) return porCreatedAt;
      // Desempate determinista por `id` (mayor primero), igual que el `orderBy` del service.
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

  for (const asiento of dentroDelCorte) {
    if (!vigentes.has(asiento.cuenta_id)) {
      vigentes.set(asiento.cuenta_id, {
        cuenta_id: asiento.cuenta_id,
        saldo: asiento.saldo,
        fecha: asiento.fecha,
      });
    }
  }

  return vigentes;
}

// ──────────────────────────────────────────────────────────────────────────────
// G7-5 — Caja virtual (Mercado Pago canal web)
// ──────────────────────────────────────────────────────────────────────────────

/** Ingreso con el único campo que suma la caja virtual. */
export interface IngresoMonto {
  monto: Prisma.Decimal;
}

/** Contra-asiento (reintegro) con el único campo que resta la caja virtual. */
export interface ContraMonto {
  monto: Prisma.Decimal;
}

/**
 * G7-5 — caja virtual = Σ `IngresoTesoreria.monto` − Σ
 * `ContraAsientoIngreso.monto`. Puede dar NEGATIVO (reintegros sin ingreso
 * neto); no se hace clamp a cero. Cada reducción arranca en `Decimal(0)`, así
 * que listas vacías dan `Decimal(0)`. NO se suman los `VentaMedioPago` web ni
 * se modelan retiros (se indican en pantalla).
 */
export function calcularCajaVirtual(
  ingresos: IngresoMonto[],
  contraAsientos: ContraMonto[],
): Prisma.Decimal {
  const totalIngresos = ingresos.reduce(
    (acc, ingreso) => acc.plus(ingreso.monto),
    new Prisma.Decimal(0),
  );
  const totalContra = contraAsientos.reduce(
    (acc, contra) => acc.plus(contra.monto),
    new Prisma.Decimal(0),
  );
  return totalIngresos.minus(totalContra);
}

// ──────────────────────────────────────────────────────────────────────────────
// G7-7 — Egresos proyectados (DEFINITIVA / PROVISORIO separados)
// ──────────────────────────────────────────────────────────────────────────────

/** Cuenta por pagar proyectada: los dos estados exigibles y su vencimiento. */
export interface CuentaProyectada {
  id: string;
  estado: "DEFINITIVA" | "PROVISORIO";
  monto: Prisma.Decimal;
  fecha_vencimiento: Date | null;
}

/** Grupo de egresos por fecha de vencimiento (`null` = grupo «sin fecha»). */
export interface GrupoEgreso {
  fecha_vencimiento: string | null;
  cuentas: CuentaProyectada[];
  subtotal: Prisma.Decimal;
}

export interface EgresosAgrupados {
  definitivas: GrupoEgreso[];
  provisorias: GrupoEgreso[];
  total_definitivas: Prisma.Decimal;
}

/** Agrupa por `fecha_vencimiento` (fecha-solo UTC), con los `null` al final. */
function agruparPorVencimiento(cuentas: CuentaProyectada[]): GrupoEgreso[] {
  const porFecha = new Map<string, CuentaProyectada[]>();
  const sinFecha: CuentaProyectada[] = [];

  for (const cuenta of cuentas) {
    if (cuenta.fecha_vencimiento === null) {
      sinFecha.push(cuenta);
      continue;
    }
    const clave = diaCalendarioUtc(cuenta.fecha_vencimiento);
    const grupo = porFecha.get(clave);
    if (grupo === undefined) porFecha.set(clave, [cuenta]);
    else grupo.push(cuenta);
  }

  const grupos: GrupoEgreso[] = [...porFecha.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fecha_vencimiento, filas]) => ({
      fecha_vencimiento,
      cuentas: filas,
      subtotal: sumarDecimales(filas.map((fila) => fila.monto)),
    }));

  if (sinFecha.length > 0) {
    grupos.push({
      fecha_vencimiento: null,
      cuentas: sinFecha,
      subtotal: sumarDecimales(sinFecha.map((fila) => fila.monto)),
    });
  }

  return grupos;
}

/**
 * G7-7 — separa los egresos proyectados en DOS bloques que NO se suman entre
 * sí: `DEFINITIVA` (deuda exigible) y `PROVISORIO` (compromiso estimado).
 * Dentro de cada bloque agrupa por `fecha_vencimiento` (con su propio grupo
 * «sin fecha»). El total de egresos proyectados suma SOLO las `DEFINITIVA`.
 */
export function agruparEgresosProyectados(cuentas: CuentaProyectada[]): EgresosAgrupados {
  const definitivas = cuentas.filter((cuenta) => cuenta.estado === "DEFINITIVA");
  const provisorias = cuentas.filter((cuenta) => cuenta.estado === "PROVISORIO");

  return {
    definitivas: agruparPorVencimiento(definitivas),
    provisorias: agruparPorVencimiento(provisorias),
    total_definitivas: sumarDecimales(definitivas.map((cuenta) => cuenta.monto)),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// G7-8 — Ingresos proyectados (saldo de CC + hitos informativos)
// ──────────────────────────────────────────────────────────────────────────────

/** Hito de un plan de pagos crudo (sin tipar, tal como llega del `Json`). */
export interface HitoPlan {
  hito: string;
  porcentaje: number;
  fecha_estimada?: string;
}

/** Operación de cuenta corriente con su plan de pagos crudo (`Json?`). */
export interface OperacionPlan {
  cuenta_corriente_id: string;
  monto: Prisma.Decimal;
  plan_de_pagos: unknown;
}

/** Hito proyectado e informativo (NO se suma al total líquido). */
export interface HitoProyectado {
  cuenta_corriente_id: string;
  hito: string;
  porcentaje: number;
  importe: Prisma.Decimal;
  fecha_estimada: string;
}

/** Guarda de forma de un hito del `plan_de_pagos` (objeto con `hito`/`porcentaje`). */
function esHitoPlan(valor: unknown): valor is HitoPlan {
  if (typeof valor !== "object" || valor === null) return false;
  const candidato = valor as Record<string, unknown>;
  return (
    typeof candidato.hito === "string" &&
    candidato.hito.length > 0 &&
    typeof candidato.porcentaje === "number" &&
    Number.isFinite(candidato.porcentaje)
  );
}

/**
 * G7-8 — hitos de proyección de ingresos a partir del `plan_de_pagos` (`Json`)
 * de las operaciones de cuenta corriente. Informativo: NO se suma al total
 * (design D3). Importe = `monto × porcentaje / 100` en `Prisma.Decimal` con la
 * escala 2 del dinero. Un hito SIN `fecha_estimada` queda EXCLUIDO, y un
 * `plan_de_pagos` que no sea un JSON con forma de lista de hitos se ignora
 * (devuelve lo acumulado, sin romper).
 */
export function proyectarHitosPlanPagos(operaciones: OperacionPlan[]): HitoProyectado[] {
  const hitos: HitoProyectado[] = [];

  for (const operacion of operaciones) {
    const plan = operacion.plan_de_pagos;
    if (!Array.isArray(plan)) continue;

    for (const crudo of plan) {
      if (!esHitoPlan(crudo)) continue;
      const fechaEstimada = crudo.fecha_estimada;
      if (typeof fechaEstimada !== "string" || fechaEstimada.length === 0) continue;

      const importe = operacion.monto
        .times(new Prisma.Decimal(crudo.porcentaje))
        .div(100)
        .toDecimalPlaces(2);

      hitos.push({
        cuenta_corriente_id: operacion.cuenta_corriente_id,
        hito: crudo.hito,
        porcentaje: crudo.porcentaje,
        importe,
        fecha_estimada: fechaEstimada,
      });
    }
  }

  return hitos;
}

// ──────────────────────────────────────────────────────────────────────────────
// Totales y formato
// ──────────────────────────────────────────────────────────────────────────────

/** Σ de una lista de `Decimal` (lista vacía ⇒ `Decimal(0)`). */
export function sumarDecimales(valores: Prisma.Decimal[]): Prisma.Decimal {
  return valores.reduce((acc, valor) => acc.plus(valor), new Prisma.Decimal(0));
}

/**
 * G7-1 — total líquido = Σ de los saldos vigentes + la caja virtual. Solo entran
 * las cuentas CON saldo registrado (ya filtradas por el llamador vía
 * `elegirSaldoVigente`).
 */
export function totalLiquido(
  saldos: SaldoVigente[],
  cajaVirtual: Prisma.Decimal,
): Prisma.Decimal {
  return sumarDecimales(saldos.map((saldo) => saldo.saldo)).plus(cajaVirtual);
}

/** Serializa un `Decimal` monetario a `string` con exactamente 2 decimales. */
export function formatMonto(decimal: Prisma.Decimal): string {
  return decimal.toFixed(2);
}
