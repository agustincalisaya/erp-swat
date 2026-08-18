"use client";

/**
 * @component EditorPermisosRol
 * @description Modal para reemplazar el conjunto de Permisos de un Rol
 * existente (Endpoint 2.2.6, task_cali_roles_permisos.md §7). Muestra el
 * diff (qué se agrega, qué se remueve) antes de confirmar — refuerza a
 * nivel UI la advertencia operativa de que el cambio afecta de inmediato a
 * todos los usuarios con ese rol (spec_modulo_D.md §2.2.6).
 *
 * Si el guardado dispara `SISTEMA_SIN_ADMINISTRADOR` (§4.3 — la operación
 * dejaría al sistema sin ningún usuario con `roles:administrar`), muestra
 * un mensaje específico explicando por qué se bloqueó, no un error genérico.
 *
 * Server Action `actualizarPermisosRolAction` (re-valida en servidor).
 */

import { useState, useTransition, useMemo } from "react";
import { ShieldAlert, Loader2, Plus, Minus } from "lucide-react";

import { actualizarPermisosRolAction } from "@/app/(dashboard)/auditoria/roles/actions";
import type {
  RolPermisosActualizados,
  PermisoListado,
} from "@/lib/services/auditoria/rol.service";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface EditorPermisosRolProps {
  rolId: string;
  nombreRol: string;
  permisoIdsActuales: string[];
  permisosDisponibles: PermisoListado[];
  onSuccess?: (data: RolPermisosActualizados) => void;
}

export function EditorPermisosRol({
  rolId,
  nombreRol,
  permisoIdsActuales,
  permisosDisponibles,
  onSuccess,
}: EditorPermisosRolProps) {
  const [open, setOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<string[]>(permisoIdsActuales);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nuevoAbierto: boolean) => {
    if (nuevoAbierto) {
      setSeleccion(permisoIdsActuales);
      setServerError(null);
      setOpen(true);
    } else {
      setOpen(false);
      setServerError(null);
    }
  };

  const { agregados, removidos } = useMemo(() => {
    const actualesSet = new Set(permisoIdsActuales);
    const seleccionSet = new Set(seleccion);
    const porCodigo = new Map(permisosDisponibles.map((p) => [p.id, p.codigo]));

    return {
      agregados: seleccion
        .filter((id) => !actualesSet.has(id))
        .map((id) => porCodigo.get(id) ?? id),
      removidos: permisoIdsActuales
        .filter((id) => !seleccionSet.has(id))
        .map((id) => porCodigo.get(id) ?? id),
    };
  }, [seleccion, permisoIdsActuales, permisosDisponibles]);

  const hayDiff = agregados.length > 0 || removidos.length > 0;

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const result = await actualizarPermisosRolAction({ rol_id: rolId, permiso_ids: seleccion });
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
        return;
      }
      handleOpenChange(false);
      onSuccess?.(result.data!);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
        <ShieldAlert className="size-3.5" />
        Editar permisos
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Permisos de {nombreRol}</DialogTitle>
          <DialogDescription>
            El cambio afecta de inmediato a todos los usuarios con este rol — los permisos se
            resuelven en cada request, sin necesidad de volver a loguearse.
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" aria-hidden="true" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2 rounded-lg border border-input p-3 max-h-56 overflow-y-auto">
          {permisosDisponibles.map((permiso) => {
            const checked = seleccion.includes(permiso.id);
            return (
              <label key={permiso.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setSeleccion((prev) =>
                      e.target.checked
                        ? [...prev, permiso.id]
                        : prev.filter((id) => id !== permiso.id),
                    );
                  }}
                  className="size-4 mt-0.5 rounded border-input accent-blue-600"
                />
                <span className="flex flex-col">
                  <span className="font-mono text-xs">{permiso.codigo}</span>
                  {permiso.descripcion && (
                    <span className="text-xs text-muted-foreground">{permiso.descripcion}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        {hayDiff && (
          <div className="space-y-1.5 text-xs">
            {agregados.map((codigo) => (
              <div key={`add-${codigo}`} className="flex items-center gap-1.5 text-green-700">
                <Plus className="size-3" aria-hidden="true" />
                <Badge className="bg-green-100 text-green-700 border border-green-200 hover:bg-green-100 font-mono">
                  {codigo}
                </Badge>
              </div>
            ))}
            {removidos.map((codigo) => (
              <div key={`rem-${codigo}`} className="flex items-center gap-1.5 text-red-700">
                <Minus className="size-3" aria-hidden="true" />
                <Badge className="bg-red-100 text-red-700 border border-red-200 hover:bg-red-100 font-mono">
                  {codigo}
                </Badge>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!hayDiff || isPending}
            onClick={handleConfirm}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Guardando…
              </>
            ) : (
              "Confirmar cambios"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
