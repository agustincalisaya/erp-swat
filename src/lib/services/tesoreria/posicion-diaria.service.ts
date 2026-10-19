import "server-only";

/**
 * @module posicion-diaria.service
 * @description Capa de dominio de HU-G7 (spec_modulo_G.md §9.8): posición diaria
 * consolidada de Tesorería. Lee las cuentas propias activas + la caja virtual
 * `MERCADO_PAGO_CANAL_WEB` + las proyecciones (egresos e ingresos) y, por la
 * otra acción, registra un `SaldoDiarioCuenta` append-only.
 *
 * Reglas transversales (RULES.md §1/§2/§7, spec G §9.8):
 *  - Autorización por PERMISO, nunca por nombre de rol. GET exige
 *    `tesoreria:leer_reportes`; POST `tesoreria:registrar_saldo_diario`. Las
 *    rutas lo resuelven con `withPermission`.
 *  - `SaldoDiarioCuenta` es append-only: NO existe update ni delete. Una
 *    corrección es OTRA fila del mismo día; prevalece la de mayor `created_at`
 *    (desempate por `id`). La escritura vive en un único `prisma.$transaction`;
 *    el evento D1 se emite POST-COMMIT, nunca dentro de la transacción.
 *  - Todo el dinero es `Prisma.Decimal`; se serializa con `.toFixed(2)`.
 *  - La respuesta NUNCA expone CBU ni alias: las cuentas se identifican por
 *    nombre/ID (la proyección de `listarCuentasPropiasActivas()` no descifra).
 *  - NO se lee `TurnoCaja`: el arqueo ciego de HU-B2 se conserva intacto.
 */

import { Prisma } from "@prisma/client";
import type { TipoCuentaPropia } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { RegistrarSaldoDiarioInput } from "@/lib/schemas/posicion-diaria.schema";
import { diaCalendarioUtc, inicioDiaUtc } from "@/lib/utils/fecha-negocio";
import { listarCuentasPropiasActivas } from "@/lib/services/tesoreria/cuenta-propia.service";
import { CAJA_VIRTUAL_MERCADO_PAGO_WEB } from "@/lib/services/tesoreria/ingreso-tesoreria.service";
import {
  agruparEgresosProyectados,
  type AsientoSaldo,
  calcularCajaVirtual,
  corteCajaHasta,
  corteSaldoDia,
  type CuentaProyectada,
  elegirSaldoVigente,
  formatMonto,
  type GrupoEgreso,
  type OperacionPlan,
  proyectarHitosPlanPagos,
  type SaldoVigente,
  totalLiquido,
} from "@/lib/services/tesoreria/posicion-diaria.calculo";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos y constantes (spec §9.8 / §7) — un permiso por acción.
// ──────────────────────────────────────────────────────────────────────────────

/** POST — registra un saldo diario. Solo Tesorero Central (uuid `…055`). */
export const PERMISO_REGISTRAR_SALDO_DIARIO = "tesoreria:registrar_saldo_diario";

/** GET — punto de verdad compartido con el reporte mensual (HU-G15). */
export { PERMISO_LEER_REPORTES } from "@/lib/services/tesoreria/reporte-mensual.service";

/**
 * Caja virtual de Mercado Pago (canal web). Se re-exporta desde
 * `ingreso-tesoreria.service.ts` (HU-G11) para no duplicar el literal: es la
 * única fuente de los cobros online, y su saldo no se imputa a ningún
 * `TurnoCaja`.
 */
export { CAJA_VIRTUAL_MERCADO_PAGO_WEB };

/** G7-5 / G7-8 — texto de las salvedades que la UI debe mostrar tal cual. */
const NOTA_RETIROS = "Los retiros de Mercado Pago no están modelados.";
const NOTA_COBRANZAS_EXTERNAS =
  "Las cobranzas externas de cuenta corriente no se registran.";

// ──────────────────────────────────────────────────────────────────────────────
// DTOs (dinero = string `.toFixed(2)`; cortes temporales explícitos)
// ──────────────────────────────────────────────────────────────────────────────

export interface CuentaPosicionDto {
  cuenta_id: string;
  nombre: string;
  tipo: TipoCuentaPropia;
  origen: "PROPIA" | "CAJA_VIRTUAL";
  /** `null` cuando no hay saldo registrado (nunca se presume cero). */
  saldo: string | null;
  sin_saldo_registrado: boolean;
  /** Día del asiento vigente (`AAAA-MM-DD`) o `null`. */
  fecha_saldo: string | null;
}

export interface GrupoEgresoDto {
  /** Día de vencimiento (`AAAA-MM-DD`) o `null` para el grupo «sin fecha». */
  fecha_vencimiento: string | null;
  total: string;
  cuentas: { id: string; monto: string }[];
}

export interface ProyeccionEgresosDto {
  definitivas: GrupoEgresoDto[];
  provisorias: GrupoEgresoDto[];
  /** Suma SOLO de las `DEFINITIVA` (los dos bloques NO se suman entre sí). */
  total_definitivas: string;
  nota: string;
}

export interface CuentaCorrienteDto {
  cuenta_corriente_id: string;
  cliente: string;
  saldo_actual: string;
}

export interface HitoDto {
  cuenta_corriente_id: string;
  hito: string;
  porcentaje: number;
  importe: string;
  fecha_estimada: string;
}

export interface ProyeccionIngresosDto {
  cuentas_corrientes: CuentaCorrienteDto[];
  hitos: HitoDto[];
  nota_cobranzas_externas: string;
}

export interface PosicionDiariaDto {
  dia: string;
  corte: { liquido: string; proyecciones: "ESTADO_ACTUAL" };
  cuentas: CuentaPosicionDto[];
  caja_virtual: { id: string; saldo: string; nota_retiros: string };
  total_liquido: string;
  proyeccion_egresos: ProyeccionEgresosDto;
  proyeccion_ingresos: ProyeccionIngresosDto;
}

export interface SaldoRegistrado {
  saldo_diario_id: string;
  cuenta_id: string;
  fecha: string;
  saldo: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────────────────────

/** Suma de agregados Prisma `_sum`: `Decimal | null` ⇒ `Decimal(0)`, nunca `.toNumber()`. */
function decimalSeguro(valor: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return valor ?? new Prisma.Decimal(0);
}

/** Traduce el `RangeError` de `fecha-negocio` a un `ServiceError` de dominio. */
function aServiceErrorPeriodo(error: unknown): never {
  if (error instanceof RangeError) {
    throw new ServiceError("PERIODO_INVALIDO", error.message);
  }
  throw error;
}

function aGrupoEgresoDto(grupo: GrupoEgreso): GrupoEgresoDto {
  return {
    fecha_vencimiento: grupo.fecha_vencimiento,
    total: formatMonto(grupo.subtotal),
    cuentas: grupo.cuentas.map((cuenta) => ({
      id: cuenta.id,
      monto: formatMonto(cuenta.monto),
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §9.8 / G7-1..G7-8 — Lectura: posición diaria consolidada
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Arma la posición diaria consolidada de un día de Argentina.
 *
 * Cortes (design ADR-2): el día elegido gobierna los saldos LÍQUIDOS
 * (`corte.liquido = diaIso`); las deudas y cuentas corrientes proyectadas
 * reflejan el ESTADO ACTUAL (`corte.proyecciones = "ESTADO_ACTUAL"`).
 *
 * @throws {ServiceError} PERIODO_INVALIDO si el día no es un rango válido.
 */
export async function obtenerPosicionDiaria(diaIso: string): Promise<PosicionDiariaDto> {
  let corte: Date;
  let hasta: Date;
  try {
    corte = corteSaldoDia(diaIso);
    hasta = corteCajaHasta(diaIso);
  } catch (error) {
    aServiceErrorPeriodo(error);
  }

  const cuentas = await listarCuentasPropiasActivas();
  const idsCuentas = cuentas.map((cuenta) => cuenta.id);

  const [asientos, ingresos, contraAsientos, cuentasPorPagar, cuentasCorrientes] =
    await Promise.all([
      idsCuentas.length === 0
        ? Promise.resolve([] as AsientoSaldo[])
        : prisma.saldoDiarioCuenta.findMany({
            where: { cuenta_id: { in: idsCuentas }, fecha: { lte: corte } },
            orderBy: [{ fecha: "desc" }, { created_at: "desc" }, { id: "desc" }],
            select: {
              id: true,
              cuenta_id: true,
              fecha: true,
              created_at: true,
              saldo: true,
            },
          }),
      // Caja virtual: acumulado SIN cota inferior, corte semiabierto por el día siguiente.
      prisma.ingresoTesoreria.findMany({
        where: { fecha: { lt: hasta } },
        select: { monto: true },
      }),
      // Contra-asientos por `created_at` (instante real), mismo corte. SIN turnos.
      prisma.contraAsientoIngreso.findMany({
        where: { created_at: { lt: hasta } },
        select: { monto: true },
      }),
      // Egresos proyectados: solo DEFINITIVA/PROVISORIO activos; nunca PAGADA/CANCELADA.
      prisma.cuentaPorPagar.findMany({
        where: {
          is_active: true,
          deleted_at: null,
          estado: { in: ["DEFINITIVA", "PROVISORIO"] },
        },
        select: { id: true, estado: true, monto: true, fecha_vencimiento: true },
      }),
      prisma.cuentaCorrienteCliente.findMany({
        where: { is_active: true, deleted_at: null },
        select: {
          id: true,
          saldo_actual: true,
          cliente: { select: { nombre: true } },
          operaciones: {
            where: { is_active: true, deleted_at: null },
            select: { monto: true, plan_de_pagos: true },
          },
        },
      }),
    ]);

  const saldosVigentes = elegirSaldoVigente(asientos, diaIso);
  const cajaVirtual = calcularCajaVirtual(ingresos, contraAsientos);
  const total = totalLiquido([...saldosVigentes.values()], cajaVirtual);

  const cuentasDto: CuentaPosicionDto[] = cuentas.map((cuenta) => {
    const vigente: SaldoVigente | undefined = saldosVigentes.get(cuenta.id);
    return {
      cuenta_id: cuenta.id,
      nombre: cuenta.nombre,
      tipo: cuenta.tipo,
      origen: "PROPIA",
      saldo: vigente === undefined ? null : formatMonto(vigente.saldo),
      sin_saldo_registrado: vigente === undefined,
      fecha_saldo: vigente === undefined ? null : diaCalendarioUtc(vigente.fecha),
    };
  });

  const egresos: CuentaProyectada[] = cuentasPorPagar.flatMap((fila) => {
    // El `where` ya filtró a estos dos estados; esto lo estrecha para el tipo.
    if (fila.estado !== "DEFINITIVA" && fila.estado !== "PROVISORIO") return [];
    return [
      {
        id: fila.id,
        estado: fila.estado,
        monto: decimalSeguro(fila.monto),
        fecha_vencimiento: fila.fecha_vencimiento,
      },
    ];
  });
  const egresosAgrupados = agruparEgresosProyectados(egresos);

  const operaciones: OperacionPlan[] = cuentasCorrientes.flatMap((cuenta) =>
    cuenta.operaciones.map((operacion) => ({
      cuenta_corriente_id: cuenta.id,
      monto: decimalSeguro(operacion.monto),
      plan_de_pagos: operacion.plan_de_pagos,
    })),
  );
  const hitos = proyectarHitosPlanPagos(operaciones);

  return {
    dia: diaIso,
    corte: { liquido: diaIso, proyecciones: "ESTADO_ACTUAL" },
    cuentas: cuentasDto,
    caja_virtual: {
      id: CAJA_VIRTUAL_MERCADO_PAGO_WEB,
      saldo: formatMonto(cajaVirtual),
      nota_retiros: NOTA_RETIROS,
    },
    total_liquido: formatMonto(total),
    proyeccion_egresos: {
      definitivas: egresosAgrupados.definitivas.map(aGrupoEgresoDto),
      provisorias: egresosAgrupados.provisorias.map(aGrupoEgresoDto),
      total_definitivas: formatMonto(egresosAgrupados.total_definitivas),
      nota: "Las DEFINITIVA y PROVISORIO se muestran por separado y no se suman entre sí.",
    },
    proyeccion_ingresos: {
      cuentas_corrientes: cuentasCorrientes.map((cuenta) => ({
        cuenta_corriente_id: cuenta.id,
        cliente: cuenta.cliente.nombre,
        saldo_actual: formatMonto(decimalSeguro(cuenta.saldo_actual)),
      })),
      hitos: hitos.map((hito) => ({
        cuenta_corriente_id: hito.cuenta_corriente_id,
        hito: hito.hito,
        porcentaje: hito.porcentaje,
        importe: formatMonto(hito.importe),
        fecha_estimada: hito.fecha_estimada,
      })),
      nota_cobranzas_externas: NOTA_COBRANZAS_EXTERNAS,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §9.8 / G7-4 — Escritura: registro append-only de saldo diario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registra un `SaldoDiarioCuenta` (append-only). Verifica DENTRO de la
 * transacción que la cuenta exista y esté activa, y crea UNA fila nueva — una
 * corrección es otra fila del mismo día (no hay update). El evento D1
 * `tesoreria:saldo_diario_registrado` se emite POST-COMMIT; D.3 escribe el
 * asiento de auditoría.
 *
 * @throws {ServiceError} CUENTA_PROPRIA_NO_ENCONTRADA si la cuenta no existe o está inactiva.
 */
export async function registrarSaldoDiario(
  input: RegistrarSaldoDiarioInput,
  usuarioId: string,
): Promise<SaldoRegistrado> {
  const creado = await prisma.$transaction(async (tx) => {
    const cuenta = await tx.cuentaPropia.findFirst({
      where: { id: input.cuenta_id, is_active: true, deleted_at: null },
      select: { id: true },
    });

    if (!cuenta) {
      throw new ServiceError(
        "CUENTA_PROPRIA_NO_ENCONTRADA",
        "La cuenta propia indicada no existe o está inactiva",
      );
    }

    return tx.saldoDiarioCuenta.create({
      data: {
        cuenta_id: input.cuenta_id,
        fecha: inicioDiaUtc(input.fecha),
        saldo: new Prisma.Decimal(input.saldo),
        registrado_por_id: usuarioId,
      },
      select: { id: true, cuenta_id: true, fecha: true, saldo: true },
    });
  });

  domainEventBus.emit("tesoreria:saldo_diario_registrado", {
    cuenta_propia_id: creado.cuenta_id,
    fecha: creado.fecha.toISOString(),
    saldo: creado.saldo.toFixed(2),
    usuario_id: usuarioId,
    timestamp: new Date().toISOString(),
  });

  return {
    saldo_diario_id: creado.id,
    cuenta_id: creado.cuenta_id,
    fecha: creado.fecha.toISOString(),
    saldo: creado.saldo.toFixed(2),
  };
}
