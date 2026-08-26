"use client";

/**
 * @component MatrizVariantes
 * @description HU-A1 — Sección 8: generación en lote de `VarianteSKU` (Paso
 * 2 del flujo, después de `FormularioProductoMaestro`). El producto
 * cartesiano talle × color × género se calcula EN EL CLIENTE con la misma
 * `generarSku()` que usa el servicio (`@/lib/utils/sku`, función pura) para
 * mostrar el preview de SKUs antes de confirmar — nunca se reimplementa esa
 * lógica acá, solo se reutiliza.
 *
 * Talles/colores son texto libre (tipo "tags"): el catálogo institucional
 * de colores todavía no está definido (ver nota en `sku.ts`), así que no
 * hay un <select> cerrado posible todavía. Géneros sí son fijos porque
 * coinciden con el enum de `GenerarVariantesMatrizSchema`.
 *
 * Rediseño del escaneo (task_cali_scanner_ean_matriz.md): cada fila del
 * preview tiene un campo de EAN-13 opcional, con un botón que abre la cámara
 * para esa fila puntual. El escaneo del código de fábrica del producto
 * (SKU `[PRODUCTO]`) se sacó del Paso 1 (`BuscadorProductoExistente.tsx`) —
 * el EAN-13 de acá es un dato completamente distinto (`VarianteSKU.ean_qr`,
 * de la unidad física), desacoplado del `sku` determinístico.
 *
 * Cámara compartida entre filas: se reutiliza `CameraBarcodeScanner.tsx` sin
 * modificarlo (es código de HU-2, de otro integrante) montando una única
 * instancia dentro de un `Dialog` — se abre como overlay al tocar el botón
 * de escanear de cualquier fila y vuelca el resultado en `eanPorFila[key]`
 * de la fila que lo invocó. Se descartó una instancia de cámara por fila:
 * con hasta 45 filas, montar `useBarcodeScanner` por cada una arriesga
 * múltiples `getUserMedia` concurrentes sobre el mismo dispositivo (la
 * mayoría de navegadores no lo soportan bien), y el flujo real es siempre
 * escanear una unidad física a la vez — nunca en simultáneo.
 *
 * El EAN-13 por fila vive en un estado propio (`eanPorFila`, keyeado por
 * `claveCombinacionVariante()`), separado del `useMemo` del preview: así
 * sobrevive si se agrega/saca un talle/color y las filas que ya existían se
 * recalculan (mismo `sku`, misma key).
 */

import { useMemo, useState, useTransition } from "react";
import { X, Loader2, LayoutGrid, CheckCircle2, ScanLine } from "lucide-react";

import { generarSku, claveCombinacionVariante, type Genero } from "@/lib/utils/sku";
import { generarVariantesMatriz } from "@/app/(dashboard)/inventario/productos/actions";
import type { ResultadoGenerarVariantesMatriz } from "@/lib/services/inventario/producto.service";
import { CameraBarcodeScanner } from "@/components/inventario/escaner/CameraBarcodeScanner";
import { SelectorTalles } from "@/components/inventario/SelectorTalles";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const GENEROS: Genero[] = ["HOMBRE", "MUJER", "UNISEX"];

interface MatrizVariantesProps {
  productoMaestroId: string;
  codigoProducto: string;
  nombreProducto: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// TagList — input tipo "tags" reutilizado para talles y colores (texto libre)
// ──────────────────────────────────────────────────────────────────────────────
interface TagListProps {
  label: string;
  placeholder: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}

function TagList({ label, placeholder, values, onAdd, onRemove }: TagListProps) {
  const [input, setInput] = useState("");

  function commit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const yaExiste = values.some((v) => v.toLowerCase() === trimmed.toLowerCase());
    if (!yaExiste) onAdd(trimmed);
    setInput("");
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={input}
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={commit}>
          Agregar
        </Button>
      </div>
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

// ──────────────────────────────────────────────────────────────────────────────
// MatrizVariantes
// ──────────────────────────────────────────────────────────────────────────────
export function MatrizVariantes({
  productoMaestroId,
  codigoProducto,
  nombreProducto,
}: MatrizVariantesProps) {
  const [modelo, setModelo] = useState("");
  const [talles, setTalles] = useState<string[]>([]);
  const [colores, setColores] = useState<string[]>([]);
  const [generos, setGeneros] = useState<Genero[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoGenerarVariantesMatriz | null>(null);
  const [isPending, startTransition] = useTransition();

  // EAN-13 por fila del preview, keyeado por `claveCombinacionVariante()`.
  // Estado propio (no derivado del useMemo de abajo) para que sobreviva a un
  // recálculo del cartesiano — agregar/sacar un talle o color no debe borrar
  // lo ya tipeado/escaneado en las filas que siguen existiendo.
  const [eanPorFila, setEanPorFila] = useState<Record<string, string>>({});
  // Key de la fila que abrió la cámara — controla el Dialog compartido.
  // `null` = cámara cerrada. Una sola instancia de CameraBarcodeScanner en
  // todo el componente (ver docstring del módulo).
  const [filaEscaneoActiva, setFilaEscaneoActiva] = useState<string | null>(null);

  // Producto cartesiano en el cliente — solo preview, la fuente de verdad
  // (idempotencia, límite de combinaciones) sigue siendo el servicio.
  const filasPreview = useMemo(() => {
    if (!modelo.trim() || talles.length === 0 || colores.length === 0 || generos.length === 0) {
      return [];
    }
    const filas: { key: string; talle: string; color: string; genero: Genero; sku: string }[] = [];
    for (const talle of talles) {
      for (const color of colores) {
        for (const genero of generos) {
          filas.push({
            key: claveCombinacionVariante({ talle, color, genero }),
            talle,
            color,
            genero,
            sku: generarSku({ codigoProducto, modelo, talle, codigoColor: color, genero }),
          });
        }
      }
    }
    return filas;
  }, [codigoProducto, modelo, talles, colores, generos]);

  function toggleGenero(genero: Genero) {
    setGeneros((prev) => (prev.includes(genero) ? prev.filter((g) => g !== genero) : [...prev, genero]));
  }

  function handleDetectParaFilaActiva(codigo: string) {
    if (!filaEscaneoActiva) return;
    setEanPorFila((prev) => ({ ...prev, [filaEscaneoActiva]: codigo }));
    setFilaEscaneoActiva(null);
  }

  function handleConfirmar() {
    setServerError(null);
    const eanPorCombinacion = Object.fromEntries(
      Object.entries(eanPorFila).filter(([, ean]) => ean.trim().length > 0),
    );

    startTransition(async () => {
      const respuesta = await generarVariantesMatriz(productoMaestroId, {
        modelo: modelo.trim(),
        talles,
        colores,
        generos,
        ean_por_combinacion: eanPorCombinacion,
      });

      if (respuesta.error) {
        setServerError(respuesta.error.message);
        return;
      }

      setResultado(respuesta.data);
    });
  }

  function handleNuevaTanda() {
    setResultado(null);
    setServerError(null);
    setModelo("");
    setTalles([]);
    setColores([]);
    setGeneros([]);
    setEanPorFila({});
    setFilaEscaneoActiva(null);
  }

  const puedeConfirmar = filasPreview.length > 0 && !isPending;

  // ── Resultado ya confirmado ──────────────────────────────────────────────
  if (resultado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-green-700">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Variantes generadas
          </CardTitle>
          <CardDescription>
            {resultado.variantes_creadas} creada(s)
            {resultado.variantes_omitidas_duplicadas > 0
              ? ` · ${resultado.variantes_omitidas_duplicadas} omitida(s) por SKU duplicado`
              : ""}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="text-sm font-mono space-y-1 max-h-64 overflow-y-auto">
            {resultado.variantes.map((v) => (
              <li key={v.id} className="flex justify-between border-b border-slate-100 py-1">
                <span>{v.sku}</span>
                <span className="text-muted-foreground">
                  {v.ean_qr ?? "Sin EAN-13 (pendiente)"}
                </span>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" onClick={handleNuevaTanda}>
            Generar otra tanda de variantes
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Formulario de matriz ─────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <LayoutGrid className="size-4 text-blue-500" aria-hidden="true" />
          Matriz de Variantes
        </CardTitle>
        <CardDescription>
          Combinación talle × color × género para{" "}
          <span className="font-semibold text-foreground">{nombreProducto}</span>{" "}
          (<span className="font-mono">{codigoProducto}</span>).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="modelo">Modelo</Label>
          <Input
            id="modelo"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder="Ej: SS3"
            maxLength={10}
            autoComplete="off"
          />
        </div>

        <SelectorTalles
          values={talles}
          onAdd={(v) => setTalles((p) => [...p, v])}
          onRemove={(v) => setTalles((p) => p.filter((t) => t !== v))}
        />

        <TagList
          label="Colores"
          placeholder="Ej: NEGRO"
          values={colores}
          onAdd={(v) => setColores((p) => [...p, v])}
          onRemove={(v) => setColores((p) => p.filter((c) => c !== v))}
        />

        <div className="space-y-2">
          <Label>Géneros</Label>
          <div className="flex gap-4">
            {GENEROS.map((genero) => (
              <label key={genero} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={generos.includes(genero)}
                  onChange={() => toggleGenero(genero)}
                  className="size-4 rounded border-input"
                />
                {genero}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Preview — {filasPreview.length} SKU(s)
          </p>
          {filasPreview.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Completá modelo, al menos un talle, un color y un género para ver el preview.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1">
              {filasPreview.map((fila) => (
                <li key={fila.key} className="flex items-center gap-2">
                  <span className="flex-1 truncate font-mono text-sm">{fila.sku}</span>
                  <Input
                    value={eanPorFila[fila.key] ?? ""}
                    onChange={(e) =>
                      setEanPorFila((prev) => ({ ...prev, [fila.key]: e.target.value }))
                    }
                    placeholder="EAN-13 (opcional)"
                    inputMode="numeric"
                    maxLength={13}
                    autoComplete="off"
                    className="h-8 w-36 font-mono text-xs"
                    aria-label={`EAN-13 para ${fila.sku}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setFilaEscaneoActiva(fila.key)}
                    aria-label={`Escanear EAN-13 para ${fila.sku}`}
                  >
                    <ScanLine className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button
            type="button"
            disabled={!puedeConfirmar}
            onClick={handleConfirmar}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Generando…
              </>
            ) : (
              <>Confirmar y generar {filasPreview.length || ""} variante(s)</>
            )}
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={filaEscaneoActiva !== null}
        onOpenChange={(open) => !open && setFilaEscaneoActiva(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escanear EAN-13</DialogTitle>
            <DialogDescription>
              Apuntá al código de barras de la etiqueta física. Se vuelca solo en la fila que
              abrió la cámara.
            </DialogDescription>
          </DialogHeader>
          {filaEscaneoActiva !== null && (
            <CameraBarcodeScanner
              onDetect={handleDetectParaFilaActiva}
              activo={filaEscaneoActiva !== null}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
