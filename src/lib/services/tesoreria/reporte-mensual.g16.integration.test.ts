import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/db/prisma";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { cargarReporteMensual } from "./reporte-mensual.pantalla";
import { obtenerSerieSeisMeses } from "./reporte-mensual.serie.service";
import { exportarReporteMensual } from "./reporte-mensual.export.service";
import { PDFDocument } from "pdf-lib";

const BASE = process.env.HU_G16_INTEGRATION_DATABASE_URL;

test("HU-G16 real: G14, serie, CSV/PDF, G15, RBAC y auditoría", { skip: !BASE, timeout: 180_000 }, async () => {
  const url = new URL(BASE!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55440");
  assert.equal(url.pathname, "/hu_g13_g14_20261019");
  process.env.DATABASE_URL = BASE;

  const usuarios = await Promise.all(["gerente.seed", "tesorero.seed", "auditor.seed", "administrador.seed", "cajero.seed"]
    .map((nombre_usuario) => prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario }, select: { id: true } })));
  const [gerente, tesorero, auditor, administrador, cajero] = usuarios;
  for (const usuario of [gerente, tesorero, auditor]) assert.equal(await usuarioTienePermiso(usuario.id, "tesoreria:exportar_reportes"), true);
  for (const usuario of [administrador, cajero]) assert.equal(await usuarioTienePermiso(usuario.id, "tesoreria:exportar_reportes"), false);
  assert.equal(await usuarioTienePermiso(cajero.id, "tesoreria:leer_desglose_gastos"), false);
  const auditoriasPrevias = await prisma.auditLog.findMany({ where: { accion: "REPORTE_MENSUAL_EXPORTADO" }, select: { id: true } });

  const categoria = await prisma.categoriaGasto.create({ data: {
    nombre: "G16 Ñandú histórico", nombre_normalizado: "g16-nandu-historico-2098",
  } });
  const ids: string[] = [];
  try {
    for (const [fecha, monto] of [["2098-03-01", "10.10"], ["2098-03-15", "20.20"], ["2098-03-31", "0.05"]]) {
      const gasto = await prisma.gastoOperativo.create({ data: {
        categoria_gasto_id: categoria.id, fecha: new Date(`${fecha}T00:00:00.000Z`), monto,
        descripcion: "Prueba G16", registrado_por_id: tesorero.id,
      } });
      ids.push(gasto.id);
    }
    await prisma.categoriaGasto.update({ where: { id: categoria.id }, data: {
      is_active: false, deleted_at: new Date(), deleted_by: tesorero.id, deletion_reason: "Prueba G16",
    } });
    const pantalla = await cargarReporteMensual(2098, 3, { incluir_desglose_gastos: true });
    assert.equal(pantalla.resumen.egresos.gastos_operativos, "30.35");
    assert.equal(pantalla.resumen.egresos.total, "30.35");
    assert.equal(pantalla.resumen.resultado_neto, "-30.35");
    assert.equal(pantalla.resumen.egresos.gastos_por_categoria?.[0].nombre, categoria.nombre);
    assert.equal(pantalla.bloques.some((b) => b.clave === "egresos_por_proveedor"), true);
    assert.equal(pantalla.bloques.some((b) => b.clave === "comparacion_mes_anterior"), true);
    const inicio = performance.now();
    const serie = await obtenerSerieSeisMeses(pantalla.resumen);
    const duracionSerieMs = Math.round(performance.now() - inicio);
    assert.deepEqual(serie.map((p) => p.periodo), ["2097-10", "2097-11", "2097-12", "2098-01", "2098-02", "2098-03"]);
    assert.deepEqual(serie.at(-1), { periodo: "2098-03", ingresos: "0.00", egresos: "30.35" });
    const con = await exportarReporteMensual(2098, 3, { incluir_desglose_gastos: true }, "CSV", tesorero.id);
    assert.deepEqual(con.reporte.resumen, pantalla.resumen);
    const csv = new TextDecoder().decode(con.bytes);
    assert.match(csv, /Gastos operativos;30,35/);
    assert.match(csv, /Resultado neto;-30,35/);
    assert.match(csv, /G16 Ñandú histórico/);
    assert.match(csv, /Egresos por proveedor/);
    assert.match(csv, /Comparación con el mes anterior/);
    const sin = await exportarReporteMensual(2098, 3, { incluir_desglose_gastos: false }, "CSV", auditor.id);
    const csvSin = new TextDecoder().decode(sin.bytes);
    assert.equal(sin.reporte.resumen.egresos.gastos_operativos, "30.35");
    assert.equal(sin.reporte.resumen.egresos.gastos_por_categoria, null);
    assert.doesNotMatch(csvSin, /G16 Ñandú histórico|GASTO_OPERATIVO|Prueba G16|Gastos por categoría/);
    const pdf = await exportarReporteMensual(2098, 3, { incluir_desglose_gastos: false }, "PDF", gerente.id);
    assert.deepEqual(pdf.reporte.resumen, sin.reporte.resumen);
    assert.equal((await PDFDocument.load(pdf.bytes)).getTitle(), "Reporte mensual - 2098-03");
    const vacio = await cargarReporteMensual(2098, 5, { incluir_desglose_gastos: false });
    assert.equal(vacio.resumen.egresos.gastos_operativos, "0.00");
    assert.equal(vacio.resumen.egresos.gastos_por_categoria, null);
    assert.equal(vacio.detalle.some((f) => f.tipo === "GASTO_OPERATIVO"), false);
    const asientos = await prisma.auditLog.findMany({ where: { accion: "REPORTE_MENSUAL_EXPORTADO",
      registro_id: { not: null }, id: { notIn: auditoriasPrevias.map((a) => a.id) } }, select: { usuario_id: true, valor_nuevo: true } });
    assert.equal(asientos.length, 3);
    assert.deepEqual(asientos.map((a) => a.usuario_id).sort(), [tesorero.id, auditor.id, gerente.id].sort());
    assert.deepEqual(asientos.map((a) => (a.valor_nuevo as { formato: string }).formato).sort(), ["CSV", "CSV", "PDF"]);
    console.info("[HU-G16 integración]", { total: "30.35", serie_meses: serie.length, llamadas_g14_serie: 5,
      duracion_serie_ms: duracionSerieMs, exportaciones_auditadas: asientos.length });
  } finally {
    await prisma.auditLog.deleteMany({ where: { accion: "REPORTE_MENSUAL_EXPORTADO", id: { notIn: auditoriasPrevias.map((a) => a.id) } } });
    await prisma.gastoOperativo.deleteMany({ where: { id: { in: ids } } });
    await prisma.categoriaGasto.delete({ where: { id: categoria.id } });
    assert.equal(await prisma.gastoOperativo.count({ where: { id: { in: ids } } }), 0);
    await prisma.$disconnect();
  }
});
