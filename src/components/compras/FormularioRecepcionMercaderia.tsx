"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronRight, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { construirQueryRecepciones } from "@/lib/services/proveedores/recepcion-reglas";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface OrdenRecepcionable {
  id: string;
  numero_orden: string;
  fecha_emision: string;
  estado: string;
  proveedor: string;
  items: Array<{
    orden_compra_item_id: string;
    sku: string;
    producto: string;
    cantidad_solicitada: number;
  }>;
}

interface DepositoRecepcion {
  id: string;
  nombre: string;
  tipo: string;
}

interface ProveedorFiltroRecepcion {
  id: string;
  razon_social: string;
}

interface EstadoRecepcionPorOrden {
  deposito_destino_id: string;
  clave_idempotencia: string;
  isSubmitting: boolean;
  completada: boolean;
  resultado: { tipo: "ok" | "error"; texto: string } | null;
}

function formatearFecha(fecha: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(fecha));
}

export function FormularioRecepcionMercaderia({
  ordenes,
  depositos,
  proveedores,
  proveedorSeleccionado,
  fechaSeleccionada,
  page,
  totalPages,
  ordenInicialId,
}: {
  ordenes: OrdenRecepcionable[];
  depositos: DepositoRecepcion[];
  proveedores: ProveedorFiltroRecepcion[];
  proveedorSeleccionado?: string;
  fechaSeleccionada?: string;
  page: number;
  totalPages: number;
  ordenInicialId?: string;
}) {
  const router = useRouter();
  const [ordenExpandidaId, setOrdenExpandidaId] = useState<string | null>(() =>
    ordenes.some((orden) => orden.id === ordenInicialId) ? ordenInicialId! : null,
  );
  const [estadosPorOrden, setEstadosPorOrden] = useState<Record<string, EstadoRecepcionPorOrden>>(
    () => Object.fromEntries(ordenes.map((orden) => [
      orden.id,
      {
        deposito_destino_id: depositos[0]?.id ?? "",
        clave_idempotencia: crypto.randomUUID(),
        isSubmitting: false,
        completada: false,
        resultado: null,
      },
    ])),
  );
  const [confirmacion, setConfirmacion] = useState<string | null>(null);

  const ordenesVisibles = useMemo(
    () => ordenes.filter((orden) => !estadosPorOrden[orden.id]?.completada),
    [ordenes, estadosPorOrden],
  );

  function actualizarEstado(
    ordenId: string,
    cambio: Partial<EstadoRecepcionPorOrden>,
  ): void {
    setEstadosPorOrden((actual) => ({
      ...actual,
      [ordenId]: { ...actual[ordenId]!, ...cambio },
    }));
  }

  function actualizarFiltros(cambio: {
    proveedorId?: string;
    fechaEmision?: string;
  }): void {
    const proveedorId = cambio.proveedorId ?? proveedorSeleccionado ?? "";
    const fechaEmision = cambio.fechaEmision ?? fechaSeleccionada ?? "";
    const query = construirQueryRecepciones({ proveedorId, fechaEmision, page: 1 });
    router.push(`/compras/recepciones/nueva${query ? `?${query}` : ""}`);
  }

  function navegarPagina(nuevaPagina: number): void {
    const query = construirQueryRecepciones({
      proveedorId: proveedorSeleccionado,
      fechaEmision: fechaSeleccionada,
      page: nuevaPagina,
    });
    router.push(`/compras/recepciones/nueva${query ? `?${query}` : ""}`);
  }

  async function confirmarRecepcion(orden: OrdenRecepcionable): Promise<void> {
    const estado = estadosPorOrden[orden.id]!;
    if (orden.items.length === 0) {
      actualizarEstado(orden.id, {
        resultado: { tipo: "error", texto: "La orden no tiene materiales activos para recibir." },
      });
      return;
    }
    if (!estado.deposito_destino_id) {
      actualizarEstado(orden.id, {
        resultado: { tipo: "error", texto: "Seleccioná un depósito destino." },
      });
      return;
    }

    actualizarEstado(orden.id, { isSubmitting: true, resultado: null });
    try {
      const respuesta = await fetch(`/api/ordenes-compra/${orden.id}/recepciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposito_destino_id: estado.deposito_destino_id,
          clave_idempotencia: estado.clave_idempotencia,
        }),
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) {
        actualizarEstado(orden.id, {
          resultado: {
            tipo: "error",
            texto: cuerpo.error?.message ?? "No se pudo registrar la recepción.",
          },
        });
        return;
      }

      const avisoEvaluacion = cuerpo.data.evaluacion_proveedor === "FALLO"
        ? " La recepción quedó confirmada, pero falló la evaluación del proveedor."
        : "";
      const mensaje = `Recepción confirmada para ${orden.numero_orden}.${avisoEvaluacion}`;
      actualizarEstado(orden.id, {
        completada: true,
        resultado: { tipo: "ok", texto: mensaje },
      });
      setConfirmacion(mensaje);
      setOrdenExpandidaId(null);
      router.refresh();
    } catch {
      // La clave de esta OC se conserva: un retry tras timeout no duplica efectos.
      actualizarEstado(orden.id, {
        resultado: {
          tipo: "error",
          texto: "No se recibió respuesta. Reintentá: la operación es idempotente.",
        },
      });
    } finally {
      actualizarEstado(orden.id, { isSubmitting: false });
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-[minmax(220px,1fr)_minmax(180px,auto)_auto] md:items-end">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Proveedor</span>
          <select
            className="w-full rounded-md border bg-white px-3 py-2"
            value={proveedorSeleccionado ?? ""}
            onChange={(event) => actualizarFiltros({ proveedorId: event.target.value })}
          >
            <option value="">Todos los proveedores</option>
            {proveedores.map((proveedor) => (
              <option key={proveedor.id} value={proveedor.id}>
                {proveedor.razon_social}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Fecha de emisión</span>
          <input
            type="date"
            className="w-full rounded-md border bg-white px-3 py-2"
            value={fechaSeleccionada ?? ""}
            onChange={(event) => actualizarFiltros({ fechaEmision: event.target.value })}
          />
        </label>

        <Button
          type="button"
          variant="outline"
          className="w-full md:w-auto"
          onClick={() => router.push("/compras/recepciones/nueva")}
        >
          Limpiar filtros
        </Button>
      </div>

      {confirmacion && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" aria-hidden="true" /> {confirmacion}
        </p>
      )}

      {ordenesVisibles.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No hay órdenes confirmadas que coincidan con los filtros seleccionados.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border">
            <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Orden</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Fecha emisión</TableHead>
              <TableHead className="text-right">Ítems</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenesVisibles.map((orden) => {
              const expandida = ordenExpandidaId === orden.id;
              const estado = estadosPorOrden[orden.id]!;

              return (
                <Fragment key={orden.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs font-semibold">
                      {orden.numero_orden}
                    </TableCell>
                    <TableCell>{orden.proveedor}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatearFecha(orden.fecha_emision)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {orden.items.length}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">CONFIRMADA</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={expandida}
                        aria-controls={`materiales-${orden.id}`}
                        onClick={() => setOrdenExpandidaId(expandida ? null : orden.id)}
                      >
                        {expandida
                          ? <ChevronDown className="size-4" aria-hidden="true" />
                          : <ChevronRight className="size-4" aria-hidden="true" />}
                        Ver materiales
                      </Button>
                    </TableCell>
                  </TableRow>

                  {expandida && (
                    <TableRow id={`materiales-${orden.id}`}>
                      <TableCell colSpan={6} className="bg-muted/20 p-0">
                        <div className="space-y-6 px-4 py-5 sm:px-6">
                          <div className="space-y-3">
                            <h3 className="font-semibold">Materiales</h3>
                            <div className="overflow-hidden rounded-md border bg-background">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Producto</TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead className="text-right">Cantidad</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {orden.items.map((item) => (
                                    <TableRow key={item.orden_compra_item_id}>
                                      <TableCell>{item.producto}</TableCell>
                                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {item.cantidad_solicitada}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <h3 className="font-semibold">Recepción</h3>
                            <div className="grid gap-3 rounded-md border bg-background p-4 sm:p-5 md:grid-cols-[auto_minmax(240px,1fr)_auto] md:items-center md:gap-4">
                              <label
                                htmlFor={`deposito-${orden.id}`}
                                className="text-sm font-medium"
                              >
                                Depósito destino
                              </label>
                              <select
                                id={`deposito-${orden.id}`}
                                className="w-full rounded-md border bg-white px-3 py-2"
                                value={estado.deposito_destino_id}
                                disabled={estado.isSubmitting || depositos.length === 0}
                                onChange={(event) => actualizarEstado(orden.id, {
                                  deposito_destino_id: event.target.value,
                                  resultado: null,
                                })}
                              >
                                {depositos.map((deposito) => (
                                  <option key={deposito.id} value={deposito.id}>
                                    {deposito.nombre} ({deposito.tipo})
                                  </option>
                                ))}
                              </select>

                              <Button
                                type="button"
                                className="w-full md:w-auto"
                                disabled={
                                  estado.isSubmitting
                                  || depositos.length === 0
                                  || orden.items.length === 0
                                }
                                onClick={() => void confirmarRecepcion(orden)}
                              >
                                <PackageCheck className="size-4" aria-hidden="true" />
                                {estado.isSubmitting ? "Confirmando…" : "Confirmar recepción"}
                              </Button>
                            </div>
                          </div>

                          {estado.resultado?.tipo === "error" && (
                            <p role="status" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                              {estado.resultado.texto}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Paginación de órdenes recepcionables"
              className="flex items-center justify-between gap-4"
            >
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => navegarPagina(page - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => navegarPagina(page + 1)}
              >
                Siguiente
              </Button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
