"use client"

/**
 * @component ConsolaDepositoProductos
 * @description HU-A5 ampliada (Sprint 2) — punto de montaje de
 * `TablaFiltroPaginada` para el flujo "Tabla General → Filtro Depósito →
 * Tabla Filtrada" del criterio de aceptación del Backlog (spec_modulo_A.md
 * §2.6). Un `<select>` de depósito activo dispara la carga de la tabla contra
 * `GET /api/inventario/depositos/[id]/productos`.
 *
 * Reusa el Server Action `listarDepositosActivos()` ya existente
 * (`depositos/actions.ts`, el mismo que consume `SelectorJerarquicoStock`).
 * El fetch contra el endpoint se inyecta como `cargarPagina`:
 * `TablaFiltroPaginada` no conoce esta ruta (task §3.2), de modo que HU-A11
 * pueda reutilizar el componente con su propio endpoint sin tocarlo.
 *
 * Vista de visualización/búsqueda masiva, distinta del selector jerárquico de
 * umbrales de esta misma pantalla (task §3.3: la cascada habilita la edición
 * manual; esta tabla es búsqueda masiva — no se unifican).
 *
 * task_UI_modal_umbrales_deposito.md §2.2 — Entrada B: si el contenedor pasa
 * `onConfigurarUmbrales`, cada fila suma una acción (ícono de edición) que
 * entrega esa variante ya resuelta al modal de umbrales, sin re-consultar la
 * cascada. Tras un guardado exitoso, el contenedor llama `revalidar()` (handle
 * imperativo) para refrescar la tabla.
 */
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type Ref,
} from "react"
import { Pencil, SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import {
  TablaFiltroPaginada,
  type ColumnaTabla,
} from "@/components/inventario/TablaFiltroPaginada"
import type { PrecargaUmbrales } from "@/components/inventario/ModalConfigurarUmbrales"
import { listarDepositosActivos } from "@/app/(dashboard)/inventario/depositos/actions"
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service"
import type {
  ListadoProductosPorDeposito,
  ProductoPorDepositoItem,
} from "@/lib/services/inventario/stock.service"

// Mismo estilo de `<select>` nativo que `SelectorJerarquicoStock` (no hay
// wrapper de select reutilizable en `components/ui` todavía).
const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80"

interface RespuestaProductosPorDeposito {
  data: ListadoProductosPorDeposito | null
  error: { code: string; message: string } | null
}

const COLUMNAS_BASE: ColumnaTabla<ProductoPorDepositoItem>[] = [
  {
    clave: "variante_sku",
    encabezado: "SKU",
    render: (fila) => <span className="font-mono text-xs">{fila.variante_sku}</span>,
  },
  {
    clave: "producto_nombre",
    encabezado: "Producto",
    render: (fila) => fila.producto_nombre,
  },
  {
    clave: "cantidad",
    encabezado: "Cantidad",
    alinear: "derecha",
    render: (fila) => fila.cantidad,
  },
  {
    clave: "punto_pedido",
    encabezado: "Punto de pedido",
    alinear: "derecha",
    render: (fila) => fila.punto_pedido,
  },
  {
    clave: "stock_seguridad",
    encabezado: "Stock de seguridad",
    alinear: "derecha",
    render: (fila) => fila.stock_seguridad,
  },
]

/** Handle imperativo expuesto al contenedor que aloja esta Consola. */
export interface ConsolaDepositoProductosHandle {
  /**
   * Fuerza un refetch de la tabla tras un guardado externo (el modal de
   * umbrales). Reinicia a la página 1 — trade-off asumido (task hallazgo H-A):
   * `TablaFiltroPaginada` solo expone `revalidarCuando`, sin refetch in situ.
   */
  revalidar: () => void
}

interface ConsolaDepositoProductosProps {
  ref?: Ref<ConsolaDepositoProductosHandle>
  /**
   * Entrada B (task §2.2): la acción por fila entrega al contenedor del modal
   * la variante ya resuelta, sin pasar por la cascada. Ausente → no se
   * renderiza la columna de acción (uso de solo lectura).
   */
  onConfigurarUmbrales?: (precarga: PrecargaUmbrales) => void
}

export function ConsolaDepositoProductos({
  ref,
  onConfigurarUmbrales,
}: ConsolaDepositoProductosProps) {
  const [depositos, setDepositos] = useState<DepositoActivo[]>([])
  const [depositoId, setDepositoId] = useState("")
  const [cargandoDepositos, setCargandoDepositos] = useState(true)

  // Contador de revalidación (task hallazgo H-A): cada guardado exitoso desde
  // el modal lo incrementa vía `revalidar()`, y entra en `revalidarCuando` para
  // forzar el refetch de la tabla sin recarga de página.
  const [revalidacionNonce, setRevalidacionNonce] = useState(0)
  useImperativeHandle(
    ref,
    () => ({ revalidar: () => setRevalidacionNonce((n) => n + 1) }),
    [],
  )

  const columnas = useMemo<ColumnaTabla<ProductoPorDepositoItem>[]>(() => {
    if (!onConfigurarUmbrales) return COLUMNAS_BASE
    return [
      ...COLUMNAS_BASE,
      {
        clave: "acciones",
        encabezado: "",
        alinear: "derecha",
        render: (fila) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Configurar umbrales de ${fila.variante_sku}`}
            onClick={() =>
              onConfigurarUmbrales({
                variante_sku_id: fila.variante_sku_id,
                deposito_id: depositoId,
                punto_pedido_actual: fila.punto_pedido,
                stock_seguridad_actual: fila.stock_seguridad,
                variante_sku: fila.variante_sku,
                producto_nombre: fila.producto_nombre,
              })
            }
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        ),
      },
    ]
  }, [onConfigurarUmbrales, depositoId])

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

  async function cargarPagina({
    busqueda,
    pagina,
    porPagina,
  }: {
    busqueda: string
    pagina: number
    porPagina: number
  }): Promise<ListadoProductosPorDeposito> {
    const params = new URLSearchParams({
      pagina: String(pagina),
      por_pagina: String(porPagina),
    })
    if (busqueda) params.set("busqueda", busqueda)

    const respuesta = await fetch(
      `/api/inventario/depositos/${depositoId}/productos?${params.toString()}`,
    )
    const cuerpo = (await respuesta.json()) as RespuestaProductosPorDeposito

    if (!respuesta.ok || cuerpo.error || !cuerpo.data) {
      throw new Error(cuerpo.error?.message ?? "No se pudo cargar el listado")
    }

    return cuerpo.data
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consola de depósito</CardTitle>
        <CardDescription>
          Elegí un depósito para ver sus productos con stock configurado, buscar
          por nombre de producto o SKU y paginar los resultados (hasta 20 por
          vista).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="consola-deposito">Depósito</Label>
          <select
            id="consola-deposito"
            className={selectClassName}
            value={depositoId}
            disabled={cargandoDepositos}
            onChange={(e) => setDepositoId(e.target.value)}
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

        {depositoId && (
          <TablaFiltroPaginada<ProductoPorDepositoItem>
            columnas={columnas}
            obtenerClaveFila={(fila) => fila.stock_deposito_id}
            cargarPagina={cargarPagina}
            revalidarCuando={[depositoId, revalidacionNonce]}
            busquedaPlaceholder="Buscar por nombre de producto o SKU…"
            mensajeVacio="Este depósito no tiene productos con stock configurado."
            etiquetaRegistros={{ singular: "producto", plural: "productos" }}
          />
        )}
      </CardContent>
    </Card>
  )
}
