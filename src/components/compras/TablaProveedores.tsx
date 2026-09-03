"use client";

/**
 * @component TablaProveedores
 * @description Grilla de proveedores (HU-H1) con filtro server-side por
 * estado, sincronizado con la URL (mismo patrón que `TablaOrdenesCompra`: el
 * filtro escribe query params y el RSC padre re-consulta). Incluye las
 * acciones de gestión por fila — alta (diálogo con el formulario), edición
 * del legajo, homologar / suspender y baja lógica — habilitadas según los
 * permisos granulares que resuelve el RSC padre.
 *
 * NUNCA renderiza datos bancarios (el listado del servicio no los expone —
 * Ley N.° 25.326 / spec §3.3).
 */

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Pencil, UserPlus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EstadoProveedorBadge } from "@/components/compras/EstadoProveedorBadge";
import { FormularioNuevoProveedor } from "@/components/compras/FormularioNuevoProveedor";
import { DialogHomologar } from "@/components/compras/DialogHomologar";
import { DialogSuspender } from "@/components/compras/DialogSuspender";
import { DialogBaja } from "@/components/compras/DialogBaja";
import { DialogVolverPendiente } from "@/components/compras/DialogVolverPendiente";
import type { ProveedorListado } from "@/lib/services/proveedores/proveedor.service";

export interface PermisosProveedores {
  crear: boolean;
  editar: boolean;
  homologar: boolean;
  baja: boolean;
}

interface TablaProveedoresProps {
  proveedores: ProveedorListado[];
  filtrosIniciales: {
    estado?: string;
  };
  permisos: PermisosProveedores;
}

const ESTADOS = ["PENDIENTE", "HOMOLOGADO", "SUSPENDIDO"] as const;

const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  HOMOLOGADO: "Homologado",
  SUSPENDIDO: "Suspendido",
};

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(fecha));
}

/** Categorías truncadas a las 2 primeras + contador. */
function categoriasCortas(categorias: string[]): string {
  if (categorias.length === 0) return "—";
  if (categorias.length <= 2) return categorias.join(", ");
  return `${categorias.slice(0, 2).join(", ")} +${categorias.length - 2} más`;
}

/**
 * Acciones de una fila: edición (diálogo con el formulario en modo edición),
 * homologar / suspender / baja según el estado y los permisos del usuario.
 */
function FilaAcciones({
  proveedor,
  permisos,
}: {
  proveedor: ProveedorListado;
  permisos: PermisosProveedores;
}) {
  const router = useRouter();
  const [editarAbierto, setEditarAbierto] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {permisos.editar && (
        <Dialog open={editarAbierto} onOpenChange={setEditarAbierto}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setEditarAbierto(true)}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Editar
          </Button>
          <DialogContent className="flex max-h-[85vh] flex-col">
            <DialogHeader>
              <DialogTitle>Editar legajo — {proveedor.razon_social}</DialogTitle>
              <DialogDescription>
                Modificá los datos del legajo comercial. El CUIT y el estado no
                se pueden editar; los datos bancarios solo se reemplazan.
              </DialogDescription>
            </DialogHeader>
            {/* El portal del Dialog monta/desmonta el contenido al abrir/cerrar:
                el formulario arranca siempre con estado fresco. */}
            <FormularioNuevoProveedor
              proveedor={proveedor}
              onExito={() => {
                setEditarAbierto(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {permisos.homologar && proveedor.estado === "PENDIENTE" && (
        <DialogHomologar
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          estadoActual="PENDIENTE"
        />
      )}
      {permisos.homologar && proveedor.estado === "SUSPENDIDO" && (
        <DialogHomologar
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          estadoActual="SUSPENDIDO"
        />
      )}
      {permisos.homologar && proveedor.estado === "HOMOLOGADO" && (
        <DialogSuspender
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
        />
      )}

      {permisos.homologar && proveedor.estado === "HOMOLOGADO" && (
        <DialogVolverPendiente
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          estadoActual="HOMOLOGADO"
        />
      )}
      {permisos.homologar && proveedor.estado === "SUSPENDIDO" && (
        <DialogVolverPendiente
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          estadoActual="SUSPENDIDO"
        />
      )}

      {permisos.baja && (
        <DialogBaja proveedorId={proveedor.id} razonSocial={proveedor.razon_social} />
      )}
    </div>
  );
}

export function TablaProveedores({
  proveedores,
  filtrosIniciales,
  permisos,
}: TablaProveedoresProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  const estadoActual = filtrosIniciales.estado ?? "";

  const aplicarFiltro = useCallback(
    (valor: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (valor) {
        params.set("estado", valor);
      } else {
        params.delete("estado");
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const hayFiltro = Boolean(estadoActual);

  return (
    <div className="space-y-4">
      {/* ── Filtros + CTA de alta ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Filter className="size-3.5" />
            Filtros
          </div>
          {permisos.crear && (
            <Dialog open={nuevoAbierto} onOpenChange={setNuevoAbierto}>
              <Button
                type="button"
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                onClick={() => setNuevoAbierto(true)}
              >
                <UserPlus className="size-4" aria-hidden="true" />
                Nuevo proveedor
              </Button>
              <DialogContent className="flex max-h-[85vh] flex-col">
                <DialogHeader>
                  <DialogTitle>Alta de proveedor</DialogTitle>
                  <DialogDescription>
                    El proveedor se crea en estado PENDIENTE y queda pendiente
                    de homologación (Supervisor de Compras). Los datos
                    bancarios se cifran en reposo (AES-256).
                  </DialogDescription>
                </DialogHeader>
                <FormularioNuevoProveedor
                  onExito={() => {
                    setNuevoAbierto(false);
                    router.refresh();
                  }}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="filtro-estado-prov" className="text-xs">
              Estado
            </Label>
            <select
              id="filtro-estado-prov"
              value={estadoActual}
              onChange={(e) => aplicarFiltro(e.target.value)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">Todos los estados</option>
              {ESTADOS.map((estado) => (
                <option key={estado} value={estado}>
                  {ESTADO_LABEL[estado] ?? estado}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hayFiltro && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("?")}
              className="text-xs h-7 text-muted-foreground hover:text-foreground"
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {proveedores.length} proveedor(es)
      </p>

      {/* ── Tabla ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Proveedor
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  CUIT
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Categorías
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Estado
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Alta
                </th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {proveedores.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground text-sm"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <Users className="size-8 text-muted-foreground/50" />
                      No hay proveedores que coincidan con los filtros.
                    </div>
                  </td>
                </tr>
              ) : (
                proveedores.map((proveedor) => (
                  <tr key={proveedor.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{proveedor.razon_social}</p>
                      {proveedor.nombre_fantasia && (
                        <p className="text-xs text-muted-foreground">
                          {proveedor.nombre_fantasia}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{proveedor.cuit}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {categoriasCortas(proveedor.categorias)}
                    </td>
                    <td className="px-4 py-3">
                      <EstadoProveedorBadge estado={proveedor.estado} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatFecha(proveedor.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <FilaAcciones proveedor={proveedor} permisos={permisos} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}