import "server-only";

/**
 * @module cuenta-corriente.service
 * @description Capa de dominio de HU-B5 — Cuenta corriente de cliente y
 * autorización de excepción de crédito (spec_modulo_B.md §2.5, §3.3, §4;
 * docs/tasks/task_HU-B5.md). Toda regla de negocio vive acá — los Route
 * Handlers y Server Actions son wrappers finos (spec §1).
 *
 * Decisiones de diseño (task HU-B5 + confirmaciones del Paso 0):
 *  - `saldo_actual` solo se incrementa cuando la operación queda APROBADA
 *    (directa, o tras `resolverExcepcionCredito` con `APROBAR`); nunca por una
 *    RETENIDA sin resolver ni por un RECHAZO.
 *  - Alta: `SELECT … FOR UPDATE` sobre la fila de `CuentaCorrienteCliente`
 *    serializa altas concurrentes del mismo cliente, así el cálculo de
 *    `disponible` no puede quedar desactualizado entre la lectura y el UPDATE.
 *  - Resolución: `updateMany({ where: { estado: "RETENIDA" } })` + `count === 1`
 *    es la defensa contra condiciones de carrera (spec §3.1: validar el estado
 *    origen dentro de la misma transacción que ejecuta el UPDATE).
 *  - Al APROBAR una RETENIDA NO se revalida el límite: el saldo puede quedar
 *    por encima del límite, es el sentido mismo de la excepción de crédito.
 *  - Auto-aprobación permitida (decisión consciente, mismo criterio que
 *    HU-B4): la integridad descansa en `withPermission` (solo Supervisor de
 *    Ventas llega a `resolver`) + `AuditLog`, no en un control extra
 *    "solicitante ≠ autorizante".
 *  - LIMITACIÓN CONOCIDA: `CuentaCorrienteOperacion` no tiene columna del
 *    usuario que la registró, así que `usuario_solicitante_id` del evento
 *    sensible sale de `PedidoVenta.registrado_por_id`. Coincide con la
 *    integración prevista con HU-B1 (pedido y operación en la misma sesión),
 *    pero puede diferir si otro usuario registra la operación a mano.
 *  - `autorizacion_id`: id de correlación (`crypto.randomUUID()`) generado
 *    antes del COMMIT, no el `id` real de `AuditLog` (mismo criterio que
 *    `pedido-venta.service.ts`, docs/tasks/HU-B4.md §1.2).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  RegistrarOperacionCuentaCorrienteInput,
  ResolverExcepcionCreditoInput,
} from "@/lib/schemas/ventas.schema";

export const PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE = "ventas:gestionar_cuenta_corriente";
export const PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO = "ventas:autorizar_excepcion_credito";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface CuentaCorrienteConsulta {
  cliente_id: string;
  limite_credito_autorizado: number;
  saldo_actual: number;
  disponible: number;
}

export interface OperacionCuentaCorrienteRegistrada {
  operacion_id: string;
  estado: "APROBADA";
}

export interface ExcepcionCreditoResuelta {
  operacion_id: string;
  estado: "APROBADA" | "RECHAZADA";
  autorizacion_id: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.1 — Consulta de cuenta
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @throws {ServiceError} CUENTA_CORRIENTE_NO_ENCONTRADA (404)
 */
export async function consultarCuentaCorriente(clienteId: string): Promise<CuentaCorrienteConsulta> {
  const cuenta = await prisma.cuentaCorrienteCliente.findFirst({
    where: { cliente_id: clienteId, is_active: true, deleted_at: null },
    select: { cliente_id: true, limite_credito_autorizado: true, saldo_actual: true },
  });
  if (!cuenta) {
    throw new ServiceError(
      "CUENTA_CORRIENTE_NO_ENCONTRADA",
      "El cliente indicado no tiene una cuenta corriente",
    );
  }
  return {
    cliente_id: cuenta.cliente_id,
    limite_credito_autorizado: cuenta.limite_credito_autorizado.toNumber(),
    saldo_actual: cuenta.saldo_actual.toNumber(),
    disponible: cuenta.limite_credito_autorizado.sub(cuenta.saldo_actual).toNumber(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.2 — Registro de operación a cuenta corriente
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registra una operación contra la cuenta corriente de `clienteId`. Si el
 * monto entra en el disponible queda APROBADA y suma al `saldo_actual`; si lo
 * excede queda RETENIDA (persistida, sin tocar el saldo) y, DESPUÉS del
 * COMMIT, se lanza `LIMITE_CREDITO_EXCEDIDO` (422) con
 * `details.operacion_id` — la request no se rechaza de plano, la operación ya
 * existe y espera la resolución de un Supervisor.
 *
 * @throws {ServiceError} CUENTA_CORRIENTE_NO_ENCONTRADA (404)
 * @throws {ServiceError} PEDIDO_VENTA_NO_ENCONTRADO (404)
 * @throws {ServiceError} PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE (422)
 * @throws {ServiceError} PEDIDO_VENTA_NO_OPERABLE (422) — inactivo o ANULADO.
 * @throws {ServiceError} LIMITE_CREDITO_EXCEDIDO (422) — operación RETENIDA ya committeada.
 */
export async function registrarOperacionCuentaCorriente(
  clienteId: string,
  input: RegistrarOperacionCuentaCorrienteInput,
): Promise<OperacionCuentaCorrienteRegistrada> {
  const monto = new Prisma.Decimal(input.monto).toDecimalPlaces(2);
  // `fecha_estimada` (Date tras el `z.coerce.date()`) se serializa a ISO para el JSON.
  const planDePagos = input.plan_de_pagos?.map((h) => ({
    hito: h.hito,
    porcentaje: h.porcentaje,
    ...(h.fecha_estimada ? { fecha_estimada: h.fecha_estimada.toISOString() } : {}),
  }));

  const resultado = await prisma.$transaction(async (tx) => {
    // Bloqueo de fila: serializa altas concurrentes del mismo cliente.
    const cuentas = await tx.$queryRaw<
      Array<{ id: string; limite_credito_autorizado: Prisma.Decimal; saldo_actual: Prisma.Decimal }>
    >`SELECT id, limite_credito_autorizado, saldo_actual
      FROM cuentas_corrientes_cliente
      WHERE cliente_id = ${clienteId} AND is_active = true AND deleted_at IS NULL
      FOR UPDATE`;
    const cuenta = cuentas[0];
    if (!cuenta) {
      throw new ServiceError(
        "CUENTA_CORRIENTE_NO_ENCONTRADA",
        "El cliente indicado no tiene una cuenta corriente",
      );
    }

    const pedido = await tx.pedidoVenta.findUnique({
      where: { id: input.pedido_venta_id },
      select: { id: true, cliente_id: true, estado: true, is_active: true },
    });
    if (!pedido) {
      throw new ServiceError("PEDIDO_VENTA_NO_ENCONTRADO", "El pedido de venta indicado no existe");
    }
    if (pedido.cliente_id !== clienteId) {
      throw new ServiceError(
        "PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE",
        "El pedido de venta indicado no pertenece a este cliente",
      );
    }
    if (!pedido.is_active || pedido.estado === "ANULADO") {
      throw new ServiceError(
        "PEDIDO_VENTA_NO_OPERABLE",
        "No se puede registrar una operación sobre un pedido anulado o inactivo",
      );
    }

    // Revalidado server-side dentro de la transacción, con la fila bloqueada.
    const disponible = new Prisma.Decimal(cuenta.limite_credito_autorizado).sub(cuenta.saldo_actual);
    const aprobada = monto.lte(disponible);

    const operacion = await tx.cuentaCorrienteOperacion.create({
      data: {
        cuenta_corriente_id: cuenta.id,
        pedido_venta_id: pedido.id,
        monto,
        plan_de_pagos: planDePagos,
        estado: aprobada ? "APROBADA" : "RETENIDA",
        autorizado_por_id: null,
      },
      select: { id: true },
    });

    if (aprobada) {
      await tx.cuentaCorrienteCliente.update({
        where: { id: cuenta.id },
        data: { saldo_actual: { increment: monto } },
      });
    }

    return { operacionId: operacion.id, aprobada };
  });

  // Post-COMMIT (spec §3.3): el evento se emite tanto para APROBADA como RETENIDA.
  domainEventBus.emit("venta:operacion_cuenta_corriente_registrada", {
    operacion_id: resultado.operacionId,
    cliente_id: clienteId,
    pedido_venta_id: input.pedido_venta_id,
    monto: monto.toNumber(),
    estado: resultado.aprobada ? "APROBADA" : "RETENIDA",
    ...(planDePagos ? { plan_de_pagos: planDePagos } : {}),
  });

  if (!resultado.aprobada) {
    throw new ServiceError(
      "LIMITE_CREDITO_EXCEDIDO",
      "La operación excede el límite de crédito disponible; requiere autorización de un Supervisor de Ventas",
      { operacion_id: resultado.operacionId },
    );
  }

  return { operacion_id: resultado.operacionId, estado: "APROBADA" };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.3 — Resolución de una operación RETENIDA
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Aprueba o rechaza una operación RETENIDA. El permiso
 * `ventas:autorizar_excepcion_credito` lo exige el gate del Route Handler /
 * Server Action; `usuarioAutorizanteId` es el usuario de la sesión.
 *
 * @throws {ServiceError} OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA (404)
 * @throws {ServiceError} TRANSICION_INVALIDA (409) — la operación no está RETENIDA.
 */
export async function resolverExcepcionCredito(
  operacionId: string,
  input: ResolverExcepcionCreditoInput,
  usuarioAutorizanteId: string,
): Promise<ExcepcionCreditoResuelta> {
  // Id de correlación generado ANTES del COMMIT (patrón HU-B4).
  const autorizacionId = crypto.randomUUID();
  const aprobar = input.decision === "APROBAR";

  const datos = await prisma.$transaction(async (tx) => {
    const operacion = await tx.cuentaCorrienteOperacion.findFirst({
      where: { id: operacionId, is_active: true },
      select: {
        id: true,
        monto: true,
        pedido_venta_id: true,
        cuenta_corriente_id: true,
        cuenta_corriente: { select: { cliente_id: true } },
        pedido_venta: { select: { registrado_por_id: true } },
      },
    });
    if (!operacion) {
      throw new ServiceError(
        "OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA",
        "La operación de cuenta corriente indicada no existe",
      );
    }

    // Guardia atómica de estado origen: si otra request ya la resolvió
    // (o nunca estuvo RETENIDA), count === 0.
    const { count } = await tx.cuentaCorrienteOperacion.updateMany({
      where: { id: operacionId, is_active: true, estado: "RETENIDA" },
      data: {
        estado: aprobar ? "APROBADA" : "RECHAZADA",
        autorizado_por_id: usuarioAutorizanteId,
      },
    });
    if (count !== 1) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        "Solo una operación en estado RETENIDA puede resolverse",
      );
    }

    if (aprobar) {
      await tx.cuentaCorrienteCliente.update({
        where: { id: operacion.cuenta_corriente_id },
        data: { saldo_actual: { increment: operacion.monto } },
      });
    }

    return {
      pedidoVentaId: operacion.pedido_venta_id,
      clienteId: operacion.cuenta_corriente.cliente_id,
      solicitanteId: operacion.pedido_venta.registrado_por_id,
      monto: operacion.monto.toNumber(),
    };
  });

  // Post-COMMIT: evento sensible → Módulo D (encadenamiento SHA-256).
  domainEventBus.emit("venta:excepcion_credito_resuelta", {
    autorizacion_id: autorizacionId,
    operacion_id: operacionId,
    pedido_venta_id: datos.pedidoVentaId,
    cliente_id: datos.clienteId,
    usuario_solicitante_id: datos.solicitanteId,
    usuario_autorizante_id: usuarioAutorizanteId,
    decision: input.decision,
    motivo: input.motivo,
    monto: datos.monto,
  });

  return {
    operacion_id: operacionId,
    estado: aprobar ? "APROBADA" : "RECHAZADA",
    autorizacion_id: autorizacionId,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lecturas para la UI (solo consulta)
// ──────────────────────────────────────────────────────────────────────────────

export interface CuentaCorrienteResumen extends CuentaCorrienteConsulta {
  cliente_nombre: string;
  operaciones_retenidas: number;
}

/** Listado de cuentas activas para `/ventas/cuentas-corrientes`. */
export async function listarCuentasCorrientes(): Promise<CuentaCorrienteResumen[]> {
  const cuentas = await prisma.cuentaCorrienteCliente.findMany({
    where: { is_active: true, deleted_at: null },
    orderBy: { cliente: { nombre: "asc" } },
    select: {
      cliente_id: true,
      limite_credito_autorizado: true,
      saldo_actual: true,
      cliente: { select: { nombre: true } },
      _count: { select: { operaciones: { where: { is_active: true, estado: "RETENIDA" } } } },
    },
  });
  return cuentas.map((c) => ({
    cliente_id: c.cliente_id,
    cliente_nombre: c.cliente.nombre,
    limite_credito_autorizado: c.limite_credito_autorizado.toNumber(),
    saldo_actual: c.saldo_actual.toNumber(),
    disponible: c.limite_credito_autorizado.sub(c.saldo_actual).toNumber(),
    operaciones_retenidas: c._count.operaciones,
  }));
}

export type EstadoOperacionCuentaCorriente = "APROBADA" | "RETENIDA" | "RECHAZADA";

export interface OperacionCuentaCorrienteDetalle {
  id: string;
  pedido_venta_id: string;
  numero_venta: string;
  monto: number;
  estado: EstadoOperacionCuentaCorriente;
  autorizado_por_id: string | null;
  autorizado_por_nombre: string | null;
  plan_de_pagos: Array<{ hito: string; porcentaje: number; fecha_estimada?: string }> | null;
  created_at: string;
}

export interface CuentaCorrienteDetalle extends CuentaCorrienteConsulta {
  cliente_nombre: string;
  operaciones: OperacionCuentaCorrienteDetalle[];
}

/** Detalle de una cuenta con su historial de operaciones. `null` si no existe. */
export async function obtenerCuentaCorrienteDetalle(
  clienteId: string,
): Promise<CuentaCorrienteDetalle | null> {
  const cuenta = await prisma.cuentaCorrienteCliente.findFirst({
    where: { cliente_id: clienteId, is_active: true, deleted_at: null },
    select: {
      cliente_id: true,
      limite_credito_autorizado: true,
      saldo_actual: true,
      cliente: { select: { nombre: true } },
      operaciones: {
        where: { is_active: true },
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          pedido_venta_id: true,
          monto: true,
          estado: true,
          autorizado_por_id: true,
          plan_de_pagos: true,
          created_at: true,
          pedido_venta: { select: { numero_venta: true } },
          autorizado_por: { select: { nombre_completo: true } },
        },
      },
    },
  });
  if (!cuenta) return null;

  return {
    cliente_id: cuenta.cliente_id,
    cliente_nombre: cuenta.cliente.nombre,
    limite_credito_autorizado: cuenta.limite_credito_autorizado.toNumber(),
    saldo_actual: cuenta.saldo_actual.toNumber(),
    disponible: cuenta.limite_credito_autorizado.sub(cuenta.saldo_actual).toNumber(),
    operaciones: cuenta.operaciones.map((o) => ({
      id: o.id,
      pedido_venta_id: o.pedido_venta_id,
      numero_venta: o.pedido_venta.numero_venta,
      monto: o.monto.toNumber(),
      estado: o.estado,
      autorizado_por_id: o.autorizado_por_id,
      autorizado_por_nombre: o.autorizado_por?.nombre_completo ?? null,
      plan_de_pagos: (o.plan_de_pagos as OperacionCuentaCorrienteDetalle["plan_de_pagos"]) ?? null,
      created_at: o.created_at.toISOString(),
    })),
  };
}
