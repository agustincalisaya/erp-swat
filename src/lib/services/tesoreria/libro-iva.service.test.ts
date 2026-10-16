import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { cargarAislado } from "../ecommerce/comprobante-pdf.test-helpers.ts";
import * as reglas from "./libro-iva.reglas.ts";
import * as fechas from "../../utils/fecha-negocio.ts";
import * as schema from "../../schemas/libro-iva.schema.ts";
import { ServiceError } from "../../errors/service-error.ts";

function venta(id: string, numero = "V-2026-000001") {
  return { id, created_at: new Date("2026-10-01T03:00:00Z"), tipo_comprobante: "FACTURA_B", monto_total: new Prisma.Decimal(121),
    comprobante_original_id: null as string | null, pedido_venta_id: id,
    pedido_venta: { numero_venta: numero, canal: "WEB", estado: "ANULADO", cliente: { dni: "30111222", nombre: "José" } },
    _count: { notas_credito: 0 }, comprobante_original: null as unknown,
  };
}
function compra(id: string, numero = "0002-1", cuit = "30-70011122-3") {
  return { id, fecha_emision: new Date("2026-10-01T00:00:00Z"), tipo: "FACTURA_M", numero_comprobante: numero,
    monto_total: new Prisma.Decimal(242), proveedor: { cuit, razon_social: "Proveedor" } };
}

function cargar(ventas: unknown[] = [], compras: unknown[] = []) {
  const consultas: { origen: string; args: Record<string, unknown> }[] = [];
  const prisma = {
    comprobanteFiscal: { findMany: async (args: Record<string, unknown>) => { consultas.push({ origen: "ventas", args }); return [...ventas]; } },
    comprobanteProveedor: { findMany: async (args: Record<string, unknown>) => { consultas.push({ origen: "compras", args }); return [...compras]; } },
  };
  const repositorio = cargarAislado(new URL("./comprobantes-repositorio.service.ts", import.meta.url), {
    "server-only": {}, "@/lib/db/prisma": { prisma }, "@/lib/errors/service-error": { ServiceError },
    "@/lib/utils/fecha-negocio": fechas, "@/lib/services/ecommerce/comprobante-web-pdf": {},
  });
  const servicio = cargarAislado<{
    generarLibroIva: (tipo: "VENTAS" | "COMPRAS", periodo: string) => Promise<string>;
    consultarLibroIva: (tipo: "VENTAS" | "COMPRAS", periodo: string) => Promise<import("./libro-iva.constants.ts").LibroIvaVista>;
  }>(new URL("./libro-iva.service.ts", import.meta.url), {
    "server-only": {}, "@/lib/db/prisma": { prisma }, "@/lib/errors/service-error": { ServiceError },
    "@/lib/utils/fecha-negocio": fechas, "@/lib/schemas/libro-iva.schema": schema,
    "@/lib/services/tesoreria/comprobantes-repositorio.service": repositorio, "./libro-iva.reglas": reglas,
  });
  return { ...servicio, consultas };
}

test("G4 usa núcleo G3 real sin límites/filtros heredados, proyección acotada y orden ASC", async () => {
  const filas = Array.from({ length: 125 }, (_, i) => venta(String(i).padStart(3, "0"), `V-2026-${String(i + 1).padStart(6, "0")}`)).reverse();
  const s = cargar(filas);
  const txt = await s.generarLibroIva("VENTAS", "2026-10");
  assert.equal(txt.trimEnd().split("\n").length, 125);
  assert.equal(txt.split("\n")[0]!.split(";")[3], "26000001");
  const q = s.consultas[0]!.args;
  assert.deepEqual(q.where, { created_at: { gte: new Date("2026-10-01T03:00:00Z"), lt: new Date("2026-11-01T03:00:00Z") } });
  assert.equal(q.take, undefined); assert.equal(q.skip, undefined);
  const select = q.select as Record<string, unknown>;
  assert.ok(select._count); assert.ok(select.comprobante_original);
  assert.equal(select.items, undefined); assert.equal(select.medios_pago, undefined);
});

test("G4 NC usa emisión propia y venta original, cuenta hermanas fuera del mes", async () => {
  const nc = { ...venta("nc"), tipo_comprobante: "NOTA_CREDITO", comprobante_original_id: "original",
    comprobante_original: { id: "original", pedido_venta_id: "nc", comprobante_original_id: null, tipo_comprobante: "FACTURA_A", pedido_venta: { numero_venta: "V-2025-001234" }, _count: { notas_credito: 1 } } };
  const txt = await cargar([nc]).generarLibroIva("VENTAS", "2026-10");
  assert.ok(txt.startsWith("20261001;003;00001;25001234;"));
  assert.ok(txt.includes(";-121.00;-100.00;-21.00;"));
  for (const original of [null, { ...nc.comprobante_original, _count: { notas_credito: 2 } }, { ...nc.comprobante_original, tipo_comprobante: "TICKET" }, { ...nc.comprobante_original, pedido_venta_id: "ajeno" }]) {
    await assert.rejects(cargar([{ ...nc, comprobante_original: original }]).generarLibroIva("VENTAS", "2026-10"), (e: unknown) => e instanceof ServiceError && e.code === "LIBRO_IVA_DATOS_INVALIDOS");
  }
});

test("G4 compras calendario y emisor: coincidencias válidas, equivalencias inválidas", async () => {
  const s = cargar([], [compra("a"), compra("b", "00002-00000001", "30-80011122-3")]);
  const txt = await s.generarLibroIva("COMPRAS", "2026-12");
  assert.equal(txt.trimEnd().split("\n").length, 2);
  assert.ok(txt.startsWith("20261001;051;"));
  assert.deepEqual(s.consultas[0]!.args.where, { is_active: true, fecha_emision: { gte: new Date("2026-12-01T00:00:00Z"), lt: new Date("2027-01-01T00:00:00Z") } });
  await assert.rejects(cargar([], [compra("a"), compra("b", "2-00000001", "30700111223")]).generarLibroIva("COMPRAS", "2026-10"), /incompatibles/);
});

test("G4 aborta solo el libro solicitado; incidencias acotadas sin valores privados", async () => {
  const filas = Array.from({ length: 25 }, (_, i) => ({ ...venta(`id-${i}`), monto_total: new Prisma.Decimal(-121) }));
  const s = cargar(filas, []);
  await assert.rejects(s.generarLibroIva("VENTAS", "2026-10"), (e: unknown) => {
    assert.ok(e instanceof ServiceError);
    const d = e.details as { incidencias: unknown[]; total_incidencias: number; hay_mas: boolean };
    assert.equal(d.incidencias.length, 20); assert.equal(d.total_incidencias, 25); assert.equal(d.hay_mas, true);
    assert.equal(JSON.stringify(e).includes("30111222"), false); assert.equal(JSON.stringify(e).includes("José"), false);
    return true;
  });
  assert.equal(await s.generarLibroIva("COMPRAS", "2026-10"), "");
  await assert.rejects(cargar([venta("a"), venta("b")]).generarLibroIva("VENTAS", "2026-10"), /incompatibles/);
  await assert.rejects(s.generarLibroIva("VENTAS", "2026-00"), /mes válido/);
});

test("G4 conserva el extremo 9999-12 admitido sin modificar helpers compartidos", async () => {
  const s = cargar();
  assert.equal(await s.generarLibroIva("VENTAS", "9999-12"), "");
  assert.equal(await s.generarLibroIva("COMPRAS", "9999-12"), "");
  assert.deepEqual(s.consultas[0]!.args.where, { created_at: { gte: new Date("9999-12-01T03:00:00Z"), lt: new Date("+010000-01-01T03:00:00Z") } });
  assert.deepEqual(s.consultas[1]!.args.where, { is_active: true, fecha_emision: { gte: new Date("9999-12-01T00:00:00Z"), lt: new Date("+010000-01-01T00:00:00Z") } });
});

test("G4 vista comparte filas y totales decimales exactos con TXT, NC y libro vacío", async () => {
  const factura = venta("original");
  const nc = { ...venta("nc"), pedido_venta_id: "original", tipo_comprobante: "NOTA_CREDITO", comprobante_original_id: "original",
    comprobante_original: { ...factura, _count: { notas_credito: 1 } } };
  const s = cargar([{ ...factura, _count: { notas_credito: 1 } }, nc, { ...venta("otra", "V-2026-000002"), monto_total: new Prisma.Decimal("0.03") }]);
  const libro = await s.consultarLibroIva("VENTAS", "2026-10");
  assert.deepEqual(libro.totales, { comprobantes: 3, notas_credito: 1, neto: "0.02", iva: "0.01", total: "0.03" });
  assert.equal(reglas.serializarLibro(libro.filas), await s.generarLibroIva("VENTAS", "2026-10"));
  assert.equal(libro.filas[0]!.id, "nc");
  assert.deepEqual((await cargar().consultarLibroIva("COMPRAS", "2026-10")).totales,
    { comprobantes: 0, notas_credito: 0, neto: "0.00", iva: "0.00", total: "0.00" });
});
