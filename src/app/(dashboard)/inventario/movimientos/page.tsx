/**
 * @page MovimientosPage
 * @route /inventario/movimientos
 *
 * Server Component encargado de cargar los datos necesarios para las
 * operaciones de inventario y aplicar RBAC antes de renderizar la página.
 *
 * La página admite distintas capacidades dentro del mismo módulo:
 * - Registrar ingresos de stock.
 * - Transferir stock entre depósitos.
 * - Confirmar recepción de transferencias.
 *
 * El acceso se permite si el usuario posee al menos una de estas capacidades.
 * Cada operación mantiene además su autorización granular en Server Actions
 * y Route Handlers.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ScanBarcode, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";

import { listarDepositosActivos } from "@/lib/services/inventario/deposito.service";
import { usuarioPuedeRegistrarIngresoStock } from "@/lib/services/inventario/movimiento.service";
import {
  listarTransferenciasPendientes,
  listarVariantesTransferibles,
} from "@/lib/services/inventario/transferencia.service";

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
          No se pudieron cargar los depósitos. Verificá la conexión con la base
          de datos.
        </AlertDescription>
      </Alert>
    );
  }

  return <IngresoEscaneoPanel depositos={depositos} />;
}

export default async function MovimientosPage() {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  const [puedeRegistrarIngreso, puedeTransferir, puedeConfirmar] =
    await Promise.all([
      usuarioPuedeRegistrarIngresoStock(session.userId),
      usuarioTienePermiso(
        session.userId,
        "inventario:transferir_stock",
      ),
      usuarioTienePermiso(
        session.userId,
        "inventario:confirmar_recepcion",
      ),
    ]);

  if (!puedeRegistrarIngreso && !puedeTransferir && !puedeConfirmar) {
    redirect("/no-autorizado");
  }

  const [depositos, variantes, transferencias] = await Promise.all([
    listarDepositosActivos(),
    puedeTransferir ? listarVariantesTransferibles() : [],
    puedeTransferir || puedeConfirmar ? listarTransferenciasPendientes() : [],
  ]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-xl bg-blue-100 p-2 text-blue-600">
            <ScanBarcode className="size-5" aria-hidden="true" />
          </div>

          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              Movimientos de inventario
            </h1>
            <p className="text-sm text-muted-foreground">
              Transferí stock entre depósitos y registrá ingresos por escaneo.
            </p>
          </div>
        </div>

        {(puedeTransferir || puedeConfirmar) && (
          <TransferenciasPanel
            variantes={variantes}
            depositos={depositos}
            transferencias={transferencias}
            puedeTransferir={puedeTransferir}
            puedeConfirmar={puedeConfirmar}
          />
        )}

        {puedeRegistrarIngreso && (
          <>
            <div className="border-t pt-6">
              <h2 className="mb-1 text-xl font-bold text-gray-900">
                Ingreso por escaneo
              </h2>
              <p className="mb-5 text-sm text-muted-foreground">
                Registrá ingresos externos al sistema.
              </p>
            </div>

            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                  Cargando depósitos…
                </div>
              }
            >
              <IngresoEscaneoData />
            </Suspense>
          </>
        )}
      </div>
    </main>
  );
}
