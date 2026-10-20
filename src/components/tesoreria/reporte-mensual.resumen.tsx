"use client";

import { useState } from "react";
import type { ResumenMensualDto } from "@/lib/services/tesoreria/reporte-mensual.types";
import type { DetalleMovimientoMensualDto } from "@/lib/services/tesoreria/reporte-mensual.detalle.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { diaDeVigencia, formatearFechaNegocio } from "@/lib/utils/fecha-negocio";

function dinero(valor: string) {
  const signo = valor.startsWith("-") ? "−" : "";
  const [entero, centavos = "00"] = (signo ? valor.slice(1) : valor).split(".");
  return `${signo}$ ${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

function absoluto(importe: string) { return importe.startsWith("-") ? importe.slice(1) : importe; }

function porcentaje(importe: string, total: string) {
  const base = Number(total);
  return base > 0 ? `${(Number(importe) / base * 100).toFixed(1).replace(".", ",")} %` : "—";
}

function Barra({ etiqueta, importe, total, color, onClick }: {
  etiqueta: string; importe: string; total: string; color: string; onClick?: () => void;
}) {
  const ancho = Number(total) > 0 ? Math.min(100, Math.max(0, Number(importe) / Number(total) * 100)) : 0;
  const contenido = <>
    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <span className="tabular-nums">{dinero(importe)} <span className="text-muted-foreground">· {porcentaje(importe, total)}</span></span>
    </span>
    <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${ancho}%` }} />
    </span>
  </>;
  return onClick
    ? <button type="button" onClick={onClick} className="block w-full space-y-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{contenido}</button>
    : <div className="space-y-2 px-2 py-1.5">{contenido}</div>;
}

function Tarjeta({ titulo, total, children }: { titulo: string; total: string; children: React.ReactNode }) {
  return <Card className="min-w-0 gap-3">
    <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
      <CardTitle className="text-base">{titulo}</CardTitle>
      <span className="text-sm tabular-nums text-muted-foreground">{dinero(total)}</span>
    </CardHeader>
    <CardContent className="space-y-3">{children}</CardContent>
  </Card>;
}

const MEDIOS: Record<string, string> = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", E_CHEQ: "E-cheq",
  MERCADO_PAGO: "Mercado Pago", TARJETA: "Tarjeta",
};

export function ResumenVisualMensual({ resumen, detalle, mes }: {
  resumen: ResumenMensualDto; detalle: DetalleMovimientoMensualDto[]; mes: string;
}) {
  const [seleccion, setSeleccion] = useState<{ titulo: string; filas: DetalleMovimientoMensualDto[]; total: string } | null>(null);
  const abrir = (titulo: string, filas: DetalleMovimientoMensualDto[], total: string) => setSeleccion({ titulo, filas, total });
  const cobrosWeb = detalle.filter((fila) => fila.tipo === "COBRO_WEB");
  const cobrosMostrador = detalle.filter((fila) => fila.tipo === "VENTA_MOSTRADOR" && fila.impacta_resultado);
  const hayReintegros = resumen.ingresos.reintegros_web !== "0.00";
  const medios = resumen.ingresos.mostrador_por_medio;


  return <>
    <div className="grid gap-4 lg:grid-cols-2">
      <Tarjeta titulo="Ingresos por canal" total={resumen.ingresos.total}>
        <Barra etiqueta="Web" importe={resumen.ingresos.web} total={resumen.ingresos.total} color="bg-[var(--report-income)]" onClick={() => abrir("Web", cobrosWeb, resumen.ingresos.web)} />
        <Barra etiqueta="Mostrador" importe={resumen.ingresos.mostrador} total={resumen.ingresos.total} color="bg-[#748a70]" onClick={() => abrir("Mostrador", cobrosMostrador, resumen.ingresos.mostrador)} />
        {hayReintegros && <p className="flex justify-between gap-3 border-t pt-3 text-sm text-muted-foreground"><span>Reintegros web (restan del total)</span><span className="tabular-nums">− {dinero(resumen.ingresos.reintegros_web)}</span></p>}
      </Tarjeta>
      <Tarjeta titulo="Ingresos por medio de pago" total={resumen.ingresos.total}>
        <Barra etiqueta="Web" importe={resumen.ingresos.web} total={resumen.ingresos.total} color="bg-[var(--report-income)]" onClick={() => abrir("Web", cobrosWeb, resumen.ingresos.web)} />
        {medios.map((fila) => <Barra key={fila.medio} etiqueta={`${MEDIOS[fila.medio] ?? fila.medio.replaceAll("_", " ")} (mostrador)`} importe={fila.importe} total={resumen.ingresos.total} color="bg-[#748a70]" onClick={() => abrir(`${MEDIOS[fila.medio] ?? fila.medio.replaceAll("_", " ")} (mostrador)`, cobrosMostrador.filter((movimiento) => movimiento.medio_pago === fila.medio), fila.importe)} />)}
        {medios.length === 0 && <p className="text-sm text-muted-foreground">Sin cobros de mostrador.</p>}
        {hayReintegros && <p className="text-xs text-muted-foreground">Los reintegros web se restan del total de ingresos.</p>}
      </Tarjeta>
    </div>

    <ModalMovimientos seleccion={seleccion} mes={mes} cerrar={() => setSeleccion(null)} />
  </>;
}

export function CategoriasVisualMensual({ resumen, detalle, mes }: { resumen: ResumenMensualDto; detalle: DetalleMovimientoMensualDto[]; mes: string }) {
  const [seleccion, setSeleccion] = useState<{ titulo: string; filas: DetalleMovimientoMensualDto[]; total: string } | null>(null);
  const categorias = resumen.egresos.gastos_por_categoria;
  if (categorias === null) return <Tarjeta titulo="Gastos operativos" total={resumen.egresos.gastos_operativos}>
    <p className="text-sm text-muted-foreground">Total del período.</p>
  </Tarjeta>;
  return <><Tarjeta titulo="Egresos por categoría de gasto" total={resumen.egresos.gastos_operativos}>
    {categorias.length === 0 ? <p className="text-sm text-muted-foreground">Sin gastos operativos.</p> : categorias.map((fila) =>
      <Barra key={fila.categoria_gasto_id} etiqueta={`${fila.nombre}${fila.activa ? "" : " (inactiva)"}`} importe={fila.importe} total={resumen.egresos.gastos_operativos} color="bg-[var(--report-expense)]" onClick={() => setSeleccion({ titulo: fila.nombre, filas: detalle.filter((movimiento) => movimiento.tipo === "GASTO_OPERATIVO" && movimiento.categoria_gasto_id === fila.categoria_gasto_id), total: fila.importe })} />)}
  </Tarjeta><ModalMovimientos seleccion={seleccion} mes={mes} cerrar={() => setSeleccion(null)} /></>;
}


function fechaMovimiento(fila: DetalleMovimientoMensualDto) {
  const dia = fila.tipo === "GASTO_OPERATIVO" ? fila.fecha.slice(0, 10)
    : fila.tipo === "EGRESO_PROVEEDOR" ? diaDeVigencia(new Date(fila.fecha)) : null;
  if (!dia) return formatearFechaNegocio(fila.fecha);
  const [anio, mes, fecha] = dia.split("-");
  return `${fecha}/${mes}/${anio}`;
}

function ModalMovimientos({ seleccion, mes, cerrar }: {
  seleccion: { titulo: string; filas: DetalleMovimientoMensualDto[]; total: string } | null;
  mes: string; cerrar: () => void;
}) {
  if (!seleccion) return null;
  const nombreMes = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" })
    .format(new Date(`${mes}-01T12:00:00.000Z`));
  return <Dialog open={seleccion !== null} onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{seleccion?.titulo} · {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} {mes.slice(0, 4)}</DialogTitle>
        <DialogDescription>Movimientos que componen este importe.</DialogDescription>
      </DialogHeader>
      <div className="max-h-[55vh] overflow-auto">
        <Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Concepto</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
          <TableBody>{seleccion?.filas.map((fila) => <TableRow key={fila.id}>
            <TableCell className="whitespace-nowrap">{fechaMovimiento(fila)}</TableCell>
            <TableCell>{fila.concepto}</TableCell>
            <TableCell className="text-right tabular-nums">{dinero(absoluto(fila.importe))}</TableCell>
          </TableRow>)}</TableBody></Table>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <strong className="tabular-nums">Total: {dinero(seleccion?.total ?? "0.00")}</strong>
        <DialogClose render={<Button variant="outline" />}>Cerrar</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function ProveedoresVisualMensual({ detalle, total, mes }: { detalle: DetalleMovimientoMensualDto[]; total: string; mes: string }) {
  const [seleccion, setSeleccion] = useState<{ titulo: string; filas: DetalleMovimientoMensualDto[]; total: string } | null>(null);
  const grupos = new Map<string, { nombre: string; filas: DetalleMovimientoMensualDto[]; centavos: bigint }>();
  for (const fila of detalle) {
    if (fila.tipo !== "EGRESO_PROVEEDOR" || !fila.proveedor_id) continue;
    const grupo = grupos.get(fila.proveedor_id) ?? { nombre: fila.concepto, filas: [], centavos: BigInt(0) };
    grupo.filas.push(fila);
    grupo.centavos += BigInt(absoluto(fila.importe).replace(".", ""));
    grupos.set(fila.proveedor_id, grupo);
  }
  const filas = [...grupos.entries()].sort(([idA, a], [idB, b]) =>
    a.centavos === b.centavos ? a.nombre.localeCompare(b.nombre, "es") || idA.localeCompare(idB)
      : a.centavos > b.centavos ? -1 : 1);
  const importe = (centavos: bigint) => `${centavos / BigInt(100)}.${String(centavos % BigInt(100)).padStart(2, "0")}`;
  return <><Tarjeta titulo="Egresos por proveedor" total={total}>
    {filas.length === 0 ? <p className="text-sm text-muted-foreground">Sin pagos a proveedores.</p>
      : filas.map(([id, grupo]) => <div key={id}>
        <Barra etiqueta={grupo.nombre} importe={importe(grupo.centavos)} total={total} color="bg-[var(--report-expense)]"
          onClick={() => setSeleccion({ titulo: grupo.nombre, filas: grupo.filas, total: importe(grupo.centavos) })} />
        <p className="px-2 text-xs text-muted-foreground">{grupo.filas.length} {grupo.filas.length === 1 ? "pago" : "pagos"}</p>
      </div>)}
  </Tarjeta><ModalMovimientos seleccion={seleccion} mes={mes} cerrar={() => setSeleccion(null)} /></>;
}
