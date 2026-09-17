/**
 * @page DetallePresupuestoPage
 * @route /ventas/presupuestos/[id]
 *
 * Detalle de un Presupuesto (HU-B3, spec_modulo_B.md §2.3/§3.1). RSC:
 * resuelve sesión + permisos y trae el detalle — la lectura ya aplica la
 * transición perezosa EMITIDO → VENCIDO (`obtenerPresupuesto()`).
 *
 * Única acción de esta pantalla: "Aceptar y convertir a pedido"
 * (EMITIDO → PedidoVenta RESERVADO), visible solo con
 * `ventas:emitir_cotizacion` y estado EMITIDO. HU-B3 no define una pantalla
 * de detalle de PedidoVenta propia (fuera de alcance) — el pedido generado
 * se muestra inline acá, con su número y estado.
 */

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, FileText, Ban, Clock } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  obtenerPresupuesto,
  PERMISO_VENTAS_LEER,
  PERMISO_VENTAS_EMITIR_COTIZACION,
} from "@/lib/services/ventas/presupuesto.service";
import { EstadoPresupuestoBadge } from "@/components/ventas/EstadoPresupuestoBadge";
import { EstadoPedidoVentaBadge } from "@/components/ventas/EstadoPedidoVentaBadge";
import { DialogAceptarPresupuesto } from "@/components/ventas/DialogAceptarPresupuesto";

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

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

function formatFechaHora(fecha: Date | null): string {
  if (!fecha) return "—";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(fecha),
  );
}

export default async function DetallePresupuestoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeLeer = await usuarioTienePermiso(session.userId, PERMISO_VENTAS_LEER);
  if (!puedeLeer) redirect("/no-autorizado");

  const { id } = await params;
  const [presupuesto, puedeEmitir] = await Promise.all([
    obtenerPresupuesto(id),
    usuarioTienePermiso(session.userId, PERMISO_VENTAS_EMITIR_COTIZACION),
  ]);
  if (!presupuesto) notFound();

  const mostrarBotonAceptar =
    puedeEmitir && presupuesto.estado === "EMITIDO" && !presupuesto.pedido_venta;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <Link
          href="/ventas/presupuestos"
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al listado
        </Link>

        {/* ── Encabezado ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                {presupuesto.cliente_nombre}
              </h1>
              <EstadoPresupuestoBadge estado={presupuesto.estado} />
            </div>
            <p className="text-sm text-muted-foreground">
              Vigencia: {presupuesto.vigencia_dias} día(s) — hasta{" "}
              {formatFechaHora(presupuesto.vigencia_hasta)}
            </p>
            {presupuesto.creado_por_nombre && (
              <p className="text-xs text-muted-foreground">
                Emitido por {presupuesto.creado_por_nombre}
              </p>
            )}
          </div>

          {mostrarBotonAceptar && (
            <div className="shrink-0">
              <DialogAceptarPresupuesto presupuestoId={presupuesto.id} />
            </div>
          )}
        </div>

        {/* ── Aviso de vencimiento ────────────────────────────────────── */}
        {presupuesto.estado === "VENCIDO" && (
          <Alert variant="destructive">
            <Clock className="size-4" aria-hidden="true" />
            <AlertDescription>
              El presupuesto venció el {formatFechaHora(presupuesto.vigencia_hasta)} sin
              conversión a pedido.
              {presupuesto.deletion_reason ? ` ${presupuesto.deletion_reason}.` : ""}
            </AlertDescription>
          </Alert>
        )}

        {/* ── Pedido generado ─────────────────────────────────────────── */}
        {presupuesto.pedido_venta && (
          <Alert>
            <FileText className="size-4" aria-hidden="true" />
            <AlertDescription className="flex items-center gap-2">
              Convertido al pedido de venta{" "}
              <span className="font-mono font-semibold">
                {presupuesto.pedido_venta.numero_venta}
              </span>
              <EstadoPedidoVentaBadge estado={presupuesto.pedido_venta.estado} />
            </AlertDescription>
          </Alert>
        )}

        {/* ── Condiciones comerciales ─────────────────────────────────── */}
        {presupuesto.condiciones_comerciales && (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-semibold">Condiciones comerciales</CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <p className="text-sm whitespace-pre-wrap text-gray-700">
                {presupuesto.condiciones_comerciales}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Ítems ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-blue-500" aria-hidden="true" />
              Ítems ({presupuesto.items.length})
            </CardTitle>
            <CardDescription>
              Cada ítem tiene su propia reserva de stock congelada en Módulo A.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Variante
                    </th>
                    <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Depósito
                    </th>
                    <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Cantidad
                    </th>
                    <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Precio cotizado
                    </th>
                    <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {presupuesto.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3">
                        <div className="font-mono text-xs font-semibold">{item.sku}</div>
                        <div className="text-xs text-muted-foreground">{item.descripcion}</div>
                      </td>
                      <td className="py-3 text-muted-foreground">{item.deposito_nombre}</td>
                      <td className="py-3 text-right tabular-nums">{item.cantidad}</td>
                      <td className="py-3 text-right tabular-nums">
                        {money.format(item.precio_cotizado)}
                      </td>
                      <td className="py-3 text-right tabular-nums font-medium">
                        {money.format(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border">
                  <tr>
                    <td colSpan={4} className="py-3 text-right text-sm font-semibold">
                      Total cotizado
                    </td>
                    <td className="py-3 text-right tabular-nums text-base font-bold">
                      {money.format(presupuesto.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {presupuesto.deleted_at && presupuesto.estado !== "VENCIDO" && (
          <Alert variant="destructive">
            <Ban className="size-4" aria-hidden="true" />
            <AlertDescription>
              Presupuesto dado de baja el {formatFechaHora(presupuesto.deleted_at)}.
              {presupuesto.deletion_reason ? ` Motivo: ${presupuesto.deletion_reason}` : ""}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  );
}
