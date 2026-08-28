/**
 * @component Navbar
 * @description Barra superior del dashboard (HU-D9,
 * task_cali_layout_dashboard.md). Server Component: resuelve sesión e
 * identidad (nombre, roles) del usuario autenticado; delega el logout —
 * única parte interactiva — a `LogoutButton` (Client Component).
 *
 * El espacio de notificaciones queda contemplado en el diseño (icono
 * deshabilitado) aunque ningún módulo emite notificaciones todavía —
 * ver task_cali_layout_dashboard.md §1.
 */
import { Bell, UserCircle2 } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { obtenerIdentidadUsuario } from "@/lib/services/auditoria/usuario.service";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { Badge } from "@/components/ui/badge";
import { limpiarNombreUsuario } from "@/lib/utils/nombre-usuario";

export async function Navbar() {
  const session = await getServerSession();
  if (!session) return null;

  const identidad = await obtenerIdentidadUsuario(session.userId);

  return (
    <header className="h-14 shrink-0 border-b border-border bg-white flex items-center justify-between gap-4 px-4 sm:px-6">
      <div className="lg:hidden w-8" aria-hidden="true" />

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {/* Espacio reservado para notificaciones — sin fuente de datos hoy. */}
        <button
          type="button"
          disabled
          className="p-2 rounded-lg text-gray-300 cursor-not-allowed"
          aria-label="Notificaciones (sin novedades)"
          title="Sin notificaciones configuradas todavía"
        >
          <Bell className="size-4.5" aria-hidden="true" />
        </button>

        <div className="hidden sm:flex items-center gap-2 pl-1 border-l border-border">
          <UserCircle2 className="size-6 text-gray-400 ml-2" aria-hidden="true" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-gray-900">
              {limpiarNombreUsuario(identidad?.nombre_completo ?? session.nombreUsuario)}
            </span>
            <div className="flex flex-wrap gap-1">
              {(identidad?.roles ?? []).length > 0 ? (
                identidad!.roles.map((rol) => (
                  <Badge
                    key={rol}
                    className="bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-100 text-[10px] px-1.5 py-0"
                  >
                    {rol}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground italic">Sin roles</span>
              )}
            </div>
          </div>
        </div>

        <LogoutButton />
      </div>
    </header>
  );
}
