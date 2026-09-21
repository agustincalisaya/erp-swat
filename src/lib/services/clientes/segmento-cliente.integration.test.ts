import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Suite de integración de HU-C8 (spec_modulo_C.md §2.8) — espeja el patrón de
 * `canal-contacto.integration.test.ts` (HU-C9): se salta (no falla) cuando
 * `HU_C8_INTEGRATION_DATABASE_URL` no está definida, resuelve el
 * `DATABASE_URL` ANTES de los imports dinámicos, y espera la materialización
 * fire-and-forget de la auditoría con polling.
 *
 * Correr con: `npm run test:integration:c8`.
 *
 * Escenarios (spec §2.8 + auditoría §3.3/§4):
 *  (a) un cliente recién creado nace `MINORISTA` por el default de columna,
 *      SIN ninguna llamada a este endpoint (no hay inicialización explícita).
 *  (b) `MINORISTA` → `MAYORISTA`: persistido y shape
 *      `{ cliente_id, segmento_anterior, segmento_nuevo }`.
 *  (c) `MAYORISTA` → `CLIENTE_FRECUENTE`: re-edición libre, sin máquina de
 *      estados ni transiciones prohibidas.
 *  (d) cliente inexistente Y cliente inactivo → `CLIENTE_NO_ENCONTRADO`, sin
 *      escritura ni asiento.
 *  (e) el asiento de `audit_logs` es `accion: "UPDATE"`,
 *      `tabla_afectada: "clientes"`, `registro_id = clienteId`, con la cadena
 *      SHA-256 intacta (ambos asientos entran encadenados).
 *
 * Los fixtures se dan de baja lógica (UPDATE de `is_active`/`deleted_at`/
 * `deleted_by`/`deletion_reason`) — NUNCA `delete()`/`deleteMany()`.
 */
const DATABASE_URL = process.env.HU_C8_INTEGRATION_DATABASE_URL;

test("HU-C8 integra actualización del segmento comercial (default + persistencia + auditoría UPDATE)", {
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

  // ── (a) Default de columna: alta SIN tocar este endpoint ───────────────
  // Se crea directamente por Prisma (como haría cualquier alta) sin pasar
  // `segmento`: el valor debe venir del `DEFAULT 'MINORISTA'` de la columna.
  const clienteFixture = await prisma.cliente.create({
    data: { dni: dniNuevo(), nombre: "Cliente HU-C8 principal" },
    select: { id: true, segmento: true },
  });
  idFixtures.push(clienteFixture.id);
  assert.equal(
    clienteFixture.segmento,
    "MINORISTA",
    "un cliente recién creado debe nacer MINORISTA por el default de columna (sin llamada a este endpoint)",
  );

  // ── (b) MINORISTA → MAYORISTA ──────────────────────────────────────────
  const resultadoB = await cliente.actualizarSegmentoCliente(
    clienteFixture.id,
    { segmento: "MAYORISTA" },
    USUARIO_ID,
  );
  assert.deepEqual(resultadoB, {
    cliente_id: clienteFixture.id,
    segmento_anterior: "MINORISTA",
    segmento_nuevo: "MAYORISTA",
  });

  const trasB = await prisma.cliente.findUniqueOrThrow({
    where: { id: clienteFixture.id },
    select: { segmento: true },
  });
  assert.equal(trasB.segmento, "MAYORISTA", "la fila debe quedar persistida en MAYORISTA");

  // ── (c) MAYORISTA → CLIENTE_FRECUENTE (re-edición libre) ───────────────
  const resultadoC = await cliente.actualizarSegmentoCliente(
    clienteFixture.id,
    { segmento: "CLIENTE_FRECUENTE" },
    USUARIO_ID,
  );
  assert.deepEqual(resultadoC, {
    cliente_id: clienteFixture.id,
    segmento_anterior: "MAYORISTA",
    segmento_nuevo: "CLIENTE_FRECUENTE",
  });

  const trasC = await prisma.cliente.findUniqueOrThrow({
    where: { id: clienteFixture.id },
    select: { segmento: true },
  });
  assert.equal(trasC.segmento, "CLIENTE_FRECUENTE");

  // ── (d1) cliente inexistente → CLIENTE_NO_ENCONTRADO ───────────────────
  const codigoInexistente = await codigoDeError(
    cliente.actualizarSegmentoCliente(randomUUID(), { segmento: "MINORISTA" }, USUARIO_ID),
  );
  assert.equal(codigoInexistente, "CLIENTE_NO_ENCONTRADO");

  // ── (d2) cliente inactivo → CLIENTE_NO_ENCONTRADO y sin escritura ───────
  const clienteInactivo = await prisma.cliente.create({
    data: { dni: dniNuevo(), nombre: "Cliente HU-C8 inactivo", segmento: "MAYORISTA" },
    select: { id: true },
  });
  idFixtures.push(clienteInactivo.id);
  await prisma.cliente.update({
    where: { id: clienteInactivo.id },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: USUARIO_ID,
      deletion_reason: "Setup de HU-C8: verificar resolución del cliente inactivo",
    },
  });

  const codigoInactivo = await codigoDeError(
    cliente.actualizarSegmentoCliente(clienteInactivo.id, { segmento: "MINORISTA" }, USUARIO_ID),
  );
  assert.equal(codigoInactivo, "CLIENTE_NO_ENCONTRADO");

  const filaInactivo = await prisma.cliente.findUniqueOrThrow({
    where: { id: clienteInactivo.id },
    select: { segmento: true, is_active: true },
  });
  assert.equal(filaInactivo.is_active, false);
  assert.equal(
    filaInactivo.segmento,
    "MAYORISTA",
    "un cliente inactivo no debe haber sido modificado",
  );

  // ── (e) Materialización de auditoría ────────────────────────────────────
  // Fire-and-forget: se esperan los DOS asientos UPDATE del clienteFixture.
  let asientos: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
  for (let intento = 0; intento < 40 && asientos.length < 2; intento++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    asientos = await prisma.auditLog.findMany({
      where: { tabla_afectada: "clientes", registro_id: clienteFixture.id, accion: "UPDATE" },
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
  assert.equal(primero.registro_id, clienteFixture.id);
  assert.deepEqual(
    primero.valor_anterior,
    { segmento: "MINORISTA" },
    "el primer asiento debe registrar el segmento previo",
  );
  const nuevoPrimero = primero.valor_nuevo as Record<string, unknown>;
  assert.equal(nuevoPrimero.cliente_id, clienteFixture.id);
  assert.deepEqual(
    nuevoPrimero.campos_modificados,
    ["segmento"],
    "`campos_modificados` no tiene columna propia: se pliega dentro de `valor_nuevo`",
  );
  assert.equal(nuevoPrimero.segmento, "MAYORISTA");
  assert.ok(
    primero.hash_actual.length > 0,
    "el asiento debe entrar en la cadena SHA-256 de auditoría",
  );

  const segundo = asientos[1]!;
  assert.equal(segundo.accion, "UPDATE");
  assert.equal(segundo.tabla_afectada, "clientes");
  assert.equal(segundo.registro_id, clienteFixture.id);
  assert.deepEqual(
    segundo.valor_anterior,
    { segmento: "MAYORISTA" },
    "la re-edición debe preservar el valor anterior real",
  );
  const nuevoSegundo = segundo.valor_nuevo as Record<string, unknown>;
  assert.equal(nuevoSegundo.segmento, "CLIENTE_FRECUENTE");
  assert.ok(segundo.hash_actual.length > 0);
  assert.notEqual(
    segundo.hash_actual,
    primero.hash_actual,
    "cada asiento de la cadena debe tener su propio hash encadenado",
  );

  // Ningún asiento UPDATE para el cliente inactivo (falló antes de escribir).
  assert.equal(
    await prisma.auditLog.count({
      where: { accion: "UPDATE", registro_id: clienteInactivo.id },
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
    updateDeLaCorrida.every((asiento) => asiento.registro_id === clienteFixture.id),
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
        deletion_reason: "Cleanup de la suite HU-C8 (baja lógica, nunca DELETE)",
      },
    });
  }

  console.info("[HU-C8:EVIDENCIA]", JSON.stringify({
    cliente_id: clienteFixture.id,
    segmento_inicial: clienteFixture.segmento,
    segmento_final: trasC.segmento,
    inexistente_code: codigoInexistente,
    inactivo_code: codigoInactivo,
    asientos_update: asientos.length,
    asientos_corrida: updateDeLaCorrida.length,
  }));
});
