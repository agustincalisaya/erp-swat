import { z } from "zod";

/**
 * Schemas Zod de HU-H3 — Emisión y seguimiento de Orden de Compra
 * (spec_modulo_H.md §2.4 y §2.5).
 *
 * Convención del módulo (spec §2, "Convenciones generales"): los `*_id` se
 * validan solo como `uuid` de forma; la existencia real contra la base es
 * responsabilidad de la capa de servicios (`orden-compra.service.ts`), nunca
 * de estos schemas.
 */

/** `id` de una OrdenCompra recibido por path param. */
export const OrdenCompraIdSchema = z
  .string()
  .uuid("El identificador de la orden de compra debe ser un UUID válido");

// ──────────────────────────────────────────────────────────────────────────────
// §2.4 — Emisión de Orden de Compra (Camino A)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Camino A (decisión del equipo, spec §2.4): el cliente **nunca** envía
 * `precio_unitario`. El servicio lo resuelve contra la `ListaPrecioVersion`
 * vigente del proveedor. Enviar el precio en el payload sería una superficie
 * de manipulación de costos.
 */
export const CrearOrdenCompraSchema = z.object({
  proveedor_id: z.string().uuid(),
  observaciones: z.string().optional(),
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        cantidad_solicitada: z
          .number()
          .int()
          .positive("La cantidad debe ser mayor a 0"),
      }),
    )
    .min(1, "La orden debe incluir al menos un ítem"),
});
export type CrearOrdenCompraInput = z.infer<typeof CrearOrdenCompraSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// §2.5 — Transición de estado (envío, confirmación, cierre, cancelación)
// ──────────────────────────────────────────────────────────────────────────────

export const CambiarEstadoOrdenCompraSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("ENVIAR") }),
  z.object({
    accion: z.literal("CONFIRMAR"),
    fecha_entrega_comprometida: z.coerce.date(),
  }),
  z.object({ accion: z.literal("CERRAR") }),
  z.object({
    accion: z.literal("CANCELAR"),
    deletion_reason: z.string().min(1, "El motivo de cancelación es obligatorio"),
  }),
]);
export type CambiarEstadoOrdenCompraInput = z.infer<
  typeof CambiarEstadoOrdenCompraSchema
>;

/** Acciones válidas de transición de estado de una OrdenCompra (§2.5). */
export type AccionOrdenCompra = CambiarEstadoOrdenCompraInput["accion"];

// ──────────────────────────────────────────────────────────────────────────────
// Filtros del listado `/compras/ordenes` (solo lectura, hidratados desde la URL)
// ──────────────────────────────────────────────────────────────────────────────

/** Los 7 estados del enum `EstadoOrdenCompra` de Prisma (spec §3.1). */
export const ESTADOS_ORDEN_COMPRA = [
  "BORRADOR",
  "ENVIADA",
  "CONFIRMADA",
  "RECEPCION_PARCIAL",
  "RECIBIDA_COMPLETA",
  "CERRADA",
  "CANCELADA",
] as const;

export type EstadoOrdenCompraValor = (typeof ESTADOS_ORDEN_COMPRA)[number];

/**
 * Filtros de la grilla de órdenes. Ambos opcionales — sin filtros se lista
 * todo. `.catch(undefined)` para que un query param corrupto no rompa la
 * página, solo se ignore (mismo criterio que el resto de las grillas del
 * dashboard).
 */
export const FiltrosListadoOrdenesCompraSchema = z.object({
  estado: z.enum(ESTADOS_ORDEN_COMPRA).optional().catch(undefined),
  proveedor_id: z.string().uuid().optional().catch(undefined),
});
export type FiltrosListadoOrdenesCompraInput = z.infer<
  typeof FiltrosListadoOrdenesCompraSchema
>;
