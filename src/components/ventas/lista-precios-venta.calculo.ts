/**
 * @module lista-precios-venta.calculo
 * @description HU-B9 (frontend) — reglas PURAS de la pantalla
 * `/ventas/lista-precios`: cuándo se exige motivo, qué filas se publican y
 * cómo se arma el payload de `publicarVersionListaPrecioVentaAction`. Sin
 * React, sin `server-only`, sin alias `@/...` — testeable con el runner
 * nativo de Node (mismo patrón que `lista-precio-venta.calculo.ts`).
 *
 * La regla de bajo costo NO se reimplementa: se delega en `validarBajoCosto`
 * del backend, así la UI y el servicio deciden con el mismo criterio.
 */
import { validarBajoCosto } from "../../lib/services/ventas/lista-precio-venta.calculo.ts";

/** Fila de la tabla tal como la arma el RSC (montos ya en `number`). */
export interface FilaListaPrecioVenta {
  variante_sku_id: string;
  sku: string;
  descripcion: string;
  precio_vigente: number | null;
  costo_reposicion: number | null;
  precio_sugerido: number | null;
}

/** Lo que el Supervisor tipeó en una fila (strings crudos de los inputs). */
export interface EdicionFila {
  precio: string;
  motivo: string;
}

/**
 * Margen leído de `ConfiguracionSistema` → `number`, o `null` si el valor no
 * es un número no negativo (mismo criterio que `obtenerSugerenciaPrecio`, que
 * en ese caso lanza `CONFIGURACION_INVALIDA`).
 */
export function parsearMargen(valor: string): number | null {
  if (valor.trim() === "") return null;
  const margen = Number(valor);
  return Number.isFinite(margen) && margen >= 0 ? margen : null;
}

/**
 * Precio tipeado → `number` positivo con a lo sumo 2 decimales (escala de
 * `Decimal(12, 2)`), o `null` si es inválido. Acepta coma decimal.
 */
export function parsearPrecio(texto: string): number | null {
  const normalizado = texto.trim().replace(",", ".");
  if (normalizado === "" || !/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  const precio = Number(normalizado);
  return precio > 0 ? precio : null;
}

/** `true` si el precio tipeado es válido y queda por debajo del costo de reposición. */
export function requiereMotivo(precioTexto: string, costo: number | null): boolean {
  const precio = parsearPrecio(precioTexto);
  if (precio === null) return false;
  return !validarBajoCosto(precio, costo).ok;
}

/**
 * Medianoche de Argentina del día elegido, con offset `-03:00` explícito (no
 * medianoche UTC, que en Argentina son las 21:00 del día anterior).
 * Nota: esto NO resuelve la deuda #16 de la task (el resolver compara por
 * instante, no por día de negocio); solo evita el caso más común del date
 * picker.
 */
export function vigenteDesdeArgentina(diaIso: string): string {
  return `${diaIso}T00:00:00-03:00`;
}

/** Filtro en memoria por SKU o descripción (sin distinguir mayúsculas). */
export function filtrarFilas(
  filas: readonly FilaListaPrecioVenta[],
  busqueda: string,
): FilaListaPrecioVenta[] {
  const texto = busqueda.trim().toLowerCase();
  if (!texto) return [...filas];
  return filas.filter(
    (fila) =>
      fila.sku.toLowerCase().includes(texto) || fila.descripcion.toLowerCase().includes(texto),
  );
}

export type ErrorFila = "PRECIO_INVALIDO" | "MOTIVO_REQUERIDO";

export interface PayloadVersion {
  vigente_desde: string;
  items: { variante_sku_id: string; precio_venta: number; motivo_bajo_costo?: string }[];
}

export type ResultadoPayload =
  | { ok: true; payload: PayloadVersion; items_bajo_costo: number }
  | {
      ok: false;
      errores_fila: Map<string, ErrorFila>;
      error_general: "SIN_ITEMS" | "FECHA_INVALIDA" | null;
    };

/**
 * Arma el payload de la versión nueva. Solo viajan las filas con precio
 * cargado: el resolver es por SKU, así que las variantes que no se incluyen
 * mantienen su precio vigente. El motivo solo se envía si el precio queda
 * por debajo del costo.
 *
 * @param hoyIso - día de negocio actual (`diaNegocioIso()`), mínimo permitido.
 */
export function construirPayloadVersion(
  filas: readonly FilaListaPrecioVenta[],
  ediciones: ReadonlyMap<string, EdicionFila>,
  vigenteDesdeDia: string,
  hoyIso: string,
): ResultadoPayload {
  const errores_fila = new Map<string, ErrorFila>();
  const items: PayloadVersion["items"] = [];
  let items_bajo_costo = 0;

  for (const fila of filas) {
    const edicion = ediciones.get(fila.variante_sku_id);
    if (!edicion || edicion.precio.trim() === "") continue;

    const precio = parsearPrecio(edicion.precio);
    if (precio === null) {
      errores_fila.set(fila.variante_sku_id, "PRECIO_INVALIDO");
      continue;
    }
    const validacion = validarBajoCosto(precio, fila.costo_reposicion, edicion.motivo);
    if (!validacion.ok) {
      errores_fila.set(fila.variante_sku_id, "MOTIVO_REQUERIDO");
      continue;
    }
    if (validacion.confirmado_bajo_costo) items_bajo_costo++;
    items.push({
      variante_sku_id: fila.variante_sku_id,
      precio_venta: precio,
      ...(validacion.confirmado_bajo_costo ? { motivo_bajo_costo: edicion.motivo.trim() } : {}),
    });
  }

  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(vigenteDesdeDia) && vigenteDesdeDia >= hoyIso;

  if (errores_fila.size > 0 || items.length === 0 || !fechaValida) {
    return {
      ok: false,
      errores_fila,
      error_general: !fechaValida ? "FECHA_INVALIDA" : items.length === 0 && errores_fila.size === 0 ? "SIN_ITEMS" : null,
    };
  }

  return {
    ok: true,
    payload: { vigente_desde: vigenteDesdeArgentina(vigenteDesdeDia), items },
    items_bajo_costo,
  };
}
