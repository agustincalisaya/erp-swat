import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FiltrosOrdenesRecepcionablesSchema,
  RegistrarRecepcionSchema,
} from "../../schemas/recepciones.schema.ts";
import {
  calcularPayloadHashRecepcion,
  payloadCanonicoRecepcion,
} from "./recepcion-idempotencia.ts";
import {
  construirConsultaOrdenesRecepcionables,
  construirItemsRecepcionPerfecta,
  construirPayloadRecepcionRegistrada,
  construirQueryRecepciones,
  construirRangoFechaEmision,
  MAX_ORDENES_RECEPCIONABLES,
} from "./recepcion-reglas.ts";

const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
const OTRA_ORDEN_ID = "11111111-1111-4111-8111-111111111112";
const DEPOSITO_ID = "22222222-2222-4222-8222-222222222222";
const OTRO_DEPOSITO_ID = "22222222-2222-4222-8222-222222222223";
const CLAVE = "55555555-5555-4555-8555-555555555555";

function payloadValido() {
  return {
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: CLAVE,
  };
}

test("schema HU-H4 V2.1 acepta únicamente depósito y clave idempotente", () => {
  assert.deepEqual(RegistrarRecepcionSchema.parse(payloadValido()), payloadValido());
});

test("schema HU-H4 V2.1 valida UUID de depósito y clave", () => {
  assert.equal(RegistrarRecepcionSchema.safeParse({
    ...payloadValido(),
    deposito_destino_id: "deposito-invalido",
  }).success, false);
  assert.equal(RegistrarRecepcionSchema.safeParse({
    ...payloadValido(),
    clave_idempotencia: "clave-invalida",
  }).success, false);
});

test("schema estricto rechaza payload legacy con items y cantidades", () => {
  const resultado = RegistrarRecepcionSchema.safeParse({
    ...payloadValido(),
    items: [{
      orden_compra_item_id: "33333333-3333-4333-8333-333333333333",
      cantidad_recibida: 10,
      cantidad_aceptada: 10,
      discrepancias: [],
    }],
  });
  assert.equal(resultado.success, false);
  if (!resultado.success) assert.equal(resultado.error.issues[0]?.code, "unrecognized_keys");
});

test("schema estricto rechaza remito y observaciones", () => {
  assert.equal(RegistrarRecepcionSchema.safeParse({
    ...payloadValido(),
    numero_remito_proveedor: "REM-1",
  }).success, false);
  assert.equal(RegistrarRecepcionSchema.safeParse({
    ...payloadValido(),
    observaciones: "texto debe rechazarse",
  }).success, false);
});

test("backend deriva todos los items como recibidos y aceptados por lo solicitado", () => {
  assert.deepEqual(
    construirItemsRecepcionPerfecta([
      { id: "item-a", variante_sku_id: "sku-a", cantidad_solicitada: 10 },
      { id: "item-b", variante_sku_id: "sku-b", cantidad_solicitada: 5 },
    ]),
    [
      {
        orden_compra_item_id: "item-a",
        variante_sku_id: "sku-a",
        cantidad_recibida: 10,
        cantidad_aceptada: 10,
      },
      {
        orden_compra_item_id: "item-b",
        variante_sku_id: "sku-b",
        cantidad_recibida: 5,
        cantidad_aceptada: 5,
      },
    ],
  );
});

test("una OC sin items activos deriva una lista vacía y el service la rechaza", () => {
  assert.deepEqual(construirItemsRecepcionPerfecta([]), []);
  const fuente = readFileSync(new URL("./recepcion.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /itemsRecepcion\.length === 0/);
  assert.match(fuente, /ORDEN_SIN_ITEMS_RECEPCIONABLES/);
});

test("frontend impide confirmar una OC sin items aunque reciba props obsoletas", () => {
  const fuente = readFileSync(
    new URL("../../../components/compras/FormularioRecepcionMercaderia.tsx", import.meta.url),
    "utf8",
  );
  assert.match(fuente, /if \(orden\.items\.length === 0\)/);
  assert.match(fuente, /\|\| orden\.items\.length === 0/);
  assert.doesNotMatch(fuente, /Se recibirá completa la OC/);
});

test("filtros URL validan proveedor UUID y fecha de emisión calendario", () => {
  assert.deepEqual(FiltrosOrdenesRecepcionablesSchema.parse({
    proveedorId: ORDEN_ID,
    fechaEmision: "2026-09-09",
  }), {
    proveedorId: ORDEN_ID,
    fechaEmision: "2026-09-09",
    page: 1,
  });
  assert.deepEqual(FiltrosOrdenesRecepcionablesSchema.parse({
    proveedorId: "no-es-uuid",
    fechaEmision: "2026-02-30",
    page: "0",
  }), {
    proveedorId: undefined,
    fechaEmision: undefined,
    page: 1,
  });
});

test("consulta sin filtros exige OC recepcionable, ordena fecha DESC y limita a 10", () => {
  const consulta = construirConsultaOrdenesRecepcionables();
  assert.deepEqual(consulta.where, {
    estado: "CONFIRMADA",
    is_active: true,
    deleted_at: null,
    items: { some: { is_active: true, deleted_at: null } },
  });
  assert.deepEqual(consulta.orderBy, [
    { fecha_emision: "desc" },
    { numero_orden: "desc" },
  ]);
  assert.equal(consulta.skip, 0);
  assert.equal(consulta.take, MAX_ORDENES_RECEPCIONABLES);
});

test("consulta aplica proveedor y nunca permite un límite mayor a 10", () => {
  const consulta = construirConsultaOrdenesRecepcionables({
    proveedorId: ORDEN_ID,
    limit: 500,
  });
  assert.equal(consulta.where.proveedor_id, ORDEN_ID);
  assert.equal(consulta.take, 10);
});

test("12 OC se distribuyen en páginas de 10 y 2 con metadata correcta", () => {
  const doceOrdenes = Array.from({ length: 12 }, (_, index) => index + 1);
  const pagina1 = construirConsultaOrdenesRecepcionables({ page: 1 }, 12);
  assert.equal(pagina1.skip, 0);
  assert.equal(pagina1.take, 10);
  assert.equal(pagina1.page, 1);
  assert.equal(pagina1.pageSize, 10);
  assert.equal(pagina1.totalPages, 2);
  assert.equal(doceOrdenes.slice(pagina1.skip, pagina1.skip + pagina1.take).length, 10);

  const pagina2 = construirConsultaOrdenesRecepcionables({ page: 2 }, 12);
  assert.equal(pagina2.skip, 10);
  assert.equal(pagina2.take, 10);
  assert.equal(doceOrdenes.slice(pagina2.skip, pagina2.skip + pagina2.take).length, 2);
  assert.equal(pagina2.page, 2);
  assert.equal(pagina2.totalPages, 2);
});

test("página superior al total se normaliza a la última página válida", () => {
  const consulta = construirConsultaOrdenesRecepcionables({ page: 99 }, 12);
  assert.equal(consulta.page, 2);
  assert.equal(consulta.skip, 10);
});

test("filtro de fecha usa rango inclusivo/exclusivo del día UTC", () => {
  const rango = construirRangoFechaEmision("2026-09-09");
  assert.equal(rango.gte.toISOString(), "2026-09-09T00:00:00.000Z");
  assert.equal(rango.lt.toISOString(), "2026-09-10T00:00:00.000Z");

  const consulta = construirConsultaOrdenesRecepcionables({ fechaEmision: "2026-09-09" });
  assert.deepEqual(consulta.where.fecha_emision, rango);
});

test("consulta combina proveedor y fecha sin perder reglas base", () => {
  const consulta = construirConsultaOrdenesRecepcionables({
    proveedorId: ORDEN_ID,
    fechaEmision: new Date("2026-09-09T18:30:00.000Z"),
    limit: 3,
  });
  assert.equal(consulta.where.estado, "CONFIRMADA");
  assert.equal(consulta.where.proveedor_id, ORDEN_ID);
  assert.equal(consulta.where.fecha_emision?.gte.toISOString(), "2026-09-09T00:00:00.000Z");
  assert.equal(consulta.where.fecha_emision?.lt.toISOString(), "2026-09-10T00:00:00.000Z");
  assert.equal(consulta.take, 3);
});

test("navegación conserva filtros y cambiar filtros vuelve a página 1", () => {
  assert.equal(
    construirQueryRecepciones({
      proveedorId: ORDEN_ID,
      fechaEmision: "2026-09-09",
      page: 2,
    }),
    `proveedor_id=${ORDEN_ID}&fecha_emision=2026-09-09&page=2`,
  );
  assert.equal(
    construirQueryRecepciones({
      proveedorId: ORDEN_ID,
      fechaEmision: "2026-09-09",
      page: 1,
    }),
    `proveedor_id=${ORDEN_ID}&fecha_emision=2026-09-09`,
  );
});

test("UI deshabilita Anterior y Siguiente en los extremos", () => {
  const fuente = readFileSync(
    new URL("../../../components/compras/FormularioRecepcionMercaderia.tsx", import.meta.url),
    "utf8",
  );
  assert.match(fuente, /disabled=\{page <= 1\}/);
  assert.match(fuente, /disabled=\{page >= totalPages\}/);
  assert.match(fuente, /totalPages > 1/);
});

test("intención idempotente V2.1 contiene únicamente OC y depósito", () => {
  const input = RegistrarRecepcionSchema.parse(payloadValido());
  assert.equal(
    payloadCanonicoRecepcion(ORDEN_ID, input),
    JSON.stringify({ orden_compra_id: ORDEN_ID, deposito_destino_id: DEPOSITO_ID }),
  );
  assert.match(calcularPayloadHashRecepcion(ORDEN_ID, input), /^[a-f0-9]{64}$/);
});

test("hash ignora la clave y cambia únicamente con OC o depósito", () => {
  const base = RegistrarRecepcionSchema.parse(payloadValido());
  const otraClave = RegistrarRecepcionSchema.parse({
    ...payloadValido(),
    clave_idempotencia: "55555555-5555-4555-8555-555555555556",
  });
  const otroDeposito = RegistrarRecepcionSchema.parse({
    ...payloadValido(),
    deposito_destino_id: OTRO_DEPOSITO_ID,
  });

  assert.equal(
    calcularPayloadHashRecepcion(ORDEN_ID, base),
    calcularPayloadHashRecepcion(ORDEN_ID, otraClave),
  );
  assert.notEqual(
    calcularPayloadHashRecepcion(ORDEN_ID, base),
    calcularPayloadHashRecepcion(OTRA_ORDEN_ID, base),
  );
  assert.notEqual(
    calcularPayloadHashRecepcion(ORDEN_ID, base),
    calcularPayloadHashRecepcion(ORDEN_ID, otroDeposito),
  );
});

test("la ruta mantiene los payload legacy como VALIDATION_ERROR HTTP 400", () => {
  const fuente = readFileSync(
    new URL("../../../app/api/ordenes-compra/[id]/recepciones/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(fuente, /RegistrarRecepcionSchema\.safeParse\(body\)/);
  assert.match(fuente, /code: "VALIDATION_ERROR"[\s\S]*?status: 400/);
});

test("payload recepcion:registrada conserva el contrato aprobado", () => {
  assert.deepEqual(
    construirPayloadRecepcionRegistrada({
      recepcion_id: "r1",
      orden_compra_id: ORDEN_ID,
      numero_orden: "OC-2026-001",
      deposito_destino_id: DEPOSITO_ID,
      recibida_por_id: "u1",
      fecha_recepcion: new Date("2026-09-02T12:00:00.000Z"),
      estado_anterior_oc: "CONFIRMADA",
      estado_nuevo_oc: "RECIBIDA_COMPLETA",
    }),
    {
      recepcion_id: "r1",
      orden_compra_id: ORDEN_ID,
      numero_orden: "OC-2026-001",
      deposito_destino_id: DEPOSITO_ID,
      recibida_por_id: "u1",
      fecha_recepcion: "2026-09-02T12:00:00.000Z",
      estado_anterior_oc: "CONFIRMADA",
      estado_nuevo_oc: "RECIBIDA_COMPLETA",
    },
  );
});
