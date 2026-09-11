"use client"

/**
 * @component SeccionUmbralesDeposito
 * @description task_UI_modal_umbrales_deposito.md §2.1 / §2.2 — límite cliente
 * de `/inventario/depositos`. La página (Server Component) solo aporta la
 * cabecera estática; este wrapper concentra el único estado nuevo de la task:
 * si el modal de umbrales está abierto y con qué fila viene precargado.
 *
 * Ambos puntos de entrada abren el MISMO `ModalConfigurarUmbrales` (task §2.4):
 *  - **Entrada A**: botón "Configurar umbrales" de la cabecera → `precarga`
 *    en `null` → cascada vacía.
 *  - **Entrada B**: acción por fila de la Consola → `precarga` con esa
 *    variante ya resuelta.
 *
 * Revalidación (task §2.3, hallazgo H-A): tras un guardado exitoso se llama al
 * handle imperativo de `ConsolaDepositoProductos`, que incrementa su propio
 * contador y lo pasa a `revalidarCuando` de `TablaFiltroPaginada`. El
 * trade-off asumido es que ese refetch reinicia la tabla a la página 1.
 */
import { useRef, useState } from "react"
import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ConsolaDepositoProductos,
  type ConsolaDepositoProductosHandle,
} from "@/components/inventario/ConsolaDepositoProductos"
import {
  ModalConfigurarUmbrales,
  type PrecargaUmbrales,
} from "@/components/inventario/ModalConfigurarUmbrales"

export function SeccionUmbralesDeposito() {
  const consolaRef = useRef<ConsolaDepositoProductosHandle>(null)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [precarga, setPrecarga] = useState<PrecargaUmbrales | null>(null)

  function abrirEntradaA() {
    setPrecarga(null)
    setModalAbierto(true)
  }

  function abrirEntradaB(fila: PrecargaUmbrales) {
    setPrecarga(fila)
    setModalAbierto(true)
  }

  function handleGuardadoExitoso() {
    consolaRef.current?.revalidar()
  }

  return (
    <div className="space-y-6">
      
      <ConsolaDepositoProductos
        ref={consolaRef}
        onConfigurarUmbrales={abrirEntradaB}
      />
      
      <div className="flex justify-end">
        <Button onClick={abrirEntradaA}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Configurar umbrales
        </Button>
      </div>

      <ModalConfigurarUmbrales
        open={modalAbierto}
        onOpenChange={setModalAbierto}
        precarga={precarga}
        onGuardadoExitoso={handleGuardadoExitoso}
      />
    </div>
  )
}
