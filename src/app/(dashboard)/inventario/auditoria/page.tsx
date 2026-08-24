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
  title: "Auditoría Forense — Módulo A (Inventario) | ERP SWAT",
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
  // Extraer término de búsqueda libre
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

  let listado;
  try {
    listado = await obtenerLogsInventario(filtrosParsed.data, sesion, q);
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
      q={q ?? ""}
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
                Cada acceso a datos sensibles se registra automáticamente como{" "}
                <span className="font-semibold">LECTURA_SENSIBLE</span> en el
                ledger de auditoría (Ley N.° 25.326).
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
              Log de eventos — Módulo A
            </CardTitle>
            <CardDescription>
              Movimientos de stock, legajos en prueba y cambios de inventario.
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
