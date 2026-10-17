import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { Prisma } from "@prisma/client";

/**
 * Bug H7 (HU-F3): `canonicalizarJson()` convertía un `Date` en `{}` y un
 * `Prisma.Decimal` en `{d,e,s}`, mientras que Prisma persiste en jsonb su
 * `toJSON()`. El hash del insert (con el objeto) y el de `verificar-cadena`
 * (con el string releído del jsonb) tienen que coincidir.
 *
 * `hash-chain.ts` importa `server-only`, que fuera de la condición
 * `react-server` lanza al cargarse: se resuelve a un módulo vacío solo para
 * este archivo, en vez del patrón source-regex del resto de la suite.
 */
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
      return nextResolve(specifier, context);
    }`),
);

const { calcularHashEncadenado, HASH_GENESIS } = await import("./hash-chain.ts");

const base = {
  usuario_id: "11111111-1111-1111-1111-111111111111",
  tabla_afectada: "usuarios",
  registro_id: "11111111-1111-1111-1111-111111111111",
  ip: "127.0.0.1",
};

/** Lo que devuelve Prisma al releer el valor desde la columna jsonb. */
const releidoDeJsonb = (valor: unknown) => JSON.parse(JSON.stringify(valor));

test("Date: hashear el objeto Date da lo mismo que hashear el texto ISO releído del jsonb", () => {
  const bloqueadoHasta = new Date("2026-10-03T15:30:00.000Z");
  const alInsertar = {
    ...base,
    accion: "SUSPENSION_AUTOMATICA",
    valor_anterior: null,
    valor_nuevo: { intentos_fallidos: 5, bloqueado_hasta: bloqueadoHasta },
  };
  const alVerificar = { ...alInsertar, valor_nuevo: releidoDeJsonb(alInsertar.valor_nuevo) };

  assert.equal(alVerificar.valor_nuevo.bloqueado_hasta, "2026-10-03T15:30:00.000Z");
  assert.equal(
    calcularHashEncadenado(alInsertar, HASH_GENESIS),
    calcularHashEncadenado(alVerificar, HASH_GENESIS),
  );
});

test("Date: dos fechas distintas producen hashes distintos (no colapsan a {})", () => {
  const conFecha = (iso: string) => ({
    ...base,
    accion: "SUSPENSION_AUTOMATICA",
    valor_anterior: null,
    valor_nuevo: { intentos_fallidos: 5, bloqueado_hasta: new Date(iso) },
  });

  assert.notEqual(
    calcularHashEncadenado(conFecha("2026-10-03T15:30:00.000Z"), HASH_GENESIS),
    calcularHashEncadenado(conFecha("2026-10-03T15:45:00.000Z"), HASH_GENESIS),
  );
});

test("Decimal: hashear un Prisma.Decimal da lo mismo que hashear el string numérico releído del jsonb", () => {
  const alInsertar = {
    ...base,
    tabla_afectada: "productos_maestros",
    accion: "UPDATE",
    valor_anterior: { costo_estandar_referencia: new Prisma.Decimal("1234.50") },
    valor_nuevo: { costo_estandar_referencia: 1500 },
  };
  const alVerificar = { ...alInsertar, valor_anterior: releidoDeJsonb(alInsertar.valor_anterior) };

  assert.equal(alVerificar.valor_anterior.costo_estandar_referencia, "1234.5");
  assert.equal(
    calcularHashEncadenado(alInsertar, HASH_GENESIS),
    calcularHashEncadenado(alVerificar, HASH_GENESIS),
  );
});
