import { z } from "zod";

// Import RELATIVO con extensión explícita (`../utils/fecha-negocio.ts`), no
// el alias `@/...`: este schema se testea bajo el script `test` de
// `package.json` (`node --experimental-strip-types --test`, sin `tsx`), que
// no resuelve alias de `tsconfig.json` — mismo motivo documentado en
// `evaluacion.calculo.ts` / `lista-precios.calculo.ts`.
import { esFechaSoloAnteriorAHoyNegocio } from "../utils/fecha-negocio.ts";

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
 *
 * `items` rechaza el mismo `variante_sku_id` en más de un ítem: con dos
 * precios distintos para la misma variante no hay forma segura de decidir
 * cuál "gana", y persistir ambos dejaría dos `ListaPrecioItem` activos para
 * la misma variante-versión (la corrupción que `DUPLICADO_LISTA_PRECIO_ITEM`
 * detecta en HU-H7/H8). Mismo código y mensaje que la regla equivalente de
 * `OrdenCompra` (`ITEMS_DUPLICADOS`, `orden-compra.service.ts`); el prefijo
 * del mensaje lo detecta `esErrorItemsDuplicados` (mismo patrón que
 * `esErrorCamposNoEditables` en `proveedores.schema.ts`).
 */
export const PublicarListaPreciosSchema = z.object({
  // A1 (auditoría transversal Módulo H, 2026-09-26): el `.refine()` original
  // comparaba `d >= new Date(new Date().toDateString())` — medianoche
  // LOCAL del server, distinta de la medianoche UTC en la que
  // `z.coerce.date()` deja una fecha-solo como "2026-09-26". En Argentina
  // (UTC-3) esa diferencia de 3 h hacía que "hoy" quedara siempre 3 h "antes
  // de hoy" y se rechazara. Se compara ahora por DÍA CALENDARIO de negocio
  // (`esFechaSoloAnteriorAHoyNegocio`, `src/lib/utils/fecha-negocio.ts`):
  // "hoy" nunca se rechaza.
  fecha_inicio_vigencia: z.coerce.date().refine(
    (d) => !esFechaSoloAnteriorAHoyNegocio(d),
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
    .min(1, "La lista debe incluir al menos un ítem")
    .refine(
      (items) =>
        new Set(items.map((item) => item.variante_sku_id)).size === items.length,
      "ITEMS_DUPLICADOS: la lista no puede incluir la misma variante en más de un ítem",
    ),
});
export type PublicarListaPreciosInput = z.infer<
  typeof PublicarListaPreciosSchema
>;

/**
 * True si un `ZodError` de `PublicarListaPreciosSchema` corresponde al
 * rechazo de variantes repetidas — el wrapper (Route Handler o Server
 * Action) lo usa para responder `422 ITEMS_DUPLICADOS` en vez de un
 * `400 VALIDATION_ERROR` genérico.
 */
export function esErrorItemsDuplicados(error: z.ZodError): boolean {
  return error.issues.some((issue) =>
    issue.message.startsWith("ITEMS_DUPLICADOS"),
  );
}

/** `version_id` de una `ListaPrecioVersion` recibido por path param (endpoint de aprobación). */
export const ListaPrecioVersionIdSchema = z
  .string()
  .uuid("El identificador de la versión de lista de precios debe ser un UUID válido");

/**
 * Body de `POST /api/proveedores/[id]/lista-precios/preview` — mismo shape de
 * `items` que `PublicarListaPreciosSchema` (mismo `.refine()` de
 * `ITEMS_DUPLICADOS`, detectable con el mismo `esErrorItemsDuplicados`), SIN
 * `fecha_inicio_vigencia`: el preview no persiste nada, no hay fecha que
 * pueda colisionar con `validarFechaNoDuplicada`.
 */
export const PreviewListaPreciosSchema = z.object({
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        precio_unitario: z
          .number()
          .positive("El precio unitario debe ser mayor a 0"),
      }),
    )
    .min(1, "La lista debe incluir al menos un ítem")
    .refine(
      (items) =>
        new Set(items.map((item) => item.variante_sku_id)).size === items.length,
      "ITEMS_DUPLICADOS: la lista no puede incluir la misma variante en más de un ítem",
    ),
});
export type PreviewListaPreciosInput = z.infer<typeof PreviewListaPreciosSchema>;
