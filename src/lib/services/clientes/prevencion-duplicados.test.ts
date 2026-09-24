import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { consultarPrevencionAlta, esPosibleCoincidencia } from "./prevencion-duplicados.service.ts";
import { crearClienteTx } from "./cliente.service.ts";

type Fila = { id: string; dni: string; nombre: string; telefono: string | null; email: string | null; is_active: boolean };

function baseSoloLectura(filas: Fila[]) {
  const original = structuredClone(filas);
  const lecturas: string[] = [];
  const db = { cliente: {
    findUnique: async ({ where }: { where: { dni: string } }) => {
      lecturas.push("findUnique");
      const c = filas.find((fila) => fila.dni === where.dni);
      return c ? { id: c.id, is_active: c.is_active } : null;
    },
    findMany: async ({ where }: { where: { dni: { not: string } } }) => {
      lecturas.push("findMany");
      return filas.filter((fila) => fila.dni !== where.dni.not);
    },
    create: () => { throw new Error("La prevención no debe crear clientes"); },
    update: () => { throw new Error("La prevención no debe modificar clientes"); },
  } } as unknown as PrismaClient;
  return { db, lecturas, sinCambios: () => assert.deepEqual(filas, original) };
}

test("DNI existente activo e inactivo: advertencia sin escritura ni reactivación", async () => {
  const filas = [
    { id: "activo", dni: "30123456", nombre: "Ana Ruiz", telefono: null, email: null, is_active: true },
    { id: "inactivo", dni: "30987654", nombre: "Eva Diaz", telefono: null, email: null, is_active: false },
  ];
  const base = baseSoloLectura(filas);
  assert.deepEqual((await consultarPrevencionAlta(base.db, { dni: "30123456" })).existente, { id: "activo", is_active: true });
  assert.deepEqual((await consultarPrevencionAlta(base.db, { dni: "30987654" })).existente, { id: "inactivo", is_active: false });
  assert.deepEqual(base.lecturas, ["findUnique", "findUnique"]);
  base.sinCambios();
});

test("DNI nuevo: coincidencias independientes por nombre, teléfono y email; alta no bloqueada", async () => {
  const base = baseSoloLectura([
    { id: "nombre", dni: "30123456", nombre: "María Gómez", telefono: null, email: null, is_active: true },
    { id: "telefono", dni: "30987654", nombre: "Otra Persona", telefono: "(387) 400-1234", email: null, is_active: true },
    { id: "email", dni: "30777777", nombre: "Tercera Persona", telefono: null, email: "ANA@EXAMPLE.COM", is_active: false },
  ]);
  const r = await consultarPrevencionAlta(base.db, {
    dni: "30888888", nombre: "Maria Gomes", telefono: "3874001234", email: "ana@example.com",
  });
  assert.equal(r.existente, null);
  assert.deepEqual(r.posibles.map((c) => c.cliente_id), ["nombre", "telefono", "email"]);
  assert.equal(esPosibleCoincidencia({ dni: "30888888", nombre: "Pedro" }, { nombre: "Juan", telefono: null, email: null }), false);
  base.sinCambios();
});

test("DNI nuevo sin coincidencias permite continuar con HU-C1", async () => {
  const base = baseSoloLectura([]);
  assert.deepEqual(await consultarPrevencionAlta(base.db, { dni: "30888888", nombre: "Nueva Persona" }),
    { existente: null, posibles: [] });
  base.sinCambios();
});

test("HU-C1 recupera DNI existente sin modificar cliente ni consentimientos", async () => {
  for (const activo of [true, false]) {
    let escrituras = 0;
    const tx = { cliente: {
      findUnique: async () => ({ id: activo ? "activo" : "inactivo", dni: "30123456" }),
      create: () => { escrituras++; throw new Error("No debe crear"); },
      update: () => { escrituras++; throw new Error("No debe editar"); },
    }, consentimientoCliente: { create: () => { escrituras++; throw new Error("No debe consentir"); } },
    eventoConsentimientoCliente: { create: () => { escrituras++; throw new Error("No debe registrar"); } } } as unknown as Prisma.TransactionClient;
    const resultado = await crearClienteTx(tx, { dni: "30123456", nombre: "Otro Nombre",
      acepta_tratamiento_datos: true, decision_comercial: "ACEPTA" }, "actor");
    assert.equal(resultado.esNuevo, false);
    assert.equal(escrituras, 0);
  }
});

test("HU-C1 permite alta con DNI nuevo y registra las decisiones exigidas", async () => {
  const escrituras: string[] = [];
  const tx = { cliente: {
    findUnique: async () => null,
    create: async () => { escrituras.push("cliente"); return { id: "nuevo", dni: "30888888" }; },
  }, consentimientoCliente: {
    create: async () => { escrituras.push("consentimiento"); return { id: "consentimiento" }; },
  }, eventoConsentimientoCliente: {
    create: async () => { escrituras.push("evento"); return { id: "evento" }; },
  } } as unknown as Prisma.TransactionClient;
  const resultado = await crearClienteTx(tx, { dni: "30888888", nombre: "Nueva Persona",
    acepta_tratamiento_datos: true, decision_comercial: "RECHAZA" }, "actor");
  assert.equal(resultado.esNuevo, true);
  assert.deepEqual(escrituras, ["cliente", "consentimiento", "evento", "evento"]);
});
