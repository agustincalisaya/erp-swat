"use client";

/**
 * @component LegajoPruebaTable
 * @description Tabla de LegajosPrueba activos con Shadcn UI Table + Badge.
 *
 * UI Stack:
 *  - Shadcn UI: Table (TableHeader/TableRow/TableHead/TableBody/TableCell),
 *               Badge, Button, Input (buscador)
 *  - Paleta Tailwind CSS: blue (bg-blue-600, text-blue-600, border-blue-200)
 *  - Datos descifrados recibidos como props desde el Server Component padre.
 */

import { useState } from "react";
import {
  ShieldCheck,
  Lock,
  Package2,
  Calendar,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";

// Shadcn UI
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LegajoPruebaDecifrado } from "@/lib/services/inventario/legajo-prueba.service";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function maskPlaca(placa: string): string {
  if (placa.length <= 4) return "*".repeat(placa.length);
  return "*".repeat(placa.length - 4) + placa.slice(-4);
}

// ──────────────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────────────
interface LegajoPruebaTableProps {
  legajos: LegajoPruebaDecifrado[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────────────────────────
export function LegajoPruebaTable({ legajos }: LegajoPruebaTableProps) {
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  const toggleReveal = (id: string) =>
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const filtered = legajos
    .filter((l) => {
      const q = search.toLowerCase();
      return (
        l.variante_sku.sku.toLowerCase().includes(q) ||
        l.efectivo_organismo.toLowerCase().includes(q) ||
        l.efectivo_placa.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const diff =
        new Date(a.fecha_inicio_prueba).getTime() -
        new Date(b.fecha_inicio_prueba).getTime();
      return sortDesc ? -diff : diff;
    });

  return (
    <div className="space-y-4">
      {/* ── Controles ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="search-legajos"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU, organismo o placa…"
            className="pl-8 focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
          />
        </div>
        <p className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} {filtered.length === 1 ? "registro" : "registros"}
        </p>
      </div>

      {/* ── Estado vacío ───────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed border-blue-100 bg-blue-50/40 text-center">
          <div className="p-4 rounded-full bg-blue-100 text-blue-500 mb-4">
            <ShieldCheck className="size-8" />
          </div>
          <p className="text-sm font-medium text-gray-600">
            {search
              ? "Sin resultados para tu búsqueda"
              : "No hay legajos de prueba activos"}
          </p>
          {!search && (
            <p className="text-xs text-muted-foreground mt-1">
              Registrá una nueva asignación usando el botón superior.
            </p>
          )}
        </div>
      ) : (
        /* ── Tabla Shadcn ────────────────────────────────────────────── */
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Package2 className="size-3.5" aria-hidden="true" />
                    SKU / Variante
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Lock className="size-3.5 text-blue-500" aria-hidden="true" />
                    Placa efectivo
                  </div>
                </TableHead>
                <TableHead className="hidden md:table-cell text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Organismo
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSortDesc((v) => !v)}
                    className="h-auto p-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground gap-1"
                    aria-label={`Ordenar por fecha ${sortDesc ? "ascendente" : "descendente"}`}
                  >
                    <Calendar className="size-3.5" aria-hidden="true" />
                    Inicio prueba
                    {sortDesc ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronUp className="size-3" />
                    )}
                  </Button>
                </TableHead>
                <TableHead className="hidden sm:table-cell text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Estado
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filtered.map((legajo) => {
                const isRevealed = revealedIds.has(legajo.id);
                return (
                  <TableRow key={legajo.id} className="hover:bg-blue-50/30">
                    {/* SKU */}
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs font-semibold">
                          {legajo.variante_sku.sku}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {legajo.variante_sku.talle} · {legajo.variante_sku.color}
                        </span>
                      </div>
                    </TableCell>

                    {/* Placa (con revelar/ocultar) */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">
                          {isRevealed
                            ? legajo.efectivo_placa
                            : maskPlaca(legajo.efectivo_placa)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => toggleReveal(legajo.id)}
                          aria-label={isRevealed ? "Ocultar placa" : "Revelar placa"}
                          className="text-blue-500 hover:text-blue-700 hover:bg-blue-100"
                        >
                          <Lock className="size-3" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>

                    {/* Organismo */}
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs text-muted-foreground line-clamp-1 max-w-48">
                        {legajo.efectivo_organismo}
                      </span>
                    </TableCell>

                    {/* Fecha */}
                    <TableCell>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(legajo.fecha_inicio_prueba)}
                      </span>
                    </TableCell>

                    {/* Estado */}
                    <TableCell className="hidden sm:table-cell">
                      <Badge className="bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-100 gap-1">
                        <ShieldCheck className="size-3" aria-hidden="true" />
                        En Prueba
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
