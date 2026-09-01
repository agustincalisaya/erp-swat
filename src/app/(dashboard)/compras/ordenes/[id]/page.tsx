/**
 * @page DetalleOrdenCompraPage
 * @route /compras/ordenes/[id]
 *
 * Detalle de una Orden de Compra (HU-H3, spec_modulo_H.md §2.4 / §2.5;
 * Alcance Funcional §2.1 / §5). RSC: resuelve sesión + permisos, trae el
 * detalle y el historial de estado (leído del ledger de auditoría, Módulo D).
 *
 * Acciones de esta pantalla (cada una: botón solo con el permiso granular
 * correspondiente y en el estado válido; el endpoint revalida igual):
 *  - "Enviar orden" (BORRADOR → ENVIADA): `ordenes_compra:enviar`, exclusivo
 *    del Supervisor de Compras. Un Comprador ve el chip "Pendiente de
 *    aprobación del Supervisor de Compras" ("Comprador Solicita / Supervisor
 *    Emite").
 *  - "Confirmar orden" (ENVIADA → CONFIRMADA): `ordenes_compra:confirmar`
 *    (ambos roles). Captura la `fecha_entrega_comprometida` (obligatoria).
 *  - "Cerrar orden" (RECIBIDA_COMPLETA → CERRADA): `ordenes_compra:cerrar`
 *    (ambos roles). Hoy inejercitable end-to-end: nada produce
 *    RECIBIDA_COMPLETA hasta la integración con HU-H4 (Emir).
 *  - "Cancelar orden" (baja lógica): `ordenes_compra:cancelar`, exclusivo del
 *    Supervisor de Compras, en BORRADOR o ENVIADA. Sin permiso, chip de solo
 *    lectura.
 *
 * Fuera de alcance a propósito (ver PR): las transiciones de recepción
 * (CONFIRMADA → RECEPCION_PARCIAL → RECIBIDA_COMPLETA), HU-H4 (Emir).
 */

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  FileText,
  History,
  Ban,
  Hourglass,
  Lock,
  AlertTriangle,
} from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  obtenerOrdenCompra,
  obtenerHistorialOrdenCompra,
  listarVariantesParaOrden,
  PERMISO_POR_ACCION_ORDEN_COMPRA,
} from "@/lib/services/proveedores/orden-compra.service";
import { EstadoOrdenCompraBadge } from "@/components/compras/EstadoOrdenCompraBadge";
import { DialogEnviarOrdenCompra } from "@/components/compras/DialogEnviarOrdenCompra";
import { DialogConfirmarOrdenCompra } from "@/components/compras/DialogConfirmarOrdenCompra";
import { DialogCerrarOrdenCompra } from "@/components/compras/DialogCerrarOrdenCompra";
import { DialogCancelarOrdenCompra } from "@/components/compras/DialogCancelarOrdenCompra";
import { EditorItemsOrdenCompra } from "@/components/compras/EditorItemsOrdenCompra";

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

const ESTADOS_CANCELABLES = new Set(["BORRADOR", "ENVIADA"]);

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

function formatFecha(fecha: Date | null): string | null {
  if (!fecha) return null;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(fecha));
}

/**
 * Formatea una fecha-solo (sin componente horario relevante). Fija `timeZone:
 * "UTC"` para no correr el día: `fecha_entrega_comprometida` se escribe desde
 * un `<input type="date">` y se persiste como medianoche UTC; renderizarla en
 * la TZ local (UTC-3) la mostraría un día antes.
 */
function formatFechaSolo(fecha: Date | null): string | null {
  if (!fecha) return null;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(fecha));
}

function formatFechaHora(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(fecha));
}

export default async function DetalleOrdenCompraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(
    session.userId,
    // Gate de lectura del módulo — misma decisión que el listado.
    "ordenes_compra:crear",
  );
  if (!autorizado) redirect("/no-autorizado");

  const { id } = await params;
  const [orden, puedeEnviar, puedeConfirmar, puedeCerrar, puedeCancelar] =
    await Promise.all([
      obtenerOrdenCompra(id),
      usuarioTienePermiso(session.userId, PERMISO_POR_ACCION_ORDEN_COMPRA.ENVIAR),
      usuarioTienePermiso(session.userId, PERMISO_POR_ACCION_ORDEN_COMPRA.CONFIRMAR),
      usuarioTienePermiso(session.userId, PERMISO_POR_ACCION_ORDEN_COMPRA.CERRAR),
      usuarioTienePermiso(session.userId, PERMISO_POR_ACCION_ORDEN_COMPRA.CANCELAR),
    ]);

  if (!orden) notFound();

  const enBorrador = orden.is_active && orden.estado === "BORRADOR";

  // Las variantes del selector solo hacen falta si la orden es editable.
  const [historial, variantesParaEditar] = await Promise.all([
    obtenerHistorialOrdenCompra(id),
    enBorrador ? listarVariantesParaOrden() : Promise.resolve([]),
  ]);

  // "Comprador Solicita / Supervisor Emite" (Alcance §2.1 / §5): el botón solo
  // para quien tiene `ordenes_compra:enviar` (Supervisor de Compras). El
  // Comprador ve el indicador de solo lectura, nunca el botón.
  const mostrarBotonEnviar = enBorrador && puedeEnviar;
  const mostrarPendienteAprobacion = enBorrador && !puedeEnviar;

  // Confirmar (ENVIADA → CONFIRMADA) y Cerrar (RECIBIDA_COMPLETA → CERRADA):
  // ambos roles, cada uno solo en su estado válido. Cerrar hoy no es
  // ejercitable — nada produce RECIBIDA_COMPLETA sin HU-H4.
  const mostrarBotonConfirmar =
    orden.is_active && orden.estado === "ENVIADA" && puedeConfirmar;
  const mostrarBotonCerrar =
    orden.is_active && orden.estado === "RECIBIDA_COMPLETA" && puedeCerrar;

  // Cancelar (baja lógica) es exclusivo del Supervisor de Compras (decisión
  // final del equipo — revertir una orden impacta la negociación). El
  // Comprador ve un chip de solo lectura en Borrador/Enviada, nunca el botón.
  const cancelablePorEstado =
    orden.is_active && ESTADOS_CANCELABLES.has(orden.estado);
  const mostrarBotonCancelar = puedeCancelar && cancelablePorEstado;
  const mostrarCancelarBloqueado = !puedeCancelar && cancelablePorEstado;

  const entregaComprometida = formatFechaSolo(orden.fecha_entrega_comprometida);
  const entregaPendiente =
    !entregaComprometida && ESTADOS_CANCELABLES.has(orden.estado);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <Link
          href="/compras/ordenes"
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al listado
        </Link>

        {/* ── Encabezado ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight font-mono">
                {orden.numero_orden}
              </h1>
              <EstadoOrdenCompraBadge estado={orden.estado} />
            </div>
            <p className="text-sm text-muted-foreground">
              {orden.proveedor_razon_social}
              {orden.proveedor_nombre_fantasia
                ? ` · ${orden.proveedor_nombre_fantasia}`
                : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Emitida el {formatFecha(orden.fecha_emision)}
              {orden.creada_por_nombre ? ` por ${orden.creada_por_nombre}` : ""}
            </p>
          </div>

          {(mostrarBotonEnviar ||
            mostrarBotonConfirmar ||
            mostrarBotonCerrar ||
            mostrarBotonCancelar ||
            mostrarPendienteAprobacion ||
            mostrarCancelarBloqueado) && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {mostrarBotonEnviar && (
                <DialogEnviarOrdenCompra
                  ordenCompraId={orden.id}
                  numeroOrden={orden.numero_orden}
                />
              )}
              {mostrarBotonConfirmar && (
                <DialogConfirmarOrdenCompra
                  ordenCompraId={orden.id}
                  numeroOrden={orden.numero_orden}
                />
              )}
              {mostrarBotonCerrar && (
                <DialogCerrarOrdenCompra
                  ordenCompraId={orden.id}
                  numeroOrden={orden.numero_orden}
                />
              )}
              {mostrarPendienteAprobacion && (
                <span className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                  <Hourglass className="size-3.5" aria-hidden="true" />
                  Pendiente de aprobación del Supervisor de Compras
                </span>
              )}
              {mostrarBotonCancelar && (
                <DialogCancelarOrdenCompra
                  ordenCompraId={orden.id}
                  numeroOrden={orden.numero_orden}
                />
              )}
              {mostrarCancelarBloqueado && (
                <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Solo el Supervisor de Compras puede cancelar esta orden
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Aviso de cancelación ────────────────────────────────────── */}
        {orden.deleted_at && (
          <Alert variant="destructive">
            <Ban className="size-4" aria-hidden="true" />
            <AlertDescription>
              Orden cancelada el {formatFecha(orden.deleted_at)}.
              {orden.deletion_reason ? ` Motivo: ${orden.deletion_reason}` : ""}
            </AlertDescription>
          </Alert>
        )}

        {/* ── Alerta CA3: incumplimiento de fecha de entrega comprometida ── */}
        {orden.entrega_vencida && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              La fecha de entrega comprometida ({entregaComprometida}) venció y
              la orden todavía no se recibió por completo.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Fechas clave ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4 text-blue-500" aria-hidden="true" />
              Fechas de seguimiento
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Envío</dt>
                <dd className="mt-0.5">{formatFecha(orden.fecha_envio) ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Confirmación</dt>
                <dd className="mt-0.5">{formatFecha(orden.fecha_confirmacion) ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">
                  Entrega comprometida
                </dt>
                <dd
                  className={`mt-0.5 ${orden.entrega_vencida ? "font-semibold text-red-700" : ""}`}
                >
                  {entregaComprometida ? (
                    <>
                      {entregaComprometida}
                      {orden.entrega_vencida && (
                        <span className="ml-1.5 text-xs font-semibold text-red-700">
                          · vencida
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">
                      {entregaPendiente ? "Pendiente de confirmación" : "—"}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase tracking-wide">Cierre</dt>
                <dd className="mt-0.5">{formatFecha(orden.fecha_cierre) ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* ── Ítems ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-blue-500" aria-hidden="true" />
              Ítems ({orden.items.length})
            </CardTitle>
            <CardDescription>
              {enBorrador
                ? "Podés editar los ítems mientras la orden esté en borrador. Una vez enviada quedan bloqueados."
                : "El precio unitario quedó congelado al emitir la orden."}
            </CardDescription>
          </CardHeader>
          <CardContent className={enBorrador ? "pt-5" : "pt-0"}>
            {enBorrador ? (
              <EditorItemsOrdenCompra
                ordenCompraId={orden.id}
                itemsIniciales={orden.items.map((it) => ({
                  variante_sku_id: it.variante_sku_id,
                  sku: it.sku,
                  cantidad_solicitada: it.cantidad_solicitada,
                }))}
                variantes={variantesParaEditar}
              />
            ) : (
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
                    <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orden.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3">
                        <div className="font-mono text-xs font-semibold">{item.sku}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.descripcion}
                        </div>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {item.cantidad_solicitada}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {money.format(item.precio_unitario)}
                      </td>
                      <td className="py-3 text-right tabular-nums font-medium">
                        {money.format(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border">
                  <tr>
                    <td colSpan={3} className="py-3 text-right text-sm font-semibold">
                      Total de la orden
                    </td>
                    <td className="py-3 text-right tabular-nums text-base font-bold">
                      {money.format(orden.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            )}
          </CardContent>
        </Card>

        {/* ── Observaciones ───────────────────────────────────────────── */}
        {orden.observaciones && (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-semibold">Observaciones</CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <p className="text-sm whitespace-pre-wrap text-gray-700">
                {orden.observaciones}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Historial de estado ─────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-blue-500" aria-hidden="true" />
              Historial de estado
            </CardTitle>
            <CardDescription>
              Leído del ledger de auditoría (Módulo D).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            {historial.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Sin eventos registrados.
              </p>
            ) : (
              <ol className="space-y-4">
                {historial.map((mov) => (
                  <li key={mov.id} className="flex gap-3">
                    <div className="mt-1 size-2 rounded-full bg-blue-500 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {mov.estado_anterior && mov.estado_nuevo
                          ? `${mov.estado_anterior} → ${mov.estado_nuevo}`
                          : (mov.estado_nuevo ?? mov.accion)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFechaHora(mov.fecha)}
                        {mov.usuario_nombre ? ` · ${mov.usuario_nombre}` : ""}
                      </p>
                      {mov.detalle && (
                        <p className="text-xs text-gray-600">{mov.detalle}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
