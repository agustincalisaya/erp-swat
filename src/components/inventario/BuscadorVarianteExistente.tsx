"use client";

/**
 * @component BuscadorVarianteExistente
 * @description HU-A8 — buscador liviano de `VarianteSKU` activas para el
 * flujo de edición de atributos operativos. Calcado 1:1 del patrón de
 * `BuscadorProductoExistente.tsx` (mismo debounce, mismo portal, mismo
 * manejo de click-afuera) — ver el docstring de ese componente para el
 * detalle de cada decisión (portal a `document.body`, cierre en
 * scroll/resize en vez de reposicionar en vivo, doble ref para click-afuera
 * porque el listbox no es descendiente en el DOM real).
 *
 * Única diferencia real de comportamiento: consume
 * `buscarVariantesActivasAction()` (`ActionResult<T>`, shape
 * `{ success, data?, error? }`), no `buscarProductosActivos()`
 * (`{ data, error }`) — el chequeo de resultado es `if (resultado.success)`,
 * no `if (!resultado.error)`.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Loader2 } from "lucide-react";

import {
  buscarVariantesActivasAction,
} from "@/app/(dashboard)/inventario/variantes/actions";
import type { VarianteActivaResumen } from "@/lib/services/inventario/variante.service";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEBOUNCE_MS = 300;

interface BuscadorVarianteExistenteProps {
  onSeleccionar: (variante: VarianteActivaResumen) => void;
}

interface PosicionListbox {
  top: number;
  left: number;
  width: number;
}

export function BuscadorVarianteExistente({ onSeleccionar }: BuscadorVarianteExistenteProps) {
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<VarianteActivaResumen[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<PosicionListbox | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Descarta respuestas obsoletas cuando dos búsquedas quedan en vuelo a la
  // vez (el usuario tipeó de nuevo antes de que la anterior resolviera).
  const ultimaConsultaRef = useRef("");

  function abrirListbox() {
    const rect = inputWrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setPosicion({ top: rect.bottom, left: rect.left, width: rect.width });
    }
    setAbierto(true);
  }

  function ejecutarBusqueda(texto: string) {
    const trimmed = texto.trim();
    ultimaConsultaRef.current = trimmed;

    if (trimmed.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }

    setBuscando(true);
    buscarVariantesActivasAction(trimmed).then((resultado) => {
      if (ultimaConsultaRef.current !== trimmed) return;
      setBuscando(false);
      setResultados(resultado.success ? (resultado.data ?? []) : []);
    });
  }

  function handleChange(valor: string) {
    setQuery(valor);
    abrirListbox();

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => ejecutarBusqueda(valor), DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Cierra la lista al hacer click afuera. `listaRef` es imprescindible acá:
  // el `<ul>` vive en `document.body` (portal), no dentro de `contenedorRef`
  // en el DOM real, aunque sí sea hijo de este componente en el árbol de React.
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

  // El portal usa `position: fixed` calculado una sola vez al abrir — no
  // sigue al input si la página scrollea o la ventana se redimensiona, así
  // que directamente se cierra en cualquiera de los dos casos.
  useEffect(() => {
    if (!abierto) return;

    function cerrar() {
      setAbierto(false);
    }
    // `capture: true`: los eventos de scroll no burbujean, así que hace
    // falta la fase de captura para detectar el scroll de cualquier
    // contenedor scrolleable ancestro (no solo `window`).
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  function handleSeleccionar(variante: VarianteActivaResumen) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAbierto(false);
    setQuery("");
    setResultados([]);
    onSeleccionar(variante);
  }

  const queryValida = query.trim().length >= 2;
  const mostrarLista = abierto && queryValida;

  return (
    <div ref={contenedorRef} className="relative space-y-2">
      <Label htmlFor="buscador-variante-existente">Buscar variante existente</Label>
      <div ref={inputWrapperRef} className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="buscador-variante-existente"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={abrirListbox}
          placeholder="Buscar por SKU, talle, color, género o modelo…"
          autoComplete="off"
          className="pl-9"
        />
        {buscando && queryValida && (
          <Loader2
            className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>

      {mostrarLista &&
        posicion &&
        createPortal(
          <ul
            ref={listaRef}
            role="listbox"
            style={{ top: posicion.top, left: posicion.left, width: posicion.width }}
            className="fixed z-50 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-md"
          >
            {resultados.length === 0 && !buscando && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                Sin variantes activas que coincidan con &quot;{query.trim()}&quot;.
              </li>
            )}
            {resultados.map((variante) => (
              <li key={variante.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => handleSeleccionar(variante)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="font-mono text-xs">{variante.sku}</span>
                    <span className="text-muted-foreground">{variante.producto_nombre}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Talle {variante.talle} · {variante.color} · {variante.genero} · {variante.modelo}
                  </span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
