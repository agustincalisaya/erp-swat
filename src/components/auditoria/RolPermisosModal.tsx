"use client";

/**
 * @component RolPermisosModal
 * @description Modal de solo lectura con el detalle completo (codigo +
 * descripcion) de los permisos de un Rol. Reemplaza el listado de badges
 * individuales que antes se renderizaba inline en la columna "Permisos" de
 * `/auditoria/roles` (task_resumen_permisos_rol.md) — no agrega lectura ni
 * escritura nueva, reutiliza los datos que `listarRoles(true)` ya trae.
 */

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { PermisoListado } from "@/lib/services/auditoria/rol.service";

interface RolPermisosModalProps {
  nombreRol: string;
  permisos: PermisoListado[];
}

export function RolPermisosModal({ nombreRol, permisos }: RolPermisosModalProps) {
  const cantidad = permisos.length;
  const texto = cantidad === 1 ? "1 permiso" : `${cantidad} permisos`;

  if (cantidad === 0) {
    return (
      <Badge className="bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-100 text-[10px]">
        {texto}
      </Badge>
    );
  }

  return (
    <Dialog>
      <DialogTrigger
        nativeButton={false}
        render={
          <Badge
            className="bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 text-[10px] cursor-pointer"
            role="button"
            tabIndex={0}
          />
        }
      >
        {texto}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Permisos de {nombreRol}</DialogTitle>
          <DialogDescription>
            Detalle de solo lectura — {texto} asignado{cantidad === 1 ? "" : "s"} a este rol.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-lg border border-input p-3 max-h-72 overflow-y-auto">
          {permisos.map((permiso) => (
            <div key={permiso.id} className="flex flex-col gap-0.5">
              <span className="font-mono text-xs">{permiso.codigo}</span>
              <span className="text-xs text-muted-foreground">
                {permiso.descripcion || "Sin descripción"}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
