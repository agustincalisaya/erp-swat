import { Prisma, type TipoComprobante, type TipoComprobanteVenta } from "@prisma/client";
import { numeroFiscalVisible } from "../ecommerce/pdf-marca.ts";
import { ROTULO_LIBRO_IVA, type TipoLibroIva } from "./libro-iva.constants.ts";
export type { TipoLibroIva } from "./libro-iva.constants.ts";

/** Motivos constantes: jamás incorporar valores de origen a diagnósticos. */
export class DatoLibroIvaInvalido extends Error {
  readonly motivo: string;
  constructor(motivo: string) {
    super(motivo);
    this.name = "DatoLibroIvaInvalido";
    this.motivo = motivo;
  }
}

const invalidar = (motivo: string): never => { throw new DatoLibroIvaInvalido(motivo); };

export function numeroCompra(valor: string): { pv: string; numero: string } {
  // Rechazar saltos incluso en los extremos: trim no debe ocultarlos.
  if (/[\r\n]/.test(valor)) invalidar("NUMERO_COMPRA_INVALIDO");
  const texto = valor.trim();
  const separado = /^(\d{1,5})[ \t]*-[ \t]*(\d{1,8})$/.exec(texto);
  const solo = /^\d{1,8}$/.test(texto);
  if (!separado && !solo) invalidar("NUMERO_COMPRA_INVALIDO");
  const pv = separado ? separado[1]! : "1";
  const numero = separado ? separado[2]! : texto;
  if (/^0+$/.test(pv) || /^0+$/.test(numero)) invalidar("NUMERO_COMPRA_CERO");
  return { pv: pv.padStart(5, "0"), numero: numero.padStart(8, "0") };
}

export function cuitLibro(valor: string): string {
  if (/^\d{11}$/.test(valor)) return valor;
  if (/^\d{2}-\d{8}-\d$/.test(valor)) return valor.replace(/-/g, "");
  return invalidar("CUIT_PROVEEDOR_INVALIDO");
}

export function numeroVentaLibro(valor: string): { pv: string; numero: string } {
  const visible = numeroFiscalVisible(valor);
  if (!visible) invalidar("NUMERO_VENTA_INVALIDO");
  const [pv, numero] = visible!.split("-");
  return { pv: pv!, numero: numero! };
}

export function contraparteVenta(cliente: { dni: string; nombre: string } | null) {
  if (!cliente) return { tipo_doc: "99", numero_doc: "0", denominacion: "Consumidor final" };
  if (!/^\d{7,8}$/.test(cliente.dni)) invalidar("DNI_CLIENTE_INVALIDO");
  return { tipo_doc: "96", numero_doc: cliente.dni, denominacion: cliente.nombre };
}

export function codigoVenta(tipo: TipoComprobanteVenta, original?: TipoComprobanteVenta | null): string {
  switch (tipo) {
    case "FACTURA_A": return "001";
    case "FACTURA_B": return "006";
    case "TICKET": return "083";
    case "NOTA_CREDITO":
      if (original === "FACTURA_A") return "003";
      if (original === "FACTURA_B") return "008";
      return invalidar("ORIGINAL_NC_SIN_CODIGO");
    default: return invalidar("TIPO_COMPROBANTE_INVALIDO");
  }
}

export function codigoCompra(tipo: TipoComprobante): string {
  switch (tipo) {
    case "FACTURA_A": return "001";
    case "FACTURA_B": return "006";
    case "FACTURA_C": return "011";
    case "FACTURA_M": return "051";
    default: return invalidar("TIPO_COMPROBANTE_INVALIDO");
  }
}

export function importesLibro(total: Prisma.Decimal | string, esNC = false) {
  let monto: Prisma.Decimal;
  try { monto = new Prisma.Decimal(total); } catch { return invalidar("IMPORTE_INVALIDO"); }
  if (!monto.isFinite() || (monto.isNegative() && !monto.isZero()) || monto.decimalPlaces() > 2) {
    invalidar("IMPORTE_INVALIDO");
  }
  const neto = monto.div("1.21").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const iva = monto.minus(neto);
  const formatear = (valor: Prisma.Decimal) => valor.isZero() ? "0.00" : (esNC ? valor.negated() : valor).toFixed(2);
  return { total: formatear(monto), neto: formatear(neto), iva: formatear(iva) };
}

export interface FilaLibroIva {
  fecha: string;
  tipo: string;
  pv: string;
  numero: string;
  tipo_doc: string;
  numero_doc: string;
  denominacion: string;
  total: string;
  neto: string;
  iva: string;
}

export function serializarLibro(filas: FilaLibroIva[]): string {
  return filas.map((f) => [f.fecha, f.tipo, f.pv, f.numero, f.tipo_doc, f.numero_doc,
    f.denominacion.replace(/[;\r\n]/g, " ").trim(), f.total, f.neto, f.iva, "21.00"].join(";") + "\n").join("");
}

export function nombreArchivoLibro(tipo: TipoLibroIva, periodo: string, formato: "txt" | "pdf" = "txt") {
  const libro = tipo.toLowerCase();
  return {
    visible: `${ROTULO_LIBRO_IVA} - ${libro} - ${periodo}.${formato}`,
    ascii: `Libro_IVA_${libro}_${periodo}.${formato}`,
  };
}
