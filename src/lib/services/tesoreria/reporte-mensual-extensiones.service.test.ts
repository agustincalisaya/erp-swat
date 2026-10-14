/**
 * Sprint 5 · PR 0 (complemento) — stub de `obtenerBloquesAdicionales` (contrato de HU-G15).
 *
 * Carga el service real con dependencias aisladas (sin BD), mismo patrón que
 * `reporte-mensual.service.test.ts`. Cuando el Cluster 6 reemplace el stub,
 * este test se adapta a la lógica real.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";
import * as fechaNegocio from "../../utils/fecha-negocio.ts";

interface Servicio {
  obtenerBloquesAdicionales: (anio: number, mes: number, opciones: { incluir_desglose_gastos: boolean }) => Promise<unknown[]>;
}

function cargarServicio(): Servicio {
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/utils/fecha-negocio": fechaNegocio,
  };
  const ruta = "./reporte-mensual-extensiones.service.ts";
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

test("stub: devuelve una lista vacía de bloques", async () => {
  const bloques = await servicio.obtenerBloquesAdicionales(2026, 10, { incluir_desglose_gastos: true });
  assert.deepEqual(bloques, []);
});

test("stub: un mes inválido se rechaza con ServiceError PERIODO_INVALIDO", async () => {
  for (const mes of [0, 13]) {
    await assert.rejects(
      servicio.obtenerBloquesAdicionales(2026, mes, { incluir_desglose_gastos: false }),
      (error: unknown) => error instanceof ServiceError && error.code === "PERIODO_INVALIDO",
    );
  }
});
