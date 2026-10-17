/**
 * HU-E5 / auditoría — handlers de `ecommerce:visibilidad_web_cambiada`,
 * `ecommerce:contenido_web_baja` y el ajuste de `carrito_articulo_no_disponible`
 * (task_relos.md D6, D12, D13). Mismo arnés que `audit-log.listener.test.ts`
 * (HU-E4): el listener real con dependencias aisladas, sin BD ni bus global,
 * para poder inyectar un rechazo de `registrarAuditLog`.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";

interface Bus extends EventEmitter {
  emit: (event: string, payload: unknown) => boolean;
}

function cargarListener(
  registrarAuditLog: (params: unknown) => Promise<void>,
  consola: { error: (...args: unknown[]) => void } = console,
): Bus {
  const bus: Bus = new EventEmitter() as Bus;
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/services/auditoria/audit-log.service": { registrarAuditLog },
  };
  const ruta = "./audit-log.listener.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: { iniciarAuditLogListener?: () => void } } = { exports: {} };
  runInThisContext(`(function(require, module, exports, console) {\n${codigo}\n})`, { filename: ruta })(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) throw new Error(`Dependencia inesperada: ${nombre}`);
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
    consola,
  );
  modulo.exports.iniciarAuditLogListener!();
  return bus;
}

function observarUnhandledRejection(t: TestContext): { readonly conteo: number } {
  const estado = { conteo: 0 };
  const handler = () => {
    estado.conteo += 1;
  };
  process.on("unhandledRejection", handler);
  t.after(() => {
    process.off("unhandledRejection", handler);
  });
  return {
    get conteo() {
      return estado.conteo;
    },
  };
}

const drenar = () => new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
const rechazoConDatosSensibles = () =>
  new Promise<void>((_, reject) => {
    setImmediate(() => reject(Object.assign(new Error("postgresql://u:clave-secreta@db DNI 30123456"), { meta: { dni: "30123456" } })));
  });

const visibilidad = {
  producto_web_id: "contenido-1",
  producto_maestro_id: "maestro-1",
  visibilidad_anterior: true,
  visibilidad_nueva: false,
  motivo: "Fin de temporada",
  actor_id: "usuario-admin",
};
const baja = {
  producto_web_id: "contenido-1",
  producto_maestro_id: "maestro-1",
  deletion_reason: "Discontinuado",
  actor_id: "usuario-admin",
};
const articuloBase = {
  carrito_id: "carrito-1",
  carrito_item_id: "item-1",
  variante_sku_id: "variante-1",
  sku: "SKU-1",
  motivo: "NO_VISIBLE_WEB",
  cliente_web_cuenta_id: "cuenta-1",
};

test("visibilidad_web_cambiada: asiento con el actor, acción = nombre del evento y estado antes/después", async () => {
  const llamadas: unknown[] = [];
  const bus = cargarListener(async (p) => void llamadas.push(p));
  bus.emit("ecommerce:visibilidad_web_cambiada", visibilidad);
  await drenar();
  assert.deepEqual(llamadas, [
    {
      usuario_id: "usuario-admin",
      accion: "ecommerce:visibilidad_web_cambiada",
      tabla_afectada: "contenidos_producto_web",
      registro_id: "contenido-1",
      ip: "internal-event",
      valor_anterior: { visibilidad_web: true },
      valor_nuevo: { visibilidad_web: false, motivo: "Fin de temporada", producto_maestro_id: "maestro-1" },
    },
  ]);
});

test("contenido_web_baja: asiento de baja lógica con actor y motivo", async () => {
  const llamadas: unknown[] = [];
  const bus = cargarListener(async (p) => void llamadas.push(p));
  bus.emit("ecommerce:contenido_web_baja", baja);
  await drenar();
  assert.deepEqual(llamadas, [
    {
      usuario_id: "usuario-admin",
      accion: "ecommerce:contenido_web_baja",
      tabla_afectada: "contenidos_producto_web",
      registro_id: "contenido-1",
      ip: "internal-event",
      valor_anterior: { is_active: true },
      valor_nuevo: {
        is_active: false,
        deleted_by: "usuario-admin",
        deletion_reason: "Discontinuado",
        visibilidad_web: false,
        producto_maestro_id: "maestro-1",
      },
    },
  ]);
});

test("carrito_articulo_no_disponible sin origen o con CHECKOUT: mismo asiento que HU-E1 (CHECKOUT_BLOQUEADO)", async () => {
  for (const origen of [undefined, "CHECKOUT"]) {
    const llamadas: unknown[] = [];
    const bus = cargarListener(async (p) => void llamadas.push(p));
    bus.emit("ecommerce:carrito_articulo_no_disponible", origen ? { ...articuloBase, origen } : articuloBase);
    await drenar();
    assert.deepEqual(
      llamadas,
      [
        {
          usuario_id: null,
          accion: "CHECKOUT_BLOQUEADO",
          tabla_afectada: "items_carrito_web",
          registro_id: "item-1",
          ip: "internal-event",
          valor_anterior: null,
          valor_nuevo: { carrito_id: "carrito-1", variante_sku_id: "variante-1", motivo: "NO_VISIBLE_WEB", cliente_web_cuenta_id: "cuenta-1" },
        },
      ],
      String(origen),
    );
  }
});

test("carrito_articulo_no_disponible con origen VISIBILIDAD_WEB: etiqueta propia e incluye origen", async () => {
  const llamadas: unknown[] = [];
  const bus = cargarListener(async (p) => void llamadas.push(p));
  bus.emit("ecommerce:carrito_articulo_no_disponible", { ...articuloBase, origen: "VISIBILIDAD_WEB" });
  await drenar();
  assert.deepEqual(llamadas, [
    {
      usuario_id: null,
      accion: "ARTICULO_NO_DISPONIBLE_VISIBILIDAD_WEB",
      tabla_afectada: "items_carrito_web",
      registro_id: "item-1",
      ip: "internal-event",
      valor_anterior: null,
      valor_nuevo: {
        carrito_id: "carrito-1",
        variante_sku_id: "variante-1",
        motivo: "NO_VISIBLE_WEB",
        cliente_web_cuenta_id: "cuenta-1",
        origen: "VISIBILIDAD_WEB",
      },
    },
  ]);
});

for (const [evento, payload, clave] of [
  ["ecommerce:visibilidad_web_cambiada", visibilidad, { producto_web_id: "contenido-1" }],
  ["ecommerce:contenido_web_baja", baja, { producto_web_id: "contenido-1" }],
  ["ecommerce:carrito_articulo_no_disponible", articuloBase, { carrito_item_id: "item-1" }],
  ["ecommerce:carrito_articulo_no_disponible", { ...articuloBase, origen: "VISIBILIDAD_WEB" }, { carrito_item_id: "item-1" }],
] as const) {
  test(`${evento}${"origen" in payload ? " (VISIBILIDAD_WEB)" : ""}: un rechazo de registrarAuditLog no produce unhandledRejection y el diagnóstico no filtra datos`, async (t) => {
    const logs: unknown[][] = [];
    const u = observarUnhandledRejection(t);
    const bus = cargarListener(rechazoConDatosSensibles, { error: (...args: unknown[]) => void logs.push(args) });
    bus.emit(evento, payload);
    await drenar();
    assert.equal(u.conteo, 0, "se produjo un unhandledRejection");
    assert.equal(logs.length, 1);
    assert.match(String(logs[0][0]), new RegExp(`Falló la escritura de auditoría para ${evento}`));
    assert.deepEqual(logs[0][1], { ...clave, codigo_error: "ERROR_ESCRITURA_AUDITORIA" });
    const salida = JSON.stringify(logs);
    for (const marcador of ["clave-secreta", "30123456", "postgresql://"]) {
      assert.equal(salida.includes(marcador), false, marcador);
    }
  });
}
