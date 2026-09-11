"use client";

/**
 * @component ComboboxFiltrable
 * @description task_cali_buscador_selector_umbrales.md — combobox genérico
 * con filtrado por texto, reusado por `SelectorJerarquicoStock.tsx` para los
 * niveles de Producto Maestro y Variante (Depósito no lo usa, sigue con
 * `<select>` nativo por tener pocas opciones).
 *
 * Filtrado 100% client-side sobre `items` (ya cargados por el llamador vía
 * `listarProductosConVariantes()`/`listarVariantesPorProducto()`, sin
 * `take`/paginación) — no hay debounce ni fetch acá, a diferencia de
 * `BuscadorProductoExistente.tsx` (que sí pega contra una Server Action por
 * cada búsqueda). Mismo motivo por el que no se reusa ese componente tal
 * cual: contrato de datos distinto (lista ya en memoria vs. búsqueda remota).
 *
 * Reusa el patrón de portal + listbox + click-outside ya establecido en
 * `BuscadorProductoExistente.tsx` (mismo proyecto, no hay Combobox/Command
 * de librería instalado — confirmado antes de construir este componente).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

interface ComboboxFiltrableProps<T> {
  id?: string;
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  value: string;
  onChange: (item: T) => void;
  placeholder: string;
  disabled?: boolean;
  cargando?: boolean;
  cargandoLabel?: string;
  emptyMessage?: string;
  pageSize?: number;
}

interface PosicionListbox {
  top: number;
  left: number;
  width: number;
}

export function ComboboxFiltrable<T>({
  id,
  items,
  getId,
  getLabel,
  value,
  onChange,
  placeholder,
  disabled = false,
  cargando = false,
  cargandoLabel = "Cargando…",
  emptyMessage = "Sin coincidencias.",
  pageSize,
}: ComboboxFiltrableProps<T>) {
  const [query, setQuery] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<PosicionListbox | null>(null);
  const [pagina, setPagina] = useState(1);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  const deshabilitado = disabled || cargando;
  const seleccionado = items.find((item) => getId(item) === value) ?? null;

  function abrirListbox() {
    if (deshabilitado) return;
    const rect = inputWrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setPosicion({ top: rect.bottom, left: rect.left, width: rect.width });
    }
    setQuery("");
    setAbierto(true);
  }

  function cerrarListbox() {
    setAbierto(false);
  }

  // Cierra la lista al hacer click afuera. `listaRef` es imprescindible acá:
  // el `<ul>` vive en `document.body` (portal), no dentro de `inputWrapperRef`
  // en el DOM real, aunque sí sea hijo de este componente en el árbol de React.
  useEffect(() => {
    function handleClickAfuera(e: MouseEvent) {
      const target = e.target as Node;
      if (inputWrapperRef.current?.contains(target)) return;
      if (listaRef.current?.contains(target)) return;
      cerrarListbox();
    }
    document.addEventListener("mousedown", handleClickAfuera);
    return () => document.removeEventListener("mousedown", handleClickAfuera);
  }, []);

  // El portal usa `position: fixed` calculado una sola vez al abrir — no
  // sigue al input si la página scrollea o la ventana se redimensiona, así
  // que directamente se cierra en cualquiera de los dos casos (mismo
  // criterio que `BuscadorProductoExistente.tsx`).
  //
  // El listener de scroll va en captura sobre `window` porque "scroll" no
  // burbujea — pero por eso mismo también se dispara cuando lo que scrollea
  // es el propio `<ul>` del listbox (la fase de captura recorre el árbol
  // completo hasta el target, sin importar si el evento burbujea después).
  // Sin el chequeo de `listaRef`, hacer scroll DENTRO de la lista cerraba
  // el combobox solo — invisible con pocas opciones (nunca aparece
  // scrollbar interno), pero reproducible en cuanto la lista excede
  // `max-h-64` (ej. el filtro de Usuario de Auditoría Forense).
  useEffect(() => {
    if (!abierto) return;
    function handleScroll(e: Event) {
      if (listaRef.current?.contains(e.target as Node)) return;
      cerrarListbox();
    }
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", cerrarListbox);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", cerrarListbox);
    };
  }, [abierto]);

  function handleSeleccionar(item: T) {
    setAbierto(false);
    setQuery("");
    onChange(item);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") cerrarListbox();
  }

  const textoFiltro = query.trim().toLowerCase();
  const itemsFiltrados = textoFiltro
    ? items.filter((item) => getLabel(item).toLowerCase().includes(textoFiltro))
    : items;
  const totalPaginas = pageSize ? Math.max(1, Math.ceil(itemsFiltrados.length / pageSize)) : 1;
  const itemsVisibles = pageSize
    ? itemsFiltrados.slice((pagina - 1) * pageSize, pagina * pageSize)
    : itemsFiltrados;

  const valorMostrado = abierto ? query : seleccionado ? getLabel(seleccionado) : "";

  return (
    <div ref={inputWrapperRef} className="relative">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        value={valorMostrado}
        onChange={(e) => {
          if (!abierto) abrirListbox();
          setPagina(1);
          setQuery(e.target.value);
        }}
        onFocus={abrirListbox}
        onKeyDown={handleKeyDown}
        placeholder={cargando ? cargandoLabel : placeholder}
        disabled={deshabilitado}
        autoComplete="off"
        role="combobox"
        aria-expanded={abierto}
        className="pl-9"
      />

      {abierto &&
        posicion &&
        createPortal(
          <ul
            ref={listaRef}
            role="listbox"
            style={{ top: posicion.top, left: posicion.left, width: posicion.width }}
            className="fixed z-50 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-md"
          >
            {itemsFiltrados.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
            )}
            {itemsVisibles.map((item) => {
              const itemId = getId(item);
              return (
                <li key={itemId} role="option" aria-selected={itemId === value}>
                  <button
                    type="button"
                    onClick={() => handleSeleccionar(item)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    {getLabel(item)}
                  </button>
                </li>
              );
            })}
            {pageSize && itemsFiltrados.length > 0 && (
              <li className="flex items-center justify-between gap-2 border-t px-3 py-2" role="presentation">
                <span className="text-xs text-muted-foreground">Página {pagina} de {totalPaginas}</span>
                <div className="flex gap-2">
                  <button type="button" className="rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50" disabled={pagina <= 1} onClick={() => setPagina((actual) => Math.max(1, actual - 1))}>Anterior</button>
                  <button type="button" className="rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50" disabled={pagina >= totalPaginas} onClick={() => setPagina((actual) => Math.min(totalPaginas, actual + 1))}>Siguiente</button>
                </div>
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
