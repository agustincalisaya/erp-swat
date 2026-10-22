import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-E16 — Nivel 2: integración de servicios contra una base REAL descartable
 * (spec_modulo_E.md §6.2; docs/modulos/modulo E/HU16_TASKS.md T03). Molde de
 * `hu-e5.integration.test.ts`: `skip` sin `HU_E16_INTEGRATION_DATABASE_URL`,
 * imports dinámicos (`server-only`), listener de auditoría real.
 *
 *   HU_E16_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e16
 *
 * Cada escenario crea sus propios artículos (`hu-e1.test-fixtures.ts`). El
 * contenido sembrado para E16-5 se lee y se deja oculto. Nunca se borra nada.
 */

const DATABASE_URL = process.env.HU_E16_INTEGRATION_DATABASE_URL;

// IDs fijos de prisma/seed.ts.
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";
const CONTENIDO_WEB_E16_SIN_FOTO_ID = "4f151400-53c6-4e19-9f0c-53bf8a2c6438";
const EVENTO_RECHAZO = "ecommerce:publicacion_web_rechazada";

test(
  "HU-E16 — publicación de contenido completo contra una base real",
  { skip: !DATABASE_URL, timeout: 300_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      visibilidad,
      fotos,
      catalogo,
      { bloquearContenidoActivo },
      { domainEventBus, listenersRegistrados },
      { confirmacionesPublicacionWeb },
      { ServiceError },
      { iniciarAuditLogListener },
      { verificarCadenaIntegridad },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./visibilidad-web.service.ts"),
      import("./foto-web.service.ts"),
      import("./catalogo-web.service.ts"),
      import("./contenido-web-lock.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../events/publicacion-web-confirmacion.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../auditoria/audit-log.service.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);
    t.after(async () => prisma.$disconnect());

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e16] current_database() = ${db}`);

    await listenersRegistrados;
    iniciarAuditLogListener(); // idempotente para este evento (marca Symbol)
    assert.equal(domainEventBus.listenerCount(EVENTO_RECHAZO), 1, "un solo handler de auditoría del rechazo");

    // ── Captura de eventos ──────────────────────────────────────────────────
    type Evento = { nombre: string; payload: Record<string, unknown> };
    const eventos: Evento[] = [];
    for (const nombre of [
      "ecommerce:visibilidad_web_cambiada",
      "ecommerce:carrito_articulo_no_disponible",
      EVENTO_RECHAZO,
    ] as const) {
      domainEventBus.on(nombre, (payload) => void eventos.push({ nombre, payload: payload as unknown as Record<string, unknown> }));
    }
    const eventosDe = (nombre: string, productoWebId: string) =>
      eventos.filter((e) => e.nombre === nombre && e.payload.producto_web_id === productoWebId);

    const ADMIN = USUARIO_ADMIN_ECOMMERCE_SEED_ID;
    const mostrar = (id: string) => visibilidad.cambiarVisibilidadWeb(id, { visibilidad_web: true }, ADMIN);
    const ocultar = (id: string) => visibilidad.cambiarVisibilidadWeb(id, { visibilidad_web: false }, ADMIN);
    const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const conCodigo = (codigo: string) => (err: unknown) => err instanceof ServiceError && err.code === codigo;
    const noPublicable = (faltantes: string[]) => (err: unknown) => {
      assert.ok(err instanceof ServiceError, String(err));
      assert.equal(err.code, "CONTENIDO_NO_PUBLICABLE");
      assert.deepEqual(err.details, { faltantes });
      return true;
    };

    /** Artículo de E1 (con foto y descripción) con categoría única para buscarlo en la tienda. */
    async function crearArticulo(opciones: { visible?: boolean; descripcion?: string; sinFotos?: boolean } = {}) {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 5, visible: opciones.visible ?? false });
      const categoria = `Test HU-E16 ${a.productoWebId.slice(0, 8)}`;
      await prisma.productoMaestro.update({ where: { id: a.productoMaestroId }, data: { categoria } });
      if (opciones.descripcion !== undefined) {
        await prisma.productoWebContenido.update({ where: { id: a.productoWebId }, data: { descripcion: opciones.descripcion } });
      }
      const foto = await prisma.productoWebFoto.findFirstOrThrow({ where: { producto_web_contenido_id: a.productoWebId } });
      if (opciones.sinFotos) await bajaFoto(a.productoWebId, foto.id);
      return { ...a, categoria, fotoId: foto.id };
    }
    const bajaFoto = (productoWebId: string, fotoId: string) => fotos.darDeBajaFoto(productoWebId, fotoId, "Baja test HU-E16", ADMIN);
    const leerContenido = (id: string) => prisma.productoWebContenido.findUniqueOrThrow({ where: { id } });
    const asientosRechazo = (id: string) =>
      prisma.auditLog.findMany({
        where: { accion: EVENTO_RECHAZO, registro_id: id },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
      });
    const filaAdmin = async (id: string) => {
      for (let page = 1; ; page++) {
        const pagina = await visibilidad.listarContenidoWebAdmin({ page, page_size: 100 });
        const fila = pagina.items.find((f) => f.producto_web_id === id);
        if (fila) return fila;
        if (page * pagina.page_size >= pagina.total) return undefined;
      }
    };
    const enTienda = async (a: { productoWebId: string; categoria: string }) => {
      const listado = await catalogo.listarCatalogo({ categoria: a.categoria, page: 1, page_size: 12 });
      return listado.items.some((i) => i.producto_web_id === a.productoWebId);
    };

    /** Reemplaza temporalmente los handlers del evento de rechazo (fallo/timeout/sin listener). */
    async function conHandlersDeRechazo(handlers: ((p: { intento_id: string }) => void)[], cuerpo: () => Promise<void>) {
      const originales = domainEventBus.listeners(EVENTO_RECHAZO) as ((p: unknown) => void)[];
      domainEventBus.removeAllListeners(EVENTO_RECHAZO);
      for (const h of handlers) domainEventBus.on(EVENTO_RECHAZO, h);
      try {
        await cuerpo();
      } finally {
        domainEventBus.removeAllListeners(EVENTO_RECHAZO);
        for (const h of originales) domainEventBus.on(EVENTO_RECHAZO, h);
      }
    }

    /** E16-1: el rechazo no muta el contenido ni emite cambios de visibilidad. */
    async function assertSinMutacion(id: string, antes: { visibilidad_web: boolean; updated_at: Date }) {
      const despues = await leerContenido(id);
      assert.equal(despues.visibilidad_web, antes.visibilidad_web);
      assert.equal(despues.updated_at.getTime(), antes.updated_at.getTime(), "sin UPDATE: updated_at intacto");
      assert.equal(eventosDe("ecommerce:visibilidad_web_cambiada", id).length, 0);
    }

    // ── E16-1: faltantes individuales y combinados, mutación nula ─────────────
    await t.test("E16-1 — sin foto activa: 422 ['foto'], sin UPDATE ni evento de visibilidad", async () => {
      const a = await crearArticulo({ sinFotos: true });
      const antes = await leerContenido(a.productoWebId);
      await assert.rejects(mostrar(a.productoWebId), noPublicable(["foto"]));
      await assertSinMutacion(a.productoWebId, antes);
    });

    await t.test("E16-1 — descripción vacía y de solo espacios: 422 ['descripcion']", async () => {
      for (const descripcion of ["", "   \n "]) {
        const a = await crearArticulo({ descripcion });
        const antes = await leerContenido(a.productoWebId);
        await assert.rejects(mostrar(a.productoWebId), noPublicable(["descripcion"]));
        await assertSinMutacion(a.productoWebId, antes);
      }
    });

    await t.test("E16-1 — faltan ambas: 422 ['descripcion', 'foto'] en orden canónico", async () => {
      const a = await crearArticulo({ descripcion: " ", sinFotos: true });
      const antes = await leerContenido(a.productoWebId);
      await assert.rejects(mostrar(a.productoWebId), noPublicable(["descripcion", "foto"]));
      await assertSinMutacion(a.productoWebId, antes);
    });

    // ── E16-4: un asiento por cada 422, incluso repetido ──────────────────────
    await t.test("E16-4 — tres rechazos del mismo contenido: tres asientos ya persistidos al recibir cada 422, sin descripción ni URLs", async () => {
      const a = await crearArticulo({ sinFotos: true });
      for (let i = 1; i <= 3; i++) {
        await assert.rejects(mostrar(a.productoWebId), noPublicable(["foto"]));
        // Sin polling: el 422 llega recién después de que D.3 confirmó la persistencia.
        assert.equal((await asientosRechazo(a.productoWebId)).length, i);
      }
      const asientos = await asientosRechazo(a.productoWebId);
      const emitidos = eventosDe(EVENTO_RECHAZO, a.productoWebId);
      assert.equal(emitidos.length, 3);
      const ids = asientos.map((x) => (x.valor_nuevo as { intento_id: string }).intento_id);
      assert.equal(new Set(ids).size, 3, "intento_id único por rechazo");
      assert.deepEqual(new Set(ids), new Set(emitidos.map((e) => e.payload.intento_id)));
      for (const x of asientos) {
        assert.equal(x.usuario_id, ADMIN);
        assert.equal(x.tabla_afectada, "contenidos_producto_web");
        assert.equal(x.ip, "internal-event");
        assert.equal(x.valor_anterior, null);
        assert.deepEqual(Object.keys(x.valor_nuevo as object).sort(), ["faltantes", "intento_id", "timestamp"]);
        assert.deepEqual((x.valor_nuevo as { faltantes: string[] }).faltantes, ["foto"]);
        const texto = JSON.stringify(x);
        assert.equal(texto.includes("Fixture de test"), false, "sin descripción");
        assert.equal(texto.includes("placehold.co"), false, "sin URLs de fotos");
      }
      for (const e of emitidos) {
        assert.deepEqual(Object.keys(e.payload).sort(), ["actor_id", "faltantes", "intento_id", "producto_web_id", "timestamp"]);
      }
      assert.equal((await leerContenido(a.productoWebId)).visibilidad_web, false);
    });

    // ── E16-4: fallo, timeout y ausencia del listener → 503 sin cambio ────────
    await t.test("E16-4 — D.3 no confirma (falla): 503 AUDITORIA_NO_DISPONIBLE, visibilidad intacta y sin asiento", async () => {
      const a = await crearArticulo({ sinFotos: true });
      const antes = await leerContenido(a.productoWebId);
      await conHandlersDeRechazo([(p) => confirmacionesPublicacionWeb.confirmar(p.intento_id, false)], async () => {
        await assert.rejects(mostrar(a.productoWebId), conCodigo("AUDITORIA_NO_DISPONIBLE"));
      });
      await assertSinMutacion(a.productoWebId, antes);
      assert.equal((await asientosRechazo(a.productoWebId)).length, 0);
      assert.equal(confirmacionesPublicacionWeb.cantidadPendiente, 0);
    });

    await t.test("E16-4 — timeout del listener: 503, visibilidad intacta y espera limpia", async () => {
      const a = await crearArticulo({ sinFotos: true });
      const antes = await leerContenido(a.productoWebId);
      const plazoOriginal = confirmacionesPublicacionWeb.plazoMs;
      confirmacionesPublicacionWeb.plazoMs = 200;
      try {
        await conHandlersDeRechazo([() => {}], async () => {
          const inicio = Date.now();
          await assert.rejects(mostrar(a.productoWebId), conCodigo("AUDITORIA_NO_DISPONIBLE"));
          assert.ok(Date.now() - inicio >= 150, "esperó el plazo antes de responder");
        });
      } finally {
        confirmacionesPublicacionWeb.plazoMs = plazoOriginal;
      }
      await assertSinMutacion(a.productoWebId, antes);
      assert.equal((await asientosRechazo(a.productoWebId)).length, 0);
      assert.equal(confirmacionesPublicacionWeb.cantidadPendiente, 0);
    });

    await t.test("E16-4 — sin listener: 503 inmediato y sin cambio", async () => {
      const a = await crearArticulo({ sinFotos: true });
      const antes = await leerContenido(a.productoWebId);
      await conHandlersDeRechazo([], async () => {
        await assert.rejects(mostrar(a.productoWebId), conCodigo("AUDITORIA_NO_DISPONIBLE"));
      });
      await assertSinMutacion(a.productoWebId, antes);
      assert.equal(confirmacionesPublicacionWeb.cantidadPendiente, 0);
    });

    // ── Concurrencia: carrera con la baja de la última foto ───────────────────
    /** Abre una transacción que toma el lock del contenido y lo retiene hasta `liberar()`. */
    function retenerLock(productoWebId: string, dentro: (tx: Parameters<typeof bloquearContenidoActivo>[0]) => Promise<void> = async () => {}) {
      let liberar!: () => void;
      let tomado!: () => void;
      const liberado = new Promise<void>((r) => { liberar = r; });
      const lockTomado = new Promise<void>((r) => { tomado = r; });
      const tx = prisma.$transaction(async (tx) => {
        await bloquearContenidoActivo(tx, productoWebId);
        await dentro(tx);
        tomado();
        await liberado;
      }, { timeout: 20_000 });
      return { lockTomado, liberar, tx };
    }
    const pendiente = async (p: Promise<unknown>) => {
      const marca = Symbol("pendiente");
      return (await Promise.race([p.then(() => "ok", () => "error"), pausa(400).then(() => marca)])) === marca;
    };

    await t.test("Concurrencia — mostrar espera el lock de la baja de la última foto y revalida: 422 ['foto']", async () => {
      const a = await crearArticulo();
      const lock = retenerLock(a.productoWebId, async (tx) => {
        await tx.productoWebFoto.update({
          where: { id: a.fotoId },
          data: { is_active: false, deleted_at: new Date(), deleted_by: ADMIN, deletion_reason: "Baja concurrente test HU-E16" },
        });
      });
      await lock.lockTomado;
      const intento = mostrar(a.productoWebId);
      intento.catch(() => {});
      assert.equal(await pendiente(intento), true, "cambiarVisibilidadWeb queda bloqueado por el lock compartido");
      lock.liberar();
      await lock.tx;
      await assert.rejects(intento, noPublicable(["foto"]));
      assert.equal((await leerContenido(a.productoWebId)).visibilidad_web, false, "nunca queda visible por una lectura vieja");
    });

    await t.test("Concurrencia — orden por lock: mostrar antes que la baja → visible; baja antes que mostrar → 422", async () => {
      // mostrar adquiere el lock primero: la baja posterior deja visible sin foto (E16-3).
      const a = await crearArticulo();
      const l1 = retenerLock(a.productoWebId);
      await l1.lockTomado;
      const m1 = mostrar(a.productoWebId);
      await pausa(200);
      const b1 = bajaFoto(a.productoWebId, a.fotoId);
      await pausa(200);
      l1.liberar();
      await l1.tx;
      assert.deepEqual(await m1, { producto_web_id: a.productoWebId, visibilidad_web: true });
      await b1;
      assert.equal((await leerContenido(a.productoWebId)).visibilidad_web, true);

      // la baja adquiere el lock primero: mostrar revalida y rechaza.
      const b = await crearArticulo();
      const l2 = retenerLock(b.productoWebId);
      await l2.lockTomado;
      const b2 = bajaFoto(b.productoWebId, b.fotoId);
      await pausa(200);
      const m2 = mostrar(b.productoWebId);
      m2.catch(() => {});
      await pausa(200);
      l2.liberar();
      await l2.tx;
      await b2;
      await assert.rejects(m2, noPublicable(["foto"]));
      assert.equal((await leerContenido(b.productoWebId)).visibilidad_web, false);
    });

    await t.test("Concurrencia — la baja de foto espera al lock que toma cambiarVisibilidadWeb (helper compartido)", async () => {
      const a = await crearArticulo({ visible: true });
      const lock = retenerLock(a.productoWebId);
      await lock.lockTomado;
      const baja = bajaFoto(a.productoWebId, a.fotoId);
      baja.catch(() => {});
      assert.equal(await pendiente(baja), true, "darDeBajaFoto usa el mismo SELECT … FOR UPDATE");
      lock.liberar();
      await lock.tx;
      await baja;
    });

    // ── E16-3: visible que pierde la última foto ──────────────────────────────
    await t.test("E16-3 — visible que pierde la última foto: sigue visible, la tienda lo excluye, el admin lo marca No publicable", async () => {
      const a = await crearArticulo({ visible: true });
      assert.equal(await enTienda(a), true, "publicado antes de la baja");
      assert.deepEqual((await filaAdmin(a.productoWebId))?.faltantes, []);

      await bajaFoto(a.productoWebId, a.fotoId);
      assert.equal((await leerContenido(a.productoWebId)).visibilidad_web, true, "visibilidad_web conserva su valor");
      assert.equal(await enTienda(a), false, "el catálogo público lo excluye (regla HU-E11)");
      await assert.rejects(catalogo.obtenerDetalleProductoWeb(a.productoWebId), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));

      const fila = await filaAdmin(a.productoWebId);
      assert.ok(fila, "el listado administrativo no lo filtra por publicabilidad");
      assert.equal(fila.visibilidad_web, true);
      assert.equal(fila.publicable, false);
      assert.deepEqual(fila.faltantes, ["foto"]);
      assert.equal(fila.fotos_activas, 0);

      // Pedir "visible" otra vez es el no-op E5: 200 sin UPDATE ni evento ni asiento de rechazo.
      const antes = await leerContenido(a.productoWebId);
      assert.deepEqual(await mostrar(a.productoWebId), { producto_web_id: a.productoWebId, visibilidad_web: true });
      assert.equal((await leerContenido(a.productoWebId)).updated_at.getTime(), antes.updated_at.getTime());
      assert.equal(eventosDe(EVENTO_RECHAZO, a.productoWebId).length, 0);
      assert.equal((await asientosRechazo(a.productoWebId)).length, 0);

      // Ocultar sigue habilitado (contrato E5) y volver a mostrar se rechaza.
      assert.deepEqual(await ocultar(a.productoWebId), { producto_web_id: a.productoWebId, visibilidad_web: false });
      assert.equal(eventosDe("ecommerce:visibilidad_web_cambiada", a.productoWebId).length, 1);
      await assert.rejects(mostrar(a.productoWebId), noPublicable(["foto"]));
      assert.equal((await leerContenido(a.productoWebId)).visibilidad_web, false);
    });

    // ── E5 intacto ────────────────────────────────────────────────────────────
    await t.test("E5 — mostrar publicable, ocultar no publicable, no-op oculto y 404 conservan su contrato", async () => {
      const a = await crearArticulo();
      assert.deepEqual(await mostrar(a.productoWebId), { producto_web_id: a.productoWebId, visibilidad_web: true });
      const cambios = eventosDe("ecommerce:visibilidad_web_cambiada", a.productoWebId);
      assert.equal(cambios.length, 1);
      assert.equal(cambios[0].payload.visibilidad_nueva, true);

      const b = await crearArticulo({ visible: true, descripcion: "" });
      assert.deepEqual(await ocultar(b.productoWebId), { producto_web_id: b.productoWebId, visibilidad_web: false });
      const antes = await leerContenido(b.productoWebId);
      assert.deepEqual(await ocultar(b.productoWebId), { producto_web_id: b.productoWebId, visibilidad_web: false });
      assert.equal((await leerContenido(b.productoWebId)).updated_at.getTime(), antes.updated_at.getTime(), "no-op sin UPDATE");
      assert.equal(eventosDe("ecommerce:visibilidad_web_cambiada", b.productoWebId).length, 1);
      assert.equal(eventosDe(EVENTO_RECHAZO, b.productoWebId).length, 0);

      await visibilidad.darDeBajaContenidoWeb(a.productoWebId, { deletion_reason: "Baja test HU-E16" }, ADMIN);
      await assert.rejects(mostrar(a.productoWebId), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
      await assert.rejects(ocultar(a.productoWebId), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
      await assert.rejects(mostrar("00000000-0000-4000-8000-000000000000"), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
    });

    // ── E16-2: listado administrativo ─────────────────────────────────────────
    await t.test("E16-2 — listado: publicable/faltantes calculados en servidor, sin filtrar ni exponer la descripción", async () => {
      const completo = await crearArticulo();
      const incompleto = await crearArticulo({ descripcion: "", sinFotos: true });
      const f1 = await filaAdmin(completo.productoWebId);
      const f2 = await filaAdmin(incompleto.productoWebId);
      assert.ok(f1 && f2);
      assert.equal(f1.publicable, true);
      assert.deepEqual(f1.faltantes, []);
      assert.equal(f2.publicable, false);
      assert.deepEqual(f2.faltantes, ["descripcion", "foto"]);
      assert.equal("descripcion" in f1, false, "la fila no agrega la descripción");
    });

    // ── E16-5: seed ───────────────────────────────────────────────────────────
    await t.test("E16-5 — contenido sembrado con descripción y sin foto: oculto, No publicable y rechazado", async () => {
      const sembrado = await prisma.productoWebContenido.findUnique({
        where: { id: CONTENIDO_WEB_E16_SIN_FOTO_ID },
        include: { fotos: { where: { is_active: true, deleted_at: null } } },
      });
      assert.ok(sembrado, "falta correr el seed con el bloque HU-E16");
      assert.equal(sembrado.visibilidad_web, false);
      assert.ok(sembrado.descripcion.trim().length > 0);
      assert.equal(sembrado.fotos.length, 0);
      const fila = await filaAdmin(CONTENIDO_WEB_E16_SIN_FOTO_ID);
      assert.equal(fila?.publicable, false);
      assert.deepEqual(fila?.faltantes, ["foto"]);
      await assert.rejects(mostrar(CONTENIDO_WEB_E16_SIN_FOTO_ID), noPublicable(["foto"]));
      assert.equal((await leerContenido(CONTENIDO_WEB_E16_SIN_FOTO_ID)).visibilidad_web, false);
    });

    // ── Cadena de auditoría ───────────────────────────────────────────────────
    await t.test("auditoría — la cadena SHA-256 sigue íntegra", async () => {
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
