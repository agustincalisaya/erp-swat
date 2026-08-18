"use client";

/**
 * @component ControlEstadoUsuario
 * @description Control simple para el cambio de estado manual de Usuario
 * (Endpoint 2.2.3, task_cali_estado_usuario.md §6). Tres botones —
 * ACTIVO/SUSPENDIDO/BLOQUEADO— con el estado actual deshabilitado
 * (soporte de la idempotencia del service también a nivel UI).
 *
 * Server Action `cambiarEstadoUsuarioAction` (re-valida en servidor).
 */

import { useTransition, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, Loader2 } from "lucide-react";

import { cambiarEstadoUsuarioAction } from "@/app/(dashboard)/auditoria/usuarios/actions";
import type { UsuarioEstadoCambiado } from "@/lib/services/auditoria/usuario.service";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {OPCIONES.map(({ estado, label, icon: Icon, activeClass }) => {
          const esActual = estado === estadoActual;
          return (
            <Button
              key={estado}
              type="button"
              size="sm"
              variant="outline"
              disabled={esActual || isPending}
              onClick={() => handleClick(estado)}
              title={esActual ? `Ya está ${label.toLowerCase()}` : `Marcar como ${label}`}
              className={`gap-1 text-xs px-2 ${esActual ? activeClass : ""}`}
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Icon className="size-3" aria-hidden="true" />
              )}
              {label}
            </Button>
          );
        })}
      </div>
      {serverError && (
        <Alert variant="destructive" className="py-1.5 px-2">
          <AlertDescription className="text-xs">{serverError}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
