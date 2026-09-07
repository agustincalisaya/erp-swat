import assert from "node:assert/strict";
import test from "node:test";
import { RegistrarRecepcionSchema } from "../../schemas/recepciones.schema.ts";
import {
  calcularPayloadHashRecepcion,
  payloadCanonicoRecepcion,
} from "./recepcion-idempotencia.ts";
import {
  construirPayloadRecepcionRegistrada,
  determinarEstadoFisicoOrden,
  FILTRO_ACUMULADO_RECEPCIONES_ACTIVAS,
} from "./recepcion-reglas.ts";

const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
const DEPOSITO_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_1_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_2_ID = "44444444-4444-4444-8444-444444444444";
const CLAVE = "55555555-5555-4555-8555-555555555555";

function payloadValido() {
  return {
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: CLAVE,
    numero_remito_proveedor: "REM-1",
    items: [
      {
        orden_compra_item_id: ITEM_1_ID,
        cantidad_recibida: 5,
        cantidad_aceptada: 4,
        discrepancias: [{ tipo: "CALIDAD" as const, detalle: "Una unidad dañada" }],
      },
    ],
  };
}

test("schema HU-H4 acepta una recepción válida", () => {
  assert.equal(RegistrarRecepcionSchema.safeParse(payloadValido()).success, true);
});

test("schema HU-H4 exige cantidad recibida mayor a cero", () => {
  const payload = payloadValido();
  payload.items[0]!.cantidad_recibida = 0;
  assert.equal(RegistrarRecepcionSchema.safeParse(payload).success, false);
});

test("schema HU-H4 exige cantidad aceptada no negativa", () => {
  const payload = payloadValido();
  payload.items[0]!.cantidad_aceptada = -1;
  assert.equal(RegistrarRecepcionSchema.safeParse(payload).success, false);
});

test("schema HU-H4 impide aceptar más de lo recibido", () => {
  const payload = payloadValido();
  payload.items[0]!.cantidad_aceptada = 6;
  assert.equal(RegistrarRecepcionSchema.safeParse(payload).success, false);
});

test("schema HU-H4 exige documentar una discrepancia cuando hay unidades observadas", () => {
  const sinCausa = payloadValido();
  sinCausa.items[0]!.discrepancias = [];
  assert.equal(RegistrarRecepcionSchema.safeParse(sinCausa).success, false);

  const totalmenteObservada = payloadValido();
  totalmenteObservada.items[0]!.cantidad_aceptada = 0;
  assert.equal(RegistrarRecepcionSchema.safeParse(totalmenteObservada).success, true);
});

test("schema HU-H4 impide repetir el mismo ítem de OC", () => {
  const payload = payloadValido();
  payload.items.push({ ...payload.items[0]!, discrepancias: [] });
  assert.equal(RegistrarRecepcionSchema.safeParse(payload).success, false);
});

test("regla de saldo distingue recepción parcial y completa", () => {
  assert.equal(
    determinarEstadoFisicoOrden([
      { cantidad_solicitada: 10, cantidad_recibida_previa: 2, cantidad_recibida_actual: 3 },
    ]),
    "RECEPCION_PARCIAL",
  );
  assert.equal(
    determinarEstadoFisicoOrden([
      { cantidad_solicitada: 10, cantidad_recibida_previa: 4, cantidad_recibida_actual: 6 },
      { cantidad_solicitada: 5, cantidad_recibida_previa: 5, cantidad_recibida_actual: 0 },
    ]),
    "RECIBIDA_COMPLETA",
  );
});

test("el acumulado excluye ítems y recepciones con soft delete", () => {
  assert.deepEqual(FILTRO_ACUMULADO_RECEPCIONES_ACTIVAS, {
    is_active: true,
    deleted_at: null,
    recepcion: { is_active: true, deleted_at: null },
  });
});

test("canonicalización es estable ante distinto orden de arrays", () => {
  const base = RegistrarRecepcionSchema.parse({
    ...payloadValido(),
    items: [
      {
        ...payloadValido().items[0],
        discrepancias: [
          { tipo: "CALIDAD" as const, detalle: "Una unidad dañada" },
          { tipo: "COLOR" as const, detalle: "Color incorrecto" },
        ],
      },
      { orden_compra_item_id: ITEM_2_ID, cantidad_recibida: 1, cantidad_aceptada: 1, discrepancias: [] },
    ],
  });
  const invertido = {
    ...base,
    items: [...base.items].reverse().map((item) => ({
      ...item,
      discrepancias: [...item.discrepancias].reverse(),
    })),
  };
  assert.equal(payloadCanonicoRecepcion(ORDEN_ID, base), payloadCanonicoRecepcion(ORDEN_ID, invertido));
  assert.equal(calcularPayloadHashRecepcion(ORDEN_ID, base), calcularPayloadHashRecepcion(ORDEN_ID, invertido));
  assert.match(calcularPayloadHashRecepcion(ORDEN_ID, base), /^[a-f0-9]{64}$/);
});

test("canonicalización ignora el orden de propiedades y normaliza strings equivalentes", () => {
  const compuesto = RegistrarRecepcionSchema.parse({
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: CLAVE,
    numero_remito_proveedor: "  REM-Á  ",
    observaciones: "   ",
    items: [{
      orden_compra_item_id: ITEM_1_ID,
      cantidad_recibida: 5,
      cantidad_aceptada: 4,
      discrepancias: [{ tipo: "CALIDAD", detalle: "  Unidad dañada  " }],
    }],
  });
  const descompuestoYOtroOrden = RegistrarRecepcionSchema.parse({
    items: [{
      discrepancias: [{ detalle: "Unidad dan\u0303ada", tipo: "CALIDAD" }],
      cantidad_aceptada: 4,
      cantidad_recibida: 5,
      orden_compra_item_id: ITEM_1_ID,
    }],
    observaciones: undefined,
    numero_remito_proveedor: "REM-A\u0301",
    clave_idempotencia: CLAVE,
    deposito_destino_id: DEPOSITO_ID,
  });

  assert.equal(compuesto.numero_remito_proveedor, "REM-Á");
  assert.equal(compuesto.observaciones, undefined);
  assert.equal(
    calcularPayloadHashRecepcion(ORDEN_ID, compuesto),
    calcularPayloadHashRecepcion(ORDEN_ID, descompuestoYOtroOrden),
  );
});

test("misma clave y mismo payload conserva hash; payload distinto lo cambia", () => {
  const base = RegistrarRecepcionSchema.parse(payloadValido());
  const mismaIntencion = RegistrarRecepcionSchema.parse(payloadValido());
  const distinta = RegistrarRecepcionSchema.parse({
    ...payloadValido(),
    items: [{ ...payloadValido().items[0], cantidad_aceptada: 3 }],
  });
  assert.equal(base.clave_idempotencia, mismaIntencion.clave_idempotencia);
  assert.equal(calcularPayloadHashRecepcion(ORDEN_ID, base), calcularPayloadHashRecepcion(ORDEN_ID, mismaIntencion));
  assert.notEqual(calcularPayloadHashRecepcion(ORDEN_ID, base), calcularPayloadHashRecepcion(ORDEN_ID, distinta));
});

test("payload recepcion:registrada respeta el contrato aprobado", () => {
  assert.deepEqual(
    construirPayloadRecepcionRegistrada({
      recepcion_id: "r1",
      orden_compra_id: ORDEN_ID,
      numero_orden: "OC-2026-001",
      deposito_destino_id: DEPOSITO_ID,
      recibida_por_id: "u1",
      fecha_recepcion: new Date("2026-09-02T12:00:00.000Z"),
      estado_anterior_oc: "CONFIRMADA",
      estado_nuevo_oc: "RECEPCION_PARCIAL",
    }),
    {
      recepcion_id: "r1",
      orden_compra_id: ORDEN_ID,
      numero_orden: "OC-2026-001",
      deposito_destino_id: DEPOSITO_ID,
      recibida_por_id: "u1",
      fecha_recepcion: "2026-09-02T12:00:00.000Z",
      estado_anterior_oc: "CONFIRMADA",
      estado_nuevo_oc: "RECEPCION_PARCIAL",
    },
  );
});
