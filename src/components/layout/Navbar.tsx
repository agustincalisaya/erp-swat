/**
 * @component Navbar
 * @description Barra superior del dashboard (HU-D9,
 * task_cali_layout_dashboard.md). Server Component: resuelve sesión e
 * identidad (nombre, roles) del usuario autenticado; delega el logout —
 * única parte interactiva — a `LogoutButton` (Client Component).
 *
 * La campana de notificaciones (HU-F3) es un Client Component propio con
 * polling del contador de no leídas — `CampanaNotificaciones`.
 */
import { UserCircle2 } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { obtenerIdentidadUsuario } from "@/lib/services/auditoria/usuario.service";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { CampanaNotificaciones } from "@/components/notificaciones/CampanaNotificaciones";
import { Badge } from "@/components/ui/badge";
import { ThemeSelector } from "@/components/theme/ThemeSelector";

export async function Navbar() {
  const session = await getServerSession();
  if (!session) return null;

  const identidad = await obtenerIdentidadUsuario(session.userId);

  return (
    <header className="h-14 shrink-0 border-b border-border bg-card flex items-center justify-between gap-4 px-4 sm:px-6">
      <div className="lg:hidden w-8" aria-hidden="true" />

      <div className="flex-1"><ThemeSelector /></div>

      <div className="flex items-center gap-3">
        <CampanaNotificaciones />

        <div className="hidden sm:flex items-center gap-2 pl-1 border-l border-border">
          <UserCircle2 className="size-6 text-muted-foreground ml-2" aria-hidden="true" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-foreground">
              {identidad?.nombre_completo ?? session.nombreUsuario}
            </span>
            <div className="flex flex-wrap gap-1">
              {(identidad?.roles ?? []).length > 0 ? (
                identidad!.roles.map((rol) => (
                  <Badge
                    key={rol}
                    className="bg-info text-info-foreground border border-info-foreground hover:bg-info text-[10px] px-1.5 py-0"
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
