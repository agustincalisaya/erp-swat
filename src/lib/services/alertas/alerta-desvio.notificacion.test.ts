import assert from "node:assert/strict";
import test from "node:test";
import {
  ejecutarMotorNotificaciones,
  renderizarPlantilla,
  type NotificacionNueva,
  type PuertosMotorNotificaciones,
} from "../notificaciones/notificacion.reglas.ts";
import {
  etiquetaMes,
  notificacionDeAlerta,
  PERMISO_LEER_ALERTAS,
  PLANTILLAS_NOTIFICACION_ALERTA,
  prioridadDeSeveridad,
  variablesNotificacionAlerta,
  type TransicionAlertaNotificable,
} from "./alerta-desvio.notificacion.ts";
import type { SeveridadAlerta } from "./alerta-desvio.reglas.ts";

const SEVERIDADES: readonly SeveridadAlerta[] = ["CRITICA", "ADVERTENCIA", "INFORMATIVA"];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const egresos = (anterior: SeveridadAlerta | null, nueva: SeveridadAlerta | null): TransicionAlertaNotificable => ({
  evento_id: "0f0e0d0c-0b0a-4908-8706-050403020100",
  indicador: "EGRESOS_SOBRE_INGRESOS",
  referencia: "2026-10",
  severidad_anterior: anterior,
  severidad_nueva: nueva,
  detalle: { cantidad_actual: null, punto_pedido: null, porcentaje_egresos: 78.4, umbral_aplicado: 70 },
});

const stock = (anterior: SeveridadAlerta | null, nueva: SeveridadAlerta | null): TransicionAlertaNotificable => ({
  evento_id: "1f1e1d1c-1b1a-4918-8716-151413121110",
  indicador: "STOCK_BAJO_PUNTO_PEDIDO",
  referencia: "11111111-1111-4111-8111-111111111111:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  severidad_anterior: anterior,
  severidad_nueva: nueva,
  detalle: { cantidad_actual: 0, punto_pedido: 5, porcentaje_egresos: null, umbral_aplicado: null },
});

// ── Mapeo severidad → prioridad (explícito, no por posición) ─────────────────

test("prioridadDeSeveridad: mapeo explícito de las tres severidades", () => {
  assert.equal(prioridadDeSeveridad("CRITICA"), "CRITICA");
  assert.equal(prioridadDeSeveridad("ADVERTENCIA"), "ADVERTENCIA");
  assert.equal(prioridadDeSeveridad("INFORMATIVA"), "INFORMATIVA");
});

// ── Cuándo se notifica ────────────────────────────────────────────────────────

for (const nueva of SEVERIDADES) {
  test(`creada (${nueva}) notifica por permiso, clave_origen = evento_id, prioridad = severidad`, () => {
    const n = notificacionDeAlerta(egresos(null, nueva));
    assert.ok(n);
    assert.equal(n.clave_origen, "0f0e0d0c-0b0a-4908-8706-050403020100");
    assert.equal(n.prioridad, nueva);
    assert.deepEqual(n.destinatarios, { permisos: [PERMISO_LEER_ALERTAS] });
    assert.equal(PERMISO_LEER_ALERTAS, "alertas:leer");
  });
}

/** Matriz completa de nivel_cambiado: solo el ascenso a CRITICA notifica. */
const NOTIFICAN = new Set(["ADVERTENCIA>CRITICA", "INFORMATIVA>CRITICA"]);
for (const anterior of SEVERIDADES) {
  for (const nueva of SEVERIDADES) {
    const esperado = NOTIFICAN.has(`${anterior}>${nueva}`);
    test(`nivel_cambiado ${anterior} → ${nueva}: ${esperado ? "notifica (CRITICA)" : "no notifica"}`, () => {
      const n = notificacionDeAlerta(stock(anterior, nueva));
      if (!esperado) {
        assert.equal(n, null);
        return;
      }
      assert.ok(n);
      assert.equal(n.prioridad, "CRITICA");
      assert.equal(n.clave_origen, "1f1e1d1c-1b1a-4918-8716-151413121110");
    });
  }
}

for (const anterior of SEVERIDADES) {
  test(`resuelta (desde ${anterior}) no notifica`, () => {
    assert.equal(notificacionDeAlerta(egresos(anterior, null)), null);
    assert.equal(notificacionDeAlerta(stock(anterior, null)), null);
  });
}

// ── Texto (D22) ───────────────────────────────────────────────────────────────

test("etiquetaMes: AAAA-MM → mes en palabras; inválida tal cual", () => {
  assert.equal(etiquetaMes("2026-10"), "octubre 2026");
  assert.equal(etiquetaMes("2027-01"), "enero 2027");
  assert.equal(etiquetaMes("2026-13"), "2026-13");
});

test("variables de egresos: mes legible, severidad en palabras, detalle con coma, sin UUID", () => {
  const v = variablesNotificacionAlerta(egresos("ADVERTENCIA", "CRITICA"));
  assert.deepEqual(v, {
    indicador: "Egresos sobre ingresos",
    descripcion: "Egresos sobre ingresos de octubre 2026",
    severidad: "Crítica",
    severidad_anterior: "Advertencia",
    detalle: "78,4% (umbral 70%)",
  });
  assert.doesNotMatch(JSON.stringify(v), UUID);
});

test("variables de stock: texto genérico sin IDs; sin datos de stock → «Sin detalle»", () => {
  const v = variablesNotificacionAlerta(stock(null, "CRITICA"));
  assert.equal(v.descripcion, "Stock bajo el punto de pedido");
  assert.equal(v.detalle, "Stock 0 (punto de pedido 5)");
  assert.equal(v.severidad_anterior, "");
  assert.doesNotMatch(JSON.stringify(v), UUID);
  const sinDatos = { ...stock(null, "ADVERTENCIA"), detalle: { cantidad_actual: null, punto_pedido: null, porcentaje_egresos: null, umbral_aplicado: null } };
  assert.equal(variablesNotificacionAlerta(sinDatos).detalle, "Sin detalle");
});

test("plantillas sembradas: renderizan sin placeholders sueltos ni UUID y citan el panel", () => {
  const [creada, escalada] = PLANTILLAS_NOTIFICACION_ALERTA;
  const ve = variablesNotificacionAlerta(egresos(null, "INFORMATIVA"));
  assert.equal(renderizarPlantilla(creada.asunto, ve), "Alerta Informativa: Egresos sobre ingresos");
  assert.equal(
    renderizarPlantilla(creada.cuerpo, ve),
    "Egresos sobre ingresos de octubre 2026. Nivel Informativa: 78,4% (umbral 70%). Revisala en Tesorería › Alertas (/tesoreria/alertas).",
  );
  const vs = variablesNotificacionAlerta(stock("ADVERTENCIA", "CRITICA"));
  assert.equal(renderizarPlantilla(escalada.asunto, vs), "Alerta escalada a Crítica: Stock bajo el punto de pedido");
  assert.equal(
    renderizarPlantilla(escalada.cuerpo, vs),
    "Stock bajo el punto de pedido pasó de Advertencia a Crítica: Stock 0 (punto de pedido 5). Revisala en Tesorería › Alertas (/tesoreria/alertas).",
  );
  for (const p of PLANTILLAS_NOTIFICACION_ALERTA) {
    for (const texto of [p.asunto, p.cuerpo]) {
      assert.doesNotMatch(renderizarPlantilla(texto, ve), /\{\{|\}\}/);
      assert.doesNotMatch(renderizarPlantilla(texto, ve), UUID);
    }
  }
  assert.deepEqual(PLANTILLAS_NOTIFICACION_ALERTA.map((p) => p.tipo_evento), ["alerta_desvio:creada", "alerta_desvio:nivel_cambiado"]);
});

// ── Idempotencia con el motor real (puertos falsos con unicidad de clave) ─────

test("idempotencia: el mismo evento procesado dos veces crea una sola notificación por usuario", async () => {
  const guardadas = new Map<string, NotificacionNueva>();
  const puertos: PuertosMotorNotificaciones = {
    usuariosActivos: async (ids) => ids,
    usuariosPorRoles: async () => [],
    usuariosPorPermisos: async () => ["admin-1", "gerente-1"],
    plantillaActiva: async () => null,
    crearNotificacion: async (data) => {
      if (guardadas.has(data.clave_idempotencia)) throw Object.assign(new Error("único"), { code: "P2002" });
      guardadas.set(data.clave_idempotencia, data);
    },
  };
  const generacion = notificacionDeAlerta(egresos(null, "ADVERTENCIA"))!;
  const entrada = { ...generacion, tipo_evento: "alerta_desvio:creada", prioridad_default: "INFORMATIVA" as const };

  assert.deepEqual(await ejecutarMotorNotificaciones(entrada, puertos), { creadas: 2, duplicadas: 0, fallidas: 0 });
  assert.deepEqual(await ejecutarMotorNotificaciones(entrada, puertos), { creadas: 0, duplicadas: 2, fallidas: 0 });
  assert.equal(guardadas.size, 2);
  for (const n of guardadas.values()) assert.equal(n.prioridad, "ADVERTENCIA");
});
