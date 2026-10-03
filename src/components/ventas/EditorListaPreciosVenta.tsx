"use client";

/**
 * @component EditorListaPreciosVenta
 * @description HU-B9 — tabla editable de `/ventas/lista-precios`. Tabla
 * propia con el mismo patrón visual que `TablaPresupuestos` y cuentas
 * corrientes (ninguna pantalla de Ventas usa `TablaFiltroPaginada`), con
 * búsqueda en memoria por SKU/descripción.
 *
 * Cada fila arranca con el input de precio VACÍO; "Aplicar" copia la
 * sugerencia. Solo se publican las filas con precio cargado — el resolver es
 * por SKU, así que el resto mantiene su precio vigente. El input de motivo
 * aparece solo cuando el precio queda por debajo del costo de reposición.
 * Toda la validación vive en `lista-precios-venta.calculo.ts` (puro).
 */

import { useMemo, useState } from "react";
import { Search, Info, Wand2 } from "lucide-react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogPublicarVersionListaPrecioVenta } from "@/components/ventas/DialogPublicarVersionListaPrecioVenta";
import {
  construirPayloadVersion,
  filtrarFilas,
  parsearPrecio,
  requiereMotivo,
  type EdicionFila,
  type FilaListaPrecioVenta,
} from "@/components/ventas/lista-precios-venta.calculo";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

const SIN_EDICION: EdicionFila = { precio: "", motivo: "" };

interface EditorListaPreciosVentaProps {
  filas: FilaListaPrecioVenta[];
  /** Día de negocio actual (`AAAA-MM-DD`), calculado en el RSC: default y mínimo de la fecha. */
  hoy: string;
}

export function EditorListaPreciosVenta({ filas, hoy }: EditorListaPreciosVentaProps) {
  const [ediciones, setEdiciones] = useState<Map<string, EdicionFila>>(() => new Map());
  const [busqueda, setBusqueda] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(hoy);
  /** Fila rechazada por el servidor (`details.variante_sku_id` de MOTIVO_BAJO_COSTO_REQUERIDO). */
  const [filaRechazada, setFilaRechazada] = useState<string | null>(null);

  const visibles = useMemo(() => filtrarFilas(filas, busqueda), [filas, busqueda]);
  const resultado = useMemo(
    () => construirPayloadVersion(filas, ediciones, vigenteDesde, hoy),
    [filas, ediciones, vigenteDesde, hoy],
  );

  function editar(id: string, cambio: Partial<EdicionFila>) {
    setFilaRechazada(null);
    setEdiciones((actual) => {
      const siguiente = new Map(actual);
      siguiente.set(id, { ...(actual.get(id) ?? SIN_EDICION), ...cambio });
      return siguiente;
    });
  }

  const cantidadCargadas = [...ediciones.values()].filter((e) => e.precio.trim() !== "").length;
  const erroresFila = resultado.ok ? null : resultado.errores_fila;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-sm font-semibold">Variantes activas ({filas.length})</CardTitle>
          <CardDescription>
            Cargá el nuevo precio solo en las variantes que querés actualizar. La sugerencia es el
            costo de reposición más el margen configurado.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="relative sm:max-w-sm">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por SKU o descripción…"
              autoComplete="off"
              className="pl-9"
              aria-label="Buscar variante"
            />
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Variante
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Precio vigente
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Costo reposición
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                      Sugerido
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground min-w-56">
                      Nuevo precio
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">
                        {filas.length === 0
                          ? "No hay variantes activas para cotizar."
                          : "Ninguna variante coincide con la búsqueda."}
                      </td>
                    </tr>
                  ) : (
                    visibles.map((fila) => {
                      const id = fila.variante_sku_id;
                      const edicion = ediciones.get(id) ?? SIN_EDICION;
                      const mostrarMotivo = requiereMotivo(edicion.precio, fila.costo_reposicion);
                      const errorFila = erroresFila?.get(id);
                      const precioInvalido = errorFila === "PRECIO_INVALIDO";
                      const motivoFaltante = errorFila === "MOTIVO_REQUERIDO" || filaRechazada === id;
                      const editada = parsearPrecio(edicion.precio) !== null;
                      return (
                        <tr
                          key={id}
                          className={
                            filaRechazada === id ? "bg-red-50" : editada ? "bg-blue-50/40" : undefined
                          }
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="font-mono text-xs text-muted-foreground">{fila.sku}</div>
                            <div className="font-medium">{fila.descripcion}</div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums align-top">
                            {fila.precio_vigente === null ? (
                              <Badge className="bg-amber-100 text-amber-700 border border-amber-200 font-medium">
                                Sin precio
                              </Badge>
                            ) : (
                              money.format(fila.precio_vigente)
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums align-top">
                            {fila.costo_reposicion === null ? (
                              <span className="text-xs text-muted-foreground">Sin costo</span>
                            ) : (
                              money.format(fila.costo_reposicion)
                            )}
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            {fila.precio_sugerido === null ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                <span className="tabular-nums">{money.format(fila.precio_sugerido)}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 px-2 text-xs text-blue-600 hover:text-blue-700"
                                  onClick={() => editar(id, { precio: String(fila.precio_sugerido) })}
                                >
                                  <Wand2 className="size-3" aria-hidden="true" />
                                  Aplicar
                                </Button>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="space-y-2">
                              <Input
                                value={edicion.precio}
                                onChange={(e) => editar(id, { precio: e.target.value })}
                                inputMode="decimal"
                                placeholder="Sin cambios"
                                aria-label={`Nuevo precio de ${fila.sku}`}
                                aria-invalid={precioInvalido || undefined}
                                className="text-right tabular-nums"
                              />
                              {precioInvalido && (
                                <p className="text-xs text-destructive">
                                  Precio inválido: mayor a 0, hasta 2 decimales.
                                </p>
                              )}
                              {mostrarMotivo && (
                                <div className="space-y-1">
                                  <Input
                                    value={edicion.motivo}
                                    onChange={(e) => editar(id, { motivo: e.target.value })}
                                    placeholder="Motivo (precio bajo costo)"
                                    aria-label={`Motivo de precio bajo costo de ${fila.sku}`}
                                    aria-invalid={motivoFaltante || undefined}
                                    className="border-amber-300 focus-visible:border-amber-500"
                                  />
                                  <p
                                    className={`text-xs ${motivoFaltante ? "text-destructive" : "text-amber-700"}`}
                                  >
                                    Por debajo del costo de reposición: el motivo es obligatorio.
                                  </p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-sm font-semibold">Publicar versión nueva</CardTitle>
          <CardDescription>
            {cantidadCargadas === 0
              ? "Todavía no cargaste ningún precio."
              : `${cantidadCargadas} variante(s) con precio nuevo.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Las variantes sin precio cargado no entran en esta versión y mantienen su precio
              vigente.
            </span>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <Label
                htmlFor="vigente-desde"
                className="text-xs font-semibold uppercase tracking-wide text-gray-700"
              >
                Vigente desde
              </Label>
              <Input
                id="vigente-desde"
                type="date"
                value={vigenteDesde}
                min={hoy}
                onChange={(e) => setVigenteDesde(e.target.value)}
                className="w-full sm:w-48"
                aria-invalid={(!resultado.ok && resultado.error_general === "FECHA_INVALIDA") || undefined}
              />
              {!resultado.ok && resultado.error_general === "FECHA_INVALIDA" && (
                <p className="text-xs text-destructive">Elegí una fecha desde hoy en adelante.</p>
              )}
            </div>

            <DialogPublicarVersionListaPrecioVenta
              resultado={resultado}
              vigenteDesdeDia={vigenteDesde}
              onPublicada={() => {
                setEdiciones(new Map());
                setVigenteDesde(hoy);
              }}
              onFilaRechazada={setFilaRechazada}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
