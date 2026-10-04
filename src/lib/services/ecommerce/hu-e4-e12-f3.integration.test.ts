import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/**
 * HU-E4 → HU-E12 → HU-F3 — recorrido combinado contra PostgreSQL real.
 *
 * Atraviesa, sin sustituir `$transaction` ni emitir eventos a mano: checkout con
 * cupón → aplicación pendiente → confirmación de pago por el servicio productivo
 * (consumo + admisión E12 en la misma transacción) → bus real →
 * `notificacion.listener` (F3) productivo → `Notificacion` persistida.
 *
 * Simulado: solo la pasarela de Mercado Pago (`consultarPago`/`cerrarCobro`
 * inyectados) y `MP_MODO=simulado` para la preferencia. Real: Prisma, PostgreSQL,
 * servicios, bus de eventos y listeners de auditoría y notificación.
 *
 * Base descartable NUEVA (nunca una existente):
 *   docker exec swat_erp_postgres psql -U erpswat -d postgres -c "CREATE DATABASE <nueva> TEMPLATE template0"
 *   DATABASE_URL=<nueva> npx prisma migrate deploy && DATABASE_URL=<nueva> npx prisma db seed
 *   HU_E4_E12_F3_INTEGRATION_DATABASE_URL=<nueva> npm run test:integration:e4-e12-f3
 */

const DATABASE_URL = process.env.HU_E4_E12_F3_INTEGRATION_DATABASE_URL;
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
const EVENTO_ADMISION = "ecommerce:pedido_admitido_cola";
const MARCADORES_SENSIBLES = "DNI 30123456 postgresql://usuario:clave-secreta@db.interna:5432/erp";

test(
  "HU-E4 → HU-E12 → HU-F3 — pago con cupón, admisión y notificación interna persistida",
  { skip: !DATABASE_URL, timeout: 240_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MP_MODO = "simulado";
    process.env.APP_PUBLIC_URL = "http://localhost:3000";

    const [
      { prisma },
      carrito,
      checkout,
      pagoWeb,
      { domainEventBus },
      { ServiceError },
      { iniciarAuditLogListener },
      { iniciarNotificacionListener },
      { calcularClaveIdempotencia },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./carrito.service.ts"),
      import("./checkout.service.ts"),
      import("./pago-web.service.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../../events/listeners/notificacion.listener.ts"),
      import("../notificaciones/notificacion.reglas.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);

    const [{ base }] = await prisma.$queryRaw<{ base: string }[]>`select current_database() as base`;
    const esperada = new URL(DATABASE_URL!).pathname.slice(1);
    assert.equal(base, esperada, "la conexión efectiva no apunta a la base indicada");
    assert.match(base, /^swat_erp_test_/, "la base no es descartable de test");
    console.log(`[hu-e4-e12-f3] current_database() = ${base}`);

    let rechazosNoManejados = 0;
    const contarRechazo = () => {
      rechazosNoManejados += 1;
    };
    process.on("unhandledRejection", contarRechazo);

    const auditCreateOriginal = prisma.auditLog.create.bind(prisma.auditLog);
    const consolaErrorOriginal = console.error;
    t.after(async () => {
      process.off("unhandledRejection", contarRechazo);
      prisma.auditLog.create = auditCreateOriginal as typeof prisma.auditLog.create;
      console.error = consolaErrorOriginal;
      let anterior = -1;
      for (let intento = 0; intento < 60; intento++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) break;
        anterior = actual;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await prisma.$disconnect();
    });
    iniciarAuditLogListener();
    iniciarNotificacionListener();

    const pagosMp = new Map<string, PagoConsultado>();
    const pasarela = {
      consultarPago: async (id: string) => {
        const pago = pagosMp.get(id);
        if (!pago) throw new ServiceError("PAGO_NO_ENCONTRADO");
        return pago;
      },
      cerrarCobro: async () => {},
    };
    function pagoMp(ref: string, estado: "approved" | "rejected", monto: number): string {
      const id = String(Math.floor(Math.random() * 1e12));
      pagosMp.set(id, {
        payment_id: id,
        estado: estado === "approved" ? "APROBADO" : "RECHAZADO",
        status_mp: estado,
        status_detail: estado === "approved" ? "accredited" : "cc_rejected_insufficient_amount",
        monto,
        moneda: "ARS",
        external_reference: ref,
        fecha_aprobacion: estado === "approved" ? new Date().toISOString() : null,
      });
      return id;
    }

    async function esperar<T>(descripcion: string, leer: () => Promise<T | null | false>, timeoutMs = 20_000): Promise<T> {
      const limite = Date.now() + timeoutMs;
      for (;;) {
        const valor = await leer();
        if (valor) return valor;
        if (Date.now() > limite) throw new Error(`Tiempo agotado esperando: ${descripcion}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const admisiones: { evento_id: string; pedido_venta_id: string }[] = [];
    domainEventBus.on(EVENTO_ADMISION, (payload) => {
      admisiones.push({ evento_id: payload.evento_id, pedido_venta_id: payload.pedido_venta_id });
    });

    async function crearCupon() {
      const codigo = `X3${randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.cuponDescuento.create({
        data: {
          codigo,
          tipo_beneficio: "PORCENTAJE",
          valor: 10,
          vigente_desde: new Date(Date.now() - 86_400_000),
          vigente_hasta: new Date(Date.now() + 86_400_000),
          limite_uso_global: 5,
          limite_uso_por_cliente: 5,
        },
      });
      return codigo;
    }
    async function compraConCupon() {
      const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 5, precio: 10000 });
      const cuenta = await fixtures.crearCuenta(prisma);
      await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 2 });
      const cupon = await crearCupon();
      const iniciado = await checkout.iniciarCheckout(cuenta.sesion, { cupon_codigo: cupon });
      const aplicacion = await prisma.cuponAplicacion.findFirstOrThrow({ where: { pedido_venta_id: iniciado.pedido_venta_id } });
      return { articulo, cuenta, cupon, iniciado, aplicacion };
    }
    const stockShowroom = async (varianteId: string) =>
      (
        await prisma.stockDeposito.findUniqueOrThrow({
          where: { variante_sku_id_deposito_id: { variante_sku_id: varianteId, deposito_id: DEPOSITO_SHOWROOM_ID } },
        })
      ).cantidad;
    const estadoPedido = (pedidoVentaId: string) =>
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: pedidoVentaId },
        select: { estado_ecommerce: true, fecha_pago_confirmado: true, operador_asignado_id: true },
      });
    const auditorias = (accion: string, registroId: string) => prisma.auditLog.count({ where: { accion, registro_id: registroId } });

    const operadores = (
      await prisma.usuarioRol.findMany({
        where: { is_active: true, rol: { nombre: "OPERADOR_PICK_PACK", is_active: true }, usuario: { is_active: true } },
        select: { usuario_id: true },
      })
    ).map((u) => u.usuario_id);
    assert.ok(operadores.length >= 1, "el seed debe dejar al menos un operador OPERADOR_PICK_PACK activo");
    const notificacionesAdmision = () => prisma.notificacion.count({ where: { tipo_evento: EVENTO_ADMISION } });
    const claves = (eventoId: string) => operadores.map((id) => calcularClaveIdempotencia(EVENTO_ADMISION, eventoId, id));

    await t.test("A–F — checkout con cupón pendiente; pago consume una vez, admite en E12 y F3 persiste la notificación; webhook duplicado sin efectos", async () => {
      const notificacionesIniciales = await notificacionesAdmision();
      const { articulo, iniciado, aplicacion } = await compraConCupon();

      // A — aplicación pendiente, sin consumo confirmado.
      assert.equal(aplicacion.confirmada, false);
      assert.equal(aplicacion.is_active, true);
      assert.ok(aplicacion.reserva_hasta, "la aplicación pendiente tiene TTL de reserva");
      assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: aplicacion.cupon_id, confirmada: true } }), 0);
      assert.equal((await estadoPedido(iniciado.pedido_venta_id)).estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(await auditorias("ecommerce:cupon_consumido", aplicacion.id), 0);
      assert.equal(admisiones.filter((a) => a.pedido_venta_id === iniciado.pedido_venta_id).length, 0);
      assert.equal(await notificacionesAdmision(), notificacionesIniciales, "ninguna notificación de admisión antes del pago");

      // B — pago confirmado real (18000 = 2 × 10000 − 10 %).
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 18000);
      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "CONFIRMADO");
      const consumida = await prisma.cuponAplicacion.findUniqueOrThrow({ where: { id: aplicacion.id } });
      assert.equal(consumida.confirmada, true);
      assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: aplicacion.cupon_id, confirmada: true } }), 1);

      // C — admisión E12 persistida por la transacción de pago.
      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "EN_PREPARACION");
      assert.equal(p.operador_asignado_id, null);
      assert.ok(p.fecha_pago_confirmado);
      assert.equal(await stockShowroom(articulo.varianteId), 3);

      // D — el evento real del recorrido llegó al bus y F3 persistió una Notificacion por operador.
      const evento = admisiones.filter((a) => a.pedido_venta_id === iniciado.pedido_venta_id);
      assert.equal(evento.length, 1, "exactamente un evento de admisión emitido desde el pago");
      const filas = await esperar("notificaciones de admisión para cada operador", async () => {
        const rows = await prisma.notificacion.findMany({ where: { clave_idempotencia: { in: claves(evento[0].evento_id) } } });
        return rows.length === operadores.length ? rows : null;
      });
      assert.deepEqual(filas.map((f) => f.usuario_destinatario_id).sort(), [...operadores].sort());
      for (const fila of filas) {
        assert.equal(fila.tipo_evento, EVENTO_ADMISION);
        assert.equal(fila.prioridad, "INFORMATIVA");
        assert.equal(fila.is_active, true);
        assert.equal(fila.leida_at, null);
        assert.equal(fila.cuenta_cliente_web_destinatario_id, null);
      }
      assert.equal(await notificacionesAdmision(), notificacionesIniciales + operadores.length, "cantidad esperada según el contrato (un aviso por operador activo)");

      // Barrera de auditoría persistida (consumo y admisión) antes de comprobar duplicados.
      await esperar("auditoría de consumo persistida", async () => (await auditorias("ecommerce:cupon_consumido", aplicacion.id)) === 1);
      await esperar("auditoría de admisión persistida", async () => (await auditorias("PEDIDO_ADMITIDO_COLA", iniciado.pedido_venta_ecommerce_id)) === 1);

      // F — el mismo pago otra vez: sin efectos duplicados.
      const repetido = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(repetido.resultado, "SIN_EFECTO");
      await pausa(1500);
      assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: aplicacion.cupon_id, confirmada: true } }), 1);
      assert.equal(await auditorias("ecommerce:cupon_consumido", aplicacion.id), 1);
      assert.equal(admisiones.filter((a) => a.pedido_venta_id === iniciado.pedido_venta_id).length, 1);
      assert.equal(await notificacionesAdmision(), notificacionesIniciales + operadores.length);
      assert.equal(await stockShowroom(articulo.varianteId), 3);
    });

    await t.test("G/I — falla async de la auditoría de consumo: rechazo manejado, sin auditoría ficticia; pago, consumo, admisión y F3 intactos", async () => {
      const { iniciado, aplicacion } = await compraConCupon();
      const notificacionesIniciales = await notificacionesAdmision();

      const diagnosticos: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        diagnosticos.push(args);
      };
      let intentosFallidos = 0;
      prisma.auditLog.create = (async (args: { data: { accion: string; registro_id: string | null } }) => {
        if (args.data.accion === "ecommerce:cupon_consumido" && args.data.registro_id === aplicacion.id) {
          intentosFallidos += 1;
          await pausa(5);
          throw Object.assign(new Error(MARCADORES_SENSIBLES), { meta: { dni: "30123456" } });
        }
        return auditCreateOriginal(args as never);
      }) as unknown as typeof prisma.auditLog.create;

      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 18000);
      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "CONFIRMADO");

      const admision = await esperar("evento de admisión", async () => admisiones.find((a) => a.pedido_venta_id === iniciado.pedido_venta_id) ?? null);
      const filas = await esperar("notificaciones de admisión (F3) pese al fallo de auditoría", async () => {
        const rows = await prisma.notificacion.findMany({ where: { clave_idempotencia: { in: claves(admision.evento_id) } } });
        return rows.length === operadores.length ? rows : null;
      });
      // Barrera: la cola del ledger es serial; si la admisión ya está auditada, el intento de consumo (anterior) terminó.
      await esperar("auditoría de admisión persistida", async () => (await auditorias("PEDIDO_ADMITIDO_COLA", iniciado.pedido_venta_ecommerce_id)) === 1);
      const diagnosticosPropios = diagnosticos.filter((d) => String(d[0]).includes("ecommerce:cupon_consumido") && String(d[0]).includes("Falló la escritura"));
      console.error = consolaErrorOriginal;
      prisma.auditLog.create = auditCreateOriginal as typeof prisma.auditLog.create;

      assert.equal(intentosFallidos, 1, "se inyectó el fallo en un único intento de auditoría");
      assert.equal(diagnosticosPropios.length, 1, "un único diagnóstico del listener de consumo");
      assert.deepEqual(diagnosticosPropios[0][1], {
        aplicacion_id: aplicacion.id,
        pedido_venta_id: iniciado.pedido_venta_id,
        codigo_error: "ERROR_ESCRITURA_AUDITORIA",
      });
      const salida = JSON.stringify(diagnosticos);
      for (const marcador of ["30123456", "clave-secreta", "db.interna", "postgresql://"]) {
        assert.equal(salida.includes(marcador), false, `el diagnóstico filtra "${marcador}"`);
      }
      assert.equal(await auditorias("ecommerce:cupon_consumido", aplicacion.id), 0, "la auditoría fallida no figura como persistida");
      assert.equal(rechazosNoManejados, 0, "no debe haber unhandledRejection");

      const consumida = await prisma.cuponAplicacion.findUniqueOrThrow({ where: { id: aplicacion.id } });
      assert.equal(consumida.confirmada, true, "el consumo persiste aunque falle su auditoría");
      assert.equal((await estadoPedido(iniciado.pedido_venta_id)).estado_ecommerce, "EN_PREPARACION");
      assert.equal(filas.length, operadores.length);
      assert.equal(await notificacionesAdmision(), notificacionesIniciales + operadores.length);
    });

    await t.test("E — pago rechazado: libera cupón y stock, sin admisión ni notificación de operador", async () => {
      const { articulo, iniciado, aplicacion } = await compraConCupon();
      assert.equal(await stockShowroom(articulo.varianteId), 3);
      const notificacionesIniciales = await notificacionesAdmision();

      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "rejected", 18000);
      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "RECHAZADO");

      const liberada = await prisma.cuponAplicacion.findUniqueOrThrow({ where: { id: aplicacion.id } });
      assert.equal(liberada.is_active, false);
      assert.equal(liberada.confirmada, false);
      assert.match(liberada.deletion_reason ?? "", /Pago rechazado/);
      assert.equal(await stockShowroom(articulo.varianteId), 5, "la reserva se liberó");
      assert.equal((await estadoPedido(iniciado.pedido_venta_id)).estado_ecommerce, "PAGO_RECHAZADO");

      await esperar("auditoría de liberación persistida", async () => (await auditorias("ecommerce:cupon_aplicacion_liberada", aplicacion.id)) === 1);
      await pausa(1000);
      assert.equal(await auditorias("ecommerce:cupon_consumido", aplicacion.id), 0);
      assert.equal(admisiones.filter((a) => a.pedido_venta_id === iniciado.pedido_venta_id).length, 0);
      assert.equal(await notificacionesAdmision(), notificacionesIniciales, "sin notificación de admisión para un pedido rechazado");
    });
  },
);
