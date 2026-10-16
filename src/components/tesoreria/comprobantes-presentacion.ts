/**
 * @module comprobantes-presentacion
 * @description HU-G3 (spec_modulo_G.md §9.5) — presentación compartida por el
 * listado (`TablaComprobantes`) y la vista de detalle
 * (`/tesoreria/comprobantes/[id]`): etiquetas, formato del total y armado de
 * los links NC ↔ original (G3-4) y del PDF (G3-3).
 *
 * Sin dependencias en runtime (solo `import type`): el test de la vista de
 * detalle carga este módulo aislado.
 *
 * Los links al detalle y "Volver al listado" arrastran solo los parámetros
 * conocidos del listado, para conservar filtros y página sin reenviar
 * parámetros arbitrarios.
 */
import type { CanalVenta, TipoComprobanteVenta } from "@prisma/client";
import type { ComprobanteResumen } from "@/lib/services/tesoreria/comprobantes-repositorio.service";

export const RUTA_COMPROBANTES = "/tesoreria/comprobantes";

export const ETIQUETAS_TIPO_COMPROBANTE: Record<TipoComprobanteVenta, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  TICKET: "Ticket",
  NOTA_CREDITO: "Nota de Crédito",
};

export const ETIQUETAS_CANAL_COMPROBANTE: Record<CanalVenta, string> = { MOSTRADOR: "Mostrador", WEB: "Web" };

const monedaAR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

/**
 * `monto_total` llega como string de dos decimales y se formatea sin pasar
 * por `number`. La NC se guarda en positivo: el signo lo pone la presentación.
 */
export function formatearTotalComprobante(c: Pick<ComprobanteResumen, "tipo_comprobante" | "monto_total">): string {
  const monto = monedaAR.format(c.monto_total as Intl.StringNumericLiteral);
  return c.tipo_comprobante === "NOTA_CREDITO" ? `− ${monto}` : monto;
}

/** Parámetros del listado que se conservan al ir y volver del detalle. */
const CLAVES_LISTADO = ["cliente", "fecha_desde", "fecha_hasta", "tipo", "canal", "page", "page_size"] as const;

type ParametrosUrl = URLSearchParams | Record<string, string | string[] | undefined>;

/** Query string (sin `?`) con solo los parámetros conocidos y no vacíos del listado. */
export function queryListadoComprobantes(parametros: ParametrosUrl): string {
  const leer = (clave: string) => {
    if (parametros instanceof URLSearchParams) return parametros.get(clave) ?? undefined;
    const valor = parametros[clave];
    return Array.isArray(valor) ? valor[0] : valor;
  };
  const query = new URLSearchParams();
  for (const clave of CLAVES_LISTADO) {
    const valor = leer(clave)?.trim();
    if (valor) query.set(clave, valor);
  }
  return query.toString();
}

const conQuery = (ruta: string, query: string) => (query ? `${ruta}?${query}` : ruta);

export function hrefListadoComprobantes(query = ""): string {
  return conQuery(RUTA_COMPROBANTES, query);
}

export function hrefDetalleComprobante(id: string, query = ""): string {
  return conQuery(`${RUTA_COMPROBANTES}/${encodeURIComponent(id)}`, query);
}

/** `inline` abre el PDF en el navegador; `attachment` (por defecto en la API) lo descarga. */
export function hrefPdfComprobante(id: string, disposicion: "inline" | "attachment"): string {
  const ruta = `/api/tesoreria/comprobantes/${encodeURIComponent(id)}/pdf`;
  return disposicion === "inline" ? `${ruta}?disposicion=inline` : ruta;
}

export interface EnlaceComprobante {
  comprobante_id: string;
  numero: string;
  href: string;
}

/**
 * Links de G3-4 desde `comprobante_original` / `notas_credito`, que el
 * servicio resuelve por `comprobante_original_id` (nunca por el número).
 */
export function enlacesVinculados(
  c: Pick<ComprobanteResumen, "comprobante_original" | "notas_credito">,
  query = "",
): { original: EnlaceComprobante | null; notas_credito: EnlaceComprobante[] } {
  const enlace = ({ comprobante_id, numero }: { comprobante_id: string; numero: string }): EnlaceComprobante => ({
    comprobante_id,
    numero,
    href: hrefDetalleComprobante(comprobante_id, query),
  });
  return {
    original: c.comprobante_original ? enlace(c.comprobante_original) : null,
    notas_credito: c.notas_credito.map(enlace),
  };
}
