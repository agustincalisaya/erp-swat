/**
 * HU-E11 / auditoría — handlers de los cinco eventos de contenido y fotos del
 * catálogo web (task_relos.md D25). Mismo arnés que
 * `audit-log.listener.e5.test.ts`: el listener real con dependencias aisladas,
 * sin BD ni bus global, para poder inyectar un rechazo de `registrarAuditLog`.
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

const creado = {
  producto_web_id: "contenido-1",
  producto_maestro_id: "maestro-1",
  titulo_comercial: "Gorra",
  descripcion: "Gorra táctica",
  actor_id: "usuario-admin",
};
const editado = {
  producto_web_id: "contenido-1",
  producto_maestro_id: "maestro-1",
  antes: { titulo_comercial: "Gorra" },
  despues: { titulo_comercial: "Gorra Operativa" },
  actor_id: "usuario-admin",
};
const subida = {
  foto_id: "foto-2",
  producto_web_id: "contenido-1",
  url: "/api/tienda/fotos/x.jpg",
  formato: "JPG",
  tamano_bytes: 1234,
  es_principal: true,
  orden: 1,
  principal_anterior_id: "foto-1",
  actor_id: "usuario-admin",
};
const principal = { foto_id: "foto-2", producto_web_id: "contenido-1", principal_anterior_id: "foto-1", actor_id: "usuario-admin" };
const bajaFoto = {
  foto_id: "foto-2",
  producto_web_id: "contenido-1",
  deletion_reason: "Foto vieja",
  era_principal: true,
  principal_promovida_id: "foto-1",
  actor_id: "usuario-admin",
};

const base = { usuario_id: "usuario-admin", ip: "internal-event" };

for (const [evento, payload, esperado] of [
  [
    "ecommerce:contenido_web_creado",
    creado,
    {
      ...base,
      accion: "ecommerce:contenido_web_creado",
      tabla_afectada: "contenidos_producto_web",
      registro_id: "contenido-1",
      valor_anterior: null,
      valor_nuevo: { producto_maestro_id: "maestro-1", titulo_comercial: "Gorra", descripcion: "Gorra táctica", visibilidad_web: false },
    },
  ],
  [
    "ecommerce:contenido_web_editado",
    editado,
    {
      ...base,
      accion: "ecommerce:contenido_web_editado",
      tabla_afectada: "contenidos_producto_web",
      registro_id: "contenido-1",
      valor_anterior: { titulo_comercial: "Gorra" },
      valor_nuevo: { titulo_comercial: "Gorra Operativa" },
    },
  ],
  [
    "ecommerce:foto_web_subida",
    subida,
    {
      ...base,
      accion: "ecommerce:foto_web_subida",
      tabla_afectada: "fotos_producto_web",
      registro_id: "foto-2",
      valor_anterior: null,
      valor_nuevo: {
        producto_web_id: "contenido-1",
        url: "/api/tienda/fotos/x.jpg",
        formato: "JPG",
        tamano_bytes: 1234,
        es_principal: true,
        orden: 1,
        principal_anterior_id: "foto-1",
      },
    },
  ],
  [
    "ecommerce:foto_web_principal_cambiada",
    principal,
    {
      ...base,
      accion: "ecommerce:foto_web_principal_cambiada",
      tabla_afectada: "fotos_producto_web",
      registro_id: "foto-2",
      valor_anterior: { es_principal: false, principal_anterior_id: "foto-1" },
      valor_nuevo: { es_principal: true },
    },
  ],
  [
    "ecommerce:foto_web_baja",
    bajaFoto,
    {
      ...base,
      accion: "ecommerce:foto_web_baja",
      tabla_afectada: "fotos_producto_web",
      registro_id: "foto-2",
      valor_anterior: { is_active: true, es_principal: true },
      valor_nuevo: { is_active: false, deleted_by: "usuario-admin", deletion_reason: "Foto vieja", principal_promovida_id: "foto-1" },
    },
  ],
] as const) {
  test(`${evento}: asiento con el actor, acción = nombre del evento y estado antes/después`, async () => {
    const llamadas: unknown[] = [];
    const bus = cargarListener(async (p) => void llamadas.push(p));
    bus.emit(evento, payload);
    await drenar();
    assert.deepEqual(llamadas, [esperado]);
  });

  test(`${evento}: un rechazo de registrarAuditLog no produce unhandledRejection y el diagnóstico no filtra datos`, async (t) => {
    const logs: unknown[][] = [];
    const u = observarUnhandledRejection(t);
    const bus = cargarListener(rechazoConDatosSensibles, { error: (...args: unknown[]) => void logs.push(args) });
    bus.emit(evento, payload);
    await drenar();
    assert.equal(u.conteo, 0, "se produjo un unhandledRejection");
    assert.equal(logs.length, 1);
    assert.match(String(logs[0][0]), new RegExp(`Falló la escritura de auditoría para ${evento}`));
    assert.deepEqual(logs[0][1], { registro_id: esperado.registro_id, codigo_error: "ERROR_ESCRITURA_AUDITORIA" });
    const salida = JSON.stringify(logs);
    for (const marcador of ["clave-secreta", "30123456", "postgresql://"]) {
      assert.equal(salida.includes(marcador), false, marcador);
    }
  });
}
