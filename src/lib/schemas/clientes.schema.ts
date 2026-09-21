import { z } from "zod";

/**
 * HU-C1 (Módulo C) — Alta de Cliente con validación de unicidad por DNI
 * (spec_modulo_C.md §2.1). Base: el `CrearClienteSchema` del spec, SIN el
 * campo `direccion` del snippet original — el "Comportamiento esperado" de
 * §2.1 no describe ningún manejo de dirección, la dirección no tiene lugar
 * en el modelo `Cliente` (vive en `DireccionCliente`, HU-C3 §2.3, entidad
 * separada con su propio endpoint/schema/permiso), y el propio
 * `schema.prisma` es explícito: "toda dirección se modela en
 * `DireccionCliente` (HU-C3), incluida la primera que se cargue en el
 * alta". Omitir el campo evita implementar un comportamiento que el spec
 * no define (gate de confirmación de esta tarea).
 */
export const CrearClienteSchema = z.object({
  dni: z.string().regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
  nombre: z.string().min(2, "El nombre es obligatorio"),
  telefono: z.string().optional(),
  // Un input HTML vacío manda "" (no undefined): "" se trata como "sin email".
  email: z
    .string()
    .email("Email inválido")
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});
export type CrearClienteInput = z.infer<typeof CrearClienteSchema>;

/**
 * HU-C3 (Módulo C) — Alta de una dirección de un cliente
 * (spec_modulo_C.md §2.3). Contrato exacto del spec para
 * `POST /api/clientes/[id]/direcciones`: `{ rotulo, tipo, direccion_completa }`.
 *
 * SIN `.strict()` a propósito (spec §2.3): `cliente_id` NO es parte del
 * contrato de entrada. El único origen de verdad del cliente es el path
 * param `[id]` de la ruta — el servicio jamás lee `cliente_id` del input
 * parseado. Como el schema no es `.strict()` (comportamiento por defecto de
 * Zod), una clave `cliente_id` espuria en el body se descarta en silencio en
 * lugar de rechazar el request, que es exactamente lo que exige el spec.
 *
 * `tipo` es el enum del modelo `TipoDireccionCliente` (ya fijado en
 * `schema.prisma` — nunca se renombra ni se reemplaza por un schema propio).
 */
export const AgregarDireccionClienteSchema = z.object({
  rotulo: z.string().min(1, "El rótulo es obligatorio (ej. 'Casa', 'Depósito')"),
  tipo: z.enum(["FACTURACION", "ENVIO"]),
  direccion_completa: z.string().min(5, "La dirección es obligatoria"),
});
export type AgregarDireccionClienteInput = z.infer<typeof AgregarDireccionClienteSchema>;
