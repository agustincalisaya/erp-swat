import { redirect } from "next/navigation";
import { CatalogoWebAdmin } from "@/components/ecommerce/CatalogoWebAdmin";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { listarContenidoWebAdmin } from "@/lib/services/ecommerce/visibilidad-web.service";

/**
 * HU-E5 — Visibilidad web del catálogo (spec E §2.5). La lista se lee en el
 * servidor (task_relos.md D9, sin GET nuevo); las acciones van a los Route
 * Handlers de `/api/ecommerce/catalogo/**` (D15, sin Server Actions).
 */
export default async function CatalogoWebPage({
  searchParams,
}: {
  searchParams: Promise<{ [clave: string]: string | string[] | undefined }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CATALOGO))) redirect("/no-autorizado");

  const { page } = await searchParams;
  const numero = Number(Array.isArray(page) ? page[0] : page);
  const pagina = await listarContenidoWebAdmin({ page: Number.isInteger(numero) && numero > 0 ? numero : 1 });

  return (
    <main className="p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Catálogo web</h1>
          <p className="text-sm text-muted-foreground">
            La visibilidad en la tienda es propia del canal web: no cambia el inventario ni el estado de los artículos.
          </p>
        </div>
        <CatalogoWebAdmin pagina={pagina} />
      </div>
    </main>
  );
}
