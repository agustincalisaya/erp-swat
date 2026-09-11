"use client";

/**
 * @component DialogReactivarUsuario
 * @description AlertDialog de confirmación para la reactivación de un
 * Usuario INACTIVO (task_cali_filtro_reactivacion.md §2.5). Deliberadamente
 * separado del botón simple "Activo" de `ControlEstadoUsuario` (Endpoint
 * 2.2.3) — reactivar una baja lógica es una decisión de mayor peso, por eso
 * exige su propio motivo obligatorio y muestra el `deletion_reason`
 * original antes de confirmar.
 *
 * UI Stack: Shadcn UI AlertDialog + Textarea + Button (mismo patrón que
 * `DialogBajaUsuario.tsx`). Server Action `reactivarUsuarioAction`
 * (re-valida en servidor).
 */

import { useState, useTransition, useCallback } from "react";
import { UserCheck, Loader2, History } from "lucide-react";

import { reactivarUsuarioAction } from "@/app/(dashboard)/auditoria/usuarios/actions";
import type { UsuarioReactivado } from "@/lib/services/auditoria/usuario.service";

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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

interface DialogReactivarUsuarioProps {
  usuarioId: string;
  nombreUsuario: string;
  deletionReason: string | null;
  deletedAt: Date | null;
  onSuccess?: (data: UsuarioReactivado) => void;
}

export function DialogReactivarUsuario({
  usuarioId,
  nombreUsuario,
  deletionReason,
  deletedAt,
  onSuccess,
}: DialogReactivarUsuarioProps) {
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
      const result = await reactivarUsuarioAction({
        usuario_id: usuarioId,
        motivo_reactivacion: motivo,
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
            id={`btn-reactivar-usuario-${usuarioId}`}
            variant="outline"
            size="sm"
            className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
          />
        }
      >
        <UserCheck className="size-3.5" />
        Reactivar
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <UserCheck className="size-4 text-green-600" aria-hidden="true" />
            Reactivar a {nombreUsuario}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción restaura el acceso del usuario al sistema. El historial de la baja
            original se conserva.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Alert className="bg-muted/40 border-border">
          <History className="size-4" aria-hidden="true" />
          <AlertDescription className="text-xs">
            {deletedAt ? (
              <>
                Este usuario fue dado de baja el <strong>{formatDate(deletedAt)}</strong>
                {deletionReason ? (
                  <>
                    {" "}
                    por: <em>&ldquo;{deletionReason}&rdquo;</em>
                  </>
                ) : (
                  " sin motivo registrado."
                )}
              </>
            ) : (
              "No hay datos de baja registrados para este usuario."
            )}
          </AlertDescription>
        </Alert>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`motivo-reactivacion-${usuarioId}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Motivo de la reactivación
          </label>
          <textarea
            id={`motivo-reactivacion-${usuarioId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Reincorporación institucional aprobada"
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede confirmar la reactivación sin un motivo.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={!motivoValido || isPending}
            onClick={handleConfirm}
            className="gap-2 bg-green-600 hover:bg-green-700 text-white"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Reactivando…
              </>
            ) : (
              <>
                <UserCheck className="size-4" aria-hidden="true" />
                Confirmar reactivación
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
