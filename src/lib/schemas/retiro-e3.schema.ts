import { z } from "zod";

/** Cuerpo de POST /api/ecommerce/preparacion/validar-retiro (HU-E3). */
export const ValidarRetiroSchema = z
  .object({
    qr_token: z
      .string({ required_error: "El QR es obligatorio", invalid_type_error: "El QR debe ser texto" })
      .trim()
      .min(1, "El QR no puede estar vacío")
      .max(128, "El QR no puede superar 128 caracteres"),
    dni: z
      .string({ required_error: "El DNI es obligatorio", invalid_type_error: "El DNI debe ser texto" })
      .trim()
      .regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
  })
  .strict();

export type ValidarRetiroInput = z.infer<typeof ValidarRetiroSchema>;
