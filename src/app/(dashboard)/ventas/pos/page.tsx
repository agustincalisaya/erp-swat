/**
 * @page VentaMostradorPage
 * @route /ventas/pos
 *
 * Venta de mostrador con cobro multimedio (HU-B1, spec_modulo_B.md §2.1).
 * React Server Component: resuelve sesión + permiso, precarga los
 * selectores (clientes activos, variantes activas, depósitos activos) y
 * consulta `obtenerTurnoAbiertoDeUsuario()` para bloquear el formulario con
 * un mensaje claro si el Cajero no tiene turno abierto — el backend igual
 * revalida esto como precondición dura (`422 SIN_TURNO_ABIERTO`), esto es
 * solo UX preventiva (mismo criterio que `/ventas/turnos`).
 *
 * Gate de acceso: `ventas:registrar_venta_mostrador` (exclusivo Cajero POS,
 * spec §2.1 — Supervisor de Ventas no tiene `✓` directo para esta acción).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingCart, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { obtenerTurnoAbiertoDeUsuario } from "@/lib/services/ventas/turno-caja.service";
import {
  listarClientesParaSelector,
  listarVariantesParaCotizacion,
} from "@/lib/services/ventas/presupuesto.service";
import { listarDepositosActivos } from "@/lib/services/inventario/deposito.service";
import { PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR } from "@/lib/services/ventas/venta-mostrador.service";
import { FormularioVentaMostrador } from "@/components/ventas/FormularioVentaMostrador";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Venta de mostrador — ERP SWAT",
  description: "Venta de mostrador con cobro multimedio (Módulo B).",
};

export default async function VentaMostradorPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_VENTAS_REGISTRAR_VENTA_MOSTRADOR);
  if (!autorizado) redirect("/no-autorizado");

  let turnoAbierto;
  let clientes;
  let variantes;
  let depositos;
  try {
    [turnoAbierto, clientes, variantes, depositos] = await Promise.all([
      obtenerTurnoAbiertoDeUsuario(session.userId),
      listarClientesParaSelector(),
      listarVariantesParaCotizacion(),
      listarDepositosActivos(),
    ]);
  } catch (err) {
    console.error("[VentaMostradorPage] Error al precargar la pantalla:", err);
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudo cargar la pantalla de venta. Verificá la conexión con
              la base de datos.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <ShoppingCart className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Venta de mostrador
            </h1>
            <p className="text-sm text-muted-foreground">
              Cobro multimedio, con selección manual del tipo de comprobante.
            </p>
          </div>
        </div>

        {!turnoAbierto ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription className="flex flex-col gap-2">
              <span>
                No tenés un turno de caja abierto — es un requisito previo
                para registrar una venta de mostrador.
              </span>
              <Link
                href="/ventas/turnos"
                className={`${buttonVariants({ variant: "outline", size: "sm" })} w-fit`}
              >
                Abrir turno de caja
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-semibold">Datos de la venta</CardTitle>
              <CardDescription>
                Agregá los ítems, indicá el/los medio(s) de pago y elegí el
                tipo de comprobante antes de confirmar.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <FormularioVentaMostrador
                clientes={clientes}
                variantes={variantes}
                depositos={depositos}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
