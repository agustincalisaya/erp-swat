/* eslint-disable @typescript-eslint/no-explicit-any -- Doble HTTP con payload de respuesta variable. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as fechas from "../../utils/fecha-negocio.ts";

const ruta = "../../../app/api/tesoreria/reporte-mensual/route.ts";
const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
const codigo = transpileModule(fuente, { compilerOptions: {
  module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
} }).outputText;

function rutaConPermisos(permisos: string[], fallo = false) {
  const llamadas: boolean[] = [];
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const respuesta = (body: unknown, opciones: { status?: number; headers?: unknown } = {}) =>
    ({ status: opciones.status ?? 200, body });
  const dependencias: Record<string, unknown> = {
    "next/server": { NextResponse: { json: respuesta } },
    "@/lib/auth/with-permission": {
      withPermission: (codigo: string, handler: (...args: unknown[]) => unknown) =>
        (req: unknown) => !permisos.includes("sesion") ? respuesta({ data: null }, { status: 401 })
          : !permisos.includes(codigo) ? respuesta({ data: null }, { status: 403 })
          : handler(req, { userId: "u1" }),
      usuarioTienePermiso: async (_id: string, codigo: string) => permisos.includes(codigo),
    },
    "@/lib/services/tesoreria/reporte-mensual.pantalla": {
      cargarReporteMensual: async (_anio: number, _mes: number, opciones: { incluir_desglose_gastos: boolean }) => {
        llamadas.push(opciones.incluir_desglose_gastos);
        if (fallo) throw new Error("DB interna");
        return { resumen: { egresos: { gastos_por_categoria: opciones.incluir_desglose_gastos ? [] : null } },
          detalle: opciones.incluir_desglose_gastos ? [{ tipo: "GASTO_OPERATIVO" }] : [],
          bloques: [], adicionalesDisponibles: true };
      },
    },
    "@/lib/services/tesoreria/reporte-mensual.periodo": {
      interpretarMesReporte: (valor: string | undefined) => {
        if (!valor) return { anio: 2026, mes: 10 };
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) return null;
        return { anio: Number(valor.slice(0, 4)), mes: Number(valor.slice(5)) };
      },
    },
    "@/lib/services/tesoreria/reporte-mensual.service": {
      PERMISO_LEER_REPORTES: "tesoreria:leer_reportes",
      PERMISO_LEER_DESGLOSE_GASTOS: "tesoreria:leer_desglose_gastos",
    },
    "@/lib/utils/fecha-negocio": fechas,
  };
  runInThisContext(`(function(require, module, exports) {\n${codigo}\n})`, { filename: ruta })(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) throw new Error(`Dependencia inesperada: ${nombre}`);
      return dependencias[nombre];
    }, modulo, modulo.exports,
  );
  const GET = modulo.exports.GET as (req: { nextUrl: URL }) => Promise<{ status: number; body: any }>;
  return { GET: (mes = "2026-10") => GET({ nextUrl: new URL(`http://local.test/api/tesoreria/reporte-mensual?mes=${mes}`) }), llamadas };
}

test("G14 HTTP: sesión y lectura requeridas; el navegador no concede desglose", async () => {
  assert.equal((await rutaConPermisos([]).GET()).status, 401);
  assert.equal((await rutaConPermisos(["sesion"]).GET()).status, 403);
  const cajero = rutaConPermisos(["sesion", "tesoreria:leer_reportes"]);
  const respuesta = await cajero.GET();
  assert.equal(respuesta.status, 200);
  assert.deepEqual(cajero.llamadas, [false]);
  assert.equal(respuesta.body.data.resumen.egresos.gastos_por_categoria, null);
  assert.deepEqual(respuesta.body.data.detalle, []);
  const gerente = rutaConPermisos(["sesion", "tesoreria:leer_reportes", "tesoreria:leer_desglose_gastos"]);
  assert.equal((await gerente.GET()).status, 200);
  assert.deepEqual(gerente.llamadas, [true]);
});

test("G14 HTTP: 400 período inválido y 500 seguro", async () => {
  const autorizado = rutaConPermisos(["sesion", "tesoreria:leer_reportes"]);
  assert.equal((await autorizado.GET("2026-13")).status, 400);
  assert.deepEqual(autorizado.llamadas, []);
  const fallo = await rutaConPermisos(["sesion", "tesoreria:leer_reportes"], true).GET();
  assert.equal(fallo.status, 500);
  assert.equal(fallo.body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(fallo.body), /DB interna/);
});
