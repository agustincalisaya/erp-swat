"use client";

/**
 * @component FormularioNuevaOrdenCompra
 * @description Alta de una Orden de Compra en estado BORRADOR (HU-H3, spec
 * §2.4). Conecta con la Server Action `crearOrdenCompraAction` — wrapper
 * fino sobre `orden-compra.service.ts`, la lógica de negocio no vive acá.
 *
 * Camino A: el formulario **nunca** captura ni envía `precio_unitario`. El
 * servicio lo congela contra la `ListaPrecioVersion` vigente del proveedor.
 * El único selector de proveedor ofrece exclusivamente proveedores
 * HOMOLOGADOS (filtrado en el query del RSC padre, no solo visual).
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, PackagePlus, Info } from "lucide-react";

import { crearOrdenCompraAction } from "@/app/(dashboard)/compras/ordenes/actions";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  ProveedorParaSelector,
  VarianteParaSelector,
} from "@/lib/services/proveedores/orden-compra.service";

interface FormularioNuevaOrdenCompraProps {
  proveedores: ProveedorParaSelector[];
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

export function FormularioNuevaOrdenCompra({
  proveedores,
  variantes,
}: FormularioNuevaOrdenCompraProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [proveedorId, setProveedorId] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<ItemFila[]>([nuevaFila()]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [errorProveedor, setErrorProveedor] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<string | null>(null);

  const skuPorId = useMemo(
    () => new Map(variantes.map((v) => [v.id, v.sku])),
    [variantes],
  );

  const setFila = (key: string, cambios: Partial<ItemFila>) => {
    setItems((prev) =>
      prev.map((fila) => (fila.key === key ? { ...fila, ...cambios } : fila)),
    );
  };
  const agregarFila = () => setItems((prev) => [...prev, nuevaFila()]);
  const quitarFila = (key: string) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));

  /** Traduce una lista de UUIDs de un mensaje del servicio a etiquetas SKU. */
  const skusDesdeMensaje = (mensaje: string): string => {
    const ids = mensaje.match(UUID_RE) ?? [];
    const skus = ids.map((id) => skuPorId.get(id.toLowerCase()) ?? id);
    return skus.join(", ");
  };

  const validarLocal = (): boolean => {
    setErrorGeneral(null);
    setErrorProveedor(null);
    setErrorItems(null);

    if (!proveedorId) {
      setErrorProveedor("Elegí un proveedor homologado.");
      return false;
    }
    const filasCargadas = items.filter((f) => f.variante_sku_id);
    if (filasCargadas.length === 0) {
      setErrorItems("Agregá al menos una variante a la orden.");
      return false;
    }
    for (const fila of filasCargadas) {
      const cantidad = Number(fila.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        setErrorItems(
          `La cantidad de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe ser un entero mayor a 0.`,
        );
        return false;
      }
    }
    const ids = filasCargadas.map((f) => f.variante_sku_id);
    if (new Set(ids).size !== ids.length) {
      setErrorItems("Hay una variante repetida. Consolidá la cantidad en un solo ítem.");
      return false;
    }
    return true;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validarLocal()) return;

    // `observaciones` es `.optional()` en el schema: si el campo quedó vacío
    // NO se incluye la clave en el payload (en vez de mandar `undefined`, que
    // una Server Action serializa como el marcador de wire `"$undefined"` y
    // ensucia el Request Payload en DevTools aunque el servidor lo decodifique
    // bien). Así Zod la trata como ausente y se persiste NULL.
    const observacionesLimpias = observaciones.trim();
    const payload = {
      proveedor_id: proveedorId,
      ...(observacionesLimpias ? { observaciones: observacionesLimpias } : {}),
      items: items
        .filter((f) => f.variante_sku_id)
        .map((f) => ({
          variante_sku_id: f.variante_sku_id,
          cantidad_solicitada: Number(f.cantidad),
        })),
    };

    startTransition(async () => {
      const resultado = await crearOrdenCompraAction(payload);

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
        if (
          code === "PROVEEDOR_NO_HOMOLOGADO" ||
          code === "PROVEEDOR_SIN_LISTA_VIGENTE" ||
          code === "PROVEEDOR_NO_ENCONTRADO"
        ) {
          setErrorProveedor(message);
          return;
        }
        if (code === "ITEMS_DUPLICADOS") {
          setErrorItems(message);
          return;
        }
        setErrorGeneral(message);
        return;
      }

      router.push(`/compras/ordenes/${resultado.data.orden_compra_id}`);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {errorGeneral && (
        <Alert variant="destructive">
          <AlertDescription>{errorGeneral}</AlertDescription>
        </Alert>
      )}

      {/* ── Proveedor ───────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="oc-proveedor" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Proveedor
        </Label>
        <ComboboxFiltrable
          id="oc-proveedor"
          items={proveedores}
          getId={(p) => p.id}
          getLabel={(p) =>
            p.nombre_fantasia ? `${p.razon_social} (${p.nombre_fantasia})` : p.razon_social
          }
          value={proveedorId}
          onChange={(p) => {
            setProveedorId(p.id);
            setErrorProveedor(null);
          }}
          placeholder="Buscar proveedor homologado…"
          emptyMessage="No hay proveedores homologados."
          pageSize={8}
        />
        {proveedores.length === 0 && (
          <p className="text-xs text-amber-600">
            No hay proveedores en estado HOMOLOGADO. No es posible emitir una orden.
          </p>
        )}
        {errorProveedor && (
          <p className="text-xs text-destructive">{errorProveedor}</p>
        )}
      </div>

      {/* ── Ítems ───────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Ítems de la orden
          </Label>
          <Button type="button" variant="outline" size="sm" onClick={agregarFila} className="gap-1.5">
            <Plus className="size-3.5" />
            Agregar ítem
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          El precio unitario se resuelve automáticamente contra la lista de precios
          vigente del proveedor — no se ingresa acá.
        </p>

        <div className="space-y-2">
          {items.map((fila) => (
            <div
              key={fila.key}
              className="flex flex-col sm:flex-row sm:items-end gap-2 rounded-lg border border-border bg-muted/20 p-3"
            >
              <div className="flex-1 space-y-1">
                <Label htmlFor={`item-var-${fila.key}`} className="text-xs">
                  Variante
                </Label>
                <ComboboxFiltrable
                  id={`item-var-${fila.key}`}
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
                <Label htmlFor={`item-cant-${fila.key}`} className="text-xs">
                  Cantidad
                </Label>
                <Input
                  id={`item-cant-${fila.key}`}
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
                disabled={items.length === 1}
                aria-label="Quitar ítem"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {errorItems && <p className="text-xs text-destructive">{errorItems}</p>}
      </div>

      {/* ── Observaciones ───────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="oc-observaciones" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Observaciones <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <textarea
          id="oc-observaciones"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={3}
          placeholder="Notas internas sobre la orden, condiciones acordadas, etc."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/compras/ordenes")}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isPending || proveedores.length === 0}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creando…
            </>
          ) : (
            <>
              <PackagePlus className="size-4" />
              Crear orden en borrador
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
