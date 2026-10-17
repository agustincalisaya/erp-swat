import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Nivel 1 de HU-E6 (source-regex, sin DB) — mismo patrón que
 * `auditoria-ventas.service.test.ts`: `auditoria-pagos.service.ts` y
 * `pago-web.service.ts` importan `server-only`/prisma y no se pueden cargar en
 * Node sin base. El comportamiento real contra datos se verifica en los
 * integration tests de HU-E6.
 */

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const sinComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const servicio = leer("./auditoria-pagos.service.ts");
const pago = leer("./pago-web.service.ts");
const eventoFuente = leer("../../events/event-types.ts");
const rutaGet = leer("../../../app/api/ecommerce/auditoria/pagos/route.ts");
const rutaPost = leer("../../../app/api/ecommerce/auditoria/pagos/solicitar-acceso/route.ts");
const rutaPatch = leer("../../../app/api/ecommerce/auditoria/pagos/solicitar-acceso/[id]/route.ts");
const rutaFacturacion = leer("../../../app/api/ecommerce/auditoria/pagos/[id]/facturacion/route.ts");

/** Bloque de una función del servicio (hasta el próximo separador de sección). */
function bloque(nombre: string): string {
  const inicio = servicio.indexOf(`function ${nombre}(`);
  assert.ok(inicio > -1, `no se encontró ${nombre} en auditoria-pagos.service.ts`);
  const fin = servicio.indexOf("\n// ──", inicio + 10);
  return servicio.slice(inicio, fin === -1 ? undefined : fin);
}

/** Bloque de una función de pago-web.service.ts (hasta el próximo `async function`). */
function funcionPago(nombre: string): string {
  const inicio = pago.indexOf(`async function ${nombre}(`);
  assert.ok(inicio > -1, `no se encontró ${nombre} en pago-web.service.ts`);
  const siguiente = pago.indexOf("\nasync function ", inicio + 10);
  return pago.slice(inicio, siguiente === -1 ? undefined : siguiente);
}

/** Cuerpo de una función `function nombre(` hasta su llave de cierre a columna 0. */
function helperPago(nombre: string): string {
  const inicio = pago.indexOf(`function ${nombre}(`);
  assert.ok(inicio > -1, `no se encontró ${nombre} en pago-web.service.ts`);
  const fin = pago.indexOf("\n}", inicio);
  return pago.slice(inicio, fin === -1 ? undefined : fin + 2);
}

/** Bloque de una interfaz de event-types.ts hasta su llave de cierre. */
function interfaz(nombre: string): string {
  const inicio = eventoFuente.indexOf(`export interface ${nombre} {`);
  assert.ok(inicio > -1, `no se encontró ${nombre} en event-types.ts`);
  const fin = eventoFuente.indexOf("\n}", inicio);
  return eventoFuente.slice(inicio, fin === -1 ? undefined : fin + 2);
}

const resolver = bloque("resolverAccesoLogPagos");
const vigente = bloque("accesoAprobadoVigente");
const obtener = bloque("obtenerLogPagos");
const decryptBloque = bloque("decryptAndAuditBilling");
const facturacionBloque = bloque("obtenerFacturacionPago");
const verificar = bloque("verificarIntegridadLogPagos");

// ── Permisos y gate (R2) ────────────────────────────────────────────────────

test("los permisos coinciden con los códigos sembrados y el orden da precedencia al Auditor", () => {
  assert.match(servicio, /PERMISO_AUDITORIA_LEER_FORENSE = "auditoria:leer_forense"/);
  assert.match(servicio, /PERMISO_SOLICITAR_ACCESO_LOG_PAGOS = "ecommerce:solicitar_acceso_log_pagos"/);
  const seed = leer("../../../../prisma/seed.ts");
  assert.match(seed, /"auditoria:leer_forense"/);
  assert.match(seed, /"ecommerce:solicitar_acceso_log_pagos"/);
  assert.match(seed, /ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS/);

  assert.ok(
    resolver.indexOf("PERMISO_AUDITORIA_LEER_FORENSE") < resolver.indexOf("PERMISO_SOLICITAR_ACCESO_LOG_PAGOS"),
  );
  assert.match(resolver, /PERMISO_AUDITORIA_LEER_FORENSE\)\) return "AUDITOR"/);
});

test("sin ningún permiso → FORBIDDEN; con permiso de solicitud pero sin aprobación → ACCESO_LOG_PAGOS_NO_APROBADO", () => {
  assert.match(resolver, /throw new ServiceError\(\s*"FORBIDDEN"/);
  assert.match(resolver, /throw new ServiceError\(\s*"ACCESO_LOG_PAGOS_NO_APROBADO"/);
  assert.match(resolver, /accesoAprobadoVigente\(usuarioId\)/);
});

test("accesoAprobadoVigente: solo APROBADO, activo y no expirado (expira_en nulo = sin vencimiento)", () => {
  assert.match(vigente, /solicitante_id:\s*usuarioId/);
  assert.match(vigente, /estado:\s*"APROBADO"/);
  assert.match(vigente, /is_active:\s*true/);
  assert.match(vigente, /expira_en:\s*null/);
  assert.match(vigente, /expira_en:\s*\{\s*gt:\s*ahora\s*\}/);
});

// ── Lectura (R2) ────────────────────────────────────────────────────────────

test("obtenerLogPagos corta el gate ANTES de tocar la base", () => {
  const iGate = obtener.indexOf("resolverAccesoLogPagos");
  const iQuery = obtener.indexOf("prisma.transaccionPagoLog");
  assert.ok(iGate > -1 && iQuery > iGate);
});

test("obtenerLogPagos: filtra por estado_pago y por rango con finDeDia, paginado en base", () => {
  assert.match(obtener, /where\.estado_pago = filtros\.estado_pago/);
  assert.match(obtener, /lte:\s*finDeDia\(filtros\.fecha_hasta\)/);
  assert.match(obtener, /skip:\s*\(filtros\.page - 1\) \* filtros\.page_size/);
  assert.match(obtener, /take:\s*filtros\.page_size/);
  assert.equal((obtener.match(/transaccionPagoLog\.findMany/g) ?? []).length, 1);
});

test("finDeDia extiende fecha_hasta a 23:59:59.999 UTC", () => {
  assert.match(servicio, /Date\.UTC\([\s\S]*?23, 59, 59, 999,?\s*\)/);
});

test("respuesta: shape { items, total, page } y NUNCA el campo cifrado", () => {
  assert.match(obtener, /transaccion_id:\s*r\.id/);
  assert.match(obtener, /pedido_venta_id:\s*r\.pedido_venta_ecommerce\.pedido_venta_id/);
  assert.match(obtener, /monto:\s*r\.monto\.toNumber\(\)/);
  assert.match(obtener, /timestamp:\s*r\.created_at/);
  assert.match(obtener, /total,\s*page:\s*filtros\.page/);
  assert.doesNotMatch(obtener, /datos_facturacion_cifrados/);
});

test("W1: obtenerLogPagos devuelve también la mitad forense (AuditLog filtrado) sin romper { items, total, page }", () => {
  assert.match(obtener, /prisma\.auditLog\.findMany\(/);
  assert.match(obtener, /tabla_afectada:\s*TABLA_AUDITORIA_LOG_PAGOS/);
  assert.match(obtener, /auditoria:\s*\{/);
  assert.match(obtener, /auditoria_id:\s*r\.id/);
  assert.match(obtener, /hash_actual:\s*r\.hash_actual/);
  assert.match(servicio, /TABLA_AUDITORIA_LOG_PAGOS = "log_transacciones_pago"/);
  // El shape base sigue presente y en orden.
  assert.match(obtener, /total,\s*page:\s*filtros\.page/);
  // La proyección forense no filtra el json crudo del audit log.
  assert.doesNotMatch(obtener, /valor_(anterior|nuevo):\s*true/);
});

test("el log de lectura es de solo lectura sobre TransaccionPagoLog (sin create/update/delete)", () => {
  assert.doesNotMatch(servicio, /transaccionPagoLog\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(sinComentarios(servicio), /prisma\.[a-zA-Z]+\.delete\(/);
});

// ── Acceso al dato cifrado (R3) ─────────────────────────────────────────────

test("decryptAndAuditBilling: reservado al Auditor, descifra con la capa compartida", () => {
  assert.match(decryptBloque, /usuarioTienePermiso\(auditorId, PERMISO_AUDITORIA_LEER_FORENSE\)/);
  assert.match(decryptBloque, /throw new ServiceError\(\s*"FORBIDDEN"/);
  assert.match(decryptBloque, /decrypt\(\{/);
  assert.doesNotMatch(servicio, /createCipheriv|createDecipheriv/);
});

test("decryptAndAuditBilling emite ecommerce:acceso_dato_cifrado_auditado EXACTAMENTE una vez, sin el valor en claro", () => {
  assert.equal((decryptBloque.match(/domainEventBus\.emit\("ecommerce:acceso_dato_cifrado_auditado"/g) ?? []).length, 1);
  const iPayload = decryptBloque.indexOf("const payload");
  const iEmit = decryptBloque.indexOf("domainEventBus.emit");
  assert.ok(iPayload > -1 && iEmit > iPayload);
  const payloadSeg = decryptBloque.slice(iPayload, iEmit);
  assert.match(payloadSeg, /transaccion_id:\s*transaccionId/);
  assert.match(payloadSeg, /usuario_auditor_id:\s*auditorId/);
  assert.match(payloadSeg, /timestamp:/);
  assert.doesNotMatch(payloadSeg, /claro|datos_facturacion/);
});

test("obtenerFacturacionPago delega en decryptAndAuditBilling con el usuario de la sesión (sin duplicar la emisión)", () => {
  assert.match(facturacionBloque, /decryptAndAuditBilling\(transaccionId,\s*sesion\.userId\)/);
  // No re-emite acá: la emisión única vive en decryptAndAuditBilling.
  assert.doesNotMatch(facturacionBloque, /domainEventBus\.emit/);
  // Nunca loguea nada (mucho menos el valor descifrado).
  assert.doesNotMatch(facturacionBloque, /console\./);
});

test("GET facturacion: solo Auditor (withPermission), id validado, service, 404/403 mapeados, sin prisma", () => {
  assert.match(rutaFacturacion, /export const GET = withPermission\(/);
  assert.match(rutaFacturacion, /PERMISO_AUDITORIA_LEER_FORENSE/);
  assert.match(rutaFacturacion, /TransaccionPagoLogIdSchema\.safeParse/);
  assert.match(rutaFacturacion, /obtenerFacturacionPago\(parsedId\.data, session\)/);
  assert.match(rutaFacturacion, /TRANSACCION_NO_ENCONTRADA:\s*404/);
  assert.match(rutaFacturacion, /FORBIDDEN:\s*403/);
  assert.match(rutaFacturacion, /await \(rawContext as Context\)\.params/);
  assert.doesNotMatch(rutaFacturacion, /@\/lib\/db\/prisma/);
  assert.doesNotMatch(rutaFacturacion, /@\/lib\/crypto\/aes/);
  // El id de la transacción se valida contra el schema UUID dedicado.
  assert.match(leer("../../schemas/ecommerce.schema.ts"), /TransaccionPagoLogIdSchema = z/);
});

// ── Integridad (divergencia Backlog↔spec) ───────────────────────────────────

test("verificarIntegridadLogPagos recorre TODA la cadena y cuenta solo acciones de HU-E6", () => {
  assert.match(verificar, /auditLog\.findMany\(\{\s*orderBy:\s*\{\s*created_at:\s*"asc"\s*\}/);
  assert.doesNotMatch(verificar, /where:/);
  assert.match(verificar, /ACCIONES_LOG_PAGOS\.includes\(registro\.accion\)/);
  assert.match(verificar, /calcularHashEncadenado/);
  assert.match(verificar, /HASH_GENESIS/);
});

// ── R1: log del pago (pago-web.service.ts) ──────────────────────────────────

test("R1: inserta el TransaccionPagoLog cifrado para APROBADO y RECHAZADO, con idempotencia previa", () => {
  const confirmar = funcionPago("confirmarPago");
  const rechazar = funcionPago("rechazarPago");

  assert.match(pago, /import \{ encrypt \} from "@\/lib\/crypto\/aes"/);

  for (const [cuerpo, estado] of [
    [confirmar, "APROBADO"],
    [rechazar, "RECHAZADO"],
  ] as const) {
    assert.match(cuerpo, /tx\.transaccionPagoLog\.create\(\{/);
    assert.match(cuerpo, new RegExp(`estado_pago: "${estado}"`));
    assert.match(cuerpo, /datos_facturacion_cifrados: cifrado\.ciphertext/);
    assert.match(cuerpo, /datos_facturacion_iv: cifrado\.iv/);
    assert.match(cuerpo, /encrypt\(JSON\.stringify\(datosFacturacionParaCifrar\(/);
    // La transición condicionada (idempotencia) precede a la inserción.
    assert.ok(cuerpo.indexOf("updateMany") < cuerpo.indexOf("transaccionPagoLog.create"));
  }
});

test("R1: el evento ecommerce:transaccion_pago_registrada se emite post-COMMIT con el shape de spec §4", () => {
  const confirmar = funcionPago("confirmarPago");
  const rechazar = funcionPago("rechazarPago");

  for (const cuerpo of [confirmar, rechazar]) {
    const iEmit = cuerpo.indexOf('emitirEventoPostCommitSeguroE2("ecommerce:transaccion_pago_registrada"');
    assert.ok(iEmit > -1);
    assert.ok(cuerpo.indexOf("Post-commit") < iEmit, "la emisión debe ser post-COMMIT");
  }
  assert.match(confirmar, /const payloadTransaccion: TransaccionPagoRegistradaPayload = \{/);
  assert.match(confirmar, /transaccion_id:\s*confirmado\.transaccionId/);
  assert.match(rechazar, /const payloadTransaccionRechazo: TransaccionPagoRegistradaPayload = \{/);
  assert.match(rechazar, /estado_pago: "RECHAZADO"/);
});

test("R1: resultado_webhook no incluye datos de tarjeta ni de facturación", () => {
  const resumen = helperPago("resultadoWebhookSeguro");
  assert.match(resumen, /payment_id:\s*pago\.payment_id/);
  assert.doesNotMatch(resumen, /card|tarjeta|cvv|numero_tarjeta|dni|email|telefono|datos_facturacion/i);
});

test("payload del evento: exactamente 5 campos, sin datos sensibles", () => {
  const iface = interfaz("TransaccionPagoRegistradaPayload");
  assert.match(iface, /transaccion_id: string;/);
  assert.match(iface, /pedido_venta_id: string;/);
  assert.match(iface, /monto: number;/);
  // P-R4 (acordado con Rama el 2026-10-08): + "ANOMALIA" para los pagos no aplicados.
  assert.match(iface, /estado_pago: "APROBADO" \| "RECHAZADO" \| "PENDIENTE" \| "ANOMALIA";/);
  assert.match(iface, /mercadopago_payment_id: string;/);
  assert.doesNotMatch(iface, /datos_facturacion|dni|email|telefono|tarjeta|card/i);
});

// ── Rutas (WU6) ─────────────────────────────────────────────────────────────

test("GET: withAuth + schema + service; ambos 403 mapeados; sin prisma ni lógica de negocio", () => {
  assert.match(rutaGet, /export const GET = withAuth\(/);
  assert.match(rutaGet, /ListarLogPagosQuerySchema\.safeParse/);
  assert.match(rutaGet, /obtenerLogPagos\(parsed\.data, session\)/);
  assert.match(rutaGet, /ACCESO_LOG_PAGOS_NO_APROBADO:\s*403/);
  assert.match(rutaGet, /FORBIDDEN:\s*403/);
  assert.doesNotMatch(rutaGet, /@\/lib\/db\/prisma/);
  assert.doesNotMatch(rutaGet, /\$transaction/);
});

test("POST solicitar-acceso: withPermission del permiso de solicitud y 201", () => {
  assert.match(rutaPost, /export const POST = withPermission\(/);
  assert.match(rutaPost, /PERMISO_SOLICITAR_ACCESO_LOG_PAGOS/);
  assert.match(rutaPost, /SolicitarAccesoLogPagosSchema\.safeParse/);
  assert.match(rutaPost, /solicitarAccesoLogPagos\(session\.userId/);
  assert.match(rutaPost, /status: 201/);
});

test("PATCH [id]: gated por auditoria:leer_forense y aprueba la solicitud", () => {
  assert.match(rutaPatch, /export const PATCH = withPermission\(/);
  assert.match(rutaPatch, /PERMISO_AUDITORIA_LEER_FORENSE/);
  assert.match(rutaPatch, /AccesoLogPagosIdSchema\.safeParse/);
  assert.match(rutaPatch, /aprobarAccesoLogPagos\(parsedId\.data, session\.userId\)/);
});
