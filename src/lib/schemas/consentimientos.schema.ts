import { z } from "zod";

export const RegularizarConsentimientoSchema = z.object({
  alcance: z.enum(["VENTA_ASISTIDA", "COMUNICACIONES_COMERCIALES"]),
  decision: z.enum(["ACEPTA", "RECHAZA"]),
}).strict().refine(
  (value) => value.alcance !== "VENTA_ASISTIDA" || value.decision === "ACEPTA",
  { message: "El tratamiento solo admite aceptación expresa", path: ["decision"] },
);

export const ClienteIdConsentimientoSchema = z.string().uuid();
export type RegularizarConsentimientoInput = z.infer<typeof RegularizarConsentimientoSchema>;

const id = z.string().uuid();
const motivoOpcional = z.string().trim().min(1).max(1000).optional();

/** Los IDs son precondiciones de concurrencia, nunca fuentes de autoridad. */
export const TransicionConsentimientoSchema = z.discriminatedUnion("operacion", [
  z.object({
    operacion: z.literal("REVOCAR_COMERCIAL"),
    alcance: z.literal("COMUNICACIONES_COMERCIALES"),
    consentimiento_id: id,
    motivo: motivoOpcional,
  }).strict(),
  z.object({
    operacion: z.literal("SOLICITAR_REVOCACION"),
    alcance: z.literal("VENTA_ASISTIDA"),
    consentimiento_id: id,
    motivo: motivoOpcional,
  }).strict(),
  z.object({
    operacion: z.literal("EJECUTAR_REVOCACION"),
    alcance: z.literal("VENTA_ASISTIDA"),
    consentimiento_id: id,
    solicitud_evento_id: id,
    motivo: motivoOpcional,
  }).strict(),
  z.object({
    operacion: z.literal("RECHAZAR_SOLICITUD"),
    alcance: z.literal("VENTA_ASISTIDA"),
    consentimiento_id: id,
    solicitud_evento_id: id,
    motivo: z.string().trim().min(1).max(1000),
  }).strict(),
  z.object({
    operacion: z.literal("NUEVA_ACEPTACION"),
    alcance: z.enum(["VENTA_ASISTIDA", "COMUNICACIONES_COMERCIALES"]),
    revocacion_evento_id: id,
    aceptacion_expresa: z.literal(true),
  }).strict(),
]);
export type TransicionConsentimientoInput = z.infer<typeof TransicionConsentimientoSchema>;
