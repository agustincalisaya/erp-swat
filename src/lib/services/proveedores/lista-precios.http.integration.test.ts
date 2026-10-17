import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end de HU-H2 — `POST /api/proveedores/[id]/lista-precios`
 * y `PATCH /api/proveedores/[id]/lista-precios/[version_id]/aprobar` — contra
 * un servidor real (`npm run dev` / `next start`): `withPermission()`
 * depende de `cookies()` de `next/headers`, que solo existe dentro del
 * runtime real de Next (mismo motivo que
 * `costo-reposicion.http.integration.test.ts`).
 *
 * Cubre (1) el rechazo de variantes repetidas en el body del `POST`
 * (`422 ITEMS_DUPLICADOS`, no `VARIANTE_SKU_INEXISTENTE`) y (2) la
 * pertenencia versión ↔ proveedor del path del `PATCH .../aprobar`: el `id`
 * de la URL debe ser el dueño real de la versión (vía
 * `listas_precio.proveedor_id`); si no,
 * `404 VERSION_INEXISTENTE` sin aprobar nada — mismo criterio que
 * `DIRECCION_NO_ENCONTRADA` en `PATCH /api/clientes/[id]/direcciones/[direccionId]`.
 *
 * Arma su propio Rol/Usuario con `proveedores:publicar_lista` +
 * `proveedores:publicar_lista_critica` y lo da de baja lógica en `after()` (la aprobación deja un `AuditLog` que
 * referencia al usuario — ledger append-only, no se borra).
 *
 * Opt-in vía `HU_H2_INTEGRATION_BASE_URL` (ej. "http://localhost:3100").
 */

const BASE_URL = process.env.HU_H2_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

async function loginReal(baseUrl: string, email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login falló para ${email}: ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login para ${email} no devolvió cookie de sesión`);
  return setCookie!.split(";")[0]!;
}

test(
  "HU-H2 — POST .../lista-precios y PATCH .../[version_id]/aprobar contra un servidor real",
  { skip: !BASE_URL, timeout: 60_000 },
  async (t) => {
    const baseUrl = BASE_URL!;
    const { prisma } = await import("../../db/prisma.ts");

    const sufijo = Date.now().toString(36);
    const productoMaestro = await prisma.productoMaestro.findFirstOrThrow({
      select: { id: true },
    });

    async function crearProveedorHomologado(caso: string) {
      return prisma.proveedor.create({
        data: {
          razon_social: `QA HU-H2 http ${caso} ${sufijo}`,
          cuit: `20-${sufijo}-http${caso}`,
          categorias: [],
          estado: "HOMOLOGADO",
        },
        select: { id: true },
      });
    }

    const [proveedorDueno, proveedorAjeno] = await Promise.all([
      crearProveedorHomologado("DUENO"),
      crearProveedorHomologado("AJENO"),
    ]);
    const proveedoresFixture = [proveedorDueno.id, proveedorAjeno.id];

    const variante = await prisma.varianteSKU.create({
      data: {
        producto_maestro_id: productoMaestro.id,
        sku: `QA-H2-HTTP-${sufijo}`,
        talle: "M",
        color: "Negro",
        genero: "Unisex",
        modelo: "QA-H2",
        proveedor_id: proveedorDueno.id,
      },
      select: { id: true },
    });

    // Versión pendiente de aprobación (superó el umbral crítico) del dueño.
    const lista = await prisma.listaPrecio.create({
      data: { proveedor_id: proveedorDueno.id },
      select: { id: true },
    });
    const versionPendiente = await prisma.listaPrecioVersion.create({
      data: {
        lista_precio_id: lista.id,
        fecha_inicio_vigencia: new Date(),
        variacion_porcentual_maxima: 50,
        requiere_aprobacion: true,
        publicada: false,
        items: {
          create: [{ variante_sku_id: variante.id, precio_unitario: 1500 }],
        },
      },
      select: { id: true },
    });

    const { hashPassword } = await import("../../auth/password-hash-core.ts");
    const passwordHash = await hashPassword(PASSWORD_SEED);
    const [permisoAprobar, permisoPublicar] = await Promise.all([
      prisma.permiso.findFirstOrThrow({
        where: { codigo: "proveedores:publicar_lista_critica" },
        select: { id: true },
      }),
      prisma.permiso.findFirstOrThrow({
        where: { codigo: "proveedores:publicar_lista" },
        select: { id: true },
      }),
    ]);
    const rolFixture = await prisma.rol.create({
      data: { nombre: `QA HU-H2 Test Role ${sufijo}` },
      select: { id: true },
    });
    await prisma.rolPermiso.createMany({
      data: [
        { rol_id: rolFixture.id, permiso_id: permisoAprobar.id },
        { rol_id: rolFixture.id, permiso_id: permisoPublicar.id },
      ],
    });
    const usuarioFixture = await prisma.usuario.create({
      data: {
        nombre_usuario: `qa.hu-h2.${sufijo}`,
        email: `qa.hu-h2.${sufijo}@erp-swat.local`,
        password_hash: passwordHash.hash,
        password_salt: passwordHash.salt,
        nombre_completo: "QA HU-H2 Fixture",
      },
      select: { id: true, email: true },
    });
    await prisma.usuarioRol.create({
      data: { usuario_id: usuarioFixture.id, rol_id: rolFixture.id },
    });

    t.after(async () => {
      const filtroProveedor = { proveedor_id: { in: proveedoresFixture } };
      await prisma.listaPrecioItem.deleteMany({
        where: { lista_precio_version: { lista_precio: filtroProveedor } },
      });
      await prisma.listaPrecioVersion.deleteMany({
        where: { lista_precio: filtroProveedor },
      });
      await prisma.listaPrecio.deleteMany({ where: filtroProveedor });
      await prisma.varianteSKU.delete({ where: { id: variante.id } });
      await prisma.proveedor.deleteMany({ where: { id: { in: proveedoresFixture } } });

      const baja = {
        is_active: false,
        deleted_at: new Date(),
        deletion_reason: "Fixture de test HU-H2 (lista-precios.http.integration.test.ts)",
      };
      await prisma.sesion.deleteMany({ where: { usuario_id: usuarioFixture.id } });
      await prisma.usuarioRol.deleteMany({ where: { usuario_id: usuarioFixture.id } });
      await prisma.rolPermiso.deleteMany({ where: { rol_id: rolFixture.id } });
      await prisma.usuario.update({ where: { id: usuarioFixture.id }, data: baja });
      await prisma.rol.update({ where: { id: rolFixture.id }, data: baja });
      await prisma.$disconnect();
    });

    const cookie = await loginReal(baseUrl, usuarioFixture.email);
    const aprobar = (proveedorId: string, versionId: string) =>
      fetch(
        `${baseUrl}/api/proveedores/${proveedorId}/lista-precios/${versionId}/aprobar`,
        { method: "PATCH", headers: { Cookie: cookie } },
      );

    await t.test(
      "Hallazgo 4 — POST con la misma variante repetida: 422 ITEMS_DUPLICADOS, no VARIANTE_SKU_INEXISTENTE",
      async () => {
        const res = await fetch(`${baseUrl}/api/proveedores/${proveedorDueno.id}/lista-precios`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            fecha_inicio_vigencia: new Date().toISOString(),
            items: [
              { variante_sku_id: variante.id, precio_unitario: 1000 },
              { variante_sku_id: variante.id, precio_unitario: 1200 },
            ],
          }),
        });
        const body = await res.json();
        assert.equal(res.status, 422, JSON.stringify(body));
        assert.deepEqual(body, {
          data: null,
          error: {
            code: "ITEMS_DUPLICADOS",
            message: "La lista no puede incluir la misma variante en más de un ítem",
          },
        });

        // No se creó ninguna versión nueva: solo existe la pendiente del fixture.
        const versiones = await prisma.listaPrecioVersion.count({
          where: { lista_precio: { proveedor_id: proveedorDueno.id } },
        });
        assert.equal(versiones, 1);
      },
    );

    await t.test(
      "Hallazgo 1 — proveedor del path que NO es dueño de la versión: 404 VERSION_INEXISTENTE, no aprueba",
      async () => {
        const res = await aprobar(proveedorAjeno.id, versionPendiente.id);
        const body = await res.json();
        assert.equal(res.status, 404, JSON.stringify(body));
        assert.equal(body.data, null);
        assert.equal(body.error.code, "VERSION_INEXISTENTE");

        const persistida = await prisma.listaPrecioVersion.findUniqueOrThrow({
          where: { id: versionPendiente.id },
          select: { publicada: true, aprobada_por_id: true },
        });
        assert.equal(persistida.publicada, false);
        assert.equal(persistida.aprobada_por_id, null);
      },
    );

    await t.test(
      "Hallazgo 1 — id de proveedor con formato inválido: 400 VALIDATION_ERROR",
      async () => {
        const res = await aprobar("no-es-un-uuid", versionPendiente.id);
        const body = await res.json();
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(body.error.code, "VALIDATION_ERROR");
      },
    );

    await t.test(
      "Hallazgo 1 — control: el dueño real aprueba (200) y la versión queda publicada",
      async () => {
        const res = await aprobar(proveedorDueno.id, versionPendiente.id);
        const body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.equal(body.error, null);
        assert.equal(body.data.lista_precio_version_id, versionPendiente.id);
        assert.equal(body.data.publicada, true);
        assert.equal(body.data.aprobada_por_id, usuarioFixture.id);
      },
    );
  },
);
