"use client";

/**
 * @component BotonRevelarDatos
 * @description HU-G5 §9.7 (G5-3) — revelado EXPLÍCITO del CBU/alias de una
 * cuenta propia. Botón que invoca `revelarDatosBancariosAction` (permiso
 * `tesoreria:ver_datos_bancarios`) y muestra el valor en claro SOLO dentro de un
 * diálogo efímero; al cerrarlo se limpia el estado (el dato nunca queda en la
 * grilla ni en memoria más allá de la lectura explícita).
 */

import { useState, useTransition } from "react";
import { Eye, Loader2, ShieldAlert } from "lucide-react";

import { revelarDatosBancariosAction } from "@/app/(dashboard)/tesoreria/cuentas-propias/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface BotonRevelarDatosProps {
  cuentaPropiaId: string;
  nombre: string;
}

interface DatosRevelados {
  cbu: string | null;
  alias: string | null;
}

export function BotonRevelarDatos({ cuentaPropiaId, nombre }: BotonRevelarDatosProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [datos, setDatos] = useState<DatosRevelados | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revelar = () => {
    setError(null);
    startTransition(async () => {
      const res = await revelarDatosBancariosAction(cuentaPropiaId);
      if (res.error) {
        setDatos(null);
        setError(res.error.message);
        return;
      }
      setDatos({ cbu: res.data.cbu, alias: res.data.alias });
    });
  };

  const handleOpenChange = (abierto: boolean) => {
    setOpen(abierto);
    if (!abierto) {
      // Limpieza al cerrar: el valor sensible no persiste en el estado.
      setDatos(null);
      setError(null);
    } else {
      revelar();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" className="gap-1.5" />}>
        <Eye className="size-3.5" aria-hidden="true" />
        Ver datos
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-warning-foreground" aria-hidden="true" />
            Datos bancarios — {nombre}
          </DialogTitle>
          <DialogDescription>
            Lectura explícita de los datos bancarios. Esta consulta queda
            registrada en la auditoría.
          </DialogDescription>
        </DialogHeader>

        {isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Revelando…
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!isPending && !error && datos && (
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">CBU</dt>
            <dd className="font-mono">{datos.cbu ?? "—"}</dd>
            <dt className="text-muted-foreground">Alias</dt>
            <dd className="font-mono">{datos.alias ?? "—"}</dd>
          </dl>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cerrar
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
