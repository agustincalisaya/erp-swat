import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-E5 — Nivel 2: integración de servicios contra una base REAL descartable
 * (mismo patrón que `hu-e1.integration.test.ts`). `skip` sin
 * `HU_E5_INTEGRATION_DATABASE_URL`; imports dinámicos (`server-only`).
 *
 *   HU_E5_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e5
 *
 * Cada escenario crea sus propios artículos y cuentas (`hu-e1.test-fixtures.ts`).
 * Excepciones deliberadas: la Gorra Táctica del seed (fixture de HU-E5) se
 * re-afirma oculta al empezar y se deja oculta al terminar, y la clave
 * `ECOMMERCE_CARRITO_ABANDONADO_DIAS` se restaura a 7. Nunca se borra nada.
 */

const DATABASE_URL = process.env.HU_E5_INTEGRATION_DATABASE_URL;

// IDs fijos de prisma/seed.ts.
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";
const CONTENIDO_WEB_GORRA_TACTICA_ID = "a8ba9e46-5aa0-4224-8cde-b6faa676126f";
const CLAVE_PLAZO = "ECOMMERCE_CARRITO_ABANDONADO_DIAS";
const DIA_MS = 86_400_000;

test(
  "HU-E5 — visibilidad web, baja lógica, aviso a carritos y carritos abandonados contra una base real",
  { skip: !DATABASE_URL, timeout: 300_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MP_MODO = "simulado";
    process.env.APP_PUBLIC_URL ??= "http://localhost:3000";

    const [
      { prisma },
      visibilidad,
      catalogo,
      carrito,
      checkout,
      abandonados,
      mantenimiento,
      cupones,
      reservaSvc,
      { domainEventBus },
      { ServiceError },
      { iniciarAuditLogListener },
      { iniciarNotificacionListener },
      { verificarCadenaIntegridad },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./visibilidad-web.service.ts"),
      import("./catalogo-web.service.ts"),
      import("./carrito.service.ts"),
      import("./checkout.service.ts"),
      import("./carrito-abandonado.service.ts"),
      import("./mantenimiento-programado.ts"),
      import("./cupon.service.ts"),
      import("../inventario/reserva.service.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../../events/listeners/notificacion.listener.ts"),
      import("../auditoria/audit-log.service.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);
    t.after(async () => prisma.$disconnect());

    // Evidencia de aislamiento: nunca correr contra una base que no sea de test.
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e5] current_database() = ${db}`);

    iniciarAuditLogListener();
    iniciarNotificacionListener();

    // ── Captura de eventos emitidos ─────────────────────────────────────────
    type Evento = { nombre: string; payload: Record<string, unknown> };
    const eventos: Evento[] = [];
    for (const nombre of [
      "ecommerce:visibilidad_web_cambiada",
      "ecommerce:contenido_web_baja",
      "ecommerce:carrito_articulo_no_disponible",
    ] as const) {
      domainEventBus.on(nombre, (payload) => void eventos.push({ nombre, payload: payload as unknown as Record<string, unknown> }));
    }
    const eventosDe = (nombre: string, filtro: (p: Record<string, unknown>) => boolean) =>
      eventos.filter((e) => e.nombre === nombre && filtro(e.payload));

    const conCodigo = (codigo: string) => (err: unknown) => err instanceof ServiceError && err.code === codigo;
    async function esperar<T>(leer: () => Promise<T>, listo: (v: T) => boolean): Promise<T> {
      let valor = await leer();
      for (let intento = 0; intento < 60 && !listo(valor); intento++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        valor = await leer();
      }
      return valor;
    }
    const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const crearArticulo = (opciones: Parameters<typeof fixtures.crearArticulo>[1]) => fixtures.crearArticulo(prisma, opciones);
    const crearCuenta = () => fixtures.crearCuenta(prisma);
    const ADMIN = USUARIO_ADMIN_ECOMMERCE_SEED_ID;
    const ocultar = (id: string, motivo?: string) =>
      visibilidad.cambiarVisibilidadWeb(id, { visibilidad_web: false, ...(motivo ? { motivo } : {}) }, ADMIN);
    const mostrar = (id: string) => visibilidad.cambiarVisibilidadWeb(id, { visibilidad_web: true }, ADMIN);

    /** Estado de Módulo A de un artículo, para comparar antes/después. */
    async function snapshotModuloA(a: { varianteId: string; productoMaestroId: string }) {
      return {
        variante: await prisma.varianteSKU.findUniqueOrThrow({ where: { id: a.varianteId } }),
        producto: await prisma.productoMaestro.findUniqueOrThrow({ where: { id: a.productoMaestroId } }),
        stock: await prisma.stockDeposito.findMany({ where: { variante_sku_id: a.varianteId }, orderBy: { deposito_id: "asc" } }),
      };
    }

    // ── Criterios 1 y 2 ─────────────────────────────────────────────────────
    await t.test("CA1/CA2 — ocultar en la tienda no lee ni escribe Módulo A: SKU, producto y stock quedan idénticos", async () => {
      const a = await crearArticulo({ stockShowroom: 6 });
      const antes = await snapshotModuloA(a);
      const r = await ocultar(a.productoWebId, "Fin de temporada");
      assert.deepEqual(r, { producto_web_id: a.productoWebId, visibilidad_web: false });

      const contenido = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(contenido.visibilidad_web, false);
      assert.equal(contenido.is_active, true, "ocultar NO es baja lógica");
      assert.equal(contenido.deleted_at, null);
      assert.equal(contenido.deletion_reason, null);
      assert.deepEqual(await snapshotModuloA(a), antes, "VarianteSKU, ProductoMaestro y StockDeposito idénticos");
      assert.equal(antes.variante.is_active, true, "activo en inventario y no visible en la tienda");
    });

    await t.test("CA2 inverso — SKU inactivo en inventario con visibilidad_web = true: la bandera web es independiente", async () => {
      const a = await crearArticulo({ stockShowroom: 3, visible: false });
      await prisma.varianteSKU.update({
        where: { id: a.varianteId },
        data: { is_active: false, deleted_at: new Date(), deletion_reason: "test HU-E5 CA2 inverso" },
      });
      const antes = await snapshotModuloA(a);
      await mostrar(a.productoWebId);
      const contenido = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(contenido.visibilidad_web, true, "visible en la tienda aunque el SKU esté inactivo");
      assert.deepEqual(await snapshotModuloA(a), antes, "mostrar no reactiva el SKU");
      // El resultado al cliente sigue respetando Módulo A (spec §2.5): no comprable.
      const vista = (await catalogo.resolverVariantesWeb([a.varianteId])).get(a.varianteId);
      assert.equal(vista?.comprable, false);
      assert.equal(vista?.motivo, "SKU_INACTIVO");
    });

    // ── Gorra Táctica del seed ──────────────────────────────────────────────
    await t.test("Gorra Táctica (seed): mostrarla la lista y la vuelve comprable; ocultarla la saca y su detalle da 404", async () => {
      // Re-afirma el fixture del seed (oculta y activa), como hace E1 con los suyos.
      await prisma.productoWebContenido.update({
        where: { id: CONTENIDO_WEB_GORRA_TACTICA_ID },
        data: { visibilidad_web: false, is_active: true, deleted_at: null, deleted_by: null, deletion_reason: null },
      });
      const buscar = async () =>
        (await catalogo.listarCatalogo({ q: "Gorra Táctica Operativa", page: 1, page_size: 48 })).items.find(
          (i) => i.producto_web_id === CONTENIDO_WEB_GORRA_TACTICA_ID,
        );
      assert.equal(await buscar(), undefined, "oculta: no se lista");
      await assert.rejects(() => catalogo.obtenerDetalleProductoWeb(CONTENIDO_WEB_GORRA_TACTICA_ID), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));

      await mostrar(CONTENIDO_WEB_GORRA_TACTICA_ID);
      assert.ok(await buscar(), "visible: aparece en el listado");
      const detalle = await catalogo.obtenerDetalleProductoWeb(CONTENIDO_WEB_GORRA_TACTICA_ID);
      assert.equal(detalle.comprable, true);

      await ocultar(CONTENIDO_WEB_GORRA_TACTICA_ID, "Vuelve a quedar oculta (fixture HU-E5)");
      assert.equal(await buscar(), undefined);
      await assert.rejects(() => catalogo.obtenerDetalleProductoWeb(CONTENIDO_WEB_GORRA_TACTICA_ID), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
    });

    // ── D2: idempotencia ────────────────────────────────────────────────────
    await t.test("D2 — pedir el valor actual: 200 con el estado, sin UPDATE, sin evento y sin notificaciones", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const c = await crearCuenta();
      await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      const delContenido = (p: Record<string, unknown>) => p.producto_web_id === a.productoWebId;
      const delArticulo = (p: Record<string, unknown>) => p.variante_sku_id === a.varianteId;

      const inicial = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.deepEqual(await mostrar(a.productoWebId), { producto_web_id: a.productoWebId, visibilidad_web: true });
      const sinCambio = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(sinCambio.updated_at.getTime(), inicial.updated_at.getTime(), "sin UPDATE");
      assert.equal(eventosDe("ecommerce:visibilidad_web_cambiada", delContenido).length, 0);

      await ocultar(a.productoWebId);
      assert.equal(eventosDe("ecommerce:visibilidad_web_cambiada", delContenido).length, 1);
      assert.equal(eventosDe("ecommerce:carrito_articulo_no_disponible", delArticulo).length, 1);
      const oculto = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });

      assert.deepEqual(await ocultar(a.productoWebId, "otra vez"), { producto_web_id: a.productoWebId, visibilidad_web: false });
      const repetido = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(repetido.updated_at.getTime(), oculto.updated_at.getTime(), "sin UPDATE");
      assert.equal(eventosDe("ecommerce:visibilidad_web_cambiada", delContenido).length, 1, "sin evento");
      assert.equal(eventosDe("ecommerce:carrito_articulo_no_disponible", delArticulo).length, 1, "sin notificaciones nuevas");
    });

    await t.test("D2 — dos pedidos concurrentes de ocultar el mismo contenido emiten un único evento", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const r = await Promise.all([ocultar(a.productoWebId), ocultar(a.productoWebId)]);
      assert.ok(r.every((x) => x.visibilidad_web === false));
      assert.equal(eventosDe("ecommerce:visibilidad_web_cambiada", (p) => p.producto_web_id === a.productoWebId).length, 1);
    });

    // ── Criterio 3: baja lógica ─────────────────────────────────────────────
    await t.test("CA3 — baja lógica: is_active, deleted_at, deleted_by, deletion_reason y visibilidad false; el registro sigue", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const conteo = () => prisma.productoWebContenido.count({ where: { id: a.productoWebId } });
      const totalAntes = await prisma.productoWebContenido.count();
      assert.equal(await conteo(), 1);
      const antesA = await snapshotModuloA(a);

      const r = await visibilidad.darDeBajaContenidoWeb(a.productoWebId, { deletion_reason: "Discontinuado en la web" }, ADMIN);
      assert.equal(r.producto_web_id, a.productoWebId);
      assert.equal(r.is_active, false);
      assert.ok(r.deleted_at instanceof Date);

      const fila = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(fila.is_active, false);
      assert.equal(fila.deleted_at?.getTime(), r.deleted_at.getTime());
      assert.equal(fila.deleted_by, ADMIN);
      assert.equal(fila.deletion_reason, "Discontinuado en la web");
      assert.equal(fila.visibilidad_web, false);
      assert.equal(await conteo(), 1, "nunca DELETE físico");
      assert.equal(await prisma.productoWebContenido.count(), totalAntes);
      assert.deepEqual(await snapshotModuloA(a), antesA, "la baja web no toca Módulo A");

      // D3: dado de baja no es operable.
      await assert.rejects(
        () => visibilidad.darDeBajaContenidoWeb(a.productoWebId, { deletion_reason: "otra vez" }, ADMIN),
        conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"),
      );
      await assert.rejects(() => mostrar(a.productoWebId), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
      await assert.rejects(() => catalogo.obtenerDetalleProductoWeb(a.productoWebId), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
      assert.equal(eventosDe("ecommerce:contenido_web_baja", (p) => p.producto_web_id === a.productoWebId).length, 1);
      const listado = await visibilidad.listarContenidoWebAdmin({ page: 1, page_size: 100 });
      assert.equal(listado.items.some((i) => i.producto_web_id === a.productoWebId), false, "no aparece en el backoffice");
    });

    await t.test("D3 — un id inexistente da 404 en ambas operaciones", async () => {
      const inexistente = "00000000-0000-4000-8000-000000000000";
      await assert.rejects(() => ocultar(inexistente), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
      await assert.rejects(
        () => visibilidad.darDeBajaContenidoWeb(inexistente, { deletion_reason: "x" }, ADMIN),
        conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"),
      );
    });

    await t.test("listado de backoffice: activos, ordenados por título, con producto, visibilidad y fotos activas", async () => {
      const a = await crearArticulo({ stockShowroom: 1, visible: false });
      const activos = await prisma.productoWebContenido.count({ where: { is_active: true, deleted_at: null } });
      const filas: Awaited<ReturnType<typeof visibilidad.listarContenidoWebAdmin>>["items"] = [];
      for (let page = 1; ; page++) {
        const pagina = await visibilidad.listarContenidoWebAdmin({ page, page_size: 500 });
        assert.equal(pagina.page_size, 100, "page_size acotado a 100");
        assert.equal(pagina.total, activos);
        filas.push(...pagina.items);
        if (pagina.items.length < pagina.page_size) break;
      }
      assert.equal(filas.length, activos, "la paginación recorre todos los activos sin repetir");
      assert.equal(new Set(filas.map((f) => f.producto_web_id)).size, activos);
      // Orden por título con la collation de Postgres (no la de JS).
      const esperado = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM contenidos_producto_web WHERE is_active AND deleted_at IS NULL ORDER BY titulo_comercial, id`;
      assert.deepEqual(filas.map((f) => f.producto_web_id), esperado.map((e) => e.id), "ordenados por título");
      const fila = filas.find((i) => i.producto_web_id === a.productoWebId);
      assert.ok(fila, "el artículo nuevo aparece en el listado");
      assert.equal(fila.visibilidad_web, false);
      assert.equal(fila.fotos_activas, 1);
      assert.equal(fila.producto_activo, true);
      assert.equal(fila.producto_maestro_id, a.productoMaestroId);
    });

    // ── Criterio 4: aviso proactivo + bloqueo de checkout (contrato con E1) ─
    await t.test(
      "CA4 — ocultar con ítems en carritos: evento VISIBILIDAD_WEB por ítem, notificación al cliente (no al visitante) y el checkout se bloquea identificando el ítem",
      async () => {
        const a = await crearArticulo({ stockShowroom: 5 });
        const otro = await crearArticulo({ stockShowroom: 5 });
        const c = await crearCuenta();
        const deCuenta = await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
        await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: otro.varianteId, cantidad: 1 });
        const deVisitante = await carrito.agregarAlCarrito({ carritoToken: null }, { variante_sku_id: a.varianteId, cantidad: 2 });
        const itemCuenta = deCuenta.carrito.items.find((i) => i.variante_sku_id === a.varianteId)!.item_id;
        const itemVisitante = deVisitante.carrito.items[0].item_id;

        await ocultar(a.productoWebId, "Sin stock de temporada");

        const avisos = eventosDe("ecommerce:carrito_articulo_no_disponible", (p) => p.variante_sku_id === a.varianteId);
        assert.equal(avisos.length, 2, "uno por ítem afectado");
        const porItem = new Map(avisos.map((e) => [e.payload.carrito_item_id, e.payload]));
        assert.deepEqual(porItem.get(itemCuenta), {
          carrito_id: deCuenta.carrito.carrito_id,
          carrito_item_id: itemCuenta,
          variante_sku_id: a.varianteId,
          sku: a.sku,
          motivo: "NO_VISIBLE_WEB",
          cliente_web_cuenta_id: c.cuentaId,
          origen: "VISIBILIDAD_WEB",
        });
        assert.equal(porItem.get(itemVisitante)?.cliente_web_cuenta_id, null, "D8: el visitante también emite (sin destinatario)");
        assert.equal(
          eventosDe("ecommerce:carrito_articulo_no_disponible", (p) => p.variante_sku_id === otro.varianteId).length,
          0,
          "el otro artículo del carrito no se avisa",
        );

        // F3: notificación ADVERTENCIA en la bandeja del cliente; ninguna para el visitante.
        const delSku = () =>
          prisma.notificacion.findMany({
            where: { tipo_evento: "ecommerce:carrito_articulo_no_disponible", cuerpo: { contains: a.sku } },
          });
        const notificaciones = await esperar(delSku, (filas) => filas.length > 0);
        await pausa(300);
        assert.equal((await delSku()).length, 1, "una sola notificación: la del cliente con cuenta");
        assert.equal(notificaciones[0].cuenta_cliente_web_destinatario_id, c.cuentaId);
        assert.equal(notificaciones[0].prioridad, "ADVERTENCIA");

        // El flujo de HU-E1 reacciona al toggle: 422 identificando el ítem.
        await assert.rejects(
          () => checkout.iniciarCheckout(c.sesion),
          (err: unknown) => {
            assert.ok(err instanceof ServiceError);
            assert.equal(err.code, "ARTICULO_NO_DISPONIBLE");
            const items = (err.details as { items: { item_id: string; variante_sku_id: string; sku: string; motivo: string }[] }).items;
            assert.deepEqual(items.map((i) => [i.item_id, i.variante_sku_id, i.sku, i.motivo]), [
              [itemCuenta, a.varianteId, a.sku, "NO_VISIBLE_WEB"],
            ]);
            return true;
          },
        );
        // D7: el checkout bloqueado reutiliza la clave `carrito_item_id`: no notifica de nuevo.
        await pausa(300);
        assert.equal((await delSku()).length, 1, "D7: una notificación por ítem");

        // D6/D13: etiquetas de auditoría por origen.
        const asientos = await esperar(
          () => prisma.auditLog.findMany({ where: { tabla_afectada: "items_carrito_web", registro_id: { in: [itemCuenta, itemVisitante] } } }),
          (filas) => filas.length >= 3,
        );
        const acciones = asientos.map((x) => `${x.registro_id === itemCuenta ? "cuenta" : "visitante"}:${x.accion}`).sort();
        assert.deepEqual(acciones, [
          "cuenta:ARTICULO_NO_DISPONIBLE_VISIBILIDAD_WEB",
          "cuenta:CHECKOUT_BLOQUEADO",
          "visitante:ARTICULO_NO_DISPONIBLE_VISIBILIDAD_WEB",
        ]);
        const proactivo = asientos.find((x) => x.registro_id === itemCuenta && x.accion === "ARTICULO_NO_DISPONIBLE_VISIBILIDAD_WEB")!;
        assert.equal((proactivo.valor_nuevo as { origen?: string }).origen, "VISIBILIDAD_WEB");
        const bloqueo = asientos.find((x) => x.accion === "CHECKOUT_BLOQUEADO")!;
        assert.equal("origen" in (bloqueo.valor_nuevo as object), false, "el asiento de E1 no cambia");
      },
    );

    await t.test("CA4 — mostrar no avisa; dar de baja un contenido visible con ítems en carritos sí avisa", async () => {
      const a = await crearArticulo({ stockShowroom: 5, visible: false });
      const c = await crearCuenta();
      await mostrar(a.productoWebId);
      assert.equal(eventosDe("ecommerce:carrito_articulo_no_disponible", (p) => p.variante_sku_id === a.varianteId).length, 0);
      await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      await visibilidad.darDeBajaContenidoWeb(a.productoWebId, { deletion_reason: "Retirado del catálogo web" }, ADMIN);
      const avisos = eventosDe("ecommerce:carrito_articulo_no_disponible", (p) => p.variante_sku_id === a.varianteId);
      assert.equal(avisos.length, 1);
      assert.equal(avisos[0].payload.origen, "VISIBILIDAD_WEB");
      await assert.rejects(() => checkout.iniciarCheckout(c.sesion), conCodigo("ARTICULO_NO_DISPONIBLE"));
    });

    // ── Robustez post-commit ────────────────────────────────────────────────
    await t.test("un listener que lanza de forma síncrona no convierte en error una operación ya confirmada", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const b = await crearArticulo({ stockShowroom: 5 });
      const c = await crearCuenta();
      await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      const explota = () => {
        throw new Error("listener roto");
      };
      const errores: unknown[][] = [];
      const errorOriginal = console.error;
      console.error = (...args: unknown[]) => void errores.push(args);
      domainEventBus.on("ecommerce:visibilidad_web_cambiada", explota);
      domainEventBus.on("ecommerce:contenido_web_baja", explota);
      domainEventBus.on("ecommerce:carrito_articulo_no_disponible", explota);
      try {
        assert.deepEqual(await ocultar(a.productoWebId), { producto_web_id: a.productoWebId, visibilidad_web: false });
        const baja = await visibilidad.darDeBajaContenidoWeb(b.productoWebId, { deletion_reason: "Prueba de robustez" }, ADMIN);
        assert.equal(baja.is_active, false);
      } finally {
        domainEventBus.off("ecommerce:visibilidad_web_cambiada", explota);
        domainEventBus.off("ecommerce:contenido_web_baja", explota);
        domainEventBus.off("ecommerce:carrito_articulo_no_disponible", explota);
        console.error = errorOriginal;
      }
      assert.equal((await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } })).visibilidad_web, false);
      assert.equal((await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: b.productoWebId } })).is_active, false);
      assert.equal(errores.length, 3, "se loguea cada publicación fallida (cambio, aviso al carrito y baja)");
      const salida = JSON.stringify(errores);
      assert.equal(salida.includes("listener roto"), false, "el log no incluye el mensaje del error");
    });

    // ── Auditoría ───────────────────────────────────────────────────────────
    await t.test("auditoría — asientos con el actor de la sesión, acción = evento y estado antes/después", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      await ocultar(a.productoWebId, "Motivo auditado");
      await visibilidad.darDeBajaContenidoWeb(a.productoWebId, { deletion_reason: "Baja auditada" }, ADMIN);
      const asientos = await esperar(
        () => prisma.auditLog.findMany({ where: { tabla_afectada: "contenidos_producto_web", registro_id: a.productoWebId }, orderBy: { created_at: "asc" } }),
        (filas) => filas.length >= 2,
      );
      assert.deepEqual(asientos.map((x) => [x.accion, x.usuario_id]), [
        ["ecommerce:visibilidad_web_cambiada", ADMIN],
        ["ecommerce:contenido_web_baja", ADMIN],
      ]);
      assert.deepEqual(asientos[0].valor_anterior, { visibilidad_web: true });
      assert.deepEqual(asientos[0].valor_nuevo, { visibilidad_web: false, motivo: "Motivo auditado", producto_maestro_id: a.productoMaestroId });
      assert.equal((asientos[1].valor_nuevo as { deletion_reason: string }).deletion_reason, "Baja auditada");
    });

    // ── Criterio 5: carritos abandonados ────────────────────────────────────
    const envejecer = async (carritoId: string, dias: number) => {
      const fecha = new Date(Date.now() - dias * DIA_MS);
      await prisma.carritoWeb.update({ where: { id: carritoId }, data: { updated_at: fecha } });
      const leida = await prisma.carritoWeb.findUniqueOrThrow({ where: { id: carritoId } });
      assert.equal(leida.updated_at.getTime(), fecha.getTime(), "el carrito quedó envejecido");
    };

    await t.test(
      "CA5 — vía ejecutarMantenimientoProgramado: carrito viejo de baja lógica (ABANDONADO, registro e ítems intactos), reciente intacto, la cuenta arma uno nuevo; reservas y cupones siguen funcionando",
      async () => {
        const plazo = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: CLAVE_PLAZO } });
        assert.equal(plazo.valor, "7", "sembrada con el default de D4");
        assert.equal(plazo.modulo, "E");

        const a = await crearArticulo({ stockShowroom: 10 });
        const viejaCuenta = await crearCuenta();
        const recienteCuenta = await crearCuenta();
        const vieja = await carrito.agregarAlCarrito({ cuentaId: viejaCuenta.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
        const reciente = await carrito.agregarAlCarrito({ cuentaId: recienteCuenta.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
        const visitante = await carrito.agregarAlCarrito({ carritoToken: null }, { variante_sku_id: a.varianteId, cantidad: 1 });
        const viejaId = vieja.carrito.carrito_id!;
        const recienteId = reciente.carrito.carrito_id!;
        const visitanteId = visitante.carrito.carrito_id!;
        await envejecer(viejaId, 8);
        await envejecer(visitanteId, 8);
        await envejecer(recienteId, 6);

        // Reserva vencida para comprobar que la tarea de reservas sigue liberando.
        const conReserva = await crearCuenta();
        await carrito.agregarAlCarrito({ cuentaId: conReserva.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
        const pedido = await checkout.iniciarCheckout(conReserva.sesion);
        const [{ reserva }] = await prisma.pedidoVentaItem.findMany({ where: { pedido_venta_id: pedido.pedido_venta_id }, select: { reserva: true } });
        await prisma.reserva.update({ where: { id: reserva!.id }, data: { fecha_expiracion: new Date(Date.now() - 60_000) } });

        const totalCarritos = await prisma.carritoWeb.count();
        const totalItems = await prisma.carritoWebItem.count();
        const itemsViejaAntes = await prisma.carritoWebItem.findMany({ where: { carrito_id: viejaId }, orderBy: { id: "asc" } });

        const ahora = new Date();
        const resultado = await mantenimiento.ejecutarMantenimientoProgramado(ahora);
        assert.equal(resultado.reservas.ok, true);
        assert.ok(resultado.reservas.ok && resultado.reservas.valor.liberadas.some((l) => l.reserva_id === reserva!.id), "reservas: liberó la vencida");
        assert.equal(resultado.cupones.ok, true, "cupones: corrió sin error");
        assert.equal(resultado.carritos.ok, true);
        assert.ok(resultado.carritos.ok);
        const ids = resultado.carritos.valor.carrito_ids;
        assert.ok(ids.includes(viejaId) && ids.includes(visitanteId), "viejos de baja");
        assert.equal(ids.includes(recienteId), false, "reciente intacto");
        assert.equal(resultado.carritos.valor.total_desactivados, ids.length);

        const filaVieja = await prisma.carritoWeb.findUniqueOrThrow({ where: { id: viejaId } });
        assert.equal(filaVieja.is_active, false);
        assert.equal(filaVieja.deleted_at?.getTime(), ahora.getTime());
        assert.equal(filaVieja.deleted_by, null, "actor del sistema");
        assert.equal(filaVieja.deletion_reason, abandonados.MOTIVO_CARRITO_ABANDONADO);
        assert.equal(filaVieja.deletion_reason, "ABANDONADO");
        assert.equal((await prisma.carritoWeb.findUniqueOrThrow({ where: { id: recienteId } })).is_active, true);
        assert.equal(await prisma.carritoWeb.count(), totalCarritos, "ningún carrito se borró");
        assert.equal(await prisma.carritoWebItem.count(), totalItems, "ningún ítem se borró");
        assert.deepEqual(
          await prisma.carritoWebItem.findMany({ where: { carrito_id: viejaId }, orderBy: { id: "asc" } }),
          itemsViejaAntes,
          "los ítems no se tocan",
        );
        // D5: no es un evento auditable.
        assert.equal(await prisma.auditLog.count({ where: { tabla_afectada: "carritos_web", registro_id: viejaId } }), 0);

        // Índice parcial: la cuenta con el carrito abandonado arma uno nuevo.
        const nuevo = await carrito.agregarAlCarrito({ cuentaId: viejaCuenta.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 2 });
        assert.notEqual(nuevo.carrito.carrito_id, viejaId);
        assert.equal(nuevo.carrito.items[0].cantidad, 2, "arranca vacío: no hereda el abandonado");
        assert.equal(await prisma.carritoWeb.count({ where: { cuenta_cliente_web_id: viejaCuenta.cuentaId } }), 2);

        // Una segunda pasada no vuelve a tocar los ya desactivados.
        const segunda = await abandonados.desactivarCarritosAbandonados(new Date());
        assert.equal(segunda.carrito_ids.includes(viejaId), false);
        assert.equal((await prisma.carritoWeb.findUniqueOrThrow({ where: { id: viejaId } })).deleted_at?.getTime(), ahora.getTime());
      },
    );

    await t.test(
      "D18 — un visitante con la cookie de un carrito abandonado sigue usando la tienda: GET vacío y agregar crea un carrito nuevo",
      async () => {
        const a = await crearArticulo({ stockShowroom: 5 });
        const inicial = await carrito.agregarAlCarrito({ carritoToken: null }, { variante_sku_id: a.varianteId, cantidad: 1 });
        const token = inicial.token_nuevo!;
        const viejoId = inicial.carrito.carrito_id!;
        await envejecer(viejoId, 30);
        const r = await abandonados.desactivarCarritosAbandonados(new Date());
        assert.ok(r.carrito_ids.includes(viejoId));
        assert.equal((await prisma.carritoWeb.findUniqueOrThrow({ where: { id: viejoId } })).carrito_token, token, "el inactivo conserva el token");

        const vista = await carrito.obtenerCarrito({ carritoToken: token });
        assert.equal(vista.carrito_id, null);
        assert.equal(vista.items.length, 0);

        const otra = await carrito.agregarAlCarrito({ carritoToken: token }, { variante_sku_id: a.varianteId, cantidad: 1 });
        assert.ok(otra.token_nuevo, "se emite un token nuevo para la cookie");
        assert.notEqual(otra.token_nuevo, token);
        assert.notEqual(otra.carrito.carrito_id, viejoId);
        assert.equal(otra.carrito.items.length, 1);
      },
    );

    await t.test("D4 — el plazo se lee de ConfiguracionSistema (no está hardcodeado)", async () => {
      const a = await crearArticulo({ stockShowroom: 5 });
      const c = await crearCuenta();
      const r = await carrito.agregarAlCarrito({ cuentaId: c.cuentaId }, { variante_sku_id: a.varianteId, cantidad: 1 });
      const id = r.carrito.carrito_id!;
      await envejecer(id, 8);
      await prisma.configuracionSistema.update({ where: { clave: CLAVE_PLAZO }, data: { valor: "30" } });
      try {
        const con30 = await abandonados.desactivarCarritosAbandonados(new Date());
        assert.equal(con30.carrito_ids.includes(id), false, "con 30 días, 8 días no es abandono");
        await prisma.configuracionSistema.update({ where: { clave: CLAVE_PLAZO }, data: { valor: "cero" } });
        await assert.rejects(() => abandonados.desactivarCarritosAbandonados(new Date()), conCodigo("CONFIGURACION_INVALIDA"));
      } finally {
        await prisma.configuracionSistema.update({ where: { clave: CLAVE_PLAZO }, data: { valor: "7" } });
      }
      const con7 = await abandonados.desactivarCarritosAbandonados(new Date());
      assert.ok(con7.carrito_ids.includes(id), "con 7 días, 8 días sí es abandono");
    });

    await t.test("D10/D14 — aislamiento del coordinador: el fallo de carritos no impide reservas y cupones, y viceversa", async () => {
      const errores: unknown[][] = [];
      const errorOriginal = console.error;
      console.error = (...args: unknown[]) => void errores.push(args);
      try {
        let reservasCorrieron = false;
        let cuponesCorrieron = false;
        const fallaCarritos = await mantenimiento.ejecutarMantenimientoProgramado(new Date(), {
          liberarReservasVencidas: async (ahora) => {
            reservasCorrieron = true;
            return reservaSvc.liberarReservasVencidas(ahora);
          },
          ejecutarMantenimientoCupones: async () => {
            cuponesCorrieron = true;
            return cupones.ejecutarMantenimientoCupones();
          },
          desactivarCarritosAbandonados: async () => {
            throw new Error("falla simulada de carritos");
          },
        });
        assert.equal(fallaCarritos.reservas.ok, true);
        assert.equal(fallaCarritos.cupones.ok, true);
        assert.equal(fallaCarritos.carritos.ok, false);
        assert.ok(reservasCorrieron && cuponesCorrieron);
        assert.equal(errores.length, 1, "el error de carritos se loguea");

        let carritosCorrieron = false;
        const fallanOtras = await mantenimiento.ejecutarMantenimientoProgramado(new Date(), {
          liberarReservasVencidas: async () => {
            throw new Error("falla simulada de Módulo A");
          },
          ejecutarMantenimientoCupones: async () => {
            throw new Error("falla simulada de cupones");
          },
          desactivarCarritosAbandonados: async (ahora) => {
            carritosCorrieron = true;
            return abandonados.desactivarCarritosAbandonados(ahora);
          },
        });
        assert.equal(fallanOtras.reservas.ok, false);
        assert.equal(fallanOtras.cupones.ok, false);
        assert.equal(fallanOtras.carritos.ok, true);
        assert.equal(carritosCorrieron, true);
        assert.equal(errores.length, 3);
      } finally {
        console.error = errorOriginal;
      }
    });

    // ── Cierre: Gorra oculta, cadena íntegra ────────────────────────────────
    await t.test("la cadena SHA-256 del ledger sigue íntegra", async () => {
      const gorra = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: CONTENIDO_WEB_GORRA_TACTICA_ID } });
      assert.equal(gorra.visibilidad_web, false, "el fixture del seed queda oculto");
      assert.equal(gorra.is_active, true);
      let anterior = -1;
      for (let intento = 0; intento < 60; intento++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) break;
        anterior = actual;
        await pausa(250);
      }
      const resultado = await verificarCadenaIntegridad();
      assert.equal(resultado.integra, true, JSON.stringify(resultado));
    });
  },
);
