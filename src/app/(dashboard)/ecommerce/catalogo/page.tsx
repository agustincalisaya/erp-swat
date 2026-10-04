import { redirect } from "next/navigation";
import { CatalogoWebAdmin } from "@/components/ecommerce/CatalogoWebAdmin";
import type { LimitesFotos } from "@/components/ecommerce/ContenidoWebFormularios";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  listarProductosSinContenido,
  obtenerDetalleContenidosAdmin,
} from "@/lib/services/ecommerce/contenido-web.service";
import { listarContenidoWebAdmin } from "@/lib/services/ecommerce/visibilidad-web.service";
import {
  obtenerFotoFormatosPermitidos,
  obtenerFotosMaxPorProducto,
  obtenerFotoTamanoMaxBytes,
} from "@/lib/services/sistema/configuracion.service";

/**
 * HU-E5 — Visibilidad web del catálogo (spec E §2.5). La lista se lee en el
 * servidor (task_relos.md D9, sin GET nuevo); las acciones van a los Route
 * Handlers de `/api/ecommerce/catalogo/**` (D15, sin Server Actions).
 * HU-E11 — suma alta, edición y fotos (spec E §2.11): descripción y fotos de
 * cada contenido, productos sin contenido y límites de fotos de la configuración.
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
  const [pagina, productosSinContenido, limitesFotos] = await Promise.all([
    listarContenidoWebAdmin({ page: Number.isInteger(numero) && numero > 0 ? numero : 1 }),
    listarProductosSinContenido(),
    leerLimitesFotos(),
  ]);
  const detalles = await obtenerDetalleContenidosAdmin(pagina.items.map((f) => f.producto_web_id));

  return (
    <main className="p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Catálogo web</h1>
          <p className="text-sm text-muted-foreground">
            La visibilidad en la tienda es propia del canal web: no cambia el inventario ni el estado de los artículos.
          </p>
        </div>
        <CatalogoWebAdmin
          pagina={{
            ...pagina,
            items: pagina.items.map((fila) => ({
              ...fila,
              descripcion: detalles.get(fila.producto_web_id)?.descripcion ?? "",
              fotos: detalles.get(fila.producto_web_id)?.fotos ?? [],
            })),
          }}
          productosSinContenido={productosSinContenido}
          limitesFotos={limitesFotos}
        />
      </div>
    </main>
  );
}

/** Límites de fotos (D3); `null` si la configuración falta o es inválida (la subida respondería 500). */
async function leerLimitesFotos(): Promise<LimitesFotos | null> {
  try {
    const [maximo, tamanoBytes, formatos] = await Promise.all([
      obtenerFotosMaxPorProducto(),
      obtenerFotoTamanoMaxBytes(),
      obtenerFotoFormatosPermitidos(),
    ]);
    return { maximo, tamano_max_mb: tamanoBytes / (1024 * 1024), formatos };
  } catch (error) {
    if (error instanceof ServiceError) return null;
    throw error;
  }
}
