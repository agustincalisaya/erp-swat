import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-E14 — `GET /api/ecommerce/preparacion` contra un servidor Next.js real
 * (spec E §6.3 E14-2/E14-3/E14-4: se verifica el JSON HTTP, no la tarjeta).
 *
 * Usa los pedidos web del seed V-2026-000006 / V-2026-000007 sin mutarlos y
 * roles/usuarios propios con nombres únicos por corrida (no toca los roles
 * del seed). La revocación es baja lógica de `RolPermiso` (RULES §1).
 *
 * Variables requeridas:
 *   HU_E14_HTTP_BASE_URL=http://localhost:3114
 *   HU_E14_HTTP_DATABASE_URL=postgresql://.../swat_erp_test_...
 */

const BASE_URL = process.env.HU_E14_HTTP_BASE_URL;
const DATABASE_URL = process.env.HU_E14_HTTP_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";
const NUMEROS_SEED = ["V-2026-000006", "V-2026-000007"];
const PAYMENT_IDS_SEED = ["1320000000006", "1320000000007"];

interface ItemColaJson {
  pedido_venta_id: string;
  numero_venta: string;
  cliente_nombre: string | null;
  fecha_pago_confirmado: string | null;
  unidades_totales: number;
  progreso: { total_requerido: number };
  pago?: { total: string; medios: string[] };
}
interface Envelope {
  data: { items: ItemColaJson[]; total: number; page: number; page_size: number } | null;
  error: { code: string; message: string } | null;
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  assert.equal(res.status, 200, `login falló para ${email}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login no devolvió cookie para ${email}`);
  return setCookie.split(";")[0]!;
}

async function getCola(cookie: string | null, page = 1) {
  const res = await fetch(`${BASE_URL}/api/ecommerce/preparacion?page=${page}&page_size=50`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const texto = await res.text();
  return { status: res.status, texto, body: JSON.parse(texto) as Envelope };
}

/** Recorre todas las páginas; devuelve los ítems y el texto crudo de cada respuesta. */
async function colaCompleta(cookie: string) {
  const items: ItemColaJson[] = [];
  const textos: string[] = [];
  for (let page = 1; ; page++) {
    const r = await getCola(cookie, page);
    assert.equal(r.status, 200, r.texto);
    textos.push(r.texto);
    items.push(...r.body.data!.items);
    if (page * r.body.data!.page_size >= r.body.data!.total) break;
  }
  return { items, json: textos.join("\n") };
}

test("HU-E14 — JSON HTTP de la cola por permiso", {
  skip: !BASE_URL || !DATABASE_URL,
  timeout: 240_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  assert.match(new URL(DATABASE_URL!).pathname, /test/i, "la base de integración debe ser de test");
  const [{ prisma }, { hashPassword }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("../../auth/password-hash-core.ts"),
  ]);
  t.after(() => prisma.$disconnect());

  const juanPerez = await prisma.cliente.findFirstOrThrow({
    where: { nombre: "Juan Pérez", is_active: true },
    select: { nombre: true, dni: true, email: true, telefono: true },
  });
  const pedidosSeed = await prisma.pedidoVenta.findMany({
    where: { numero_venta: { in: NUMEROS_SEED } },
    select: { id: true, numero_venta: true, total: true },
  });
  assert.equal(pedidosSeed.length, 2, "el seed debe tener V-2026-000006 y V-2026-000007");

  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { hash } = await hashPassword(PASSWORD_SEED);
  const permisoId = async (codigo: string) =>
    (await prisma.permiso.findFirstOrThrow({ where: { codigo, is_active: true }, select: { id: true } })).id;
  const PERMISO_COLA = await permisoId("ecommerce:leer_cola_preparacion");
  const PERMISO_HISTORIAL = await permisoId("ecommerce:leer_historial_ordenes");

  async function usuarioConRol(nombre: string, permisos: string[]) {
    const rol = await prisma.rol.create({
      data: {
        nombre: `TEST_E14_${nombre}_${sufijo}`,
        descripcion: "Rol de prueba HU-E14",
        permisos: { create: permisos.map((permiso_id) => ({ permiso_id })) },
      },
      select: { id: true },
    });
    const usuario = await prisma.usuario.create({
      data: {
        nombre_usuario: `e14.${nombre.toLowerCase()}.${sufijo}`,
        email: `e14.${nombre.toLowerCase()}.${sufijo}@test.local`,
        password_hash: hash,
        password_salt: "x",
        nombre_completo: `Usuario E14 ${nombre}`,
        estado: "ACTIVO",
        roles: { create: { rol_id: rol.id } },
      },
      select: { email: true },
    });
    return { rolId: rol.id, cookie: await login(usuario.email) };
  }

  function itemsSeed(items: ItemColaJson[]) {
    const porNumero = new Map(items.map((i) => [i.numero_venta, i]));
    return NUMEROS_SEED.map((n) => {
      const item = porNumero.get(n);
      assert.ok(item, `${n} debe estar en la cola`);
      return item;
    });
  }

  function sinPiiNiPaymentId(json: string) {
    for (const x of [juanPerez.dni, juanPerez.email!, juanPerez.telefono!, ...PAYMENT_IDS_SEED]) {
      assert.equal(json.includes(x), false, `el JSON no debe contener ${x}`);
    }
  }

  await t.test("operador.pickpack.seed → proyección base, sin clave `pago`", async () => {
    const { items, json } = await colaCompleta(await login("operador.pickpack.seed@erp-swat.local"));
    const [v6, v7] = itemsSeed(items);
    for (const [item, unidades] of [[v6, 1], [v7, 2]] as const) {
      assert.equal(item.cliente_nombre, juanPerez.nombre);
      assert.equal(item.unidades_totales, unidades);
      assert.equal(item.progreso.total_requerido, unidades);
      assert.equal(typeof item.fecha_pago_confirmado, "string");
      assert.ok(!Number.isNaN(Date.parse(item.fecha_pago_confirmado!)));
    }
    for (const item of items) assert.equal(Object.hasOwn(item, "pago"), false);
    assert.equal(json.includes("\"pago\""), false);
    assert.equal(json.includes("MERCADO_PAGO"), false);
    sinPiiNiPaymentId(json);
  });

  await t.test("admin.ecommerce.seed → proyección con `pago` desde la venta registrada", async () => {
    const { items, json } = await colaCompleta(await login("admin.ecommerce.seed@erp-swat.local"));
    for (const item of itemsSeed(items)) {
      const bd = pedidosSeed.find((p) => p.numero_venta === item.numero_venta)!;
      assert.deepEqual(item.pago, { total: bd.total.toFixed(2), medios: ["MERCADO_PAGO"] });
      assert.equal(item.cliente_nombre, juanPerez.nombre);
    }
    for (const item of items) assert.ok(Object.hasOwn(item, "pago"));
    sinPiiNiPaymentId(json);
  });

  await t.test("sin ecommerce:leer_cola_preparacion → 403 (aunque tenga historial)", async () => {
    const { cookie } = await usuarioConRol("SINCOLA", [PERMISO_HISTORIAL]);
    const r = await getCola(cookie);
    assert.equal(r.status, 403);
    assert.equal(r.body.data, null);
    assert.equal(r.body.error?.code, "FORBIDDEN");
  });

  await t.test("revocar leer_historial_ordenes tiene efecto en el request siguiente", async () => {
    const { rolId, cookie } = await usuarioConRol("REVOCA", [PERMISO_COLA, PERMISO_HISTORIAL]);

    const antes = await colaCompleta(cookie);
    for (const item of itemsSeed(antes.items)) assert.ok(Object.hasOwn(item, "pago"));

    await prisma.rolPermiso.update({
      where: { rol_id_permiso_id: { rol_id: rolId, permiso_id: PERMISO_HISTORIAL } },
      data: { is_active: false, deleted_at: new Date(), deletion_reason: "revocación test HU-E14" },
    });

    const despues = await colaCompleta(cookie);
    itemsSeed(despues.items);
    for (const item of despues.items) assert.equal(Object.hasOwn(item, "pago"), false);
    assert.equal(despues.json.includes("\"pago\""), false);
  });

  await t.test("sin sesión → 401", async () => {
    const r = await getCola(null);
    assert.equal(r.status, 401);
    assert.equal(r.body.error?.code, "UNAUTHORIZED");
  });
});
