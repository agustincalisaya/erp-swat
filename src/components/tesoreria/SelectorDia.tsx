"use client";

/**
 * @component SelectorDia
 * @description HU-G7 §9.8 (G7-2) — selector del día de negocio de la posición.
 * Mismo patrón que `FiltrosComprobantes`: el día vive en la URL (`?dia=`) y el
 * Server Component vuelve a consultar el servicio. El día elegido gobierna los
 * saldos LÍQUIDOS; las proyecciones reflejan el estado actual.
 */

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RUTA = "/tesoreria/posicion-diaria";

interface SelectorDiaProps {
  /** Día vigente (`AAAA-MM-DD`) que ya está resolviendo el servidor. */
  dia: string;
}

export function SelectorDia({ dia }: SelectorDiaProps) {
  const router = useRouter();

  const cambiarDia = (valor: string) => {
    // Un valor vacío vuelve al día de negocio por defecto (sin `?dia=`).
    router.push(valor ? `${RUTA}?dia=${encodeURIComponent(valor)}` : RUTA);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="selector-dia" className="flex items-center gap-1.5 text-xs">
        <CalendarDays className="size-3.5" aria-hidden="true" />
        Día de la posición
      </Label>
      <Input
        id="selector-dia"
        type="date"
        value={dia}
        onChange={(e) => cambiarDia(e.target.value)}
        className="w-44"
      />
    </div>
  );
}
