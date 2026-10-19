import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { diaDeVigencia, rangoMesFechaSolo, rangoMesNegocio } from "@/lib/utils/fecha-negocio";
import type { OpcionesResumenMensual, ResumenMensualDto } from "./reporte-mensual.types";
import type { DetalleMovimientoMensualDto } from "./reporte-mensual.detalle.types";

const CERO = new Prisma.Decimal(0);
const MEDIOS = ["EFECTIVO", "TRANSFERENCIA", "E_CHEQ", "MERCADO_PAGO", "TARJETA"] as const;
const sumar = (valores: readonly Prisma.Decimal[]) => valores.reduce((total, valor) => total.plus(valor), CERO);
const importe = (valor: Prisma.Decimal) => valor.toFixed(2);

export interface ReporteMensualConsultado {
  resumen: ResumenMensualDto;
  detalle: DetalleMovimientoMensualDto[];
}

/** Una consulta por fuente; el gasto individual solo se consulta con desglose autorizado. */
export async function consultarReporteMensual(
  anio: number,
  mes: number,
  opciones: OpcionesResumenMensual,
  cliente: Pick<PrismaClient, "ingresoTesoreria" | "contraAsientoIngreso" | "ventaMedioPago" | "cuentaPorPagar" | "gastoOperativo"> = prisma,
): Promise<ReporteMensualConsultado> {
  let negocio: ReturnType<typeof rangoMesNegocio>;
  let fechaSolo: ReturnType<typeof rangoMesFechaSolo>;
  try {
    negocio = rangoMesNegocio(anio, mes);
    fechaSolo = rangoMesFechaSolo(anio, mes);
  } catch (error) {
    if (error instanceof RangeError) throw new ServiceError("PERIODO_INVALIDO", error.message);
    throw error;
  }
  const instantes = { gte: negocio.desde, lt: negocio.hasta };
  const dias = { gte: fechaSolo.desde, lt: fechaSolo.hasta };
  // Superconjunto de las dos convenciones; la selección definitiva es por día.
  const pagosPosibles = {
    gte: fechaSolo.desde < negocio.desde ? fechaSolo.desde : negocio.desde,
    lt: fechaSolo.hasta > negocio.hasta ? fechaSolo.hasta : negocio.hasta,
  };
  const mesIso = `${anio}-${String(mes).padStart(2, "0")}`;

  const [cobros, reintegros, medios, cuentas] = await Promise.all([
    cliente.ingresoTesoreria.findMany({
      where: { fecha: instantes, estado: { in: ["PENDIENTE_CONCILIACION", "CONCILIADO"] } },
      select: { id: true, monto: true, fecha: true },
    }),
    cliente.contraAsientoIngreso.findMany({ where: { created_at: instantes }, select: { id: true, monto: true, created_at: true } }),
    cliente.ventaMedioPago.findMany({
      where: { is_active: true, pedido_venta: { is_active: true, canal: "MOSTRADOR",
        estado: { in: ["FACTURADO", "REMITO_EMITIDO", "CERRADO"] }, fecha_facturacion: instantes } },
      select: { id: true, importe: true, medio: true,
        pedido_venta: { select: { numero_venta: true, fecha_facturacion: true } } },
    }),
    cliente.cuentaPorPagar.findMany({
      where: { estado: "PAGADA", is_active: true, fecha_pago: pagosPosibles },
      select: { id: true, monto: true, fecha_pago: true,
        orden_compra: { select: { proveedor: { select: { razon_social: true } } } } },
    }),
  ]);
  const pagos = cuentas.filter((fila) => fila.fecha_pago !== null && diaDeVigencia(fila.fecha_pago).slice(0, 7) === mesIso);
  // La consulta de filas de gasto, conceptos y categorías no ocurre sin permiso.
  const gastos = opciones.incluir_desglose_gastos
    ? await cliente.gastoOperativo.findMany({
        where: { is_active: true, fecha: dias },
        select: { id: true, monto: true, fecha: true, descripcion: true, categoria_gasto_id: true,
          categoria: { select: { nombre: true, is_active: true } } },
      })
    : null;
  const gastoTotal = gastos === null
    ? (await cliente.gastoOperativo.aggregate({ where: { is_active: true, fecha: dias }, _sum: { monto: true } }))._sum.monto ?? CERO
    : sumar(gastos.map((fila) => fila.monto));

  const web = sumar(cobros.map((fila) => fila.monto));
  const reintegrosWeb = sumar(reintegros.map((fila) => fila.monto));
  const porMedio = new Map<(typeof MEDIOS)[number], Prisma.Decimal>();
  let cuentaCorriente = CERO;
  for (const fila of medios) {
    if (fila.medio === "CUENTA_CORRIENTE") cuentaCorriente = cuentaCorriente.plus(fila.importe);
    else porMedio.set(fila.medio, (porMedio.get(fila.medio) ?? CERO).plus(fila.importe));
  }
  const mostrador = sumar([...porMedio.values()]);
  const proveedores = sumar(pagos.map((fila) => fila.monto));
  const ingresos = web.minus(reintegrosWeb).plus(mostrador);
  const egresos = proveedores.plus(gastoTotal);
  const categorias = new Map<string, { nombre: string; activa: boolean; total: Prisma.Decimal }>();
  for (const fila of gastos ?? []) {
    const previa = categorias.get(fila.categoria_gasto_id);
    categorias.set(fila.categoria_gasto_id, {
      nombre: fila.categoria.nombre, activa: fila.categoria.is_active,
      total: (previa?.total ?? CERO).plus(fila.monto),
    });
  }
  const resumen: ResumenMensualDto = {
    periodo: { anio, mes, desde: negocio.desde.toISOString(), hasta: negocio.hasta.toISOString() },
    ingresos: {
      web: importe(web), reintegros_web: importe(reintegrosWeb),
      mostrador_por_medio: MEDIOS.filter((medio) => porMedio.has(medio))
        .map((medio) => ({ medio, importe: importe(porMedio.get(medio)!) })),
      mostrador: importe(mostrador), total: importe(ingresos),
    },
    egresos: {
      proveedores: importe(proveedores), gastos_operativos: importe(gastoTotal),
      gastos_por_categoria: gastos === null ? null
        : [...categorias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([categoria_gasto_id, dato]) => ({
            categoria_gasto_id, nombre: dato.nombre, activa: dato.activa, importe: importe(dato.total),
          })),
      total: importe(egresos),
    },
    resultado_neto: importe(ingresos.minus(egresos)),
    porcentaje_egresos_sobre_ingresos: ingresos.lte(CERO) ? null
      : egresos.div(ingresos).mul(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    ventas_cuenta_corriente_informativo: importe(cuentaCorriente),
  };
  // Los signos siguientes son únicamente de presentación. Ningún total se calcula desde el detalle.
  const detalle: DetalleMovimientoMensualDto[] = [
    ...cobros.map((fila) => ({ id: `COBRO_WEB:${fila.id}`, fuente_id: fila.id, tipo: "COBRO_WEB" as const,
      fecha: fila.fecha.toISOString(), concepto: "Cobro web", importe: importe(fila.monto), impacta_resultado: true })),
    ...reintegros.map((fila) => ({ id: `REINTEGRO_WEB:${fila.id}`, fuente_id: fila.id, tipo: "REINTEGRO_WEB" as const,
      fecha: fila.created_at.toISOString(), concepto: "Reintegro web", importe: importe(fila.monto.neg()), impacta_resultado: true })),
    ...medios.map((fila) => ({ id: `VENTA_MOSTRADOR:${fila.id}`, fuente_id: fila.id, tipo: "VENTA_MOSTRADOR" as const,
      fecha: fila.pedido_venta.fecha_facturacion!.toISOString(),
      concepto: `${fila.pedido_venta.numero_venta} · ${fila.medio.replaceAll("_", " ")}`,
      importe: importe(fila.importe), impacta_resultado: fila.medio !== "CUENTA_CORRIENTE" })),
    ...pagos.map((fila) => ({ id: `EGRESO_PROVEEDOR:${fila.id}`, fuente_id: fila.id, tipo: "EGRESO_PROVEEDOR" as const,
      fecha: fila.fecha_pago!.toISOString(), concepto: fila.orden_compra.proveedor.razon_social,
      importe: importe(fila.monto.neg()), impacta_resultado: true })),
    ...(gastos ?? []).map((fila) => ({ id: `GASTO_OPERATIVO:${fila.id}`, fuente_id: fila.id, tipo: "GASTO_OPERATIVO" as const,
      fecha: fila.fecha.toISOString(), concepto: `${fila.categoria.nombre} · ${fila.descripcion}`,
      importe: importe(fila.monto.neg()), impacta_resultado: true })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  return { resumen, detalle };
}
