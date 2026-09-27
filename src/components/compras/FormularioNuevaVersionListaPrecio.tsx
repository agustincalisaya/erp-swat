"use client";

/**
 * @component FormularioNuevaVersionListaPrecio
 * @description Alta de una nueva `ListaPrecioVersion` (HU-H2, UI "Lista de
 * Precios"). Flujo en dos pasos:
 *  1. "Calcular variación" → `previsualizarListaPreciosAction` (NO persiste
 *     nada): muestra la variación % por ítem, resalta los que superan el
 *     umbral y advierte que la versión quedará pendiente de aprobación del
 *     Supervisor de Compras ANTES de confirmar.
 *  2. "Confirmar publicación" → `publicarListaPrecios` (Server Action ya
 *     existente, T8/T9). Si `requiere_aprobacion` viene `true`, se muestra
 *     como un estado de resultado normal ("Pendiente de aprobación del
 *     Supervisor de Compras"), NO como un error.
 *
 * Row keys: `useId()` + índice de fila para `id`/`htmlFor` (NO
 * `crypto.randomUUID()` — causó hydration mismatches antes en los 2
 * formularios de HU-H3, ver `key` de fila abajo que SÍ puede usar
 * `crypto.randomUUID()` porque React `key` nunca se renderiza al DOM).
 */

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Calculator, Send, AlertTriangle, CheckCircle2, Info } from "lucide-react";

import {
  previsualizarListaPreciosAction,
  publicarListaPrecios,
} from "@/app/(dashboard)/compras/listas-precios/actions";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { VarianteParaSelector } from "@/lib/services/proveedores/orden-compra.service";
import type {
  PreviewListaPreciosResultado,
  VarianteConPrecioVigente,
} from "@/lib/services/proveedores/lista-precios.service";
import { diaNegocioIso } from "@/lib/utils/fecha-negocio";

interface FormularioNuevaVersionListaPrecioProps {
  proveedorId: string;
  variantes: VarianteParaSelector[];
  /**
   * Variantes que HOY tienen precio vigente para este proveedor (A3,
   * auditoría transversal Módulo H, 2026-09-26) — se usa exclusivamente para
   * avisar en el paso de confirmación cuáles quedan afuera de esta nueva
   * versión (ver aviso más abajo), nunca para precargar el formulario.
   */
  variantesVigentes: VarianteConPrecioVigente[];
}

interface ItemFila {
  key: string;
  variante_sku_id: string;
  precio: string;
}

function nuevaFila(): ItemFila {
  return { key: crypto.randomUUID(), variante_sku_id: "", precio: "" };
}

/**
 * A1 (auditoría transversal Módulo H, 2026-09-26): antes derivaba "hoy" con
 * `new Date().toISOString().slice(0, 10)` (UTC) — desde las 21:00 hora
 * Argentina eso ya era "mañana", y el backend rechazaba la fecha propuesta
 * por defecto. Ahora usa el mismo criterio de "día de negocio" que el
 * validador del schema (`esFechaSoloAnteriorAHoyNegocio`,
 * `src/lib/utils/fecha-negocio.ts`).
 */
function hoyISO(): string {
  return diaNegocioIso();
}

export function FormularioNuevaVersionListaPrecio({
  proveedorId,
  variantes,
  variantesVigentes,
}: FormularioNuevaVersionListaPrecioProps) {
  const router = useRouter();
  const formId = useId();
  const [isPending, startTransition] = useTransition();

  const [fechaInicioVigencia, setFechaInicioVigencia] = useState(hoyISO());
  const [items, setItems] = useState<ItemFila[]>(() => [nuevaFila()]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewListaPreciosResultado | null>(null);
  const [resultado, setResultado] = useState<
    { requiere_aprobacion: boolean } | null
  >(null);

  const skuPorId = useMemo(
    () => new Map(variantes.map((v) => [v.id, v.sku])),
    [variantes],
  );
  const varianteSkuIdsSeleccionados = new Set(
    items.filter((f) => f.variante_sku_id).map((f) => f.variante_sku_id),
  );

  // A3 (auditoría transversal Módulo H, 2026-09-26): una versión nueva es un
  // DELTA sobre la vigente, no un reemplazo total — las variantes vigentes
  // que esta versión no incluye NO pierden su precio, siguen vigentes desde
  // su versión anterior (`resolverListaPrecioVigente` resuelve por variante).
  // Antes esto confundía al usuario ("¿se quedan sin precio?"); ahora se
  // avisa explícitamente que es intencional.
  const variantesOmitidas = variantesVigentes.filter(
    (v) => !varianteSkuIdsSeleccionados.has(v.variante_sku_id),
  );

  const setFila = (key: string, cambios: Partial<ItemFila>) => {
    setPreview(null);
    setResultado(null);
    setItems((prev) => prev.map((f) => (f.key === key ? { ...f, ...cambios } : f)));
  };
  const agregarFila = () => {
    setPreview(null);
    setItems((prev) => [...prev, nuevaFila()]);
  };
  const quitarFila = (key: string) => {
    setPreview(null);
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));
  };

  const filasValidas = () => {
    const cargadas = items.filter((f) => f.variante_sku_id && f.precio);
    if (cargadas.length === 0) {
      setError("Agregá al menos un ítem con variante y precio.");
      return null;
    }
    for (const fila of cargadas) {
      const precio = Number(fila.precio);
      if (!Number.isFinite(precio) || precio <= 0) {
        setError(`El precio de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe ser mayor a 0.`);
        return null;
      }
    }
    const ids = cargadas.map((f) => f.variante_sku_id);
    if (new Set(ids).size !== ids.length) {
      setError("Hay una variante repetida. Cada variante puede tener un único precio en esta versión.");
      return null;
    }
    return cargadas.map((f) => ({
      variante_sku_id: f.variante_sku_id,
      precio_unitario: Number(f.precio),
    }));
  };

  const calcularVariacion = () => {
    setError(null);
    setResultado(null);
    const itemsPayload = filasValidas();
    if (!itemsPayload) return;

    startTransition(async () => {
      const res = await previsualizarListaPreciosAction(proveedorId, { items: itemsPayload });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setPreview(res.data);
    });
  };

  const confirmarPublicacion = () => {
    setError(null);
    const itemsPayload = filasValidas();
    if (!itemsPayload) return;

    startTransition(async () => {
      const res = await publicarListaPrecios(proveedorId, {
        fecha_inicio_vigencia: fechaInicioVigencia,
        items: itemsPayload,
      });
      if (res.error) {
        if (res.error.code === "FECHA_DUPLICADA") {
          setError("Ya existe una versión con esa fecha de vigencia para este proveedor. Elegí otra fecha.");
          return;
        }
        setError(res.error.message);
        return;
      }
      setResultado({ requiere_aprobacion: res.data.requiere_aprobacion });
      setPreview(null);
      setItems([nuevaFila()]);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {resultado && (
        <Alert className={resultado.requiere_aprobacion ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}>
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <AlertDescription>
            {resultado.requiere_aprobacion
              ? "Versión publicada. Pendiente de aprobación del Supervisor de Compras (superó el umbral de variación crítica)."
              : "Versión publicada y vigente desde la fecha indicada."}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-fecha`} className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Fecha de inicio de vigencia
        </Label>
        <Input
          id={`${formId}-fecha`}
          type="date"
          min={hoyISO()}
          value={fechaInicioVigencia}
          onChange={(e) => {
            setFechaInicioVigencia(e.target.value);
            setPreview(null);
            setResultado(null);
          }}
          className="max-w-xs"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Ítems de la nueva versión
          </Label>
          <Button type="button" variant="outline" size="sm" onClick={agregarFila} className="gap-1.5">
            <Plus className="size-3.5" />
            Agregar ítem
          </Button>
        </div>

        <div className="space-y-2">
          {items.map((fila, indice) => {
            const varId = `${formId}-var-${indice}`;
            const precioId = `${formId}-precio-${indice}`;
            const variantesDisponibles = variantes.filter(
              (v) => v.id === fila.variante_sku_id || !varianteSkuIdsSeleccionados.has(v.id),
            );
            const itemPreview = preview?.items.find((i) => i.variante_sku_id === fila.variante_sku_id);
            const superaUmbral =
              itemPreview?.variacion_porcentual !== null &&
              itemPreview?.variacion_porcentual !== undefined &&
              preview !== null &&
              Math.abs(itemPreview.variacion_porcentual) > preview.umbral;

            return (
              <div
                key={fila.key}
                className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end ${
                  superaUmbral ? "border-amber-300 bg-amber-50" : "border-border bg-muted/20"
                }`}
              >
                <div className="flex-1 space-y-1">
                  <Label htmlFor={varId} className="text-xs">
                    Variante
                  </Label>
                  <ComboboxFiltrable
                    id={varId}
                    items={variantesDisponibles}
                    getId={(v) => v.id}
                    getLabel={(v) => `${v.sku} — ${v.descripcion}`}
                    value={fila.variante_sku_id}
                    onChange={(v) => setFila(fila.key, { variante_sku_id: v.id })}
                    placeholder="Buscar SKU o producto…"
                    emptyMessage="Sin coincidencias."
                    pageSize={8}
                  />
                </div>
                <div className="w-full space-y-1 sm:w-36">
                  <Label htmlFor={precioId} className="text-xs">
                    Precio unitario
                  </Label>
                  <Input
                    id={precioId}
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={fila.precio}
                    onChange={(e) => setFila(fila.key, { precio: e.target.value })}
                    className="text-sm"
                  />
                </div>
                {itemPreview && (
                  <div className="w-full sm:w-28 text-xs">
                    <span className="block text-muted-foreground">Variación</span>
                    <span className={superaUmbral ? "font-semibold text-amber-700" : ""}>
                      {itemPreview.variacion_porcentual === null
                        ? "sin precio previo"
                        : `${itemPreview.variacion_porcentual.toFixed(2)}%`}
                    </span>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => quitarFila(fila.key)}
                  disabled={items.length === 1}
                  aria-label="Quitar ítem"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {varianteSkuIdsSeleccionados.size > 0 && variantesOmitidas.length > 0 && (
        <Alert className="border-blue-200 bg-blue-50">
          <Info className="size-4 text-blue-600" aria-hidden="true" />
          <AlertDescription>
            Esta versión no incluye {variantesOmitidas.length === 1 ? "1 variante" : `${variantesOmitidas.length} variantes`} que
            hoy {variantesOmitidas.length === 1 ? "tiene" : "tienen"} precio vigente:{" "}
            {variantesOmitidas.map((v) => skuPorId.get(v.variante_sku_id) ?? v.variante_sku_id).join(", ")}.{" "}
            Al publicar, {variantesOmitidas.length === 1 ? "esa variante seguirá" : "esas variantes seguirán"} vigente
            {variantesOmitidas.length === 1 ? "" : "s"} desde su versión anterior — <strong>no van a perder su precio</strong>,
            esta versión es un agregado/actualización parcial, no un reemplazo completo de la lista.
          </AlertDescription>
        </Alert>
      )}

      {preview && preview.requiere_aprobacion && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
          <AlertDescription>
            La variación máxima calculada ({preview.variacion_porcentual_maxima.toFixed(2)}%) supera el
            umbral de {preview.umbral}%. Si confirmás, la versión se publicará como{" "}
            <strong>pendiente de aprobación del Supervisor de Compras</strong> y no quedará vigente hasta
            que se apruebe.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={calcularVariacion}
          disabled={isPending}
          className="gap-2"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
          Calcular variación
        </Button>
        <Button
          type="button"
          onClick={confirmarPublicacion}
          disabled={isPending}
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Confirmar publicación
        </Button>
      </div>
    </div>
  );
}
