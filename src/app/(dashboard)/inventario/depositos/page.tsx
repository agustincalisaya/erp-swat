import { Warehouse } from "lucide-react"
import { SelectorJerarquicoStock } from "@/components/inventario/SelectorJerarquicoStock"
import { ConsolaDepositoProductos } from "@/components/inventario/ConsolaDepositoProductos"

export default function DepositosPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8 pb-20 lg:pb-24">
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
              Configurá el punto de pedido y el stock de seguridad de cada
              variante en este depósito para recibir alertas automáticas de
              reposición antes de llegar al nivel crítico.
            </p>
          </div>
        </div>
      </div>

      <SelectorJerarquicoStock />

      <ConsolaDepositoProductos />
    </div>
  )
}