import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Suite de integración de HU-C7 (spec_modulo_C.md §2.7) — espeja el patrón de
 * `segmento-cliente.integration.test.ts`: se salta (no falla) cuando
 * `HU_C7_INTEGRATION_DATABASE_URL` no está definida, y resuelve el
 * `DATABASE_URL` ANTES de los imports dinámicos.
 *
 * Correr con: `npm run test:integration:c7`.
 *
 * DIFERENCIA DELIBERADA con las suites de HU-C8/C9: NO se llama a
 * `iniciarAuditLogListener()`. HU-C7 es una consulta de SOLO LECTURA: no
 * emite ningún evento de dominio, así que nada escribe `audit_logs` y el
 * listener no tiene trabajo que hacer. El escenario (f) —que verifica que dos
 * consultas no agregan filas de auditoría— es válido precisamente porque no
 * hay listener materializando asientos: si la consulta escribiera (o
 * emitiera), el conteo cambiaría.
 *
 * Escenarios (spec §2.7):
 *  (a) Juan Pérez (30123456): 2 direcciones con `direccion_id`, canal
 *      WHATSAPP, historial 2 operaciones / $458.000, `ultima_compra`
 *      comparada contra una LECTURA A LA BASE (nunca un ISO hardcodeado: el
 *      seed usa `diasAtras()` y las fechas son relativas a la corrida).
 *  (b) María Gómez (27555111): 0/0/null — su único pedido está RESERVADO y
 *      queda excluido por el filtro de estados.
 *  (c) cliente activo SIN pedidos: 0/0/null (nunca `undefined` ni error).
 *  (d) CLÚSTER DE FUSIÓN: un pedido FACTURADO creado ad-hoc para el
 *      secundario fusionado (27555222) aparece en el historial del primario.
 *  (e) DNI válido sin ningún cliente: `CLIENTE_NO_ENCONTRADO` con el DNI en
 *      el mensaje.
 *  (e2) HU-C6: un cliente dado de baja lógica sigue devolviendo ficha e
 *      historial, con `is_active: false`.
 *  (f) dos consultas consecutivas devuelven lo mismo y `audit_logs` no gana
 *      filas.
 *
 * Los fixtures ad-hoc se dan de baja lógica — NUNCA `delete()`/`deleteMany()`.
 * El pedido ad-hoc se ANULA además de soft-deletearse (ver escenario d):
 * `resolverHistorialCompras` filtra por `estado`, no por `is_active`, y
 * `ANULADO` es exactamente la "baja lógica" de un `PedidoVenta` según
 * `schema.prisma`; sin anularlo, la suite no sería idempotente entre corridas.
 */
const DATABASE_URL = process.env.HU_C7_INTEGRATION_DATABASE_URL;

/** Ids del seed (`prisma/seed.ts`) — el contrato de datos de referencia. */
const CLIENTE_JUAN_PEREZ_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000001";
const CLIENTE_MARIA_GOMEZ_PRIMARIO_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000003";
const CLIENTE_MARIA_GOMEZ_FUSIONADO_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000004";
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";

const ESTADOS_EFECTIVOS = ["FACTURADO", "REMITO_EMITIDO", "CERRADO"] as const;

test("HU-C7 integra la consulta unificada por DNI (ficha + historial + clúster de fusión, solo lectura)", {
  skip: !DATABASE_URL,
  timeout: 30_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;

  const [{ prisma }, clienteService] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./cliente.service.ts"),
  ]);
  t.after(async () => prisma.$disconnect());

  /** Ids de clientes fixture creados por esta corrida (cleanup por baja lógica). */
  const clientesFixture: string[] = [];
  /** Id del pedido ad-hoc del escenario (d) — se anula en el teardown. */
  let pedidoAdHocId: string | null = null;
  /** Id del pedido ad-hoc del escenario (e2, cliente dado de baja) — idem. */
  let pedidoInactivoId: string | null = null;

  // Teardown garantizado aun si un assert falla a mitad de camino: un
  // `PedidoVenta` se da de baja lógica con `estado: "ANULADO"` (+ bloque de
  // soft delete), la convención de Módulo B (schema.prisma §PedidoVenta).
  t.after(async () => {
    for (const id of [pedidoAdHocId, pedidoInactivoId]) {
      if (!id) continue;
      await prisma.pedidoVenta.update({
        where: { id },
        data: {
          estado: "ANULADO",
          is_active: false,
          deleted_at: new Date(),
          deleted_by: USUARIO_CAJERO_SEED_ID,
          deletion_reason: "Cleanup de la suite HU-C7: pedido ad-hoc anulado (nunca DELETE)",
        },
      });
    }
    for (const id of clientesFixture) {
      await prisma.cliente.update({
        where: { id },
        data: {
          is_active: false,
          deleted_at: new Date(),
          deleted_by: USUARIO_CAJERO_SEED_ID,
          deletion_reason: "Cleanup de la suite HU-C7 (baja lógica, nunca DELETE)",
        },
      });
    }
  });

  /** DNI de 8 dígitos, distinto por corrida — fixtures ad-hoc. */
  let secuenciaDni = 0;
  function dniNuevo(): string {
    secuenciaDni += 1;
    return String(10_000_000 + ((Date.now() + secuenciaDni * 1013) % 89_999_999)).slice(0, 8);
  }

  // ── (a) Ficha de Juan Pérez ─────────────────────────────────────────────
  const juan = await clienteService.consultarClientePorDni("30123456");
  assert.equal(juan.cliente_id, CLIENTE_JUAN_PEREZ_ID, "debe resolver el cliente del seed por DNI");
  assert.equal(juan.dni, "30123456");
  assert.equal(juan.nombre, "Juan Pérez");
  assert.equal(juan.telefono, "3874001234");
  assert.equal(juan.email, "juan.perez@example.com");
  assert.equal(juan.canal_preferido, "WHATSAPP");
  assert.equal(juan.direcciones.length, 2, "Juan Pérez tiene 2 direcciones activas en el seed");
  assert.deepEqual(
    juan.direcciones.map((direccion) => direccion.tipo),
    ["FACTURACION", "ENVIO"],
    "listarDireccionesCliente ordena por created_at asc",
  );
  for (const direccion of juan.direcciones) {
    assert.equal(typeof direccion.direccion_id, "string");
    assert.ok(direccion.direccion_id.length > 0, "cada dirección expone su direccion_id");
    assert.deepEqual(
      Object.keys(direccion).sort(),
      ["direccion_id", "rotulo", "tipo"],
      "la ficha NO debe filtrar is_active ni created_at",
    );
  }
  assert.equal(juan.historial_compras.cantidad_operaciones, 2);
  assert.equal(juan.historial_compras.monto_total_historico, 458000);

  // `ultima_compra` contra una LECTURA a la base: el seed usa fechas
  // relativas (`diasAtras`), así que hardcodear un ISO sería frágil.
  const maxEnBase = await prisma.pedidoVenta.aggregate({
    where: { cliente_id: CLIENTE_JUAN_PEREZ_ID, estado: { in: [...ESTADOS_EFECTIVOS] } },
    _max: { fecha_facturacion: true },
  });
  assert.ok(maxEnBase._max.fecha_facturacion, "el seed debe tener pedidos efectivos de Juan Pérez");
  assert.equal(
    juan.historial_compras.ultima_compra?.getTime(),
    maxEnBase._max.fecha_facturacion.getTime(),
    "ultima_compra debe ser el máximo de fecha_facturacion de los pedidos efectivos",
  );

  // Minimización del payload: nada de segmento / detalle de soft delete /
  // fusión. `is_active` SÍ se expone (HU-C6) para que el frontend pueda mostrar
  // "cliente inactivo".
  assert.equal("segmento" in juan, false);
  assert.equal("fusionado_en_id" in juan, false);
  assert.equal(juan.is_active, true);
  assert.equal("deleted_at" in juan, false);

  // ── (b) María Gómez: su único pedido está RESERVADO → excluido ──────────
  const maria = await clienteService.consultarClientePorDni("27555111");
  assert.equal(maria.cliente_id, CLIENTE_MARIA_GOMEZ_PRIMARIO_ID);
  assert.equal(maria.canal_preferido, "EMAIL");
  assert.deepEqual(
    maria.historial_compras,
    { ultima_compra: null, monto_total_historico: 0, cantidad_operaciones: 0 },
    "un pedido RESERVADO no cuenta como compra efectiva",
  );

  // ── (c) Cliente activo sin pedidos → 0/0/null ───────────────────────────
  const clienteSinCompras = await prisma.cliente.create({
    data: { dni: dniNuevo(), nombre: "Cliente HU-C7 sin compras" },
    select: { id: true, dni: true },
  });
  clientesFixture.push(clienteSinCompras.id);
  const sinCompras = await clienteService.consultarClientePorDni(clienteSinCompras.dni);
  assert.deepEqual(sinCompras.direcciones, [], "un cliente sin direcciones devuelve arreglo vacío");
  assert.deepEqual(sinCompras.historial_compras, {
    ultima_compra: null,
    monto_total_historico: 0,
    cantidad_operaciones: 0,
  });

  // ── (d) Clúster de fusión: pedido del secundario entra al primario ──────
  const totalAdHoc = 12345.67;
  const fechaAdHoc = new Date();
  const pedidoAdHoc = await prisma.pedidoVenta.create({
    data: {
      numero_venta: `HU-C7-${randomUUID()}`,
      cliente_id: CLIENTE_MARIA_GOMEZ_FUSIONADO_ID,
      estado: "FACTURADO",
      total: totalAdHoc,
      fecha_facturacion: fechaAdHoc,
      registrado_por_id: USUARIO_CAJERO_SEED_ID,
      is_active: true,
    },
    select: { id: true },
  });
  pedidoAdHocId = pedidoAdHoc.id;

  // Baseline del primario ANTES del clúster: su único pedido propio está
  // RESERVADO, así que un pedido FACTURADO del secundario debe mover el
  // historial de 0 a exactamente 1 operación.
  const mariaConCluster = await clienteService.consultarClientePorDni("27555111");
  assert.equal(
    mariaConCluster.historial_compras.cantidad_operaciones,
    1,
    "el pedido efectivo del secundario fusionado debe contar en el primario",
  );
  assert.equal(mariaConCluster.historial_compras.monto_total_historico, totalAdHoc);
  assert.equal(
    mariaConCluster.historial_compras.ultima_compra?.getTime(),
    fechaAdHoc.getTime(),
    "ultima_compra del primario debe incluir la fecha del pedido del secundario",
  );

  // El helper resuelve el clúster internamente a partir del primario.
  const historialDirecto = await clienteService.resolverHistorialCompras(
    CLIENTE_MARIA_GOMEZ_PRIMARIO_ID,
  );
  assert.deepEqual(historialDirecto, mariaConCluster.historial_compras);

  // ── (e) DNI válido sin cliente activo → CLIENTE_NO_ENCONTRADO ───────────
  let codigoInexistente: string | null = null;
  let mensajeInexistente = "";
  try {
    await clienteService.consultarClientePorDni("99999999");
  } catch (err) {
    codigoInexistente = (err as { code?: string } | null)?.code ?? null;
    mensajeInexistente = (err as { message?: string } | null)?.message ?? "";
  }
  assert.equal(codigoInexistente, "CLIENTE_NO_ENCONTRADO");
  assert.match(
    mensajeInexistente,
    /99999999/,
    "el mensaje de CLIENTE_NO_ENCONTRADO debe incluir el DNI consultado (spec §2.7)",
  );

  // ── (e2) HU-C6: un cliente dado de baja SIGUE siendo consultable ────────
  // Regresión del bug de alcance: la consulta filtraba `is_active: true`, así
  // que tras la baja devolvía 404 y el historial dejaba de verse (viola spec
  // Módulo C §2.3). Ahora devuelve ficha + historial con `is_active: false`.
  const clienteInactivo = await prisma.cliente.create({
    data: { dni: dniNuevo(), nombre: "Cliente HU-C7 dado de baja" },
    select: { id: true, dni: true },
  });
  clientesFixture.push(clienteInactivo.id);
  const totalInactivo = 5000;
  const pedidoInactivo = await prisma.pedidoVenta.create({
    data: {
      numero_venta: `HU-C7-${randomUUID()}`,
      cliente_id: clienteInactivo.id,
      estado: "FACTURADO",
      total: totalInactivo,
      fecha_facturacion: new Date(),
      registrado_por_id: USUARIO_CAJERO_SEED_ID,
      is_active: true,
    },
    select: { id: true },
  });
  pedidoInactivoId = pedidoInactivo.id;

  await clienteService.bajaCliente(
    clienteInactivo.id,
    USUARIO_CAJERO_SEED_ID,
    "Baja de prueba HU-C7 (cliente inactivo sigue consultable)",
  );

  const inactivo = await clienteService.consultarClientePorDni(clienteInactivo.dni);
  assert.equal(inactivo.cliente_id, clienteInactivo.id, "el cliente inactivo se sigue resolviendo por DNI");
  assert.equal(inactivo.is_active, false, "la ficha marca al cliente como inactivo");
  assert.equal(inactivo.nombre, "Cliente HU-C7 dado de baja");
  assert.equal(inactivo.historial_compras.cantidad_operaciones, 1, "el historial permanece accesible");
  assert.equal(inactivo.historial_compras.monto_total_historico, totalInactivo);

  // ── (f) Doble consulta idempotente + cero filas de auditoría ────────────
  const asientosAntes = await prisma.auditLog.count({ where: { tabla_afectada: "clientes" } });
  const primera = await clienteService.consultarClientePorDni("30123456");
  const segunda = await clienteService.consultarClientePorDni("30123456");
  assert.deepEqual(segunda, primera, "dos consultas consecutivas deben devolver lo mismo");
  const asientosDespues = await prisma.auditLog.count({ where: { tabla_afectada: "clientes" } });
  assert.equal(
    asientosDespues,
    asientosAntes,
    "una consulta de solo lectura no debe agregar filas a audit_logs",
  );

  console.info("[HU-C7:EVIDENCIA]", JSON.stringify({
    juan_direcciones: juan.direcciones.length,
    juan_operaciones: juan.historial_compras.cantidad_operaciones,
    juan_monto: juan.historial_compras.monto_total_historico,
    maria_sin_cluster: maria.historial_compras.cantidad_operaciones,
    maria_con_cluster: mariaConCluster.historial_compras.cantidad_operaciones,
    inexistente_code: codigoInexistente,
    asientos_antes: asientosAntes,
    asientos_despues: asientosDespues,
  }));
});
