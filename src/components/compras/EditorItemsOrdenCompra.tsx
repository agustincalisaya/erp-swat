"use client";

/**
 * @component EditorItemsOrdenCompra
 * @description Edición de los ítems de una Orden de Compra en estado
 * BORRADOR (HU-H3, CA2 del Backlog Sprint 2): agregar, quitar y cambiar
 * cantidad, con un botón de guardar cambios. En cualquier otro estado el
 * detalle muestra la tabla de solo lectura, no este editor.
 *
 * Camino A: el precio **nunca** viaja desde el cliente — se resuelve
 * server-side contra la lista vigente del proveedor al guardar, igual que en
 * el alta. Comparte el patrón de renglones dinámicos con
 * `FormularioNuevaOrdenCompra` (duplicación consciente; si crece, extraer un
 * `<ItemsOrdenCompraFieldset>` compartido).
 *
 * Server Action: `editarItemsOrdenCompraAction` — reemplazo total del set.
 */

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Save, Info, RotateCcw } from "lucide-react";

import { editarItemsOrdenCompraAction } from "@/app/(dashboard)/compras/ordenes/actions";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { VarianteParaSelector } from "@/lib/services/proveedores/orden-compra.service";

interface ItemInicial {
  variante_sku_id: string;
  sku: string;
  cantidad_solicitada: number;
}

interface EditorItemsOrdenCompraProps {
  ordenCompraId: string;
  itemsIniciales: ItemInicial[];
  variantes: VarianteParaSelector[];
}

interface ItemFila {
  key: string;
  variante_sku_id: string;
  cantidad: string;
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function nuevaFila(): ItemFila {
  return { key: crypto.randomUUID(), variante_sku_id: "", cantidad: "1" };
}

function filasDesdeIniciales(items: ItemInicial[]): ItemFila[] {
  return items.map((it) => ({
    key: crypto.randomUUID(),
    variante_sku_id: it.variante_sku_id,
    cantidad: String(it.cantidad_solicitada),
  }));
}

/** Firma canónica para comparar el set actual contra el inicial. */
function firma(filas: { variante_sku_id: string; cantidad: string }[]): string {
  return filas
    .filter((f) => f.variante_sku_id)
    .map((f) => `${f.variante_sku_id}:${Number(f.cantidad)}`)
    .sort()
    .join("|");
}

export function EditorItemsOrdenCompra({
  ordenCompraId,
  itemsIniciales,
  variantes,
}: EditorItemsOrdenCompraProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Prefijo estable entre SSR y cliente para los `id`/`htmlFor` de cada fila.
  // No se usa `fila.key` (un `crypto.randomUUID()`): el initializer de
  // `useState` corre por separado en el servidor y en el cliente y generaría
  // UUIDs distintos → hydration mismatch en los atributos `htmlFor`/`id`.
  // `useId()` se llama una sola vez y se combina con el índice de la fila
  // (patrón recomendado por React para listas).
  const editorId = useId();

  const [items, setItems] = useState<ItemFila[]>(() =>
    itemsIniciales.length > 0 ? filasDesdeIniciales(itemsIniciales) : [nuevaFila()],
  );
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<string | null>(null);

  const skuPorId = useMemo(
    () => new Map(variantes.map((v) => [v.id, v.sku])),
    [variantes],
  );

  const firmaInicial = useMemo(
    () =>
      firma(
        itemsIniciales.map((it) => ({
          variante_sku_id: it.variante_sku_id,
          cantidad: String(it.cantidad_solicitada),
        })),
      ),
    [itemsIniciales],
  );
  const dirty = firma(items) !== firmaInicial;

  const setFila = (key: string, cambios: Partial<ItemFila>) => {
    setItems((prev) =>
      prev.map((fila) => (fila.key === key ? { ...fila, ...cambios } : fila)),
    );
  };
  const agregarFila = () => setItems((prev) => [...prev, nuevaFila()]);
  const quitarFila = (key: string) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));
  const restaurar = () => {
    setItems(
      itemsIniciales.length > 0 ? filasDesdeIniciales(itemsIniciales) : [nuevaFila()],
    );
    setErrorGeneral(null);
    setErrorItems(null);
  };

  const skusDesdeMensaje = (mensaje: string): string => {
    const ids = mensaje.match(UUID_RE) ?? [];
    return ids.map((id) => skuPorId.get(id.toLowerCase()) ?? id).join(", ");
  };

  const validarLocal = (): boolean => {
    setErrorGeneral(null);
    setErrorItems(null);
    const cargadas = items.filter((f) => f.variante_sku_id);
    if (cargadas.length === 0) {
      setErrorItems("La orden debe incluir al menos una variante.");
      return false;
    }
    for (const fila of cargadas) {
      const cantidad = Number(fila.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        setErrorItems(
          `La cantidad de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe ser un entero mayor a 0.`,
        );
        return false;
      }
    }
    const ids = cargadas.map((f) => f.variante_sku_id);
    if (new Set(ids).size !== ids.length) {
      setErrorItems("Hay una variante repetida. Consolidá la cantidad en un solo ítem.");
      return false;
    }
    return true;
  };

  const guardar = () => {
    if (!validarLocal()) return;
    const payload = {
      items: items
        .filter((f) => f.variante_sku_id)
        .map((f) => ({
          variante_sku_id: f.variante_sku_id,
          cantidad_solicitada: Number(f.cantidad),
        })),
    };

    startTransition(async () => {
      const resultado = await editarItemsOrdenCompraAction(ordenCompraId, payload);
      if (resultado.error) {
        const { code, message } = resultado.error;
        if (code === "SKU_SIN_PRECIO_VIGENTE") {
          setErrorItems(
            `Estas variantes no tienen precio en la lista vigente del proveedor: ${skusDesdeMensaje(message)}. Cargá el precio o sacálas de la orden.`,
          );
          return;
        }
        if (code === "SKU_INVALIDO") {
          setErrorItems(
            `Estas variantes no existen o están inactivas: ${skusDesdeMensaje(message)}.`,
          );
          return;
        }
        if (code === "ITEMS_DUPLICADOS") {
          setErrorItems(message);
          return;
        }
        if (code === "ORDEN_ITEMS_BLOQUEADOS") {
          setErrorGeneral(
            `${message}. Recargá la página para ver el estado actual de la orden.`,
          );
          return;
        }
        setErrorGeneral(message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {errorGeneral && (
        <Alert variant="destructive">
          <AlertDescription>{errorGeneral}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Editar ítems (orden en borrador)
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={agregarFila}
          disabled={isPending}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          Agregar ítem
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        El precio unitario se resuelve automáticamente contra la lista de precios
        vigente del proveedor al guardar — no se ingresa acá.
      </p>

      <div className="space-y-2">
        {items.map((fila, indice) => {
          const varId = `${editorId}-var-${indice}`;
          const cantId = `${editorId}-cant-${indice}`;
          return (
          <div
            key={fila.key}
            className="flex flex-col sm:flex-row sm:items-end gap-2 rounded-lg border border-border bg-muted/20 p-3"
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor={varId} className="text-xs">
                Variante
              </Label>
              <ComboboxFiltrable
                id={varId}
                items={variantes}
                getId={(v) => v.id}
                getLabel={(v) => `${v.sku} — ${v.descripcion}`}
                value={fila.variante_sku_id}
                onChange={(v) => {
                  setFila(fila.key, { variante_sku_id: v.id });
                  setErrorItems(null);
                }}
                placeholder="Buscar SKU o producto…"
                emptyMessage="Sin coincidencias."
                pageSize={8}
              />
            </div>
            <div className="w-full sm:w-28 space-y-1">
              <Label htmlFor={cantId} className="text-xs">
                Cantidad
              </Label>
              <Input
                id={cantId}
                type="number"
                min={1}
                step={1}
                value={fila.cantidad}
                onChange={(e) => {
                  setFila(fila.key, { cantidad: e.target.value });
                  setErrorItems(null);
                }}
                className="text-sm"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => quitarFila(fila.key)}
              disabled={items.length === 1 || isPending}
              aria-label="Quitar ítem"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          );
        })}
      </div>

      {errorItems && <p className="text-xs text-destructive">{errorItems}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={restaurar}
            disabled={isPending}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            Descartar cambios
          </Button>
        )}
        <Button
          type="button"
          onClick={guardar}
          disabled={!dirty || isPending}
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Guardando…
            </>
          ) : (
            <>
              <Save className="size-4" />
              Guardar cambios
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
