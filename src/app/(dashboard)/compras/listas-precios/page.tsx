/**
 * @page ListasPreciosPage
 * @route /compras/listas-precios
 *
 * Pantalla unificada de Listas de Precios de proveedor (HU-H2 publicación +
 * aprobación · HU-H7 comparativa). React Server Component: resuelve sesión +
 * permisos granulares, precarga selectores (proveedores HOMOLOGADOS,
 * variantes) y — si hay un `?proveedor=` en la URL — el historial de
 * versiones de ese proveedor (`listarVersionesListaPrecio`, HU-H2/H6).
 *
 * Gate de acceso: al menos uno de `proveedores:publicar_lista` /
 * `proveedores:comparar_precios` / `proveedores:leer` (si el usuario no
 * tiene ninguno de los tres, no hay nada que hacer en esta pantalla). Cada
 * sección se oculta aparte según su propio permiso — un Comprador sin
 * `publicar_lista_critica` ve todo salvo el botón "Aprobar" del historial.
 *
 * C7 (auditoría transversal Módulo H, 2026-09-26): el Auditor tiene
 * `proveedores:leer` y el `GET` de historial ya lo permitía (Alcance
 * Funcional §5 exige que pueda consultar precios/OC), pero esta pantalla
 * gateaba el historial/comparativa con `proveedores:publicar_lista` — sin
 * pantalla, sin forma de ejercer ese permiso. Ahora el historial y la
 * comparativa se muestran también con `proveedores:leer` (solo lectura: sin
 * el formulario de "Nueva versión", que sigue exclusivo de
 * `proveedores:publicar_lista`; el botón "Aprobar" sigue exclusivo de
 * `proveedores:publicar_lista_critica`, gateado dentro de
 * `HistorialVersionesListaPrecio`).
 */

import { redirect } from "next/navigation";
import { Tags, History, PackagePlus, BarChart3 } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarProveedoresHomologados,
  listarVariantesParaOrden,
} from "@/lib/services/proveedores/orden-compra.service";
import {
  listarVersionesListaPrecio,
  listarVariantesConPrecioVigente,
  PERMISO_PUBLICAR_LISTA_PRECIO,
  PERMISO_APROBAR_LISTA_PRECIO_CRITICA,
} from "@/lib/services/proveedores/lista-precios.service";
import { PERMISO_LEER } from "@/lib/services/proveedores/proveedor.service";

import { SelectorProveedorListaPrecios } from "@/components/compras/SelectorProveedorListaPrecios";
import { HistorialVersionesListaPrecio } from "@/components/compras/HistorialVersionesListaPrecio";
import { FormularioNuevaVersionListaPrecio } from "@/components/compras/FormularioNuevaVersionListaPrecio";
import { ComparativaPreciosCard } from "@/components/compras/ComparativaPreciosCard";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

// `proveedores:comparar_precios` no tiene una constante `PERMISO_*` exportada
// en `comparativa-precios.service.ts` (ver nota en `actions.ts`) — se usa el
// mismo literal que el resto de este módulo.
const PERMISO_COMPARAR_PRECIOS = "proveedores:comparar_precios";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lista de Precios — ERP SWAT",
  description: "Publicación, historial/aprobación y comparativa de precios de proveedores (Módulo H).",
};

interface ListasPreciosPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ListasPreciosPage({ searchParams }: ListasPreciosPageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [puedePublicar, puedeAprobarCritica, puedeComparar, puedeLeerProveedores] =
    await Promise.all([
      usuarioTienePermiso(session.userId, PERMISO_PUBLICAR_LISTA_PRECIO),
      usuarioTienePermiso(session.userId, PERMISO_APROBAR_LISTA_PRECIO_CRITICA),
      usuarioTienePermiso(session.userId, PERMISO_COMPARAR_PRECIOS),
      usuarioTienePermiso(session.userId, PERMISO_LEER),
    ]);

  if (!puedePublicar && !puedeComparar && !puedeLeerProveedores) redirect("/no-autorizado");

  // C7: ver el historial no requiere poder publicar — alcanza con
  // proveedores:leer (Auditor incluido). La comparativa se gatea aparte
  // con proveedores:comparar_precios (solo Comprador y Supervisor de Compras).
  const puedeVerHistorial = puedePublicar || puedeLeerProveedores;

  const rawParams = await searchParams;
  const proveedorId = typeof rawParams.proveedor === "string" ? rawParams.proveedor : "";

  const [proveedores, variantes] = await Promise.all([
    listarProveedoresHomologados(),
    listarVariantesParaOrden(),
  ]);

  const [versiones, variantesVigentes] = await Promise.all([
    proveedorId && puedeVerHistorial ? listarVersionesListaPrecio(proveedorId) : null,
    proveedorId && puedePublicar ? listarVariantesConPrecioVigente(proveedorId) : null,
  ]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Tags className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Lista de Precios
            </h1>
            <p className="text-sm text-muted-foreground">
              Publicación y aprobación de versiones de lista de precios, y comparativa entre proveedores.
            </p>
          </div>
        </div>

        {puedeVerHistorial && (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-semibold">Proveedor</CardTitle>
              <CardDescription>
                {puedePublicar
                  ? "Elegí un proveedor homologado para ver su historial de versiones o publicar una nueva."
                  : "Elegí un proveedor homologado para ver su historial de versiones."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <SelectorProveedorListaPrecios
                proveedores={proveedores}
                proveedorSeleccionadoId={proveedorId}
              />
            </CardContent>
          </Card>
        )}

        {puedeVerHistorial && proveedorId && versiones && (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <History className="size-4 text-blue-500" aria-hidden="true" />
                Historial de versiones
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <HistorialVersionesListaPrecio
                proveedorId={proveedorId}
                versiones={versiones}
                puedeAprobarCritica={puedeAprobarCritica}
              />
            </CardContent>
          </Card>
        )}

        {puedePublicar && proveedorId && (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <PackagePlus className="size-4 text-blue-500" aria-hidden="true" />
                Nueva versión
              </CardTitle>
              <CardDescription>
                Calculá la variación contra la lista vigente antes de confirmar la publicación.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <FormularioNuevaVersionListaPrecio
                proveedorId={proveedorId}
                variantes={variantes}
                variantesVigentes={variantesVigentes ?? []}
              />
            </CardContent>
          </Card>
        )}

        {puedeComparar && (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="size-4 text-blue-500" aria-hidden="true" />
                Comparativa de precios
              </CardTitle>
              <CardDescription>
                Precio vigente de cada proveedor homologado para una variante, ordenado de menor a mayor.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <ComparativaPreciosCard variantes={variantes} />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
