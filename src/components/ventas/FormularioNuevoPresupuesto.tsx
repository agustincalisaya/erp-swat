"use client";

/**
 * @component FormularioNuevoPresupuesto
 * @description Alta de un Presupuesto con congelamiento de stock (HU-B3,
 * spec §2.3). Conecta con la Server Action `crearPresupuestoAction` —
 * wrapper fino sobre `presupuesto.service.ts`, la lógica de negocio no vive
 * acá.
 *
 * Mismo patrón que `FormularioNuevaOrdenCompra.tsx` (confirmado en el
 * relevamiento): `useState` manual con filas dinámicas de ítems, sin
 * react-hook-form — no hay precedente de `useFieldArray` en el proyecto, y
 * este formulario tiene la misma forma (cabecera + N ítems) que el de Orden
 * de Compra.
 *
 * A diferencia de Orden de Compra (que resuelve `precio_unitario`
 * server-side contra una lista de precios vigente), acá el precio SÍ lo
 * ingresa el vendedor (`precio_cotizado`, spec §2.3 — es una cotización
 * negociada, no un precio de catálogo). El depósito de origen también lo
 * elige el vendedor por línea (extensión autorizada al contrato de spec
 * §2.3, decisión del equipo: 3 depósitos reales sembrados, sin uno único).
 *
 * Mejora UX — stock por depósito (task_mejora_ux_stock_deposito_presupuesto.md):
 * al elegir la variante de una fila (`onChange` del combobox de variante),
 * se consulta `GET /api/inventario/variantes/[id]/stock-por-deposito` y se
 * anota cada `<option>` del `<select>` de depósito con "(N disp.)". Ningún
 * depósito se oculta aunque tenga 0 disponible (alcance §5) — la validación
 * real de stock insuficiente sigue viviendo server-side en `crearReserva()`
 * (Módulo A), esto es puramente informativo/preventivo en el cliente.
 */

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, FileText, Info } from "lucide-react";

import { crearPresupuestoAction } from "@/app/(dashboard)/ventas/presupuestos/actions";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ClienteParaSelector, VarianteParaCotizacion } from "@/lib/services/ventas/presupuesto.service";
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";
import type { StockPorDeposito } from "@/lib/services/inventario/stock.service";

interface FormularioNuevoPresupuestoProps {
  clientes: ClienteParaSelector[];
  variantes: VarianteParaCotizacion[];
  depositos: DepositoActivo[];
}

interface ItemFila {
  key: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad: string;
  precio_cotizado: string;
}

function nuevaFila(depositoIdPorDefecto: string): ItemFila {
  return {
    key: crypto.randomUUID(),
    variante_sku_id: "",
    deposito_id: depositoIdPorDefecto,
    cantidad: "1",
    precio_cotizado: "",
  };
}

export function FormularioNuevoPresupuesto({
  clientes,
  variantes,
  depositos,
}: FormularioNuevoPresupuestoProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const formId = useId();

  const depositoPorDefecto = depositos[0]?.id ?? "";

  const [clienteId, setClienteId] = useState("");
  const [vigenciaDias, setVigenciaDias] = useState("7");
  const [condicionesComerciales, setCondicionesComerciales] = useState("");
  const [items, setItems] = useState<ItemFila[]>(() => [nuevaFila(depositoPorDefecto)]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [errorCliente, setErrorCliente] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<string | null>(null);

  // Mejora UX — stock por depósito: `stockPorFila[fila.key]` guarda la última
  // respuesta de `GET /api/inventario/variantes/[id]/stock-por-deposito` para
  // esa fila; `cargandoStockKeys` habilita un indicador liviano mientras
  // resuelve. `ultimaVarianteConsultadaRef` descarta respuestas fuera de
  // orden (el usuario cambió la variante de la fila antes de que resolviera
  // la consulta anterior) sin depender del estado de `items` en la clausura.
  const [stockPorFila, setStockPorFila] = useState<Record<string, StockPorDeposito[]>>({});
  const [cargandoStockKeys, setCargandoStockKeys] = useState<Record<string, boolean>>({});
  const ultimaVarianteConsultadaRef = useRef<Record<string, string>>({});

  const skuPorId = useMemo(() => new Map(variantes.map((v) => [v.id, v.sku])), [variantes]);

  const setFila = (key: string, cambios: Partial<ItemFila>) => {
    setItems((prev) => prev.map((fila) => (fila.key === key ? { ...fila, ...cambios } : fila)));
  };
  const agregarFila = () => setItems((prev) => [...prev, nuevaFila(depositoPorDefecto)]);
  const quitarFila = (key: string) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));

  const cargarStockPorDeposito = async (key: string, varianteSkuId: string) => {
    ultimaVarianteConsultadaRef.current[key] = varianteSkuId;
    setStockPorFila((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _descartado, ...resto } = prev;
      return resto;
    });
    setCargandoStockKeys((prev) => ({ ...prev, [key]: true }));

    try {
      const respuesta = await fetch(`/api/inventario/variantes/${varianteSkuId}/stock-por-deposito`);
      const json = await respuesta.json();
      if (ultimaVarianteConsultadaRef.current[key] !== varianteSkuId) return; // superada por una selección más reciente
      if (!respuesta.ok || json.error) return; // informativo: si falla, el select se comporta como hoy

      setStockPorFila((prev) => ({ ...prev, [key]: json.data as StockPorDeposito[] }));
    } catch {
      // Consulta puramente informativa — un error de red no bloquea el alta.
    } finally {
      if (ultimaVarianteConsultadaRef.current[key] === varianteSkuId) {
        setCargandoStockKeys((prev) => ({ ...prev, [key]: false }));
      }
    }
  };

  const validarLocal = (): boolean => {
    setErrorGeneral(null);
    setErrorCliente(null);
    setErrorItems(null);

    if (!clienteId) {
      setErrorCliente("Elegí un cliente.");
      return false;
    }
    const vigencia = Number(vigenciaDias);
    if (!Number.isInteger(vigencia) || vigencia <= 0) {
      setErrorGeneral("La vigencia debe ser un número entero de días mayor a 0.");
      return false;
    }
    const filasCargadas = items.filter((f) => f.variante_sku_id);
    if (filasCargadas.length === 0) {
      setErrorItems("Agregá al menos un ítem al presupuesto.");
      return false;
    }
    for (const fila of filasCargadas) {
      const cantidad = Number(fila.cantidad);
      const precio = Number(fila.precio_cotizado);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        setErrorItems(
          `La cantidad de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe ser un entero mayor a 0.`,
        );
        return false;
      }
      if (!Number.isFinite(precio) || precio <= 0) {
        setErrorItems(
          `El precio cotizado de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe ser mayor a 0.`,
        );
        return false;
      }
      if (!fila.deposito_id) {
        setErrorItems(
          `Elegí el depósito de origen de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"}.`,
        );
        return false;
      }
    }
    return true;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validarLocal()) return;

    const condicionesLimpias = condicionesComerciales.trim();
    const payload = {
      cliente_id: clienteId,
      vigencia_dias: Number(vigenciaDias),
      ...(condicionesLimpias ? { condiciones_comerciales: condicionesLimpias } : {}),
      items: items
        .filter((f) => f.variante_sku_id)
        .map((f) => ({
          variante_sku_id: f.variante_sku_id,
          deposito_id: f.deposito_id,
          cantidad: Number(f.cantidad),
          precio_cotizado: Number(f.precio_cotizado),
        })),
    };

    startTransition(async () => {
      const resultado = await crearPresupuestoAction(payload);

      if (resultado.error) {
        const { code, message } = resultado.error;
        if (code === "CLIENTE_NO_ENCONTRADO") {
          setErrorCliente(message);
          return;
        }
        if (code === "VARIANTE_NO_ENCONTRADA" || code === "DEPOSITO_NO_ENCONTRADO" || code === "STOCK_INSUFICIENTE") {
          setErrorItems(message);
          return;
        }
        setErrorGeneral(message);
        return;
      }

      router.push(`/ventas/presupuestos/${resultado.data.presupuesto_id}`);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {errorGeneral && (
        <Alert variant="destructive">
          <AlertDescription>{errorGeneral}</AlertDescription>
        </Alert>
      )}

      {/* ── Cliente y vigencia ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="pres-cliente" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Cliente
          </Label>
          <ComboboxFiltrable
            id="pres-cliente"
            items={clientes}
            getId={(c) => c.id}
            getLabel={(c) => `${c.nombre} (DNI ${c.dni})`}
            value={clienteId}
            onChange={(c) => {
              setClienteId(c.id);
              setErrorCliente(null);
            }}
            placeholder="Buscar cliente…"
            emptyMessage="No hay clientes activos."
            pageSize={8}
          />
          {errorCliente && <p className="text-xs text-destructive">{errorCliente}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pres-vigencia" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Vigencia (días)
          </Label>
          <Input
            id="pres-vigencia"
            type="number"
            min={1}
            step={1}
            value={vigenciaDias}
            onChange={(e) => setVigenciaDias(e.target.value)}
            className="text-sm"
          />
        </div>
      </div>

      {/* ── Condiciones comerciales ─────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="pres-condiciones" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Condiciones comerciales <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <textarea
          id="pres-condiciones"
          value={condicionesComerciales}
          onChange={(e) => setCondicionesComerciales(e.target.value)}
          rows={3}
          placeholder="Condiciones de pago, plazos de entrega acordados, etc."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {/* ── Ítems ───────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Ítems cotizados
          </Label>
          <Button type="button" variant="outline" size="sm" onClick={agregarFila} className="gap-1.5">
            <Plus className="size-3.5" />
            Agregar ítem
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          El precio cotizado es el pactado con el cliente para esta cotización — no se
          resuelve contra la lista de precios de catálogo.
        </p>

        <div className="space-y-2">
          {items.map((fila, indice) => {
            const varId = `${formId}-var-${indice}`;
            const depId = `${formId}-dep-${indice}`;
            const cantId = `${formId}-cant-${indice}`;
            const precioId = `${formId}-precio-${indice}`;
            return (
              <div
                key={fila.key}
                className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3"
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
                      void cargarStockPorDeposito(fila.key, v.id);
                    }}
                    placeholder="Buscar SKU o producto…"
                    emptyMessage="Sin coincidencias."
                    pageSize={8}
                  />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={depId} className="text-xs">
                      Depósito de origen
                      {cargandoStockKeys[fila.key] && (
                        <span className="ml-1.5 font-normal normal-case text-muted-foreground">
                          consultando stock…
                        </span>
                      )}
                    </Label>
                    <select
                      id={depId}
                      value={fila.deposito_id}
                      onChange={(e) => {
                        setFila(fila.key, { deposito_id: e.target.value });
                        setErrorItems(null);
                      }}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="">Elegí un depósito…</option>
                      {depositos.map((d) => {
                        const stock = stockPorFila[fila.key]?.find((s) => s.deposito_id === d.id);
                        return (
                          <option key={d.id} value={d.id}>
                            {stock ? `${d.nombre} (${stock.cantidad_disponible} disp.)` : d.nombre}
                          </option>
                        );
                      })}
                    </select>
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
                  <div className="w-full sm:w-36 space-y-1">
                    <Label htmlFor={precioId} className="text-xs">
                      Precio cotizado
                    </Label>
                    <Input
                      id={precioId}
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={fila.precio_cotizado}
                      onChange={(e) => {
                        setFila(fila.key, { precio_cotizado: e.target.value });
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
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {errorItems && <p className="text-xs text-destructive">{errorItems}</p>}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/ventas/presupuestos")}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isPending || clientes.length === 0}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Emitiendo…
            </>
          ) : (
            <>
              <FileText className="size-4" />
              Emitir presupuesto
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
