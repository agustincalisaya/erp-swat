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

/**
 * HU-C9 (Módulo C) — Actualización del canal de contacto preferido
 * (spec_modulo_C.md §2.3). Contrato de
 * `PATCH /api/clientes/[id]/canal-contacto` (permiso `clientes:editar`).
 *
 * SIN `.strict()` a propósito (mismo criterio que
 * `AgregarDireccionClienteSchema`, HU-C3): `cliente_id` NO es parte del body
 * — el único origen de verdad del cliente es el path param `[id]` de la ruta,
 * y el servicio jamás lee un `cliente_id` del input parseado. Como el schema
 * no es `.strict()` (comportamiento por defecto de Zod), una clave
 * `cliente_id` espuria en el body se descarta en silencio en lugar de
 * rechazar el request, que es exactamente lo que exige la spec.
 *
 * Los tres valores del enum son exactamente los del `CanalContacto` de
 * `schema.prisma` (WHATSAPP/EMAIL/AMBOS) — nunca se reemplazan por un enum
 * propio. `null` NO es un valor válido: no existe operación de limpieza
 * (spec §2.3, "Fuera de alcance").
 */
export const ActualizarCanalContactoSchema = z.object({
  canal_preferido: z.enum(["WHATSAPP", "EMAIL", "AMBOS"]),
});
export type ActualizarCanalContactoInput = z.infer<typeof ActualizarCanalContactoSchema>;

/**
 * HU-C8 (Módulo C) — Actualización del segmento comercial
 * (spec_modulo_C.md §2.8). Contrato de
 * `PATCH /api/clientes/[id]/segmento` (permiso `clientes:gestionar_segmento`,
 * DISTINTO de `clientes:editar` — partición deliberada de RBAC).
 *
 * SIN `.strict()` a propósito (mismo criterio que
 * `AgregarDireccionClienteSchema` y `ActualizarCanalContactoSchema`):
 * `cliente_id` NO es parte del body — el único origen de verdad del cliente es
 * el path param `[id]` de la ruta, y el servicio jamás lee un `cliente_id` del
 * input parseado. Como el schema no es `.strict()` (comportamiento por defecto
 * de Zod), una clave `cliente_id` espuria en el body se descarta en silencio en
 * lugar de rechazar el request, que es exactamente lo que exige la spec.
 *
 * Los tres valores del enum son exactamente los del `SegmentoComercial` de
 * `schema.prisma` (MINORISTA/MAYORISTA/CLIENTE_FRECUENTE) — nunca se
 * reemplazan por un enum propio. `segmento` es `NOT NULL` con default
 * `MINORISTA`: no existe valor vacío ni operación de limpieza (spec §2.8).
 */
export const ActualizarSegmentoClienteSchema = z.object({
  segmento: z.enum(["MINORISTA", "MAYORISTA", "CLIENTE_FRECUENTE"]),
});
export type ActualizarSegmentoClienteInput = z.infer<typeof ActualizarSegmentoClienteSchema>;

/**
 * HU-C7 (Módulo C) — Consulta unificada por DNI
 * (spec_modulo_C.md §2.7). Contrato de entrada de
 * `GET /api/clientes/buscar?dni=<dni>`.
 *
 * A diferencia de los schemas de body de las demás HUs de Módulo C, este
 * valida el **QUERY STRING** de la URL — no un body JSON. Por eso el Route
 * Handler parsea `{ dni: req.nextUrl.searchParams.get("dni") }` en lugar de
 * `await req.json()`: un DNI ausente llega como `null` (no `undefined`), y el
 * regex lo rechaza igual que a cualquier formato inválido.
 *
 * SIN `.strict()` (mismo criterio que los demás schemas de Módulo C): solo
 * interesa `dni`; cualquier otro parámetro de query se ignora en silencio.
 *
 * El patrón es exactamente el del `CrearClienteSchema` (mismo mensaje de
 * error) para que el POS reciba el mismo texto de validación en el alta y en
 * la consulta: 7 u 8 dígitos, sin puntos ni espacios.
 */
export const BuscarClientePorDniQuerySchema = z.object({
  dni: z.string().regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
});
export type BuscarClientePorDniQueryInput = z.infer<typeof BuscarClientePorDniQuerySchema>;

/**
 * HU-C6 (Módulo C) — Baja lógica de un cliente (spec_modulo_C.md §2.6,
 * RULES.md Regla N.° 1 — nunca un DELETE). Contrato de
 * `PATCH /api/clientes/[id]/baja`. El único requisito es el motivo: la baja NO
 * se bloquea por pedidos/presupuestos abiertos ni por saldo de cuenta corriente
 * (decisión de diseño). Mismo shape que `DarDeBajaProveedorSchema`.
 */
export const BajaClienteSchema = z.object({
  deletion_reason: z.string().trim().min(1, "El motivo de la baja es obligatorio"),
});
export type BajaClienteInput = z.infer<typeof BajaClienteSchema>;

/**
 * HU-C2 (Módulo C) — Edición de los datos de contacto de un cliente
 * (spec_modulo_C.md, backlog HU-C2). Contrato de `PATCH /api/clientes/[id]`
 * (permiso `clientes:editar`). Campos editables: `nombre`, `telefono`,
 * `email`. La dirección NO se edita acá: vive en `DireccionCliente` y tiene
 * su propio contrato (`EditarDireccionClienteSchema`).
 *
 * Semántica de cada campo: ausente (`undefined`) = "no tocar"; `""` en
 * `telefono`/`email` = "vaciar" (el service lo persiste como `null`). A
 * diferencia de `CrearClienteSchema`, el `""` de `email` NO se transforma a
 * `undefined`: en edición esa diferencia es la que permite borrar el dato.
 *
 * `dni` es inmutable una vez creado el registro (AC de HU-C2): `.passthrough()`
 * preserva las claves desconocidas para que el `superRefine` detecte `dni` y
 * falle con `CAMPOS_NO_EDITABLES` (mismo patrón que `EditarProveedorSchema`;
 * el service replica el chequeo como defensa en profundidad). Cualquier otra
 * clave espuria (ej. `cliente_id`) se ignora, como en el resto del módulo.
 */
export const EditarClienteSchema = z
  .object({
    nombre: z.string().min(2, "El nombre es obligatorio").optional(),
    telefono: z.string().optional(),
    email: z.string().email("Email inválido").or(z.literal("")).optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if ("dni" in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CAMPOS_NO_EDITABLES: el DNI de un cliente no se puede editar",
        path: ["dni"],
      });
      return;
    }
    if (
      data.nombre === undefined &&
      data.telefono === undefined &&
      data.email === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Debe indicar al menos un campo a editar (nombre, teléfono o email)",
      });
    }
  });
export type EditarClienteInput = z.infer<typeof EditarClienteSchema>;

/**
 * True si un `ZodError` de `EditarClienteSchema` corresponde al rechazo de un
 * campo no editable (`dni`) — el wrapper (Route Handler o Server Action) lo
 * usa para responder `422 CAMPOS_NO_EDITABLES` en vez de un `400
 * VALIDATION_ERROR` genérico. Espejo de `esErrorCamposNoEditables` de
 * proveedores.
 */
export function esErrorClienteCamposNoEditables(error: z.ZodError): boolean {
  return error.issues.some((issue) => issue.message.startsWith("CAMPOS_NO_EDITABLES"));
}

/**
 * HU-C2 (Módulo C) — Edición de una dirección existente de un cliente.
 * Contrato de `PATCH /api/clientes/[id]/direcciones/[direccionId]` (permiso
 * `clientes:editar`). Campos editables: `rotulo`, `tipo`,
 * `direccion_completa` — todos opcionales (edición parcial), con al menos uno
 * presente. Mismas validaciones de formato que `AgregarDireccionClienteSchema`.
 *
 * SIN `.strict()` (mismo criterio que el resto del módulo): `cliente_id` y
 * `direccion_id` NO son parte del body — el origen de verdad son los path
 * params `[id]` / `[direccionId]`, y una clave espuria se descarta en silencio.
 * La regla de FACTURACION al cambiar `tipo` NO vive acá: es una regla de
 * negocio con lectura de DB, vive en el service (`direccion-cliente.reglas.ts`).
 */
export const EditarDireccionClienteSchema = z
  .object({
    rotulo: z
      .string()
      .min(1, "El rótulo es obligatorio (ej. 'Casa', 'Depósito')")
      .optional(),
    tipo: z.enum(["FACTURACION", "ENVIO"]).optional(),
    direccion_completa: z.string().min(5, "La dirección es obligatoria").optional(),
  })
  .refine(
    (data) =>
      data.rotulo !== undefined ||
      data.tipo !== undefined ||
      data.direccion_completa !== undefined,
    { message: "Debe indicar al menos un campo a editar (rótulo, tipo o dirección)" },
  );
export type EditarDireccionClienteInput = z.infer<typeof EditarDireccionClienteSchema>;
