import Link from "next/link";
import Image from "next/image";
import type { PedidoWebDetalle } from "@/lib/services/ecommerce/mis-pedidos.service";
import { EstadoPedidoWebBadge } from "@/components/ecommerce/MisPedidosListado";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

export function DetallePedidoWeb({
  pedido,
  estado,
}: {
  pedido: PedidoWebDetalle | null;
  estado?: "cargando" | "sesion_no_disponible" | "no_encontrado" | "error";
}) {
  const mensaje = estado === "cargando" ? "Cargando pedido…" :
    estado === "sesion_no_disponible" ? "Iniciá sesión como Cliente Web para ver este pedido." :
      estado === "error" ? "No pudimos cargar el pedido. Intentá nuevamente." :
        !pedido ? "El pedido solicitado no existe." : null;

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
      ) : pedido && (
        <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pedido {pedido.numero}</h1>
              <p className="text-sm text-muted-foreground">Fecha del pedido: {fecha.format(new Date(pedido.fecha))}</p>
            </div>
            <EstadoPedidoWebBadge estado={pedido.estado} />
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Productos</CardTitle>
              <CardDescription>Detalle de los artículos comprados.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {pedido.items.map((item, index) => (
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
              <span className="font-semibold">{pesos.format(pedido.total)}</span>
            </CardContent>
          </Card>

          {pedido.qr_data_url ? (
            <Card>
              <CardHeader>
                <CardTitle>Pedido listo para retirar</CardTitle>
                <CardDescription>Presentá este código QR al momento del retiro.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Image src={pedido.qr_data_url} alt="Código QR para retirar el pedido" width={220} height={220} unoptimized className="h-auto w-full max-w-55" />
                {pedido.plazo_retiro_vencimiento && (
                  <p className="text-sm"><span className="font-medium">Plazo de retiro:</span> {fecha.format(new Date(pedido.plazo_retiro_vencimiento))}</p>
                )}
              </CardContent>
            </Card>
          ) : pedido.estado === "LISTO_PARA_RETIRO" ? (
            <Card>
              <CardHeader>
                <CardTitle>Retiro</CardTitle>
                <CardDescription>El código de retiro no está disponible.</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {pedido.comprobante && (
            <Card>
              <CardHeader>
                <CardTitle>Comprobante</CardTitle>
                <CardDescription>Información fiscal emitida para esta compra.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <dl className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Tipo</dt>
                    <dd className="font-medium">{pedido.comprobante.tipo.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Emitido</dt>
                    <dd className="font-medium">{fecha.format(new Date(pedido.comprobante.fecha_emision))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Monto</dt>
                    <dd className="font-medium">{pesos.format(pedido.comprobante.monto)}</dd>
                  </div>
                </dl>
                <p className="border-t pt-3 text-muted-foreground">Comprobante no disponible para descarga.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
