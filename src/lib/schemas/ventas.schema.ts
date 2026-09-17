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
