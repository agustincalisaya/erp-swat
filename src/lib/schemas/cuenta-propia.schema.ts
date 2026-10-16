import { z } from "zod";

/**
 * Schemas Zod de HU-G5 — Cuentas bancarias y cajas propias (spec_modulo_G.md
 * §9.1 y §9.7).
 *
 * Convención del módulo (spec §9.1, igual que `cuentas-por-pagar.schema.ts`):
 * estos schemas validan FORMA y reglas de campo. La existencia real de la
 * cuenta, su estado `is_active` y la autorización por permiso son
 * responsabilidad de la capa de servicios (`cuenta-propia.service.ts`), nunca
 * de estos schemas.
 *
 * Diferencia por `tipo` (G5-1): una `BANCARIA` exige `banco`, `cbu` y `alias`
 * (errores por campo vía `superRefine`); una `CAJA` puede omitirlos. El CBU,
 * cuando viene con valor, debe ser exactamente 22 dígitos.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Tipos y constantes compartidas
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Naturaleza de la cuenta propia. Espejo exacto del enum `TipoCuentaPropia`
 * de Prisma — mantener sincronizado.
 */
export const CUENTAS_PROPIAS_TIPOS = ["BANCARIA", "CAJA"] as const;

export type TipoCuentaPropiaValor = (typeof CUENTAS_PROPIAS_TIPOS)[number];

/** CBU argentino: exactamente 22 dígitos (BCRA). */
export const CBU_REGEX = /^\d{22}$/;

/**
 * `id` de una `CuentaPropia` recibido por path param. A diferencia de las
 * entidades con `@default(uuid())`, las cuentas sembradas conservan los `id`
 * de texto del catálogo retirado de HU-G10 (ej. `banco-nacion-cc-principal`),
 * por eso se valida como string no vacío y no como UUID.
 */
export const CuentaPropiaIdSchema = z
  .string()
  .min(1, "El identificador de la cuenta propia es obligatorio");

// ──────────────────────────────────────────────────────────────────────────────
// Campos comunes (reutilizados por alta y edición)
// ──────────────────────────────────────────────────────────────────────────────

const nombreSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio")
  .max(120, "El nombre no puede superar los 120 caracteres");

const bancoSchema = z
  .string()
  .trim()
  .max(120, "El banco no puede superar los 120 caracteres");

/**
 * CBU opcional. Se acepta `""` en la forma base (lo usa la `CAJA` para "sin
 * CBU"); si trae valor no vacío, debe cumplir `CBU_REGEX`. Que una `BANCARIA`
 * lo exija es responsabilidad del `superRefine`.
 */
const cbuSchema = z.union([
  z.string().trim().regex(CBU_REGEX, "El CBU debe tener exactamente 22 dígitos"),
  z.literal(""),
]);

const aliasSchema = z
  .string()
  .trim()
  .max(60, "El alias no puede superar los 60 caracteres");

/**
 * Forma base de una cuenta propia. Es la materia prima de los objetos de alta
 * y edición; el refinamiento condicional por `tipo` se agrega en cada uno.
 */
const CuentaPropiaCamposSchema = z.object({
  nombre: nombreSchema,
  tipo: z.enum(CUENTAS_PROPIAS_TIPOS),
  banco: bancoSchema.optional(),
  cbu: cbuSchema.optional(),
  alias: aliasSchema.optional(),
});

/**
 * Regla G5-1 compartida: una `BANCARIA` exige banco, CBU y alias (error por
 * campo). Una `CAJA` no exige ningún dato bancario. El sentido es
 * unidireccional: no se prohíbe que una `CAJA` traiga datos, solo no se le
 * exigen.
 */
function requerirDatosBancariosSiBancaria(
  data: { tipo?: TipoCuentaPropiaValor; banco?: string; cbu?: string; alias?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.tipo !== "BANCARIA") return;

  if (data.banco === undefined || data.banco.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["banco"],
      message: "El banco es obligatorio para una cuenta bancaria",
    });
  }
  if (data.cbu === undefined || data.cbu.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cbu"],
      message: "El CBU es obligatorio para una cuenta bancaria (22 dígitos)",
    });
  }
  if (data.alias === undefined || data.alias.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["alias"],
      message: "El alias es obligatorio para una cuenta bancaria",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// §9.7 — Alta de una cuenta propia
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Alta de una `CuentaPropia`. `tipo=BANCARIA` exige banco, CBU y alias;
 * `tipo=CAJA` los admite ausentes. El CBU con valor debe ser de 22 dígitos y el
 * nombre se recorta a 1..120 caracteres.
 */
export const CrearCuentaPropiaSchema = CuentaPropiaCamposSchema.superRefine(
  requerirDatosBancariosSiBancaria,
);
export type CrearCuentaPropiaInput = z.infer<typeof CrearCuentaPropiaSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// §9.7 — Edición de una cuenta propia (parcial)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Edición parcial de una `CuentaPropia`: todos los campos son opcionales. La
 * regla condicional solo aplica cuando el payload declara `tipo=BANCARIA`
 * (cambiarla a bancaria exige los datos bancarios en ese mismo payload); una
 * edición que no toca `tipo` no re-valida los datos existentes.
 */
export const EditarCuentaPropiaSchema = CuentaPropiaCamposSchema.partial().superRefine(
  requerirDatosBancariosSiBancaria,
);
export type EditarCuentaPropiaInput = z.infer<typeof EditarCuentaPropiaSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// §9.7 — Baja lógica de una cuenta propia
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Baja lógica de una `CuentaPropia` (RULES.md Regla 1): el motivo es
 * obligatorio. No existe schema de baja física — el borrado nunca ocurre.
 */
export const DarDeBajaCuentaPropiaSchema = z.object({
  deletion_reason: z
    .string()
    .trim()
    .min(1, "El motivo de baja es obligatorio")
    .max(500, "El motivo de baja no puede superar los 500 caracteres"),
});
export type DarDeBajaCuentaPropiaInput = z.infer<typeof DarDeBajaCuentaPropiaSchema>;
