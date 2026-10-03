import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-B9 — Nivel 2 (HTTP, login real) + Nivel 3 (verificación en BD) de
 * docs/tasks/HU-B9.md §7. Mismo patrón que `cuenta-corriente.http.integration.test.ts`:
 * `withPermission()` depende de `cookies()`, así que 401/403 solo se prueban
 * contra un servidor real apuntando a la base de test.
 *
 * Casos 1–16 de la tabla del task, en orden. Las versiones creadas se dan de
 * baja lógica al terminar (nunca DELETE) para que el test sea re-ejecutable.
 *
 * Opt-in: `HU_B9_INTEGRATION_BASE_URL` + `HU_B9_INTEGRATION_DATABASE_URL`
 * (la MISMA base a la que apunta el servidor); `skip` si falta alguna.
 */

const BASE_URL = process.env.HU_B9_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_B9_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";

const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";
const LISTA_ID = "16d1dbbf-b91e-4c07-93f0-007572d0d116";
const VERSION_1_ID = "f7bc2652-5022-4d5c-b235-be90b8f1677d";
const CT1 = "407e729d-47c3-404d-a89a-0a9c1f85a3db";
const CT2 = "6fbb4612-9e6d-4661-b250-0bc62579089e";
const CT3 = "0929aab1-57fb-44bc-90b6-76417c76c016";
const GORRA = "bc8d1631-2378-4c63-826f-16e2cc814eea";
const POLICIA = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";
const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

/** v1 del seed (task §2.1): costo HU-H8 y precio redondeado por el seed. */
const V1: Record<string, { precio: number; costo: number | null }> = {
  [CT1]: { precio: 21100, costo: 15600 },
  [CT2]: { precio: 22800, costo: 16900 },
  [CT3]: { precio: 21500, costo: 15950 },
  "864c2765-cbdd-41eb-837a-e12814b62868": { precio: 58700, costo: 43500 },
  "79f41b7f-a667-4867-b3cc-2c73f6134086": { precio: 56000, costo: 41500 },
};

async function loginReal(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
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
  "HU-B9 — endpoints de Lista de Precios de Venta contra un servidor real (casos 1–16 + BD)",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 180_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const { prisma } = await import("../../db/prisma.ts");

    const versionesCreadas: string[] = [];
    t.after(async () => {
      if (versionesCreadas.length > 0) {
        await prisma.listaPrecioVentaVersion.updateMany({
          where: { id: { in: versionesCreadas } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B9 http" },
        });
      }
      await prisma.$disconnect();
    });

    const supervisor = await loginReal("supervisor.ventas.seed@erp-swat.local");
    const cajero = await loginReal("cajero.seed@erp-swat.local");
    const adminEcommerce = await loginReal("admin.ecommerce.seed@erp-swat.local");
    const auditor = await loginReal("auditor.seed@erp-swat.local");
    const headers = (cookie?: string) => ({
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    });
    const urlVersiones = `${BASE_URL}/api/ventas/lista-precios/versiones`;
    const urlVigente = (id: string) => `${BASE_URL}/api/ventas/lista-precios/vigente?variante_sku_id=${id}`;
    const urlSugerencia = (id: string) => `${BASE_URL}/api/ventas/lista-precios/sugerencia/${id}`;

    async function publicar(body: unknown, cookie = supervisor) {
      const res = await fetch(urlVersiones, { method: "POST", headers: headers(cookie), body: JSON.stringify(body) });
      const json = await res.json();
      if (res.status === 201) versionesCreadas.push(json.data.version_id);
      return { status: res.status, body: json };
    }
    async function vigente(id: string) {
      const res = await fetch(urlVigente(id), { headers: headers(supervisor) });
      return { status: res.status, body: await res.json() };
    }

    const conteoVersionesInicial = await prisma.listaPrecioVentaVersion.count();

    await t.test("1 — sugerencia CT1 → 200, costo 15600, margen 0.35, sugerido 21060 (sin redondeo)", async () => {
      const res = await fetch(urlSugerencia(CT1), { headers: headers(supervisor) });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        data: { variante_sku_id: CT1, costo_reposicion_referencia: 15600, margen: 0.35, precio_sugerido: 21060 },
        error: null,
      });
    });

    await t.test("2 — sugerencia Gorra (sin costo) → 200 con nulls; id inválido → 400; SKU inexistente → 422 VARIANTE_NO_ENCONTRADA", async () => {
      const res = await fetch(urlSugerencia(GORRA), { headers: headers(supervisor) });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        data: { variante_sku_id: GORRA, costo_reposicion_referencia: null, margen: 0.35, precio_sugerido: null },
        error: null,
      });
      const malo = await fetch(urlSugerencia("no-es-uuid"), { headers: headers(supervisor) });
      assert.equal(malo.status, 400);
      const inexistente = await fetch(urlSugerencia(UUID_INEXISTENTE), { headers: headers(supervisor) });
      assert.equal(inexistente.status, 422);
      assert.equal((await inexistente.json()).error.code, "VARIANTE_NO_ENCONTRADA");
    });

    await t.test("3 — vigente CT1 → 200, 21100, versión f7bc2652, con vigente_desde", async () => {
      const r = await vigente(CT1);
      assert.equal(r.status, 200);
      assert.equal(r.body.error, null);
      assert.equal(r.body.data.variante_sku_id, CT1);
      assert.equal(r.body.data.precio_venta, 21100);
      assert.equal(r.body.data.lista_precio_version_id, VERSION_1_ID);
      assert.match(r.body.data.vigente_desde, /^\d{4}-\d{2}-\d{2}T/);
    });

    await t.test("4 — vigente Camisa de Policía → 404 SKU_SIN_PRECIO_VIGENTE · query inválida → 400", async () => {
      const r = await vigente(POLICIA);
      assert.equal(r.status, 404);
      assert.deepEqual(r.body, {
        data: null,
        error: { code: "SKU_SIN_PRECIO_VIGENTE", message: "La variante no tiene un precio de venta vigente" },
      });
      const sinParam = await fetch(`${BASE_URL}/api/ventas/lista-precios/vigente`, { headers: headers(supervisor) });
      assert.equal(sinParam.status, 400);
    });

    let versionCaso5 = "";
    await t.test("5 — publicar [CT1 → 23000] vigente ahora → 201, items_publicados 1, bajo_costo 0", async () => {
      const vigenteDesde = new Date().toISOString();
      const r = await publicar({ vigente_desde: vigenteDesde, items: [{ variante_sku_id: CT1, precio_venta: 23000 }] });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.error, null);
      assert.equal(r.body.data.lista_id, LISTA_ID);
      assert.equal(r.body.data.vigente_desde, vigenteDesde);
      assert.equal(r.body.data.items_publicados, 1);
      assert.equal(r.body.data.items_bajo_costo, 0);
      versionCaso5 = r.body.data.version_id;
    });

    await t.test("6 — resolución por SKU: CT1 = 23000 (nueva versión); CT2 = 22800 (sigue v1)", async () => {
      const ct1 = await vigente(CT1);
      assert.equal(ct1.body.data.precio_venta, 23000);
      assert.equal(ct1.body.data.lista_precio_version_id, versionCaso5);
      const ct2 = await vigente(CT2);
      assert.equal(ct2.body.data.precio_venta, 22800);
      assert.equal(ct2.body.data.lista_precio_version_id, VERSION_1_ID);
    });

    await t.test("7 — [CT2 → 15000] sin motivo → 422 MOTIVO_BAJO_COSTO_REQUERIDO con details; nada persistido", async () => {
      const antes = await prisma.listaPrecioVentaVersion.count();
      const r = await publicar({ vigente_desde: new Date().toISOString(), items: [{ variante_sku_id: CT2, precio_venta: 15000 }] });
      assert.equal(r.status, 422);
      assert.deepEqual(r.body, {
        data: null,
        error: {
          code: "MOTIVO_BAJO_COSTO_REQUERIDO",
          message: "El precio propuesto para la variante está por debajo del costo de reposición; debe declararse un motivo",
          details: { variante_sku_id: CT2 },
        },
      });
      assert.equal(await prisma.listaPrecioVentaVersion.count(), antes);
    });

    let versionCaso8 = "";
    await t.test("8 — ídem con motivo → 201, items_bajo_costo 1", async () => {
      const r = await publicar({
        vigente_desde: new Date().toISOString(),
        items: [{ variante_sku_id: CT2, precio_venta: 15000, motivo_bajo_costo: "Liquidación de temporada" }],
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.items_bajo_costo, 1);
      versionCaso8 = r.body.data.version_id;
    });

    await t.test("9 — vigencia futura +7 días [CT3 → 30000] → 201; vigente CT3 sigue en 21500", async () => {
      const futura = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const r = await publicar({ vigente_desde: futura, items: [{ variante_sku_id: CT3, precio_venta: 30000 }] });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const ct3 = await vigente(CT3);
      assert.equal(ct3.body.data.precio_venta, 21500);
      assert.equal(ct3.body.data.lista_precio_version_id, VERSION_1_ID);
    });

    let versionCaso10 = "";
    await t.test("10 — sin costo de referencia [Gorra → 1] → 201, bajo_costo 0 (no aplica la validación)", async () => {
      const r = await publicar({ vigente_desde: new Date().toISOString(), items: [{ variante_sku_id: GORRA, precio_venta: 1 }] });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.items_bajo_costo, 0);
      versionCaso10 = r.body.data.version_id;
    });

    await t.test("11 — validación: items [] / precio_venta 0 / body no JSON → 400 VALIDATION_ERROR", async () => {
      for (const body of [
        { vigente_desde: new Date().toISOString(), items: [] },
        { vigente_desde: new Date().toISOString(), items: [{ variante_sku_id: CT1, precio_venta: 0 }] },
      ]) {
        const r = await publicar(body);
        assert.equal(r.status, 400);
        assert.equal(r.body.error.code, "VALIDATION_ERROR");
      }
      const noJson = await fetch(urlVersiones, { method: "POST", headers: headers(supervisor), body: "{" });
      assert.equal(noJson.status, 400);
    });

    await t.test("12 — SKU inexistente → 422 VARIANTE_NO_ENCONTRADA", async () => {
      const r = await publicar({ vigente_desde: new Date().toISOString(), items: [{ variante_sku_id: UUID_INEXISTENTE, precio_venta: 100 }] });
      assert.equal(r.status, 422);
      assert.equal(r.body.error.code, "VARIANTE_NO_ENCONTRADA");
    });

    await t.test("13 — SKU duplicado → 400 ITEM_DUPLICADO_EN_VERSION", async () => {
      const r = await publicar({
        vigente_desde: new Date().toISOString(),
        items: [{ variante_sku_id: CT1, precio_venta: 100 }, { variante_sku_id: CT1, precio_venta: 200 }],
      });
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, "ITEM_DUPLICADO_EN_VERSION");
    });

    const bodyValido = { vigente_desde: new Date().toISOString(), items: [{ variante_sku_id: CT1, precio_venta: 99999 }] };
    await t.test("14 — cajero.seed → 403 en las 3 rutas", async () => {
      assert.equal((await publicar(bodyValido, cajero)).status, 403);
      assert.equal((await fetch(urlVigente(CT1), { headers: headers(cajero) })).status, 403);
      assert.equal((await fetch(urlSugerencia(CT1), { headers: headers(cajero) })).status, 403);
    });

    await t.test("15 — admin.ecommerce.seed → 403 en las 3 rutas", async () => {
      assert.equal((await publicar(bodyValido, adminEcommerce)).status, 403);
      assert.equal((await fetch(urlVigente(CT1), { headers: headers(adminEcommerce) })).status, 403);
      assert.equal((await fetch(urlSugerencia(CT1), { headers: headers(adminEcommerce) })).status, 403);
    });

    await t.test("16 — sin sesión → 401 en las 3 rutas", async () => {
      const post = await fetch(urlVersiones, { method: "POST", headers: headers(), body: JSON.stringify(bodyValido) });
      assert.equal(post.status, 401);
      assert.equal((await fetch(urlVigente(CT1))).status, 401);
      assert.equal((await fetch(urlSugerencia(CT1))).status, 401);
    });

    // ── Nivel 3 — verificación en BD ─────────────────────────────────────────

    await t.test("BD — sólo 4 versiones nuevas (5, 8, 9, 10); los rechazos no persistieron nada", async () => {
      assert.equal(await prisma.listaPrecioVentaVersion.count(), conteoVersionesInicial + 4);
      const nuevas = await prisma.listaPrecioVentaVersion.findMany({ where: { id: { in: versionesCreadas } } });
      for (const v of nuevas) {
        assert.equal(v.publicado_por_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
        assert.equal(v.is_active, true);
        assert.equal(v.lista_id, LISTA_ID);
      }
    });

    await t.test("BD — costo congelado server-side y bajo costo con motivo en los ítems nuevos", async () => {
      const item = (version_id: string) => prisma.listaPrecioVentaItem.findFirstOrThrow({ where: { version_id } });
      const i5 = await item(versionCaso5);
      assert.equal(i5.precio_venta.toNumber(), 23000);
      assert.equal(i5.costo_reposicion_referencia?.toNumber(), 15600);
      assert.equal(i5.confirmado_bajo_costo, false);
      const i8 = await item(versionCaso8);
      assert.equal(i8.costo_reposicion_referencia?.toNumber(), 16900);
      assert.equal(i8.confirmado_bajo_costo, true);
      assert.equal(i8.motivo_bajo_costo, "Liquidación de temporada");
      const i10 = await item(versionCaso10);
      assert.equal(i10.costo_reposicion_referencia, null);
      assert.equal(i10.confirmado_bajo_costo, false);
    });

    await t.test("BD — v1 intacta: 6 ítems con los precios y costos del seed (inmutabilidad)", async () => {
      const v1 = await prisma.listaPrecioVentaVersion.findUniqueOrThrow({ where: { id: VERSION_1_ID } });
      assert.equal(v1.is_active, true);
      const items = await prisma.listaPrecioVentaItem.findMany({
        where: { version_id: VERSION_1_ID, variante_sku_id: { in: [...Object.keys(V1), GORRA] } },
      });
      assert.equal(items.length, 6);
      for (const i of items) {
        if (i.variante_sku_id === GORRA) {
          assert.equal(i.precio_venta.toNumber(), 9500);
          assert.equal(i.costo_reposicion_referencia, null);
          continue;
        }
        assert.equal(i.precio_venta.toNumber(), V1[i.variante_sku_id].precio);
        assert.equal(i.costo_reposicion_referencia?.toNumber(), V1[i.variante_sku_id].costo);
      }
    });

    await t.test("BD — no-retroactividad: precios congelados de los pedidos web V-2026-000004…11 sin cambios", async () => {
      const items = await prisma.pedidoVentaItem.findMany({
        where: { pedido_venta: { numero_venta: { gte: "V-2026-000004", lte: "V-2026-000011" } } },
        select: { variante_sku_id: true, precio_unitario: true },
      });
      assert.ok(items.length > 0);
      for (const i of items) {
        const esperado = V1[i.variante_sku_id]?.precio;
        if (esperado !== undefined) assert.equal(i.precio_unitario.toNumber(), esperado, i.variante_sku_id);
      }
    });

    await t.test("BD — AuditLog: un asiento PUBLICAR_VERSION_LISTA_PRECIO_VENTA por versión, usuario = supervisor", async () => {
      let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
      for (let i = 0; i < 60 && filas.length < versionesCreadas.length; i++) {
        await new Promise((res) => setTimeout(res, 50));
        filas = await prisma.auditLog.findMany({
          where: { tabla_afectada: "versiones_lista_precio_venta", registro_id: { in: versionesCreadas } },
        });
      }
      assert.equal(filas.length, versionesCreadas.length);
      for (const f of filas) {
        assert.equal(f.accion, "PUBLICAR_VERSION_LISTA_PRECIO_VENTA");
        assert.equal(f.usuario_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
        assert.equal(f.valor_anterior, null);
        assert.ok(f.hash_anterior && f.hash_actual);
      }
      const f8 = filas.find((f) => f.registro_id === versionCaso8)!;
      assert.equal((f8.valor_nuevo as { items_bajo_costo: number }).items_bajo_costo, 1);
    });

    await t.test("Cadena SHA-256 íntegra: POST /api/auditoria/verificar-cadena con auditor.seed → integra: true", async () => {
      const res = await fetch(`${BASE_URL}/api/auditoria/verificar-cadena`, { method: "POST", headers: headers(auditor) });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.integra, true, JSON.stringify(body.data));
    });
  },
);
