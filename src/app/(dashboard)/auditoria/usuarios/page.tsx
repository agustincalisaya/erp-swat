/**
 * @page UsuariosPage
 * @route /auditoria/usuarios
 *
 * Server Component: lista usuarios activos (RULES.md §1 — filtrado por
 * defecto de inactivos) y roles disponibles para el selector de alta.
 * HU-1 (alta) / HU-2 (baja lógica) — Módulo D.2.
 */
import { Suspense } from "react";
import { Users, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle } from "lucide-react";
import { listarUsuarios, listarRolesActivos } from "@/lib/services/auditoria/usuario.service";
import { FormularioAltaUsuario } from "@/components/auditoria/FormularioAltaUsuario";
import { DialogBajaUsuario } from "@/components/auditoria/DialogBajaUsuario";
import { ControlEstadoUsuario } from "@/components/auditoria/ControlEstadoUsuario";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
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

// Server Component: llama a `listarUsuarios()`/`listarRolesActivos()` (Prisma)
// directamente al renderizar. Sin esto, `next build` intenta prerenderizar
// la página estáticamente y falla si no hay una base de datos accesible en
// build-time (ej. CI). Además, RBAC exige lectura fresca en cada request
// (spec_modulo_D.md §3.3 — revocación inmediata), así que esta página nunca
// debería cachearse de todos modos.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Usuarios — ERP SWAT",
  description: "Alta y baja lógica de usuarios del sistema (Módulo D — RBAC).",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

// Endpoint 2.2.3 hace que SUSPENDIDO/BLOQUEADO sean alcanzables desde la UI
// (además de la suspensión automática de HU-3) — el badge ya no puede ser
// siempre verde, debe reflejar el estado real de cada usuario.
const ESTADO_BADGE: Record<string, { className: string; icon: typeof ShieldCheck }> = {
  ACTIVO: {
    className: "bg-green-100 text-green-700 border border-green-200 hover:bg-green-100",
    icon: ShieldCheck,
  },
  SUSPENDIDO: {
    className: "bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-100",
    icon: ShieldAlert,
  },
  BLOQUEADO: {
    className: "bg-red-100 text-red-700 border border-red-200 hover:bg-red-100",
    icon: ShieldX,
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Server: obtener datos (componente async para Suspense)
// ──────────────────────────────────────────────────────────────────────────────
async function UsuariosData() {
  let usuarios;
  try {
    usuarios = await listarUsuarios();
  } catch (err) {
    console.error("[UsuariosPage] Error al obtener usuarios:", err);
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertDescription>
          No se pudieron cargar los usuarios. Verificá la conexión con la base de datos.
        </AlertDescription>
      </Alert>
    );
  }

  if (usuarios.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed border-blue-100 bg-blue-50/40 text-center">
        <div className="p-4 rounded-full bg-blue-100 text-blue-500 mb-4">
          <Users className="size-8" />
        </div>
        <p className="text-sm font-medium text-gray-600">No hay usuarios activos</p>
        <p className="text-xs text-muted-foreground mt-1">
          Dá de alta el primer usuario usando el botón superior.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="border-b border-border hover:bg-transparent">
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Usuario
            </TableHead>
            <TableHead className="hidden md:table-cell text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Email
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Roles
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Estado
            </TableHead>
            <TableHead className="hidden sm:table-cell text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Alta
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">
              Acciones
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {usuarios.map((usuario) => (
            <TableRow key={usuario.id} className="hover:bg-blue-50/30">
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold">{usuario.nombre_usuario}</span>
                  <span className="text-xs text-muted-foreground">{usuario.nombre_completo}</span>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <span className="text-xs text-muted-foreground">{usuario.email}</span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {usuario.roles.length > 0 ? (
                    usuario.roles.map((rol) => (
                      <Badge
                        key={rol}
                        className="bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-100"
                      >
                        {rol}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Sin roles</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {(() => {
                  const { className, icon: Icon } =
                    ESTADO_BADGE[usuario.estado] ?? ESTADO_BADGE.ACTIVO;
                  return (
                    <Badge className={`${className} gap-1`}>
                      <Icon className="size-3" aria-hidden="true" />
                      {usuario.estado}
                    </Badge>
                  );
                })()}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(usuario.created_at)}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-col items-end gap-2">
                  <ControlEstadoUsuario usuarioId={usuario.id} estadoActual={usuario.estado} />
                  <DialogBajaUsuario
                    usuarioId={usuario.id}
                    nombreUsuario={usuario.nombre_usuario}
                  />
                </div>
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
export default async function UsuariosPage() {
  const roles = await listarRolesActivos();

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header + CTA ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
              <Users className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Usuarios</h1>
              <p className="text-sm text-muted-foreground">
                Alta de usuarios y roles, y baja lógica con revocación inmediata de accesos.
              </p>
            </div>
          </div>
          <div className="pl-12 sm:pl-0">
            <FormularioAltaUsuario roles={roles} />
          </div>
        </div>

        {/* ── Tabla en Card ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-blue-500" aria-hidden="true" />
              Usuarios activos
            </CardTitle>
            <CardDescription>Usuarios con acceso vigente al sistema.</CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Cargando usuarios…
                </div>
              }
            >
              <UsuariosData />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
