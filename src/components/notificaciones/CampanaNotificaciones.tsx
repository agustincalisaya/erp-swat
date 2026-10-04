"use client";

/**
 * @component CampanaNotificaciones
 * @description Campana con contador de no leídas en el header del dashboard
 * (HU-F3, task §6). Polling cada 30 s a
 * `GET /api/notificaciones?solo_no_leidas=true&page_size=1`, pausado con la
 * pestaña oculta (sin WebSocket/SSE, spec F §2.3). Nunca envía
 * `solo_no_leidas=false` (task §8, Punto abierto 6).
 *
 * Como la bandeja ordena CRITICA primero, el único ítem devuelto es CRITICA
 * si y solo si hay alguna crítica sin leer → la campana se resalta.
 *
 * La página `/notificaciones` dispara `EVENTO_NOTIFICACIONES_CAMBIARON` tras
 * cada acción para refrescar el contador sin esperar al próximo ciclo.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

export const EVENTO_NOTIFICACIONES_CAMBIARON = "notificaciones:cambiaron";

const INTERVALO_MS = 30_000;
const URL_CONTADOR = "/api/notificaciones?solo_no_leidas=true&page_size=1";

interface EstadoCampana {
  noLeidas: number;
  hayCritica: boolean;
}

export function CampanaNotificaciones() {
  const [estado, setEstado] = useState<EstadoCampana | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function consultar() {
      if (document.hidden) return;
      try {
        const res = await fetch(URL_CONTADOR, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelado || !body?.data) return;
        setEstado({
          noLeidas: body.data.no_leidas,
          hayCritica: body.data.items[0]?.prioridad === "CRITICA",
        });
      } catch {
        // Falla de red: se conserva el último valor y se reintenta en el próximo ciclo.
      }
    }

    const alCambiarVisibilidad = () => {
      if (!document.hidden) void consultar();
    };
    const alCambiarNotificaciones = () => void consultar();

    void consultar();
    const intervalo = window.setInterval(() => void consultar(), INTERVALO_MS);
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    window.addEventListener(EVENTO_NOTIFICACIONES_CAMBIARON, alCambiarNotificaciones);
    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener(EVENTO_NOTIFICACIONES_CAMBIARON, alCambiarNotificaciones);
    };
  }, []);

  const noLeidas = estado?.noLeidas ?? 0;
  const etiqueta =
    noLeidas === 0
      ? "Notificaciones (sin novedades)"
      : `Notificaciones (${noLeidas} sin leer${estado?.hayCritica ? ", hay críticas" : ""})`;

  return (
    <Link
      href="/notificaciones"
      aria-label={etiqueta}
      title={etiqueta}
      className={`relative p-2 rounded-lg transition-colors hover:bg-gray-100 ${
        estado?.hayCritica ? "text-red-600" : "text-gray-500 hover:text-gray-900"
      }`}
    >
      <Bell className="size-4.5" aria-hidden="true" />
      {noLeidas > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 min-w-4.5 h-4.5 px-1 rounded-full text-[10px] font-semibold leading-4.5 text-center text-white ${
            estado?.hayCritica ? "bg-red-600 animate-pulse" : "bg-blue-600"
          }`}
        >
          {noLeidas > 99 ? "99+" : noLeidas}
        </span>
      )}
    </Link>
  );
}
