"use client";

/**
 * @component ControlEstadoUsuario
 * @description Control simple para el cambio de estado manual de Usuario
 * (Endpoint 2.2.3, task_cali_estado_usuario.md §6). Tres ítems de menú —
 * ACTIVO/SUSPENDIDO/BLOQUEADO— con el estado actual deshabilitado
 * (soporte de la idempotencia del service también a nivel UI).
 *
 * Contenedor visual: `DropdownMenuItem` (task_modificacion.md — refactor de
 * la columna Acciones). Se renderiza como hijo de `DropdownMenuContent` en
 * `UsuarioAccionesMenu`; `closeOnClick={false}` para no cerrar el menú
 * mientras la Server Action está pendiente o si devuelve un error, igual que
 * antes no había ningún cierre involucrado al ser botones inline.
 *
 * Server Action `cambiarEstadoUsuarioAction` (re-valida en servidor).
 */

import { useTransition, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, Loader2 } from "lucide-react";

import { cambiarEstadoUsuarioAction } from "@/app/(dashboard)/auditoria/usuarios/actions";
import type { UsuarioEstadoCambiado } from "@/lib/services/auditoria/usuario.service";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";

type EstadoManual = "ACTIVO" | "SUSPENDIDO" | "BLOQUEADO";

const OPCIONES: {
  estado: EstadoManual;
  label: string;
  icon: typeof ShieldCheck;
  activeClass: string;
}[] = [
  {
    estado: "ACTIVO",
    label: "Activo",
    icon: ShieldCheck,
    activeClass: "bg-green-100 text-green-700 border-green-200 hover:bg-green-100",
  },
  {
    estado: "SUSPENDIDO",
    label: "Suspender",
    icon: ShieldAlert,
    activeClass: "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100",
  },
  {
    estado: "BLOQUEADO",
    label: "Bloquear",
    icon: ShieldX,
    activeClass: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
  },
];

interface ControlEstadoUsuarioProps {
  usuarioId: string;
  estadoActual: string;
  onSuccess?: (data: UsuarioEstadoCambiado) => void;
}

export function ControlEstadoUsuario({
  usuarioId,
  estadoActual,
  onSuccess,
}: ControlEstadoUsuarioProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = (nuevoEstado: EstadoManual) => {
    if (nuevoEstado === estadoActual) return;

    setServerError(null);
    startTransition(async () => {
      const result = await cambiarEstadoUsuarioAction({
        usuario_id: usuarioId,
        nuevo_estado: nuevoEstado,
      });
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
        return;
      }
      onSuccess?.(result.data!);
    });
  };

  return (
    <>
      {OPCIONES.map(({ estado, label, icon: Icon, activeClass }) => {
        const esActual = estado === estadoActual;
        return (
          <DropdownMenuItem
            key={estado}
            closeOnClick={false}
            disabled={esActual || isPending}
            onClick={() => handleClick(estado)}
            title={esActual ? `Ya está ${label.toLowerCase()}` : `Marcar como ${label}`}
            className={esActual ? activeClass : undefined}
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="size-3.5" aria-hidden="true" />
            )}
            {label}
          </DropdownMenuItem>
        );
      })}
      {serverError && (
        <div className="px-1.5 py-1">
          <Alert variant="destructive" className="py-1.5 px-2">
            <AlertDescription className="text-xs">{serverError}</AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}
