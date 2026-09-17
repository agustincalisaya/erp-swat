/**
 * @page NuevoPresupuestoPage
 * @route /ventas/presupuestos/nueva
 *
 * Formulario de alta de un Presupuesto con congelamiento de stock (HU-B3,
 * spec_modulo_B.md §2.3). RSC: resuelve sesión + permiso y precarga los
 * selectores (clientes activos, variantes activas, depósitos activos). El
 * submit lo maneja `FormularioNuevoPresupuesto` contra la Server Action
 * `crearPresupuestoAction`.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FilePlus2, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarClientesParaSelector,
  listarVariantesParaCotizacion,
  PERMISO_VENTAS_EMITIR_COTIZACION,
} from "@/lib/services/ventas/presupuesto.service";
import { listarDepositosActivos } from "@/lib/services/inventario/deposito.service";
import { FormularioNuevoPresupuesto } from "@/components/ventas/FormularioNuevoPresupuesto";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Nuevo Presupuesto — ERP SWAT",
  description: "Alta de una cotización con reserva de stock (Módulo B).",
};

export default async function NuevoPresupuestoPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_VENTAS_EMITIR_COTIZACION);
  if (!autorizado) redirect("/no-autorizado");

  let clientes;
  let variantes;
  let depositos;
  try {
    [clientes, variantes, depositos] = await Promise.all([
      listarClientesParaSelector(),
      listarVariantesParaCotizacion(),
      listarDepositosActivos(),
    ]);
  } catch (err) {
    console.error("[NuevoPresupuestoPage] Error al precargar selectores:", err);
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudieron cargar clientes, variantes y depósitos. Verificá
              la conexión con la base de datos.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <Link
          href="/ventas/presupuestos"
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al listado
        </Link>

        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <FilePlus2 className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Nuevo presupuesto
            </h1>
            <p className="text-sm text-muted-foreground">
              Al emitir, se congela stock por cada ítem cotizado — la vigencia
              en días determina el TTL de la reserva.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-sm font-semibold">Datos de la cotización</CardTitle>
            <CardDescription>
              Elegí el cliente y agregá las variantes con su depósito, cantidad
              y precio cotizado.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <FormularioNuevoPresupuesto
              clientes={clientes}
              variantes={variantes}
              depositos={depositos}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
