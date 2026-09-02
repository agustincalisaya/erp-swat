"use client";

/**
 * @component RangoFechasCalendario
 * @description HU-A11 (spec_modulo_A.md §2.10) — selector de rango de fechas
 * tipo calendario para el historial de movimientos. Construido a mano sobre
 * `Popover` de `@base-ui/react` (ya dependencia del proyecto, mismo primitivo
 * que usa `dialog.tsx`) en vez de instalar una librería de date picker —
 * mismo criterio que `ComboboxFiltrable.tsx` ("no hay Combobox/Command de
 * librería instalado — confirmado antes de construir este componente").
 *
 * Controlado: recibe `desde`/`hasta` (formato AAAA-MM-DD o `undefined`) y
 * notifica el rango elegido vía `onChange`. No conoce Zod ni el schema del
 * llamador — solo produce el string de fecha calendario.
 */
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface RangoFechasCalendarioProps {
  desde?: string;
  hasta?: string;
  onChange: (rango: { desde?: string; hasta?: string }) => void;
}

const DIAS_SEMANA = ["L", "M", "M", "J", "V", "S", "D"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function aFechaCalendario(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function formatearParaMostrar(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio}`;
}

/** Días del mes visible, con relleno `null` para completar la primera/última semana (grilla lunes→domingo). */
function diasDelMes(anio: number, mes: number): (number | null)[] {
  const primerDia = new Date(anio, mes, 1).getDay(); // 0 = domingo
  const offsetLunes = (primerDia + 6) % 7; // 0 = lunes
  const totalDias = new Date(anio, mes + 1, 0).getDate();
  const celdas: (number | null)[] = Array(offsetLunes).fill(null);
  for (let dia = 1; dia <= totalDias; dia++) celdas.push(dia);
  while (celdas.length % 7 !== 0) celdas.push(null);
  return celdas;
}

export function RangoFechasCalendario({ desde, hasta, onChange }: RangoFechasCalendarioProps) {
  const hoy = new Date();
  const [abierto, setAbierto] = useState(false);
  const [vistaAnio, setVistaAnio] = useState(hoy.getFullYear());
  const [vistaMes, setVistaMes] = useState(hoy.getMonth());

  function irMesAnterior() {
    if (vistaMes === 0) { setVistaMes(11); setVistaAnio((a) => a - 1); } else setVistaMes((m) => m - 1);
  }
  function irMesSiguiente() {
    if (vistaMes === 11) { setVistaMes(0); setVistaAnio((a) => a + 1); } else setVistaMes((m) => m + 1);
  }

  function handleClickDia(dia: number) {
    const fecha = aFechaCalendario(vistaAnio, vistaMes, dia);
    // Sin selección previa, o rango ya completo: arranca un rango nuevo.
    if (!desde || (desde && hasta)) {
      onChange({ desde: fecha, hasta: undefined });
      return;
    }
    // Ya hay un `desde` pendiente de `hasta`.
    if (fecha < desde) {
      onChange({ desde: fecha, hasta: desde });
    } else {
      onChange({ desde, hasta: fecha });
    }
    setAbierto(false);
  }

  function limpiar() {
    onChange({ desde: undefined, hasta: undefined });
    setAbierto(false);
  }

  const celdas = diasDelMes(vistaAnio, vistaMes);
  const etiqueta = desde && hasta
    ? `${formatearParaMostrar(desde)} – ${formatearParaMostrar(hasta)}`
    : desde
      ? `Desde ${formatearParaMostrar(desde)}…`
      : "Rango de fechas";

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger render={<Button variant="outline" className="justify-start font-normal" />}>
        <CalendarDays className="size-4" aria-hidden="true" />
        {etiqueta}
        {(desde || hasta) && (
          <X
            className="ml-1 size-3.5 text-muted-foreground hover:text-foreground"
            aria-label="Limpiar rango de fechas"
            onClick={(e) => { e.stopPropagation(); limpiar(); }}
          />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="mb-2 flex items-center justify-between">
          <Button type="button" variant="ghost" size="icon-sm" onClick={irMesAnterior} aria-label="Mes anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-semibold">{MESES[vistaMes]} {vistaAnio}</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={irMesSiguiente} aria-label="Mes siguiente">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {DIAS_SEMANA.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {celdas.map((dia, i) => {
            if (dia === null) return <span key={i} />;
            const fecha = aFechaCalendario(vistaAnio, vistaMes, dia);
            const enRango = desde && hasta && fecha >= desde && fecha <= hasta;
            const esExtremo = fecha === desde || fecha === hasta;
            return (
              <button
                key={i}
                type="button"
                onClick={() => handleClickDia(dia)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-sm hover:bg-muted",
                  enRango && "bg-blue-50",
                  esExtremo && "bg-blue-600 text-white hover:bg-blue-700",
                )}
              >
                {dia}
              </button>
            );
          })}
        </div>
        {(desde || hasta) && (
          <div className="mt-2 flex justify-end border-t pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={limpiar}>Limpiar</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
