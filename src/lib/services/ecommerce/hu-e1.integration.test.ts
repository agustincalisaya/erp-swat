import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-E1 — Nivel 2: integración de servicios contra una base REAL descartable
 * (Postgres del docker-compose, base `swat_erp_test_e1`; ver
 * docs/modulos/modulo E/HU1_MODULO_E.md §5 para crearla). Mismo patrón que
 * `venta-mostrador.integration.test.ts`: `skip` sin
 * `HU_E1_INTEGRATION_DATABASE_URL` e imports dinámicos (los servicios usan
 * `import "server-only"`).
 *
 *   HU_E1_INTEGRATION_DATABASE_URL=postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e1?schema=public \
 *     npm run test:integration:e1
 *
 * Cada escenario crea SUS PROPIOS artículos (Producto Maestro + variante +
 * contenido web + foto + precio + stock) y SUS PROPIAS cuentas, así los
 * escenarios no dependen del orden ni del estado que dejó una corrida
 * anterior. Excepción deliberada: la fusión del seed (CT2 repetido) usa los
 * fixtures de `prisma/seed.ts` y los re-afirma al empezar, igual que el seed.
 * Nunca se borra nada (Regla N.° 1): la base es descartable.
 */

const DATABASE_URL = process.env.HU_E1_INTEGRATION_DATABASE_URL;

// IDs fijos de prisma/seed.ts.
const DEPOSITO_CENTRAL_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
const LISTA_PRECIO_VENTA_GENERAL_ID = "16d1dbbf-b91e-4c07-93f0-007572d0d116";
const LISTA_PRECIO_VENTA_VERSION_1_ID = "f7bc2652-5022-4d5c-b235-be90b8f1677d";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";
const VARIANTE_CAMISA_TACTICA_2_ID = "6fbb4612-9e6d-4661-b250-0bc62579089e"; // CT2
const VARIANTE_CAMISA_TACTICA_3_ID = "0929aab1-57fb-44bc-90b6-76417c76c016"; // CT3
const VARIANTE_CAMISA_TACTICA_INACTIVA_ID = "9f8b39ba-97af-42fc-9915-2f46a5fe67f9";
const CUENTA_WEB_CARLOS_RUIZ_ID = "f14aeb05-43e6-419e-aad0-61b096ecf13e";
const CARRITO_WEB_CARLOS_RUIZ_ID = "9694caaa-2f5b-4cb7-b848-7c005bdca884";
const CARRITO_ITEM_CARLOS_CT2_ID = "c29cea90-76fc-4e05-9a7b-9ba264d4bdda";
const CARRITO_ITEM_CARLOS_INACTIVA_ID = "edf2919c-4f48-4bc3-9fb8-6e2ca0809b56";
const CARRITO_WEB_VISITANTE_ID = "1fa6fdec-4aef-4c79-8174-9b41983b8147";
const CARRITO_ITEM_VISITANTE_CT3_ID = "6e08eb73-6768-4ab5-83ce-e6e3841166c4";
const CARRITO_ITEM_VISITANTE_CT2_ID = "e984b52c-1fb2-417e-9c71-93cceeeb408a";
const CARRITO_VISITANTE_TOKEN_SEED = "0b61c7bf18671e7ed1a096da1a17d9ea94c81004ed50d22a";

const UNA_HORA_MS = 60 * 60 * 1000;

test(
  "HU-E1 — catálogo, carrito, fusión y checkout parcial contra una base real",
  { skip: !DATABASE_URL, timeout: 180_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      catalogo,
      carrito,
      checkout,
      reservaSvc,
      ventaMostrador,
      turnoCaja,
      { ServiceError },
      { iniciarAuditLogListener },
      { iniciarNotificacionListener },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./catalogo-web.service.ts"),
      import("./carrito.service.ts"),
      import("./checkout.service.ts"),
      import("../inventario/reserva.service.ts"),
      import("../ventas/venta-mostrador.service.ts"),
      import("../ventas/turno-caja.service.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../../events/listeners/notificacion.listener.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);
    t.after(async () => prisma.$disconnect());
    iniciarAuditLogListener();
    iniciarNotificacionListener();

    const conCodigo = (codigo: string) => (err: unknown) => err instanceof ServiceError && err.code === codigo;

    async function esperar<T>(leer: () => Promise<T>, listo: (v: T) => boolean): Promise<T> {
      let valor = await leer();
      for (let intento = 0; intento < 40 && !listo(valor); intento++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        valor = await leer();
      }
      return valor;
    }

    // ── Fixtures propios por escenario (módulo compartido con el test HTTP) ──
    const crearArticulo = (opciones: Parameters<typeof fixtures.crearArticulo>[1]) => fixtures.crearArticulo(prisma, opciones);
    const crearCuenta = (vinculacionPendiente = false) => fixtures.crearCuenta(prisma, { vinculacionPendiente });

    async function stockShowroom(varianteId: string): Promise<number> {
      const fila = await prisma.stockDeposito.findUniqueOrThrow({
        where: { variante_sku_id_deposito_id: { variante_sku_id: varianteId, deposito_id: DEPOSITO_SHOWROOM_ID } },
      });
      return fila.cantidad;
    }

    async function reservasDelPedido(pedidoVentaId: string) {
      const items = await prisma.pedidoVentaItem.findMany({
        where: { pedido_venta_id: pedidoVentaId },
        select: { reserva: true },
      });
      return items.map((i) => i.reserva!);
    }

    // ── CA1 ─────────────────────────────────────────────────────────────────
    await t.test(
      "CA1 — el disponible es StockDeposito del depósito configurado para el canal web (sin copia propia)",
      async () => {
        const a = await crearArticulo({ stockShowroom: 7, stockCentral: 40 });
        const detalle = await catalogo.obtenerDetalleProductoWeb(a.productoWebId);
        assert.equal(detalle.variantes[0].disponible, 7);

        // Cambiar la configuración cambia la fuente en el siguiente request.
        const clave = "ECOMMERCE_DEPOSITO_CANAL_WEB_ID";
        await prisma.configuracionSistema.update({ where: { clave }, data: { valor: DEPOSITO_CENTRAL_ID } });
        try {
          const desdeCentral = await catalogo.obtenerDetalleProductoWeb(a.productoWebId);
          assert.equal(desdeCentral.variantes[0].disponible, 40);
        } finally {
          await prisma.configuracionSistema.update({ where: { clave }, data: { valor: DEPOSITO_SHOWROOM_ID } });
        }

        // Un cambio directo en Módulo A se ve sin cache.
        await prisma.stockDeposito.update({
          where: { variante_sku_id_deposito_id: { variante_sku_id: a.varianteId, deposito_id: DEPOSITO_SHOWROOM_ID } },
          data: { cantidad: 3 },
        });
        const vistas = await catalogo.resolverVariantesWeb([a.varianteId]);
        assert.equal(vistas.get(a.varianteId)!.disponible, 3);
      },
    );

    // ── CA2 ─────────────────────────────────────────────────────────────────
    await t.test(
      "CA2 — una venta de mostrador de la última unidad deja el artículo agotado en la web al instante",
      async () => {
        const a = await crearArticulo({ stockShowroom: 1 });
        await prisma.turnoCaja.updateMany({
          where: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID, fecha_cierre: null },
          data: { fecha_cierre: new Date(), saldo_esperado: 0, conteo_fisico_declarado: 0, diferencia: 0 },
        });
        await turnoCaja.abrirTurnoCaja(USUARIO_SUPERVISOR_VENTAS_SEED_ID, { fondo_fijo_inicial: 1000 });

        assert.equal((await catalogo.obtenerDetalleProductoWeb(a.productoWebId)).agotado, false);

        await ventaMostrador.registrarVentaMostrador(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
          items: [{ variante_sku_id: a.varianteId, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 1, precio_unitario: 10000 }],
          medios_pago: [{ medio: "EFECTIVO", importe: 10000 }],
          tipo_comprobante: "TICKET",
        });

        const detalle = await catalogo.obtenerDetalleProductoWeb(a.productoWebId);
        assert.equal(detalle.variantes[0].disponible, 0);
        assert.equal(detalle.agotado, true);
        await assert.rejects(
          () => carrito.agregarAlCarrito({ carritoToken: null }, { variante_sku_id: a.varianteId, cantidad: 1 }),
          conCodigo("STOCK_INSUFICIENTE"),
        );
      },
    );

    // ── CA3 ─────────────────────────────────────────────────────────────────
    await t.test(
      "CA3 — el precio sale de la versión VIGENTE de la Lista de Precios de Venta; una versión futura no se aplica",
      async () => {
        const a = await crearArticulo({ stockShowroom: 5, precio: 12345 });
        const futura = await prisma.listaPrecioVentaVersion.create({
          data: {
            lista_id: LISTA_PRECIO_VENTA_GENERAL_ID,
            vigente_desde: new Date(Date.now() + 30 * 24 * UNA_HORA_MS),
            publicado_por_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID,
            items: { create: { variante_sku_id: a.varianteId, precio_venta: 99999 } },
          },
        });
        assert.ok(futura.id);
        const vista = (await catalogo.resolverVariantesWeb([a.varianteId])).get(a.varianteId)!;
        assert.equal(vista.precio_venta, 12345);
        assert.equal(vista.lista_precio_version_id, LISTA_PRECIO_VENTA_VERSION_1_ID);

        const listado = await catalogo.listarCatalogo({ q: a.sku.slice(-8), page: 1, page_size: 48 });
        const enListado = listado.items.find((p) => p.producto_web_id === a.productoWebId);
        assert.equal(enListado?.precio_desde, 12345);
      },
    );

    await t.test(
      "CA3 — un SKU sin precio vigente se lista pero NO es comprable: no se agrega al carrito y bloquea el checkout",
      async () => {
        const a = await crearArticulo({ stockShowroom: 5, precio: null });
        const detalle = await catalogo.obtenerDetalleProductoWeb(a.productoWebId);
        assert.equal(detalle.comprable, false);
        assert.equal(detalle.variantes[0].comprable, false);
        assert.equal(detalle.variantes[0].motivo, "SIN_PRECIO_VIGENTE");
        await assert.rejects(
          () => carrito.agregarAlCarrito({ carritoToken: null }, { variante_sku_id: a.varianteId, cantidad: 1 }),
          conCodigo("ARTICULO_NO_DISPONIBLE"),
        );

        // Ítem colado en el carrito (ej. el precio se dio de baja después de agregarlo).
        const c = await crearCuenta();
        const cart = await prisma.carritoWeb.create({ data: { cuenta_cliente_web_id: c.cuentaId } });
        await prisma.carritoWebItem.create({ data: { carrito_id: cart.id, variante_sku_id: a.varianteId, cantidad: 1 } });
        await assert.rejects(
          () => checkout.iniciarCheckout(c.sesion),
          (err: unknown) =>
            err instanceof ServiceError &&
            err.code === "ARTICULO_NO_DISPONIBLE" &&
            JSON.stringify(err.details).includes("SIN_PRECIO_VIGENTE"),
        );
      },
    );

    // ── CA4 ─────────────────────────────────────────────────────────────────
    await t.test(
      "CA4 — un artículo desactivado bloquea el checkout identificándolo y notifica UNA vez al cliente; nada se reserva",
      async () => {
        const ok = await crearArticulo({ stockShowroom: 5 });
        const aDesactivar = await crearArticulo({ stockShowroom: 5 });
        const c = await crearCuenta();
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: ok.varianteId, cantidad: 1 });
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: aDesactivar.varianteId, cantidad: 1 });

        // Baja lógica del SKU (Módulo A) DESPUÉS de agregarlo al carrito.
        await prisma.varianteSKU.update({
          where: { id: aDesactivar.varianteId },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "test HU-E1 CA4" },
        });

        for (let intento = 0; intento < 2; intento++) {
          await assert.rejects(
            () => checkout.iniciarCheckout(c.sesion),
            (err: unknown) => {
              assert.ok(err instanceof ServiceError);
              assert.equal(err.code, "ARTICULO_NO_DISPONIBLE");
              const items = (err.details as { items: { variante_sku_id: string; sku: string; motivo: string }[] }).items;
              assert.deepEqual(items.map((i) => [i.variante_sku_id, i.sku, i.motivo]), [
                [aDesactivar.varianteId, aDesactivar.sku, "SKU_INACTIVO"],
              ]);
              return true;
            },
          );
        }

        const notificaciones = await esperar(
          () =>
            prisma.notificacion.findMany({
              where: { cuenta_cliente_web_destinatario_id: c.cuentaId, tipo_evento: "ecommerce:carrito_articulo_no_disponible" },
            }),
          (filas) => filas.length > 0,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(notificaciones.length, 1, "dos bloqueos del mismo ítem notifican una sola vez");
        assert.equal(notificaciones[0].prioridad, "ADVERTENCIA");
        assert.match(notificaciones[0].cuerpo, new RegExp(aDesactivar.sku));

        // Rollback completo: el carrito sigue activo y no se reservó nada.
        const vista = await carrito.obtenerCarrito({ cuentaId: c.cuentaId });
        assert.equal(vista.items.length, 2);
        assert.equal(vista.items.find((i) => i.variante_sku_id === aDesactivar.varianteId)?.motivo, "SKU_INACTIVO");
        assert.equal(await stockShowroom(ok.varianteId), 5);
      },
    );

    await t.test("CA4 — también bloquea si se apaga la visibilidad web (NO_VISIBLE_WEB)", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const c = await crearCuenta();
      await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      await prisma.productoWebContenido.update({ where: { id: a.productoWebId }, data: { visibilidad_web: false } });
      await assert.rejects(
        () => checkout.iniciarCheckout(c.sesion),
        (err: unknown) => err instanceof ServiceError && JSON.stringify(err.details).includes("NO_VISIBLE_WEB"),
      );
    });

    // ── CA5 + D10 ───────────────────────────────────────────────────────────
    let pedidoCa5 = "";
    let articuloCa5 = { varianteId: "" };
    let cuentaCa5 = { cuentaId: "", clienteId: "" };
    await t.test(
      "CA5 — el checkout reserva con el TTL configurado (CHECKOUT_WEB), deja el pedido en PAGO_PENDIENTE y convierte el carrito",
      async () => {
        const a = await crearArticulo({ stockShowroom: 4, precio: 15000 });
        const c = await crearCuenta();
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 2 });

        const resultado = await checkout.iniciarCheckout(c.sesion);
        assert.equal(resultado.reutilizado, false);
        assert.equal(resultado.estado_ecommerce, "PAGO_PENDIENTE");
        assert.equal(resultado.total, 30000);
        assert.equal(resultado.checkout_url, null);
        assert.equal(await stockShowroom(a.varianteId), 2);

        const [reserva] = await reservasDelPedido(resultado.pedido_venta_id);
        assert.equal(reserva.origen_reserva, "CHECKOUT_WEB");
        assert.equal(reserva.cantidad, 2);
        assert.equal(reserva.fecha_expiracion.getTime() - reserva.fecha_inicio_reserva.getTime(), UNA_HORA_MS);
        assert.equal(new Date(resultado.ttl_expiracion).getTime(), reserva.fecha_expiracion.getTime());

        const pedido = await prisma.pedidoVenta.findUniqueOrThrow({
          where: { id: resultado.pedido_venta_id },
          include: { ecommerce: true },
        });
        assert.equal(pedido.canal, "WEB");
        assert.equal(pedido.estado, "RESERVADO");
        assert.equal(pedido.ecommerce?.estado_ecommerce, "PAGO_PENDIENTE");

        // D10: el carrito queda de baja lógica "convertido en pedido" y el cliente arranca vacío.
        const carritos = await prisma.carritoWeb.findMany({ where: { cuenta_cliente_web_id: c.cuentaId } });
        assert.equal(carritos.length, 1);
        assert.equal(carritos[0].is_active, false);
        assert.equal(carritos[0].deletion_reason, "convertido en pedido");
        assert.equal(carritos[0].deleted_by, c.cuentaId);
        assert.equal((await carrito.obtenerCarrito({ cuentaId: c.cuentaId })).items.length, 0);

        const auditoria = await esperar(
          () => prisma.auditLog.findMany({ where: { tabla_afectada: "carritos_web", registro_id: carritos[0].id, accion: "DELETE_LOGICO" } }),
          (filas) => filas.length > 0,
        );
        assert.equal(auditoria.length, 1);

        pedidoCa5 = resultado.pedido_venta_id;
        articuloCa5 = a;
        cuentaCa5 = c;
      },
    );

    await t.test("D10 caso 2 — doble clic secuencial: sin carrito con ítems, devuelve el pedido vigente sin reservar de nuevo", async () => {
      const otraVez = await checkout.iniciarCheckout({ ...cuentaCa5, vinculacionPendiente: false });
      assert.equal(otraVez.pedido_venta_id, pedidoCa5);
      assert.equal(otraVez.reutilizado, true);
      assert.equal(await stockShowroom(articuloCa5.varianteId), 2);
      assert.equal(await prisma.pedidoVenta.count({ where: { cliente_id: cuentaCa5.clienteId } }), 1);
    });

    await t.test(
      "D10 caso 1 (ex BUG CA5/D10) — con un pedido Pago Pendiente vigente y un carrito NUEVO con ítems, el checkout crea OTRO pedido y vacía el carrito",
      async () => {
        // Escenario del bug visto en desarrollo (Carlos, V-2026-000031): antes
        // D10 devolvía el pedido viejo y el carrito quedaba lleno.
        const viejo = await crearArticulo({ stockShowroom: 5 });
        const nuevo = await crearArticulo({ stockShowroom: 5 });
        const c = await crearCuenta();
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: viejo.varianteId, cantidad: 1 });
        const primero = await checkout.iniciarCheckout(c.sesion);
        assert.equal(primero.reutilizado, false);

        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: nuevo.varianteId, cantidad: 1 });
        const segundo = await checkout.iniciarCheckout(c.sesion);

        assert.equal(segundo.reutilizado, false);
        assert.notEqual(segundo.pedido_venta_id, primero.pedido_venta_id);
        assert.equal((await carrito.obtenerCarrito({ cuentaId: c.cuentaId })).items.length, 0, "carrito vacío después del checkout");
        assert.equal(await stockShowroom(nuevo.varianteId), 4);
        const [reserva] = await reservasDelPedido(segundo.pedido_venta_id);
        assert.equal(reserva.variante_sku_id, nuevo.varianteId);
        // Los dos pedidos Pago Pendiente coexisten.
        const pendientes = await prisma.pedidoVentaEcommerce.count({
          where: { estado_ecommerce: "PAGO_PENDIENTE", pedido_venta: { cliente_id: c.clienteId } },
        });
        assert.equal(pendientes, 2);
        // La página de pendiente muestra el pedido pedido por id (no "el último").
        assert.equal((await checkout.obtenerPedidoWebPendiente(primero.pedido_venta_id, c.clienteId))?.numero_venta, primero.numero_venta);
        assert.equal((await checkout.obtenerPedidoWebPendiente(segundo.pedido_venta_id, c.clienteId))?.numero_venta, segundo.numero_venta);
      },
    );

    await t.test("D10 caso 3 — sin carrito con ítems y sin pedido vigente: 422 CARRITO_VACIO", async () => {
      // (a) cuenta nueva, sin carrito.
      const sinNada = await crearCuenta();
      await assert.rejects(() => checkout.iniciarCheckout(sinNada.sesion), conCodigo("CARRITO_VACIO"));

      // (b) carrito activo pero con todos los ítems quitados.
      const a = await crearArticulo({ stockShowroom: 5 });
      const vacio = await crearCuenta();
      const r = await carrito.agregarAlCarrito({ cuentaId: vacio.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      await carrito.quitarDelCarrito({ cuentaId: vacio.cuentaId }, r.carrito.items[0].item_id);
      await assert.rejects(() => checkout.iniciarCheckout(vacio.sesion), conCodigo("CARRITO_VACIO"));

      // (c) solo un pedido Pago Pendiente con la reserva VENCIDA: no cuenta.
      const vencido = await crearCuenta();
      await carrito.agregarAlCarrito({ cuentaId: vencido.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      const pedido = await checkout.iniciarCheckout(vencido.sesion);
      const reservas = await reservasDelPedido(pedido.pedido_venta_id);
      await prisma.reserva.updateMany({
        where: { id: { in: reservas.map((x) => x.id) } },
        data: { fecha_expiracion: new Date(Date.now() - 1000) },
      });
      await assert.rejects(() => checkout.iniciarCheckout(vencido.sesion), conCodigo("CARRITO_VACIO"));
    });

    await t.test("la vista del pedido pendiente por id no expone pedidos de otro cliente", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const duenio = await crearCuenta();
      const otro = await crearCuenta();
      await carrito.agregarAlCarrito({ cuentaId: duenio.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      const pedido = await checkout.iniciarCheckout(duenio.sesion);
      assert.equal(await checkout.obtenerPedidoWebPendiente(pedido.pedido_venta_id, otro.clienteId), null);
      assert.equal((await checkout.obtenerPedidoWebPendiente(pedido.pedido_venta_id, duenio.clienteId))?.estado_visible, "PAGO_PENDIENTE");
    });

    await t.test(
      "CA5 — vencida la ventana, el job devuelve el stock a Disponible; el pedido NO cambia de estado (E7) y se ve 'Reserva vencida'",
      async () => {
        const reservas = await reservasDelPedido(pedidoCa5);
        await prisma.reserva.updateMany({
          where: { id: { in: reservas.map((r) => r.id) } },
          data: { fecha_expiracion: new Date(Date.now() - 60_000) },
        });

        const liberacion = await reservaSvc.liberarReservasVencidas(new Date());
        assert.ok(liberacion.liberadas.some((l) => l.reserva_id === reservas[0].id));
        assert.equal(await stockShowroom(articuloCa5.varianteId), 4);
        const cerrada = await prisma.reserva.findUniqueOrThrow({ where: { id: reservas[0].id } });
        assert.ok(cerrada.fecha_fin_reserva);
        const compensatorio = await prisma.movimientoStock.findFirst({
          where: { comprobante_referencia: `CRON-LIBERACION-RESERVA-${reservas[0].id}`, tipo_movimiento: "INGRESO" },
          include: { items: true },
        });
        assert.equal(compensatorio?.items[0].estado_origen, "RESERVADO");
        assert.equal(compensatorio?.items[0].estado_destino, "DISPONIBLE");

        const ecommerce = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pedidoCa5 } });
        assert.equal(ecommerce.estado_ecommerce, "PAGO_PENDIENTE", "la transición a ANULADO es de HU-E7");
        const vista = await checkout.obtenerPedidoWebPendiente(pedidoCa5, cuentaCa5.clienteId);
        assert.equal(vista?.estado_visible, "RESERVA_VENCIDA");
        assert.equal(await checkout.buscarPedidoPendienteVigente(cuentaCa5.clienteId), null);
      },
    );

    await t.test(
      "D4.2 — una reserva vencida que el job NO liberó se libera dentro del checkout nuevo (sin depender del job)",
      async () => {
        const a = await crearArticulo({ stockShowroom: 1 });
        const c = await crearCuenta();
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
        const primero = await checkout.iniciarCheckout(c.sesion);
        assert.equal(await stockShowroom(a.varianteId), 0);

        const [reservaVieja] = await reservasDelPedido(primero.pedido_venta_id);
        await prisma.reserva.update({ where: { id: reservaVieja.id }, data: { fecha_expiracion: new Date(Date.now() - 1000) } });
        // Sin correr el job: el stock sigue en 0.
        assert.equal(await stockShowroom(a.varianteId), 0);

        // `agregarAlCarrito` valida contra el disponible actual (0, la unidad sigue
        // "reservada"): el carrito nuevo se arma a mano, como si se hubiera
        // agregado antes de que venciera la reserva.
        const cart = await prisma.carritoWeb.create({ data: { cuenta_cliente_web_id: c.cuentaId } });
        await prisma.carritoWebItem.create({ data: { carrito_id: cart.id, variante_sku_id: a.varianteId, cantidad: 1 } });

        const segundo = await checkout.iniciarCheckout(c.sesion);
        assert.equal(segundo.reutilizado, false, "el pedido con reserva vencida no cuenta para la idempotencia");
        assert.notEqual(segundo.pedido_venta_id, primero.pedido_venta_id);
        assert.equal(await stockShowroom(a.varianteId), 0, "liberó 1 y volvió a reservar 1");
        const vieja = await prisma.reserva.findUniqueOrThrow({ where: { id: reservaVieja.id } });
        assert.ok(vieja.fecha_fin_reserva, "la reserva vencida quedó cerrada por el checkout");
        const [nueva] = await reservasDelPedido(segundo.pedido_venta_id);
        assert.equal(nueva.fecha_fin_reserva, null);
      },
    );

    // ── Concurrencia ────────────────────────────────────────────────────────
    await t.test(
      "Concurrencia — dos checkouts simultáneos por la ÚLTIMA unidad: uno reserva, el otro 422 STOCK_INSUFICIENTE, stock nunca negativo",
      async () => {
        const a = await crearArticulo({ stockShowroom: 1 });
        const [c1, c2] = await Promise.all([crearCuenta(), crearCuenta()]);
        for (const c of [c1, c2]) {
          await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
        }

        const resultados = await Promise.allSettled([checkout.iniciarCheckout(c1.sesion), checkout.iniciarCheckout(c2.sesion)]);
        const ok = resultados.filter((r) => r.status === "fulfilled");
        const rechazados = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        assert.equal(ok.length, 1);
        assert.equal(rechazados.length, 1);
        assert.ok(conCodigo("STOCK_INSUFICIENTE")(rechazados[0].reason));

        assert.equal(await stockShowroom(a.varianteId), 0);
        const activas = await prisma.reserva.count({ where: { variante_sku_id: a.varianteId, fecha_fin_reserva: null } });
        assert.equal(activas, 1, "una sola reserva para la única unidad");

        // El perdedor conserva su carrito (rollback) para reintentar.
        const perdedor = resultados[0].status === "rejected" ? c1 : c2;
        assert.equal((await carrito.obtenerCarrito({ cuentaId: perdedor.cuentaId })).items.length, 1);
      },
    );

    await t.test(
      "Concurrencia D10 — dos checkouts simultáneos de la MISMA cuenta crean un único pedido y reservan una sola vez",
      async () => {
        const a = await crearArticulo({ stockShowroom: 5 });
        const c = await crearCuenta();
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 2 });

        const [r1, r2] = await Promise.all([checkout.iniciarCheckout(c.sesion), checkout.iniciarCheckout(c.sesion)]);
        assert.equal(r1.pedido_venta_id, r2.pedido_venta_id);
        assert.equal([r1.reutilizado, r2.reutilizado].filter(Boolean).length, 1);
        assert.equal(await prisma.pedidoVenta.count({ where: { cliente_id: c.clienteId } }), 1);
        assert.equal(await stockShowroom(a.varianteId), 3);
      },
    );

    await t.test(
      "Concurrencia D10 — doble clic simultáneo con OTRO pedido vigente previo: ambos devuelven el pedido de ESTE carrito (caso 2), sin duplicar",
      async () => {
        const previo = await crearArticulo({ stockShowroom: 5 });
        const actual = await crearArticulo({ stockShowroom: 5 });
        const c = await crearCuenta();
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: previo.varianteId, cantidad: 1 });
        const pedidoPrevio = await checkout.iniciarCheckout(c.sesion);

        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: actual.varianteId, cantidad: 1 });
        const [r1, r2] = await Promise.all([checkout.iniciarCheckout(c.sesion), checkout.iniciarCheckout(c.sesion)]);

        assert.equal(r1.pedido_venta_id, r2.pedido_venta_id, "un solo pedido para el carrito");
        assert.notEqual(r1.pedido_venta_id, pedidoPrevio.pedido_venta_id, "nunca el pedido previo de la cuenta");
        assert.equal([r1.reutilizado, r2.reutilizado].filter(Boolean).length, 1);
        assert.equal(await prisma.pedidoVenta.count({ where: { cliente_id: c.clienteId } }), 2);
        assert.equal(await stockShowroom(actual.varianteId), 4, "reservó una sola vez");
      },
    );

    // ── CA6 ─────────────────────────────────────────────────────────────────
    await t.test(
      "CA6 — un visitante sin cuenta arma un carrito (token, sin PII); una cuenta con vinculación pendiente no puede iniciar checkout",
      async () => {
        const a = await crearArticulo({ stockShowroom: 5 });
        const agregado = await carrito.agregarAlCarrito({ carritoToken: null }, { variante_sku_id: a.varianteId, cantidad: 2 });
        assert.match(agregado.token_nuevo ?? "", /^[0-9a-f]{48}$/);
        const fila = await prisma.carritoWeb.findUniqueOrThrow({ where: { id: agregado.carrito.carrito_id! } });
        assert.equal(fila.cuenta_cliente_web_id, null);
        assert.equal(fila.carrito_token, agregado.token_nuevo);

        const recuperado = await carrito.obtenerCarrito({ carritoToken: agregado.token_nuevo });
        assert.equal(recuperado.items[0].cantidad, 2);
        // Agregar de nuevo suma sobre el mismo carrito (no crea otro).
        const otra = await carrito.agregarAlCarrito({ carritoToken: agregado.token_nuevo }, { variante_sku_id: a.varianteId, cantidad: 1 });
        assert.equal(otra.token_nuevo, null);
        assert.equal(otra.carrito.items[0].cantidad, 3);

        const pendiente = await crearCuenta(true);
        await assert.rejects(() => checkout.iniciarCheckout(pendiente.sesion), conCodigo("CUENTA_VINCULACION_PENDIENTE"));
      },
    );

    // ── CA7 ─────────────────────────────────────────────────────────────────
    await t.test(
      "CA7 — fusión del carrito de visitante del seed con el de Carlos: CT2 repetido suma (1+1), CT3 se agrega, el visitante queda de baja",
      async () => {
        // Re-afirma los fixtures del seed (una corrida anterior pudo consumirlos).
        await prisma.carritoWeb.updateMany({
          where: { cuenta_cliente_web_id: CUENTA_WEB_CARLOS_RUIZ_ID, id: { not: CARRITO_WEB_CARLOS_RUIZ_ID }, is_active: true },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "RESET_TEST_HU_E1" },
        });
        const activo = { is_active: true, deleted_at: null, deleted_by: null, deletion_reason: null };
        await prisma.carritoWeb.update({ where: { id: CARRITO_WEB_CARLOS_RUIZ_ID }, data: { ...activo, carrito_token: null } });
        await prisma.carritoWeb.update({
          where: { id: CARRITO_WEB_VISITANTE_ID },
          data: { ...activo, carrito_token: CARRITO_VISITANTE_TOKEN_SEED, cuenta_cliente_web_id: null },
        });
        const fixture = [
          [CARRITO_ITEM_CARLOS_CT2_ID, 1],
          [CARRITO_ITEM_CARLOS_INACTIVA_ID, 1],
          [CARRITO_ITEM_VISITANTE_CT3_ID, 2],
          [CARRITO_ITEM_VISITANTE_CT2_ID, 1],
        ] as const;
        await prisma.carritoWebItem.updateMany({
          where: {
            carrito_id: { in: [CARRITO_WEB_CARLOS_RUIZ_ID, CARRITO_WEB_VISITANTE_ID] },
            id: { notIn: fixture.map(([id]) => id) },
          },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "RESET_TEST_HU_E1" },
        });
        for (const [id, cantidad] of fixture) {
          await prisma.carritoWebItem.update({ where: { id }, data: { ...activo, cantidad } });
        }

        const fusion = await carrito.fusionarCarritoVisitante(CARRITO_VISITANTE_TOKEN_SEED, CUENTA_WEB_CARLOS_RUIZ_ID);
        assert.deepEqual(fusion, {
          carrito_origen_id: CARRITO_WEB_VISITANTE_ID,
          carrito_destino_id: CARRITO_WEB_CARLOS_RUIZ_ID,
          items_fusionados: 2,
        });

        // "Otro dispositivo": cualquier request con la sesión de la cuenta ve el mismo carrito.
        const vista = await carrito.obtenerCarrito({ cuentaId: CUENTA_WEB_CARLOS_RUIZ_ID });
        assert.equal(vista.carrito_id, CARRITO_WEB_CARLOS_RUIZ_ID);
        const cantidades = Object.fromEntries(vista.items.map((i) => [i.variante_sku_id, i.cantidad]));
        assert.deepEqual(cantidades, {
          [VARIANTE_CAMISA_TACTICA_2_ID]: 2,
          [VARIANTE_CAMISA_TACTICA_INACTIVA_ID]: 1,
          [VARIANTE_CAMISA_TACTICA_3_ID]: 2,
        });

        const visitante = await prisma.carritoWeb.findUniqueOrThrow({ where: { id: CARRITO_WEB_VISITANTE_ID } });
        assert.equal(visitante.is_active, false);
        assert.equal(visitante.carrito_token, null);
        assert.equal(visitante.deletion_reason, "FUSIONADO");
        assert.equal(visitante.deleted_by, CUENTA_WEB_CARLOS_RUIZ_ID);
        const itemsVisitante = await prisma.carritoWebItem.findMany({ where: { carrito_id: CARRITO_WEB_VISITANTE_ID } });
        assert.ok(itemsVisitante.every((i) => !i.is_active && i.deletion_reason === "FUSIONADO_EN_CARRITO_DE_CUENTA"));

        // Idempotente: el mismo token ya no fusiona nada.
        assert.equal(await carrito.fusionarCarritoVisitante(CARRITO_VISITANTE_TOKEN_SEED, CUENTA_WEB_CARLOS_RUIZ_ID), null);

        const auditoria = await esperar(
          () => prisma.auditLog.findMany({ where: { tabla_afectada: "carritos_web", registro_id: CARRITO_WEB_VISITANTE_ID, accion: "CARRITO_FUSIONADO" } }),
          (filas) => filas.length > 0,
        );
        assert.ok(auditoria.length >= 1);
      },
    );

    await t.test("CA7 — fusión con un SKU que la cuenta había quitado: se reactiva el ítem (no se duplica la fila)", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const c = await crearCuenta();
      const cuenta = await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      await carrito.quitarDelCarrito({ cuentaId: c.cuentaId }, cuenta.carrito.items[0].item_id);
      const visitante = await carrito.agregarAlCarrito({ carritoToken: null }, { variante_sku_id: a.varianteId, cantidad: 3 });

      await carrito.fusionarCarritoVisitante(visitante.token_nuevo!, c.cuentaId);
      const filas = await prisma.carritoWebItem.findMany({ where: { carrito_id: cuenta.carrito.carrito_id!, variante_sku_id: a.varianteId } });
      assert.equal(filas.length, 1);
      assert.equal(filas[0].is_active, true);
      assert.equal(filas[0].cantidad, 3);
    });

    // ── Regla N.° 1 sobre el carrito ────────────────────────────────────────
    await t.test("quitar un ítem es baja lógica (la fila sigue existiendo con motivo y autor)", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const c = await crearCuenta();
      const r = await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      const itemId = r.carrito.items[0].item_id;
      await carrito.quitarDelCarrito({ cuentaId: c.cuentaId }, itemId);
      const fila = await prisma.carritoWebItem.findUniqueOrThrow({ where: { id: itemId } });
      assert.equal(fila.is_active, false);
      assert.equal(fila.deleted_by, c.cuentaId);
      assert.equal(fila.deletion_reason, "QUITADO_POR_CLIENTE");
      // Un ítem ajeno da 404.
      const otra = await crearCuenta();
      await assert.rejects(() => carrito.quitarDelCarrito({ cuentaId: otra.cuentaId }, itemId), conCodigo("ITEM_CARRITO_NO_ENCONTRADO"));
    });
  },
);
