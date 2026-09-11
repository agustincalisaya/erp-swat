import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_H4_INTEGRATION_DATABASE_URL;

test("HU-H4 V2.1 integra recepción perfecta, stock, H5, auditoría, idempotencia y concurrencia", {
  skip: !DATABASE_URL,
  timeout: 30_000,
}, async (t) => {
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
  t.after(async () => prisma.$disconnect());
  iniciarAuditLogListener();

  const PROVEEDOR_ID = "1a2b3c4d-6666-4a1a-8a1a-000000000001";
  const USUARIO_COMPRADOR_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000001";
  const USUARIO_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";
  const DEPOSITO_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
  const DEPOSITO_ALTERNATIVO_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
  const VARIANTE_1_ID = "407e729d-47c3-404d-a89a-0a9c1f85a3db";
  const VARIANTE_2_ID = "864c2765-cbdd-41eb-837a-e12814b62868";
  const VARIANTE_ESCANEO_ID = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";

  async function crearOrdenConfirmada(opciones: {
    incluirSegundoItem?: boolean;
  } = {}) {
    const sufijo = randomUUID().replaceAll("-", "").slice(0, 16);
    return prisma.ordenCompra.create({
      data: {
        numero_orden: `IT-H4V21-${sufijo}`,
        proveedor_id: PROVEEDOR_ID,
        estado: "CONFIRMADA",
        fecha_envio: new Date(),
        fecha_confirmacion: new Date(),
        fecha_entrega_comprometida: new Date(Date.now() + 24 * 60 * 60 * 1000),
        creada_por_id: USUARIO_COMPRADOR_ID,
        items: {
          create: [
            {
              variante_sku_id: VARIANTE_1_ID,
              cantidad_solicitada: 10,
              precio_unitario: 15800,
            },
            ...(opciones.incluirSegundoItem
              ? [{
                  variante_sku_id: VARIANTE_2_ID,
                  cantidad_solicitada: 5,
                  precio_unitario: 42000,
                }]
              : []),
          ],
        },
      },
      select: {
        id: true,
        numero_orden: true,
        items: {
          orderBy: { created_at: "asc" },
          select: { id: true, variante_sku_id: true, cantidad_solicitada: true },
        },
      },
    });
  }

  const permisoRecepcion = await prisma.permiso.findUniqueOrThrow({
    where: { codigo: "recepciones:registrar" },
    select: { roles: { select: { is_active: true, rol: { select: { nombre: true } } } } },
  });
  assert.deepEqual(
    permisoRecepcion.roles
      .filter((vinculo) => vinculo.is_active)
      .map((vinculo) => vinculo.rol.nombre)
      .sort(),
    ["ADMINISTRADOR", "ENCARGADO_DEPOSITO"],
  );
  assert.equal(
    permisoRecepcion.roles.some(
      (vinculo) => vinculo.is_active && vinculo.rol.nombre === "COMPRADOR",
    ),
    false,
  );

  // Regresión A2/A11: el wrapper público conserva movimiento y stock sin
  // asociar una recepción H4.
  const stockEscaneoInicial = await prisma.stockDeposito.findUniqueOrThrow({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_ESCANEO_ID,
        deposito_id: DEPOSITO_ID,
      },
    },
  });
  let eventoIngresoEscaneo: { movimiento_id: string; deposito_destino_id: string } | null = null;
  domainEventBus.once(
    "inventario:ingreso_stock_registrado",
    (payload) => { eventoIngresoEscaneo = payload; },
  );
  const ingresoEscaneo = await inventario.registrarIngresoStock({
    deposito_destino_id: DEPOSITO_ID,
    comprobante_referencia: `IT-A2-A11-${randomUUID()}`,
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

  // Rollback: una variante temporalmente inactiva hace fallar Inventario y
  // revierte recepción, movimiento, stock y estado de OC.
  const ordenRollback = await crearOrdenConfirmada();
  const claveRollback = randomUUID();
  await prisma.varianteSKU.update({ where: { id: VARIANTE_1_ID }, data: { is_active: false } });
  try {
    await assert.rejects(
      recepciones.registrarRecepcion({
        orden_compra_id: ordenRollback.id,
        deposito_destino_id: DEPOSITO_ID,
        clave_idempotencia: claveRollback,
      }, USUARIO_ID),
      (error: unknown) => error instanceof ServiceError && error.code === "VARIANTE_NO_ENCONTRADA",
    );
  } finally {
    await prisma.varianteSKU.update({ where: { id: VARIANTE_1_ID }, data: { is_active: true } });
  }
  assert.equal(await prisma.recepcion.count({ where: { clave_idempotencia: claveRollback } }), 0);
  assert.equal(
    (await prisma.ordenCompra.findUniqueOrThrow({ where: { id: ordenRollback.id } })).estado,
    "CONFIRMADA",
  );

  // Una OC confirmada sin líneas activas no puede producir una recepción vacía.
  const ordenSinItems = await crearOrdenConfirmada();
  await prisma.ordenCompraItem.updateMany({
    where: { orden_compra_id: ordenSinItems.id },
    data: { is_active: false, deleted_at: new Date() },
  });
  const claveSinItems = randomUUID();
  await assert.rejects(
    recepciones.registrarRecepcion({
      orden_compra_id: ordenSinItems.id,
      deposito_destino_id: DEPOSITO_ID,
      clave_idempotencia: claveSinItems,
    }, USUARIO_ID),
    (error: unknown) => (
      error instanceof ServiceError && error.code === "ORDEN_SIN_ITEMS_RECEPCIONABLES"
    ),
  );
  assert.equal(await prisma.recepcion.count({ where: { clave_idempotencia: claveSinItems } }), 0);
  assert.equal(
    (await recepciones.listarOrdenesRecepcionables()).ordenes.some(
      (orden) => orden.id === ordenSinItems.id,
    ),
    false,
  );

  const fechaHoy = new Date().toISOString().slice(0, 10);
  const sinFiltros = await recepciones.listarOrdenesRecepcionables({ limit: 500 });
  assert.ok(sinFiltros.ordenes.length <= 10);
  assert.equal(sinFiltros.pageSize, 10);
  assert.equal(sinFiltros.page, 1);
  assert.ok(sinFiltros.ordenes.every(
    (orden) => orden.estado === "CONFIRMADA" && orden.items.length > 0,
  ));
  assert.ok(sinFiltros.ordenes.some((orden) => orden.id === ordenRollback.id));
  for (let index = 1; index < sinFiltros.ordenes.length; index++) {
    assert.ok(
      Date.parse(sinFiltros.ordenes[index - 1]!.fecha_emision)
        >= Date.parse(sinFiltros.ordenes[index]!.fecha_emision),
    );
  }

  const porProveedor = await recepciones.listarOrdenesRecepcionables({
    proveedorId: PROVEEDOR_ID,
  });
  assert.ok(porProveedor.ordenes.some((orden) => orden.id === ordenRollback.id));

  const porFecha = await recepciones.listarOrdenesRecepcionables({
    fechaEmision: fechaHoy,
  });
  assert.ok(porFecha.ordenes.some((orden) => orden.id === ordenRollback.id));
  assert.ok(porFecha.ordenes.every((orden) => orden.fecha_emision.startsWith(fechaHoy)));

  const filtrosCombinados = await recepciones.listarOrdenesRecepcionables({
    proveedorId: PROVEEDOR_ID,
    fechaEmision: fechaHoy,
  });
  assert.ok(filtrosCombinados.ordenes.some((orden) => orden.id === ordenRollback.id));
  const proveedorSinResultados = await recepciones.listarOrdenesRecepcionables({
    proveedorId: randomUUID(),
    page: 2,
  });
  assert.deepEqual(proveedorSinResultados.ordenes, []);
  assert.equal(proveedorSinResultados.total, 0);
  assert.equal(proveedorSinResultados.page, 1);
  assert.equal(proveedorSinResultados.totalPages, 0);
  assert.deepEqual(
    (await recepciones.listarOrdenesRecepcionables({
      fechaEmision: "2099-01-01",
    })).ordenes,
    [],
  );

  // Caso principal: el request no decide líneas ni cantidades. La OC aporta
  // A=10 y B=5; ambas se reciben y aceptan completas.
  const ordenPrincipal = await crearOrdenConfirmada({ incluirSegundoItem: true });
  const itemPrincipal1 = ordenPrincipal.items.find(
    (item) => item.variante_sku_id === VARIANTE_1_ID,
  )!;
  const itemPrincipal2 = ordenPrincipal.items.find(
    (item) => item.variante_sku_id === VARIANTE_2_ID,
  )!;
  const stockInicial1 = await prisma.stockDeposito.findUniqueOrThrow({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_1_ID,
        deposito_id: DEPOSITO_ID,
      },
    },
  });
  const stockInicial2 = await prisma.stockDeposito.findUniqueOrThrow({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_2_ID,
        deposito_id: DEPOSITO_ID,
      },
    },
  });
  const clavePrincipal = randomUUID();
  const payloadPrincipal = {
    orden_compra_id: ordenPrincipal.id,
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: clavePrincipal,
  };
  const reintentos = await Promise.all([
    recepciones.registrarRecepcion(payloadPrincipal, USUARIO_ID),
    recepciones.registrarRecepcion(payloadPrincipal, USUARIO_ID),
  ]);
  const principal = reintentos[0]!;
  assert.equal(new Set(reintentos.map((resultado) => resultado.recepcion_id)).size, 1);
  assert.equal(reintentos.filter((resultado) => resultado.idempotente).length, 1);
  assert.equal(principal.estado_orden_compra, "RECIBIDA_COMPLETA");
  assert.ok(principal.movimiento_stock_id);
  assert.equal(await prisma.recepcion.count({ where: { clave_idempotencia: clavePrincipal } }), 1);
  assert.equal(await prisma.movimientoStock.count({ where: { recepcion_id: principal.recepcion_id } }), 1);
  assert.equal(await prisma.evaluacionProveedor.count({ where: { recepcion_id: principal.recepcion_id } }), 1);
  assert.equal(
    reintentos.find((resultado) => resultado.idempotente)?.evaluacion_proveedor,
    "NO_REEJECUTADA",
  );

  const recepcionPrincipal = await prisma.recepcion.findUniqueOrThrow({
    where: { id: principal.recepcion_id },
    select: {
      numero_remito_proveedor: true,
      observaciones: true,
      items: {
        orderBy: { orden_compra_item_id: "asc" },
        select: {
          orden_compra_item_id: true,
          cantidad_recibida: true,
          cantidad_aceptada: true,
          discrepancias: { select: { id: true } },
        },
      },
    },
  });
  assert.equal(recepcionPrincipal.numero_remito_proveedor, null);
  assert.equal(recepcionPrincipal.observaciones, null);
  assert.equal(recepcionPrincipal.items.length, 2);
  assert.deepEqual(
    new Map(recepcionPrincipal.items.map((item) => [item.orden_compra_item_id, item])),
    new Map([
      [itemPrincipal1.id, {
        orden_compra_item_id: itemPrincipal1.id,
        cantidad_recibida: 10,
        cantidad_aceptada: 10,
        discrepancias: [],
      }],
      [itemPrincipal2.id, {
        orden_compra_item_id: itemPrincipal2.id,
        cantidad_recibida: 5,
        cantidad_aceptada: 5,
        discrepancias: [],
      }],
    ]),
  );
  assert.equal(await prisma.recepcionDiscrepancia.count({
    where: { recepcion_item: { recepcion_id: principal.recepcion_id } },
  }), 0);

  const stockFinal1 = await prisma.stockDeposito.findUniqueOrThrow({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_1_ID,
        deposito_id: DEPOSITO_ID,
      },
    },
  });
  const stockFinal2 = await prisma.stockDeposito.findUniqueOrThrow({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: VARIANTE_2_ID,
        deposito_id: DEPOSITO_ID,
      },
    },
  });
  assert.equal(stockFinal1.cantidad, stockInicial1.cantidad + 10);
  assert.equal(stockFinal2.cantidad, stockInicial2.cantidad + 5);

  const evaluacionPrincipal = await prisma.evaluacionProveedor.findUniqueOrThrow({
    where: { recepcion_id: principal.recepcion_id },
    select: { puntaje_calidad_recepcion: true },
  });
  assert.equal(evaluacionPrincipal.puntaje_calidad_recepcion, 100);

  // Misma clave con otro depósito cambia la intención; una clave nueva no
  // puede abrir una segunda recepción sobre la OC ya completada.
  await assert.rejects(
    recepciones.registrarRecepcion({
      ...payloadPrincipal,
      deposito_destino_id: DEPOSITO_ALTERNATIVO_ID,
    }, USUARIO_ID),
    (error: unknown) => (
      error instanceof ServiceError && error.code === "CLAVE_IDEMPOTENCIA_REUTILIZADA"
    ),
  );
  await assert.rejects(
    recepciones.registrarRecepcion({
      ...payloadPrincipal,
      clave_idempotencia: randomUUID(),
    }, USUARIO_ID),
    (error: unknown) => error instanceof ServiceError && error.code === "ORDEN_NO_RECEPCIONABLE",
  );

  // Dos claves distintas compiten por la misma OC: una única transacción gana.
  const ordenConcurrente = await crearOrdenConfirmada();
  const carrera = await Promise.allSettled([randomUUID(), randomUUID()].map((clave_idempotencia) =>
    recepciones.registrarRecepcion({
      orden_compra_id: ordenConcurrente.id,
      deposito_destino_id: DEPOSITO_ID,
      clave_idempotencia,
    }, USUARIO_ID)));
  assert.equal(carrera.filter((resultado) => resultado.status === "fulfilled").length, 1);
  assert.equal(carrera.filter((resultado) => resultado.status === "rejected").length, 1);
  const resultadoRechazado = carrera.find((resultado) => resultado.status === "rejected");
  assert.ok(resultadoRechazado);
  assert.equal(
    resultadoRechazado.reason instanceof ServiceError
      && resultadoRechazado.reason.code === "ORDEN_NO_RECEPCIONABLE",
    true,
  );
  assert.equal(await prisma.recepcion.count({ where: { orden_compra_id: ordenConcurrente.id } }), 1);
  assert.equal(await prisma.movimientoStock.count({
    where: { recepcion: { orden_compra_id: ordenConcurrente.id } },
  }), 1);
  assert.equal(
    (await prisma.ordenCompra.findUniqueOrThrow({ where: { id: ordenConcurrente.id } })).estado,
    "RECIBIDA_COMPLETA",
  );

  // Un fallo inyectado de H5 ocurre post-commit y no revierte H4.
  const ordenFalloH5 = await crearOrdenConfirmada();
  const falloH5 = await recepciones.registrarRecepcionConDependencias({
    orden_compra_id: ordenFalloH5.id,
    deposito_destino_id: DEPOSITO_ID,
    clave_idempotencia: randomUUID(),
  }, USUARIO_ID, {
    registrarEvaluacion: async () => { throw new Error("fallo H5 simulado"); },
  });
  assert.equal(falloH5.evaluacion_proveedor, "FALLO");
  assert.equal(falloH5.estado_orden_compra, "RECIBIDA_COMPLETA");
  assert.equal(await prisma.recepcion.count({ where: { id: falloH5.recepcion_id } }), 1);

  // Trazabilidad MovimientoStock -> Recepcion -> OrdenCompra -> Proveedor.
  const movimiento = await prisma.movimientoStock.findUniqueOrThrow({
    where: { id: principal.movimiento_stock_id! },
    select: {
      items: { select: { variante_sku_id: true, cantidad: true } },
      recepcion: {
        select: {
          id: true,
          orden_compra: { select: { id: true, proveedor_id: true, numero_orden: true } },
        },
      },
    },
  });
  assert.deepEqual(
    new Map(movimiento.items.map((item) => [item.variante_sku_id, item.cantidad])),
    new Map([[VARIANTE_1_ID, 10], [VARIANTE_2_ID, 5]]),
  );
  assert.equal(movimiento.recepcion?.id, principal.recepcion_id);
  assert.equal(movimiento.recepcion?.orden_compra.id, ordenPrincipal.id);
  assert.equal(movimiento.recepcion?.orden_compra.proveedor_id, PROVEEDOR_ID);

  // El listener es fire-and-forget: esperar la materialización del AuditLog.
  let auditPrincipales: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
  for (let intento = 0; intento < 20 && auditPrincipales.length === 0; intento++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    auditPrincipales = await prisma.auditLog.findMany({
      where: { tabla_afectada: "recepciones", registro_id: principal.recepcion_id },
    });
  }
  assert.equal(auditPrincipales.length, 1);
  const auditPrincipal = auditPrincipales[0]!;
  assert.equal(auditPrincipal.usuario_id, USUARIO_ID);
  assert.deepEqual(auditPrincipal.valor_anterior, { estado_orden_compra: "CONFIRMADA" });
  assert.deepEqual(auditPrincipal.valor_nuevo, {
    orden_compra_id: ordenPrincipal.id,
    numero_orden: ordenPrincipal.numero_orden,
    deposito_destino_id: DEPOSITO_ID,
    fecha_recepcion: principal.fecha_recepcion,
    estado_orden_compra: "RECIBIDA_COMPLETA",
  });

  console.info("[HU-H4-V2.1:EVIDENCIA]", JSON.stringify({
    numero_orden: ordenPrincipal.numero_orden,
    orden_compra_id: ordenPrincipal.id,
    proveedor_id: movimiento.recepcion?.orden_compra.proveedor_id,
    estado_inicial: "CONFIRMADA",
    recepcion_id: principal.recepcion_id,
    items: [
      { variante_sku_id: VARIANTE_1_ID, solicitada: 10, recibida: 10, aceptada: 10 },
      { variante_sku_id: VARIANTE_2_ID, solicitada: 5, recibida: 5, aceptada: 5 },
    ],
    discrepancias: 0,
    estado_final: principal.estado_orden_compra,
    movimiento_stock_id: principal.movimiento_stock_id,
    audit_log_id: auditPrincipal.id,
  }));
});
