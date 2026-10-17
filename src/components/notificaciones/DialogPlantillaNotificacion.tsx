"use client";

/**
 * @component DialogPlantillaNotificacion
 * @description Alta y edición de una PlantillaNotificacion (HU-F2,
 * spec_modulo_F.md §2.2, task §6).
 *
 *  - Alta: `tipo_evento` se elige del registro de eventos
 *    (`TIPOS_EVENTO_PLANTILLA`, Punto abierto 4 resuelto).
 *  - Edición: `tipo_evento` es inmutable — se muestra solo lectura y nunca se
 *    envía (el schema de edición es `.strict()`).
 *
 * Los placeholders `{{variable}}` se guardan tal cual; los resuelve el Motor
 * de Notificaciones (HU-F3). No hay catálogo de variables por evento
 * (Punto abierto 5): el texto de ayuda solo explica la sintaxis.
 *
 * Tras el éxito: `router.refresh()` ANTES de cerrar el Dialog y toast de
 * éxito (task §6, lección HU-H9).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";

import {
  crearPlantillaNotificacionAction,
  editarPlantillaNotificacionAction,
} from "@/app/(dashboard)/administracion/notificaciones/actions";
import type { PlantillaNotificacionListado } from "@/lib/services/notificaciones/plantilla-notificacion.service";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

import { ETIQUETA_PRIORIDAD, PRIORIDADES, type Prioridad } from "./prioridad";

const CLASE_CAMPO =
  "w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

interface DialogPlantillaNotificacionProps {
  open: boolean;
  onClose: () => void;
  /** Sin plantilla → alta; con plantilla → edición. */
  plantilla?: PlantillaNotificacionListado;
  /** Registro de eventos admitidos (alta). Los que ya tienen plantilla se omiten. */
  tiposEvento: readonly string[];
}

export function DialogPlantillaNotificacion({
  open,
  onClose,
  plantilla,
  tiposEvento,
}: DialogPlantillaNotificacionProps) {
  const router = useRouter();
  const esEdicion = plantilla !== undefined;

  // El estado arranca de la plantilla (o vacío en el alta): la tabla remonta
  // el Dialog con un `key` nuevo en cada apertura.
  const [tipoEvento, setTipoEvento] = useState(plantilla?.tipo_evento ?? "");
  const [asunto, setAsunto] = useState(plantilla?.asunto ?? "");
  const [cuerpo, setCuerpo] = useState(plantilla?.cuerpo ?? "");
  const [prioridad, setPrioridad] = useState<Prioridad>(
    plantilla?.prioridad_default ?? "INFORMATIVA",
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const valido =
    tipoEvento.length > 0 && asunto.trim().length > 0 && cuerpo.trim().length > 0;

  const handleGuardar = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = esEdicion
        ? await editarPlantillaNotificacionAction(plantilla.id, {
            asunto,
            cuerpo,
            prioridad_default: prioridad,
          })
        : await crearPlantillaNotificacionAction({
            tipo_evento: tipoEvento,
            asunto,
            cuerpo,
            prioridad_default: prioridad,
          });

      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }

      router.refresh();
      onClose();
      toast.add({
        title: esEdicion ? "Plantilla actualizada" : "Plantilla creada",
        description: `${resultado.data.tipo_evento} — los próximos eventos usarán esta redacción.`,
        type: "success",
      });
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle>
          <DialogDescription>
            {esEdicion
              ? "El cambio de redacción aplica desde el próximo evento, sin despliegue."
              : "Cada evento de dominio admite una sola plantilla. Sin plantilla activa, el sistema usa un texto por defecto."}
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plantilla-tipo-evento" className="text-xs">
              Evento de dominio
            </Label>
            {esEdicion ? (
              <p
                id="plantilla-tipo-evento"
                className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground"
              >
                {plantilla.tipo_evento}
                <span className="ml-2 font-sans">(no editable)</span>
              </p>
            ) : (
              <select
                id="plantilla-tipo-evento"
                value={tipoEvento}
                onChange={(e) => setTipoEvento(e.target.value)}
                disabled={isPending}
                className={`${CLASE_CAMPO} h-9 font-mono text-xs`}
              >
                <option value="">Seleccioná un evento…</option>
                {tiposEvento.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plantilla-asunto" className="text-xs">
              Asunto
            </Label>
            <Input
              id="plantilla-asunto"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              disabled={isPending}
              placeholder="Ej: Stock en umbral crítico"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plantilla-cuerpo" className="text-xs">
              Cuerpo
            </Label>
            <textarea
              id="plantilla-cuerpo"
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              disabled={isPending}
              rows={5}
              placeholder="Ej: Tu pedido {{numero_venta}} ya está listo para retirar."
              className={`${CLASE_CAMPO} py-2`}
            />
            <p className="text-xs text-muted-foreground">
              Podés insertar datos del evento con <code className="font-mono">{"{{variable}}"}</code>
              , por ejemplo <code className="font-mono">{"{{numero_venta}}"}</code>. Una variable
              que el evento no informa se reemplaza por texto vacío.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plantilla-prioridad" className="text-xs">
              Prioridad por defecto
            </Label>
            <select
              id="plantilla-prioridad"
              value={prioridad}
              onChange={(e) => setPrioridad(e.target.value as Prioridad)}
              disabled={isPending}
              className={`${CLASE_CAMPO} h-9`}
            >
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {ETIQUETA_PRIORIDAD[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!valido || isPending}
            onClick={handleGuardar}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {isPending ? "Guardando…" : esEdicion ? "Guardar cambios" : "Crear plantilla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
