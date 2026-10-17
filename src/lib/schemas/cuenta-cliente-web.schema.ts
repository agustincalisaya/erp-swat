import { z } from "zod";

const emailNormalizado = z.string().trim().email("Email inválido").transform((value) => value.toLowerCase());
const password = z.string().min(8, "La contraseña debe tener al menos 8 caracteres");

export const RegistroCuentaWebSchema = z.object({
  nombre: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres"),
  dni: z.string().regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
  telefono: z.string().trim().min(1, "El teléfono es obligatorio"),
  email: emailNormalizado,
  password,
  acepta_tratamiento: z.literal(true, { errorMap: () => ({ message: "Debe aceptar el tratamiento de datos" }) }),
  acepta_comunicaciones: z.boolean().default(false),
});
export type RegistroCuentaWebInput = z.infer<typeof RegistroCuentaWebSchema>;

export const RedefinirPasswordSchema = z.object({
  email: emailNormalizado,
  codigo: z.string().trim().length(8, "El código debe tener 8 caracteres").transform((value) => value.toUpperCase()),
  password,
  confirmacion: z.string(),
}).refine((data) => data.password === data.confirmacion, { message: "Las contraseñas no coinciden", path: ["confirmacion"] });
export type RedefinirPasswordInput = z.infer<typeof RedefinirPasswordSchema>;

export const BajaCuentaWebSchema = z.object({
  motivo: z.string().trim().min(1, "El motivo es obligatorio"),
  confirmar: z.literal(true, { errorMap: () => ({ message: "Debe confirmar la baja" }) }),
});
export type BajaCuentaWebInput = z.infer<typeof BajaCuentaWebSchema>;

export const ValidarVinculacionSchema = z.discriminatedUnion("email_reconocido", [
  z.object({ email_reconocido: z.literal(true) }).strict(),
  z.object({ email_reconocido: z.literal(false), email_titular: emailNormalizado }).strict(),
]);
export type ValidarVinculacionInput = z.infer<typeof ValidarVinculacionSchema>;

export const BuscarCuentaPorDniSchema = z.object({
  dni: z.string().regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
});
