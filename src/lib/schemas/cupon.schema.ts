/**
 * HU-E4 — Schemas de la administración de cupones (spec_modulo_E.md §2.4.e).
 * Bodies estrictos: cualquier campo desconocido (incluido `codigo` al editar,
 * `is_active` o el actor) es 400.
 */
import { z } from "zod";

export const TIPOS_BENEFICIO = ["PORCENTAJE", "MONTO_FIJO"] as const;
export const FILTROS_ESTADO_CUPON = ["ACTIVOS", "INACTIVOS", "TODOS"] as const;

const codigo = z
  .string({ required_error: "El código es obligatorio", invalid_type_error: "El código debe ser texto" })
  .trim()
  .transform((valor) => valor.toUpperCase())
  .pipe(
    z
      .string()
      .min(3, "El código debe tener entre 3 y 50 caracteres")
      .max(50, "El código debe tener entre 3 y 50 caracteres")
      .regex(/^[A-Z0-9_-]+$/, "El código solo admite letras, números, guion y guion bajo"),
  );
const tipoBeneficio = z.enum(TIPOS_BENEFICIO, {
  errorMap: () => ({ message: "El tipo de beneficio debe ser PORCENTAJE o MONTO_FIJO" }),
});
/** Decimal positivo como string, con hasta 2 decimales (`Decimal(12,2)`). */
const valor = z
  .string({
    required_error: "El valor es obligatorio",
    invalid_type_error: "El valor debe enviarse como texto decimal",
  })
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "El valor debe ser un número con hasta 2 decimales")
  .refine((v) => Number(v) > 0, "El valor debe ser mayor que cero");
const fecha = z
  .string({ required_error: "La fecha es obligatoria", invalid_type_error: "La fecha debe ser ISO 8601 con zona horaria" })
  .datetime({ offset: true, message: "La fecha debe ser ISO 8601 con zona horaria" });
const numeroLimite = { required_error: "El límite es obligatorio", invalid_type_error: "El límite debe ser un número entero" };
const limiteGlobal = z
  .number(numeroLimite)
  .int("El límite debe ser un entero")
  .positive("El límite debe ser mayor que cero")
  .nullable();
const limitePorCliente = z
  .number(numeroLimite)
  .int("El límite debe ser un entero")
  .positive("El límite debe ser mayor que cero");
const CAMPOS_NO_PERMITIDOS = "El cuerpo contiene campos no permitidos";
/** Body ausente, `null`, array o no-JSON (`leerJson` lo convierte en `null`). */
const CUERPO_OBJETO = {
  required_error: "El cuerpo debe ser un objeto JSON",
  invalid_type_error: "El cuerpo debe ser un objeto JSON",
};

interface CamposCruzados {
  tipo_beneficio?: string;
  valor?: string;
  vigente_desde?: string;
  vigente_hasta?: string;
}

/** Reglas que cruzan campos: porcentaje < 100 (K5) y ventana no invertida. */
function validarCruzados(datos: CamposCruzados, ctx: z.RefinementCtx): void {
  if (datos.tipo_beneficio === "PORCENTAJE" && datos.valor !== undefined && Number(datos.valor) >= 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valor"], message: "El porcentaje debe ser menor que 100" });
  }
  if (
    datos.vigente_desde !== undefined &&
    datos.vigente_hasta !== undefined &&
    new Date(datos.vigente_hasta) <= new Date(datos.vigente_desde)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vigente_hasta"],
      message: "El fin de vigencia debe ser posterior al inicio",
    });
  }
}

export const CrearCuponSchema = z
  .object({
    codigo,
    tipo_beneficio: tipoBeneficio,
    valor,
    vigente_desde: fecha,
    vigente_hasta: fecha,
    limite_uso_global: limiteGlobal.default(null),
    limite_uso_por_cliente: limitePorCliente.default(1),
  }, CUERPO_OBJETO)
  .strict(CAMPOS_NO_PERMITIDOS)
  .superRefine(validarCruzados);
export type CrearCuponInput = z.infer<typeof CrearCuponSchema>;

export const EditarCuponSchema = z
  .object({
    tipo_beneficio: tipoBeneficio.optional(),
    valor: valor.optional(),
    vigente_desde: fecha.optional(),
    vigente_hasta: fecha.optional(),
    limite_uso_global: limiteGlobal.optional(),
    limite_uso_por_cliente: limitePorCliente.optional(),
  }, CUERPO_OBJETO)
  .strict(CAMPOS_NO_PERMITIDOS)
  .refine((datos) => Object.keys(datos).length > 0, "Indicá al menos un campo a modificar")
  .superRefine(validarCruzados);
export type EditarCuponInput = z.infer<typeof EditarCuponSchema>;

export const BajaCuponSchema = z
  .object({
    motivo: z
      .string({ required_error: "El motivo es obligatorio", invalid_type_error: "El motivo debe ser texto" })
      .trim()
      .min(3, "El motivo debe tener entre 3 y 500 caracteres")
      .max(500, "El motivo debe tener entre 3 y 500 caracteres"),
  }, CUERPO_OBJETO)
  .strict(CAMPOS_NO_PERMITIDOS);
export type BajaCuponInput = z.infer<typeof BajaCuponSchema>;

export const FiltroCuponesSchema = z.object({
  estado: z
    .enum(FILTROS_ESTADO_CUPON, { errorMap: () => ({ message: "El estado debe ser ACTIVOS, INACTIVOS o TODOS" }) })
    .default("ACTIVOS"),
  q: z
    .string({ invalid_type_error: "La búsqueda debe ser texto" })
    .trim()
    .max(50, "La búsqueda admite hasta 50 caracteres")
    .transform((v) => v.toUpperCase())
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type FiltroCuponesInput = z.infer<typeof FiltroCuponesSchema>;
