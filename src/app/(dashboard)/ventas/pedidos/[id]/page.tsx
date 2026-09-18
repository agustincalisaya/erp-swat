/**
 * @page DetallePedidoVentaPage
 * @route /ventas/pedidos/[id]
 *
 * Detalle MÍNIMO de un PedidoVenta (HU-B4, spec_modulo_B.md §2.4). RSC:
 * resuelve sesión + permisos y trae el detalle. No es una implementación
 * completa de gestión de `PedidoVenta` (eso corresponde a HU-B1/HU-B3 UI
 * completa, fuera de alcance — docs/tasks/HU-B4.md §2). Sin listado propio
 * `/ventas/pedidos` en esta task: se accede por URL directa o desde el
 * `pedido_venta_id` que `aceptarPresupuesto()` (HU-B3) ya expone en
 * `/ventas/presupuestos/[id]`.
 *
 * Única acción de esta pantalla: "Autorizar excepción" por cada ítem con
 * `requiere_autorizacion: true` y `autorizado_por_id: null` — Dialog gateado
 * por `ventas:autorizar_excepcion_descuento` (mismo patrón que
 * `DialogAceptarPresupuesto` de HU-B3, gateado en el RSC padre).
 */

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { PERMISO_VENTAS_LEER } from "@/lib/services/ventas/presupuesto.service";
import {
  obtenerPedidoVenta,
  listarSupervisoresVentas,
  PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO,
} from "@/lib/services/ventas/pedido-venta.service";
import { EstadoPedidoVentaBadge } from "@/components/ventas/EstadoPedidoVentaBadge";
import { AutorizacionItemBadge } from "@/components/ventas/AutorizacionItemBadge";
import { DialogAutorizarOverrideDescuento } from "@/components/ventas/DialogAutorizarOverrideDescuento";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

export default async function DetallePedidoVentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeLeer = await usuarioTienePermiso(session.userId, PERMISO_VENTAS_LEER);
  if (!puedeLeer) redirect("/no-autorizado");

  const { id } = await params;
  const [pedido, puedeAutorizar] = await Promise.all([
    obtenerPedidoVenta(id),
    usuarioTienePermiso(session.userId, PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO),
  ]);
  if (!pedido) notFound();

  const supervisores = puedeAutorizar ? await listarSupervisoresVentas() : [];

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <Link
          href="/ventas/presupuestos"
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver a presupuestos
        </Link>

        {/* ── Encabezado ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight font-mono">
                {pedido.numero_venta}
              </h1>
              <EstadoPedidoVentaBadge estado={pedido.estado} />
            </div>
            <p className="text-sm text-muted-foreground">
              {pedido.cliente_nombre ?? "Venta de mostrador sin cliente identificado"}
            </p>
          </div>
        </div>

        {/* ── Ítems ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-blue-500" aria-hidden="true" />
              Ítems ({pedido.items.length})
            </CardTitle>
            <CardDescription>
              Ítems con descuento/precio fuera de margen quedan en espera de autorización
              de un Supervisor de Ventas (HU-B4).
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
                    <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Cantidad
                    </th>
                    <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Precio unitario
                    </th>
                    <th className="min-w-[110px] whitespace-nowrap text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Descuento
                    </th>
                    <th className="min-w-[170px] whitespace-nowrap text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Autorización
                    </th>
                    <th className="py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pedido.items.map((item) => {
                    const mostrarAccion =
                      puedeAutorizar && item.requiere_autorizacion && item.autorizado_por_id === null;
                    return (
                      <tr key={item.id}>
                        <td className="py-3">
                          <div className="font-mono text-xs font-semibold">{item.sku}</div>
                          <div className="text-xs text-muted-foreground">{item.descripcion}</div>
                        </td>
                        <td className="py-3 text-right tabular-nums">{item.cantidad}</td>
                        <td className="py-3 text-right tabular-nums">
                          {money.format(item.precio_unitario)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {item.descuento_porcentual !== null ? `${item.descuento_porcentual}%` : "—"}
                        </td>
                        <td className="px-3 py-3">
                          {item.requiere_autorizacion || item.autorizado_por_id !== null ? (
                            <div className="space-y-0.5">
                              <AutorizacionItemBadge
                                requiereAutorizacion={item.requiere_autorizacion}
                                autorizadoPorId={item.autorizado_por_id}
                              />
                              {item.autorizado_por_nombre && (
                                <p className="text-xs text-muted-foreground">
                                  Autorizado por {item.autorizado_por_nombre}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {mostrarAccion && (
                            <DialogAutorizarOverrideDescuento
                              pedidoVentaId={pedido.id}
                              varianteSkuId={item.variante_sku_id}
                              itemLabel={item.sku}
                              supervisores={supervisores}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-border">
                  <tr>
                    <td colSpan={3} className="py-3 text-right text-sm font-semibold">
                      Total del pedido
                    </td>
                    <td colSpan={3} className="py-3 text-right tabular-nums text-base font-bold">
                      {money.format(pedido.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
