import Link from "next/link";
import Image from "next/image";
import type { PedidoWebDetalle } from "@/lib/services/ecommerce/mis-pedidos.service";
import { EstadoPedidoWebBadge } from "@/components/ecommerce/MisPedidosListado";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <Link href="/cuenta/pedidos" className="text-sm text-blue-700 underline-offset-2 hover:underline">Volver a mis pedidos</Link>
      {mensaje ? <p role={estado === "error" ? "alert" : "status"} className="rounded-lg border p-5 text-sm text-muted-foreground">{mensaje}</p> : pedido && (
        <>
          <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Pedido {pedido.numero}</h1>
              <p className="text-sm text-muted-foreground">{fecha.format(new Date(pedido.fecha))}</p>
            </div>
            <EstadoPedidoWebBadge estado={pedido.estado} />
          </header>
          <Card>
            <CardHeader><CardTitle className="text-base">Artículos</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">
                {pedido.items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:justify-between">
                    <div>
                      <p className="font-medium">{item.producto}</p>
                      <p className="text-muted-foreground">{item.sku} · {item.talle} · {item.color} · {item.cantidad} u.</p>
                    </div>
                    <p>{pesos.format(item.precio_unitario)} por unidad</p>
                  </li>
                ))}
              </ul>
              <p className="border-t pt-3 text-right font-semibold">Total: {pesos.format(pedido.total)}</p>
            </CardContent>
          </Card>
          {pedido.comprobante && (
            <Card>
              <CardHeader><CardTitle className="text-base">Comprobante</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{pedido.comprobante.tipo.replaceAll("_", " ")}</p>
                <p>Emitido: {fecha.format(new Date(pedido.comprobante.fecha))}</p>
                <p className="text-muted-foreground">Comprobante no disponible para descarga.</p>
              </CardContent>
            </Card>
          )}
          {pedido.qr_data_url ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Código QR de retiro</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Image src={pedido.qr_data_url} alt="Código QR para retirar el pedido" width={220} height={220} unoptimized className="h-44 w-44 sm:h-55 sm:w-55" />
                {pedido.plazo_retiro_vencimiento && <p className="text-sm">Retirar antes del {fecha.format(new Date(pedido.plazo_retiro_vencimiento))}.</p>}
              </CardContent>
            </Card>
          ) : pedido.qr_inconsistente ? (
            <p role="alert" className="rounded-lg border p-4 text-sm">El código de retiro no está disponible. Contactá a la sucursal.</p>
          ) : pedido.estado === "LISTO_PARA_RETIRO" ? (
            <p className="rounded-lg border p-4 text-sm">El plazo de retiro venció; el QR no está disponible.</p>
          ) : null}
        </>
      )}
    </main>
  );
}
