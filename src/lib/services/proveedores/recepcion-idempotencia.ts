import { createHash } from "node:crypto";
import type { RegistrarRecepcionInput } from "@/lib/schemas/recepciones.schema";

/**
 * Serialización canónica de la intención funcional de una recepción. No
 * incluye clave, fecha, usuario, IDs generados ni los ítems derivados por el
 * servidor. Una OC confirmada y el depósito elegido definen toda la intención.
 */
export function payloadCanonicoRecepcion(
  ordenCompraId: string,
  input: RegistrarRecepcionInput,
): string {
  return JSON.stringify({
    orden_compra_id: ordenCompraId,
    deposito_destino_id: input.deposito_destino_id,
  });
}

export function calcularPayloadHashRecepcion(
  ordenCompraId: string,
  input: RegistrarRecepcionInput,
): string {
  return createHash("sha256").update(payloadCanonicoRecepcion(ordenCompraId, input)).digest("hex");
}
