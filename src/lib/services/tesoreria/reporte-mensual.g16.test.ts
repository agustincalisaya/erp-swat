import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import type { ResumenMensualDto } from "./reporte-mensual.types";
import type { ReporteExportable } from "./reporte-mensual.export.types";
import { obtenerSerieSeisMeses } from "./reporte-mensual.serie.service";
import { proyectarDesgloseVisual, proyectarSerieVisual } from "./reporte-mensual.graficos.datos";
import { serializarReporteCsv } from "./reporte-mensual.csv";
import { generarReporteMensualPdf } from "./reporte-mensual.pdf";
import { exportarReporteMensual } from "./reporte-mensual.export.service";

function resumen(anio = 2026, mes = 1, desglose = true): ResumenMensualDto {
  return {
    periodo: { anio, mes, desde: "2026-01-01T03:00:00.000Z", hasta: "2026-02-01T03:00:00.000Z" },
    ingresos: { web: "10.00", reintegros_web: "1.00", mostrador_por_medio: [{ medio: "EFECTIVO", importe: "3.00" }], mostrador: "3.00", total: "12.00" },
    egresos: { proveedores: "2.00", gastos_operativos: "4.00", gastos_por_categoria: desglose
      ? [{ categoria_gasto_id: "cat", nombre: "Servicios", activa: false, importe: "4.00" }] : null, total: "6.00" },
    resultado_neto: "6.00", porcentaje_egresos_sobre_ingresos: 50, ventas_cuenta_corriente_informativo: "0.00",
  };
}
function exportable(desglose = true): ReporteExportable {
  return { resumen: resumen(2026, 1, desglose), detalle: [
    { id: "1", fuente_id: "1", tipo: "EGRESO_PROVEEDOR", fecha: "2026-01-10T00:00:00.000Z", concepto: "=CMD proveedor; Álvarez\nSur", importe: "-2.00", impacta_resultado: true },
    ...(desglose ? [{ id: "2", fuente_id: "2", tipo: "GASTO_OPERATIVO" as const, fecha: "2026-01-11T00:00:00.000Z", concepto: "@gasto", importe: "-4.00", impacta_resultado: true }] : []),
  ], bloques: [
    { clave: "egresos_por_proveedor", titulo: "Egresos por proveedor", columnas: ["Proveedor", "Total", "Cantidad"],
      filas: [["-1.234,50", "-1.234,50", "1"], ["+fórmula", "+1.234,50", "2"], ["@otro", "0,00", "3"]] },
    { clave: "comparacion_mes_anterior", titulo: "Comparación", columnas: ["Concepto", "Anterior", "Actual", "Variación", "Porcentaje"],
      filas: [["Ingresos", "1,00", "2,00", "+1,00", "+12,5 %"]] },
    { clave: "futuro", titulo: "Bloque futuro", columnas: ["Dato"], filas: [] },
  ] };
}

test("G16 serie: cinco consultas sin desglose, cronología y seleccionado reutilizado", async () => {
  const llamadas: string[] = [];
  const serie = await obtenerSerieSeisMeses(resumen(2026, 2), async (anio, mes, opciones) => {
    llamadas.push(`${anio}-${String(mes).padStart(2, "0")}:${opciones.incluir_desglose_gastos}`);
    return resumen(anio, mes, false);
  });
  assert.deepEqual(serie.map((p) => p.periodo), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(llamadas.length, 5);
  assert.equal(llamadas.some((s) => s.startsWith("2026-02")), false);
  assert.equal(llamadas.every((s) => s.endsWith(":false")), true);
  const visual = proyectarSerieVisual([{ periodo: "2026-01", ingresos: "-1.25", egresos: "0.00" }]);
  assert.deepEqual([visual[0].ingresosVisual, visual[0].egresosVisual], [-1.25, 0]);
  assert.throws(() => proyectarSerieVisual([{ periodo: "x", ingresos: "Infinity", egresos: "0.00" }]));
});

test("G16 gráfico mensual no filtra categorías sin permiso", () => {
  const con = proyectarDesgloseVisual(resumen());
  assert.deepEqual(con.egresos.map((b) => b.etiqueta), ["Proveedores", "Servicios"]);
  assert.equal(con.ingresos.find((b) => b.etiqueta.startsWith("Reintegros"))?.visual, -1);
  const sin = proyectarDesgloseVisual(resumen(2026, 1, false));
  assert.deepEqual(sin.egresos.map((b) => b.etiqueta), ["Proveedores", "Gastos operativos"]);
  assert.doesNotMatch(JSON.stringify(sin), /Servicios|cat/);
});

test("G16 CSV: BOM, CRLF, escapado, origen numérico y ausencia de desglose", () => {
  const r = exportable();
  r.detalle.push({ id: "3", fuente_id: "3", tipo: "COBRO_WEB", fecha: "2026-01-12T00:00:00.000Z", concepto: '  =x; "cita"\rfin', importe: "1.00", impacta_resultado: true });
  for (const prefijo of ["=", "+", "-", "@"]) r.detalle.push({ id: prefijo, fuente_id: prefijo, tipo: "COBRO_WEB", fecha: "2026-01-12T00:00:00.000Z", concepto: `${prefijo}CMD`, importe: "1.00", impacta_resultado: true });
  const bytes = serializarReporteCsv(r);
  const csv = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(csv, /\r\n/);
  assert.match(csv, /Álvarez/);
  assert.match(csv, /"'=CMD proveedor; Álvarez\nSur"/);
  assert.match(csv, /"'  =x; ""cita""\rfin"/);
  for (const prefijo of ["=", "+", "-", "@"]) assert.ok(csv.includes(`'${prefijo}CMD`));
  assert.ok(csv.includes("'-1.234,50"));
  assert.ok(csv.includes(";-1.234,50;"));
  assert.ok(csv.includes(";+1.234,50;"));
  assert.ok(csv.includes(";+12,5 %"));
  r.resumen.porcentaje_egresos_sobre_ingresos = 1234.5;
  assert.ok(new TextDecoder().decode(serializarReporteCsv(r)).includes(";1.234,5 %"));
  const restringido = new TextDecoder().decode(serializarReporteCsv(exportable(false)));
  assert.doesNotMatch(restringido, /Servicios|GASTO_OPERATIVO|@gasto|Gastos por categoría/);
  assert.match(restringido, /Gastos operativos;4,00/);
  assert.match(restringido, /Bloque futuro;?\r\nDato;?\r\n/);
});

test("G16 PDF cargable con Unicode y tablas autorizadas", async () => {
  const r = exportable();
  r.bloques[0].filas[0][0] = "Łukasz Álvarez";
  r.detalle[0].concepto = "Proveedor Łukasz — pedido";
  const bytes = await generarReporteMensualPdf(r);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "%PDF");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getTitle(), "Reporte mensual - 2026-01");
  assert.ok(pdf.getPageCount() >= 1);
  const sin = await generarReporteMensualPdf(exportable(false));
  assert.ok((await PDFDocument.load(sin)).getPageCount() >= 1);
  const largo = exportable();
  largo.detalle = Array.from({ length: 110 }, (_, i) => ({ ...largo.detalle[0], id: String(i), concepto: `Proveedor ${i} Álvarez` }));
  assert.ok((await PDFDocument.load(await generarReporteMensualPdf(largo))).getPageCount() > 1);
});

test("G16 exportación estricta: G15 o generación fallida no audita", async () => {
  const base = exportable(false);
  let auditorias = 0;
  const deps = {
    consultar: async () => ({ resumen: base.resumen, detalle: base.detalle }),
    bloques: async () => base.bloques,
    csv: serializarReporteCsv,
    pdf: generarReporteMensualPdf,
    auditar: async () => { auditorias++; },
  };
  await exportarReporteMensual(2026, 1, { incluir_desglose_gastos: false }, "CSV", "actor", deps);
  assert.equal(auditorias, 1);
  await assert.rejects(exportarReporteMensual(2026, 1, { incluir_desglose_gastos: false }, "CSV", "actor", {
    ...deps, bloques: async () => { throw new Error("SQL secreto"); },
  }), (e: Error) => !e.message.includes("SQL secreto"));
  await assert.rejects(exportarReporteMensual(2026, 1, { incluir_desglose_gastos: false }, "CSV", "actor", {
    ...deps, csv: () => { throw new Error("fallo"); },
  }));
  assert.equal(auditorias, 1);
});
