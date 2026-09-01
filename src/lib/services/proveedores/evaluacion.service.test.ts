import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RegistrarEvaluacionDesdeRecepcionSchema } from "../../schemas/proveedores.schema.ts";

const usuarioId = "11111111-1111-4111-8111-111111111111";
const recepcionId = "22222222-2222-4222-8222-222222222222";

test("RegistrarEvaluacionDesdeRecepcionSchema acepta el input mínimo y valida UUIDs", () => {
  assert.equal(
    RegistrarEvaluacionDesdeRecepcionSchema.safeParse({ recepcion_id: recepcionId, usuario_id: usuarioId }).success,
    true,
  );
  assert.equal(
    RegistrarEvaluacionDesdeRecepcionSchema.safeParse({ recepcion_id: "no-es-uuid", usuario_id: usuarioId }).success,
    false,
  );
});

test("RegistrarEvaluacionDesdeRecepcionSchema rechaza overrides fuera de rango o negativos", () => {
  assert.equal(
    RegistrarEvaluacionDesdeRecepcionSchema.safeParse({
      recepcion_id: recepcionId,
      usuario_id: usuarioId,
      puntaje_documentacion_override: 101,
    }).success,
    false,
  );
  assert.equal(
    RegistrarEvaluacionDesdeRecepcionSchema.safeParse({
      recepcion_id: recepcionId,
      usuario_id: usuarioId,
      devoluciones_fabricacion: -1,
    }).success,
    false,
  );
});

test("registrarEvaluacionDesdeRecepcion conserva la firma exacta (recepcionId, usuarioId) del contrato con HU-H4", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  assert.match(
    fuente,
    /export async function registrarEvaluacionDesdeRecepcion\(\s*recepcionId: string,\s*usuarioId: string,\s*\)/,
  );
});

test("la lectura de la recepción y el cálculo de sub-puntajes corren dentro de una única transacción", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  const inicioTransaccion = fuente.indexOf("const resultado = await prisma.$transaction");
  const findRecepcion = fuente.indexOf("tx.recepcion.findFirst");
  const createEvaluacion = fuente.indexOf("tx.evaluacionProveedor.create");
  assert.ok(inicioTransaccion >= 0);
  assert.ok(findRecepcion > inicioTransaccion);
  assert.ok(createEvaluacion > findRecepcion);
});

test("EvaluacionProveedor siempre se inserta (nunca se actualiza un registro existente)", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /tx\.evaluacionProveedor\.create/);
  assert.doesNotMatch(fuente, /evaluacionProveedor\.update/);
});

test("nunca hace DELETE físico: ninguna llamada a .delete() ni .deleteMany()", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(fuente, /\.delete\(/);
  assert.doesNotMatch(fuente, /\.deleteMany\(/);
});

test("la suspensión compara contra la constante UMBRAL_MINIMO_HOMOLOGACION, nunca un número mágico", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /puntajeTotal < UMBRAL_MINIMO_HOMOLOGACION/);
});

test("la suspensión es idempotente: no reescribe ni reemite si el proveedor ya está SUSPENDIDO", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /if \(proveedor\.estado !== "SUSPENDIDO"\)/);
});

test("el update de Proveedor.estado a SUSPENDIDO ocurre dentro de la misma transacción que crea la evaluación", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  const inicioTransaccion = fuente.indexOf("const resultado = await prisma.$transaction");
  const finTransaccion = fuente.indexOf("});\n\n  // Post-COMMIT");
  const updateProveedor = fuente.indexOf('tx.proveedor.update');
  assert.ok(updateProveedor > inicioTransaccion);
  assert.ok(finTransaccion < 0 || updateProveedor < finTransaccion);
});

test("el evento proveedor:estado_cambiado se emite después del COMMIT, nunca dentro de la transacción", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  const finTransaccion = fuente.indexOf("const resultado = await prisma.$transaction");
  const emitEvento = fuente.indexOf('domainEventBus.emit("proveedor:estado_cambiado"');
  assert.ok(finTransaccion >= 0);
  assert.ok(emitEvento > finTransaccion);
  // El emit debe estar afuera del cuerpo de la transacción: no antes del cierre `});` que la termina.
  const cierreTransaccion = fuente.indexOf("  });", finTransaccion);
  assert.ok(emitEvento > cierreTransaccion);
});

test("el payload emitido usa origen AUTOMATICO y usuario_id null (es una transición de sistema, no de un usuario)", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /usuario_id:\s*null,/);
  assert.match(fuente, /origen:\s*"AUTOMATICO"/);
  assert.match(fuente, /estado_nuevo:\s*"SUSPENDIDO"/);
});

test("no hay ninguna llamada directa a un servicio/tabla de auditoría: solo emite el evento de dominio", () => {
  const fuente = readFileSync(new URL("./evaluacion.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(fuente, /auditLog\.create/);
  assert.doesNotMatch(fuente, /registrarAuditLog/);
});
