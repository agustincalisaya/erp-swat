import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  AlertaDesvioCreadaPayload,
  AlertaDesvioNivelCambiadoPayload,
  AlertaDesvioResueltaPayload,
} from "../../events/event-types.ts";

/**
 * HU-D6 — Nivel 2: alertas de indicadores críticos contra una base REAL
 * descartable (task_relos.md §2, Paso 8A). `skip` sin
 * `HU_D6_INTEGRATION_DATABASE_URL`.
 *
 *   docker exec swat_erp_postgres psql -U erpswat -d postgres \
 *     -c "CREATE DATABASE swat_erp_test_d6 TEMPLATE template0"
 *   DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
 *   HU_D6_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:d6
 *
 * Usa el servicio real y los listeners REALES del bus (auditoría, F3 y el de
 * alertas, registrados por `listenersRegistrados`). Cada caso crea sus propias
 * fixtures (variantes y depósitos con un marcador único; meses 2099-xx para
 * egresos con reloj inyectado) y no depende del orden de los demás. Los casos
 * que pasan por el listener de alertas usan el reloj y el HU-G14 reales.
 *
 * Limpieza con el criterio de los tests recientes (HU-E11, HU-F3): nunca se
 * borra nada. Al final, las alertas creadas por la suite se dan de baja lógica
 * (`is_active = false`, `clave_activa = null`) y los umbrales vuelven a
 * 70/85/100; las fixtures quedan con su marcador. Se verifica por conteo.
 */

const DATABASE_URL = process.env.HU_D6_INTEGRATION_DATABASE_URL;
const PROVEEDOR_HOMOLOGADO_ID = "1a2b3c4d-6666-4a1a-8a1a-000000000001";
/** Opt-in: `HU_D6_SOLO=d5,e2` corre solo esos casos (prueba de que no dependen del orden). */
const SOLO = process.env.HU_D6_SOLO?.split(",").map((s) => s.trim()).filter(Boolean);
const caso = (id: string) => ({ skip: SOLO ? !SOLO.includes(id) : false });

test(
  "HU-D6 — alertas de indicadores críticos contra una base real",
  { skip: !DATABASE_URL, timeout: 600_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      { domainEventBus, listenersRegistrados },
      { alertasPendientes },
      { SUSCRIPCIONES_NOTIFICACION },
      { generarNotificaciones },
      { calcularClaveIdempotencia },
      servicio,
      { obtenerPanelAlertas },
      configuracion,
      { verificarCadenaIntegridad },
      { registrarIngresoStock },
      transferencias,
      reservas,
      { reclasificarDevuelto },
      { diaNegocioIso },
      { obtenerResumenMensual },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../events/listeners/alerta-desvio.listener.ts"),
      import("../../events/listeners/notificacion.listener.ts"),
      import("../notificaciones/notificacion.service.ts"),
      import("../notificaciones/notificacion.reglas.ts"),
      import("./alerta-desvio.service.ts"),
      import("./alerta-desvio.panel.service.ts"),
      import("../sistema/configuracion.service.ts"),
      import("../auditoria/audit-log.service.ts"),
      import("../inventario/movimiento.service.ts"),
      import("../inventario/transferencia.service.ts"),
      import("../inventario/reserva.service.ts"),
      import("../inventario/reclasificacion.service.ts"),
      import("../../utils/fecha-negocio.ts"),
      import("../tesoreria/reporte-mensual.service.ts"),
    ]);
    const { evaluarStock, evaluarEgresos } = servicio;

    // Evidencia de aislamiento: nunca correr contra una base que no sea de test.
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-d6] current_database() = ${db}`);
    await listenersRegistrados;

    const MARCADOR = `D6IT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const admin = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "administrador.seed" }, select: { id: true } });
    const gerente = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "gerente.seed" }, select: { id: true } });
    const cajero = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "cajero.seed" }, select: { id: true } });

    // ── Espía de eventos de alerta en el bus real (no reemplaza a los listeners) ──
    type EventoAlerta = {
      nombre: "alerta_desvio:creada" | "alerta_desvio:nivel_cambiado" | "alerta_desvio:resuelta";
      payload: AlertaDesvioCreadaPayload | AlertaDesvioNivelCambiadoPayload | AlertaDesvioResueltaPayload;
    };
    const eventos: EventoAlerta[] = [];
    for (const nombre of ["alerta_desvio:creada", "alerta_desvio:nivel_cambiado", "alerta_desvio:resuelta"] as const) {
      domainEventBus.on(nombre, (payload: EventoAlerta["payload"]) => void eventos.push({ nombre, payload }));
    }
    const eventosDe = (alertaId: string) => eventos.filter((e) => e.payload.alerta_id === alertaId);

    // ── Helpers ──────────────────────────────────────────────────────────────
    async function esperar<T>(consulta: () => Promise<T | null | undefined | false>, descripcion: string, ms = 10_000): Promise<T> {
      const limite = Date.now() + ms;
      for (;;) {
        const valor = await consulta();
        if (valor) return valor as T;
        if (Date.now() > limite) throw new Error(`timeout esperando: ${descripcion}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    /** Deja que terminen el listener de alertas y las escrituras post-COMMIT (auditoría, F3). */
    async function drenar() {
      await alertasPendientes();
      let previo = "";
      for (let i = 0; i < 40; i += 1) {
        const actual = JSON.stringify([await prisma.auditLog.count(), await prisma.notificacion.count(), await prisma.alertaDesvio.count()]);
        if (actual === previo) return;
        previo = actual;
        await new Promise((r) => setTimeout(r, 150));
        await alertasPendientes();
      }
    }

    let secuencia = 0;
    async function crearDeposito() {
      secuencia += 1;
      return prisma.deposito.create({ data: { nombre: `${MARCADOR} Depósito ${secuencia}`, tipo: "CENTRAL" } });
    }
    async function crearVariante() {
      secuencia += 1;
      const producto = await prisma.productoMaestro.create({
        data: {
          codigo_producto: MARCADOR,
          nombre: `${MARCADOR} Producto ${secuencia}`,
          rubro: "Indumentaria",
          categoria: "Test HU-D6",
          unidad_medida: "UNIDAD",
          costo_estandar_referencia: 1000,
        },
      });
      return prisma.varianteSKU.create({
        data: {
          producto_maestro_id: producto.id,
          proveedor_id: PROVEEDOR_HOMOLOGADO_ID,
          sku: `${MARCADOR}-${secuencia}`,
          talle: "M",
          color: "Negro",
          genero: "UNISEX",
          modelo: "Test",
        },
      });
    }
    /** Par variante/depósito propio con su StockDeposito. */
    async function crearPar(cantidad: number, punto_pedido: number) {
      const [variante, deposito] = [await crearVariante(), await crearDeposito()];
      const stock = await prisma.stockDeposito.create({
        data: { variante_sku_id: variante.id, deposito_id: deposito.id, cantidad, punto_pedido },
      });
      return { varianteSkuId: variante.id, depositoId: deposito.id, stockId: stock.id, sku: variante.sku, deposito: deposito.nombre };
    }
    type Par = Awaited<ReturnType<typeof crearPar>>;
    const fijarStock = (par: Par, data: { cantidad?: number; punto_pedido?: number }) =>
      prisma.stockDeposito.update({ where: { id: par.stockId }, data });
    const cantidadDe = async (par: Par) =>
      (await prisma.stockDeposito.findUniqueOrThrow({ where: { id: par.stockId }, select: { cantidad: true } })).cantidad;
    const alertasDe = (par: Par) =>
      prisma.alertaDesvio.findMany({
        where: { variante_sku_id: par.varianteSkuId, deposito_id: par.depositoId, is_active: true },
        orderBy: { created_at: "asc" },
      });
    const activaDe = async (par: Par) => (await alertasDe(par)).find((a) => a.estado === "ACTIVA") ?? null;

    const referenciaHoy = diaNegocioIso(new Date()).slice(0, 7);
    const [anioHoy, mesHoy] = referenciaHoy.split("-").map(Number) as [number, number];
    const mesAnterior = mesHoy === 1 ? { anio: anioHoy - 1, mes: 12 } : { anio: anioHoy, mes: mesHoy - 1 };
    const referenciaAnterior = `${mesAnterior.anio}-${String(mesAnterior.mes).padStart(2, "0")}`;
    /** Instante del día 15 del mes anterior a las 12:00 de Argentina. */
    const relojMesAnterior = () => new Date(`${referenciaAnterior}-15T15:00:00.000Z`);

    /** Dependencias de egresos con HU-G14 y umbrales inyectados. */
    function egresosInyectados(porcentaje: () => number | null, opciones: { reloj?: () => Date; fallar?: boolean } = {}) {
      const llamadas = { g14: 0 };
      return {
        llamadas,
        dependencias: {
          ...(opciones.reloj && { ahora: opciones.reloj }),
          obtenerUmbralesEgresos: async () => ({ informativa: 70, advertencia: 85, critica: 100 }),
          obtenerResumenMensual: async (anio: number, mes: number) => {
            llamadas.g14 += 1;
            if (opciones.fallar) throw Object.assign(new Error("G14 caído"), { code: "G14_NO_DISPONIBLE" });
            return { periodo: { anio, mes }, porcentaje_egresos_sobre_ingresos: porcentaje() } as never;
          },
        },
      };
    }
    const alertaEgresos = (referencia: string) =>
      prisma.alertaDesvio.findFirst({
        where: { indicador: "EGRESOS_SOBRE_INGRESOS", referencia, estado: "ACTIVA", is_active: true },
      });
    /** Precondición de los casos con el mes en curso: ninguna alerta activa del mes. */
    async function sinAlertaEgresosHoy() {
      await evaluarEgresos({ anio: anioHoy, mes: mesHoy }, { dependencias: egresosInyectados(() => null).dependencias });
      await drenar();
      assert.equal(await alertaEgresos(referenciaHoy), null);
    }

    // ── Conteos iniciales (verificados al final) ─────────────────────────────
    const stockSeedAntes = await prisma.stockDeposito.aggregate({
      _sum: { cantidad: true },
      where: { variante_sku: { sku: { not: { startsWith: "D6IT-" } } } },
    });
    const alertasActivasAntes = await prisma.alertaDesvio.count({ where: { is_active: true, estado: "ACTIVA" } });
    const referenciasEgresosSuite = new Set<string>([referenciaHoy, referenciaAnterior]);
    const umbralesAntes = await configuracion.obtenerUmbralesEgresos();

    t.after(async () => {
      await drenar().catch(() => undefined);
      // Restaurar umbrales y dar de baja lógica las alertas de la suite.
      await configuracion.actualizarUmbralesEgresos({ informativa: 70, advertencia: 85, critica: 100 }, admin.id).catch(() => undefined);
      await prisma.alertaDesvio.updateMany({
        where: {
          is_active: true,
          OR: [
            { variante_sku: { sku: { startsWith: MARCADOR } } },
            { indicador: "EGRESOS_SOBRE_INGRESOS", referencia: { in: [...referenciasEgresosSuite] } },
          ],
        },
        data: { is_active: false, deleted_at: new Date(), deleted_by: admin.id, deletion_reason: `Fixture ${MARCADOR}`, clave_activa: null },
      });
      await drenar().catch(() => undefined);
      await prisma.$disconnect();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // a. Stock con el servicio real
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("a1 — sin alerta con punto de pedido 0 (aun en stock 0) y con cantidad sobre el punto", caso("a1"), async () => {
      const sinControl = await crearPar(0, 0);
      const holgado = await crearPar(9, 5);
      for (const par of [sinControl, holgado]) {
        const r = await evaluarStock(par);
        assert.equal(r.severidad, null);
        assert.equal(r.transicion, "NADA");
        assert.equal((await alertasDe(par)).length, 0);
      }
    });

    await t.test("a2 — ADVERTENCIA en cantidad = punto, CRITICA en ≤ 0, sube, baja, resuelve; nuevo episodio = fila nueva", caso("a2"), async () => {
      const par = await crearPar(5, 5);
      assert.equal((await evaluarStock(par)).transicion, "CREAR");
      let activa = (await activaDe(par))!;
      assert.equal(activa.severidad, "ADVERTENCIA");
      assert.equal(activa.clave_activa, `STOCK_BAJO_PUNTO_PEDIDO:${par.varianteSkuId}:${par.depositoId}`);

      await fijarStock(par, { cantidad: 0 });
      assert.equal((await evaluarStock(par)).transicion, "CAMBIAR_NIVEL");
      assert.equal((await activaDe(par))!.severidad, "CRITICA");

      await fijarStock(par, { cantidad: -1 });
      assert.equal((await evaluarStock(par)).transicion, "NADA", "≤ 0 sigue CRITICA");

      await fijarStock(par, { cantidad: 2 });
      assert.equal((await evaluarStock(par)).transicion, "CAMBIAR_NIVEL");
      activa = (await activaDe(par))!;
      assert.equal(activa.severidad, "ADVERTENCIA");

      await fijarStock(par, { cantidad: 12 });
      assert.equal((await evaluarStock(par)).transicion, "RESOLVER");
      const [resuelta] = await alertasDe(par);
      assert.equal(resuelta!.estado, "RESUELTA");
      assert.equal(resuelta!.clave_activa, null);
      assert.ok(resuelta!.resuelta_at);
      // D28: la resolución no pisa el último desvío.
      assert.equal(resuelta!.cantidad_actual, 2);
      assert.equal(resuelta!.punto_pedido, 5);

      await drenar();
      const fotoResuelta = JSON.stringify(await prisma.alertaDesvio.findUniqueOrThrow({ where: { id: resuelta!.id } }));
      await fijarStock(par, { cantidad: 1 });
      assert.equal((await evaluarStock(par)).transicion, "CREAR");
      const filas = await alertasDe(par);
      assert.equal(filas.length, 2, "nuevo episodio = fila nueva");
      assert.notEqual(filas[1]!.id, resuelta!.id);
      assert.equal(
        JSON.stringify(await prisma.alertaDesvio.findUniqueOrThrow({ where: { id: resuelta!.id } })),
        fotoResuelta,
        "la resuelta queda como histórico inmutable",
      );
    });

    await t.test("a3 — repetir la evaluación sin cambio de condición no crea fila, ni asiento, ni notificación", caso("a3"), async () => {
      const par = await crearPar(3, 5);
      await evaluarStock(par);
      await drenar();
      const alerta = (await activaDe(par))!;
      const antes = [await prisma.alertaDesvio.count(), await prisma.auditLog.count(), await prisma.notificacion.count(), eventosDe(alerta.id).length];
      for (let i = 0; i < 3; i += 1) assert.equal((await evaluarStock(par)).transicion, "NADA");
      await drenar();
      const despues = [await prisma.alertaDesvio.count(), await prisma.auditLog.count(), await prisma.notificacion.count(), eventosDe(alerta.id).length];
      assert.deepEqual(despues, antes);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // b. Unicidad y concurrencia
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("b1 — 10 evaluaciones simultáneas: una sola alerta activa y un único evento creada", caso("b1"), async () => {
      const par = await crearPar(0, 4);
      const resultados = await Promise.all(Array.from({ length: 10 }, () => evaluarStock(par)));
      await drenar();
      const filas = await alertasDe(par);
      assert.equal(filas.length, 1);
      assert.equal(filas[0]!.estado, "ACTIVA");
      assert.equal(resultados.filter((r) => r.transicion === "CREAR").length, 1);
      assert.equal(resultados.filter((r) => r.transicion === "NADA").length, 9);
      assert.equal(eventosDe(filas[0]!.id).filter((e) => e.nombre === "alerta_desvio:creada").length, 1);
    });

    await t.test("b2 — la base rechaza un insert directo con clave_activa duplicada", caso("b2"), async () => {
      const par = await crearPar(0, 4);
      await evaluarStock(par);
      const activa = (await activaDe(par))!;
      await assert.rejects(
        prisma.alertaDesvio.create({
          data: {
            indicador: "STOCK_BAJO_PUNTO_PEDIDO",
            referencia: activa.referencia,
            clave_activa: activa.clave_activa,
            severidad: "CRITICA",
            variante_sku_id: par.varianteSkuId,
            deposito_id: par.depositoId,
          },
        }),
        (error: { code?: string }) => error.code === "P2002",
      );
      assert.equal((await alertasDe(par)).length, 1);
    });

    await t.test("b3 — ninguna RESUELTA conserva clave_activa", caso("b3"), async () => {
      assert.equal(await prisma.alertaDesvio.count({ where: { estado: "RESUELTA", clave_activa: { not: null } } }), 0);
      assert.ok((await prisma.alertaDesvio.count({ where: { estado: "RESUELTA" } })) > 0, "hay resueltas para verificar");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // c. Disparadores reales por el bus (listener de alertas registrado)
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("c1 — stock:umbral_critico_alcanzado y inventario:ingreso_stock_registrado (servicio real de ingreso)", caso("c1"), async () => {
      const par = await crearPar(8, 5);
      // RESTA real (VENDIDO 4): 8 → 4 ≤ 5; emite ingreso_stock_registrado + umbral_critico_alcanzado.
      await registrarIngresoStock(
        { deposito_destino_id: par.depositoId, comprobante_referencia: MARCADOR, items: [{ variante_sku_id: par.varianteSkuId, cantidad: 4, estado_destino: "VENDIDO" }] },
        admin.id,
      );
      await drenar();
      assert.equal(await cantidadDe(par), 4);
      assert.equal((await activaDe(par))?.severidad, "ADVERTENCIA");

      // Solo umbral_critico_alcanzado: decremento a 0 sin otro evento, luego el evento de A.
      await fijarStock(par, { cantidad: 0 });
      domainEventBus.emit("stock:umbral_critico_alcanzado", {
        stock_deposito_id: par.stockId,
        variante_sku_id: par.varianteSkuId,
        deposito_id: par.depositoId,
        cantidad_resultante: 0,
        punto_pedido: 5,
        movimiento_id_origen: randomUUID(),
      });
      await drenar();
      assert.equal((await activaDe(par))?.severidad, "CRITICA");

      // SUMA real (DISPONIBLE 10): 0 → 10 > 5; solo ingreso_stock_registrado → resuelve.
      await registrarIngresoStock(
        { deposito_destino_id: par.depositoId, comprobante_referencia: MARCADOR, items: [{ variante_sku_id: par.varianteSkuId, cantidad: 10, estado_destino: "DISPONIBLE" }] },
        admin.id,
      );
      await drenar();
      assert.equal(await cantidadDe(par), 10);
      assert.equal(await activaDe(par), null);
    });

    await t.test("c2 — stock:transferencia_iniciada (origen) y stock:transferencia_recepcion_confirmada (destino), servicio real", caso("c2"), async () => {
      const origen = await crearPar(6, 5);
      const deposito2 = await crearDeposito();
      const destinoStock = await prisma.stockDeposito.create({
        data: { variante_sku_id: origen.varianteSkuId, deposito_id: deposito2.id, cantidad: 1, punto_pedido: 3 },
      });
      const destino: Par = { ...origen, depositoId: deposito2.id, stockId: destinoStock.id, deposito: deposito2.nombre };
      await evaluarStock(destino);
      assert.equal((await activaDe(destino))?.severidad, "ADVERTENCIA");

      const creada = await transferencias.crearTransferencia(
        { deposito_origen_id: origen.depositoId, deposito_destino_id: destino.depositoId, items: [{ variante_sku_id: origen.varianteSkuId, cantidad: 4 }] },
        admin.id,
      );
      await drenar();
      assert.equal(await cantidadDe(origen), 2);
      assert.equal((await activaDe(origen))?.severidad, "ADVERTENCIA", "el origen quedó en 2 ≤ 5");

      const item = await prisma.transferenciaStockItem.findFirstOrThrow({ where: { transferencia_id: creada.transferencia_id }, select: { id: true } });
      await transferencias.confirmarRecepcionTransferencia(
        { transferencia_id: creada.transferencia_id, items: [{ transferencia_item_id: item.id, cantidad_recibida: 4 }] },
        admin.id,
      );
      await drenar();
      assert.equal(await cantidadDe(destino), 5);
      assert.equal(await activaDe(destino), null, "el destino quedó en 5 > 3: se resuelve");
    });

    await t.test("c3 — stock:reserva_congelada y stock:reserva_liberada (PAGO_RECHAZADO relee la Reserva; VENTA no evalúa)", caso("c3"), async () => {
      const par = await crearPar(7, 5);
      const reserva = await reservas.crearReserva(
        { variante_sku_id: par.varianteSkuId, deposito_id: par.depositoId, cantidad: 3, origen_reserva: "SENIA" },
        admin.id,
      );
      await drenar();
      assert.equal(await cantidadDe(par), 4);
      assert.equal((await activaDe(par))?.severidad, "ADVERTENCIA");

      // VENTA: no cambia la cantidad y no reevalúa. Se cambia el stock SIN evento: si el
      // listener evaluara, resolvería; como ignora VENTA, la alerta sigue igual.
      await fijarStock(par, { cantidad: 20 });
      domainEventBus.emit("stock:reserva_liberada", {
        reserva_id: reserva.reserva_id,
        motivo_liberacion: "VENTA",
        variante_sku_id: par.varianteSkuId,
        cantidad: 3,
      });
      await drenar();
      assert.equal((await activaDe(par))?.severidad, "ADVERTENCIA", "VENTA no reevalúa");
      await fijarStock(par, { cantidad: 4 });

      // PAGO_RECHAZADO real: devuelve 3 (4 → 7 > 5) y emite sin depósito en el payload.
      const liberadas = await prisma.$transaction((tx) => reservas.liberarReservasTx(tx, [reserva.reserva_id], "PAGO_RECHAZADO"));
      reservas.emitirReservasLiberadas(liberadas, "PAGO_RECHAZADO");
      await drenar();
      assert.equal(await cantidadDe(par), 7);
      assert.equal(await activaDe(par), null, "releyó la Reserva, evaluó el par y resolvió");
    });

    await t.test("c4 — stock:reclasificacion_devuelto: DISPONIBLE reevalúa (servicio real), BAJA_MERMA no", caso("c4"), async () => {
      const par = await crearPar(2, 5);
      await evaluarStock(par);
      // Unidades devueltas reales (SUMA): 2 → 4, sigue ADVERTENCIA.
      await registrarIngresoStock(
        { deposito_destino_id: par.depositoId, comprobante_referencia: MARCADOR, items: [{ variante_sku_id: par.varianteSkuId, cantidad: 2, estado_destino: "DEVUELTO" }] },
        admin.id,
      );
      await drenar();
      assert.equal((await activaDe(par))?.severidad, "ADVERTENCIA");

      // BAJA_MERMA no cambia la cantidad: cambio SIN evento + evento → no reevalúa.
      await fijarStock(par, { cantidad: 30 });
      domainEventBus.emit("stock:reclasificacion_devuelto", {
        movimiento_id: randomUUID(),
        variante_sku_id: par.varianteSkuId,
        deposito_id: par.depositoId,
        resultado_control_calidad: "NO_APTO",
        estado_origen: "DEVUELTO",
        estado_destino: "BAJA_MERMA",
        motivo: "Fixture",
        usuario_id: admin.id,
      });
      await drenar();
      assert.equal((await activaDe(par))?.severidad, "ADVERTENCIA", "BAJA_MERMA no reevalúa");
      await fijarStock(par, { cantidad: 4 });

      // APTO real (vía directa, ≤ umbral): 4 → 6 > 5, emite DISPONIBLE → resuelve.
      await reclasificarDevuelto(
        { variante_sku_id: par.varianteSkuId, deposito_id: par.depositoId, cantidad: 2, resultado_control_calidad: "APTO" },
        admin.id,
      );
      await drenar();
      assert.equal(await cantidadDe(par), 6);
      assert.equal(await activaDe(par), null);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // d. Egresos
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("d1 — egresos con G14 inyectado: crea, escala, baja y resuelve", caso("d1"), async () => {
      let pct: number | null = 72;
      const { dependencias } = egresosInyectados(() => pct, { reloj: () => new Date("2099-01-15T15:00:00.000Z") });
      referenciasEgresosSuite.add("2099-01");
      const pasos: [number | null, string, string | null][] = [
        [72, "CREAR", "INFORMATIVA"],
        [130, "CAMBIAR_NIVEL", "CRITICA"],
        [86, "CAMBIAR_NIVEL", "ADVERTENCIA"],
        [69.99, "RESOLVER", null],
      ];
      for (const [valor, transicion, severidad] of pasos) {
        pct = valor;
        const r = await evaluarEgresos({ anio: 2099, mes: 1 }, { dependencias });
        assert.equal(r.estado, "EVALUADO");
        assert.equal(r.estado === "EVALUADO" && r.transicion, transicion, `${valor}%`);
        assert.equal((await alertaEgresos("2099-01"))?.severidad ?? null, severidad, `${valor}%`);
      }
      const resuelta = await prisma.alertaDesvio.findFirstOrThrow({ where: { referencia: "2099-01", estado: "RESUELTA", is_active: true } });
      assert.equal(Number(resuelta.porcentaje_egresos), 86, "D28: conserva el último desvío");
    });

    await t.test("d2 — porcentaje no calculable (D2) resuelve; G14 caído no modifica nada", caso("d2"), async () => {
      referenciasEgresosSuite.add("2099-02");
      const reloj = () => new Date("2099-02-10T15:00:00.000Z");
      await evaluarEgresos({ anio: 2099, mes: 2 }, { dependencias: egresosInyectados(() => 90, { reloj }).dependencias });
      const antes = JSON.stringify(await alertaEgresos("2099-02"));
      const caido = egresosInyectados(() => 10, { reloj, fallar: true });
      const r = await evaluarEgresos({ anio: 2099, mes: 2 }, { dependencias: caido.dependencias });
      assert.equal(r.estado, "ERROR_FUENTE");
      assert.equal(JSON.stringify(await alertaEgresos("2099-02")), antes, "G14 caído: nada cambia");

      const noCalculable = await evaluarEgresos({ anio: 2099, mes: 2 }, { dependencias: egresosInyectados(() => null, { reloj }).dependencias });
      assert.equal(noCalculable.estado === "EVALUADO" && noCalculable.transicion, "RESOLVER");
      assert.equal(await alertaEgresos("2099-02"), null);
    });

    await t.test("d6 — G14 real sin ingresos informa NO_CALCULABLE en D6", caso("d6"), async () => {
      const periodo = { anio: 2198, mes: 11 };
      const referencia = "2198-11";
      referenciasEgresosSuite.add(referencia);
      const resumen = await obtenerResumenMensual(periodo.anio, periodo.mes, { incluir_desglose_gastos: false });
      assert.equal(resumen.ingresos.total, "0.00", "mes sin ingresos en la base de test");
      assert.equal(resumen.porcentaje_egresos_sobre_ingresos, null);

      const ahora = () => new Date("2198-11-15T15:00:00.000Z");
      const evaluacion = await evaluarEgresos(periodo, { dependencias: { ahora } });
      assert.equal(evaluacion.estado, "EVALUADO");
      assert.equal(evaluacion.estado === "EVALUADO" && evaluacion.porcentaje, null);
      const panel = await obtenerPanelAlertas({ estado: "todas", page: 1, page_size: 100 }, { dependencias: { ahora } });
      assert.deepEqual(panel.fuente_egresos, { estado: "NO_CALCULABLE", referencia });
    });

    await t.test("d3 — mes pasado: se resuelve sin llamar a G14", caso("d3"), async () => {
      referenciasEgresosSuite.add("2099-03");
      await evaluarEgresos({ anio: 2099, mes: 3 }, { dependencias: egresosInyectados(() => 80, { reloj: () => new Date("2099-03-20T15:00:00.000Z") }).dependencias });
      assert.ok(await alertaEgresos("2099-03"));
      const abril = egresosInyectados(() => 999, { reloj: () => new Date("2099-04-02T15:00:00.000Z") });
      const r = await evaluarEgresos({ anio: 2099, mes: 3 }, { dependencias: abril.dependencias });
      assert.equal(r.estado, "MES_NO_VIGENTE");
      assert.equal(abril.llamadas.g14, 0);
      assert.equal(await alertaEgresos("2099-03"), null);
    });

    await t.test("d4 — por el bus: CxP con otra acción no evalúa; PAGAR del mes en curso reevalúa (G14 real no calculable)", caso("d4"), async () => {
      await sinAlertaEgresosHoy();
      await evaluarEgresos({ anio: anioHoy, mes: mesHoy }, { dependencias: egresosInyectados(() => 90).dependencias });
      assert.equal((await alertaEgresos(referenciaHoy))?.severidad, "ADVERTENCIA");
      const cxp = (accion: "DEFINIR" | "PAGAR", fecha_pago: string | null) => ({
        cuenta_por_pagar_id: randomUUID(), orden_compra_id: randomUUID(), numero_orden: `${MARCADOR}-OC`, proveedor_id: PROVEEDOR_HOMOLOGADO_ID,
        estado_anterior: "DEFINITIVA" as const, estado_nuevo: accion === "PAGAR" ? ("PAGADA" as const) : ("DEFINITIVA" as const), accion, cambiado_por: admin.id,
        monto_anterior: "1.00", monto_nuevo: "1.00", recepcion_id: null, fecha_vencimiento: null, fecha_pago, deletion_reason: null,
        medio_pago: accion === "PAGAR" ? ("TRANSFERENCIA" as const) : null, cuenta_origen_id: null, comprobante_proveedor_ids: null, observaciones: null,
      });
      domainEventBus.emit("cuenta_por_pagar:estado_cambiado", cxp("DEFINIR", null));
      await drenar();
      assert.equal((await alertaEgresos(referenciaHoy))?.severidad, "ADVERTENCIA", "DEFINIR no evalúa");
      domainEventBus.emit("cuenta_por_pagar:estado_cambiado", cxp("PAGAR", new Date().toISOString()));
      await drenar();
      assert.equal(await alertaEgresos(referenciaHoy), null, "PAGAR reevaluó el mes: no calculable → resuelta");
    });

    await t.test("d5 — por el bus: gasto de mes pasado no crea alerta; editado entre dos meses evalúa ambos", caso("d5"), async () => {
      await sinAlertaEgresosHoy();
      const gasto = (fecha: string) => ({ gasto_operativo_id: randomUUID(), categoria_gasto_id: randomUUID(), fecha, monto: "1000.00", usuario_id: admin.id });
      const antes = await prisma.alertaDesvio.count({ where: { referencia: referenciaAnterior } });
      domainEventBus.emit("gasto_operativo:creado", gasto(`${referenciaAnterior}-10`));
      await drenar();
      assert.equal(await prisma.alertaDesvio.count({ where: { referencia: referenciaAnterior } }), antes, "mes pasado: no crea");

      // Activas en ambos meses (la del mes anterior, creada con el reloj en ese mes).
      await evaluarEgresos({ anio: anioHoy, mes: mesHoy }, { dependencias: egresosInyectados(() => 90).dependencias });
      await evaluarEgresos(mesAnterior, { dependencias: egresosInyectados(() => 75, { reloj: relojMesAnterior }).dependencias });
      assert.ok(await alertaEgresos(referenciaHoy));
      assert.ok(await alertaEgresos(referenciaAnterior));
      const datos = (fecha: string) => ({ categoria_gasto_id: randomUUID(), fecha, monto: "1000.00", descripcion: MARCADOR });
      domainEventBus.emit("gasto_operativo:editado", {
        ...gasto(`${referenciaHoy}-01`),
        valor_anterior: datos(`${referenciaAnterior}-10`),
        valor_nuevo: datos(`${referenciaHoy}-01`),
      });
      await drenar();
      assert.equal(await alertaEgresos(referenciaAnterior), null, "mes anterior: resuelta (no vigente)");
      assert.equal(await alertaEgresos(referenciaHoy), null, "mes en curso: reevaluado (G14 real no calculable)");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // e. Panel
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("e1 — obtenerPanelAlertas reevalúa al abrir: corrige stock cambiado sin evento y resuelve egresos de meses pasados", caso("e1"), async () => {
      const subeSinEvento = await crearPar(1, 5);
      const bajaSinEvento = await crearPar(4, 5);
      await evaluarStock(subeSinEvento);
      await evaluarStock(bajaSinEvento);
      await fijarStock(subeSinEvento, { cantidad: 40 }); // como compensarVentaPagada: incremento sin evento
      await fijarStock(bajaSinEvento, { cantidad: 0 });
      await evaluarEgresos(mesAnterior, { dependencias: egresosInyectados(() => 80, { reloj: relojMesAnterior }).dependencias });
      assert.ok(await alertaEgresos(referenciaAnterior));

      const panel = await obtenerPanelAlertas({ estado: "todas", page: 1, page_size: 100 });
      await drenar();
      assert.equal(await activaDe(subeSinEvento), null, "resuelta al abrir el panel");
      assert.equal((await activaDe(bajaSinEvento))?.severidad, "CRITICA", "subió de nivel al abrir el panel");
      assert.equal(await alertaEgresos(referenciaAnterior), null, "mes pasado resuelto al abrir el panel");
      const resumen = await obtenerResumenMensual(anioHoy, mesHoy, { incluir_desglose_gastos: false });
      assert.ok(Number(resumen.ingresos.total) > 0, "fixture del mes: ingresos positivos");
      assert.notEqual(resumen.porcentaje_egresos_sobre_ingresos, null);
      assert.deepEqual(panel.fuente_egresos, {
        estado: "CALCULABLE",
        referencia: referenciaHoy,
        porcentaje: resumen.porcentaje_egresos_sobre_ingresos,
      });
      assert.deepEqual(panel.umbrales, { informativa: 70, advertencia: 85, critica: 100 });
    });

    await t.test("e2 — panel: filtros, orden, paginación coherente, is_active, detalle vigente (ACTIVAS) y último desvío (RESUELTAS)", caso("e2"), async () => {
      const activa = await crearPar(3, 5);
      await evaluarStock(activa);
      await fijarStock(activa, { cantidad: 2 }); // sigue ADVERTENCIA: la fila guarda 3, el valor vigente es 2
      const resuelta = await crearPar(0, 5);
      await evaluarStock(resuelta);
      await fijarStock(resuelta, { cantidad: 50 });
      await evaluarStock(resuelta);
      const deBaja = await crearPar(0, 5);
      await evaluarStock(deBaja);
      await prisma.alertaDesvio.updateMany({
        where: { variante_sku_id: deBaja.varianteSkuId, is_active: true },
        data: { is_active: false, deleted_at: new Date(), deleted_by: admin.id, deletion_reason: `Fixture ${MARCADOR}`, clave_activa: null },
      });

      const todas = await obtenerPanelAlertas({ estado: "todas", page: 1, page_size: 100 });
      const filaActiva = todas.alertas.find((a) => a.referencia === `${activa.sku} · ${activa.deposito}` && a.estado === "ACTIVA")!;
      assert.equal(filaActiva.detalle, "Stock 2 (punto de pedido 5)");
      assert.equal(filaActiva.detalle_vigente, true);
      const filaResuelta = todas.alertas.find((a) => a.referencia === `${resuelta.sku} · ${resuelta.deposito}`)!;
      assert.equal(filaResuelta.estado, "RESUELTA");
      assert.equal(filaResuelta.detalle, "Stock 0 (punto de pedido 5)", "D28: último desvío");
      assert.ok(filaResuelta.resuelta_texto);
      assert.equal(todas.alertas.some((a) => a.referencia === `${deBaja.sku} · ${deBaja.deposito}`), false, "is_active = false no se lista");
      for (const fila of todas.alertas) assert.doesNotMatch(fila.referencia, /[0-9a-f]{8}-[0-9a-f]{4}-/i);

      // Orden: más grave primero; dentro del nivel, más reciente primero.
      const rango = { CRITICA: 0, ADVERTENCIA: 1, INFORMATIVA: 2 } as const;
      for (let i = 1; i < todas.alertas.length; i += 1) {
        const [a, b] = [todas.alertas[i - 1]!, todas.alertas[i]!];
        assert.ok(rango[a.severidad] < rango[b.severidad] || (rango[a.severidad] === rango[b.severidad] && a.desde >= b.desde), `orden en ${i}`);
      }

      // Filtros por pestaña y nivel; conteo coherente con la base.
      for (const [estado, where] of [
        ["activas", { estado: "ACTIVA" as const }],
        ["resueltas", { estado: "RESUELTA" as const }],
        ["todas", {}],
      ] as const) {
        const panel = await obtenerPanelAlertas({ estado, page: 1, page_size: 100 });
        assert.equal(panel.paginacion.total, await prisma.alertaDesvio.count({ where: { is_active: true, ...where } }), estado);
        assert.ok(panel.alertas.every((a) => estado === "todas" || a.estado === (estado === "activas" ? "ACTIVA" : "RESUELTA")));
      }
      const criticas = await obtenerPanelAlertas({ estado: "todas", nivel: "critica", page: 1, page_size: 100 });
      assert.ok(criticas.alertas.length > 0 && criticas.alertas.every((a) => a.severidad === "CRITICA"));
      assert.equal(criticas.paginacion.total, await prisma.alertaDesvio.count({ where: { is_active: true, severidad: "CRITICA" } }));

      // Paginación: páginas de 2 sin repetidos ni faltantes, total igual al conteo.
      const total = todas.paginacion.total;
      const ids: string[] = [];
      for (let page = 1; page <= Math.ceil(total / 2); page += 1) {
        const pagina = await obtenerPanelAlertas({ estado: "todas", page, page_size: 2 });
        assert.equal(pagina.paginacion.total, total);
        assert.equal(pagina.paginacion.total_paginas, Math.ceil(total / 2));
        ids.push(...pagina.alertas.map((a) => a.id));
      }
      assert.equal(ids.length, total);
      assert.equal(new Set(ids).size, total);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // f. Auditoría real
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("f1 — un asiento por transición (creada, nivel_cambiado, resuelta), ninguno en no-op; cadena íntegra", caso("f1"), async () => {
      const par = await crearPar(4, 5);
      await evaluarStock(par);
      const alertaId = (await activaDe(par))!.id;
      await fijarStock(par, { cantidad: 0 });
      await evaluarStock(par);
      await evaluarStock(par); // no-op
      await fijarStock(par, { cantidad: 9 });
      await evaluarStock(par);
      await drenar();
      const asientos = await esperar(
        async () => {
          const filas = await prisma.auditLog.findMany({ where: { tabla_afectada: "alertas_desvio", registro_id: alertaId }, orderBy: { created_at: "asc" } });
          return filas.length >= 3 && filas;
        },
        "asientos de la alerta",
      );
      assert.deepEqual(asientos.map((a) => a.accion), ["ALERTA_DESVIO_CREADA", "ALERTA_DESVIO_NIVEL_CAMBIADO", "ALERTA_DESVIO_RESUELTA"]);
      for (const a of asientos) {
        assert.equal(a.usuario_id, null);
        assert.equal(a.ip, "internal-event");
      }
      assert.deepEqual(asientos[1]!.valor_anterior, { severidad: "ADVERTENCIA" });
      assert.equal((asientos[1]!.valor_nuevo as Record<string, unknown>).severidad, "CRITICA");
      assert.equal((asientos[2]!.valor_nuevo as Record<string, unknown>).estado, "RESUELTA");
      const integridad = await verificarCadenaIntegridad();
      assert.equal(integridad.integra, true, JSON.stringify(integridad));
    });

    await t.test("f2 — actualizarUmbralesEgresos real: asiento UPDATE en configuraciones_sistema por clave cambiada, con el usuario real", caso("f2"), async () => {
      const desde = new Date();
      const r = await configuracion.actualizarUmbralesEgresos({ informativa: 70, advertencia: 85, critica: 120 }, admin.id);
      assert.deepEqual(r.claves_cambiadas, ["TESORERIA_ALERTA_EGRESOS_CRITICA_PCT"]);
      const asiento = await esperar(
        () => prisma.auditLog.findFirst({ where: { tabla_afectada: "configuraciones_sistema", created_at: { gte: desde } } }),
        "asiento de configuracion:actualizada",
      );
      assert.equal(asiento.accion, "UPDATE");
      assert.equal(asiento.registro_id, "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT");
      assert.equal(asiento.usuario_id, admin.id);
      assert.deepEqual(asiento.valor_anterior, { clave: "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT", valor: "100" });
      assert.deepEqual(asiento.valor_nuevo, { clave: "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT", valor: "120" });
      await configuracion.actualizarUmbralesEgresos({ informativa: 70, advertencia: 85, critica: 100 }, admin.id);
      await drenar();
      assert.equal(await prisma.auditLog.count({ where: { tabla_afectada: "configuraciones_sistema", created_at: { gte: desde } } }), 2);
      assert.deepEqual(await configuracion.obtenerUmbralesEgresos(), { informativa: 70, advertencia: 85, critica: 100 });
      assert.equal((await verificarCadenaIntegridad()).integra, true);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // g. Notificaciones reales (F3)
    // ─────────────────────────────────────────────────────────────────────────

    const notificacionesDe = (evento: EventoAlerta) =>
      prisma.notificacion.findMany({
        where: {
          tipo_evento: evento.nombre,
          clave_idempotencia: {
            in: [admin.id, gerente.id, cajero.id].map((u) => calcularClaveIdempotencia(evento.nombre, evento.payload.evento_id, u)),
          },
        },
        select: { usuario_destinatario_id: true, prioridad: true, asunto: true, cuerpo: true },
      });

    await t.test("g1 — creada notifica a administrador.seed y gerente.seed con la prioridad de la severidad (gana a la de la plantilla)", caso("g1"), async () => {
      const plantilla = await prisma.plantillaNotificacion.findUniqueOrThrow({ where: { tipo_evento: "alerta_desvio:creada" } });
      assert.equal(plantilla.prioridad_default, "ADVERTENCIA");
      const par = await crearPar(0, 5); // CRITICA ≠ prioridad de la plantilla
      await evaluarStock(par);
      const alerta = (await activaDe(par))!;
      const creada = eventosDe(alerta.id).find((e) => e.nombre === "alerta_desvio:creada")!;
      const notis = await esperar(async () => {
        const n = await notificacionesDe(creada);
        return n.length >= 2 && n;
      }, "notificaciones de creada");
      await drenar();
      assert.deepEqual(notis.map((n) => n.usuario_destinatario_id).sort(), [admin.id, gerente.id].sort());
      for (const n of notis) {
        assert.equal(n.prioridad, "CRITICA");
        assert.equal(n.asunto, "Alerta Crítica: Stock bajo el punto de pedido");
        assert.doesNotMatch(n.cuerpo, /[0-9a-f]{8}-[0-9a-f]{4}-/i);
      }
      assert.equal((await notificacionesDe(creada)).some((n) => n.usuario_destinatario_id === cajero.id), false, "sin alertas:leer no recibe");
    });

    await t.test("g2 — nivel_cambiado notifica solo al escalar a CRITICA; resuelta no notifica; reentrega no duplica", caso("g2"), async () => {
      const par = await crearPar(4, 5);
      await evaluarStock(par); // ADVERTENCIA
      const alertaId = (await activaDe(par))!.id;
      await fijarStock(par, { cantidad: 0 });
      await evaluarStock(par); // → CRITICA (notifica)
      await fijarStock(par, { cantidad: 3 });
      await evaluarStock(par); // → ADVERTENCIA (no notifica)
      await fijarStock(par, { cantidad: 30 });
      await evaluarStock(par); // → resuelta (no notifica)
      await drenar();
      const [escalada, bajada] = eventosDe(alertaId).filter((e) => e.nombre === "alerta_desvio:nivel_cambiado");
      const resuelta = eventosDe(alertaId).find((e) => e.nombre === "alerta_desvio:resuelta")!;
      assert.equal(escalada!.payload.severidad_nueva, "CRITICA");
      assert.equal(bajada!.payload.severidad_nueva, "ADVERTENCIA");
      const notisEscalada = await esperar(async () => {
        const n = await notificacionesDe(escalada!);
        return n.length >= 2 && n;
      }, "notificaciones de la escalada");
      assert.ok(notisEscalada.every((n) => n.prioridad === "CRITICA" && n.asunto === "Alerta escalada a Crítica: Stock bajo el punto de pedido"));
      assert.equal((await notificacionesDe(bajada!)).length, 0, "bajar de nivel no notifica");
      assert.equal((await notificacionesDe(resuelta)).length, 0, "resolver no notifica");
      assert.equal(await prisma.notificacion.count({ where: { tipo_evento: "alerta_desvio:resuelta" } }), 0, "resuelta nunca notifica");

      // Reentrega del mismo evento_id por la suscripción real de F3: no duplica.
      const suscripcion = SUSCRIPCIONES_NOTIFICACION.find((s) => s.evento === "alerta_desvio:nivel_cambiado")!;
      const generacion = suscripcion.armar(escalada!.payload as never)!;
      const reentrega = await generarNotificaciones({ ...generacion, tipo_evento: suscripcion.evento, prioridad_default: suscripcion.prioridad_default });
      assert.deepEqual(reentrega, { creadas: 0, duplicadas: 2, fallidas: 0 });
      assert.equal((await notificacionesDe(escalada!)).length, 2);
    });

    await t.test("g3 — ningún usuario sin alertas:leer recibe notificaciones de alertas", caso("g3"), async () => {
      const sinPermiso = await prisma.notificacion.count({
        where: {
          tipo_evento: { startsWith: "alerta_desvio:" },
          usuario_destinatario_id: { notIn: [admin.id, gerente.id] },
        },
      });
      assert.equal(sinPermiso, 0);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Conteos finales contra los iniciales (antes de la limpieza de t.after)
    // ─────────────────────────────────────────────────────────────────────────

    await t.test("z — el stock del seed no cambió y los umbrales siguen 70/85/100", caso("z"), async () => {
      await drenar();
      const stockSeedDespues = await prisma.stockDeposito.aggregate({
        _sum: { cantidad: true },
        where: { variante_sku: { sku: { not: { startsWith: "D6IT-" } } } },
      });
      assert.deepEqual(stockSeedDespues, stockSeedAntes);
      assert.deepEqual(await configuracion.obtenerUmbralesEgresos(), umbralesAntes);
      console.log(`[hu-d6] alertas activas al inicio: ${alertasActivasAntes}; marcador de fixtures: ${MARCADOR}`);
    });
  },
);
