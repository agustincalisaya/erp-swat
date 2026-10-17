import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T05_INTEGRATION_DATABASE_URL;

test("HU-E13 T05 — resultado discriminado de contra-asiento", {
  skip: !DATABASE_URL,
  timeout: 120_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, { registrarContraAsiento }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./ingreso-tesoreria.service.ts"),
  ]);
  t.after(() => prisma.$disconnect());

  const actor = await prisma.usuario.findFirstOrThrow({ where: { is_active: true }, select: { id: true } });

  async function pedido() {
    return prisma.pedidoVenta.create({
      data: {
        numero_venta: `T05-${randomUUID()}`,
        canal: "WEB",
        estado: "FACTURADO",
        total: 1500,
        fecha_facturacion: new Date(),
        registrado_por_id: actor.id,
      },
    });
  }

  async function conIngreso() {
    const venta = await pedido();
    const ingreso = await prisma.ingresoTesoreria.create({
      data: {
        pedido_venta_id: venta.id,
        mercadopago_payment_id: `t05-${randomUUID()}`,
        monto: venta.total,
        fecha: new Date("2026-10-08T12:00:00.000Z"),
        estado: "PENDIENTE_CONCILIACION",
        caja_virtual: "MERCADO_PAGO_CANAL_WEB",
      },
    });
    return { venta, ingreso };
  }

  function input(pedido_venta_id: string) {
    return { pedido_venta_id, monto: 1500, motivo: "Reintegro total HU-E13" };
  }

  await t.test("crea y luego reutiliza el mismo contra-asiento sin mutar el ingreso", async () => {
    const f = await conIngreso();
    const ingresoAntes = await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { id: f.ingreso.id } });

    const creado = await registrarContraAsiento(input(f.venta.id));
    const existente = await registrarContraAsiento(input(f.venta.id));

    assert.equal(creado.resultado, "CREADO");
    assert.equal(existente.resultado, "YA_EXISTENTE");
    assert.equal(existente.contra_asiento_id, creado.contra_asiento_id);
    assert.equal(creado.ingreso_original_id, f.ingreso.id);
    assert.equal(creado.monto, "1500.00");
    assert.equal(creado.motivo, "Reintegro total HU-E13");
    assert.equal(await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.venta.id } }), 1);
    assert.deepEqual(await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { id: f.ingreso.id } }), ingresoAntes);
  });

  await t.test("distingue ingreso original no encontrado sin crear contra-asiento", async () => {
    const venta = await pedido();
    const resultado = await registrarContraAsiento(input(venta.id));
    assert.deepEqual(resultado, {
      resultado: "INGRESO_ORIGINAL_NO_ENCONTRADO",
      pedido_venta_id: venta.id,
    });
    assert.equal(await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: venta.id } }), 0);
  });

  await t.test("dos llamadas concurrentes devuelven CREADO y YA_EXISTENTE con una fila", async () => {
    const f = await conIngreso();
    const ingresoAntes = await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { id: f.ingreso.id } });

    const resultados = await Promise.all([
      registrarContraAsiento(input(f.venta.id)),
      registrarContraAsiento(input(f.venta.id)),
    ]);

    assert.deepEqual(resultados.map((resultado) => resultado.resultado).sort(), ["CREADO", "YA_EXISTENTE"]);
    const exitosos = resultados.filter((resultado) => resultado.resultado !== "INGRESO_ORIGINAL_NO_ENCONTRADO");
    assert.equal(new Set(exitosos.map((resultado) => resultado.contra_asiento_id)).size, 1);
    assert.equal(await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.venta.id } }), 1);
    assert.deepEqual(await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { id: f.ingreso.id } }), ingresoAntes);
  });
});
