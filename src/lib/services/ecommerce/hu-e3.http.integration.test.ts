import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

/** Requiere Next real y PostgreSQL descartable con seed; nunca apunta a datos productivos. */
const BASE_URL = process.env.HU_E3_T7_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E3_T7_INTEGRATION_DATABASE_URL;
const PATH = "/api/ecommerce/preparacion/validar-retiro";
const PASSWORD_SEED = "abc123456789";
const VARIANTE_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

async function login(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function post(body: unknown, cookie?: string, raw = false) {
  const response = await fetch(`${BASE_URL}${PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: raw ? String(body) : JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, payload };
}

function assertSinDatosSensibles(payload: unknown, ...valores: string[]) {
  const serializado = JSON.stringify(payload);
  for (const valor of valores) assert.ok(!serializado.includes(valor));
  assert.doesNotMatch(serializado, /qr_token|codigo_qr_retiro|dni|email|mercadopago|TOKEN_NO_RESUELTO|DNI_NO_COINCIDE/i);
}

test("HU-E3 T7: contrato HTTP real, RBAC y respuestas sin datos sensibles", {
  skip: !BASE_URL || !DATABASE_URL, timeout: 120_000,
}, async (t) => {
  if (!DATABASE_URL) return;
  process.env.DATABASE_URL = DATABASE_URL;
  const { prisma } = await import("../../db/prisma.ts");
  const db: PrismaClient = prisma;
  const operador = await db.usuario.findUniqueOrThrow({
    where: { email: "operador.pickpack.seed@erp-swat.local" }, select: { id: true },
  });
  const fixtures: Array<{ clienteId: string; pedidoId: string }> = [];
  t.after(async () => {
    const ahora = new Date();
    for (const fixture of fixtures) {
      await db.pedidoVentaItem.updateMany({ where: { pedido_venta_id: fixture.pedidoId }, data: { is_active: false, deleted_at: ahora } });
      await db.pedidoVentaEcommerce.updateMany({ where: { pedido_venta_id: fixture.pedidoId }, data: { is_active: false, deleted_at: ahora } });
      await db.pedidoVenta.update({ where: { id: fixture.pedidoId }, data: { is_active: false, deleted_at: ahora } });
      await db.cliente.update({ where: { id: fixture.clienteId }, data: { is_active: false, deleted_at: ahora } });
    }
    await db.$disconnect();
  });

  async function crearFixture(opciones: { estado?: "EN_PREPARACION" | "LISTO_PARA_RETIRO"; vencido?: boolean; inconsistente?: boolean } = {}) {
    const sufijo = randomUUID();
    const dni = String(Math.floor(10_000_000 + Math.random() * 90_000_000));
    const qr_token = randomUUID();
    const cliente = await db.cliente.create({ data: { dni, nombre: `Cliente E3 HTTP ${sufijo}` }, select: { id: true } });
    const pedido = await db.pedidoVenta.create({
      data: {
        numero_venta: `V-TEST-E3-HTTP-${sufijo}`, cliente_id: cliente.id,
        registrado_por_id: operador.id, canal: "WEB", estado: "FACTURADO", total: 100,
        items: { create: { variante_sku_id: VARIANTE_ID, cantidad: 2,
          cantidad_facturada: opciones.inconsistente ? 1 : 2,
          cantidad_entregada: 0, precio_unitario: 50 } },
      }, select: { id: true, numero_venta: true },
    });
    fixtures.push({ clienteId: cliente.id, pedidoId: pedido.id });
    const extension = await db.pedidoVentaEcommerce.create({
      data: { pedido_venta_id: pedido.id, estado_ecommerce: opciones.estado ?? "LISTO_PARA_RETIRO",
        codigo_qr_retiro: qr_token,
        plazo_retiro_vencimiento: opciones.vencido ? new Date(Date.now() - 60_000) : null },
      select: { id: true },
    });
    return { cliente, pedido, extension, qr_token, dni };
  }

  const operadorCookie = await login("operador.pickpack.seed@erp-swat.local");
  const adminCookie = await login("admin.ecommerce.seed@erp-swat.local");

  await t.test("401 y 403 antes de evaluar el body", async () => {
    const sinSesion = await post({ qr_token: randomUUID(), dni: "12345678" });
    assert.equal(sinSesion.status, 401);
    assert.equal((sinSesion.payload as { error: { code: string } }).error.code, "UNAUTHORIZED");
    const sinPermiso = await post({ qr_token: randomUUID(), dni: "12345678" }, adminCookie);
    assert.equal(sinPermiso.status, 403);
    assert.equal((sinPermiso.payload as { error: { code: string } }).error.code, "FORBIDDEN");
  });

  await t.test("400 para JSON inválido, formato y campos extra", async () => {
    for (const body of ["{", { qr_token: "", dni: "12345678" },
      { qr_token: randomUUID(), dni: "12345678", actorId: operador.id },
      { qr_token: randomUUID(), dni: "12.345.678" }]) {
      const respuesta = await post(body, operadorCookie, body === "{");
      assert.equal(respuesta.status, 400);
      assert.deepEqual(respuesta.payload, { data: null, error: { code: "VALIDATION_ERROR", message: "Datos de retiro inválidos" } });
      assertSinDatosSensibles(respuesta.payload, "12345678", operador.id);
    }
  });

  await t.test("422 uniforme para QR inexistente, DNI, estado, plazo y baja", async () => {
    const fixture = await crearFixture();
    const preparado = await crearFixture({ estado: "EN_PREPARACION" });
    const vencido = await crearFixture({ vencido: true });
    const inactivo = await crearFixture();
    await db.pedidoVenta.update({ where: { id: inactivo.pedido.id }, data: { is_active: false } });
    const entradas = [
      { qr_token: randomUUID(), dni: fixture.dni },
      { qr_token: fixture.qr_token, dni: "00000000" },
      { qr_token: preparado.qr_token, dni: preparado.dni },
      { qr_token: vencido.qr_token, dni: vencido.dni },
      { qr_token: inactivo.qr_token, dni: inactivo.dni },
    ];
    for (const entrada of entradas) {
      const respuesta = await post(entrada, operadorCookie);
      assert.equal(respuesta.status, 422);
      assert.deepEqual(respuesta.payload, { data: null, error: { code: "RETIRO_NO_VALIDO", message: "No fue posible validar el retiro" } });
      assertSinDatosSensibles(respuesta.payload, entrada.qr_token, entrada.dni);
    }
  });

  await t.test("500 seguro ante inconsistencia interna", async () => {
    const fixture = await crearFixture({ inconsistente: true });
    const respuesta = await post({ qr_token: fixture.qr_token, dni: fixture.dni }, operadorCookie);
    assert.equal(respuesta.status, 500);
    assert.deepEqual(respuesta.payload, { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } });
    assertSinDatosSensibles(respuesta.payload, fixture.qr_token, fixture.dni);
  });

  await t.test("200 exacto, input normalizado y actor obtenido de sesión", async () => {
    const fixture = await crearFixture();
    const respuesta = await post({ qr_token: `  ${fixture.qr_token}  `, dni: ` ${fixture.dni} ` }, operadorCookie);
    assert.equal(respuesta.status, 200);
    assert.deepEqual(respuesta.payload, {
      data: { pedido_venta_id: fixture.pedido.id, numero: fixture.pedido.numero_venta, estado: "ENTREGADO" }, error: null,
    });
    assertSinDatosSensibles(respuesta.payload, fixture.qr_token, fixture.dni, fixture.extension.id);
    const extension = await db.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: fixture.extension.id } });
    assert.equal(extension.estado_ecommerce, "ENTREGADO");
    assert.equal(extension.codigo_qr_retiro, null);
    const venta = await db.pedidoVenta.findUniqueOrThrow({ where: { id: fixture.pedido.id } });
    assert.equal(venta.estado, "CERRADO");
    for (let intento = 0; intento < 40; intento++) {
      const audit = await db.auditLog.findFirst({ where: { accion: "PEDIDO_ENTREGADO", registro_id: fixture.extension.id } });
      if (audit) {
        assert.equal(audit.usuario_id, operador.id);
        break;
      }
      if (intento === 39) assert.fail("No se registró auditoría del actor de sesión");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const repetido = await post({ qr_token: fixture.qr_token, dni: fixture.dni }, operadorCookie);
    assert.equal(repetido.status, 422);
    assert.deepEqual(repetido.payload, { data: null, error: { code: "RETIRO_NO_VALIDO", message: "No fue posible validar el retiro" } });
  });
});
