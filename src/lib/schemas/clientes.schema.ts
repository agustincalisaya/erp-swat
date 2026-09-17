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
  email: z.string().email("Email inválido").optional(),
});
export type CrearClienteInput = z.infer<typeof CrearClienteSchema>;
