import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-E13 T17 — integración end-to-end HTTP contra un servidor Next real.
 *
 * Las cancelaciones Cliente Web/Admin y el reintento manual se ejecutan por
 * sus Route Handlers reales (sesión, ownership, RBAC); los estados previos se
 * construyen por el circuito productivo (checkout → pago E2 → toma → scans →
 * completar). El servidor corre con `MP_MODO=simulado`: el refund aprueba si
 * el pago existe en el simulador y se rechaza en forma definitiva si no
 * (`PAGO_NO_ENCONTRADO`), lo que permite el ciclo rechazo → reintento manual.
 *
 * La serialización del ledger AuditLog es en memoria por proceso: entre cada
 * paso del test y cada request se drenan los listeners para no intercalar
 * escrituras de dos procesos.
 *
 * Uso (servidor `next dev` apuntando a la misma base de test):
 *   HU_E13_T17_INTEGRATION_BASE_URL=http://localhost:3117 \
 *   HU_E13_T17_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e13-http
 */
const BASE_URL = process.env.HU_E13_T17_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E13_T17_INTEGRATION_DATABASE_URL;
const PASSWORD_WEB = "hu-e13-t17-password";
const PASSWORD_INTERNO = "abc123456789";

class Jar {
  private readonly cookies = new Map<string, string>();
  absorber(response: Response) {
    for (const linea of response.headers.getSetCookie()) {
      const [par] = linea.split(";");
      const [nombre, ...resto] = par.split("=");
      const valor = resto.join("=");
      if (!valor || /expires=Thu, 01 Jan 1970/i.test(linea)) this.cookies.delete(nombre.trim());
      else this.cookies.set(nombre.trim(), valor);
    }
  }
  header() { return [...this.cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join("; "); }
}

test("HU-E13 T17 HTTP — cancelaciones, reintento manual, E9 y T15 sobre servidor real", {
  skip: !BASE_URL || !DATABASE_URL,
  timeout: 900_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MP_MODO = "simulado";
  process.env.APP_PUBLIC_URL = BASE_URL;
  const f = await import("./hu-e13.test-fixtures.ts");
  f.exigirDbDeTest(DATABASE_URL!);
  const [
    { prisma },
    { hashPassword },
    { guardarPagoSimulado },
    pickPack,
    misPedidos,
    adminPagados,
    retiro,
    auditoria,
    { listenersRegistrados },
  ] = await Promise.all([
    import("../../db/prisma.ts"),
    import("../../auth/password-hash-core.ts"),
    import("../../integraciones/mercadopago/simulador.ts"),
    import("./pick-pack.service.ts"),
    import("./mis-pedidos.service.ts"),
    import("./pedidos-pagados-admin.service.ts"),
    import("./retiro-e3.service.ts"),
    import("../auditoria/audit-log.service.ts"),
    import("../../events/domain-event-bus.ts"),
  ]);
  await listenersRegistrados;
  t.after(async () => {
    await f.drenarListeners();
    await prisma.$disconnect();
  });
  const { hash } = await hashPassword(PASSWORD_WEB);
  const inicioSuite = new Date();
  const administradores = await f.usuariosConRol("ADMINISTRADOR_ECOMMERCE");
  const canalWeb = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "canal.web.sistema" }, select: { id: true } });
  const operador = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "operador.pickpack.seed" }, select: { id: true, email: true } });

  async function llamar(jar: Jar, path: string, method: "GET" | "PATCH" | "POST", body?: unknown) {
    await f.drenarListeners();
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: jar.header() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    jar.absorber(response);
    const texto = await response.text();
    await f.drenarListeners();
    return { status: response.status, texto, body: texto ? JSON.parse(texto) : null };
  }
  async function loginWeb(email: string) {
    const jar = new Jar();
    assert.equal((await llamar(jar, "/api/tienda/cuenta/login", "POST", { email, password: PASSWORD_WEB })).status, 200);
    return jar;
  }
  async function loginInterno(nombreUsuario: string) {
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: nombreUsuario }, select: { id: true, email: true } });
    const jar = new Jar();
    assert.equal((await llamar(jar, "/api/auth/login", "POST", { email: usuario.email, password: PASSWORD_INTERNO })).status, 200);
    return { jar, usuario };
  }
  /** Compra pagada real; `refundAprobable` registra el pago en el simulador MP del servidor. */
  async function compra(opciones: { refundAprobable?: boolean; lineas?: { cantidad: number }[] } = {}) {
    const c = await f.crearCompraPagada({ passwordHash: hash, lineas: opciones.lineas });
    if (opciones.refundAprobable !== false) registrarEnSimulador(c);
    await f.drenarListeners();
    return { ...c, jar: await loginWeb(c.cuenta.email) };
  }
  function registrarEnSimulador(c: { payment_id: string; total: number; pedido_venta_ecommerce_id: string }) {
    guardarPagoSimulado({
      id: c.payment_id,
      status: "approved",
      status_detail: "accredited",
      transaction_amount: c.total,
      currency_id: "ARS",
      external_reference: c.pedido_venta_ecommerce_id,
      date_approved: new Date().toISOString(),
    });
  }
  async function filaAdmin(pedidoVentaId: string) {
    for (let page = 1; ; page++) {
      const pagina = await adminPagados.listarPedidosPagadosAdmin({ page, page_size: 100 });
      const fila = pagina.items.find((item) => item.pedido_venta_id === pedidoVentaId);
      if (fila) return fila;
      if (page * pagina.page_size >= pagina.total) return null;
    }
  }
  async function sagaDe(pedidoVentaId: string) {
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pedidoVentaId } });
    const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: saga.id }, orderBy: { numero: "asc" } });
    return { saga, intentos };
  }
  async function auditorias(registroIds: string[]) {
    return prisma.auditLog.findMany({
      where: {
        registro_id: { in: registroIds },
        accion: { in: ["PEDIDO_PAGADO_CANCELADO", "PEDIDO_VENCIDO_SIN_RETIRO", "REINTEGRO_APROBADO", "REINTEGRO_RECHAZADO", "REINTEGRO_REINTENTO_MANUAL"] },
      },
      orderBy: { created_at: "asc" },
    });
  }
  async function verificarF3SoloCliente(c: Awaited<ReturnType<typeof compra>>) {
    const { saga } = await sagaDe(c.pedido_venta_id);
    assert.equal((await f.efectos(c)).notificaciones_e13, 1, "una notificación F3 al Cliente Web");
    assert.equal(await prisma.notificacion.count({
      where: { clave_idempotencia: { in: administradores.map((id) => f.claveF3("ecommerce:pedido_cancelado", saga.id, id)) } },
    }), 0, "sin F3 HU-E13 al rol ADMINISTRADOR_ECOMMERCE");
    const notificaciones = await prisma.notificacion.findMany({
      where: { cuenta_cliente_web_destinatario_id: c.cuenta.cuentaId, tipo_evento: "ecommerce:pedido_cancelado" },
      select: { asunto: true, cuerpo: true },
    });
    const { intentos } = await sagaDe(c.pedido_venta_id);
    const logs = (await auditorias([saga.id, ...intentos.map((i) => i.id)])).map((a) => [a.valor_anterior, a.valor_nuevo]);
    f.assertSinSecretos(JSON.stringify({ notificaciones, logs }), c, intentos.flatMap((i) => [i.clave_idempotencia, i.refund_id ?? ""]));
  }

  const admin = await loginInterno("admin.ecommerce.seed");
  const operadorSesion = await loginInterno("operador.pickpack.seed");
  assert.equal(operadorSesion.usuario.id, operador.id);
  const rutaCliente = (id: string) => `/api/tienda/mis-pedidos/${id}/cancelar`;
  const rutaAdmin = (id: string) => `/api/ecommerce/pedidos/${id}/cancelar`;
  const rutaRetry = (id: string) => `/api/ecommerce/pedidos/${id}/reintegro/reintentar`;
  const cancelados: Awaited<ReturnType<typeof compra>>[] = [];

  await t.test("Cliente Web: PATCH propio PAGO_CONFIRMADO → CANCELADO con saga completa, F3 y E9 histórico", async () => {
    const c = await compra();
    const ajeno = await compra();
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    assert.equal((await llamar(new Jar(), rutaCliente(c.pedido_venta_id), "PATCH", { motivo: "Sin sesión" })).status, 401);
    assert.equal((await llamar(ajeno.jar, rutaCliente(c.pedido_venta_id), "PATCH", { motivo: "Ajeno" })).status, 404);
    assert.equal((await llamar(c.jar, rutaCliente(c.pedido_venta_id), "PATCH", { motivo: "  " })).status, 400);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: c.pedido_venta_id } }), 0);

    const respuesta = await llamar(c.jar, rutaCliente(c.pedido_venta_id), "PATCH", { motivo: "Ya no lo necesito" });
    assert.equal(respuesta.status, 200);
    assert.deepEqual(respuesta.body, {
      data: { pedido_venta_id: c.pedido_venta_id, estado_ecommerce: "CANCELADO", reintegro_iniciado: true },
      error: null,
    });
    await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
    const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
    assert.equal(ext.deleted_by, canalWeb.id);
    assert.equal(ext.deletion_reason, "Ya no lo necesito");
    assert.equal(ext.operador_asignado_id, null);
    const { saga, intentos } = await sagaDe(c.pedido_venta_id);
    assert.equal(saga.solicitado_por_tipo, "CLIENTE_WEB");
    assert.equal(saga.solicitado_por_id, null);
    assert.equal(saga.estado, "APROBADO");
    assert.equal(intentos.length, 1);
    assert.equal(intentos[0]!.origen, "INICIAL");
    assert.equal(intentos[0]!.estado, "APROBADO");
    assert.equal(saga.intento_aprobado_id, intentos[0]!.id);
    assert.equal(saga.proximo_reintento_at, null);
    const logs = await auditorias([saga.id, intentos[0]!.id]);
    assert.deepEqual(logs.map((a) => [a.accion, a.usuario_id]), [["PEDIDO_PAGADO_CANCELADO", null], ["REINTEGRO_APROBADO", null]]);
    assert.equal((logs[0]!.valor_nuevo as { actor_tipo: string }).actor_tipo, "CLIENTE_WEB");
    await verificarF3SoloCliente(c);
    f.assertSinSecretos(respuesta.texto, c, [saga.id, intentos[0]!.clave_idempotencia, intentos[0]!.refund_id!]);

    const listado = await llamar(c.jar, "/api/tienda/mis-pedidos", "GET");
    assert.equal(listado.status, 200);
    assert.equal(listado.body.data.pedidos.find((p: { id: string }) => p.id === c.pedido_venta_id)?.estado, "CANCELADO");
    const detalle = await llamar(c.jar, `/api/tienda/mis-pedidos/${c.pedido_venta_id}`, "GET");
    assert.equal(detalle.status, 200);
    assert.equal(detalle.body.data.estado, "CANCELADO");
    assert.equal(detalle.body.data.qr_data_url, null);
    f.assertSinSecretos(listado.texto + detalle.texto, c, [saga.id, intentos[0]!.clave_idempotencia, intentos[0]!.refund_id!]);
    // Post-T17 (SPEC §2.13.16): motivo, fecha, estado agregado, factura original y NC separada.
    await f.verificarE9Terminal(detalle.body.data, c, { estado: "CANCELADO", motivo: "Ya no lo necesito", reintegro_estado: "APROBADO" });
    assert.equal((await llamar(ajeno.jar, `/api/tienda/mis-pedidos/${c.pedido_venta_id}`, "GET")).status, 404);
    const listadoAjeno = await llamar(ajeno.jar, "/api/tienda/mis-pedidos", "GET");
    assert.equal(listadoAjeno.body.data.pedidos.some((p: { id: string }) => p.id === c.pedido_venta_id), false);

    const antes = await f.efectos(c);
    const repetida = await llamar(c.jar, rutaCliente(c.pedido_venta_id), "PATCH", { motivo: "Ya no lo necesito" });
    assert.equal(repetida.status, 200);
    assert.deepEqual(repetida.body, respuesta.body);
    assert.deepEqual(await f.efectos(c), antes, "repetición idempotente sin efectos nuevos");
    assert.deepEqual(await filaAdmin(c.pedido_venta_id).then((fila) => [fila?.estado_ecommerce, fila?.reintegro, fila?.acciones]), [
      "CANCELADO",
      { estado: "APROBADO", tiene_intento_pendiente: false },
      { cancelar_pedido: false, reintentar_reintegro: false },
    ]);
    cancelados.push(c);
  });

  await t.test("Cliente Web: un pedido ya tomado (EN_PREPARACION) responde 409 sin saga", async () => {
    const c = await compra();
    await pickPack.tomarPedido(c.pedido_venta_id, operador.id);
    const respuesta = await llamar(c.jar, rutaCliente(c.pedido_venta_id), "PATCH", { motivo: "Tarde" });
    assert.equal(respuesta.status, 409);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: c.pedido_venta_id } }), 0);
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } })).estado_ecommerce, "EN_PREPARACION");
  });

  await t.test("Admin: PAGO_CONFIRMADO con permiso exacto, actor de sesión y motivo; T15 actualizada", async () => {
    const c = await compra();
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    assert.deepEqual((await filaAdmin(c.pedido_venta_id))?.acciones, { cancelar_pedido: true, reintentar_reintegro: false });
    assert.equal((await llamar(operadorSesion.jar, rutaAdmin(c.pedido_venta_id), "PATCH", { motivo: "Sin permiso" })).status, 403);
    const respuesta = await llamar(admin.jar, rutaAdmin(c.pedido_venta_id), "PATCH", { motivo: "Falta de stock físico" });
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.data.estado_ecommerce, "CANCELADO");
    await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
    const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
    assert.equal(ext.deleted_by, admin.usuario.id);
    assert.equal(ext.deletion_reason, "Falta de stock físico");
    const { saga, intentos } = await sagaDe(c.pedido_venta_id);
    assert.equal(saga.solicitado_por_tipo, "USUARIO");
    assert.equal(saga.solicitado_por_id, admin.usuario.id);
    assert.equal(saga.motivo, "Falta de stock físico");
    assert.equal(saga.estado, "APROBADO");
    const logs = await auditorias([saga.id, intentos[0]!.id]);
    assert.deepEqual(logs.map((a) => [a.accion, a.usuario_id]), [["PEDIDO_PAGADO_CANCELADO", admin.usuario.id], ["REINTEGRO_APROBADO", null]]);
    await verificarF3SoloCliente(c);
    assert.deepEqual((await filaAdmin(c.pedido_venta_id))?.acciones, { cancelar_pedido: false, reintentar_reintegro: false });
    const pagina = await fetch(`${BASE_URL}/ecommerce/pedidos/pagados`, { headers: { cookie: admin.jar.header() }, redirect: "manual" });
    const html = await pagina.text();
    await f.drenarListeners();
    assert.equal(pagina.status, 200);
    assert.ok(html.includes(c.numero_venta), "la pantalla T15 refleja el pedido cancelado");
    f.assertSinSecretos(html, c, [intentos[0]!.clave_idempotencia, intentos[0]!.refund_id!]);
    cancelados.push(c);
  });

  await t.test("Admin: EN_PREPARACION creado por toma real; conserva operador y scans; efectos y refund una vez", async () => {
    const c = await compra({ lineas: [{ cantidad: 2 }] });
    await pickPack.tomarPedido(c.pedido_venta_id, operador.id);
    await pickPack.confirmarItem(c.pedido_venta_id, operador.id, { scan_id: crypto.randomUUID(), codigo: c.articulos[0]!.sku });
    await f.drenarListeners();
    const scansAntes = await prisma.pedidoPreparacionEscaneo.findMany({ where: { pedido_venta_item: { pedido_venta_id: c.pedido_venta_id } } });
    assert.equal(scansAntes.length, 1);
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    assert.equal((await filaAdmin(c.pedido_venta_id))?.acciones.cancelar_pedido, true);
    const respuesta = await llamar(admin.jar, rutaAdmin(c.pedido_venta_id), "PATCH", { motivo: "Cliente pidió anular" });
    assert.equal(respuesta.status, 200);
    await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
    const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
    assert.equal(ext.operador_asignado_id, operador.id, "operador histórico preservado");
    assert.deepEqual(
      await prisma.pedidoPreparacionEscaneo.findMany({ where: { pedido_venta_item: { pedido_venta_id: c.pedido_venta_id } } }),
      scansAntes,
      "no se inventan ni limpian scans",
    );
    const { intentos } = await sagaDe(c.pedido_venta_id);
    assert.equal(intentos.length, 1);
    assert.equal(intentos[0]!.estado, "APROBADO");
    await assert.rejects(() => pickPack.confirmarItem(c.pedido_venta_id, operador.id, { scan_id: crypto.randomUUID(), codigo: c.articulos[0]!.sku }));
    await assert.rejects(() => pickPack.tomarPedido(c.pedido_venta_id, operador.id));
    await f.drenarListeners();
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } })).estado_ecommerce, "CANCELADO");
    await verificarF3SoloCliente(c);
    cancelados.push(c);
  });

  await t.test("Admin: LISTO_PARA_RETIRO por preparación real → QR consumido y ya no retirable", async () => {
    const c = await compra();
    await f.prepararHastaListo(c.pedido_venta_id, operador.id);
    await f.drenarListeners();
    const qr = (await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } })).codigo_qr_retiro!;
    assert.ok(qr);
    assert.equal((await filaAdmin(c.pedido_venta_id))?.acciones.cancelar_pedido, true);
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    const respuesta = await llamar(admin.jar, rutaAdmin(c.pedido_venta_id), "PATCH", { motivo: "No se retirará" });
    assert.equal(respuesta.status, 200);
    await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
    await assert.rejects(() => retiro.validarYEntregarRetiro({ qr_token: qr, dni: c.dni }, operador.id),
      (error: unknown) => error instanceof retiro.RetiroRechazadoError);
    await f.drenarListeners();
    assert.equal((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: c.pedido_venta_id } })).estado, "FACTURADO");
    const detalle = await llamar(c.jar, `/api/tienda/mis-pedidos/${c.pedido_venta_id}`, "GET");
    assert.equal(detalle.body.data.estado, "CANCELADO");
    assert.equal(detalle.body.data.qr_data_url, null);
    f.assertSinSecretos(detalle.texto, c, [qr]);
    await f.verificarE9Terminal(detalle.body.data, c, { estado: "CANCELADO", motivo: "No se retirará", reintegro_estado: "APROBADO" });
    await verificarF3SoloCliente(c);
    cancelados.push(c);
  });

  await t.test("refund RECHAZADO → T15 ofrece reintento → POST manual crea intento nuevo con key nueva y conserva el rechazado", async () => {
    const c = await compra({ refundAprobable: false });
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    assert.equal((await llamar(admin.jar, rutaAdmin(c.pedido_venta_id), "PATCH", { motivo: "Pago observado" })).status, 200);
    await f.verificarTerminalCompensado(c, fiscal, "CANCELADO");
    let { saga, intentos } = await sagaDe(c.pedido_venta_id);
    assert.equal(saga.estado, "RECHAZADO");
    assert.equal(intentos.length, 1);
    const rechazado = intentos[0]!;
    assert.equal(rechazado.estado, "RECHAZADO");
    assert.deepEqual((await filaAdmin(c.pedido_venta_id))?.reintegro, { estado: "RECHAZADO", tiene_intento_pendiente: false });
    assert.deepEqual((await filaAdmin(c.pedido_venta_id))?.acciones, { cancelar_pedido: false, reintentar_reintegro: true });
    const e9Rechazado = await llamar(c.jar, `/api/tienda/mis-pedidos/${c.pedido_venta_id}`, "GET");
    assert.equal(e9Rechazado.status, 200);
    await f.verificarE9Terminal(e9Rechazado.body.data, c, { estado: "CANCELADO", motivo: "Pago observado", reintegro_estado: "RECHAZADO" });
    f.assertSinSecretos(e9Rechazado.texto, c, [saga.id, rechazado.id, rechazado.clave_idempotencia, rechazado.refund_id ?? c.payment_id]);

    assert.equal((await llamar(operadorSesion.jar, rutaRetry(c.pedido_venta_id), "POST", { motivo: "Sin permiso" })).status, 403);
    assert.equal((await llamar(admin.jar, rutaRetry(c.pedido_venta_id), "POST", { motivo: " " })).status, 400);
    registrarEnSimulador(c);
    const reintento = await llamar(admin.jar, rutaRetry(c.pedido_venta_id), "POST", { motivo: "MP confirmó saldo disponible" });
    assert.equal(reintento.status, 200);
    assert.equal(reintento.body.data.resultado, "APROBADO");
    assert.equal(reintento.body.data.intento_reutilizado, false);
    ({ saga, intentos } = await sagaDe(c.pedido_venta_id));
    assert.equal(intentos.length, 2);
    assert.deepEqual(intentos[0], rechazado, "el intento rechazado conserva su evidencia");
    const manual = intentos[1]!;
    assert.equal(manual.origen, "REINTENTO_MANUAL");
    assert.equal(manual.numero, 2);
    assert.equal(manual.clave_idempotencia, `HU-E13:REFUND:${c.pedido_venta_id}:${c.payment_id}:2`);
    assert.notEqual(manual.clave_idempotencia, rechazado.clave_idempotencia);
    assert.equal(manual.creado_por_id, admin.usuario.id);
    assert.equal(manual.motivo_reintento, "MP confirmó saldo disponible");
    assert.equal(manual.estado, "APROBADO");
    assert.equal(saga.estado, "APROBADO");
    assert.equal(saga.intento_aprobado_id, manual.id);
    assert.equal(saga.proximo_reintento_at, null);
    f.assertSinSecretos(reintento.texto, c, [rechazado.clave_idempotencia, manual.clave_idempotencia, manual.refund_id!]);
    const logs = await auditorias([rechazado.id, manual.id]);
    assert.deepEqual(logs.map((a) => [a.accion, a.registro_id, a.usuario_id]), [
      ["REINTEGRO_RECHAZADO", rechazado.id, null],
      ["REINTEGRO_REINTENTO_MANUAL", manual.id, admin.usuario.id],
      ["REINTEGRO_APROBADO", manual.id, null],
    ]);
    assert.deepEqual((await filaAdmin(c.pedido_venta_id))?.acciones, { cancelar_pedido: false, reintentar_reintegro: false });
    const e9Aprobado = await llamar(c.jar, `/api/tienda/mis-pedidos/${c.pedido_venta_id}`, "GET");
    await f.verificarE9Terminal(e9Aprobado.body.data, c, { estado: "CANCELADO", motivo: "Pago observado", reintegro_estado: "APROBADO" });
    f.assertSinSecretos(e9Aprobado.texto, c, [
      "MP confirmó saldo disponible", admin.usuario.id, rechazado.id, manual.id, manual.clave_idempotencia, manual.refund_id!,
    ]);
    const tras = await llamar(admin.jar, rutaRetry(c.pedido_venta_id), "POST", { motivo: "Otro más" });
    assert.equal(tras.status, 409);
    assert.equal(tras.body.error.code, "REINTEGRO_APROBADO");
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: saga.id } }), 2);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: saga.id, estado: "APROBADO" } }), 1);
    await verificarF3SoloCliente(c);
    cancelados.push(c);
  });

  await t.test("legacy sin TransaccionPagoLog: cancelación admin permitida; evidencia contradictoria responde 409 sin efectos", async () => {
    for (const estado of ["PAGO_CONFIRMADO", "EN_PREPARACION"] as const) {
      const legacy = await f.crearPedidoLegacy({ estado, operadorId: operador.id, cuenta: await f.crearCuenta(hash) });
      registrarEnSimulador(legacy);
      const fiscal = await f.snapshotFiscal(legacy.pedido_venta_id);
      const medios = await prisma.ventaMedioPago.findMany({ where: { pedido_venta_id: legacy.pedido_venta_id } });
      const ingreso = await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { pedido_venta_id: legacy.pedido_venta_id } });
      assert.equal((await llamar(admin.jar, rutaAdmin(legacy.pedido_venta_id), "PATCH", { motivo: `Legacy ${estado}` })).status, 200);
      await f.verificarTerminalCompensado(legacy, fiscal, "CANCELADO");
      assert.equal((await f.efectos(legacy)).transacciones_pago, 0, "no se crea TransaccionPagoLog retroactivo");
      assert.deepEqual(await prisma.ventaMedioPago.findMany({ where: { pedido_venta_id: legacy.pedido_venta_id } }), medios);
      assert.deepEqual(await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { pedido_venta_id: legacy.pedido_venta_id } }), ingreso);
      assert.equal((await sagaDe(legacy.pedido_venta_id)).saga.estado, "APROBADO");
    }

    const contradictorio = await f.crearPedidoLegacy({ estado: "EN_PREPARACION", operadorId: operador.id, contradictorio: true });
    registrarEnSimulador(contradictorio);
    const extAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: contradictorio.pedido_venta_id } });
    const respuesta = await llamar(admin.jar, rutaAdmin(contradictorio.pedido_venta_id), "PATCH", { motivo: "Contradictorio" });
    assert.equal(respuesta.status, 409);
    assert.equal(respuesta.body.error.code, "EVIDENCIA_PAGO_INCONSISTENTE");
    assert.deepEqual(await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: contradictorio.pedido_venta_id } }), extAntes);
    const e = await f.efectos(contradictorio);
    assert.deepEqual([e.sagas, e.notas_credito, e.movimientos_compensacion, e.contra_asientos, e.intentos], [0, 0, 0, 0, 0]);
    assert.equal(await f.stockDisponible(contradictorio.articulos[0]!.variante_sku_id, contradictorio.deposito_id), 9);
  });

  await t.test("E9: ANULADO legacy sigue fuera del historial; terminales HU-E13 solo para su dueño", async () => {
    const anulado = await prisma.pedidoVenta.findFirst({
      where: { canal: "WEB", ecommerce: { is: { estado_ecommerce: "ANULADO" } } },
      select: { id: true, cliente_id: true },
    });
    if (anulado?.cliente_id) {
      const listado = await misPedidos.listarPedidosWebCliente(anulado.cliente_id, { porPagina: 50 });
      assert.equal(listado.pedidos.some((p) => p.id === anulado.id), false);
      await assert.rejects(() => misPedidos.obtenerPedidoWebCliente(anulado.cliente_id!, anulado.id));
    }
    for (const c of cancelados) {
      const detalle = await misPedidos.obtenerPedidoWebCliente(c.cuenta.clienteId, c.pedido_venta_id);
      assert.equal(detalle.estado, "CANCELADO");
      assert.equal(detalle.qr_data_url, null);
      const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
      assert.equal(ext.is_active, false);
      assert.ok(ext.deleted_at);
    }
  });

  await t.test("invariantes globales, F3 solo Cliente Web y cadena AuditLog SHA-256 íntegra", async () => {
    await f.drenarListeners(800);
    for (const c of cancelados) {
      const e = await f.efectos(c);
      assert.deepEqual(
        [e.sagas, e.notas_credito, e.originales, e.contra_asientos, e.intentos_iniciales, e.intentos_aprobados, e.notificaciones_e13, e.auditorias_terminales],
        [1, 1, 1, 1, 1, 1, 1, 1],
      );
      assert.equal(e.movimientos_compensacion, c.articulos.length);
      const venta = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: c.pedido_venta_id } });
      assert.equal(venta.estado, "FACTURADO");
      assert.equal(venta.is_active, true);
      assert.equal(venta.cliente_id, c.cuenta.clienteId);
    }
    assert.equal(await prisma.notificacion.count({
      where: { created_at: { gte: inicioSuite }, tipo_evento: { in: [...f.EVENTOS_F3_HU_E13] }, usuario_destinatario_id: { not: null } },
    }), 0);
    const cadena = await auditoria.verificarCadenaIntegridad();
    assert.equal(cadena.integra, true, JSON.stringify(cadena));
  });
});
