"use client";

/**
 * @component SolicitudesPendientesPanel
 * @description HU-A9 — Panel de aprobación/rechazo de `ReclasificacionSolicitud`
 * en `PENDIENTE_APROBACION` (spec_modulo_A.md §3.8). Solo visible para
 * ADMINISTRADOR (`inventario:reclasificar_aprobar`, decidido en la página).
 *
 * Aprobar aplica la baja/merma (BAJA_MERMA) de inmediato; rechazar exige un
 * motivo obligatorio. `useState` + Server Actions, sin react-hook-form.
 * Paleta azul Tailwind (`blue-*`).
 */
import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, Loader2, ClipboardList } from "lucide-react";

import {
  aprobarSolicitudAction,
  rechazarSolicitudAction,
} from "@/app/(dashboard)/inventario/devoluciones/actions";
import type { SolicitudReclasificacionListado } from "@/lib/services/inventario/reclasificacion.service";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface SolicitudesPendientesPanelProps {
  solicitudes: SolicitudReclasificacionListado[];
}

type EstadoAccion =
  | { tipo: "aprobando"; solicitudId: string }
  | { tipo: "rechazando"; solicitudId: string };

function formatearFecha(iso: Date): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function SolicitudesPendientesPanel({ solicitudes }: SolicitudesPendientesPanelProps) {
  const [motivoRechazoPorSolicitud, setMotivoRechazoPorSolicitud] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState<EstadoAccion | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAprobar = (solicitudId: string) => {
    setServerError(null);
    setAccionEnCurso({ tipo: "aprobando", solicitudId });
    startTransition(async () => {
      const result = await aprobarSolicitudAction(solicitudId);
      setAccionEnCurso(null);
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
      }
    });
  };

  const handleRechazar = (solicitudId: string) => {
    const motivo = motivoRechazoPorSolicitud[solicitudId] ?? "";
    if (motivo.trim() === "") {
      setServerError("El motivo de rechazo es obligatorio.");
      return;
    }
    setServerError(null);
    setAccionEnCurso({ tipo: "rechazando", solicitudId });
    startTransition(async () => {
      const result = await rechazarSolicitudAction(solicitudId, motivo.trim());
      setAccionEnCurso(null);
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
      }
    });
  };

  if (solicitudes.length === 0) {
    return (
      <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-blue-800">
          <ClipboardList className="size-4" aria-hidden="true" />
          Solicitudes pendientes de aprobación
        </h2>
        <p className="mt-2 text-sm text-blue-700/80">
          No hay solicitudes sobre el umbral esperando aprobación.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-blue-800">
        <ClipboardList className="size-4" aria-hidden="true" />
        Solicitudes pendientes de aprobación
        <Badge variant="outline" className="ml-1 border-blue-200 bg-blue-50 text-blue-700">
          {solicitudes.length}
        </Badge>
      </h2>

      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {solicitudes.map((solicitud) => {
          const motivoRechazo = motivoRechazoPorSolicitud[solicitud.id] ?? "";
          const enCurso = accionEnCurso?.solicitudId === solicitud.id;
          const deshabilitado = isPending;
          return (
            <div
              key={solicitud.id}
              className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {solicitud.sku} — {solicitud.producto_nombre}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {solicitud.cantidad} unidad(es) · {solicitud.deposito_nombre} · solicitada el{" "}
                    {formatearFecha(solicitud.created_at)}
                  </p>
                  {solicitud.motivo && (
                    <p className="mt-1 text-xs text-gray-500">Motivo: {solicitud.motivo}</p>
                  )}
                  {solicitud.rma_id && (
                    <p className="mt-0.5 text-xs text-gray-500">RMA: {solicitud.rma_id}</p>
                  )}
                </div>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  PENDIENTE_APROBACION
                </Badge>
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={deshabilitado}
                    onClick={() => handleAprobar(solicitud.id)}
                    className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {enCurso && accionEnCurso.tipo === "aprobando" ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    )}
                    Aprobar (baja/merma)
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={motivoRechazo}
                    onChange={(e) =>
                      setMotivoRechazoPorSolicitud((prev) => ({
                        ...prev,
                        [solicitud.id]: e.target.value,
                      }))
                    }
                    placeholder="Motivo del rechazo (obligatorio)"
                    className="h-8 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-red-400 focus-visible:ring-3 focus-visible:ring-red-400/30"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={deshabilitado || motivoRechazo.trim() === ""}
                    onClick={() => handleRechazar(solicitud.id)}
                    className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    {enCurso && accionEnCurso.tipo === "rechazando" ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <XCircle className="size-3.5" aria-hidden="true" />
                    )}
                    Rechazar
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}