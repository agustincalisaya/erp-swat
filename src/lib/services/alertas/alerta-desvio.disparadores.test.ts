import assert from "node:assert/strict";
import test from "node:test";
import type {
  CuentaPorPagarEstadoCambiadoPayload,
  GastoOperativoCreadoPayload,
  GastoOperativoDadoDeBajaPayload,
  GastoOperativoEditadoPayload,
  IngresoStockRegistradoPayload,
  ReclasificacionDevueltoPayload,
  ReservaCongeladaPayload,
  ReservaLiberadaPayload,
  TransferenciaStockPayload,
  TransferenciaStockRecepcionConfirmadaPayload,
  UmbralCriticoAlcanzadoPayload,
} from "../../events/event-types.ts";
import {
  objetivosCuentaPorPagar,
  objetivosGastoCreado,
  objetivosGastoDadoDeBaja,
  objetivosGastoEditado,
  objetivosIngresoStock,
  objetivosReclasificacionDevuelto,
  objetivosReservaCongelada,
  objetivosTransferenciaIniciada,
  objetivosTransferenciaRecepcion,
  objetivosUmbralCritico,
  reservasALiberar,
} from "./alerta-desvio.disparadores.ts";

const VAR_A = "11111111-1111-4111-8111-111111111111";
const VAR_B = "22222222-2222-4222-8222-222222222222";
const DEP_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEP_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USUARIO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// ── Gastos ────────────────────────────────────────────────────────────────────

const gasto = (fecha: string): GastoOperativoCreadoPayload => ({
  gasto_operativo_id: "g-1",
  categoria_gasto_id: "c-1",
  fecha,
  monto: "1000.00",
  usuario_id: USUARIO,
});

test("gasto_operativo:creado → el mes de la fecha del gasto", () => {
  assert.deepEqual(objetivosGastoCreado(gasto("2026-10-15")), [{ anio: 2026, mes: 10 }]);
  assert.deepEqual(objetivosGastoCreado(gasto("2026-12-31")), [{ anio: 2026, mes: 12 }]);
  assert.deepEqual(objetivosGastoCreado(gasto("2027-01-01")), [{ anio: 2027, mes: 1 }]);
});

test("gasto_operativo:dado_de_baja → el mes de la fecha del gasto", () => {
  const payload: GastoOperativoDadoDeBajaPayload = { ...gasto("2026-09-30"), motivo: "Cargado por error" };
  assert.deepEqual(objetivosGastoDadoDeBaja(payload), [{ anio: 2026, mes: 9 }]);
});

const editado = (anterior: string, nueva: string): GastoOperativoEditadoPayload => {
  const datos = (fecha: string) => ({ categoria_gasto_id: "c-1", fecha, monto: "1000.00", descripcion: "Alquiler" });
  return { ...gasto(nueva), valor_anterior: datos(anterior), valor_nuevo: datos(nueva) };
};

test("gasto_operativo:editado entre dos meses → los dos meses", () => {
  assert.deepEqual(objetivosGastoEditado(editado("2026-09-28", "2026-10-02")), [
    { anio: 2026, mes: 9 },
    { anio: 2026, mes: 10 },
  ]);
  assert.deepEqual(objetivosGastoEditado(editado("2026-12-31", "2027-01-01")), [
    { anio: 2026, mes: 12 },
    { anio: 2027, mes: 1 },
  ]);
});

test("gasto_operativo:editado dentro del mismo mes → un solo mes", () => {
  assert.deepEqual(objetivosGastoEditado(editado("2026-10-01", "2026-10-31")), [{ anio: 2026, mes: 10 }]);
});

test("gasto_operativo:editado con una fecha inválida → solo el mes válido", () => {
  assert.deepEqual(objetivosGastoEditado(editado("no-es-fecha", "2026-10-31")), [{ anio: 2026, mes: 10 }]);
});

// ── Cuentas por pagar ─────────────────────────────────────────────────────────

const cuenta = (
  accion: CuentaPorPagarEstadoCambiadoPayload["accion"],
  fecha_pago: string | null,
): CuentaPorPagarEstadoCambiadoPayload => ({
  cuenta_por_pagar_id: "cxp-1",
  orden_compra_id: "oc-1",
  numero_orden: "OC-0001",
  proveedor_id: "prov-1",
  estado_anterior: accion === "CREAR" ? null : "DEFINITIVA",
  estado_nuevo: accion === "PAGAR" ? "PAGADA" : "DEFINITIVA",
  accion,
  cambiado_por: USUARIO,
  monto_anterior: null,
  monto_nuevo: "5000.00",
  recepcion_id: null,
  fecha_vencimiento: null,
  fecha_pago,
  deletion_reason: null,
  medio_pago: accion === "PAGAR" ? "TRANSFERENCIA" : null,
  cuenta_origen_id: null,
  comprobante_proveedor_ids: null,
  observaciones: null,
});

test("cuenta_por_pagar:estado_cambiado: solo PAGAR produce objetivos", () => {
  for (const accion of ["CREAR", "DEFINIR", "CANCELAR"] as const) {
    assert.deepEqual(objetivosCuentaPorPagar(cuenta(accion, "2026-10-15T15:00:00.000Z")), [], accion);
  }
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", "2026-10-15T15:00:00.000Z")), [{ anio: 2026, mes: 10 }]);
});

test("PAGAR con fecha_pago como día AAAA-MM-DD → ese mes", () => {
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", "2026-10-01")), [{ anio: 2026, mes: 10 }]);
});

test("PAGAR con un día del formulario (medianoche UTC del día 1) → mes del día UTC y del día argentino", () => {
  // `2026-10-01` cargado en la UI viaja como 2026-10-01T00:00Z = 30/09 21:00 en Argentina.
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", "2026-10-01T00:00:00.000Z")), [
    { anio: 2026, mes: 9 },
    { anio: 2026, mes: 10 },
  ]);
});

test("PAGAR con un instante real cerca de la medianoche argentina", () => {
  // 31/10 23:59 en Argentina = 01/11 02:59 UTC: cuentan octubre (día de negocio) y noviembre (día UTC).
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", "2026-11-01T02:59:00.000Z")), [
    { anio: 2026, mes: 10 },
    { anio: 2026, mes: 11 },
  ]);
  // 01/11 00:00 en Argentina = 01/11 03:00 UTC: ambos días caen en noviembre → un solo mes.
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", "2026-11-01T03:00:00.000Z")), [{ anio: 2026, mes: 11 }]);
});

test("PAGAR sin fecha_pago o con fecha inválida → sin objetivos", () => {
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", null)), []);
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", "mañana")), []);
  assert.deepEqual(objetivosCuentaPorPagar(cuenta("PAGAR", "2026-13-01")), []);
});

// ── Stock ─────────────────────────────────────────────────────────────────────

test("stock:umbral_critico_alcanzado → la combinación del payload", () => {
  const payload: UmbralCriticoAlcanzadoPayload = {
    stock_deposito_id: "sd-1",
    variante_sku_id: VAR_A,
    deposito_id: DEP_1,
    cantidad_resultante: 2,
    punto_pedido: 5,
    movimiento_id_origen: "mov-1",
  };
  assert.deepEqual(objetivosUmbralCritico(payload), [{ varianteSkuId: VAR_A, depositoId: DEP_1 }]);
});

test("inventario:ingreso_stock_registrado → cada variante en el depósito destino, sin repetir", () => {
  const item = (variante_sku_id: string, estado_destino: string) => ({
    variante_sku_id,
    cantidad: 1,
    estado_destino,
    cantidad_resultante: 3,
  });
  const payload: IngresoStockRegistradoPayload = {
    movimiento_id: "mov-2",
    deposito_destino_id: DEP_2,
    items: [item(VAR_A, "DISPONIBLE"), item(VAR_B, "VENDIDO"), item(VAR_A, "BAJA_MERMA")],
    usuario_id: USUARIO,
  };
  assert.deepEqual(objetivosIngresoStock(payload), [
    { varianteSkuId: VAR_A, depositoId: DEP_2 },
    { varianteSkuId: VAR_B, depositoId: DEP_2 },
  ]);
});

const transferencia: TransferenciaStockPayload = {
  transferencia_id: "t-1",
  remito_id: "R-0001",
  movimiento_id: "mov-3",
  deposito_origen_id: DEP_1,
  deposito_destino_id: DEP_2,
  items: [
    { variante_sku_id: VAR_A, cantidad: 2 },
    { variante_sku_id: VAR_B, cantidad: 1 },
  ],
  usuario_id: USUARIO,
};

test("stock:transferencia_iniciada → el depósito ORIGEN", () => {
  assert.deepEqual(objetivosTransferenciaIniciada(transferencia), [
    { varianteSkuId: VAR_A, depositoId: DEP_1 },
    { varianteSkuId: VAR_B, depositoId: DEP_1 },
  ]);
});

test("stock:transferencia_recepcion_confirmada → el depósito DESTINO", () => {
  const payload: TransferenciaStockRecepcionConfirmadaPayload = {
    ...transferencia,
    items: [
      { variante_sku_id: VAR_A, cantidad_recibida: 2, estado_item: "RECIBIDO_TOTAL" },
      { variante_sku_id: VAR_B, cantidad_recibida: 0, estado_item: "PENDIENTE" },
    ],
    estado_transferencia: "PARCIAL",
    recibida_at: null,
  };
  assert.deepEqual(objetivosTransferenciaRecepcion(payload), [
    { varianteSkuId: VAR_A, depositoId: DEP_2 },
    { varianteSkuId: VAR_B, depositoId: DEP_2 },
  ]);
});

test("stock:reserva_congelada → la combinación de la reserva", () => {
  const payload: ReservaCongeladaPayload = {
    reserva_id: "r-1",
    variante_sku_id: VAR_B,
    deposito_id: DEP_1,
    usuario_id: USUARIO,
    origen_reserva: "CHECKOUT_WEB",
    cantidad: 1,
  };
  assert.deepEqual(objetivosReservaCongelada(payload), [{ varianteSkuId: VAR_B, depositoId: DEP_1 }]);
});

test("stock:reclasificacion_devuelto: solo DISPONIBLE reincorpora stock", () => {
  const reclasificacion = (estado_destino: ReclasificacionDevueltoPayload["estado_destino"]): ReclasificacionDevueltoPayload => ({
    movimiento_id: "mov-4",
    variante_sku_id: VAR_A,
    deposito_id: DEP_2,
    resultado_control_calidad: estado_destino === "DISPONIBLE" ? "APTO" : "NO_APTO",
    estado_origen: "DEVUELTO",
    estado_destino,
    usuario_id: USUARIO,
  });
  assert.deepEqual(objetivosReclasificacionDevuelto(reclasificacion("DISPONIBLE")), [
    { varianteSkuId: VAR_A, depositoId: DEP_2 },
  ]);
  assert.deepEqual(objetivosReclasificacionDevuelto(reclasificacion("BAJA_MERMA")), []);
});

test("stock:reserva_liberada: VENTA se ignora; los demás motivos devuelven la reserva a releer", () => {
  const liberada = (motivo_liberacion: ReservaLiberadaPayload["motivo_liberacion"]): ReservaLiberadaPayload => ({
    reserva_id: "r-9",
    motivo_liberacion,
    variante_sku_id: VAR_A,
    cantidad: 1,
  });
  assert.deepEqual(reservasALiberar(liberada("VENTA")), []);
  for (const motivo of ["TTL_VENCIDO", "PAGO_RECHAZADO", "ANULACION_ORDEN"] as const) {
    assert.deepEqual(reservasALiberar(liberada(motivo)), ["r-9"], motivo);
  }
});

// ── Payloads inválidos: nunca lanzan ──────────────────────────────────────────

test("payloads inválidos devuelven lista vacía sin lanzar", () => {
  const roto = (valor: unknown) => valor as never;
  assert.deepEqual(objetivosGastoCreado(roto({})), []);
  assert.deepEqual(objetivosGastoCreado(roto(null)), []);
  assert.deepEqual(objetivosGastoCreado(gasto("15/10/2026")), []);
  assert.deepEqual(objetivosGastoCreado(gasto("2026-00-10")), []);
  assert.deepEqual(objetivosGastoEditado(roto({ fecha: 5 })), []);
  assert.deepEqual(objetivosCuentaPorPagar(roto(undefined)), []);
  assert.deepEqual(objetivosUmbralCritico(roto({ variante_sku_id: VAR_A })), []);
  assert.deepEqual(objetivosIngresoStock(roto({ deposito_destino_id: DEP_1, items: "x" })), []);
  assert.deepEqual(objetivosIngresoStock(roto({ deposito_destino_id: DEP_1, items: [null, {}] })), []);
  assert.deepEqual(objetivosTransferenciaIniciada(roto({ items: [{ variante_sku_id: VAR_A }] })), []);
  assert.deepEqual(objetivosReservaCongelada(roto(null)), []);
  assert.deepEqual(objetivosReclasificacionDevuelto(roto(null)), []);
  assert.deepEqual(reservasALiberar(roto({ motivo_liberacion: "TTL_VENCIDO" })), []);
  assert.deepEqual(reservasALiberar(roto(null)), []);
});
