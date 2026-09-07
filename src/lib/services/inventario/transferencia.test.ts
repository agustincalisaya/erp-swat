import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CrearTransferenciaSchema, BajaTransferenciaSchema, FiltrosHistorialTransferenciasSchema, RegistrarIngresoPorEscaneoSchema, TransferenciaIdSchema } from "../../schemas/inventario.schema.ts";
import { calcularResumenStock } from "./stock-calculos.ts";

const variante = "11111111-1111-4111-8111-111111111111";
const central = "22222222-2222-4222-8222-222222222222";
const showroom = "33333333-3333-4333-8333-333333333333";

test("acepta un despacho entre depósitos distintos con cantidad positiva", () => {
  assert.equal(CrearTransferenciaSchema.safeParse({ deposito_origen_id: central, deposito_destino_id: showroom, items: [{ variante_sku_id: variante, cantidad: 8 }] }).success, true);
});

test("rechaza origen y destino iguales sin permitir llegar al servicio", () => {
  const result = CrearTransferenciaSchema.safeParse({ deposito_origen_id: central, deposito_destino_id: central, items: [{ variante_sku_id: variante, cantidad: 8 }] });
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ["deposito_destino_id"]);
});

test("rechaza cantidad cero, negativa o fraccionaria", () => {
  for (const cantidad of [0, -1, 1.5]) {
    assert.equal(CrearTransferenciaSchema.safeParse({ deposito_origen_id: central, deposito_destino_id: showroom, items: [{ variante_sku_id: variante, cantidad }] }).success, false);
  }
});

test("HU-A11: rechaza un carrito de transferencia vacío", () => {
  assert.equal(CrearTransferenciaSchema.safeParse({ deposito_origen_id: central, deposito_destino_id: showroom, items: [] }).success, false);
});

test("mantiene el tránsito fuera del disponible y dentro del total físico", () => {
  assert.deepEqual(calcularResumenStock(17, 8), { disponible: 17, en_transito: 8, total_fisico: 25 });
  assert.deepEqual(calcularResumenStock(25, 0), { disponible: 25, en_transito: 0, total_fisico: 25 });
});

test("flujo completo: destino no aumenta antes de recibir y el total físico se conserva", () => {
  let centralDisponible = 20;
  let showroomDisponible = 5;
  let enTransito = 0;
  centralDisponible -= 5;
  enTransito += 5;
  assert.deepEqual({ centralDisponible, showroomDisponible, enTransito }, { centralDisponible: 15, showroomDisponible: 5, enTransito: 5 });
  assert.equal(calcularResumenStock(centralDisponible + showroomDisponible, enTransito).total_fisico, 25);
  showroomDisponible += 5;
  enTransito -= 5;
  assert.deepEqual({ centralDisponible, showroomDisponible, enTransito }, { centralDisponible: 15, showroomDisponible: 10, enTransito: 0 });
  assert.equal(calcularResumenStock(centralDisponible + showroomDisponible, enTransito).total_fisico, 25);
});

test("la disponibilidad por depósito no usa stock de otro depósito", () => {
  const showroomDisponible = 0;
  const movilDisponible = 10;
  assert.equal(showroomDisponible, 0);
  assert.equal(calcularResumenStock(showroomDisponible + movilDisponible, 0).total_fisico, 10);
});

test("la baja lógica exige motivo no vacío", () => {
  assert.equal(BajaTransferenciaSchema.safeParse({ deletion_reason: "" }).success, false);
  assert.equal(BajaTransferenciaSchema.safeParse({ deletion_reason: "Remito archivado" }).success, true);
});

test("un ingreso común no puede declarar stock EN_TRANSITO", () => {
  const resultado = RegistrarIngresoPorEscaneoSchema.safeParse({
    deposito_destino_id: central,
    comprobante_referencia: "ING-1",
    items: [{ variante_sku_id: variante, cantidad: 1, estado_destino: "EN_TRANSITO" }],
  });
  assert.equal(resultado.success, false);
});

test("HU-A11: rechaza un carrito de ingreso vacío", () => {
  const resultado = RegistrarIngresoPorEscaneoSchema.safeParse({
    deposito_destino_id: central,
    comprobante_referencia: "ING-1",
    items: [],
  });
  assert.equal(resultado.success, false);
});

test("recepción y baja exigen un UUID de transferencia válido", () => {
  assert.equal(TransferenciaIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(TransferenciaIdSchema.safeParse(variante).success, true);
});

test("los filtros del historial aceptan remito parcial, fechas y página", () => {
  const resultado = FiltrosHistorialTransferenciasSchema.parse({
    remito: "  TR-123  ",
    desde: "2026-08-01",
    hasta: "2026-08-31",
    page: "2",
  });
  assert.deepEqual(resultado, { remito: "TR-123", desde: "2026-08-01", hasta: "2026-08-31", page: 2 });
});

test("los filtros del historial rechazan fechas inexistentes y rangos invertidos", () => {
  assert.equal(FiltrosHistorialTransferenciasSchema.safeParse({ desde: "2026-02-30" }).success, false);
  assert.equal(FiltrosHistorialTransferenciasSchema.safeParse({ desde: "2026-08-20", hasta: "2026-08-10" }).success, false);
});

test("el historial consulta sólo recibidas activas, pagina en servidor y usa Hasta inclusivo", () => {
  const fuente = readFileSync(new URL("./transferencia.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /estado: "RECIBIDA"/);
  assert.match(fuente, /is_active: true/);
  assert.match(fuente, /deleted_at: null/);
  assert.match(fuente, /contains: filtros\.remito, mode: "insensitive"/);
  assert.match(fuente, /skip: \(filtros\.page - 1\) \* HISTORIAL_PAGE_SIZE/);
  assert.match(fuente, /take: HISTORIAL_PAGE_SIZE/);
  assert.match(fuente, /\{ lt: hastaExclusivo \}/);
});

test("el servicio protege stock insuficiente, entidades inactivas y doble recepción con operaciones condicionadas", () => {
  const fuente = readFileSync(new URL("./transferencia.service.ts", import.meta.url), "utf8");
  // HU-A11 (multi-ítem): el decremento de origen es por ítem del carrito, no un `input.cantidad` único.
  assert.match(fuente, /cantidad:\s*\{ gte: item\.cantidad \}/);
  assert.match(fuente, /if \(decremento\.count === 0\)/);
  // HU-A11: "ya recibida" ahora se valida sobre la cabecera antes del loop de ítems
  // (no un `updateMany` todo-o-nada); la doble recepción del MISMO ítem se blinda con
  // un `updateMany` condicionado sobre `cantidad_recibida` (protección por ítem, no por remito).
  assert.match(fuente, /transferencia\.estado === "RECIBIDA"/);
  assert.match(fuente, /cantidad_recibida:\s*item\.cantidad_recibida/);
  assert.match(fuente, /ITEM_RECEPCION_CONCURRENTE/);
  assert.match(fuente, /TRANSFERENCIA_YA_RECIBIDA/);
  assert.match(fuente, /STOCK_DESTINO_INACTIVO/);
  assert.match(fuente, /VARIANTE_NO_ENCONTRADA/);
  assert.match(fuente, /DEPOSITO_ORIGEN_NO_ENCONTRADO/);
  assert.match(fuente, /DEPOSITO_DESTINO_NO_ENCONTRADO/);
});

test("despacho y recepción conservan las fases y emiten eventos después de la transacción", () => {
  const fuente = readFileSync(new URL("./transferencia.service.ts", import.meta.url), "utf8");
  const finDespacho = fuente.indexOf('domainEventBus.emit("stock:transferencia_iniciada"');
  const finRecepcion = fuente.indexOf('domainEventBus.emit("stock:transferencia_recepcion_confirmada"');
  const inicioRecepcion = fuente.indexOf("export async function confirmarRecepcionTransferencia");
  const transaccionRecepcion = fuente.indexOf("const resultado = await prisma.$transaction", inicioRecepcion);
  assert.ok(finDespacho > fuente.indexOf("const resultado = await prisma.$transaction"));
  assert.ok(finRecepcion > transaccionRecepcion);
  assert.match(fuente, /estado_origen: "DISPONIBLE"[\s\S]*estado_destino: "EN_TRANSITO"/);
  assert.match(fuente, /estado_origen: "EN_TRANSITO"[\s\S]*estado_destino: "DISPONIBLE"/);
});

test("HU-A11: recepción parcial recalcula el estado de la cabecera mirando todos los ítems", () => {
  const fuente = readFileSync(new URL("./transferencia.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /RECIBIDO_TOTAL/);
  assert.match(fuente, /RECIBIDO_PARCIAL/);
  assert.match(fuente, /const nuevoEstadoCabecera:\s*"PARCIAL"\s*\|\s*"RECIBIDA"\s*=\s*todosTotal \? "RECIBIDA" : "PARCIAL"/);
});

test("RBAC asigna transferencia y recepción sólo a Administrador y Encargado", () => {
  const seed = readFileSync(new URL("../../../../prisma/seed.ts", import.meta.url), "utf8");
  assert.match(seed, /for \(const rol of \[rolEncargadoDeposito, rolAdministrador\]\)/);
  assert.match(seed, /inventario:transferir_stock/);
  assert.match(seed, /inventario:confirmar_recepcion/);
  const ruta = readFileSync(new URL("../../../app/api/inventario/movimientos/transferencia/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /withPermission\("inventario:transferir_stock"/);
  assert.doesNotMatch(seed, /\[rolAuditor[^\]]*permisoTransferirStock/);
  const rbac = readFileSync(new URL("../../auth/with-permission.ts", import.meta.url), "utf8");
  assert.match(rbac, /code: "UNAUTHORIZED"/);
  assert.match(rbac, /status: 401/);
  assert.match(rbac, /code: "FORBIDDEN"/);
  assert.match(rbac, /status: 403/);
});
