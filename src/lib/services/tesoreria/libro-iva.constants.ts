export const PERMISO_EXPORTAR_LIBRO_IVA = "tesoreria:exportar_libro_iva";
export const ROTULO_LIBRO_IVA = "Libro de IVA";
export type TipoLibroIva = "VENTAS" | "COMPRAS";

export interface FilaLibroIvaVista {
  id: string; fecha: string; tipo: string; pv: string; numero: string;
  tipo_doc: string; numero_doc: string; denominacion: string;
  total: string; neto: string; iva: string;
}
export interface LibroIvaVista {
  tipo: TipoLibroIva;
  periodo: string;
  filas: FilaLibroIvaVista[];
  totales: { comprobantes: number; notas_credito: number; neto: string; iva: string; total: string };
}
