import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";

const url = process.env.HU_C4_INTEGRATION_DATABASE_URL;
test("HU-C4 regulariza finalidades independientes en la base aislada", { skip: !url, timeout: 60_000 }, async (t) => {
  const destino = new URL(url!);
  assert.equal(destino.hostname, "127.0.0.1");
  assert.equal(destino.port, "55434");
  assert.equal(destino.pathname, "/hu_c4_validate_20260921_4d7e2a");
  assert.equal(destino.search, "");
  assert.equal(process.env.DATABASE_URL, url);
  const [{ prisma }, servicio, { ServiceError }] = await Promise.all([
    import("../../db/prisma.ts"), import("./consentimiento.service.ts"), import("../../errors/service-error.ts"),
  ]);
  t.after(() => prisma.$disconnect());
  const identidad = await prisma.$queryRaw<{ base: string; cluster: bigint }[]>`
    SELECT current_database() AS base, (pg_control_system()).system_identifier AS cluster
  `;
  assert.equal(identidad[0]?.base, "hu_c4_validate_20260921_4d7e2a");
  assert.equal(String(identidad[0]?.cluster), "7687955598197395495");
  const actor = await prisma.usuario.findFirstOrThrow({ where: { is_active: true }, select: { id: true } });
  const crear = async (nombre: string, activo = true) => prisma.cliente.create({ data: {
    dni: String(randomInt(10_000_000, 99_999_999)), nombre: `${nombre} ${randomUUID()}`,
    is_active: activo,
  } });
  const cliente = await crear("C4 integración");
  const legado = await prisma.consentimientoCliente.create({ data: {
    cliente_id: cliente.id, alcance: "AMBOS", finalidad: "Registro anterior",
  } });
  const previo = await servicio.obtenerConsentimientosCliente(cliente.id);
  assert.equal(previo.estados.VENTA_ASISTIDA.estado, "PENDIENTE_REGULARIZACION");
  assert.equal(previo.estados.COMUNICACIONES_COMERCIALES.estado, "PENDIENTE_REGULARIZACION");
  assert.equal(previo.historial[0]?.resultado, "Legado: no acredita aceptación expresa");

  const tratamiento = await servicio.regularizarConsentimientoCliente(cliente.id, { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, actor.id);
  assert.equal(tratamiento.estado, "ACEPTADO");
  const intermedio = await servicio.obtenerConsentimientosCliente(cliente.id);
  assert.equal(intermedio.estados.VENTA_ASISTIDA.estado, "ACEPTADO");
  assert.equal(intermedio.estados.COMUNICACIONES_COMERCIALES.estado, "PENDIENTE_REGULARIZACION");
  const comercial = await servicio.regularizarConsentimientoCliente(cliente.id, { alcance: "COMUNICACIONES_COMERCIALES", decision: "RECHAZA" }, actor.id);
  assert.equal(comercial.estado, "RECHAZADO");
  assert.equal(comercial.consentimiento_id, null);
  const final = await servicio.obtenerConsentimientosCliente(cliente.id);
  assert.equal(final.estados.COMUNICACIONES_COMERCIALES.estado, "RECHAZADO");
  assert.equal(await prisma.consentimientoCliente.count({ where: { cliente_id: cliente.id } }), 2);
  assert.equal((await prisma.consentimientoCliente.findUniqueOrThrow({ where: { id: legado.id } })).origen, "LEGADO_SIN_ACREDITACION_EXPRESA");
  await assert.rejects(
    servicio.regularizarConsentimientoCliente(cliente.id, { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, actor.id),
    (e: unknown) => e instanceof ServiceError && e.code === "CONSENTIMIENTO_CONFLICTO",
  );

  const paralelo = await crear("C4 carrera");
  const carrera = await Promise.allSettled([
    servicio.regularizarConsentimientoCliente(paralelo.id, { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, actor.id),
    servicio.regularizarConsentimientoCliente(paralelo.id, { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, actor.id),
  ]);
  assert.equal(carrera.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(carrera.filter((r) => r.status === "rejected" && r.reason instanceof ServiceError && r.reason.code === "CONSENTIMIENTO_CONFLICTO").length, 1);
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: paralelo.id } }), 1);

  const aceptadoComercial = await crear("C4 comercial acepta");
  const aceptacionComercial = await servicio.regularizarConsentimientoCliente(aceptadoComercial.id,
    { alcance: "COMUNICACIONES_COMERCIALES", decision: "ACEPTA" }, actor.id);
  assert.equal(aceptacionComercial.estado, "ACEPTADO");
  assert.equal((await servicio.obtenerConsentimientosCliente(aceptadoComercial.id)).estados.VENTA_ASISTIDA.estado,
    "PENDIENTE_REGULARIZACION");
  const aceptacionGuardada = await prisma.consentimientoCliente.findUniqueOrThrow({ where: { id: aceptacionComercial.consentimiento_id! } });
  assert.equal(aceptacionGuardada.alcance, "COMUNICACIONES_COMERCIALES");
  assert.equal(aceptacionGuardada.origen, "EXPRESO");
  assert.equal(aceptacionGuardada.registrado_por_id, actor.id);

  const rollback = await crear("C4 rollback");
  await assert.rejects(servicio.regularizarConsentimientoCliente(rollback.id,
    { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, "00000000-0000-4000-8000-000000000000"));
  assert.equal(await prisma.consentimientoCliente.count({ where: { cliente_id: rollback.id } }), 0);
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: rollback.id } }), 0);

  const corrupto = await crear("C4 integridad");
  await prisma.consentimientoCliente.create({ data: {
    cliente_id: corrupto.id, alcance: "VENTA_ASISTIDA", finalidad: "Huérfano",
    origen: "EXPRESO", registrado_por_id: actor.id,
  } });
  assert.equal((await servicio.obtenerConsentimientosCliente(corrupto.id)).estados.VENTA_ASISTIDA.estado, "ERROR_INTEGRIDAD");
  await assert.rejects(
    servicio.regularizarConsentimientoCliente(corrupto.id, { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, actor.id),
    (e: unknown) => e instanceof ServiceError && e.code === "CONSENTIMIENTO_INTEGRIDAD",
  );
  const inactivo = await crear("C4 inactivo", false);
  for (const id of [inactivo.id, randomUUID()]) {
    await assert.rejects(
      servicio.regularizarConsentimientoCliente(id, { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" }, actor.id),
      (e: unknown) => e instanceof ServiceError && e.code === "CLIENTE_NO_ENCONTRADO",
    );
  }
});

test("HU-C4 etapa 3: revocaciones, solicitudes, rol, concurrencia e historial", {
  skip: !url, timeout: 90_000,
}, async (t) => {
  const destino = new URL(url!);
  assert.equal(destino.hostname, "127.0.0.1");
  assert.equal(destino.port, "55434");
  assert.equal(destino.pathname, "/hu_c4_validate_20260921_4d7e2a");
  assert.equal(destino.search, "");
  assert.equal(process.env.DATABASE_URL, url);
  const [{ prisma }, servicio, { ServiceError }] = await Promise.all([
    import("../../db/prisma.ts"), import("./consentimiento.service.ts"), import("../../errors/service-error.ts"),
  ]);
  const identidad = await prisma.$queryRaw<{ base: string; cluster: bigint }[]>`
    SELECT current_database() AS base, (pg_control_system()).system_identifier AS cluster
  `;
  assert.equal(identidad[0]?.base, "hu_c4_validate_20260921_4d7e2a");
  assert.equal(String(identidad[0]?.cluster), "7687955598197395495");

  const vendedor = await prisma.usuario.findUniqueOrThrow({ where: { email: "vendedor.seed@erp-swat.local" } });
  const auditor = await prisma.usuario.findUniqueOrThrow({ where: { email: "auditor.seed@erp-swat.local" } });
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: "admin.seed@erp-swat.local" } });
  const rolCrm = await prisma.rol.findUniqueOrThrow({ where: { nombre: "ADMINISTRADOR_CRM" } });
  t.after(() => prisma.$disconnect());
  assert.equal(rolCrm.is_active, true);
  assert.equal(await servicio.esAdministradorCrmActivo(admin.id), true);
  assert.equal(await servicio.esAdministradorCrmActivo(vendedor.id), false);
  // No hay una asignación CRM activa en esta base. Verificamos que la consulta
  // también conserve ese rol y exija asignación y rol activos, sin crear usuarios.
  const consultaCrm = { usuarioRol: { findFirst: async (args: {
    where: { is_active: boolean; rol: { is_active: boolean; nombre: { in: string[] } } },
  }) => {
    assert.equal(args.where.is_active, true);
    assert.equal(args.where.rol.is_active, true);
    assert.ok(args.where.rol.nombre.in.includes(rolCrm.nombre));
    return { id: randomUUID() };
  } } } as unknown as typeof prisma;
  assert.equal(await servicio.esAdministradorCrmActivo(randomUUID(), consultaCrm), true);
  const crear = async () => prisma.cliente.create({ data: {
    dni: String(randomInt(10_000_000, 99_999_999)), nombre: `C4 etapa 3 ${randomUUID()}`,
  } });
  const tratamiento = { alcance: "VENTA_ASISTIDA" as const, decision: "ACEPTA" as const };
  const comercial = { alcance: "COMUNICACIONES_COMERCIALES" as const, decision: "ACEPTA" as const };
  const conflicto = (code: string) => (error: unknown) => error instanceof ServiceError && error.code === code;

  const cliente = await crear();
  const inicial = await servicio.regularizarConsentimientoCliente(cliente.id, tratamiento, vendedor.id);
  const solicitud = await servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
  }, vendedor.id);
  let lectura = await servicio.obtenerConsentimientosCliente(cliente.id);
  assert.equal(lectura.estados.VENTA_ASISTIDA.estado, "ACEPTADO");
  assert.equal(lectura.estados.VENTA_ASISTIDA.solicitudes_pendientes[0]?.id, solicitud.evento_id);
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
  }, vendedor.id), conflicto("SOLICITUD_YA_PENDIENTE"));
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
    solicitud_evento_id: solicitud.evento_id,
  }, vendedor.id), conflicto("FORBIDDEN"));
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
    solicitud_evento_id: solicitud.evento_id, motivo: "No corresponde",
  }, vendedor.id), conflicto("FORBIDDEN"));
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
    solicitud_evento_id: solicitud.evento_id,
  }, auditor.id), conflicto("FORBIDDEN"));
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
    solicitud_evento_id: solicitud.evento_id, motivo: "   ",
  }, admin.id), conflicto("VALIDATION_ERROR"));
  const rechazo = await servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
    solicitud_evento_id: solicitud.evento_id, motivo: "No corresponde",
  }, admin.id);
  lectura = await servicio.obtenerConsentimientosCliente(cliente.id);
  assert.equal(lectura.estados.VENTA_ASISTIDA.estado, "ACEPTADO");
  assert.equal(lectura.estados.VENTA_ASISTIDA.solicitudes_pendientes.length, 0);
  assert.equal(lectura.historial.find((hecho) => hecho.id === rechazo.evento_id)?.solicitud_evento_id, solicitud.evento_id);
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
    solicitud_evento_id: solicitud.evento_id,
  }, admin.id), conflicto("SOLICITUD_NO_PENDIENTE"));
  const segundaSolicitud = await servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
  }, vendedor.id);
  const ejecutada = await servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: inicial.consentimiento_id,
    solicitud_evento_id: segundaSolicitud.evento_id,
  }, admin.id);
  lectura = await servicio.obtenerConsentimientosCliente(cliente.id);
  assert.equal(lectura.estados.VENTA_ASISTIDA.estado, "REVOCADO");
  assert.equal(lectura.estados.VENTA_ASISTIDA.ultima_revocacion_evento_id, ejecutada.evento_id);
  assert.equal(lectura.estados.VENTA_ASISTIDA.solicitudes_pendientes.length, 0);
  assert.equal((await prisma.consentimientoCliente.findUniqueOrThrow({ where: { id: inicial.consentimiento_id! } })).is_active, true);
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA",
    revocacion_evento_id: ejecutada.evento_id, aceptacion_expresa: true,
  }, vendedor.id), conflicto("FORBIDDEN"));
  const nueva = await servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA",
    revocacion_evento_id: ejecutada.evento_id, aceptacion_expresa: true,
  }, admin.id);
  assert.notEqual(nueva.consentimiento_id, inicial.consentimiento_id);
  const nuevaFila = await prisma.consentimientoCliente.findUniqueOrThrow({ where: { id: nueva.consentimiento_id } });
  const nuevoEvento = await prisma.eventoConsentimientoCliente.findUniqueOrThrow({ where: { id: nueva.evento_id } });
  assert.equal(nuevaFila.origen, "EXPRESO");
  assert.equal(nuevaFila.registrado_por_id, admin.id);
  assert.equal(nuevaFila.fecha_consentimiento.getTime(), nuevoEvento.fecha_evento.getTime());
  assert.equal(nuevoEvento.tipo, "NUEVA_ACEPTACION");
  assert.equal(nuevoEvento.consentimiento_id, nuevaFila.id);
  assert.ok(nuevoEvento.fecha_evento > (await prisma.eventoConsentimientoCliente.findUniqueOrThrow({ where: { id: ejecutada.evento_id } })).fecha_evento);
  assert.equal((await servicio.obtenerConsentimientosCliente(cliente.id)).estados.VENTA_ASISTIDA.estado, "ACEPTADO");
  await assert.rejects(servicio.transicionarConsentimientoCliente(cliente.id, {
    operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA",
    revocacion_evento_id: ejecutada.evento_id, aceptacion_expresa: true,
  }, admin.id), conflicto("CONSENTIMIENTO_CONFLICTO"));

  const clienteComercial = await crear();
  const comercialInicial = await servicio.regularizarConsentimientoCliente(clienteComercial.id, comercial, vendedor.id);
  await assert.rejects(servicio.transicionarConsentimientoCliente(clienteComercial.id, {
    operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", consentimiento_id: nuevaFila.id,
  }, vendedor.id), conflicto("ACEPTACION_OBSOLETA"));
  const revocacionComercial = await servicio.transicionarConsentimientoCliente(clienteComercial.id, {
    operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", consentimiento_id: comercialInicial.consentimiento_id,
  }, vendedor.id);
  assert.equal((await servicio.obtenerConsentimientosCliente(clienteComercial.id)).estados.COMUNICACIONES_COMERCIALES.estado, "REVOCADO");
  assert.equal((await prisma.consentimientoCliente.findUniqueOrThrow({ where: { id: comercialInicial.consentimiento_id! } })).is_active, true);
  await assert.rejects(servicio.transicionarConsentimientoCliente(clienteComercial.id, {
    operacion: "NUEVA_ACEPTACION", alcance: "COMUNICACIONES_COMERCIALES",
    revocacion_evento_id: ejecutada.evento_id, aceptacion_expresa: true,
  }, admin.id), conflicto("REVOCACION_OBSOLETA"));

  const rechazado = await crear();
  await servicio.regularizarConsentimientoCliente(rechazado.id,
    { alcance: "COMUNICACIONES_COMERCIALES", decision: "RECHAZA" }, vendedor.id);
  await assert.rejects(servicio.transicionarConsentimientoCliente(rechazado.id, {
    operacion: "NUEVA_ACEPTACION", alcance: "COMUNICACIONES_COMERCIALES",
    revocacion_evento_id: revocacionComercial.evento_id, aceptacion_expresa: true,
  }, admin.id), conflicto("CONSENTIMIENTO_CONFLICTO"));

  const carreraSolicitud = await crear();
  const baseSolicitud = await servicio.regularizarConsentimientoCliente(carreraSolicitud.id, tratamiento, vendedor.id);
  const solicitudes = await Promise.allSettled([1, 2].map(() => servicio.transicionarConsentimientoCliente(carreraSolicitud.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: baseSolicitud.consentimiento_id,
  }, vendedor.id)));
  assert.equal(solicitudes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(solicitudes.filter((r) => r.status === "rejected" && r.reason instanceof ServiceError && r.reason.code === "SOLICITUD_YA_PENDIENTE").length, 1);
  assert.equal((await servicio.obtenerConsentimientosCliente(carreraSolicitud.id)).estados.VENTA_ASISTIDA.solicitudes_pendientes.length, 1);

  const carreraResolucion = await crear();
  const baseResolucion = await servicio.regularizarConsentimientoCliente(carreraResolucion.id, tratamiento, vendedor.id);
  const pendiente = await servicio.transicionarConsentimientoCliente(carreraResolucion.id, {
    operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: baseResolucion.consentimiento_id,
  }, vendedor.id);
  const resoluciones = await Promise.allSettled([
    servicio.transicionarConsentimientoCliente(carreraResolucion.id, {
      operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: baseResolucion.consentimiento_id,
      solicitud_evento_id: pendiente.evento_id,
    }, admin.id),
    servicio.transicionarConsentimientoCliente(carreraResolucion.id, {
      operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: baseResolucion.consentimiento_id,
      solicitud_evento_id: pendiente.evento_id, motivo: "No procede",
    }, admin.id),
  ]);
  assert.equal(resoluciones.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(resoluciones.filter((r) => r.status === "rejected").length, 1);
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { solicitud_evento_id: pendiente.evento_id } }), 1);

  const rollback = await crear();
  const baseRollback = await servicio.regularizarConsentimientoCliente(rollback.id, comercial, vendedor.id);
  const revocadoRollback = await servicio.transicionarConsentimientoCliente(rollback.id, {
    operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", consentimiento_id: baseRollback.consentimiento_id,
  }, vendedor.id);
  const cantidadAntes = await prisma.consentimientoCliente.count({ where: { cliente_id: rollback.id } });
  await assert.rejects(prisma.$transaction(async (tx) => {
    const interceptado = new Proxy(tx, { get(target, property) {
      if (property === "eventoConsentimientoCliente") return new Proxy(target.eventoConsentimientoCliente, {
        get(modelo, metodo) {
          if (metodo === "create") return () => { throw new Error("Fallo interno en segunda inserción C4"); };
          const valor = Reflect.get(modelo, metodo);
          return typeof valor === "function" ? valor.bind(modelo) : valor;
        },
      });
      const valor = Reflect.get(target, property);
      return typeof valor === "function" ? valor.bind(target) : valor;
    } }) as Prisma.TransactionClient;
    await servicio.transicionarConsentimientoClienteTx(interceptado, rollback.id, {
      operacion: "NUEVA_ACEPTACION", alcance: "COMUNICACIONES_COMERCIALES",
      revocacion_evento_id: revocadoRollback.evento_id, aceptacion_expresa: true,
    }, admin.id);
  }), /Fallo interno en segunda inserción C4/);
  assert.equal(await prisma.consentimientoCliente.count({ where: { cliente_id: rollback.id } }), cantidadAntes);
  assert.equal((await servicio.obtenerConsentimientosCliente(rollback.id)).estados.COMUNICACIONES_COMERCIALES.estado, "REVOCADO");

  const soloLegado = await crear();
  const filaLegada = await prisma.consentimientoCliente.create({ data: {
    cliente_id: soloLegado.id, alcance: "COMUNICACIONES_COMERCIALES", finalidad: "Registro anterior",
  } });
  await assert.rejects(servicio.transicionarConsentimientoCliente(soloLegado.id, {
    operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", consentimiento_id: filaLegada.id,
  }, vendedor.id), conflicto("CONSENTIMIENTO_CONFLICTO"));
  assert.equal((await servicio.obtenerConsentimientosCliente(soloLegado.id)).estados.COMUNICACIONES_COMERCIALES.estado,
    "PENDIENTE_REGULARIZACION");

});
