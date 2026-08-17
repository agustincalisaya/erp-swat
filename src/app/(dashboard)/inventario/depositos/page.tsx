import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FormularioUmbralesStock } from "@/components/inventario/FormularioUmbralesStock"

// TODO: reemplazar por la variante/depósito real seleccionados por el
// Encargado de Depósito (listado + selección) una vez exista esa vista.
// IDs fijos que coinciden EXACTAMENTE con los del seed de datos de prueba
// (prisma/seed.ts): VarianteSKU "CAMISA-POLICIA-M-AZUL-MASCULINO" en
// Deposito "Depósito Central".
const VARIANTE_SKU_ID_MOCK = "fadabd3f-991e-4e26-90f2-ad8cc97856c7"
const DEPOSITO_ID_MOCK = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a"
const PUNTO_PEDIDO_ACTUAL_MOCK = 10
const STOCK_SEGURIDAD_ACTUAL_MOCK = 5

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

      <Card>
        <CardHeader>
          <CardTitle>Umbrales de reposición</CardTitle>
          <CardDescription>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                Camisa de Policía (Talle M, Azul)
              </span>
              <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-700/10">
                Depósito Central
              </span>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioUmbralesStock
            variante_sku_id={VARIANTE_SKU_ID_MOCK}
            deposito_id={DEPOSITO_ID_MOCK}
            punto_pedido_actual={PUNTO_PEDIDO_ACTUAL_MOCK}
            stock_seguridad_actual={STOCK_SEGURIDAD_ACTUAL_MOCK}
          />
        </CardContent>
      </Card>
    </div>
  )
}
