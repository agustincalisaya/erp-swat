import assert from "node:assert/strict";
import test from "node:test";
import { FiltrosAuditoriaClientesSchema } from "../../schemas/auditoria-clientes.schema.ts";
import { construirFiltroAuditoriaClientes, construirFiltroNombreCliente, valoresVisiblesAuditoriaCliente } from "./auditoria-clientes.reglas.ts";

test("HU-C10: el resumen CRM omite valores del resultado y del JSON", () => {
  const anterior = { nombre: "Anterior" };
  const nuevo = { nombre: "Nuevo", deletion_reason: "Motivo histórico" };
  const resumen = valoresVisiblesAuditoriaCliente(false, anterior, nuevo);
  assert.deepEqual(resumen, {});
  assert.equal(JSON.stringify(resumen), "{}");
});

test("HU-C10: el detalle autorizado conserva los valores del asiento", () => {
  const anterior = { nombre: "Anterior" };
  const nuevo = { nombre: "Nuevo" };
  assert.deepEqual(valoresVisiblesAuditoriaCliente(true, anterior, nuevo), {
    valor_anterior: anterior,
    valor_nuevo: nuevo,
  });
});

test("HU-C10: rechaza operaciones y tablas fuera del alcance aun por URL directa", () => {
  for (const entrada of [
    { modulo: "clientes", accion: "CONSENTIMIENTO_ACEPTACION_INICIAL" },
    { modulo: "clientes", tabla_afectada: "ventas" },
    { modulo: "clientes", verificar_integridad: "true" },
    { modulo: "clientes", cliente_id: "e1953b02-856e-4b4f-9e5b-27c14886c6a5" },
    { modulo: "clientes", usuario_nombre: "Admin" },
  ]) {
    assert.equal(FiltrosAuditoriaClientesSchema.safeParse(entrada).success, false);
  }
});

test("HU-C10: tabla y acciones de Clientes permanecen fijas con filtros combinados", () => {
  const clienteIds = ["e1953b02-856e-4b4f-9e5b-27c14886c6a5", "b40d50ec-92dd-49c5-a39a-3335305a8ec9"];
  const usuarioId = "32bca979-0dba-4c35-82f5-8456ccf608ac";
  const filtros = FiltrosAuditoriaClientesSchema.parse({
    modulo: "clientes", cliente_nombre: "  maRIA  ", usuario_id: usuarioId,
    accion: "UPDATE", fecha_desde: "2026-09-01", fecha_hasta: "2026-09-24",
    page: "2", page_size: "10",
  });
  assert.equal(filtros.page, 2);
  assert.equal(filtros.page_size, 10);
  assert.equal(filtros.cliente_nombre, "maRIA");
  assert.deepEqual(construirFiltroNombreCliente(filtros.cliente_nombre!), {
    nombre: { contains: "maRIA", mode: "insensitive" },
  });
  assert.deepEqual(construirFiltroAuditoriaClientes(filtros, clienteIds), {
    tabla_afectada: "clientes",
    accion: { in: ["UPDATE"] },
    registro_id: { in: clienteIds },
    usuario_id: usuarioId,
    created_at: {
      gte: new Date("2026-09-01T00:00:00.000Z"),
      lte: new Date("2026-09-24T23:59:59.999Z"),
    },
  });
  const todos = FiltrosAuditoriaClientesSchema.parse({ modulo: "clientes" });
  assert.deepEqual(construirFiltroAuditoriaClientes(todos), {
    tabla_afectada: "clientes",
    accion: { in: ["CREATE", "UPDATE", "DELETE_LOGICO"] },
  });
  assert.deepEqual(construirFiltroAuditoriaClientes(filtros, []).registro_id, { in: [] });
});
