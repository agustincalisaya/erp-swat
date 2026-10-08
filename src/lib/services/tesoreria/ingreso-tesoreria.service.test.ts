/**
 * HU-G11 — service de ingresos de Tesorería por cobros web.
 *
 * Carga el service real con un Prisma aislado (sin BD), siguiendo el patrón de
 * `audit-log.listener.test.ts`. Verifica idempotencia por ambas claves
 * (`pedido_venta_id` y `mercadopago_payment_id`), la captura race-safe de
 * `P2002`, la inmutabilidad/idempotencia del contra-asiento y que el service
 * NUNCA usa `prisma.*.delete()`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { Prisma } from "@prisma/client";

interface Servicio {
  registrarIngresoWeb: (input: unknown) => Promise<Record<string, unknown> | null>;
  registrarContraAsiento: (input: unknown) => Promise<Record<string, unknown> | null>;
  listarIngresosWeb: (filtros: unknown) => Promise<Record<string, unknown>>;
  reprocesarIngresoWeb: (pedidoVentaId: string) => Promise<Record<string, unknown> | null>;
}

function cargarServicio(prismaFake: unknown): Servicio {
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@prisma/client": { Prisma },
    "@/lib/db/prisma": { prisma: prismaFake },
  };
  const ruta = "./ingreso-tesoreria.service.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const ejecutar = runInThisContext(
    `(function(require, module, exports) {\n${codigo}\n})`,
    { filename: ruta },
  );
  ejecutar(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) {
        throw new Error(`Dependencia inesperada: ${nombre}`);
      }
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
  );
  return modulo.exports as unknown as Servicio;
}

/** Prisma mínimo: `$transaction` ejecuta el callback con el `tx` provisto. */
function prismaConTx(tx: unknown): unknown {
  return { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
}

const inputIngreso = {
  pedido_venta_id: "pedido-1",
  mercadopago_payment_id: "mp-1",
  monto: 100.5,
  fecha_aprobacion: "2026-10-06T12:00:00.000Z",
};

test("registrarIngresoWeb: un ingreso preexistente (misma clave) es no-op", async () => {
  let creó = false;
  const tx = {
    ingresoTesoreria: {
      findFirst: async () => ({ id: "existente" }),
      create: async () => {
        creó = true;
        return {};
      },
    },
  };
  const f = cargarServicio(prismaConTx(tx));
  const r = await f.registrarIngresoWeb(inputIngreso);
  assert.equal(r, null);
  assert.equal(creó, false);
});

test("registrarIngresoWeb: el pre-check consulta AMBAS claves únicas (OR)", async () => {
  let whereRecibido: unknown;
  const tx = {
    ingresoTesoreria: {
      findFirst: async (args: { where: unknown }) => {
        whereRecibido = args.where;
        return null;
      },
      create: async () => ({
        id: "nuevo",
        monto: new Prisma.Decimal("100.50"),
        fecha: new Date("2026-10-06T12:00:00.000Z"),
        estado: "PENDIENTE_CONCILIACION",
        caja_virtual: "MERCADO_PAGO_CANAL_WEB",
      }),
    },
  };
  const f = cargarServicio(prismaConTx(tx));
  await f.registrarIngresoWeb(inputIngreso);
  assert.deepEqual(whereRecibido, {
    OR: [
      { pedido_venta_id: "pedido-1" },
      { mercadopago_payment_id: "mp-1" },
    ],
  });
});

test("registrarIngresoWeb: registra con estado y caja_virtual constantes y monto serializado", async () => {
  let dataRecibida: Record<string, unknown> = {};
  const tx = {
    ingresoTesoreria: {
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        dataRecibida = args.data;
        return {
          id: "nuevo",
          monto: new Prisma.Decimal("100.50"),
          fecha: new Date("2026-10-06T12:00:00.000Z"),
          estado: "PENDIENTE_CONCILIACION",
          caja_virtual: "MERCADO_PAGO_CANAL_WEB",
        };
      },
    },
  };
  const f = cargarServicio(prismaConTx(tx));
  const r = await f.registrarIngresoWeb(inputIngreso);

  assert.equal(dataRecibida.estado, "PENDIENTE_CONCILIACION");
  assert.equal(dataRecibida.caja_virtual, "MERCADO_PAGO_CANAL_WEB");
  assert.equal((dataRecibida.monto as Prisma.Decimal).toFixed(2), "100.50");
  assert.ok(r);
  assert.equal(r.ingreso_id, "nuevo");
  assert.equal(r.monto, "100.50");
  assert.equal(r.estado, "PENDIENTE_CONCILIACION");
  assert.equal(r.caja_virtual, "MERCADO_PAGO_CANAL_WEB");
});

test("registrarIngresoWeb: un P2002 concurrente se trata como no-op (race-safe)", async () => {
  const tx = {
    ingresoTesoreria: {
      findFirst: async () => null,
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "6.19.3",
        });
      },
    },
  };
  const f = cargarServicio(prismaConTx(tx));
  const r = await f.registrarIngresoWeb(inputIngreso);
  assert.equal(r, null);
});

test("registrarContraAsiento: repetir un pedido ya contra-asentado es no-op", async () => {
  let creó = false;
  const tx = {
    contraAsientoIngreso: {
      findUnique: async () => ({ id: "contra-existente" }),
      create: async () => {
        creó = true;
        return {};
      },
    },
    ingresoTesoreria: { findUnique: async () => ({ id: "ingreso-1" }) },
  };
  const f = cargarServicio(prismaConTx(tx));
  const r = await f.registrarContraAsiento({ pedido_venta_id: "pedido-1", monto: 50, motivo: "reintegro" });
  assert.equal(r, null);
  assert.equal(creó, false);
});

test("registrarContraAsiento: resuelve ingreso_original_id por pedido_venta_id y nunca edita el original", async () => {
  let dataRecibida: Record<string, unknown> = {};
  const tx = {
    contraAsientoIngreso: {
      findUnique: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        dataRecibida = args.data;
        return { id: "contra-nuevo", monto: new Prisma.Decimal("50.00") };
      },
    },
    ingresoTesoreria: { findUnique: async () => ({ id: "ingreso-original" }) },
  };
  const f = cargarServicio(prismaConTx(tx));
  const r = await f.registrarContraAsiento({ pedido_venta_id: "pedido-1", monto: 50, motivo: "reintegro" });

  assert.equal(dataRecibida.ingreso_original_id, "ingreso-original");
  assert.equal(dataRecibida.pedido_venta_id, "pedido-1");
  assert.ok(r);
  assert.equal(r.contra_asiento_id, "contra-nuevo");
  assert.equal(r.ingreso_original_id, "ingreso-original");
  assert.equal(r.monto, "50.00");
});

test("registrarContraAsiento: sin IngresoTesoreria previo es no-op (no crea huérfano)", async () => {
  let creó = false;
  const tx = {
    contraAsientoIngreso: {
      findUnique: async () => null,
      create: async () => {
        creó = true;
        return {};
      },
    },
    ingresoTesoreria: { findUnique: async () => null },
  };
  const f = cargarServicio(prismaConTx(tx));
  const r = await f.registrarContraAsiento({ pedido_venta_id: "pedido-sin", monto: 50, motivo: "x" });
  assert.equal(r, null);
  assert.equal(creó, false);
});

test("listarIngresosWeb: shape paginado con monto y fecha serializados", async () => {
  const prismaFake = {
    ingresoTesoreria: {
      findMany: async () => [
        {
          id: "i1",
          pedido_venta_id: "p1",
          mercadopago_payment_id: "mp1",
          monto: new Prisma.Decimal("1234.5"),
          fecha: new Date("2026-10-06T12:00:00.000Z"),
          estado: "PENDIENTE_CONCILIACION",
          caja_virtual: "MERCADO_PAGO_CANAL_WEB",
          created_at: new Date("2026-10-06T12:00:00.000Z"),
        },
      ],
      count: async () => 1,
    },
  };
  const f = cargarServicio(prismaFake);
  const r = await f.listarIngresosWeb({ page: 1, page_size: 25 });
  assert.equal(r.total, 1);
  assert.equal(r.page, 1);
  assert.equal(r.page_size, 25);
  const registros = r.registros as Record<string, unknown>[];
  assert.equal(registros.length, 1);
  assert.equal(registros[0].monto, "1234.50");
  assert.equal(registros[0].fecha, "2026-10-06T12:00:00.000Z");
});

test("reprocesarIngresoWeb: un pedido sin pago confirmado es no-op", async () => {
  const prismaFake = {
    pedidoVentaEcommerce: {
      findUnique: async () => ({
        mercadopago_payment_id: null,
        fecha_pago_confirmado: null,
        is_active: true,
      }),
    },
    pedidoVenta: { findUnique: async () => ({ total: new Prisma.Decimal("100.00") }) },
  };
  const f = cargarServicio(prismaFake);
  const r = await f.reprocesarIngresoWeb("pedido-1");
  assert.equal(r, null);
});

// P-R2 (task HU-E2-integracion §9): "pagado" = fecha_pago_confirmado y
// mercadopago_payment_id no nulos, sin mirar estado_ecommerce. Tras E2+E12 el
// pedido confirmado ya está en EN_PREPARACION (PAGO_CONFIRMADO nunca persiste).

/** Prisma falso del reproceso: el pedido web leído + la tx de `registrarIngresoWeb`. */
function prismaReproceso(
  pve: Record<string, unknown>,
  ingresoExistente: { id: string } | null,
): { prisma: unknown; creados: Record<string, unknown>[] } {
  const creados: Record<string, unknown>[] = [];
  const tx = {
    ingresoTesoreria: {
      findFirst: async () => ingresoExistente,
      create: async (args: { data: Record<string, unknown> }) => {
        creados.push(args.data);
        return {
          id: "ingreso-reproceso",
          monto: args.data.monto,
          fecha: args.data.fecha,
          estado: args.data.estado,
          caja_virtual: args.data.caja_virtual,
        };
      },
    },
  };
  return {
    creados,
    prisma: {
      pedidoVentaEcommerce: { findUnique: async () => pve },
      pedidoVenta: { findUnique: async () => ({ total: new Prisma.Decimal("19350.00") }) },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
}

const pedidoEnPreparacion = {
  mercadopago_payment_id: "mp-reproceso",
  fecha_pago_confirmado: new Date("2026-10-08T15:30:00.000Z"),
  is_active: true,
};

test("reprocesarIngresoWeb: un pedido EN_PREPARACION con pago confirmado registra el ingreso", async () => {
  const { prisma, creados } = prismaReproceso(pedidoEnPreparacion, null);
  const f = cargarServicio(prisma);
  const r = await f.reprocesarIngresoWeb("pedido-1");

  assert.equal(creados.length, 1);
  assert.equal(creados[0].pedido_venta_id, "pedido-1");
  assert.equal(creados[0].mercadopago_payment_id, "mp-reproceso");
  assert.equal((creados[0].monto as Prisma.Decimal).toFixed(2), "19350.00");
  assert.equal((creados[0].fecha as Date).toISOString(), "2026-10-08T15:30:00.000Z");
  assert.ok(r);
  assert.equal(r.ingreso_id, "ingreso-reproceso");
  assert.equal(r.monto, "19350.00");
  assert.equal(r.fecha, "2026-10-08T15:30:00.000Z");
});

test("reprocesarIngresoWeb: reprocesar un pedido EN_PREPARACION ya registrado es no-op (idempotente)", async () => {
  const { prisma, creados } = prismaReproceso(pedidoEnPreparacion, { id: "ingreso-previo" });
  const f = cargarServicio(prisma);
  const r = await f.reprocesarIngresoWeb("pedido-1");
  assert.equal(r, null);
  assert.equal(creados.length, 0);
});

test("reprocesarIngresoWeb: un pago rechazado (payment_id sin fecha de pago) es no-op", async () => {
  const { prisma, creados } = prismaReproceso(
    { mercadopago_payment_id: "mp-rechazado", fecha_pago_confirmado: null, is_active: true },
    null,
  );
  const f = cargarServicio(prisma);
  const r = await f.reprocesarIngresoWeb("pedido-1");
  assert.equal(r, null);
  assert.equal(creados.length, 0);
});

test("reprocesarIngresoWeb: el criterio de pagado no depende de estado_ecommerce", () => {
  const fuente = readFileSync(new URL("./ingreso-tesoreria.service.ts", import.meta.url), "utf8");
  const inicio = fuente.indexOf("export async function reprocesarIngresoWeb");
  const cuerpo = fuente.slice(inicio);
  assert.ok(inicio > -1);
  assert.doesNotMatch(cuerpo, /estado_ecommerce/);
  assert.match(cuerpo, /!pve\.fecha_pago_confirmado/);
  assert.match(cuerpo, /!pve\.mercadopago_payment_id/);
});

test("el service nunca usa prisma.*.delete() ni deleteMany()", () => {
  const fuente = readFileSync(new URL("./ingreso-tesoreria.service.ts", import.meta.url), "utf8");
  assert.equal(/\b(?:prisma|tx)\.\w+\.(?:delete|deleteMany)\s*\(/.test(fuente), false);
});
