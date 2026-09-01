/**
 * @page MovimientosPage
 * @route /inventario/movimientos
 *
 * Server Component encargado de cargar los datos necesarios para las
 * operaciones de inventario y aplicar RBAC antes de renderizar la página.
 *
 * HU-A11 (spec_modulo_A.md §2.10): la carga de movimientos (ingreso y
 * transferencia) se hace a través de un único wizard de 3 pasos
 * (`MovimientoWizard`), que reemplaza los paneles independientes de HU-A2 e
 * HU-A4. "Confirmar recepción" de transferencias vive en su propia sección
 * (`RecepcionesPendientesPanel`), separada del formulario de despacho.
 *
 * El acceso se permite si el usuario posee al menos una de estas capacidades.
 * Cada operación mantiene además su autorización granular en Server Actions
 * y Route Handlers.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { History, ScanBarcode } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";

import { listarDepositosActivos } from "@/lib/services/inventario/deposito.service";
import { usuarioPuedeRegistrarIngresoStock } from "@/lib/services/inventario/movimiento.service";
import {
  listarTransferenciasPendientes,
  listarVariantesTransferibles,
} from "@/lib/services/inventario/transferencia.service";

import { MovimientoWizard } from "@/components/inventario/wizard/MovimientoWizard";
import { RecepcionesPendientesPanel } from "@/components/inventario/RecepcionesPendientesPanel";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "Movimientos de Inventario — ERP SWAT",
  description: "Ingresos y transferencias internas de mercadería.",
};

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-xl bg-blue-100 p-2 text-blue-600">
              <ScanBarcode className="size-5" aria-hidden="true" />
            </div>

            <div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">
                Movimientos de inventario
              </h1>
              <p className="text-sm text-muted-foreground">
                Registrá ingresos y transferencias de mercadería entre depósitos.
              </p>
            </div>
          </div>
          <Link href="/inventario/movimientos/historial" className={buttonVariants({ variant: "outline" })}>
            <History className="size-4" /> Historial de movimientos
          </Link>
        </div>

        {(puedeRegistrarIngreso || puedeTransferir) && (
          <MovimientoWizard
            depositos={depositos}
            variantes={variantes}
            puedeRegistrarIngreso={puedeRegistrarIngreso}
            puedeTransferir={puedeTransferir}
          />
        )}

        {puedeConfirmar && (
          <div className="border-t pt-6">
            <RecepcionesPendientesPanel transferencias={transferencias} puedeConfirmar={puedeConfirmar} />
          </div>
        )}
      </div>
    </main>
  );
}
