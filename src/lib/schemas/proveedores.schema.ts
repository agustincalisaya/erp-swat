import { z } from "zod";

/**
 * HU-H5 (Módulo H) — Evaluación de proveedores.
 *
 * No se expone como Route Handler ni Server Action propios en este PR — se
 * invoca internamente desde `recepcion.service.ts` (HU-H4, task_relos.md
 * Sección 0.5). El schema queda igual documentado por si en el futuro se
 * expone una vía manual (ej. carga de documentación por un Supervisor de
 * Compras).
 */
export const RegistrarEvaluacionDesdeRecepcionSchema = z.object({
  recepcion_id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  /** Insumo opcional de Módulo I (todavía no existe) — manual por ahora. */
  devoluciones_fabricacion: z.number().int().nonnegative().optional(),
  /** Insumo opcional de documentación — manual por ahora (Sección 0.4). */
  puntaje_documentacion_override: z.number().int().min(0).max(100).optional(),
  observaciones: z.string().optional(),
});
export type RegistrarEvaluacionDesdeRecepcionInput = z.infer<
  typeof RegistrarEvaluacionDesdeRecepcionSchema
>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-H1 (Módulo H) — Alta y Homologación de Proveedores (spec_modulo_H.md
// §2.1 / §2.2). Schemas de entrada del legajo comercial. El dato bancario se
// modela en claro acá (el servicio es el único responsable de cifrarlo antes
// de persistir — spec §3.3).
// ──────────────────────────────────────────────────────────────────────────────

const CUIT_REGEX = /^\d{2}-\d{8}-\d{1}$/;

const DatosBancariosSchema = z.object({
  cbu: z.string().length(22, "El CBU debe tener 22 dígitos"),
  alias: z.string().optional(),
  banco: z.string().min(1, "El banco es obligatorio"),
});

/** Alta de proveedor (spec §2.1). Estado inicial SIEMPRE PENDIENTE (service). */
export const CrearProveedorSchema = z.object({
  razon_social: z.string().min(2, "La razón social es obligatoria"),
  nombre_fantasia: z.string().optional(),
  cuit: z
    .string()
    .regex(CUIT_REGEX, "El CUIT debe tener el formato NN-NNNNNNNN-N"),
  condiciones_pago: z.string().optional(),
  categorias: z
    .array(
      z
        .string()
        .min(1, "Cada categoría debe tener al menos 1 carácter")
        .max(50, "Cada categoría admite hasta 50 caracteres"),
    )
    .min(1, "Debe indicar al menos una categoría de producto")
    .max(20, "Máximo 20 categorías"),
  contacto_nombre: z.string().optional(),
  contacto_email: z.string().email("Email de contacto inválido").optional(),
  contacto_telefono: z.string().optional(),
  datos_bancarios: DatosBancariosSchema.optional(),
});
export type CrearProveedorInput = z.infer<typeof CrearProveedorSchema>;

/** Cambio manual de estado de homologación (spec §2.2). */
export const CambiarEstadoProveedorSchema = z
  .object({
    nuevo_estado: z.enum(["HOMOLOGADO", "SUSPENDIDO", "PENDIENTE"]),
    motivo: z
      .string()
      .min(1, "El motivo es obligatorio al suspender un proveedor")
      .optional(),
  })
  .refine(
    (data) =>
      data.nuevo_estado !== "SUSPENDIDO" ||
      (data.motivo !== undefined && data.motivo.length > 0),
    {
      message: "El motivo es obligatorio al transicionar a SUSPENDIDO",
      path: ["motivo"],
    },
  );
export type CambiarEstadoProveedorInput = z.infer<
  typeof CambiarEstadoProveedorSchema
>;

/** Baja lógica del registro de proveedor (Regla N.° 1 — nunca un DELETE). */
export const DarDeBajaProveedorSchema = z.object({
  deletion_reason: z.string().min(1, "El motivo de la baja es obligatorio"),
});
export type DarDeBajaProveedorInput = z.infer<typeof DarDeBajaProveedorSchema>;

/**
 * Edición parcial del legajo (PATCH /api/proveedores/[id]). Campos editables:
 * `razon_social`, `nombre_fantasia`, `condiciones_pago`, `categorias`,
 * `contacto_*`, `datos_bancarios` (reemplazo). `cuit` y `estado` NO son
 * editables: `.passthrough()` preserva las claves desconocidas del payload
 * para que el `superRefine` las detecte y falle con `CAMPOS_NO_EDITABLES`
 * (el service replica el chequeo como defensa en profundidad).
 */
export const EditarProveedorSchema = z
  .object({
    razon_social: z
      .string()
      .min(2, "La razón social debe tener al menos 2 caracteres")
      .optional(),
    nombre_fantasia: z.string().optional(),
    condiciones_pago: z.string().optional(),
    categorias: z
      .array(
        z
          .string()
          .min(1, "Cada categoría debe tener al menos 1 carácter")
          .max(50, "Cada categoría admite hasta 50 caracteres"),
      )
      .min(1, "Debe indicar al menos una categoría de producto")
      .max(20, "Máximo 20 categorías")
      .optional(),
    contacto_nombre: z.string().optional(),
    contacto_email: z.string().email("Email de contacto inválido").optional(),
    contacto_telefono: z.string().optional(),
    datos_bancarios: DatosBancariosSchema.optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if ("cuit" in data || "estado" in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "CAMPOS_NO_EDITABLES: el CUIT y el estado del proveedor no se pueden editar en el legajo",
        path: ["cuit"],
      });
    }
  });
export type EditarProveedorInput = z.infer<typeof EditarProveedorSchema>;

/**
 * True si un `ZodError` de `EditarProveedorSchema` corresponde al rechazo de
 * campos no editables (`cuit`/`estado`) — el wrapper (Route Handler o Server
 * Action) lo usa para responder `422 CAMPOS_NO_EDITABLES` en vez de un
 * `400 VALIDATION_ERROR` genérico.
 */
export function esErrorCamposNoEditables(error: z.ZodError): boolean {
  return error.issues.some((issue) =>
    issue.message.startsWith("CAMPOS_NO_EDITABLES"),
  );
}

/** ID de proveedor (ruta `[id]`). */
export const ProveedorIdSchema = z.string().uuid();

/** Filtro del listado GET /api/proveedores (`?estado=`). */
export const FiltrosListadoProveedoresSchema = z.object({
  estado: z.enum(["PENDIENTE", "HOMOLOGADO", "SUSPENDIDO"]).optional(),
});
export type FiltrosListadoProveedoresInput = z.infer<
  typeof FiltrosListadoProveedoresSchema
>;
