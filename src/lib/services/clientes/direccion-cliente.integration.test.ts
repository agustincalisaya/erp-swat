import assert from "node:assert/strict";
import test from "node:test";

/**
 * Suite de integración de HU-C3 (spec_modulo_C.md §2.3) — espeja el patrón de
 * `cliente.integration.test.ts` (HU-C1): se salta (no falla) cuando
 * `HU_C3_INTEGRATION_DATABASE_URL` no está definida, resuelve el
 * `DATABASE_URL` ANTES de los imports dinámicos, y espera la materialización
 * fire-and-forget de la auditoría con polling.
 *
 * Correr con: `npm run test:integration:c3`.
 *
 * Escenarios (spec §2.3):
 *  (a) FACTURACION como primera dirección de un cliente sin direcciones.
 *  (b) N direcciones de ENVIO con FACTURACION activa previa (sin límite).
 *  (c) ENVIO sin FACTURACION activa → `DIRECCION_FACTURACION_REQUERIDA` y
 *      CERO escrituras (sin direcciones, y con la única FACTURACION inactiva).
 *  (d) Listado: solo activas por defecto; `incluirInactivas` las incluye.
 *  (e) Materialización en `audit_logs` con encadenamiento SHA-256.
 */
const DATABASE_URL = process.env.HU_C3_INTEGRATION_DATABASE_URL;

test("HU-C3 integra alta de direcciones (FACTURACION/ENVIO), regla estructural sin escritura y auditoría", {
  skip: !DATABASE_URL,
  timeout: 30_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;

  const [
    { prisma },
    cliente,
    { iniciarAuditLogListener },
  ] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./cliente.service.ts"),
    import("../../events/listeners/audit-log.listener.ts"),
  ]);
  t.after(async () => prisma.$disconnect());
  iniciarAuditLogListener();

  // Usuario ya sembrado por seed.ts (rol ADMINISTRADOR) — solo se usa como
  // `usuario_id` del evento/auditoría, este test no ejercita RBAC (igual que
  // la suite de HU-C1).
  const USUARIO_ID = "64a0a7e3-76e2-4637-828e-f7cb96756597";

  const inicioDeLaCorrida = new Date();

  /**
   * Ids de TODAS las direcciones que este test crea con éxito (las que deben
   * materializar exactamente un asiento de auditoría cada una). Los intentos
   * rechazados con 422 no agregan ids acá — esa asimetría es justamente lo
   * que prueba que el rechazo no escribe ni emite.
   */
  const idsCreadosExitosos: string[] = [];

  type DireccionAgregada = Awaited<ReturnType<typeof cliente.agregarDireccionCliente>>;

  function dniNuevo(): string {
    return String(10_000_000 + (Date.now() % 89_999_999)).slice(0, 8);
  }

  /** Devuelve el `code` del ServiceError, o `null` si la promesa resolvió. */
  async function codigoDeError(promesa: Promise<unknown>): Promise<string | null> {
    try {
      await promesa;
      return null;
    } catch (err) {
      return (err as { code?: string } | null)?.code ?? null;
    }
  }

  async function crearClienteDePrueba(sufijo: string): Promise<string> {
    const alta = await cliente.crearCliente(
      { dni: dniNuevo(), nombre: `Cliente HU-C3 ${sufijo}`, acepta_tratamiento_datos: true, decision_comercial: "RECHAZA" },
      USUARIO_ID,
    );
    return alta.cliente_id;
  }

  async function agregarDireccion(
    clienteId: string,
    input: Parameters<typeof cliente.agregarDireccionCliente>[1],
  ): Promise<DireccionAgregada> {
    const direccion = await cliente.agregarDireccionCliente(clienteId, input, USUARIO_ID);
    idsCreadosExitosos.push(direccion.direccion_id);
    return direccion;
  }

  // ── (a) FACTURACION como primera dirección de un cliente sin direcciones ─
  const cliente1 = await crearClienteDePrueba("principal");
  const facturacion = await agregarDireccion(cliente1, {
    rotulo: "Casa",
    tipo: "FACTURACION",
    direccion_completa: "Av. Siempreviva 742",
  });
  assert.ok(facturacion.direccion_id);
  assert.equal(facturacion.rotulo, "Casa");
  assert.equal(facturacion.tipo, "FACTURACION");

  const facturacionEnDb = await prisma.direccionCliente.findUniqueOrThrow({
    where: { id: facturacion.direccion_id },
    select: {
      cliente_id: true,
      tipo: true,
      rotulo: true,
      direccion_completa: true,
      is_active: true,
    },
  });
  assert.equal(facturacionEnDb.cliente_id, cliente1);
  assert.equal(facturacionEnDb.tipo, "FACTURACION");
  assert.equal(facturacionEnDb.is_active, true);

  // ── (b) N direcciones de ENVIO con FACTURACION activa previa ────────────
  const envios: DireccionAgregada[] = [];
  for (const [indice, rotulo] of ["Depósito", "Sucursal 2", "Planta"].entries()) {
    envios.push(
      await agregarDireccion(cliente1, {
        rotulo,
        tipo: "ENVIO",
        direccion_completa: `Ruta 8 km ${12 + indice}`,
      }),
    );
  }
  assert.equal(envios.length, 3);
  assert.ok(envios.every((envio) => envio.tipo === "ENVIO"));
  assert.equal(
    await prisma.direccionCliente.count({ where: { cliente_id: cliente1, is_active: true } }),
    4,
    "la primera FACTURACION más 3 ENVIO deberían ser 4 filas activas (sin límite de cantidad)",
  );

  // ── (c1) ENVIO sin ninguna dirección → 422 y CERO escrituras ────────────
  const cliente2 = await crearClienteDePrueba("envio-first");
  const codigoEnvioFirst = await codigoDeError(
    cliente.agregarDireccionCliente(
      cliente2,
      { rotulo: "Depósito", tipo: "ENVIO", direccion_completa: "Ruta 8 km 12" },
      USUARIO_ID,
    ),
  );
  assert.equal(codigoEnvioFirst, "DIRECCION_FACTURACION_REQUERIDA");
  assert.equal(
    await prisma.direccionCliente.count({ where: { cliente_id: cliente2 } }),
    0,
    "el rechazo no debe haber insertado ninguna fila",
  );

  // ── (c2) ENVIO cuando la ÚNICA FACTURACION está dada de baja lógica ─────
  const cliente3 = await crearClienteDePrueba("facturacion-inactiva");
  const facturacionInactivable = await agregarDireccion(cliente3, {
    rotulo: "Casa vieja",
    tipo: "FACTURACION",
    direccion_completa: "Mitre 100",
  });
  // Baja lógica directa (setup del test): NUNCA un borrado físico.
  await prisma.direccionCliente.update({
    where: { id: facturacionInactivable.direccion_id },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: USUARIO_ID,
      deletion_reason: "Setup de HU-C3: única FACTURACION inactiva",
    },
  });

  const codigoFacturacionInactiva = await codigoDeError(
    cliente.agregarDireccionCliente(
      cliente3,
      { rotulo: "Planta", tipo: "ENVIO", direccion_completa: "Ruta 9 km 5" },
      USUARIO_ID,
    ),
  );
  assert.equal(codigoFacturacionInactiva, "DIRECCION_FACTURACION_REQUERIDA");

  const direccionesCliente3 = await prisma.direccionCliente.findMany({
    where: { cliente_id: cliente3 },
    select: { is_active: true },
  });
  assert.equal(direccionesCliente3.length, 1, "no debe haberse insertado la ENVIO");
  assert.equal(
    direccionesCliente3.filter((direccion) => direccion.is_active).length,
    0,
    "una FACTURACION inactiva no habilita direcciones de ENVIO",
  );

  // ── (d) Listado: default solo activas; `incluirInactivas` las incluye ────
  // Se da de baja lógica una ENVIO de cliente1 (setup directo, sin service:
  // la baja de direcciones está fuera del alcance de HU-C3).
  await prisma.direccionCliente.update({
    where: { id: envios[2]!.direccion_id },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: USUARIO_ID,
      deletion_reason: "Setup de HU-C3: verificar filtro del listado",
    },
  });

  const soloActivas = await cliente.listarDireccionesCliente(cliente1);
  assert.equal(soloActivas.length, 3);
  assert.ok(soloActivas.every((direccion) => direccion.is_active));
  assert.equal(
    soloActivas.some((direccion) => direccion.id === envios[2]!.direccion_id),
    false,
    "el listado por defecto no debe exponer direcciones inactivas",
  );

  const todas = await cliente.listarDireccionesCliente(cliente1, { incluirInactivas: true });
  assert.equal(todas.length, 4, "el bypass de Auditoría debe incluir la inactiva");
  assert.equal(todas.filter((direccion) => !direccion.is_active).length, 1);
  // Orden estable por `created_at asc`: la FACTURACION cargada primero.
  assert.equal(todas[0]!.id, facturacion.direccion_id);
  assert.deepEqual(
    Object.keys(todas[0]!).sort(),
    ["created_at", "direccion_completa", "id", "is_active", "rotulo", "tipo"].sort(),
    "el listado debe exponer exactamente los campos del contrato de consumo",
  );

  // ── (e) Materialización de auditoría ────────────────────────────────────
  // Fire-and-forget: se espera a que el listener escriba los N asientos.
  let auditoria: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
  for (
    let intento = 0;
    intento < 40 && auditoria.length < idsCreadosExitosos.length;
    intento++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    auditoria = await prisma.auditLog.findMany({
      where: {
        tabla_afectada: "direcciones_cliente",
        registro_id: { in: idsCreadosExitosos },
      },
    });
  }
  assert.equal(
    auditoria.length,
    idsCreadosExitosos.length,
    "cada dirección creada con éxito debe materializar exactamente un asiento de auditoría",
  );

  const asientoFacturacion = auditoria.find(
    (asiento) => asiento.registro_id === facturacion.direccion_id,
  );
  assert.ok(asientoFacturacion, "debe existir el asiento de la dirección FACTURACION");
  assert.equal(asientoFacturacion.usuario_id, USUARIO_ID);
  assert.equal(asientoFacturacion.accion, "CREATE");
  assert.equal(asientoFacturacion.tabla_afectada, "direcciones_cliente");
  assert.ok(
    asientoFacturacion.hash_actual.length > 0,
    "el asiento debe entrar en la cadena SHA-256 de auditoría",
  );
  const valorNuevo = asientoFacturacion.valor_nuevo as Record<string, unknown>;
  assert.equal(valorNuevo.cliente_id, cliente1);
  assert.equal(valorNuevo.id, facturacion.direccion_id);
  assert.equal(valorNuevo.tipo, "FACTURACION");
  assert.deepEqual(
    valorNuevo.campos_modificados,
    ["direcciones"],
    "`campos_modificados` no tiene columna propia: se pliega dentro de `valor_nuevo`",
  );

  // Los rechazos 422 NO deben haber emitido evento: ningún asiento nuevo con
  // `tabla_afectada: "direcciones_cliente"` aparece en esta corrida fuera de
  // los ids creados con éxito. Se verifica por conteo Y por pertenencia, para
  // que un asiento espurio no pueda pasar desapercibido.
  const asientosDeLaCorrida = await prisma.auditLog.findMany({
    where: {
      tabla_afectada: "direcciones_cliente",
      created_at: { gte: inicioDeLaCorrida },
    },
    select: { registro_id: true },
  });
  assert.equal(
    asientosDeLaCorrida.length,
    idsCreadosExitosos.length,
    "solo las altas exitosas deben auditarse: los 422 no escriben ni emiten",
  );
  assert.ok(
    asientosDeLaCorrida.every(
      (asiento) => asiento.registro_id !== null && idsCreadosExitosos.includes(asiento.registro_id),
    ),
    "todo asiento de `direcciones_cliente` debe corresponder a una alta exitosa de esta corrida",
  );

  console.info("[HU-C3:EVIDENCIA]", JSON.stringify({
    cliente_id: cliente1,
    direccion_facturacion_id: facturacion.direccion_id,
    envios_creados: envios.length,
    activas_cliente1: soloActivas.length,
    total_con_inactivas: todas.length,
    envio_first_code: codigoEnvioFirst,
    facturacion_inactiva_code: codigoFacturacionInactiva,
    altas_exitosas: idsCreadosExitosos.length,
    asientos_auditoria: asientosDeLaCorrida.length,
  }));
});
