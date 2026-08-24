/**
 * @page MovimientosPage
 * @route /inventario/movimientos
 *
 * Server Component: obtiene los depósitos activos en servidor y los pasa
 * como props al panel de escaneo (Client Component).
 *
 * Capa 1 de RBAC (Hallazgo 1) — bloqueo real de acceso, mismo patrón que
 * `auditoria/usuarios/page.tsx` (HU-D10): sin sesión válida redirige a
 * `/login`; con sesión pero sin un rol autorizado
 * (`usuarioPuedeRegistrarIngresoStock()`, único punto de verdad compartido
 * con las Server Actions y el Route Handler REST) redirige a
 * `/no-autorizado`. Antes de esta corrección, un rol de solo lectura
 * (ej. `AUDITOR`) podía abrir esta pantalla y mutar stock real.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ScanBarcode, AlertTriangle } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { listarDepositosActivos } from "@/lib/services/inventario/deposito.service";
import { usuarioPuedeRegistrarIngresoStock } from "@/lib/services/inventario/movimiento.service";
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

export default async function MovimientosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioPuedeRegistrarIngresoStock(session.userId);
  if (!autorizado) redirect("/no-autorizado");

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
