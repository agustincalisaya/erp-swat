/**
 * @component TablaAuditoriaProveedores
 * @description Tabla de la consola `/auditoria/logs?modulo=proveedores`
 * (HU-H6). Mismo estilo/patrón que `TablaAuditoriaClientes.tsx` (HU-C10):
 * componente puro (Server Component), recibe el resultado ya resuelto por
 * `listarEventosDeDominioProveedores()` + el `Map` de nombres de usuario ya
 * resuelto (`resolverNombresUsuarios`) y el `queryBase` para paginar
 * preservando filtros.
 */
import Link from "next/link";
import type {
  ResultadoListadoAuditoriaProveedores,
  AccionDominioProveedores,
} from "@/lib/services/proveedores/auditoria-proveedores.service";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const ETIQUETA_TIPO_EVENTO: Record<AccionDominioProveedores, string> = {
  "proveedor:estado_cambiado": "Cambio de estado",
  "proveedor:variacion_precio_critica": "Variación de precio crítica",
  "proveedor:lista_precio_aprobada": "Lista de precios aprobada",
  "proveedor:legajo_bancario_consultado": "Legajo bancario consultado",
};

function fechaHora(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(fecha));
}

interface TablaAuditoriaProveedoresProps {
  resultado: ResultadoListadoAuditoriaProveedores;
  nombresPorUsuarioId: Map<string, string>;
  razonesSocialesPorProveedorId: Map<string, string>;
  queryBase: string;
}

export function TablaAuditoriaProveedores({
  resultado,
  nombresPorUsuarioId,
  razonesSocialesPorProveedorId,
  queryBase,
}: TablaAuditoriaProveedoresProps) {
  const { items, paginacion } = resultado;

  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No hay asientos de proveedores para los filtros aplicados.
      </p>
    );
  }

  const hrefPagina = (numero: number) => `/auditoria/logs?${queryBase}&pagina=${numero}`;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha y hora</TableHead>
              <TableHead>Tipo de evento</TableHead>
              <TableHead>Usuario responsable</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Cambios registrados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((evento) => (
              <TableRow key={evento.audit_log_id}>
                <TableCell className="whitespace-nowrap text-xs">{fechaHora(evento.created_at)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {ETIQUETA_TIPO_EVENTO[evento.tipo_evento] ?? evento.tipo_evento}
                </TableCell>
                <TableCell className="text-xs">
                  {evento.usuario_id ? (nombresPorUsuarioId.get(evento.usuario_id) ?? "—") : "sistema"}
                </TableCell>
                <TableCell className="text-xs">
                  {/* Sin link: no existe todavía una página de detalle de
                      proveedor (`/compras/proveedores/[id]`) — solo el
                      listado (`/compras/proveedores`). Se muestra la razón
                      social resuelta en batch (`resolverRazonesSocialesProveedores`),
                      nunca el id crudo. */}
                  {evento.proveedor_id ? (razonesSocialesPorProveedorId.get(evento.proveedor_id) ?? "—") : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {evento.valor_anterior != null || evento.valor_nuevo != null ? (
                    <details>
                      <summary className="cursor-pointer text-blue-600">Ver valores</summary>
                      <pre className="mt-1 max-w-sm overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
                        {JSON.stringify({ anterior: evento.valor_anterior, nuevo: evento.valor_nuevo }, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Página {paginacion.pagina_actual} de {paginacion.total_paginas} — {paginacion.total} asiento
          {paginacion.total === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          {paginacion.pagina_actual > 1 ? (
            <Link className="rounded border px-3 py-1.5" href={hrefPagina(paginacion.pagina_actual - 1)}>
              Anterior
            </Link>
          ) : (
            <span className="rounded border px-3 py-1.5 opacity-50">Anterior</span>
          )}
          {paginacion.pagina_actual < paginacion.total_paginas ? (
            <Link className="rounded border px-3 py-1.5" href={hrefPagina(paginacion.pagina_actual + 1)}>
              Siguiente
            </Link>
          ) : (
            <span className="rounded border px-3 py-1.5 opacity-50">Siguiente</span>
          )}
        </div>
      </div>
    </div>
  );
}
