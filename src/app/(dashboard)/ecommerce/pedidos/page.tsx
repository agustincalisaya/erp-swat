import { redirect } from "next/navigation";
import { PedidosWebAdmin } from "@/components/ecommerce/PedidosWebAdmin";
import { PERMISO_ANULAR_ORDEN_NO_ABONADA } from "@/lib/auth/permisos-ecommerce";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { listarOrdenesNoAbonadasAdmin } from "@/lib/services/ecommerce/anulacion-orden.service";

/**
 * HU-E7 — Órdenes web no abonadas (spec E §2.7; task_relos.md D2). La lista
 * se lee en el servidor; la anulación va al Route Handler
 * `PATCH /api/ecommerce/pedidos/[id]/anular` (sin Server Actions, D2).
 */
export default async function PedidosWebPage({
  searchParams,
}: {
  searchParams: Promise<{ [clave: string]: string | string[] | undefined }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_ANULAR_ORDEN_NO_ABONADA))) redirect("/no-autorizado");

  const { page } = await searchParams;
  const numero = Number(Array.isArray(page) ? page[0] : page);
  const pagina = await listarOrdenesNoAbonadasAdmin({ page: Number.isInteger(numero) && numero > 0 ? numero : 1 });

  return (
    <main className="p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Pedidos web</h1>
          <p className="text-sm text-muted-foreground">
            Órdenes de la tienda online que todavía no se pagaron. Anular una orden la da de baja sin borrarla y libera el
            stock que tenga reservado.
          </p>
        </div>
        <PedidosWebAdmin pagina={pagina} />
      </div>
    </main>
  );
}
