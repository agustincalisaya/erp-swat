/**
 * Sprint 5 · PR 0 — stub de `obtenerResumenMensual` (contrato de HU-G14).
 *
 * Carga el service real con dependencias aisladas (sin BD), mismo patrón que
 * `ingreso-tesoreria.service.test.ts`. Verifica la forma del DTO, el desglose
 * `null` según la opción y el rechazo de un período inválido. Cuando el
 * Cluster 3 reemplace el stub, este test se adapta a la lógica real.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";
import * as fechaNegocio from "../../utils/fecha-negocio.ts";

interface Servicio {
  PERMISO_LEER_REPORTES: string;
  obtenerResumenMensual: (anio: number, mes: number, opciones: { incluir_desglose_gastos: boolean }) => Promise<Record<string, unknown>>;
}

function cargarServicio(): Servicio {
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/utils/fecha-negocio": fechaNegocio,
  };
  const ruta = "./reporte-mensual.service.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const ejecutar = runInThisContext(
    `(function(require, module, exports) {\n${codigo}\n})`,
    { filename: ruta },
  );
  ejecutar(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) {
        throw new Error(`Dependencia inesperada: ${nombre}`);
      }
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
  );
  return modulo.exports as unknown as Servicio;
}

const servicio = cargarServicio();

test("PERMISO_LEER_REPORTES es tesoreria:leer_reportes", () => {
  assert.equal(servicio.PERMISO_LEER_REPORTES, "tesoreria:leer_reportes");
});

test("stub: devuelve la forma completa del contrato con importes en cero y el período en hora Argentina", async () => {
  const resumen = await servicio.obtenerResumenMensual(2026, 10, { incluir_desglose_gastos: true });
  assert.deepEqual(resumen, {
    periodo: { anio: 2026, mes: 10, desde: "2026-10-01T03:00:00.000Z", hasta: "2026-11-01T03:00:00.000Z" },
    ingresos: { web: "0.00", reintegros_web: "0.00", mostrador_por_medio: [], mostrador: "0.00", total: "0.00" },
    egresos: { proveedores: "0.00", gastos_operativos: "0.00", gastos_por_categoria: [], total: "0.00" },
    resultado_neto: "0.00",
    porcentaje_egresos_sobre_ingresos: null,
    ventas_cuenta_corriente_informativo: "0.00",
  });
});

test("stub: sin desglose de gastos, gastos_por_categoria es null", async () => {
  const resumen = await servicio.obtenerResumenMensual(2026, 10, { incluir_desglose_gastos: false });
  assert.equal((resumen.egresos as { gastos_por_categoria: unknown }).gastos_por_categoria, null);
});

test("stub: un mes inválido se rechaza con ServiceError PERIODO_INVALIDO", async () => {
  for (const mes of [0, 13]) {
    await assert.rejects(
      servicio.obtenerResumenMensual(2026, mes, { incluir_desglose_gastos: false }),
      (error: unknown) => error instanceof ServiceError && error.code === "PERIODO_INVALIDO",
    );
  }
});
