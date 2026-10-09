import Link from "next/link";
import type { EstadoEcommerce } from "@prisma/client";
import type { PedidoWebResumen } from "@/lib/services/ecommerce/mis-pedidos.service";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatearFechaNegocio } from "@/lib/utils/fecha-negocio";

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

export function etiquetaEstadoPedidoWeb(estado: EstadoEcommerce): string {
  return estados[estado].etiqueta;
}

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
  const tituloEstado = estado === "cargando" ? "Cargando pedidos…" :
    estado === "sesion_no_disponible" ? "Iniciá sesión como Cliente Web para ver tus pedidos." :
      estado === "error" ? "No pudimos cargar tus pedidos. Intentá nuevamente." :
        pedidos.length === 0 ? "Todavía no tenés pedidos" : null;
  const descripcionEstado = !estado && pedidos.length === 0
    ? "Cuando realices una compra, podrás consultar acá su estado y retiro."
    : null;

  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6" aria-labelledby="mis-pedidos-title">
      <header className="space-y-1">
        <h1 id="mis-pedidos-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">Mis pedidos</h1>
        <p className="text-sm text-muted-foreground">Consultá el estado y detalle de tus compras realizadas en la tienda.</p>
      </header>

      {tituloEstado ? (
        <Card role={estado === "error" ? "alert" : "status"}>
          <CardHeader className="space-y-2">
            <CardTitle>{tituloEstado}</CardTitle>
            {descripcionEstado && <CardDescription>{descripcionEstado}</CardDescription>}
          </CardHeader>
          {descripcionEstado && (
            <CardContent>
              <Link href="/tienda/catalogo" className={buttonVariants({ variant: "outline" })}>Volver a la tienda</Link>
            </CardContent>
          )}
        </Card>
      ) : (
        <ul className="grid gap-4">
          {pedidos.map((pedido) => (
            <li key={pedido.id}>
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle>Pedido {pedido.numero}</CardTitle>
                    <CardDescription>Fecha del pedido: {formatearFechaNegocio(pedido.fecha)}</CardDescription>
                  </div>
                  <EstadoPedidoWebBadge estado={pedido.estado} />
                </CardHeader>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Total</dt>
                      <dd className="font-medium">{pesos.format(pedido.total)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Artículos</dt>
                      <dd className="font-medium">{pedido.cantidad_items} {pedido.cantidad_items === 1 ? "artículo" : "artículos"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Estado</dt>
                      <dd className="font-medium">{estados[pedido.estado].etiqueta}</dd>
                    </div>
                  </dl>
                  <Link href={`/tienda/cuenta/pedidos/${pedido.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Ver detalle
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PaginacionPedidos({ pagina, totalPaginas, porPagina }: { pagina: number; totalPaginas: number; porPagina: number }) {
  if (totalPaginas <= 1) return null;
  return (
    <nav className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 pb-6 text-sm sm:px-6" aria-label="Paginación de pedidos">
      {pagina > 1 ? (
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={{ pathname: "/tienda/cuenta/pedidos", query: { page: pagina - 1, page_size: porPagina } }}>
          Anterior
        </Link>
      ) : <span />}
      <span className="text-muted-foreground">Página {pagina} de {totalPaginas}</span>
      {pagina < totalPaginas ? (
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={{ pathname: "/tienda/cuenta/pedidos", query: { page: pagina + 1, page_size: porPagina } }}>
          Siguiente
        </Link>
      ) : <span />}
    </nav>
  );
}
