import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/** HU-E3 T5: usar exclusivamente una copia PostgreSQL descartable con seed. */
const DATABASE_URL = process.env.HU_E3_T5_INTEGRATION_DATABASE_URL;
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

function barrera<T>() {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>((resolve) => { resolver = resolve; });
  return { promise, resolver };
}

test("HU-E3 T5: entrega B/E atómica, rollback y doble retiro en PostgreSQL", {
  skip: !DATABASE_URL,
  timeout: 90_000,
}, async (t) => {
  if (!DATABASE_URL) return;
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, {
    validarYEntregarRetiro, conRetiroValidadoTx, completarRetiroValidadoTx, RetiroRechazadoError,
  }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./retiro-e3.service.ts"),
  ]);
  const fixtures: Array<{ clienteId: string; pedidoId: string }> = [];
  t.after(async () => {
    try {
      const ahora = new Date();
      for (const fixture of fixtures) {
        await prisma.pedidoVentaItem.updateMany({
          where: { pedido_venta_id: fixture.pedidoId }, data: { is_active: false, deleted_at: ahora },
        });
        await prisma.pedidoVentaEcommerce.updateMany({
          where: { pedido_venta_id: fixture.pedidoId }, data: { is_active: false, deleted_at: ahora },
        });
        await prisma.pedidoVenta.update({
          where: { id: fixture.pedidoId }, data: { is_active: false, deleted_at: ahora },
        });
        await prisma.cliente.update({
          where: { id: fixture.clienteId }, data: { is_active: false, deleted_at: ahora },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function crearFixture() {
    const sufijo = randomUUID();
    const dni = String(Math.floor(10_000_000 + Math.random() * 90_000_000));
    const qr_token = randomUUID();
    const plazo = new Date(Date.now() + 600_000);
    const cliente = await prisma.cliente.create({
      data: { dni, nombre: `Test retiro T5 ${sufijo}` }, select: { id: true },
    });
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `V-TEST-E3-T5-${sufijo}`,
        cliente_id: cliente.id,
        registrado_por_id: USUARIO_CAJERO_SEED_ID,
        canal: "WEB",
        estado: "FACTURADO",
        total: 250,
        items: { create: [
          { variante_sku_id: VARIANTE_BORCEGOS_2_ID, cantidad: 2,
            cantidad_facturada: 2, cantidad_entregada: 0, precio_unitario: 50 },
          { variante_sku_id: VARIANTE_BORCEGOS_2_ID, cantidad: 3,
            cantidad_facturada: 3, cantidad_entregada: 0, precio_unitario: 50 },
        ] },
      },
      select: { id: true, numero_venta: true },
    });
    fixtures.push({ clienteId: cliente.id, pedidoId: pedido.id });
    const extension = await prisma.pedidoVentaEcommerce.create({
      data: { pedido_venta_id: pedido.id, estado_ecommerce: "LISTO_PARA_RETIRO",
        codigo_qr_retiro: qr_token, plazo_retiro_vencimiento: plazo },
      select: { id: true },
    });
    return { pedido, extension, input: { qr_token, dni }, plazo };
  }

  async function leerEstado(pedidoId: string) {
    const [pedido, extension, items] = await Promise.all([
      prisma.pedidoVenta.findUniqueOrThrow({
        where: { id: pedidoId }, select: { estado: true },
      }),
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: pedidoId },
        select: { estado_ecommerce: true, codigo_qr_retiro: true,
          plazo_retiro_vencimiento: true },
      }),
      prisma.pedidoVentaItem.findMany({
        where: { pedido_venta_id: pedidoId },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        select: { cantidad: true, cantidad_facturada: true, cantidad_entregada: true },
      }),
    ]);
    return { pedido, extension, items };
  }

  await t.test("éxito real, QR consumido, plazo conservado y segundo uso rechazado", async () => {
    const f = await crearFixture();
    const resultado = await validarYEntregarRetiro(f.input, USUARIO_CAJERO_SEED_ID);
    assert.deepEqual(resultado, {
      pedido_venta_id: f.pedido.id,
      pedido_venta_ecommerce_id: f.extension.id,
      numero_venta: f.pedido.numero_venta,
      estado: "ENTREGADO",
    });
    assert.ok(!JSON.stringify(resultado).includes(f.input.qr_token));
    assert.ok(!JSON.stringify(resultado).includes(f.input.dni));
    const estado = await leerEstado(f.pedido.id);
    assert.equal(estado.pedido.estado, "CERRADO");
    assert.equal(estado.extension.estado_ecommerce, "ENTREGADO");
    assert.equal(estado.extension.codigo_qr_retiro, null);
    assert.deepEqual(estado.extension.plazo_retiro_vencimiento, f.plazo);
    assert.deepEqual(estado.items.map((item) => [item.cantidad, item.cantidad_facturada,
      item.cantidad_entregada]).sort((a, b) => a[0] - b[0]), [[2, 2, 2], [3, 3, 3]]);
    await assert.rejects(() => validarYEntregarRetiro(f.input, USUARIO_CAJERO_SEED_ID),
      (error: unknown) => error instanceof RetiroRechazadoError &&
        error.motivo === "TOKEN_NO_RESUELTO");
    assert.deepEqual(await leerEstado(f.pedido.id), estado);
    assert.equal(await prisma.ventaMedioPago.count({ where: { pedido_venta_id: f.pedido.id } }), 0);
  });

  await t.test("fallo controlado del UPDATE E revierte B e ítems", async () => {
    const f = await crearFixture();
    // Trigger temporal de la base descartable: hace que solo el UPDATE E de
    // este fixture afecte cero filas después de que el helper B se ejecutó.
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION hu_e3_t5_omitir_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$
    `);
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER hu_e3_t5_omitir_update
        BEFORE UPDATE ON pedidos_venta_ecommerce
        FOR EACH ROW WHEN (OLD.id = '${f.extension.id}')
        EXECUTE FUNCTION hu_e3_t5_omitir_update()
      `);
      await assert.rejects(() => validarYEntregarRetiro(f.input, USUARIO_CAJERO_SEED_ID),
        (error: unknown) => error instanceof RetiroRechazadoError &&
          error.motivo === "ESTADO_NO_LISTO");
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS hu_e3_t5_omitir_update ON pedidos_venta_ecommerce");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS hu_e3_t5_omitir_update()");
    }
    const estado = await leerEstado(f.pedido.id);
    assert.equal(estado.pedido.estado, "FACTURADO");
    assert.equal(estado.extension.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.equal(estado.extension.codigo_qr_retiro, f.input.qr_token);
    assert.deepEqual(estado.extension.plazo_retiro_vencimiento, f.plazo);
    assert.deepEqual(estado.items.map((item) => item.cantidad_entregada), [0, 0]);
  });

  await t.test("dos operadores preleídos compiten: uno entrega, otro espera y rechaza", async () => {
    const f = await crearFixture();
    const liberarA = barrera<void>();
    const entroA = barrera<number>();
    let aTerminada = false;
    let bTerminada = false;
    const a = conRetiroValidadoTx(f.input, async (tx, retiro) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      entroA.resolver(pid);
      await liberarA.promise;
      return completarRetiroValidadoTx(tx, retiro, f.input.qr_token);
    }).finally(() => { aTerminada = true; });

    try {
      const pidA = await entroA.promise;
      // B ejecuta la operación pública T5: al observarla bloqueada sobre
      // PedidoVenta, ya completó su prelectura del token antes del commit A.
      const b = validarYEntregarRetiro(f.input, USUARIO_CAJERO_SEED_ID).then(
        (valor) => { bTerminada = true; return { ok: true as const, valor }; },
        (error: unknown) => { bTerminada = true; return { ok: false as const, error }; },
      );
      const limite = Date.now() + 3_000;
      let pidB: number | undefined;
      while (Date.now() < limite) {
        const bloqueados = await prisma.$queryRaw<{ pid: number; bloqueadores: number[] }[]>`
          SELECT pid, pg_blocking_pids(pid) AS bloqueadores
          FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
        `;
        pidB = bloqueados.find((fila) => fila.pid !== pidA &&
          fila.bloqueadores.includes(pidA))?.pid;
        if (pidB) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(pidB, "PostgreSQL debe mostrar al retiro B esperando el lock de A");
      assert.equal(aTerminada, false);
      assert.equal(bTerminada, false);
      liberarA.resolver();
      const resultadoA = await a;
      const resultadoB = await b;
      assert.equal(resultadoA.estado, "ENTREGADO");
      assert.equal(resultadoB.ok, false);
      if (!resultadoB.ok) {
        assert.ok(resultadoB.error instanceof RetiroRechazadoError);
        assert.equal(resultadoB.error.motivo, "ESTADO_NO_LISTO");
      }
    } finally {
      liberarA.resolver();
      await a;
    }
    const estado = await leerEstado(f.pedido.id);
    assert.equal(estado.pedido.estado, "CERRADO");
    assert.equal(estado.extension.estado_ecommerce, "ENTREGADO");
    assert.equal(estado.extension.codigo_qr_retiro, null);
    assert.deepEqual(estado.extension.plazo_retiro_vencimiento, f.plazo);
    assert.deepEqual(estado.items.map((item) => item.cantidad_entregada).sort(), [2, 3]);
  });
});
