import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-B9 — Nivel 2/3 a nivel servicio contra una base REAL descartable
 * (misma base de test que HU-E1, `swat_erp_test_e1`, migrada y sembrada).
 * Cubre lo que el nivel HTTP no puede ver: el parámetro opcional
 * `{ prisma: tx }` del resolver, la atomicidad del 422 y el asiento del
 * listener en `AuditLog`.
 *
 * Opt-in: `HU_B9_INTEGRATION_DATABASE_URL`; `skip` si falta. Imports
 * dinámicos (los servicios usan `import "server-only"`). Nunca se borra nada
 * (Regla N.° 1): las versiones creadas se dan de baja lógica al terminar,
 * para que re-correr el test parta otra vez de la v1 del seed.
 */

const DATABASE_URL = process.env.HU_B9_INTEGRATION_DATABASE_URL;

const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";
const LISTA_PRECIO_VENTA_GENERAL_ID = "16d1dbbf-b91e-4c07-93f0-007572d0d116";
const VERSION_1_ID = "f7bc2652-5022-4d5c-b235-be90b8f1677d";
const CT1 = "407e729d-47c3-404d-a89a-0a9c1f85a3db";
const CT2 = "6fbb4612-9e6d-4661-b250-0bc62579089e";
const GORRA = "bc8d1631-2378-4c63-826f-16e2cc814eea";
const POLICIA = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";
const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

test(
  "HU-B9 — servicio de Lista de Precios de Venta contra una base real",
  { skip: !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const [{ prisma }, servicio, { ServiceError }] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./lista-precio-venta.service.ts"),
      import("../../errors/service-error.ts"),
    ]);

    const versionesCreadas: string[] = [];
    t.after(async () => {
      if (versionesCreadas.length > 0) {
        await prisma.listaPrecioVentaVersion.updateMany({
          where: { id: { in: versionesCreadas } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B9" },
        });
      }
      await prisma.$disconnect();
    });

    const conCodigo = (code: string) => (err: unknown) =>
      err instanceof ServiceError && err.code === code;

    await t.test("sugerencia CT1 → costo 15600, margen 0.35, sugerido 21060 exacto (sin redondeo)", async () => {
      assert.deepEqual(await servicio.obtenerSugerenciaPrecio(CT1), {
        variante_sku_id: CT1,
        costo_reposicion_referencia: 15600,
        margen: 0.35,
        precio_sugerido: 21060,
      });
    });

    await t.test("sugerencia Gorra (sin costo HU-H8) → nulls, margen igual informado", async () => {
      assert.deepEqual(await servicio.obtenerSugerenciaPrecio(GORRA), {
        variante_sku_id: GORRA,
        costo_reposicion_referencia: null,
        margen: 0.35,
        precio_sugerido: null,
      });
    });

    await t.test("sugerencia SKU inexistente → VARIANTE_NO_ENCONTRADA (422), no se confunde con 'sin costo'", async () => {
      await assert.rejects(
        servicio.obtenerSugerenciaPrecio(UUID_INEXISTENTE),
        (err) => conCodigo("VARIANTE_NO_ENCONTRADA")(err),
      );
    });

    await t.test("resolver: CT1 resuelve a la v1 del seed; Camisa de Policía → null", async () => {
      const ct1 = await servicio.resolverPrecioVentaVigente(CT1);
      assert.equal(ct1?.precio_venta.toNumber(), 21100);
      assert.equal(ct1?.lista_precio_version_id, VERSION_1_ID);
      assert.equal(await servicio.resolverPrecioVentaVigente(POLICIA), null);
    });

    await t.test("resolver con { prisma: tx } ve lo escrito en la transacción del llamador (y no fuera de ella)", async () => {
      const ROLLBACK = new Error("rollback intencional");
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          const v = await tx.listaPrecioVentaVersion.create({
            data: {
              lista_id: LISTA_PRECIO_VENTA_GENERAL_ID,
              vigente_desde: new Date(Date.now() - 1000),
              publicado_por_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID,
              items: { create: { variante_sku_id: CT1, precio_venta: 77777 } },
            },
          });
          const dentro = await servicio.resolverPrecioVentaVigente(CT1, { prisma: tx });
          assert.equal(dentro?.precio_venta.toNumber(), 77777);
          assert.equal(dentro?.lista_precio_version_id, v.id);
          const fuera = await servicio.resolverPrecioVentaVigente(CT1);
          assert.equal(fuera?.precio_venta.toNumber(), 21100);
          throw ROLLBACK;
        }),
        (err) => err === ROLLBACK,
      );
      assert.equal((await servicio.resolverPrecioVentaVigente(CT1))?.precio_venta.toNumber(), 21100);
    });

    await t.test("bajo costo sin motivo → MOTIVO_BAJO_COSTO_REQUERIDO con details; NADA persistido (atomicidad)", async () => {
      const antes = await prisma.listaPrecioVentaVersion.count();
      await assert.rejects(
        servicio.publicarVersionListaPrecioVenta(
          { vigente_desde: new Date(), items: [{ variante_sku_id: CT1, precio_venta: 23000 }, { variante_sku_id: CT2, precio_venta: 15000 }] },
          USUARIO_SUPERVISOR_VENTAS_SEED_ID,
        ),
        (err) => conCodigo("MOTIVO_BAJO_COSTO_REQUERIDO")(err) &&
          (err as InstanceType<typeof ServiceError>).details !== undefined &&
          ((err as InstanceType<typeof ServiceError>).details as { variante_sku_id: string }).variante_sku_id === CT2,
      );
      assert.equal(await prisma.listaPrecioVentaVersion.count(), antes);
    });

    await t.test("publicación parcial: CT1 nuevo precio, CT2 sigue resolviendo a v1 (resolución por SKU); evento → AuditLog", async () => {
      const r = await servicio.publicarVersionListaPrecioVenta(
        { vigente_desde: new Date(), items: [{ variante_sku_id: CT1, precio_venta: 23000 }] },
        USUARIO_SUPERVISOR_VENTAS_SEED_ID,
      );
      versionesCreadas.push(r.version_id);
      assert.equal(r.lista_id, LISTA_PRECIO_VENTA_GENERAL_ID);
      assert.equal(r.items_publicados, 1);
      assert.equal(r.items_bajo_costo, 0);

      assert.equal((await servicio.resolverPrecioVentaVigente(CT1))?.precio_venta.toNumber(), 23000);
      const ct2 = await servicio.resolverPrecioVentaVigente(CT2);
      assert.equal(ct2?.precio_venta.toNumber(), 22800);
      assert.equal(ct2?.lista_precio_version_id, VERSION_1_ID);

      const item = await prisma.listaPrecioVentaItem.findFirstOrThrow({ where: { version_id: r.version_id } });
      assert.equal(item.costo_reposicion_referencia?.toNumber(), 15600);
      assert.equal(item.confirmado_bajo_costo, false);
      assert.equal(item.motivo_bajo_costo, null);

      let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
      for (let i = 0; i < 40 && filas.length === 0; i++) {
        await new Promise((res) => setTimeout(res, 50));
        filas = await prisma.auditLog.findMany({
          where: { tabla_afectada: "versiones_lista_precio_venta", registro_id: r.version_id },
        });
      }
      assert.equal(filas.length, 1);
      assert.equal(filas[0].accion, "PUBLICAR_VERSION_LISTA_PRECIO_VENTA");
      assert.equal(filas[0].usuario_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
      assert.equal(filas[0].valor_anterior, null);
      assert.deepEqual(filas[0].valor_nuevo, {
        version_id: r.version_id,
        lista_id: LISTA_PRECIO_VENTA_GENERAL_ID,
        publicado_por_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID,
        vigente_desde: r.vigente_desde.toISOString(),
        items_publicados: 1,
        items_bajo_costo: 0,
      });
    });

    await t.test("dos versiones con el MISMO vigente_desde: gana la de created_at más reciente (desempate)", async () => {
      const mismo = new Date(Date.now() - 60_000);
      for (const precio of [31000, 32000]) {
        const r = await servicio.publicarVersionListaPrecioVenta(
          { vigente_desde: mismo, items: [{ variante_sku_id: CT1, precio_venta: precio }] },
          USUARIO_SUPERVISOR_VENTAS_SEED_ID,
        );
        versionesCreadas.push(r.version_id);
      }
      // La versión de 23000 (caso anterior) tiene vigente_desde POSTERIOR: sigue ganando.
      assert.equal((await servicio.resolverPrecioVentaVigente(CT1))?.precio_venta.toNumber(), 23000);
      await prisma.listaPrecioVentaVersion.updateMany({
        where: { id: versionesCreadas[0] },
        data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup parcial test HU-B9" },
      });
      // Baja lógica de la vigente → cae a las dos empatadas; desempata created_at desc.
      assert.equal((await servicio.resolverPrecioVentaVigente(CT1))?.precio_venta.toNumber(), 32000);
    });

    await t.test("LISTA_PRECIO_VENTA_NO_CONFIGURADA si hay más de una lista activa", async () => {
      const extra = await prisma.listaPrecioVenta.create({ data: { nombre: "Lista extra test HU-B9" } });
      try {
        await assert.rejects(
          servicio.publicarVersionListaPrecioVenta(
            { vigente_desde: new Date(), items: [{ variante_sku_id: CT1, precio_venta: 23000 }] },
            USUARIO_SUPERVISOR_VENTAS_SEED_ID,
          ),
          conCodigo("LISTA_PRECIO_VENTA_NO_CONFIGURADA"),
        );
      } finally {
        await prisma.listaPrecioVenta.update({
          where: { id: extra.id },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B9" },
        });
      }
    });

    await t.test("CONFIGURACION_NO_ENCONTRADA si falta la clave del margen (sin default)", async () => {
      const fila = await prisma.configuracionSistema.findUniqueOrThrow({
        where: { clave: "VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA" },
      });
      // Renombrar (UPDATE, nunca DELETE) y restaurar.
      await prisma.configuracionSistema.update({ where: { id: fila.id }, data: { clave: `${fila.clave}__TEST_B9` } });
      try {
        await assert.rejects(servicio.obtenerSugerenciaPrecio(CT1), conCodigo("CONFIGURACION_NO_ENCONTRADA"));
      } finally {
        await prisma.configuracionSistema.update({ where: { id: fila.id }, data: { clave: fila.clave } });
      }
    });
  },
);
