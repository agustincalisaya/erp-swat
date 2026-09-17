import assert from "node:assert/strict";
import test from "node:test";

const DATABASE_URL = process.env.HU_C1_INTEGRATION_DATABASE_URL;

test("HU-C1 integra alta de Cliente con validación de unicidad por DNI, consentimiento inicial y auditoría", {
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
  // `usuario_id` del evento/auditoría, este test no ejercita RBAC.
  const USUARIO_ID = "64a0a7e3-76e2-4637-828e-f7cb96756597";

  function dniNuevo() {
    // 8 dígitos numéricos, sin colisión entre corridas del test.
    return String(10_000_000 + (Date.now() % 89_999_999)).slice(0, 8);
  }

  // ── Alta con DNI nuevo → crea Cliente + ConsentimientoCliente ───────────
  const dni = dniNuevo();
  const alta = await cliente.crearCliente(
    { dni, nombre: "Cliente de Prueba HU-C1", telefono: "3870000000", email: "hu-c1@example.com" },
    USUARIO_ID,
  );
  assert.equal(alta.dni, dni);
  assert.equal(alta.es_nuevo, true);
  assert.ok(alta.cliente_id);

  const clienteCreado = await prisma.cliente.findUniqueOrThrow({
    where: { id: alta.cliente_id },
    select: {
      dni: true,
      nombre: true,
      telefono: true,
      email: true,
      is_active: true,
      segmento: true,
      canal_preferido: true,
    },
  });
  assert.equal(clienteCreado.dni, dni);
  assert.equal(clienteCreado.nombre, "Cliente de Prueba HU-C1");
  assert.equal(clienteCreado.telefono, "3870000000");
  assert.equal(clienteCreado.email, "hu-c1@example.com");
  assert.equal(clienteCreado.is_active, true);
  assert.equal(clienteCreado.segmento, "MINORISTA");
  assert.equal(clienteCreado.canal_preferido, null);

  const consentimientos = await prisma.consentimientoCliente.findMany({
    where: { cliente_id: alta.cliente_id },
    select: { alcance: true, finalidad: true, is_active: true },
  });
  assert.equal(consentimientos.length, 1);
  assert.equal(consentimientos[0]!.alcance, "VENTA_ASISTIDA");
  assert.equal(consentimientos[0]!.is_active, true);
  assert.ok(consentimientos[0]!.finalidad.length > 0);

  // ── Alta repitiendo el mismo DNI → recupera, no duplica ─────────────────
  const recuperado = await cliente.crearCliente(
    { dni, nombre: "Nombre Distinto Ignorado", telefono: "0000000000" },
    USUARIO_ID,
  );
  assert.equal(recuperado.cliente_id, alta.cliente_id);
  assert.equal(recuperado.dni, dni);
  assert.equal(recuperado.es_nuevo, false);

  assert.equal(await prisma.cliente.count({ where: { dni } }), 1);
  // El intento de recuperación no debe haber tocado nombre/teléfono.
  const clienteTrasRecuperar = await prisma.cliente.findUniqueOrThrow({
    where: { id: alta.cliente_id },
    select: { nombre: true },
  });
  assert.equal(clienteTrasRecuperar.nombre, "Cliente de Prueba HU-C1");
  assert.equal(
    await prisma.consentimientoCliente.count({ where: { cliente_id: alta.cliente_id } }),
    1,
  );

  // ── Concurrencia: dos altas simultáneas con el mismo DNI nuevo ──────────
  // producen un único Cliente (el `@unique` de `dni` resuelve la carrera).
  const dniConcurrente = dniNuevo();
  const carrera = await Promise.allSettled([
    cliente.crearCliente({ dni: dniConcurrente, nombre: "Carrera A" }, USUARIO_ID),
    cliente.crearCliente({ dni: dniConcurrente, nombre: "Carrera B" }, USUARIO_ID),
  ]);
  const cumplidas = carrera.filter(
    (resultado): resultado is PromiseFulfilledResult<Awaited<ReturnType<typeof cliente.crearCliente>>> =>
      resultado.status === "fulfilled",
  );
  assert.ok(cumplidas.length >= 1);
  assert.equal(await prisma.cliente.count({ where: { dni: dniConcurrente } }), 1);
  const idsDevueltos = new Set(cumplidas.map((resultado) => resultado.value.cliente_id));
  assert.equal(idsDevueltos.size, 1);

  // ── Auditoría: el listener es fire-and-forget, esperar su materialización ──
  let auditAlta: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
  for (let intento = 0; intento < 20 && auditAlta.length === 0; intento++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    auditAlta = await prisma.auditLog.findMany({
      where: { tabla_afectada: "clientes", registro_id: alta.cliente_id },
    });
  }
  assert.equal(auditAlta.length, 1);
  assert.equal(auditAlta[0]!.usuario_id, USUARIO_ID);
  assert.equal(auditAlta[0]!.accion, "CREATE");
  assert.deepEqual(auditAlta[0]!.valor_nuevo, { dni });

  // La recuperación (DNI ya existente) NO debe haber generado un segundo
  // evento/asiento de auditoría — sigue habiendo exactamente uno.
  assert.equal(
    await prisma.auditLog.count({ where: { tabla_afectada: "clientes", registro_id: alta.cliente_id } }),
    1,
  );

  console.info("[HU-C1:EVIDENCIA]", JSON.stringify({
    dni,
    cliente_id: alta.cliente_id,
    es_nuevo_en_alta: alta.es_nuevo,
    es_nuevo_en_recuperacion: recuperado.es_nuevo,
    consentimiento_alcance: consentimientos[0]!.alcance,
    audit_log_id: auditAlta[0]!.id,
    dni_concurrente: dniConcurrente,
    ids_unicos_en_carrera: idsDevueltos.size,
  }));
});
