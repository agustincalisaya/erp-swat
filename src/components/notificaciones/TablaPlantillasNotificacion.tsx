"use client";

/**
 * @component TablaPlantillasNotificacion
 * @description Gestión de plantillas de notificación (HU-F2, task §6).
 *
 * Tabla simple con los datos que entrega la RSC y filtro de estado del lado
 * del cliente (default "Activas"), sin endpoint de listado — mismo criterio
 * que la pantalla de HU-B9. Muestra también las dadas de baja para poder
 * reactivarlas: excepción documentada a RULES.md Regla N.° 1 (task §6).
 *
 * Los cuatro Dialogs viven a nivel tabla (no por fila): al cambiar de estado,
 * la fila sale del filtro y se desmontaría junto con su modal.
 */

import { useMemo, useState } from "react";
import { BellOff, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";

import type { PlantillaNotificacionListado } from "@/lib/services/notificaciones/plantilla-notificacion.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DialogBajaPlantillaNotificacion } from "./DialogBajaPlantillaNotificacion";
import { DialogPlantillaNotificacion } from "./DialogPlantillaNotificacion";
import { DialogReactivarPlantillaNotificacion } from "./DialogReactivarPlantillaNotificacion";
import { ETIQUETA_PRIORIDAD, type Prioridad } from "./prioridad";

type FiltroEstado = "ACTIVAS" | "BAJA" | "TODAS";
type TipoDialog = "crear" | "editar" | "baja" | "reactivar";

const OPCIONES_FILTRO: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: "ACTIVAS", etiqueta: "Activas" },
  { valor: "BAJA", etiqueta: "Dadas de baja" },
  { valor: "TODAS", etiqueta: "Todas" },
];

const CLASE_PRIORIDAD: Record<Prioridad, string> = {
  CRITICA: "bg-red-600 text-white",
  ADVERTENCIA: "bg-amber-100 text-amber-800",
  INFORMATIVA: "bg-sky-100 text-sky-800",
};

const formatoFecha = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

interface TablaPlantillasNotificacionProps {
  plantillas: PlantillaNotificacionListado[];
  tiposEvento: readonly string[];
}

export function TablaPlantillasNotificacion({
  plantillas,
  tiposEvento,
}: TablaPlantillasNotificacionProps) {
  const [filtro, setFiltro] = useState<FiltroEstado>("ACTIVAS");
  // Tipo y plantilla se conservan al cerrar (`abierto = false`) para que el
  // contenido del modal no cambie durante la animación de salida.
  const [dialog, setDialog] = useState<TipoDialog>("crear");
  const [abierto, setAbierto] = useState(false);
  const [seleccionada, setSeleccionada] = useState<PlantillaNotificacionListado>();
  // Cada apertura remonta el Dialog (`key`) para que arranque con estado limpio.
  const [apertura, setApertura] = useState(0);

  const visibles = useMemo(
    () =>
      plantillas.filter((p) =>
        filtro === "TODAS" ? true : filtro === "ACTIVAS" ? p.is_active : !p.is_active,
      ),
    [plantillas, filtro],
  );

  // El alta solo ofrece eventos sin plantilla (activa o dada de baja): una
  // por evento en toda su historia (`tipo_evento @unique`).
  const tiposDisponibles = useMemo(() => {
    const conPlantilla = new Set(plantillas.map((p) => p.tipo_evento));
    return tiposEvento.filter((tipo) => !conPlantilla.has(tipo));
  }, [plantillas, tiposEvento]);

  const abrir = (tipo: TipoDialog, plantilla?: PlantillaNotificacionListado) => {
    setSeleccionada(plantilla);
    setDialog(tipo);
    setApertura((n) => n + 1);
    setAbierto(true);
  };
  const cerrar = () => setAbierto(false);

  const cantidadBaja = plantillas.filter((p) => !p.is_active).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filtrar por estado" className="inline-flex rounded-lg border bg-background p-0.5">
          {OPCIONES_FILTRO.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              aria-pressed={filtro === opcion.valor}
              onClick={() => setFiltro(opcion.valor)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filtro === opcion.valor
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opcion.etiqueta}
              {opcion.valor === "BAJA" && cantidadBaja > 0 && ` (${cantidadBaja})`}
            </button>
          ))}
        </div>

        <Button type="button" className="gap-2" onClick={() => abrir("crear")}>
          <Plus className="size-4" aria-hidden="true" />
          Nueva plantilla
        </Button>
      </div>

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-background px-6 py-12 text-center">
          <BellOff className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-900">
            {plantillas.length === 0 || filtro === "ACTIVAS"
              ? "No hay plantillas configuradas"
              : "No hay plantillas en este estado"}
          </p>
          {(plantillas.length === 0 || filtro === "ACTIVAS") && (
            <p className="text-sm text-muted-foreground">
              Los eventos usarán el texto por defecto.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Evento</TableHead>
                <TableHead>Asunto</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Actualizada</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((p) => (
                <TableRow key={p.id} className={p.is_active ? undefined : "bg-muted/30"}>
                  <TableCell className="font-mono text-xs">{p.tipo_evento}</TableCell>
                  <TableCell className="max-w-72">
                    <span className="block truncate" title={p.asunto}>
                      {p.asunto}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={CLASE_PRIORIDAD[p.prioridad_default]}>
                      {ETIQUETA_PRIORIDAD[p.prioridad_default]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {p.is_active ? (
                      <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                        Activa
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                        title={p.deletion_reason ?? undefined}
                      >
                        Baja
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatoFecha.format(new Date(p.updated_at))}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      {p.is_active ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => abrir("editar", p)}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                            Editar
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            onClick={() => abrir("baja", p)}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            Baja
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => abrir("reactivar", p)}
                        >
                          <RotateCcw className="size-3.5" aria-hidden="true" />
                          Reactivar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DialogPlantillaNotificacion
        key={`formulario-${apertura}`}
        open={abierto && (dialog === "crear" || dialog === "editar")}
        onClose={cerrar}
        plantilla={dialog === "editar" ? seleccionada : undefined}
        tiposEvento={tiposDisponibles}
      />
      <DialogBajaPlantillaNotificacion
        key={`baja-${apertura}`}
        open={abierto && dialog === "baja"}
        onClose={cerrar}
        plantilla={seleccionada}
      />
      <DialogReactivarPlantillaNotificacion
        key={`reactivar-${apertura}`}
        open={abierto && dialog === "reactivar"}
        onClose={cerrar}
        plantilla={seleccionada}
      />
    </div>
  );
}
