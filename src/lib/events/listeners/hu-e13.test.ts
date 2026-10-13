import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tipos = readFileSync(new URL("../event-types.ts", import.meta.url), "utf8");
const t07 = readFileSync(new URL("../../services/ecommerce/reintegro-pedido-web.service.ts", import.meta.url), "utf8");
const t08 = readFileSync(new URL("../../services/ecommerce/reintegro-refund.service.ts", import.meta.url), "utf8");
const audit = readFileSync(new URL("./audit-log.listener.ts", import.meta.url), "utf8");
const notificaciones = readFileSync(new URL("./notificacion.listener.ts", import.meta.url), "utf8");

test("DomainEventMap y registro runtime incluyen los cuatro eventos HU-E13", () => {
  for (const evento of [
    "ecommerce:plazo_retiro_por_vencer",
    "ecommerce:pedido_cancelado",
    "ecommerce:pedido_vencido_sin_retiro",
    "ecommerce:reintegro_estado_cambiado",
  ]) {
    assert.equal(tipos.split(`\"${evento}\"`).length - 1, 2, `${evento} debe estar en mapa y registro runtime`);
  }
});

test("Paso 0 publica el terminal solo después de resolver la transacción", () => {
  const transaccion = t07.indexOf("const resultado: InicioReintegroPedidoWebResultado = await prisma.$transaction");
  const publicacion = t07.indexOf("domainEventBus.emit(eventoTerminal.valor.nombre");
  assert.ok(transaccion >= 0 && publicacion > transaccion);
  assert.match(t07.slice(publicacion - 120, publicacion), /if \(eventoTerminal\.valor\)/);
});

test("T08 publica manual y resultado únicamente después de sus commits", () => {
  const commitManual = t08.indexOf("const preparado = await prisma.$transaction");
  const eventoManual = t08.indexOf("if (eventoManual) emitirReintegroSeguro");
  const persistenciaResultado = t08.indexOf("const resultado = await persistirResultado");
  const emisionResultado = t08.indexOf("emitirResultadoSiNuevo(preparado, resultado)", persistenciaResultado);
  assert.ok(commitManual >= 0 && eventoManual > commitManual);
  assert.ok(persistenciaResultado >= 0 && emisionResultado > persistenciaResultado);
});

test("retry técnico no emite nacimiento manual ni resultado financiero", () => {
  const tecnico = t08.slice(t08.indexOf("async function persistirError"), t08.indexOf("function emitirResultadoSiNuevo"));
  assert.doesNotMatch(tecnico, /domainEventBus\.emit|emitirReintegroSeguro/);
  assert.match(t08, /if \(resultado\.resultado !== "APROBADO" && resultado\.resultado !== "RECHAZADO"\) return/);
});

test("listeners HU-E13 usan auditoría central idempotente y claves F3 estables", () => {
  for (const evento of [
    "ecommerce:plazo_retiro_por_vencer",
    "ecommerce:pedido_cancelado",
    "ecommerce:pedido_vencido_sin_retiro",
    "ecommerce:reintegro_estado_cambiado",
  ]) assert.match(audit, new RegExp(`domainEventBus\\.on\\(\"${evento}\"`));
  assert.match(audit, /registrarAuditLogIdempotente/);
  assert.match(audit, /registro_id: payload\.intento_refund_id/);
  assert.match(notificaciones, /clave_origen: p\.clave_origen/);
  assert.match(notificaciones, /clave_origen: p\.reintegro_id/g);
  const huE13F3 = notificaciones.slice(notificaciones.indexOf('evento: "ecommerce:plazo_retiro_por_vencer"'));
  assert.doesNotMatch(huE13F3, /ADMINISTRADOR_ECOMMERCE/);
});

test("F3 HU-E13 post-T17: solo Cliente Web y vencimiento CRITICA", () => {
  const bloque = (evento: string) => {
    const inicio = notificaciones.indexOf(`evento: "${evento}"`);
    assert.ok(inicio >= 0, evento);
    const fin = notificaciones.indexOf("suscripcion({", inicio);
    return notificaciones.slice(inicio, fin < 0 ? notificaciones.indexOf("];", inicio) : fin);
  };
  const prioridades = {
    "ecommerce:plazo_retiro_por_vencer": "ADVERTENCIA",
    "ecommerce:pedido_cancelado": "ADVERTENCIA",
    "ecommerce:pedido_vencido_sin_retiro": "CRITICA",
  } as const;
  for (const [evento, prioridad] of Object.entries(prioridades)) {
    const suscripcion = bloque(evento);
    assert.match(suscripcion, new RegExp(`prioridad_default: "${prioridad}"`), evento);
    assert.match(suscripcion, /destinatarios: \{ cuenta_cliente_web_ids: \[p\.cliente_web_cuenta_id\] \}/, evento);
    assert.doesNotMatch(suscripcion, /roles|usuario_ids/, evento);
  }
});

test("payloads HU-E13 no declaran secretos de pago", () => {
  const huE13 = tipos.slice(tipos.indexOf("export interface EcommercePlazoRetiroPorVencerPayload"), tipos.indexOf("// HU-E3 — retiro validado"));
  for (const prohibido of ["access_token", "authorization", "clave_idempotencia", "datos_tarjeta", "mercadopago_payment_id"]) {
    assert.doesNotMatch(huE13, new RegExp(prohibido, "i"));
  }
});
