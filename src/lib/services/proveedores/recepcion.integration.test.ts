import assert from "node:assert/strict";
import test from "node:test";

const DATABASE_URL = process.env.HU_H4_INTEGRATION_DATABASE_URL;

test("HU-H4 integra recepción, stock, H5, auditoría, idempotencia y concurrencia en PostgreSQL", {
  skip: !DATABASE_URL,
  timeout: 30_000,
}, async () => {
  process.env.DATABASE_URL = DATABASE_URL;

  const [
    { prisma },
    recepciones,
    inventario,
    { ServiceError },
    { iniciarAuditLogListener },
    { domainEventBus },
  ] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./recepcion.service.ts"),
    import("../inventario/movimiento.service.ts"),
    import("../../errors/service-error.ts"),
    import("../../events/listeners/audit-log.listener.ts"),
    import("../../events/domain-event-bus.ts"),
  ]);
  iniciarAuditLogListener();

  const ORDEN_ID = "1a2b3c4d-7777-4a1a-8a1a-000000000001";
  const ITEM_1_ID = "1a2b3c4d-7778-4a1a-8a1a-000000000001";
  const ITEM_2_ID = "1a2b3c4d-7778-4a1a-8a1a-000000000002";
  const USUARIO_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";
  const DEPOSITO_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
  const VARIANTE_1_ID = "407e729d-47c3-404d-a89a-0a9c1f85a3db";
  const VARIANTE_2_ID = "864c2765-cbdd-41eb-837a-e12814b62868";
  const VARIANTE_ESCANEO_ID = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";

  const stockInicial1 = await prisma.stockDeposito.findUniqueOrThrow({
    where: { variante_sku_id_deposito_id: { variante_sku_id: VARIANTE_1_ID, deposito_id: DEPOSITO_ID } },
  });
  const stockInicial2 = await prisma.stockDeposito.findUniqueOrThrow({
    where: { variante_sku_id_deposito_id: { variante_sku_id: VARIANTE_2_ID, deposito_id: DEPOSITO_ID } },
  });

  const permisoRecepcion = await prisma.permiso.findUniqueOrThrow({
    where: { codigo: "recepciones:registrar" },
    select: { roles: { select: { is_active: true, rol: { select: { nombre: true } } } } },
  });
  assert.deepEqual(
    permisoRecepcion.roles.filter((vinculo) => vinculo.is_active).map((vinculo) => vinculo.rol.nombre).sort(),
    ["ADMINISTRADOR", "ENCARGADO_DEPOSITO"],
  );
  assert.equal(
    permisoRecepcion.roles.some((vinculo) => vinculo.is_active && vinculo.rol.nombre === "COMPRADOR"),
    false,
  );

  // Regresión HU-A2/A11: el wrapper público extraído conserva transacción,
  // stock, movimiento y evento, sin asociar una recepción de HU-H4.
  const stockEscaneoInicial = await prisma.stockDeposito.findUniqueOrThrow({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_ESCANEO_ID,
        deposito_id: DEPOSITO_ID,
      },
    },
  });
  let eventoIngresoEscaneo: { movimiento_id: string; deposito_destino_id: string } | null = null;
  const capturarIngresoEscaneo = (payload: { movimiento_id: string; deposito_destino_id: string }) => {
    eventoIngresoEscaneo = payload;
  };
  domainEventBus.once("inventario:ingreso_stock_registrado", capturarIngresoEscaneo);
  const ingresoEscaneo = await inventario.registrarIngresoStock({
    deposito_destino_id: DEPOSITO_ID,
    comprobante_referencia: "IT-REGRESION-A2-A11",
    items: [{
      variante_sku_id: VARIANTE_ESCANEO_ID,
      cantidad: 2,
      estado_destino: "DISPONIBLE",
    }],
  }, USUARIO_ID);
  const stockEscaneoFinal = await prisma.stockDeposito.findUniqueOrThrow({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_ESCANEO_ID,
        deposito_id: DEPOSITO_ID,
      },
    },
  });
  const movimientoEscaneo = await prisma.movimientoStock.findUniqueOrThrow({
    where: { id: ingresoEscaneo.movimiento_id },
    select: { recepcion_id: true, items: { select: { cantidad: true, estado_destino: true } } },
  });
  assert.equal(stockEscaneoFinal.cantidad, stockEscaneoInicial.cantidad + 2);
  assert.equal(movimientoEscaneo.recepcion_id, null);
  assert.deepEqual(movimientoEscaneo.items, [{ cantidad: 2, estado_destino: "DISPONIBLE" }]);
  assert.deepEqual(eventoIngresoEscaneo, {
    movimiento_id: ingresoEscaneo.movimiento_id,
    deposito_destino_id: DEPOSITO_ID,
    items: [{
      variante_sku_id: VARIANTE_ESCANEO_ID,
      cantidad: 2,
      estado_destino: "DISPONIBLE",
      cantidad_resultante: stockEscaneoFinal.cantidad,
    }],
    usuario_id: USUARIO_ID,
  });

  // Rollback real: la recepción llega a insertarse dentro de la tx, pero el
  // núcleo de stock falla al encontrar la variante temporalmente inactiva.
  const claveRollback = "61000000-0000-4000-8000-000000000001";
  await prisma.varianteSKU.update({ where: { id: VARIANTE_1_ID }, data: { is_active: false } });
  await assert.rejects(
    recepciones.registrarRecepcion({
      orden_compra_id: ORDEN_ID,
      deposito_destino_id: DEPOSITO_ID,
      clave_idempotencia: claveRollback,
      items: [{ orden_compra_item_id: ITEM_1_ID, cantidad_recibida: 1, cantidad_aceptada: 1, discrepancias: [] }],
    }, USUARIO_ID),
    (error: unknown) => error instanceof ServiceError && error.code === "VARIANTE_NO_ENCONTRADA",
  );
  await prisma.varianteSKU.update({ where: { id: VARIANTE_1_ID }, data: { is_active: true } });
  assert.equal(await prisma.recepcion.count({ where: { clave_idempotencia: claveRollback } }), 0);

  // Dos requests con la misma clave/payload producen una sola recepción.
  const claveParcial = "62000000-0000-4000-8000-000000000001";
  const payloadParcial = {
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: claveParcial,
    numero_remito_proveedor: "IT-PARCIAL",
    items: [{
      orden_compra_item_id: ITEM_1_ID,
      cantidad_recibida: 1,
      cantidad_aceptada: 0,
      discrepancias: [{ tipo: "CALIDAD" as const, detalle: "Unidad rechazada" }],
    }],
  };
  const reintentos = await Promise.all([
    recepciones.registrarRecepcion({ ...payloadParcial, orden_compra_id: ORDEN_ID }, USUARIO_ID),
    recepciones.registrarRecepcion({ ...payloadParcial, orden_compra_id: ORDEN_ID }, USUARIO_ID),
  ]);
  assert.equal(new Set(reintentos.map((resultado) => resultado.recepcion_id)).size, 1);
  assert.equal(reintentos.filter((resultado) => resultado.idempotente).length, 1);
  assert.equal(await prisma.recepcion.count({ where: { clave_idempotencia: claveParcial } }), 1);
  assert.equal(reintentos[0]!.movimiento_stock_id, null);
  assert.equal((await prisma.ordenCompra.findUniqueOrThrow({ where: { id: ORDEN_ID } })).estado, "RECEPCION_PARCIAL");
  assert.equal(await prisma.evaluacionProveedor.count({ where: { recepcion_id: reintentos[0]!.recepcion_id } }), 1);
  const recepcionTotalmenteObservada = await prisma.recepcion.findUniqueOrThrow({
    where: { id: reintentos[0]!.recepcion_id },
    select: {
      movimiento_stock: { select: { id: true } },
      items: {
        select: {
          cantidad_recibida: true,
          cantidad_aceptada: true,
          discrepancias: { select: { tipo: true, detalle: true } },
        },
      },
    },
  });
  assert.equal(recepcionTotalmenteObservada.movimiento_stock, null);
  assert.deepEqual(recepcionTotalmenteObservada.items, [{
    cantidad_recibida: 1,
    cantidad_aceptada: 0,
    discrepancias: [{ tipo: "CALIDAD", detalle: "Unidad rechazada" }],
  }]);
  assert.equal((await prisma.stockDeposito.findUniqueOrThrow({
    where: { variante_sku_id_deposito_id: { variante_sku_id: VARIANTE_1_ID, deposito_id: DEPOSITO_ID } },
  })).cantidad, stockInicial1.cantidad);

  await assert.rejects(
    recepciones.registrarRecepcion({
      orden_compra_id: ORDEN_ID,
      ...payloadParcial,
      items: [{ ...payloadParcial.items[0], cantidad_aceptada: 1 }],
    }, USUARIO_ID),
    (error: unknown) => error instanceof ServiceError && error.code === "CLAVE_IDEMPOTENCIA_REUTILIZADA",
  );

  // Sobre-recepción bloqueada sin escritura residual.
  const claveExceso = "63000000-0000-4000-8000-000000000001";
  await assert.rejects(
    recepciones.registrarRecepcion({
      orden_compra_id: ORDEN_ID,
      deposito_destino_id: DEPOSITO_ID,
      clave_idempotencia: claveExceso,
      items: [{ orden_compra_item_id: ITEM_1_ID, cantidad_recibida: 2, cantidad_aceptada: 2, discrepancias: [] }],
    }, USUARIO_ID),
    (error: unknown) => error instanceof ServiceError && error.code === "CANTIDAD_EXCEDE_PENDIENTE",
  );
  assert.equal(await prisma.recepcion.count({ where: { clave_idempotencia: claveExceso } }), 0);

  // Dos claves compiten por la última unidad: Serializable permite una sola.
  const clavesSaldo = [
    "64000000-0000-4000-8000-000000000001",
    "64000000-0000-4000-8000-000000000002",
  ];
  const carreraSaldo = await Promise.allSettled(clavesSaldo.map((clave_idempotencia) =>
    recepciones.registrarRecepcion({
      orden_compra_id: ORDEN_ID,
      deposito_destino_id: DEPOSITO_ID,
      clave_idempotencia,
      items: [{ orden_compra_item_id: ITEM_1_ID, cantidad_recibida: 1, cantidad_aceptada: 1, discrepancias: [] }],
    }, USUARIO_ID)));
  assert.equal(carreraSaldo.filter((resultado) => resultado.status === "fulfilled").length, 1);
  assert.equal(carreraSaldo.filter((resultado) => resultado.status === "rejected").length, 1);

  // Un fallo inyectado de H5 ocurre post-commit y no revierte H4.
  const claveFalloH5 = "65000000-0000-4000-8000-000000000001";
  const falloH5 = await recepciones.registrarRecepcionConDependencias({
    orden_compra_id: ORDEN_ID,
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: claveFalloH5,
    items: [{
      orden_compra_item_id: ITEM_2_ID,
      cantidad_recibida: 1,
      cantidad_aceptada: 0,
      discrepancias: [{ tipo: "CALIDAD", detalle: "Unidad rechazada en prueba de fallo H5" }],
    }],
  }, USUARIO_ID, {
    registrarEvaluacion: async () => { throw new Error("fallo H5 simulado"); },
  });
  assert.equal(falloH5.evaluacion_proveedor, "FALLO");
  assert.equal(await prisma.recepcion.count({ where: { id: falloH5.recepcion_id } }), 1);

  // La recepción final completa por cantidad física e ingresa solo 7 aceptadas.
  const claveFinal = "66000000-0000-4000-8000-000000000001";
  const final = await recepciones.registrarRecepcion({
    orden_compra_id: ORDEN_ID,
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: claveFinal,
    numero_remito_proveedor: "IT-FINAL",
    items: [{
      orden_compra_item_id: ITEM_2_ID,
      cantidad_recibida: 9,
      cantidad_aceptada: 7,
      discrepancias: [{ tipo: "CANTIDAD", detalle: "Dos unidades no aceptadas" }],
    }],
  }, USUARIO_ID);
  assert.equal(final.estado_orden_compra, "RECIBIDA_COMPLETA");
  assert.ok(final.movimiento_stock_id);
  assert.equal(await prisma.evaluacionProveedor.count({ where: { recepcion_id: final.recepcion_id } }), 1);

  const finalReintentada = await recepciones.registrarRecepcion({
    orden_compra_id: ORDEN_ID,
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: claveFinal,
    numero_remito_proveedor: "IT-FINAL",
    items: [{
      orden_compra_item_id: ITEM_2_ID,
      cantidad_recibida: 9,
      cantidad_aceptada: 7,
      discrepancias: [{ tipo: "CANTIDAD", detalle: "Dos unidades no aceptadas" }],
    }],
  }, USUARIO_ID);
  assert.equal(finalReintentada.recepcion_id, final.recepcion_id);
  assert.equal(finalReintentada.idempotente, true);
  assert.equal(finalReintentada.evaluacion_proveedor, "NO_REEJECUTADA");
  assert.equal(await prisma.movimientoStock.count({ where: { recepcion_id: final.recepcion_id } }), 1);
  assert.equal(await prisma.evaluacionProveedor.count({ where: { recepcion_id: final.recepcion_id } }), 1);

  const stockFinal1 = await prisma.stockDeposito.findUniqueOrThrow({
    where: { variante_sku_id_deposito_id: { variante_sku_id: VARIANTE_1_ID, deposito_id: DEPOSITO_ID } },
  });
  const stockFinal2 = await prisma.stockDeposito.findUniqueOrThrow({
    where: { variante_sku_id_deposito_id: { variante_sku_id: VARIANTE_2_ID, deposito_id: DEPOSITO_ID } },
  });
  assert.equal(stockFinal1.cantidad, stockInicial1.cantidad + 1);
  assert.equal(stockFinal2.cantidad, stockInicial2.cantidad + 7);

  const movimiento = await prisma.movimientoStock.findUniqueOrThrow({
    where: { id: final.movimiento_stock_id! },
    select: {
      recepcion: {
        select: {
          id: true,
          orden_compra: { select: { id: true, proveedor_id: true, numero_orden: true } },
        },
      },
    },
  });
  assert.equal(movimiento.recepcion?.id, final.recepcion_id);
  assert.equal(movimiento.recepcion?.orden_compra.id, ORDEN_ID);
  assert.ok(movimiento.recepcion?.orden_compra.proveedor_id);

  // El listener es fire-and-forget: esperar brevemente la materialización.
  let auditLogs: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
  for (let intento = 0; intento < 20 && auditLogs.length < 2; intento++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    auditLogs = await prisma.auditLog.findMany({
      where: {
        tabla_afectada: "recepciones",
        registro_id: { in: [reintentos[0]!.recepcion_id, final.recepcion_id] },
      },
    });
  }
  assert.equal(auditLogs.length, 2);
  const auditParcial = auditLogs.find((log) => log.registro_id === reintentos[0]!.recepcion_id);
  const auditFinal = auditLogs.find((log) => log.registro_id === final.recepcion_id);
  assert.ok(auditParcial);
  assert.ok(auditFinal);
  assert.equal(auditParcial.usuario_id, USUARIO_ID);
  assert.equal((auditParcial.valor_anterior as { estado_orden_compra?: string }).estado_orden_compra, "CONFIRMADA");
  assert.equal((auditParcial.valor_nuevo as { estado_orden_compra?: string }).estado_orden_compra, "RECEPCION_PARCIAL");
  assert.equal(auditFinal.usuario_id, USUARIO_ID);
  assert.deepEqual(auditFinal.valor_anterior, { estado_orden_compra: "RECEPCION_PARCIAL" });
  assert.deepEqual(auditFinal.valor_nuevo, {
    orden_compra_id: ORDEN_ID,
    numero_orden: "OC-2026-0001",
    deposito_destino_id: DEPOSITO_ID,
    fecha_recepcion: final.fecha_recepcion,
    estado_orden_compra: "RECIBIDA_COMPLETA",
  });

  console.info("[HU-H4:EVIDENCIA]", JSON.stringify({
    numero_orden: "OC-2026-0001",
    orden_compra_id: ORDEN_ID,
    proveedor_id: movimiento.recepcion?.orden_compra.proveedor_id,
    estado_inicial: "CONFIRMADA",
    recepcion_parcial_id: reintentos[0]!.recepcion_id,
    estado_intermedio: "RECEPCION_PARCIAL",
    recepcion_final_id: final.recepcion_id,
    estado_final: final.estado_orden_compra,
    movimiento_stock_id: final.movimiento_stock_id,
    audit_log_parcial_id: auditParcial.id,
    audit_log_final_id: auditFinal.id,
  }));

  await prisma.$disconnect();
});
