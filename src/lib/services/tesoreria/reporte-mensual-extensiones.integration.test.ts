import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { EstadoCuentaPorPagar } from "@prisma/client";

/**
 * HU-G15 — bloques adicionales del reporte mensual contra una base REAL
 * descartable (task de HU-G15, §2 y Paso 4). `skip` sin
 * `HU_G15_INTEGRATION_DATABASE_URL`.
 *
 *   docker exec swat_erp_postgres psql -U erpswat -d postgres \
 *     -c "CREATE DATABASE swat_erp_test_g15 TEMPLATE template0"
 *   DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
 *   HU_G15_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:g15
 *
 * Usa el servicio real (`generarBloquesAdicionales`) contra la base, con
 * `obtenerResumenMensual` de HU-G14 inyectado como doble (el servicio real de
 * G14 todavía es el stub del PR 0); el caso k usa las dependencias reales.
 * Cada caso crea sus propias fixtures directo con Prisma (proveedor, orden de
 * compra y cuentas por pagar con `fecha_pago` a medida), marcadas con
 * `G15IT-xxxx`, en un mes propio (2099, y 2098 para los casos que no entran en
 * los doce meses de 2099), y no depende del orden de los demás. Antes de cada
 * caso se exige que sus meses no tengan cuentas `PAGADA` activas.
 *
 * Limpieza con el criterio de HU-D6: nunca se borra nada. Al final de cada
 * caso las cuentas, órdenes y proveedores creados se dan de baja lógica; se
 * verifica por conteo (activos con el marcador = 0, y las `PAGADA` activas de
 * los meses usados vuelven a las del inicio).
 */

const DATABASE_URL = process.env.HU_G15_INTEGRATION_DATABASE_URL;
/** Opt-in: `HU_G15_SOLO=c,h` corre solo esos casos (prueba de que no dependen del orden). */
const SOLO = process.env.HU_G15_SOLO?.split(",").map((s) => s.trim()).filter(Boolean);
const caso = (id: string) => ({ skip: SOLO ? !SOLO.includes(id) : false });

type Totales = { ingresos: string; egresos: string; resultado_neto: string };
type Opciones = { incluir_desglose_gastos: boolean };
type Mes = [anio: number, mes: number];

const SIN_DESGLOSE: Opciones = { incluir_desglose_gastos: false };
const CON_DESGLOSE: Opciones = { incluir_desglose_gastos: true };
const CEROS: Totales = { ingresos: "0.00", egresos: "0.00", resultado_neto: "0.00" };
const COLUMNAS_PROVEEDORES = ["Proveedor", "Total pagado ($)", "Cantidad de pagos"];
const FILAS_COMPARACION_CEROS = [
  ["Ingresos", "0,00", "0,00", "0,00", "—"],
  ["Egresos", "0,00", "0,00", "0,00", "—"],
  ["Resultado neto", "0,00", "0,00", "0,00", "—"],
];

test(
  "HU-G15 — bloques adicionales del reporte mensual contra una base real",
  { skip: !DATABASE_URL, timeout: 300_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, servicio, { obtenerResumenMensual }, { rangoMesFechaSolo, rangoMesNegocio }] =
      await Promise.all([
        import("../../db/prisma.ts"),
        import("./reporte-mensual-extensiones.service.ts"),
        import("./reporte-mensual.service.ts"),
        import("../../utils/fecha-negocio.ts"),
      ]);
    const { generarBloquesAdicionales, obtenerBloquesAdicionales } = servicio;

    // Evidencia de aislamiento: nunca correr contra una base que no sea de test.
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-g15] current_database() = ${db}`);

    const MARCADOR = `G15IT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const admin = await prisma.usuario.findUniqueOrThrow({
      where: { nombre_usuario: "administrador.seed" },
      select: { id: true },
    });
    const rs = (nombre: string) => `${MARCADOR} ${nombre}`;

    // ── Fechas ───────────────────────────────────────────────────────────────
    /** Rango que cubre las dos lecturas de `fecha_pago` del mes (el mismo que consulta el servicio). */
    function rangoSuperconjunto([anio, mes]: Mes) {
      const fechaSolo = rangoMesFechaSolo(anio, mes);
      const negocio = rangoMesNegocio(anio, mes);
      return {
        gte: fechaSolo.desde < negocio.desde ? fechaSolo.desde : negocio.desde,
        lt: fechaSolo.hasta > negocio.hasta ? fechaSolo.hasta : negocio.hasta,
      };
    }
    const pagadasActivasEn = (mes: Mes) =>
      prisma.cuentaPorPagar.count({ where: { estado: "PAGADA", is_active: true, fecha_pago: rangoSuperconjunto(mes) } });
    /** Todos los meses que usa la suite (2098-01 a 2099-12). */
    const pagadasActivasEnLaSuite = () =>
      prisma.cuentaPorPagar.count({
        where: {
          estado: "PAGADA",
          is_active: true,
          fecha_pago: { gte: rangoSuperconjunto([2098, 1]).gte, lt: rangoSuperconjunto([2099, 12]).lt },
        },
      });

    // ── Fixtures ─────────────────────────────────────────────────────────────
    const baja = (motivo: string) => ({
      is_active: false,
      deleted_at: new Date(),
      deleted_by: admin.id,
      deletion_reason: `Fixture ${MARCADOR} (${motivo})`,
    });

    let secuencia = 0;
    async function crearProveedor(nombre: string, opciones: { dadoDeBaja?: boolean } = {}) {
      secuencia += 1;
      return prisma.proveedor.create({
        data: {
          razon_social: rs(nombre),
          cuit: `${MARCADOR}-${secuencia}`,
          ...(opciones.dadoDeBaja && baja("proveedor dado de baja en el caso")),
        },
        select: { id: true, razon_social: true },
      });
    }
    async function crearOrden(proveedorId: string, opciones: { dadaDeBaja?: boolean } = {}) {
      secuencia += 1;
      return prisma.ordenCompra.create({
        data: {
          numero_orden: `${MARCADOR}-OC-${secuencia}`,
          proveedor_id: proveedorId,
          creada_por_id: admin.id,
          observaciones: MARCADOR,
          ...(opciones.dadaDeBaja && baja("orden dada de baja en el caso")),
        },
        select: { id: true },
      });
    }
    async function crearCuenta(
      ordenId: string,
      monto: string,
      fechaPago: string | null,
      opciones: { estado?: EstadoCuentaPorPagar; activa?: boolean } = {},
    ) {
      return prisma.cuentaPorPagar.create({
        data: {
          orden_compra_id: ordenId,
          monto,
          estado: opciones.estado ?? "PAGADA",
          fecha_pago: fechaPago === null ? null : new Date(fechaPago),
          observaciones: MARCADOR,
          ...(opciones.activa === false && baja("cuenta dada de baja en el caso")),
        },
        select: { id: true },
      });
    }
    /** Proveedor con una orden de compra y una cuenta `PAGADA` por cada `[monto, fecha_pago]`. */
    async function proveedorConPagos(
      nombre: string,
      pagos: [monto: string, fechaPago: string][],
      opciones: { dadoDeBaja?: boolean; ordenDadaDeBaja?: boolean } = {},
    ) {
      const proveedor = await crearProveedor(nombre, { dadoDeBaja: opciones.dadoDeBaja });
      const orden = await crearOrden(proveedor.id, { dadaDeBaja: opciones.ordenDadaDeBaja });
      for (const [monto, fecha] of pagos) await crearCuenta(orden.id, monto, fecha);
      return proveedor;
    }

    // ── HU-G14 inyectado ─────────────────────────────────────────────────────
    /** Doble de `obtenerResumenMensual`: DTO completo del PR 0 con los totales de cada mes (`AAAA-MM`). */
    function g14(totalesPorMes: Record<string, Totales> = {}) {
      const llamadas: [number, number, Opciones][] = [];
      const obtener = async (anio: number, mes: number, opciones: Opciones) => {
        llamadas.push([anio, mes, opciones]);
        const totales = totalesPorMes[`${anio}-${String(mes).padStart(2, "0")}`] ?? CEROS;
        return {
          periodo: { anio, mes, desde: "", hasta: "" },
          ingresos: { web: "0.00", reintegros_web: "0.00", mostrador_por_medio: [], mostrador: "0.00", total: totales.ingresos },
          egresos: { proveedores: "0.00", gastos_operativos: "0.00", gastos_por_categoria: null, total: totales.egresos },
          resultado_neto: totales.resultado_neto,
          porcentaje_egresos_sobre_ingresos: null,
          ventas_cuenta_corriente_informativo: "0.00",
        };
      };
      return { obtenerResumenMensual: obtener, llamadas };
    }
    const bloquesDe = ([anio, mes]: Mes, totales: Record<string, Totales> = {}, opciones: Opciones = SIN_DESGLOSE) =>
      generarBloquesAdicionales(anio, mes, opciones, { obtenerResumenMensual: g14(totales).obtenerResumenMensual });
    const filasProveedoresDe = async (mes: Mes) => (await bloquesDe(mes))[0]!.filas;

    /** Verifica los dos bloques completos: proveedores y comparación. */
    function verificarBloques(
      bloques: Awaited<ReturnType<typeof generarBloquesAdicionales>>,
      filasProveedores: string[][],
      comparacion: { columnas: string[]; filas: string[][] },
    ) {
      assert.deepEqual(bloques, [
        {
          clave: "egresos_por_proveedor",
          titulo: "Egresos por proveedor",
          columnas: COLUMNAS_PROVEEDORES,
          filas: filasProveedores,
        },
        {
          clave: "comparacion_mes_anterior",
          titulo: "Comparación con el mes anterior",
          columnas: ["Concepto", ...comparacion.columnas, "Variación ($)", "Variación (%)"],
          filas: comparacion.filas,
        },
      ]);
    }

    // ── Limpieza (baja lógica) ───────────────────────────────────────────────
    async function activosConMarcador() {
      return {
        cuentas: await prisma.cuentaPorPagar.count({ where: { is_active: true, observaciones: MARCADOR } }),
        ordenes: await prisma.ordenCompra.count({ where: { is_active: true, numero_orden: { startsWith: MARCADOR } } }),
        proveedores: await prisma.proveedor.count({ where: { is_active: true, razon_social: { startsWith: MARCADOR } } }),
      };
    }
    async function pagadasPorMes(meses: Mes[]) {
      const conteos: Record<string, number> = {};
      for (const mes of meses) conteos[mes.join("-")] = await pagadasActivasEn(mes);
      return conteos;
    }
    async function darDeBajaFixtures(etiqueta: string, meses: Mes[]) {
      const antes = { activos_con_marcador: await activosConMarcador(), pagadas_activas: await pagadasPorMes(meses) };
      const datos = baja(`limpieza ${etiqueta}`);
      await prisma.cuentaPorPagar.updateMany({ where: { is_active: true, observaciones: MARCADOR }, data: datos });
      await prisma.ordenCompra.updateMany({ where: { is_active: true, numero_orden: { startsWith: MARCADOR } }, data: datos });
      await prisma.proveedor.updateMany({ where: { is_active: true, razon_social: { startsWith: MARCADOR } }, data: datos });
      const despues = { activos_con_marcador: await activosConMarcador(), pagadas_activas: await pagadasPorMes(meses) };
      console.log(`[hu-g15] limpieza ${etiqueta}: antes ${JSON.stringify(antes)} → después ${JSON.stringify(despues)}`);
      assert.deepEqual(despues.activos_con_marcador, { cuentas: 0, ordenes: 0, proveedores: 0 });
      for (const mes of meses) assert.equal(despues.pagadas_activas[mes.join("-")], 0, `quedaron PAGADA activas en ${mes.join("-")}`);
    }

    /** Caso con precondición (meses sin `PAGADA` activas) y limpieza garantizada. */
    async function escenario(id: string, nombre: string, meses: Mes[], cuerpo: () => Promise<void>) {
      await t.test(`${id} — ${nombre}`, caso(id), async () => {
        for (const mes of meses) {
          const ajenas = await pagadasActivasEn(mes);
          assert.equal(ajenas, 0, `El mes ${mes.join("-")} ya tiene ${ajenas} cuenta(s) PAGADA activa(s) ajenas a la suite: abortado`);
        }
        try {
          await cuerpo();
        } finally {
          await darDeBajaFixtures(id, meses);
        }
      });
    }

    // ── Conteos iniciales (verificados al final) ─────────────────────────────
    const pagadasSuiteAntes = await pagadasActivasEnLaSuite();
    console.log(`[hu-g15] marcador ${MARCADOR}; PAGADA activas en 2098-01..2099-12 al inicio: ${pagadasSuiteAntes}`);

    t.after(async () => {
      // Red de seguridad: si un caso abortó antes de su limpieza, nada queda activo.
      await prisma.cuentaPorPagar.updateMany({ where: { is_active: true, observaciones: MARCADOR }, data: baja("t.after") });
      await prisma.ordenCompra.updateMany({ where: { is_active: true, numero_orden: { startsWith: MARCADOR } }, data: baja("t.after") });
      await prisma.proveedor.updateMany({ where: { is_active: true, razon_social: { startsWith: MARCADOR } }, data: baja("t.after") });
      await prisma.$disconnect();
    });

    // ─────────────────────────────────────────────────────────────────────────

    await escenario("a", "varios proveedores y varios pagos del mismo proveedor", [[2099, 2]], async () => {
      await proveedorConPagos("Textil Norte", [
        ["1000.00", "2099-02-05T15:00:00.000Z"],
        ["500.50", "2099-02-10T00:00:00.000Z"],
        ["250.25", "2099-02-20T12:00:00.000Z"],
      ]);
      await proveedorConPagos("Calzados Sur", [["2000.00", "2099-02-11T18:30:00.000Z"]]);
      await proveedorConPagos("Mochilas Este", [["99.99", "2099-02-28T00:00:00.000Z"]]);

      verificarBloques(
        await bloquesDe([2099, 2]),
        [
          [rs("Calzados Sur"), "2.000,00", "1"],
          [rs("Textil Norte"), "1.750,75", "3"],
          [rs("Mochilas Este"), "99,99", "1"],
        ],
        { columnas: ["Enero 2099", "Febrero 2099"], filas: FILAS_COMPARACION_CEROS },
      );
    });

    await escenario("b", "empates de total: razón social sin distinguir mayúsculas y proveedor_id", [[2099, 3]], async () => {
      const acmes = [
        await proveedorConPagos("Acme SA", [["300.00", "2099-03-03T12:00:00.000Z"]]),
        await proveedorConPagos("ACME SA", [["300.00", "2099-03-04T12:00:00.000Z"]]),
        await proveedorConPagos("Acme SA", [["100.00", "2099-03-05T12:00:00.000Z"], ["200.00", "2099-03-06T12:00:00.000Z"]]),
      ];
      await proveedorConPagos("beta SRL", [["300.00", "2099-03-07T12:00:00.000Z"]]);
      await proveedorConPagos("Zeta SA", [["500.00", "2099-03-08T12:00:00.000Z"]]);

      const acmesPorId = [...acmes].sort((x, y) => (x.id < y.id ? -1 : 1));
      verificarBloques(
        await bloquesDe([2099, 3]),
        [
          [rs("Zeta SA"), "500,00", "1"],
          ...acmesPorId.map((p) => [p.razon_social, "300,00", p === acmes[2] ? "2" : "1"]),
          [rs("beta SRL"), "300,00", "1"],
        ],
        { columnas: ["Febrero 2099", "Marzo 2099"], filas: FILAS_COMPARACION_CEROS },
      );
    });

    await escenario(
      "c",
      "bordes del mes en hora de Argentina (y los dos meses contiguos)",
      [[2099, 4], [2099, 5], [2099, 6]],
      async () => {
        await proveedorConPagos("Día 1 00:00 ART", [["60.00", "2099-05-01T03:00:00.000Z"]]);
        await proveedorConPagos("Último día 23:59:59.999 ART", [["50.00", "2099-06-01T02:59:59.999Z"]]);
        await proveedorConPagos("Mes siguiente 00:00 ART", [["40.00", "2099-06-01T03:00:00.000Z"]]);
        await proveedorConPagos("Día 1 como lo guarda la UI", [["30.00", "2099-05-01T00:00:00.000Z"]]);
        await proveedorConPagos("Día 1 del mes siguiente (UI)", [["20.00", "2099-06-01T00:00:00.000Z"]]);
        await proveedorConPagos("01:00Z del día 1 (30/04 ART)", [["10.00", "2099-05-01T01:00:00.000Z"]]);

        verificarBloques(
          await bloquesDe([2099, 5]),
          [
            [rs("Día 1 00:00 ART"), "60,00", "1"],
            [rs("Último día 23:59:59.999 ART"), "50,00", "1"],
            [rs("Día 1 como lo guarda la UI"), "30,00", "1"],
          ],
          { columnas: ["Abril 2099", "Mayo 2099"], filas: FILAS_COMPARACION_CEROS },
        );
        verificarBloques(
          await bloquesDe([2099, 4]),
          [[rs("01:00Z del día 1 (30/04 ART)"), "10,00", "1"]],
          { columnas: ["Marzo 2099", "Abril 2099"], filas: FILAS_COMPARACION_CEROS },
        );
        verificarBloques(
          await bloquesDe([2099, 6]),
          [
            [rs("Mes siguiente 00:00 ART"), "40,00", "1"],
            [rs("Día 1 del mes siguiente (UI)"), "20,00", "1"],
          ],
          { columnas: ["Mayo 2099", "Junio 2099"], filas: FILAS_COMPARACION_CEROS },
        );
      },
    );

    await escenario("d", "exclusiones: estados no pagados y PAGADA con baja lógica", [[2099, 7]], async () => {
      const noPagados = Object.values(EstadoCuentaPorPagar).filter((e) => e !== "PAGADA");
      assert.deepEqual([...noPagados].sort(), ["CANCELADA", "DEFINITIVA", "PROVISORIO"]);
      for (const estado of noPagados) {
        const proveedor = await crearProveedor(`Estado ${estado}`);
        const orden = await crearOrden(proveedor.id);
        await crearCuenta(orden.id, "999.00", "2099-07-15T15:00:00.000Z", { estado });
      }
      const inactiva = await crearProveedor("PAGADA dada de baja");
      await crearCuenta((await crearOrden(inactiva.id)).id, "888.00", "2099-07-16T15:00:00.000Z", { activa: false });
      await proveedorConPagos("Pago válido", [["100.00", "2099-07-17T15:00:00.000Z"]]);

      verificarBloques(await bloquesDe([2099, 7]), [[rs("Pago válido"), "100,00", "1"]], {
        columnas: ["Junio 2099", "Julio 2099"],
        filas: FILAS_COMPARACION_CEROS,
      });
    });

    await escenario(
      "e",
      "pagos del mes anterior y del siguiente no aparecen",
      [[2099, 8], [2099, 9], [2099, 10]],
      async () => {
        await proveedorConPagos("Tres meses", [
          ["11.00", "2099-08-20T15:00:00.000Z"],
          ["22.00", "2099-09-10T15:00:00.000Z"],
          ["33.00", "2099-10-05T15:00:00.000Z"],
        ]);
        await proveedorConPagos("Solo agosto", [["44.00", "2099-08-31T00:00:00.000Z"]]);
        await proveedorConPagos("Solo octubre", [["55.00", "2099-10-01T03:00:00.000Z"]]);

        verificarBloques(await bloquesDe([2099, 9]), [[rs("Tres meses"), "22,00", "1"]], {
          columnas: ["Agosto 2099", "Septiembre 2099"],
          filas: FILAS_COMPARACION_CEROS,
        });
        assert.deepEqual(await filasProveedoresDe([2099, 8]), [
          [rs("Solo agosto"), "44,00", "1"],
          [rs("Tres meses"), "11,00", "1"],
        ]);
        assert.deepEqual(await filasProveedoresDe([2099, 10]), [
          [rs("Solo octubre"), "55,00", "1"],
          [rs("Tres meses"), "33,00", "1"],
        ]);
      },
    );

    await escenario("f", "proveedor sin pagos, proveedor dado de baja y orden de compra dada de baja", [[2099, 11]], async () => {
      const sinPagos = await crearProveedor("Sin pagos en el mes");
      await crearCuenta((await crearOrden(sinPagos.id)).id, "700.00", null, { estado: "DEFINITIVA" });
      await proveedorConPagos("Proveedor dado de baja", [["200.00", "2099-11-10T15:00:00.000Z"]], { dadoDeBaja: true });
      await proveedorConPagos("Orden dada de baja", [["150.00", "2099-11-11T15:00:00.000Z"]], { ordenDadaDeBaja: true });
      await proveedorConPagos("Normal", [["100.00", "2099-11-12T15:00:00.000Z"]]);

      verificarBloques(
        await bloquesDe([2099, 11]),
        [
          [rs("Proveedor dado de baja"), "200,00", "1"],
          [rs("Orden dada de baja"), "150,00", "1"],
          [rs("Normal"), "100,00", "1"],
        ],
        { columnas: ["Octubre 2099", "Noviembre 2099"], filas: FILAS_COMPARACION_CEROS },
      );
    });

    await escenario("g", "mes sin pagos y mes que vuelve a quedar vacío tras la limpieza", [[2099, 12]], async () => {
      verificarBloques(await bloquesDe([2099, 12]), [], {
        columnas: ["Noviembre 2099", "Diciembre 2099"],
        filas: FILAS_COMPARACION_CEROS,
      });

      await proveedorConPagos("Pago que se limpia", [["123.45", "2099-12-15T15:00:00.000Z"]]);
      assert.deepEqual(await filasProveedoresDe([2099, 12]), [[rs("Pago que se limpia"), "123,45", "1"]]);
      await darDeBajaFixtures("g (intermedia)", [[2099, 12]]);
      assert.deepEqual(await filasProveedoresDe([2099, 12]), []);

      // El mes del caso a, ya limpiado, también quedó sin pagos.
      assert.deepEqual(await filasProveedoresDe([2099, 2]), []);
    });

    await escenario("h", "montos sensibles al float y montos grandes", [[2098, 1]], async () => {
      assert.notEqual(0.1 + 0.2, 0.3, "premisa: en float 0.1 + 0.2 no es 0.3");
      assert.notEqual(0.1 + 0.1 + 0.1, 0.3, "premisa: en float 0.1 × 3 no es 0.3");
      await proveedorConPagos("Uno", [["0.10", "2098-01-05T15:00:00.000Z"], ["0.20", "2098-01-06T15:00:00.000Z"]]);
      await proveedorConPagos("Dos", [
        ["0.10", "2098-01-07T15:00:00.000Z"],
        ["0.10", "2098-01-08T15:00:00.000Z"],
        ["0.10", "2098-01-09T15:00:00.000Z"],
      ]);
      await proveedorConPagos("Tres", [
        ["0.70", "2098-01-10T15:00:00.000Z"],
        ["0.10", "2098-01-11T15:00:00.000Z"],
        ["0.20", "2098-01-12T15:00:00.000Z"],
      ]);
      await proveedorConPagos("Grande", [["1234567.89", "2098-01-13T15:00:00.000Z"]]);

      verificarBloques(
        await bloquesDe([2098, 1]),
        [
          [rs("Grande"), "1.234.567,89", "1"],
          [rs("Tres"), "1,00", "3"],
          [rs("Dos"), "0,30", "3"],
          [rs("Uno"), "0,30", "2"],
        ],
        { columnas: ["Diciembre 2097", "Enero 2098"], filas: FILAS_COMPARACION_CEROS },
      );
    });

    await escenario("i", "comparación con totales distintos; enero 2099 contra diciembre 2098", [[2099, 1]], async () => {
      const doble = g14({
        "2099-01": { ingresos: "1500.00", egresos: "2000.00", resultado_neto: "-500.00" },
        "2098-12": { ingresos: "1000.00", egresos: "0.00", resultado_neto: "1000.00" },
      });
      const bloques = await generarBloquesAdicionales(2099, 1, SIN_DESGLOSE, {
        obtenerResumenMensual: doble.obtenerResumenMensual,
      });
      assert.deepEqual([...doble.llamadas].sort((x, y) => x[0] - y[0]), [
        [2098, 12, SIN_DESGLOSE],
        [2099, 1, SIN_DESGLOSE],
      ]);
      verificarBloques(bloques, [], {
        columnas: ["Diciembre 2098", "Enero 2099"],
        filas: [
          ["Ingresos", "1.000,00", "1.500,00", "+500,00", "+50,0 %"],
          ["Egresos", "0,00", "2.000,00", "+2.000,00", "—"],
          ["Resultado neto", "1.000,00", "-500,00", "-1.500,00", "-150,0 %"],
        ],
      });
    });

    await escenario("j", "incluir_desglose_gastos true y false dan el mismo resultado", [[2098, 2]], async () => {
      await proveedorConPagos("Desglose A", [["10.00", "2098-02-10T15:00:00.000Z"]]);
      await proveedorConPagos("Desglose B", [["20.00", "2098-02-11T00:00:00.000Z"]]);
      const totales = {
        "2098-02": { ingresos: "100.00", egresos: "30.00", resultado_neto: "70.00" },
        "2098-01": { ingresos: "80.00", egresos: "40.00", resultado_neto: "40.00" },
      };
      const conDesglose = await bloquesDe([2098, 2], totales, CON_DESGLOSE);
      const sinDesglose = await bloquesDe([2098, 2], totales, SIN_DESGLOSE);
      assert.deepEqual(conDesglose, sinDesglose);
      verificarBloques(
        conDesglose,
        [
          [rs("Desglose B"), "20,00", "1"],
          [rs("Desglose A"), "10,00", "1"],
        ],
        {
          columnas: ["Enero 2098", "Febrero 2098"],
          filas: [
            ["Ingresos", "80,00", "100,00", "+20,00", "+25,0 %"],
            ["Egresos", "40,00", "30,00", "-10,00", "-25,0 %"],
            ["Resultado neto", "40,00", "70,00", "+30,00", "+75,0 %"],
          ],
        },
      );
    });

    await escenario("k", "obtenerBloquesAdicionales con las dependencias reales (G14 stub)", [[2098, 3]], async () => {
      for (const [anio, mes] of [[2098, 3], [2098, 2]] as Mes[]) {
        const resumen = await obtenerResumenMensual(anio, mes, SIN_DESGLOSE);
        assert.deepEqual(
          { ingresos: resumen.ingresos.total, egresos: resumen.egresos.total, resultado_neto: resumen.resultado_neto },
          CEROS,
          "El obtenerResumenMensual real ya no devuelve ceros (¿se mergeó HU-G14?): adaptar el caso k",
        );
      }
      await proveedorConPagos("Dependencias reales", [["75.00", "2098-03-20T15:00:00.000Z"]]);
      verificarBloques(
        await obtenerBloquesAdicionales(2098, 3, CON_DESGLOSE),
        [[rs("Dependencias reales"), "75,00", "1"]],
        { columnas: ["Febrero 2098", "Marzo 2098"], filas: FILAS_COMPARACION_CEROS },
      );
    });

    await t.test("l — si HU-G14 falla no se devuelven bloques y no queda nada sin limpiar", caso("l"), async (tl) => {
      tl.mock.method(console, "error", () => {});
      const mes: Mes = [2098, 4];
      assert.equal(await pagadasActivasEn(mes), 0, "El mes 2098-4 ya tiene cuentas PAGADA activas ajenas: abortado");
      try {
        await proveedorConPagos("G14 caído", [["40.00", "2098-04-10T15:00:00.000Z"]]);
        assert.equal(await pagadasActivasEn(mes), 1);
        await assert.rejects(
          generarBloquesAdicionales(2098, 4, SIN_DESGLOSE, {
            obtenerResumenMensual: async () => {
              throw new Error("G14 caído");
            },
          }),
          (error: unknown) =>
            (error as { name?: string; code?: string }).name === "ServiceError" &&
            (error as { code?: string }).code === "RESUMEN_MENSUAL_NO_DISPONIBLE",
        );
      } finally {
        tl.mock.restoreAll();
        await darDeBajaFixtures("l", [mes]);
      }
      assert.deepEqual(await activosConMarcador(), { cuentas: 0, ordenes: 0, proveedores: 0 });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Conteos finales contra los iniciales
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("z — sin fixtures activos y las PAGADA activas de los meses de la suite como al inicio", async () => {
      const pagadasSuiteDespues = await pagadasActivasEnLaSuite();
      const activos = await activosConMarcador();
      console.log(
        `[hu-g15] PAGADA activas en 2098-01..2099-12: inicio ${pagadasSuiteAntes}, final ${pagadasSuiteDespues}; ` +
          `activos con el marcador ${MARCADOR}: ${JSON.stringify(activos)}`,
      );
      assert.equal(pagadasSuiteDespues, pagadasSuiteAntes);
      assert.deepEqual(activos, { cuentas: 0, ordenes: 0, proveedores: 0 });
    });
  },
);
