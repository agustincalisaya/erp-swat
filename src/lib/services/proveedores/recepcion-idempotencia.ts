import { createHash } from "node:crypto";
import type { RegistrarRecepcionInput } from "@/lib/schemas/recepciones.schema";

function compararTextoBinario(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Serialización canónica de la intención funcional de una recepción. No
 * incluye fecha, usuario ni IDs generados por el servidor. Los arrays se
 * ordenan para que un retry semánticamente idéntico produzca el mismo hash.
 */
export function payloadCanonicoRecepcion(
  ordenCompraId: string,
  input: RegistrarRecepcionInput,
): string {
  const items = input.items
    .map((item) => ({
      orden_compra_item_id: item.orden_compra_item_id,
      cantidad_recibida: item.cantidad_recibida,
      cantidad_aceptada: item.cantidad_aceptada,
      discrepancias: [...item.discrepancias]
        .map((d) => ({ tipo: d.tipo, detalle: d.detalle }))
        .sort((a, b) => compararTextoBinario(
          `${a.tipo}\u0000${a.detalle}`,
          `${b.tipo}\u0000${b.detalle}`,
        )),
    }))
    .sort((a, b) => compararTextoBinario(a.orden_compra_item_id, b.orden_compra_item_id));

  return JSON.stringify({
    orden_compra_id: ordenCompraId,
    deposito_destino_id: input.deposito_destino_id,
    numero_remito_proveedor: input.numero_remito_proveedor ?? null,
    observaciones: input.observaciones ?? null,
    items,
  });
}

export function calcularPayloadHashRecepcion(
  ordenCompraId: string,
  input: RegistrarRecepcionInput,
): string {
  return createHash("sha256").update(payloadCanonicoRecepcion(ordenCompraId, input)).digest("hex");
}
