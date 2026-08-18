"use client";

/**
 * @component DialogBajaUsuario
 * @description AlertDialog de confirmación destructiva para la baja lógica
 * de un Usuario (HU-2). Exige escribir `deletion_reason` en el propio modal
 * antes de habilitar el botón de confirmación — la UI es la primera barrera,
 * el Zod schema server-side (`BajaLogicaUsuarioSchema`) la segunda
 * (spec_modulo_D.md — Componentes UI).
 *
 * UI Stack: Shadcn UI AlertDialog + Textarea + Button.
 * Server Action `desactivarUsuarioAction` (re-valida en servidor).
 */

import { useState, useTransition, useCallback } from "react";
import { UserX, Loader2, AlertTriangle } from "lucide-react";

import { desactivarUsuarioAction } from "@/app/(dashboard)/auditoria/usuarios/actions";
import type { UsuarioDadoDeBaja } from "@/lib/services/auditoria/usuario.service";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTrigger,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DialogBajaUsuarioProps {
  usuarioId: string;
  nombreUsuario: string;
  onSuccess?: (data: UsuarioDadoDeBaja) => void;
}

export function DialogBajaUsuario({ usuarioId, nombreUsuario, onSuccess }: DialogBajaUsuarioProps) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setMotivo("");
    setServerError(null);
  }, []);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const result = await desactivarUsuarioAction({
        usuario_id: usuarioId,
        deletion_reason: motivo,
      });
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
        return;
      }
      handleClose();
      onSuccess?.(result.data!);
    });
  };

  const motivoValido = motivo.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <AlertDialogTrigger
        render={
          <Button
            id={`btn-baja-usuario-${usuarioId}`}
            variant="destructive"
            size="sm"
            className="gap-1.5"
          />
        }
      >
        <UserX className="size-3.5" />
        Dar de baja
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Dar de baja a {nombreUsuario}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción revoca el acceso del usuario de inmediato. Su historial de auditoría
            permanece intacto — no puede deshacerse desde acá.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`motivo-baja-${usuarioId}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Motivo de la baja
          </label>
          <textarea
            id={`motivo-baja-${usuarioId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Egreso del colaborador — desvinculación institucional"
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede confirmar la baja sin un motivo.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={!motivoValido || isPending}
            onClick={handleConfirm}
            className="gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Dando de baja…
              </>
            ) : (
              <>
                <UserX className="size-4" aria-hidden="true" />
                Confirmar baja
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
