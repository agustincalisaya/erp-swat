import { redirect } from "next/navigation";
import { PedidosPagadosAdmin } from "@/components/ecommerce/PedidosPagadosAdmin";
import { PERMISO_CANCELAR_PEDIDO_PAGADO } from "@/lib/auth/permisos-ecommerce";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { listarPedidosPagadosAdmin } from "@/lib/services/ecommerce/pedidos-pagados-admin.service";

export default async function PedidosPagadosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_CANCELAR_PEDIDO_PAGADO))) redirect("/no-autorizado");
  const params = await searchParams;
  const page = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const pagina = await listarPedidosPagadosAdmin({ page: Number.isSafeInteger(page) && page > 0 ? page : 1 });

  return (
    <main className="p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Pedidos pagados</h1>
          <p className="text-sm text-muted-foreground">
            Gestioná cancelaciones de pedidos pagados y reintegros rechazados.
          </p>
        </header>
        <PedidosPagadosAdmin pagina={pagina} />
      </div>
    </main>
  );
}
