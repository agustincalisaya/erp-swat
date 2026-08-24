"use client"

/**
 * @component SelectorJerarquicoStock
 * @description task_cali_selector_umbrales.md — selector jerárquico de 3
 * niveles (Depósito → Producto Maestro → Variante) que antecede al
 * `FormularioUmbralesStock` ya existente. Este componente concentra toda la
 * lógica de cascada, reseteo y fetch de la combinación elegida — el
 * formulario en sí queda enfocado exclusivamente en el guardado, sin mezclar
 * lógica de selección (sección 4 de la tarea).
 *
 * No hay un componente de `<select>` reutilizable en `components/ui` todavía
 * (mismo caso que `BuscadorProductoExistente`) — se usan `<select>` nativos
 * con la paleta visual de `Input`, en vez de introducir una dependencia o un
 * wrapper nuevo para 3 usos.
 *
 * `FormularioUmbralesStock` se remonta (`key`) por cada combinación nueva:
 * `react-hook-form` solo lee `defaultValues` al montar, así que sin `key` el
 * formulario conservaría los valores de la combinación anterior al cambiar
 * de variante.
 */
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { FormularioUmbralesStock } from "@/components/inventario/FormularioUmbralesStock"
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable"
import {
  listarDepositosActivos,
  listarProductosConVariantes,
  listarVariantesPorProducto,
  obtenerStockDepositoPorCombinacion,
} from "@/app/(dashboard)/inventario/depositos/actions"
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service"
import type { ProductoConVariantesResumen } from "@/lib/services/inventario/producto.service"
import type { VariantePorProducto } from "@/lib/services/inventario/variante.service"
import type { StockDepositoCombinacion } from "@/lib/services/inventario/stock.service"

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80"

function etiquetaVariante(variante: VariantePorProducto): string {
  return `${variante.talle} · ${variante.color} · ${variante.genero} (${variante.sku})`
}

export function SelectorJerarquicoStock() {
  const [depositos, setDepositos] = useState<DepositoActivo[]>([])
  const [productos, setProductos] = useState<ProductoConVariantesResumen[]>([])
  const [variantes, setVariantes] = useState<VariantePorProducto[]>([])

  const [depositoId, setDepositoId] = useState("")
  const [productoId, setProductoId] = useState("")
  const [varianteId, setVarianteId] = useState("")

  const [cargandoDepositos, setCargandoDepositos] = useState(true)
  const [cargandoProductos, setCargandoProductos] = useState(false)
  const [cargandoVariantes, setCargandoVariantes] = useState(false)
  const [cargandoCombinacion, setCargandoCombinacion] = useState(false)

  const [stockCombinacion, setStockCombinacion] = useState<StockDepositoCombinacion | null>(null)

  // 1er nivel — se carga una sola vez al montar.
  useEffect(() => {
    listarDepositosActivos().then((respuesta) => {
      setCargandoDepositos(false)
      if (respuesta.error) {
        toast.add({
          title: "No se pudieron cargar los depósitos",
          description: respuesta.error.message,
          type: "error",
        })
        return
      }
      setDepositos(respuesta.data)
    })
  }, [])

  function handleDepositoChange(nuevoDepositoId: string) {
    setDepositoId(nuevoDepositoId)
    // Reset en cascada: un depósito nuevo invalida Producto y Variante ya elegidos.
    setProductoId("")
    setVarianteId("")
    setVariantes([])
    setStockCombinacion(null)

    if (!nuevoDepositoId) {
      setProductos([])
      return
    }

    setCargandoProductos(true)
    listarProductosConVariantes().then((respuesta) => {
      setCargandoProductos(false)
      if (respuesta.error) {
        toast.add({
          title: "No se pudieron cargar los productos",
          description: respuesta.error.message,
          type: "error",
        })
        return
      }
      setProductos(respuesta.data)
    })
  }

  function handleProductoChange(nuevoProductoId: string) {
    setProductoId(nuevoProductoId)
    // Reset en cascada: un producto nuevo invalida la Variante ya elegida.
    setVarianteId("")
    setStockCombinacion(null)

    if (!nuevoProductoId) {
      setVariantes([])
      return
    }

    setCargandoVariantes(true)
    listarVariantesPorProducto(nuevoProductoId).then((respuesta) => {
      setCargandoVariantes(false)
      if (respuesta.error) {
        toast.add({
          title: "No se pudieron cargar las variantes",
          description: respuesta.error.message,
          type: "error",
        })
        return
      }
      setVariantes(respuesta.data)
    })
  }

  function handleVarianteChange(nuevaVarianteId: string) {
    setVarianteId(nuevaVarianteId)
    setStockCombinacion(null)

    if (!nuevaVarianteId || !depositoId) return

    setCargandoCombinacion(true)
    obtenerStockDepositoPorCombinacion(nuevaVarianteId, depositoId).then((respuesta) => {
      setCargandoCombinacion(false)
      if (respuesta.error) {
        toast.add({
          title: "No se pudo consultar el stock de la combinación",
          description: respuesta.error.message,
          type: "error",
        })
        return
      }
      setStockCombinacion(respuesta.data.stockDeposito)
    })
  }

  const seleccionCompleta = Boolean(depositoId && productoId && varianteId) && !cargandoCombinacion
  const varianteSeleccionada = variantes.find((v) => v.id === varianteId)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Seleccionar combinación</CardTitle>
          <CardDescription>
            Elegí depósito, producto y variante para configurar sus umbrales de reposición.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="selector-deposito">Depósito</Label>
            <select
              id="selector-deposito"
              className={selectClassName}
              value={depositoId}
              disabled={cargandoDepositos}
              onChange={(e) => handleDepositoChange(e.target.value)}
            >
              <option value="">
                {cargandoDepositos ? "Cargando…" : "Seleccioná un depósito"}
              </option>
              {depositos.map((deposito) => (
                <option key={deposito.id} value={deposito.id}>
                  {deposito.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="selector-producto">Producto Maestro</Label>
            <ComboboxFiltrable
              id="selector-producto"
              items={productos}
              getId={(producto) => producto.id}
              getLabel={(producto) => producto.nombre}
              value={productoId}
              onChange={(producto) => handleProductoChange(producto.id)}
              placeholder="Buscar producto por nombre…"
              disabled={!depositoId}
              cargando={cargandoProductos}
              emptyMessage="Sin coincidencias."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="selector-variante">Variante</Label>
            <ComboboxFiltrable
              id="selector-variante"
              items={variantes}
              getId={(variante) => variante.id}
              getLabel={etiquetaVariante}
              value={varianteId}
              onChange={(variante) => handleVarianteChange(variante.id)}
              placeholder="Buscar variante por talle, color, género o SKU…"
              disabled={!productoId}
              cargando={cargandoVariantes}
              emptyMessage="Sin coincidencias."
            />
          </div>
        </CardContent>
      </Card>

      {cargandoCombinacion && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Consultando stock de la combinación…
        </div>
      )}

      {seleccionCompleta && (
        <Card>
          <CardHeader>
            <CardTitle>Umbrales de reposición</CardTitle>
            <CardDescription>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                  {productos.find((p) => p.id === productoId)?.nombre}
                </span>
                <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-700/10">
                  {depositos.find((d) => d.id === depositoId)?.nombre}
                </span>
                {varianteSeleccionada && (
                  <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-700/10">
                    Talle {varianteSeleccionada.talle} · {varianteSeleccionada.color} · {varianteSeleccionada.genero}
                  </span>
                )}
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioUmbralesStock
              key={`${varianteId}-${depositoId}`}
              variante_sku_id={varianteId}
              deposito_id={depositoId}
              punto_pedido_actual={stockCombinacion?.punto_pedido ?? 0}
              stock_seguridad_actual={stockCombinacion?.stock_seguridad ?? 0}
              tiene_stock_cargado={stockCombinacion !== null}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
