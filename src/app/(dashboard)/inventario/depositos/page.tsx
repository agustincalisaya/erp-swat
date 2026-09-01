import { Warehouse } from "lucide-react"
import { SeccionUmbralesDeposito } from "@/components/inventario/SeccionUmbralesDeposito"

export default function DepositosPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8 pb-20 lg:pb-24">
      <div className="space-y-1">
        {/* Cabecera alineada estrictamente a la izquierda (flex-row fijo) */}
        <div className="flex items-start gap-3.5 text-left">
          <div className="p-2 bg-blue-50 rounded-xl border border-blue-100 text-blue-600 shrink-0 mt-0.5">
            <Warehouse className="size-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-blue-950 tracking-tight">
              Gestión Operativa de Depósito
            </h1>
            <p className="text-sm text-slate-500">
              Consultá el stock por depósito y configurá el punto de pedido y el stock de seguridad de cada
              variante para recibir alertas automáticas.
            </p>
          </div>
        </div>
      </div>

      {/*
        task_UI_modal_umbrales_deposito.md §2.1 — la Consola de Depósito es el
        contenido por defecto; el formulario de umbrales ya no vive en el flujo
        de la página, se abre bajo demanda desde `SeccionUmbralesDeposito`
        (límite cliente: estado `open` del modal + fila precargada).
      */}
      <SeccionUmbralesDeposito />
    </div>
  )
}
