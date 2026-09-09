import "server-only";

/**
 * @module cuenta-por-pagar.service
 * @description Capa de dominio de HU-G8 (spec_modulo_G.md §2, §3). Máquina de
 * estados reactiva `PROVISORIO → DEFINITIVA → PAGADA` (+ `CANCELADA`), sin
 * alta manual. Contiene las tres transiciones reactivas al evento
 * `orden_compra:estado_cambiado` (invocadas por `cuenta-por-pagar.listener.ts`,
 * PR2), la mutación manual `marcarCuentaPorPagarPagada`, el listado y los
 * helpers puros re-exportados de `./cuenta-por-pagar.calculo`.
 *
 * Reglas transversales (spec §3, RULES.md §1/§2): sin `delete()`/`deleteMany()`;
 * `CANCELADA` NO es baja lógica (`is_active` sigue `true`); toda escritura en un
 * único `prisma.$transaction`; `cuenta_por_pagar:estado_cambiado` se emite
 * post-`COMMIT`; la auditoría la resuelve `audit-log.listener.ts` vía el evento.
 */

import { Prisma } from "@prisma/client";
import type {
  EstadoCuentaPorPagar,
  EstadoOrdenCompra,
  EstadoProveedor,
  MedioPago,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import { validarComprobantesDePago } from "@/lib/services/tesoreria/cuenta-por-pagar.comprobantes";
import type {
  CuentaPorPagarEstadoCambiadoPayload,
  OrdenCompraEstadoCambiadoPayload,
} from "@/lib/events/event-types";
import {
  calcularMontoDesdeItems,
  calcularMontoDesdeItemsAceptados,
} from "@/lib/services/tesoreria/cuenta-por-pagar.calculo";

// Re-export de los helpers puros: los consumidores (listener, routes) los
// importan desde este servicio; la implementación testeable vive en el módulo
// hermano `cuenta-por-pagar.calculo` (sin `server-only`).
export {
  calcularMontoDesdeItems,
  calcularMontoDesdeItemsAceptados,
  esTransicionValidaCuentaPorPagar,
} from "@/lib/services/tesoreria/cuenta-por-pagar.calculo";
export type {
  AccionCuentaPorPagar,
  ItemMontoCuentaPorPagar,
  ItemMontoAceptadoCuentaPorPagar,
} from "@/lib/services/tesoreria/cuenta-por-pagar.calculo";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec_modulo_G.md §2.4 / §2.5 / §7) — un permiso por
// acción. Punto de verdad compartido por Route Handlers y HOFs de auth.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_LEER_CUENTAS_POR_PAGAR = "cuentas_por_pagar:leer";
export const PERMISO_PAGAR_CUENTA_POR_PAGAR = "cuentas_por_pagar:pagar";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface MarcarCuentaPorPagarPagadaInput {
  fecha_pago?: Date;
  /** HU-G10 — medio de pago (obligatorio desde HU-G10). */
  medio_pago: MedioPago;
  /** HU-G10 — id de catálogo de la cuenta de origen (obligatorio desde HU-G10). */
  cuenta_origen_id: string;
  /** HU-G10 — comprobantes a imputar al pago (al menos uno, obligatorio). */
  comprobante_proveedor_ids: string[];
  /** HU-G10 — nota libre opcional (<=500 chars, validado en Zod). */
  observaciones?: string;
}

export interface CuentaPorPagarPagada {
  cuenta_por_pagar_id: string;
  estado_anterior: "DEFINITIVA";
  estado_nuevo: "PAGADA";
  fecha_pago: Date;
  /** HU-G10 */
  medio_pago: MedioPago;
  /** HU-G10 */
  cuenta_origen_id: string;
  /** HU-G10 — ids efectivamente imputados en este pago. */
  comprobante_proveedor_ids: string[];
  /** HU-G10 */
  observaciones: string | null;
}

/**
 * Input del listado. Refleja el shape parseado de
 * `FiltrosListadoCuentasPorPagarSchema` (que crea PR3): `page` / `page_size`
 * llegan siempre resueltos por los `.default()` del schema.
 */
export interface FiltrosListadoCuentasPorPagar {
  estado?: EstadoCuentaPorPagar;
  orden_compra_id?: string;
  proveedor_id?: string;
  page: number;
  page_size: number;
}

export interface ProveedorDeCuentaPorPagar {
  id: string;
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string;
  estado: EstadoProveedor;
}

export interface OrdenCompraDeCuentaPorPagar {
  id: string;
  numero_orden: string;
  estado: EstadoOrdenCompra;
  fecha_emision: Date;
  proveedor: ProveedorDeCuentaPorPagar;
}

export interface CuentaPorPagarResumen {
  id: string;
  orden_compra_id: string;
  recepcion_id: string | null;
  /**
   * Serializado con `.toFixed(2)` → `string` de 2 decimales fijos (nunca
   * `number`: un valor monetario no pasa por IEEE-754). Escala fija sin
   * importar el camino aritmético que produjo el `Decimal`.
   */
  monto: string;
  estado: EstadoCuentaPorPagar;
  fecha_vencimiento: Date | null;
  fecha_pago: Date | null;
  is_active: boolean;
  deletion_reason: string | null;
  created_at: Date;
  orden_compra: OrdenCompraDeCuentaPorPagar;
}

export interface ListadoCuentasPorPagar {
  registros: CuentaPorPagarResumen[];
  total: number;
  page: number;
  page_size: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper de monto sobre una OrdenCompra (spec_modulo_G.md §2.1 paso 2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `Σ(cantidad_solicitada × precio_unitario)` sobre los `OrdenCompraItem`
 * activos de una orden. `Prisma.aggregate._sum` no expresa un producto por
 * fila, por eso `findMany` + `calcularMontoDesdeItems` (helper puro).
 */
async function calcularMontoOrdenCompra(
  tx: Prisma.TransactionClient,
  ordenCompraId: string,
): Promise<Prisma.Decimal> {
  const items = await tx.ordenCompraItem.findMany({
    where: {
      orden_compra_id: ordenCompraId,
      is_active: true,
      deleted_at: null,
    },
    select: { cantidad_solicitada: true, precio_unitario: true },
  });
  return calcularMontoDesdeItems(items);
}

/**
 * `Σ(cantidad_aceptada × precio_unitario)` sobre los `RecepcionItem` activos de
 * TODAS las `Recepcion` activas de la orden, agrupado por
 * `orden_compra_item_id`. Es el monto DEFINITIVO (spec_modulo_G.md §2.2): lo
 * efectivamente recibido y validado, no lo pedido. Un ítem todavía sin
 * recepción no aparece en el `groupBy` ⇒ no suma (y no rompe).
 */
async function calcularMontoDesdeRecepcion(
  tx: Prisma.TransactionClient,
  ordenCompraId: string,
): Promise<Prisma.Decimal> {
  const aceptadoPorItem = await tx.recepcionItem.groupBy({
    by: ["orden_compra_item_id"],
    where: {
      is_active: true,
      deleted_at: null,
      recepcion: {
        orden_compra_id: ordenCompraId,
        is_active: true,
        deleted_at: null,
      },
    },
    _sum: { cantidad_aceptada: true },
  });
  if (aceptadoPorItem.length === 0) return new Prisma.Decimal(0);

  // Precio por ítem de OC: se busca por `id` SIN filtrar `is_active` — si el
  // ítem se dio de baja lógica después de recibirse, igual se factura lo
  // aceptado a su precio pactado.
  const preciosItem = await tx.ordenCompraItem.findMany({
    where: { id: { in: aceptadoPorItem.map((g) => g.orden_compra_item_id) } },
    select: { id: true, precio_unitario: true },
  });
  const precioPorItem = new Map(
    preciosItem.map((p) => [p.id, p.precio_unitario]),
  );

  return calcularMontoDesdeItemsAceptados(
    aceptadoPorItem.map((g) => ({
      cantidad_aceptada: g._sum.cantidad_aceptada ?? 0,
      precio_unitario:
        precioPorItem.get(g.orden_compra_item_id) ?? new Prisma.Decimal(0),
    })),
  );
}

/**
 * Resuelve `proveedor_id` + `numero_orden` de una OC. El payload de
 * `orden_compra:estado_cambiado` no lleva `proveedor_id`, así que se lee de
 * la OC; `numero_orden` sí viene en el payload y se prefiere para no depender
 * de la lectura.
 */
async function resolverDatosOrden(
  tx: Prisma.TransactionClient,
  ordenCompraId: string,
  numeroOrdenPayload: string,
): Promise<{ proveedor_id: string; numero_orden: string } | null> {
  const oc = await tx.ordenCompra.findUnique({
    where: { id: ordenCompraId },
    select: { numero_orden: true, proveedor_id: true },
  });
  if (!oc) return null;
  return {
    proveedor_id: oc.proveedor_id,
    numero_orden: numeroOrdenPayload || oc.numero_orden,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.1 — Generación de Cuenta por Pagar provisoria (accion "ENVIAR")
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Crea la `CuentaPorPagar` `PROVISORIO` de una OC recién enviada. Idempotente:
 * si ya existe una activa en `PROVISORIO` para esa orden, retorna `null` sin
 * escribir (no es error — protege ante reintentos del bus). El monto se
 * recalcula sobre los ítems activos con `Prisma.Decimal`.
 */
export async function generarCuentaPorPagarProvisoria(
  payload: OrdenCompraEstadoCambiadoPayload,
): Promise<CuentaPorPagarEstadoCambiadoPayload | null> {
  return prisma.$transaction(async (tx) => {
    const existente = await tx.cuentaPorPagar.findFirst({
      where: {
        orden_compra_id: payload.orden_compra_id,
        estado: "PROVISORIO",
        is_active: true,
      },
      select: { id: true },
    });
    if (existente) return null;

    const monto = await calcularMontoOrdenCompra(tx, payload.orden_compra_id);

    const datos = await resolverDatosOrden(
      tx,
      payload.orden_compra_id,
      payload.numero_orden,
    );
    if (!datos) {
      console.error(
        "[HU-G8] generarCuentaPorPagarProvisoria: OrdenCompra inexistente",
        { orden_compra_id: payload.orden_compra_id },
      );
      return null;
    }

    const creada = await tx.cuentaPorPagar.create({
      data: {
        orden_compra_id: payload.orden_compra_id,
        monto,
        estado: "PROVISORIO",
        fecha_vencimiento: null,
        recepcion_id: null,
        is_active: true,
      },
      select: { id: true, monto: true },
    });

    return {
      cuenta_por_pagar_id: creada.id,
      orden_compra_id: payload.orden_compra_id,
      numero_orden: datos.numero_orden,
      proveedor_id: datos.proveedor_id,
      estado_anterior: null,
      estado_nuevo: "PROVISORIO",
      accion: "CREAR",
      cambiado_por: payload.cambiado_por,
      monto_anterior: null,
      monto_nuevo: monto.toFixed(2),
      recepcion_id: null,
      fecha_vencimiento: null,
      fecha_pago: null,
      deletion_reason: null,
      // HU-G10 — campos de PAGAR: nulos en las transiciones reactivas.
      medio_pago: null,
      cuenta_origen_id: null,
      comprobante_proveedor_ids: null,
      observaciones: null,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.2 — Consolidación a Cuenta por Pagar definitiva (accion "CERRAR")
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Consolida la `CuentaPorPagar` `PROVISORIO` de una OC a `DEFINITIVA` al
 * cerrarse la orden. No crea fila nueva: reemplaza sobre el mismo registro.
 * Si no hay `PROVISORIO` activa, loguea con `orden_compra_id` y retorna `null`
 * (NO lanza — el listener no tiene llamador HTTP).
 *
 * El monto se recalcula sobre `RecepcionItem.cantidad_aceptada` (lo
 * efectivamente **recibido y validado** — NO `cantidad_recibida`, NO
 * `cantidad_solicitada`), sumado sobre todas las `Recepcion` activas de la
 * orden (`calcularMontoDesdeRecepcion`). Esto lo distingue del PROVISORIO, que
 * sí suma lo pedido. Cualquier diferencia con el provisorio se toma en
 * silencio y queda trazada por `monto_anterior` / `monto_nuevo` del evento.
 * `recepcion_id` resuelve a la `Recepcion` activa más reciente de la orden.
 */
export async function consolidarCuentaPorPagarDefinitiva(
  payload: OrdenCompraEstadoCambiadoPayload,
): Promise<CuentaPorPagarEstadoCambiadoPayload | null> {
  // Guarda de contrato entre módulos (spec_modulo_G.md §2.2): solo consolida
  // el cierre por conciliación de factura (`RECIBIDA_COMPLETA → CERRADA`). Hoy
  // es redundante contra la máquina de estados de OC (único origen de `CERRAR`),
  // pero esa máquina la controla Módulo H — la guarda blinda HU-G8 ante un
  // cambio ahí sin costo real.
  if (payload.estado_anterior !== "RECIBIDA_COMPLETA") return null;

  return prisma.$transaction(async (tx) => {
    const provisoria = await tx.cuentaPorPagar.findFirst({
      where: {
        orden_compra_id: payload.orden_compra_id,
        estado: "PROVISORIO",
        is_active: true,
      },
      select: { id: true, monto: true },
    });
    if (!provisoria) {
      console.error(
        "[HU-G8] consolidarCuentaPorPagarDefinitiva: sin CuentaPorPagar PROVISORIO activa",
        { orden_compra_id: payload.orden_compra_id },
      );
      return null;
    }

    // Monto DEFINITIVO: sobre lo efectivamente recibido y validado
    // (`RecepcionItem.cantidad_aceptada`), NO sobre lo pedido — criterio 4.
    const monto = await calcularMontoDesdeRecepcion(tx, payload.orden_compra_id);

    const recepcion = await tx.recepcion.findFirst({
      where: { orden_compra_id: payload.orden_compra_id, is_active: true },
      orderBy: { fecha_recepcion: "desc" },
      select: { id: true },
    });
    const recepcionId = recepcion?.id ?? null;

    const datos = await resolverDatosOrden(
      tx,
      payload.orden_compra_id,
      payload.numero_orden,
    );
    if (!datos) {
      console.error(
        "[HU-G8] consolidarCuentaPorPagarDefinitiva: OrdenCompra inexistente",
        { orden_compra_id: payload.orden_compra_id },
      );
      return null;
    }

    // Escritura guardada por `estado` (concurrencia optimista): si otra
    // transacción movió la fila en el interín, `count === 0` → no-op.
    const cambio = await tx.cuentaPorPagar.updateMany({
      where: { id: provisoria.id, estado: "PROVISORIO", is_active: true },
      data: { estado: "DEFINITIVA", monto, recepcion_id: recepcionId },
    });
    if (cambio.count === 0) return null;

    return {
      cuenta_por_pagar_id: provisoria.id,
      orden_compra_id: payload.orden_compra_id,
      numero_orden: datos.numero_orden,
      proveedor_id: datos.proveedor_id,
      estado_anterior: "PROVISORIO",
      estado_nuevo: "DEFINITIVA",
      accion: "DEFINIR",
      cambiado_por: payload.cambiado_por,
      monto_anterior: provisoria.monto.toFixed(2),
      monto_nuevo: monto.toFixed(2),
      recepcion_id: recepcionId,
      fecha_vencimiento: null,
      fecha_pago: null,
      deletion_reason: null,
      // HU-G10 — campos de PAGAR: nulos en las transiciones reactivas.
      medio_pago: null,
      cuenta_origen_id: null,
      comprobante_proveedor_ids: null,
      observaciones: null,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.3 — Cancelación de Cuenta por Pagar (accion "CANCELAR")
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pasa a `CANCELADA` la `CuentaPorPagar` `PROVISORIO` de una OC cancelada. Si
 * no existe (OC cancelada desde `BORRADOR`, que nunca generó cuenta), retorna
 * `null` — no es un error, es un evento válido sin efecto sobre este módulo.
 */
export async function cancelarCuentaPorPagar(
  payload: OrdenCompraEstadoCambiadoPayload,
): Promise<CuentaPorPagarEstadoCambiadoPayload | null> {
  return prisma.$transaction(async (tx) => {
    const provisoria = await tx.cuentaPorPagar.findFirst({
      where: {
        orden_compra_id: payload.orden_compra_id,
        estado: "PROVISORIO",
        is_active: true,
      },
      select: { id: true, monto: true },
    });
    if (!provisoria) return null;

    const datos = await resolverDatosOrden(
      tx,
      payload.orden_compra_id,
      payload.numero_orden,
    );
    if (!datos) {
      console.error("[HU-G8] cancelarCuentaPorPagar: OrdenCompra inexistente", {
        orden_compra_id: payload.orden_compra_id,
      });
      return null;
    }

    // Cambio de ESTADO, NO baja lógica del registro: `is_active` permanece
    // `true` y `deleted_at` / `deleted_by` permanecen `null`. `deletion_reason`
    // se reutiliza SOLO como portador del motivo de la cancelación funcional
    // (spec_modulo_G.md §2.3 / §3.4). No completar la tripleta de soft-delete.
    const cambio = await tx.cuentaPorPagar.updateMany({
      where: { id: provisoria.id, estado: "PROVISORIO", is_active: true },
      data: { estado: "CANCELADA", deletion_reason: payload.deletion_reason },
    });
    if (cambio.count === 0) return null;

    const montoStr = provisoria.monto.toFixed(2);
    return {
      cuenta_por_pagar_id: provisoria.id,
      orden_compra_id: payload.orden_compra_id,
      numero_orden: datos.numero_orden,
      proveedor_id: datos.proveedor_id,
      estado_anterior: "PROVISORIO",
      estado_nuevo: "CANCELADA",
      accion: "CANCELAR",
      cambiado_por: payload.cambiado_por,
      monto_anterior: montoStr,
      monto_nuevo: montoStr,
      recepcion_id: null,
      fecha_vencimiento: null,
      fecha_pago: null,
      deletion_reason: payload.deletion_reason,
      // HU-G10 — campos de PAGAR: nulos en las transiciones reactivas.
      medio_pago: null,
      cuenta_origen_id: null,
      comprobante_proveedor_ids: null,
      observaciones: null,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.4 — Marcar Cuenta por Pagar como pagada (mutación manual)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Única mutación manual de HU-G8: `DEFINITIVA → PAGADA` (todo-o-nada, sin
 * evidencia de pago ni pago parcial). Orden de argumentos igual a
 * `cambiarEstadoOrdenCompra`. Emite `cuenta_por_pagar:estado_cambiado`
 * (`accion: "PAGAR"`) post-`COMMIT`, con `proveedor_id` para que Módulo H
 * refleje el pago en el historial del proveedor.
 */
export async function marcarCuentaPorPagarPagada(
  cuentaPorPagarId: string,
  input: MarcarCuentaPorPagarPagadaInput,
  usuarioId: string,
): Promise<CuentaPorPagarPagada> {
  const resultado = await prisma.$transaction(async (tx) => {
    // 1. Estado de la cuenta.
    const cuenta = await tx.cuentaPorPagar.findFirst({
      where: { id: cuentaPorPagarId },
      select: {
        id: true,
        estado: true,
        is_active: true,
        monto: true,
        orden_compra_id: true,
        orden_compra: { select: { numero_orden: true, proveedor_id: true } },
      },
    });
    if (!cuenta) {
      throw new ServiceError(
        "CUENTA_POR_PAGAR_NO_ENCONTRADA",
        "La cuenta por pagar indicada no existe",
      );
    }
    if (!cuenta.is_active || cuenta.estado !== "DEFINITIVA") {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        "No es posible pagar una cuenta en estado " + cuenta.estado,
      );
    }

    // 2. Comprobantes realmente existentes (SIN filtro is_active: hace falta
    //    para distinguir ANULADO de INEXISTENTE en `validarComprobantesDePago`).
    const encontrados = await tx.comprobanteProveedor.findMany({
      where: { id: { in: input.comprobante_proveedor_ids } },
      select: { id: true, orden_compra_id: true, is_active: true },
    });

    // 2b. Comprobantes ya imputados a OTRA CuentaPorPagar PAGADA.
    const yaImputados = await tx.cuentaPorPagarComprobante.findMany({
      where: {
        comprobante_proveedor_id: { in: input.comprobante_proveedor_ids },
        cuenta_por_pagar_id: { not: cuentaPorPagarId },
        cuenta_por_pagar: { is: { estado: "PAGADA" } },
      },
      select: { comprobante_proveedor_id: true },
    });
    const idsYaImputadosEnOtrosPagos = new Set(
      yaImputados.map((r) => r.comprobante_proveedor_id),
    );

    // 3. Validación de la imputación. Cualquier detalle ⇒ rollback total.
    const detalles = validarComprobantesDePago(
      input.comprobante_proveedor_ids,
      encontrados,
      cuenta.orden_compra_id,
      idsYaImputadosEnOtrosPagos,
    );
    if (detalles.length > 0) {
      throw new ServiceError(
        "COMPROBANTE_PROVEEDOR_REQUERIDO",
        "Hay comprobantes que no se pueden imputar a este pago",
        detalles,
      );
    }

    const fechaPago = input.fecha_pago ?? new Date();
    const observaciones = input.observaciones ?? null;

    // 4. Transición DEFINITIVA → PAGADA (guardada por estado: concurrencia).
    const { count } = await tx.cuentaPorPagar.updateMany({
      where: { id: cuentaPorPagarId, estado: "DEFINITIVA", is_active: true },
      data: {
        estado: "PAGADA",
        fecha_pago: fechaPago,
        medio_pago: input.medio_pago,
        cuenta_origen_id: input.cuenta_origen_id,
        observaciones,
      },
    });
    if (count === 0) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        "El estado de la cuenta cambió durante la operación; reintentá",
      );
    }

    // 5. Imputación histórica e inmutable de los comprobantes.
    await tx.cuentaPorPagarComprobante.createMany({
      data: input.comprobante_proveedor_ids.map((cid) => ({
        cuenta_por_pagar_id: cuentaPorPagarId,
        comprobante_proveedor_id: cid,
      })),
    });

    return {
      orden_compra_id: cuenta.orden_compra_id,
      numero_orden: cuenta.orden_compra.numero_orden,
      proveedor_id: cuenta.orden_compra.proveedor_id,
      monto: cuenta.monto,
      fecha_pago: fechaPago,
      observaciones,
    };
  });

  // Post-COMMIT (mismo patrón que `orden-compra.service.ts:432`): evento de
  // dominio → `audit-log.listener.ts` (asiento SHA-256) y Módulo H (`PAGAR`).
  const montoStr = resultado.monto.toFixed(2);
  domainEventBus.emit("cuenta_por_pagar:estado_cambiado", {
    cuenta_por_pagar_id: cuentaPorPagarId,
    orden_compra_id: resultado.orden_compra_id,
    numero_orden: resultado.numero_orden,
    proveedor_id: resultado.proveedor_id,
    estado_anterior: "DEFINITIVA",
    estado_nuevo: "PAGADA",
    accion: "PAGAR",
    cambiado_por: usuarioId,
    monto_anterior: montoStr,
    monto_nuevo: montoStr,
    recepcion_id: null,
    fecha_vencimiento: null,
    fecha_pago: resultado.fecha_pago.toISOString(),
    deletion_reason: null,
    // HU-G10 — presentes solo en PAGAR.
    medio_pago: input.medio_pago,
    cuenta_origen_id: input.cuenta_origen_id,
    comprobante_proveedor_ids: input.comprobante_proveedor_ids,
    observaciones: resultado.observaciones,
  });

  return {
    cuenta_por_pagar_id: cuentaPorPagarId,
    estado_anterior: "DEFINITIVA",
    estado_nuevo: "PAGADA",
    fecha_pago: resultado.fecha_pago,
    medio_pago: input.medio_pago,
    cuenta_origen_id: input.cuenta_origen_id,
    comprobante_proveedor_ids: input.comprobante_proveedor_ids,
    observaciones: resultado.observaciones,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.5 — Listado de Cuentas por Pagar (solo lectura)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Listado paginado para `GET /api/tesoreria/cuentas-por-pagar`. Filtra por
 * `is_active: true`; expone `estado` tal cual (incluido `PROVISORIO`, ver
 * §3.1). El `select` del proveedor es una whitelist estricta de 5 campos:
 * NUNCA `include`, NUNCA `datos_bancarios_cifrado` / `datos_bancarios_iv`
 * (Alcance §5.1). `monto` se mapea a `string` de 2 decimales vía `.toFixed(2)`.
 */
export async function listarCuentasPorPagar(
  filtros: FiltrosListadoCuentasPorPagar,
): Promise<ListadoCuentasPorPagar> {
  const where: Prisma.CuentaPorPagarWhereInput = {
    is_active: true,
    ...(filtros.estado && { estado: filtros.estado }),
    ...(filtros.orden_compra_id && { orden_compra_id: filtros.orden_compra_id }),
    ...(filtros.proveedor_id && {
      orden_compra: { proveedor_id: filtros.proveedor_id },
    }),
  };

  const [filas, total] = await Promise.all([
    prisma.cuentaPorPagar.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
      select: {
        id: true,
        orden_compra_id: true,
        recepcion_id: true,
        monto: true,
        estado: true,
        fecha_vencimiento: true,
        fecha_pago: true,
        is_active: true,
        deletion_reason: true,
        created_at: true,
        orden_compra: {
          select: {
            id: true,
            numero_orden: true,
            estado: true,
            fecha_emision: true,
            proveedor: {
              select: {
                id: true,
                razon_social: true,
                nombre_fantasia: true,
                cuit: true,
                estado: true,
              },
            },
          },
        },
      },
    }),
    prisma.cuentaPorPagar.count({ where }),
  ]);

  const registros: CuentaPorPagarResumen[] = filas.map((f) => ({
    id: f.id,
    orden_compra_id: f.orden_compra_id,
    recepcion_id: f.recepcion_id,
    monto: f.monto.toFixed(2),
    estado: f.estado,
    fecha_vencimiento: f.fecha_vencimiento,
    fecha_pago: f.fecha_pago,
    is_active: f.is_active,
    deletion_reason: f.deletion_reason,
    created_at: f.created_at,
    orden_compra: {
      id: f.orden_compra.id,
      numero_orden: f.orden_compra.numero_orden,
      estado: f.orden_compra.estado,
      fecha_emision: f.orden_compra.fecha_emision,
      proveedor: {
        id: f.orden_compra.proveedor.id,
        razon_social: f.orden_compra.proveedor.razon_social,
        nombre_fantasia: f.orden_compra.proveedor.nombre_fantasia,
        cuit: f.orden_compra.proveedor.cuit,
        estado: f.orden_compra.proveedor.estado,
      },
    },
  }));

  return {
    registros,
    total,
    page: filtros.page,
    page_size: filtros.page_size,
  };
}
