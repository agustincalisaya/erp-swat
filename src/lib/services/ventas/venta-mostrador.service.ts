import "server-only";

/**
 * @module venta-mostrador.service
 * @description Capa de dominio de HU-B1 — Venta de mostrador con cobro
 * multimedio (spec_modulo_B.md §2.1, docs/tasks/task_relos.md).
 *
 * TODA la lógica de negocio de este circuito vive acá: el Route Handler
 * (`app/api/ventas/route.ts`) y la Server Action
 * (`app/(dashboard)/ventas/pos/actions.ts`) son wrappers finos — resuelven
 * sesión + permiso granular, parsean el body con Zod, invocan
 * `registrarVentaMostrador()` y mapean el resultado/excepción al shape
 * estándar `{ data, error }`. Está prohibido reimplementar cualquier regla de
 * acá en esas capas.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * DECISIÓN RESUELTA A — Atomicidad de reserva/confirmación de stock
 * ══════════════════════════════════════════════════════════════════════════
 * `crearReserva()`/`confirmarReservaPorVenta()` (Módulo A,
 * `reserva.service.ts`) abren CADA UNA su propia `prisma.$transaction`
 * interna — no aceptan un `tx` externo. HU-B3 (`presupuesto.service.ts`) ya
 * estableció el precedente real: estas llamadas viven SECUENCIALES, FUERA de
 * una `$transaction` envolvente ("Módulo B no puede ni debe envolverla en la
 * suya" — Módulo A es dueño exclusivo de esa atomicidad). Acá se sigue el
 * MISMO precedente para `crearReserva()` + `confirmarReservaPorVenta()`, y
 * una `$transaction` SEPARADA cubre únicamente `PedidoVenta` + `PedidoVentaItem`
 * + `VentaMedioPago` + `ComprobanteFiscal`.
 *
 * Riesgo conocido, MÁS SEVERO que en HU-B3 (decisión del usuario, confirmada
 * explícitamente): si la segunda `$transaction` falla DESPUÉS de que una o
 * más `Reserva` ya fueron confirmadas a `VENDIDO` (`confirmarReservaPorVenta()`),
 * ese stock queda huérfano de forma PERMANENTE — a diferencia de HU-B3 (donde
 * una `Reserva` húerfana queda `RESERVADO` y el cron de TTL de Módulo A la
 * libera solo), acá no existe ningún mecanismo de reversión automática: el
 * cron de TTL solo opera sobre reservas `RESERVADO`, nunca sobre `VENDIDO`.
 * Por eso la segunda `$transaction` va envuelta en un `try/catch` explícito
 * (`registrarVentaHuerfanaEnLog()`) que deja un log claro con los `reserva_id`
 * afectados y SIEMPRE relanza el error (nunca lo traga en silencio) — el
 * Cajero debe enterarse de que la venta no se completó. Documentado también
 * en `docs/tasks/task_relos.md` como deuda técnica real, con la resolución
 * recomendada a futuro (refactorizar `reserva.service.ts` para aceptar un
 * `Prisma.TransactionClient` externo — NO implementado en esta rama,
 * requiere coordinación con el dueño de Módulo A).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * DECISIÓN RESUELTA B — Alcance de "queda en espera" (autorización por ítem)
 * ══════════════════════════════════════════════════════════════════════════
 * El fixture ya sembrado `PEDIDO_VENTA_REMITO_PARCIAL_ITEM_AUTORIZACION_ID`
 * (`prisma/seed.ts`, `V-2026-000003`) muestra un `PedidoVenta` en
 * `REMITO_EMITIDO` con UN ítem `requiere_autorizacion: true` conviviendo con
 * OTRO ítem ya facturado/entregado — la espera es POR ÍTEM en el modelo de
 * datos real, nunca bloquea el pedido completo (`requiere_autorizacion` vive
 * en `PedidoVentaItem`, no hay ningún campo que represente "pedido completo
 * en espera"). Decisión del usuario, confirmada explícitamente: se sigue ese
 * precedente.
 *
 * Los ítems DENTRO del margen (`MARGEN_DESCUENTO_CAJERO_POS`) se reservan,
 * confirman contra Módulo A y entran al comprobante fiscal normalmente. El
 * ítem FUERA de margen se crea con `requiere_autorizacion: true` /
 * `autorizado_por_id: null`, SIN reserva ni confirmación de stock — queda
 * excluido del comprobante hasta que un Supervisor lo resuelva vía el
 * endpoint ya existente de HU-B4 (`autorizarOverrideDescuento()`).
 *
 * El cobro de HU-B1 es ATÓMICO (el Cajero recibe todos los medios de pago
 * juntos, sumando el total COMPLETO de la venta, validado por el `.refine()`
 * del schema ANTES de invocar este servicio) — no hay forma de "cobrar
 * aparte" el ítem pendiente. TODOS los `VentaMedioPago` recibidos se
 * persisten completos, ligados al `PedidoVenta`: el dinero ya fue recibido
 * físicamente por el Cajero, eso no se retiene.
 *
 * `PedidoVenta.estado` = `FACTURADO` si NINGÚN ítem quedó pendiente,
 * `RESERVADO` si AL MENOS UNO quedó con `requiere_autorizacion: true`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * DECISIÓN RESUELTA C — Comprobante fiscal cuando hay ítems pendientes
 * ══════════════════════════════════════════════════════════════════════════
 * Mientras exista al menos un ítem `requiere_autorizacion: true`, NO se emite
 * ningún `ComprobanteFiscal` — `comprobante_id: null` en la respuesta, tal
 * como ya lo define literalmente el contrato de spec §2.1 ("comprobante_id
 * (null si quedó pendiente de autorización)"). Modelar un comprobante PARCIAL
 * (por la porción de ítems ya resueltos) habría adelantado la máquina de
 * facturación parcial que la decisión 0.3 de `task_relos.md` reserva
 * explícitamente para la futura rama de HU-B7 completa — fuera de alcance
 * acá. Emitir el comprobante del total, una vez resuelto el último ítem
 * pendiente vía HU-B4, queda documentado como deuda técnica (task_relos.md).
 *
 * Reglas transversales aplicadas (RULES.md §1/§2):
 *  - Ninguna función de este archivo invoca `prisma.*.delete()` / `deleteMany()`.
 *  - El evento de dominio se emite DESPUÉS de que la persistencia resuelve,
 *    nunca antes (mismo patrón fire-and-forget que el resto del proyecto).
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import { crearReserva, confirmarReservaPorVenta } from "@/lib/services/inventario/reserva.service";
import { emitirComprobanteFiscal } from "@/lib/services/ventas/comprobante-fiscal.service";
import { MARGEN_DESCUENTO_CAJERO_POS } from "@/lib/services/ventas/venta-mostrador.constants";
import { calcularTotalVenta, itemSuperaMargenDescuento } from "@/lib/services/ventas/venta-mostrador.calculo";
import type { RegistrarVentaMostradorInput } from "@/lib/schemas/ventas.schema";

export const PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR = "ventas:registrar_venta_mostrador";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface VentaMostradorRegistrada {
  pedido_venta_id: string;
  numero_venta: string;
  /** `null` si al menos un ítem quedó `requiere_autorizacion: true` (DECISIÓN C). */
  comprobante_id: string | null;
  tipo_comprobante: RegistrarVentaMostradorInput["tipo_comprobante"];
  total: number;
}

interface ItemClasificado {
  variante_sku_id: string;
  deposito_id: string;
  cantidad: number;
  precio_unitario: number;
  descuento_porcentual: number | null;
  requiere_autorizacion: boolean;
  /** Completado durante el paso de reserva; `null` si el ítem quedó pendiente. */
  reserva_id: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// numero_venta — mismo patrón que `generarNumeroVenta()` de
// `presupuesto.service.ts` / `generarNumeroOrden()` de `orden-compra.service.ts`
// (duplicado a propósito: ningún service comparte este helper hoy).
// ──────────────────────────────────────────────────────────────────────────────

async function generarNumeroVenta(tx: Prisma.TransactionClient): Promise<string> {
  const anio = new Date().getFullYear();
  const prefijo = `V-${anio}-`;
  const emitidosEsteAnio = await tx.pedidoVenta.count({
    where: { numero_venta: { startsWith: prefijo } },
  });
  return `${prefijo}${String(emitidosEsteAnio + 1).padStart(6, "0")}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Log de stock huérfano — DECISIÓN RESUELTA A. Nunca traga el error: siempre
// lo relanza el llamador, esto solo deja constancia clara en el log.
// ──────────────────────────────────────────────────────────────────────────────

function registrarStockHuerfanoEnLog(
  etapa: "RESERVA" | "PERSISTENCIA_PEDIDO",
  pedidoVentaId: string,
  usuarioId: string,
  reservaIdsConfirmadas: string[],
  error: unknown,
): void {
  if (reservaIdsConfirmadas.length === 0) return;
  console.error(
    `[registrarVentaMostrador] FALLO en etapa ${etapa}: ${reservaIdsConfirmadas.length} reserva(s) ` +
      `ya CONFIRMADAS a VENDIDO sin ningún PedidoVenta que las respalde — stock huérfano permanente ` +
      `(no recuperable por el cron de TTL de Módulo A, que solo libera reservas RESERVADO). ` +
      `pedido_venta_id=${pedidoVentaId} usuario_id=${usuarioId} ` +
      `reserva_ids_huerfanas=${JSON.stringify(reservaIdsConfirmadas)}. ` +
      `Deuda técnica conocida — ver DECISIÓN RESUELTA A en el docstring de este módulo ` +
      `y docs/tasks/task_relos.md. Requiere resolución manual (auditoría contra estas reservas).`,
    error,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.1 — Registrar venta de mostrador con cobro multimedio
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registra una venta de mostrador (spec §2.1). Ver los tres bloques de
 * DECISIÓN RESUELTA (A/B/C) en el docstring del módulo para el detalle de
 * cada regla no explícita en el contrato original de la tarea.
 *
 * @throws {ServiceError} SIN_TURNO_ABIERTO (422) — el Cajero no tiene un
 *   `TurnoCaja` con `fecha_cierre: null`. Se valida ANTES de tocar stock o
 *   cobro (spec §2.1).
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA | DEPOSITO_NO_ENCONTRADO (404)
 *   — propagado tal cual desde `crearReserva()` (Módulo A).
 * @throws {ServiceError} STOCK_INSUFICIENTE (422) — propagado tal cual desde
 *   `crearReserva()` (Módulo A).
 * @throws {ServiceError} CLIENTE_NO_ENCONTRADO (404) — `cliente_id` vino en
 *   el input pero no existe o está inactivo/fusionado.
 */
export async function registrarVentaMostrador(
  usuarioId: string,
  input: RegistrarVentaMostradorInput,
): Promise<VentaMostradorRegistrada> {
  // Paso 1 — Precondición de turno abierto (spec §2.1: "sin turno abierto,
  // 422 antes de tocar stock o cobro"). Lectura simple, sin transacción.
  const turno = await prisma.turnoCaja.findFirst({
    where: { usuario_id: usuarioId, fecha_cierre: null },
    select: { id: true },
  });
  if (!turno) {
    throw new ServiceError(
      "SIN_TURNO_ABIERTO",
      "El Cajero POS debe tener un turno de caja abierto para registrar ventas",
    );
  }

  // Paso 2 — Clasificar ítems contra MARGEN_DESCUENTO_CAJERO_POS (DECISIÓN B).
  const itemsClasificados: ItemClasificado[] = input.items.map((item) => ({
    variante_sku_id: item.variante_sku_id,
    deposito_id: item.deposito_id,
    cantidad: item.cantidad,
    precio_unitario: item.precio_unitario,
    descuento_porcentual: item.descuento_porcentual ?? null,
    requiere_autorizacion: itemSuperaMargenDescuento(item.descuento_porcentual, MARGEN_DESCUENTO_CAJERO_POS),
    reserva_id: null,
  }));
  const algunoPendiente = itemsClasificados.some((i) => i.requiere_autorizacion);

  // `pedidoVentaId` pre-generado (mismo patrón que `autorizacionId`/`reservaId`
  // en otros services del proyecto): `confirmarReservaPorVenta()` exige un
  // `venta_id` ANTES de que el PedidoVenta exista — se persiste como `id`
  // explícito al crear el PedidoVenta en el Paso 4.
  const pedidoVentaId = randomUUID();

  // Paso 3 — Congelar + confirmar stock SOLO para ítems que NO requieren
  // autorización (DECISIÓN A: secuencial, FUERA de una $transaction envolvente).
  for (const item of itemsClasificados) {
    if (item.requiere_autorizacion) continue;

    let reservaId: string;
    try {
      const reserva = await crearReserva(
        {
          variante_sku_id: item.variante_sku_id,
          deposito_id: item.deposito_id,
          cantidad: item.cantidad,
          origen_reserva: "SENIA",
          motivo: `Venta de mostrador (HU-B1) — turno de caja ${turno.id}`,
        },
        usuarioId,
      );
      reservaId = reserva.reserva_id;
    } catch (error) {
      const yaConfirmadas = itemsClasificados
        .filter((i): i is ItemClasificado & { reserva_id: string } => i.reserva_id !== null)
        .map((i) => i.reserva_id);
      registrarStockHuerfanoEnLog("RESERVA", pedidoVentaId, usuarioId, yaConfirmadas, error);
      throw error;
    }

    try {
      await confirmarReservaPorVenta(reservaId, pedidoVentaId, usuarioId);
    } catch (error) {
      const yaConfirmadas = itemsClasificados
        .filter((i): i is ItemClasificado & { reserva_id: string } => i.reserva_id !== null)
        .map((i) => i.reserva_id);
      registrarStockHuerfanoEnLog("RESERVA", pedidoVentaId, usuarioId, yaConfirmadas, error);
      throw error;
    }

    item.reserva_id = reservaId;
  }

  const totalVenta = calcularTotalVenta(input.items);
  const estado: "FACTURADO" | "RESERVADO" = algunoPendiente ? "RESERVADO" : "FACTURADO";

  // Paso 4 — Persistencia atómica de PedidoVenta + PedidoVentaItem +
  // VentaMedioPago + ComprobanteFiscal (DECISIÓN A: $transaction SEPARADA de
  // la reserva/confirmación del Paso 3; DECISIÓN C: comprobante solo si
  // `!algunoPendiente`). Envuelta en try/catch — DECISIÓN A, riesgo severo:
  // si esto falla DESPUÉS del Paso 3, hay reservas ya VENDIDO sin PedidoVenta.
  const MAX_INTENTOS_NUMERO_VENTA = 3;
  let resultado: { numero_venta: string; comprobante_id: string | null };
  try {
    resultado = await (async () => {
      for (let intento = 1; ; intento++) {
        try {
          return await prisma.$transaction(async (tx) => {
            let clienteId: string | null = null;
            if (input.cliente_id) {
              // Lookup directo y simple (decisión 0.8 de task_relos.md): HU-C7
              // todavía no existe en código, así que NO se invoca ninguna
              // función unificada de Módulo C — consulta ad-hoc contra
              // `prisma.cliente`, mismo criterio ya usado por
              // `crearPresupuesto()` (HU-B3).
              const cliente = await tx.cliente.findFirst({
                where: { id: input.cliente_id, is_active: true, deleted_at: null },
                select: { id: true },
              });
              if (!cliente) {
                throw new ServiceError(
                  "CLIENTE_NO_ENCONTRADO",
                  "El cliente indicado no existe o está inactivo",
                );
              }
              clienteId = cliente.id;
            }

            const numeroVenta = await generarNumeroVenta(tx);

            await tx.pedidoVenta.create({
              data: {
                id: pedidoVentaId,
                numero_venta: numeroVenta,
                cliente_id: clienteId,
                turno_caja_id: turno.id,
                estado,
                total: totalVenta,
                fecha_facturacion: estado === "FACTURADO" ? new Date() : null,
                registrado_por_id: usuarioId,
                items: {
                  create: itemsClasificados.map((item) => ({
                    variante_sku_id: item.variante_sku_id,
                    cantidad: item.cantidad,
                    precio_unitario: item.precio_unitario,
                    descuento_porcentual: item.descuento_porcentual,
                    reserva_id: item.reserva_id,
                    requiere_autorizacion: item.requiere_autorizacion,
                    autorizado_por_id: null,
                    // Ítems ya reservados/confirmados: venta de mostrador,
                    // entrega física inmediata (spec §1) → 100% facturado y
                    // entregado en el mismo acto. Ítems pendientes de
                    // autorización (DECISIÓN B): 0/0, todavía sin stock
                    // congelado.
                    cantidad_facturada: item.requiere_autorizacion ? 0 : item.cantidad,
                    cantidad_entregada: item.requiere_autorizacion ? 0 : item.cantidad,
                  })),
                },
                medios_pago: {
                  create: input.medios_pago.map((mp) => ({
                    medio: mp.medio,
                    importe: mp.importe,
                    referencia: mp.referencia,
                  })),
                },
              },
            });

            let comprobanteId: string | null = null;
            if (!algunoPendiente) {
              const comprobante = await emitirComprobanteFiscal(tx, {
                pedido_venta_id: pedidoVentaId,
                numero_venta: numeroVenta,
                tipo_comprobante: input.tipo_comprobante,
                monto_total: totalVenta,
                emitido_por_id: usuarioId,
              });
              comprobanteId = comprobante.comprobante_id;
            }

            return { numero_venta: numeroVenta, comprobante_id: comprobanteId };
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002" &&
            intento < MAX_INTENTOS_NUMERO_VENTA
          ) {
            const target = error.meta?.target as string[] | string | undefined;
            const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
            if (targetStr.includes("numero_venta")) continue;
          }
          throw error;
        }
      }
    })();
  } catch (error) {
    const reservaIdsConfirmadas = itemsClasificados
      .filter((i): i is ItemClasificado & { reserva_id: string } => i.reserva_id !== null)
      .map((i) => i.reserva_id);
    registrarStockHuerfanoEnLog("PERSISTENCIA_PEDIDO", pedidoVentaId, usuarioId, reservaIdsConfirmadas, error);
    throw error;
  }

  // Post-COMMIT: evento de dominio → Módulo D (auditoría estándar), payload
  // literal de spec §4 (`venta:registrada`).
  domainEventBus.emit("venta:registrada", {
    pedido_venta_id: pedidoVentaId,
    cliente_id: input.cliente_id ?? null,
    total: totalVenta,
    medios_pago: input.medios_pago.map((mp) => ({ medio: mp.medio, importe: mp.importe })),
    turno_caja_id: turno.id,
    usuario_id: usuarioId,
  });

  return {
    pedido_venta_id: pedidoVentaId,
    numero_venta: resultado.numero_venta,
    comprobante_id: resultado.comprobante_id,
    tipo_comprobante: input.tipo_comprobante,
    total: totalVenta,
  };
}
