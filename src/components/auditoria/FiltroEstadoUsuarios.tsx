"use client";

/**
 * @component FiltroEstadoUsuarios
 * @description Filtro Activos/Inactivos/Todos para el listado de Usuarios
 * (task_cali_filtro_reactivacion.md §1.3). El filtro vive en la URL
 * (`?estado=...`) — mismo patrón que `FiltrosAuditoria.tsx`: al cambiar,
 * navega a la misma ruta con el query param actualizado, y el Server
 * Component (`page.tsx`) vuelve a llamar `listarUsuarios(filtro)`.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Users, UserCheck, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FiltroEstadoUsuario } from "@/lib/services/auditoria/usuario.service";

const OPCIONES: { valor: FiltroEstadoUsuario; label: string; icon: typeof Users }[] = [
  { valor: "activos", label: "Activos", icon: UserCheck },
  { valor: "inactivos", label: "Inactivos", icon: UserX },
  { valor: "todos", label: "Todos", icon: Users },
];

interface FiltroEstadoUsuariosProps {
  filtroActual: FiltroEstadoUsuario;
}

export function FiltroEstadoUsuarios({ filtroActual }: FiltroEstadoUsuariosProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const cambiarFiltro = (valor: FiltroEstadoUsuario) => {
    if (valor === filtroActual) return;

    const params = new URLSearchParams(searchParams.toString());
    if (valor === "activos") {
      params.delete("estado");
    } else {
      params.set("estado", valor);
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1 gap-1">
      {OPCIONES.map(({ valor, label, icon: Icon }) => {
        const activo = valor === filtroActual;
        return (
          <Button
            key={valor}
            type="button"
            size="sm"
            variant={activo ? "default" : "ghost"}
            onClick={() => cambiarFiltro(valor)}
            className="gap-1.5 text-xs px-2.5"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
