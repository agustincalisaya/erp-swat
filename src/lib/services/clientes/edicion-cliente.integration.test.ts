import assert from "node:assert/strict";
import test from "node:test";

/**
 * Suite de integración de HU-C2 — edición de contacto y de direcciones de un
 * cliente. Mismo patrón que `direccion-cliente.integration.test.ts`: se salta
 * (no falla) cuando `HU_C2_INTEGRATION_DATABASE_URL` no está definida.
 *
 * Correr con: `npm run test:integration:c2`.
 *
 * Escenarios:
 *  (a) Edición de contacto: persiste, audita UPDATE sobre `clientes` con
 *      valor anterior/nuevo, y `""` vacía teléfono/email.
 *  (b) Edición sin cambios reales: no escribe ni emite asiento.
 *  (c) `dni` en el input → CAMPOS_NO_EDITABLES sin escrituras.
 *  (d) Regla de FACTURACION en edición: la ÚNICA FACTURACION no puede pasar a
 *      ENVIO (422, cero escrituras); con una segunda FACTURACION sí puede; la
 *      segunda ya no (queda una sola).
 *  (e) Ediciones inocuas (rótulo, ENVIO→FACTURACION) no disparan la regla.
 *  (f) Una dirección de OTRO cliente → DIRECCION_NO_ENCONTRADA.
 *  (g) Auditoría UPDATE sobre `direcciones_cliente` con registro_id = dirección.
 */
const DATABASE_URL = process.env.HU_C2_INTEGRATION_DATABASE_URL;

test("HU-C2 integra edición de contacto y direcciones (regla FACTURACION excluyendo el propio registro) con auditoría", {
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

  function dniNuevo(): string {
    return String(10_000_000 + (Date.now() % 89_999_999)).slice(0, 8);
  }

  async function codigoDeError(promesa: Promise<unknown>): Promise<string | null> {
    try {
      await promesa;
      return null;
    } catch (err) {
      return (err as { code?: string } | null)?.code ?? null;
    }
  }

  /** Espera (polling) los asientos UPDATE de un registro; la auditoría es fire-and-forget. */
  async function asientosUpdate(tabla: string, registroId: string, esperados: number) {
    for (let i = 0; i < 50; i++) {
      const filas = await prisma.auditLog.findMany({
        where: { tabla_afectada: tabla, registro_id: registroId, accion: "UPDATE" },
        orderBy: { created_at: "asc" },
      });
      if (filas.length >= esperados) return filas;
      await new Promise((r) => setTimeout(r, 100));
    }
    return prisma.auditLog.findMany({
      where: { tabla_afectada: tabla, registro_id: registroId, accion: "UPDATE" },
      orderBy: { created_at: "asc" },
    });
  }

  const alta = await svc.crearCliente({ dni: dniNuevo(), nombre: "Cliente HU-C2" }, USUARIO_ID);
  const clienteId = alta.cliente_id;

  // ── (a) contacto ────────────────────────────────────────────────────────
  const editado = await svc.editarCliente(
    clienteId,
    { nombre: "Cliente HU-C2 Editado", telefono: "3874001122", email: "c2@example.com" },
    USUARIO_ID,
  );
  assert.deepEqual(editado.campos_modificados, ["nombre", "telefono", "email"]);
  const enDb = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
  assert.equal(enDb.nombre, "Cliente HU-C2 Editado");
  assert.equal(enDb.telefono, "3874001122");
  assert.equal(enDb.dni, alta.dni, "el DNI no cambia");

  const asientos1 = await asientosUpdate("clientes", clienteId, 1);
  assert.equal(asientos1.length, 1);
  assert.deepEqual(asientos1[0].valor_anterior, {
    nombre: "Cliente HU-C2",
    telefono: null,
    email: null,
  });
  assert.equal((asientos1[0].valor_nuevo as Record<string, unknown>).nombre, "Cliente HU-C2 Editado");

  await svc.editarCliente(clienteId, { telefono: "", email: "" }, USUARIO_ID);
  const vaciado = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
  assert.equal(vaciado.telefono, null);
  assert.equal(vaciado.email, null);
  assert.equal((await asientosUpdate("clientes", clienteId, 2)).length, 2);

  // ── (b) sin cambios reales ──────────────────────────────────────────────
  const sinCambios = await svc.editarCliente(clienteId, { nombre: "Cliente HU-C2 Editado" }, USUARIO_ID);
  assert.deepEqual(sinCambios.campos_modificados, []);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await asientosUpdate("clientes", clienteId, 2)).length, 2, "no hay asiento nuevo");

  // ── (c) dni ─────────────────────────────────────────────────────────────
  assert.equal(
    await codigoDeError(
      svc.editarCliente(clienteId, { nombre: "Otro", dni: "99999999" } as never, USUARIO_ID),
    ),
    "CAMPOS_NO_EDITABLES",
  );
  assert.equal(
    (await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } })).nombre,
    "Cliente HU-C2 Editado",
    "el rechazo no escribe",
  );

  // ── (d) regla de FACTURACION en edición ─────────────────────────────────
  const f1 = await svc.agregarDireccionCliente(
    clienteId,
    { rotulo: "Casa", tipo: "FACTURACION", direccion_completa: "Av. Siempreviva 742" },
    USUARIO_ID,
  );
  const envio = await svc.agregarDireccionCliente(
    clienteId,
    { rotulo: "Depósito", tipo: "ENVIO", direccion_completa: "Ruta 8 km 12" },
    USUARIO_ID,
  );

  // La única FACTURACION → ENVIO: 422 y cero escrituras.
  assert.equal(
    await codigoDeError(svc.editarDireccionCliente(clienteId, f1.direccion_id, { tipo: "ENVIO" }, USUARIO_ID)),
    "DIRECCION_FACTURACION_REQUERIDA",
  );
  assert.equal(
    (await prisma.direccionCliente.findUniqueOrThrow({ where: { id: f1.direccion_id } })).tipo,
    "FACTURACION",
  );

  // Segunda FACTURACION (ENVIO→FACTURACION, inocua) ⇒ ahora f1 sí puede pasar a ENVIO.
  await svc.editarDireccionCliente(clienteId, envio.direccion_id, { tipo: "FACTURACION" }, USUARIO_ID);
  const aEnvio = await svc.editarDireccionCliente(clienteId, f1.direccion_id, { tipo: "ENVIO" }, USUARIO_ID);
  assert.equal(aEnvio.tipo, "ENVIO");

  // Ahora la segunda (`envio`) es la ÚNICA FACTURACION: no puede pasar a ENVIO.
  assert.equal(
    await codigoDeError(
      svc.editarDireccionCliente(clienteId, envio.direccion_id, { tipo: "ENVIO" }, USUARIO_ID),
    ),
    "DIRECCION_FACTURACION_REQUERIDA",
  );

  // ── (e) ediciones inocuas ───────────────────────────────────────────────
  const soloRotulo = await svc.editarDireccionCliente(
    clienteId,
    envio.direccion_id,
    { rotulo: "Casa central", direccion_completa: "Av. Siempreviva 800" },
    USUARIO_ID,
  );
  assert.deepEqual(soloRotulo.campos_modificados, ["rotulo", "direccion_completa"]);

  // ── (f) dirección de otro cliente ───────────────────────────────────────
  const otro = await svc.crearCliente({ dni: dniNuevo(), nombre: "Otro cliente HU-C2" }, USUARIO_ID);
  assert.equal(
    await codigoDeError(
      svc.editarDireccionCliente(otro.cliente_id, f1.direccion_id, { rotulo: "X" }, USUARIO_ID),
    ),
    "DIRECCION_NO_ENCONTRADA",
  );

  // ── (g) auditoría sobre direcciones_cliente ─────────────────────────────
  const asientosDir = await asientosUpdate("direcciones_cliente", f1.direccion_id, 1);
  assert.equal(asientosDir.length, 1);
  assert.deepEqual(asientosDir[0].valor_anterior, { tipo: "FACTURACION" });
  assert.equal((asientosDir[0].valor_nuevo as Record<string, unknown>).tipo, "ENVIO");
  assert.equal((asientosDir[0].valor_nuevo as Record<string, unknown>).cliente_id, clienteId);
});
