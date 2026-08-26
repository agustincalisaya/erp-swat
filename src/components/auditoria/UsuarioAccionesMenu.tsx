"use client";

/**
 * @component UsuarioAccionesMenu
 * @description Contenedor puramente visual (task_modificacion.md — refactor
 * de la columna "Acciones" del listado `/auditoria/usuarios`). Agrupa, para
 * usuarios no-INACTIVO, las 4 acciones existentes — Activo/Suspender/
 * Bloquear (`ControlEstadoUsuario`) y Dar de baja (`DialogBajaUsuario`) —
 * dentro de un `DropdownMenu` de shadcn/ui activado por un botón de tres
 * puntos, en vez de mostrarlas como botones inline.
 *
 * No agrega lógica: cada ítem de menú dispara exactamente el mismo
 * handler/Server Action/validación que disparaba su botón equivalente antes
 * del refactor — solo cambia el contenedor visual.
 *
 * `DialogBajaUsuario` se renderiza como HERMANO del `DropdownMenu` (no
 * anidado en `DropdownMenuContent`): su `open` vive acá y se le pasa como
 * prop controlada. Si el diálogo quedara anidado en el menú, cerrar el menú
 * al hacer click en el ítem lo desmontaría a mitad de apertura; y si el menú
 * se mantenía abierto para evitar eso, ambos overlays competían por el foco
 * y el `<textarea>` de motivo no aceptaba texto.
 */

import { useState } from "react";
import { MoreVertical, UserX } from "lucide-react";

import { ControlEstadoUsuario } from "@/components/auditoria/ControlEstadoUsuario";
import { DialogBajaUsuario } from "@/components/auditoria/DialogBajaUsuario";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UsuarioAccionesMenuProps {
  usuarioId: string;
  nombreUsuario: string;
  estadoActual: string;
}

export function UsuarioAccionesMenu({
  usuarioId,
  nombreUsuario,
  estadoActual,
}: UsuarioAccionesMenuProps) {
  const [bajaOpen, setBajaOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Más acciones" />}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <ControlEstadoUsuario usuarioId={usuarioId} estadoActual={estadoActual} />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            id={`btn-baja-usuario-${usuarioId}`}
            variant="destructive"
            onClick={() => setBajaOpen(true)}
          >
            <UserX className="size-3.5" aria-hidden="true" />
            Dar de baja
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogBajaUsuario
        usuarioId={usuarioId}
        nombreUsuario={nombreUsuario}
        open={bajaOpen}
        onOpenChange={setBajaOpen}
      />
    </>
  );
}
