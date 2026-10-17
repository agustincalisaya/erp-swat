import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";

const base = process.env.HU_C4_INTEGRATION_BASE_URL;
const url = process.env.HU_C4_INTEGRATION_DATABASE_URL;
type Db = typeof import("../../db/prisma.ts").prisma;

async function esperarAsientosC4(db: Db, eventoIds: string[]) {
  const limite = Date.now() + 6_000;
  while (Date.now() < limite) {
    const filas = await db.auditLog.findMany({
      where: { tabla_afectada: "eventos_consentimiento_cliente", registro_id: { in: eventoIds } },
    });
    if (filas.length >= eventoIds.length) {
      assert.equal(filas.length, eventoIds.length);
      return filas;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("No se observaron los asientos C4 persistidos dentro del límite");
}

async function cookieExistente(db: Db, email: string): Promise<string> {
  assert.match(process.env.JWT_SECRET ?? "", /^[0-9a-fA-F]{64}$/, "Se requiere el secreto de la aplicación de prueba");
  const usuario = await db.usuario.findUniqueOrThrow({ where: { email } });
  const sesion = await db.sesion.findFirst({
    where: { usuario_id: usuario.id, revocada: false, expira_en: { gt: new Date() } },
    orderBy: { expira_en: "desc" },
  });
  assert.ok(sesion, `Se requiere una sesión vigente preexistente para ${email}`);
  const { firmarSesionJwt } = await import("../../auth/jwt.ts");
  return `swat_session=${await firmarSesionJwt({ usuarioId: usuario.id, jti: sesion.jwt_id }, sesion.expira_en)}`;
}

test("HU-C4 POST y ficha HTTP con RBAC", { skip: !base || !url, timeout: 60_000 }, async (t) => {
  const destino = new URL(url!);
  assert.equal(destino.hostname, "127.0.0.1");
  assert.equal(destino.port, "55434");
  assert.equal(destino.pathname, "/hu_c4_validate_20260921_4d7e2a");
  assert.equal(destino.search, "");
  assert.equal(process.env.DATABASE_URL, url);
  const { prisma } = await import("../../db/prisma.ts");
  t.after(() => prisma.$disconnect());
  const identidad = await prisma.$queryRaw<{ base: string; cluster: bigint }[]>`
    SELECT current_database() AS base, (pg_control_system()).system_identifier AS cluster
  `;
  assert.equal(identidad[0]?.base, "hu_c4_validate_20260921_4d7e2a");
  assert.equal(String(identidad[0]?.cluster), "7687955598197395495");
  const cliente = await prisma.cliente.create({ data: {
    dni: String(randomInt(10_000_000, 99_999_999)), nombre: `C4 HTTP ${randomUUID()}`,
  } });
  const endpoint = `${base}/api/clientes/${cliente.id}/consentimientos`;
  const payload = { alcance: "COMUNICACIONES_COMERCIALES", decision: "RECHAZA" };
  const post = (cookie?: string, body: unknown = payload) => fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await post()).status, 401);
  const auditor = await cookieExistente(prisma, "auditor.seed@erp-swat.local");
  assert.equal((await post(auditor)).status, 403);
  const vendedor = await cookieExistente(prisma, "vendedor.seed@erp-swat.local");
  for (const invalido of [
    { alcance: "AMBOS", decision: "ACEPTA" },
    { alcance: "VENTA_ASISTIDA", decision: "RECHAZA" },
    { alcance: "COMUNICACIONES_COMERCIALES" },
  ]) assert.equal((await post(vendedor, invalido)).status, 400);
  const guardado = await post(vendedor);
  assert.equal(guardado.status, 201, JSON.stringify(await guardado.clone().json()));
  const guardadoData = (await guardado.json()).data;
  assert.equal(guardadoData.estado, "RECHAZADO");
  const [asientoRegularizacion] = await esperarAsientosC4(prisma, [guardadoData.evento_id]);
  assert.equal((asientoRegularizacion.valor_nuevo as Record<string, unknown>).contexto, "REGULARIZACION");
  const repetido = await post(vendedor);
  assert.equal(repetido.status, 409);
  assert.equal((await repetido.json()).error.code, "CONSENTIMIENTO_CONFLICTO");
  assert.equal(await prisma.eventoConsentimientoCliente.count({ where: { cliente_id: cliente.id } }), 1);
  const ficha = await fetch(`${base}/clientes/${cliente.id}`, { headers: { Cookie: vendedor }, redirect: "manual" });
  assert.equal(ficha.status, 200);
  const html = await ficha.text();
  assert.match(html, /Consentimientos/);
  assert.match(html, /Rechazado/);
  assert.match(html, /Pendiente de regularización/);
  const ausente = await fetch(`${base}/api/clientes/${randomUUID()}/consentimientos`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: vendedor }, body: JSON.stringify(payload),
  });
  assert.equal(ausente.status, 404);
  const inactivo = await prisma.cliente.create({ data: {
    dni: String(randomInt(10_000_000, 99_999_999)), nombre: `C4 HTTP inactivo ${randomUUID()}`, is_active: false,
  } });
  const respuestaInactivo = await fetch(`${base}/api/clientes/${inactivo.id}/consentimientos`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: vendedor }, body: JSON.stringify(payload),
  });
  assert.equal(respuestaInactivo.status, 404);
});

test("HU-C4 etapa 3: POST de transiciones y ficha con roles reales", {
  skip: !base || !url, timeout: 90_000,
}, async (t) => {
  const destino = new URL(url!);
  assert.equal(destino.hostname, "127.0.0.1");
  assert.equal(destino.port, "55434");
  assert.equal(destino.pathname, "/hu_c4_validate_20260921_4d7e2a");
  assert.equal(destino.search, "");
  assert.equal(process.env.DATABASE_URL, url);
  const { prisma } = await import("../../db/prisma.ts");
  const identidad = await prisma.$queryRaw<{ base: string; cluster: bigint }[]>`
    SELECT current_database() AS base, (pg_control_system()).system_identifier AS cluster
  `;
  assert.equal(identidad[0]?.base, "hu_c4_validate_20260921_4d7e2a");
  assert.equal(String(identidad[0]?.cluster), "7687955598197395495");
  const vendedor = await prisma.usuario.findUniqueOrThrow({ where: { email: "vendedor.seed@erp-swat.local" } });
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: "admin.seed@erp-swat.local" } });
  const sufijo = randomUUID();
  t.after(() => prisma.$disconnect());
  const cliente = await prisma.cliente.create({ data: {
    dni: String(randomInt(10_000_000, 99_999_999)), nombre: `Cliente C4 HTTP etapa 3 ${sufijo}`,
  } });
  const vendorCookie = await cookieExistente(prisma, "vendedor.seed@erp-swat.local");
  // La ficha creada directamente en la base aislada debe verse desde Next:
  // si el servidor apuntara a otra base, el test se detiene antes del POST C4.
  const fichaAislada = await fetch(`${base}/clientes/${cliente.id}`, {
    headers: { Cookie: vendorCookie }, redirect: "manual",
  });
  assert.equal(fichaAislada.status, 200);
  assert.match(await fichaAislada.text(), new RegExp(sufijo));
  const auditorCookie = await cookieExistente(prisma, "auditor.seed@erp-swat.local");
  const adminCookie = await cookieExistente(prisma, admin.email);
  const endpoint = `${base}/api/clientes/${cliente.id}/consentimientos/transiciones`;
  const post = (cookie: string | null, body: unknown) => fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const tratamiento = await prisma.consentimientoCliente.create({ data: {
    cliente_id: cliente.id, alcance: "VENTA_ASISTIDA", finalidad: "Tratamiento de datos personales para operar con el cliente",
    origen: "EXPRESO", registrado_por_id: vendedor.id, fecha_consentimiento: new Date("2026-01-01T10:00:00Z"),
  } });
  await prisma.eventoConsentimientoCliente.create({ data: {
    cliente_id: cliente.id, consentimiento_id: tratamiento.id, alcance: "VENTA_ASISTIDA",
    finalidad: tratamiento.finalidad, tipo: "ACEPTACION_INICIAL", usuario_id: vendedor.id,
    fecha_evento: tratamiento.fecha_consentimiento,
  } });
  const solicitar = { operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: tratamiento.id };
  assert.equal((await post(null, solicitar)).status, 401);
  assert.equal((await post(auditorCookie, solicitar)).status, 403);
  assert.equal((await post(vendorCookie, { ...solicitar, usuario_id: admin.id })).status, 400);
  const solicitudRes = await post(vendorCookie, solicitar);
  assert.equal(solicitudRes.status, 201, JSON.stringify(await solicitudRes.clone().json()));
  const solicitudId = (await solicitudRes.json()).data.evento_id as string;
  assert.equal((await post(vendorCookie, solicitar)).status, 409);
  const resolver = { operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA",
    consentimiento_id: tratamiento.id, solicitud_evento_id: solicitudId };
  assert.equal((await post(vendorCookie, resolver)).status, 403);
  const fichaVendor = await fetch(`${base}/clientes/${cliente.id}`, { headers: { Cookie: vendorCookie } });
  assert.equal(fichaVendor.status, 200);
  const htmlVendor = await fichaVendor.text();
  assert.match(htmlVendor, /Solicitudes de revocación pendientes/);
  assert.doesNotMatch(htmlVendor, /Ejecutar revocación solicitada/);
  const fichaAdmin = await fetch(`${base}/clientes/${cliente.id}`, { headers: { Cookie: adminCookie } });
  assert.equal(fichaAdmin.status, 200);
  const htmlAdmin = await fichaAdmin.text();
  assert.match(htmlAdmin, /Ejecutar revocación solicitada/);
  assert.match(htmlAdmin, /Rechazar solicitud/);
  assert.equal((await post(adminCookie, { ...resolver, operacion: "RECHAZAR_SOLICITUD", motivo: "   " })).status, 400);
  const ejecutadaRes = await post(adminCookie, resolver);
  assert.equal(ejecutadaRes.status, 201, JSON.stringify(await ejecutadaRes.clone().json()));
  const revocacionId = (await ejecutadaRes.json()).data.evento_id as string;
  assert.equal((await post(adminCookie, resolver)).status, 409);
  const aceptar = { operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA",
    revocacion_evento_id: revocacionId, aceptacion_expresa: true };
  assert.equal((await post(vendorCookie, aceptar)).status, 403);
  assert.equal((await post(adminCookie, { ...aceptar, aceptacion_expresa: false })).status, 400);
  const aceptadaRes = await post(adminCookie, aceptar);
  assert.equal(aceptadaRes.status, 201, JSON.stringify(await aceptadaRes.clone().json()));
  const aceptadaData = (await aceptadaRes.json()).data;
  const aceptacionNuevaId = aceptadaData.consentimiento_id as string;
  assert.equal((await post(adminCookie, aceptar)).status, 409);
  const nuevaSolicitudRes = await post(vendorCookie, { ...solicitar, consentimiento_id: aceptacionNuevaId });
  assert.equal(nuevaSolicitudRes.status, 201);
  const nuevaSolicitudId = (await nuevaSolicitudRes.json()).data.evento_id as string;
  const rechazar = { operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA",
    consentimiento_id: aceptacionNuevaId, solicitud_evento_id: nuevaSolicitudId, motivo: "No procede" };
  assert.equal((await post(vendorCookie, rechazar)).status, 403);
  const rechazadaRes = await post(adminCookie, rechazar);
  assert.equal(rechazadaRes.status, 201, JSON.stringify(await rechazadaRes.clone().json()));
  const rechazadaId = (await rechazadaRes.json()).data.evento_id as string;
  const rechazada = await prisma.eventoConsentimientoCliente.findUniqueOrThrow({ where: { id: rechazadaId } });
  assert.equal(rechazada.tipo, "SOLICITUD_RECHAZADA");
  assert.equal(rechazada.solicitud_evento_id, nuevaSolicitudId);
  assert.equal((await post(adminCookie, rechazar)).status, 409);
  const eventosAuditables = [solicitudId, revocacionId, aceptadaData.evento_id as string,
    nuevaSolicitudId, rechazadaId];
  const asientos = await esperarAsientosC4(prisma, eventosAuditables);
  assert.equal(asientos.length, 5);
  assert.ok(asientos.every((fila) => (fila.valor_nuevo as Record<string, unknown>).contexto === "FICHA"));
  const inexistente = await fetch(`${base}/api/clientes/${randomUUID()}/consentimientos/transiciones`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: vendorCookie },
    body: JSON.stringify(solicitar),
  });
  assert.equal(inexistente.status, 404);
});
