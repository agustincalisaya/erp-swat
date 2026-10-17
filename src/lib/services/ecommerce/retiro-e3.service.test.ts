import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { ServiceError } from "../../errors/service-error.ts";
import {
  completarRetiroValidadoTx,
  resolverPedidoVentaIdPorQr,
  RetiroRechazadoError,
  validarRetiroBajoLocksTx,
} from "./retiro-e3.service.ts";

const DNI = "12345678";
const QR_A = "qr-sensible-A";
const QR_B = "qr-sensible-B";

type Pedido = {
  id: string; cliente_id: string | null; numero_venta: string; canal: string;
  estado: string; is_active: boolean; deleted_at: Date | null;
};
type Extension = {
  id: string; pedido_venta_id: string; estado_ecommerce: string;
  codigo_qr_retiro: string | null; plazo_retiro_vencimiento: Date | null;
  is_active: boolean; deleted_at: Date | null;
};
type Item = { id: string; cantidad: number; cantidad_facturada: number; cantidad_entregada: number };
type Cliente = { id: string; dni: string; is_active: boolean; deleted_at: Date | null };

function fixture(qr = QR_A, id = "pedido-A") {
  const pedido: Pedido = {
    id, cliente_id: "cliente-1", numero_venta: id === "pedido-A" ? "V-A" : "V-B",
    canal: "WEB", estado: "FACTURADO", is_active: true, deleted_at: null,
  };
  const extension: Extension = {
    id: `ext-${id}`, pedido_venta_id: id, estado_ecommerce: "LISTO_PARA_RETIRO",
    codigo_qr_retiro: qr, plazo_retiro_vencimiento: null, is_active: true, deleted_at: null,
  };
  const items: Item[] = [{ id: `item-${id}`, cantidad: 2, cantidad_facturada: 2, cantidad_entregada: 0 }];
  const cliente: Cliente = { id: "cliente-1", dni: DNI, is_active: true, deleted_at: null };
  const orden: string[] = [];
  const escrituras: string[] = [];
  const conteo = { total: 1 };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      assert.match(query, /FOR UPDATE/);
      if (query.includes("FROM pedido_venta_items")) {
        assert.match(query, /ORDER BY created_at ASC, id ASC/);
        orden.push("items");
        return items;
      }
      if (query.includes("FROM pedidos_venta_ecommerce")) {
        orden.push("extension");
        return [extension];
      }
      if (query.includes("FROM pedidos_venta")) {
        orden.push("pedido");
        assert.equal(values[0], id);
        return [pedido];
      }
      if (query.includes("FROM clientes")) {
        orden.push("cliente");
        assert.equal(values[0], pedido.cliente_id);
        return [cliente];
      }
      throw new Error("Consulta inesperada");
    },
    pedidoVentaItem: { count: async () => conteo.total },
    pedidoVenta: { update: () => escrituras.push("pedido") },
    pedidoVentaEcommerce: { update: () => escrituras.push("extension") },
  } as unknown as Prisma.TransactionClient;
  return { pedido, extension, items, cliente, tx, orden, escrituras, conteo };
}

async function validar(f: ReturnType<typeof fixture>, qr = QR_A, dni = DNI) {
  return validarRetiroBajoLocksTx(f.tx, f.pedido.id, { qr_token: qr, dni });
}

async function motivo(f: ReturnType<typeof fixture>, esperado: string, qr = QR_A, dni = DNI) {
  await assert.rejects(() => validar(f, qr, dni), (error: unknown) => {
    assert.ok(error instanceof RetiroRechazadoError);
    assert.equal(error.motivo, esperado);
    assert.ok(!JSON.stringify(error).includes(qr));
    assert.ok(!JSON.stringify(error).includes(dni));
    return true;
  });
}

test("prelectura mínima: token inexistente y resolución única sin consultar DNI", async () => {
  const consultas: unknown[] = [];
  const db = { pedidoVentaEcommerce: { findUnique: async (args: unknown) => {
    consultas.push(args);
    return null;
  } } } as unknown as Pick<Prisma.TransactionClient, "pedidoVentaEcommerce">;
  await assert.rejects(() => resolverPedidoVentaIdPorQr(db, QR_A),
    (error: unknown) => error instanceof RetiroRechazadoError && error.motivo === "TOKEN_NO_RESUELTO");
  assert.deepEqual(consultas, [{ where: { codigo_qr_retiro: QR_A }, select: { pedido_venta_id: true } }]);
});

test("QR A y B del mismo titular determinan exactamente su pedido, sin mutaciones", async () => {
  for (const [qr, id] of [[QR_A, "pedido-A"], [QR_B, "pedido-B"]] as const) {
    const f = fixture(qr, id);
    const pre = { pedidoVentaEcommerce: { findUnique: async () => ({ pedido_venta_id: id }) } } as unknown as
      Pick<Prisma.TransactionClient, "pedidoVentaEcommerce">;
    assert.equal(await resolverPedidoVentaIdPorQr(pre, qr), id);
    const resultado = await validar(f, qr);
    assert.deepEqual(resultado, { pedido_venta_id: id, pedido_venta_ecommerce_id: `ext-${id}`, numero_venta: f.pedido.numero_venta });
    assert.deepEqual(f.orden, ["pedido", "extension", "items", "cliente"]);
    assert.equal(f.pedido.estado, "FACTURADO");
    assert.equal(f.extension.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.equal(f.extension.codigo_qr_retiro, qr);
    assert.equal(f.items[0].cantidad_entregada, 0);
    assert.deepEqual(f.escrituras, []);
    assert.ok(!JSON.stringify(resultado).includes(qr));
    assert.ok(!JSON.stringify(resultado).includes(DNI));
  }
});

test("relectura bajo lock rechaza QR cambiado y DNI de otro titular", async () => {
  const f = fixture();
  f.extension.codigo_qr_retiro = QR_B;
  await motivo(f, "ESTADO_NO_LISTO");
  await motivo(fixture(), "DNI_NO_COINCIDE", QR_A, "87654321");
});

test("rechazos operativos de venta y extensión", async () => {
  const casos: Array<[string, (f: ReturnType<typeof fixture>) => void, string]> = [
    ["canal", (f) => { f.pedido.canal = "MOSTRADOR"; }, "PEDIDO_NO_OPERABLE"],
    ["venta inactiva", (f) => { f.pedido.is_active = false; }, "PEDIDO_NO_OPERABLE"],
    ["venta eliminada", (f) => { f.pedido.deleted_at = new Date(); }, "PEDIDO_NO_OPERABLE"],
    ["B no facturado", (f) => { f.pedido.estado = "CERRADO"; }, "ESTADO_NO_LISTO"],
    ["extensión inactiva", (f) => { f.extension.is_active = false; }, "PEDIDO_NO_OPERABLE"],
    ["extensión eliminada", (f) => { f.extension.deleted_at = new Date(); }, "PEDIDO_NO_OPERABLE"],
    ["E no listo", (f) => { f.extension.estado_ecommerce = "ENTREGADO"; }, "ESTADO_NO_LISTO"],
  ];
  for (const [nombre, cambiar, esperado] of casos) {
    const f = fixture(); cambiar(f);
    await motivo(f, esperado);
    assert.deepEqual(f.escrituras, [], nombre);
  }
});

test("plazo nulo, futuro y vencido; Cliente activo, inactivo y eliminado", async () => {
  const nulo = fixture(); await validar(nulo);
  const futuro = fixture(); futuro.extension.plazo_retiro_vencimiento = new Date(Date.now() + 60_000);
  await validar(futuro);
  const vencido = fixture(); vencido.extension.plazo_retiro_vencimiento = new Date(Date.now() - 60_000);
  await motivo(vencido, "PLAZO_VENCIDO");
  const inactivo = fixture(); inactivo.cliente.is_active = false;
  await motivo(inactivo, "CLIENTE_NO_OPERABLE");
  const eliminado = fixture(); eliminado.cliente.deleted_at = new Date();
  await motivo(eliminado, "CLIENTE_NO_OPERABLE");
});

test("ítems ausentes, facturación y entrega previa son inconsistencias internas", async () => {
  const casos = [
    (f: ReturnType<typeof fixture>) => { f.items.length = 0; f.conteo.total = 0; },
    (f: ReturnType<typeof fixture>) => { f.conteo.total = 2; },
    (f: ReturnType<typeof fixture>) => { f.items[0].cantidad_facturada = 1; },
    (f: ReturnType<typeof fixture>) => { f.items[0].cantidad_entregada = 1; },
    (f: ReturnType<typeof fixture>) => { f.items[0].cantidad_entregada = 3; },
  ];
  for (const cambiar of casos) {
    const f = fixture(); cambiar(f);
    await assert.rejects(() => validar(f), (error: unknown) =>
      error instanceof ServiceError && error.code === "ESTADO_INCONSISTENTE");
    assert.deepEqual(f.escrituras, []);
  }
});

test("CuentaClienteWeb no se consulta ni condiciona el retiro", async () => {
  const f = fixture();
  Object.assign(f.tx, { cuentaClienteWeb: { findFirst: () => { throw new Error("Consulta web prohibida"); } } });
  await validar(f);
});

function fixtureEntrega(opciones: { fallaB?: boolean; fallaE?: boolean } = {}) {
  const operaciones: string[] = [];
  let estadoB = opciones.fallaB ? "RESERVADO" : "FACTURADO";
  let cantidadEntregada = 0;
  let estadoE = "LISTO_PARA_RETIRO";
  let token: string | null = QR_A;
  const tx = {
    pedidoVenta: {
      findFirst: async () => {
        operaciones.push("B:validar");
        return estadoB === "FACTURADO" ? { id: "pedido-A" } : null;
      },
      updateMany: async (args: { where: { estado: string }; data: { estado: string } }) => {
        operaciones.push(`B:${args.data.estado}`);
        if (estadoB !== args.where.estado) return { count: 0 };
        estadoB = args.data.estado;
        return { count: 1 };
      },
    },
    pedidoVentaItem: {
      findMany: async () => {
        operaciones.push("B:items");
        return [{ id: "item-A", cantidad: 2, cantidad_facturada: 2,
          cantidad_entregada: cantidadEntregada, is_active: true, deleted_at: null }];
      },
      updateMany: async (args: { data: { cantidad_entregada: number } }) => {
        operaciones.push("B:entregar-item");
        cantidadEntregada = args.data.cantidad_entregada;
        return { count: 1 };
      },
    },
    pedidoVentaEcommerce: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: { estado_ecommerce: string; codigo_qr_retiro: null };
      }) => {
        operaciones.push("E:entregar");
        assert.deepEqual(args.where, {
          id: "ext-pedido-A", pedido_venta_id: "pedido-A", is_active: true,
          deleted_at: null, estado_ecommerce: "LISTO_PARA_RETIRO", codigo_qr_retiro: QR_A,
        });
        assert.deepEqual(args.data, { estado_ecommerce: "ENTREGADO", codigo_qr_retiro: null });
        if (opciones.fallaE) return { count: 0 };
        estadoE = args.data.estado_ecommerce;
        token = args.data.codigo_qr_retiro;
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, operaciones, estado: () => ({ estadoB, cantidadEntregada, estadoE, token }) };
}

const retiroValidado = {
  pedido_venta_id: "pedido-A", pedido_venta_ecommerce_id: "ext-pedido-A", numero_venta: "V-A",
};

test("T5 continúa sobre el mismo tx: helper B antes de UPDATE E condicional", async () => {
  const f = fixtureEntrega();
  const resultado = await completarRetiroValidadoTx(f.tx, retiroValidado, QR_A);
  assert.deepEqual(f.operaciones, ["B:validar", "B:items", "B:entregar-item",
    "B:REMITO_EMITIDO", "B:CERRADO", "E:entregar"]);
  assert.deepEqual(f.estado(), {
    estadoB: "CERRADO", cantidadEntregada: 2, estadoE: "ENTREGADO", token: null,
  });
  assert.deepEqual(resultado, { ...retiroValidado, estado: "ENTREGADO" });
  assert.ok(!JSON.stringify(resultado).includes(QR_A));
  assert.ok(!JSON.stringify(resultado).includes(DNI));
});

test("fallo B impide E; fallo E propaga error para rollback del caller", async () => {
  const fallaB = fixtureEntrega({ fallaB: true });
  await assert.rejects(() => completarRetiroValidadoTx(fallaB.tx, retiroValidado, QR_A),
    (error: unknown) => error instanceof ServiceError && error.code === "TRANSICION_INVALIDA");
  assert.deepEqual(fallaB.operaciones, ["B:validar"]);
  const fallaE = fixtureEntrega({ fallaE: true });
  await assert.rejects(() => completarRetiroValidadoTx(fallaE.tx, retiroValidado, QR_A),
    (error: unknown) => error instanceof RetiroRechazadoError && error.motivo === "ESTADO_NO_LISTO");
  assert.equal(fallaE.operaciones.at(-1), "E:entregar");
});

test("orquestador conserva T4 y B/E; no escribe AuditLog, stock ni pagos", () => {
  const fuente = readFileSync(new URL("./retiro-e3.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /resultado = await conRetiroValidadoTx\(input, \(tx, retiro\) =>\s*completarRetiroValidadoTx\(tx, retiro, input\.qr_token\)\)/);
  assert.doesNotMatch(fuente, /auditLog|stockDeposito|ventaMedioPago|cuentaClienteWeb/);
});
