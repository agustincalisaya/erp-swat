import assert from "node:assert/strict";
import test from "node:test";

/**
 * Integración real de HU-H8 a nivel servicio (`obtenerCostoReposicionVigente`)
 * contra Postgres — complementa `costo-reposicion.http.integration.test.ts`
 * (que necesita un servidor Next real) con los casos que solo dependen de
 * la base: la guarda de `ListaPrecioItem` duplicados.
 *
 * `ListaPrecioItem` no tiene `@@unique` sobre (`lista_precio_version_id`,
 * `variante_sku_id`), así que el fixture de duplicados se puede insertar
 * directo. Cada caso usa su PROPIO `Proveedor` + `VarianteSKU` dedicados, y
 * todo lo creado se limpia en `after()`.
 *
 * Opt-in vía `HU_H8_INTEGRATION_DATABASE_URL`, `skip` si no está seteada —
 * mismo patrón que `recepcion.integration.test.ts` (HU-H4).
 */

const DATABASE_URL = process.env.HU_H8_INTEGRATION_DATABASE_URL;

test(
  "HU-H8 — costo de reposición vigente contra Postgres real",
  { skip: !DATABASE_URL, timeout: 60_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, { obtenerCostoReposicionVigente }, { ServiceError }] =
      await Promise.all([
        import("../../db/prisma.ts"),
        import("./costo-reposicion.service.ts"),
        import("../../errors/service-error.ts"),
      ]);

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

    async function crearProveedorHomologado(caso: string) {
      const proveedor = await prisma.proveedor.create({
        data: {
          razon_social: `QA HU-H8 svc ${caso} ${sufijo}`,
          cuit: `20-${sufijo}-svc${caso}`,
          categorias: [],
          estado: "HOMOLOGADO",
        },
        select: { id: true },
      });
      proveedoresFixture.push(proveedor.id);
      return proveedor.id;
    }

    async function crearVariante(caso: string, proveedorId: string) {
      const variante = await prisma.varianteSKU.create({
        data: {
          producto_maestro_id: productoMaestro.id,
          sku: `QA-H8-SVC-${sufijo}-${caso}`,
          talle: "M",
          color: "Negro",
          genero: "Unisex",
          modelo: "QA-H8",
          proveedor_id: proveedorId,
        },
        select: { id: true },
      });
      variantesFixture.push(variante.id);
      return variante.id;
    }

    async function crearVersionPublicada(
      proveedorId: string,
      items: { variante_sku_id: string; precio_unitario: number }[],
    ) {
      const lista = await prisma.listaPrecio.create({
        data: { proveedor_id: proveedorId },
        select: { id: true },
      });
      return prisma.listaPrecioVersion.create({
        data: {
          lista_precio_id: lista.id,
          fecha_inicio_vigencia: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          variacion_porcentual_maxima: 0,
          requiere_aprobacion: false,
          publicada: true,
          items: { create: items },
        },
        select: { id: true },
      });
    }

    await t.test(
      "Hallazgo 9 — 2 ListaPrecioItem activos para la misma variante-versión lanzan DUPLICADO_LISTA_PRECIO_ITEM",
      async () => {
        const proveedorDuplicado = await crearProveedorHomologado("DUP");
        const proveedorSano = await crearProveedorHomologado("SANO");
        const varianteId = await crearVariante("DUP", proveedorDuplicado);

        // Candidato corrupto: dos ítems activos, precios distintos, misma
        // variante-versión. Sin la guarda, `findFirst` tomaba uno cualquiera.
        const versionCorrupta = await crearVersionPublicada(proveedorDuplicado, [
          { variante_sku_id: varianteId, precio_unitario: 1000 },
          { variante_sku_id: varianteId, precio_unitario: 1200 },
        ]);
        // Candidato sano más caro: si el servicio ignorara al corrupto, este
        // "ganaría" y el error pasaría desapercibido.
        await crearVersionPublicada(proveedorSano, [
          { variante_sku_id: varianteId, precio_unitario: 5000 },
        ]);

        await assert.rejects(
          obtenerCostoReposicionVigente(varianteId),
          (err: unknown) => {
            assert.ok(err instanceof ServiceError);
            assert.equal(err.code, "DUPLICADO_LISTA_PRECIO_ITEM");
            assert.match(err.message, new RegExp(versionCorrupta.id));
            return true;
          },
        );
      },
    );

    await t.test(
      "Hallazgo 9 — control: con un solo ítem por variante-versión resuelve normal",
      async () => {
        const proveedorId = await crearProveedorHomologado("UNICO");
        const varianteId = await crearVariante("UNICO", proveedorId);
        await crearVersionPublicada(proveedorId, [
          { variante_sku_id: varianteId, precio_unitario: 1500 },
        ]);

        const resultado = await obtenerCostoReposicionVigente(varianteId);
        assert.ok(resultado);
        assert.equal(resultado.proveedor_id, proveedorId);
        assert.equal(resultado.precio_unitario, 1500);
      },
    );
  },
);
