import assert from "node:assert/strict";
import test from "node:test";

/**
 * Integración real de HU-H2 (`lista-precios.service.ts`) contra Postgres —
 * cubre los hallazgos de la auditoría externa sobre Módulo H que dependen
 * del comportamiento real de la base (precisión de columnas, joins), no
 * reproducibles con mocks.
 *
 * Cada caso usa su PROPIO `Proveedor` + `VarianteSKU` dedicados (misma
 * razón que `costo-reposicion.http.integration.test.ts`: la versión vigente
 * se resuelve de forma global por proveedor, compartirlo contamina casos).
 * Todo lo creado se limpia en `after()`; los `AuditLog` emitidos por el
 * listener quedan (append-only, cadena SHA-256 global — borrarlos la rompe).
 *
 * Opt-in vía `HU_H2_INTEGRATION_DATABASE_URL`, `skip` si no está seteada —
 * mismo patrón que `recepcion.integration.test.ts` (HU-H4).
 */

const DATABASE_URL = process.env.HU_H2_INTEGRATION_DATABASE_URL;

// Usuario del seed (mismo que usa `recepcion.integration.test.ts`).
const USUARIO_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";

test(
  "HU-H2 — publicación de lista de precios contra Postgres real",
  { skip: !DATABASE_URL, timeout: 60_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, listaPrecios, { iniciarAuditLogListener }] =
      await Promise.all([
        import("../../db/prisma.ts"),
        import("./lista-precios.service.ts"),
        import("../../events/listeners/audit-log.listener.ts"),
      ]);
    iniciarAuditLogListener();

    const sufijo = Date.now().toString(36);
    const productoMaestro = await prisma.productoMaestro.findFirstOrThrow({
      select: { id: true },
    });

    const proveedoresFixture: string[] = [];
    const variantesFixture: string[] = [];

    t.after(async () => {
      const filtroProveedor = { proveedor_id: { in: proveedoresFixture } };
      await prisma.listaPrecioItem.deleteMany({
        where: { lista_precio_version: { lista_precio: filtroProveedor } },
      });
      await prisma.listaPrecioVersion.deleteMany({
        where: { lista_precio: filtroProveedor },
      });
      await prisma.listaPrecio.deleteMany({ where: filtroProveedor });
      await prisma.varianteSKU.deleteMany({
        where: { id: { in: variantesFixture } },
      });
      await prisma.proveedor.deleteMany({
        where: { id: { in: proveedoresFixture } },
      });
      await prisma.$disconnect();
    });

    /** Proveedor homologado + variante propia + versión previa publicada. */
    async function crearEscenario(caso: string, precioPrevio: number) {
      const proveedor = await prisma.proveedor.create({
        data: {
          razon_social: `QA HU-H2 ${caso} ${sufijo}`,
          cuit: `20-${sufijo}-${caso}`,
          categorias: [],
          estado: "HOMOLOGADO",
        },
        select: { id: true },
      });
      proveedoresFixture.push(proveedor.id);

      const variante = await prisma.varianteSKU.create({
        data: {
          producto_maestro_id: productoMaestro.id,
          sku: `QA-H2-${sufijo}-${caso}`,
          talle: "M",
          color: "Negro",
          genero: "Unisex",
          modelo: "QA-H2",
          proveedor_id: proveedor.id,
        },
        select: { id: true },
      });
      variantesFixture.push(variante.id);

      const lista = await prisma.listaPrecio.create({
        data: { proveedor_id: proveedor.id },
        select: { id: true },
      });
      await prisma.listaPrecioVersion.create({
        data: {
          lista_precio_id: lista.id,
          fecha_inicio_vigencia: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          variacion_porcentual_maxima: 0,
          requiere_aprobacion: false,
          publicada: true,
          items: {
            create: [
              { variante_sku_id: variante.id, precio_unitario: precioPrevio },
            ],
          },
        },
      });

      return { proveedorId: proveedor.id, varianteId: variante.id };
    }

    await t.test(
      "Hallazgo 2 — variación > 999.99% persiste y queda pendiente de aprobación",
      async () => {
        const { proveedorId, varianteId } = await crearEscenario("H2-SUBA", 1);

        // 1 → 12 = +1100%: excedía `Decimal(5,2)` (máx. 999.99).
        const resultado = await listaPrecios.publicarNuevaVersionListaPrecio(
          proveedorId,
          new Date(),
          [{ variante_sku_id: varianteId, precio_unitario: 12 }],
          USUARIO_ID,
        );

        assert.equal(resultado.variacion_porcentual_maxima, 1100);
        assert.equal(resultado.requiere_aprobacion, true);
        assert.equal(resultado.publicada, false);

        const persistida = await prisma.listaPrecioVersion.findUniqueOrThrow({
          where: { id: resultado.lista_precio_version_id },
          select: {
            variacion_porcentual_maxima: true,
            requiere_aprobacion: true,
            publicada: true,
          },
        });
        assert.equal(persistida.variacion_porcentual_maxima.toNumber(), 1100);
        assert.equal(persistida.requiere_aprobacion, true);
        assert.equal(persistida.publicada, false);
      },
    );

    await t.test(
      "Hallazgo 2 — variación en el máximo matemático del dominio de precios persiste",
      async () => {
        // Peor caso real: precio previo mínimo persistible (0.01, escala 2 de
        // `ListaPrecioItem.precio_unitario`) → precio nuevo máximo persistible
        // (99,999,999.99, `Decimal(10,2)`) ≈ +999,999,999,800%.
        const { proveedorId, varianteId } = await crearEscenario(
          "H2-TOPE",
          0.01,
        );

        const resultado = await listaPrecios.publicarNuevaVersionListaPrecio(
          proveedorId,
          new Date(),
          [{ variante_sku_id: varianteId, precio_unitario: 99_999_999.99 }],
          USUARIO_ID,
        );

        assert.equal(resultado.requiere_aprobacion, true);
        const persistida = await prisma.listaPrecioVersion.findUniqueOrThrow({
          where: { id: resultado.lista_precio_version_id },
          select: { variacion_porcentual_maxima: true },
        });
        assert.equal(
          persistida.variacion_porcentual_maxima.toFixed(2),
          "999999999800.00",
        );
      },
    );

    /**
     * El listener registra el `AuditLog` de forma asíncrona (`void
     * registrarAuditLog(...)`, cola serializada del ledger): se espera a
     * que aparezca en vez de asumir que ya está escrito al volver el service.
     */
    async function esperarAuditLogVariacionCritica(versionId: string) {
      for (let intento = 0; intento < 40; intento++) {
        const log = await prisma.auditLog.findFirst({
          where: { accion: "VARIACION_CRITICA", registro_id: versionId },
          select: { valor_nuevo: true },
        });
        if (log) return log;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    }

    await t.test(
      "Hallazgo 3 — una baja que supera el umbral dispara el mismo flujo que una suba equivalente",
      async () => {
        const suba = await crearEscenario("H3-SUBA", 100);
        const baja = await crearEscenario("H3-BAJA", 100);

        // ±30%, por encima del umbral de 20%.
        const [resultadoSuba, resultadoBaja] = await Promise.all([
          listaPrecios.publicarNuevaVersionListaPrecio(
            suba.proveedorId,
            new Date(),
            [{ variante_sku_id: suba.varianteId, precio_unitario: 130 }],
            USUARIO_ID,
          ),
          listaPrecios.publicarNuevaVersionListaPrecio(
            baja.proveedorId,
            new Date(),
            [{ variante_sku_id: baja.varianteId, precio_unitario: 70 }],
            USUARIO_ID,
          ),
        ]);

        for (const resultado of [resultadoSuba, resultadoBaja]) {
          assert.equal(resultado.variacion_porcentual_maxima, 30);
          assert.equal(resultado.requiere_aprobacion, true);
          assert.equal(resultado.publicada, false);

          const persistida = await prisma.listaPrecioVersion.findUniqueOrThrow({
            where: { id: resultado.lista_precio_version_id },
            select: { variacion_porcentual_maxima: true, publicada: true },
          });
          assert.equal(persistida.variacion_porcentual_maxima.toNumber(), 30);
          assert.equal(persistida.publicada, false);
        }

        // Evento crítico → AuditLog en ambos casos; el ítem conserva el signo.
        const logSuba = await esperarAuditLogVariacionCritica(
          resultadoSuba.lista_precio_version_id,
        );
        const logBaja = await esperarAuditLogVariacionCritica(
          resultadoBaja.lista_precio_version_id,
        );
        assert.ok(logSuba, "falta el AuditLog VARIACION_CRITICA de la suba");
        assert.ok(logBaja, "falta el AuditLog VARIACION_CRITICA de la baja");
        const itemsBaja = (logBaja.valor_nuevo as {
          items_variacion_critica: { variacion_porcentual: number }[];
        }).items_variacion_critica;
        assert.equal(itemsBaja[0]!.variacion_porcentual, -30);
      },
    );

    await t.test(
      "Hallazgo 4 — el servicio (sin Zod) rechaza SKU repetido con ITEMS_DUPLICADOS y no crea nada",
      async () => {
        const { ServiceError } = await import("../../errors/service-error.ts");
        const { proveedorId, varianteId } = await crearEscenario("H4-DUP", 100);

        await assert.rejects(
          listaPrecios.publicarNuevaVersionListaPrecio(
            proveedorId,
            new Date(),
            [
              { variante_sku_id: varianteId, precio_unitario: 1000 },
              { variante_sku_id: varianteId, precio_unitario: 1200 },
            ],
            USUARIO_ID,
          ),
          (err: unknown) => {
            assert.ok(err instanceof ServiceError);
            assert.equal(err.code, "ITEMS_DUPLICADOS");
            return true;
          },
        );

        // Solo existe la versión previa del escenario: no se persistió nada.
        const versiones = await prisma.listaPrecioVersion.count({
          where: { lista_precio: { proveedor_id: proveedorId } },
        });
        assert.equal(versiones, 1);
      },
    );

    await t.test(
      "Hallazgo 3 — control: una baja dentro del umbral se publica directo",
      async () => {
        const { proveedorId, varianteId } = await crearEscenario("H3-BAJA-OK", 100);

        const resultado = await listaPrecios.publicarNuevaVersionListaPrecio(
          proveedorId,
          new Date(),
          [{ variante_sku_id: varianteId, precio_unitario: 90 }],
          USUARIO_ID,
        );

        assert.equal(resultado.variacion_porcentual_maxima, 10);
        assert.equal(resultado.requiere_aprobacion, false);
        assert.equal(resultado.publicada, true);
      },
    );
  },
);
