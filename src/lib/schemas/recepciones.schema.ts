import { z } from "zod";

export const TIPOS_DISCREPANCIA_RECEPCION = [
  "CANTIDAD",
  "TALLE",
  "COLOR",
  "CALIDAD",
] as const;

const DiscrepanciaRecepcionSchema = z.object({
  tipo: z.enum(TIPOS_DISCREPANCIA_RECEPCION),
  detalle: z
    .string()
    .trim()
    .min(1, "El detalle de la discrepancia es obligatorio")
    .max(500)
    .transform((valor) => valor.normalize("NFC")),
});

const TextoOpcionalNormalizadoSchema = (maximo: number) => z
  .string()
  .trim()
  .max(maximo)
  .transform((valor) => {
    const normalizado = valor.normalize("NFC");
    return normalizado.length === 0 ? undefined : normalizado;
  })
  .optional();

const ItemRecepcionSchema = z
  .object({
    orden_compra_item_id: z.string().uuid(),
    cantidad_recibida: z.number().int().positive("La cantidad recibida debe ser mayor a 0"),
    cantidad_aceptada: z.number().int().min(0, "La cantidad aceptada no puede ser negativa"),
    discrepancias: z.array(DiscrepanciaRecepcionSchema).default([]),
  })
  .refine((item) => item.cantidad_aceptada <= item.cantidad_recibida, {
    message: "La cantidad aceptada no puede superar la cantidad recibida",
    path: ["cantidad_aceptada"],
  })
  .refine(
    (item) => item.cantidad_aceptada === item.cantidad_recibida || item.discrepancias.length > 0,
    {
      message: "Documentá al menos una discrepancia cuando la cantidad aceptada sea menor a la recibida",
      path: ["discrepancias"],
    },
  );

export const RegistrarRecepcionSchema = z
  .object({
    deposito_destino_id: z.string().uuid("Seleccioná un depósito destino"),
    clave_idempotencia: z.string().uuid("La clave de idempotencia debe ser un UUID válido"),
    numero_remito_proveedor: TextoOpcionalNormalizadoSchema(100),
    observaciones: TextoOpcionalNormalizadoSchema(1000),
    items: z.array(ItemRecepcionSchema).min(1, "La recepción debe incluir al menos un ítem"),
  })
  .superRefine((input, ctx) => {
    const ids = new Set<string>();
    input.items.forEach((item, index) => {
      if (ids.has(item.orden_compra_item_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "No se puede repetir un ítem de la orden en la misma recepción",
          path: ["items", index, "orden_compra_item_id"],
        });
      }
      ids.add(item.orden_compra_item_id);
    });
  });

export type RegistrarRecepcionInput = z.infer<typeof RegistrarRecepcionSchema>;
