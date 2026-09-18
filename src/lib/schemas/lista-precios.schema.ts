import { z } from "zod";

/**
 * Schemas Zod de HU-H2 (Módulo H) — Publicación y aprobación de versiones de
 * lista de precios de proveedor (`docs/tasks/sdd/HU-H2/spec.md`).
 *
 * Ni el Design ni las Tasks especifican este archivo explícitamente (nota en
 * `tasks_HU-H2_FINAL.md`: "El Design no especifica el shape exacto de
 * request/response... al implementarlas, alinearlas con los contratos de
 * servicio"); se crea acá siguiendo la misma convención de archivo que
 * `ordenes-compra.schema.ts` / `proveedores.schema.ts`.
 *
 * `ProveedorIdSchema` (path param `id` de ambos endpoints de este módulo) NO
 * se redefine acá — ya existe en `@/lib/schemas/proveedores.schema.ts` con
 * exactamente la misma forma (`z.string().uuid()`); se reusa desde ahí para
 * no duplicar el schema del mismo recurso lógico (Proveedor) en dos archivos.
 */

/**
 * Body de `POST /api/proveedores/[id]/lista-precios` — copiado EXACTO de
 * `spec.md` ("Endpoint de publicación" · Request), incluido el `.refine()`
 * de fecha no anterior a hoy.
 */
export const PublicarListaPreciosSchema = z.object({
  fecha_inicio_vigencia: z.coerce.date().refine(
    (d) => d >= new Date(new Date().toDateString()),
    "La fecha de vigencia no puede ser anterior al día de hoy",
  ),
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        precio_unitario: z
          .number()
          .positive("El precio unitario debe ser mayor a 0"),
      }),
    )
    .min(1, "La lista debe incluir al menos un ítem"),
});
export type PublicarListaPreciosInput = z.infer<
  typeof PublicarListaPreciosSchema
>;

/** `version_id` de una `ListaPrecioVersion` recibido por path param (endpoint de aprobación). */
export const ListaPrecioVersionIdSchema = z
  .string()
  .uuid("El identificador de la versión de lista de precios debe ser un UUID válido");
