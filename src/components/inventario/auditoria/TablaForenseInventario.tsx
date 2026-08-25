"use client";

/**
 * @component TablaForenseInventario
 * @description Client Component de solo lectura para la HU-A7.
 *
 * Provee:
 *  - Filtros server-side: búsqueda libre, SKU, usuario, rango de fechas,
 *    tipo de movimiento y módulo/tabla (CA 2).
 *  - Verificación interactiva de integridad SHA-256 (CA 3).
 *  - Visualización append-only del ledger (CA 4).
 *
 * No expone ninguna acción de mutación (CA 1 / CA 4).
 */

import { useState, useTransition, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Hash,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { verificarIntegridadAction } from "@/app/(dashboard)/inventario/auditoria/actions";
import type {
  RegistroAuditoriaInventario,
  ResultadoVerificacionInventario,
} from "@/lib/services/inventario/auditoria.service";

interface TablaForenseInventarioProps {
  registros: RegistroAuditoriaInventario[];
  total: number;
  page: number;
  page_size: number;
  /** Valores iniciales de los filtros activos (hidratados desde la URL). */
  filtrosIniciales?: {
    q?: string;
    sku_referencia?: string;
    tipo_movimiento?: string;
    tabla_afectada?: string;
    fecha_desde?: string;
    fecha_hasta?: string;
  };
}

const ACCION_COLOR: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800 border-green-200",
  UPDATE: "bg-blue-100 text-blue-800 border-blue-200",
  EGRESO: "bg-orange-100 text-orange-800 border-orange-200",
  INGRESO: "bg-emerald-100 text-emerald-800 border-emerald-200",
  AJUSTE: "bg-yellow-100 text-yellow-800 border-yellow-200",
  TRANSFERENCIA: "bg-cyan-100 text-cyan-800 border-cyan-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};

const TIPOS_MOVIMIENTO = [
  { value: "INGRESO", label: "Ingreso" },
  { value: "EGRESO", label: "Egreso" },
  { value: "AJUSTE", label: "Ajuste" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "CREATE", label: "Creación" },
  { value: "UPDATE", label: "Actualización" },
  { value: "DELETE", label: "Eliminación" },
];

const TABLAS_MODULO_A = [
  { value: "movimientos_stock", label: "Movimientos de Stock" },
  { value: "stock_depositos", label: "Stock por Depósito" },
  { value: "variantes_sku", label: "Variantes SKU" },
  { value: "depositos", label: "Depósitos" },
  { value: "productos_maestros", label: "Productos Maestros" },
];

export function TablaForenseInventario({
  registros,
  total,
  page,
  page_size,
  filtrosIniciales = {},
}: TablaForenseInventarioProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [resultadoVerificacion, setResultadoVerificacion] =
    useState<ResultadoVerificacionInventario | null>(null);
  const [isPending, startTransition] = useTransition();

  // Estado local de filtros (se sincronizan con la URL al aplicar)
  const [q, setQ] = useState(filtrosIniciales.q ?? "");
  const [sku, setSku] = useState(filtrosIniciales.sku_referencia ?? "");
  const [tipoMov, setTipoMov] = useState(filtrosIniciales.tipo_movimiento ?? "");
  const [tabla, setTabla] = useState(filtrosIniciales.tabla_afectada ?? "");
  const [fechaDesde, setFechaDesde] = useState(filtrosIniciales.fecha_desde ?? "");
  const [fechaHasta, setFechaHasta] = useState(filtrosIniciales.fecha_hasta ?? "");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Aplicar filtros → URL (dispara recarga del RSC) ────────────────────────
  const aplicarFiltros = useCallback(
    (overrides: Record<string, string> = {}) => {
      const params = new URLSearchParams(searchParams.toString());
      const values: Record<string, string> = {
        q,
        sku_referencia: sku,
        tipo_movimiento: tipoMov,
        tabla_afectada: tabla,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        ...overrides,
      };

      Object.entries(values).forEach(([key, val]) => {
        if (val && val.trim()) {
          params.set(key, val.trim());
        } else {
          params.delete(key);
        }
      });
      params.delete("page");
      router.push(`?${params.toString()}`);
    },
    [router, searchParams, q, sku, tipoMov, tabla, fechaDesde, fechaHasta],
  );

  // Búsqueda libre con debounce 350ms
  const handleBusquedaLibre = (valor: string) => {
    setQ(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      aplicarFiltros({ q: valor });
    }, 350);
  };

  const limpiarFiltros = () => {
    setQ(""); setSku(""); setTipoMov(""); setTabla("");
    setFechaDesde(""); setFechaHasta("");
    router.push("?");
  };

  // ── Verificación SHA-256 ───────────────────────────────────────────────────
  const handleVerificarCadena = () => {
    startTransition(async () => {
      setResultadoVerificacion(null);
      const resultado = await verificarIntegridadAction();
      if (resultado.success && resultado.data) {
        setResultadoVerificacion(resultado.data);
      }
    });
  };

  const hayFiltrosActivos = [q, sku, tipoMov, tabla, fechaDesde, fechaHasta].some(Boolean);

  return (
    <div className="space-y-4">

      {/* ── Panel de filtros (CA 2) ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Filter className="size-3.5" />
          Filtros
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

          {/* Búsqueda libre */}
          <div className="space-y-1">
            <Label htmlFor="busqueda-libre" className="text-xs">Búsqueda libre</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                id="busqueda-libre"
                placeholder="Acción, tabla, registro..."
                value={q}
                onChange={(e) => handleBusquedaLibre(e.target.value)}
                className="pl-8 text-sm h-8"
              />
            </div>
          </div>

          {/* SKU */}
          <div className="space-y-1">
            <Label htmlFor="filtro-sku" className="text-xs">SKU / Variante</Label>
            <Input
              id="filtro-sku"
              placeholder="UUID o fragmento de SKU"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              onBlur={() => aplicarFiltros({ sku_referencia: sku })}
              onKeyDown={(e) => e.key === "Enter" && aplicarFiltros({ sku_referencia: sku })}
              className="text-sm h-8"
            />
          </div>

          {/* Tipo de movimiento */}
          <div className="space-y-1">
            <Label htmlFor="filtro-tipo" className="text-xs">Tipo de movimiento</Label>
            <select
              id="filtro-tipo"
              value={tipoMov}
              onChange={(e) => {
                setTipoMov(e.target.value);
                aplicarFiltros({ tipo_movimiento: e.target.value });
              }}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">Todos los tipos</option>
              {TIPOS_MOVIMIENTO.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Módulo / Tabla */}
          <div className="space-y-1">
            <Label htmlFor="filtro-tabla" className="text-xs">Módulo / Entidad</Label>
            <select
              id="filtro-tabla"
              value={tabla}
              onChange={(e) => {
                setTabla(e.target.value);
                aplicarFiltros({ tabla_afectada: e.target.value });
              }}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">Todas las entidades</option>
              {TABLAS_MODULO_A.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Fecha desde */}
          <div className="space-y-1">
            <Label htmlFor="filtro-fecha-desde" className="text-xs">Desde</Label>
            <Input
              id="filtro-fecha-desde"
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              onBlur={() => aplicarFiltros({ fecha_desde: fechaDesde })}
              className="text-sm h-8"
            />
          </div>

          {/* Fecha hasta */}
          <div className="space-y-1">
            <Label htmlFor="filtro-fecha-hasta" className="text-xs">Hasta</Label>
            <Input
              id="filtro-fecha-hasta"
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              onBlur={() => aplicarFiltros({ fecha_hasta: fechaHasta })}
              className="text-sm h-8"
            />
          </div>

        </div>

        {hayFiltrosActivos && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={limpiarFiltros}
              className="text-xs h-7 text-muted-foreground hover:text-foreground"
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </div>

      {/* ── Toolbar: verificación + contador ───────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Mostrando {registros.length} de {total} evento(s) — página {page} de{" "}
          {Math.ceil(total / page_size) || 1}
        </p>
        <Button
          id="btn-verificar-cadena-inventario"
          variant="outline"
          size="sm"
          onClick={handleVerificarCadena}
          disabled={isPending}
          className="shrink-0 gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Hash className="size-4" />
          )}
          Verificar integridad SHA-256
        </Button>
      </div>

      {/* ── Resultado de verificación (CA 3) ───────────────────────────────── */}
      {resultadoVerificacion && (
        <Alert
          variant={resultadoVerificacion.integra ? "default" : "destructive"}
          className={
            resultadoVerificacion.integra
              ? "border-green-200 bg-green-50 text-green-800"
              : undefined
          }
        >
          {resultadoVerificacion.integra ? (
            <CheckCircle2 className="size-4 text-green-600" />
          ) : (
            <XCircle className="size-4" />
          )}
          <AlertDescription className="text-sm">
            {resultadoVerificacion.integra ? (
              <>
                <strong>Cadena íntegra.</strong> Se verificaron{" "}
                {resultadoVerificacion.registros_verificados} evento(s) sin discrepancias.
              </>
            ) : (
              <>
                <strong>¡Cadena comprometida!</strong> Ruptura detectada después de{" "}
                {resultadoVerificacion.registros_verificados} evento(s).
                {resultadoVerificacion.primer_registro_divergente_id && (
                  <span className="block mt-1 font-mono text-xs">
                    Primer registro divergente:{" "}
                    <span className="font-semibold">
                      {resultadoVerificacion.primer_registro_divergente_id}
                    </span>
                  </span>
                )}
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Tabla (CA 1: solo lectura, CA 4: append-only visible) ─────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Fecha / Hora
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Usuario
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Acción
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Entidad
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Registro ID
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Hash SHA-256
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {registros.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground text-sm"
                  >
                    No hay eventos que coincidan con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                registros.map((registro) => (
                  <tr
                    key={registro.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {registro.created_at.toLocaleString("es-AR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>

                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">
                        {registro.usuario_nombre ?? "Sistema"}
                      </div>
                      <div className="text-muted-foreground font-mono text-[10px] mt-0.5">
                        {registro.ip}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono ${ACCION_COLOR[registro.accion] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
                      >
                        {registro.accion}
                      </Badge>
                    </td>

                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                      {registro.tabla_afectada}
                    </td>

                    <td className="px-4 py-3 text-[10px] font-mono text-muted-foreground truncate max-w-[120px]">
                      {registro.registro_id ?? "—"}
                    </td>

                    <td className="px-4 py-3">
                      <code
                        className="text-[9px] font-mono text-muted-foreground truncate block max-w-[140px]"
                        title={registro.hash_actual}
                      >
                        {registro.hash_actual.slice(0, 16)}…
                      </code>
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
