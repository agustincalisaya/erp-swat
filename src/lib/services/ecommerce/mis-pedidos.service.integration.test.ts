import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E9_INTEGRATION_DATABASE_URL;

test("HU-E9 consulta pedidos propios y QR contra PostgreSQL aislado", {
  skip: !DATABASE_URL,
  timeout: 60_000,
}, async (t) => {
  if (!DATABASE_URL) throw new Error("Falta HU_E9_INTEGRATION_DATABASE_URL");
  const url = new URL(DATABASE_URL);
  if (!(["postgres:", "postgresql:"].includes(url.protocol) &&
    ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/hu_e9_test")) {
    throw new Error("HU-E9 requiere una base PostgreSQL local dedicada llamada hu_e9_test");
  }
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, { listarPedidosWebCliente, obtenerPedidoWebCliente, obtenerComprobanteWebCliente }, { ServiceError }] =
    await Promise.all([
      import("../../db/prisma.ts"),
      import("./mis-pedidos.service.ts"),
      import("../../errors/service-error.ts"),
    ]);
  t.after(() => prisma.$disconnect());

  const usuarioId = randomUUID();
  const clienteAId = randomUUID();
  const clienteBId = randomUUID();
  const proveedorId = randomUUID();
  const productoId = randomUUID();
  const varianteId = randomUUID();
  const pedidosCreados: string[] = [];
  const ahora = new Date();
  const plazo = new Date(ahora.getTime() + 86_400_000);
  const codigo = randomUUID();
  const tokenRetiro = randomUUID();
  const rollback = new Error("rollback de fixtures HU-E9");

  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.usuario.create({ data: {
      id: usuarioId, nombre_usuario: `hu-e9-${codigo}`, email: `hu-e9-${codigo}@example.invalid`,
      password_hash: "cuenta-no-operativa", password_salt: "cuenta-no-operativa",
      nombre_completo: "Registrante de pruebas HU-E9", estado: "INACTIVO", is_active: false,
    } });
    const dniA = String(randomInt(10_000_000, 99_999_999));
    let dniB = String(randomInt(10_000_000, 99_999_999));
    while (dniB === dniA) dniB = String(randomInt(10_000_000, 99_999_999));
    await tx.cliente.createMany({ data: [
      { id: clienteAId, dni: dniA, nombre: "Cliente A HU-E9" },
      { id: clienteBId, dni: dniB, nombre: "Cliente B HU-E9" },
    ] });
    await tx.proveedor.create({ data: { id: proveedorId, cuit: `HU-E9-${codigo}`, razon_social: "Proveedor pruebas HU-E9", categorias: [] } });
    await tx.productoMaestro.create({ data: {
      id: productoId, codigo_producto: "HUE9", nombre: "Producto HU-E9", rubro: "Pruebas",
      categoria: "Pruebas", unidad_medida: "UNIDAD", costo_estandar_referencia: 50,
    } });
    await tx.varianteSKU.create({ data: {
      id: varianteId, producto_maestro_id: productoId, proveedor_id: proveedorId,
      sku: `HU-E9-${codigo}`, talle: "M", color: "Negro", genero: "Unisex", modelo: "Prueba",
    } });

    async function crearPedido(clienteId: string, canal: "WEB" | "MOSTRADOR", estado: "PAGO_CONFIRMADO" | "EN_PREPARACION" | "LISTO_PARA_RETIRO" | "ENTREGADO" | "CANCELADO", opciones: { inactivo?: boolean; vencimiento?: Date; token?: string } = {}) {
      const id = randomUUID();
      pedidosCreados.push(id);
      const pedido = await tx.pedidoVenta.create({ data: {
        id, numero_venta: `V-HU-E9-${id}`, cliente_id: clienteId, canal,
        estado: estado === "ENTREGADO" ? "CERRADO" : "FACTURADO",
        registrado_por_id: usuarioId, total: 150,
        ...(opciones.inactivo ? { is_active: false, deleted_at: ahora, deleted_by: usuarioId, deletion_reason: "Histórico de prueba" } : {}),
      } });
      await tx.pedidoVentaItem.create({ data: {
        pedido_venta_id: pedido.id, variante_sku_id: varianteId, cantidad: 1, precio_unitario: 150,
      } });
      if (canal === "WEB") {
        await tx.pedidoVentaEcommerce.create({ data: {
          pedido_venta_id: pedido.id, estado_ecommerce: estado,
          codigo_qr_retiro: opciones.token ?? null, plazo_retiro_vencimiento: opciones.vencimiento ?? null,
          ...(opciones.inactivo ? { is_active: false, deleted_at: ahora, deleted_by: usuarioId, deletion_reason: "Histórico de prueba" } : {}),
        } });
      }
      return pedido.id;
    }

    const pago = await crearPedido(clienteAId, "WEB", "PAGO_CONFIRMADO");
    const preparacion = await crearPedido(clienteAId, "WEB", "EN_PREPARACION");
    const listo = await crearPedido(clienteAId, "WEB", "LISTO_PARA_RETIRO", { vencimiento: plazo, token: tokenRetiro });
    const entregado = await crearPedido(clienteAId, "WEB", "ENTREGADO", { token: randomUUID() });
    const historico = await crearPedido(clienteAId, "WEB", "CANCELADO", { inactivo: true, token: randomUUID() });
    const ajeno = await crearPedido(clienteBId, "WEB", "LISTO_PARA_RETIRO", { vencimiento: plazo, token: randomUUID() });
    const mostrador = await crearPedido(clienteAId, "MOSTRADOR", "ENTREGADO");

    const comprobanteId = randomUUID();
    await tx.comprobanteFiscal.create({ data: {
      id: comprobanteId, pedido_venta_id: ajeno, tipo_comprobante: "FACTURA_B",
      cae_simulado: "12345678901234", qr_data_url: "data:image/png;base64,AA==",
      monto_total: 150, emitido_por_id: usuarioId,
    } });

    const listado = await listarPedidosWebCliente(clienteAId, { db: tx });
    assert.equal(listado.total, 4);
    assert.deepEqual(new Set(listado.pedidos.map((p) => p.id)), new Set([pago, preparacion, listo, entregado]));
    assert.ok(!listado.pedidos.some((p) => p.id === ajeno || p.id === mostrador || p.id === historico));
    assert.equal((await listarPedidosWebCliente(clienteAId, { db: tx, pagina: 2, porPagina: 2 })).pedidos.length, 2);

    const propio = await obtenerPedidoWebCliente(clienteAId, listo, { db: tx, ahora });
    assert.equal(propio.items[0].producto, "Producto HU-E9");
    assert.match(propio.qr_data_url ?? "", /^data:image\/png;base64,/);
    assert.ok(!JSON.stringify(propio).includes(tokenRetiro));
    for (const id of [pago, preparacion, entregado]) {
      assert.equal((await obtenerPedidoWebCliente(clienteAId, id, { db: tx, ahora })).qr_data_url, null);
    }
    const codigoError = async (id: string) => {
      try {
        await obtenerPedidoWebCliente(clienteAId, id, { db: tx });
      } catch (error) {
        assert.ok(error instanceof ServiceError);
        return { code: error.code, message: error.message };
      }
      throw new Error("La consulta debió devolver PEDIDO_NO_ENCONTRADO");
    };
    assert.deepEqual(await codigoError(ajeno), await codigoError(randomUUID()));
    assert.deepEqual(await codigoError(historico), await codigoError(randomUUID()));
    assert.deepEqual(await codigoError(mostrador), await codigoError(randomUUID()));
    await assert.rejects(
      () => obtenerComprobanteWebCliente(clienteAId, ajeno, comprobanteId, { db: tx }),
      (error: unknown) => error instanceof ServiceError && error.code === "COMPROBANTE_NO_ENCONTRADO",
    );
    throw rollback;
  }, { timeout: 45_000 }), (error: unknown) => {
    if (error !== rollback) throw error;
    return true;
  });

  assert.equal(await prisma.pedidoVenta.count({ where: { id: { in: pedidosCreados } } }), 0);
  assert.equal(await prisma.cliente.count({ where: { id: { in: [clienteAId, clienteBId] } } }), 0);
  assert.equal(await prisma.usuario.count({ where: { id: usuarioId } }), 0);
});
