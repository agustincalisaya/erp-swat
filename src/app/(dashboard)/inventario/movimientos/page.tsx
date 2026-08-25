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
import { listarTransferencias, listarVariantesTransferibles } from "@/lib/services/inventario/transferencia.service";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { IngresoEscaneoPanel } from "@/components/inventario/escaner/IngresoEscaneoPanel";
import { TransferenciasPanel } from "@/components/inventario/TransferenciasPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata = {
  title: "Movimientos de Inventario — ERP SWAT",
  description: "Ingresos y transferencias internas de mercadería.",
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

export default async function MovimientosPage() {
  const session = await getServerSession();
  const [puedeTransferir, puedeConfirmar] = await Promise.all([
    session ? usuarioTienePermiso(session.userId, "inventario:transferir_stock") : false,
    session ? usuarioTienePermiso(session.userId, "inventario:confirmar_recepcion") : false,
  ]);
  const [depositos, variantes, transferencias] = await Promise.all([
    listarDepositosActivos(),
    puedeTransferir ? listarVariantesTransferibles() : [],
    puedeTransferir || puedeConfirmar ? listarTransferencias() : [],
  ]);
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <ScanBarcode className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Movimientos de inventario
            </h1>
            <p className="text-sm text-muted-foreground">
              Transferí stock entre depósitos y registrá ingresos por escaneo.
            </p>
          </div>
        </div>

        <TransferenciasPanel variantes={variantes} depositos={depositos} transferencias={transferencias} puedeTransferir={puedeTransferir} puedeConfirmar={puedeConfirmar} />

        <div className="border-t pt-6"><h2 className="mb-1 text-xl font-bold text-gray-900">Ingreso por escaneo</h2><p className="mb-5 text-sm text-muted-foreground">Registrá ingresos externos al sistema.</p></div>
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
