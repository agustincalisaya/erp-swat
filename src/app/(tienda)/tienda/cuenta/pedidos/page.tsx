import { redirect } from "next/navigation";
import { MisPedidosListado, PaginacionPedidos } from "@/components/ecommerce/MisPedidosListado";
import { getSesionClienteWeb, getSesionClienteWebVinculada } from "@/lib/auth/sesion-cliente-web";
import { MisPedidosQuerySchema } from "@/lib/schemas/mis-pedidos.schema";
import { listarPedidosWebCliente } from "@/lib/services/ecommerce/mis-pedidos.service";

export default async function MisPedidosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sesionActual = await getSesionClienteWeb();
  if (sesionActual?.vinculacionPendiente) redirect("/tienda/cuenta");
  const sesion = await getSesionClienteWebVinculada();
  if (!sesion) {
    const retorno = new URLSearchParams();
    if (typeof params.page === "string") retorno.set("page", params.page);
    if (typeof params.page_size === "string") retorno.set("page_size", params.page_size);
    const destino = `/tienda/cuenta/pedidos${retorno.size ? `?${retorno}` : ""}`;
    redirect(`/tienda/ingresar?redirect=${encodeURIComponent(destino)}`);
  }

  const query = MisPedidosQuerySchema.safeParse(params);
  if (!query.success) return <MisPedidosListado pedidos={[]} estado="error" />;

  const resultado = await listarPedidosWebCliente(sesion.clienteId, {
    pagina: query.data.page,
    porPagina: query.data.page_size,
  }).catch(() => null);
  if (!resultado) return <MisPedidosListado pedidos={[]} estado="error" />;

  const totalPaginas = Math.ceil(resultado.total / resultado.por_pagina);
  return (
    <div className="space-y-4">
      <MisPedidosListado pedidos={resultado.pedidos} />
      <PaginacionPedidos pagina={resultado.pagina} totalPaginas={totalPaginas} porPagina={resultado.por_pagina} />
    </div>
  );
}
