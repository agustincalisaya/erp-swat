/**
 * @page MiHistorialPage
 * @route /auditoria/mi-historial
 *
 * HU-D8 — historial propio del usuario interno (spec_modulo_D.md §8.1,
 * `docs/modulos/modulo D/HU8_TASKS.md` T04). Server Component: el usuario
 * sale de `getServerSession()` y nunca de la URL. Disponible para toda sesión
 * interna sin permiso adicional (D8-5). Distinta de la Consola de Auditoría
 * Forense (`/auditoria/logs`): sin búsqueda por usuario, sin detalle
 * anterior/nuevo, sin exportación ni verificación de cadena (D8-6/D8-7).
 */
import { Suspense } from "react";
import { History, AlertTriangle } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import {
  listarHistorialPropio,
  listarAccionesPropias,
  type ListadoHistorialPropio,
} from "@/lib/services/auditoria/audit-log.service";
import { HistorialPropioFiltrosSchema } from "@/lib/schemas/auditoria.schema";
import { FiltrosHistorialPropio } from "@/components/auditoria/FiltrosHistorialPropio";
import { TablaHistorialPropio } from "@/components/auditoria/TablaHistorialPropio";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Lee cookies y consulta Prisma por request: nunca prerenderizar ni cachear.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Mi historial — ERP SWAT",
  description: "Acciones registradas con tu usuario en el log de auditoría (Módulo D — HU-D8).",
};

interface MiHistorialPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MiHistorialPage({ searchParams }: MiHistorialPageProps) {
  const session = await getServerSession();

  if (!session) {
    // Defensa en profundidad: `src/proxy.ts` solo valida la firma del JWT,
    // no si la `Sesion` fue revocada (mismo criterio que `/auditoria/logs`).
    return (
      <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              Tu sesión ya no es válida. Volvé a iniciar sesión para continuar.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  const rawParams = await searchParams;
  const parsed = HistorialPropioFiltrosSchema.safeParse(rawParams);
  // Filtros inválidos (p. ej. desde > hasta): se avisa y se lista sin filtros.
  const filtros = parsed.success ? parsed.data : HistorialPropioFiltrosSchema.parse({});
  const errorFiltros = parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "Los filtros enviados no son válidos");

  let resultado: ListadoHistorialPropio;
  let acciones: string[] = [];
  let errorCarga = false;
  try {
    [resultado, acciones] = await Promise.all([
      listarHistorialPropio(filtros, session.userId),
      listarAccionesPropias(session.userId),
    ]);
  } catch (err) {
    console.error("[MiHistorialPage] Error al obtener el historial propio:", err);
    resultado = { registros: [], total: 0, page: filtros.page, page_size: filtros.page_size };
    errorCarga = true;
  }

  // Filtros activos (sin `page`) para que la paginación no los pierda.
  const queryBase = new URLSearchParams();
  if (filtros.fecha_desde) queryBase.set("fecha_desde", filtros.fecha_desde);
  if (filtros.fecha_hasta) queryBase.set("fecha_hasta", filtros.fecha_hasta);
  if (filtros.accion) queryBase.set("accion", filtros.accion);
  if (filtros.page_size !== 25) queryBase.set("page_size", String(filtros.page_size));

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-selected text-selected-foreground shrink-0">
            <History className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Mi historial de acciones</h1>
            <p className="text-sm text-muted-foreground">
              Acciones registradas con tu usuario. Horario de Argentina.
            </p>
          </div>
        </div>

        {errorFiltros && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{errorFiltros}. Se muestran los registros sin filtros.</AlertDescription>
          </Alert>
        )}
        {errorCarga && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>No se pudo cargar tu historial. Probá de nuevo en unos minutos.</AlertDescription>
          </Alert>
        )}

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <Suspense fallback={null}>
          <FiltrosHistorialPropio acciones={acciones} />
        </Suspense>

        {/* ── Tabla en Card ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-primary" aria-hidden="true" />
              Registros
            </CardTitle>
            <CardDescription>
              {resultado.total} registro{resultado.total === 1 ? "" : "s"} encontrado
              {resultado.total === 1 ? "" : "s"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <TablaHistorialPropio resultado={resultado} queryBase={queryBase.toString()} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
