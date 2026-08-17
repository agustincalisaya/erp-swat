/**
 * @page LegajosPruebaPage
 * @route /inventario/legajos-prueba
 *
 * Server Component: obtiene y descifra los legajos en servidor,
 * pasa datos en texto plano a Client Components como props.
 *
 * UI Stack: Shadcn UI Card + Alert — paleta Tailwind CSS blue.
 */

import { Suspense } from "react";
import { ShieldCheck, Lock, AlertTriangle } from "lucide-react";
import { listarLegajosPruebaActivos } from "@/lib/services/inventario/legajo-prueba.service";
import { LegajoPruebaForm } from "@/components/inventario/LegajoPruebaForm";
import { LegajoPruebaTable } from "@/components/inventario/LegajoPruebaTable";

// Shadcn UI
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata = {
  title: "Legajos en Prueba — ERP SWAT",
  description:
    "Gestión de asignaciones de stock en estado de prueba de tallaje para efectivos institucionales.",
};

// ──────────────────────────────────────────────────────────────────────────────
// Server: obtener datos (componente async para Suspense)
// ──────────────────────────────────────────────────────────────────────────────
async function LegajosData() {
  let legajos;
  try {
    legajos = await listarLegajosPruebaActivos();
  } catch (err) {
    console.error("[LegajosPruebaPage] Error al obtener legajos:", err);
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertDescription>
          No se pudieron cargar los legajos. Verificá la conexión con la base de datos.
        </AlertDescription>
      </Alert>
    );
  }

  return <LegajoPruebaTable legajos={legajos} />;
}

// ──────────────────────────────────────────────────────────────────────────────
// Página
// ──────────────────────────────────────────────────────────────────────────────
export default function LegajosPruebaPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* ── Header + CTA ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                Legajos en Prueba
              </h1>
              <p className="text-sm text-muted-foreground">
                Asignaciones de stock temporales a efectivos institucionales.
              </p>
            </div>
          </div>
          <div className="pl-12 sm:pl-0">
            <LegajoPruebaForm />
          </div>
        </div>

        {/* ── Banner de Seguridad ──────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl shrink-0">
              <Lock className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold">Datos protegidos — Ley N.° 25.326</p>
              <p className="text-xs text-blue-100 mt-0.5">
                Los datos identificatorios se cifran con{" "}
                <span className="font-semibold">AES-256-GCM</span> antes de almacenarse. 
              </p>
            </div>
          </div>
          <div className="sm:ml-auto shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/15 text-xs font-semibold">
            <span className="size-2 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
            Cifrado activo
          </div>
        </div>

        {/* ── Tabla en Card ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-blue-500" aria-hidden="true" />
              Asignaciones activas
            </CardTitle>
            <CardDescription>
              Unidades actualmente en poder de efectivos para prueba de tallaje.
            </CardDescription>
            <CardAction>
              <span className="text-xs text-muted-foreground italic flex items-center gap-1">
                <Lock className="size-3" aria-hidden="true" />
                Placas enmascaradas
              </span>
            </CardAction>
          </CardHeader>

          <CardContent className="pt-5">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Cargando legajos…
                </div>
              }
            >
              <LegajosData />
            </Suspense>
          </CardContent>
        </Card>


      </div> 
    </main>
  );
}