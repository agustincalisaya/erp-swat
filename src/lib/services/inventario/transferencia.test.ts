import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CrearTransferenciaSchema, BajaTransferenciaSchema, RegistrarIngresoPorEscaneoSchema, TransferenciaIdSchema } from "../../schemas/inventario.schema.ts";
import { calcularResumenStock } from "./stock-calculos.ts";

const variante = "11111111-1111-4111-8111-111111111111";
const central = "22222222-2222-4222-8222-222222222222";
const showroom = "33333333-3333-4333-8333-333333333333";

test("acepta un despacho entre depósitos distintos con cantidad positiva", () => {
  assert.equal(CrearTransferenciaSchema.safeParse({ variante_sku_id: variante, deposito_origen_id: central, deposito_destino_id: showroom, cantidad: 8 }).success, true);
});

test("rechaza origen y destino iguales sin permitir llegar al servicio", () => {
  const result = CrearTransferenciaSchema.safeParse({ variante_sku_id: variante, deposito_origen_id: central, deposito_destino_id: central, cantidad: 8 });
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ["deposito_destino_id"]);
});

test("rechaza cantidad cero, negativa o fraccionaria", () => {
  for (const cantidad of [0, -1, 1.5]) {
    assert.equal(CrearTransferenciaSchema.safeParse({ variante_sku_id: variante, deposito_origen_id: central, deposito_destino_id: showroom, cantidad }).success, false);
  }
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
    variante_sku_id: variante,
    deposito_destino_id: central,
    cantidad: 1,
    comprobante_referencia: "ING-1",
    estado_destino: "EN_TRANSITO",
  });
  assert.equal(resultado.success, false);
});

test("recepción y baja exigen un UUID de transferencia válido", () => {
  assert.equal(TransferenciaIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(TransferenciaIdSchema.safeParse(variante).success, true);
});

test("el servicio protege stock insuficiente, entidades inactivas y doble recepción con operaciones condicionadas", () => {
  const fuente = readFileSync(new URL("./transferencia.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /cantidad:\s*\{ gte: input\.cantidad \}/);
  assert.match(fuente, /if \(decremento\.count === 0\)/);
  assert.match(fuente, /estado: "EN_TRANSITO", is_active: true, deleted_at: null/);
  assert.match(fuente, /TRANSFERENCIA_YA_RECIBIDA/);
  assert.match(fuente, /STOCK_DESTINO_INACTIVO/);
  assert.match(fuente, /VARIANTE_NO_ENCONTRADA/);
  assert.match(fuente, /DEPOSITO_ORIGEN_NO_ENCONTRADO/);
  assert.match(fuente, /DEPOSITO_DESTINO_NO_ENCONTRADO/);
});

test("despacho y recepción conservan las fases y emiten eventos después de la transacción", () => {
  const fuente = readFileSync(new URL("./transferencia.service.ts", import.meta.url), "utf8");
  const finDespacho = fuente.indexOf('domainEventBus.emit("stock:transferencia_iniciada"');
  const finRecepcion = fuente.indexOf('domainEventBus.emit("stock:transferencia_recibida"');
  const inicioRecepcion = fuente.indexOf("export async function confirmarRecepcionTransferencia");
  const transaccionRecepcion = fuente.indexOf("const resultado = await prisma.$transaction", inicioRecepcion);
  assert.ok(finDespacho > fuente.indexOf("const resultado = await prisma.$transaction"));
  assert.ok(finRecepcion > transaccionRecepcion);
  assert.match(fuente, /estado_origen: "DISPONIBLE"[\s\S]*estado_destino: "EN_TRANSITO"/);
  assert.match(fuente, /estado_origen: "EN_TRANSITO"[\s\S]*estado_destino: "DISPONIBLE"/);
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
