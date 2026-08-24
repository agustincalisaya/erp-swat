"use client";

/**
 * @component BuscadorProductoExistente
 * @description Mejora post-HU-A1 — camino alternativo al Paso 1 del wizard
 * de `app/(dashboard)/inventario/productos/`: buscador liviano que permite
 * saltar directo al Paso 2 (matriz de variantes) para un `ProductoMaestro`
 * activo ya existente, sin repetir su alta.
 *
 * No hay ningún componente de combobox/autocomplete reutilizable en
 * `components/ui` todavía — se implementa acá el mínimo necesario (Input +
 * lista de resultados) en vez de introducir una dependencia o un wrapper de
 * Popover nuevo para un único uso.
 *
 * El listbox se renderiza vía `createPortal` a `document.body`, posicionado
 * con `getBoundingClientRect()` del input (`position: fixed`). Se probó
 * dentro del flujo normal (`position: absolute` como hijo directo) y el
 * `Card` que envuelve el buscador tiene `overflow-hidden` (deliberado, para
 * los bordes redondeados — ver `components/ui/card.tsx`), así que cualquier
 * resultado que no entrara en el alto visible del Card quedaba recortado.
 * El portal evita ese clipping sin tocar el `overflow` del Card genérico.
 *
 * Dos cuidados específicos de este patrón (portal + combobox):
 *  1. Reposicionamiento: si la página hace scroll o se redimensiona la
 *     ventana con el listbox abierto, el input se mueve pero el portal
 *     (fixed, posición calculada una sola vez al abrir) no lo sigue —
 *     directamente se cierra en scroll/resize en vez de recalcular en vivo
 *     (opción explícitamente válida, evita la complejidad de un listener
 *     de scroll que reposicione en cada frame).
 *  2. Click afuera: el listbox portado ya NO es descendiente en el DOM del
 *     contenedor del buscador (aunque sí lo sea en el árbol de React), así
 *     que el chequeo de "click afuera" necesita además `listaRef` — sin
 *     esto, el `mousedown` sobre un resultado se interpreta como "afuera",
 *     el listbox se cierra, y el `click` posterior que dispara la selección
 *     nunca llega a ejecutarse.
 *
 * Debounce disparado desde el `onChange` (con `setTimeout` en un ref), no
 * desde un `useEffect` sobre `query` — mismo patrón que
 * `components/auditoria/BuscadorUsuarios.tsx`, evita el render en cascada de
 * `setState` síncrono dentro de un efecto.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Loader2, Camera, CircleAlert } from "lucide-react";

import {
  buscarProductosActivos,
  buscarProductosPorCodigo,
  type ProductoMaestroActivoResumen,
} from "@/app/(dashboard)/inventario/productos/actions";
import { extraerCodigoProducto } from "@/lib/utils/sku";
import { CameraBarcodeScanner } from "@/components/inventario/escaner/CameraBarcodeScanner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DEBOUNCE_MS = 300;

interface BuscadorProductoExistenteProps {
  onSeleccionar: (producto: ProductoMaestroActivoResumen) => void;
}

interface PosicionListbox {
  top: number;
  left: number;
  width: number;
}

export function BuscadorProductoExistente({ onSeleccionar }: BuscadorProductoExistenteProps) {
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<ProductoMaestroActivoResumen[]>([]);
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

  // ── Escáner de código de fábrica ────────────────────────────────────────
  const [scannerActivo, setScannerActivo] = useState(false);
  const [resolviendoEscaneo, setResolviendoEscaneo] = useState(false);
  const [errorEscaneo, setErrorEscaneo] = useState<string | null>(null);
  // Guarda contra detecciones reentrantes mientras una búsqueda por código
  // ya está en vuelo (la cámara se desactiva antes del await, pero un frame
  // ya en curso podría reportar una detección en el mismo tick).
  const resolviendoEscaneoRef = useRef(false);

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
    buscarProductosActivos(trimmed).then((respuesta) => {
      if (ultimaConsultaRef.current !== trimmed) return;
      setBuscando(false);
      setResultados(respuesta.data ?? []);
    });
  }

  function handleChange(valor: string) {
    setQuery(valor);
    setErrorEscaneo(null);
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

  function handleSeleccionar(producto: ProductoMaestroActivoResumen) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAbierto(false);
    setQuery("");
    setResultados([]);
    onSeleccionar(producto);
  }

  function toggleScanner() {
    setErrorEscaneo(null);
    setScannerActivo((prev) => !prev);
  }

  /**
   * Post-procesamiento del código escaneado (task_cali_scanner_variante.md
   * §1.2/1.3): extrae `[PRODUCTO]`, busca coincidencias EXACTAS y decide
   * según cardinalidad. Específico de este flujo — no reusa la resolución de
   * `IngresoEscaneoPanel.tsx`, que resuelve un SKU completo contra
   * `VarianteSKU`, no un `ProductoMaestro` por su código corto.
   */
  async function handleDetect(codigoEscaneado: string) {
    if (resolviendoEscaneoRef.current) return;

    const segmento = extraerCodigoProducto(codigoEscaneado);
    if (!segmento) {
      setErrorEscaneo("Código no reconocido. Verificá que sea un código de producto válido.");
      return;
    }

    resolviendoEscaneoRef.current = true;
    setScannerActivo(false);
    setErrorEscaneo(null);
    setResolviendoEscaneo(true);

    const respuesta = await buscarProductosPorCodigo(segmento);
    const productos = respuesta.data ?? [];

    resolviendoEscaneoRef.current = false;
    setResolviendoEscaneo(false);

    if (productos.length === 1) {
      handleSeleccionar(productos[0]);
      return;
    }

    if (productos.length === 0) {
      setErrorEscaneo(
        `No se encontró ningún producto con código "${segmento}". Verificá el código o cargalo manualmente.`,
      );
      return;
    }

    // Colisión (2+ coincidencias): recae en el buscador manual ya existente
    // — precarga el segmento y muestra la lista para elección explícita.
    setQuery(segmento);
    abrirListbox();
    ejecutarBusqueda(segmento);
  }

  const queryValida = query.trim().length >= 2;
  const mostrarLista = abierto && queryValida;

  return (
    <div ref={contenedorRef} className="relative space-y-2">
      <Label htmlFor="buscador-producto-existente">
        ¿El producto ya existe? Agregar variantes a uno existente
      </Label>
      <div className="flex items-center gap-2">
        <div ref={inputWrapperRef} className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="buscador-producto-existente"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={abrirListbox}
            placeholder="Buscar por nombre o código de producto…"
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

        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-2"
          onClick={toggleScanner}
          disabled={resolviendoEscaneo}
        >
          <Camera className="size-4" aria-hidden="true" />
          {scannerActivo ? "Cerrar cámara" : "Escanear código"}
        </Button>
      </div>

      {scannerActivo && (
        <CameraBarcodeScanner onDetect={handleDetect} activo={scannerActivo} />
      )}

      {resolviendoEscaneo && (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Resolviendo código escaneado…
        </div>
      )}

      {errorEscaneo && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" aria-hidden="true" />
          <AlertDescription>{errorEscaneo}</AlertDescription>
        </Alert>
      )}

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
                Sin productos activos que coincidan con &quot;{query.trim()}&quot;.
              </li>
            )}
            {resultados.map((producto) => (
              <li key={producto.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => handleSeleccionar(producto)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>{producto.nombre}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {producto.codigo_producto}
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
