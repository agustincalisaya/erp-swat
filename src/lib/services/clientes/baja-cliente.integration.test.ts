import assert from "node:assert/strict";
import test from "node:test";

/**
 * Suite de integración de HU-C6 — baja lógica de un cliente
 * (spec_modulo_C.md §2.6). Mismo patrón que `edicion-cliente.integration.test.ts`:
 * se salta (no falla) cuando `HU_C6_INTEGRATION_DATABASE_URL` no está definida.
 *
 * Correr con: `npm run test:integration:c6`.
 *
 * Escenarios:
 *  (a) Baja exitosa: setea los 4 campos de soft delete (`is_active=false`,
 *      `deleted_at`, `deleted_by`, `deletion_reason`) y la fila PERMANECE (nunca
 *      DELETE físico).
 *  (b) Auditoría: un asiento `DELETE_LOGICO` sobre `clientes` con
 *      `valor_anterior/valor_nuevo` `{ is_active, deletion_reason }`.
 *  (c) Doble baja sobre el mismo cliente → CLIENTE_NO_ENCONTRADO (guarda de
 *      concurrencia), sin asiento de auditoría adicional y sin pisar el motivo.
 *  (d) Dos bajas concurrentes: exactamente una gana, la otra recibe el 404.
 *  (e) Cliente inexistente → CLIENTE_NO_ENCONTRADO.
 *
 * El motivo vacío se rechaza en la capa Zod (`baja-cliente.schema.test.ts`), no
 * en el service. El 403 del Vendedor es RBAC y se verifica en la suite HTTP.
 */
const DATABASE_URL = process.env.HU_C6_INTEGRATION_DATABASE_URL;

test("HU-C6 integra la baja lógica de cliente (4 campos, auditoría DELETE_LOGICO, guarda de doble baja)", {
  skip: !DATABASE_URL,
  timeout: 30_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;

  const [{ prisma }, svc, { iniciarAuditLogListener }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./cliente.service.ts"),
    import("../../events/listeners/audit-log.listener.ts"),
  ]);
  t.after(async () => prisma.$disconnect());
  iniciarAuditLogListener();

  const USUARIO_ID = "64a0a7e3-76e2-4637-828e-f7cb96756597";

  let secuenciaDni = 0;
  function dniNuevo(): string {
    secuenciaDni += 1;
    return String(10_000_000 + ((Date.now() + secuenciaDni * 1013) % 89_999_999)).slice(0, 8);
  }

  async function codigoDeError(promesa: Promise<unknown>): Promise<string | null> {
    try {
      await promesa;
      return null;
    } catch (err) {
      return (err as { code?: string } | null)?.code ?? null;
    }
  }

  /** Espera (polling) los asientos DELETE_LOGICO; la auditoría es fire-and-forget. */
  async function asientosBaja(clienteId: string, esperados: number) {
    const consulta = () =>
      prisma.auditLog.findMany({
        where: { tabla_afectada: "clientes", registro_id: clienteId, accion: "DELETE_LOGICO" },
        orderBy: { created_at: "asc" },
      });
    for (let i = 0; i < 50; i++) {
      const filas = await consulta();
      if (filas.length >= esperados) return filas;
      await new Promise((r) => setTimeout(r, 100));
    }
    return consulta();
  }

  // ── (a) baja exitosa ────────────────────────────────────────────────────
  const alta = await svc.crearCliente({ dni: dniNuevo(), nombre: "Cliente HU-C6" }, USUARIO_ID);
  const clienteId = alta.cliente_id;

  const motivo = "Cliente duplicado por error de carga";
  const antes = Date.now();
  const resultado = await svc.bajaCliente(clienteId, USUARIO_ID, motivo);
  assert.deepEqual(resultado, { cliente_id: clienteId, is_active: false });

  const enDb = await prisma.cliente.findUnique({ where: { id: clienteId } });
  assert.ok(enDb, "la fila permanece: la baja es lógica, nunca un DELETE físico");
  assert.equal(enDb.is_active, false);
  assert.ok(enDb.deleted_at && enDb.deleted_at.getTime() >= antes - 1000, "deleted_at seteado");
  assert.equal(enDb.deleted_by, USUARIO_ID);
  assert.equal(enDb.deletion_reason, motivo);

  // ── (b) auditoría ───────────────────────────────────────────────────────
  const asientos = await asientosBaja(clienteId, 1);
  assert.equal(asientos.length, 1);
  assert.equal(asientos[0].usuario_id, USUARIO_ID);
  assert.deepEqual(asientos[0].valor_anterior, { is_active: true });
  assert.deepEqual(asientos[0].valor_nuevo, { is_active: false, deletion_reason: motivo });

  // ── (c) doble baja → 404 sin efectos ────────────────────────────────────
  assert.equal(
    await codigoDeError(svc.bajaCliente(clienteId, USUARIO_ID, "Segundo intento")),
    "CLIENTE_NO_ENCONTRADO",
  );
  const trasSegunda = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
  assert.equal(trasSegunda.deletion_reason, motivo, "la segunda baja no pisa el motivo original");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await asientosBaja(clienteId, 1)).length, 1, "la doble baja no emite asiento nuevo");

  // ── (d) concurrencia: exactamente una baja gana ─────────────────────────
  const concurrente = await svc.crearCliente({ dni: dniNuevo(), nombre: "Cliente HU-C6 race" }, USUARIO_ID);
  const resultados = await Promise.allSettled([
    svc.bajaCliente(concurrente.cliente_id, USUARIO_ID, "Baja A"),
    svc.bajaCliente(concurrente.cliente_id, USUARIO_ID, "Baja B"),
  ]);
  assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1, "una sola baja gana");
  const perdedora = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal((perdedora.reason as { code?: string }).code, "CLIENTE_NO_ENCONTRADO");
  assert.equal((await asientosBaja(concurrente.cliente_id, 1)).length, 1);

  // ── (e) inexistente ─────────────────────────────────────────────────────
  assert.equal(
    await codigoDeError(
      svc.bajaCliente("00000000-0000-4000-8000-000000000000", USUARIO_ID, "No existe"),
    ),
    "CLIENTE_NO_ENCONTRADO",
  );
});
