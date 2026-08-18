"use client";

/**
 * @component BuscadorUsuarios
 * @description Buscador server-side por `nombre_completo`/`email`/`nombre_usuario`
 * para el listado de Usuarios (task_cali_buscador_usuarios.md §4). Búsqueda
 * server-side por decisión ya tomada — un filtro solo sobre lo ya renderizado
 * en pantalla no podría combinarse con `?estado=...` (no encontraría un
 * INACTIVO mientras el filtro está en "Activos") ni sería compartible por URL.
 *
 * Mismo mecanismo que `FiltroEstadoUsuarios.tsx`: el término vive en la URL
 * (`?q=...`), clonando siempre el `searchParams` actual completo antes de
 * tocar la clave `q` — así `?estado=...` (o cualquier otro param futuro)
 * sobrevive intacto. Usa `router.replace()` en vez de `router.push()`
 * (a diferencia del filtro de estado, que sí usa `push`): tipear dispara una
 * navegación por cada debounce (~350ms), y con `push` cada tramo de tipeo
 * ensuciaría el historial del navegador con una entrada por letra-pausa.
 */

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";

const DEBOUNCE_MS = 350;

export function BuscadorUsuarios() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const qActual = searchParams.get("q") ?? "";
  const [valor, setValor] = useState(qActual);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Si `q` cambia por una navegación externa (ej. el usuario edita la URL a
  // mano, o vuelve con el botón atrás del navegador), sincroniza el input.
  // Patrón "ajustar estado durante el render" (no useEffect) — evita el
  // render en cascada que dispara `setState` síncrono dentro de un efecto.
  const [qSincronizado, setQSincronizado] = useState(qActual);
  if (qActual !== qSincronizado) {
    setQSincronizado(qActual);
    setValor(qActual);
  }

  const navegarConQ = (nuevoValor: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = nuevoValor.trim();
    if (trimmed) {
      params.set("q", trimmed);
    } else {
      params.delete("q");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const handleChange = (nuevoValor: string) => {
    setValor(nuevoValor);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navegarConQ(nuevoValor), DEBOUNCE_MS);
  };

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setValor("");
    navegarConQ("");
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="text"
        value={valor}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Buscar por nombre, email o usuario…"
        className="pl-8 pr-8 h-9 text-xs"
        aria-label="Buscar usuarios"
      />
      {valor && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Limpiar búsqueda"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
