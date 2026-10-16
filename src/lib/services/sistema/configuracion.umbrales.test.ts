/**
 * HU-D6 — `actualizarUmbralesEgresos()` (task_relos.md D10, D24), sin base de
 * datos: se transpila `configuracion.service.ts` y se le inyecta un `require`
 * con stubs (mismo patrón que `ingreso-tesoreria.listener.test.ts`), el
 * `ServiceError` y el schema Zod REALES, y una transacción en memoria que
 * registra el orden de cada operación y revierte si algo lanza.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";
import * as schema from "../../schemas/alertas-desvio.schema.ts";

const INF = "TESORERIA_ALERTA_EGRESOS_INFORMATIVA_PCT";
const ADV = "TESORERIA_ALERTA_EGRESOS_ADVERTENCIA_PCT";
const CRI = "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT";
const ADMIN = "64a0a7e3-76e2-4637-828e-f7cb96756597";

type Payload = { clave: string; valor_anterior: string; valor_nuevo: string; usuario_id: string };
type Actualizar = (umbrales: unknown, usuarioId: string, deps?: Record<string, unknown>) => Promise<{
  umbrales: Record<string, number>;
  hubo_cambio: boolean;
  claves_cambiadas: string[];
}>;

function cargarServicio(): { actualizar: Actualizar; logs: unknown[][] } {
  const logs: unknown[][] = [];
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/services/ecommerce/validacion-imagen": { FORMATOS_IMAGEN_CONOCIDOS: ["JPG", "PNG", "WEBP"] },
    "@/lib/schemas/alertas-desvio.schema": schema,
  };
  const ruta = "./configuracion.service.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  runInThisContext(`(function(require, module, exports, console) {\n${codigo}\n})`, { filename: ruta })(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) throw new Error(`Dependencia inesperada: ${nombre}`);
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
    { ...console, error: (...args: unknown[]) => logs.push(args) },
  );
  return { actualizar: modulo.exports.actualizarUmbralesEgresos as Actualizar, logs };
}

/** "Base" en memoria: transacción que revierte ante un error y bitácora de operaciones. */
function baseFalsa(inicial: Record<string, string> = { [INF]: "70", [ADV]: "85", [CRI]: "100" }) {
  let datos = { ...inicial };
  const bitacora: string[] = [];
  const eventos: Payload[] = [];
  let transacciones = 0;
  const deps = {
    ejecutarTransaccion: async <T>(fn: (repo: unknown) => Promise<T>): Promise<T> => {
      transacciones += 1;
      const copia = { ...datos };
      bitacora.push("BEGIN");
      try {
        const resultado = await fn({
          bloquearYLeer: async (clave: string) => {
            bitacora.push(`LOCK ${clave}`);
            return copia[clave] ?? null;
          },
          actualizar: async (clave: string, valor: string, usuarioId: string) => {
            bitacora.push(`UPDATE ${clave}=${valor} por ${usuarioId}`);
            copia[clave] = valor;
          },
        });
        datos = copia;
        bitacora.push("COMMIT");
        return resultado;
      } catch (error) {
        bitacora.push("ROLLBACK");
        throw error;
      }
    },
    emitir: (payload: Payload) => {
      bitacora.push(`EMIT ${payload.clave}`);
      eventos.push(payload);
    },
  };
  return { deps, bitacora, eventos, leer: () => ({ ...datos }), transacciones: () => transacciones };
}

test("conjunto válido: bloquea y escribe en orden fijo, emite post-COMMIT un evento por clave", async () => {
  const { actualizar } = cargarServicio();
  const b = baseFalsa();
  // Claves del objeto en orden inverso: el orden de escritura no depende del input.
  const r = await actualizar({ critica: 95, advertencia: 80, informativa: 60 }, ADMIN, b.deps);
  assert.deepEqual(r, {
    umbrales: { informativa: 60, advertencia: 80, critica: 95 },
    hubo_cambio: true,
    claves_cambiadas: [INF, ADV, CRI],
  });
  assert.deepEqual(b.leer(), { [INF]: "60", [ADV]: "80", [CRI]: "95" });
  assert.deepEqual(b.bitacora, [
    "BEGIN",
    `LOCK ${INF}`,
    `LOCK ${ADV}`,
    `LOCK ${CRI}`,
    `UPDATE ${INF}=60 por ${ADMIN}`,
    `UPDATE ${ADV}=80 por ${ADMIN}`,
    `UPDATE ${CRI}=95 por ${ADMIN}`,
    "COMMIT",
    `EMIT ${INF}`,
    `EMIT ${ADV}`,
    `EMIT ${CRI}`,
  ]);
  assert.deepEqual(b.eventos, [
    { clave: INF, valor_anterior: "70", valor_nuevo: "60", usuario_id: ADMIN },
    { clave: ADV, valor_anterior: "85", valor_nuevo: "80", usuario_id: ADMIN },
    { clave: CRI, valor_anterior: "100", valor_nuevo: "95", usuario_id: ADMIN },
  ]);
});

test("bordes válidos: 1/2/1000", async () => {
  const { actualizar } = cargarServicio();
  const b = baseFalsa();
  await actualizar({ informativa: 1, advertencia: 2, critica: 1000 }, ADMIN, b.deps);
  assert.deepEqual(b.leer(), { [INF]: "1", [ADV]: "2", [CRI]: "1000" });
});

const INVALIDOS: [string, unknown][] = [
  ["no entero", { informativa: 70, advertencia: 85.5, critica: 100 }],
  ["número como texto", { informativa: 70, advertencia: "85", critica: 100 }],
  ["cero", { informativa: 0, advertencia: 85, critica: 100 }],
  ["negativo", { informativa: -5, advertencia: 85, critica: 100 }],
  ["mayor a 1000", { informativa: 70, advertencia: 85, critica: 1001 }],
  ["iguales", { informativa: 70, advertencia: 70, critica: 100 }],
  ["decrecientes", { informativa: 90, advertencia: 85, critica: 100 }],
  ["crítica menor que advertencia", { informativa: 70, advertencia: 85, critica: 80 }],
  ["falta una clave", { informativa: 70, advertencia: 85 }],
  ["clave extra", { informativa: 70, advertencia: 85, critica: 100, maxima: 200 }],
  ["no es objeto", null],
  ["NaN", { informativa: Number.NaN, advertencia: 85, critica: 100 }],
];
for (const [caso, umbrales] of INVALIDOS) {
  test(`inválido (${caso}): UMBRALES_EGRESOS_INVALIDOS con fieldErrors, sin transacción ni eventos`, async () => {
    const { actualizar } = cargarServicio();
    const b = baseFalsa();
    await assert.rejects(actualizar(umbrales, ADMIN, b.deps), (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "UMBRALES_EGRESOS_INVALIDOS");
      assert.ok((error.details as { fieldErrors?: unknown })?.fieldErrors);
      return true;
    });
    assert.equal(b.transacciones(), 0);
    assert.deepEqual(b.eventos, []);
    assert.deepEqual(b.leer(), { [INF]: "70", [ADV]: "85", [CRI]: "100" });
  });
}

test("sin cambios: no escribe, no emite y devuelve hubo_cambio=false", async () => {
  const { actualizar } = cargarServicio();
  const b = baseFalsa();
  const r = await actualizar({ informativa: 70, advertencia: 85, critica: 100 }, ADMIN, b.deps);
  assert.equal(r.hubo_cambio, false);
  assert.deepEqual(r.claves_cambiadas, []);
  assert.equal(b.bitacora.filter((op) => op.startsWith("UPDATE") || op.startsWith("EMIT")).length, 0);
  assert.deepEqual(b.eventos, []);
});

test("cambio parcial: escribe y emite solo por la clave modificada", async () => {
  const { actualizar } = cargarServicio();
  const b = baseFalsa();
  const r = await actualizar({ informativa: 70, advertencia: 85, critica: 120 }, ADMIN, b.deps);
  assert.deepEqual(r.claves_cambiadas, [CRI]);
  assert.deepEqual(b.bitacora.filter((op) => op.startsWith("UPDATE")), [`UPDATE ${CRI}=120 por ${ADMIN}`]);
  assert.deepEqual(b.eventos, [{ clave: CRI, valor_anterior: "100", valor_nuevo: "120", usuario_id: ADMIN }]);
  // Se bloquean las tres filas igual: el conjunto se evalúa entero bajo el lock.
  assert.deepEqual(b.bitacora.filter((op) => op.startsWith("LOCK")), [`LOCK ${INF}`, `LOCK ${ADV}`, `LOCK ${CRI}`]);
});

test("el emisor que lanza (sync o async) no rompe la edición y los demás eventos salen igual", async () => {
  const { actualizar, logs } = cargarServicio();
  const b = baseFalsa();
  const emitidos: string[] = [];
  const r = await actualizar({ informativa: 60, advertencia: 80, critica: 95 }, ADMIN, {
    ...b.deps,
    // INF: lanza de forma síncrona · ADV: promesa rechazada · CRI: emite.
    emitir: (payload: Payload) => {
      if (payload.clave === INF) throw Object.assign(new Error("bus caído con datos"), { code: "BUS_CAIDO" });
      if (payload.clave === ADV) return Promise.reject(new Error("rechazo sin código"));
      emitidos.push(payload.clave);
      return undefined;
    },
  });
  assert.equal(r.hubo_cambio, true);
  assert.deepEqual(b.leer(), { [INF]: "60", [ADV]: "80", [CRI]: "95" });
  assert.deepEqual(emitidos, [CRI]);
  assert.deepEqual(
    logs.map(([, contexto]) => contexto),
    [
      { clave: INF, codigo_error: "BUS_CAIDO" },
      { clave: ADV, codigo_error: "ERROR_EMISION_EVENTO" },
    ],
  );
  assert.doesNotMatch(JSON.stringify(logs), /datos|rechazo/);
});

test("clave faltante en la base: CONFIGURACION_NO_ENCONTRADA, sin escrituras ni eventos", async () => {
  const { actualizar } = cargarServicio();
  const b = baseFalsa({ [INF]: "70", [CRI]: "100" });
  await assert.rejects(actualizar({ informativa: 60, advertencia: 80, critica: 95 }, ADMIN, b.deps), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, "CONFIGURACION_NO_ENCONTRADA");
    return true;
  });
  assert.equal(b.bitacora.some((op) => op.startsWith("UPDATE")), false);
  assert.equal(b.bitacora.at(-1), "ROLLBACK");
  assert.deepEqual(b.eventos, []);
});

test("si la transacción falla a mitad, no se emite nada y la base queda como estaba", async () => {
  const { actualizar } = cargarServicio();
  const b = baseFalsa();
  const deps = {
    ...b.deps,
    ejecutarTransaccion: <T>(fn: (repo: unknown) => Promise<T>) =>
      b.deps.ejecutarTransaccion((repo) =>
        fn({
          ...(repo as object),
          actualizar: async (clave: string) => {
            if (clave === ADV) throw Object.assign(new Error("deadlock"), { code: "P2034" });
            await (repo as { actualizar: (c: string, v: string, u: string) => Promise<void> }).actualizar(clave, "60", ADMIN);
          },
        }),
      ),
  };
  await assert.rejects(actualizar({ informativa: 60, advertencia: 80, critica: 95 }, ADMIN, deps));
  assert.deepEqual(b.leer(), { [INF]: "70", [ADV]: "85", [CRI]: "100" });
  assert.deepEqual(b.eventos, []);
});
