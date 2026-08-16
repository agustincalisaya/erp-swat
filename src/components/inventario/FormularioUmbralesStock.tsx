"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  ActualizarUmbralesStockSchema,
  type ActualizarUmbralesStockInput,
} from "@/lib/schemas/inventario.schema"
import { actualizarUmbrales } from "@/app/(dashboard)/inventario/depositos/actions"

interface FormularioUmbralesStockProps {
  variante_sku_id: string
  deposito_id: string
  punto_pedido_actual: number
  stock_seguridad_actual: number
}

interface SugerenciaUmbralesResponse {
  data: {
    promedio_egreso_mensual: number
    punto_pedido_sugerido: number | null
    stock_seguridad_sugerido: number | null
    meses_analizados: number
    warning: string | null
  } | null
  error: { code: string; message: string } | null
}

// TODO(Módulo D): reemplazar por el usuario de la sesión real una vez exista
// `lib/auth/session.ts`. Ver nota en depositos/actions.ts.
const USUARIO_ID_MOCK = "00000000-0000-4000-8000-000000000000"

export function FormularioUmbralesStock({
  variante_sku_id,
  deposito_id,
  punto_pedido_actual,
  stock_seguridad_actual,
}: FormularioUmbralesStockProps) {
  const [calculandoSugerencia, setCalculandoSugerencia] = React.useState(false)

  const form = useForm<ActualizarUmbralesStockInput>({
    resolver: zodResolver(ActualizarUmbralesStockSchema),
    defaultValues: {
      variante_sku_id,
      deposito_id,
      punto_pedido: punto_pedido_actual,
      stock_seguridad: stock_seguridad_actual,
    },
  })

  async function onSubmit(values: ActualizarUmbralesStockInput) {
    const formData = new FormData()
    formData.set("variante_sku_id", values.variante_sku_id)
    formData.set("deposito_id", values.deposito_id)
    formData.set("punto_pedido", String(values.punto_pedido))
    formData.set("stock_seguridad", String(values.stock_seguridad))

    const resultado = await actualizarUmbrales(USUARIO_ID_MOCK, formData)

    if (resultado.error) {
      toast.add({
        title: "No se pudieron guardar los umbrales",
        description: resultado.error.message,
        type: "error",
      })
      return
    }

    toast.add({
      title: "Umbrales actualizados",
      description: `Punto de pedido: ${resultado.data.punto_pedido} · Stock de seguridad: ${resultado.data.stock_seguridad}`,
      type: "success",
    })
  }

  async function calcularSugerencia() {
    setCalculandoSugerencia(true)
    try {
      const response = await fetch("/api/inventario/stock/umbrales/sugerencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variante_sku_id: form.getValues("variante_sku_id"),
          deposito_id: form.getValues("deposito_id"),
        }),
      })

      const { data, error } = (await response.json()) as SugerenciaUmbralesResponse

      if (error || !data) {
        toast.add({
          title: "No se pudo calcular la sugerencia",
          description: error?.message ?? "Error inesperado",
          type: "error",
        })
        return
      }

      if (data.punto_pedido_sugerido === null || data.stock_seguridad_sugerido === null) {
        toast.add({
          title: "Sin historial suficiente",
          description: data.warning ?? "No hay movimientos en el rango analizado",
          type: "info",
        })
        return
      }

      form.setValue("punto_pedido", data.punto_pedido_sugerido, { shouldValidate: true })
      form.setValue("stock_seguridad", data.stock_seguridad_sugerido, { shouldValidate: true })

      toast.add({
        title: "Sugerencia aplicada",
        description: `Basada en un promedio de ${data.promedio_egreso_mensual} egresos/mes (últimos ${data.meses_analizados} meses)`,
        type: "success",
      })
    } catch {
      toast.add({
        title: "No se pudo calcular la sugerencia",
        description: "Error de red al contactar el servidor",
        type: "error",
      })
    } finally {
      setCalculandoSugerencia(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="punto_pedido"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Punto de pedido</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  {...field}
                  onChange={(event) => field.onChange(event.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="stock_seguridad"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stock de seguridad</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  {...field}
                  onChange={(event) => field.onChange(event.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {form.formState.isSubmitting ? "Guardando..." : "Guardar"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={calcularSugerencia}
            disabled={calculandoSugerencia}
            className="bg-blue-100 text-blue-900 hover:bg-blue-200"
          >
            {calculandoSugerencia ? "Calculando..." : "Calcular sugerencia"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
