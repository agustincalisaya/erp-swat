/**
 * Schemas Zod de Módulo E — E-commerce / Tienda Online (spec_modulo_E.md).
 */
import { z } from "zod";

/**
 * HU-E8 §2.8 — login de Cliente Web.
 * TODO(HU-E8): introducido por HU-E1 como parte del mínimo provisional de
 * sesión (`lib/auth/sesion-cliente-web.ts`); el owner de HU-E8 lo completa.
 */
export const IniciarSesionClienteWebSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type IniciarSesionClienteWebInput = z.infer<typeof IniciarSesionClienteWebSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-E1 §2.1 — catálogo y carrito
// ──────────────────────────────────────────────────────────────────────────────

/** Tope por línea de carrito: evita cantidades absurdas en un carrito anónimo
 * (la garantía real anti-sobreventa es la reserva del checkout). */
export const CANTIDAD_MAXIMA_POR_ITEM = 99;

export const AgregarAlCarritoSchema = z.object({
  variante_sku_id: z.string().uuid(),
  cantidad: z.number().int().positive().max(CANTIDAD_MAXIMA_POR_ITEM),
});
export type AgregarAlCarritoInput = z.infer<typeof AgregarAlCarritoSchema>;

export const ActualizarCantidadCarritoSchema = z.object({
  cantidad: z.number().int().positive().max(CANTIDAD_MAXIMA_POR_ITEM),
});
export type ActualizarCantidadCarritoInput = z.infer<typeof ActualizarCantidadCarritoSchema>;

export const ItemCarritoIdSchema = z.string().uuid("El identificador del ítem es inválido");
export const ProductoWebIdSchema = z.string().uuid("El identificador del producto es inválido");

/** Filtros mínimos de HU-E1 (los completos — talle/color/género/orden — son de HU-E11). */
export const ListarCatalogoQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoria: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(48).default(12),
});
export type ListarCatalogoQuery = z.infer<typeof ListarCatalogoQuerySchema>;
