import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { imagenMinima, jpgDeTamano, textoComoImagen } from "./hu-e11.test-fixtures.ts";

/**
 * HU-E11 — Nivel 2: contenido comercial, fotos, publicación y listado del
 * catálogo contra una base REAL descartable (task_relos.md §6.2). `skip` sin
 * `HU_E11_INTEGRATION_DATABASE_URL`.
 *
 *   docker exec swat_erp_postgres psql -U erpswat -d postgres \
 *     -c "CREATE DATABASE swat_erp_test_e11 TEMPLATE template0"
 *   DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
 *   HU_E11_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e11
 *
 * Fotos: un Gateway EN MEMORIA inyectado (imágenes mínimas válidas generadas
 * en el test); el Adapter de disco se prueba aparte con un directorio
 * temporal FUERA del repo. Escrituras directas deliberadas (fixtures): los
 * Productos Maestros, variantes, precios y stock (Módulo A/B no tienen alta
 * de contenido web), y un contenido con `descripcion` vacía para CA5 (el
 * schema no permite crearlo por servicio, D18). Nunca se borra nada.
 */

const DATABASE_URL = process.env.HU_E11_INTEGRATION_DATABASE_URL;
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";

test(
  "HU-E11 — contenido comercial, fotos, publicación y listado del catálogo contra una base real",
  { skip: !DATABASE_URL, timeout: 600_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      contenidoSvc,
      fotoSvc,
      catalogo,
      visibilidad,
      configuracion,
      { domainEventBus, listenersRegistrados },
      { ServiceError },
      { verificarCadenaIntegridad },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./contenido-web.service.ts"),
      import("./foto-web.service.ts"),
      import("./catalogo-web.service.ts"),
      import("./visibilidad-web.service.ts"),
      import("../sistema/configuracion.service.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../errors/service-error.ts"),
      import("../auditoria/audit-log.service.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);
    t.after(async () => {
      await esperarLedgerQuieto();
      await prisma.$disconnect();
    });

    // Evidencia de aislamiento: nunca correr contra una base que no sea de test.
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e11] current_database() = ${db}`);

    await listenersRegistrados;
    const ADMIN = USUARIO_ADMIN_ECOMMERCE_SEED_ID;

    // ── Eventos emitidos ─────────────────────────────────────────────────────
    type Evento = { nombre: string; payload: Record<string, unknown> };
    const eventos: Evento[] = [];
    for (const nombre of [
      "ecommerce:contenido_web_creado",
      "ecommerce:contenido_web_editado",
      "ecommerce:foto_web_subida",
      "ecommerce:foto_web_principal_cambiada",
      "ecommerce:foto_web_baja",
    ] as const) {
      domainEventBus.on(nombre, (payload) => void eventos.push({ nombre, payload: payload as unknown as Record<string, unknown> }));
    }
    const eventosDe = (nombre: string, registro: string) =>
      eventos.filter((e) => e.nombre === nombre && (e.payload.producto_web_id === registro || e.payload.foto_id === registro));

    // ── Gateway en memoria ───────────────────────────────────────────────────
    const guardadas = new Map<string, Uint8Array>();
    const memoria = {
      guardarImagen: async ({ contenido, formato }: { contenido: Uint8Array; formato: "JPG" | "PNG" | "WEBP" }) => {
        const nombre = `${randomUUID()}.${formato === "JPG" ? "jpg" : formato.toLowerCase()}`;
        guardadas.set(nombre, contenido);
        return { nombre, url: `/api/tienda/fotos/${nombre}` };
      },
      leerImagen: async () => null,
    };

    // ── Helpers ──────────────────────────────────────────────────────────────
    const conCodigo = (codigo: string) => (err: unknown) => {
      assert.ok(err instanceof ServiceError, String(err));
      assert.equal(err.code, codigo);
      return true;
    };
    const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    async function esperarLedgerQuieto() {
      let anterior = -1;
      for (let intento = 0; intento < 60; intento++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) return;
        anterior = actual;
        await pausa(250);
      }
    }
    const sufijo = () => randomUUID().slice(0, 8).toUpperCase();

    async function crearMaestro(activo = true) {
      const s = sufijo();
      return prisma.productoMaestro.create({
        data: {
          codigo_producto: "E11TEST",
          nombre: `Producto HU-E11 ${s}`,
          rubro: "Indumentaria",
          categoria: `Test HU-E11 ${s}`,
          unidad_medida: "UNIDAD",
          costo_estandar_referencia: 1000,
          is_active: activo,
          ...(activo ? {} : { deleted_at: new Date(), deletion_reason: "Fixture inactivo" }),
        },
      });
    }

    type VarianteFixture = { talle: string; color: string; genero: string; modelo: string; precio: number | null; stock?: number };
    /** Producto Maestro + variantes con precio/stock propios + contenido web (fixture directo). */
    async function crearProductoWeb(opciones: {
      categoria: string;
      titulo: string;
      variantes: VarianteFixture[];
      visible?: boolean;
      conFoto?: boolean;
      descripcion?: string;
      creadoEn?: Date;
    }) {
      const s = sufijo();
      const producto = await prisma.productoMaestro.create({
        data: {
          codigo_producto: "E11TEST",
          nombre: `${opciones.titulo} ${s}`,
          rubro: "Indumentaria",
          categoria: opciones.categoria,
          unidad_medida: "UNIDAD",
          costo_estandar_referencia: 1000,
        },
      });
      const variantes = [];
      for (const [i, v] of opciones.variantes.entries()) {
        const variante = await prisma.varianteSKU.create({
          data: {
            producto_maestro_id: producto.id,
            proveedor_id: fixtures.PROVEEDOR_HOMOLOGADO_ID,
            sku: `E11TEST-${s}-${i}`,
            talle: v.talle,
            color: v.color,
            genero: v.genero,
            modelo: v.modelo,
          },
        });
        if (v.precio !== null) {
          await prisma.listaPrecioVentaItem.create({
            data: { version_id: fixtures.LISTA_PRECIO_VENTA_VERSION_1_ID, variante_sku_id: variante.id, precio_venta: v.precio },
          });
        }
        await prisma.stockDeposito.create({
          data: { variante_sku_id: variante.id, deposito_id: fixtures.DEPOSITO_SHOWROOM_ID, cantidad: v.stock ?? 3 },
        });
        variantes.push(variante);
      }
      const contenido = await prisma.productoWebContenido.create({
        data: {
          producto_maestro_id: producto.id,
          titulo_comercial: opciones.titulo,
          descripcion: opciones.descripcion ?? `Descripción de ${opciones.titulo}`,
          visibilidad_web: opciones.visible ?? true,
          ...(opciones.creadoEn ? { created_at: opciones.creadoEn } : {}),
          ...(opciones.conFoto === false
            ? {}
            : { fotos: { create: { url: `/api/tienda/fotos/${randomUUID()}.jpg`, es_principal: true } } }),
        },
      });
      return { productoMaestroId: producto.id, productoWebId: contenido.id, variantes };
    }

    /** Contenido creado POR SERVICIO para un Producto Maestro nuevo, con una variante con precio y stock. */
    async function contenidoPorServicio() {
      const maestro = await crearMaestro();
      const variante = await prisma.varianteSKU.create({
        data: {
          producto_maestro_id: maestro.id,
          proveedor_id: fixtures.PROVEEDOR_HOMOLOGADO_ID,
          sku: `E11SVC-${sufijo()}`,
          talle: "M",
          color: "Negro",
          genero: "UNISEX",
          modelo: "Servicio",
        },
      });
      await prisma.listaPrecioVentaItem.create({
        data: { version_id: fixtures.LISTA_PRECIO_VENTA_VERSION_1_ID, variante_sku_id: variante.id, precio_venta: 15000 },
      });
      await prisma.stockDeposito.create({ data: { variante_sku_id: variante.id, deposito_id: fixtures.DEPOSITO_SHOWROOM_ID, cantidad: 4 } });
      const alta = await contenidoSvc.crearContenidoWeb(
        { producto_maestro_id: maestro.id, titulo_comercial: `Contenido HU-E11 ${sufijo()}`, descripcion: "Descripción comercial" },
        ADMIN,
      );
      return { ...alta, varianteId: variante.id };
    }

    const subir = (productoWebId: string, bytes: Uint8Array, esPrincipal = false) =>
      fotoSvc.subirFotoProducto(productoWebId, bytes, esPrincipal, ADMIN, memoria);
    const fotosActivas = (productoWebId: string) =>
      prisma.productoWebFoto.findMany({
        where: { producto_web_contenido_id: productoWebId, is_active: true, deleted_at: null },
        orderBy: { orden: "asc" },
      });

    // ── CA1 — contenido ──────────────────────────────────────────────────────
    await t.test("CA1 — alta: nace oculto, 201 contractual, evento y sin copia de talle/color/género/modelo", async () => {
      const maestro = await crearMaestro();
      const alta = await contenidoSvc.crearContenidoWeb(
        { producto_maestro_id: maestro.id, titulo_comercial: "Campera HU-E11", descripcion: "Campera softshell" },
        ADMIN,
      );
      assert.deepEqual(Object.keys(alta).sort(), ["producto_maestro_id", "producto_web_id", "visibilidad_web"]);
      assert.equal(alta.visibilidad_web, false);
      const fila = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: alta.producto_web_id } });
      assert.equal(fila.visibilidad_web, false);
      assert.equal(fila.is_active, true);
      for (const campo of ["talle", "color", "genero", "modelo"]) assert.equal(campo in fila, false, campo);
      assert.equal(eventosDe("ecommerce:contenido_web_creado", alta.producto_web_id).length, 1);
    });

    await t.test("CA1 — alta: 409 si ya hay contenido activo y también si está dado de baja (sin reactivar)", async () => {
      const { producto_web_id, producto_maestro_id } = await contenidoPorServicio();
      const repetir = () =>
        contenidoSvc.crearContenidoWeb({ producto_maestro_id, titulo_comercial: "Otro", descripcion: "Otra" }, ADMIN);
      await assert.rejects(repetir, conCodigo("CONTENIDO_WEB_EXISTENTE"));
      await visibilidad.darDeBajaContenidoWeb(producto_web_id, { deletion_reason: "Baja de prueba E11" }, ADMIN);
      await assert.rejects(repetir, conCodigo("CONTENIDO_WEB_EXISTENTE"));
      assert.equal(await prisma.productoWebContenido.count({ where: { producto_maestro_id } }), 1);
      const fila = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: producto_web_id } });
      assert.equal(fila.is_active, false, "no se reactivó");
    });

    await t.test("CA1 — alta: dos altas concurrentes del mismo producto → una 201 y una 409", async () => {
      const maestro = await crearMaestro();
      const resultados = await Promise.allSettled(
        [1, 2].map((i) =>
          contenidoSvc.crearContenidoWeb({ producto_maestro_id: maestro.id, titulo_comercial: `C${i}`, descripcion: "D" }, ADMIN),
        ),
      );
      assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
      const rechazo = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.equal((rechazo.reason as InstanceType<typeof ServiceError>).code, "CONTENIDO_WEB_EXISTENTE");
    });

    await t.test("CA1 — alta: Producto Maestro inexistente o inactivo → PRODUCTO_MAESTRO_NO_ENCONTRADO", async () => {
      await assert.rejects(
        () => contenidoSvc.crearContenidoWeb({ producto_maestro_id: randomUUID(), titulo_comercial: "X", descripcion: "Y" }, ADMIN),
        conCodigo("PRODUCTO_MAESTRO_NO_ENCONTRADO"),
      );
      const inactivo = await crearMaestro(false);
      await assert.rejects(
        () => contenidoSvc.crearContenidoWeb({ producto_maestro_id: inactivo.id, titulo_comercial: "X", descripcion: "Y" }, ADMIN),
        conCodigo("PRODUCTO_MAESTRO_NO_ENCONTRADO"),
      );
      assert.equal(await prisma.productoWebContenido.count({ where: { producto_maestro_id: inactivo.id } }), 0);
    });

    await t.test("CA1 — edición: solo título/descripción; no-op sin evento; dado de baja → 404", async () => {
      const { producto_web_id } = await contenidoPorServicio();
      const { titulo_comercial: tituloOriginal } = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: producto_web_id } });
      const editado = await contenidoSvc.editarContenidoWeb(producto_web_id, { titulo_comercial: "Título nuevo" }, ADMIN);
      assert.deepEqual(editado, {
        producto_web_id,
        titulo_comercial: "Título nuevo",
        descripcion: "Descripción comercial",
        visibilidad_web: false,
      });
      const evento = eventosDe("ecommerce:contenido_web_editado", producto_web_id);
      assert.equal(evento.length, 1);
      assert.deepEqual(evento[0].payload.antes, { titulo_comercial: tituloOriginal });
      assert.deepEqual(evento[0].payload.despues, { titulo_comercial: "Título nuevo" });

      const antes = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: producto_web_id } });
      const noop = await contenidoSvc.editarContenidoWeb(producto_web_id, { titulo_comercial: "Título nuevo", descripcion: "Descripción comercial" }, ADMIN);
      assert.equal(noop.titulo_comercial, "Título nuevo");
      const despues = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: producto_web_id } });
      assert.equal(despues.updated_at.getTime(), antes.updated_at.getTime(), "un no-op no hace UPDATE");
      assert.equal(eventosDe("ecommerce:contenido_web_editado", producto_web_id).length, 1, "un no-op no emite");

      await contenidoSvc.editarContenidoWeb(producto_web_id, { descripcion: "Descripción 2" }, ADMIN);
      assert.equal((await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: producto_web_id } })).visibilidad_web, false);

      await visibilidad.darDeBajaContenidoWeb(producto_web_id, { deletion_reason: "Baja E11" }, ADMIN);
      await assert.rejects(
        () => contenidoSvc.editarContenidoWeb(producto_web_id, { titulo_comercial: "X" }, ADMIN),
        conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"),
      );
      await assert.rejects(
        () => contenidoSvc.editarContenidoWeb(randomUUID(), { titulo_comercial: "X" }, ADMIN),
        conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"),
      );
    });

    await t.test("CA1 — productos sin contenido: excluye los que tienen contenido (activo o de baja) y los inactivos", async () => {
      const libre = await crearMaestro();
      const inactivo = await crearMaestro(false);
      const conBaja = await contenidoPorServicio();
      await visibilidad.darDeBajaContenidoWeb(conBaja.producto_web_id, { deletion_reason: "Baja" }, ADMIN);
      const ids = new Set((await contenidoSvc.listarProductosSinContenido()).map((p) => p.producto_maestro_id));
      assert.equal(ids.has(libre.id), true);
      assert.equal(ids.has(inactivo.id), false);
      assert.equal(ids.has(conBaja.producto_maestro_id), false);
    });

    // ── CA2 / CA7 — fotos ────────────────────────────────────────────────────
    await t.test("CA2 — subida válida de JPG, PNG y WebP; la primera queda principal; orden incremental", async () => {
      const { producto_web_id } = await contenidoPorServicio();
      const jpg = await subir(producto_web_id, imagenMinima("JPG"));
      const png = await subir(producto_web_id, imagenMinima("PNG"));
      const webp = await subir(producto_web_id, imagenMinima("WEBP"));
      assert.equal(jpg.es_principal, true);
      assert.equal(png.es_principal, false);
      assert.deepEqual([jpg.orden, png.orden, webp.orden], [0, 1, 2]);
      assert.match(jpg.url, /^\/api\/tienda\/fotos\/[0-9a-f-]{36}\.jpg$/);
      assert.match(png.url, /\.png$/);
      assert.match(webp.url, /\.webp$/);
      assert.deepEqual(Object.keys(jpg).sort(), ["deleted_at", "es_principal", "foto_id", "is_active", "orden", "producto_web_id", "url"]);
      const evento = eventosDe("ecommerce:foto_web_subida", jpg.foto_id)[0];
      assert.equal(evento.payload.formato, "JPG");
      assert.equal(evento.payload.tamano_bytes, imagenMinima("JPG").length);
      assert.equal(evento.payload.principal_anterior_id, null);
    });

    await t.test("CA2 — formato falso, vacía y demasiado grande se rechazan sin guardar nada", async () => {
      const { producto_web_id } = await contenidoPorServicio();
      const guardadasAntes = guardadas.size;
      await assert.rejects(() => subir(producto_web_id, textoComoImagen()), conCodigo("FORMATO_IMAGEN_NO_ADMITIDO"));
      await assert.rejects(() => subir(producto_web_id, new Uint8Array()), conCodigo("ARCHIVO_VACIO"));
      const maximo = await configuracion.obtenerFotoTamanoMaxBytes();
      assert.equal(maximo, 5 * 1024 * 1024);
      await assert.rejects(() => subir(producto_web_id, jpgDeTamano(maximo + 1)), conCodigo("ARCHIVO_DEMASIADO_GRANDE"));
      assert.equal(guardadas.size, guardadasAntes, "el Gateway no recibió nada");
      assert.equal(await prisma.productoWebFoto.count({ where: { producto_web_contenido_id: producto_web_id } }), 0);
      // Exactamente en el límite: se admite.
      const enLimite = await subir(producto_web_id, jpgDeTamano(maximo));
      assert.equal(enLimite.es_principal, true);
    });

    await t.test("CA2 — límite N con subidas concurrentes: N+1 en paralelo deja exactamente N y una sola principal", async () => {
      const { producto_web_id } = await contenidoPorServicio();
      const n = await configuracion.obtenerFotosMaxPorProducto();
      assert.equal(n, 8);
      const resultados = await Promise.allSettled(Array.from({ length: n + 1 }, () => subir(producto_web_id, imagenMinima("PNG"))));
      assert.equal(resultados.filter((r) => r.status === "fulfilled").length, n);
      const rechazos = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      assert.equal(rechazos.length, 1);
      assert.equal((rechazos[0].reason as InstanceType<typeof ServiceError>).code, "LIMITE_FOTOS_ALCANZADO");
      const activas = await fotosActivas(producto_web_id);
      assert.equal(activas.length, n);
      assert.equal(activas.filter((f) => f.es_principal).length, 1);
      assert.deepEqual(activas.map((f) => f.orden), Array.from({ length: n }, (_, i) => i));
      await assert.rejects(() => subir(producto_web_id, imagenMinima("JPG")), conCodigo("LIMITE_FOTOS_ALCANZADO"));
      // Una baja libera un lugar (el cupo cuenta solo activas, D24).
      await fotoSvc.darDeBajaFoto(producto_web_id, activas[3].id, "Liberar lugar", ADMIN);
      const otra = await subir(producto_web_id, imagenMinima("JPG"));
      assert.equal(otra.orden, n);
    });

    await t.test("CA2 — marcar otra como principal desmarca la anterior; repetirlo es no-op sin evento", async () => {
      const { producto_web_id } = await contenidoPorServicio();
      const a = await subir(producto_web_id, imagenMinima("JPG"));
      const b = await subir(producto_web_id, imagenMinima("PNG"));
      const c = await subir(producto_web_id, imagenMinima("WEBP"), true);
      assert.equal(c.es_principal, true, "subida con es_principal = true");
      assert.equal(eventosDe("ecommerce:foto_web_subida", c.foto_id)[0].payload.principal_anterior_id, a.foto_id);
      const marcada = await fotoSvc.marcarFotoPrincipal(producto_web_id, b.foto_id, ADMIN);
      assert.equal(marcada.es_principal, true);
      const activas = await fotosActivas(producto_web_id);
      assert.deepEqual(activas.filter((f) => f.es_principal).map((f) => f.id), [b.foto_id]);
      const evento = eventosDe("ecommerce:foto_web_principal_cambiada", b.foto_id);
      assert.equal(evento.length, 1);
      assert.equal(evento[0].payload.principal_anterior_id, c.foto_id);
      await fotoSvc.marcarFotoPrincipal(producto_web_id, b.foto_id, ADMIN);
      assert.equal(eventosDe("ecommerce:foto_web_principal_cambiada", b.foto_id).length, 1, "no-op sin evento");
    });

    await t.test("CA7 — baja de la principal promueve a la de menor orden; baja con los cuatro campos; nada se elimina", async () => {
      const { producto_web_id } = await contenidoPorServicio();
      const a = await subir(producto_web_id, imagenMinima("JPG"));
      const b = await subir(producto_web_id, imagenMinima("PNG"));
      const c = await subir(producto_web_id, imagenMinima("WEBP"));
      const totalFotos = await prisma.productoWebFoto.count();
      const totalContenidos = await prisma.productoWebContenido.count();

      const baja = await fotoSvc.darDeBajaFoto(producto_web_id, a.foto_id, "Foto desactualizada", ADMIN);
      assert.equal(baja.is_active, false);
      assert.ok(baja.deleted_at instanceof Date);
      const fila = await prisma.productoWebFoto.findUniqueOrThrow({ where: { id: a.foto_id } });
      assert.equal(fila.is_active, false);
      assert.ok(fila.deleted_at);
      assert.equal(fila.deleted_by, ADMIN);
      assert.equal(fila.deletion_reason, "Foto desactualizada");
      assert.ok(fila.updated_at.getTime() >= fila.created_at.getTime(), "updated_at (D17)");

      const activas = await fotosActivas(producto_web_id);
      assert.deepEqual(activas.map((f) => [f.id, f.es_principal]), [[b.foto_id, true], [c.foto_id, false]]);
      const evento = eventosDe("ecommerce:foto_web_baja", a.foto_id)[0];
      assert.equal(evento.payload.era_principal, true);
      assert.equal(evento.payload.principal_promovida_id, b.foto_id);

      // Baja de una no principal: no promueve.
      await fotoSvc.darDeBajaFoto(producto_web_id, c.foto_id, "Sobra", ADMIN);
      assert.equal(eventosDe("ecommerce:foto_web_baja", c.foto_id)[0].payload.principal_promovida_id, null);

      assert.equal(await prisma.productoWebFoto.count(), totalFotos, "conteo de filas idéntico: nada eliminado");
      assert.equal(await prisma.productoWebContenido.count(), totalContenidos);
      assert.equal(guardadas.has(a.url.split("/").pop()!), true, "el archivo sigue guardado");
    });

    await t.test("CA7 — foto de otro contenido, ya dada de baja o inexistente → 404; contenido de baja → 404", async () => {
      const uno = await contenidoPorServicio();
      const otro = await contenidoPorServicio();
      const foto = await subir(uno.producto_web_id, imagenMinima("JPG"));
      await assert.rejects(() => fotoSvc.marcarFotoPrincipal(otro.producto_web_id, foto.foto_id, ADMIN), conCodigo("FOTO_WEB_NO_ENCONTRADA"));
      await assert.rejects(() => fotoSvc.darDeBajaFoto(otro.producto_web_id, foto.foto_id, "X", ADMIN), conCodigo("FOTO_WEB_NO_ENCONTRADA"));
      await assert.rejects(() => fotoSvc.marcarFotoPrincipal(uno.producto_web_id, randomUUID(), ADMIN), conCodigo("FOTO_WEB_NO_ENCONTRADA"));
      await fotoSvc.darDeBajaFoto(uno.producto_web_id, foto.foto_id, "Primera baja", ADMIN);
      await assert.rejects(() => fotoSvc.darDeBajaFoto(uno.producto_web_id, foto.foto_id, "Segunda", ADMIN), conCodigo("FOTO_WEB_NO_ENCONTRADA"));
      await assert.rejects(() => fotoSvc.marcarFotoPrincipal(uno.producto_web_id, foto.foto_id, ADMIN), conCodigo("FOTO_WEB_NO_ENCONTRADA"));

      await visibilidad.darDeBajaContenidoWeb(otro.producto_web_id, { deletion_reason: "Baja" }, ADMIN);
      await assert.rejects(() => subir(otro.producto_web_id, imagenMinima("JPG")), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
      await assert.rejects(() => subir(randomUUID(), imagenMinima("JPG")), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
    });

    await t.test("D21 — configuración de fotos inválida → CONFIGURACION_INVALIDA (y se restaura)", async () => {
      const clave = "ECOMMERCE_FOTO_FORMATOS_PERMITIDOS";
      const original = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave } });
      try {
        for (const valor of ["JPG,GIF", "", " , "]) {
          await prisma.configuracionSistema.update({ where: { clave }, data: { valor } });
          await assert.rejects(() => configuracion.obtenerFotoFormatosPermitidos(), conCodigo("CONFIGURACION_INVALIDA"));
        }
        await prisma.configuracionSistema.update({ where: { clave }, data: { valor: "png" } });
        assert.deepEqual(await configuracion.obtenerFotoFormatosPermitidos(), ["PNG"]);
        const { producto_web_id } = await contenidoPorServicio();
        await assert.rejects(() => subir(producto_web_id, imagenMinima("JPG")), conCodigo("FORMATO_IMAGEN_NO_ADMITIDO"));
      } finally {
        await prisma.configuracionSistema.update({ where: { clave }, data: { valor: original.valor } });
      }
    });

    await t.test("D2 — Adapter de disco: escribe en CATALOGO_FOTOS_DIR (temporal, fuera del repo), lee y rechaza traversal", async () => {
      const anterior = process.env.CATALOGO_FOTOS_DIR;
      const directorio = mkdtempSync(path.join(tmpdir(), "hu-e11-fotos-"));
      assert.equal(path.relative(process.cwd(), directorio).startsWith(".."), true, "fuera del repo");
      const { almacenamientoImagenesLocal } = await import("./almacenamiento-imagenes.local.adapter.ts");
      try {
        delete process.env.CATALOGO_FOTOS_DIR;
        await assert.rejects(
          () => almacenamientoImagenesLocal.guardarImagen({ contenido: imagenMinima("PNG"), formato: "PNG" }),
          conCodigo("ALMACENAMIENTO_NO_CONFIGURADO"),
        );
        process.env.CATALOGO_FOTOS_DIR = directorio;
        const { producto_web_id } = await contenidoPorServicio();
        // Sin Gateway inyectado: la fábrica devuelve el Adapter de disco.
        const foto = await fotoSvc.subirFotoProducto(producto_web_id, imagenMinima("PNG"), false, ADMIN);
        const nombre = foto.url.replace("/api/tienda/fotos/", "");
        const ruta = path.join(directorio, nombre);
        assert.equal(existsSync(ruta), true);
        assert.deepEqual(new Uint8Array(readFileSync(ruta)), imagenMinima("PNG"));
        const leida = await almacenamientoImagenesLocal.leerImagen(nombre);
        assert.equal(leida?.contentType, "image/png");

        await fotoSvc.darDeBajaFoto(producto_web_id, foto.foto_id, "Baja con archivo en disco", ADMIN);
        assert.equal(existsSync(ruta), true, "el archivo físico no se borra (D29)");
        assert.ok(await almacenamientoImagenesLocal.leerImagen(nombre), "la ruta pública la sigue sirviendo (D24)");

        for (const intento of ["../.env", "..\\.env", `../${nombre}`, `${nombre}/../../x`, "/etc/passwd", nombre.toUpperCase(), `${randomUUID()}.svg`]) {
          assert.equal(await almacenamientoImagenesLocal.leerImagen(intento), null, intento);
        }
        assert.equal(await almacenamientoImagenesLocal.leerImagen(`${randomUUID()}.jpg`), null, "inexistente");
      } finally {
        if (anterior === undefined) delete process.env.CATALOGO_FOTOS_DIR;
        else process.env.CATALOGO_FOTOS_DIR = anterior;
      }
    });

    // ── CA5 — publicación ────────────────────────────────────────────────────
    await t.test("CA5 — sin foto, sin descripción, sin precio u oculto no aparece comprable; con todo, sí", async () => {
      const categoria = `Test HU-E11 CA5 ${sufijo()}`;
      const variante = { talle: "M", color: "Negro", genero: "UNISEX", modelo: "CA5", precio: 20000 };
      const completo = await crearProductoWeb({ categoria, titulo: "Completo", variantes: [variante] });
      const sinFoto = await crearProductoWeb({ categoria, titulo: "Sin foto", variantes: [variante], conFoto: false });
      const sinDescripcion = await crearProductoWeb({ categoria, titulo: "Sin descripción", variantes: [variante], descripcion: "" });
      const soloEspacios = await crearProductoWeb({ categoria, titulo: "Solo espacios", variantes: [variante], descripcion: "   " });
      const sinPrecio = await crearProductoWeb({ categoria, titulo: "Sin precio", variantes: [{ ...variante, precio: null }] });
      const oculto = await crearProductoWeb({ categoria, titulo: "Oculto", variantes: [variante], visible: false });

      const listado = await catalogo.listarCatalogo({ categoria, page: 1, page_size: 48 });
      const porId = new Map(listado.items.map((i) => [i.producto_web_id, i]));
      assert.equal(porId.get(completo.productoWebId)?.comprable, true);
      for (const ausente of [sinFoto, sinDescripcion, oculto]) assert.equal(porId.has(ausente.productoWebId), false);
      // D18: se listan pero NO como comprables (lo exige HU-E1).
      assert.equal(porId.get(sinPrecio.productoWebId)?.comprable, false);
      assert.equal(porId.get(soloEspacios.productoWebId)?.comprable, false);

      const vistas = await catalogo.resolverVariantesWeb(
        [completo, sinFoto, sinDescripcion, soloEspacios, sinPrecio, oculto].map((p) => p.variantes[0].id),
      );
      const motivo = (p: { variantes: { id: string }[] }) => vistas.get(p.variantes[0].id)?.motivo ?? null;
      assert.equal(motivo(completo), null);
      assert.equal(motivo(sinFoto), "NO_PUBLICABLE");
      assert.equal(motivo(sinDescripcion), "NO_PUBLICABLE");
      assert.equal(motivo(soloEspacios), "NO_PUBLICABLE");
      assert.equal(motivo(sinPrecio), "SIN_PRECIO_VIGENTE");
      assert.equal(motivo(oculto), "NO_VISIBLE_WEB");
    });

    await t.test("CA5 — circuito por servicio: alta oculta → foto → mostrar (E5) → publicado; baja de la única foto → deja de estarlo", async () => {
      const c = await contenidoPorServicio();
      const comprable = async () => (await catalogo.resolverVariantesWeb([c.varianteId])).get(c.varianteId)!;
      assert.equal((await comprable()).motivo, "NO_VISIBLE_WEB");
      const foto = await subir(c.producto_web_id, imagenMinima("JPG"));
      assert.equal((await comprable()).motivo, "NO_VISIBLE_WEB");
      await visibilidad.cambiarVisibilidadWeb(c.producto_web_id, { visibilidad_web: true }, ADMIN);
      assert.equal((await comprable()).comprable, true);
      const detalle = await catalogo.obtenerDetalleProductoWeb(c.producto_web_id);
      assert.equal(detalle.comprable, true);

      await fotoSvc.darDeBajaFoto(c.producto_web_id, foto.foto_id, "Única foto", ADMIN);
      assert.equal((await comprable()).motivo, "NO_PUBLICABLE");
      await assert.rejects(() => catalogo.obtenerDetalleProductoWeb(c.producto_web_id), conCodigo("PRODUCTO_WEB_NO_ENCONTRADO"));
    });

    // ── CA4 — detalle ────────────────────────────────────────────────────────
    await t.test("CA4 — el detalle (E1) muestra todas las fotos activas con la principal primero, descripción, precio y disponibilidad", async () => {
      const c = await contenidoPorServicio();
      const a = await subir(c.producto_web_id, imagenMinima("JPG"));
      const b = await subir(c.producto_web_id, imagenMinima("PNG"));
      const d = await subir(c.producto_web_id, imagenMinima("WEBP"));
      await fotoSvc.marcarFotoPrincipal(c.producto_web_id, d.foto_id, ADMIN);
      await fotoSvc.darDeBajaFoto(c.producto_web_id, b.foto_id, "Fuera", ADMIN);
      await visibilidad.cambiarVisibilidadWeb(c.producto_web_id, { visibilidad_web: true }, ADMIN);
      const detalle = await catalogo.obtenerDetalleProductoWeb(c.producto_web_id);
      assert.deepEqual(detalle.fotos, [d.url, a.url]);
      assert.equal(detalle.descripcion, "Descripción comercial");
      assert.equal(detalle.variantes.length, 1);
      assert.equal(detalle.variantes[0].precio_venta, 15000);
      assert.equal(detalle.variantes[0].disponible, 4);
      assert.equal(detalle.variantes[0].comprable, true);
      // Disponibilidad en tiempo real: un cambio de stock se ve en la siguiente lectura.
      await prisma.stockDeposito.updateMany({ where: { variante_sku_id: c.varianteId, deposito_id: fixtures.DEPOSITO_SHOWROOM_ID }, data: { cantidad: 1 } });
      assert.equal((await catalogo.obtenerDetalleProductoWeb(c.producto_web_id)).variantes[0].disponible, 1);
    });

    // ── CA3 — listado ────────────────────────────────────────────────────────
    await t.test("CA3 — filtros, búsqueda, orden, paginación y valores disponibles", async () => {
      const s = sufijo();
      const categoria = `Test HU-E11 CA3 ${s}`;
      const T = (x: string) => `${x}-${s}`; // valores únicos de esta corrida
      const base = Date.now() - 60_000;
      const p1 = await crearProductoWeb({
        categoria,
        titulo: `Remera ${T("alfa")}`,
        creadoEn: new Date(base),
        variantes: [
          { talle: T("M"), color: T("Negro"), genero: "MASCULINO", modelo: T("Clasico"), precio: 3000 },
          { talle: T("L"), color: T("Rojo"), genero: "MASCULINO", modelo: T("Clasico"), precio: 3500 },
          // Sin precio: no comprable, no cuenta para filtros ni valores.
          { talle: T("XL"), color: T("Azul"), genero: "MASCULINO", modelo: T("Clasico"), precio: null },
        ],
      });
      const p2 = await crearProductoWeb({
        categoria,
        titulo: "Pantalón",
        creadoEn: new Date(base + 1000),
        variantes: [{ talle: T("M"), color: T("Verde"), genero: "FEMENINO", modelo: T("Cargo"), precio: 1000 }],
      });
      const p3 = await crearProductoWeb({
        categoria,
        titulo: "Chaleco",
        creadoEn: new Date(base + 2000),
        variantes: [{ talle: T("S"), color: T("Negro"), genero: "UNISEX", modelo: T("Cargo"), precio: 9000 }],
      });
      const p4SinPrecio = await crearProductoWeb({
        categoria,
        titulo: "Gorro",
        creadoEn: new Date(base + 3000),
        variantes: [{ talle: T("U"), color: T("Gris"), genero: "UNISEX", modelo: T("Lana"), precio: null }],
      });
      const ids = (items: { producto_web_id: string }[]) => items.map((i) => i.producto_web_id);
      const listar = (extra: Record<string, unknown>) =>
        catalogo.listarCatalogo({ categoria, page: 1, page_size: 48, ...extra } as Parameters<typeof catalogo.listarCatalogo>[0]);

      // Novedad (default) y orden por precio, sin precio al final en ambos sentidos.
      assert.deepEqual(ids((await listar({})).items), [p4SinPrecio, p3, p2, p1].map((p) => p.productoWebId));
      assert.deepEqual(ids((await listar({ orden: "precio_asc" })).items), [p2, p1, p3, p4SinPrecio].map((p) => p.productoWebId));
      assert.deepEqual(ids((await listar({ orden: "precio_desc" })).items), [p3, p1, p2, p4SinPrecio].map((p) => p.productoWebId));
      const asc = (await listar({ orden: "precio_asc" })).items;
      assert.deepEqual(asc.map((i) => i.precio_desde), [1000, 3000, 9000, null]);

      // Cada filtro por separado.
      assert.deepEqual(ids((await listar({ talle: T("M") })).items).sort(), [p1, p2].map((p) => p.productoWebId).sort());
      assert.deepEqual(ids((await listar({ color: T("Negro") })).items).sort(), [p1, p3].map((p) => p.productoWebId).sort());
      assert.deepEqual(ids((await listar({ genero: "FEMENINO" })).items), [p2.productoWebId]);
      assert.deepEqual(ids((await listar({ modelo: T("Cargo") })).items).sort(), [p2, p3].map((p) => p.productoWebId).sort());
      // Combinados: la MISMA variante debe cumplirlos (D20a).
      assert.deepEqual(ids((await listar({ talle: T("M"), color: T("Negro") })).items), [p1.productoWebId]);
      assert.deepEqual(ids((await listar({ talle: T("M"), color: T("Rojo") })).items), [], "M es Negro y L es Rojo: ninguna variante cumple ambos");
      assert.deepEqual(ids((await listar({ talle: T("L"), color: T("Rojo"), genero: "MASCULINO", modelo: T("Clasico") })).items), [p1.productoWebId]);
      // Solo cuentan variantes comprables.
      assert.deepEqual(ids((await listar({ talle: T("XL") })).items), []);
      assert.deepEqual(ids((await listar({ color: T("Gris") })).items), []);
      // Valores inexistentes → lista vacía; categoría inexistente → vacía.
      assert.deepEqual((await listar({ talle: "no-existe" })).items, []);
      assert.equal((await catalogo.listarCatalogo({ categoria: `no existe ${s}`, page: 1, page_size: 12 })).paginacion.total, 0);

      // Búsqueda por texto (título o descripción).
      assert.deepEqual(ids((await catalogo.listarCatalogo({ q: T("alfa"), page: 1, page_size: 12 })).items), [p1.productoWebId]);
      assert.deepEqual(ids((await catalogo.listarCatalogo({ q: T("alfa").toUpperCase(), color: T("Verde"), page: 1, page_size: 12 })).items), []);

      // Paginación: totales y página fuera de rango.
      const pagina1 = await listar({ page_size: 3 });
      assert.deepEqual(pagina1.paginacion, { total: 4, pagina_actual: 1, total_paginas: 2, por_pagina: 3 });
      const pagina2 = await listar({ page: 2, page_size: 3 });
      assert.deepEqual(ids(pagina2.items), [p1.productoWebId]);
      const fuera = await listar({ page: 9, page_size: 3 });
      assert.deepEqual(fuera.items, []);
      assert.equal(fuera.paginacion.total, 4);

      // Valores disponibles: de todo el catálogo publicado y comprable (D20d).
      const { filtros } = await listar({ talle: T("M") });
      for (const valor of [T("M"), T("L"), T("S")]) assert.ok(filtros.talles.includes(valor), valor);
      for (const valor of [T("XL"), T("U")]) assert.equal(filtros.talles.includes(valor), false, valor);
      for (const valor of [T("Negro"), T("Rojo"), T("Verde")]) assert.ok(filtros.colores.includes(valor), valor);
      assert.equal(filtros.colores.includes(T("Gris")), false);
      for (const valor of [T("Clasico"), T("Cargo")]) assert.ok(filtros.modelos.includes(valor), valor);
      assert.equal(filtros.modelos.includes(T("Lana")), false);
      assert.ok(filtros.categorias.includes(categoria));
      assert.ok(filtros.generos.includes("FEMENINO"));
      assert.deepEqual([...filtros.talles].sort((a, b) => a.localeCompare(b, "es")), filtros.talles, "ordenados");
    });

    // ── CA6 — inventario y POS ───────────────────────────────────────────────
    await t.test("CA6 — snapshot de VarianteSKU, StockDeposito, Reserva y ProductoMaestro idéntico antes y después", async () => {
      // Fixtures primero (son Módulo A); el snapshot cubre SOLO las operaciones de E11.
      const maestro = await crearMaestro();
      const c = await contenidoPorServicio();
      const huella = async () =>
        prisma.$queryRaw<{ variantes: string; stock: string; reservas: string; maestros: string }[]>`
          SELECT
            (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM variantes_sku t) AS variantes,
            (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM stock_depositos t) AS stock,
            (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM reservas t) AS reservas,
            (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM productos_maestros t) AS maestros`;
      const antes = await huella();

      const alta = await contenidoSvc.crearContenidoWeb(
        { producto_maestro_id: maestro.id, titulo_comercial: "CA6", descripcion: "CA6" },
        ADMIN,
      );
      await contenidoSvc.editarContenidoWeb(alta.producto_web_id, { titulo_comercial: "CA6 bis", descripcion: "CA6 bis" }, ADMIN);
      const f1 = await subir(c.producto_web_id, imagenMinima("JPG"));
      const f2 = await subir(c.producto_web_id, imagenMinima("PNG"));
      await fotoSvc.marcarFotoPrincipal(c.producto_web_id, f2.foto_id, ADMIN);
      await fotoSvc.darDeBajaFoto(c.producto_web_id, f2.foto_id, "CA6", ADMIN);
      await fotoSvc.darDeBajaFoto(c.producto_web_id, f1.foto_id, "CA6", ADMIN);
      await catalogo.listarCatalogo({ page: 1, page_size: 48, orden: "precio_asc", talle: "M" });

      assert.deepEqual(await huella(), antes);
    });

    // ── D14/D25 — auditoría ──────────────────────────────────────────────────
    await t.test("D25 — los cinco eventos quedan en el ledger con el actor correcto y la cadena SHA-256 íntegra", async () => {
      const c = await contenidoPorServicio();
      await contenidoSvc.editarContenidoWeb(c.producto_web_id, { descripcion: "Auditada" }, ADMIN);
      const a = await subir(c.producto_web_id, imagenMinima("JPG"));
      const b = await subir(c.producto_web_id, imagenMinima("PNG"));
      await fotoSvc.marcarFotoPrincipal(c.producto_web_id, b.foto_id, ADMIN);
      await fotoSvc.darDeBajaFoto(c.producto_web_id, b.foto_id, "Auditoría E11", ADMIN);
      await esperarLedgerQuieto();

      const asientos = await prisma.auditLog.findMany({
        where: { registro_id: { in: [c.producto_web_id, a.foto_id, b.foto_id] } },
        orderBy: { created_at: "asc" },
      });
      const acciones = asientos.map((x) => `${x.accion}:${x.registro_id}`);
      for (const esperado of [
        `ecommerce:contenido_web_creado:${c.producto_web_id}`,
        `ecommerce:contenido_web_editado:${c.producto_web_id}`,
        `ecommerce:foto_web_subida:${a.foto_id}`,
        `ecommerce:foto_web_subida:${b.foto_id}`,
        `ecommerce:foto_web_principal_cambiada:${b.foto_id}`,
        `ecommerce:foto_web_baja:${b.foto_id}`,
      ]) {
        assert.ok(acciones.includes(esperado), esperado);
      }
      for (const asiento of asientos) assert.equal(asiento.usuario_id, ADMIN, asiento.accion);
      const bajaFoto = asientos.find((x) => x.accion === "ecommerce:foto_web_baja")!;
      assert.equal(bajaFoto.tabla_afectada, "fotos_producto_web");
      assert.deepEqual(bajaFoto.valor_nuevo, {
        is_active: false,
        deleted_by: ADMIN,
        deletion_reason: "Auditoría E11",
        principal_promovida_id: a.foto_id,
      });

      const resultado = await verificarCadenaIntegridad();
      assert.equal(resultado.integra, true, JSON.stringify(resultado));
    });
  },
);
