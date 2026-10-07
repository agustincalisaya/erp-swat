/**
 * @page PreparacionPickPackPage
 * @route /ecommerce/preparacion
 *
 * Consola operativa de Pick & Pack / Click & Collect (HU-E12 T09).
 * React Server Component: verifica sesión y gates por permiso real —
 * acceso a la pantalla por `ecommerce:leer_cola_preparacion`, y las
 * capacidades (`ecommerce:preparar_pedido`, `ecommerce:priorizar_cola`,
 * `ecommerce:validar_retiro_qr`) se
 * pasan a la consola cliente para el control visual por permiso.
 */
import { redirect } from "next/navigation";
import { ScanBarcode } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ConsolaPickPack } from "@/components/ecommerce/ConsolaPickPack";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Preparación de pedidos — ERP SWAT",
  description: "Cola Pick & Pack / Click & Collect (Módulo E).",
};

export default async function PreparacionPickPackPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [puedeLeer, puedePreparar, puedePriorizar, puedeValidarRetiro] = await Promise.all([
    usuarioTienePermiso(session.userId, "ecommerce:leer_cola_preparacion"),
    usuarioTienePermiso(session.userId, "ecommerce:preparar_pedido"),
    usuarioTienePermiso(session.userId, "ecommerce:priorizar_cola"),
    usuarioTienePermiso(session.userId, "ecommerce:validar_retiro_qr"),
  ]);
  if (!puedeLeer) redirect("/no-autorizado");

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-xl bg-blue-100 p-2 text-blue-600">
            <ScanBarcode className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              Preparación de pedidos
            </h1>
            <p className="text-sm text-muted-foreground">
              Cola de Pick &amp; Pack para pedidos web pagados (Click &amp; Collect).
            </p>
          </div>
        </div>

        <ConsolaPickPack
          puedePreparar={puedePreparar}
          puedePriorizar={puedePriorizar}
          puedeValidarRetiro={puedeValidarRetiro}
          usuarioId={session.userId}
        />
      </div>
    </main>
  );
}
