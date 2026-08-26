"use client";

/**
 * @component AutocompleteInput
 * @description Input de texto libre con sugerencias desplegables sobre
 * valores ya existentes — a diferencia de un `<select>`, nada impide
 * escribir un valor nuevo que todavía no existe (las sugerencias ayudan, no
 * restringen). Filtro "contains", case-insensitive, sobre una lista ya
 * cargada por el padre (sin roundtrip por tecla).
 *
 * Mismo patrón de portal que `BuscadorProductoExistente.tsx`: el `Card` que
 * envuelve el formulario tiene `overflow-hidden` (bordes redondeados), así
 * que el listbox se porta a `document.body` con `position: fixed`
 * (recalculada al abrir) para no quedar recortado — se cierra en
 * scroll/resize en vez de reposicionarse en vivo, mismo trade-off que ese
 * componente.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Input } from "@/components/ui/input";

interface AutocompleteInputProps extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  sugerencias: string[];
}

interface PosicionListbox {
  top: number;
  left: number;
  width: number;
}

export const AutocompleteInput = forwardRef<HTMLInputElement, AutocompleteInputProps>(
  function AutocompleteInput({ value, onChange, sugerencias, ...inputProps }, ref) {
    const [abierto, setAbierto] = useState(false);
    const [posicion, setPosicion] = useState<PosicionListbox | null>(null);
    const contenedorRef = useRef<HTMLDivElement>(null);
    const listaRef = useRef<HTMLUListElement>(null);

    const coincidencias = useMemo(() => {
      const texto = value.trim().toLowerCase();
      if (!texto) return [];
      return sugerencias.filter((s) => s.toLowerCase().includes(texto));
    }, [value, sugerencias]);

    function abrirListbox() {
      const rect = contenedorRef.current?.getBoundingClientRect();
      if (rect) setPosicion({ top: rect.bottom, left: rect.left, width: rect.width });
      setAbierto(true);
    }

    // Cierra la lista al hacer click afuera. `listaRef` es imprescindible:
    // el `<ul>` vive en `document.body` (portal), no dentro de
    // `contenedorRef` en el DOM real.
    useEffect(() => {
      function handleClickAfuera(e: MouseEvent) {
        const target = e.target as Node;
        if (contenedorRef.current?.contains(target)) return;
        if (listaRef.current?.contains(target)) return;
        setAbierto(false);
      }
      document.addEventListener("mousedown", handleClickAfuera);
      return () => document.removeEventListener("mousedown", handleClickAfuera);
    }, []);

    // Posición `fixed` calculada una sola vez al abrir — no sigue al input
    // si la página scrollea o la ventana se redimensiona, así que se cierra.
    useEffect(() => {
      if (!abierto) return;
      function cerrar() {
        setAbierto(false);
      }
      window.addEventListener("scroll", cerrar, true);
      window.addEventListener("resize", cerrar);
      return () => {
        window.removeEventListener("scroll", cerrar, true);
        window.removeEventListener("resize", cerrar);
      };
    }, [abierto]);

    function handleSeleccionar(sugerencia: string) {
      onChange(sugerencia);
      setAbierto(false);
    }

    const mostrarLista = abierto && coincidencias.length > 0;

    return (
      <div ref={contenedorRef} className="relative">
        <Input
          {...inputProps}
          ref={ref}
          value={value}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            abrirListbox();
          }}
          onFocus={abrirListbox}
        />

        {mostrarLista &&
          posicion &&
          createPortal(
            <ul
              ref={listaRef}
              role="listbox"
              style={{ top: posicion.top, left: posicion.left, width: posicion.width }}
              className="fixed z-50 max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-md"
            >
              {coincidencias.map((sugerencia) => (
                <li key={sugerencia} role="option" aria-selected="false">
                  <button
                    type="button"
                    onClick={() => handleSeleccionar(sugerencia)}
                    className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    {sugerencia}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )}
      </div>
    );
  },
);
