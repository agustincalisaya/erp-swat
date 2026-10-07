import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * HU-E3 T4, PostgreSQL real y descartable. Requiere una base con esquema y
 * referencias de usuario/variante del seed, igual que la integración B de T3.
 * Ejecutar con HU_E3_T4_INTEGRATION_DATABASE_URL; nunca usar una base productiva.
 */
const DATABASE_URL = process.env.HU_E3_T4_INTEGRATION_DATABASE_URL;
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

function barrera<T>() {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>((resolve) => { resolver = resolve; });
  return { promise, resolver };
}

test("HU-E3 T4: SQL real, locks retenidos y revalidación tras espera", {
  skip: !DATABASE_URL,
  timeout: 60_000,
}, async (t) => {
  if (!DATABASE_URL) return;
  process.env.DATABASE_URL = DATABASE_URL;

  const [{ prisma }, { conRetiroValidadoTx, resolverPedidoVentaIdPorQr, validarRetiroBajoLocksTx,
    RetiroRechazadoError }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./retiro-e3.service.ts"),
  ]);
  t.after(async () => prisma.$disconnect());

  const sufijo = randomUUID();
  const dni = String(Math.floor(10_000_000 + Math.random() * 90_000_000));
  const qr_token = randomUUID();
  const cliente = await prisma.cliente.create({
    data: { dni, nombre: `Test retiro ${sufijo}` },
    select: { id: true },
  });
  const fixtureIds: { pedido?: string } = {};
  t.after(async () => {
    // Solo baja lógica de fixtures propios, sin DELETE físico.
    const ahora = new Date();
    if (fixtureIds.pedido) {
      await prisma.pedidoVentaItem.updateMany({
        where: { pedido_venta_id: fixtureIds.pedido }, data: { is_active: false, deleted_at: ahora },
      });
      await prisma.pedidoVentaEcommerce.updateMany({
        where: { pedido_venta_id: fixtureIds.pedido }, data: { is_active: false, deleted_at: ahora },
      });
      await prisma.pedidoVenta.update({
        where: { id: fixtureIds.pedido }, data: { is_active: false, deleted_at: ahora },
      });
    }
    await prisma.cliente.update({
      where: { id: cliente.id }, data: { is_active: false, deleted_at: ahora },
    });
  });

  const pedido = await prisma.pedidoVenta.create({
    data: {
      numero_venta: `V-TEST-E3-T4-${sufijo}`,
      cliente_id: cliente.id,
      registrado_por_id: USUARIO_CAJERO_SEED_ID,
      canal: "WEB",
      estado: "FACTURADO",
      total: 100,
      items: {
        create: [{
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          cantidad: 2,
          cantidad_facturada: 2,
          cantidad_entregada: 0,
          precio_unitario: 50,
        }],
      },
    },
    select: { id: true, numero_venta: true },
  });
  fixtureIds.pedido = pedido.id;
  const extension = await prisma.pedidoVentaEcommerce.create({
    data: {
      pedido_venta_id: pedido.id,
      estado_ecommerce: "LISTO_PARA_RETIRO",
      codigo_qr_retiro: qr_token,
      plazo_retiro_vencimiento: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });
  const input = { qr_token, dni };

  async function comprobarSinEntrega(tokenEsperado: string | null) {
    const [venta, ecommerce, items] = await Promise.all([
      prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pedido.id }, select: { estado: true } }),
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { id: extension.id }, select: { estado_ecommerce: true, codigo_qr_retiro: true },
      }),
      prisma.pedidoVentaItem.findMany({
        where: { pedido_venta_id: pedido.id }, select: { cantidad_entregada: true },
      }),
    ]);
    assert.equal(venta.estado, "FACTURADO");
    assert.equal(ecommerce.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.equal(ecommerce.codigo_qr_retiro, tokenEsperado);
    assert.deepEqual(items.map((item) => item.cantidad_entregada), [0]);
  }

  await t.test("A: las cuatro consultas raw validan y el callback conserva el agregado", async () => {
    const metadata = await conRetiroValidadoTx(input, async (tx, retiro) => {
      assert.deepEqual(retiro, {
        pedido_venta_id: pedido.id,
        pedido_venta_ecommerce_id: extension.id,
        numero_venta: pedido.numero_venta,
      });
      const [venta, ecommerce, items] = await Promise.all([
        tx.pedidoVenta.findUniqueOrThrow({ where: { id: pedido.id }, select: { estado: true } }),
        tx.pedidoVentaEcommerce.findUniqueOrThrow({
          where: { id: extension.id }, select: { estado_ecommerce: true, codigo_qr_retiro: true },
        }),
        tx.pedidoVentaItem.findMany({
          where: { pedido_venta_id: pedido.id }, select: { cantidad_entregada: true },
        }),
      ]);
      assert.equal(venta.estado, "FACTURADO");
      assert.equal(ecommerce.estado_ecommerce, "LISTO_PARA_RETIRO");
      assert.equal(ecommerce.codigo_qr_retiro, qr_token);
      assert.deepEqual(items.map((item) => item.cantidad_entregada), [0]);
      return retiro;
    });
    assert.equal(metadata.pedido_venta_id, pedido.id);
    assert.ok(!JSON.stringify(metadata).includes(qr_token));
    assert.ok(!JSON.stringify(metadata).includes(dni));
    await comprobarSinEntrega(qr_token);
  });

  await t.test("B/C: venta bloqueada durante callback; tras liberación se relee el QR cambiado", async () => {
    const liberarA = barrera<void>();
    const entroA = barrera<number>();
    const entroB = barrera<number>();
    let aTerminada = false;
    let bTerminada = false;

    const a = conRetiroValidadoTx(input, async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      entroA.resolver(pid);
      await liberarA.promise;
      // Única mutación técnica controlada: simula que otro mutador consumió
      // el QR mientras el competidor conserva una prelectura anterior.
      await tx.pedidoVentaEcommerce.update({
        where: { id: extension.id }, data: { codigo_qr_retiro: null },
      });
    }).finally(() => { aTerminada = true; });

    try {
      const pidA = await entroA.promise;
      const preleido = await resolverPedidoVentaIdPorQr(prisma, qr_token);
      assert.equal(preleido, pedido.id);
      const b = prisma.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        entroB.resolver(pid);
        return validarRetiroBajoLocksTx(tx, preleido, input);
      }, { timeout: 15_000 }).then(
        (valor) => { bTerminada = true; return { ok: true as const, valor }; },
        (error: unknown) => { bTerminada = true; return { ok: false as const, error }; },
      );
      const pidB = await entroB.promise;
      assert.notEqual(pidA, pidB);

      // Observación del propio gestor de locks de PostgreSQL. El plazo es
      // solo guardrail; la evidencia es pg_blocking_pids, no el sleep.
      const limite = Date.now() + 3_000;
      let bloqueadores: number[] = [];
      while (Date.now() < limite) {
        const [fila] = await prisma.$queryRaw<{ bloqueadores: number[] }[]>`
          SELECT pg_blocking_pids(${pidB}::integer) AS bloqueadores
        `;
        bloqueadores = fila.bloqueadores;
        if (bloqueadores.includes(pidA)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(bloqueadores.includes(pidA), "PostgreSQL debe mostrar a Tx A bloqueando Tx B");
      assert.equal(aTerminada, false);
      assert.equal(bTerminada, false);

      liberarA.resolver();
      await a;
      const resultadoB = await b;
      assert.equal(resultadoB.ok, false);
      if (!resultadoB.ok) {
        assert.ok(resultadoB.error instanceof RetiroRechazadoError);
        assert.equal(resultadoB.error.motivo, "ESTADO_NO_LISTO");
        assert.ok(!JSON.stringify(resultadoB.error).includes(qr_token));
        assert.ok(!JSON.stringify(resultadoB.error).includes(dni));
      }
      await comprobarSinEntrega(null);
    } finally {
      liberarA.resolver();
      await a;
      // Restaurar el token del fixture antes de la baja lógica final.
      await prisma.pedidoVentaEcommerce.update({
        where: { id: extension.id }, data: { codigo_qr_retiro: qr_token },
      });
    }
    await comprobarSinEntrega(qr_token);
  });
});
