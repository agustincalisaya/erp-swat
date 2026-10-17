import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

/**
 * HU-E12 T08 — Route Handlers HTTP de Pick&Pack.
 *
 * Requiere un servidor Next.js real porque `withPermission()`/`withAuth()`
 * dependen de `cookies()` de `next/headers` (AsyncLocalStorage poblado por el
 * runtime de Next). No se puede testear invocando el `route.ts` directamente.
 *
 * Variables requeridas:
 *   HU_E12_INTEGRATION_BASE_URL=http://localhost:3102
 *   HU_E12_INTEGRATION_DATABASE_URL=postgresql://...
 */

const BASE_URL = process.env.HU_E12_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E12_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";
const ADMIN_EMAIL = "admin.ecommerce.seed@erp-swat.local";
const OPERADOR_EMAIL = "operador.pickpack.seed@erp-swat.local";

async function loginReal(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login falló para ${email}: ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login no devolvió cookie para ${email}`);
  return setCookie!.split(";")[0]!;
}

async function request(
  method: string,
  path: string,
  { cookie, body }: { cookie?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown; res: Response }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  return { status: res.status, body: json, res };
}

async function crearPedidoPreparacion(
  prisma: PrismaClient,
  overrides: {
    estado_ecommerce?: "EN_PREPARACION" | "PAGO_CONFIRMADO";
    fecha_pago_confirmado?: Date | null;
    cantidad?: number;
    conOperador?: boolean;
    prioridad_manual?: number | null;
  } = {},
) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const proveedor = await prisma.proveedor.create({
    data: {
      razon_social: `Proveedor HU-E12-HTTP ${suffix}`,
      cuit: `30-${suffix}`,
      estado: "HOMOLOGADO",
    },
    select: { id: true },
  });

  const producto = await prisma.productoMaestro.create({
    data: {
      codigo_producto: `PPE12HTTP-${suffix}`,
      nombre: `Producto HU-E12 HTTP ${suffix}`,
      rubro: "Test",
      categoria: "Test",
      unidad_medida: "UNIDAD",
      costo_estandar_referencia: 1000,
    },
    select: { id: true },
  });

  const variante = await prisma.varianteSKU.create({
    data: {
      producto_maestro_id: producto.id,
      sku: `PPE12HTTP-L-AZUL-H-${suffix}`,
      ean_qr: `779${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
      talle: "L",
      color: "AZUL",
      genero: "HOMBRE",
      modelo: "TEST",
      proveedor_id: proveedor.id,
    },
    select: { id: true, sku: true },
  });

  const pedido = await prisma.pedidoVenta.create({
    data: {
      numero_venta: `V-E12HTTP-${suffix}`,
      canal: "WEB",
      estado: "FACTURADO",
      total: 1000 * (overrides.cantidad ?? 1),
      registrado_por_id: "b49a122e-fea6-43c4-8b8f-36a2491fddeb", // usuario_canal_web (seed)
      items: {
        create: {
          variante_sku_id: variante.id,
          cantidad: overrides.cantidad ?? 1,
          precio_unitario: 1000,
        },
      },
    },
    select: { id: true, numero_venta: true },
  });

  const pve = await prisma.pedidoVentaEcommerce.create({
    data: {
      pedido_venta_id: pedido.id,
      estado_ecommerce: overrides.estado_ecommerce ?? "EN_PREPARACION",
      fecha_pago_confirmado: Object.hasOwn(overrides, "fecha_pago_confirmado")
        ? overrides.fecha_pago_confirmado
        : new Date(),
      prioridad_manual: overrides.prioridad_manual,
      operador_asignado_id: overrides.conOperador ? null : undefined,
    },
    select: { id: true, pedido_venta_id: true },
  });

  return { pedidoId: pedido.id, pveId: pve.id, numeroVenta: pedido.numero_venta, variante };
}

async function crearOperador(prisma: PrismaClient, suffix: string) {
  const rolOperador = await prisma.rol.findFirstOrThrow({
    where: { nombre: "OPERADOR_PICK_PACK" },
    select: { id: true },
  });

  const usuario = await prisma.usuario.create({
    data: {
      nombre_usuario: `operador.e12.http.${suffix}`,
      email: `operador.e12.http.${suffix}@test.local`,
      password_hash: "x",
      password_salt: "x",
      nombre_completo: "Operador HTTP E12",
      estado: "ACTIVO",
      roles: {
        create: {
          rol_id: rolOperador.id,
        },
      },
    },
    select: { id: true, email: true },
  });

  const hashModule = await import("../../auth/password-hash-core.ts");
  const { hash } = await hashModule.hashPassword(PASSWORD_SEED);
  await prisma.usuario.update({ where: { id: usuario.id }, data: { password_hash: hash, password_salt: "x" } });

  return usuario;
}

test(
  "HU-E12 T08 — Route Handlers HTTP de Pick&Pack",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 240_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const [{ prisma }] = await Promise.all([import("../../db/prisma.ts")]);
    t.after(() => prisma.$disconnect());

    // Limpieza de corridas anteriores abortadas: solo registros identificables
    // creados por este archivo de test.
    await prisma.$transaction(async (tx) => {
      await tx.pedidoPreparacionEscaneo.deleteMany({
        where: { pedido_venta_item: { pedido_venta: { numero_venta: { startsWith: "V-E12HTTP-" } } } },
      });
      await tx.pedidoVentaItem.deleteMany({
        where: { pedido_venta: { numero_venta: { startsWith: "V-E12HTTP-" } } },
      });
      await tx.pedidoVentaEcommerce.deleteMany({
        where: { pedido_venta: { numero_venta: { startsWith: "V-E12HTTP-" } } },
      });
      await tx.pedidoVenta.deleteMany({ where: { numero_venta: { startsWith: "V-E12HTTP-" } } });
      await tx.varianteSKU.deleteMany({ where: { sku: { startsWith: "PPE12HTTP-" } } });
      await tx.productoMaestro.deleteMany({ where: { codigo_producto: { startsWith: "PPE12HTTP-" } } });
      await tx.proveedor.deleteMany({ where: { razon_social: { startsWith: "Proveedor HU-E12-HTTP" } } });
    });

    const adminCookie = await loginReal(ADMIN_EMAIL);
    const operadorCookie = await loginReal(OPERADOR_EMAIL);

    await t.test("sin sesión → 401 en todas las rutas", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const rGet = await request("GET", "/api/ecommerce/preparacion");
      assert.equal(rGet.status, 401);
      assert.equal((rGet.body as { error: { code: string } }).error.code, "UNAUTHORIZED");

      for (const path of [
        `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`,
        `/api/ecommerce/preparacion/${pedido.pedidoId}/prioridad`,
        `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`,
        `/api/ecommerce/preparacion/${pedido.pedidoId}/completar`,
      ]) {
        const method = path.endsWith("preparacion") ? "GET" : path.endsWith("tomar") || path.endsWith("scan") || path.endsWith("completar") ? "POST" : "PATCH";
        const r = await request(method, path);
        assert.equal(r.status, 401, path);
      }
    });

    await t.test("GET /api/ecommerce/preparacion — admin ve la cola con progreso", async () => {
      const pedido = await crearPedidoPreparacion(prisma, { prioridad_manual: 100 });
      const r = await request("GET", "/api/ecommerce/preparacion?page_size=1", { cookie: adminCookie });
      assert.equal(r.status, 200);
      const data = (r.body as { data: { items: Array<{ pedido_venta_id: string; progreso: { completo: boolean } }>; total: number; page: number; page_size: number } }).data;
      assert.ok(Array.isArray(data.items));
      assert.equal(data.page_size, 1);
      assert.ok(data.items.some((it) => it.pedido_venta_id === pedido.pedidoId));
      assert.equal(typeof data.total, "number");
      const item = data.items.find((it) => it.pedido_venta_id === pedido.pedidoId);
      assert.ok(item);
      assert.equal(item!.progreso.completo, false);
    });

    await t.test("GET /api/ecommerce/preparacion — query inválida → 400", async () => {
      const r = await request("GET", "/api/ecommerce/preparacion?page=0", { cookie: adminCookie });
      assert.equal(r.status, 400);
      assert.equal((r.body as { error: { code: string } }).error.code, "VALIDATION_ERROR");
    });

    await t.test("GET /api/ecommerce/preparacion — respuesta no expone datos sensibles", async () => {
      const r = await request("GET", "/api/ecommerce/preparacion", { cookie: adminCookie });
      const text = JSON.stringify(r.body);
      assert.doesNotMatch(text, /codigo_qr_retiro/);
      assert.doesNotMatch(text, /mercadopago_payment_id/);
      assert.doesNotMatch(text, /mercadopago_preference_id/);
      assert.doesNotMatch(text, /mercadopago_checkout_url/);
    });

    await t.test("RBAC — admin puede priorizar pero no preparar", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const rToma = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: adminCookie, body: {} });
      assert.equal(rToma.status, 403);
      assert.equal((rToma.body as { error: { code: string } }).error.code, "FORBIDDEN");

      const rScan = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: adminCookie,
        body: { scan_id: crypto.randomUUID(), codigo: pedido.variante.sku },
      });
      assert.equal(rScan.status, 403);

      const rCompletar = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/completar`, { cookie: adminCookie, body: {} });
      assert.equal(rCompletar.status, 403);

      const rPrioridad = await request("PATCH", `/api/ecommerce/preparacion/${pedido.pedidoId}/prioridad`, {
        cookie: adminCookie,
        body: { prioridad_manual: 5 },
      });
      assert.equal(rPrioridad.status, 200);
    });

    await t.test("RBAC — operador puede preparar y ver cola pero no priorizar", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const rGet = await request("GET", "/api/ecommerce/preparacion", { cookie: operadorCookie });
      assert.equal(rGet.status, 200);

      const rToma = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      assert.equal(rToma.status, 200);
      assert.equal((rToma.body as { data: { cambio_realizado: boolean } }).data.cambio_realizado, true);

      const rPrioridad = await request("PATCH", `/api/ecommerce/preparacion/${pedido.pedidoId}/prioridad`, {
        cookie: operadorCookie,
        body: { prioridad_manual: 5 },
      });
      assert.equal(rPrioridad.status, 403);
    });

    await t.test("POST tomar — retry mismo operador es idempotente", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const r1 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      assert.equal(r1.status, 200);
      const r2 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      assert.equal(r2.status, 200);
      assert.equal((r2.body as { data: { cambio_realizado: boolean } }).data.cambio_realizado, false);
    });

    await t.test("POST tomar — otro operador intenta tomar pedido ya tomado → 409", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      const otro = await crearOperador(prisma, `${Date.now()}-otro`);
      const cookieOtro = await loginReal(otro.email);
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: cookieOtro, body: {} });
      assert.equal(r.status, 409);
      assert.equal((r.body as { error: { code: string } }).error.code, "PEDIDO_YA_TOMADO");
    });

    await t.test("POST tomar — UUID inválido → 400", async () => {
      const r = await request("POST", "/api/ecommerce/preparacion/no-es-uuid/tomar", { cookie: operadorCookie, body: {} });
      assert.equal(r.status, 400);
    });

    await t.test("POST tomar — body con campo extra → 400", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: { extra: 1 } });
      assert.equal(r.status, 400);
      assert.equal((r.body as { error: { code: string } }).error.code, "VALIDATION_ERROR");
    });

    await t.test("PATCH prioridad — valores límite y null", async () => {
      const pedido1 = await crearPedidoPreparacion(prisma);
      const r1 = await request("PATCH", `/api/ecommerce/preparacion/${pedido1.pedidoId}/prioridad`, {
        cookie: adminCookie,
        body: { prioridad_manual: 1 },
      });
      assert.equal(r1.status, 200);

      const pedido100 = await crearPedidoPreparacion(prisma);
      const r100 = await request("PATCH", `/api/ecommerce/preparacion/${pedido100.pedidoId}/prioridad`, {
        cookie: adminCookie,
        body: { prioridad_manual: 100 },
      });
      assert.equal(r100.status, 200);

      const pedidoNull = await crearPedidoPreparacion(prisma);
      const rNull = await request("PATCH", `/api/ecommerce/preparacion/${pedidoNull.pedidoId}/prioridad`, {
        cookie: adminCookie,
        body: { prioridad_manual: null },
      });
      assert.equal(rNull.status, 200);
    });

    await t.test("PATCH prioridad — valores inválidos → 400", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      for (const valor of [0, 101, 5.5, "alta"]) {
        const r = await request("PATCH", `/api/ecommerce/preparacion/${pedido.pedidoId}/prioridad`, {
          cookie: adminCookie,
          body: { prioridad_manual: valor },
        });
        assert.equal(r.status, 400, `valor ${valor}`);
      }
    });

    await t.test("PATCH prioridad — pedido tomado no es priorizable por admin → 409", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      const r = await request("PATCH", `/api/ecommerce/preparacion/${pedido.pedidoId}/prioridad`, {
        cookie: adminCookie,
        body: { prioridad_manual: 5 },
      });
      assert.equal(r.status, 409);
    });

    await t.test("POST scan — SKU válido incrementa progreso", async () => {
      const pedido = await crearPedidoPreparacion(prisma, { cantidad: 2 });
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      const scanId = crypto.randomUUID();
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: scanId, codigo: pedido.variante.sku },
      });
      assert.equal(r.status, 200);
      assert.equal((r.body as { data: { cantidad_confirmada: number } }).data.cantidad_confirmada, 1);
    });

    await t.test("POST scan — retry mismo scan_id es idempotente", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      const scanId = crypto.randomUUID();
      const r1 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: scanId, codigo: pedido.variante.sku },
      });
      assert.equal(r1.status, 200);
      const r2 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: scanId, codigo: pedido.variante.sku },
      });
      assert.equal(r2.status, 200);
      assert.equal((r2.body as { data: { idempotente: boolean } }).data.idempotente, true);
    });

    await t.test("POST scan — scan_id distinto para mismo código ya completo → 409", async () => {
      const pedido = await crearPedidoPreparacion(prisma, { cantidad: 1 });
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      const scanId = crypto.randomUUID();
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: scanId, codigo: pedido.variante.sku },
      });
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: crypto.randomUUID(), codigo: pedido.variante.sku },
      });
      assert.equal(r.status, 409);
    });

    await t.test("POST scan — código que no pertenece al pedido → 409", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const otro = await crearPedidoPreparacion(prisma);
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: crypto.randomUUID(), codigo: otro.variante.sku },
      });
      assert.equal(r.status, 409);
      assert.equal((r.body as { error: { code: string } }).error.code, "CODIGO_NO_PERTENECE_PEDIDO");
    });

    await t.test("POST scan — actor distinto al operador asignado → 403", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      const otro = await crearOperador(prisma, `${Date.now()}-scan`);
      const cookieOtro = await loginReal(otro.email);
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: cookieOtro,
        body: { scan_id: crypto.randomUUID(), codigo: pedido.variante.sku },
      });
      assert.equal(r.status, 403);
      assert.equal((r.body as { error: { code: string } }).error.code, "OPERADOR_NO_AUTORIZADO");
    });

    await t.test("POST scan — body inválido → 400", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const r1 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: "no-uuid", codigo: pedido.variante.sku },
      });
      assert.equal(r1.status, 400);

      const r2 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: crypto.randomUUID(), codigo: "" },
      });
      assert.equal(r2.status, 400);

      const r3 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: crypto.randomUUID(), codigo: pedido.variante.sku, extra: 1 },
      });
      assert.equal(r3.status, 400);
    });

    await t.test("POST completar — preparación incompleta → 409", async () => {
      const pedido = await crearPedidoPreparacion(prisma, { cantidad: 2 });
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: crypto.randomUUID(), codigo: pedido.variante.sku },
      });
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/completar`, { cookie: operadorCookie, body: {} });
      assert.equal(r.status, 409);
      assert.equal((r.body as { error: { code: string } }).error.code, "PREPARACION_INCOMPLETA");
    });

    await t.test("POST completar — flujo completo y retry idempotente, sin QR expuesto", async () => {
      const pedido = await crearPedidoPreparacion(prisma, { cantidad: 1 });
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/tomar`, { cookie: operadorCookie, body: {} });
      await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/scan`, {
        cookie: operadorCookie,
        body: { scan_id: crypto.randomUUID(), codigo: pedido.variante.sku },
      });
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/completar`, { cookie: operadorCookie, body: {} });
      assert.equal(r.status, 200);
      const data = r.body as { data: { estado_ecommerce: string; transicion_realizada: boolean } };
      assert.equal(data.data.estado_ecommerce, "LISTO_PARA_RETIRO");
      assert.equal(data.data.transicion_realizada, true);
      const text = JSON.stringify(r.body);
      assert.doesNotMatch(text, /codigo_qr_retiro/);

      const r2 = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/completar`, { cookie: operadorCookie, body: {} });
      assert.equal(r2.status, 200);
      assert.equal((r2.body as { data: { idempotente: boolean } }).data.idempotente, true);
    });

    await t.test("POST completar — body con campo extra → 400", async () => {
      const pedido = await crearPedidoPreparacion(prisma);
      const r = await request("POST", `/api/ecommerce/preparacion/${pedido.pedidoId}/completar`, {
        cookie: operadorCookie,
        body: { extra: 1 },
      });
      assert.equal(r.status, 400);
    });

    await t.test("GET cola — registros legacy con fecha_pago_confirmado null son representables", async () => {
      const pedido = await crearPedidoPreparacion(prisma, { fecha_pago_confirmado: null, prioridad_manual: 100 });
      const r = await request("GET", "/api/ecommerce/preparacion?page_size=50", { cookie: adminCookie });
      assert.equal(r.status, 200);
      const found = (r.body as { data: { items: { pedido_venta_id: string; fecha_pago_confirmado: unknown }[] } }).data.items.find(
        (it) => it.pedido_venta_id === pedido.pedidoId,
      );
      assert.ok(found);
      assert.equal(found!.fecha_pago_confirmado, null);
    });
  },
);
