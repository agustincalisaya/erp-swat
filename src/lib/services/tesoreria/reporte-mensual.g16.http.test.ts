import assert from "node:assert/strict";
import test from "node:test";
import { cargarAislado } from "../ecommerce/comprobante-pdf.test-helpers.ts";
import { ServiceError } from "../../errors/service-error.ts";

class Respuesta {
  status: number;
  body: unknown;
  headers = new Headers();
  constructor(body: unknown, opciones: { status?: number; headers?: Record<string, string> } = {}) {
    this.status = opciones.status ?? 200;
    this.body = body;
    for (const [k, v] of Object.entries(opciones.headers ?? {})) this.headers.set(k, v);
  }
  static json(body: unknown, opciones?: { status?: number; headers?: Record<string, string> }) { return new Respuesta(body, opciones); }
}

function ruta(permisos: string[], fallo?: string, formato: "CSV" | "PDF" = "CSV") {
  const llamadas: { opciones: { incluir_desglose_gastos: boolean }; formato: string }[] = [];
  const modulo = cargarAislado<{ crearDescargaReporteMensual: (formato: "CSV" | "PDF") => (req: unknown, ctx: unknown) => Promise<Respuesta> }>(
    new URL("./reporte-mensual.export.http.ts", import.meta.url), {
      "server-only": {}, "next/server": { NextResponse: Respuesta },
      "@/lib/auth/with-permission": {
        withPermission: (codigo: string, fn: (req: unknown, session: { userId: string }) => Promise<Respuesta>) =>
          (req: unknown) => !permisos.includes("sesion") ? Respuesta.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 })
            : !permisos.includes(codigo) ? Respuesta.json({ error: { code: "FORBIDDEN" } }, { status: 403 })
            : fn(req, { userId: "actor" }),
        usuarioTienePermiso: async (_id: string, codigo: string) => permisos.includes(codigo),
      },
      "@/lib/errors/service-error": { ServiceError },
      "./reporte-mensual.periodo": { interpretarMesReporte: (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ?
        { anio: Number(s.slice(0, 4)), mes: Number(s.slice(5)), mesIso: s } : null },
      "./reporte-mensual.service": { PERMISO_LEER_DESGLOSE_GASTOS: "tesoreria:leer_desglose_gastos" },
      "./reporte-mensual.export.service": {
        PERMISO_EXPORTAR_REPORTES: "tesoreria:exportar_reportes",
        exportarReporteMensual: async (_a: number, _m: number, opciones: { incluir_desglose_gastos: boolean }, formato: string) => {
          llamadas.push({ opciones, formato });
          if (fallo) throw new ServiceError(fallo, "dato interno");
          return { bytes: new Uint8Array([37, 80, 68, 70]) };
        },
      },
    });
  const GET = modulo.crearDescargaReporteMensual(formato);
  return { GET: (mes = "2026-10") => GET({ nextUrl: new URL(`http://local.test/?mes=${mes}`) }, {}), llamadas };
}

test("G16 HTTP: exportar es el único gate y desglose se resuelve en servidor", async () => {
  assert.equal((await ruta([]).GET()).status, 401);
  assert.equal((await ruta(["sesion"]).GET()).status, 403);
  const agregado = ruta(["sesion", "tesoreria:exportar_reportes"]);
  const respuesta = await agregado.GET();
  assert.equal(respuesta.status, 200);
  assert.equal(agregado.llamadas[0].opciones.incluir_desglose_gastos, false);
  assert.equal(respuesta.headers.get("Cache-Control"), "private, no-store");
  assert.equal(respuesta.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(respuesta.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(respuesta.headers.get("Content-Disposition")!, /attachment; filename="reporte-mensual-2026-10.csv"/);
  const completo = ruta(["sesion", "tesoreria:exportar_reportes", "tesoreria:leer_desglose_gastos"]);
  assert.equal((await completo.GET()).status, 200);
  assert.equal(completo.llamadas[0].opciones.incluir_desglose_gastos, true);
  const pdf = await ruta(["sesion", "tesoreria:exportar_reportes"], undefined, "PDF").GET();
  assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
  assert.match(pdf.headers.get("Content-Disposition")!, /attachment; filename="reporte-mensual-2026-10.pdf"/);
});

test("G16 HTTP: mes inválido y dependencias fallidas no exponen detalles", async () => {
  const permitido = ["sesion", "tesoreria:exportar_reportes"];
  assert.equal((await ruta(permitido).GET("2026-13")).status, 400);
  const g15 = await ruta(permitido, "REPORTE_BLOQUES_NO_DISPONIBLES").GET();
  assert.equal(g15.status, 503);
  assert.doesNotMatch(JSON.stringify(g15.body), /dato interno/);
  const auditoria = await ruta(permitido, "REPORTE_AUDITORIA_NO_CONFIRMADA").GET();
  assert.equal(auditoria.status, 503);
  assert.equal(auditoria.headers.get("Cache-Control"), "private, no-store");
});
