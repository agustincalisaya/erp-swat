import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end de HU-H8 (`GET /api/proveedores/costo-reposicion/[variante_sku_id]`)
 * — mismo patrón que `pedido-venta.http.integration.test.ts`/`rbac-hu-b8.integration.test.ts`:
 * `withPermission()` depende de `cookies()` de `next/headers` (AsyncLocalStorage
 * poblado solo por el runtime real de Next al atender un request), así que
 * 401/403/200 de sesión real solo se pueden verificar pegando contra un
 * servidor real (`npm run dev` / `next start`), no invocando el `route.ts` a
 * mano.
 *
 * El permiso `proveedores:leer_costo_reposicion` (T1) es servicio-a-servicio
 * y no está asignado a ningún Rol del seed (propose_HU-H8_FINAL.md §2.2) —
 * este archivo arma su propio fixture de Rol/Usuario con el permiso
 * otorgado, y lo limpia por completo en `after()`, junto con los
 * `Proveedor`/`VarianteSKU`/`ListaPrecio*` creados para cada caso. No se
 * modifica `prisma/seed.ts`.
 *
 * Cada caso usa su(s) PROPIO(S) `Proveedor` dedicado, nunca uno compartido
 * entre casos: `resolverListaPrecioVigente` (HU-H2) resuelve la versión
 * vigente de un proveedor de forma GLOBAL (la de `fecha_inicio_vigencia`
 * más reciente entre TODAS sus `ListaPrecioVersion`, sin filtrar por
 * variante) y recién después chequea si esa versión puntual trae un ítem
 * para la variante pedida — sin "buscar más atrás" si no lo trae (decisión
 * de diseño ya cerrada de HU-H2, ver `lista-precios.service.ts:229-243`).
 * Si un mismo proveedor fixture se reutilizara en dos casos con fechas
 * distintas, el caso con la fecha más vieja perdería su propio ítem: la
 * versión "vigente" real pasaría a ser la del otro caso. Un proveedor por
 * caso evita esta contaminación cruzada por completo.
 *
 * Nota sobre las queries SQL de evidencia: `listas_precio_version` NO
 * tiene una columna `proveedor_id` propia (esa FK vive en `listas_precio`,
 * su padre) — el join correcto es
 * `listas_precio_item → listas_precio_version → listas_precio → proveedores`.
 * El dataset de ejemplo de `spec_HU-H8_FINAL.md` §6 asume incorrectamente
 * `lpv.proveedor_id` en sus 6 queries de evidencia (confirmado real acá:
 * `psql` rechaza esa columna con `column lpv.proveedor_id does not exist`) —
 * hallazgo nuevo, reportado aparte; este archivo usa el join real de 4
 * tablas.
 *
 * Opt-in vía `HU_H8_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"),
 * `skip` si no está seteada — mismo patrón de integración opcional que
 * `test:integration:b4-http`/`test:integration:b8`.
 */

const BASE_URL = process.env.HU_H8_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

// Usuario seed sin el permiso `proveedores:leer_costo_reposicion` (nadie lo
// tiene — T1 lo dejó sin asignar a ningún rol humano de producción).
const EMAIL_SIN_PERMISO = "comprador.seed@erp-swat.local";

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
  "HU-H8 — GET /api/proveedores/costo-reposicion/[variante_sku_id] contra un servidor real (200/400/403/401/404)",
  { skip: !BASE_URL, timeout: 60_000 },
  async (t) => {
    const baseUrl = BASE_URL!;
    const [{ prisma }] = await Promise.all([import("../../db/prisma.ts")]);
    t.after(() => prisma.$disconnect());

    const sufijo = Date.now().toString(36);

    const productoMaestro = await prisma.productoMaestro.findFirstOrThrow({
      select: { id: true },
    });

    async function crearProveedorHomologado(nombre: string) {
      return prisma.proveedor.create({
        data: {
          razon_social: `QA HU-H8 ${nombre} ${sufijo}`,
          cuit: `20-${sufijo}-${nombre}`,
          categorias: [],
          estado: "HOMOLOGADO",
        },
        select: { id: true },
      });
    }

    async function crearVariante(nombre: string, proveedorHabitualId: string) {
      return prisma.varianteSKU.create({
        data: {
          producto_maestro_id: productoMaestro.id,
          sku: `QA-H8-${sufijo}-${nombre}`,
          talle: "M",
          color: "Negro",
          genero: "Unisex",
          modelo: "QA-H8",
          proveedor_id: proveedorHabitualId,
        },
        select: { id: true },
      });
    }

    const dias = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    async function crearVersionPublicada(
      proveedorId: string,
      fechaInicioVigencia: Date,
      items: { variante_sku_id: string; precio_unitario: number; is_active?: boolean }[],
    ) {
      const lista = await prisma.listaPrecio.create({
        data: { proveedor_id: proveedorId },
        select: { id: true },
      });
      const version = await prisma.listaPrecioVersion.create({
        data: {
          lista_precio_id: lista.id,
          fecha_inicio_vigencia: fechaInicioVigencia,
          variacion_porcentual_maxima: 0,
          requiere_aprobacion: false,
          publicada: true,
        },
        select: { id: true },
      });
      for (const item of items) {
        await prisma.listaPrecioItem.create({
          data: {
            lista_precio_version_id: version.id,
            variante_sku_id: item.variante_sku_id,
            precio_unitario: item.precio_unitario,
            is_active: item.is_active ?? true,
          },
        });
      }
      return { listaId: lista.id, versionId: version.id };
    }

    // ── Proveedores dedicados: uno (o dos/tres) por caso, nunca compartidos
    // entre casos (ver nota de cabecera) ──────────────────────────────────
    const [proveedorC1, proveedorC2A, proveedorC2B, proveedorC3A, proveedorC3B, proveedorC3bA, proveedorC3bB, proveedorC6, proveedorC8] =
      await Promise.all([
        crearProveedorHomologado("C1"),
        crearProveedorHomologado("C2A"),
        crearProveedorHomologado("C2B"),
        crearProveedorHomologado("C3A"),
        crearProveedorHomologado("C3B"),
        crearProveedorHomologado("C3bA"),
        crearProveedorHomologado("C3bB"),
        crearProveedorHomologado("C6"),
        crearProveedorHomologado("C8"),
      ]);

    const todosLosProveedoresFixture = [
      proveedorC1,
      proveedorC2A,
      proveedorC2B,
      proveedorC3A,
      proveedorC3B,
      proveedorC3bA,
      proveedorC3bB,
      proveedorC6,
      proveedorC8,
    ].map((p) => p.id);

    const [varianteCaso1, varianteCaso2, varianteCaso3, varianteCaso3b, varianteCaso8, varianteCaso6] =
      await Promise.all([
        crearVariante("C1", proveedorC1.id),
        crearVariante("C2", proveedorC2A.id),
        crearVariante("C3", proveedorC3A.id),
        crearVariante("C3B", proveedorC3bA.id),
        crearVariante("C8", proveedorC8.id),
        crearVariante("C6", proveedorC6.id),
      ]);

    // Variante SIN ningún ListaPrecioItem en toda la base (relevamiento
    // manual previo: única variante libre del seed real). Caso 4 no
    // necesita fixture propio: es el estado natural.
    const VARIANTE_SIN_CANDIDATOS_ID = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";

    // Caso 1 — único candidato: proveedorC1 a 1500.
    await crearVersionPublicada(proveedorC1.id, dias(5), [
      { variante_sku_id: varianteCaso1.id, precio_unitario: 1500 },
    ]);

    // Caso 2 — multi candidato, distinto precio: C2A=1500, C2B=1350 (gana C2B).
    await Promise.all([
      crearVersionPublicada(proveedorC2A.id, dias(5), [
        { variante_sku_id: varianteCaso2.id, precio_unitario: 1500 },
      ]),
      crearVersionPublicada(proveedorC2B.id, dias(5), [
        { variante_sku_id: varianteCaso2.id, precio_unitario: 1350 },
      ]),
    ]);

    // Caso 3 — empate exacto de precio, fecha distinta: C3A (más vieja,
    // 10d) vs C3B (más nueva, 3d) a 1350 — gana C3B por fecha más reciente.
    await Promise.all([
      crearVersionPublicada(proveedorC3A.id, dias(10), [
        { variante_sku_id: varianteCaso3.id, precio_unitario: 1350 },
      ]),
      crearVersionPublicada(proveedorC3B.id, dias(3), [
        { variante_sku_id: varianteCaso3.id, precio_unitario: 1350 },
      ]),
    ]);

    // Caso 3b — desempate terciario: C3bA vs C3bB, mismo precio Y misma
    // fecha exacta — gana el proveedor_id lexicográficamente menor.
    const fechaEmpateTerciario = dias(4);
    await Promise.all([
      crearVersionPublicada(proveedorC3bA.id, fechaEmpateTerciario, [
        { variante_sku_id: varianteCaso3b.id, precio_unitario: 1350 },
      ]),
      crearVersionPublicada(proveedorC3bB.id, fechaEmpateTerciario, [
        { variante_sku_id: varianteCaso3b.id, precio_unitario: 1350 },
      ]),
    ]);

    // Caso 8 — único candidato pero con el ítem borrado lógicamente.
    await crearVersionPublicada(proveedorC8.id, dias(5), [
      { variante_sku_id: varianteCaso8.id, precio_unitario: 1500, is_active: false },
    ]);

    // Caso 6 — no-cache: versión inicial a 1500 (creada directo, fecha
    // pasada). La segunda versión se publica DURANTE el test vía el
    // endpoint real de HU-H2.
    await crearVersionPublicada(proveedorC6.id, dias(5), [
      { variante_sku_id: varianteCaso6.id, precio_unitario: 1500 },
    ]);

    // ── Fixture de permiso: Rol + Usuario propios de este archivo, con
    // `proveedores:leer_costo_reposicion` (T1, sin asignar a ningún rol de
    // producción) y `proveedores:publicar_lista` (HU-H2, necesario solo
    // para que el fixture pueda ejecutar el POST del Caso 6) ─────────────
    const { hashPassword } = await import("../../auth/password-hash-core.ts");
    const passwordHash = await hashPassword(PASSWORD_SEED);

    const [permisoCostoReposicion, permisoPublicarLista] = await Promise.all([
      prisma.permiso.findFirstOrThrow({
        where: { codigo: "proveedores:leer_costo_reposicion" },
        select: { id: true },
      }),
      prisma.permiso.findFirstOrThrow({
        where: { codigo: "proveedores:publicar_lista" },
        select: { id: true },
      }),
    ]);

    const rolFixture = await prisma.rol.create({
      data: { nombre: `QA HU-H8 Test Role ${sufijo}` },
      select: { id: true },
    });
    await Promise.all([
      prisma.rolPermiso.create({
        data: { rol_id: rolFixture.id, permiso_id: permisoCostoReposicion.id },
      }),
      prisma.rolPermiso.create({
        data: { rol_id: rolFixture.id, permiso_id: permisoPublicarLista.id },
      }),
    ]);

    const usuarioFixture = await prisma.usuario.create({
      data: {
        nombre_usuario: `qa.hu-h8.${sufijo}`,
        email: `qa.hu-h8.${sufijo}@erp-swat.local`,
        password_hash: passwordHash.hash,
        password_salt: passwordHash.salt,
        nombre_completo: "QA HU-H8 Fixture",
      },
      select: { id: true, email: true },
    });
    await prisma.usuarioRol.create({
      data: { usuario_id: usuarioFixture.id, rol_id: rolFixture.id },
    });

    t.after(async () => {
      await prisma.listaPrecioItem.deleteMany({
        where: { lista_precio_version: { lista_precio: { proveedor_id: { in: todosLosProveedoresFixture } } } },
      });
      await prisma.listaPrecioVersion.deleteMany({
        where: { lista_precio: { proveedor_id: { in: todosLosProveedoresFixture } } },
      });
      await prisma.listaPrecio.deleteMany({
        where: { proveedor_id: { in: todosLosProveedoresFixture } },
      });
      await prisma.varianteSKU.deleteMany({
        where: {
          id: {
            in: [
              varianteCaso1.id,
              varianteCaso2.id,
              varianteCaso3.id,
              varianteCaso3b.id,
              varianteCaso8.id,
              varianteCaso6.id,
            ],
          },
        },
      });
      await prisma.proveedor.deleteMany({ where: { id: { in: todosLosProveedoresFixture } } });

      // `Usuario`/`Rol` de fixture: soft-delete, no `.delete()` — el POST
      // real del Caso 6 dejó un `AuditLog` con `usuario_id` apuntando a
      // este usuario (`onDelete: Restrict`, ledger append-only, nunca se
      // borra ni se reescribe). Se limpia primero la `Sesion` real que dejó
      // el login (esa sí no es inmutable) y se da de baja lógica al Rol y
      // al Usuario — mismo patrón que la baja real de un usuario del
      // sistema, no un dato de test viviendo activo en la base.
      await prisma.sesion.deleteMany({ where: { usuario_id: usuarioFixture.id } });
      await prisma.usuarioRol.deleteMany({ where: { usuario_id: usuarioFixture.id } });
      await prisma.rolPermiso.deleteMany({ where: { rol_id: rolFixture.id } });
      await prisma.usuario.update({
        where: { id: usuarioFixture.id },
        data: { is_active: false, deleted_at: new Date(), deletion_reason: "Fixture de test HU-H8 (costo-reposicion.http.integration.test.ts)" },
      });
      await prisma.rol.update({
        where: { id: rolFixture.id },
        data: { is_active: false, deleted_at: new Date(), deletion_reason: "Fixture de test HU-H8 (costo-reposicion.http.integration.test.ts)" },
      });
    });

    const cookieConPermiso = await loginReal(baseUrl, usuarioFixture.email);

    // ── Caso 1 — camino feliz, candidato único ──────────────────────────
    await t.test("Caso 1 — candidato único: 200 con el precio y proveedor correctos", async () => {
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso1.id}`, {
        headers: { Cookie: cookieConPermiso },
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.variante_sku_id, varianteCaso1.id);
      assert.equal(body.data.proveedor_id, proveedorC1.id);
      assert.equal(body.data.precio_unitario, 1500);
      assert.equal(body.data.criterio_seleccion, "MENOR_PRECIO_VIGENTE");
      assert.equal(body.error, null);

      const filaSql = await prisma.$queryRaw<{ precio_unitario: unknown }[]>`
        SELECT lpi.precio_unitario
        FROM listas_precio_item lpi
        JOIN listas_precio_version lpv ON lpv.id = lpi.lista_precio_version_id
        JOIN listas_precio lp ON lp.id = lpv.lista_precio_id
        JOIN proveedores p ON p.id = lp.proveedor_id
        WHERE lpi.variante_sku_id = ${varianteCaso1.id}
          AND lpi.is_active = true AND p.estado = 'HOMOLOGADO' AND p.is_active = true
          AND lpv.publicada = true
      `;
      assert.equal(filaSql.length, 1);
      assert.equal(Number(filaSql[0]!.precio_unitario), 1500);
    });

    // ── Caso 2 — múltiples candidatos, gana el menor precio ─────────────
    await t.test("Caso 2 — múltiples candidatos: gana el de menor precio (C2B, 1350)", async () => {
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso2.id}`, {
        headers: { Cookie: cookieConPermiso },
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.proveedor_id, proveedorC2B.id);
      assert.equal(body.data.precio_unitario, 1350);

      const filasSql = await prisma.$queryRaw<{ proveedor_id: string; precio: unknown }[]>`
        SELECT p.id AS proveedor_id, MIN(lpi.precio_unitario) AS precio
        FROM listas_precio_item lpi
        JOIN listas_precio_version lpv ON lpv.id = lpi.lista_precio_version_id
        JOIN listas_precio lp ON lp.id = lpv.lista_precio_id
        JOIN proveedores p ON p.id = lp.proveedor_id
        WHERE lpi.variante_sku_id = ${varianteCaso2.id}
          AND lpi.is_active = true AND p.estado = 'HOMOLOGADO' AND p.is_active = true
          AND lpv.publicada = true
        GROUP BY p.id
        ORDER BY precio ASC
      `;
      assert.equal(filasSql[0]!.proveedor_id, proveedorC2B.id);
    });

    // ── Caso 3 — empate exacto de precio → desempate por fecha ──────────
    await t.test("Caso 3 — empate exacto de precio: gana la fecha_inicio_vigencia más reciente", async () => {
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso3.id}`, {
        headers: { Cookie: cookieConPermiso },
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.proveedor_id, proveedorC3B.id, "C3B tiene la fecha_inicio_vigencia más reciente");
      assert.equal(body.data.precio_unitario, 1350);

      const filasSql = await prisma.$queryRaw<{ proveedor_id: string; fecha_inicio_vigencia: Date }[]>`
        SELECT p.id AS proveedor_id, lpv.fecha_inicio_vigencia
        FROM listas_precio_item lpi
        JOIN listas_precio_version lpv ON lpv.id = lpi.lista_precio_version_id
        JOIN listas_precio lp ON lp.id = lpv.lista_precio_id
        JOIN proveedores p ON p.id = lp.proveedor_id
        WHERE lpi.variante_sku_id = ${varianteCaso3.id}
          AND lpi.is_active = true AND p.estado = 'HOMOLOGADO' AND p.is_active = true
          AND lpv.publicada = true
        ORDER BY lpi.precio_unitario ASC, lpv.fecha_inicio_vigencia DESC, p.id ASC
      `;
      assert.equal(filasSql[0]!.proveedor_id, proveedorC3B.id);
    });

    // ── Caso 3b — desempate terciario por proveedor_id ASC ──────────────
    await t.test("Caso 3b — empate de precio Y fecha: gana el proveedor_id lexicográficamente menor", async () => {
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso3b.id}`, {
        headers: { Cookie: cookieConPermiso },
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      const ganadorEsperado = proveedorC3bA.id < proveedorC3bB.id ? proveedorC3bA.id : proveedorC3bB.id;
      assert.equal(body.data.proveedor_id, ganadorEsperado);
    });

    // ── Caso 4 — sin candidato → 404 ─────────────────────────────────────
    await t.test("Caso 4 — variante sin candidato: 404 SIN_COSTO_REPOSICION_DISPONIBLE", async () => {
      const res = await fetch(
        `${baseUrl}/api/proveedores/costo-reposicion/${VARIANTE_SIN_CANDIDATOS_ID}`,
        { headers: { Cookie: cookieConPermiso } },
      );
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "SIN_COSTO_REPOSICION_DISPONIBLE");
      assert.equal(body.data, null);

      const conteoSql = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM listas_precio_item lpi
        JOIN listas_precio_version lpv ON lpv.id = lpi.lista_precio_version_id
        JOIN listas_precio lp ON lp.id = lpv.lista_precio_id
        JOIN proveedores p ON p.id = lp.proveedor_id
        WHERE lpi.variante_sku_id = ${VARIANTE_SIN_CANDIDATOS_ID}
          AND lpi.is_active = true AND p.estado = 'HOMOLOGADO' AND p.is_active = true
          AND lpv.publicada = true
      `;
      assert.equal(Number(conteoSql[0]!.count), 0);
    });

    // ── Caso 5 — formato inválido → 400 ──────────────────────────────────
    await t.test("Caso 5 — variante_sku_id con formato inválido: 400 VALIDATION_ERROR", async (t2) => {
      const invalidos = ["no-es-un-uuid", "12345", "a1b2c3d4-0001-4000-8000"];
      for (const invalido of invalidos) {
        await t2.test(`"${invalido}" → 400`, async () => {
          const res = await fetch(
            `${baseUrl}/api/proveedores/costo-reposicion/${encodeURIComponent(invalido)}`,
            { headers: { Cookie: cookieConPermiso } },
          );
          const body = await res.json();
          assert.equal(res.status, 400, JSON.stringify(body));
          assert.equal(body.error.code, "VALIDATION_ERROR");
          assert.equal(body.data, null);
        });
      }
      // Que no se ejecuta ninguna query en paso B: verificado por inspección
      // de código, no por intercepción de queries (route.ts:49-60): el
      // `safeParse` corta con `return` antes de cualquier llamada a
      // `obtenerCostoReposicionVigente()`.
    });

    // ── Caso 6 — verificación de no-cache ────────────────────────────────
    await t.test("Caso 6 — no-cache: el segundo GET refleja la nueva versión sin reiniciar el proceso", async () => {
      const primerRes = await fetch(
        `${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso6.id}`,
        { headers: { Cookie: cookieConPermiso } },
      );
      const primerBody = await primerRes.json();
      assert.equal(primerRes.status, 200, JSON.stringify(primerBody));
      assert.equal(primerBody.data.precio_unitario, 1500);

      const publicarRes = await fetch(`${baseUrl}/api/proveedores/${proveedorC6.id}/lista-precios`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieConPermiso },
        body: JSON.stringify({
          fecha_inicio_vigencia: new Date().toISOString(),
          items: [{ variante_sku_id: varianteCaso6.id, precio_unitario: 1650 }],
        }),
      });
      const publicarBody = await publicarRes.json();
      assert.equal(publicarRes.status, 201, JSON.stringify(publicarBody));
      assert.equal(publicarBody.data.publicada, true, "10% de variación no debe requerir aprobación (umbral 20%)");

      const segundoRes = await fetch(
        `${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso6.id}`,
        { headers: { Cookie: cookieConPermiso } },
      );
      const segundoBody = await segundoRes.json();
      assert.equal(segundoRes.status, 200, JSON.stringify(segundoBody));
      assert.equal(segundoBody.data.precio_unitario, 1650);

      const filaSql = await prisma.$queryRaw<{ precio_unitario: unknown }[]>`
        SELECT lpi.precio_unitario
        FROM listas_precio lp
        JOIN listas_precio_version lpv ON lpv.lista_precio_id = lp.id
        JOIN listas_precio_item lpi ON lpi.lista_precio_version_id = lpv.id
        WHERE lp.proveedor_id = ${proveedorC6.id}
          AND lpi.variante_sku_id = ${varianteCaso6.id}
          AND lpi.is_active = true AND lpv.publicada = true
        ORDER BY lpv.fecha_inicio_vigencia DESC LIMIT 1
      `;
      assert.equal(Number(filaSql[0]!.precio_unitario), 1650);
    });

    // ── Caso 7 — autorización ─────────────────────────────────────────
    await t.test("Caso 7 — sin sesión: 401", async () => {
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso1.id}`);
      assert.equal(res.status, 401);
    });

    await t.test("Caso 7 — sesión sin el permiso: 403", async () => {
      const cookieSinPermiso = await loginReal(baseUrl, EMAIL_SIN_PERMISO);
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso1.id}`, {
        headers: { Cookie: cookieSinPermiso },
      });
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
    });

    await t.test("Caso 7 — sesión con el permiso: accede con éxito (200)", async () => {
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso1.id}`, {
        headers: { Cookie: cookieConPermiso },
      });
      assert.equal(res.status, 200);
    });

    // ── Caso 8 — ítem con borrado lógico → 404, no costo fantasma ───────
    await t.test("Caso 8 — ítem con is_active=false: 404, no expone el precio borrado", async () => {
      const res = await fetch(`${baseUrl}/api/proveedores/costo-reposicion/${varianteCaso8.id}`, {
        headers: { Cookie: cookieConPermiso },
      });
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "SIN_COSTO_REPOSICION_DISPONIBLE");

      const filaSql = await prisma.$queryRaw<{ is_active: boolean }[]>`
        SELECT lpi.is_active
        FROM listas_precio_item lpi
        JOIN listas_precio_version lpv ON lpv.id = lpi.lista_precio_version_id
        JOIN listas_precio lp ON lp.id = lpv.lista_precio_id
        JOIN proveedores p ON p.id = lp.proveedor_id
        WHERE lpi.variante_sku_id = ${varianteCaso8.id}
          AND p.estado = 'HOMOLOGADO' AND p.is_active = true AND lpv.publicada = true
      `;
      assert.equal(filaSql.length, 1);
      assert.equal(filaSql[0]!.is_active, false);
    });
  },
);
