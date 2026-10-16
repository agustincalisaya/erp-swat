/**
 * HU-G15 — funciones puras de los bloques adicionales del reporte mensual
 * (`reporte-mensual-extensiones.calculo.ts`). Runner nativo de Node:
 * `node --experimental-strip-types --test <este archivo>`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  agruparPagosPorProveedor,
  armarBloqueComparacion,
  armarBloqueEgresosPorProveedor,
  calcularVariacion,
  centavosAImporte,
  etiquetaMes,
  fechaPagoEnMes,
  formatearImporte,
  formatearPorcentaje,
  importeACentavos,
  mesAnterior,
  type PagoProveedor,
  type TotalesMes,
} from "./reporte-mensual-extensiones.calculo.ts";

// ── Variación ─────────────────────────────────────────────────────────────────

test("variación con mes anterior positivo: suba y baja", () => {
  assert.deepEqual(calcularVariacion("1100.00", "1000.00"), { importe: "100.00", porcentaje: "10.0" });
  assert.deepEqual(calcularVariacion("900.00", "1000.00"), { importe: "-100.00", porcentaje: "-10.0" });
});

test("variación con mes anterior negativo: el porcentaje se calcula sobre el valor absoluto", () => {
  assert.deepEqual(calcularVariacion("50.00", "-100.00"), { importe: "150.00", porcentaje: "150.0" });
  assert.deepEqual(calcularVariacion("-150.00", "-100.00"), { importe: "-50.00", porcentaje: "-50.0" });
});

test("variación con mes anterior cero: porcentaje null y el importe igual", () => {
  assert.deepEqual(calcularVariacion("250.75", "0.00"), { importe: "250.75", porcentaje: null });
  assert.deepEqual(calcularVariacion("-250.75", "0.00"), { importe: "-250.75", porcentaje: null });
});

test("variación con ambos meses en cero", () => {
  assert.deepEqual(calcularVariacion("0.00", "0.00"), { importe: "0.00", porcentaje: null });
});

test("redondeo half-up: el empate se aleja de cero, positivo y negativo", () => {
  // 1225 / 10000 = 12,25 %
  assert.equal(calcularVariacion("11225.00", "10000.00").porcentaje, "12.3");
  assert.equal(calcularVariacion("8775.00", "10000.00").porcentaje, "-12.3");
  // 0,05 % → 0,1 % (empate en la primera décima)
  assert.equal(calcularVariacion("1000.50", "1000.00").porcentaje, "0.1");
  assert.equal(calcularVariacion("999.50", "1000.00").porcentaje, "-0.1");
  // Justo debajo del empate: 12,24999 % → 12,2 %
  assert.equal(calcularVariacion("112249.99", "100000.00").porcentaje, "12.2");
  assert.equal(calcularVariacion("87750.01", "100000.00").porcentaje, "-12.2");
});

test("un porcentaje que redondea a 0,0 no lleva signo, tampoco si la variación es negativa", () => {
  const suba = calcularVariacion("100000.04", "100000.00");
  const baja = calcularVariacion("99999.96", "100000.00");
  assert.deepEqual(suba, { importe: "0.04", porcentaje: "0.0" });
  assert.deepEqual(baja, { importe: "-0.04", porcentaje: "0.0" });
  assert.equal(formatearPorcentaje(baja.porcentaje), "0,0 %");
  assert.equal(formatearImporte(baja.importe, true), "-0,04");
});

test("variación sin cambio: cero sin signo en importe y porcentaje", () => {
  const v = calcularVariacion("500.00", "500.00");
  assert.deepEqual(v, { importe: "0.00", porcentaje: "0.0" });
  assert.equal(formatearImporte(v.importe, true), "0,00");
  assert.equal(formatearPorcentaje(v.porcentaje), "0,0 %");
});

test("variación con importes inválidos lanza RangeError", () => {
  assert.throws(() => calcularVariacion("1.5", "1.00"), RangeError);
  assert.throws(() => calcularVariacion("1.00", "1,00"), RangeError);
});

// ── Período ───────────────────────────────────────────────────────────────────

test("mes anterior: enero pasa a diciembre del año anterior", () => {
  assert.deepEqual(mesAnterior(2026, 1), { anio: 2025, mes: 12 });
  assert.deepEqual(mesAnterior(2026, 10), { anio: 2026, mes: 9 });
  assert.deepEqual(mesAnterior(2026, 12), { anio: 2026, mes: 11 });
});

test("mes anterior: período inválido o mes anterior inexistente lanza RangeError", () => {
  for (const [anio, mes] of [[2026, 0], [2026, 13], [2026, 1.5], [999, 5], [10000, 1], [1000, 1]]) {
    assert.throws(() => mesAnterior(anio!, mes!), RangeError, `${anio}-${mes}`);
  }
  assert.deepEqual(mesAnterior(1000, 2), { anio: 1000, mes: 1 });
});

test("etiqueta de mes en español con inicial mayúscula", () => {
  assert.equal(etiquetaMes(2026, 9), "Septiembre 2026");
  assert.equal(etiquetaMes(2026, 1), "Enero 2026");
  assert.equal(etiquetaMes(2025, 12), "Diciembre 2025");
  assert.throws(() => etiquetaMes(2026, 13), RangeError);
});

// ── Fecha de pago ─────────────────────────────────────────────────────────────

test("fechaPagoEnMes: medianoche UTC del día 1 es día calendario y cuenta en ese mes", () => {
  const fechaSolo = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(fechaPagoEnMes(fechaSolo, 2026, 10), true);
  assert.equal(fechaPagoEnMes(fechaSolo, 2026, 9), false);
  assert.equal(fechaPagoEnMes(new Date("2026-10-31T00:00:00.000Z"), 2026, 10), true);
});

test("fechaPagoEnMes: instante del último día a las 23:59 de Argentina cuenta en ese mes", () => {
  const instante = new Date("2026-10-31T23:59:59.999-03:00"); // 2026-11-01T02:59:59.999Z
  assert.equal(fechaPagoEnMes(instante, 2026, 10), true);
  assert.equal(fechaPagoEnMes(instante, 2026, 11), false);
});

test("fechaPagoEnMes: instante del día 1 a las 00:00 de Argentina cuenta en ese mes; 1 ms antes, en el anterior", () => {
  const inicio = new Date("2026-10-01T00:00:00.000-03:00"); // 03:00Z
  const unMsAntes = new Date(inicio.getTime() - 1);
  assert.equal(fechaPagoEnMes(inicio, 2026, 10), true);
  assert.equal(fechaPagoEnMes(unMsAntes, 2026, 10), false);
  assert.equal(fechaPagoEnMes(unMsAntes, 2026, 9), true);
});

test("fechaPagoEnMes: enero contra diciembre del año anterior", () => {
  assert.equal(fechaPagoEnMes(new Date("2026-01-01T02:59:59.999Z"), 2025, 12), true);
  assert.equal(fechaPagoEnMes(new Date("2026-01-01T00:00:00.000Z"), 2026, 1), true);
});

test("fechaPagoEnMes: período o fecha inválidos lanzan RangeError", () => {
  assert.throws(() => fechaPagoEnMes(new Date("2026-10-15T12:00:00Z"), 2026, 13), RangeError);
  assert.throws(() => fechaPagoEnMes(new Date("no es fecha"), 2026, 10), RangeError);
});

// ── Dinero y formato ──────────────────────────────────────────────────────────

test("importes a centavos y vuelta, sin pasar por float", () => {
  assert.equal(importeACentavos("1234.50"), BigInt(123450));
  assert.equal(importeACentavos("-0.05"), BigInt(-5));
  assert.equal(centavosAImporte(BigInt(123450)), "1234.50");
  assert.equal(centavosAImporte(BigInt(-5)), "-0.05");
  assert.equal(centavosAImporte(BigInt(0)), "0.00");
  assert.equal(centavosAImporte(importeACentavos("0.10") + importeACentavos("0.20")), "0.30");
  assert.equal(
    centavosAImporte(importeACentavos("9007199254740.99") + importeACentavos("0.02")),
    "9007199254741.01",
  );
});

test("importes con otro formato se rechazan con RangeError", () => {
  for (const invalido of ["1234.5", "1234", "1,234.50", "1.234,50", "", " 1.00", "+1.00", "1.000", "abc", "1.00 "]) {
    assert.throws(() => importeACentavos(invalido), RangeError, JSON.stringify(invalido));
    assert.throws(() => formatearImporte(invalido), RangeError, JSON.stringify(invalido));
  }
  assert.throws(() => importeACentavos(1.5 as unknown as string), RangeError);
});

test("formato de importes es-AR: miles, millones, negativos y cero", () => {
  assert.equal(formatearImporte("0.00"), "0,00");
  assert.equal(formatearImporte("-0.00"), "0,00");
  assert.equal(formatearImporte("0.05"), "0,05");
  assert.equal(formatearImporte("999.99"), "999,99");
  assert.equal(formatearImporte("1000.00"), "1.000,00");
  assert.equal(formatearImporte("1234.50"), "1.234,50");
  assert.equal(formatearImporte("1234567.89"), "1.234.567,89");
  assert.equal(formatearImporte("-1234567.89"), "-1.234.567,89");
});

test("formato de variaciones: «+» si es positiva, sin signo en cero, «-» si es negativa", () => {
  assert.equal(formatearImporte("1234.50", true), "+1.234,50");
  assert.equal(formatearImporte("0.00", true), "0,00");
  assert.equal(formatearImporte("-5.00", true), "-5,00");
});

test("formato de porcentajes: 1 decimal, coma, sufijo « %» y «—» sin dato", () => {
  assert.equal(formatearPorcentaje("12.5"), "+12,5 %");
  assert.equal(formatearPorcentaje("-3.0"), "-3,0 %");
  assert.equal(formatearPorcentaje("0.0"), "0,0 %");
  assert.equal(formatearPorcentaje("-0.0"), "0,0 %");
  assert.equal(formatearPorcentaje("12345.6"), "+12.345,6 %");
  assert.equal(formatearPorcentaje(null), "—");
  assert.throws(() => formatearPorcentaje("12.50"), RangeError);
  assert.throws(() => formatearPorcentaje("12"), RangeError);
});

// ── Egresos por proveedor ─────────────────────────────────────────────────────

test("agrupa por proveedor, suma en centavos y cuenta pagos (sin errores de float)", () => {
  const pagos: PagoProveedor[] = [
    { proveedor_id: "p1", razon_social: "Textil Norte SA", monto: "0.10" },
    { proveedor_id: "p2", razon_social: "Calzados Sur SRL", monto: "500.00" },
    { proveedor_id: "p1", razon_social: "Textil Norte SA", monto: "0.20" },
  ];
  assert.deepEqual(agruparPagosPorProveedor(pagos), [
    { proveedor_id: "p2", razon_social: "Calzados Sur SRL", total_pagado: "500.00", cantidad_pagos: 1 },
    { proveedor_id: "p1", razon_social: "Textil Norte SA", total_pagado: "0.30", cantidad_pagos: 2 },
  ]);
});

test("orden: total descendente, razón social sin distinguir mayúsculas y proveedor_id", () => {
  const pagos: PagoProveedor[] = [
    { proveedor_id: "id-d", razon_social: "beta SA", monto: "50.00" },
    { proveedor_id: "id-c", razon_social: "acme SA", monto: "50.00" },
    { proveedor_id: "id-z", razon_social: "Zeta SA", monto: "60.00" },
    { proveedor_id: "id-a", razon_social: "ACME SA", monto: "50.00" },
    { proveedor_id: "id-z", razon_social: "Zeta SA", monto: "40.00" },
    { proveedor_id: "id-b", razon_social: "Ñandú SRL", monto: "50.00" },
  ];
  assert.deepEqual(
    agruparPagosPorProveedor(pagos).map((e) => [e.proveedor_id, e.razon_social, e.total_pagado, e.cantidad_pagos]),
    [
      ["id-z", "Zeta SA", "100.00", 2],
      ["id-a", "ACME SA", "50.00", 1],
      ["id-c", "acme SA", "50.00", 1],
      ["id-d", "beta SA", "50.00", 1],
      ["id-b", "Ñandú SRL", "50.00", 1],
    ],
  );
  // El resultado no depende del orden de entrada.
  assert.deepEqual(agruparPagosPorProveedor([...pagos].reverse()), agruparPagosPorProveedor(pagos));
});

test("sin pagos no hay proveedores; un monto inválido lanza RangeError", () => {
  assert.deepEqual(agruparPagosPorProveedor([]), []);
  assert.throws(
    () => agruparPagosPorProveedor([{ proveedor_id: "p1", razon_social: "X", monto: "10" }]),
    RangeError,
  );
});

// ── Bloques ───────────────────────────────────────────────────────────────────

test("bloque «Egresos por proveedor»: estructura exacta y razón social tal cual", () => {
  const bloque = armarBloqueEgresosPorProveedor([
    { proveedor_id: "p2", razon_social: "=Calzados \"Sur\"; SRL", total_pagado: "1234567.89", cantidad_pagos: 1234 },
    { proveedor_id: "p1", razon_social: "Textil Norte SA", total_pagado: "0.30", cantidad_pagos: 2 },
  ]);
  assert.deepEqual(bloque, {
    clave: "egresos_por_proveedor",
    titulo: "Egresos por proveedor",
    columnas: ["Proveedor", "Total pagado ($)", "Cantidad de pagos"],
    filas: [
      ["=Calzados \"Sur\"; SRL", "1.234.567,89", "1234"],
      ["Textil Norte SA", "0,30", "2"],
    ],
  });
});

test("bloque «Egresos por proveedor» sin pagos: presente con las filas vacías", () => {
  assert.deepEqual(armarBloqueEgresosPorProveedor([]), {
    clave: "egresos_por_proveedor",
    titulo: "Egresos por proveedor",
    columnas: ["Proveedor", "Total pagado ($)", "Cantidad de pagos"],
    filas: [],
  });
});

test("bloque «Comparación con el mes anterior»: estructura exacta", () => {
  const anterior: TotalesMes = { anio: 2026, mes: 9, ingresos: "10000.00", egresos: "8000.00", resultado_neto: "2000.00" };
  const actual: TotalesMes = { anio: 2026, mes: 10, ingresos: "11225.00", egresos: "8000.00", resultado_neto: "-500.50" };
  const bloque = armarBloqueComparacion(actual, anterior);
  assert.deepEqual(bloque, {
    clave: "comparacion_mes_anterior",
    titulo: "Comparación con el mes anterior",
    columnas: ["Concepto", "Septiembre 2026", "Octubre 2026", "Variación ($)", "Variación (%)"],
    filas: [
      ["Ingresos", "10.000,00", "11.225,00", "+1.225,00", "+12,3 %"],
      ["Egresos", "8.000,00", "8.000,00", "0,00", "0,0 %"],
      ["Resultado neto", "2.000,00", "-500,50", "-2.500,50", "-125,0 %"],
    ],
  });
  for (const fila of bloque.filas) assert.equal(fila.length, bloque.columnas.length);
});

test("bloque de comparación enero contra diciembre y con el resumen en cero (stub de G14)", () => {
  const cero = { ingresos: "0.00", egresos: "0.00", resultado_neto: "0.00" };
  const bloque = armarBloqueComparacion({ anio: 2026, mes: 1, ...cero }, { anio: 2025, mes: 12, ...cero });
  assert.deepEqual(bloque.columnas, ["Concepto", "Diciembre 2025", "Enero 2026", "Variación ($)", "Variación (%)"]);
  assert.deepEqual(bloque.filas, [
    ["Ingresos", "0,00", "0,00", "0,00", "—"],
    ["Egresos", "0,00", "0,00", "0,00", "—"],
    ["Resultado neto", "0,00", "0,00", "0,00", "—"],
  ]);
  for (const fila of bloque.filas) assert.equal(fila.length, bloque.columnas.length);
});

test("bloque de comparación con un período o un importe inválido lanza RangeError", () => {
  const ok = { ingresos: "0.00", egresos: "0.00", resultado_neto: "0.00" };
  assert.throws(() => armarBloqueComparacion({ anio: 2026, mes: 13, ...ok }, { anio: 2026, mes: 12, ...ok }), RangeError);
  assert.throws(
    () => armarBloqueComparacion({ anio: 2026, mes: 10, ...ok, ingresos: "1" }, { anio: 2026, mes: 9, ...ok }),
    RangeError,
  );
});
