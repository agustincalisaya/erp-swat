/**
 * @page DetalleCuentaCorrientePage
 * @route /ventas/cuentas-corrientes/[cliente_id]
 *
 * Detalle de la cuenta corriente de un cliente (HU-B5, spec_modulo_B.md
 * §2.5): límite, saldo, disponible e historial de operaciones con su badge de
 * estado. La acción "Resolver excepción" (aprobar/rechazar una operación
 * RETENIDA) se muestra solo a quien tiene `ventas:autorizar_excepcion_credito`
 * (Supervisor de Ventas) — gate en el RSC, mismo patrón que HU-B4.
 */

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  obtenerCuentaCorrienteDetalle,
  PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO,
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
} from "@/lib/services/ventas/cuenta-corriente.service";
import { ClienteCuentaCorrienteIdSchema } from "@/lib/schemas/ventas.schema";
import { EstadoOperacionCCBadge } from "@/components/ventas/EstadoOperacionCCBadge";
import { DialogResolverExcepcionCredito } from "@/components/ventas/DialogResolverExcepcionCredito";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

export default async function DetalleCuentaCorrientePage({
  params,
}: {
  params: Promise<{ cliente_id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeGestionar = await usuarioTienePermiso(
    session.userId,
    PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
  );
  if (!puedeGestionar) redirect("/no-autorizado");

  const { cliente_id } = await params;
  if (!ClienteCuentaCorrienteIdSchema.safeParse(cliente_id).success) notFound();

  const [cuenta, puedeResolver] = await Promise.all([
    obtenerCuentaCorrienteDetalle(cliente_id),
    usuarioTienePermiso(session.userId, PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO),
  ]);
  if (!cuenta) notFound();

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <Link
          href="/ventas/cuentas-corrientes"
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver a cuentas corrientes
        </Link>

        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Wallet className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">{cuenta.cliente_nombre}</h1>
            <p className="text-sm text-muted-foreground">Cuenta corriente</p>
          </div>
        </div>

        {/* ── Resumen ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Límite autorizado
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {money.format(cuenta.limite_credito_autorizado)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Saldo actual
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">{money.format(cuenta.saldo_actual)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Disponible
              </p>
              <p
                className={`mt-1 text-lg font-bold tabular-nums ${cuenta.disponible < 0 ? "text-red-600" : ""}`}
              >
                {money.format(cuenta.disponible)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── Operaciones ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="size-4 text-blue-500" aria-hidden="true" />
              Operaciones ({cuenta.operaciones.length})
            </CardTitle>
            <CardDescription>
              Solo las operaciones aprobadas suman al saldo. Una operación retenida espera la
              decisión de un Supervisor de Ventas.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {cuenta.operaciones.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Esta cuenta todavía no tiene operaciones.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Pedido
                      </th>
                      <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Fecha
                      </th>
                      <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Monto
                      </th>
                      <th className="min-w-[170px] whitespace-nowrap text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                        Estado
                      </th>
                      <th className="py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cuenta.operaciones.map((op) => (
                      <tr key={op.id}>
                        <td className="py-3">
                          <Link
                            href={`/ventas/pedidos/${op.pedido_venta_id}`}
                            className="font-mono text-xs font-semibold text-blue-600 hover:underline"
                          >
                            {op.numero_venta}
                          </Link>
                          {op.plan_de_pagos && op.plan_de_pagos.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Plan de pagos: {op.plan_de_pagos.map((h) => `${h.hito} ${h.porcentaje}%`).join(" · ")}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          {fecha.format(new Date(op.created_at))}
                        </td>
                        <td className="py-3 text-right tabular-nums">{money.format(op.monto)}</td>
                        <td className="px-3 py-3">
                          <div className="space-y-0.5">
                            <EstadoOperacionCCBadge
                              estado={op.estado}
                              autorizadoPorId={op.autorizado_por_id}
                            />
                            {op.autorizado_por_nombre && (
                              <p className="text-xs text-muted-foreground">
                                Resuelta por {op.autorizado_por_nombre}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right">
                          {puedeResolver && op.estado === "RETENIDA" && (
                            <DialogResolverExcepcionCredito
                              operacionId={op.id}
                              itemLabel={op.numero_venta}
                              montoLabel={money.format(op.monto)}
                            />
                          )}
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
