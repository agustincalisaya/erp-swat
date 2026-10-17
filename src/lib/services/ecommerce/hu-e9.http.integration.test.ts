import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";

const BASE_URL = process.env.HU_E8_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E8_INTEGRATION_DATABASE_URL ?? process.env.HU_E9_INTEGRATION_DATABASE_URL;
const PASSWORD = "password-segura";

class Jar {
  private readonly cookies = new Map<string, string>();
  absorber(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (value) this.cookies.set(name.trim(), value);
    }
  }
  header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "); }
}

async function llamar(jar: Jar, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie: jar.header(), ...(init.headers ?? {}) },
  });
  jar.absorber(response);
  const text = await response.text();
  const body = response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null;
  return { status: response.status, body, text, response };
}

function assertCachePrivada(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

const error404 = {
  data: null,
  error: { code: "PEDIDO_NO_ENCONTRADO", message: "El pedido solicitado no existe" },
};

const sensibles = [
  "codigo_qr_retiro", "qr_inconsistente", "mercadopago_payment_id", "access_token", "operador_asignado_id",
  "prioridad_manual", "escaneos", "cae_simulado", "es_simulado", "qr_data_url_fiscal", "deleted_at",
  "deleted_by", "deletion_reason",
];

test("HU-E9 HTTP — sesión E8, aislamiento, DTO, QR y caché", {
  skip: !BASE_URL || !DATABASE_URL ? "Faltan HU_E8_INTEGRATION_BASE_URL y HU_E8_INTEGRATION_DATABASE_URL/HU_E9_INTEGRATION_DATABASE_URL" : false,
  timeout: 180_000,
}, async (t) => {
  if (!BASE_URL || !DATABASE_URL) throw new Error("Faltan HU_E8_INTEGRATION_BASE_URL y una URL de base de integración E8/E9");
  const url = new URL(DATABASE_URL);
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:")) throw new Error("HU-E9 HTTP requiere PostgreSQL de integración");
  process.env.DATABASE_URL = DATABASE_URL;

  const [{ prisma }, { hashPassword }] = await Promise.all([
    import("@/lib/db/prisma"),
    import("@/lib/auth/password-hash-core"),
  ]);
  t.after(() => prisma.$disconnect());

  const codigo = randomUUID();
  const usuarioId = randomUUID();
  const proveedorId = randomUUID();
  const productoId = randomUUID();
  const varianteId = randomUUID();
  const ahora = new Date();
  const futuro = new Date(ahora.getTime() + 86_400_000);
  const vencido = new Date(ahora.getTime() - 86_400_000);
  const { hash } = await hashPassword(PASSWORD);

  await prisma.usuario.create({ data: {
    id: usuarioId, nombre_usuario: `hu-e9-http-${codigo}`, email: `hu-e9-http-${codigo}@example.invalid`,
    password_hash: "cuenta-no-operativa", password_salt: "cuenta-no-operativa",
    nombre_completo: "Registrante HTTP HU-E9", estado: "INACTIVO", is_active: false,
  } });
  await prisma.proveedor.create({ data: { id: proveedorId, cuit: `HU-E9-HTTP-${codigo}`, razon_social: "Proveedor HTTP HU-E9", categorias: [] } });
  await prisma.productoMaestro.create({ data: {
    id: productoId, codigo_producto: `HUE9-${codigo.slice(0, 8)}`, nombre: "Producto HTTP HU-E9", rubro: "Pruebas",
    categoria: "Pruebas", unidad_medida: "UNIDAD", costo_estandar_referencia: 50,
  } });
  await prisma.varianteSKU.create({ data: {
    id: varianteId, producto_maestro_id: productoId, proveedor_id: proveedorId,
    sku: `HU-E9-HTTP-${codigo.slice(0, 8)}`, talle: "M", color: "Negro", genero: "Unisex", modelo: "Prueba",
  } });

  async function crearCuenta(pendiente: boolean) {
    const cliente = await prisma.cliente.create({ data: {
      dni: String(randomInt(10_000_000, 99_999_999)), nombre: "Cliente HTTP HU-E9",
    } });
    const cuenta = await prisma.cuentaClienteWeb.create({ data: {
      cliente_id: cliente.id, email: `hu-e9-${randomUUID()}@example.test`, password_hash: hash,
      vinculacion_pendiente: pendiente,
    } });
    return { cliente, cuenta };
  }

  async function login(email: string) {
    const jar = new Jar();
    const result = await llamar(jar, "/api/tienda/cuenta/login", {
      method: "POST", body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(result.status, 200);
    return jar;
  }

  type Estado = "PAGO_CONFIRMADO" | "LISTO_PARA_RETIRO" | "ENTREGADO";
  async function crearPedido(
    clienteId: string,
    canal: "WEB" | "MOSTRADOR",
    estado: Estado,
    opciones: {
      fecha: Date;
      token?: string;
      plazo?: Date | null;
      pedidoActivo?: boolean;
      pedidoEliminado?: boolean;
      ecommerceActivo?: boolean;
      ecommerceEliminado?: boolean;
      comprobante?: boolean;
    },
  ) {
    const id = randomUUID();
    await prisma.pedidoVenta.create({ data: {
      id, numero_venta: `V-HTTP-${id}`, cliente_id: clienteId, canal,
      estado: estado === "ENTREGADO" ? "CERRADO" : "FACTURADO", registrado_por_id: usuarioId,
      total: 150, created_at: opciones.fecha,
      is_active: opciones.pedidoActivo ?? true,
      ...(opciones.pedidoEliminado ? { deleted_at: ahora, deleted_by: usuarioId, deletion_reason: "Baja HTTP de prueba" } : {}),
    } });
    await prisma.pedidoVentaItem.create({ data: {
      pedido_venta_id: id, variante_sku_id: varianteId, cantidad: 2, precio_unitario: 75,
    } });
    if (canal === "WEB") {
      await prisma.pedidoVentaEcommerce.create({ data: {
        pedido_venta_id: id, estado_ecommerce: estado, codigo_qr_retiro: opciones.token ?? null,
        plazo_retiro_vencimiento: opciones.plazo ?? null, is_active: opciones.ecommerceActivo ?? true,
        ...(opciones.ecommerceEliminado ? { deleted_at: ahora, deleted_by: usuarioId, deletion_reason: "Baja HTTP de prueba" } : {}),
      } });
    }
    if (opciones.comprobante) {
      await prisma.comprobanteFiscal.create({ data: {
        pedido_venta_id: id, tipo_comprobante: "FACTURA_B", cae_simulado: "12345678901234",
        qr_data_url: "data:image/png;base64,RklTQ0FM", monto_total: 150, emitido_por_id: usuarioId,
      } });
    }
    return id;
  }

  const vinculadaA = await crearCuenta(false);
  const vinculadaB = await crearCuenta(false);
  const pendiente = await crearCuenta(true);
  const jarA = await login(vinculadaA.cuenta.email);
  const jarPendiente = await login(pendiente.cuenta.email);
  const tokenFuturo = `token-futuro-${randomUUID()}`;
  const tokenSinPlazo = `token-sin-plazo-${randomUUID()}`;
  const tokenVencido = `token-vencido-${randomUUID()}`;
  const baseFecha = ahora.getTime() - 1_000_000;

  const antesListo = await crearPedido(vinculadaA.cliente.id, "WEB", "PAGO_CONFIRMADO", { fecha: new Date(baseFecha + 1_000) });
  const listoFuturo = await crearPedido(vinculadaA.cliente.id, "WEB", "LISTO_PARA_RETIRO", { fecha: new Date(baseFecha + 5_000), token: tokenFuturo, plazo: futuro, comprobante: true });
  const listoSinPlazo = await crearPedido(vinculadaA.cliente.id, "WEB", "LISTO_PARA_RETIRO", { fecha: new Date(baseFecha + 4_000), token: tokenSinPlazo });
  const listoVencido = await crearPedido(vinculadaA.cliente.id, "WEB", "LISTO_PARA_RETIRO", { fecha: new Date(baseFecha + 3_000), token: tokenVencido, plazo: vencido });
  const entregado = await crearPedido(vinculadaA.cliente.id, "WEB", "ENTREGADO", { fecha: new Date(baseFecha + 2_000), token: randomUUID() });
  const ajeno = await crearPedido(vinculadaB.cliente.id, "WEB", "LISTO_PARA_RETIRO", { fecha: ahora, token: randomUUID(), plazo: futuro });
  const mostrador = await crearPedido(vinculadaA.cliente.id, "MOSTRADOR", "ENTREGADO", { fecha: ahora });
  const pedidoInactivo = await crearPedido(vinculadaA.cliente.id, "WEB", "ENTREGADO", { fecha: ahora, pedidoActivo: false });
  const pedidoEliminado = await crearPedido(vinculadaA.cliente.id, "WEB", "ENTREGADO", { fecha: ahora, pedidoEliminado: true });
  const ecommerceInactivo = await crearPedido(vinculadaA.cliente.id, "WEB", "ENTREGADO", { fecha: ahora, ecommerceActivo: false });
  const ecommerceEliminado = await crearPedido(vinculadaA.cliente.id, "WEB", "ENTREGADO", { fecha: ahora, ecommerceEliminado: true });

  await t.test("401 real en historial y detalle conserva contrato y caché", async () => {
    for (const path of ["/api/tienda/mis-pedidos", `/api/tienda/mis-pedidos/${listoFuturo}`]) {
      const result = await llamar(new Jar(), path);
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { data: null, error: { code: "SESION_CLIENTE_WEB_REQUERIDA", message: "Debe iniciar sesión para continuar" } });
      assertCachePrivada(result.response);
    }
  });

  await t.test("403 real para cuenta pendiente no expone datos y conserva caché", async () => {
    for (const path of ["/api/tienda/mis-pedidos", `/api/tienda/mis-pedidos/${listoFuturo}`]) {
      const result = await llamar(jarPendiente, path);
      assert.equal(result.status, 403);
      assert.deepEqual(result.body, { data: null, error: { code: "CUENTA_VINCULACION_PENDIENTE", message: "Tu cuenta está pendiente de validación de identidad en sucursal" } });
      assertCachePrivada(result.response);
      assert.doesNotMatch(result.text, /pedidos|qr_data_url|comprobante/i);
    }
  });

  await t.test("historial filtra, ordena, pagina y devuelve DTO mínimo", async () => {
    const page1 = await llamar(jarA, "/api/tienda/mis-pedidos?page=1&page_size=20");
    assert.equal(page1.status, 200);
    assertCachePrivada(page1.response);
    assert.equal(page1.body.data.total, 5);
    assert.deepEqual(page1.body.data.pedidos.map((pedido: { id: string }) => pedido.id), [listoFuturo, listoSinPlazo, listoVencido, entregado, antesListo]);
    assert.deepEqual(Object.keys(page1.body.data.pedidos[0]).sort(), ["cantidad_items", "estado", "fecha", "id", "numero", "total"]);
    for (const id of [ajeno, mostrador, pedidoInactivo, pedidoEliminado, ecommerceInactivo, ecommerceEliminado]) assert.ok(!page1.text.includes(id));
    for (const sensible of sensibles) assert.ok(!page1.text.toLowerCase().includes(sensible.toLowerCase()));

    const page2 = await llamar(jarA, "/api/tienda/mis-pedidos?page=2&page_size=1");
    assert.equal(page2.status, 200);
    assert.equal(page2.body.data.pagina, 2);
    assert.equal(page2.body.data.por_pagina, 1);
    assert.deepEqual(page2.body.data.pedidos.map((pedido: { id: string }) => pedido.id), [listoSinPlazo]);
    assertCachePrivada(page2.response);
  });

  await t.test("queries inválidas e identidad HTTP maliciosa producen 400", async () => {
    const queries = [
      "page=0", "page=-1", "page=1.5", "page_size=0", "page_size=51", "page=abc", "page_size=abc", "desconocido=x",
      `clienteId=${vinculadaB.cliente.id}`, `cuentaId=${vinculadaB.cuenta.id}`, "email=x", "dni=x", "usuarioId=x",
    ];
    for (const query of queries) {
      const result = await llamar(jarA, `/api/tienda/mis-pedidos?${query}`);
      assert.equal(result.status, 400, query);
      assert.equal(result.body.error.code, "VALIDATION_ERROR", query);
      assertCachePrivada(result.response);
    }
  });

  await t.test("detalle propio minimiza DTO y QR depende únicamente del contrato server-side", async () => {
    const casos = [
      [antesListo, false], [listoFuturo, true], [listoSinPlazo, true], [listoVencido, false], [entregado, false],
    ] as const;
    for (const [id, visible] of casos) {
      const result = await llamar(jarA, `/api/tienda/mis-pedidos/${id}`);
      assert.equal(result.status, 200);
      assertCachePrivada(result.response);
      assert.equal(typeof result.body.data.qr_data_url === "string", visible);
      assert.deepEqual(Object.keys(result.body.data.items[0]).sort(), ["cantidad", "color", "precio_unitario", "producto", "sku", "talle"]);
      for (const sensible of sensibles) assert.ok(!result.text.toLowerCase().includes(sensible.toLowerCase()), sensible);
    }
    const comprobante = (await llamar(jarA, `/api/tienda/mis-pedidos/${listoFuturo}`)).body.data.comprobante;
    assert.deepEqual(Object.keys(comprobante).sort(), ["fecha_emision", "monto", "tipo"]);
  });

  await t.test("IDOR y todas las variantes no visibles producen exactamente el mismo 404", async () => {
    const ids = [ajeno, randomUUID(), mostrador, pedidoInactivo, pedidoEliminado, ecommerceInactivo, ecommerceEliminado];
    const respuestas = await Promise.all(ids.map((id) => llamar(jarA, `/api/tienda/mis-pedidos/${id}`)));
    for (const result of respuestas) {
      assert.equal(result.status, 404);
      assert.deepEqual(result.body, error404);
      assert.equal(result.text, JSON.stringify(error404));
      assertCachePrivada(result.response);
    }
  });

  await t.test("UUID inválido produce 400 HTTP y caché privada", async () => {
    const result = await llamar(jarA, "/api/tienda/mis-pedidos/no-es-uuid");
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "VALIDATION_ERROR");
    assertCachePrivada(result.response);
  });
});
