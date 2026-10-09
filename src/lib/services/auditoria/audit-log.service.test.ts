import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * HU-E13 T18 (PLAN §9.4) — contrato estructural del append al ledger. La
 * garantía multiproceso real se prueba con procesos OS distintos en
 * `hu-e13.concurrencia.integration.test.ts`; acá se fija el orden exacto.
 */
const fuente = readFileSync(new URL("./audit-log.service.ts", import.meta.url), "utf8");
const anexar = fuente.slice(
  fuente.indexOf("async function anexarRegistroAuditLog"),
  fuente.indexOf("// Lectura — listarAuditLog"),
);

test("cada append corre en una transacción propia, salvo que el llamador aporte la suya", () => {
  assert.match(fuente, /prisma\.\$transaction\(\(t\) => anexarRegistroAuditLog\(t, params, null\), OPCIONES_TRANSACCION_LEDGER\)/);
  assert.match(fuente, /prisma\.\$transaction\(\(t\) => anexarRegistroAuditLog\(t, params, params\), OPCIONES_TRANSACCION_LEDGER\)/);
  assert.match(fuente, /if \(tx\) \{\s*await anexarRegistroAuditLog\(tx, params, null\);/);
  assert.doesNotMatch(fuente, /pg_advisory_unlock/);
});

test("lock fijo del ledger → deduplicación → anterior → hash → INSERT, en ese orden", () => {
  assert.match(fuente, /CLAVE_ADVISORY_LEDGER_AUDITLOG = \[0x41554449, 0x544c4f47\] as const/);
  const posiciones = [
    anexar.indexOf("pg_advisory_xact_lock(${claveA}::int4, ${claveB}::int4)"),
    anexar.indexOf("if (identidad)"),
    anexar.indexOf('orderBy: [{ created_at: "desc" }, { id: "desc" }]'),
    anexar.indexOf("calcularHashEncadenado("),
    anexar.indexOf("tx.auditLog.create("),
  ];
  assert.ok(posiciones.every((p) => p >= 0), JSON.stringify(posiciones));
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones);
  assert.doesNotMatch(anexar, /\bprisma\./, "todo el append usa el cliente de la transacción");
});

test("created_at estrictamente creciente bajo el lock y verificación con el mismo orden total", () => {
  assert.match(anexar, /clock_timestamp\(\) AT TIME ZONE 'UTC'\)::timestamp\(3\)/);
  assert.match(anexar, /new Date\(ultimoRegistro\.created_at\.getTime\(\) \+ 1\)/);
  assert.match(anexar, /created_at: createdAt/);
  const verificar = fuente.slice(fuente.indexOf("export async function verificarCadenaIntegridad"));
  assert.match(verificar, /orderBy: \[\{ created_at: "asc" \}, \{ id: "asc" \}\]/);
});
