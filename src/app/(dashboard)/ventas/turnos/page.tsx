/**
 * @page TurnosPage
 * @route /ventas/turnos
 *
 * Apertura/cierre de turno de caja con arqueo ciego (HU-B2, task_relos.md §8).
 * React Server Component: resuelve sesión + permiso, consulta
 * `obtenerTurnoAbiertoDeUsuario()` directamente (sin fetch HTTP) — mismo
 * patrón que `/ventas/presupuestos`.
 *
 * Sin listado histórico de turnos en este PR (task §8, igual que HU-B3 dejó
 * el listado completo de pedidos fuera de alcance).
 *
 * Gate de acceso: `ventas:gestionar_turno_caja` — único permiso para abrir Y
 * cerrar (mismo criterio que `ventas:emitir_cotizacion` en Presupuesto).
 */

import { redirect } from "next/navigation";
import { Wallet, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  obtenerTurnoAbiertoDeUsuario,
  PERMISO_VENTAS_GESTIONAR_TURNO_CAJA,
} from "@/lib/services/ventas/turno-caja.service";
import { FormularioTurnoCaja } from "@/components/ventas/FormularioTurnoCaja";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Turno de caja — ERP SWAT",
  description: "Apertura y cierre de turno de caja con arqueo ciego (Módulo B).",
};

export default async function TurnosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_VENTAS_GESTIONAR_TURNO_CAJA);
  if (!autorizado) redirect("/no-autorizado");

  let turnoAbierto;
  try {
    turnoAbierto = await obtenerTurnoAbiertoDeUsuario(session.userId);
  } catch (err) {
    console.error("[TurnosPage] Error al consultar el turno abierto:", err);
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-2xl mx-auto">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudo consultar el turno de caja. Verificá la conexión con
              la base de datos.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Wallet className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Turno de caja
            </h1>
            <p className="text-sm text-muted-foreground">
              {turnoAbierto
                ? "Tenés un turno abierto — cerralo declarando tu conteo físico."
                : "Abrí tu turno declarando el fondo fijo inicial."}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-sm font-semibold">
              {turnoAbierto ? "Cierre de turno" : "Apertura de turno"}
            </CardTitle>
            <CardDescription>
              {turnoAbierto
                ? "Arqueo ciego — el saldo esperado se revela recién después de enviar tu conteo."
                : "Solo puede haber un turno abierto por Cajero a la vez."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <FormularioTurnoCaja turnoAbierto={turnoAbierto} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
