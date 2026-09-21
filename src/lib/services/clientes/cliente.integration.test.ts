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

  let secuenciaDni = 0;
  function dniNuevo() {
    // 8 dígitos numéricos, sin colisión entre corridas del test.
    return String(10_000_000 + ((Date.now() + secuenciaDni++) % 89_000_000));
  }

  for (const decisiones of [
    { acepta_tratamiento_datos: false, decision_comercial: "RECHAZA" as const },
    { decision_comercial: "ACEPTA" as const },
    { acepta_tratamiento_datos: true },
  ]) {
    const dniInvalido = dniNuevo();
    await assert.rejects(
      cliente.crearCliente({ dni: dniInvalido, nombre: "Sin decisión completa", ...decisiones }, USUARIO_ID),
      { name: "ServiceError" },
    );
    assert.equal(await prisma.cliente.count({ where: { dni: dniInvalido } }), 0);
  }

  // ── Alta con DNI nuevo → crea Cliente + ConsentimientoCliente ───────────
  const dni = dniNuevo();
  const alta = await cliente.crearCliente(
    { dni, nombre: "Cliente de Prueba HU-C1", telefono: "3870000000", email: "hu-c1@example.com", acepta_tratamiento_datos: true, decision_comercial: "RECHAZA" },
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
    select: { id: true, alcance: true, finalidad: true, is_active: true, origen: true, registrado_por_id: true, fecha_consentimiento: true },
  });
  assert.equal(consentimientos.length, 1);
  assert.equal(consentimientos[0]!.alcance, "VENTA_ASISTIDA");
  assert.equal(consentimientos[0]!.is_active, true);
  assert.equal(consentimientos[0]!.origen, "EXPRESO");
  assert.equal(consentimientos[0]!.registrado_por_id, USUARIO_ID);
  assert.ok(consentimientos[0]!.finalidad.length > 0);
  const eventosAlta = await prisma.eventoConsentimientoCliente.findMany({
    where: { cliente_id: alta.cliente_id },
    orderBy: { alcance: "asc" },
  });
  assert.equal(eventosAlta.length, 2);
  const aceptacionTratamiento = eventosAlta.find((evento) => evento.alcance === "VENTA_ASISTIDA");
  const rechazoComercial = eventosAlta.find((evento) => evento.alcance === "COMUNICACIONES_COMERCIALES");
  assert.equal(aceptacionTratamiento?.tipo, "ACEPTACION_INICIAL");
  assert.equal(aceptacionTratamiento?.consentimiento_id, consentimientos[0]!.id);
  assert.equal(aceptacionTratamiento?.finalidad, consentimientos[0]!.finalidad);
  assert.equal(aceptacionTratamiento?.fecha_evento.getTime(), consentimientos[0]!.fecha_consentimiento.getTime());
  assert.equal(rechazoComercial?.tipo, "RECHAZO_COMERCIAL");
  assert.equal(rechazoComercial?.consentimiento_id, null);
  assert.ok(eventosAlta.every((evento) => evento.usuario_id === USUARIO_ID));

  const dniComercialAceptado = dniNuevo();
  const altaComercialAceptada = await cliente.crearCliente(
    { dni: dniComercialAceptado, nombre: "Cliente con comunicaciones", acepta_tratamiento_datos: true, decision_comercial: "ACEPTA" },
    USUARIO_ID,
  );
  const aceptacionesComerciales = await prisma.consentimientoCliente.findMany({
    where: { cliente_id: altaComercialAceptada.cliente_id },
  });
  const eventosComerciales = await prisma.eventoConsentimientoCliente.findMany({
    where: { cliente_id: altaComercialAceptada.cliente_id },
  });
  assert.deepEqual(new Set(aceptacionesComerciales.map((fila) => fila.alcance)), new Set(["VENTA_ASISTIDA", "COMUNICACIONES_COMERCIALES"]));
  assert.equal(aceptacionesComerciales.length, 2);
  assert.equal(eventosComerciales.length, 2);
  assert.ok(aceptacionesComerciales.every((fila) => fila.origen === "EXPRESO" && fila.registrado_por_id === USUARIO_ID));
  assert.ok(eventosComerciales.every((evento) => evento.tipo === "ACEPTACION_INICIAL" && evento.consentimiento_id !== null));

  const dniRollback = dniNuevo();
  await assert.rejects(prisma.$transaction(async (tx) => {
    const creadoEnTx = await cliente.crearClienteTx(
      tx,
      { dni: dniRollback, nombre: "Cliente revertido", acepta_tratamiento_datos: true, decision_comercial: "ACEPTA" },
      USUARIO_ID,
    );
    // Un evento inválido dispara el CHECK de 1A y revierte también el alta anterior.
    await tx.eventoConsentimientoCliente.create({
      data: {
        cliente_id: creadoEnTx.cliente.id,
        tipo: "RECHAZO_COMERCIAL",
        alcance: "VENTA_ASISTIDA",
        finalidad: "Evento inválido para verificar rollback",
        usuario_id: USUARIO_ID,
      },
    });
  }));
  assert.equal(await prisma.cliente.count({ where: { dni: dniRollback } }), 0);

  await t.test("HU-C4 revierte el alta si falla la inserción interna del consentimiento", async () => {
    const dniRollbackInterno = dniNuevo();
    const usuarioInexistente = "00000000-0000-4000-8000-000000000000";
    assert.equal(await prisma.usuario.count({ where: { id: usuarioInexistente } }), 0);
    const [clientesAntes, consentimientosAntes, eventosAntes] = await Promise.all([
      prisma.cliente.count(),
      prisma.consentimientoCliente.count(),
      prisma.eventoConsentimientoCliente.count(),
    ]);

    // Cliente.create ocurre primero; el FK del actor falla en el primer consentimiento.create.
    await assert.rejects(
      prisma.$transaction((tx) => cliente.crearClienteTx(
        tx,
        { dni: dniRollbackInterno, nombre: "Cliente con rollback interno", acepta_tratamiento_datos: true, decision_comercial: "ACEPTA" },
        usuarioInexistente,
      )),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "code" in error);
        assert.equal(error.code, "P2003");
        return true;
      },
    );

    assert.equal(await prisma.cliente.count({ where: { dni: dniRollbackInterno } }), 0);
    assert.equal(await prisma.cliente.count(), clientesAntes);
    assert.equal(await prisma.consentimientoCliente.count(), consentimientosAntes);
    assert.equal(await prisma.eventoConsentimientoCliente.count(), eventosAntes);
  });

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
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: alta.cliente_id } }), 2);

  const recuperadoConDecisiones = await cliente.crearCliente(
    { dni, nombre: "Otro nombre ignorado", acepta_tratamiento_datos: true, decision_comercial: "ACEPTA" },
    USUARIO_ID,
  );
  assert.equal(recuperadoConDecisiones.es_nuevo, false);
  assert.equal(await prisma.consentimientoCliente.count({ where: { cliente_id: alta.cliente_id } }), 1);
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: alta.cliente_id } }), 2);

  const dniLegado = dniNuevo();
  const clienteLegado = await prisma.cliente.create({ data: { dni: dniLegado, nombre: "Cliente legado" } });
  const consentimientoLegado = await prisma.consentimientoCliente.create({
    data: {
      cliente_id: clienteLegado.id,
      alcance: "AMBOS",
      finalidad: "Registro anterior sin acreditación expresa",
    },
  });
  const recuperacionLegada = await cliente.crearCliente(
    { dni: dniLegado, nombre: "Nombre ignorado", acepta_tratamiento_datos: true, decision_comercial: "RECHAZA" },
    USUARIO_ID,
  );
  assert.equal(recuperacionLegada.es_nuevo, false);
  assert.equal((await prisma.consentimientoCliente.findUniqueOrThrow({ where: { id: consentimientoLegado.id } })).origen, "LEGADO_SIN_ACREDITACION_EXPRESA");
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: clienteLegado.id } }), 0);

  // ── Concurrencia: dos altas simultáneas con el mismo DNI nuevo ──────────
  // producen un único Cliente (el `@unique` de `dni` resuelve la carrera).
  const dniConcurrente = dniNuevo();
  const carrera = await Promise.allSettled([
    cliente.crearCliente({ dni: dniConcurrente, nombre: "Carrera A", acepta_tratamiento_datos: true, decision_comercial: "ACEPTA" }, USUARIO_ID),
    cliente.crearCliente({ dni: dniConcurrente, nombre: "Carrera B", acepta_tratamiento_datos: true, decision_comercial: "RECHAZA" }, USUARIO_ID),
  ]);
  const cumplidas = carrera.filter(
    (resultado): resultado is PromiseFulfilledResult<Awaited<ReturnType<typeof cliente.crearCliente>>> =>
      resultado.status === "fulfilled",
  );
  assert.ok(cumplidas.length >= 1);
  assert.equal(await prisma.cliente.count({ where: { dni: dniConcurrente } }), 1);
  const idsDevueltos = new Set(cumplidas.map((resultado) => resultado.value.cliente_id));
  assert.equal(idsDevueltos.size, 1);
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: [...idsDevueltos][0] } }), 2);

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
