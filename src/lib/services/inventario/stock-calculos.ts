/** Función pura compartida por el servicio y sus pruebas de invariantes. */
export function calcularResumenStock(disponible: number, enTransito: number) {
  if (!Number.isInteger(disponible) || !Number.isInteger(enTransito) || disponible < 0 || enTransito < 0) {
    throw new RangeError("Las cantidades de stock deben ser enteros no negativos");
  }
  return { disponible, en_transito: enTransito, total_fisico: disponible + enTransito };
}
