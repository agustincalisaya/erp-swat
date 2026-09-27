"use client";

/**
 * @component HistorialVersionesListaPrecio
 * @description Historial de versiones de la lista de precios de un proveedor
 * (HU-H2/H6, UI "Lista de Precios"). Recibe los datos ya resueltos por
 * `listarVersionesListaPrecio()` (RSC padre) — Client Component solo porque
 * necesita interactividad (`router.refresh()` tras aprobar una versión
 * pendiente), mismo patrón que `TablaOrdenesCompra` frente a su RSC.
 *
 * "Aprobar" solo se muestra para versiones `PENDIENTE_APROBACION` y usuarios
 * con `proveedores:publicar_lista_critica` (flag ya resuelto en el RSC
 * padre) — el endpoint (`aprobarListaPrecioVersionAction`) revalida el gate
 * igual.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { aprobarListaPrecioVersionAction } from "@/app/(dashboard)/compras/listas-precios/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EstadoListaPrecioVersionBadge } from "@/components/compras/EstadoListaPrecioVersionBadge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { ListaPrecioVersionResumen } from "@/lib/services/proveedores/lista-precios.service";

interface HistorialVersionesListaPrecioProps {
  proveedorId: string;
  versiones: ListaPrecioVersionResumen[];
  puedeAprobarCritica: boolean;
}

/**
 * `fecha_inicio_vigencia` es un valor DATE-ONLY (sin componente horario
 * significativo, persistido a medianoche UTC) — formatearlo con la zona
 * horaria local (UTC-3) le resta un día en la UI (ej. `2026-10-01T00:00Z`
 * se mostraba como "30 sept"). Se fuerza `timeZone: "UTC"` para leerlo tal
 * cual se guardó, sin corrimiento. No aplica a timestamps reales (instantes,
 * ej. `created_at`), que sí deben mostrarse en hora local.
 */
function fecha(valor: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(valor),
  );
}

export function HistorialVersionesListaPrecio({
  proveedorId,
  versiones,
  puedeAprobarCritica,
}: HistorialVersionesListaPrecioProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [versionEnCurso, setVersionEnCurso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aprobar = (versionId: string) => {
    setError(null);
    setVersionEnCurso(versionId);
    startTransition(async () => {
      const resultado = await aprobarListaPrecioVersionAction(proveedorId, versionId);
      setVersionEnCurso(null);
      if (resultado.error) {
        setError(resultado.error.message);
        return;
      }
      router.refresh();
    });
  };

  if (versiones.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Este proveedor todavía no tiene ninguna versión de lista de precios.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha de vigencia</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Variación máx.</TableHead>
              <TableHead>Ítems</TableHead>
              <TableHead>Publicada por</TableHead>
              <TableHead>Aprobada por</TableHead>
              {puedeAprobarCritica && <TableHead>Acción</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {versiones.map((version) => (
              <TableRow key={version.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {fecha(version.fecha_inicio_vigencia)}
                </TableCell>
                <TableCell>
                  <EstadoListaPrecioVersionBadge estado={version.estado} />
                </TableCell>
                <TableCell className="text-xs">
                  {version.variacion_porcentual_maxima.toFixed(2)}%
                </TableCell>
                <TableCell className="text-xs">{version.cantidad_items}</TableCell>
                <TableCell className="text-xs">{version.publicada_por_nombre ?? "—"}</TableCell>
                <TableCell className="text-xs">{version.aprobada_por_nombre ?? "—"}</TableCell>
                {puedeAprobarCritica && (
                  <TableCell>
                    {version.estado === "PENDIENTE_APROBACION" ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => aprobar(version.id)}
                        disabled={isPending}
                        className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {isPending && versionEnCurso === version.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        Aprobar
                      </Button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
