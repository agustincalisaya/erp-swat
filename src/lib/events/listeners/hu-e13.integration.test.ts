import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T09_INTEGRATION_DATABASE_URL;

async function esperar(condicion: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("No se observaron los efectos post-commit esperados");
}

test("HU-E13 T09 — eventos, F3 y AuditLog", { skip: !DATABASE_URL, timeout: 120_000 }, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, { domainEventBus, listenersRegistrados }, auditoria, notificaciones] = await Promise.all([
    import("../../db/prisma.ts"),
    import("../domain-event-bus.ts"),
    import("../../services/auditoria/audit-log.service.ts"),
    import("../../services/notificaciones/notificacion.reglas.ts"),
  ]);
  await listenersRegistrados;
  t.after(() => prisma.$disconnect());

  const cuenta = await prisma.cuentaClienteWeb.findFirstOrThrow({
    where: { is_active: true, deleted_at: null },
    select: { id: true, cliente_id: true },
  });
  const administradores = await prisma.usuario.findMany({
    where: {
      is_active: true,
      roles: { some: { is_active: true, rol: { nombre: "ADMINISTRADOR_ECOMMERCE", is_active: true } } },
    },
    select: { id: true },
  });
  const admin = await prisma.usuario.findFirstOrThrow({
    where: {
      is_active: true,
      roles: { some: { is_active: true, rol: { nombre: "ADMINISTRADOR_ECOMMERCE", is_active: true } } },
    },
    select: { id: true },
  });

  await t.test("cancelación cliente es idempotente en AuditLog y F3", async () => {
    const ecommerceId = randomUUID();
    const reintegroId = randomUUID();
    const payload = {
      evento_id: reintegroId,
      pedido_venta_id: randomUUID(),
      pedido_venta_ecommerce_id: ecommerceId,
      reintegro_id: reintegroId,
      numero_venta: `T09-${randomUUID()}`,
      cliente_web_cuenta_id: cuenta.id,
      actor_tipo: "CLIENTE_WEB" as const,
      actor_id: cuenta.id,
      motivo: "Cancelación solicitada",
      estado_anterior: "PAGO_CONFIRMADO" as const,
      estado_nuevo: "CANCELADO" as const,
      timestamp: new Date().toISOString(),
    };
    const clave = notificaciones.calcularClaveIdempotencia("ecommerce:pedido_cancelado", reintegroId, cuenta.id);
    domainEventBus.emit("ecommerce:pedido_cancelado", payload);
    domainEventBus.emit("ecommerce:pedido_cancelado", payload);
    await esperar(async () =>
      await prisma.auditLog.count({ where: { accion: "PEDIDO_PAGADO_CANCELADO", registro_id: reintegroId } }) === 1 &&
      await prisma.notificacion.count({ where: { clave_idempotencia: clave } }) === 1,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { accion: "PEDIDO_PAGADO_CANCELADO", registro_id: reintegroId },
    });
    assert.equal(audit.usuario_id, null);
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: clave } }), 1);
    const clavesAdmin = administradores.map(({ id }) =>
      notificaciones.calcularClaveIdempotencia("ecommerce:pedido_cancelado", reintegroId, id));
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: { in: clavesAdmin } } }), 0);
  });

  await t.test("cancelación admin atribuye Usuario y notifica una vez al cliente", async () => {
    const ecommerceId = randomUUID();
    const reintegroId = randomUUID();
    const payload = {
      evento_id: reintegroId,
      pedido_venta_id: randomUUID(),
      pedido_venta_ecommerce_id: ecommerceId,
      reintegro_id: reintegroId,
      numero_venta: `T09-${randomUUID()}`,
      cliente_web_cuenta_id: cuenta.id,
      actor_tipo: "USUARIO" as const,
      actor_id: admin.id,
      motivo: "Decisión administrativa",
      estado_anterior: "EN_PREPARACION" as const,
      estado_nuevo: "CANCELADO" as const,
      timestamp: new Date().toISOString(),
    };
    const clave = notificaciones.calcularClaveIdempotencia("ecommerce:pedido_cancelado", reintegroId, cuenta.id);
    domainEventBus.emit("ecommerce:pedido_cancelado", payload);
    domainEventBus.emit("ecommerce:pedido_cancelado", payload);
    await esperar(async () =>
      await prisma.auditLog.count({ where: { accion: "PEDIDO_PAGADO_CANCELADO", registro_id: reintegroId } }) === 1 &&
      await prisma.notificacion.count({ where: { clave_idempotencia: clave } }) === 1,
    );
    assert.equal((await prisma.auditLog.findFirstOrThrow({
      where: { accion: "PEDIDO_PAGADO_CANCELADO", registro_id: reintegroId },
    })).usuario_id, admin.id);
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: clave } }), 1);
    const clavesAdmin = administradores.map(({ id }) =>
      notificaciones.calcularClaveIdempotencia("ecommerce:pedido_cancelado", reintegroId, id));
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: { in: clavesAdmin } } }), 0);
  });

  await t.test("vencimiento usa actor SISTEMA y AuditLog usuario null", async () => {
    const ecommerceId = randomUUID();
    const reintegroId = randomUUID();
    const payload = {
      evento_id: reintegroId,
      pedido_venta_id: randomUUID(),
      pedido_venta_ecommerce_id: ecommerceId,
      reintegro_id: reintegroId,
      numero_venta: `T09-${randomUUID()}`,
      cliente_web_cuenta_id: cuenta.id,
      actor_tipo: "SISTEMA" as const,
      actor_id: null,
      motivo: "Plazo de retiro vencido",
      estado_anterior: "LISTO_PARA_RETIRO" as const,
      estado_nuevo: "VENCIDO_SIN_RETIRO" as const,
      timestamp: new Date().toISOString(),
    };
    const clave = notificaciones.calcularClaveIdempotencia("ecommerce:pedido_vencido_sin_retiro", reintegroId, cuenta.id);
    domainEventBus.emit("ecommerce:pedido_vencido_sin_retiro", payload);
    domainEventBus.emit("ecommerce:pedido_vencido_sin_retiro", payload);
    await esperar(async () =>
      await prisma.auditLog.count({ where: { accion: "PEDIDO_VENCIDO_SIN_RETIRO", registro_id: reintegroId } }) === 1 &&
      await prisma.notificacion.count({ where: { clave_idempotencia: clave } }) === 1,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { accion: "PEDIDO_VENCIDO_SIN_RETIRO", registro_id: reintegroId },
    });
    assert.equal(audit.usuario_id, null);
    assert.match(JSON.stringify(audit.valor_nuevo), /"actor_tipo":"SISTEMA"/);
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: clave } }), 1);
    const clavesAdmin = administradores.map(({ id }) =>
      notificaciones.calcularClaveIdempotencia("ecommerce:pedido_vencido_sin_retiro", reintegroId, id));
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: { in: clavesAdmin } } }), 0);
    // Post-T17 (SPEC §2.13.16.1): vencimiento CRITICA y Cliente Web único destinatario.
    const notificacion = await prisma.notificacion.findUniqueOrThrow({ where: { clave_idempotencia: clave } });
    assert.equal(notificacion.prioridad, "CRITICA");
    assert.equal(notificacion.cuenta_cliente_web_destinatario_id, cuenta.id);
    assert.equal(notificacion.usuario_destinatario_id, null);
    assert.equal(await prisma.notificacion.count({
      where: {
        tipo_evento: "ecommerce:pedido_vencido_sin_retiro",
        usuario_destinatario_id: { not: null },
        created_at: { gte: notificacion.created_at },
      },
    }), 0);
  });

  await t.test("recordatorio reemitido produce una notificación y un audit", async () => {
    const pedidoId = randomUUID();
    const plazo = new Date(Date.now() + 3_600_000).toISOString();
    const claveOrigen = `${pedidoId}:${plazo}`;
    const payload = {
      evento_id: claveOrigen,
      pedido_venta_id: pedidoId,
      pedido_venta_ecommerce_id: randomUUID(),
      numero_venta: `T09-${randomUUID()}`,
      cliente_web_cuenta_id: cuenta.id,
      plazo_retiro_vencimiento: plazo,
      clave_origen: claveOrigen,
      actor_tipo: "SISTEMA" as const,
      actor_id: null,
      timestamp: new Date().toISOString(),
    };
    const clave = notificaciones.calcularClaveIdempotencia("ecommerce:plazo_retiro_por_vencer", claveOrigen, cuenta.id);
    domainEventBus.emit("ecommerce:plazo_retiro_por_vencer", payload);
    domainEventBus.emit("ecommerce:plazo_retiro_por_vencer", payload);
    await esperar(async () =>
      await prisma.auditLog.count({ where: { accion: "PLAZO_RETIRO_POR_VENCER", registro_id: claveOrigen } }) === 1 &&
      await prisma.notificacion.count({ where: { clave_idempotencia: clave } }) === 1,
    );
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: clave } }), 1);
  });

  await t.test("cuenta no notificable se omite sin bloquear el evento", async () => {
    const ecommerceId = randomUUID();
    const reintegroId = randomUUID();
    domainEventBus.emit("ecommerce:pedido_vencido_sin_retiro", {
      evento_id: reintegroId,
      pedido_venta_id: randomUUID(),
      pedido_venta_ecommerce_id: ecommerceId,
      reintegro_id: reintegroId,
      numero_venta: `T09-${randomUUID()}`,
      cliente_web_cuenta_id: null,
      actor_tipo: "SISTEMA",
      actor_id: null,
      motivo: "Plazo de retiro vencido",
      estado_anterior: "LISTO_PARA_RETIRO",
      estado_nuevo: "VENCIDO_SIN_RETIRO",
      timestamp: new Date().toISOString(),
    });
    await esperar(async () => await prisma.auditLog.count({
      where: { accion: "PEDIDO_VENCIDO_SIN_RETIRO", registro_id: reintegroId },
    }) === 1);
    const claveCliente = notificaciones.calcularClaveIdempotencia(
      "ecommerce:pedido_vencido_sin_retiro",
      reintegroId,
      cuenta.id,
    );
    assert.equal(await prisma.notificacion.count({ where: { clave_idempotencia: claveCliente } }), 0);
  });

  await t.test("tres intentos preservan cinco hechos de auditoría al reemitirse", async () => {
    const paymentId = `t09-${randomUUID()}`;
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `T09-${randomUUID()}`,
        cliente_id: cuenta.cliente_id,
        canal: "WEB",
        estado: "FACTURADO",
        total: 100,
        fecha_facturacion: new Date(),
        registrado_por_id: admin.id,
      },
    });
    await prisma.pedidoVentaEcommerce.create({
      data: {
        pedido_venta_id: pedido.id,
        estado_ecommerce: "CANCELADO",
        mercadopago_payment_id: paymentId,
        fecha_pago_confirmado: new Date(),
        is_active: false,
        deleted_at: new Date(),
        deleted_by: admin.id,
        deletion_reason: "Fixture T09",
      },
    });
    const reintegro = await prisma.reintegroPedidoWeb.create({
      data: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: paymentId,
        monto_total: 100,
        motivo: "Fixture historial T09",
        solicitado_por_tipo: "USUARIO",
        solicitado_por_id: admin.id,
      },
    });
    const intento1 = await prisma.reintegroRefundIntento.create({
      data: {
        reintegro_id: reintegro.id,
        numero: 1,
        origen: "INICIAL",
        estado: "RECHAZADO",
        clave_idempotencia: `T09:${reintegro.id}:1`,
      },
    });
    const intento2 = await prisma.reintegroRefundIntento.create({
      data: {
        reintegro_id: reintegro.id,
        numero: 2,
        origen: "REINTENTO_MANUAL",
        estado: "RECHAZADO",
        clave_idempotencia: `T09:${reintegro.id}:2`,
        creado_por_id: admin.id,
        motivo_reintento: "Segundo intento",
      },
    });
    const intento3 = await prisma.reintegroRefundIntento.create({
      data: {
        reintegro_id: reintegro.id,
        numero: 3,
        origen: "REINTENTO_MANUAL",
        estado: "APROBADO",
        clave_idempotencia: `T09:${reintegro.id}:3`,
        creado_por_id: admin.id,
        motivo_reintento: "Tercer intento",
      },
    });
    const timestamp = new Date().toISOString();
    const eventos = [
      {
        evento_id: `${intento1.id}:RECHAZADO`, reintegro_id: reintegro.id,
        intento_refund_id: intento1.id, numero_intento: 1,
        origen_intento: "INICIAL" as const, pedido_venta_id: pedido.id,
        estado_anterior: "PENDIENTE" as const, estado_nuevo: "RECHAZADO" as const,
        actor_id: null, motivo: null, timestamp,
      },
      {
        evento_id: `${intento2.id}:REINTENTO_MANUAL`, reintegro_id: reintegro.id,
        intento_refund_id: intento2.id, numero_intento: 2,
        origen_intento: "REINTENTO_MANUAL" as const, pedido_venta_id: pedido.id,
        estado_anterior: "RECHAZADO" as const, estado_nuevo: "PENDIENTE" as const,
        actor_id: admin.id, motivo: "Segundo intento", timestamp,
      },
      {
        evento_id: `${intento2.id}:RECHAZADO`, reintegro_id: reintegro.id,
        intento_refund_id: intento2.id, numero_intento: 2,
        origen_intento: "REINTENTO_MANUAL" as const, pedido_venta_id: pedido.id,
        estado_anterior: "PENDIENTE" as const, estado_nuevo: "RECHAZADO" as const,
        actor_id: null, motivo: null, timestamp,
      },
      {
        evento_id: `${intento3.id}:REINTENTO_MANUAL`, reintegro_id: reintegro.id,
        intento_refund_id: intento3.id, numero_intento: 3,
        origen_intento: "REINTENTO_MANUAL" as const, pedido_venta_id: pedido.id,
        estado_anterior: "RECHAZADO" as const, estado_nuevo: "PENDIENTE" as const,
        actor_id: admin.id, motivo: "Tercer intento", timestamp,
      },
      {
        evento_id: `${intento3.id}:APROBADO`, reintegro_id: reintegro.id,
        intento_refund_id: intento3.id, numero_intento: 3,
        origen_intento: "REINTENTO_MANUAL" as const, pedido_venta_id: pedido.id,
        estado_anterior: "PENDIENTE" as const, estado_nuevo: "APROBADO" as const,
        actor_id: null, motivo: null, timestamp,
      },
    ];
    for (const evento of eventos) domainEventBus.emit("ecommerce:reintegro_estado_cambiado", evento);
    const intentoIds = [intento1.id, intento2.id, intento3.id];
    await esperar(async () => await prisma.auditLog.count({
      where: { tabla_afectada: "reintegro_refund_intentos", registro_id: { in: intentoIds } },
    }) === 5);
    const verificarConteos = async () => {
      assert.equal(await prisma.auditLog.count({ where: { accion: "REINTEGRO_RECHAZADO", registro_id: intento1.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { accion: "REINTEGRO_REINTENTO_MANUAL", registro_id: intento2.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { accion: "REINTEGRO_RECHAZADO", registro_id: intento2.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { accion: "REINTEGRO_REINTENTO_MANUAL", registro_id: intento3.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { accion: "REINTEGRO_APROBADO", registro_id: intento3.id } }), 1);
    };
    await verificarConteos();
    for (const evento of eventos) domainEventBus.emit("ecommerce:reintegro_estado_cambiado", evento);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await verificarConteos();
    const asientos = await prisma.auditLog.findMany({
      where: { tabla_afectada: "reintegro_refund_intentos", registro_id: { in: intentoIds } },
      select: { registro_id: true, valor_nuevo: true },
    });
    assert.equal(asientos.length, 5);
    for (const asiento of asientos) {
      const valor = asiento.valor_nuevo as { intento_refund_id?: string };
      assert.equal(valor.intento_refund_id, asiento.registro_id);
    }
    assert.equal(await prisma.notificacion.count({
      where: { tipo_evento: "ecommerce:reintegro_estado_cambiado" },
    }), 0);
  });

  await t.test("cadena SHA íntegra y payloads sin secretos", async () => {
    const verificacion = await auditoria.verificarCadenaIntegridad();
    assert.equal(verificacion.integra, true);
    const filas = await prisma.auditLog.findMany({
      where: {
        accion: { in: [
          "PEDIDO_PAGADO_CANCELADO",
          "PEDIDO_VENCIDO_SIN_RETIRO",
          "PLAZO_RETIRO_POR_VENCER",
          "REINTEGRO_APROBADO",
          "REINTEGRO_RECHAZADO",
          "REINTEGRO_REINTENTO_MANUAL",
        ] },
      },
      select: { valor_anterior: true, valor_nuevo: true },
    });
    const serializado = JSON.stringify(filas);
    for (const secreto of ["Authorization", "Bearer ", "access_token", "clave_idempotencia", "X-Idempotency-Key", "datos_tarjeta"]) {
      assert.doesNotMatch(serializado, new RegExp(secreto, "i"));
    }
  });
});
