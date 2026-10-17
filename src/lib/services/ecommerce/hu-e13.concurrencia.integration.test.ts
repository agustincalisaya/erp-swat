import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * HU-E13 T18 — concurrencia, idempotencia, crash recovery y AuditLog
 * multiproceso sobre PostgreSQL real (TASKS T18 + addendum post-T17, PLAN §9.4).
 *
 * - AuditLog: escritores en PROCESOS DEL SISTEMA OPERATIVO distintos
 *   (`hu-e13.concurrencia.worker.ts` y el script real `job:reservas`), cada uno
 *   con su PrismaClient y su `colaLedger`; nunca solo `Promise.all` en un proceso.
 * - Carreras de dominio: transacciones PostgreSQL concurrentes reales sobre los
 *   servicios T07/T08/T10/T12/E3 aprobados; donde hace falta garantizar el
 *   solapamiento, un trigger temporal con `pg_sleep` retiene al ganador.
 * - Crashes: fallos inyectados con triggers temporales de la base descartable
 *   (patrón ya aprobado en las suites E3) o cortando el flujo en una frontera
 *   durable; ningún hook nuevo en código productivo.
 *
 * Uso (base local migrada y sembrada, nombre `swat_erp_test_e13_*`):
 *   HU_E13_T18_INTEGRATION_DATABASE_URL=$TEST_DB node --conditions=react-server --import tsx  *     --test --test-concurrency=1 src/lib/services/ecommerce/hu-e13.concurrencia.integration.test.ts
 */
const DATABASE_URL = process.env.HU_E13_T18_INTEGRATION_DATABASE_URL;
const WORKER = fileURLToPath(new URL("./hu-e13.concurrencia.worker.ts", import.meta.url));
const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));
const ACCIONES_HU_E13 = [
  "PEDIDO_PAGADO_CANCELADO",
  "PEDIDO_VENCIDO_SIN_RETIRO",
  "PLAZO_RETIRO_POR_VENCER",
  "REINTEGRO_APROBADO",
  "REINTEGRO_RECHAZADO",
  "REINTEGRO_REINTENTO_MANUAL",
];

interface SalidaProceso {
  codigo: number | null;
  resultado: Record<string, unknown> | null;
  salida: string;
  duracion_ms: number;
}

/** Proceso Node independiente; nunca comparte memoria con este proceso de test. */
function lanzarProceso(args: string[], env: Record<string, string>, timeoutMs = 180_000): Promise<SalidaProceso> {
  const desde = Date.now();
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", ...args], {
      cwd: RAIZ,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let salida = "";
    hijo.stdout.on("data", (chunk) => { salida += String(chunk); });
    hijo.stderr.on("data", (chunk) => { salida += String(chunk); });
    const reloj = setTimeout(() => {
      hijo.kill();
      reject(new Error(`proceso colgado (> ${timeoutMs} ms): ${args.join(" ")}\n${salida.slice(-2000)}`));
    }, timeoutMs);
    hijo.on("close", (codigo) => {
      clearTimeout(reloj);
      const linea = salida.split(/\r?\n/).reverse().find((l) => l.startsWith("RESULTADO:"));
      resolve({
        codigo,
        resultado: linea ? JSON.parse(linea.slice("RESULTADO:".length)) : null,
        salida,
        duracion_ms: Date.now() - desde,
      });
    });
  });
}

test("HU-E13 T18 — concurrencia, crash recovery y AuditLog multiproceso", {
  skip: !DATABASE_URL,
  timeout: 1_800_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MP_MODO = "real";
  process.env.APP_PUBLIC_URL = "http://t18.local";
  const f = await import("./hu-e13.test-fixtures.ts");
  f.exigirDbDeTest(DATABASE_URL!);
  const mp = new f.MercadoPagoFake();
  mp.instalar();
  const [
    { prisma },
    pickPack,
    reintegro,
    refund,
    mantenimiento,
    retiro,
    auditoria,
    { listenersRegistrados },
    { ErrorTecnicoMercadoPago },
  ] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./pick-pack.service.ts"),
    import("./reintegro-pedido-web.service.ts"),
    import("./reintegro-refund.service.ts"),
    import("./mantenimiento-hu-e13.service.ts"),
    import("./retiro-e3.service.ts"),
    import("../auditoria/audit-log.service.ts"),
    import("../../events/domain-event-bus.ts"),
    import("../../integraciones/mercadopago/adapter.ts"),
  ]);
  await listenersRegistrados;
  t.after(async () => {
    mp.desinstalar();
    await f.drenarListeners();
    await prisma.$disconnect();
  });

  const [operador, admin] = await Promise.all([
    prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "operador.pickpack.seed" }, select: { id: true } }),
    prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "admin.ecommerce.seed" }, select: { id: true } }),
  ]);
  const otroAdmin = await prisma.usuario.findFirstOrThrow({
    where: { is_active: true, deleted_at: null, id: { notIn: [admin.id, operador.id] }, nombre_usuario: { not: "canal.web.sistema" } },
    select: { id: true },
  });
  for (const [clave, valor] of [["ECOMMERCE_PLAZO_RETIRO_DIAS", "10"], ["ECOMMERCE_RECORDATORIO_RETIRO_HORAS", "24"]] as const) {
    await prisma.configuracionSistema.upsert({
      where: { clave },
      update: {},
      create: { clave, valor, modulo: "E", actualizado_por_id: admin.id },
    });
  }
  if (!await prisma.conectorPago.findFirst({ where: { entorno: "SANDBOX", estado: "ACTIVO", is_active: true, deleted_at: null } })) {
    const conectores = await import("../integraciones/conector-pago.service.ts");
    const conector = await conectores.crearConector({
      nombre: "Conector T18 SANDBOX",
      entorno: "SANDBOX",
      access_token: `TEST-T18-${randomUUID()}`,
      public_key: `TEST-T18-PK-${randomUUID()}`,
      webhook_secret: `t18-${randomUUID()}`,
    }, admin.id);
    await conectores.ejecutarHealthCheck(conector.conector_id);
  }

  const envHijo = { DATABASE_URL: DATABASE_URL!, MP_MODO: "simulado", APP_PUBLIC_URL: "http://t18.local" };
  const worker = (orden: Record<string, unknown>, env: Record<string, string> = envHijo) =>
    lanzarProceso([WORKER, JSON.stringify(orden)], env);
  const jobReservas = () => lanzarProceso(["scripts/liberar-reservas-vencidas.ts"], envHijo);

  async function compra(lineas?: { cantidad: number }[]) {
    const c = await f.crearCompraPagada({ lineas });
    mp.registrarPago(c.payment_id, c.total);
    await f.drenarListeners();
    return c;
  }

  async function listoVencido(lineas?: { cantidad: number }[]) {
    const c = await compra(lineas);
    await f.prepararHastaListo(c.pedido_venta_id, operador.id);
    await f.avanzarRelojPlazo(c.pedido_venta_id, new Date(Date.now() - 60_000));
    await f.drenarListeners();
    return c;
  }

  const extension = (pid: string) => prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
  const venta = (pid: string) => prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pid } });

  /** Integridad global del ledger: cadena SHA-256, sin bifurcación y sin hechos idempotentes duplicados. */
  async function ledgerIntegro(): Promise<number> {
    const r = await auditoria.verificarCadenaIntegridad();
    assert.equal(r.integra, true, `cadena AuditLog rota: ${JSON.stringify(r)}`);
    const [bifurcaciones] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      "SELECT count(*)::int n FROM (SELECT hash_anterior FROM audit_logs GROUP BY hash_anterior HAVING count(*) > 1) x");
    assert.equal(bifurcaciones!.n, 0, "dos asientos encadenados al mismo hash_anterior");
    const [duplicados] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int n FROM (
         SELECT 1 FROM audit_logs WHERE accion = ANY($1::text[]) OR accion = 'T18_IDEMPOTENTE'
         GROUP BY accion, tabla_afectada, registro_id HAVING count(*) > 1) x`, ACCIONES_HU_E13);
    assert.equal(duplicados!.n, 0, "hecho idempotente HU-E13 auditado dos veces");
    return r.registros_verificados;
  }

  /** Trigger temporal sobre la base descartable de test (mismo patrón que las suites E3). */
  async function conTrigger<T>(
    nombre: string,
    tabla: string,
    momento: "BEFORE INSERT" | "BEFORE UPDATE",
    condicion: string,
    accion: "FALLAR" | { dormir_s: number },
    fn: () => Promise<T>,
  ): Promise<T> {
    const cuerpo = accion === "FALLAR"
      ? `RAISE EXCEPTION 'T18 fallo inyectado: ${nombre}';`
      : `PERFORM pg_sleep(${accion.dormir_s}); RETURN NEW;`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${nombre}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${cuerpo} END $$`);
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${nombre} ${momento} ON ${tabla} FOR EACH ROW WHEN (${condicion}) EXECUTE FUNCTION ${nombre}()`);
      return await fn();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${nombre} ON ${tabla}`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${nombre}()`);
    }
  }

  /** Ninguna carrera puede terminar por deadlock o conflicto de serialización no resuelto. */
  function sinDeadlocks(resultados: PromiseSettledResult<unknown>[]): void {
    for (const r of resultados) {
      if (r.status === "rejected") {
        const texto = `${(r.reason as { code?: string })?.code ?? ""} ${String((r.reason as Error)?.message ?? r.reason)}`;
        assert.doesNotMatch(texto, /deadlock|40P01|P2034|could not serialize|Transaction already closed|timed out/i, texto);
      }
    }
  }

  function codigo(r: PromiseSettledResult<unknown>): string | null {
    return r.status === "rejected" ? String((r.reason as { code?: string; motivo?: string })?.code ?? (r.reason as { motivo?: string })?.motivo ?? r.reason) : null;
  }

  async function sinEfectosHuE13(c: Awaited<ReturnType<typeof compra>>): Promise<void> {
    const e = await f.efectos(c);
    assert.equal(e.sagas, 0);
    assert.equal(e.notas_credito, 0);
    assert.equal(e.movimientos_compensacion, 0);
    assert.equal(e.contra_asientos, 0);
    assert.equal(e.intentos, 0);
  }

  async function cancelarCliente(c: Awaited<ReturnType<typeof compra>>) {
    const inicio = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: c.pedido_venta_id,
      causa: "CANCELACION_CLIENTE",
      cliente_web_cuenta_id: c.cuenta.cuentaId,
      motivo: "Carrera T18 cliente",
    });
    await refund.continuarRefundPedidoWeb(inicio.reintegro_id);
    return inicio;
  }

  async function cancelarAdmin(c: Awaited<ReturnType<typeof compra>>, motivo = "Carrera T18 admin") {
    const inicio = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: c.pedido_venta_id,
      causa: "CANCELACION_ADMIN",
      usuario_id: admin.id,
      motivo,
    });
    await refund.continuarRefundPedidoWeb(inicio.reintegro_id);
    return inicio;
  }

  // ── AuditLog multiproceso ───────────────────────────────────────────────────

  await t.test("AuditLog: dos procesos OS escriben hechos distintos a la vez sin bifurcar la cadena", async () => {
    const base = await ledgerIntegro();
    let alternancias = 0;
    for (let ronda = 0; ronda < 3; ronda++) {
      const inicio = Date.now() + 6_000;
      const prefijos = [`A-${ronda}-${randomUUID()}`, `B-${ronda}-${randomUUID()}`];
      const [a, b] = await Promise.all(prefijos.map((prefijo) => worker({ accion: "audit", inicio, prefijo, cantidad: 25 })));
      for (const p of [a!, b!]) assert.equal(p.codigo, 0, p.salida.slice(-2000));
      assert.notEqual(a!.resultado!.pid, b!.resultado!.pid);
      const orden = await prisma.$queryRawUnsafe<{ registro_id: string }[]>(
        `SELECT registro_id FROM audit_logs WHERE accion = 'T18_MULTIPROCESO' AND (registro_id LIKE $1 OR registro_id LIKE $2)
         ORDER BY created_at ASC, id ASC`, `${prefijos[0]}-%`, `${prefijos[1]}-%`);
      assert.equal(orden.length, 50, "50 asientos nuevos, uno por append");
      for (let i = 1; i < orden.length; i++) {
        if (orden[i]!.registro_id.slice(0, 1) !== orden[i - 1]!.registro_id.slice(0, 1)) alternancias++;
      }
    }
    assert.ok(alternancias > 3, `los procesos deben intercalar appends reales (alternancias=${alternancias})`);
    assert.equal(await ledgerIntegro(), base + 150);
  });

  await t.test("AuditLog: el mismo hecho idempotente desde dos procesos produce una sola fila", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const registroId = `t18-idem-${randomUUID()}`;
      const inicio = Date.now() + 6_000;
      const procesos = await Promise.all(["P1", "P2"].map((etiqueta) => worker({
        accion: "audit-idempotente", inicio, accion_audit: "T18_IDEMPOTENTE", tabla: "t18_ledger", registro_id: registroId, etiqueta,
      })));
      for (const p of procesos) assert.equal(p.codigo, 0, p.salida.slice(-2000));
      assert.deepEqual(procesos.map((p) => p.resultado!.resultado).sort(), ["CREADO", "YA_EXISTENTE"]);
      assert.equal(await prisma.auditLog.count({ where: { accion: "T18_IDEMPOTENTE", registro_id: registroId } }), 1);
    }
    await ledgerIntegro();
  });

  await t.test("AuditLog crash A: fallo tras el lock y antes del INSERT revierte y libera el ledger", async () => {
    const antes = await prisma.auditLog.count();
    const registroId = `t18-crash-a-${randomUUID()}`;
    // BigInt no es serializable: el hash falla después de lock + lectura del anterior, antes del INSERT.
    await assert.rejects(() => auditoria.registrarAuditLog({
      usuario_id: null, accion: "T18_CRASH", tabla_afectada: "t18_ledger", registro_id: registroId, ip: "internal-test",
      valor_nuevo: { no_serializable: BigInt(1) },
    }));
    assert.equal(await prisma.auditLog.count({ where: { registro_id: registroId } }), 0);
    const otro = await worker({ accion: "audit", inicio: 0, prefijo: `post-crash-a-${randomUUID()}`, cantidad: 3 });
    assert.equal(otro.codigo, 0, otro.salida.slice(-2000));
    await auditoria.registrarAuditLog({
      usuario_id: null, accion: "T18_CRASH", tabla_afectada: "t18_ledger", registro_id: `${registroId}-ok`, ip: "internal-test",
    });
    assert.equal(await prisma.auditLog.count(), antes + 4);
    await ledgerIntegro();
  });

  await t.test("AuditLog crash B: rollback tras calcular e insertar; el otro proceso espera el lock y encadena bien", async () => {
    const registroId = `t18-crash-b-${randomUUID()}`;
    const prefijo = `post-crash-b-${randomUUID()}`;
    const [claseLock, objetoLock] = auditoria.CLAVE_ADVISORY_LEDGER_AUDITLOG;
    let hijo: Promise<SalidaProceso> | null = null;
    await assert.rejects(() => prisma.$transaction(async (tx) => {
      await auditoria.registrarAuditLog({
        usuario_id: null, accion: "T18_CRASH", tabla_afectada: "t18_ledger", registro_id: registroId, ip: "internal-test",
      }, tx);
      assert.equal(await tx.auditLog.count({ where: { registro_id: registroId } }), 1, "insertado dentro de la transacción");
      hijo = worker({ accion: "audit", inicio: 0, prefijo, cantidad: 1 });
      // El otro proceso queda bloqueado en el advisory lock del ledger mientras esta transacción vive.
      await f.esperarHasta(async () => {
        const [fila] = await prisma.$queryRawUnsafe<{ n: number }[]>(
          "SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = $1 AND objid = $2",
          claseLock, objetoLock);
        return fila!.n >= 1;
      }, "proceso hijo esperando el advisory lock del ledger", 60_000);
      throw new Error("crash simulado antes del commit");
    }, { timeout: 90_000, maxWait: 10_000 }), /crash simulado/);
    const salida = await hijo!;
    assert.equal(salida.codigo, 0, salida.salida.slice(-2000));
    assert.equal(await prisma.auditLog.count({ where: { registro_id: registroId } }), 0, "el asiento revertido no es visible");
    const ultimo = await prisma.auditLog.findFirstOrThrow({ where: { registro_id: `${prefijo}-0` } });
    const previo = await prisma.auditLog.findFirstOrThrow({
      where: { OR: [{ created_at: { lt: ultimo.created_at } }, { created_at: ultimo.created_at, id: { lt: ultimo.id } }] },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    });
    assert.equal(ultimo.hash_anterior, previo.hash_actual, "el siguiente append encadena con el último asiento confirmado");
    await ledgerIntegro();
  });

  await t.test("AuditLog: una cadena ya bifurcada (base T17 histórica) sigue detectándose como inválida", async () => {
    const urlT17 = DATABASE_URL!.replace(/\/[^/?]+(\?|$)/, "/swat_erp_test_e13_t17$1");
    const existe = await prisma.$queryRawUnsafe<{ n: number }[]>(
      "SELECT count(*)::int n FROM pg_database WHERE datname = 'swat_erp_test_e13_t17'");
    if (existe[0]!.n === 0) {
      t.diagnostic("base T17 histórica ausente: comprobación omitida");
      return;
    }
    const p = await worker({ accion: "verificar-cadena" }, { ...envHijo, DATABASE_URL: urlT17 });
    assert.equal(p.codigo, 0, p.salida.slice(-2000));
    assert.equal(p.resultado!.integra, false, "la bifurcación preexistente no se oculta ni se repara");
  });

  // ── Dos jobs reales (procesos OS) + otro escritor del ledger ───────────────

  await t.test("dos job:reservas concurrentes + otro proceso escritor: vencimientos únicos y ledger íntegro", async () => {
    const pedidos = [await listoVencido([{ cantidad: 2 }, { cantidad: 1 }]), await listoVencido(), await listoVencido()];
    const fiscales = await Promise.all(pedidos.map((c) => f.snapshotFiscal(c.pedido_venta_id)));
    const qrs = await Promise.all(pedidos.map(async (c) => (await extension(c.pedido_venta_id)).codigo_qr_retiro));
    for (const qr of qrs) assert.ok(qr);
    const [j1, j2, escritor] = await Promise.all([
      jobReservas(),
      jobReservas(),
      worker({ accion: "audit", inicio: Date.now() + 3_000, prefijo: `job-smoke-${randomUUID()}`, cantidad: 40 }),
    ]);
    for (const p of [j1!, j2!, escritor!]) assert.equal(p.codigo, 0, p.salida.slice(-3000));
    await f.drenarListeners();
    for (const [i, c] of pedidos.entries()) {
      await f.verificarTerminalCompensado(c, fiscales[i]!, "VENCIDO_SIN_RETIRO");
      const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
      assert.equal(saga.solicitado_por_tipo, "SISTEMA");
      const e = await f.efectos(c);
      assert.equal(e.intentos_iniciales, 1, "un único intento INICIAL");
      assert.equal(e.auditorias_terminales, 1, "un único hecho de vencimiento auditado");
      assert.equal(e.notificaciones_e13, 1, "F3 una sola vez");
      assert.equal(await prisma.notificacion.count({
        where: { tipo_evento: "ecommerce:pedido_vencido_sin_retiro", cuenta_cliente_web_destinatario_id: c.cuenta.cuentaId },
      }), 1);
      assert.equal(await prisma.pedidoVentaEcommerce.count({ where: { codigo_qr_retiro: qrs[i]! } }), 0, "QR consumido");
    }
    await ledgerIntegro();
  });

  // ── Carreras T10/T11: cancelación vs toma ───────────────────────────────────

  await t.test("cliente cancela vs operador toma: un único ganador coherente (5 rondas + solapamiento forzado)", async () => {
    const ganadores = new Set<string>();
    for (let ronda = 0; ronda < 6; ronda++) {
      const c = await compra();
      const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
      const ext = await extension(c.pedido_venta_id);
      const correr = () => Promise.allSettled([cancelarCliente(c), pickPack.tomarPedido(c.pedido_venta_id, operador.id)]);
      // Última ronda: el primer UPDATE de la extensión duerme con los locks tomados; el otro espera sí o sí.
      const resultados = ronda < 5 ? await correr() : await conTrigger(
        `t18_solapar_${ronda}`, "pedidos_venta_ecommerce", "BEFORE UPDATE", `OLD.id = '${ext.id}'`, { dormir_s: 1 }, correr);
      sinDeadlocks(resultados);
      await f.drenarListeners();
      const [cancelacion, toma] = resultados;
      assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1, "exactamente un ganador");
      const final = await extension(c.pedido_venta_id);
      if (cancelacion!.status === "fulfilled") {
        ganadores.add("CANCELADO");
        await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
        assert.equal(final.operador_asignado_id, null, "la toma perdedora no asignó operador");
        assert.equal(codigo(toma!) !== null, true);
      } else {
        ganadores.add("EN_PREPARACION");
        assert.equal(final.estado_ecommerce, "EN_PREPARACION");
        assert.equal(final.operador_asignado_id, operador.id);
        assert.equal(final.is_active, true);
        assert.equal(codigo(cancelacion!), "TRANSICION_INVALIDA");
        assert.equal((await venta(c.pedido_venta_id)).estado, "FACTURADO");
        await sinEfectosHuE13(c);
      }
    }
    t.diagnostic(`ganadores observados: ${[...ganadores].join(", ")}`);
    await ledgerIntegro();
  });

  await t.test("admin cancela vs operador toma: revalida bajo locks, saga única y operador histórico coherente", async () => {
    const ordenes = new Set<string>();
    for (let ronda = 0; ronda < 6; ronda++) {
      const c = await compra();
      const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
      const ext = await extension(c.pedido_venta_id);
      const correr = () => Promise.allSettled([cancelarAdmin(c), pickPack.tomarPedido(c.pedido_venta_id, operador.id)]);
      const resultados = ronda < 5 ? await correr() : await conTrigger(
        `t18_solapar_admin_${ronda}`, "pedidos_venta_ecommerce", "BEFORE UPDATE", `OLD.id = '${ext.id}'`, { dormir_s: 1 }, correr);
      sinDeadlocks(resultados);
      await f.drenarListeners();
      const [cancelacion, toma] = resultados;
      assert.equal(cancelacion!.status, "fulfilled", `el admin siempre puede cancelar: ${codigo(cancelacion!)}`);
      await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
      const final = await extension(c.pedido_venta_id);
      const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { accion: "PEDIDO_PAGADO_CANCELADO", registro_id: saga.id } });
      const estadoAnterior = (audit.valor_anterior as { estado_ecommerce: string }).estado_ecommerce;
      assert.equal(audit.usuario_id, admin.id);
      if (toma!.status === "fulfilled") {
        ordenes.add("toma→cancelación");
        assert.equal(final.operador_asignado_id, operador.id, "operador histórico conservado");
        assert.equal(estadoAnterior, "EN_PREPARACION", "la cancelación leyó el estado ya tomado (sin lectura stale)");
      } else {
        ordenes.add("cancelación→toma");
        assert.equal(final.operador_asignado_id, null);
        assert.equal(estadoAnterior, "PAGO_CONFIRMADO");
      }
    }
    t.diagnostic(`órdenes observados: ${[...ordenes].join(", ")}`);
    await ledgerIntegro();
  });

  // ── E3 vs vencimiento ───────────────────────────────────────────────────────

  async function verificarRetiroOVencimiento(c: Awaited<ReturnType<typeof compra>>, fiscal: Awaited<ReturnType<typeof f.snapshotFiscal>>) {
    await f.drenarListeners();
    const final = await extension(c.pedido_venta_id);
    const b = await venta(c.pedido_venta_id);
    const sagas = await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: c.pedido_venta_id } });
    if (final.estado_ecommerce === "ENTREGADO") {
      assert.equal(b.estado, "CERRADO");
      assert.equal(sagas, 0);
      assert.equal(final.codigo_qr_retiro, null);
      await sinEfectosHuE13(c);
      return "ENTREGADO";
    }
    assert.equal(final.estado_ecommerce, "VENCIDO_SIN_RETIRO");
    await f.verificarTerminalCompensado(c, fiscal, "VENCIDO_SIN_RETIRO");
    return "VENCIDO_SIN_RETIRO";
  }

  await t.test("E3 vs vencimiento: E3 retiene los locks dentro del plazo → ENTREGADO y el job no actúa", async () => {
    const c = await compra();
    await f.prepararHastaListo(c.pedido_venta_id, operador.id);
    await f.avanzarRelojPlazo(c.pedido_venta_id, new Date(Date.now() + 1_000));
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    const ext = await extension(c.pedido_venta_id);
    const resultados = await conTrigger("t18_e3_retiene", "pedidos_venta_ecommerce", "BEFORE UPDATE",
      `OLD.id = '${ext.id}' AND NEW.estado_ecommerce = 'ENTREGADO'`, { dormir_s: 2.5 }, async () => {
        const entrega = retiro.validarYEntregarRetiro({ qr_token: ext.codigo_qr_retiro!, dni: c.dni }, operador.id);
        await f.dormir(1_800); // el plazo ya venció: el job lo selecciona y espera el lock de E3
        const job = mantenimiento.procesarVencimientosRetiroHuE13(new Date());
        return Promise.allSettled([entrega, job]);
      });
    sinDeadlocks(resultados);
    assert.equal(resultados[0]!.status, "fulfilled", codigo(resultados[0]!) ?? "");
    assert.equal(await verificarRetiroOVencimiento(c, fiscal), "ENTREGADO");
    await ledgerIntegro();
  });

  await t.test("E3 vs vencimiento: el vencimiento retiene los locks → VENCIDO y E3 rechaza tras releer", async () => {
    const c = await listoVencido();
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    const ext = await extension(c.pedido_venta_id);
    const resultados = await conTrigger("t18_vencimiento_retiene", "pedidos_venta_ecommerce", "BEFORE UPDATE",
      `OLD.id = '${ext.id}' AND NEW.estado_ecommerce = 'VENCIDO_SIN_RETIRO'`, { dormir_s: 2 }, async () => {
        const job = mantenimiento.procesarVencimientosRetiroHuE13(new Date());
        await f.dormir(500);
        const entrega = retiro.validarYEntregarRetiro({ qr_token: ext.codigo_qr_retiro!, dni: c.dni }, operador.id);
        return Promise.allSettled([job, entrega]);
      });
    sinDeadlocks(resultados);
    assert.equal(resultados[1]!.status, "rejected");
    assert.equal(await verificarRetiroOVencimiento(c, fiscal), "VENCIDO_SIN_RETIRO");
    await ledgerIntegro();
  });

  await t.test("E3 vs vencimiento en el borde del plazo: nunca mezcla (3 rondas libres)", async () => {
    const finales: string[] = [];
    for (const desfase of [-15, 0, 15]) {
      const c = await compra();
      await f.prepararHastaListo(c.pedido_venta_id, operador.id);
      const plazo = new Date(Date.now() + 1_500);
      await f.avanzarRelojPlazo(c.pedido_venta_id, plazo);
      const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
      const ext = await extension(c.pedido_venta_id);
      await f.dormir(Math.max(0, plazo.getTime() + desfase - Date.now()));
      const resultados = await Promise.allSettled([
        retiro.validarYEntregarRetiro({ qr_token: ext.codigo_qr_retiro!, dni: c.dni }, operador.id),
        mantenimiento.procesarVencimientosRetiroHuE13(new Date(plazo.getTime() + 1)),
      ]);
      sinDeadlocks(resultados);
      await f.drenarListeners();
      if ((await extension(c.pedido_venta_id)).estado_ecommerce === "LISTO_PARA_RETIRO") {
        // Ambos declinaron en el borde (E3 tarde y Paso 0 antes de vencer): sin efectos; el job siguiente vence.
        await sinEfectosHuE13(c);
        await mantenimiento.procesarVencimientosRetiroHuE13(new Date());
      }
      finales.push(await verificarRetiroOVencimiento(c, fiscal));
    }
    t.diagnostic(`finales observados: ${finales.join(", ")}`);
    await ledgerIntegro();
  });

  // ── Refund concurrente ──────────────────────────────────────────────────────

  await t.test("dos workers de refund sobre la misma saga: una fila, misma key, a lo sumo un aprobado", async () => {
    const inicial = await compra();
    const inicioInicial = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: inicial.pedido_venta_id, causa: "CANCELACION_ADMIN", usuario_id: admin.id, motivo: "T18 refund concurrente",
    });
    const primeros = await Promise.allSettled([
      refund.continuarRefundPedidoWeb(inicioInicial.reintegro_id),
      refund.continuarRefundPedidoWeb(inicioInicial.reintegro_id),
    ]);
    sinDeadlocks(primeros);
    await f.drenarListeners();
    const intentosIniciales = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: inicioInicial.reintegro_id } });
    assert.equal(intentosIniciales.length, 1);
    assert.equal(intentosIniciales[0]!.estado, "APROBADO");
    assert.equal(new Set(mp.llamadasDe(inicial.payment_id).map((l) => l.idempotency_key)).size, 1);

    const retry = await compra();
    mp.guionar(retry.payment_id, "timeout");
    const inicio = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: retry.pedido_venta_id, causa: "CANCELACION_ADMIN", usuario_id: admin.id, motivo: "T18 retry concurrente",
    });
    assert.equal((await refund.continuarRefundPedidoWeb(inicio.reintegro_id)).resultado, "ERROR_TECNICO");
    const pendiente = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: inicio.reintegro_id } });
    const cabecera = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: inicio.reintegro_id } });
    const elegible = new Date(cabecera.proximo_reintento_at!.getTime() + 1);
    const workers = await Promise.allSettled([
      mantenimiento.procesarRetriesRefundHuE13(elegible),
      mantenimiento.procesarRetriesRefundHuE13(elegible),
    ]);
    sinDeadlocks(workers);
    await f.drenarListeners();
    const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: inicio.reintegro_id } });
    assert.equal(intentos.length, 1, "ningún intento automático nuevo");
    assert.equal(intentos[0]!.id, pendiente.id);
    assert.equal(intentos[0]!.numero, 1);
    assert.equal(intentos[0]!.clave_idempotencia, pendiente.clave_idempotencia);
    assert.ok(intentos.filter((i) => i.estado === "APROBADO").length <= 1);
    const keys = mp.llamadasDe(retry.payment_id).map((l) => l.idempotency_key);
    assert.ok(keys.length >= 2);
    assert.deepEqual([...new Set(keys)], [pendiente.clave_idempotencia], "todas las llamadas F1 con la misma key");
    assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: inicio.reintegro_id } })).estado, "APROBADO");
    await ledgerIntegro();
  });

  // ── Crashes de saga ─────────────────────────────────────────────────────────

  await t.test("crash dentro de Paso 0 (antes del commit): todo o nada", async () => {
    const c = await listoVencido([{ cantidad: 1 }, { cantidad: 2 }]);
    const antes = await extension(c.pedido_venta_id);
    const items = await prisma.pedidoVentaItem.findMany({ where: { pedido_venta_id: c.pedido_venta_id }, select: { id: true } });
    const auditsAntes = await prisma.auditLog.count();
    // Falla la ÚLTIMA hija de stock: transición E, baja lógica, QR y cabecera ya se escribieron dentro de la tx.
    const ultimaHija = [...items].sort((a, b) => a.id.localeCompare(b.id)).at(-1)!.id;
    await conTrigger("t18_crash_paso0", "reintegro_stock_compensaciones", "BEFORE INSERT",
      `NEW.pedido_venta_item_id = '${ultimaHija}'`, "FALLAR",
      () => assert.rejects(() => reintegro.iniciarReintegroPedidoWebPaso0({ pedido_venta_id: c.pedido_venta_id, causa: "VENCIMIENTO" }),
        /T18 fallo inyectado/));
    await f.drenarListeners();
    const despues = await extension(c.pedido_venta_id);
    assert.deepEqual(despues, antes, "estado E, baja lógica y QR intactos");
    assert.equal(despues.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.ok(despues.codigo_qr_retiro);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: c.pedido_venta_id } }), 0, "sin cabecera");
    assert.equal(await prisma.reintegroStockCompensacion.count({ where: { pedido_venta_item_id: { in: items.map((i) => i.id) } } }), 0, "sin hijas");
    assert.equal(await prisma.auditLog.count(), auditsAntes, "sin evento terminal (solo post-commit)");
    // Reintento posterior completo.
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    await mantenimiento.procesarVencimientosRetiroHuE13(new Date());
    await f.drenarListeners();
    await f.verificarTerminalCompensado(c, fiscal, "VENCIDO_SIN_RETIRO");
    await ledgerIntegro();
  });

  await t.test("crash entre Paso 0 y pasos locales: se reanuda sin repetir Paso 0", async () => {
    const c = await compra([{ cantidad: 1 }, { cantidad: 1 }]);
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    const inicio = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: c.pedido_venta_id, causa: "CANCELACION_CLIENTE", cliente_web_cuenta_id: c.cuenta.cuentaId, motivo: "T18 crash post Paso 0",
    });
    await f.drenarListeners();
    // El proceso "muere" aquí: hay intención durable y ningún paso local.
    let e = await f.efectos(c);
    assert.deepEqual([e.sagas, e.notas_credito, e.movimientos_compensacion, e.contra_asientos, e.intentos], [1, 0, 0, 0, 0]);
    const repetido = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: c.pedido_venta_id, causa: "CANCELACION_CLIENTE", cliente_web_cuenta_id: c.cuenta.cuentaId, motivo: "T18 crash post Paso 0",
    });
    assert.equal(repetido.reintegro_id, inicio.reintegro_id);
    await refund.continuarRefundPedidoWeb(inicio.reintegro_id);
    await f.drenarListeners();
    await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
    e = await f.efectos(c);
    assert.equal(e.auditorias_terminales, 1, "Paso 0 no se repitió");
    assert.equal(e.notificaciones_e13, 1);
    await ledgerIntegro();
  });

  await t.test("crashes entre pasos locales A–D: cada reanudación continúa desde la evidencia durable", async () => {
    // A. NC completada, crash antes del stock.
    const a = await compra();
    const fa = await f.snapshotFiscal(a.pedido_venta_id);
    const ia = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: a.pedido_venta_id, causa: "CANCELACION_ADMIN", usuario_id: admin.id, motivo: "T18 crash A",
    });
    await conTrigger("t18_crash_stock", "movimientos_stock", "BEFORE INSERT",
      `NEW.comprobante_referencia LIKE 'HU-E13:STOCK:${a.pedido_venta_id}:%'`, "FALLAR",
      () => assert.rejects(() => reintegro.continuarPasosLocalesReintegroPedidoWeb(ia.reintegro_id)));
    let e = await f.efectos(a);
    assert.deepEqual([e.notas_credito, e.compensaciones_completas, e.contra_asientos], [1, 0, 0]);
    assert.ok((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: ia.reintegro_id } })).nota_credito_id);
    await refund.continuarRefundPedidoWeb(ia.reintegro_id);
    await f.drenarListeners();
    await f.verificarTerminalCompensado(a, fa, "CANCELADO");

    // B. Parte de las líneas de stock completadas.
    const b = await compra([{ cantidad: 1 }, { cantidad: 3 }]);
    const fb = await f.snapshotFiscal(b.pedido_venta_id);
    const ib = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: b.pedido_venta_id, causa: "CANCELACION_ADMIN", usuario_id: admin.id, motivo: "T18 crash B",
    });
    const hijas = await prisma.reintegroStockCompensacion.findMany({
      where: { reintegro_id: ib.reintegro_id }, orderBy: [{ pedido_venta_item_id: "asc" }],
    });
    assert.equal(hijas.length, 2);
    await conTrigger("t18_crash_stock_parcial", "movimientos_stock", "BEFORE INSERT",
      `NEW.comprobante_referencia = '${hijas[1]!.clave_idempotencia}'`, "FALLAR",
      () => assert.rejects(() => reintegro.continuarPasosLocalesReintegroPedidoWeb(ib.reintegro_id)));
    e = await f.efectos(b);
    assert.deepEqual([e.notas_credito, e.compensaciones_completas, e.movimientos_compensacion], [1, 1, 1]);
    const stockPrimera = await f.stockDisponible(hijas[0]!.variante_sku_id, b.deposito_id);
    await refund.continuarRefundPedidoWeb(ib.reintegro_id);
    await f.drenarListeners();
    await f.verificarTerminalCompensado(b, fb, "CANCELADO");
    assert.equal(await f.stockDisponible(hijas[0]!.variante_sku_id, b.deposito_id), stockPrimera, "la línea completa no se re-suma");

    // C. Stock completo, crash antes del contra-asiento G11.
    const c = await compra();
    const fc = await f.snapshotFiscal(c.pedido_venta_id);
    const ic = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: c.pedido_venta_id, causa: "CANCELACION_ADMIN", usuario_id: admin.id, motivo: "T18 crash C",
    });
    await conTrigger("t18_crash_g11", "contra_asientos_ingreso", "BEFORE INSERT",
      `NEW.pedido_venta_id = '${c.pedido_venta_id}'`, "FALLAR",
      () => assert.rejects(() => reintegro.continuarPasosLocalesReintegroPedidoWeb(ic.reintegro_id)));
    e = await f.efectos(c);
    assert.deepEqual([e.notas_credito, e.compensaciones_completas, e.contra_asientos, e.intentos], [1, 1, 0, 0]);
    await refund.continuarRefundPedidoWeb(ic.reintegro_id);
    await f.drenarListeners();
    await f.verificarTerminalCompensado(c, fc, "CANCELADO");

    // D. G11 completo, crash antes de crear el intento refund.
    const d = await compra();
    const fd = await f.snapshotFiscal(d.pedido_venta_id);
    const id = await reintegro.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: d.pedido_venta_id, causa: "CANCELACION_ADMIN", usuario_id: admin.id, motivo: "T18 crash D",
    });
    await conTrigger("t18_crash_intento", "reintegro_refund_intentos", "BEFORE INSERT",
      `NEW.reintegro_id = '${id.reintegro_id}'`, "FALLAR",
      () => assert.rejects(() => refund.continuarRefundPedidoWeb(id.reintegro_id)));
    e = await f.efectos(d);
    assert.deepEqual([e.notas_credito, e.compensaciones_completas, e.contra_asientos, e.intentos], [1, 1, 1, 0]);
    assert.equal(mp.llamadasDe(d.payment_id).length, 0, "sin intento durable no hay llamada F1");
    await refund.continuarRefundPedidoWeb(id.reintegro_id);
    await f.drenarListeners();
    await f.verificarTerminalCompensado(d, fd, "CANCELADO");
    assert.equal((await f.efectos(d)).intentos, 1);
    await ledgerIntegro();
  });

  await t.test("crashes de refund A–C: misma fila, misma key, a lo sumo un refund aprobado", async () => {
    async function sagaLista(motivo: string) {
      const c = await compra();
      const inicio = await reintegro.iniciarReintegroPedidoWebPaso0({
        pedido_venta_id: c.pedido_venta_id, causa: "CANCELACION_ADMIN", usuario_id: admin.id, motivo,
      });
      await reintegro.continuarPasosLocalesReintegroPedidoWeb(inicio.reintegro_id);
      return { c, reintegroId: inicio.reintegro_id };
    }
    const remotos = new Map<string, string>(); // key → refund_id ya creado en "MP"
    const llamadas: string[] = [];
    const aprobar = (paymentId: string, key: string, monto: number) => {
      if (!remotos.has(key)) remotos.set(key, `T18-REF-${randomUUID()}`);
      return { refund_id: remotos.get(key)!, payment_id: paymentId, monto, estado: "APROBADO" as const };
    };
    const montoDe = async (key: string) => (await prisma.reintegroRefundIntento.findUniqueOrThrow({
      where: { clave_idempotencia: key }, select: { reintegro: { select: { monto_total: true } } },
    })).reintegro.monto_total.toNumber();

    // A. Intento confirmado y el proceso muere antes de F1.
    const a = await sagaLista("T18 refund A");
    const preparado = await refund.prepararIntentoRefundAutomatico(a.reintegroId);
    assert.equal(preparado.resultado, "LISTO_PARA_F1");
    const servicioA = refund.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId, key) => { llamadas.push(key); return aprobar(paymentId, key, await montoDe(key)); },
    });
    assert.equal((await servicioA.continuarRefundPedidoWeb(a.reintegroId)).resultado, "APROBADO");
    let intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: a.reintegroId } });
    assert.equal(intentos.length, 1);
    assert.equal(intentos[0]!.clave_idempotencia, preparado.resultado === "LISTO_PARA_F1" ? preparado.clave_idempotencia : "");

    // B. MP aceptó pero la respuesta se perdió (timeout); el retry con la misma key recupera el mismo refund.
    const b = await sagaLista("T18 refund B");
    let primeraB = true;
    const servicioB = refund.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId, key) => {
        llamadas.push(key);
        const remoto = aprobar(paymentId, key, await montoDe(key));
        if (primeraB) {
          primeraB = false;
          throw new ErrorTecnicoMercadoPago("PASARELA_TIMEOUT", "Respuesta perdida", "TIMEOUT");
        }
        return remoto;
      },
    });
    assert.equal((await servicioB.continuarRefundPedidoWeb(b.reintegroId)).resultado, "ERROR_TECNICO");
    assert.equal((await servicioB.continuarRefundPedidoWeb(b.reintegroId)).resultado, "APROBADO");
    intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: b.reintegroId } });
    assert.equal(intentos.length, 1);
    assert.equal(intentos[0]!.intentos_tecnicos, 1);
    assert.equal(intentos[0]!.refund_id, remotos.get(intentos[0]!.clave_idempotencia), "el refund creado antes de perder la respuesta");

    // C. Respuesta APROBADO obtenida pero el proceso cae antes de persistirla.
    const c = await sagaLista("T18 refund C");
    const prepC = await refund.prepararIntentoRefundAutomatico(c.reintegroId);
    assert.equal(prepC.resultado, "LISTO_PARA_F1");
    const intentoC = prepC.resultado === "LISTO_PARA_F1" ? prepC.intento_id : "";
    const llamadasC: string[] = [];
    const servicioC = refund.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId, key) => { llamadasC.push(key); return aprobar(paymentId, key, await montoDe(key)); },
    });
    await conTrigger("t18_crash_persistir", "reintegro_refund_intentos", "BEFORE UPDATE",
      `NEW.id = '${intentoC}' AND NEW.estado = 'APROBADO'`, "FALLAR",
      () => assert.rejects(() => servicioC.continuarRefundPedidoWeb(c.reintegroId)));
    const intermedio = await prisma.reintegroRefundIntento.findUniqueOrThrow({ where: { id: intentoC } });
    assert.equal(intermedio.estado, "PENDIENTE");
    assert.equal(intermedio.refund_id, null);
    assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: c.reintegroId } })).estado, "PENDIENTE");
    assert.equal((await servicioC.continuarRefundPedidoWeb(c.reintegroId)).resultado, "APROBADO");
    const finalC = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: c.reintegroId } });
    assert.equal(finalC.length, 1);
    assert.equal(finalC[0]!.refund_id, remotos.get(finalC[0]!.clave_idempotencia));
    assert.equal(new Set(llamadasC).size, 1, "ambas llamadas F1 con la misma key");
    assert.equal(llamadasC.length, 2);

    for (const s of [a, b, c]) {
      await f.drenarListeners();
      assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: s.reintegroId, estado: "APROBADO" } }), 1);
      const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: s.reintegroId } });
      assert.equal(saga.estado, "APROBADO");
      assert.equal(await prisma.auditLog.count({ where: { accion: "REINTEGRO_APROBADO", registro_id: saga.intento_aprobado_id! } }), 1);
    }
    await ledgerIntegro();
  });

  // ── Reintento manual concurrente entre procesos ─────────────────────────────

  await t.test("dos administradores reintentan a la vez desde procesos distintos: un solo intento manual", async () => {
    for (let ronda = 0; ronda < 2; ronda++) {
      const c = await compra();
      mp.guionar(c.payment_id, "rejected");
      const inicio = await cancelarAdmin(c, `T18 manual ${ronda}`);
      await f.drenarListeners();
      assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: inicio.reintegro_id } })).estado, "RECHAZADO");
      const arranque = Date.now() + 6_000;
      const actores = [{ usuario_id: admin.id, motivo: `Reintento admin 1 ronda ${ronda}` }, { usuario_id: otroAdmin.id, motivo: `Reintento admin 2 ronda ${ronda}` }];
      const procesos = await Promise.all(actores.map((actor) => worker({
        accion: "reintento-manual", inicio: arranque, reintegro_id: inicio.reintegro_id, demora_f1_ms: 1_500, ...actor,
      })));
      for (const p of procesos) assert.equal(p.codigo, 0, p.salida.slice(-3000));
      const salidas = procesos.map((p) => p.resultado!);
      const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: inicio.reintegro_id }, orderBy: { numero: "asc" } });
      assert.equal(intentos.length, 2, `sin tercera fila: ${JSON.stringify(salidas)}`);
      const [rechazado, manual] = intentos;
      assert.equal(rechazado!.estado, "RECHAZADO");
      assert.equal(manual!.origen, "REINTENTO_MANUAL");
      assert.equal(manual!.numero, 2);
      const ganador = actores.find((a) => a.usuario_id === manual!.creado_por_id);
      assert.ok(ganador, "actor ganador congelado");
      assert.equal(manual!.motivo_reintento, ganador!.motivo, "motivo del ganador congelado");
      assert.equal(manual!.estado, "APROBADO");
      assert.ok(salidas.every((s) => s.resultado === "APROBADO" || s.resultado === "APROBADO_EXISTENTE" ||
        s.error === "REINTEGRO_APROBADO"), JSON.stringify(salidas));
      assert.ok(salidas.some((s) => s.intento_reutilizado === false), JSON.stringify(salidas));
      assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: inicio.reintegro_id, estado: "APROBADO" } }), 1);
      const auditManual = await prisma.auditLog.findMany({ where: { accion: "REINTEGRO_REINTENTO_MANUAL", registro_id: manual!.id } });
      assert.equal(auditManual.length, 1);
      assert.equal(auditManual[0]!.usuario_id, ganador!.usuario_id);
      assert.equal(await prisma.auditLog.count({ where: { accion: "REINTEGRO_APROBADO", registro_id: manual!.id } }), 1);
    }
    await ledgerIntegro();
  });

  await t.test("cierre: cadena AuditLog íntegra con el orden total created_at, id", async () => {
    await f.drenarListeners();
    const verificados = await ledgerIntegro();
    t.diagnostic(`verificarCadenaIntegridad: integra=true, ${verificados} registros`);
  });
});
