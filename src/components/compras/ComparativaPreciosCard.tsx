"use client";

/**
 * @component ComparativaPreciosCard
 * @description Sección "Comparativa" de la pantalla "Lista de Precios"
 * (HU-H7, spec_modulo_H.md §2.10). Elige una variante y lista cada proveedor
 * HOMOLOGADO con precio vigente para esa variante, ordenado `precio asc`
 * (desempate `razon_social`) — vía `compararPreciosAction`
 * (`obtenerComparativaPrecios`, mismo servicio que
 * `GET /api/proveedores/comparativa-precios`). Gate: solo se renderiza si el
 * RSC padre resolvió `proveedores:comparar_precios` (no se repite acá).
 */

import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";

import { compararPreciosAction } from "@/app/(dashboard)/compras/listas-precios/actions";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { VarianteParaSelector } from "@/lib/services/proveedores/orden-compra.service";

interface ComparativaItem {
  proveedor_id: string;
  razon_social: string;
  precio_unitario: number;
  fecha_inicio_vigencia: string;
  puntaje_total: number | null;
  tiempo_entrega_promedio_dias: number | null;
}

interface ComparativaPreciosCardProps {
  variantes: VarianteParaSelector[];
}

export function ComparativaPreciosCard({ variantes }: ComparativaPreciosCardProps) {
  const [isPending, startTransition] = useTransition();
  const [varianteId, setVarianteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [proveedores, setProveedores] = useState<ComparativaItem[] | null>(null);

  const comparar = () => {
    setError(null);
    setProveedores(null);
    if (!varianteId) {
      setError("Elegí una variante para comparar.");
      return;
    }
    startTransition(async () => {
      const resultado = await compararPreciosAction({ variante_sku_id: varianteId });
      if (resultado.error) {
        setError(
          resultado.error.code === "SIN_PROVEEDORES_COMPARABLES"
            ? "No hay proveedores homologados con precio vigente para esta variante."
            : resultado.error.message,
        );
        return;
      }
      setProveedores(resultado.data.proveedores);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="comparativa-variante" className="text-xs">
            Variante
          </Label>
          <ComboboxFiltrable
            id="comparativa-variante"
            items={variantes}
            getId={(v) => v.id}
            getLabel={(v) => `${v.sku} — ${v.descripcion}`}
            value={varianteId}
            onChange={(v) => {
              setVarianteId(v.id);
              setProveedores(null);
              setError(null);
            }}
            placeholder="Buscar SKU o producto…"
            emptyMessage="Sin coincidencias."
            pageSize={8}
          />
        </div>
        <Button
          type="button"
          onClick={comparar}
          disabled={isPending}
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Comparar
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {proveedores && (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead>Precio vigente</TableHead>
                <TableHead>Vigente desde</TableHead>
                <TableHead>Puntaje</TableHead>
                <TableHead>Entrega prom. (días)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proveedores.map((p, indice) => (
                <TableRow key={p.proveedor_id}>
                  <TableCell className="text-xs">
                    {p.razon_social} {indice === 0 && <span className="text-emerald-600 font-semibold">· más barato</span>}
                  </TableCell>
                  <TableCell className="text-xs font-medium">
                    ${p.precio_unitario.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {/* `fecha_inicio_vigencia` es date-only (medianoche UTC) — se
                        formatea con `timeZone: "UTC"` para no restarle un día en
                        UTC-3 (ver HistorialVersionesListaPrecio, misma corrección). */}
                    {new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" }).format(
                      new Date(p.fecha_inicio_vigencia),
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{p.puntaje_total ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p.tiempo_entrega_promedio_dias ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
