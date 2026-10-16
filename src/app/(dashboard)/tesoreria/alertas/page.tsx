/**
 * @page AlertasDesvioPage
 * @route /tesoreria/alertas
 *
 * Panel de alertas de indicadores críticos (HU-D6, spec_modulo_D.md §8.2,
 * task_relos.md D7, D12, D19). React Server Component: resuelve sesión y
 * permiso, llama directo a `obtenerPanelAlertas()` (que reevalúa antes de
 * listar, D7) y delega la tabla a `PanelAlertasDesvio`. Pestañas, nivel y
 * página viven en la URL.
 *
 * Acceso (`resolverAccesoPanelAlertas`): sin sesión → `/login`; sin
 * `alertas:leer` → `/no-autorizado` (Gerente y Administrador lo tienen). El
 * formulario de umbrales solo se renderiza con `configuracion:administrar`;
 * para el resto el bloque es de solo lectura (variante del criterio 3). El
 * servidor vuelve a validar el permiso en el PATCH.
 */

import { redirect } from "next/navigation";
import { AlertTriangle, Info, TriangleAlert } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { obtenerPanelAlertas, type PanelAlertas } from "@/lib/services/alertas/alerta-desvio.panel.service";
import {
  normalizarFiltrosPanel,
  resolverAccesoPanelAlertas,
  textoEstadoMes,
} from "@/lib/services/alertas/alerta-desvio.presentacion";
import { PanelAlertasDesvio } from "@/components/tesoreria/PanelAlertasDesvio";
import { FormularioUmbralesEgresos } from "@/components/tesoreria/FormularioUmbralesEgresos";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Alertas — ERP SWAT",
  description: "Alertas de indicadores críticos: stock bajo el punto de pedido y egresos sobre ingresos del mes (Módulo D).",
};

const CHIPS_UMBRALES = [
  { campo: "informativa", etiqueta: "Informativa", clase: "bg-info text-info-foreground" },
  { campo: "advertencia", etiqueta: "Advertencia", clase: "bg-warning text-warning-foreground" },
  { campo: "critica", etiqueta: "Crítica", clase: "bg-danger-soft text-danger-soft-foreground" },
] as const;

const NOTA_PIE =
  "Para stock: advertencia en o por debajo del punto de pedido, crítica en cero. No se duplica una alerta activa del mismo indicador y referencia; pasa a resuelta sola cuando la condición deja de cumplirse. Fuera del sprint: Tablero de Comando y push de la PWA.";

function BloqueUmbrales({ panel, puedeEditar }: { panel: PanelAlertas; puedeEditar: boolean }) {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-sm font-semibold">Umbrales del porcentaje de egresos</CardTitle>
        <CardDescription>
          {puedeEditar
            ? "Guardados en la configuración del sistema. Como Administrador podés modificarlos."
            : "Guardados en la configuración del sistema. Solo lectura: los modifica el Administrador."}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {panel.umbrales === null ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudieron leer los umbrales de la configuración del sistema. Avisá al Administrador.
            </AlertDescription>
          </Alert>
        ) : puedeEditar ? (
          <FormularioUmbralesEgresos umbrales={panel.umbrales} />
        ) : (
          <dl className="grid gap-3 sm:grid-cols-3">
            {CHIPS_UMBRALES.map(({ campo, etiqueta, clase }) => (
              <div key={campo} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <dt>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${clase}`}>{etiqueta}</span>
                </dt>
                <dd className="text-sm font-semibold text-foreground">{panel.umbrales![campo]} %</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AlertasDesvioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const acceso = await resolverAccesoPanelAlertas(await getServerSession(), usuarioTienePermiso);
  if (acceso.tipo === "LOGIN") redirect("/login");
  if (acceso.tipo === "NO_AUTORIZADO") redirect("/no-autorizado");

  const filtros = normalizarFiltrosPanel(await searchParams);

  let panel: PanelAlertas | null = null;
  try {
    panel = await obtenerPanelAlertas(filtros);
  } catch (error) {
    const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    console.error("[AlertasDesvioPage] No se pudo cargar el panel:", {
      codigo_error: typeof codigo === "string" ? codigo : "ERROR_INESPERADO",
    });
  }

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-selected text-selected-foreground shrink-0">
            <TriangleAlert className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Alertas</h1>
            <p className="text-sm text-muted-foreground">
              Indicadores críticos: stock por debajo del punto de pedido y porcentaje de egresos sobre ingresos del
              mes en curso.
            </p>
          </div>
        </div>

        {panel === null ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>No se pudo cargar el panel de alertas. Intentá de nuevo en unos minutos.</AlertDescription>
          </Alert>
        ) : (
          <>
            {panel.fuente_egresos.estado === "NO_DISPONIBLE" ? (
              <Alert variant="destructive" role="status">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertDescription>{textoEstadoMes(panel.fuente_egresos)}</AlertDescription>
              </Alert>
            ) : (
              <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
                <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {textoEstadoMes(panel.fuente_egresos)}
              </p>
            )}

            <Card>
              <CardContent className="pt-5">
                <PanelAlertasDesvio panel={panel} filtros={filtros} />
              </CardContent>
            </Card>

            <BloqueUmbrales panel={panel} puedeEditar={acceso.puedeEditarUmbrales} />
          </>
        )}

        <p className="text-xs text-muted-foreground">{NOTA_PIE}</p>
      </div>
    </main>
  );
}
