/**
 * @page RolesPage
 * @route /auditoria/roles
 *
 * Server Component: lista roles activos con su detalle de permisos, y el
 * catálogo de permisos disponibles para los selectores de alta/edición.
 * Endpoints 2.2.5 (alta) / 2.2.6 (actualización de permisos) — Módulo D.2.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { listarRoles, listarPermisos } from "@/lib/services/auditoria/rol.service";
import { FormularioAltaRol } from "@/components/auditoria/FormularioAltaRol";
import { EditorPermisosRol } from "@/components/auditoria/EditorPermisosRol";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// Server Component: resuelve sesión (`getServerSession()`, lee cookies) y
// llama a `listarRoles()`/`listarPermisos()` (Prisma) directamente. Sin
// esto, `next build` intenta prerenderizar la página estáticamente y falla
// si no hay una base de datos accesible en build-time (ej. CI). Además,
// RBAC exige lectura fresca en cada request (spec_modulo_D.md §3.3 —
// revocación inmediata), así que esta página nunca debería cachearse.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Roles y Permisos — ERP SWAT",
  description: "Gestión de RBAC: alta de roles y asignación de permisos (Módulo D).",
};

const PERMISO_ROLES_ADMINISTRAR = "roles:administrar";

// ──────────────────────────────────────────────────────────────────────────────
// Server: obtener datos (componente async para Suspense)
// ──────────────────────────────────────────────────────────────────────────────
// Sin prop de permiso: llegar acá ya implica `roles:administrar` (HU-D10,
// task_cali_bloqueo_url_auditoria.md §1.2 — la página redirige a
// `/no-autorizado` antes de renderizar `RolesData` si falta el permiso).
// La rama de solo-lectura que existía para usuarios sin el permiso se
// eliminó junto con ese redirect: ya no hay caso en que este componente
// se renderice para alguien sin `roles:administrar`.
async function RolesData() {
  let roles;
  let permisos;
  try {
    [roles, permisos] = await Promise.all([listarRoles(true), listarPermisos()]);
  } catch (err) {
    console.error("[RolesPage] Error al obtener roles/permisos:", err);
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertDescription>
          No se pudieron cargar los roles. Verificá la conexión con la base de datos.
        </AlertDescription>
      </Alert>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed border-blue-100 bg-blue-50/40 text-center">
        <div className="p-4 rounded-full bg-blue-100 text-blue-500 mb-4">
          <ShieldCheck className="size-8" />
        </div>
        <p className="text-sm font-medium text-gray-600">No hay roles activos</p>
        <p className="text-xs text-muted-foreground mt-1">
          Dá de alta el primer rol usando el botón superior.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="border-b border-border hover:bg-transparent">
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rol
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Permisos
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">
              Acciones
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {roles.map((rol) => (
            <TableRow key={rol.id} className="hover:bg-blue-50/30">
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold">{rol.nombre}</span>
                  {rol.descripcion && (
                    <span className="text-xs text-muted-foreground">{rol.descripcion}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1 max-w-md">
                  {rol.permisos && rol.permisos.length > 0 ? (
                    rol.permisos.map((permiso) => (
                      <Badge
                        key={permiso.id}
                        className="bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-100 font-mono text-[10px]"
                      >
                        {permiso.codigo}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Sin permisos</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <EditorPermisosRol
                  rolId={rol.id}
                  nombreRol={rol.nombre}
                  permisoIdsActuales={(rol.permisos ?? []).map((p) => p.id)}
                  permisosDisponibles={permisos}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Página
// ──────────────────────────────────────────────────────────────────────────────
export default async function RolesPage() {
  const session = await getServerSession();

  if (!session) {
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

  // Bloqueo real de acceso (HU-D10, task_cali_bloqueo_url_auditoria.md
  // §1.2) — reemplaza la vista de solo lectura que existía para usuarios
  // sin `roles:administrar` por un rechazo real: si no está autorizado,
  // no llega a ver ni la tabla ni ningún dato de roles/permisos.
  const puedeAdministrar = await usuarioTienePermiso(session.userId, PERMISO_ROLES_ADMINISTRAR);
  if (!puedeAdministrar) redirect("/no-autorizado");

  const permisosParaAlta = await listarPermisos();

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header + CTA ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Roles y Permisos</h1>
              <p className="text-sm text-muted-foreground">
                Los cambios de permisos afectan de inmediato a todos los usuarios con ese rol.
              </p>
            </div>
          </div>
          <div className="pl-12 sm:pl-0">
            <FormularioAltaRol permisos={permisosParaAlta} />
          </div>
        </div>

        {/* ── Tabla en Card ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-blue-500" aria-hidden="true" />
              Roles activos
            </CardTitle>
            <CardDescription>Roles del sistema y sus permisos asignados.</CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Cargando roles…
                </div>
              }
            >
              <RolesData />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
