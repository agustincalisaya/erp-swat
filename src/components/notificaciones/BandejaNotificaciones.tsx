"use client";

/**
 * @component BandejaNotificaciones
 * @description Lista de la bandeja `/notificaciones` (HU-F3, task §6): CRITICA
 * destacada (color + icono) y primero (orden del servicio), acciones por fila
 * (marcar leída, archivar) y global (marcar todas leídas).
 *
 * Las Server Actions hacen `revalidatePath("/notificaciones")`, que refresca
 * la RSC — un único disparador de refetch (lección HU-G10). Además se avisa
 * a la campana del header para que actualice el contador al instante.
 */

import { useTransition, useState } from "react";
import { AlertOctagon, AlertTriangle, Archive, Check, CheckCheck, Info, Loader2 } from "lucide-react";

import {
  archivarNotificacionAction,
  marcarNotificacionLeidaAction,
  marcarTodasLeidasAction,
} from "@/app/(dashboard)/notificaciones/actions";
import { EVENTO_NOTIFICACIONES_CAMBIARON } from "@/components/notificaciones/CampanaNotificaciones";
import type { NotificacionBandejaItem } from "@/lib/services/notificaciones/notificacion.service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

const ESTILO_PRIORIDAD = {
  CRITICA: {
    etiqueta: "Crítica",
    Icono: AlertOctagon,
    tarjeta: "border-red-300 bg-red-50",
    icono: "text-red-600",
    chip: "bg-red-600 text-white",
  },
  ADVERTENCIA: {
    etiqueta: "Advertencia",
    Icono: AlertTriangle,
    tarjeta: "border-amber-200 bg-white",
    icono: "text-amber-600",
    chip: "bg-amber-100 text-amber-800",
  },
  INFORMATIVA: {
    etiqueta: "Informativa",
    Icono: Info,
    tarjeta: "border-border bg-white",
    icono: "text-blue-600",
    chip: "bg-blue-100 text-blue-700",
  },
} as const;

function formatearFecha(fecha: Date | string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(fecha),
  );
}

interface BandejaNotificacionesProps {
  items: NotificacionBandejaItem[];
  noLeidas: number;
}

export function BandejaNotificaciones({ items, noLeidas }: BandejaNotificacionesProps) {
  const [isPending, startTransition] = useTransition();
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  function ejecutar(clave: string, accion: () => Promise<{ error: { message: string } | null }>, exito?: string) {
    setServerError(null);
    setEnCurso(clave);
    startTransition(async () => {
      const resultado = await accion();
      setEnCurso(null);
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      window.dispatchEvent(new Event(EVENTO_NOTIFICACIONES_CAMBIARON));
      if (exito) toast.add({ title: exito, type: "success" });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {noLeidas === 0 ? "No tenés notificaciones sin leer." : `${noLeidas} sin leer.`}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending || noLeidas === 0}
          onClick={() => ejecutar("todas", marcarTodasLeidasAction, "Notificaciones marcadas como leídas")}
        >
          {enCurso === "todas" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck className="size-3.5" aria-hidden="true" />
          )}
          Marcar todas como leídas
        </Button>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted-foreground">
          No tenés notificaciones
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const estilo = ESTILO_PRIORIDAD[item.prioridad];
            const noLeida = item.leida_at === null;
            return (
              <li
                key={item.notificacion_id}
                className={`rounded-xl border p-4 flex gap-3 ${estilo.tarjeta} ${
                  item.prioridad === "CRITICA" ? "border-l-4 border-l-red-600" : ""
                }`}
              >
                <estilo.Icono className={`size-5 shrink-0 mt-0.5 ${estilo.icono}`} aria-hidden="true" />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${estilo.chip}`}>
                      {estilo.etiqueta}
                    </span>
                    <h2 className={`text-sm text-gray-900 ${noLeida ? "font-semibold" : "font-medium"}`}>
                      {item.asunto}
                    </h2>
                    {noLeida && (
                      <span className="size-2 rounded-full bg-blue-600" aria-label="Sin leer" />
                    )}
                  </div>
                  <p className="text-sm text-gray-700 break-words">{item.cuerpo}</p>
                  <p className="text-xs text-muted-foreground">{formatearFecha(item.created_at)}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                  {noLeida && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={isPending}
                      aria-label="Marcar como leída"
                      title="Marcar como leída"
                      onClick={() =>
                        ejecutar(`leer:${item.notificacion_id}`, () =>
                          marcarNotificacionLeidaAction(item.notificacion_id),
                        )
                      }
                    >
                      {enCurso === `leer:${item.notificacion_id}` ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={isPending}
                    aria-label="Archivar"
                    title="Archivar"
                    onClick={() =>
                      ejecutar(
                        `archivar:${item.notificacion_id}`,
                        () => archivarNotificacionAction(item.notificacion_id),
                        "Notificación archivada",
                      )
                    }
                  >
                    {enCurso === `archivar:${item.notificacion_id}` ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Archive className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
