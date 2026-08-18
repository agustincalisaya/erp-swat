/**
 * @module auth.schema
 * @description Contratos Zod del flujo de autenticación (HU-3, spec_modulo_D.md §2).
 * Separado de `auditoria.schema.ts` porque login/logout son flujo de
 * autenticación, no gestión de usuarios.
 */
import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "La contraseña es obligatoria"),
});
export type LoginInput = z.infer<typeof LoginSchema>;
