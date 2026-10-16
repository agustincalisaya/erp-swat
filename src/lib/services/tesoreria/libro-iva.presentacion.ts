const TIPOS: Record<string, string> = {
  "001": "Factura A", "003": "NC A", "006": "Factura B", "008": "NC B",
  "011": "Factura C", "051": "Factura M", "083": "Ticket",
};
export const tipoComprobanteLibro = (codigo: string) => TIPOS[codigo] ?? codigo;
export const fechaLibro = (fecha: string) => `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}`;
export const MESES_LIBRO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"] as const;
export function periodoLibro(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  return `${MESES_LIBRO[mes! - 1]} ${anio}`;
}
/** Formato argentino sin convertir los importes decimales a punto flotante. */
export function monedaLibro(valor: string, simbolo = true): string {
  const [entero, decimales = "00"] = valor.split(".");
  return `${simbolo ? "$ " : ""}${entero!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimales}`;
}
