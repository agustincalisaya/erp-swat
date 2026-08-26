"use client";

/**
 * @component SelectorTalles
 * @description Reemplaza el input de texto libre de "Talles" dentro de
 * `MatrizVariantes.tsx` (compartido por el wizard de alta y la pantalla de
 * "Agregar variante" — un solo componente, un solo lugar para el cambio).
 *
 * Calzado e Indumentaria son mutuamente excluyentes UNA VEZ que hay algún
 * talle cargado: el primer talle agregado en un modo bloquea el botón del
 * otro modo (deshabilitado) hasta que la lista de talles queda vacía de
 * nuevo — recién ahí ambos vuelven a estar disponibles. No hace falta
 * trackear qué modo agregó cada talle: mientras `values` no esté vacío, el
 * único botón habilitado (aparte del ya activo) es el que coincide con
 * `modo`, así que `modo` no puede cambiar sin pasar primero por la lista
 * vacía.
 *  - Calzado: input numérico, rango 30-50 validado antes de agregar.
 *  - Indumentaria: dropdown con talles estándar (alta directa a la lista
 *    con un click) + "Talle especial" (habilita texto libre).
 *
 * La lista final de chips es la misma pieza visual que ya usaba el input
 * libre anterior (mismo contrato `values`/`onAdd`/`onRemove`) — el origen
 * del talle (calzado/estándar/especial) no se distingue en la lista.
 */
import { useState } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

const TALLES_INDUMENTARIA_ESTANDAR = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"] as const;
const OPCION_TALLE_ESPECIAL = "__TALLE_ESPECIAL__";

const CALZADO_MIN = 30;
const CALZADO_MAX = 50;

type Modo = "CALZADO" | "INDUMENTARIA" | null;

interface SelectorTallesProps {
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}

export function SelectorTalles({ values, onAdd, onRemove }: SelectorTallesProps) {
  const [modo, setModo] = useState<Modo>(null);

  const [inputCalzado, setInputCalzado] = useState("");
  const [errorCalzado, setErrorCalzado] = useState<string | null>(null);

  const [mostrarInputEspecial, setMostrarInputEspecial] = useState(false);
  const [inputEspecial, setInputEspecial] = useState("");

  function agregarSiNoExiste(valor: string) {
    const trimmed = valor.trim();
    if (!trimmed) return;
    const yaExiste = values.some((v) => v.toLowerCase() === trimmed.toLowerCase());
    if (!yaExiste) onAdd(trimmed);
  }

  function commitCalzado() {
    const trimmed = inputCalzado.trim();
    if (!trimmed) return;

    const numero = Number(trimmed);
    if (!Number.isInteger(numero) || numero < CALZADO_MIN || numero > CALZADO_MAX) {
      setErrorCalzado(`El talle de calzado debe ser un número entero entre ${CALZADO_MIN} y ${CALZADO_MAX}.`);
      return;
    }

    setErrorCalzado(null);
    agregarSiNoExiste(trimmed);
    setInputCalzado("");
  }

  function commitEspecial() {
    const trimmed = inputEspecial.trim();
    if (!trimmed) return;
    agregarSiNoExiste(trimmed);
    setInputEspecial("");
  }

  function handleSeleccionDropdown(valor: string) {
    if (!valor) return;

    if (valor === OPCION_TALLE_ESPECIAL) {
      setMostrarInputEspecial(true);
      return;
    }

    agregarSiNoExiste(valor);
  }

  function seleccionarModo(nuevoModo: Modo) {
    setModo(nuevoModo);
    // Cambiar de modo no debe arrastrar estado a medio completar del otro.
    setErrorCalzado(null);
    setInputCalzado("");
    setMostrarInputEspecial(false);
    setInputEspecial("");
  }

  const hayTalles = values.length > 0;
  const calzadoBloqueado = hayTalles && modo !== "CALZADO";
  const indumentariaBloqueada = hayTalles && modo !== "INDUMENTARIA";

  return (
    <div className="space-y-2">
      <Label>Talles</Label>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={modo === "CALZADO" ? "default" : "outline"}
          disabled={calzadoBloqueado}
          title={calzadoBloqueado ? "Sacá todos los talles de Indumentaria para poder elegir Calzado" : undefined}
          onClick={() => seleccionarModo("CALZADO")}
        >
          Calzado
        </Button>
        <Button
          type="button"
          variant={modo === "INDUMENTARIA" ? "default" : "outline"}
          disabled={indumentariaBloqueada}
          title={
            indumentariaBloqueada ? "Sacá todos los talles de Calzado para poder elegir Indumentaria" : undefined
          }
          onClick={() => seleccionarModo("INDUMENTARIA")}
        >
          Indumentaria
        </Button>
      </div>
      {hayTalles && (
        <p className="text-xs text-muted-foreground">
          Sacá todos los talles para poder cambiar entre Calzado e Indumentaria.
        </p>
      )}

      {modo === "CALZADO" && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={CALZADO_MIN}
              max={CALZADO_MAX}
              value={inputCalzado}
              placeholder={`Ej: ${CALZADO_MIN + 8}`}
              onChange={(e) => {
                setInputCalzado(e.target.value);
                if (errorCalzado) setErrorCalzado(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCalzado();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={commitCalzado}>
              Agregar
            </Button>
          </div>
          {errorCalzado && <p className="text-xs text-destructive">{errorCalzado}</p>}
        </div>
      )}

      {modo === "INDUMENTARIA" && (
        <div className="space-y-1.5">
          <select
            value=""
            onChange={(e) => handleSeleccionDropdown(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Elegir talle de indumentaria"
          >
            <option value="" disabled>
              Elegir talle…
            </option>
            {TALLES_INDUMENTARIA_ESTANDAR.map((talle) => (
              <option key={talle} value={talle}>
                {talle}
              </option>
            ))}
            <option value={OPCION_TALLE_ESPECIAL}>Talle especial</option>
          </select>

          {mostrarInputEspecial && (
            <div className="flex gap-2">
              <Input
                value={inputEspecial}
                placeholder="Ej: Talle único"
                autoComplete="off"
                onChange={(e) => setInputEspecial(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEspecial();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={commitEspecial}>
                Agregar
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 min-h-6">
        {values.length === 0 && (
          <span className="text-xs text-muted-foreground">Sin valores agregados todavía.</span>
        )}
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1">
            {v}
            <button
              type="button"
              onClick={() => onRemove(v)}
              aria-label={`Quitar ${v}`}
              className="rounded-full hover:bg-black/10"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
