import { SelectorJerarquicoStock } from "@/components/inventario/SelectorJerarquicoStock"

export default function DepositosPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-blue-950">
          Gestión Operativa de Depósito
        </h1>
        <p className="text-sm text-slate-500">
          Configurá el punto de pedido y el stock de seguridad de cada
          variante en este depósito para recibir alertas automáticas de
          reposición antes de llegar al nivel crítico.
        </p>
      </div>

      <SelectorJerarquicoStock />
    </div>
  )
}
