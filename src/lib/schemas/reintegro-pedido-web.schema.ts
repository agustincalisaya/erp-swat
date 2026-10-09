import { z } from "zod";

export const PedidoVentaReintegroIdSchema = z.string().uuid("El identificador del pedido debe ser un UUID válido");

export const CancelarPedidoPagadoSchema = z.object({
  motivo: z.string().trim().min(1, "El motivo es obligatorio"),
}).strict();

export const ReintentarRefundSchema = z.object({
  motivo: z.string().trim().min(1, "El motivo es obligatorio"),
}).strict();
