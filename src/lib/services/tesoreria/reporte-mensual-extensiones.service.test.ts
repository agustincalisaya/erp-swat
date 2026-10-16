/**
 * HU-G15 — `obtenerBloquesAdicionales` / `generarBloquesAdicionales`
 * (contrato del PR 0 para el Cluster 6).
 *
 * Carga el service real con dependencias aisladas (sin BD), mismo patrón que
 * `reporte-mensual.service.test.ts`: `transpileModule` + `vm` + `require`
 * falso. Se transpila con target ES2022 (con el target por defecto los spread
 * de iteradores se rompen, lección de HU-D6). El cálculo y las fechas son los
 * módulos REALES (`reporte-mensual-extensiones.calculo.ts` y
 * `fecha-negocio.ts`, transpilados igual); el cliente de base y HU-G14 son
 * falsos e inyectados.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { ServiceError } from "../../errors/service-error.ts";

type Modulo = Record<string, unknown>;

const requireReal = createRequire(import.meta.url);

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

// ── Tipos mínimos de lo que se prueba ─────────────────────────────────────────

interface Opciones {
  incluir_desglose_gastos: boolean;
}
interface Bloque {
  clave: string;
  titulo: string;
  columnas: string[];
  filas: string[][];
}
interface FilaCuenta {
  id: string;
  monto: { toFixed: (decimales: number) => string };
  fecha_pago: Date | null;
  orden_compra: { proveedor: { id: string; razon_social: string } | null } | null;
}
interface ArgsFindMany {
  where: unknown;
  select: unknown;
}
interface ClienteFalso {
  cuentaPorPagar: { findMany: (args: ArgsFindMany) => Promise<FilaCuenta[]> };
}
type ResumenFalso = (anio: number, mes: number, opciones: Opciones) => Promise<unknown>;
interface Dependencias {
  cliente?: ClienteFalso;
  obtenerResumenMensual?: ResumenFalso;
}
interface Servicio {
  obtenerBloquesAdicionales: (anio: number, mes: number, opciones: Opciones) => Promise<Bloque[]>;
  generarBloquesAdicionales: (anio: number, mes: number, opciones: Opciones, deps?: Dependencias) => Promise<Bloque[]>;
  consultarPagosProveedoresDelMes: (
    cliente: ClienteFalso,
    anio: number,
    mes: number,
  ) => Promise<{ proveedor_id: string; razon_social: string; monto: string }[]>;
}

// ── Carga ─────────────────────────────────────────────────────────────────────

/** Dependencias "reales" por defecto del service: se reemplazan por test cuando hace falta. */
const porDefecto: { cliente: ClienteFalso; obtenerResumenMensual: ResumenFalso } = {
  cliente: {
    cuentaPorPagar: {
      findMany: async () => {
        throw new Error("el prisma por defecto no debe usarse en este test");
      },
    },
  },
  obtenerResumenMensual: async () => {
    throw new Error("el HU-G14 por defecto no debe usarse en este test");
  },
};

const fechaNegocio = cargarModulo("../../utils/fecha-negocio.ts", { "date-fns": requireReal("date-fns") });
const calculo = cargarModulo("./reporte-mensual-extensiones.calculo.ts", {
  "../../utils/fecha-negocio.ts": fechaNegocio,
});
const servicio = cargarModulo("./reporte-mensual-extensiones.service.ts", {
  "server-only": {},
  "@/lib/db/prisma": {
    prisma: { cuentaPorPagar: { findMany: (args: ArgsFindMany) => porDefecto.cliente.cuentaPorPagar.findMany(args) } },
  },
  "@/lib/errors/service-error": { ServiceError },
  "@/lib/utils/fecha-negocio": fechaNegocio,
  "@/lib/services/tesoreria/reporte-mensual.service": {
    obtenerResumenMensual: (anio: number, mes: number, opciones: Opciones) =>
      porDefecto.obtenerResumenMensual(anio, mes, opciones),
  },
  "@/lib/services/tesoreria/reporte-mensual-extensiones.calculo": calculo,
}) as unknown as Servicio;

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Imita `Prisma.Decimal.toFixed`: devuelve el string tal cual lo guarda la base. */
function decimal(valor: string) {
  return {
    toFixed: (decimales: number) => {
      assert.equal(decimales, 2);
      return valor;
    },
  };
}

let secuencia = 0;
function cuenta(proveedorId: string, razonSocial: string, monto: string, fechaPago: string): FilaCuenta {
  secuencia += 1;
  return {
    id: `cxp-${secuencia}`,
    monto: decimal(monto),
    fecha_pago: new Date(fechaPago),
    orden_compra: { proveedor: { id: proveedorId, razon_social: razonSocial } },
  };
}

function clienteCon(filas: FilaCuenta[]) {
  const llamadas: ArgsFindMany[] = [];
  const cliente: ClienteFalso = {
    cuentaPorPagar: {
      findMany: async (args) => {
        llamadas.push(args);
        return filas;
      },
    },
  };
  return { cliente, llamadas };
}

type Totales = { ingresos: string; egresos: string; resultado_neto: string };
const CEROS: Totales = { ingresos: "0.00", egresos: "0.00", resultado_neto: "0.00" };

/** HU-G14 falso: DTO completo del PR 0 con los totales pedidos por mes (`AAAA-MM`). */
function resumenCon(totalesPorMes: Record<string, Totales> = {}) {
  const llamadas: [number, number, Opciones][] = [];
  const obtenerResumenMensual: ResumenFalso = async (anio, mes, opciones) => {
    llamadas.push([anio, mes, opciones]);
    const t = totalesPorMes[`${anio}-${String(mes).padStart(2, "0")}`] ?? CEROS;
    return {
      periodo: { anio, mes, desde: "", hasta: "" },
      ingresos: { web: "0.00", reintegros_web: "0.00", mostrador_por_medio: [], mostrador: "0.00", total: t.ingresos },
      egresos: { proveedores: "0.00", gastos_operativos: "0.00", gastos_por_categoria: null, total: t.egresos },
      resultado_neto: t.resultado_neto,
      porcentaje_egresos_sobre_ingresos: null,
      ventas_cuenta_corriente_informativo: "0.00",
    };
  };
  return { obtenerResumenMensual, llamadas };
}

const SIN_DESGLOSE: Opciones = { incluir_desglose_gastos: false };
const CON_DESGLOSE: Opciones = { incluir_desglose_gastos: true };

const COLUMNAS_PROVEEDORES = ["Proveedor", "Total pagado ($)", "Cantidad de pagos"];

function esServiceError(codigo: string) {
  return (error: unknown) => error instanceof ServiceError && error.code === codigo;
}

// ── Estructura ────────────────────────────────────────────────────────────────

test("devuelve siempre dos bloques, en orden, con claves, títulos y columnas exactos", async () => {
  const { cliente } = clienteCon([cuenta("p1", "Textil Norte SA", "1500.00", "2026-10-15T15:00:00.000Z")]);
  const { obtenerResumenMensual } = resumenCon({
    "2026-10": { ingresos: "11225.00", egresos: "1500.00", resultado_neto: "9725.00" },
    "2026-09": { ingresos: "10000.00", egresos: "2000.00", resultado_neto: "8000.00" },
  });
  const bloques = await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, { cliente, obtenerResumenMensual });
  assert.deepEqual(bloques, [
    {
      clave: "egresos_por_proveedor",
      titulo: "Egresos por proveedor",
      columnas: COLUMNAS_PROVEEDORES,
      filas: [["Textil Norte SA", "1.500,00", "1"]],
    },
    {
      clave: "comparacion_mes_anterior",
      titulo: "Comparación con el mes anterior",
      columnas: ["Concepto", "Septiembre 2026", "Octubre 2026", "Variación ($)", "Variación (%)"],
      filas: [
        ["Ingresos", "10.000,00", "11.225,00", "+1.225,00", "+12,3 %"],
        ["Egresos", "2.000,00", "1.500,00", "-500,00", "-25,0 %"],
        ["Resultado neto", "8.000,00", "9.725,00", "+1.725,00", "+21,6 %"],
      ],
    },
  ]);
});

test("mes sin pagos: el bloque de proveedores está presente con las filas vacías", async () => {
  const { cliente } = clienteCon([]);
  const bloques = await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
    cliente,
    obtenerResumenMensual: resumenCon().obtenerResumenMensual,
  });
  assert.equal(bloques.length, 2);
  assert.deepEqual(bloques[0], {
    clave: "egresos_por_proveedor",
    titulo: "Egresos por proveedor",
    columnas: COLUMNAS_PROVEEDORES,
    filas: [],
  });
});

// ── Consulta ──────────────────────────────────────────────────────────────────

test("la consulta pide PAGADA, activa y el rango que cubre día calendario e instante argentino", async () => {
  const { cliente, llamadas } = clienteCon([]);
  await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
    cliente,
    obtenerResumenMensual: resumenCon().obtenerResumenMensual,
  });
  assert.equal(llamadas.length, 1, "una sola consulta");
  assert.deepEqual(llamadas[0]!.where, {
    estado: "PAGADA",
    is_active: true,
    // desde: medianoche UTC del 1/10 (rangoMesFechaSolo); hasta: 1/11 00:00 de Argentina (rangoMesNegocio).
    fecha_pago: { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2026-11-01T03:00:00.000Z") },
  });
  assert.deepEqual(llamadas[0]!.select, {
    id: true,
    monto: true,
    fecha_pago: true,
    orden_compra: { select: { proveedor: { select: { id: true, razon_social: true } } } },
  });
});

test("bordes del mes: medianoche UTC del día 1 y 23:59 argentinas del último día cuentan; 22:00 del mes anterior y el mes siguiente no", async () => {
  const filas = [
    cuenta("p-dia1", "Día uno (fecha solo-día)", "10.00", "2026-10-01T00:00:00.000Z"),
    cuenta("p-anterior", "22:00 del 30/09 en Argentina", "20.00", "2026-10-01T01:00:00.000Z"),
    cuenta("p-ultimo", "23:59 del 31/10 en Argentina", "30.00", "2026-11-01T02:59:59.999Z"),
    cuenta("p-siguiente", "00:00 del 1/11 en Argentina", "40.00", "2026-11-01T03:00:00.000Z"),
  ];
  const { cliente } = clienteCon(filas);

  const octubre = await servicio.consultarPagosProveedoresDelMes(cliente, 2026, 10);
  assert.deepEqual(octubre.map((p) => p.proveedor_id), ["p-dia1", "p-ultimo"]);
  const septiembre = await servicio.consultarPagosProveedoresDelMes(cliente, 2026, 9);
  assert.deepEqual(septiembre.map((p) => p.proveedor_id), ["p-anterior"]);

  const bloques = await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
    cliente,
    obtenerResumenMensual: resumenCon().obtenerResumenMensual,
  });
  assert.deepEqual(bloques[0]!.filas, [
    ["23:59 del 31/10 en Argentina", "30,00", "1"],
    ["Día uno (fecha solo-día)", "10,00", "1"],
  ]);
});

test("monto como Decimal (toFixed) y sensible al float: 0.10 + 0.20 = 0,30", async () => {
  const { cliente } = clienteCon([
    cuenta("p1", "Textil Norte SA", "0.10", "2026-10-05T12:00:00.000Z"),
    cuenta("p1", "Textil Norte SA", "0.20", "2026-10-06T00:00:00.000Z"),
  ]);
  const pagos = await servicio.consultarPagosProveedoresDelMes(cliente, 2026, 10);
  assert.deepEqual(pagos, [
    { proveedor_id: "p1", razon_social: "Textil Norte SA", monto: "0.10" },
    { proveedor_id: "p1", razon_social: "Textil Norte SA", monto: "0.20" },
  ]);
  const bloques = await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
    cliente,
    obtenerResumenMensual: resumenCon().obtenerResumenMensual,
  });
  assert.deepEqual(bloques[0]!.filas, [["Textil Norte SA", "0,30", "2"]]);
});

test("varios pagos del mismo proveedor, varios proveedores, orden y empates", async () => {
  const { cliente } = clienteCon([
    cuenta("id-d", "beta SA", "50.00", "2026-10-02T12:00:00.000Z"),
    cuenta("id-z", "Zeta SA", "60.00", "2026-10-03T12:00:00.000Z"),
    cuenta("id-c", "acme SA", "50.00", "2026-10-04T12:00:00.000Z"),
    cuenta("id-a", "ACME SA", "25.00", "2026-10-05T12:00:00.000Z"),
    cuenta("id-z", "Zeta SA", "40.00", "2026-10-06T00:00:00.000Z"),
    cuenta("id-a", "ACME SA", "25.00", "2026-10-07T12:00:00.000Z"),
    cuenta("id-g", "Gran Proveedor SRL", "1234567.89", "2026-10-08T12:00:00.000Z"),
  ]);
  const bloques = await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
    cliente,
    obtenerResumenMensual: resumenCon().obtenerResumenMensual,
  });
  assert.deepEqual(bloques[0]!.filas, [
    ["Gran Proveedor SRL", "1.234.567,89", "1"],
    ["Zeta SA", "100,00", "2"],
    ["ACME SA", "50,00", "2"],
    ["acme SA", "50,00", "1"],
    ["beta SA", "50,00", "1"],
  ]);
});

// ── HU-G14 ────────────────────────────────────────────────────────────────────

test("HU-G14 se llama dos veces, mes y mes anterior, siempre sin desglose; opciones no cambia el resultado", async () => {
  const filas = [cuenta("p1", "Textil Norte SA", "100.00", "2026-10-10T12:00:00.000Z")];
  const totales = {
    "2026-10": { ingresos: "500.00", egresos: "100.00", resultado_neto: "400.00" },
    "2026-09": { ingresos: "400.00", egresos: "50.00", resultado_neto: "350.00" },
  };

  const conDesglose = resumenCon(totales);
  const resultadoTrue = await servicio.generarBloquesAdicionales(2026, 10, CON_DESGLOSE, {
    cliente: clienteCon(filas).cliente,
    obtenerResumenMensual: conDesglose.obtenerResumenMensual,
  });
  assert.equal(conDesglose.llamadas.length, 2);
  assert.deepEqual(
    [...conDesglose.llamadas].sort((a, b) => a[1] - b[1]),
    [
      [2026, 9, SIN_DESGLOSE],
      [2026, 10, SIN_DESGLOSE],
    ],
  );

  const sinDesglose = resumenCon(totales);
  const resultadoFalse = await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
    cliente: clienteCon(filas).cliente,
    obtenerResumenMensual: sinDesglose.obtenerResumenMensual,
  });
  assert.deepEqual(resultadoTrue, resultadoFalse);
});

test("enero se compara con diciembre del año anterior", async () => {
  const resumen = resumenCon({ "2025-12": { ingresos: "100.00", egresos: "0.00", resultado_neto: "100.00" } });
  const bloques = await servicio.generarBloquesAdicionales(2026, 1, SIN_DESGLOSE, {
    cliente: clienteCon([]).cliente,
    obtenerResumenMensual: resumen.obtenerResumenMensual,
  });
  assert.deepEqual(
    resumen.llamadas.map(([anio, mes]) => `${anio}-${mes}`).sort(),
    ["2025-12", "2026-1"],
  );
  assert.deepEqual(bloques[1]!.columnas, ["Concepto", "Diciembre 2025", "Enero 2026", "Variación ($)", "Variación (%)"]);
  assert.deepEqual(bloques[1]!.filas[0], ["Ingresos", "100,00", "0,00", "-100,00", "-100,0 %"]);
});

test("con el stub de HU-G14 (todo en 0.00) la comparación muestra «0,00 / 0,00 / 0,00 / —»", async () => {
  const bloques = await servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
    cliente: clienteCon([]).cliente,
    obtenerResumenMensual: resumenCon().obtenerResumenMensual,
  });
  assert.deepEqual(bloques[1]!.filas, [
    ["Ingresos", "0,00", "0,00", "0,00", "—"],
    ["Egresos", "0,00", "0,00", "0,00", "—"],
    ["Resultado neto", "0,00", "0,00", "0,00", "—"],
  ]);
});

// ── Errores ───────────────────────────────────────────────────────────────────

test("un ServiceError de HU-G14 se propaga tal cual", async (t) => {
  t.mock.method(console, "error", () => {});
  const original = new ServiceError("PERIODO_INVALIDO", "mensaje de G14");
  await assert.rejects(
    servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
      cliente: clienteCon([]).cliente,
      obtenerResumenMensual: async () => {
        throw original;
      },
    }),
    (error: unknown) => error === original,
  );
});

test("otra falla de HU-G14 se envuelve como RESUMEN_MENSUAL_NO_DISPONIBLE, sin el mensaje crudo", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const secreto = "connect ECONNREFUSED 10.0.0.5:5432 usuario=erpswat";
  for (const obtenerResumenMensual of [
    async () => {
      throw new Error(secreto);
    },
    // DTO fuera de contrato: un importe sin dos decimales.
    async () => ({ ingresos: { total: "100" }, egresos: { total: "0.00" }, resultado_neto: "100.00" }),
    // DTO sin la forma esperada.
    async () => ({}),
  ]) {
    await assert.rejects(
      servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
        cliente: clienteCon([]).cliente,
        obtenerResumenMensual,
      }),
      (error: unknown) =>
        esServiceError("RESUMEN_MENSUAL_NO_DISPONIBLE")(error) && !(error as Error).message.includes("ECONNREFUSED"),
    );
  }
  assert.ok(log.mock.callCount() > 0);
  assert.ok(!JSON.stringify(log.mock.calls.map((c) => c.arguments)).includes("ECONNREFUSED"), "el log no lleva el mensaje crudo");
});

test("si falla la consulta de pagos: EGRESOS_PROVEEDORES_NO_DISPONIBLE y ningún bloque", async (t) => {
  t.mock.method(console, "error", () => {});
  const clienteRoto: ClienteFalso = {
    cuentaPorPagar: {
      findMany: async () => {
        throw Object.assign(new Error("relation \"cuentas_por_pagar\" does not exist"), { code: "P2021" });
      },
    },
  };
  await assert.rejects(
    servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
      cliente: clienteRoto,
      obtenerResumenMensual: resumenCon().obtenerResumenMensual,
    }),
    (error: unknown) =>
      esServiceError("EGRESOS_PROVEEDORES_NO_DISPONIBLE")(error) && !(error as Error).message.includes("cuentas_por_pagar"),
  );
});

test("una cuenta sin proveedor atribuible no se ignora: la consulta falla", async (t) => {
  t.mock.method(console, "error", () => {});
  const sinProveedor: FilaCuenta = {
    id: "cxp-huerfana",
    monto: decimal("10.00"),
    fecha_pago: new Date("2026-10-10T12:00:00.000Z"),
    orden_compra: { proveedor: null },
  };
  const { cliente } = clienteCon([cuenta("p1", "Textil Norte SA", "5.00", "2026-10-09T12:00:00.000Z"), sinProveedor]);
  await assert.rejects(servicio.consultarPagosProveedoresDelMes(cliente, 2026, 10), /cxp-huerfana/);
  await assert.rejects(
    servicio.generarBloquesAdicionales(2026, 10, SIN_DESGLOSE, {
      cliente,
      obtenerResumenMensual: resumenCon().obtenerResumenMensual,
    }),
    esServiceError("EGRESOS_PROVEEDORES_NO_DISPONIBLE"),
  );
});

test("período inválido: PERIODO_INVALIDO sin llamar a HU-G14 ni a la base", async () => {
  for (const [anio, mes] of [[2026, 13], [2026, 0], [999, 6], [10000, 6], [1000, 1]]) {
    const { cliente, llamadas } = clienteCon([]);
    const resumen = resumenCon();
    await assert.rejects(
      servicio.generarBloquesAdicionales(anio!, mes!, SIN_DESGLOSE, {
        cliente,
        obtenerResumenMensual: resumen.obtenerResumenMensual,
      }),
      esServiceError("PERIODO_INVALIDO"),
      `${anio}-${mes}`,
    );
    assert.equal(llamadas.length, 0);
    assert.equal(resumen.llamadas.length, 0);
  }
});

// ── Contrato del PR 0 ─────────────────────────────────────────────────────────

test("obtenerBloquesAdicionales delega con las dependencias por defecto (prisma y HU-G14 reales)", async (t) => {
  const { cliente, llamadas } = clienteCon([cuenta("p1", "Textil Norte SA", "10.00", "2026-10-10T12:00:00.000Z")]);
  const resumen = resumenCon();
  const anterior = { ...porDefecto };
  porDefecto.cliente = cliente;
  porDefecto.obtenerResumenMensual = resumen.obtenerResumenMensual;
  t.after(() => Object.assign(porDefecto, anterior));

  const bloques = await servicio.obtenerBloquesAdicionales(2026, 10, CON_DESGLOSE);
  assert.equal(llamadas.length, 1);
  assert.equal(resumen.llamadas.length, 2);
  assert.deepEqual(bloques.map((b) => b.clave), ["egresos_por_proveedor", "comparacion_mes_anterior"]);
  assert.deepEqual(bloques[0]!.filas, [["Textil Norte SA", "10,00", "1"]]);
});

test("obtenerBloquesAdicionales con período inválido: PERIODO_INVALIDO", async () => {
  await assert.rejects(servicio.obtenerBloquesAdicionales(2026, 13, SIN_DESGLOSE), esServiceError("PERIODO_INVALIDO"));
});
