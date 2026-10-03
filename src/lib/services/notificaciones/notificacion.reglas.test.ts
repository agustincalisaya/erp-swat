import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  armarPaginacion,
  calcularClaveIdempotencia,
  DEFAULT_NOTIFICATION_TEXT,
  ejecutarMotorNotificaciones,
  esViolacionUnicidad,
  renderizarPlantilla,
  type GenerarNotificacionesInput,
  type NotificacionNueva,
  type PlantillaParaMotor,
  type PuertosMotorNotificaciones,
} from "./notificacion.reglas.ts";

test("clave de idempotencia: determinística por (evento, registro, destinatario)", () => {
  const a = calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-1", "cuenta-1");
  assert.equal(a, calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-1", "cuenta-1"));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-2", "cuenta-1"));
  assert.notEqual(a, calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-1", "cuenta-2"));
});

test("clave de idempotencia: misma fórmula que los fixtures del seed (sha256 de tipo:registro:destinatario)", async () => {
  const { createHash } = await import("node:crypto");
  assert.equal(
    calcularClaveIdempotencia("t", "r", "d"),
    createHash("sha256").update("t:r:d").digest("hex"),
  );
});

test("renderizado: reemplaza placeholders y deja vacío lo que falta, sin lanzar (spec F §3.2)", () => {
  assert.equal(
    renderizarPlantilla("El artículo {{sku}} ({{ motivo }}) — {{inexistente}}.", { sku: "CAMTAC-1", motivo: "SKU_INACTIVO" }),
    "El artículo CAMTAC-1 (SKU_INACTIVO) — .",
  );
  assert.equal(renderizarPlantilla("{{a}}{{a}}", { a: 1 }), "11");
  assert.equal(renderizarPlantilla("sin placeholders", {}), "sin placeholders");
});

// ── HU-F3 — Motor (task §7 Nivel 1), con un "prisma" falso inyectado ──────────

const ENCARGADO_SEED_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";
const STOCK_CT1_CENTRAL_ID = "ec3dfab3-aae7-431f-a08d-c0aca9b21c5e";

const PLANTILLA_UMBRAL: PlantillaParaMotor = {
  id: "plantilla-umbral",
  asunto: "Stock en umbral crítico",
  cuerpo: "Quedan {{cantidad_resultante}} unidades (punto de pedido {{punto_pedido}}){{inexistente}}.",
  prioridad_default: "ADVERTENCIA",
};

function fake(opciones: {
  activos?: string[];
  porRol?: Record<string, string[]>;
  plantilla?: PlantillaParaMotor | null;
  fallarPara?: Record<string, unknown>;
} = {}) {
  const creadas: NotificacionNueva[] = [];
  const puertos: PuertosMotorNotificaciones = {
    usuariosActivos: async (ids) => ids.filter((id) => (opciones.activos ?? ids).includes(id)),
    usuariosPorRoles: async (roles) => roles.flatMap((rol) => opciones.porRol?.[rol] ?? []),
    plantillaActiva: async () => opciones.plantilla ?? null,
    crearNotificacion: async (data) => {
      const destino = data.usuario_destinatario_id ?? data.cuenta_cliente_web_destinatario_id!;
      if (opciones.fallarPara && destino in opciones.fallarPara) throw opciones.fallarPara[destino];
      creadas.push(data);
    },
  };
  return { puertos, creadas };
}

const ENTRADA_UMBRAL: GenerarNotificacionesInput = {
  tipo_evento: "stock:umbral_critico_alcanzado",
  clave_origen: `mov-1:${STOCK_CT1_CENTRAL_ID}`,
  variables: { cantidad_resultante: 7, punto_pedido: 8 },
  prioridad_default: "ADVERTENCIA",
  destinatarios: { roles: ["ENCARGADO_DEPOSITO"] },
};

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

test("motor: clave determinística = sha256(tipo:clave_origen:destinatario), fórmula del seed", async () => {
  const f = fake({ porRol: { ENCARGADO_DEPOSITO: [ENCARGADO_SEED_ID] }, plantilla: PLANTILLA_UMBRAL });
  await ejecutarMotorNotificaciones(ENTRADA_UMBRAL, f.puertos);
  assert.equal(
    f.creadas[0]!.clave_idempotencia,
    sha256(`stock:umbral_critico_alcanzado:mov-1:${STOCK_CT1_CENTRAL_ID}:${ENCARGADO_SEED_ID}`),
  );
});

test("motor (Punto abierto 5): clave por registro_id choca con la fila sembrada; por movimiento no", () => {
  // Fixture del seed: sha256(stock:umbral_critico_alcanzado:STOCK_CT1_CENTRAL:encargado).
  const sembrada = sha256(`stock:umbral_critico_alcanzado:${STOCK_CT1_CENTRAL_ID}:${ENCARGADO_SEED_ID}`);
  assert.equal(
    calcularClaveIdempotencia("stock:umbral_critico_alcanzado", STOCK_CT1_CENTRAL_ID, ENCARGADO_SEED_ID),
    sembrada,
  );
  assert.notEqual(
    calcularClaveIdempotencia("stock:umbral_critico_alcanzado", `mov-1:${STOCK_CT1_CENTRAL_ID}`, ENCARGADO_SEED_ID),
    sembrada,
  );
});

test("motor: con plantilla → texto renderizado, prioridad y plantilla_id de la plantilla; variable faltante vacía", async () => {
  const f = fake({
    porRol: { ENCARGADO_DEPOSITO: [ENCARGADO_SEED_ID] },
    plantilla: { ...PLANTILLA_UMBRAL, prioridad_default: "CRITICA" },
  });
  const r = await ejecutarMotorNotificaciones(ENTRADA_UMBRAL, f.puertos);
  assert.deepEqual(r, { creadas: 1, duplicadas: 0, fallidas: 0 });
  assert.equal(f.creadas[0]!.plantilla_id, "plantilla-umbral");
  assert.equal(f.creadas[0]!.prioridad, "CRITICA");
  assert.equal(f.creadas[0]!.asunto, "Stock en umbral crítico");
  assert.equal(f.creadas[0]!.cuerpo, "Quedan 7 unidades (punto de pedido 8).");
});

test("motor: sin plantilla → DEFAULT_NOTIFICATION_TEXT, plantilla_id null y prioridad de la suscripción", async () => {
  const f = fake({ porRol: { ADMINISTRADOR: ["admin-1"] } });
  await ejecutarMotorNotificaciones(
    {
      tipo_evento: "usuario:suspendido_automaticamente",
      clave_origen: "vendedor-1:2026-10-03T12:00:00.000Z",
      variables: {},
      prioridad_default: "CRITICA",
      destinatarios: { usuario_ids: ["vendedor-1"], roles: ["ADMINISTRADOR"] },
    },
    f.puertos,
  );
  assert.deepEqual(f.creadas.map((n) => n.usuario_destinatario_id), ["vendedor-1", "admin-1"]);
  for (const n of f.creadas) {
    assert.equal(n.plantilla_id, null);
    assert.equal(n.asunto, DEFAULT_NOTIFICATION_TEXT.asunto);
    assert.equal(n.cuerpo, DEFAULT_NOTIFICATION_TEXT.cuerpo);
    assert.equal(n.prioridad, "CRITICA");
  }
});

test("motor: OPERADOR_PICK_PACK se expande como grupo destinatario sin duplicados", async () => {
  const f = fake({ porRol: { OPERADOR_PICK_PACK: ["operador-1", "operador-1"] } });
  await ejecutarMotorNotificaciones(
    {
      tipo_evento: "ecommerce:pedido_admitido_cola",
      clave_origen: "evento-admision-1",
      variables: { pedido_venta_id: "pedido-1" },
      prioridad_default: "INFORMATIVA",
      destinatarios: { roles: ["OPERADOR_PICK_PACK"] },
    },
    f.puertos,
  );
  assert.deepEqual(f.creadas.map((n) => n.usuario_destinatario_id), ["operador-1"]);
});

test("motor: expansión de rol sin duplicados (usuario explícito que además tiene el rol)", async () => {
  const f = fake({ porRol: { ADMINISTRADOR: ["admin-1", "u-1"], AUDITOR: ["admin-1"] } });
  await ejecutarMotorNotificaciones(
    { ...ENTRADA_UMBRAL, destinatarios: { usuario_ids: ["u-1", "u-1"], roles: ["ADMINISTRADOR", "AUDITOR"] } },
    f.puertos,
  );
  assert.deepEqual(f.creadas.map((n) => n.usuario_destinatario_id).sort(), ["admin-1", "u-1"]);
  assert.equal(new Set(f.creadas.map((n) => n.clave_idempotencia)).size, 2);
});

test("motor: usuario explícito dado de baja se descarta", async () => {
  const f = fake({ activos: ["u-activo"] });
  await ejecutarMotorNotificaciones(
    { ...ENTRADA_UMBRAL, destinatarios: { usuario_ids: ["u-activo", "u-baja"] } },
    f.puertos,
  );
  assert.deepEqual(f.creadas.map((n) => n.usuario_destinatario_id), ["u-activo"]);
});

test("motor: P2002 → no-op contado como duplicada, sin excepción ni log", async () => {
  const logs: string[] = [];
  const f = fake({ porRol: { R: ["u-1", "u-2"] }, fallarPara: { "u-1": { code: "P2002" } } });
  const r = await ejecutarMotorNotificaciones(
    { ...ENTRADA_UMBRAL, destinatarios: { roles: ["R"] } },
    f.puertos,
    (m) => logs.push(m),
  );
  assert.deepEqual(r, { creadas: 1, duplicadas: 1, fallidas: 0 });
  assert.equal(logs.length, 0);
});

test("motor: error genérico en un destinatario no corta a los demás ni se propaga", async () => {
  const logs: string[] = [];
  const f = fake({ porRol: { R: ["u-1", "u-2", "u-3"] }, fallarPara: { "u-2": new Error("FK") } });
  const r = await ejecutarMotorNotificaciones(
    { ...ENTRADA_UMBRAL, destinatarios: { roles: ["R"] } },
    f.puertos,
    (m) => logs.push(m),
  );
  assert.deepEqual(r, { creadas: 2, duplicadas: 0, fallidas: 1 });
  assert.deepEqual(f.creadas.map((n) => n.usuario_destinatario_id), ["u-1", "u-3"]);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /stock:umbral_critico_alcanzado.*USUARIO u-2/);
});

test("motor: si falla la resolución (BD caída) loguea y devuelve sin lanzar", async () => {
  const logs: string[] = [];
  const f = fake();
  f.puertos.usuariosPorRoles = async () => {
    throw new Error("conexión rechazada");
  };
  const r = await ejecutarMotorNotificaciones(ENTRADA_UMBRAL, f.puertos, (m) => logs.push(m));
  assert.deepEqual(r, { creadas: 0, duplicadas: 0, fallidas: 0 });
  assert.equal(logs.length, 1);
});

test("motor: destinatario CLIENTE_WEB escribe solo cuenta_cliente_web_destinatario_id", async () => {
  const f = fake();
  await ejecutarMotorNotificaciones(
    { ...ENTRADA_UMBRAL, destinatarios: { cuenta_cliente_web_ids: ["cuenta-1"] } },
    f.puertos,
  );
  assert.equal(f.creadas.length, 1);
  assert.equal(f.creadas[0]!.cuenta_cliente_web_destinatario_id, "cuenta-1");
  assert.equal("usuario_destinatario_id" in f.creadas[0]!, false);
});

test("motor: sin destinatarios no consulta plantilla ni crea nada", async () => {
  const f = fake();
  let consultada = false;
  f.puertos.plantillaActiva = async () => {
    consultada = true;
    return null;
  };
  const r = await ejecutarMotorNotificaciones(
    { ...ENTRADA_UMBRAL, destinatarios: { roles: ["SIN_USUARIOS"] } },
    f.puertos,
  );
  assert.deepEqual(r, { creadas: 0, duplicadas: 0, fallidas: 0 });
  assert.equal(consultada, false);
});

test("esViolacionUnicidad: solo P2002", () => {
  assert.equal(esViolacionUnicidad({ code: "P2002" }), true);
  assert.equal(esViolacionUnicidad({ code: "P2003" }), false);
  assert.equal(esViolacionUnicidad(new Error("x")), false);
  assert.equal(esViolacionUnicidad(null), false);
});

test("paginación: shape del spec F §2.3", () => {
  assert.deepEqual(armarPaginacion(23, 1, 20), { total: 23, pagina_actual: 1, total_paginas: 2, por_pagina: 20 });
  assert.equal(armarPaginacion(0, 1, 20).total_paginas, 1);
});
