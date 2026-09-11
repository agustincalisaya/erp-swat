"use client";

/**
 * @component DialogBajaUsuario
 * @description AlertDialog de confirmación destructiva para la baja lógica
 * de un Usuario (HU-2). Exige escribir `deletion_reason` en el propio modal
 * antes de habilitar el botón de confirmación — la UI es la primera barrera,
 * el Zod schema server-side (`BajaLogicaUsuarioSchema`) la segunda
 * (spec_modulo_D.md — Componentes UI).
 *
 * UI Stack: Shadcn UI AlertDialog + Textarea + Button. `open`/`onOpenChange`
 * son props controladas por `UsuarioAccionesMenu` — el ítem "Dar de baja"
 * vive en el `DropdownMenu` (task_modificacion.md), pero este diálogo se
 * renderiza como hermano del menú, no anidado dentro de `DropdownMenuContent`.
 * Es necesario: mientras el diálogo estuvo anidado en el menú (con el menú
 * forzado a permanecer abierto vía `closeOnClick={false}` para no perder su
 * estado al desmontarse), ambos overlays competían por el foco y el
 * `<textarea>` de motivo no podía recibir texto — el menú se lo devolvía a su
 * ítem resaltado en cada tecla. Como hermano, cerrar el menú no afecta a este
 * diálogo y no hay conflicto de foco.
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
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DialogBajaUsuarioProps {
  usuarioId: string;
  nombreUsuario: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (data: UsuarioDadoDeBaja) => void;
}

export function DialogBajaUsuario({
  usuarioId,
  nombreUsuario,
  open,
  onOpenChange,
  onSuccess,
}: DialogBajaUsuarioProps) {
  const [motivo, setMotivo] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setMotivo("");
    setServerError(null);
  }, [onOpenChange]);

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
    <AlertDialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
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
