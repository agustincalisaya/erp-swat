import "server-only";

/**
 * @module turno-caja.service
 * @description Capa de dominio de HU-B2 — Apertura y cierre de turno de caja
 * con arqueo ciego (spec_modulo_B.md §2.2, task_relos.md).
 *
 * TODA la lógica de negocio de este circuito vive acá: el Route Handler
 * (`app/api/ventas/turnos/**`) y las Server Actions
 * (`app/(dashboard)/ventas/turnos/actions.ts`) son wrappers finos — resuelven
 * sesión + permiso granular, parsean el body con Zod, invocan una función de
 * este archivo y mapean el resultado/excepción al shape estándar
 * `{ data, error }`. Está prohibido reimplementar cualquier regla de acá en
 * esas capas.
 *
 * Arqueo ciego (task §2): es una garantía de UI/frontend, no de backend — el
 * Cajero ya declaró su `conteo_fisico_declarado` en el body cuando este
 * servicio lo recibe. `saldo_esperado`/`diferencia` se calculan en el MISMO
 * request donde llega el conteo, nunca antes (`cerrarTurnoCaja()` es la
 * única función de este archivo que los calcula — `obtenerTurnoAbiertoDeUsuario()`,
 * de solo lectura, nunca los expone, task §6.2 punto 6).
 *
 * Concurrencia — "un solo turno abierto por Cajero a la vez" (task, nota de
 * concurrencia): se valida con un `findFirst` antes del `create`, sin
 * constraint de base de datos, mismo patrón de verificación explícita que ya
 * usa el proyecto en `resolverVersionVigente()` de `lista-precios.service.ts`
 * (HU-H2) para "versión vigente" — no hay `@@unique` en `schema.prisma` que
 * lo garantice a nivel de constraint.
 *
 * Reglas transversales aplicadas (RULES.md §1/§2):
 *  - Ninguna función de este archivo invoca `prisma.*.delete()` / `deleteMany()`.
 *  - Los eventos de dominio se emiten DESPUÉS de la escritura exitosa, nunca
 *    antes (mismo patrón fire-and-forget que el resto del proyecto).
 */

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { AbrirTurnoCajaInput, CerrarTurnoCajaInput } from "@/lib/schemas/ventas.schema";
import { UMBRAL_DIFERENCIA_ARQUEO } from "./turno-caja.constants";
import { calcularDiferencia, calcularSaldoEsperado, requiereJustificacion } from "./turno-caja.calculo";

export const PERMISO_VENTAS_GESTIONAR_TURNO_CAJA = "ventas:gestionar_turno_caja";

// ──────────────────────────────────────────────────────────────────────────────
// §6.1 — Apertura
// ──────────────────────────────────────────────────────────────────────────────

export interface TurnoCajaAbierto {
  turno_caja_id: string;
  fondo_fijo_inicial: number;
  fecha_apertura: string;
}

/**
 * Abre un `TurnoCaja` para `usuarioId` (task §6.1).
 *
 * @throws {ServiceError} TURNO_YA_ABIERTO (409) — ya existe un `TurnoCaja` de
 *   este usuario con `fecha_cierre: null`.
 */
export async function abrirTurnoCaja(
  usuarioId: string,
  input: AbrirTurnoCajaInput,
): Promise<TurnoCajaAbierto> {
  const turnoAbierto = await prisma.turnoCaja.findFirst({
    where: { usuario_id: usuarioId, fecha_cierre: null },
    select: { id: true },
  });
  if (turnoAbierto) {
    throw new ServiceError(
      "TURNO_YA_ABIERTO",
      "Ya existe un turno de caja abierto para este usuario — cerralo antes de abrir uno nuevo",
    );
  }

  const turno = await prisma.turnoCaja.create({
    data: {
      usuario_id: usuarioId,
      fondo_fijo_inicial: input.fondo_fijo_inicial,
    },
    select: { id: true, fondo_fijo_inicial: true, fecha_apertura: true },
  });

  // Post-escritura: evento de dominio → Módulo D (auditoría SHA-256).
  domainEventBus.emit("venta:turno_abierto", {
    turno_caja_id: turno.id,
    usuario_id: usuarioId,
    fondo_fijo_inicial: turno.fondo_fijo_inicial.toNumber(),
  });

  return {
    turno_caja_id: turno.id,
    fondo_fijo_inicial: turno.fondo_fijo_inicial.toNumber(),
    fecha_apertura: turno.fecha_apertura.toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §6.2 — Cierre con arqueo ciego
// ──────────────────────────────────────────────────────────────────────────────

export interface TurnoCajaCerrado {
  turno_caja_id: string;
  saldo_esperado: number;
  conteo_fisico_declarado: number;
  diferencia: number;
  requiere_justificacion: boolean;
  justificacion: string | null;
}

/**
 * Cierra un `TurnoCaja` (task §6.2). `saldo_esperado` se calcula EN ESTA
 * INVOCACIÓN, nunca antes — es la garantía de backend del arqueo ciego (la
 * garantía de UI es responsabilidad de la pantalla, que no debe pedir/mostrar
 * el conteo hasta después de haber recibido `saldo_esperado` de vuelta).
 *
 * `saldo_esperado = fondo_fijo_inicial + SUM(VentaMedioPago.importe WHERE
 * medio = 'EFECTIVO' AND pedido_venta.turno_caja_id = turnoCajaId AND
 * pedido_venta.is_active = true)` — HU-B1 todavía no existe en código en
 * este punto de la secuencia (task, nota de sección 6.2 punto 2), así que
 * `totalVentasEfectivo` es `0` para todo turno real hoy; la suma queda
 * cableada correctamente para cuando HU-B1 empiece a persistir
 * `VentaMedioPago`, y cubierta con datos sintéticos en
 * `turno-caja.integration.test.ts` (ver Pendientes reales, task §10).
 *
 * @throws {ServiceError} TURNO_NO_ENCONTRADO (404)
 * @throws {ServiceError} TURNO_YA_CERRADO (409) — `fecha_cierre` ya no es `null`.
 * @throws {ServiceError} SIN_PERMISO_CIERRE (403) — `usuario_id` del turno no
 *   coincide con quien intenta cerrarlo.
 * @throws {ServiceError} JUSTIFICACION_REQUERIDA (422) — `Math.abs(diferencia)`
 *   supera `UMBRAL_DIFERENCIA_ARQUEO` y no vino `justificacion` — el turno
 *   NO se cierra, el Cajero debe reenviar con justificación.
 */
export async function cerrarTurnoCaja(
  turnoCajaId: string,
  usuarioId: string,
  input: CerrarTurnoCajaInput,
): Promise<TurnoCajaCerrado> {
  const turno = await prisma.turnoCaja.findFirst({
    where: { id: turnoCajaId },
    select: { id: true, usuario_id: true, fondo_fijo_inicial: true, fecha_cierre: true },
  });
  if (!turno) {
    throw new ServiceError("TURNO_NO_ENCONTRADO", "El turno de caja indicado no existe");
  }
  if (turno.fecha_cierre !== null) {
    throw new ServiceError("TURNO_YA_CERRADO", "Este turno de caja ya fue cerrado");
  }
  if (turno.usuario_id !== usuarioId) {
    throw new ServiceError(
      "SIN_PERMISO_CIERRE",
      "Solo el Cajero titular del turno puede cerrarlo",
    );
  }

  // Arqueo ciego, lado backend: este es el ÚNICO punto de todo el servicio
  // donde se calcula saldo_esperado — nunca antes, nunca en un endpoint de
  // lectura (task §6.2 punto 6).
  const agregadoEfectivo = await prisma.ventaMedioPago.aggregate({
    where: {
      medio: "EFECTIVO",
      is_active: true,
      pedido_venta: { turno_caja_id: turnoCajaId, is_active: true },
    },
    _sum: { importe: true },
  });
  const totalVentasEfectivo = agregadoEfectivo._sum.importe?.toNumber() ?? 0;

  const fondoFijoInicial = turno.fondo_fijo_inicial.toNumber();
  const saldoEsperado = calcularSaldoEsperado(fondoFijoInicial, totalVentasEfectivo);
  const diferencia = calcularDiferencia(saldoEsperado, input.conteo_fisico_declarado);

  if (requiereJustificacion(diferencia, input.justificacion)) {
    throw new ServiceError(
      "JUSTIFICACION_REQUERIDA",
      `La diferencia de arqueo ($${diferencia.toFixed(2)}) supera el umbral permitido ` +
        `($${UMBRAL_DIFERENCIA_ARQUEO}) — reenviá el cierre con una justificación`,
    );
  }

  const justificacionFinal = input.justificacion?.trim() ? input.justificacion.trim() : null;
  const superaUmbral = Math.abs(diferencia) > UMBRAL_DIFERENCIA_ARQUEO;

  // Única operación de escritura (task §6.2 punto 5) — un único `update`
  // sobre una sola fila, sin envolverlo en una transacción multi-tabla.
  await prisma.turnoCaja.update({
    where: { id: turnoCajaId },
    data: {
      fecha_cierre: new Date(),
      saldo_esperado: saldoEsperado,
      conteo_fisico_declarado: input.conteo_fisico_declarado,
      diferencia,
      justificacion: justificacionFinal,
    },
  });

  // Post-escritura: evento de dominio → Módulo D. Sensible (SHA-256
  // reforzado, mismo criterio que HU-B4) cuando `superaUmbral` — el listener
  // de auditoría distingue la `accion` por este mismo flag (task §7).
  domainEventBus.emit("venta:turno_cerrado", {
    turno_caja_id: turnoCajaId,
    usuario_id: usuarioId,
    saldo_esperado: saldoEsperado,
    conteo_fisico_declarado: input.conteo_fisico_declarado,
    diferencia,
    requiere_justificacion: superaUmbral,
    justificacion: justificacionFinal,
  });

  return {
    turno_caja_id: turnoCajaId,
    saldo_esperado: saldoEsperado,
    conteo_fisico_declarado: input.conteo_fisico_declarado,
    diferencia,
    requiere_justificacion: superaUmbral,
    justificacion: justificacionFinal,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lectura para la UI — NUNCA calcula ni expone saldo_esperado (task §6.2 punto 6)
// ──────────────────────────────────────────────────────────────────────────────

export interface TurnoCajaResumenAbierto {
  turno_caja_id: string;
  fondo_fijo_inicial: number;
  fecha_apertura: string;
}

/**
 * Turno abierto (si existe) de `usuarioId`, para que la pantalla de
 * `/ventas/turnos` sepa si debe mostrar el formulario de apertura o el de
 * cierre. Proyección deliberadamente mínima: SOLO `fondo_fijo_inicial` y
 * `fecha_apertura` — jamás un cálculo de `saldo_esperado`, ni siquiera de un
 * turno ya cerrado (esa lectura queda fuera de alcance de este PR, task §8:
 * "no hace falta listado histórico de turnos").
 */
export async function obtenerTurnoAbiertoDeUsuario(
  usuarioId: string,
): Promise<TurnoCajaResumenAbierto | null> {
  const turno = await prisma.turnoCaja.findFirst({
    where: { usuario_id: usuarioId, fecha_cierre: null },
    select: { id: true, fondo_fijo_inicial: true, fecha_apertura: true },
  });
  if (!turno) return null;

  return {
    turno_caja_id: turno.id,
    fondo_fijo_inicial: turno.fondo_fijo_inicial.toNumber(),
    fecha_apertura: turno.fecha_apertura.toISOString(),
  };
}
