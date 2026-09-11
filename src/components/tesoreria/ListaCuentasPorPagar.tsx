"use client";

/**
 * @component ListaCuentasPorPagar
 * @description HU-G10 — grilla de Cuentas por Pagar en estado `DEFINITIVA`
 * (spec_modulo_G.md §2.5). Cada fila ofrece la acción "Registrar pago", que
 * abre `FormularioRegistroPago` para esa cuenta. Solo presentación: el
 * listado ya llega resuelto y filtrado por el RSC padre.
 *
 * Hydration: no se generan `id`/`htmlFor` acá. Los `key` de fila usan el
 * `id` estable de la cuenta (nunca `crypto.randomUUID()` en un atributo
 * renderizado). La convención `useId()` + índice para atributos vive en
 * `FormularioRegistroPago`.
 */

import type { CuentaPorPagarResumen } from "@/lib/services/tesoreria/cuenta-por-pagar.service";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormularioRegistroPago } from "@/components/tesoreria/FormularioRegistroPago";

interface ListaCuentasPorPagarProps {
  cuentas: CuentaPorPagarResumen[];
  puedePagar: boolean;
}

const monedaAR = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

function formatearMonto(monto: string): string {
  const n = Number(monto);
  return Number.isFinite(n) ? monedaAR.format(n) : `$ ${monto}`;
}

function formatearFecha(fecha: Date | string): string {
  return new Date(fecha).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function nombreProveedor(p: CuentaPorPagarResumen["orden_compra"]["proveedor"]): string {
  return p.nombre_fantasia
    ? `${p.razon_social} (${p.nombre_fantasia})`
    : p.razon_social;
}

export function ListaCuentasPorPagar({
  cuentas,
  puedePagar,
}: ListaCuentasPorPagarProps) {
  if (cuentas.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No hay cuentas por pagar en estado DEFINITIVA.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Orden de compra</TableHead>
          <TableHead>Proveedor</TableHead>
          <TableHead className="text-right">Monto</TableHead>
          <TableHead>Emisión</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cuentas.map((cuenta) => (
          <TableRow key={cuenta.id}>
            <TableCell className="font-medium">
              {cuenta.orden_compra.numero_orden}
            </TableCell>
            <TableCell>{nombreProveedor(cuenta.orden_compra.proveedor)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatearMonto(cuenta.monto)}
            </TableCell>
            <TableCell>{formatearFecha(cuenta.orden_compra.fecha_emision)}</TableCell>
            <TableCell className="text-right">
              {puedePagar ? (
                <FormularioRegistroPago
                  cuentaPorPagarId={cuenta.id}
                  numeroOrden={cuenta.orden_compra.numero_orden}
                />
              ) : (
                <span className="text-xs text-muted-foreground">Sin permiso</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
