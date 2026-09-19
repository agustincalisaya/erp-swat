import { z } from "zod";

/**
 * Schemas Zod de HU-B3 — Cotización/Presupuesto con reserva de stock
 * (spec_modulo_B.md §2.3).
 *
 * Convención del módulo (spec §2, "Convenciones generales"): los `*_id` se
 * validan solo como `uuid` de forma; la existencia real contra la base es
 * responsabilidad de la capa de servicios (`presupuesto.service.ts`), nunca
 * de estos schemas.
 */

/** `id` de un Presupuesto recibido por path param. */
export const PresupuestoIdSchema = z
  .string()
  .uuid("El identificador del presupuesto debe ser un UUID válido");

/**
 * Extensión autorizada al contrato de spec_modulo_B.md §2.3 (decisión del
 * equipo, no contemplada explícitamente en el spec original): el negocio
 * tiene 3 depósitos reales sembrados, no uno único, así que el vendedor
 * elige el depósito de origen por línea — mismo criterio que ya usa
 * `CrearReservaSchema` de Módulo A (`spec_modulo_A.md` §2.9), que exige
 * `deposito_id` por ítem congelado.
 */
const CrearPresupuestoItemSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precio_cotizado: z.number().positive("El precio cotizado debe ser mayor a 0"),
});

export const CrearPresupuestoSchema = z.object({
  cliente_id: z.string().uuid(),
  vigencia_dias: z.number().int().positive("La vigencia debe ser mayor a 0 días"),
  condiciones_comerciales: z.string().optional(),
  /**
   * No forma parte del contrato original de spec §2.3 (que resuelve el
   * origen "según el enum vigente" sin especificar una regla programática
   * para elegir entre los dos valores institucionales). Se expone como
   * clasificación de negocio explícita a nivel de todo el presupuesto （no
   * por ítem: una cotización es de un único origen), con `"LICITACION"`
   * como default — mismo valor que usan los tres casos de seed de esta HU.
   */
  origen_reserva: z.enum(["LICITACION", "PEDIDO_INSTITUCIONAL"]).default("LICITACION"),
  items: z
    .array(CrearPresupuestoItemSchema)
    .min(1, "El presupuesto debe incluir al menos un ítem"),
});
export type CrearPresupuestoInput = z.infer<typeof CrearPresupuestoSchema>;

/**
 * Schemas Zod de HU-B4 — Override de descuento y cambio manual de precio
 * (spec_modulo_B.md §2.4).
 */

/** `id` de un PedidoVenta recibido por path param. */
export const PedidoVentaIdSchema = z
  .string()
  .uuid("El identificador del pedido de venta debe ser un UUID válido");

/**
 * Copiado textual de `spec_modulo_B.md` §2.4 — no modificar ni el `.refine`,
 * ni los tipos, ni los mensajes (task HU-B4 §1.1).
 */
export const AutorizarOverrideDescuentoSchema = z.object({
  variante_sku_id: z.string().uuid().optional(),
  descuento_porcentual_solicitado: z.number().min(0).max(100).optional(),
  precio_lista_modificado: z.number().positive().optional(),
  motivo: z.string().min(1, "El motivo es obligatorio"),
  supervisor_credencial: z.object({
    usuario_id: z.string().uuid(),
  }),
}).refine(
  (d) => d.descuento_porcentual_solicitado !== undefined || d.precio_lista_modificado !== undefined,
  { message: "Debe indicarse un descuento porcentual o un precio de lista modificado", path: ["descuento_porcentual_solicitado"] }
);
export type AutorizarOverrideDescuentoInput = z.infer<typeof AutorizarOverrideDescuentoSchema>;

/**
 * Schemas Zod de HU-B5 — Cuenta corriente de cliente y autorización de
 * excepción de crédito (spec_modulo_B.md §2.5; docs/tasks/task_HU-B5.md §2.2/§2.3).
 */

/** `cliente_id` recibido por path param (cuenta corriente 1:1 con `Cliente`). */
export const ClienteCuentaCorrienteIdSchema = z
  .string()
  .uuid("El identificador del cliente debe ser un UUID válido");

/** `id` de una `CuentaCorrienteOperacion` recibido por path param. */
export const OperacionCuentaCorrienteIdSchema = z
  .string()
  .uuid("El identificador de la operación debe ser un UUID válido");

/** Copiado textual de `spec_modulo_B.md` §2.5. */
export const RegistrarOperacionCuentaCorrienteSchema = z.object({
  pedido_venta_id: z.string().uuid(),
  monto: z.number().positive(),
  plan_de_pagos: z
    .array(
      z.object({
        hito: z.string().min(1),
        porcentaje: z.number().positive().max(100),
        fecha_estimada: z.coerce.date().optional(),
      })
    )
    .optional(),
});
export type RegistrarOperacionCuentaCorrienteInput = z.infer<typeof RegistrarOperacionCuentaCorrienteSchema>;

/** Copiado textual de `docs/tasks/task_HU-B5.md` §2.3. */
export const ResolverExcepcionCreditoSchema = z.object({
  decision: z.enum(["APROBAR", "RECHAZAR"]),
  motivo: z.string().min(1, "El motivo es obligatorio"),
});
export type ResolverExcepcionCreditoInput = z.infer<typeof ResolverExcepcionCreditoSchema>;

/**
 * Schemas Zod de HU-B2 — Apertura y cierre de turno de caja con arqueo ciego
 * (spec_modulo_B.md §2.2; docs/tasks/task_relos.md §4). Copiados textuales
 * del contrato de la tarea — no modificar tipos ni mensajes.
 */

/** `id` de un TurnoCaja recibido por path param. */
export const TurnoCajaIdSchema = z
  .string()
  .uuid("El identificador del turno de caja debe ser un UUID válido");

export const AbrirTurnoCajaSchema = z.object({
  fondo_fijo_inicial: z.number().nonnegative(),
});
export type AbrirTurnoCajaInput = z.infer<typeof AbrirTurnoCajaSchema>;

/**
 * `justificacion` es opcional a nivel de contrato Zod a propósito (task
 * §4/§6.2 punto 4): su obligatoriedad es CONDICIONAL a que la diferencia
 * supere `UMBRAL_DIFERENCIA_ARQUEO`, una regla de negocio que Zod no puede
 * expresar sin conocer el `saldo_esperado` (que todavía no existe en este
 * punto — recién se calcula server-side dentro de `cerrarTurnoCaja()`). La
 * exigencia real vive en la capa de servicios (`turno-caja.service.ts`),
 * nunca acá.
 */
export const CerrarTurnoCajaSchema = z.object({
  conteo_fisico_declarado: z.number().nonnegative(),
  justificacion: z.string().optional(),
});
export type CerrarTurnoCajaInput = z.infer<typeof CerrarTurnoCajaSchema>;
