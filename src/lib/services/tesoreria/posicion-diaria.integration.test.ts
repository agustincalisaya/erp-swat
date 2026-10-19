import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-G7 — Posición diaria consolidada contra una base REAL (mismo patrón que
 * `cuenta-propia.integration.test.ts`). Este gate NO corre con `npm test`:
 * requiere que el shell exporte `HU_G7_INTEGRATION_DATABASE_URL` (o, por
 * compatibilidad con los scripts de G5, `HU_G5_INTEGRATION_DATABASE_URL`). Si no
 * hay ninguna, el archivo FALLA con un mensaje explícito en vez de saltarse en
 * silencio — un gate que no se ejecuta no puede reportar verde. Los imports son
 * dinámicos porque `posicion-diaria.service.ts` usa `import "server-only"`.
 *
 * Cubre, contra la base sembrada:
 *  - Matriz RBAC de G7 (G7-10) resuelta por PERMISO, nunca por rol: GET
 *    (`tesoreria:leer_reportes`) para Cajero POS, Tesorero, Auditor,
 *    Administrador y Gerente; POST (`tesoreria:registrar_saldo_diario`) SOLO
 *    Tesorero Central. La verificación de estados HTTP 401/403 la garantiza el
 *    HOF compartido `withPermission` (cubierto por
 *    `cuenta-propia.http.integration.test.ts`); acá se valida la DECISIÓN de
 *    autorización por permiso, que es la que la ruta consume.
 *  - Registro append-only de un saldo (`registrarSaldoDiario`) y su asiento de
 *    auditoría D.3 (`AuditLog.tabla_afectada = "saldos_diarios_cuenta"`).
 *  - `obtenerPosicionDiaria`: el JSON NUNCA expone CBU/alias.
 *  - Validación 400: 3.º decimal y día futuro (schema), cuenta inactiva
 *    (servicio → `CUENTA_PROPRIA_NO_ENCONTRADA`).
 *
 * Corre con: `npm run test:integration:g7` (opt-in, base migrada y sembrada).
 */

const DATABASE_URL =
  process.env.HU_G7_INTEGRATION_DATABASE_URL ?? process.env.HU_G5_INTEGRATION_DATABASE_URL;

// Falla FUERTE (nunca `skip` silencioso) si falta la configuración del gate.
if (!DATABASE_URL) {
  test("HU-G7 integración DB — configuración faltante (gate no ejecutado)", () => {
    assert.fail(
      "Falta HU_G7_INTEGRATION_DATABASE_URL (o HU_G5_INTEGRATION_DATABASE_URL). Este gate NO " +
        "se ejecuta con 'npm test'; exportá la variable y volvé a correr 'npm run test:integration:g7'.",
    );
  });
}

/** Espera acotada hasta que `contar()` alcance `minimo` (asiento asíncrono). */
async function esperarContador(contar: () => Promise<number>, minimo: number, timeoutMs: number): Promise<number> {
  const limite = Date.now() + timeoutMs;
  let actual = await contar();
  while (actual < minimo && Date.now() < limite) {
    await new Promise((resolver) => setTimeout(resolver, 25));
    actual = await contar();
  }
  return actual;
}

test(
  "HU-G7 — posición diaria: RBAC, registro append-only, auditoría y sin datos bancarios",
  { skip: !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      posicionDiaria,
      { usuarioTienePermiso },
      { RegistrarSaldoDiarioSchema },
      { iniciarAuditLogListener },
      { ServiceError },
      { diaNegocioIso },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./posicion-diaria.service.ts"),
      import("../../auth/with-permission.ts"),
      import("../../schemas/posicion-diaria.schema.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../../errors/service-error.ts"),
      import("../../utils/fecha-negocio.ts"),
    ]);
    iniciarAuditLogListener();
    t.after(async () => {
      await prisma.$disconnect();
    });

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    console.log(`[hu-g7] current_database() = ${db}`);

    const usuario = async (nombre_usuario: string) =>
      prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario }, select: { id: true } });
    const [tesorero, cajero, auditor, administrador, gerente] = await Promise.all([
      usuario("tesorero.seed"),
      usuario("cajero.seed"),
      usuario("auditor.seed"),
      usuario("administrador.seed"),
      usuario("gerente.seed"),
    ]);

    // ── Matriz RBAC por permiso (G7-10) ──────────────────────────────────────
    await t.test("GET (leer_reportes) para 5 roles; POST (registrar_saldo_diario) solo Tesorero", async () => {
      for (const actor of [cajero, tesorero, auditor, administrador, gerente]) {
        assert.equal(
          await usuarioTienePermiso(actor.id, posicionDiaria.PERMISO_LEER_REPORTES),
          true,
          `${actor.id} debería leer la posición`,
        );
      }
      assert.equal(await usuarioTienePermiso(tesorero.id, posicionDiaria.PERMISO_REGISTRAR_SALDO_DIARIO), true);
      for (const actor of [cajero, auditor, administrador, gerente]) {
        assert.equal(
          await usuarioTienePermiso(actor.id, posicionDiaria.PERMISO_REGISTRAR_SALDO_DIARIO),
          false,
          `${actor.id} NO debería registrar saldos`,
        );
      }
    });

    const dia = diaNegocioIso();

    // ── Registro append-only + asiento de auditoría D.3 ──────────────────────
    await t.test("registrarSaldoDiario audita en saldos_diarios_cuenta (asiento asíncrono)", async () => {
      const cuenta = await prisma.cuentaPropia.findUniqueOrThrow({
        where: { id: "banco-nacion-cc-principal" },
        select: { id: true, is_active: true },
      });
      assert.equal(cuenta.is_active, true, "la cuenta sembrada debe estar activa");

      const contarAsientos = () =>
        prisma.auditLog.count({
          where: { accion: "CREATE", tabla_afectada: "saldos_diarios_cuenta", registro_id: cuenta.id },
        });
      const antes = await contarAsientos();

      const registrado = await posicionDiaria.registrarSaldoDiario(
        { cuenta_id: cuenta.id, fecha: dia, saldo: "1234567.89" },
        tesorero.id,
      );
      assert.equal(registrado.cuenta_id, cuenta.id);
      assert.equal(registrado.saldo, "1234567.89");

      const despues = await esperarContador(contarAsientos, antes + 1, 5_000);
      assert.ok(despues > antes, "no se escribió el asiento saldos_diarios_cuenta en 5s");

      const asiento = await prisma.auditLog.findFirstOrThrow({
        where: { accion: "CREATE", tabla_afectada: "saldos_diarios_cuenta", registro_id: cuenta.id },
        orderBy: { created_at: "desc" },
        select: { usuario_id: true, valor_nuevo: true },
      });
      assert.equal(asiento.usuario_id, tesorero.id, "el actor es el Tesorero");
      const detalle = asiento.valor_nuevo as Record<string, unknown>;
      assert.deepEqual(Object.keys(detalle).sort(), ["fecha", "saldo"]);
      assert.equal(detalle.saldo, "1234567.89");
    });

    // ── Lectura: sin datos bancarios ─────────────────────────────────────────
    await t.test("obtenerPosicionDiaria no expone CBU/alias en el JSON", async () => {
      const posicion = await posicionDiaria.obtenerPosicionDiaria(dia);
      assert.equal(posicion.corte.liquido, dia);
      assert.equal(posicion.corte.proyecciones, "ESTADO_ACTUAL");
      assert.ok(posicion.cuentas.length >= 3, "aparecen las 3 cuentas sembradas activas");
      const json = JSON.stringify(posicion).toLowerCase();
      for (const prohibido of ["cbu", "alias", "0110599520", "0070309530", "nacion.cc", "galicia.cc"]) {
        assert.ok(!json.includes(prohibido), `el JSON no debe contener "${prohibido}"`);
      }
    });

    // ── Validación 400 ───────────────────────────────────────────────────────
    await t.test("3.º decimal y día futuro los rechaza el schema; cuenta inactiva el servicio", async () => {
      assert.equal(
        RegistrarSaldoDiarioSchema.safeParse({ cuenta_id: "c1", fecha: dia, saldo: "10.123" }).success,
        false,
      );
      const futuro = new Date(`${dia}T00:00:00.000Z`);
      futuro.setUTCDate(futuro.getUTCDate() + 1);
      assert.equal(
        RegistrarSaldoDiarioSchema.safeParse({
          cuenta_id: "c1",
          fecha: futuro.toISOString().slice(0, 10),
          saldo: "10.00",
        }).success,
        false,
      );

      const inactiva = await prisma.cuentaPropia.upsert({
        where: { id: "g7-integracion-cuenta-inactiva" },
        update: { is_active: false, deleted_at: new Date(), deletion_reason: "fixture g7" },
        create: {
          id: "g7-integracion-cuenta-inactiva",
          nombre: "Cuenta inactiva (fixture G7)",
          tipo: "CAJA",
          is_active: false,
          deleted_at: new Date(),
          deletion_reason: "fixture g7",
        },
      });
      await assert.rejects(
        () => posicionDiaria.registrarSaldoDiario({ cuenta_id: inactiva.id, fecha: dia, saldo: "10.00" }, tesorero.id),
        (error: unknown) => error instanceof ServiceError && error.code === "CUENTA_PROPRIA_NO_ENCONTRADA",
      );
    });
  },
);
