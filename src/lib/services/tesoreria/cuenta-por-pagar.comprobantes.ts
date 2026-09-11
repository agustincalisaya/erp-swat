/**
 * @module cuenta-por-pagar.comprobantes
 * @description HU-G10 — helper puro (sin `server-only`, sin I/O) que valida el
 * conjunto de `ComprobanteProveedor` que un pago pretende imputar a una
 * `CuentaPorPagar`. Devuelve un detalle por cada id que NO se puede imputar,
 * con un CÓDIGO de motivo (nunca texto humano — el mensaje lo arma la capa
 * HTTP). Los ids válidos se omiten del resultado.
 *
 * Vive separado de `cuenta-por-pagar.service.ts` (que tiene `server-only`)
 * para poder testearlo con `node --test` sin cargar Prisma.
 */

export type MotivoComprobanteInvalido =
  | "NINGUNO_ENVIADO"
  | "ANULADO"
  | "DE_OTRA_OC"
  | "INEXISTENTE"
  | "YA_IMPUTADO";

export interface DetalleComprobanteInvalido {
  id: string;
  motivo: MotivoComprobanteInvalido;
}

interface ComprobanteEncontrado {
  id: string;
  orden_compra_id: string;
  is_active: boolean;
}

/**
 * @param idsSolicitados       ids que el pago quiere imputar (del body ya parseado).
 * @param encontrados          filas realmente halladas en `comprobantes_proveedor`
 *                             (SIN filtro `is_active`, para distinguir ANULADO de INEXISTENTE).
 * @param ordenCompraId        OC a la que pertenece la CuentaPorPagar que se paga.
 * @param idsYaImputadosEnOtrosPagos  ids ya imputados a otra CuentaPorPagar PAGADA.
 * @returns un `DetalleComprobanteInvalido` por id inválido; `[]` si todos son válidos.
 *
 * Precedencia cuando varios motivos aplican: INEXISTENTE > DE_OTRA_OC > ANULADO
 * > YA_IMPUTADO.
 */
export function validarComprobantesDePago(
  idsSolicitados: readonly string[],
  encontrados: readonly ComprobanteEncontrado[],
  ordenCompraId: string,
  idsYaImputadosEnOtrosPagos: ReadonlySet<string>,
): DetalleComprobanteInvalido[] {
  if (idsSolicitados.length === 0) {
    return [{ id: "", motivo: "NINGUNO_ENVIADO" }];
  }

  const porId = new Map(encontrados.map((c) => [c.id, c]));
  const detalles: DetalleComprobanteInvalido[] = [];

  for (const id of idsSolicitados) {
    const comprobante = porId.get(id);

    if (!comprobante) {
      detalles.push({ id, motivo: "INEXISTENTE" });
      continue;
    }
    if (comprobante.orden_compra_id !== ordenCompraId) {
      detalles.push({ id, motivo: "DE_OTRA_OC" });
      continue;
    }
    if (!comprobante.is_active) {
      detalles.push({ id, motivo: "ANULADO" });
      continue;
    }
    if (idsYaImputadosEnOtrosPagos.has(id)) {
      detalles.push({ id, motivo: "YA_IMPUTADO" });
      continue;
    }
  }

  return detalles;
}
