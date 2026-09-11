/**
 * @page HistorialMovimientosPage
 * @route /inventario/movimientos/historial
 *
 * HU-A11 (spec_modulo_A.md §2.10) — historial operativo de `MovimientoStock`,
 * accesible bajo el permiso `inventario:movimientos:leer_historico`.
 * Estructuralmente distinto de la Consola de Auditoría Forense (HU-A6): no
 * expone verificación de cadena SHA-256, es una vista de conveniencia
 * operativa.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { listarDepositosActivos } from "@/lib/services/inventario/deposito.service";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HistorialMovimientos } from "@/components/inventario/HistorialMovimientos";

export const metadata = {
  title: "Historial de Movimientos — ERP SWAT",
  description: "Historial operativo de movimientos de stock.",
};

export default async function HistorialMovimientosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, "inventario:movimientos:leer_historico");
  if (!autorizado) redirect("/no-autorizado");

  const depositos = await listarDepositosActivos();

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-xl bg-blue-100 p-2 text-blue-600">
              <History className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">Historial de Movimientos</h1>
              <p className="text-sm text-muted-foreground">Ingresos, egresos, transferencias y ajustes de stock.</p>
            </div>
          </div>
          <Link href="/inventario/movimientos" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="size-4" /> Volver a movimientos
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Movimientos registrados</CardTitle>
            <CardDescription>Consulta de solo lectura sobre movimientos de stock activos.</CardDescription>
          </CardHeader>
          <CardContent>
            <HistorialMovimientos depositos={depositos} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
