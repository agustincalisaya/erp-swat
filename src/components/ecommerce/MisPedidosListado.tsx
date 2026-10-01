import Link from "next/link";
import type { EstadoEcommerce } from "@prisma/client";
import type { PedidoWebResumen } from "@/lib/services/ecommerce/mis-pedidos.service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const estados: Record<EstadoEcommerce, { etiqueta: string; estilo: string }> = {
  PAGO_PENDIENTE: { etiqueta: "Pago pendiente", estilo: "bg-amber-100 text-amber-900" },
  PAGO_CONFIRMADO: { etiqueta: "Pago confirmado", estilo: "bg-blue-100 text-blue-900" },
  PAGO_RECHAZADO: { etiqueta: "Pago rechazado", estilo: "bg-red-100 text-red-900" },
  EN_PREPARACION: { etiqueta: "En preparación", estilo: "bg-indigo-100 text-indigo-900" },
  LISTO_PARA_RETIRO: { etiqueta: "Listo para retiro", estilo: "bg-green-100 text-green-900" },
  ENTREGADO: { etiqueta: "Entregado", estilo: "bg-emerald-100 text-emerald-900" },
  ANULADO: { etiqueta: "Anulado", estilo: "bg-gray-100 text-gray-800" },
  CANCELADO: { etiqueta: "Cancelado", estilo: "bg-gray-100 text-gray-800" },
  VENCIDO_SIN_RETIRO: { etiqueta: "Vencido sin retiro", estilo: "bg-orange-100 text-orange-900" },
};

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" });

export function EstadoPedidoWebBadge({ estado }: { estado: EstadoEcommerce }) {
  const { etiqueta, estilo } = estados[estado];
  return <Badge className={estilo}>{etiqueta}</Badge>;
}

export function MisPedidosListado({
  pedidos,
  estado,
}: {
  pedidos: PedidoWebResumen[];
  estado?: "cargando" | "sesion_no_disponible" | "error";
}) {
  const mensaje = estado === "cargando" ? "Cargando pedidos…" :
    estado === "sesion_no_disponible" ? "Iniciá sesión como Cliente Web para ver tus pedidos." :
      estado === "error" ? "No pudimos cargar tus pedidos. Intentá nuevamente." :
        pedidos.length === 0 ? "Todavía no tenés pedidos web." : null;

  return (
    <section className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6" aria-labelledby="mis-pedidos-title">
      <h1 id="mis-pedidos-title" className="text-2xl font-semibold">Mis pedidos</h1>
      {mensaje ? <p role={estado === "error" ? "alert" : "status"} className="rounded-lg border p-5 text-sm text-muted-foreground">{mensaje}</p> : (
        <ul className="grid gap-4">
          {pedidos.map((pedido) => (
            <li key={pedido.id}>
              <Card>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-base">Pedido {pedido.numero}</CardTitle>
                  <EstadoPedidoWebBadge estado={pedido.estado} />
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-1">
                    <p>Fecha: {fecha.format(new Date(pedido.fecha))}</p>
                    <p>Total: {pesos.format(pedido.total)}</p>
                  </div>
                  <Link href={`/cuenta/pedidos/${pedido.id}`} className="text-blue-700 underline-offset-2 hover:underline focus-visible:underline">Ver detalle del pedido</Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
