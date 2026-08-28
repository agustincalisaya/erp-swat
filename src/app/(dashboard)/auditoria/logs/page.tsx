/**
 * @page LogsPage
 * @route /auditoria/logs
 *
 * D.3 — Consola de Auditoría Forense (spec_modulo_D.md §4.3/§4.4,
 * task_cali_auditoria_forense.md). Server Component: resuelve la sesión y
 * los permisos ampliados una sola vez, y llama `listarAuditLog()`
 * directamente (mismo service que consume el Route Handler
 * `GET /api/auditoria/logs` — sin duplicar la regla de segregación).
 */
import { Suspense } from "react";
import { ScrollText, AlertTriangle } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarAuditLog,
  listarAccionesDistintas,
  listarUsuariosParaFiltro,
  type UsuarioParaFiltro,
} from "@/lib/services/auditoria/audit-log.service";
import { USUARIO_PRUEBA_EXCLUIDO_ID } from "@/lib/services/inventario/auditoria.service";
import { FiltrosAuditoriaSchema } from "@/lib/schemas/auditoria.schema";
import { FiltrosAuditoria } from "@/components/auditoria/FiltrosAuditoria";
import { TablaAuditLog } from "@/components/auditoria/TablaAuditLog";
import { BotonVerificarCadena } from "@/components/auditoria/BotonVerificarCadena";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Server Component: resuelve sesión (`getServerSession()`, lee cookies),
// lee `searchParams` y llama a `listarAuditLog()` (Prisma) directamente.
// Sin esto, `next build` intenta prerenderizar la página estáticamente y
// falla si no hay una base de datos accesible en build-time (ej. CI). El
// Ledger forense además exige lectura fresca por request — nunca cachear.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Auditoría Forense — ERP SWAT",
  description: "Consola de solo lectura sobre el Ledger de Auditoría (Módulo D — D.3).",
};

const PERMISO_LEER_FORENSE = "auditoria:leer_forense";
const PERMISO_VERIFICAR_CADENA = "auditoria:verificar_cadena";

interface LogsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const session = await getServerSession();

  if (!session) {
    // Defensa en profundidad: `src/proxy.ts` ya protege esta ruta, pero solo
    // valida firma/expiración del JWT, no `Sesion.revocada` (decisión
    // confirmada en HU-3) — una sesión recién revocada podría llegar hasta
    // acá antes de expirar criptográficamente.
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
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

  const [tieneLeerForense, tieneVerificarCadena] = await Promise.all([
    usuarioTienePermiso(session.userId, PERMISO_LEER_FORENSE),
    usuarioTienePermiso(session.userId, PERMISO_VERIFICAR_CADENA),
  ]);

  const rawParams = await searchParams;
  const parsedFiltros = FiltrosAuditoriaSchema.safeParse(rawParams);
  const filtros = parsedFiltros.success ? parsedFiltros.data : FiltrosAuditoriaSchema.parse({});

  let resultado;
  try {
    resultado = await listarAuditLog(filtros, session);
  } catch (err) {
    console.error("[LogsPage] Error al obtener AuditLog:", err);
    resultado = { registros: [], total: 0, page: filtros.page, page_size: filtros.page_size };
  }

  // Opciones de los filtros dinámicos — `usuarios` solo se consulta con el
  // permiso ampliado (ver docstring de `listarUsuariosParaFiltro`).
  let acciones: string[] = [];
  let usuarios: UsuarioParaFiltro[] = [];
  try {
    [acciones, usuarios] = await Promise.all([
      listarAccionesDistintas(),
      tieneLeerForense ? listarUsuariosParaFiltro() : Promise.resolve([]),
    ]);
    // Corrección urgente pre Sprint Review (28/08): el combo de esta
    // pantalla no ofrece al usuario de prueba como opción — ver
    // USUARIO_PRUEBA_EXCLUIDO_ID. Filtrado acá y no en
    // `listarUsuariosParaFiltro()` porque esa función también la consume
    // `/inventario/auditoria`, que ya la filtra por su cuenta.
    usuarios = usuarios.filter((u) => u.id !== USUARIO_PRUEBA_EXCLUIDO_ID);
  } catch (err) {
    console.error("[LogsPage] Error al obtener opciones de filtro:", err);
  }

  // Query string de los filtros activos (sin `page`) para que la paginación
  // de TablaAuditLog no los pierda al navegar de página.
  const queryBase = new URLSearchParams();
  if (filtros.fecha_desde) queryBase.set("fecha_desde", filtros.fecha_desde.toISOString().slice(0, 10));
  if (filtros.fecha_hasta) queryBase.set("fecha_hasta", filtros.fecha_hasta.toISOString().slice(0, 10));
  if (filtros.tabla_afectada) queryBase.set("tabla_afectada", filtros.tabla_afectada);
  if (filtros.accion) queryBase.set("accion", filtros.accion);
  if (tieneLeerForense && filtros.usuario_id) queryBase.set("usuario_id", filtros.usuario_id);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
              <ScrollText className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                Auditoría Forense
              </h1>
              <p className="text-sm text-muted-foreground">
                {tieneLeerForense
                  ? "Historial completo de acciones registradas en el sistema."
                  : "Tu propio historial de acciones — solo resumen, sin permiso ampliado."}
              </p>
            </div>
          </div>
          {tieneVerificarCadena && <BotonVerificarCadena />}
        </div>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <Suspense fallback={null}>
          <FiltrosAuditoria
            mostrarFiltroUsuario={tieneLeerForense}
            acciones={acciones}
            usuarios={usuarios}
          />
        </Suspense>

        {/* ── Tabla en Card ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ScrollText className="size-4 text-blue-500" aria-hidden="true" />
              Registros
            </CardTitle>
            <CardDescription>
              {resultado.total} registro{resultado.total === 1 ? "" : "s"} encontrado
              {resultado.total === 1 ? "" : "s"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <TablaAuditLog
              resultado={resultado}
              mostrarDetalle={tieneLeerForense}
              queryBase={queryBase.toString()}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
