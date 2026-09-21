import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";

const url = process.env.HU_C4_INTEGRATION_DATABASE_URL;

test("HU-C4: cada hecho confirmado produce su asiento central sin alterar el historial", {
  skip: !url, timeout: 90_000,
}, async (t) => {
  const destino = new URL(url!);
  assert.equal(destino.hostname, "127.0.0.1");
  assert.equal(destino.port, "55434");
  assert.equal(destino.pathname, "/hu_c4_validate_20260921_4d7e2a");
  assert.equal(destino.search, "");
  assert.equal(process.env.DATABASE_URL, url);
  const [{ prisma }, { crearCliente }, consentimiento, { iniciarAuditLogListener }, { calcularHashEncadenado }] =
    await Promise.all([
      import("../../db/prisma.ts"), import("./cliente.service.ts"), import("./consentimiento.service.ts"),
      import("../../events/listeners/audit-log.listener.ts"), import("../../crypto/hash-chain.ts"),
    ]);
  t.after(() => prisma.$disconnect());
  const identidad = await prisma.$queryRaw<{ base: string; cluster: bigint }[]>`
    SELECT current_database() AS base, (pg_control_system()).system_identifier AS cluster
  `;
  assert.equal(identidad[0]?.base, "hu_c4_validate_20260921_4d7e2a");
  assert.equal(String(identidad[0]?.cluster), "7687955598197395495");
  iniciarAuditLogListener();

  const vendedor = await prisma.usuario.findUniqueOrThrow({ where: { email: "vendedor.seed@erp-swat.local" } });
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: "admin.seed@erp-swat.local" } });
  const dni = () => String(randomInt(10_000_000, 99_999_999));
  const crear = () => prisma.cliente.create({ data: { dni: dni(), nombre: `C4 auditoría ${randomUUID()}` } });

  async function esperarAsientos(eventoIds: string[]) {
    const limite = Date.now() + 6_000;
    while (Date.now() < limite) {
      const filas = await prisma.auditLog.findMany({
        where: { tabla_afectada: "eventos_consentimiento_cliente", registro_id: { in: eventoIds } },
      });
      if (filas.length >= eventoIds.length) {
        assert.equal(filas.length, eventoIds.length, "un asiento por hecho en el recorrido normal");
        return filas;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("No se observaron todos los asientos C4 persistidos dentro del límite");
  }

  async function comprobar(eventoIds: string[], contexto: "ALTA" | "REGULARIZACION" | "FICHA") {
    const asientos = await esperarAsientos(eventoIds);
    for (const eventoId of eventoIds) {
      const evento = await prisma.eventoConsentimientoCliente.findUniqueOrThrow({ where: { id: eventoId } });
      const asiento = asientos.find((fila) => fila.registro_id === eventoId);
      assert.ok(asiento);
      const nuevo = asiento.valor_nuevo as Record<string, unknown>;
      assert.equal(asiento.usuario_id, evento.usuario_id);
      assert.equal(asiento.accion, `CONSENTIMIENTO_${evento.tipo}`);
      assert.equal(nuevo.cliente_id, evento.cliente_id);
      assert.equal(nuevo.alcance, evento.alcance);
      assert.equal(nuevo.tipo, evento.tipo);
      assert.equal(nuevo.fecha_evento, evento.fecha_evento.toISOString());
      assert.equal(nuevo.contexto, contexto);
      assert.equal(nuevo.consentimiento_id ?? null, evento.consentimiento_id);
      assert.equal(nuevo.solicitud_evento_id ?? null, evento.solicitud_evento_id);
      for (const campo of ["dni", "nombre", "telefono", "email", "motivo", "password", "token"]) {
        assert.equal(Object.hasOwn(nuevo, campo), false);
      }
      assert.equal(asiento.hash_actual, calcularHashEncadenado({
        usuario_id: asiento.usuario_id, accion: asiento.accion,
        tabla_afectada: asiento.tabla_afectada, registro_id: asiento.registro_id,
        ip: asiento.ip, valor_anterior: asiento.valor_anterior,
        valor_nuevo: asiento.valor_nuevo,
      }, asiento.hash_anterior));
    }
  }

  for (const decision_comercial of ["ACEPTA", "RECHAZA"] as const) {
    const dniAlta = dni();
    const alta = await crearCliente({ dni: dniAlta, nombre: `C4 alta auditoría ${randomUUID()}`,
      acepta_tratamiento_datos: true, decision_comercial }, vendedor.id);
    assert.equal(alta.es_nuevo, true);
    const eventos = await prisma.eventoConsentimientoCliente.findMany({ where: { cliente_id: alta.cliente_id } });
    assert.equal(eventos.length, 2);
    assert.equal(eventos.find((fila) => fila.alcance === "VENTA_ASISTIDA")?.tipo, "ACEPTACION_INICIAL");
    assert.equal(eventos.find((fila) => fila.alcance === "COMUNICACIONES_COMERCIALES")?.tipo,
      decision_comercial === "ACEPTA" ? "ACEPTACION_INICIAL" : "RECHAZO_COMERCIAL");
    await comprobar(eventos.map((fila) => fila.id), "ALTA");
    const limite = Date.now() + 6_000;
    let asientosCliente = 0;
    while (Date.now() < limite) {
      asientosCliente = await prisma.auditLog.count({
        where: { tabla_afectada: "clientes", registro_id: alta.cliente_id, accion: "CREATE" },
      });
      if (asientosCliente === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(asientosCliente, 1, "el asiento C1 de cliente:creado se conserva");
    const recuperado = await crearCliente({ dni: dniAlta, nombre: "Recuperación C4" }, vendedor.id);
    assert.equal(recuperado.es_nuevo, false);
    assert.equal((await esperarAsientos(eventos.map((fila) => fila.id))).length, 2);
  }

  const cliente = await crear();
  const tratamiento = await consentimiento.regularizarConsentimientoCliente(cliente.id,
    { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, vendedor.id);
  await comprobar([tratamiento.evento_id], "REGULARIZACION");
  const rechazoComercial = await consentimiento.regularizarConsentimientoCliente(cliente.id,
    { alcance: "COMUNICACIONES_COMERCIALES", decision: "RECHAZA" }, vendedor.id);
  await comprobar([rechazoComercial.evento_id], "REGULARIZACION");
  await assert.rejects(consentimiento.regularizarConsentimientoCliente(cliente.id,
    { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, vendedor.id));

  const solicitud = await consentimiento.transicionarConsentimientoCliente(cliente.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: tratamiento.consentimiento_id,
  }, vendedor.id);
  await comprobar([solicitud.evento_id], "FICHA");
  await assert.rejects(consentimiento.transicionarConsentimientoCliente(cliente.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: tratamiento.consentimiento_id,
  }, vendedor.id));
  const rechazo = await consentimiento.transicionarConsentimientoCliente(cliente.id, {
    operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: tratamiento.consentimiento_id,
    solicitud_evento_id: solicitud.evento_id, motivo: "Motivo reservado al historial C4",
  }, admin.id);
  await comprobar([rechazo.evento_id], "FICHA");
  const solicitud2 = await consentimiento.transicionarConsentimientoCliente(cliente.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: tratamiento.consentimiento_id,
  }, vendedor.id);
  await comprobar([solicitud2.evento_id], "FICHA");
  const ejecucion = await consentimiento.transicionarConsentimientoCliente(cliente.id, {
    operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: tratamiento.consentimiento_id,
    solicitud_evento_id: solicitud2.evento_id,
  }, admin.id);
  await comprobar([ejecucion.evento_id], "FICHA");
  const nueva = await consentimiento.transicionarConsentimientoCliente(cliente.id, {
    operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA",
    revocacion_evento_id: ejecucion.evento_id, aceptacion_expresa: true,
  }, admin.id);
  await comprobar([nueva.evento_id], "FICHA");
  assert.equal((await consentimiento.obtenerConsentimientosCliente(cliente.id)).estados.VENTA_ASISTIDA.estado, "ACEPTADO");
  const hechosConfirmados = await prisma.eventoConsentimientoCliente.findMany({ where: { cliente_id: cliente.id } });
  assert.equal((await esperarAsientos(hechosConfirmados.map((hecho) => hecho.id))).length, hechosConfirmados.length);

  const comercial = await crear();
  const aceptacion = await consentimiento.regularizarConsentimientoCliente(comercial.id,
    { alcance: "COMUNICACIONES_COMERCIALES", decision: "ACEPTA" }, vendedor.id);
  await comprobar([aceptacion.evento_id], "REGULARIZACION");
  const revocacion = await consentimiento.transicionarConsentimientoCliente(comercial.id, {
    operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES",
    consentimiento_id: aceptacion.consentimiento_id,
  }, vendedor.id);
  await comprobar([revocacion.evento_id], "FICHA");

  const cantidadAntes = await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: comercial.id } });
  await assert.rejects(prisma.$transaction(async (tx) => {
    await consentimiento.transicionarConsentimientoClienteTx(tx, comercial.id, {
      operacion: "NUEVA_ACEPTACION", alcance: "COMUNICACIONES_COMERCIALES",
      revocacion_evento_id: revocacion.evento_id, aceptacion_expresa: true,
    }, admin.id);
    throw new Error("Rollback C4 de auditoría");
  }), /Rollback C4 de auditoría/);
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: comercial.id } }), cantidadAntes);
  assert.equal((await prisma.auditLog.count({ where: {
    tabla_afectada: "eventos_consentimiento_cliente",
    valor_nuevo: { path: ["cliente_id"], equals: comercial.id },
  } })), 2);
});
