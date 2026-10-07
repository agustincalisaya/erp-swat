import { z } from "zod";

/**
 * Schemas Zod de HU-G11 — ingresos de Tesorería por cobros online
 * (spec_modulo_G.md §2.6).
 *
 * Convención del módulo (spec §2, "Convenciones generales", igual que
 * `cuentas-por-pagar.schema.ts`): los `*_id` se validan solo como `uuid` de
 * forma; la existencia real contra la base es responsabilidad de la capa de
 * servicios (`ingreso-tesoreria.service.ts`), nunca de estos schemas.
 */

// ──────────────────────────────────────────────────────────────────────────────
// §2.6 — Reproceso manual de un ingreso (POST /api/tesoreria/ingresos-web/reprocesar)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Body del reproceso manual: el `id` del `PedidoVenta` cuyo pago web se quiere
 * re-registrar. La idempotencia la garantiza el service.
 */
export const ReprocesarIngresoWebSchema = z.object({
  pedido_venta_id: z
    .string()
    .uuid("El identificador del pedido de venta debe ser un UUID válido"),
});
export type ReprocesarIngresoWebInput = z.infer<typeof ReprocesarIngresoWebSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Filtros del listado `GET /api/tesoreria/ingresos-web` (solo lectura,
// hidratados desde la URL). Convención `page` / `page_size` alineada al
// precedente real del proyecto (`cuentas-por-pagar.schema.ts`).
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Los dos únicos valores de `IngresoTesoreria.estado` (spec §2.6). Es un
 * `String`, no un enum de Prisma — la transición a `CONCILIADO` es de HU-G2.
 */
export const ESTADOS_INGRESO_TESORERIA = ["PENDIENTE_CONCILIACION", "CONCILIADO"] as const;

export type EstadoIngresoTesoreriaValor = (typeof ESTADOS_INGRESO_TESORERIA)[number];

/**
 * Filtros de la grilla de ingresos web (spec §2.6): estado y rango de fechas.
 * `page` / `page_size` llegan siempre resueltos por los `.default()`, por eso
 * el output es asignable a `FiltrosIngresosWeb` del servicio. Sin
 * `incluirInactivos` (no hay soft delete).
 */
export const FiltrosIngresosWebSchema = z.object({
  estado: z.enum(ESTADOS_INGRESO_TESORERIA).optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});
export type FiltrosIngresosWebInput = z.infer<typeof FiltrosIngresosWebSchema>;
