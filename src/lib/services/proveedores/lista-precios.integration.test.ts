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
      // A3 — ordenes de compra creadas por el caso de `crearOrdenCompra`: se
      // borran ANTES que sus `VarianteSKU`/`Proveedor` (FK `onDelete:
      // Restrict`). Nunca se toca `AuditLog` (append-only).
      await prisma.ordenCompraItem.deleteMany({
        where: { orden_compra: filtroProveedor },
      });
      await prisma.ordenCompra.deleteMany({ where: filtroProveedor });
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

    // ────────────────────────────────────────────────────────────────────
    // A3 (auditoría transversal Módulo H, 2026-09-26) — reproduce EXACTO el
    // caso del audit: proveedor InduSur (acá, un proveedor QA dedicado),
    // versión previa con 2 variantes, versión nueva PARCIAL (1 sola
    // variante) — la variante omitida debe seguir resolviendo su precio
    // contra la versión anterior, tanto en `resolverListaPrecioVigente()`
    // como end-to-end vía `crearOrdenCompra()` (HU-H3, consumidor real).
    // ────────────────────────────────────────────────────────────────────

    await t.test(
      "A3 — una versión parcial NO deja sin precio a las variantes que no incluye (resolución por variante)",
      async () => {
        const ordenCompra = await import("./orden-compra.service.ts");

        const proveedor = await prisma.proveedor.create({
          data: {
            razon_social: `QA HU-H2 A3 ${sufijo}`,
            cuit: `20-${sufijo}-A3`,
            categorias: [],
            estado: "HOMOLOGADO",
          },
          select: { id: true },
        });
        proveedoresFixture.push(proveedor.id);

        const varianteA = await prisma.varianteSKU.create({
          data: {
            producto_maestro_id: productoMaestro.id,
            sku: `QA-H2-${sufijo}-A3-A`,
            talle: "M",
            color: "Verde",
            genero: "Unisex",
            modelo: "QA-H2-A3",
            proveedor_id: proveedor.id,
          },
          select: { id: true },
        });
        const varianteB = await prisma.varianteSKU.create({
          data: {
            producto_maestro_id: productoMaestro.id,
            sku: `QA-H2-${sufijo}-A3-B`,
            talle: "L",
            color: "Negro",
            genero: "Unisex",
            modelo: "QA-H2-A3",
            proveedor_id: proveedor.id,
          },
          select: { id: true },
        });
        // Variante SIN precio en ninguna versión — control del caso "sin
        // versión que la incluya" pedido en la tarea.
        const varianteSinPrecio = await prisma.varianteSKU.create({
          data: {
            producto_maestro_id: productoMaestro.id,
            sku: `QA-H2-${sufijo}-A3-C`,
            talle: "S",
            color: "Azul",
            genero: "Unisex",
            modelo: "QA-H2-A3",
            proveedor_id: proveedor.id,
          },
          select: { id: true },
        });
        variantesFixture.push(varianteA.id, varianteB.id, varianteSinPrecio.id);

        // Versión previa: ambas variantes con precio, publicada, vigente.
        await prisma.listaPrecioVersion.create({
          data: {
            lista_precio: { create: { proveedor_id: proveedor.id } },
            fecha_inicio_vigencia: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            variacion_porcentual_maxima: 0,
            requiere_aprobacion: false,
            publicada: true,
            items: {
              create: [
                { variante_sku_id: varianteA.id, precio_unitario: 100 },
                { variante_sku_id: varianteB.id, precio_unitario: 200 },
              ],
            },
          },
        });

        // Versión nueva PARCIAL: solo varianteA, 0% de variación (auto-publica).
        const versionParcial = await listaPrecios.publicarNuevaVersionListaPrecio(
          proveedor.id,
          new Date(),
          [{ variante_sku_id: varianteA.id, precio_unitario: 100 }],
          USUARIO_ID,
        );
        assert.equal(versionParcial.publicada, true);

        // 1. `resolverListaPrecioVigente()` — varianteA resuelve contra la
        //    versión nueva; varianteB (omitida) sigue resolviendo contra la
        //    versión anterior, NO devuelve null.
        const vigenteA = await listaPrecios.resolverListaPrecioVigente(proveedor.id, varianteA.id);
        assert.equal(vigenteA?.id, versionParcial.lista_precio_version_id);

        const vigenteB = await listaPrecios.resolverListaPrecioVigente(proveedor.id, varianteB.id);
        assert.ok(vigenteB, "varianteB (omitida por la versión parcial) debe seguir teniendo precio vigente");
        assert.notEqual(vigenteB!.id, versionParcial.lista_precio_version_id);

        const itemB = await prisma.listaPrecioItem.findFirst({
          where: { lista_precio_version_id: vigenteB!.id, variante_sku_id: varianteB.id },
          select: { precio_unitario: true },
        });
        assert.equal(itemB?.precio_unitario.toNumber(), 200);

        // 2. Control — una variante sin precio en NINGUNA versión publicada
        //    sigue sin resolver (no debe "heredar" nada).
        const vigenteSinPrecio = await listaPrecios.resolverListaPrecioVigente(
          proveedor.id,
          varianteSinPrecio.id,
        );
        assert.equal(vigenteSinPrecio, null);

        // 3. End-to-end (HU-H3, consumidor real): una OC que pide AMBAS
        //    variantes (A de la versión nueva, B de la anterior) debe poder
        //    crearse, congelando el precio correcto de cada una.
        const oc = await ordenCompra.crearOrdenCompra(
          {
            proveedor_id: proveedor.id,
            items: [
              { variante_sku_id: varianteA.id, cantidad_solicitada: 1 },
              { variante_sku_id: varianteB.id, cantidad_solicitada: 1 },
            ],
          },
          USUARIO_ID,
        );
        const itemsOc = await prisma.ordenCompraItem.findMany({
          where: { orden_compra_id: oc.orden_compra_id },
          select: { variante_sku_id: true, precio_unitario: true },
        });
        const precioPorSku = new Map(itemsOc.map((i) => [i.variante_sku_id, i.precio_unitario.toNumber()]));
        assert.equal(precioPorSku.get(varianteA.id), 100);
        assert.equal(precioPorSku.get(varianteB.id), 200);

        // 4. Control — una OC que pide la variante sin precio en ninguna
        //    versión debe rechazarse con SKU_SIN_PRECIO_VIGENTE.
        const { ServiceError } = await import("../../errors/service-error.ts");
        await assert.rejects(
          ordenCompra.crearOrdenCompra(
            {
              proveedor_id: proveedor.id,
              items: [{ variante_sku_id: varianteSinPrecio.id, cantidad_solicitada: 1 }],
            },
            USUARIO_ID,
          ),
          (err: unknown) => {
            assert.ok(err instanceof ServiceError);
            assert.equal(err.code, "SKU_SIN_PRECIO_VIGENTE");
            return true;
          },
        );
      },
    );

    // ────────────────────────────────────────────────────────────────────
    // Seguimiento post-A3 (2026-09-26, confirmado por el usuario) — vigencia
    // por DÍA DE NEGOCIO (Argentina), no por instante. Fechas sintéticas fijas
    // (no dependen del reloj real): `ahora` se inyecta directo en
    // `resolverListaPrecioVigente`.
    // ────────────────────────────────────────────────────────────────────

    await t.test(
      "Seguimiento A3 — una fecha-solo de MAÑANA no queda vigente hasta la medianoche real de Argentina",
      async () => {
        const proveedor = await prisma.proveedor.create({
          data: {
            razon_social: `QA HU-H2 VIG ${sufijo}`,
            cuit: `20-${sufijo}-VIG`,
            categorias: [],
            estado: "HOMOLOGADO",
          },
          select: { id: true },
        });
        proveedoresFixture.push(proveedor.id);

        const variante = await prisma.varianteSKU.create({
          data: {
            producto_maestro_id: productoMaestro.id,
            sku: `QA-H2-${sufijo}-VIG`,
            talle: "M",
            color: "Gris",
            genero: "Unisex",
            modelo: "QA-H2-VIG",
            proveedor_id: proveedor.id,
          },
          select: { id: true },
        });
        variantesFixture.push(variante.id);

        // Versión previa (control): siempre vigente, cualquiera sea `ahora`.
        await prisma.listaPrecioVersion.create({
          data: {
            lista_precio: { create: { proveedor_id: proveedor.id } },
            fecha_inicio_vigencia: new Date("2026-09-19T00:00:00.000Z"),
            variacion_porcentual_maxima: 0,
            requiere_aprobacion: false,
            publicada: true,
            items: { create: [{ variante_sku_id: variante.id, precio_unitario: 100 }] },
          },
        });

        // Versión con fecha_inicio_vigencia = fecha-solo "mañana" (medianoche
        // UTC exacta), publicada — sin insertar vía el service para que la
        // fecha quede EXACTA (0 componente horario), tal como la deja
        // `z.coerce.date()` sobre un `<input type="date">`.
        const listaPrecio = await prisma.listaPrecio.findFirstOrThrow({
          where: { proveedor_id: proveedor.id },
          select: { id: true },
        });
        const versionManana = await prisma.listaPrecioVersion.create({
          data: {
            lista_precio_id: listaPrecio.id,
            fecha_inicio_vigencia: new Date("2026-09-27T00:00:00.000Z"),
            variacion_porcentual_maxima: 0,
            requiere_aprobacion: false,
            publicada: true,
            items: { create: [{ variante_sku_id: variante.id, precio_unitario: 150 }] },
          },
          select: { id: true },
        });

        // A las 22:00 hora Argentina del día 26 (= 2026-09-27T01:00:00Z): la
        // versión de "mañana" NO debe estar vigente todavía.
        const antesDeMedianocheArgentina = await listaPrecios.resolverListaPrecioVigente(
          proveedor.id,
          variante.id,
          undefined,
          new Date("2026-09-27T01:00:00.000Z"),
        );
        assert.notEqual(
          antesDeMedianocheArgentina?.id,
          versionManana.id,
          "una fecha-solo de mañana no debe quedar vigente 3 h antes de la medianoche real de Argentina",
        );

        // Justo a la medianoche real de Argentina (2026-09-27T03:00:00Z): sí.
        const enMedianocheArgentina = await listaPrecios.resolverListaPrecioVigente(
          proveedor.id,
          variante.id,
          undefined,
          new Date("2026-09-27T03:00:00.000Z"),
        );
        assert.equal(enMedianocheArgentina?.id, versionManana.id);

        // Sin `ahora` explícito (firma retrocompatible, usa el reloj real):
        // no debe romper — devuelve la versión previa como mínimo (la de
        // "mañana" según el calendario sintético del test siempre queda en
        // el pasado real, así que HOY resuelve contra ella igual; solo
        // valida que la llamada de 3 argumentos sigue funcionando).
        const sinAhoraExplicito = await listaPrecios.resolverListaPrecioVigente(
          proveedor.id,
          variante.id,
        );
        assert.ok(sinAhoraExplicito, "la firma de 2-3 argumentos (retrocompatible) debe seguir funcionando");
      },
    );
  },
);
