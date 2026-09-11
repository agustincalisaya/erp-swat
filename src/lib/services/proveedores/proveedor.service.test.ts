import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CambiarEstadoProveedorSchema,
  CrearProveedorSchema,
  DarDeBajaProveedorSchema,
  EditarProveedorSchema,
  esErrorCamposNoEditables,
  ProveedorIdSchema,
} from "../../schemas/proveedores.schema.ts";

/**
 * Tests source-regex sobre `proveedor.service.ts` (mismo patrón que
 * `evaluacion.service.test.ts` — sin mock de prisma) + tests de schemas Zod
 * H1. Verifican los contratos del spec §2.1/§2.2 y del design (D1-D9).
 */

const proveedorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const fuente = readFileSync(new URL("./proveedor.service.ts", import.meta.url), "utf8");

// ──────────────────────────────────────────────────────────────────────────────
// Schemas Zod H1
// ──────────────────────────────────────────────────────────────────────────────

test("CrearProveedorSchema acepta un alta completa con datos bancarios", () => {
  const resultado = CrearProveedorSchema.safeParse({
    razon_social: "Textil Los Andes S.A.",
    cuit: "30-12345678-9",
    categorias: ["Textil Táctico"],
    datos_bancarios: { cbu: "1234567890123456789012", alias: "LOS.ANDES.SA", banco: "Banco Nación" },
  });
  assert.equal(resultado.success, true);
});

test("CrearProveedorSchema valida el formato CUIT NN-NNNNNNNN-N", () => {
  assert.equal(
    CrearProveedorSchema.safeParse({
      razon_social: "Textil Los Andes S.A.",
      cuit: "30-12345678",
      categorias: ["Textil"],
    }).success,
    false,
  );
  assert.equal(
    CrearProveedorSchema.safeParse({
      razon_social: "Textil Los Andes S.A.",
      cuit: "30123456789",
      categorias: ["Textil"],
    }).success,
    false,
  );
});

test("CrearProveedorSchema exige al menos una categoría y rechaza más de 20 o ítems de más de 50 chars", () => {
  assert.equal(
    CrearProveedorSchema.safeParse({ razon_social: "A", cuit: "30-12345678-9", categorias: [] }).success,
    false,
  );
  assert.equal(
    CrearProveedorSchema.safeParse({
      razon_social: "A",
      cuit: "30-12345678-9",
      categorias: Array.from({ length: 21 }, (_, i) => `Cat ${i}`),
    }).success,
    false,
  );
  assert.equal(
    CrearProveedorSchema.safeParse({
      razon_social: "A",
      cuit: "30-12345678-9",
      categorias: ["x".repeat(51)],
    }).success,
    false,
  );
});

test("CrearProveedorSchema valida el CBU de 22 dígitos de datos_bancarios", () => {
  assert.equal(
    CrearProveedorSchema.safeParse({
      razon_social: "A",
      cuit: "30-12345678-9",
      categorias: ["Textil"],
      datos_bancarios: { cbu: "12345", banco: "Nación" },
    }).success,
    false,
  );
});

test("CambiarEstadoProveedorSchema exige motivo al transicionar a SUSPENDIDO", () => {
  assert.equal(
    CambiarEstadoProveedorSchema.safeParse({ nuevo_estado: "SUSPENDIDO" }).success,
    false,
  );
  assert.equal(
    CambiarEstadoProveedorSchema.safeParse({ nuevo_estado: "SUSPENDIDO", motivo: "Incumplimiento de plazos" }).success,
    true,
  );
  assert.equal(
    CambiarEstadoProveedorSchema.safeParse({ nuevo_estado: "HOMOLOGADO" }).success,
    true,
  );
});

test("DarDeBajaProveedorSchema exige deletion_reason (motivo obligatorio)", () => {
  assert.equal(DarDeBajaProveedorSchema.safeParse({}).success, false);
  assert.equal(
    DarDeBajaProveedorSchema.safeParse({ deletion_reason: "Cierre de actividad del proveedor" }).success,
    true,
  );
});

test("EditarProveedorSchema rechaza cuit/estado con CAMPOS_NO_EDITABLES y acepta edición parcial", () => {
  assert.equal(
    EditarProveedorSchema.safeParse({ nombre_fantasia: "Los Andes Outlet" }).success,
    true,
  );
  const conCuit = EditarProveedorSchema.safeParse({ nombre_fantasia: "X", cuit: "30-99999999-9" });
  assert.equal(conCuit.success, false);
  if (!conCuit.success) {
    assert.equal(esErrorCamposNoEditables(conCuit.error), true);
  }
  const conEstado = EditarProveedorSchema.safeParse({ estado: "HOMOLOGADO" });
  assert.equal(conEstado.success, false);
});

test("ProveedorIdSchema valida formato uuid", () => {
  assert.equal(ProveedorIdSchema.safeParse(proveedorId).success, true);
  assert.equal(ProveedorIdSchema.safeParse("no-es-uuid").success, false);
});

// ──────────────────────────────────────────────────────────────────────────────
// proveedor.service.ts — contratos de la capa de dominio
// ──────────────────────────────────────────────────────────────────────────────

test("nunca hace DELETE físico: ninguna llamada a .delete() ni .deleteMany()", () => {
  assert.doesNotMatch(fuente, /\.delete\(/);
  assert.doesNotMatch(fuente, /\.deleteMany\(/);
});

test("toda escritura corre dentro de un único prisma.$transaction", () => {
  const transacciones = fuente.match(/prisma\.\$transaction/g) ?? [];
  assert.ok(transacciones.length >= 4, "crear/cambiarEstado/baja/editar usan $transaction");
});

test("la transición de estado lee el estado origen DENTRO de la misma transacción que hace el UPDATE (race-safe)", () => {
  const inicioTransaccion = fuente.indexOf("export async function cambiarEstadoProveedor");
  const bloqueTransicion = fuente.slice(inicioTransaccion, fuente.indexOf("export async function darDeBajaProveedor"));
  const indiceTx = bloqueTransicion.indexOf("prisma.$transaction");
  const indiceFind = bloqueTransicion.indexOf("tx.proveedor.findFirst");
  const indiceUpdate = bloqueTransicion.indexOf("tx.proveedor.updateMany");
  assert.ok(indiceTx >= 0);
  assert.ok(indiceFind > indiceTx);
  assert.ok(indiceUpdate > indiceFind);
});

test("TRANSICIONES_VALIDAS es el mapa exacto de 5 aristas (P→H, H→P, H→S, S→P, S→H)", () => {
  assert.match(fuente, /PENDIENTE: \["HOMOLOGADO"\]/);
  assert.match(fuente, /HOMOLOGADO: \["PENDIENTE", "SUSPENDIDO"\]/);
  assert.match(fuente, /SUSPENDIDO: \["PENDIENTE", "HOMOLOGADO"\]/);
});

test("las transiciones prohibidas (P→S directo y misma→misma) no figuran en el mapa — validación en service", () => {
  const mapa = fuente.slice(fuente.indexOf("TRANSICIONES_VALIDAS"), fuente.indexOf("interface ProveedorCreado"));
  assert.doesNotMatch(mapa, /PENDIENTE: \[.*"SUSPENDIDO"/);
  assert.match(fuente, /destinosValidos\.includes\(input\.nuevo_estado\)/);
  assert.match(fuente, /TRANSICION_INVALIDA/);
});

test("la suspensión exige motivo también en el service (defensa en profundidad)", () => {
  assert.match(fuente, /input\.nuevo_estado === "SUSPENDIDO"/);
  assert.match(fuente, /"El motivo es obligatorio al suspender un proveedor"/);
});

test("el evento proveedor:estado_cambiado se emite post-COMMIT con origen MANUAL y usuario_id real", () => {
  const indiceTx = fuente.indexOf("const resultado = await prisma.$transaction");
  const emitEvento = fuente.indexOf('domainEventBus.emit("proveedor:estado_cambiado"');
  assert.ok(emitEvento > indiceTx);
  const cierreTransaccion = fuente.indexOf("  });", indiceTx);
  assert.ok(emitEvento > cierreTransaccion);
  assert.match(fuente, /origen: "MANUAL"/);
  assert.match(fuente, /usuario_id: usuarioId/);
  assert.match(fuente, /motivo: input\.motivo \?\? ""/);
});

test("el alta cifra datos bancarios con AES ANTES de persistir (encrypt precede a proveedor.create)", () => {
  const indiceEncrypt = fuente.indexOf("encrypt(JSON.stringify(input.datos_bancarios))");
  const indiceCreate = fuente.indexOf("tx.proveedor.create");
  assert.ok(indiceEncrypt >= 0);
  assert.ok(indiceCreate > indiceEncrypt);
  // Nunca se pasa el valor en claro al create.
  const bloqueCreate = fuente.slice(indiceCreate, indiceCreate + 900);
  assert.doesNotMatch(bloqueCreate, /datos_bancarios_cifrado: input\.datos_bancarios/);
});

test("el P2002 de Prisma se traduce a 409 CUIT_DUPLICADO (carrera de altas concurrentes)", () => {
  assert.match(fuente, /error\.code === "P2002"/);
  assert.match(fuente, /"CUIT_DUPLICADO"/);
});

test("la baja lógica usa updateMany con guarda { id, is_active: true, deleted_at: null } y count===0 → 404", () => {
  const indiceBaja = fuente.indexOf("export async function darDeBajaProveedor");
  const bloqueBaja = fuente.slice(indiceBaja, fuente.indexOf("export async function editarProveedor"));
  assert.match(bloqueBaja, /where: \{ id: proveedorId, is_active: true, deleted_at: null \}/);
  assert.match(bloqueBaja, /cambio\.count === 0/);
  assert.match(bloqueBaja, /"PROVEEDOR_NO_ENCONTRADO"/);
  assert.match(bloqueBaja, /deletion_reason: input\.deletion_reason/);
});

test("la baja emite proveedor:baja_logica post-COMMIT con { proveedor_id, usuario_id, motivo }", () => {
  const indiceTx = fuente.indexOf("const ahora = new Date();");
  const emitBaja = fuente.indexOf('domainEventBus.emit("proveedor:baja_logica"');
  assert.ok(emitBaja > indiceTx);
  assert.match(
    fuente,
    /proveedor_id: proveedorId,\s*usuario_id: usuarioId,\s*motivo: input\.deletion_reason/,
  );
});

test("la edición rechaza cuit/estado en el service con 422 CAMPOS_NO_EDITABLES", () => {
  assert.match(fuente, /"cuit" in input \|\| "estado" in input/);
  assert.match(fuente, /"CAMPOS_NO_EDITABLES"/);
});

test("el reemplazo de datos bancarios se re-cifra con IV nuevo y campos_editados nunca incluye el valor", () => {
  assert.match(fuente, /datos_bancarios_cifrado = bancarios\.ciphertext/);
  assert.match(fuente, /datos_bancarios_iv = bancarios\.iv/);
  assert.match(fuente, /camposEditados\.push\("datos_bancarios"\)/);
});

test("ningún emit de evento transporta datos bancarios (ni claro ni ciphertext)", () => {
  // Extrae SOLO los payloads de los emits (desde `domainEventBus.emit(`
  // hasta el `});` que los cierra) — no el resto del archivo, donde el
  // update de `datos_bancarios_cifrado` sí escribe el ciphertext.
  const reEmit = /domainEventBus\.emit\([\s\S]*?\);/g;
  const emits = fuente.match(reEmit) ?? [];
  assert.ok(emits.length >= 3, "hay al menos 3 emits (estado, baja, legajo)");
  for (const emit of emits) {
    assert.doesNotMatch(emit, /datos_bancarios/);
    assert.doesNotMatch(emit, /\.cbu/);
    assert.doesNotMatch(emit, /ciphertext/);
  }
});

test("el listado filtra is_active=true y nunca selecciona datos_bancarios_*", () => {
  const indiceListado = fuente.indexOf("export async function listarProveedores");
  const bloqueListado = fuente.slice(indiceListado);
  assert.match(bloqueListado, /is_active: true,\s*deleted_at: null/);
  assert.doesNotMatch(bloqueListado, /datos_bancarios_cifrado/);
  assert.doesNotMatch(bloqueListado, /datos_bancarios_iv/);
  assert.match(bloqueListado, /filtros\.estado\) where\.estado = filtros\.estado/);
});

test("expone las 5 constantes de permiso granular (un permiso por acción, sin administrar)", () => {
  assert.match(fuente, /PERMISO_CREAR = "proveedores:crear"/);
  assert.match(fuente, /PERMISO_HOMOLOGAR = "proveedores:homologar"/);
  assert.match(fuente, /PERMISO_BAJA = "proveedores:baja"/);
  assert.match(fuente, /PERMISO_EDITAR = "proveedores:editar"/);
  assert.match(fuente, /PERMISO_LEER = "proveedores:leer"/);
  assert.doesNotMatch(fuente, /proveedores:administrar/);
});

test("no hay ninguna llamada directa a un servicio/tabla de auditoría: solo emite eventos de dominio", () => {
  assert.doesNotMatch(fuente, /auditLog\.create/);
  assert.doesNotMatch(fuente, /registrarAuditLog/);
});