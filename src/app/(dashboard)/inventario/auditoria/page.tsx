/**
 * @page AuditoriaInventarioPage
 * @route /inventario/auditoria
 *
 * React Server Component: obtiene el listado de eventos de auditoría del
 * Módulo A directamente desde el servicio (sin fetch HTTP), serializa los
 * datos y los pasa a `TablaForenseInventario` como props.
 *
 * Patrón: RSC para lectura inicial → Client Components para interacciones.
 * Las acciones de verificación SHA-256 y reveal de datos sensibles se
 * delegan a Server Actions definidas en `actions.ts`.
 *
 * Acceso restringido: solo usuarios con el permiso `auditoria:leer_forense`.
 * Sin ese permiso, la página redirige a 403 (aplicado en middleware o layout).
 */

import { Suspense } from "react";

import { ShieldCheck, FileSearch, AlertTriangle, Lock } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import type { ServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { obtenerLogsInventario } from "@/lib/services/inventario/auditoria.service";
import { FiltrosAuditoriaInventarioSchema } from "@/lib/schemas/inventario-auditoria.schema";
import { TablaForenseInventario } from "@/components/inventario/auditoria/TablaForenseInventario";
// FIX 2 (TC-HU7-04) — reusa el mismo query de Módulo D en vez de escribir
// uno nuevo: acceso a esta pantalla ya exige `auditoria:leer_forense` (el
// bloqueo total de más abajo, no una degradación), así que a diferencia de
// `/auditoria/logs` acá el combo no necesita gate propio de visibilidad —
// todo el que llega hasta acá ya tiene el permiso.
import { listarUsuariosParaFiltro, type UsuarioParaFiltro } from "@/lib/services/auditoria/audit-log.service";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Auditoría del Inventario — ERP SWAT",
  description:
    "Consola de auditoría forense de movimientos de inventario con verificación de integridad SHA-256.",
};

const PERMISO_LEER_FORENSE = "auditoria:leer_forense";

// ──────────────────────────────────────────────────────────────────────────────
// Server Component: obtiene y prepara los datos
// ──────────────────────────────────────────────────────────────────────────────

async function AuditoriaData({
  searchParams,
  sesion,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  sesion: ServerSession;
}) {
  // Extraer y sanitizar el término de búsqueda libre (máx. 100 chars)
  const q = typeof searchParams.q === "string"
    ? searchParams.q.slice(0, 100)
    : undefined;

  // Parsear y validar los filtros de URL con Zod
  const filtrosParsed = FiltrosAuditoriaInventarioSchema.safeParse({
    usuario_id: searchParams.usuario_id,
    sku_referencia: searchParams.sku_referencia,
    fecha_desde: searchParams.fecha_desde,
    fecha_hasta: searchParams.fecha_hasta,
    tipo_movimiento: searchParams.tipo_movimiento,
    tabla_afectada: searchParams.tabla_afectada,
    page: searchParams.page ?? "1",
    page_size: searchParams.page_size ?? "25",
  });

  if (!filtrosParsed.success) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertDescription>
          Parámetros de filtro inválidos. Verificá los valores de búsqueda.
        </AlertDescription>
      </Alert>
    );
  }

  // FIX 2 (TC-HU7-04) — `usuarios` se trae en paralelo con el listado; si
  // esta consulta puntual fallara no tiene sentido tirar abajo toda la
  // pantalla (el listado principal ya se resolvió o falló por su cuenta),
  // así que se degrada a lista vacía en vez de propagar el error.
  let listado;
  let usuarios: UsuarioParaFiltro[] = [];
  try {
    [listado, usuarios] = await Promise.all([
      obtenerLogsInventario(filtrosParsed.data, sesion, q),
      listarUsuariosParaFiltro().catch((err) => {
        console.error("[AuditoriaInventarioPage] Error al obtener usuarios para filtro:", err);
        return [];
      }),
    ]);
  } catch (err) {
    console.error("[AuditoriaInventarioPage] Error al obtener logs:", err);
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertDescription>
          No se pudo cargar el historial de auditoría. Verificá la conexión con
          la base de datos.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TablaForenseInventario
      registros={listado.registros}
      total={listado.total}
      page={listado.page}
      page_size={listado.page_size}
      usuarios={usuarios}
      filtrosIniciales={{
        q: q ?? "",
        usuario_id: typeof searchParams.usuario_id === "string" ? searchParams.usuario_id : "",
        sku_referencia: typeof searchParams.sku_referencia === "string" ? searchParams.sku_referencia : "",
        tipo_movimiento: typeof searchParams.tipo_movimiento === "string" ? searchParams.tipo_movimiento : "",
        tabla_afectada: typeof searchParams.tabla_afectada === "string" ? searchParams.tabla_afectada : "",
        fecha_desde: typeof searchParams.fecha_desde === "string" ? searchParams.fecha_desde : "",
        fecha_hasta: typeof searchParams.fecha_hasta === "string" ? searchParams.fecha_hasta : "",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Página principal
// ──────────────────────────────────────────────────────────────────────────────

export default async function AuditoriaInventarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Verificar sesión y permiso antes de renderizar
  const sesion = await getServerSession();

  if (!sesion) {
    // Defensa en profundidad: el middleware ya valida el JWT, pero una sesión
    // recién revocada puede llegar hasta acá antes de que expire criptográficamente.
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
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

  const autorizado = await usuarioTienePermiso(
    sesion.userId,
    PERMISO_LEER_FORENSE,
  );
  if (!autorizado) {
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No tenés el permiso necesario para acceder a esta sección.
              Contactá al administrador del sistema.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  const params = await searchParams;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-100 text-indigo-600 shrink-0">
              <FileSearch className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                Auditoría Forense — Inventario
              </h1>
              <p className="text-sm text-muted-foreground">
                Historial de movimientos y verificación de integridad SHA-256.
              </p>
            </div>
          </div>
        </div>

        {/* ── Banner de seguridad ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl shrink-0">
              <Lock className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold">
                Vista de solo lectura — Auditor
              </p>
              <p className="text-xs text-indigo-100 mt-0.5">
                Toda alta, actualización o baja lógica sobre inventario queda
                registrada en un ledger encadenado por SHA-256, verificable en
                cualquier momento.
              </p>
            </div>
          </div>
          <div className="sm:ml-auto shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/15 text-xs font-semibold">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Ledger SHA-256 activo
          </div>
        </div>

        {/* ── Tabla en Card ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileSearch
                className="size-4 text-indigo-500"
                aria-hidden="true"
              />
              Log de eventos — Inventario
            </CardTitle>
            <CardDescription>
              Movimientos de stock, altas y bajas del catálogo de productos, y
              configuración de umbrales de reposición.
            </CardDescription>
            <CardAction>
              <span className="text-xs text-muted-foreground italic flex items-center gap-1">
                <Lock className="size-3" aria-hidden="true" />
                Solo lectura
              </span>
            </CardAction>
          </CardHeader>

          <CardContent className="pt-5">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  Cargando historial forense…
                </div>
              }
            >
              <AuditoriaData searchParams={params} sesion={sesion} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
