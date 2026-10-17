import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Suite de integración de HU-C9 (spec_modulo_C.md §2.3) — espeja el patrón de
 * `direccion-cliente.integration.test.ts` (HU-C3): se salta (no falla) cuando
 * `HU_C9_INTEGRATION_DATABASE_URL` no está definida, resuelve el
 * `DATABASE_URL` ANTES de los imports dinámicos, y espera la materialización
 * fire-and-forget de la auditoría con polling.
 *
 * Correr con: `npm run test:integration:c9`.
 *
 * Escenarios (spec §2.3 + auditoría §3.3/§4):
 *  (a) `null` → `WHATSAPP`: persistido y asiento con
 *      `valor_anterior: { canal_preferido: null }`.
 *  (b) `WHATSAPP` → `AMBOS`: re-edición con el anterior capturado.
 *  (c) cliente inexistente Y cliente inactivo → `CLIENTE_NO_ENCONTRADO`, sin
 *      escritura ni asiento.
 *  (d) el asiento de `audit_logs` es `accion: "UPDATE"`,
 *      `tabla_afectada: "clientes"`, `registro_id = clienteId`, con la cadena
 *      SHA-256 intacta.
 *
 * Los fixtures se dan de baja lógica (UPDATE de `is_active`/`deleted_at`/
 * `deleted_by`/`deletion_reason`) — NUNCA `delete()`/`deleteMany()`.
 */
const DATABASE_URL = process.env.HU_C9_INTEGRATION_DATABASE_URL;

test("HU-C9 integra actualización del canal de contacto (persistencia + auditoría UPDATE)", {
  skip: !DATABASE_URL,
  timeout: 30_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;

  const [
    { prisma },
    cliente,
    { iniciarAuditLogListener },
  ] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./cliente.service.ts"),
    import("../../events/listeners/audit-log.listener.ts"),
  ]);
  t.after(async () => prisma.$disconnect());
  iniciarAuditLogListener();

  // Usuario ya sembrado por seed.ts (rol ADMINISTRADOR) — solo se usa como
  // `usuario_id` del evento/auditoría; este test no ejercita RBAC.
  const USUARIO_ID = "64a0a7e3-76e2-4637-828e-f7cb96756597";

  const inicioDeLaCorrida = new Date();
  /** Ids de todos los clientes fixture creados por esta suite (cleanup). */
  const idFixtures: string[] = [];

  let secuenciaDni = 0;
  function dniNuevo(): string {
    secuenciaDni += 1;
    return String(10_000_000 + ((Date.now() + secuenciaDni * 1013) % 89_999_999)).slice(0, 8);
  }

  /** Devuelve el `code` del ServiceError, o `null` si la promesa resolvió. */
  async function codigoDeError(promesa: Promise<unknown>): Promise<string | null> {
    try {
      await promesa;
      return null;
    } catch (err) {
      return (err as { code?: string } | null)?.code ?? null;
    }
  }

  async function crearClienteDePrueba(
    sufijo: string,
    canalInicial: "WHATSAPP" | "EMAIL" | "AMBOS" | null,
  ): Promise<string> {
    const creado = await prisma.cliente.create({
      data: {
        dni: dniNuevo(),
        nombre: `Cliente HU-C9 ${sufijo}`,
        canal_preferido: canalInicial,
      },
      select: { id: true },
    });
    idFixtures.push(creado.id);
    return creado.id;
  }

  // ── (a) null → WHATSAPP ─────────────────────────────────────────────────
  const cliente1 = await crearClienteDePrueba("principal", null);

  const resultadoA = await cliente.actualizarCanalContacto(
    cliente1,
    { canal_preferido: "WHATSAPP" },
    USUARIO_ID,
  );
  assert.deepEqual(resultadoA, { cliente_id: cliente1, canal_preferido: "WHATSAPP" });

  const trasA = await prisma.cliente.findUniqueOrThrow({
    where: { id: cliente1 },
    select: { canal_preferido: true },
  });
  assert.equal(trasA.canal_preferido, "WHATSAPP", "la fila debe quedar persistida en WHATSAPP");

  // ── (b) WHATSAPP → AMBOS (re-edición, sin máquina de estados) ───────────
  const resultadoB = await cliente.actualizarCanalContacto(
    cliente1,
    { canal_preferido: "AMBOS" },
    USUARIO_ID,
  );
  assert.deepEqual(resultadoB, { cliente_id: cliente1, canal_preferido: "AMBOS" });

  const trasB = await prisma.cliente.findUniqueOrThrow({
    where: { id: cliente1 },
    select: { canal_preferido: true },
  });
  assert.equal(trasB.canal_preferido, "AMBOS");

  // ── (c1) cliente inexistente → CLIENTE_NO_ENCONTRADO ────────────────────
  const codigoInexistente = await codigoDeError(
    cliente.actualizarCanalContacto(randomUUID(), { canal_preferido: "EMAIL" }, USUARIO_ID),
  );
  assert.equal(codigoInexistente, "CLIENTE_NO_ENCONTRADO");

  // ── (c2) cliente inactivo → CLIENTE_NO_ENCONTRADO y sin escritura ───────
  const clienteInactivo = await crearClienteDePrueba("inactivo", "EMAIL");
  await prisma.cliente.update({
    where: { id: clienteInactivo },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: USUARIO_ID,
      deletion_reason: "Setup de HU-C9: verificar resolución del cliente inactivo",
    },
  });

  const codigoInactivo = await codigoDeError(
    cliente.actualizarCanalContacto(clienteInactivo, { canal_preferido: "WHATSAPP" }, USUARIO_ID),
  );
  assert.equal(codigoInactivo, "CLIENTE_NO_ENCONTRADO");

  const filaInactivo = await prisma.cliente.findUniqueOrThrow({
    where: { id: clienteInactivo },
    select: { canal_preferido: true, is_active: true },
  });
  assert.equal(filaInactivo.is_active, false);
  assert.equal(
    filaInactivo.canal_preferido,
    "EMAIL",
    "un cliente inactivo no debe haber sido modificado",
  );

  // ── (d) Materialización de auditoría ────────────────────────────────────
  // Fire-and-forget: se esperan los DOS asientos UPDATE del cliente1.
  let asientos: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
  for (let intento = 0; intento < 40 && asientos.length < 2; intento++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    asientos = await prisma.auditLog.findMany({
      where: { tabla_afectada: "clientes", registro_id: cliente1, accion: "UPDATE" },
      orderBy: { created_at: "asc" },
    });
  }
  assert.equal(
    asientos.length,
    2,
    "cada actualización exitosa debe materializar exactamente un asiento UPDATE",
  );

  const primero = asientos[0]!;
  assert.equal(primero.usuario_id, USUARIO_ID);
  assert.equal(primero.accion, "UPDATE");
  assert.equal(primero.tabla_afectada, "clientes");
  assert.equal(primero.registro_id, cliente1);
  assert.deepEqual(
    primero.valor_anterior,
    { canal_preferido: null },
    "el primer asiento debe registrar el `null` previo",
  );
  const nuevoPrimero = primero.valor_nuevo as Record<string, unknown>;
  assert.equal(nuevoPrimero.cliente_id, cliente1);
  assert.deepEqual(
    nuevoPrimero.campos_modificados,
    ["canal_preferido"],
    "`campos_modificados` no tiene columna propia: se pliega dentro de `valor_nuevo`",
  );
  assert.equal(nuevoPrimero.canal_preferido, "WHATSAPP");
  assert.ok(
    primero.hash_actual.length > 0,
    "el asiento debe entrar en la cadena SHA-256 de auditoría",
  );

  const segundo = asientos[1]!;
  assert.equal(segundo.accion, "UPDATE");
  assert.equal(segundo.tabla_afectada, "clientes");
  assert.equal(segundo.registro_id, cliente1);
  assert.deepEqual(
    segundo.valor_anterior,
    { canal_preferido: "WHATSAPP" },
    "la re-edición debe preservar el valor anterior real",
  );
  const nuevoSegundo = segundo.valor_nuevo as Record<string, unknown>;
  assert.equal(nuevoSegundo.canal_preferido, "AMBOS");
  assert.ok(segundo.hash_actual.length > 0);

  // Ningún asiento UPDATE para el cliente inactivo (falló antes de escribir).
  assert.equal(
    await prisma.auditLog.count({
      where: { accion: "UPDATE", registro_id: clienteInactivo },
    }),
    0,
    "un CLIENTE_NO_ENCONTRADO no debe emitir asiento",
  );

  // Solo las actualizaciones exitosas de esta corrida deben auditarse.
  const updateDeLaCorrida = await prisma.auditLog.findMany({
    where: {
      accion: "UPDATE",
      tabla_afectada: "clientes",
      created_at: { gte: inicioDeLaCorrida },
    },
    select: { registro_id: true },
  });
  assert.equal(
    updateDeLaCorrida.length,
    2,
    "solo las actualizaciones exitosas deben auditarse (los 404 no emiten)",
  );
  assert.ok(
    updateDeLaCorrida.every((asiento) => asiento.registro_id === cliente1),
    "todo asiento UPDATE de esta corrida debe corresponder al cliente actualizado",
  );

  // ── Cleanup: baja lógica de los fixtures (NUNCA delete) ─────────────────
  for (const id of idFixtures) {
    await prisma.cliente.update({
      where: { id },
      data: {
        is_active: false,
        deleted_at: new Date(),
        deleted_by: USUARIO_ID,
        deletion_reason: "Cleanup de la suite HU-C9 (baja lógica, nunca DELETE)",
      },
    });
  }

  console.info("[HU-C9:EVIDENCIA]", JSON.stringify({
    cliente_id: cliente1,
    canal_final: trasB.canal_preferido,
    inexistente_code: codigoInexistente,
    inactivo_code: codigoInactivo,
    asientos_update: asientos.length,
    asientos_corrida: updateDeLaCorrida.length,
  }));
});
