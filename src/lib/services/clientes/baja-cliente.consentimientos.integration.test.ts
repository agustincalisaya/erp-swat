import assert from "node:assert/strict";
import test from "node:test";

/**
 * Integración de HU-C6 (baja lógica de cliente) × consentimientos (HU-C4).
 * Archivo propio de HU-C6: no modifica los tests de HU-C4.
 *
 * Regresión del bug de alcance en `obtenerConsentimientosCliente` (mismo que
 * HU-C7 en `consultarClientePorDni`): la lectura filtraba `is_active` del
 * cliente y, tras la baja, lanzaba `CLIENTE_NO_ENCONTRADO` — la ficha de un
 * cliente inactivo quedaba inaccesible (spec Módulo C §2.3: el historial
 * permanece accesible).
 *
 * Verifica:
 *  (a) lectura de un cliente dado de baja: NO lanza y devuelve estado e
 *      historial completos (idénticos a los previos a la baja).
 *  (b) las ESCRITURAS de consentimiento siguen bloqueando al inactivo
 *      (`CLIENTE_NO_ENCONTRADO`): solo se abrió la lectura.
 *
 * Opt-in vía `HU_C6_INTEGRATION_DATABASE_URL`; requiere la migración de HU-C4
 * (eventos de consentimiento) aplicada. Correr con
 * `npm run test:integration:c6-consentimientos`.
 */
const DATABASE_URL = process.env.HU_C6_INTEGRATION_DATABASE_URL;

test("HU-C6: la lectura de consentimientos de un cliente inactivo devuelve estado e historial", {
  skip: !DATABASE_URL,
  timeout: 30_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;

  const [{ prisma }, clientes, consentimientos] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./cliente.service.ts"),
    import("./consentimiento.service.ts"),
  ]);
  t.after(async () => prisma.$disconnect());

  const USUARIO_ID = "64a0a7e3-76e2-4637-828e-f7cb96756597";
  const dni = String(10_000_000 + (Date.now() % 89_999_999)).slice(0, 8);

  const alta = await clientes.crearCliente(
    {
      dni,
      nombre: "Cliente HU-C6 consentimientos",
      acepta_tratamiento_datos: true,
      decision_comercial: "ACEPTA",
    },
    USUARIO_ID,
  );
  const clienteId = alta.cliente_id;

  // Un registro legado (alcance AMBOS) aporta historial sin depender de un
  // actor con permiso de gestión: ambas finalidades quedan pendientes.
  await prisma.consentimientoCliente.create({
    data: { cliente_id: clienteId, alcance: "AMBOS", finalidad: "Registro anterior HU-C6" },
  });

  // El fixture manda `decision_comercial: "ACEPTA"`, así que `crearClienteTx`
  // ya deja `VENTA_ASISTIDA` ACEPTADO desde el alta (`cliente.service.ts`
  // §2.1/C4) — no queda "pendiente de regularización" como el legado que se
  // insertó a mano arriba.
  const previo = await consentimientos.obtenerConsentimientosCliente(clienteId);
  assert.equal(previo.estados.VENTA_ASISTIDA.estado, "ACEPTADO");
  assert.ok(previo.historial.length >= 1, "el cliente activo tiene historial");

  await clientes.bajaCliente(clienteId, USUARIO_ID, "Baja de prueba HU-C6 (consentimientos)");

  // (a) la lectura sobre el inactivo NO lanza y coincide con la previa.
  const trasBaja = await consentimientos.obtenerConsentimientosCliente(clienteId);
  assert.deepEqual(trasBaja.estados, previo.estados, "el estado por finalidad se conserva");
  assert.equal(trasBaja.historial.length, previo.historial.length, "el historial se conserva completo");
  // Orden ASCENDENTE por fecha (`consentimiento.estado.ts`): el legado se
  // insertó DESPUÉS del alta, así que queda ÚLTIMO, no primero.
  assert.equal(
    trasBaja.historial.at(-1)?.resultado,
    "Legado: no acredita aceptación expresa",
  );

  // (b) las escrituras siguen bloqueadas para un cliente inactivo.
  await assert.rejects(
    consentimientos.regularizarConsentimientoCliente(
      clienteId,
      { alcance: "VENTA_ASISTIDA", decision: "ACEPTA" },
      USUARIO_ID,
    ),
    (e: unknown) => (e as { code?: string } | null)?.code === "CLIENTE_NO_ENCONTRADO",
  );
});
