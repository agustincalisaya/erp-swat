/**
 * HU-D6 — listener de reevaluación de alertas (task_relos.md D6, D17, Paso 4B).
 *
 * Carga el listener real con dependencias aisladas (sin BD ni bus global),
 * mismo patrón que `ingreso-tesoreria.listener.test.ts`: se transpila el
 * módulo y se le inyecta un `require` con un bus propio, un servicio espía y
 * los disparadores REALES. Verifica: cada evento llama a la función correcta
 * con origen EVENTO y sin actor; un servicio que lanza no propaga el error y
 * los objetivos siguientes se procesan; registro único; no escucha
 * `stock:umbrales_configurados`; el log no expone mensajes de error.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import * as disparadores from "../../services/alertas/alerta-desvio.disparadores.ts";

type Llamada = { funcion: "evaluarStock" | "evaluarEgresos"; objetivo: Record<string, unknown>; opciones: Record<string, unknown> };

interface Fixture {
  bus: EventEmitter;
  llamadas: Llamada[];
  logs: unknown[][];
  iniciar: (deps?: Record<string, unknown>) => void;
  pendientes: () => Promise<void>;
}

interface ServicioFalso {
  evaluarStock?: (objetivo: Record<string, unknown>) => Promise<unknown>;
  evaluarEgresos?: (objetivo: Record<string, unknown>) => Promise<unknown>;
}

function cargarFixture(servicio: ServicioFalso = {}): Fixture {
  const bus = new EventEmitter();
  const llamadas: Llamada[] = [];
  const logs: unknown[][] = [];
  const registrar =
    (funcion: Llamada["funcion"], implementacion?: (objetivo: Record<string, unknown>) => Promise<unknown>) =>
    async (objetivo: Record<string, unknown>, opciones: Record<string, unknown>) => {
      llamadas.push({ funcion, objetivo, opciones });
      return implementacion ? implementacion(objetivo) : { estado: "EVALUADO" };
    };
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/services/alertas/alerta-desvio.disparadores": disparadores,
    "@/lib/services/alertas/alerta-desvio.service": {
      evaluarStock: registrar("evaluarStock", servicio.evaluarStock),
      evaluarEgresos: registrar("evaluarEgresos", servicio.evaluarEgresos),
    },
  };
  const ruta = "./alerta-desvio.listener.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const ejecutar = runInThisContext(`(function(require, module, exports, console) {\n${codigo}\n})`, { filename: ruta });
  ejecutar(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) throw new Error(`Dependencia inesperada: ${nombre}`);
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
    { ...console, error: (...args: unknown[]) => logs.push(args) },
  );
  return {
    bus,
    llamadas,
    logs,
    iniciar: modulo.exports.iniciarAlertaDesvioListener as Fixture["iniciar"],
    pendientes: modulo.exports.alertasPendientes as Fixture["pendientes"],
  };
}

const VAR_A = "11111111-1111-4111-8111-111111111111";
const VAR_B = "22222222-2222-4222-8222-222222222222";
const DEP_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEP_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const gasto = { gasto_operativo_id: "g", categoria_gasto_id: "c", monto: "1.00", usuario_id: "u" };
const datosGasto = (fecha: string) => ({ categoria_gasto_id: "c", fecha, monto: "1.00", descripcion: "d" });

const leerReservaFija = async (reservaId: string) =>
  reservaId === "r-ok" ? { varianteSkuId: VAR_B, depositoId: DEP_2 } : null;

test("cada evento llama a la función correcta con origen EVENTO y sin actor", async () => {
  const f = cargarFixture();
  f.iniciar({ leerReserva: leerReservaFija });

  const casos: [string, unknown, Llamada["funcion"], Record<string, unknown>[]][] = [
    ["gasto_operativo:creado", { ...gasto, fecha: "2099-03-10" }, "evaluarEgresos", [{ anio: 2099, mes: 3 }]],
    ["gasto_operativo:dado_de_baja", { ...gasto, fecha: "2099-02-10", motivo: "x" }, "evaluarEgresos", [{ anio: 2099, mes: 2 }]],
    [
      "gasto_operativo:editado",
      { ...gasto, fecha: "2099-02-20", valor_anterior: datosGasto("2099-03-10"), valor_nuevo: datosGasto("2099-02-20") },
      "evaluarEgresos",
      [{ anio: 2099, mes: 3 }, { anio: 2099, mes: 2 }],
    ],
    ["cuenta_por_pagar:estado_cambiado", { accion: "PAGAR", fecha_pago: "2099-03-15T15:00:00.000Z" }, "evaluarEgresos", [{ anio: 2099, mes: 3 }]],
    [
      "stock:umbral_critico_alcanzado",
      { variante_sku_id: VAR_A, deposito_id: DEP_1, stock_deposito_id: "s", cantidad_resultante: 1, punto_pedido: 5, movimiento_id_origen: "m" },
      "evaluarStock",
      [{ varianteSkuId: VAR_A, depositoId: DEP_1 }],
    ],
    [
      "inventario:ingreso_stock_registrado",
      { deposito_destino_id: DEP_2, items: [{ variante_sku_id: VAR_A }, { variante_sku_id: VAR_B }, { variante_sku_id: VAR_A }] },
      "evaluarStock",
      [{ varianteSkuId: VAR_A, depositoId: DEP_2 }, { varianteSkuId: VAR_B, depositoId: DEP_2 }],
    ],
    [
      "stock:transferencia_iniciada",
      { deposito_origen_id: DEP_1, deposito_destino_id: DEP_2, items: [{ variante_sku_id: VAR_A }] },
      "evaluarStock",
      [{ varianteSkuId: VAR_A, depositoId: DEP_1 }],
    ],
    [
      "stock:transferencia_recepcion_confirmada",
      { deposito_origen_id: DEP_1, deposito_destino_id: DEP_2, items: [{ variante_sku_id: VAR_A }] },
      "evaluarStock",
      [{ varianteSkuId: VAR_A, depositoId: DEP_2 }],
    ],
    ["stock:reserva_congelada", { reserva_id: "r", variante_sku_id: VAR_B, deposito_id: DEP_1 }, "evaluarStock", [{ varianteSkuId: VAR_B, depositoId: DEP_1 }]],
    [
      "stock:reclasificacion_devuelto",
      { variante_sku_id: VAR_A, deposito_id: DEP_1, estado_destino: "DISPONIBLE" },
      "evaluarStock",
      [{ varianteSkuId: VAR_A, depositoId: DEP_1 }],
    ],
    [
      "stock:reserva_liberada",
      { reserva_id: "r-ok", motivo_liberacion: "TTL_VENCIDO", variante_sku_id: VAR_B },
      "evaluarStock",
      [{ varianteSkuId: VAR_B, depositoId: DEP_2 }],
    ],
  ];

  for (const [evento, payload, funcion, objetivos] of casos) {
    f.llamadas.length = 0;
    f.bus.emit(evento, payload);
    await f.pendientes();
    assert.deepEqual(
      f.llamadas.map((l) => l.funcion),
      objetivos.map(() => funcion),
      evento,
    );
    assert.deepEqual(f.llamadas.map((l) => l.objetivo), objetivos, evento);
    for (const l of f.llamadas) {
      assert.equal(l.opciones.origen, "EVENTO", evento);
      assert.equal("usuarioId" in l.opciones, false, `${evento}: el actor es siempre null`);
    }
  }
  assert.deepEqual(f.logs, []);
});

test("eventos que no producen objetivos no llaman al servicio", async () => {
  const f = cargarFixture();
  f.iniciar({ leerReserva: leerReservaFija });
  f.bus.emit("cuenta_por_pagar:estado_cambiado", { accion: "DEFINIR", fecha_pago: null });
  f.bus.emit("stock:reserva_liberada", { reserva_id: "r-ok", motivo_liberacion: "VENTA", variante_sku_id: VAR_B });
  f.bus.emit("stock:reclasificacion_devuelto", { variante_sku_id: VAR_A, deposito_id: DEP_1, estado_destino: "BAJA_MERMA" });
  f.bus.emit("gasto_operativo:creado", { ...gasto, fecha: "no-es-fecha" });
  await f.pendientes();
  assert.deepEqual(f.llamadas, []);
});

test("no escucha stock:umbrales_configurados", () => {
  const f = cargarFixture();
  f.iniciar();
  assert.equal(f.bus.listenerCount("stock:umbrales_configurados"), 0);
  assert.equal(f.bus.listenerCount("gasto_operativo:creado"), 1);
});

test("un servicio que lanza no propaga el error y los objetivos siguientes se procesan", async () => {
  const f = cargarFixture({
    evaluarStock: async (objetivo) => {
      if (objetivo.varianteSkuId === VAR_A) {
        throw Object.assign(new Error("dato sensible: CBU 0000003100000000000000"), { code: "ALERTA_CONCURRENCIA_AGOTADA" });
      }
      return { transicion: "NADA" };
    },
  });
  f.iniciar({ leerReserva: leerReservaFija });

  assert.doesNotThrow(() =>
    f.bus.emit("inventario:ingreso_stock_registrado", {
      deposito_destino_id: DEP_1,
      items: [{ variante_sku_id: VAR_A }, { variante_sku_id: VAR_B }],
    }),
  );
  await f.pendientes();

  assert.deepEqual(
    f.llamadas.map((l) => l.objetivo.varianteSkuId),
    [VAR_A, VAR_B],
    "VAR_B se evalúa aunque VAR_A haya fallado",
  );
  assert.equal(f.logs.length, 1);
  const [, contexto] = f.logs[0] as [string, Record<string, unknown>];
  assert.deepEqual(contexto, {
    evento: "inventario:ingreso_stock_registrado",
    referencia: `${VAR_A}:${DEP_1}`,
    codigo_error: "ALERTA_CONCURRENCIA_AGOTADA",
  });
  assert.doesNotMatch(JSON.stringify(f.logs), /CBU|sensible/);
});

test("ERROR_FUENTE de egresos y fallos de la relectura de la Reserva se loguean y no cortan", async () => {
  const f = cargarFixture({
    evaluarEgresos: async (objetivo) => ({
      estado: "ERROR_FUENTE",
      referencia: `${objetivo.anio}-0${objetivo.mes}`,
      codigo_error: "G14_NO_DISPONIBLE",
    }),
  });
  let lecturas = 0;
  f.iniciar({
    leerReserva: async (reservaId: string) => {
      lecturas += 1;
      if (reservaId === "r-explota") throw Object.assign(new Error("conexión caída"), { code: "P1001" });
      return leerReservaFija(reservaId);
    },
  });

  f.bus.emit("gasto_operativo:creado", { ...gasto, fecha: "2099-03-10" });
  f.bus.emit("stock:reserva_liberada", { reserva_id: "r-explota", motivo_liberacion: "PAGO_RECHAZADO", variante_sku_id: VAR_A });
  f.bus.emit("stock:reserva_liberada", { reserva_id: "r-inexistente", motivo_liberacion: "TTL_VENCIDO", variante_sku_id: VAR_A });
  f.bus.emit("stock:reserva_liberada", { reserva_id: "r-ok", motivo_liberacion: "ANULACION_ORDEN", variante_sku_id: VAR_B });
  await f.pendientes();

  assert.equal(lecturas, 3);
  assert.deepEqual(
    f.llamadas.map((l) => l.funcion),
    ["evaluarEgresos", "evaluarStock"],
    "solo la reserva encontrada llega a evaluarStock",
  );
  const codigos = f.logs.map(([, contexto]) => (contexto as { codigo_error: string }).codigo_error).sort();
  assert.deepEqual(codigos, ["G14_NO_DISPONIBLE", "P1001", "RESERVA_NO_ENCONTRADA"]);
  assert.doesNotMatch(JSON.stringify(f.logs), /conexión caída/);
});

test("los objetivos de un mismo evento se evalúan en serie (nunca dos a la vez)", async () => {
  let enCurso = 0;
  let maximo = 0;
  const f = cargarFixture({
    evaluarStock: async () => {
      enCurso += 1;
      maximo = Math.max(maximo, enCurso);
      await new Promise((resolver) => setTimeout(resolver, 5));
      enCurso -= 1;
      return { transicion: "NADA" };
    },
  });
  f.iniciar({ leerReserva: leerReservaFija });
  f.bus.emit("inventario:ingreso_stock_registrado", {
    deposito_destino_id: DEP_1,
    items: [{ variante_sku_id: VAR_A }, { variante_sku_id: VAR_B }, { variante_sku_id: "33333333-3333-4333-8333-333333333333" }],
  });
  await f.pendientes();
  assert.equal(f.llamadas.length, 3);
  assert.equal(maximo, 1);
});

test("registro único: dos llamadas a iniciar dejan un solo handler por evento", async () => {
  const f = cargarFixture();
  f.iniciar({ leerReserva: leerReservaFija });
  f.iniciar({ leerReserva: leerReservaFija });
  for (const evento of [
    "gasto_operativo:creado",
    "gasto_operativo:editado",
    "gasto_operativo:dado_de_baja",
    "cuenta_por_pagar:estado_cambiado",
    "stock:umbral_critico_alcanzado",
    "inventario:ingreso_stock_registrado",
    "stock:transferencia_iniciada",
    "stock:transferencia_recepcion_confirmada",
    "stock:reserva_congelada",
    "stock:reserva_liberada",
    "stock:reclasificacion_devuelto",
  ]) {
    assert.equal(f.bus.listenerCount(evento), 1, evento);
  }
  f.bus.emit("gasto_operativo:creado", { ...gasto, fecha: "2099-03-10" });
  await f.pendientes();
  assert.equal(f.llamadas.length, 1);
});
