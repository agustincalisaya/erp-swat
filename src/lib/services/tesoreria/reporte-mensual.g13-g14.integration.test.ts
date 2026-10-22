import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "@/lib/db/prisma";
import { rangoMesFechaSolo } from "@/lib/utils/fecha-negocio";
import { obtenerResumenMensual } from "./reporte-mensual.service";
import { cargarReporteMensual } from "./reporte-mensual.pantalla";

const DATABASE_URL = process.env.HU_G13_G14_INTEGRATION_DATABASE_URL;

test("HU-G13 → HU-G14: gastos reales, privacidad y límites de fecha", {
  skip: !DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const url = new URL(DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55440");
  assert.equal(url.pathname, "/hu_g13_g14_20261019");
  process.env.DATABASE_URL = DATABASE_URL;

  const actor = await prisma.usuario.findUniqueOrThrow({
    where: { nombre_usuario: "tesorero.seed" }, select: { id: true },
  });
  const nombres = ["Integración A 2098", "Integración B 2098"];
  const categorias = await Promise.all(nombres.map((nombre, i) =>
    prisma.categoriaGasto.create({ data: {
      nombre, nombre_normalizado: `integracion-g13-g14-20261019-${i}`,
    } })));
  const idsGastos: string[] = [];
  try {
    const [categoriaA, categoriaB] = categorias;
    const crear = async (clave: string, categoria_gasto_id: string, fecha: string, monto: string) => {
      const gasto = await prisma.gastoOperativo.create({ data: {
        categoria_gasto_id, fecha: new Date(`${fecha}T00:00:00.000Z`), monto,
        descripcion: `Fixture ${clave}`, registrado_por_id: actor.id,
      } });
      idsGastos.push(gasto.id);
      return gasto;
    };
    const A = await crear("A", categoriaA.id, "2098-03-01", "10.10");
    const B = await crear("B", categoriaB.id, "2098-03-15", "20.20");
    const C = await crear("C", categoriaB.id, "2098-03-20", "40.00");
    const D = await crear("D", categoriaB.id, "2098-02-28", "50.00");
    const E = await crear("E", categoriaB.id, "2098-03-31", "0.05");
    const siguiente = await crear("siguiente", categoriaB.id, "2098-04-01", "60.00");
    await prisma.gastoOperativo.update({ where: { id: C.id }, data: {
      is_active: false, deleted_at: new Date(), deleted_by: actor.id, deletion_reason: "Fixture baja",
    } });
    await prisma.categoriaGasto.update({ where: { id: categoriaA.id }, data: {
      is_active: false, deleted_at: new Date(), deleted_by: actor.id, deletion_reason: "Fixture baja",
    } });

    const rango = rangoMesFechaSolo(2098, 3);
    assert.equal(rango.desde.toISOString(), "2098-03-01T00:00:00.000Z");
    assert.equal(rango.hasta.toISOString(), "2098-04-01T00:00:00.000Z");
    assert.equal(E.fecha.toISOString(), "2098-03-31T00:00:00.000Z");
    assert.equal(siguiente.fecha.toISOString(), rango.hasta.toISOString());

    const con = await obtenerResumenMensual(2098, 3, { incluir_desglose_gastos: true });
    assert.equal(con.ingresos.total, "0.00");
    assert.equal(con.egresos.proveedores, "0.00");
    assert.equal(con.egresos.gastos_operativos, "30.35");
    assert.equal(con.egresos.total, "30.35");
    assert.equal(con.resultado_neto, "-30.35");
    assert.deepEqual(con.egresos.gastos_por_categoria, [
      { categoria_gasto_id: categoriaA.id, nombre: categoriaA.nombre, activa: false, importe: "10.10" },
      { categoria_gasto_id: categoriaB.id, nombre: categoriaB.nombre, activa: true, importe: "20.25" },
    ].sort((a, b) => a.categoria_gasto_id.localeCompare(b.categoria_gasto_id)));
    for (const valor of [con.egresos.gastos_operativos, con.egresos.total, con.resultado_neto,
      ...con.egresos.gastos_por_categoria!.map((fila) => fila.importe)]) {
      assert.match(valor, /^-?\d+\.\d{2}$/);
    }

    const sin = await obtenerResumenMensual(2098, 3, { incluir_desglose_gastos: false });
    assert.equal(sin.egresos.gastos_operativos, con.egresos.gastos_operativos);
    assert.equal(sin.egresos.total, con.egresos.total);
    assert.equal(sin.resultado_neto, con.resultado_neto);
    assert.equal(sin.egresos.gastos_por_categoria, null);

    const autorizado = await cargarReporteMensual(2098, 3, { incluir_desglose_gastos: true });
    const restringido = await cargarReporteMensual(2098, 3, { incluir_desglose_gastos: false });
    assert.deepEqual(autorizado.detalle.filter((fila) => fila.tipo === "GASTO_OPERATIVO")
      .map((fila) => fila.fuente_id).sort(), [A.id, B.id, E.id].sort());
    assert.equal(restringido.detalle.some((fila) => fila.tipo === "GASTO_OPERATIVO"), false);
    assert.equal(restringido.resumen.egresos.gastos_por_categoria, null);
    assert.equal(restringido.resumen.egresos.gastos_operativos, "30.35");
    assert.equal(autorizado.detalle.some((fila) => [C.id, D.id, siguiente.id].includes(fila.fuente_id)), false);

    for (const incluir_desglose_gastos of [true, false]) {
      const vacio = await cargarReporteMensual(2098, 5, { incluir_desglose_gastos });
      assert.equal(vacio.resumen.egresos.gastos_operativos, "0.00");
      assert.deepEqual(vacio.resumen.egresos.gastos_por_categoria, incluir_desglose_gastos ? [] : null);
      assert.equal(vacio.detalle.some((fila) => fila.tipo === "GASTO_OPERATIVO"), false);
    }

    console.log(JSON.stringify({ base: url.pathname, fixtures: { A: "10.10", B: "20.20", C: "40.00 baja",
      D: "50.00 febrero", E: "0.05 último día", siguiente: "60.00 abril" },
      esperado: "30.35", con: { egresos: con.egresos, resultado_neto: con.resultado_neto },
      sin: { egresos: sin.egresos, resultado_neto: sin.resultado_neto },
      privacidad: { autorizadas: 3, restringidas: 0 },
      limites: { ultimo_dia: E.fecha.toISOString(), siguiente: siguiente.fecha.toISOString() },
      vacio: "PASS" }));
  } finally {
    await prisma.gastoOperativo.deleteMany({ where: { id: { in: idsGastos } } });
    await prisma.categoriaGasto.deleteMany({ where: { id: { in: categorias.map((c) => c.id) } } });
    assert.equal(await prisma.gastoOperativo.count({ where: { id: { in: idsGastos } } }), 0);
    assert.equal(await prisma.categoriaGasto.count({ where: { id: { in: categorias.map((c) => c.id) } } }), 0);
    await prisma.$disconnect();
  }
});
