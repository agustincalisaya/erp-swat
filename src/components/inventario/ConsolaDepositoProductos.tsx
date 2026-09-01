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
 * Vista de solo lectura, distinta del selector jerárquico de umbrales de esta
 * misma pantalla (task §3.3: la cascada habilita la edición puntual; esta
 * tabla es visualización/búsqueda masiva — no se unifican).
 */
import { useEffect, useState } from "react"

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

const COLUMNAS: ColumnaTabla<ProductoPorDepositoItem>[] = [
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

export function ConsolaDepositoProductos() {
  const [depositos, setDepositos] = useState<DepositoActivo[]>([])
  const [depositoId, setDepositoId] = useState("")
  const [cargandoDepositos, setCargandoDepositos] = useState(true)

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
            columnas={COLUMNAS}
            obtenerClaveFila={(fila) => fila.stock_deposito_id}
            cargarPagina={cargarPagina}
            revalidarCuando={[depositoId]}
            busquedaPlaceholder="Buscar por nombre de producto o SKU…"
            mensajeVacio="Este depósito no tiene productos con stock configurado."
            etiquetaRegistros={{ singular: "producto", plural: "productos" }}
          />
        )}
      </CardContent>
    </Card>
  )
}
