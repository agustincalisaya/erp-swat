/**
 * Schemas Zod de Módulo E — E-commerce / Tienda Online (spec_modulo_E.md).
 */
import { z } from "zod";

/**
 * HU-E8 §2.8 — login de Cliente Web.
 * TODO(HU-E8): introducido por HU-E1 como parte del mínimo provisional de
 * sesión (`lib/auth/sesion-cliente-web.ts`); el owner de HU-E8 lo completa.
 */
export const IniciarSesionClienteWebSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type IniciarSesionClienteWebInput = z.infer<typeof IniciarSesionClienteWebSchema>;
