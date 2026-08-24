"use client";

/**
 * @component TablaForenseInventario
 * @description Client Component que renderiza el historial de auditoría del
 * Módulo A (Inventario) y provee las acciones interactivas:
 *  - Verificación de integridad SHA-256 de la cadena de hashes.
 *  - Filtrado por usuario, SKU, rango de fechas y tipo de movimiento.
 *
 * Recibe los datos pre-renderizados como props desde el RSC `page.tsx`.
 * Las interacciones (verificar cadena, filtrar) se ejecutan vía Server Actions.
 */

import { useState, useTransition, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DatoCifradoViewer } from "@/components/inventario/auditoria/DatoCifradoViewer";
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
  /** Término de búsqueda inicial (sincronizado con searchParams.q del RSC). */
  q: string;
}

const ACCION_COLOR: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800 border-green-200",
  UPDATE: "bg-blue-100 text-blue-800 border-blue-200",
  EGRESO: "bg-orange-100 text-orange-800 border-orange-200",
  INGRESO: "bg-emerald-100 text-emerald-800 border-emerald-200",
  LECTURA_SENSIBLE: "bg-purple-100 text-purple-800 border-purple-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};

export function TablaForenseInventario({
  registros,
  total,
  page,
  page_size,
  q,
}: TablaForenseInventarioProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [resultadoVerificacion, setResultadoVerificacion] =
    useState<ResultadoVerificacionInventario | null>(null);
  const [busquedaLocal, setBusquedaLocal] = useState(q);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVerificarCadena = () => {
    startTransition(async () => {
      setResultadoVerificacion(null);
      const resultado = await verificarIntegridadAction();
      if (resultado.success && resultado.data) {
        setResultadoVerificacion(resultado.data);
      }
    });
  };

  // Búsqueda server-side: actualiza la URL con ?q=... y deja que el RSC
  // recargue la página filtrando desde Prisma. Debounced 350ms para evitar
  // un request por keystroke.
  const handleBusqueda = useCallback(
    (valor: string) => {
      setBusquedaLocal(valor);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (valor.trim()) {
          params.set("q", valor.trim());
        } else {
          params.delete("q");
        }
        // Resetear a página 1 al buscar
        params.delete("page");
        router.push(`?${params.toString()}`);
      }, 350);
    },
    [router, searchParams],
  );

  // Los registros ya llegan filtrados desde el servidor
  const registrosFiltrados = registros;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            id="busqueda-auditoria-inventario"
            placeholder="Filtrar por acción, tabla, registro..."
            value={busquedaLocal}
            onChange={(e) => handleBusqueda(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>
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

      {/* Resultado de verificación */}
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
                {resultadoVerificacion.registros_verificados} evento(s) de
                inventario sin discrepancias.
              </>
            ) : (
              <>
                <strong>¡Cadena comprometida!</strong> Ruptura detectada después
                de {resultadoVerificacion.registros_verificados} evento(s).
                {resultadoVerificacion.primer_registro_divergente_id && (
                  <span className="block mt-1 font-mono text-xs">
                    Primer registro divergente:{" "}
                    {resultadoVerificacion.primer_registro_divergente_id}
                  </span>
                )}
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Contador */}
      <p className="text-xs text-muted-foreground">
        Mostrando {registrosFiltrados.length} de {total} evento(s) — página{" "}
        {page} de {Math.ceil(total / page_size) || 1}
      </p>

      {/* Tabla */}
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
                  Tabla
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Registro ID
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Datos sensibles
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Hash SHA-256
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {registrosFiltrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground text-sm"
                  >
                    No hay eventos de auditoría que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                registrosFiltrados.map((registro) => (
                  <tr
                    key={registro.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    {/* Fecha */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {registro.created_at.toLocaleString("es-AR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>

                    {/* Usuario */}
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">
                        {registro.usuario_nombre ?? "Sistema"}
                      </div>
                      <div className="text-muted-foreground font-mono text-[10px] mt-0.5">
                        {registro.ip}
                      </div>
                    </td>

                    {/* Acción */}
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono ${ACCION_COLOR[registro.accion] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
                      >
                        {registro.accion}
                      </Badge>
                    </td>

                    {/* Tabla */}
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                      {registro.tabla_afectada}
                    </td>

                    {/* Registro ID */}
                    <td className="px-4 py-3 text-[10px] font-mono text-muted-foreground truncate max-w-[120px]">
                      {registro.registro_id ?? "—"}
                    </td>

                    {/* Datos sensibles (solo para legajos_prueba) */}
                    <td className="px-4 py-3">
                      {registro.tabla_afectada === "legajos_prueba" &&
                      registro.registro_id &&
                      registro.accion === "CREATE" ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="w-14 shrink-0">Placa:</span>
                            <DatoCifradoViewer
                              legajoPruebaId={registro.registro_id}
                              campo="efectivo_placa"
                              label="placa"
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="w-14 shrink-0">Organismo:</span>
                            <DatoCifradoViewer
                              legajoPruebaId={registro.registro_id}
                              campo="efectivo_organismo"
                              label="organismo"
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>

                    {/* Hash SHA-256 */}
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
