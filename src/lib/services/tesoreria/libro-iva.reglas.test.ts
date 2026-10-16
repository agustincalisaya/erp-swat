import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { codigoCompra, codigoVenta, contraparteVenta, cuitLibro, importesLibro, nombreArchivoLibro, numeroCompra, numeroVentaLibro, serializarLibro } from "./libro-iva.reglas.ts";
import { ConsultaLibroIvaSchema } from "../../schemas/libro-iva.schema.ts";

test("G4 numeración de ventas y NC: últimos ocho, sin rechazar diez cifras internas", () => {
  assert.deepEqual(numeroVentaLibro("V-2026-001234"), { pv: "00001", numero: "26001234" });
  assert.deepEqual(numeroVentaLibro("NC-V-2026-001234"), numeroVentaLibro("V-2026-001234"));
  assert.throws(() => numeroVentaLibro("V-12-3"), /NUMERO_VENTA_INVALIDO/);
});

test("G4 parser compra: equivalencias, default y límites sin truncar", () => {
  for (const numero of ["0002-1", " 2 \t- 00000001 "]) assert.deepEqual(numeroCompra(numero), { pv: "00002", numero: "00000001" });
  assert.deepEqual(numeroCompra("4567"), { pv: "00001", numero: "00004567" });
  assert.deepEqual(numeroCompra("99999-99999999"), { pv: "99999", numero: "99999999" });
  for (const numero of ["", "0", "0-1", "1-00000000", "000001-1", "1-123456789", "1/2", "1-2-3", "1 2", "1-2\n", "1\r-2", "uno"]) {
    assert.throws(() => numeroCompra(numero), numero);
  }
});

test("G4 CUIT solo numérico/canónico, DNI presente corrupto no se anonimiza; A admite DNI/99", () => {
  assert.equal(cuitLibro("30-70011122-3"), "30700111223");
  assert.equal(cuitLibro("30700111223"), "30700111223");
  for (const v of ["30.70011122.3", "CUIT30700111223", " 30700111223 ", "123"]) assert.throws(() => cuitLibro(v));
  assert.deepEqual(contraparteVenta(null), { tipo_doc: "99", numero_doc: "0", denominacion: "Consumidor final" });
  assert.equal(contraparteVenta({ dni: "30111222", nombre: "Cliente" }).tipo_doc, "96");
  assert.throws(() => contraparteVenta({ dni: "30.111.222", nombre: "Cliente" }));
  assert.equal(codigoVenta("FACTURA_A"), "001");
});

test("G4 códigos completos y NC sin código/original explícitamente inválidas", () => {
  assert.deepEqual((["FACTURA_A", "FACTURA_B", "FACTURA_C", "FACTURA_M"] as const).map(codigoCompra), ["001", "006", "011", "051"]);
  assert.equal(codigoVenta("TICKET"), "083");
  assert.equal(codigoVenta("NOTA_CREDITO", "FACTURA_A"), "003");
  assert.equal(codigoVenta("NOTA_CREDITO", "FACTURA_B"), "008");
  for (const original of [null, "TICKET", "NOTA_CREDITO", "FACTURA_C"]) assert.throws(() => codigoVenta("NOTA_CREDITO", original as never));
  assert.throws(() => codigoCompra("OTRO" as never));
});

test("G4 Decimal conserva suma, half-up, signos y cero sin corregir negativos", () => {
  assert.deepEqual(importesLibro("121.00"), { total: "121.00", neto: "100.00", iva: "21.00" });
  assert.deepEqual(importesLibro("121.00", true), { total: "-121.00", neto: "-100.00", iva: "-21.00" });
  assert.deepEqual(importesLibro("0.01", true), { total: "-0.01", neto: "-0.01", iva: "0.00" });
  assert.deepEqual(importesLibro("0.03"), { total: "0.03", neto: "0.02", iva: "0.01" });
  assert.deepEqual(importesLibro("0", true), { total: "0.00", neto: "0.00", iva: "0.00" });
  for (let cents = 0; cents <= 250; cents++) for (const nc of [false, true]) {
    const v = importesLibro(new Prisma.Decimal(cents).div(100), nc);
    assert.ok(new Prisma.Decimal(v.neto).plus(v.iva).equals(v.total));
  }
  for (const v of ["-1", "NaN", "Infinity", "foo", "1.001"]) assert.throws(() => importesLibro(v, true));
});

test("G4 bytes de ejemplo completo, acentos, comillas, saneamiento y vacío", () => {
  const base = { fecha: "20261001", tipo: "006", ...numeroVentaLibro("V-2026-001234"), ...contraparteVenta({ dni: "30111222", nombre: "Cliente Ejemplo" }), ...importesLibro("121") };
  assert.equal(serializarLibro([base]), "20261001;006;00001;26001234;96;30111222;Cliente Ejemplo;121.00;100.00;21.00;21.00\n");
  assert.equal(serializarLibro([{ ...base, fecha: "20261003", tipo: "008", ...importesLibro("121", true) }]), "20261003;008;00001;26001234;96;30111222;Cliente Ejemplo;-121.00;-100.00;-21.00;21.00\n");
  assert.equal(serializarLibro([{ ...base, fecha: "20261005", tipo: "001", ...numeroCompra("0002-4567"), tipo_doc: "80", numero_doc: cuitLibro("30-70011122-3"), denominacion: "Proveedor Ejemplo", ...importesLibro("242") }]), "20261005;001;00002;00004567;80;30700111223;Proveedor Ejemplo;242.00;200.00;42.00;21.00\n");
  const texto = serializarLibro([{ ...base, denominacion: '  José;"Táctico"\r\n SA  ' }]);
  assert.equal(texto.trimEnd().split(";").length, 11);
  assert.ok(texto.includes('José "Táctico"   SA'));
  assert.equal(Buffer.from(texto).subarray(0, 3).toString("hex"), "323032");
  assert.equal(Buffer.byteLength(serializarLibro([])), 0);
  assert.equal(nombreArchivoLibro("VENTAS", "2026-10").visible, "Libro de IVA - ventas - 2026-10.txt");
  assert.equal(nombreArchivoLibro("COMPRAS", "2026-10", "pdf").ascii, "Libro_IVA_compras_2026-10.pdf");
});

test("G4 mes estricto y rango compartido", () => {
  for (const mes of ["1000-01", "9999-12", "2026-10"]) assert.ok(ConsultaLibroIvaSchema.safeParse({ mes }).success);
  for (const mes of ["0999-01", "2026-1", "2026-13", "2026-00", "2026-10-01", " 2026-10", "10000-01"]) assert.equal(ConsultaLibroIvaSchema.safeParse({ mes }).success, false);
  assert.equal(ConsultaLibroIvaSchema.safeParse({ mes: "2026-10", canal: "WEB" }).success, false);
});
