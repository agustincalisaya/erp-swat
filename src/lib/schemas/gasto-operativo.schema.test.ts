import assert from "node:assert/strict";
import { test } from "node:test";
import { CrearGastoOperativoSchema, EditarGastoOperativoSchema, DarDeBajaGastoOperativoSchema } from "./gasto-operativo.schema.ts";

const categoria_gasto_id = "0d579e83-dd2d-4269-8982-8d023d73c2dd";
const base = { categoria_gasto_id, fecha: "2026-10-18", monto: "0.01", descripcion: " Insumo " };
test("HU-G13 exige campos y escala monetaria", () => {
  assert.equal(CrearGastoOperativoSchema.parse(base).descripcion, "Insumo");
  for (const monto of ["0", "-1", "1.001", "1e2", "10000000000"]) assert.equal(CrearGastoOperativoSchema.safeParse({ ...base, monto }).success, false);
  assert.equal(CrearGastoOperativoSchema.safeParse({ ...base, descripcion: "   " }).success, false);
  assert.equal(EditarGastoOperativoSchema.safeParse({}).success, false);
  assert.equal(DarDeBajaGastoOperativoSchema.safeParse({ deletion_reason: "  abc " }).success, false);
});
