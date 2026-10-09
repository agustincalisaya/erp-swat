"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { ComprobanteWeb, PedidoWebDetalle } from "@/lib/services/ecommerce/mis-pedidos.service";
import { CancelarPedidoWeb } from "@/components/ecommerce/CancelarPedidoWeb";
import { EstadoPedidoWebBadge } from "@/components/ecommerce/MisPedidosListado";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatearFechaHoraNegocio } from "@/lib/utils/fecha-negocio";

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export function DetallePedidoWeb({
  pedido,
  estado,
}: {
  pedido: PedidoWebDetalle | null;
  estado?: "cargando" | "sesion_no_disponible" | "no_encontrado" | "error";
}) {
  const [pedidoActual, setPedidoActual] = useState(pedido);
  const mensaje = estado === "cargando" ? "Cargando pedido…" :
    estado === "sesion_no_disponible" ? "Iniciá sesión como Cliente Web para ver este pedido." :
      estado === "error" ? "No pudimos cargar el pedido. Intentá nuevamente." :
        !pedidoActual ? "El pedido solicitado no existe." : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <Link href="/tienda/cuenta/pedidos" className={buttonVariants({ variant: "ghost", size: "sm", className: "px-0 text-muted-foreground" })}>
        Volver a mis pedidos
      </Link>

      {mensaje ? (
        <Card role={estado === "error" ? "alert" : "status"}>
          <CardHeader>
            <CardTitle>{mensaje}</CardTitle>
          </CardHeader>
        </Card>
      ) : pedidoActual && (
        <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pedido {pedidoActual.numero}</h1>
              <p className="text-sm text-muted-foreground">Fecha del pedido: {formatearFechaHoraNegocio(pedidoActual.fecha)}</p>
            </div>
            <EstadoPedidoWebBadge estado={pedidoActual.estado} />
          </header>

          <CancelarPedidoWeb
            pedidoId={pedidoActual.id}
            numero={pedidoActual.numero}
            estado={pedidoActual.estado}
            onCancelado={() => setPedidoActual((actual) => actual ? { ...actual, estado: "CANCELADO", qr_data_url: null } : actual)}
          />

          <PedidoFinalizado pedido={pedidoActual} />

          <Card>
            <CardHeader>
              <CardTitle>Productos</CardTitle>
              <CardDescription>Detalle de los artículos comprados.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {pedidoActual.items.map((item, index) => (
                  <li key={`${item.sku}-${index}`} className="flex flex-col gap-2 py-4 text-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">{item.producto}</p>
                      <p className="text-muted-foreground">{item.sku} · {item.talle} · {item.color}</p>
                    </div>
                    <div className="text-sm sm:text-right">
                      <p className="font-medium">{pesos.format(item.precio_unitario)}</p>
                      <p className="text-muted-foreground">{item.cantidad} u.</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-base">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold">{pesos.format(pedidoActual.total)}</span>
            </CardContent>
          </Card>

          {pedidoActual.qr_data_url ? (
            <Card>
              <CardHeader>
                <CardTitle>Pedido listo para retirar</CardTitle>
                <CardDescription>Presentá este código QR al momento del retiro.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Image src={pedidoActual.qr_data_url} alt="Código QR para retirar el pedido" width={220} height={220} unoptimized className="h-auto w-full max-w-55" />
                {pedidoActual.plazo_retiro_vencimiento && (
                  <p className="text-sm"><span className="font-medium">Plazo de retiro:</span> {formatearFechaHoraNegocio(pedidoActual.plazo_retiro_vencimiento)}</p>
                )}
              </CardContent>
            </Card>
          ) : pedidoActual.estado === "LISTO_PARA_RETIRO" ? (
            <Card>
              <CardHeader>
                <CardTitle>Retiro</CardTitle>
                <CardDescription>El código de retiro no está disponible.</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {pedidoActual.comprobante && (
            <Card>
              <CardHeader>
                <CardTitle>Comprobante</CardTitle>
                <CardDescription>Información fiscal emitida para esta compra.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <DatosComprobante comprobante={pedidoActual.comprobante} />
                <p className="border-t pt-3 text-muted-foreground">Comprobante no disponible para descarga.</p>
              </CardContent>
            </Card>
          )}

          {pedidoActual.nota_credito && (
            <Card>
              <CardHeader>
                <CardTitle>Nota de crédito</CardTitle>
                <CardDescription>Emitida por la cancelación de esta compra. El comprobante original no se modifica.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <DatosComprobante comprobante={pedidoActual.nota_credito} />
                <p className="border-t pt-3 text-muted-foreground">Nota de crédito no disponible para descarga.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </main>
  );
}

const TEXTO_REINTEGRO: Record<NonNullable<PedidoWebDetalle["reintegro_estado"]>, string> = {
  PENDIENTE: "Reintegro en proceso",
  APROBADO: "Reintegro completado",
  RECHAZADO: "Reintegro rechazado",
};

function PedidoFinalizado({ pedido }: { pedido: PedidoWebDetalle }) {
  const { motivo, fecha_terminacion: fechaTerminacion, reintegro_estado: reintegro } = pedido;
  if (!motivo && !fechaTerminacion && !reintegro) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{pedido.estado === "VENCIDO_SIN_RETIRO" ? "Pedido vencido" : "Pedido cancelado"}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {motivo && (
            <div>
              <dt className="text-muted-foreground">Motivo</dt>
              <dd className="font-medium break-words">{motivo}</dd>
            </div>
          )}
          {fechaTerminacion && (
            <div>
              <dt className="text-muted-foreground">Fecha</dt>
              <dd className="font-medium">{formatearFechaHoraNegocio(fechaTerminacion)}</dd>
            </div>
          )}
          {reintegro && (
            <div>
              <dt className="text-muted-foreground">Reintegro</dt>
              <dd className="font-medium">{TEXTO_REINTEGRO[reintegro]}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

function DatosComprobante({ comprobante }: { comprobante: ComprobanteWeb }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">Tipo</dt>
        <dd className="font-medium">{comprobante.tipo.replaceAll("_", " ")}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Emitido</dt>
        <dd className="font-medium">{formatearFechaHoraNegocio(comprobante.fecha_emision)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Monto</dt>
        <dd className="font-medium">{pesos.format(comprobante.monto)}</dd>
      </div>
    </dl>
  );
}
