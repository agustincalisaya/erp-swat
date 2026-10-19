/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures Prisma dinámicas de cinco fuentes. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";
import * as fechas from "../../utils/fecha-negocio.ts";

const requireReal = createRequire(import.meta.url);
const { Prisma } = requireReal("@prisma/client") as typeof import("@prisma/client");
const D = (valor: string) => new Prisma.Decimal(valor);
const F = (valor: string) => new Date(valor);
type Fila = Record<string, any>;
type Base = {
  cobros: Fila[]; reintegros: Fila[]; medios: Fila[]; cuentas: Fila[]; gastos: Fila[];
};
const vacia = (): Base => ({ cobros: [], reintegros: [], medios: [], cuentas: [], gastos: [] });
const enRango = (fecha: Date, rango: { gte: Date; lt: Date }) => fecha >= rango.gte && fecha < rango.lt;

function cliente(base: Base) {
  let consultasGastos = 0;
  const db = {
    ingresoTesoreria: { findMany: async ({ where }: any) => base.cobros.filter((f) =>
      enRango(f.fecha, where.fecha) && where.estado.in.includes(f.estado)) },
    contraAsientoIngreso: { findMany: async ({ where }: any) => base.reintegros.filter((f) => enRango(f.created_at, where.created_at)) },
    ventaMedioPago: { findMany: async ({ where }: any) => base.medios.filter((f) =>
      f.is_active && f.pedido_venta.is_active && f.pedido_venta.canal === where.pedido_venta.canal &&
      where.pedido_venta.estado.in.includes(f.pedido_venta.estado) &&
      f.pedido_venta.fecha_facturacion && enRango(f.pedido_venta.fecha_facturacion, where.pedido_venta.fecha_facturacion)) },
    cuentaPorPagar: { findMany: async ({ where }: any) => base.cuentas.filter((f) =>
      f.estado === where.estado && f.is_active && f.fecha_pago && enRango(f.fecha_pago, where.fecha_pago)) },
    gastoOperativo: {
      findMany: async ({ where }: any) => {
        consultasGastos++;
        return base.gastos.filter((f) => f.is_active && enRango(f.fecha, where.fecha));
      },
      aggregate: async ({ where }: any) => ({
        _sum: { monto: base.gastos.filter((f) => f.is_active && enRango(f.fecha, where.fecha))
          .reduce((s, f) => s.plus(f.monto), D("0")) },
      }),
    },
  };
  return { db, consultasGastos: () => consultasGastos };
}

function cargarCalculo() {
  const ruta = "./reporte-mensual.calculo.service.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: {
    module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
  } }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@prisma/client": { Prisma },
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/utils/fecha-negocio": fechas,
  };
  runInThisContext(`(function(require, module, exports) {\n${codigo}\n})`, { filename: ruta })(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) throw new Error(`Dependencia inesperada: ${nombre}`);
      return dependencias[nombre];
    }, modulo, modulo.exports,
  );
  return modulo.exports.consultarReporteMensual as (
    anio: number, mes: number, opciones: { incluir_desglose_gastos: boolean }, db: unknown,
  ) => Promise<{ resumen: any; detalle: any[] }>;
}
const consultar = cargarCalculo();
const sin = { incluir_desglose_gastos: false };
const con = { incluir_desglose_gastos: true };

function medio(id: string, importe: string, estado = "FACTURADO", canal = "MOSTRADOR", activo = true) {
  return { id, importe: D(importe), medio: id === "cc" ? "CUENTA_CORRIENTE" : "EFECTIVO", is_active: activo,
    pedido_venta: { numero_venta: `V-${id}`, is_active: true, canal, estado,
      fecha_facturacion: F("2026-10-15T15:00:00Z") } };
}
function cuenta(id: string, fecha: string, estado = "PAGADA", activo = true) {
  return { id, monto: D("5.25"), estado, is_active: activo, fecha_pago: F(fecha),
    orden_compra: { is_active: false, proveedor: { id: "proveedor-1", razon_social: "Proveedor inactivo", is_active: false } } };
}
function gasto(id: string, monto: string, activo: boolean, categoriaActiva: boolean) {
  return { id, monto: D(monto), is_active: activo, fecha: F("2026-10-12T00:00:00Z"),
    descripcion: "Servicio", categoria_gasto_id: "cat", categoria: { nombre: "Servicios", is_active: categoriaActiva } };
}

test("G14: período inválido y mes vacío conservan contrato completo", async () => {
  const { db } = cliente(vacia());
  await assert.rejects(consultar(2026, 13, sin, db), (e: unknown) => e instanceof ServiceError && e.code === "PERIODO_INVALIDO");
  const { resumen, detalle } = await consultar(2026, 10, sin, db);
  assert.deepEqual(detalle, []);
  assert.deepEqual(resumen.ingresos, { web: "0.00", reintegros_web: "0.00", mostrador_por_medio: [], mostrador: "0.00", total: "0.00" });
  assert.deepEqual(resumen.egresos, { proveedores: "0.00", gastos_operativos: "0.00", gastos_por_categoria: null, total: "0.00" });
  assert.equal(resumen.resultado_neto, "0.00");
  assert.equal(resumen.porcentaje_egresos_sobre_ingresos, null);
  assert.equal(resumen.periodo.desde, "2026-10-01T03:00:00.000Z");
});

test("G14: cinco fuentes, filtro mostrador, fechas mixtas, histórico y precisión", async () => {
  const base = vacia();
  base.cobros.push(
    { id: "w1", monto: D("100.10"), fecha: F("2026-10-01T03:00:00Z"), estado: "PENDIENTE_CONCILIACION" },
    { id: "w2", monto: D("0.20"), fecha: F("2026-11-01T02:59:59Z"), estado: "CONCILIADO" },
    { id: "w3", monto: D("999"), fecha: F("2026-11-01T03:00:00Z"), estado: "CONCILIADO" },
  );
  base.reintegros.push({ id: "r1", monto: D("15.05"), created_at: F("2026-10-10T12:00:00Z") });
  base.medios.push(medio("f", "30.10"), medio("r", "20.00", "REMITO_EMITIDO"),
    medio("c", "10.00", "CERRADO"), medio("cc", "40.00"), medio("reservado", "90.00", "RESERVADO"),
    medio("web", "70.00", "FACTURADO", "WEB"), medio("inactivo", "60.00", "FACTURADO", "MOSTRADOR", false));
  base.cuentas.push(
    cuenta("solo1", "2026-10-01T00:00:00Z"),
    cuenta("soloUltimo", "2026-10-31T00:00:00Z"),
    cuenta("real1", "2026-10-01T03:30:00Z"),
    cuenta("realUltimo", "2026-11-01T02:59:00Z"),
    cuenta("realPrevio", "2026-10-01T01:00:00Z"),
    cuenta("soloSiguiente", "2026-11-01T00:00:00Z"),
    cuenta("definitiva", "2026-10-12T00:00:00Z", "DEFINITIVA"),
    cuenta("provisoria", "2026-10-12T00:00:00Z", "PROVISORIO"),
    cuenta("cancelada", "2026-10-12T00:00:00Z", "CANCELADA"),
    cuenta("baja", "2026-10-12T00:00:00Z", "PAGADA", false),
  );
  base.gastos.push(gasto("g1", "10.00", true, false), gasto("g2", "0.05", true, false), gasto("g3", "7", false, true));
  const { db, consultasGastos } = cliente(base);
  const visible = await consultar(2026, 10, con, db);
  assert.equal(visible.resumen.ingresos.web, "100.30");
  assert.equal(visible.resumen.ingresos.reintegros_web, "15.05");
  assert.equal(visible.resumen.ingresos.mostrador, "60.10");
  assert.equal(visible.resumen.ingresos.total, "145.35");
  assert.equal(visible.resumen.ventas_cuenta_corriente_informativo, "40.00");
  assert.equal(visible.resumen.egresos.proveedores, "21.00");
  const g15 = await import("./reporte-mensual-extensiones.calculo.ts");
  const pagosG15 = base.cuentas.filter((fila) =>
    fila.estado === "PAGADA" && fila.is_active && g15.fechaPagoEnMes(fila.fecha_pago, 2026, 10));
  const agrupadosG15 = g15.agruparPagosPorProveedor(pagosG15.map((fila) => ({
    proveedor_id: fila.orden_compra.proveedor.id,
    razon_social: fila.orden_compra.proveedor.razon_social,
    monto: fila.monto.toFixed(2),
  })));
  assert.equal(agrupadosG15[0]?.total_pagado, visible.resumen.egresos.proveedores);
  assert.equal(visible.resumen.egresos.gastos_operativos, "10.05");
  assert.equal(visible.resumen.egresos.total, "31.05");
  assert.equal(visible.resumen.resultado_neto, "114.30");
  assert.equal(visible.resumen.porcentaje_egresos_sobre_ingresos, 21.4);
  assert.deepEqual(visible.resumen.egresos.gastos_por_categoria,
    [{ categoria_gasto_id: "cat", nombre: "Servicios", activa: false, importe: "10.05" }]);
  assert.equal(visible.detalle.filter((f) => f.tipo === "EGRESO_PROVEEDOR").length, 4);
  assert.equal(visible.detalle.filter((f) => f.tipo === "GASTO_OPERATIVO").length, 2);
  assert.equal(visible.detalle.find((f) => f.fuente_id === "cc")?.impacta_resultado, false);
  assert.equal(visible.detalle.find((f) => f.fuente_id === "r1")?.importe, "-15.05");
  assert.equal(visible.detalle.length, 13);
  assert.equal(consultasGastos(), 1);
  const restringido = await consultar(2026, 10, sin, db);
  assert.equal(restringido.resumen.egresos.gastos_operativos, "10.05");
  assert.equal(restringido.resumen.egresos.gastos_por_categoria, null);
  assert.equal(restringido.detalle.some((f) => f.tipo === "GASTO_OPERATIVO"), false);
  assert.equal(consultasGastos(), 1);
});

test("G14: ingresos cero o negativos dan porcentaje null; HALF_UP a un decimal", async () => {
  const cero = vacia();
  cero.cuentas.push({ ...cuenta("p", "2026-10-15T00:00:00Z"), monto: D("169.90") });
  assert.equal((await consultar(2026, 10, sin, cliente(cero).db)).resumen.porcentaje_egresos_sobre_ingresos, null);
  cero.reintegros.push({ id: "r", monto: D("1.00"), created_at: F("2026-10-15T12:00:00Z") });
  assert.equal((await consultar(2026, 10, sin, cliente(cero).db)).resumen.porcentaje_egresos_sobre_ingresos, null);
  cero.reintegros = [];
  cero.cobros.push({ id: "w", monto: D("200.00"), fecha: F("2026-10-15T12:00:00Z"), estado: "CONCILIADO" });
  const { resumen } = await consultar(2026, 10, sin, cliente(cero).db);
  assert.equal(resumen.porcentaje_egresos_sobre_ingresos, 85);
  assert.match(resumen.resultado_neto, /^-?\d+\.\d{2}$/);
});

test("G14: el reintegro se atribuye a su propio mes y un egreso mayor produce resultado negativo", async () => {
  const base = vacia();
  base.cobros.push({ id: "web-septiembre", monto: D("500.00"),
    fecha: F("2026-09-30T12:00:00Z"), estado: "CONCILIADO" });
  base.reintegros.push({ id: "reintegro-octubre", monto: D("20.10"),
    created_at: F("2026-10-01T03:00:00Z"), ingreso_tesoreria_id: "web-septiembre" });
  base.cuentas.push({ ...cuenta("pago", "2026-10-15T00:00:00Z"), monto: D("2.25") });
  const { resumen, detalle } = await consultar(2026, 10, sin, cliente(base).db);
  assert.equal(resumen.ingresos.web, "0.00");
  assert.equal(resumen.ingresos.reintegros_web, "20.10");
  assert.equal(resumen.ingresos.total, "-20.10");
  assert.equal(resumen.egresos.total, "2.25");
  assert.equal(resumen.resultado_neto, "-22.35");
  assert.equal(resumen.porcentaje_egresos_sobre_ingresos, null);
  assert.deepEqual(detalle.map((fila) => fila.tipo), ["REINTEGRO_WEB", "EGRESO_PROVEEDOR"]);
});

test("G14: un fallo de G15 conserva el reporte principal", async () => {
  const ruta = "./reporte-mensual.pantalla.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: {
    module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
  } }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  runInThisContext(`(function(require, module, exports) {\n${codigo}\n})`, { filename: ruta })(
    (nombre: string) => {
      if (nombre === "server-only") return {};
      if (nombre === "./reporte-mensual.calculo.service") return { consultarReporteMensual: consultar };
      if (nombre === "./reporte-mensual-extensiones.service") return { obtenerBloquesAdicionales: () => [] };
      throw new Error(`Dependencia inesperada: ${nombre}`);
    }, modulo, modulo.exports,
  );
  const cargar = modulo.exports.cargarReporteMensual as (
    anio: number, mes: number, opciones: typeof sin, deps: Record<string, unknown>,
  ) => Promise<{ resumen: { resultado_neto: string }; bloques: unknown[]; adicionalesDisponibles: boolean }>;
  const principal = { resumen: { resultado_neto: "42.00" }, detalle: [] };
  const resultado = await cargar(2026, 10, sin, {
    consultar: async () => principal,
    bloques: async () => { throw new Error("G15 no disponible"); },
  });
  assert.equal(resultado.resumen.resultado_neto, "42.00");
  assert.deepEqual(resultado.bloques, []);
  assert.equal(resultado.adicionalesDisponibles, false);
});
