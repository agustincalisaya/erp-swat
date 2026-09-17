/**
 * @page PresupuestosPage
 * @route /ventas/presupuestos
 *
 * Listado de presupuestos (HU-B3, spec_modulo_B.md §2.3). React Server
 * Component: resuelve sesión + permiso, consulta el servicio directamente
 * (sin fetch HTTP) — mismo patrón que `/compras/ordenes`.
 *
 * Gate de acceso: `ventas:leer` (lectura del módulo, separada de
 * `ventas:emitir_cotizacion`).
 */

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, FilePlus2, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarPresupuestos,
  PERMISO_VENTAS_LEER,
  PERMISO_VENTAS_EMITIR_COTIZACION,
} from "@/lib/services/ventas/presupuesto.service";
import { TablaPresupuestos } from "@/components/ventas/TablaPresupuestos";

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
  title: "Presupuestos — ERP SWAT",
  description: "Cotizaciones con reserva de stock y conversión a pedido de venta (Módulo B).",
};

async function PresupuestosData() {
  let presupuestos;
  try {
    presupuestos = await listarPresupuestos();
  } catch (err) {
    console.error("[PresupuestosPage] Error al obtener el listado:", err);
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertDescription>
          No se pudo cargar el listado de presupuestos. Verificá la conexión
          con la base de datos.
        </AlertDescription>
      </Alert>
    );
  }

  return <TablaPresupuestos presupuestos={presupuestos} />;
}

export default async function PresupuestosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [puedeLeer, puedeEmitir] = await Promise.all([
    usuarioTienePermiso(session.userId, PERMISO_VENTAS_LEER),
    usuarioTienePermiso(session.userId, PERMISO_VENTAS_EMITIR_COTIZACION),
  ]);
  if (!puedeLeer) redirect("/no-autorizado");

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header + CTA ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
              <FileText className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                Presupuestos
              </h1>
              <p className="text-sm text-muted-foreground">
                Cotizaciones con reserva de stock y conversión a pedido de venta.
              </p>
            </div>
          </div>
          {puedeEmitir && (
            <div className="pl-12 sm:pl-0">
              <Link
                href="/ventas/presupuestos/nueva"
                className={`${buttonVariants()} bg-blue-600 hover:bg-blue-700 text-white gap-2`}
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                Nuevo presupuesto
              </Link>
            </div>
          )}
        </div>

        {/* ── Tabla en Card ──────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-blue-500" aria-hidden="true" />
              Presupuestos emitidos
            </CardTitle>
            <CardDescription>
              Incluye los vencidos — la baja lógica preserva la fila para
              trazabilidad.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Cargando presupuestos…
                </div>
              }
            >
              <PresupuestosData />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
