/**
 * HU-G7 §9.8 — `posicion-diaria.service.ts` (sin base de datos).
 *
 * Carga el service real con dependencias aisladas, mismo patrón que
 * `reporte-mensual-extensiones.service.test.ts`: `transpileModule` + `vm` +
 * `require` falso. Se transpila con target ES2022. El cálculo y las fechas son
 * los módulos REALES (`posicion-diaria.calculo.ts` y `fecha-negocio.ts`,
 * transpilados igual); la base de datos, el bus de eventos y la lista de
 * cuentas propias son falsos e inyectados.
 *
 * Cubre: constantes de permiso; `registrarSaldoDiario` append-only (solo
 * `create`, sin update/delete/upsert), emisión D1 POST-COMMIT y ausencia de
 * emisión cuando la transacción falla; `obtenerPosicionDiaria` (DTO, cortes,
 * caja virtual SIN cota inferior, y el negativo estructural de `TurnoCaja`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { Prisma } from "@prisma/client";
import { ServiceError } from "../../errors/service-error.ts";

type Modulo = Record<string, unknown>;

const requireReal = createRequire(import.meta.url);
const dec = (valor: string) => new Prisma.Decimal(valor);

function cargarModulo(ruta: string, dependencias: Record<string, unknown>): Modulo {
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const modulo: { exports: Modulo } = { exports: {} };
  const ejecutar = runInThisContext(`(function(require, module, exports) {\n${codigo}\n})`, { filename: ruta });
  ejecutar(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) {
        throw new Error(`Dependencia inesperada en ${ruta}: ${nombre}`);
      }
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
  );
  return modulo.exports;
}

// ── Fakes inyectados ──────────────────────────────────────────────────────────

interface ArgsWhere {
  fecha?: { lt?: Date; lte?: Date; gte?: Date };
  created_at?: { lt?: Date };
  estado?: unknown;
}
interface Args {
  where?: ArgsWhere;
  [k: string]: unknown;
}
type Fila = Record<string, unknown>;

/** Fila mínima del DTO de la posición que consume este test. */
interface CuentaDto {
  cuenta_id: string;
  nombre: string;
  tipo: string;
  origen: string;
  saldo: string | null;
  sin_saldo_registrado: boolean;
  fecha_saldo: string | null;
}
interface PosicionDto {
  dia: string;
  corte: { liquido: string; proyecciones: string };
  cuentas: CuentaDto[];
  caja_virtual: { id: string; saldo: string; nota_retiros: string };
  total_liquido: string;
  proyeccion_egresos: {
    definitivas: unknown[];
    provisorias: unknown[];
    total_definitivas: string;
    nota: string;
  };
  proyeccion_ingresos: {
    cuentas_corrientes: { saldo_actual: string }[];
    hitos: { importe: string; fecha_estimada: string }[];
    nota_cobranzas_externas: string;
  };
}
/** Argumentos del `create` append-only que captura el test. */
interface CreadoArgs {
  data: { cuenta_id: string; fecha: Date; saldo: Prisma.Decimal; registrado_por_id: string };
}

const capturas: Record<"saldos" | "ingresos" | "contra" | "cxp" | "cc", Args[]> = {
  saldos: [],
  ingresos: [],
  contra: [],
  cxp: [],
  cc: [],
};
const fixtures: Record<"cuentas" | "asientos" | "ingresos" | "contra" | "cxp" | "cc", Fila[]> = {
  cuentas: [],
  asientos: [],
  ingresos: [],
  contra: [],
  cxp: [],
  cc: [],
};

let txImpl: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> = async () => {
  throw new Error("transacción no configurada en este test");
};

const prismaFalso = {
  saldoDiarioCuenta: { findMany: async (a: Args) => (capturas.saldos.push(a), fixtures.asientos) },
  ingresoTesoreria: { findMany: async (a: Args) => (capturas.ingresos.push(a), fixtures.ingresos) },
  contraAsientoIngreso: { findMany: async (a: Args) => (capturas.contra.push(a), fixtures.contra) },
  cuentaPorPagar: { findMany: async (a: Args) => (capturas.cxp.push(a), fixtures.cxp) },
  cuentaCorrienteCliente: { findMany: async (a: Args) => (capturas.cc.push(a), fixtures.cc) },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => txImpl(fn),
};

const emitidos: { tipo: string; payload: Record<string, unknown> }[] = [];
/** Secuencia global de efectos: `commit` (fin de transacción) y `emit` (evento). */
const orden: string[] = [];
const busFalso = {
  emit: (tipo: string, payload: Record<string, unknown>) => {
    orden.push("emit");
    emitidos.push({ tipo, payload });
  },
  on: () => {},
  listeners: () => [],
};

const fechaNegocio = cargarModulo("../../utils/fecha-negocio.ts", { "date-fns": requireReal("date-fns") });
const calculo = cargarModulo("./posicion-diaria.calculo.ts", {
  "@prisma/client": requireReal("@prisma/client"),
  "../../utils/fecha-negocio.ts": fechaNegocio,
});
const servicio = cargarModulo("./posicion-diaria.service.ts", {
  "server-only": {},
  "@prisma/client": requireReal("@prisma/client"),
  "@/lib/db/prisma": { prisma: prismaFalso },
  "@/lib/errors/service-error": { ServiceError },
  "@/lib/events/domain-event-bus": { domainEventBus: busFalso },
  "@/lib/schemas/posicion-diaria.schema": {},
  "@/lib/utils/fecha-negocio": fechaNegocio,
  "@/lib/services/tesoreria/cuenta-propia.service": {
    listarCuentasPropiasActivas: async () => fixtures.cuentas,
  },
  "@/lib/services/tesoreria/ingreso-tesoreria.service": { CAJA_VIRTUAL_MERCADO_PAGO_WEB: "MERCADO_PAGO_CANAL_WEB" },
  "@/lib/services/tesoreria/posicion-diaria.calculo": calculo,
  "@/lib/services/tesoreria/reporte-mensual.service": { PERMISO_LEER_REPORTES: "tesoreria:leer_reportes" },
}) as unknown as {
  PERMISO_REGISTRAR_SALDO_DIARIO: string;
  PERMISO_LEER_REPORTES: string;
  CAJA_VIRTUAL_MERCADO_PAGO_WEB: string;
  obtenerPosicionDiaria: (dia: string) => Promise<PosicionDto>;
  registrarSaldoDiario: (
    input: { cuenta_id: string; fecha: string; saldo: string },
    usuarioId: string,
  ) => Promise<Record<string, string>>;
};

function resetear(): void {
  for (const clave of Object.keys(capturas) as (keyof typeof capturas)[]) capturas[clave] = [];
  for (const clave of Object.keys(fixtures) as (keyof typeof fixtures)[]) fixtures[clave] = [];
  emitidos.length = 0;
  orden.length = 0;
}

/** Configura una transacción con un `tx` falso y registra el orden tx→emit. */
function configurarTx(opciones: {
  cuentaEncontrada?: boolean;
  fallaCreate?: boolean;
}): { mutacionProhibida: () => boolean; creadoArgs: () => CreadoArgs | null } {
  let mutacion = false;
  let creado: CreadoArgs | null = null;
  const tx = {
    cuentaPropia: {
      findFirst: async () => (opciones.cuentaEncontrada === false ? null : { id: "c1" }),
    },
    saldoDiarioCuenta: {
      create: async (args: CreadoArgs) => {
        if (opciones.fallaCreate) throw new Error("falla de base en el create");
        creado = args;
        return { id: "s1", cuenta_id: args.data.cuenta_id, fecha: args.data.fecha, saldo: args.data.saldo };
      },
      update: () => {
        mutacion = true;
        throw new Error("append-only: update prohibido");
      },
      delete: () => {
        mutacion = true;
        throw new Error("append-only: delete prohibido");
      },
      deleteMany: () => {
        mutacion = true;
        throw new Error("append-only: deleteMany prohibido");
      },
      upsert: () => {
        mutacion = true;
        throw new Error("append-only: upsert prohibido");
      },
    },
  };
  txImpl = async (fn) => {
    const resultado = await fn(tx);
    orden.push("commit");
    return resultado;
  };
  return { mutacionProhibida: () => mutacion, creadoArgs: () => creado };
}

// ── Constantes ────────────────────────────────────────────────────────────────

test("expone las constantes de permiso y la caja virtual de Mercado Pago", () => {
  assert.equal(servicio.PERMISO_REGISTRAR_SALDO_DIARIO, "tesoreria:registrar_saldo_diario");
  assert.equal(servicio.PERMISO_LEER_REPORTES, "tesoreria:leer_reportes");
  assert.equal(servicio.CAJA_VIRTUAL_MERCADO_PAGO_WEB, "MERCADO_PAGO_CANAL_WEB");
});

// ── G7-4 — registro append-only ───────────────────────────────────────────────

test("registrarSaldoDiario: crea UNA fila (solo create), nunca update/delete/upsert", async () => {
  resetear();
  const { mutacionProhibida, creadoArgs } = configurarTx({});
  const resultado = await servicio.registrarSaldoDiario(
    { cuenta_id: "banco-nacion-cc-principal", fecha: "2026-10-15", saldo: "1250000.00" },
    "u1",
  );
  assert.deepEqual(resultado, {
    saldo_diario_id: "s1",
    cuenta_id: "banco-nacion-cc-principal",
    fecha: "2026-10-15T00:00:00.000Z",
    saldo: "1250000.00",
  });
  assert.equal(mutacionProhibida(), false, "no hay update/delete/upsert");
  const creado = creadoArgs()!;
  assert.equal(creado.data.cuenta_id, "banco-nacion-cc-principal");
  assert.equal(creado.data.registrado_por_id, "u1");
  assert.equal((creado.data.fecha as Date).toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal((creado.data.saldo as Prisma.Decimal).toFixed(2), "1250000.00");
});

test("registrarSaldoDiario: emite el evento D1 SOLO después del COMMIT", async () => {
  resetear();
  configurarTx({});
  await servicio.registrarSaldoDiario(
    { cuenta_id: "caja-chica-central", fecha: "2026-10-15", saldo: "500.25" },
    "u1",
  );
  assert.deepEqual(orden, ["commit", "emit"]);
  assert.equal(emitidos.length, 1);
  const [evento] = emitidos;
  assert.equal(evento!.tipo, "tesoreria:saldo_diario_registrado");
  assert.deepEqual(
    { ...evento!.payload, timestamp: undefined },
    {
      cuenta_propia_id: "caja-chica-central",
      fecha: "2026-10-15T00:00:00.000Z",
      saldo: "500.25",
      usuario_id: "u1",
      timestamp: undefined,
    },
  );
  assert.equal(typeof evento!.payload.timestamp, "string");
});

test("registrarSaldoDiario: dos registros del mismo día persisten DOS filas (append-only)", async () => {
  resetear();
  const { mutacionProhibida } = configurarTx({});
  await servicio.registrarSaldoDiario({ cuenta_id: "c1", fecha: "2026-10-15", saldo: "100.00" }, "u1");
  await servicio.registrarSaldoDiario({ cuenta_id: "c1", fecha: "2026-10-15", saldo: "200.00" }, "u1");
  assert.equal(mutacionProhibida(), false);
  assert.deepEqual(orden, ["commit", "emit", "commit", "emit"], "cada registro tiene su COMMIT y su evento");
  assert.equal(emitidos.length, 2, "dos asientos ⇒ dos eventos");
});

test("registrarSaldoDiario: cuenta inexistente/inactiva ⇒ CUENTA_PROPRIA_NO_ENCONTRADA y SIN emitir", async () => {
  resetear();
  configurarTx({ cuentaEncontrada: false });
  await assert.rejects(
    () => servicio.registrarSaldoDiario({ cuenta_id: "fantasma", fecha: "2026-10-15", saldo: "1.00" }, "u1"),
    (error: unknown) => error instanceof ServiceError && error.code === "CUENTA_PROPRIA_NO_ENCONTRADA",
  );
  assert.equal(emitidos.length, 0, "no se emite nada si la transacción falla");
});

test("registrarSaldoDiario: falla el create pre-COMMIT ⇒ se propaga y NO emite", async () => {
  resetear();
  configurarTx({ fallaCreate: true });
  await assert.rejects(
    () => servicio.registrarSaldoDiario({ cuenta_id: "c1", fecha: "2026-10-15", saldo: "1.00" }, "u1"),
    /falla de base/,
  );
  assert.equal(emitidos.length, 0);
});

// ── G7-1..G7-8 — lectura de la posición ───────────────────────────────────────

test("obtenerPosicionDiaria: arma el DTO con los dos cortes, saldos y caja virtual", async () => {
  resetear();
  fixtures.cuentas = [
    { id: "banco-nacion-cc-principal", nombre: "Banco Nación — CC Principal", tipo: "BANCARIA" },
    { id: "caja-chica-central", nombre: "Caja Chica — Central", tipo: "CAJA" },
  ];
  fixtures.asientos = [
    {
      id: "a1",
      cuenta_id: "banco-nacion-cc-principal",
      fecha: new Date("2026-10-15T00:00:00.000Z"),
      created_at: new Date("2026-10-15T10:00:00.000Z"),
      saldo: dec("1250000.00"),
    },
  ];
  fixtures.ingresos = [{ monto: dec("500.00") }];
  fixtures.contra = [{ monto: dec("100.00") }];
  fixtures.cxp = [
    { id: "d1", estado: "DEFINITIVA", monto: dec("100.00"), fecha_vencimiento: null },
    { id: "p1", estado: "PROVISORIO", monto: dec("999.00"), fecha_vencimiento: null },
  ];
  fixtures.cc = [
    {
      id: "cc1",
      saldo_actual: dec("250.00"),
      cliente: { nombre: "Juan Pérez" },
      operaciones: [
        { monto: dec("1000.00"), plan_de_pagos: [{ hito: "Seña", porcentaje: 30, fecha_estimada: "2026-11-01" }] },
      ],
    },
  ];

  const posicion = await servicio.obtenerPosicionDiaria("2026-10-15");

  assert.equal(posicion.dia, "2026-10-15");
  assert.deepEqual(posicion.corte, { liquido: "2026-10-15", proyecciones: "ESTADO_ACTUAL" });

  const banco = posicion.cuentas.find((c) => c.cuenta_id === "banco-nacion-cc-principal");
  const caja = posicion.cuentas.find((c) => c.cuenta_id === "caja-chica-central");
  assert.deepEqual(banco, {
    cuenta_id: "banco-nacion-cc-principal",
    nombre: "Banco Nación — CC Principal",
    tipo: "BANCARIA",
    origen: "PROPIA",
    saldo: "1250000.00",
    sin_saldo_registrado: false,
    fecha_saldo: "2026-10-15",
  });
  assert.equal(caja!.sin_saldo_registrado, true);
  assert.equal(caja!.saldo, null);

  assert.equal(posicion.caja_virtual.id, "MERCADO_PAGO_CANAL_WEB");
  assert.equal(posicion.caja_virtual.saldo, "400.00");
  assert.match(posicion.caja_virtual.nota_retiros, /retiros/i);
  assert.equal(posicion.total_liquido, "1250400.00");

  assert.equal(posicion.proyeccion_egresos.total_definitivas, "100.00");
  assert.equal(posicion.proyeccion_egresos.definitivas.length, 1);
  assert.equal(posicion.proyeccion_egresos.provisorias.length, 1);
  assert.equal(posicion.proyeccion_ingresos.cuentas_corrientes[0].saldo_actual, "250.00");
  assert.equal(posicion.proyeccion_ingresos.hitos[0].importe, "300.00");
  assert.equal(posicion.proyeccion_ingresos.hitos[0].fecha_estimada, "2026-11-01");
});

test("obtenerPosicionDiaria: la caja virtual se lee SIN cota inferior y con el corte semiabierto del día siguiente", async () => {
  resetear();
  fixtures.cuentas = [{ id: "c1", nombre: "C", tipo: "BANCARIA" }];
  await servicio.obtenerPosicionDiaria("2026-10-15");

  const hasta = new Date("2026-10-16T03:00:00.000Z").getTime(); // medianoche ART del 16/10.
  assert.equal(capturas.ingresos[0]!.where!.fecha!.lt!.getTime(), hasta);
  assert.equal("gte" in (capturas.ingresos[0]!.where!.fecha as object), false, "sin cota inferior (cross-month)");
  assert.equal(capturas.contra[0]!.where!.created_at!.lt!.getTime(), hasta);
  assert.equal(capturas.saldos[0]!.where!.fecha!.lte!.getTime(), new Date("2026-10-15T00:00:00.000Z").getTime());
  // Egresos: solo DEFINITIVA/PROVISORIO activas.
  assert.deepEqual(capturas.cxp[0]!.where!.estado, { in: ["DEFINITIVA", "PROVISORIO"] });
});

test("obtenerPosicionDiaria: un día inválido ⇒ PERIODO_INVALIDO (sin tocar la base)", async () => {
  resetear();
  await assert.rejects(
    () => servicio.obtenerPosicionDiaria("2026-13-01"),
    (error: unknown) => error instanceof ServiceError && error.code === "PERIODO_INVALIDO",
  );
  assert.equal(capturas.saldos.length, 0);
});

test("obtenerPosicionDiaria: la respuesta NUNCA lleva CBU/alias ni saldo_esperado/turno", async () => {
  resetear();
  fixtures.cuentas = [{ id: "banco-nacion-cc-principal", nombre: "Banco Nación", tipo: "BANCARIA" }];
  fixtures.asientos = [
    {
      id: "a1",
      cuenta_id: "banco-nacion-cc-principal",
      fecha: new Date("2026-10-15T00:00:00.000Z"),
      created_at: new Date("2026-10-15T00:00:00.000Z"),
      saldo: dec("100.00"),
    },
  ];
  const posicion = await servicio.obtenerPosicionDiaria("2026-10-15");
  const json = JSON.stringify(posicion).toLowerCase();
  for (const prohibido of ["cbu", "alias", "saldo_esperado", "turno", "nacion.cc.principal"]) {
    assert.ok(!json.includes(prohibido), `la respuesta no debe contener "${prohibido}"`);
  }
});

test("el service NO lee TurnoCaja y no usa .toNumber() sobre dinero (negativo estructural)", () => {
  const fuente = readFileSync(new URL("./posicion-diaria.service.ts", import.meta.url), "utf8");
  // Se ignoran los comentarios: la cabecera del módulo NOMBRA TurnoCaja y
  // `.toNumber()` justamente para documentar que NO se usan.
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bturnoCaja\b/i.test(codigo), "no debe leer TurnoCaja");
  assert.ok(!/saldo_esperado/i.test(codigo), "no debe exponer saldo_esperado");
  assert.ok(!/\.toNumber\(/.test(codigo), "el dinero no pasa por .toNumber()");
});
