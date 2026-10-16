import { z } from "zod";

/** Mismo rango de años que validarAnioMes; no coerción de formatos ambiguos. */
export const MesLibroIvaSchema = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/, "Seleccioná un mes válido (AAAA-MM).");
export const ConsultaLibroIvaSchema = z.object({ mes: MesLibroIvaSchema, formato: z.enum(["txt", "pdf", "json"]).optional() }).strict();
