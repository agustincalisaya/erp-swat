"use client";

/**
 * @component TablaFiltroPaginada
 * @description HU-A5 ampliada (Sprint 2) — componente reutilizable de
 * tabla + buscador de texto libre + paginación server-side. Es el entregable
 * compartido de esta task: HU-A11 (historial de movimientos,
 * spec_modulo_A.md §2.10) lo consume con un `items` de otro shape y otro
 * `cargarPagina`, sin modificar este archivo.
 *
 * Diseño para reutilización (task_HU-A5-ampliacion.md §3.2):
 *  - **Columnas inyectadas por props** (`columnas`): el componente NO conoce
 *    los nombres de campo de `T` (`producto_nombre`, `cantidad`, …). Cada
 *    columna trae su propio `render`.
 *  - **Fuente de datos inyectada por props** (`cargarPagina`): el componente
 *    NO importa ninguna ruta de API. HU-A5 le pasa un fetch contra
 *    `GET /api/inventario/depositos/[id]/productos`; HU-A11 le pasará el suyo
 *    contra `GET /api/inventario/movimientos/historial`.
 *  - La paginación se dibuja SOLO con los metadatos que ya vienen en la
 *    respuesta (`paginacion`) — nunca dispara una segunda request de tipo
 *    COUNT por separado.
 *
 * Contrato de datos consumido: `{ items, paginacion }` (spec_modulo_A.md
 * §2.6), estable entre todas las vistas que reutilicen el componente.
 *
 * Buscador con debounce en cliente (default 350 ms, patrón de
 * `BuscadorFiltrosVariantes`) para no disparar una request por tecla; una
 * búsqueda nueva resetea a la página 1.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Metadatos de paginación del contrato `{ items, paginacion }` (spec §2.6). */
export interface PaginacionTabla {
  total: number;
  pagina_actual: number;
  total_paginas: number;
  por_pagina: number;
}

/** Forma que `cargarPagina` debe resolver. */
export interface ResultadoTabla<T> {
  items: T[];
  paginacion: PaginacionTabla;
}

/** Definición de una columna, inyectada por el consumidor. */
export interface ColumnaTabla<T> {
  /** Clave estable para el `key` de React del encabezado y las celdas. */
  clave: string;
  encabezado: string;
  /** Render de la celda para una fila. El componente no lee campos de `T`. */
  render: (fila: T) => ReactNode;
  /** Alineación horizontal de la columna (default: "izquierda"). */
  alinear?: "izquierda" | "derecha";
}

interface TablaFiltroPaginadaProps<T> {
  columnas: ColumnaTabla<T>[];
  /** Clave estable por fila para el `key` de React. */
  obtenerClaveFila: (fila: T) => string;
  /**
   * Fuente de datos. Recibe la búsqueda y la página actuales; devuelve el
   * contrato `{ items, paginacion }`. Inyectada por el consumidor: el
   * componente no conoce ningún endpoint. Puede ser una función inline sin
   * memoizar — se lee por ref, no está en las dependencias del efecto.
   */
  cargarPagina: (params: {
    busqueda: string;
    pagina: number;
    porPagina: number;
  }) => Promise<ResultadoTabla<T>>;
  /**
   * Valores externos que, al cambiar, fuerzan recarga desde la página 1
   * (ej. el `deposito_id` seleccionado por el consumidor). Se comparan
   * serializados, como el array de dependencias de un `useEffect`.
   */
  revalidarCuando?: readonly unknown[];
  /** Ítems por vista. Tope duro 20 (regla de negocio spec §2.6). Default 20. */
  porPagina?: number;
  /** Debounce del buscador en ms (default 350, patrón del repo). */
  debounceMs?: number;
  busquedaPlaceholder?: string;
  mensajeVacio?: string;
  /** Etiqueta singular/plural para el contador ("producto"/"productos"). */
  etiquetaRegistros?: { singular: string; plural: string };
}

/** Tope duro de ítems por vista — regla de negocio de spec §2.6. */
const TOPE_POR_PAGINA = 20;

export function TablaFiltroPaginada<T>({
  columnas,
  obtenerClaveFila,
  cargarPagina,
  revalidarCuando,
  porPagina = TOPE_POR_PAGINA,
  debounceMs = 350,
  busquedaPlaceholder = "Buscar…",
  mensajeVacio = "No hay resultados.",
  etiquetaRegistros = { singular: "registro", plural: "registros" },
}: TablaFiltroPaginadaProps<T>) {
  const porPaginaEfectivo = Math.min(porPagina, TOPE_POR_PAGINA);
  const claveRevalidacion = JSON.stringify(revalidarCuando ?? []);

  const [busquedaInput, setBusquedaInput] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [pagina, setPagina] = useState(1);

  const [filas, setFilas] = useState<T[]>([]);
  const [paginacion, setPaginacion] = useState<PaginacionTabla>({
    total: 0,
    pagina_actual: 1,
    total_paginas: 1,
    por_pagina: porPaginaEfectivo,
  });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `cargarPagina` se lee por ref para que el consumidor pueda pasarlo inline
  // (sin `useCallback`) sin provocar un loop de fetch por identidad cambiante.
  const cargarPaginaRef = useRef(cargarPagina);
  useEffect(() => {
    cargarPaginaRef.current = cargarPagina;
  }, [cargarPagina]);

  // Descarta respuestas de requests que quedaron obsoletas (la búsqueda, la
  // página o la fuente cambiaron antes de que la anterior resolviera).
  const requestIdRef = useRef(0);
  // Detecta el cambio de una dependencia externa (ej. otro `deposito_id`) para
  // recargar desde la página 1.
  const fuentePrevRef = useRef(claveRevalidacion);

  function handleBusqueda(valor: string) {
    setBusquedaInput(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPagina(1); // una búsqueda nueva resetea a la página 1
      setBusquedaAplicada(valor.trim());
    }, debounceMs);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    const idRequest = ++requestIdRef.current;
    const fuenteCambio = fuentePrevRef.current !== claveRevalidacion;
    fuentePrevRef.current = claveRevalidacion;
    const paginaConsulta = fuenteCambio ? 1 : pagina;

    // Toda mutación de estado ocurre dentro de esta función anidada (callbacks
    // async), nunca de forma síncrona en el cuerpo del efecto.
    async function ejecutar() {
      if (fuenteCambio && pagina !== 1) setPagina(1);
      setCargando(true);
      setError(null);
      try {
        const resultado = await cargarPaginaRef.current({
          busqueda: busquedaAplicada,
          pagina: paginaConsulta,
          porPagina: porPaginaEfectivo,
        });
        if (idRequest !== requestIdRef.current) return; // respuesta obsoleta
        setFilas(resultado.items);
        setPaginacion(resultado.paginacion);
      } catch {
        if (idRequest !== requestIdRef.current) return;
        setError("No se pudieron cargar los datos. Reintentá en unos segundos.");
        setFilas([]);
      } finally {
        if (idRequest === requestIdRef.current) setCargando(false);
      }
    }

    void ejecutar();
  }, [busquedaAplicada, pagina, porPaginaEfectivo, claveRevalidacion]);

  const totalPaginas = Math.max(1, paginacion.total_paginas);
  const puedeAnterior = pagina > 1 && !cargando;
  const puedeSiguiente = pagina < totalPaginas && !cargando;

  return (
    <div className="space-y-4">
      <div className="relative sm:max-w-sm">
        <Search
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={busquedaInput}
          onChange={(e) => handleBusqueda(e.target.value)}
          placeholder={busquedaPlaceholder}
          autoComplete="off"
          className="pl-9"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {columnas.map((columna) => (
                <TableHead
                  key={columna.clave}
                  className={cn(columna.alinear === "derecha" && "text-right")}
                >
                  {columna.encabezado}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell
                  colSpan={columnas.length}
                  className="py-10 text-center text-sm text-destructive"
                >
                  {error}
                </TableCell>
              </TableRow>
            ) : cargando && filas.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnas.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Cargando…
                </TableCell>
              </TableRow>
            ) : filas.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnas.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {mensajeVacio}
                </TableCell>
              </TableRow>
            ) : (
              filas.map((fila) => (
                <TableRow key={obtenerClaveFila(fila)}>
                  {columnas.map((columna) => (
                    <TableCell
                      key={columna.clave}
                      className={cn(columna.alinear === "derecha" && "text-right")}
                    >
                      {columna.render(fila)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Página {paginacion.pagina_actual} de {totalPaginas} — {paginacion.total}{" "}
          {paginacion.total === 1
            ? etiquetaRegistros.singular
            : etiquetaRegistros.plural}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!puedeAnterior}
            onClick={() => setPagina((actual) => Math.max(1, actual - 1))}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={!puedeSiguiente}
            onClick={() => setPagina((actual) => actual + 1)}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
