import assert from "node:assert/strict";
import test from "node:test";
import { FiltrosAuditoriaClientesSchema } from "../../schemas/auditoria-clientes.schema.ts";
import { construirFiltroAuditoriaClientes } from "./auditoria-clientes.reglas.ts";

test("HU-C10: rechaza operaciones y tablas fuera del alcance aun por URL directa", () => {
  for (const entrada of [
    { modulo: "clientes", accion: "CONSENTIMIENTO_ACEPTACION_INICIAL" },
    { modulo: "clientes", tabla_afectada: "ventas" },
    { modulo: "clientes", verificar_integridad: "true" },
  ]) {
    assert.equal(FiltrosAuditoriaClientesSchema.safeParse(entrada).success, false);
  }
});

test("HU-C10: tabla y acciones de Clientes permanecen fijas con filtros combinados", () => {
  const clienteId = "e1953b02-856e-4b4f-9e5b-27c14886c6a5";
  const usuarioId = "32bca979-0dba-4c35-82f5-8456ccf608ac";
  const filtros = FiltrosAuditoriaClientesSchema.parse({
    modulo: "clientes", cliente_id: clienteId, usuario_id: usuarioId,
    accion: "UPDATE", fecha_desde: "2026-09-01", fecha_hasta: "2026-09-24",
    page: "2", page_size: "10",
  });
  assert.equal(filtros.page, 2);
  assert.equal(filtros.page_size, 10);
  assert.deepEqual(construirFiltroAuditoriaClientes(filtros), {
    tabla_afectada: "clientes",
    accion: { in: ["UPDATE"] },
    registro_id: clienteId,
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
});
