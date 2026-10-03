import assert from "node:assert/strict";
import test from "node:test";

const DATABASE_URL = process.env.HU_E8_INTEGRATION_DATABASE_URL;
const PASSWORD = "password-segura";
const errorConCodigo = (codigo: string) => (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === codigo;
const dniAleatorio = () => String(20_000_000 + Math.floor(Math.random() * 9_000_000));
const emailAleatorio = (prefijo: string) => `${prefijo}-${crypto.randomUUID()}@example.test`;
const esperarAuditoria = () => new Promise((resolve) => setTimeout(resolve, 80));

test("HU-E8 — matriz de servicio contra PostgreSQL", { skip: !DATABASE_URL, timeout: 180_000 }, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, servicio, { verificarCadenaIntegridad }] = await Promise.all([
    import("@/lib/db/prisma"), import("./cuenta-cliente-web.service"), import("@/lib/services/auditoria/audit-log.service"),
  ]);
  t.after(async () => prisma.$disconnect());
  const vendedor = await prisma.usuario.findFirstOrThrow({ where: { nombre_usuario: "vendedor.seed", is_active: true }, select: { id: true } });

  async function registrar(prefijo: string, override: Partial<Parameters<typeof servicio.registrarCuentaClienteWeb>[0]> = {}) {
    return servicio.registrarCuentaClienteWeb({ nombre: "Cliente E8", dni: dniAleatorio(), telefono: "3874000000", email: emailAleatorio(prefijo), password: PASSWORD, acepta_tratamiento: true, acepta_comunicaciones: false, ...override });
  }
  async function clienteMostrador(opciones: { activo?: boolean } = {}) {
    const id = crypto.randomUUID();
    const cliente = await prisma.cliente.create({ data: { id, dni: dniAleatorio(), nombre: "Cliente Mostrador", telefono: "3874111111", email: emailAleatorio("mostrador"), is_active: opciones.activo ?? true, ...((opciones.activo ?? true) ? {} : { deleted_at: new Date(), deleted_by: "test", deletion_reason: "fixture inactivo" }) } });
    return cliente;
  }

  await t.test("CA01/02/05 — registro crea Cliente, consentimiento y hash Argon2id", async () => {
    const resultado = await registrar("registro");
    assert.equal(resultado.vinculacion_pendiente, false);
    const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: resultado.cuenta_id } });
    assert.match(cuenta.password_hash, /^\$argon2id\$/); assert.ok(!cuenta.password_hash.includes(PASSWORD));
    assert.equal(await prisma.consentimientoCliente.count({ where: { cliente_id: resultado.cliente_id } }), 1);
  });

  await t.test("CA03 — DNI y email no se reutilizan; conflicto de email revierte el Cliente", async () => {
    const primera = await registrar("unicidad");
    const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: primera.cuenta_id } });
    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: primera.cliente_id } });
    await assert.rejects(() => registrar("otro", { dni: cliente.dni }), errorConCodigo("CUENTA_WEB_YA_EXISTE"));
    const dniRollback = dniAleatorio();
    await assert.rejects(() => registrar("rollback", { dni: dniRollback, email: cuenta.email }), errorConCodigo("REGISTRO_WEB_NO_DISPONIBLE"));
    assert.equal(await prisma.cliente.count({ where: { dni: dniRollback } }), 0);
  });

  await t.test("CA03 concurrencia — dos registros del mismo DNI dejan una cuenta", async () => {
    const dni = dniAleatorio();
    const resultados = await Promise.allSettled([registrar("carrera-a", { dni }), registrar("carrera-b", { dni })]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(resultados.filter((r) => r.status === "rejected" && errorConCodigo("CUENTA_WEB_YA_EXISTE")(r.reason)).length, 1);
    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { dni } });
    assert.equal(await prisma.cuentaClienteWeb.count({ where: { cliente_id: cliente.id } }), 1);
  });

  await t.test("CA04 — Cliente de mostrador queda pendiente sin mutar Cliente ni consentimientos; inactivo rechaza", async () => {
    const cliente = await clienteMostrador();
    const antes = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id }, include: { consentimientos: true } });
    const resultado = await registrar("pendiente", { dni: cliente.dni });
    assert.equal(resultado.vinculacion_pendiente, true);
    const despues = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id }, include: { consentimientos: true } });
    assert.deepEqual(despues, antes);
    const inactivo = await clienteMostrador({ activo: false });
    await assert.rejects(() => registrar("inactivo", { dni: inactivo.dni }), errorConCodigo("REGISTRO_WEB_NO_DISPONIBLE"));
  });

  await t.test("CA06 — éxito reinicia contador; quinto fallo bloquea; vencido permite login", async () => {
    const alta = await registrar("bloqueo"); const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: alta.cuenta_id } });
    for (let i = 0; i < 4; i++) await assert.rejects(() => servicio.autenticarCuentaClienteWeb(cuenta.email, "incorrecta"), errorConCodigo("CREDENCIALES_INVALIDAS"));
    await servicio.autenticarCuentaClienteWeb(cuenta.email, PASSWORD);
    assert.equal((await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } })).intentos_fallidos, 0);
    for (let i = 0; i < 4; i++) await assert.rejects(() => servicio.autenticarCuentaClienteWeb(cuenta.email, "incorrecta"), errorConCodigo("CREDENCIALES_INVALIDAS"));
    await assert.rejects(() => servicio.autenticarCuentaClienteWeb(cuenta.email, "incorrecta"), errorConCodigo("CUENTA_BLOQUEADA"));
    await assert.rejects(() => servicio.autenticarCuentaClienteWeb(cuenta.email, PASSWORD), errorConCodigo("CUENTA_BLOQUEADA"));
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { bloqueada_hasta: new Date(Date.now() - 1000) } });
    await servicio.autenticarCuentaClienteWeb(cuenta.email, PASSWORD);
    const vencido = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } });
    assert.equal(vencido.intentos_fallidos, 0); assert.equal(vencido.bloqueada_hasta, null);
  });

  await t.test("CA06 concurrencia — cinco fallos simultáneos desde cuatro intentos emiten un bloqueo", async () => {
    const alta = await registrar("bloqueo-concurrente");
    const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: alta.cuenta_id } });
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { intentos_fallidos: 4 } });
    const antes = await prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_bloqueada", registro_id: cuenta.id } });
    const resultados = await Promise.allSettled(Array.from({ length: 5 }, () => servicio.autenticarCuentaClienteWeb(cuenta.email, "incorrecta")));
    assert.equal(resultados.filter((r) => r.status === "rejected" && errorConCodigo("CUENTA_BLOQUEADA")(r.reason)).length, 5);
    await esperarAuditoria();
    assert.equal(await prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_bloqueada", registro_id: cuenta.id } }), antes + 1);
  });

  await t.test("§2.8.d.7 — configuración ECOMMERCE_CUENTA_WEB_* faltante o inválida es error operativo, no ServiceError", async () => {
    const alta = await registrar("config"); const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: alta.cuenta_id } });
    const esErrorConfiguracion = (clave: string) => (error: unknown) => error instanceof servicio.ErrorConfiguracionCuentaWeb && !("code" in error) && error.message.includes(clave);
    const max = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_CUENTA_WEB_MAX_INTENTOS" } });
    try {
      await prisma.configuracionSistema.update({ where: { id: max.id }, data: { valor: "abc" } });
      await assert.rejects(() => servicio.autenticarCuentaClienteWeb(cuenta.email, PASSWORD), esErrorConfiguracion(max.clave));
      await assert.rejects(() => servicio.redefinirPasswordCuentaWeb({ email: cuenta.email, codigo: "ABCDEFGH", password: "password-nueva", confirmacion: "password-nueva" }), esErrorConfiguracion(max.clave));
    } finally { await prisma.configuracionSistema.update({ where: { id: max.id }, data: { valor: max.valor } }); }
    const bloqueo = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS" } });
    try {
      await prisma.configuracionSistema.update({ where: { id: bloqueo.id }, data: { clave: `${bloqueo.clave}_TEST_AUSENTE` } });
      await assert.rejects(() => servicio.autenticarCuentaClienteWeb(cuenta.email, "incorrecta"), esErrorConfiguracion(bloqueo.clave));
    } finally { await prisma.configuracionSistema.update({ where: { id: bloqueo.id }, data: { clave: bloqueo.clave } }); }
    assert.equal((await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } })).intentos_fallidos, 0);
    await servicio.autenticarCuentaClienteWeb(cuenta.email, PASSWORD);
  });

  await t.test("CA04/C01 — vinculación reconocida es idempotente; reasignación revoca acceso y emite código", async () => {
    const reconocidoCliente = await clienteMostrador(); const reconocido = await registrar("reconocido", { dni: reconocidoCliente.dni });
    const auditoriasAntes = await prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_vinculada", registro_id: reconocido.cuenta_id } });
    const validaciones = await Promise.all([
      servicio.validarVinculacionCuentaWeb(reconocido.cuenta_id, vendedor.id, { email_reconocido: true }),
      servicio.validarVinculacionCuentaWeb(reconocido.cuenta_id, vendedor.id, { email_reconocido: true }),
    ]);
    assert.ok(validaciones.every((resultado) => resultado.acceso_reasignado === false));
    await esperarAuditoria();
    assert.equal(await prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_vinculada", registro_id: reconocido.cuenta_id } }), auditoriasAntes + 1);

    const terceroCliente = await clienteMostrador(); const tercero = await registrar("tercero", { dni: terceroCliente.dni });
    const emailAnterior = (await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: tercero.cuenta_id } })).email;
    const emailTitular = emailAleatorio("titular");
    const eventosAntes = await Promise.all([
      prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_vinculada", registro_id: tercero.cuenta_id } }),
      prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_recuperacion_habilitada", registro_id: tercero.cuenta_id } }),
    ]);
    const reasignaciones = await Promise.all([
      servicio.validarVinculacionCuentaWeb(tercero.cuenta_id, vendedor.id, { email_reconocido: false, email_titular: emailTitular }),
      servicio.validarVinculacionCuentaWeb(tercero.cuenta_id, vendedor.id, { email_reconocido: false, email_titular: emailTitular }),
    ]);
    assert.equal(reasignaciones.filter((resultado) => resultado.codigo?.length === 8).length, 1);
    assert.equal(reasignaciones.filter((resultado) => !("codigo" in resultado)).length, 1);
    await esperarAuditoria();
    assert.equal(await prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_vinculada", registro_id: tercero.cuenta_id } }), eventosAntes[0] + 1);
    assert.equal(await prisma.auditLog.count({ where: { accion: "ecommerce:cuenta_web_recuperacion_habilitada", registro_id: tercero.cuenta_id } }), eventosAntes[1] + 1);
    const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: tercero.cuenta_id } });
    assert.equal(cuenta.email, emailTitular); assert.equal(cuenta.token_version, 1); assert.ok(cuenta.recuperacion_codigo_digest);
    await assert.rejects(() => servicio.autenticarCuentaClienteWeb(emailAnterior, PASSWORD), errorConCodigo("CREDENCIALES_INVALIDAS"));
  });

  await t.test("CA07 — recuperación: reemplazo, intento, vencimiento, consumo único y token_version", async () => {
    const alta = await registrar("recuperacion"); const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: alta.cuenta_id } });
    const primera = await servicio.habilitarRecuperacionCuentaWeb(cuenta.id, vendedor.id);
    const segunda = await servicio.habilitarRecuperacionCuentaWeb(cuenta.id, vendedor.id);
    await assert.rejects(() => servicio.redefinirPasswordCuentaWeb({ email: cuenta.email, codigo: primera.codigo, password: "password-nueva", confirmacion: "password-nueva" }), errorConCodigo("CODIGO_RECUPERACION_INVALIDO"));
    assert.equal((await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } })).intentos_fallidos, 1);
    const consumos = await Promise.allSettled([0, 1].map(() => servicio.redefinirPasswordCuentaWeb({ email: cuenta.email, codigo: segunda.codigo, password: "password-nueva", confirmacion: "password-nueva" })));
    assert.equal(consumos.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(consumos.filter((r) => r.status === "rejected" && errorConCodigo("CODIGO_RECUPERACION_INVALIDO")(r.reason)).length, 1);
    const consumida = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } });
    assert.equal(consumida.token_version, 1); assert.equal(consumida.recuperacion_codigo_digest, null);
    await assert.rejects(() => servicio.redefinirPasswordCuentaWeb({ email: cuenta.email, codigo: segunda.codigo, password: "otra-password", confirmacion: "otra-password" }), errorConCodigo("CODIGO_RECUPERACION_INVALIDO"));
    const tercera = await servicio.habilitarRecuperacionCuentaWeb(cuenta.id, vendedor.id);
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { recuperacion_expira_en: new Date(Date.now() - 1000) } });
    await assert.rejects(() => servicio.redefinirPasswordCuentaWeb({ email: cuenta.email, codigo: tercera.codigo, password: "otra-password", confirmacion: "otra-password" }), errorConCodigo("CODIGO_RECUPERACION_INVALIDO"));
    const pendienteCliente = await clienteMostrador(); const pendiente = await registrar("rec-pendiente", { dni: pendienteCliente.dni });
    await assert.rejects(() => servicio.habilitarRecuperacionCuentaWeb(pendiente.cuenta_id, vendedor.id), errorConCodigo("CUENTA_VINCULACION_PENDIENTE"));
  });

  await t.test("D2 — código válido sobre cuenta bloqueada responde 423 sin redefinir; con bloqueo vencido redefine", async () => {
    const alta = await registrar("rec-bloqueada"); const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: alta.cuenta_id } });
    const { codigo } = await servicio.habilitarRecuperacionCuentaWeb(cuenta.id, vendedor.id);
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { bloqueada_hasta: new Date(Date.now() + 15 * 60_000) } });
    await assert.rejects(() => servicio.redefinirPasswordCuentaWeb({ email: cuenta.email, codigo, password: "password-nueva", confirmacion: "password-nueva" }), errorConCodigo("CUENTA_BLOQUEADA"));
    const bloqueada = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } });
    assert.equal(bloqueada.password_hash, cuenta.password_hash); assert.equal(bloqueada.token_version, 0); assert.ok(bloqueada.recuperacion_codigo_digest);
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { bloqueada_hasta: new Date(Date.now() - 1000) } });
    await servicio.redefinirPasswordCuentaWeb({ email: cuenta.email, codigo, password: "password-nueva", confirmacion: "password-nueva" });
    const redefinida = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } });
    assert.notEqual(redefinida.password_hash, cuenta.password_hash); assert.equal(redefinida.token_version, 1);
    assert.equal(redefinida.bloqueada_hasta, null); assert.equal(redefinida.recuperacion_codigo_digest, null);
  });

  await t.test("CA10 — baja lógica revoca acceso y conserva Cliente/consentimientos/pedidos", async () => {
    const alta = await registrar("baja"); const cuentaAntes = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: alta.cuenta_id } });
    await servicio.habilitarRecuperacionCuentaWeb(cuentaAntes.id, vendedor.id);
    const clienteAntes = await prisma.cliente.findUniqueOrThrow({ where: { id: alta.cliente_id } });
    const consentimientosAntes = await prisma.consentimientoCliente.count({ where: { cliente_id: alta.cliente_id } });
    const pedidosAntes = await prisma.pedidoVenta.count({ where: { cliente_id: alta.cliente_id } });
    await servicio.darDeBajaCuentaWeb(cuentaAntes.id, { motivo: "Decisión del titular", confirmar: true });
    const cuenta = await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuentaAntes.id } });
    assert.equal(cuenta.is_active, false); assert.ok(cuenta.deleted_at); assert.equal(cuenta.deleted_by, `cuenta_web:${cuenta.id}`); assert.equal(cuenta.deletion_reason, "Decisión del titular");
    assert.equal(cuenta.token_version, cuentaAntes.token_version + 1); assert.equal(cuenta.recuperacion_codigo_digest, null); assert.equal(cuenta.recuperacion_expira_en, null); assert.equal(cuenta.recuperacion_emitida_por_id, null);
    assert.deepEqual(await prisma.cliente.findUniqueOrThrow({ where: { id: alta.cliente_id } }), clienteAntes);
    assert.equal(await prisma.consentimientoCliente.count({ where: { cliente_id: alta.cliente_id } }), consentimientosAntes);
    assert.equal(await prisma.pedidoVenta.count({ where: { cliente_id: alta.cliente_id } }), pedidosAntes);
    await assert.rejects(() => servicio.autenticarCuentaClienteWeb(cuenta.email, PASSWORD), errorConCodigo("CREDENCIALES_INVALIDAS"));
  });

  await t.test("CA11 — las seis transiciones quedan auditadas sin campos secretos", async () => {
    await esperarAuditoria();
    const acciones = ["registrada", "bloqueada", "vinculada", "recuperacion_habilitada", "password_redefinida", "baja"];
    for (const accion of acciones) {
      const asiento = await prisma.auditLog.findFirst({ where: { accion: `ecommerce:cuenta_web_${accion}` }, orderBy: { created_at: "desc" } });
      assert.ok(asiento, accion);
      const serializado = JSON.stringify(asiento);
      assert.doesNotMatch(serializado, /password_hash|recuperacion_codigo_digest|password-segura|password-nueva|"codigo"/i);
    }
  });

  await t.test("CA11 — la cadena SHA-256 completa permanece íntegra", async () => {
    const resultado = await verificarCadenaIntegridad();
    assert.equal(resultado.integra, true, JSON.stringify(resultado));
  });
});
