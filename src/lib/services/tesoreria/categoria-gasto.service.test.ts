import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { CrearCategoriaGastoSchema, EditarCategoriaGastoSchema, DarDeBajaCategoriaGastoSchema } from "@/lib/schemas/categoria-gasto.schema";
import { normalizarNombre, esP2002 } from "./categoria-gasto.service";

test("HU-G12 normaliza espacios extremos y mayúsculas para la unicidad", () => {
  assert.equal(normalizarNombre("  SERVICIOS  "), normalizarNombre("servicios"));
  assert.equal(CrearCategoriaGastoSchema.parse({ nombre: "  Servicios  " }).nombre, "Servicios");
});

test("HU-G12 exige motivo de al menos cinco caracteres después de trim", () => {
  assert.equal(DarDeBajaCategoriaGastoSchema.safeParse({ deletion_reason: " abcd " }).success, false);
  assert.equal(DarDeBajaCategoriaGastoSchema.parse({ deletion_reason: " cierre " }).deletion_reason, "cierre");
});

test("HU-G12 permite vaciar descripción y rechaza edición sin campos", () => {
  assert.equal(EditarCategoriaGastoSchema.parse({ descripcion: "" }).descripcion, "");
  assert.equal(EditarCategoriaGastoSchema.safeParse({}).success, false);
});

test("HU-G12 identifica P2002 para traducir la carrera del índice único", () => {
  const colision = new Prisma.PrismaClientKnownRequestError("duplicado", { code: "P2002", clientVersion: "6.19.3" });
  assert.equal(esP2002(colision), true);
  assert.equal(esP2002(new Error("otro error")), false);
});
