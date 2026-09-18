/**
 * @page CuentasCorrientesPage
 * @route /ventas/cuentas-corrientes
 *
 * Listado de cuentas corrientes de clientes (HU-B5, spec_modulo_B.md §2.5).
 * RSC: resuelve sesión + permiso y consulta el servicio directamente.
 * Gate de acceso: `ventas:gestionar_cuenta_corriente` (Cajero POS y
 * Supervisor de Ventas). El alta de la cuenta y de su límite inicial está
 * fuera de alcance de HU-B5 (se asume preexistente).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet, ChevronRight } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarCuentasCorrientes,
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
} from "@/lib/services/ventas/cuenta-corriente.service";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cuentas corrientes — ERP SWAT",
  description: "Cuenta corriente de clientes y autorización de excepciones de crédito (Módulo B).",
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

export default async function CuentasCorrientesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeGestionar = await usuarioTienePermiso(
    session.userId,
    PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
  );
  if (!puedeGestionar) redirect("/no-autorizado");

  const cuentas = await listarCuentasCorrientes();

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Wallet className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Cuentas corrientes</h1>
            <p className="text-sm text-muted-foreground">
              Límite de crédito, saldo y operaciones retenidas por cliente.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="size-4 text-blue-500" aria-hidden="true" />
              Clientes con cuenta corriente ({cuentas.length})
            </CardTitle>
            <CardDescription>
              Una operación que excede el disponible queda retenida hasta que un Supervisor de
              Ventas la apruebe o la rechace.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {cuentas.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Todavía no hay cuentas corrientes registradas.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Cliente
                      </th>
                      <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Límite
                      </th>
                      <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Saldo
                      </th>
                      <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Disponible
                      </th>
                      <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Retenidas
                      </th>
                      <th className="py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cuentas.map((c) => (
                      <tr key={c.cliente_id}>
                        <td className="py-3 font-medium">{c.cliente_nombre}</td>
                        <td className="py-3 text-right tabular-nums">
                          {money.format(c.limite_credito_autorizado)}
                        </td>
                        <td className="py-3 text-right tabular-nums">{money.format(c.saldo_actual)}</td>
                        <td
                          className={`py-3 text-right tabular-nums ${c.disponible < 0 ? "text-red-600 font-semibold" : ""}`}
                        >
                          {money.format(c.disponible)}
                        </td>
                        <td className="px-3 py-3">
                          {c.operaciones_retenidas > 0 ? (
                            <Badge className="bg-amber-100 text-amber-700 border border-amber-200 font-medium">
                              {c.operaciones_retenidas} pendiente{c.operaciones_retenidas === 1 ? "" : "s"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <Link
                            href={`/ventas/cuentas-corrientes/${c.cliente_id}`}
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                          >
                            Ver cuenta
                            <ChevronRight className="size-4" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
