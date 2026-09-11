"use client"

/**
 * @component ModalConfigurarUmbrales
 * @description task_UI_modal_umbrales_deposito.md — contenedor de modal que
 * saca la configuración de umbrales del flujo normal de `/inventario/depositos`
 * y la abre bajo demanda sobre la Consola de Depósito. Reusa `Dialog`
 * (`components/ui/dialog.tsx`, Base UI) — el backdrop ya trae blur (`bg-black/10`
 * + `backdrop-blur-xs`), no se arma overlay manual (task §3, §4.1). El botón de
 * cierre "x" lo aporta `DialogContent`; "Cancelar" vive en el `DialogFooter`.
 *
 * Dos puntos de entrada que convergen en el mismo `FormularioUmbralesStock`
 * (task §2.2 / §2.4) — la única diferencia es cómo se inicializan los valores:
 *  - **Entrada A** (`precarga` ausente): `SelectorJerarquicoStock` con la
 *    cascada Depósito → Producto → Variante en su estado vacío.
 *  - **Entrada B** (`precarga` presente): `FormularioUmbralesStock` directo,
 *    ya resuelto desde una fila de la tabla, sin pasar por la cascada.
 *
 * `key` sobre `FormularioUmbralesStock` por combinación `variante/depósito`
 * (mismo patrón que `SelectorJerarquicoStock`): `react-hook-form` solo lee
 * `defaultValues` al montar, así que sin `key` una precarga nueva conservaría
 * los valores de la anterior.
 *
 * No introduce lógica de negocio (task §3): abrir/cerrar y qué variante está
 * precargada es estado de UI puro, resuelto en `SeccionUmbralesDeposito`. El
 * guardado sigue en `actualizarUmbrales`.
 */
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FormularioUmbralesStock } from "@/components/inventario/FormularioUmbralesStock"
import { SelectorJerarquicoStock } from "@/components/inventario/SelectorJerarquicoStock"

/**
 * Valores con los que la Entrada B (acción por fila) inicializa el formulario
 * sin re-consultar la cascada. `variante_sku` y `producto_nombre` son solo para
 * el encabezado de contexto del modal — no se envían en el submit.
 */
export interface PrecargaUmbrales {
  variante_sku_id: string
  deposito_id: string
  punto_pedido_actual: number
  stock_seguridad_actual: number
  variante_sku: string
  producto_nombre: string
}

interface ModalConfigurarUmbralesProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entrada B: fila ya resuelta. `null`/ausente → Entrada A (cascada vacía). */
  precarga?: PrecargaUmbrales | null
  /**
   * Disparado tras un guardado exitoso, además del cierre del modal. Lo usa
   * `SeccionUmbralesDeposito` para revalidar la tabla de la Consola (task §2.3).
   */
  onGuardadoExitoso?: () => void
}

export function ModalConfigurarUmbrales({
  open,
  onOpenChange,
  precarga,
  onGuardadoExitoso,
}: ModalConfigurarUmbralesProps) {
  function handleGuardadoExitoso() {
    onOpenChange(false)
    onGuardadoExitoso?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar umbrales de reposición</DialogTitle>
          <DialogDescription>
            {precarga
              ? `${precarga.producto_nombre} · ${precarga.variante_sku}`
              : "Elegí depósito, producto y variante para configurar su punto de pedido y stock de seguridad."}
          </DialogDescription>
        </DialogHeader>

        {precarga ? (
          <FormularioUmbralesStock
            key={`${precarga.variante_sku_id}-${precarga.deposito_id}`}
            variante_sku_id={precarga.variante_sku_id}
            deposito_id={precarga.deposito_id}
            punto_pedido_actual={precarga.punto_pedido_actual}
            stock_seguridad_actual={precarga.stock_seguridad_actual}
            tiene_stock_cargado={true}
            onSuccess={handleGuardadoExitoso}
          />
        ) : (
          <SelectorJerarquicoStock onGuardadoExitoso={handleGuardadoExitoso} />
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
