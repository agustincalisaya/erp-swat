/**
 * @page VariantesPage
 * @route /inventario/variantes
 * @description HU-A6 Ajustes — UI de Variantes (R1-R4): listado paginado
 * (10/pág) con tabs Activas/Inactivas, búsqueda general con debounce y
 * filtro por Producto Maestro, reporte de inventario INACTIVO de SOLO
 * LECTURA (Criterio 2, excepción documentada en
 * `docs/specs/excepcion-criterio2-inactivas-variantes.md`), botón
 * "Agregar variante" reubicado en la cabecera (decisión D4) y paleta azul
 * Tailwind (criterio 11).
 *
 * Server Component RSC `force-dynamic` (decisión D10, patrón
 * `auditoria/logs`): lee `searchParams`, valida con `ListarVariantesSchema`
 * (safeParse → fallback `parse({})`) y delega el listado a la función de
 * SOLO LECTURA `listarVariantesPaginadas()` — CERO Server Actions de
 * listado (decisión D1); el backend de baja aprobado queda byte-idéntico
 * (criterio 8).
 */
import { Suspense } from "react";
import Link from "next/link";
import { Boxes, AlertTriangle, LayoutGrid } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import {
  usuarioPuedeBajarVariante,
  usuarioPuedeEditarVariante,
  listarVariantesPaginadas,
  listarProductosMaestroParaFiltro,
  type ListadoVariantesPaginado,
} from "@/lib/services/inventario/variante.service";
import { ListarVariantesSchema } from "@/lib/schemas/inventario.schema";
import { ModalJustificacionBaja } from "@/components/inventario/ModalJustificacionBaja";
import { EditarVarianteDialog } from "@/components/inventario/EditarVarianteDialog";
import { TabsActivasInactivas } from "@/components/inventario/TabsActivasInactivas";
import { BuscadorFiltrosVariantes } from "@/components/inventario/BuscadorFiltrosVariantes";
import { PaginadorVariantes } from "@/components/inventario/PaginadorVariantes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

// Lectura fresca por request (patrón auditoria/logs): sin esto, `next build`
// intentaría prerenderizar la página en build-time sin base de datos
// accesible y el reporte inactivo exigiría datos actualizados en cada visita.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Variantes — ERP SWAT",
  description: "Listado paginado de variantes con reporte de inventario inactivo (solo lectura).",
};

interface VariantesPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function formatFecha(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

export default async function VariantesPage({ searchParams }: VariantesPageProps) {
  const session = await getServerSession();
  const puedeBajar = session ? await usuarioPuedeBajarVariante(session.userId) : false;
  const puedeEditar = session ? await usuarioPuedeEditarVariante(session.userId) : false;

  const rawParams = await searchParams;
  const parsedFiltros = ListarVariantesSchema.safeParse(rawParams);
  const filtros = parsedFiltros.success ? parsedFiltros.data : ListarVariantesSchema.parse({});

  let resultado: ListadoVariantesPaginado = {
    variantes: [],
    total: 0,
    page: filtros.page,
    page_size: 10,
    tab: filtros.tab,
  };
  let productos: { id: string; nombre: string }[] = [];
  let errorCarga: string | null = null;
  try {
    [resultado, productos] = await Promise.all([
      listarVariantesPaginadas(filtros),
      listarProductosMaestroParaFiltro(),
    ]);
  } catch (err) {
    console.error("[VariantesPage] Error al cargar variantes:", err);
    errorCarga = "No se pudieron cargar las variantes. Verificá la conexión con la base de datos.";
  }

  // Query string de los filtros activos (sin `page`) para que el paginador
  // y los tabs no los pierdan al navegar (decisión D8).
  const queryBase = new URLSearchParams();
  queryBase.set("tab", filtros.tab);
  if (filtros.q) queryBase.set("q", filtros.q);
  if (filtros.producto_maestro_id) queryBase.set("producto_maestro_id", filtros.producto_maestro_id);

  const esInactivas = filtros.tab === "inactivas";

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* ── Header (R1: botón "Agregar variante" reubicado acá) ──────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
              <Boxes className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Variantes</h1>
              <p className="text-sm text-muted-foreground">
                Variantes activas y reporte de inventario inactivo (solo lectura) con baja
                lógica justificada.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* ── Tabs Activas / Inactivas (estado en la URL, decisión D5) ─── */}
            <Suspense fallback={null}>
              <TabsActivasInactivas tab={filtros.tab} />
            </Suspense>

            <Link
              href="/inventario/variantes/nueva"
              className={buttonVariants({ variant: "outline" }) + " gap-2 shrink-0"}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
              Agregar variante
            </Link>

          </div>
        </div>

        {/* ── Búsqueda + filtro (debounce 350ms, reset de page) ────────── */}
        <Suspense fallback={null}>
          <BuscadorFiltrosVariantes
            productos={productos}
            qInicial={filtros.q ?? ""}
            productoMaestroIdInicial={filtros.producto_maestro_id ?? ""}
          />
        </Suspense>

        {errorCarga ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{errorCarga}</AlertDescription>
          </Alert>
        ) : resultado.variantes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-blue-200 bg-white p-8 text-center text-sm text-muted-foreground">
            No se encontraron variantes
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-blue-50 text-xs uppercase tracking-wide text-blue-900">
                  <tr>
                    <th className="px-4 py-3 font-semibold">SKU</th>
                    <th className="px-4 py-3 font-semibold">Producto</th>
                    <th className="px-4 py-3 font-semibold">Talle / Color / Género</th>
                    <th className="px-4 py-3 text-right font-semibold">Stock</th>
                    {esInactivas ? (
                      <>
                        <th className="px-4 py-3 font-semibold">Fecha de baja</th>
                        <th className="px-4 py-3 font-semibold">Dado de baja por</th>
                        <th className="px-4 py-3 font-semibold">Motivo</th>
                      </>
                    ) : (
                      (puedeBajar || puedeEditar) && (
                        <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultado.variantes.map((v) => (
                    <tr key={v.id} className="hover:bg-blue-50/40">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{v.sku}</td>
                      <td className="px-4 py-3 text-gray-900">{v.producto}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {v.talle} / {v.color} / {v.genero}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            v.stockTotal > 0
                              ? "inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
                              : "inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600"
                          }
                        >
                          {v.stockTotal}
                        </span>
                      </td>
                      {esInactivas ? (
                        <>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {formatFecha(v.deleted_at)}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {v.deleted_by_nombre ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {v.deletion_reason ?? "—"}
                          </td>
                        </>
                      ) : (
                        (puedeBajar || puedeEditar) && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {puedeEditar && <EditarVarianteDialog varianteId={v.id} />}
                              {puedeBajar && (
                                <ModalJustificacionBaja
                                  varianteId={v.id}
                                  sku={v.sku}
                                  stockTotal={v.stockTotal}
                                />
                              )}
                            </div>
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Paginación (estilo Auditoría Forense, conserva filtros) ──── */}
        {!errorCarga && (
          <PaginadorVariantes
            page={resultado.page}
            total={resultado.total}
            pageSize={resultado.page_size}
            queryBase={queryBase.toString()}
          />
        )}
      </div>
    </main>
  );
}