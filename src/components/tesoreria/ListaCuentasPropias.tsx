"use client";

/**
 * @component ListaCuentasPropias
 * @description HU-G5 §9.7 (G5-3) — grilla de cuentas propias con sus acciones.
 * Solo presentación: el listado ya llega resuelto y ENMASCARADO por el RSC
 * padre (máx. 4 caracteres finales del CBU/alias). Cada fila ofrece editar y dar
 * de baja (permiso `gestionar_cuentas_bancarias`) y revelar datos
 * (`ver_datos_bancarios`); el servidor vuelve a validar cada permiso.
 *
 * Hydration: los `key` de fila usan el `id` estable de la cuenta — nunca
 * `crypto.randomUUID()` en un atributo renderizado.
 */

import { useCallback, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

import { darDeBajaCuentaPropiaAction } from "@/app/(dashboard)/tesoreria/cuentas-propias/actions";
import type { CuentaPropiaListado } from "@/lib/services/tesoreria/cuenta-propia.service";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormularioCuentaPropia } from "@/components/tesoreria/FormularioCuentaPropia";
import { BotonRevelarDatos } from "@/components/tesoreria/BotonRevelarDatos";

const TIPO_LABEL: Record<CuentaPropiaListado["tipo"], string> = {
  BANCARIA: "Bancaria",
  CAJA: "Caja",
};

interface ListaCuentasPropiasProps {
  cuentas: CuentaPropiaListado[];
  puedeGestionar: boolean;
  puedeRevelar: boolean;
}

export function ListaCuentasPropias({
  cuentas,
  puedeGestionar,
  puedeRevelar,
}: ListaCuentasPropiasProps) {
  if (cuentas.length === 0) {
    return (
      <div className="space-y-4">
        {puedeGestionar && (
          <div className="flex justify-end">
            <FormularioCuentaPropia mode="alta" />
          </div>
        )}
        <p className="py-12 text-center text-sm text-muted-foreground">
          No hay cuentas propias activas.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {puedeGestionar && (
        <div className="flex justify-end">
          <FormularioCuentaPropia mode="alta" />
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Banco</TableHead>
            <TableHead>CBU</TableHead>
            <TableHead>Alias</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cuentas.map((cuenta) => (
            <TableRow key={cuenta.id}>
              <TableCell className="font-medium">{cuenta.nombre}</TableCell>
              <TableCell>{TIPO_LABEL[cuenta.tipo]}</TableCell>
              <TableCell>{cuenta.banco ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">
                {cuenta.cbu_enmascarado ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {cuenta.alias_enmascarado ?? "—"}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {puedeRevelar && (
                    <BotonRevelarDatos cuentaPropiaId={cuenta.id} nombre={cuenta.nombre} />
                  )}
                  {puedeGestionar && (
                    <>
                      <FormularioCuentaPropia mode="edicion" cuenta={cuenta} />
                      <BotonDarDeBaja cuentaPropiaId={cuenta.id} nombre={cuenta.nombre} />
                    </>
                  )}
                  {!puedeGestionar && !puedeRevelar && (
                    <span className="text-xs text-muted-foreground">Sin permiso</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface BotonDarDeBajaProps {
  cuentaPropiaId: string;
  nombre: string;
}

/** Diálogo de baja LÓGICA: exige un motivo (obligatorio) y nunca borra. */
function BotonDarDeBaja({ cuentaPropiaId, nombre }: BotonDarDeBajaProps) {
  const router = useRouter();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resetear = useCallback(() => {
    setMotivo("");
    setError(null);
  }, []);

  const handleOpenChange = (abierto: boolean) => {
    setOpen(abierto);
    if (!abierto) resetear();
  };

  const confirmar = () => {
    setError(null);
    if (motivo.trim().length === 0) {
      setError("El motivo de baja es obligatorio");
      return;
    }
    startTransition(async () => {
      const res = await darDeBajaCuentaPropiaAction(cuentaPropiaId, {
        deletion_reason: motivo.trim(),
      });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button type="button" variant="outline" size="sm" className="gap-1.5" />}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Dar de baja
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dar de baja — {nombre}</DialogTitle>
          <DialogDescription>
            La baja es lógica: la cuenta deja de estar disponible pero no se
            elimina. Indicá el motivo (obligatorio).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-motivo`}>Motivo de baja</Label>
          <textarea
            id={`${fieldId}-motivo`}
            rows={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo de la baja (máx. 500 caracteres)"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" disabled={isPending} className="gap-2" onClick={confirmar}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Dando de baja…
              </>
            ) : (
              "Confirmar baja"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
