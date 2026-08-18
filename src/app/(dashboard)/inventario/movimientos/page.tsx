/**
 * @page MovimientosPage
 * @route /inventario/movimientos
 *
 * Server Component: obtiene los depósitos activos en servidor y los pasa
 * como props al panel de escaneo (Client Component).
 */
import { Suspense } from "react";
import { ScanBarcode, AlertTriangle } from "lucide-react";
import { listarDepositosActivos } from "@/lib/services/inventario/deposito.service";
import { IngresoEscaneoPanel } from "@/components/inventario/escaner/IngresoEscaneoPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata = {
  title: "Ingreso por Escaneo — ERP SWAT",
  description: "Registro de ingresos de mercadería mediante escaneo de códigos de barras y QR.",
};

async function IngresoEscaneoData() {
  let depositos;
  try {
    depositos = await listarDepositosActivos();
  } catch (err) {
    console.error("[MovimientosPage] Error al obtener depósitos:", err);
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertDescription>
          No se pudieron cargar los depósitos. Verificá la conexión con la base de datos.
        </AlertDescription>
      </Alert>
    );
  }

  return <IngresoEscaneoPanel depositos={depositos} />;
}

export default function MovimientosPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <ScanBarcode className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Ingreso de Mercadería por Escaneo
            </h1>
            <p className="text-sm text-muted-foreground">
              Escaneá el código de cada unidad para registrar el ingreso al depósito.
            </p>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
              <span className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Cargando depósitos…
            </div>
          }
        >
          <IngresoEscaneoData />
        </Suspense>
      </div>
    </main>
  );
}
