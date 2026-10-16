import assert from "node:assert/strict";
import test from "node:test";
import { FiltrosPanelAlertasSchema } from "../../schemas/alertas-desvio.schema.ts";
import {
  detalleLegible,
  ETIQUETA_ESTADO,
  ETIQUETA_INDICADOR,
  ETIQUETA_SEVERIDAD,
  etiquetaMes,
  hrefPanel,
  normalizarFiltrosPanel,
  referenciaLegible,
  resolverAccesoPanelAlertas,
  textoEstadoMes,
} from "./alerta-desvio.presentacion.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ── Etiquetas ─────────────────────────────────────────────────────────────────

test("etiquetas de negocio de severidad, indicador y estado", () => {
  assert.deepEqual(ETIQUETA_SEVERIDAD, { CRITICA: "Crítica", ADVERTENCIA: "Advertencia", INFORMATIVA: "Informativa" });
  assert.deepEqual(ETIQUETA_INDICADOR, {
    STOCK_BAJO_PUNTO_PEDIDO: "Stock bajo el punto de pedido",
    EGRESOS_SOBRE_INGRESOS: "Egresos sobre ingresos",
  });
  assert.deepEqual(ETIQUETA_ESTADO, { ACTIVA: "Activa", RESUELTA: "Resuelta" });
  assert.equal(etiquetaMes("2026-10"), "octubre 2026");
});

// ── Referencia y detalle legibles ─────────────────────────────────────────────

test("referenciaLegible: egresos «Octubre 2026», stock «SKU · Depósito», nunca UUID", () => {
  assert.equal(referenciaLegible({ indicador: "EGRESOS_SOBRE_INGRESOS", referencia: "2026-10" }), "Octubre 2026");
  assert.equal(referenciaLegible({ indicador: "EGRESOS_SOBRE_INGRESOS", referencia: "2027-01" }), "Enero 2027");
  assert.equal(referenciaLegible({ indicador: "EGRESOS_SOBRE_INGRESOS", referencia: "basura" }), "Mes no identificado");
  const refStock = "11111111-1111-4111-8111-111111111111:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(
    referenciaLegible({ indicador: "STOCK_BAJO_PUNTO_PEDIDO", referencia: refStock, sku: "CAMTAC-NEG-M", deposito: "Depósito Central" }),
    "CAMTAC-NEG-M · Depósito Central",
  );
  const sinDatos = referenciaLegible({ indicador: "STOCK_BAJO_PUNTO_PEDIDO", referencia: refStock, sku: null, deposito: "Central" });
  assert.equal(sinDatos, "Variante o depósito no disponible");
  assert.doesNotMatch(sinDatos, UUID);
});

test("detalleLegible: formatos de D12 y «Sin detalle»", () => {
  const base = { cantidad_actual: null, punto_pedido: null, porcentaje_egresos: null, umbral_aplicado: null };
  assert.equal(detalleLegible({ ...base, indicador: "STOCK_BAJO_PUNTO_PEDIDO", cantidad_actual: 0, punto_pedido: 5 }), "Stock 0 (punto de pedido 5)");
  assert.equal(detalleLegible({ ...base, indicador: "STOCK_BAJO_PUNTO_PEDIDO" }), "Sin detalle");
  assert.equal(detalleLegible({ ...base, indicador: "EGRESOS_SOBRE_INGRESOS", porcentaje_egresos: 78.44, umbral_aplicado: 70 }), "78,4% (umbral 70%)");
  assert.equal(detalleLegible({ ...base, indicador: "EGRESOS_SOBRE_INGRESOS" }), "No calculable");
});

test("textoEstadoMes: calculable con 1 decimal, no calculable (criterio 5) y fuente no disponible", () => {
  assert.equal(
    textoEstadoMes({ estado: "CALCULABLE", referencia: "2026-10", porcentaje: 86.437 }),
    "Egresos sobre ingresos de octubre 2026: 86,4%",
  );
  assert.equal(
    textoEstadoMes({ estado: "NO_CALCULABLE", referencia: "2026-10" }),
    "Egresos sobre ingresos de octubre 2026: No calculable (los ingresos del mes son cero o negativos)",
  );
  assert.match(textoEstadoMes({ estado: "NO_DISPONIBLE", referencia: "2026-10" }), /no está disponible.*últimos valores guardados/);
});

// ── Filtros ───────────────────────────────────────────────────────────────────

test("schema de la API: defaults, valores válidos y rechazo de inválidos", () => {
  assert.deepEqual(FiltrosPanelAlertasSchema.parse({}), { estado: "activas", page: 1, page_size: 25 });
  assert.deepEqual(FiltrosPanelAlertasSchema.parse({ estado: "todas", nivel: "critica", page: "3", page_size: "50" }), {
    estado: "todas",
    nivel: "critica",
    page: 3,
    page_size: 50,
  });
  for (const invalido of [{ estado: "ACTIVAS" }, { estado: "archivadas" }, { nivel: "alta" }, { nivel: "" }, { page: "0" }, { page: "x" }, { page_size: "101" }]) {
    assert.equal(FiltrosPanelAlertasSchema.safeParse(invalido).success, false, JSON.stringify(invalido));
  }
});

test("normalizarFiltrosPanel (página): tolerante, cada parámetro inválido cae en su default", () => {
  assert.deepEqual(normalizarFiltrosPanel({}), { estado: "activas", nivel: undefined, page: 1, page_size: 25 });
  assert.deepEqual(normalizarFiltrosPanel({ estado: "resueltas", nivel: "advertencia", page: "2" }), {
    estado: "resueltas",
    nivel: "advertencia",
    page: 2,
    page_size: 25,
  });
  assert.deepEqual(normalizarFiltrosPanel({ estado: "cualquiera", nivel: "alta", page: "-1", page_size: "1000" }), {
    estado: "activas",
    nivel: undefined,
    page: 1,
    page_size: 25,
  });
  assert.deepEqual(normalizarFiltrosPanel({ estado: ["todas", "activas"], nivel: "" }), {
    estado: "todas",
    nivel: undefined,
    page: 1,
    page_size: 25,
  });
});

test("hrefPanel: omite defaults, cambia pestaña o nivel volviendo a la página 1", () => {
  assert.equal(hrefPanel({ estado: "activas" }), "/tesoreria/alertas");
  assert.equal(hrefPanel({ estado: "activas" }, { estado: "resueltas" }), "/tesoreria/alertas?estado=resueltas");
  assert.equal(hrefPanel({ estado: "todas", nivel: "critica" }), "/tesoreria/alertas?estado=todas&nivel=critica");
  assert.equal(hrefPanel({ estado: "todas", nivel: "critica" }, { nivel: null }), "/tesoreria/alertas?estado=todas");
  assert.equal(hrefPanel({ estado: "activas", nivel: "critica" }, { estado: "todas" }), "/tesoreria/alertas?estado=todas&nivel=critica");
  assert.equal(hrefPanel({ estado: "activas" }, { page: 3 }), "/tesoreria/alertas?page=3");
  assert.equal(hrefPanel({ estado: "activas" }, { page: 1 }), "/tesoreria/alertas");
});

// ── Acceso a la página ────────────────────────────────────────────────────────

/** Permisos por usuario tal como los siembra el seed (Paso 2): alertas:leer → ADMINISTRADOR y GERENTE. */
const PERMISOS: Record<string, string[]> = {
  administrador: ["alertas:leer", "configuracion:administrar"],
  gerente: ["alertas:leer", "tesoreria:leer_reportes"],
  cajero: ["tesoreria:leer_reportes"],
  solo_configuracion: ["configuracion:administrar"],
};
const tienePermiso = async (usuarioId: string, codigo: string) => (PERMISOS[usuarioId] ?? []).includes(codigo);

test("acceso: sin sesión → LOGIN", async () => {
  assert.deepEqual(await resolverAccesoPanelAlertas(null, tienePermiso), { tipo: "LOGIN" });
});

test("acceso: Administrador entra y puede editar umbrales", async () => {
  assert.deepEqual(await resolverAccesoPanelAlertas({ userId: "administrador" }, tienePermiso), {
    tipo: "PERMITIDO",
    puedeEditarUmbrales: true,
  });
});

test("acceso: Gerente entra pero NO edita (solo lectura de umbrales)", async () => {
  assert.deepEqual(await resolverAccesoPanelAlertas({ userId: "gerente" }, tienePermiso), {
    tipo: "PERMITIDO",
    puedeEditarUmbrales: false,
  });
});

test("acceso: un rol sin alertas:leer → NO_AUTORIZADO, aunque tenga configuracion:administrar", async () => {
  assert.deepEqual(await resolverAccesoPanelAlertas({ userId: "cajero" }, tienePermiso), { tipo: "NO_AUTORIZADO" });
  assert.deepEqual(await resolverAccesoPanelAlertas({ userId: "solo_configuracion" }, tienePermiso), { tipo: "NO_AUTORIZADO" });
});
