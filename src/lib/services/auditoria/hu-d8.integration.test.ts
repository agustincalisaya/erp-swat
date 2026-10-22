import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-D8 T02 — historial propio contra una base real (opt-in:
 * `HU_D8_INTEGRATION_DATABASE_URL`; imports dinámicos porque el servicio usa
 * `import "server-only"`). Corre con `npm run test:integration:d8`.
 *
 * Fixtures: tres usuarios internos de test SIN roles (A y B con asientos, C
 * sin ninguno), upsert por ID fijo. Los asientos se escriben con
 * `registrarAuditLog()` — la única vía de escritura del ledger — y quedan en
 * `audit_logs` (append-only). Los usuarios no se borran: tienen asientos
 * (`onDelete: Restrict`) y el upsert los reutiliza en la próxima corrida, por
 * eso las aserciones usan un oráculo leído de la base y no conteos fijos.
 *
 * El modo forense se prueba con `auditor.seed` (`auditoria:leer_forense`)
 * como NO-REGRESIÓN: mismo resultado que la consulta forense original
 * (incluido el `lte` a medianoche UTC, deuda DT-2 de HU-D5).
 */

const DATABASE_URL = process.env.HU_D8_INTEGRATION_DATABASE_URL;

const USUARIO_AUDITOR_SEED_ID = "0e273fcf-b944-4580-a610-062f7a92a384";
const USUARIO_A_ID = "d8d8d8d8-0000-4a1a-8a1a-00000000000a";
const USUARIO_B_ID = "d8d8d8d8-0000-4a1a-8a1a-00000000000b";
const USUARIO_C_ID = "d8d8d8d8-0000-4a1a-8a1a-00000000000c";

const ACCION_A1 = "HU_D8_PRUEBA_A1";
const ACCION_A2 = "HU_D8_PRUEBA_A2";
const ACCION_B1 = "HU_D8_PRUEBA_B1";

const CLAVES_DTO_PROPIO = ["accion", "created_at", "id", "registro_id", "tabla_afectada"];

function diaMas(dia: string, dias: number): string {
  const base = new Date(`${dia}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

test(
  "HU-D8 — listarHistorialPropio / listarAccionesPropias / delegación de listarAuditLog contra una base real",
  { skip: !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, svc, { diaNegocioIso }, { ServiceError }] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./audit-log.service.ts"),
      import("../../utils/fecha-negocio.ts"),
      import("../../errors/service-error.ts"),
    ]);
    t.after(async () => prisma.$disconnect());

    for (const [id, alias] of [[USUARIO_A_ID, "a"], [USUARIO_B_ID, "b"], [USUARIO_C_ID, "c"]] as const) {
      await prisma.usuario.upsert({
        where: { id },
        update: {},
        create: {
          id,
          nombre_usuario: `hu.d8.test.${alias}`,
          email: `hu.d8.test.${alias}@erp-swat.local`,
          password_hash: "no-login",
          password_salt: "no-login",
          nombre_completo: `Usuario de test HU-D8 (${alias.toUpperCase()})`,
        },
      });
    }

    const asiento = (usuario_id: string, accion: string, n: number) =>
      svc.registrarAuditLog({
        usuario_id,
        accion,
        tabla_afectada: "hu_d8_pruebas",
        registro_id: `hu-d8-${accion}-${n}`,
        ip: "203.0.113.8",
        valor_anterior: { secreto: "anterior" },
        valor_nuevo: { secreto: "nuevo" },
      });
    for (let n = 1; n <= 3; n++) await asiento(USUARIO_A_ID, ACCION_A1, n);
    await asiento(USUARIO_A_ID, ACCION_A2, 1);
    for (let n = 1; n <= 2; n++) await asiento(USUARIO_B_ID, ACCION_B1, n);

    // Oráculo independiente, en el orden del contrato.
    const filasA = await prisma.auditLog.findMany({
      where: { usuario_id: USUARIO_A_ID },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: { id: true, created_at: true, accion: true },
    });
    const sesionA = { userId: USUARIO_A_ID, nombreUsuario: "hu.d8.test.a" };
    const filtrosBase = { page: 1, page_size: 100 };

    const leerVerificacion = async () => ({
      count: await prisma.auditLog.count(),
      cadena: await svc.verificarCadenaIntegridad(),
    });
    const antes = await leerVerificacion();

    await t.test("D8-1 — A solo ve lo suyo; un usuario_id de B en listarAuditLog se ignora", async () => {
      const propio = await svc.listarHistorialPropio(filtrosBase, USUARIO_A_ID);
      assert.equal(propio.total, filasA.length);
      assert.deepEqual(propio.registros.map((r) => r.id), filasA.slice(0, 100).map((r) => r.id));

      const conTercero = await svc.listarAuditLog({ ...filtrosBase, usuario_id: USUARIO_B_ID }, sesionA);
      assert.deepEqual(conTercero, propio);
      const idsB = new Set(
        (await prisma.auditLog.findMany({ where: { usuario_id: USUARIO_B_ID }, select: { id: true } })).map((r) => r.id),
      );
      assert.ok(conTercero.registros.every((r) => !idsB.has(r.id)));
    });

    await t.test("D8-2 — orden created_at DESC, id DESC; páginas sin solapamiento ni huecos; página fuera de rango vacía", async () => {
      const ids: string[] = [];
      const paginas = Math.ceil(Math.min(filasA.length, 20) / 2);
      for (let page = 1; page <= paginas; page++) {
        const r = await svc.listarHistorialPropio({ page, page_size: 2 }, USUARIO_A_ID);
        assert.equal(r.total, filasA.length);
        assert.equal(r.page, page);
        assert.equal(r.page_size, 2);
        ids.push(...r.registros.map((x) => x.id));
      }
      assert.deepEqual(ids, filasA.slice(0, ids.length).map((r) => r.id));
      assert.equal(new Set(ids).size, ids.length);

      const fuera = await svc.listarHistorialPropio({ page: 10_000, page_size: 25 }, USUARIO_A_ID);
      assert.deepEqual(fuera.registros, []);
      assert.equal(fuera.total, filasA.length);
    });

    await t.test("D8-4 — acción que A no tiene (de B) → vacío, sin error", async () => {
      const r = await svc.listarHistorialPropio({ ...filtrosBase, accion: ACCION_B1 }, USUARIO_A_ID);
      assert.deepEqual(r.registros, []);
      assert.equal(r.total, 0);
    });

    await t.test("D8-4 — filtro por acción propia devuelve solo esa acción", async () => {
      const r = await svc.listarHistorialPropio({ ...filtrosBase, accion: ACCION_A2 }, USUARIO_A_ID);
      assert.equal(r.total, filasA.filter((f) => f.accion === ACCION_A2).length);
      assert.ok(r.registros.every((x) => x.accion === ACCION_A2));
    });

    await t.test("D8-4 — selector: DISTINCT propio, ordenado, nunca acciones de B", async () => {
      const acciones = await svc.listarAccionesPropias(USUARIO_A_ID);
      assert.deepEqual(acciones, [...new Set(filasA.map((f) => f.accion))].sort());
      assert.ok(acciones.includes(ACCION_A1) && acciones.includes(ACCION_A2));
      assert.ok(!acciones.includes(ACCION_B1));
    });

    await t.test("usuario sin registros → listado y selector vacíos", async () => {
      const r = await svc.listarHistorialPropio(filtrosBase, USUARIO_C_ID);
      assert.deepEqual(r, { registros: [], total: 0, page: 1, page_size: 100 });
      assert.deepEqual(await svc.listarAccionesPropias(USUARIO_C_ID), []);
    });

    await t.test("D8-3 — frontera ART relativa al día de un asiento real", async () => {
      const fila = filasA[0]!;
      const dia = diaNegocioIso(fila.created_at);
      const ids = async (f: { fecha_desde?: string; fecha_hasta?: string }) =>
        (await svc.listarHistorialPropio({ ...filtrosBase, ...f }, USUARIO_A_ID)).registros.map((r) => r.id);

      assert.ok((await ids({ fecha_desde: dia, fecha_hasta: dia })).includes(fila.id), "mismo día");
      assert.ok((await ids({ fecha_hasta: dia })).includes(fila.id), "solo hasta = día");
      assert.ok(!(await ids({ fecha_hasta: diaMas(dia, -1) })).includes(fila.id), "hasta = día anterior");
      assert.ok(!(await ids({ fecha_desde: diaMas(dia, 1) })).includes(fila.id), "desde = día siguiente");
    });

    await t.test("D8-3 — rango invertido llegado al servicio → ServiceError VALIDATION_ERROR", async () => {
      await assert.rejects(
        svc.listarHistorialPropio({ ...filtrosBase, fecha_desde: "2026-10-21", fecha_hasta: "2026-10-20" }, USUARIO_A_ID),
        (err: unknown) => err instanceof ServiceError && err.code === "VALIDATION_ERROR",
      );
    });

    await t.test("D8-6 — cada registro trae exactamente las 5 claves del DTO propio (también vía listarAuditLog)", async () => {
      const propio = await svc.listarHistorialPropio(filtrosBase, USUARIO_A_ID);
      const delegado = await svc.listarAuditLog(filtrosBase, sesionA);
      for (const r of [...propio.registros, ...delegado.registros]) {
        assert.deepEqual(Object.keys(r).sort(), CLAVES_DTO_PROPIO);
      }
      assert.doesNotMatch(JSON.stringify(propio), /secreto|203\.0\.113\.8|hash_/);
    });

    await t.test("delegación — los días de FiltrosAuditoriaSchema (Date a medianoche UTC) se aplican como días ART", async () => {
      const dia = diaNegocioIso(filasA[0]!.created_at);
      const delegado = await svc.listarAuditLog(
        { ...filtrosBase, fecha_desde: new Date(`${dia}T00:00:00.000Z`), fecha_hasta: new Date(`${dia}T00:00:00.000Z`) },
        sesionA,
      );
      const propio = await svc.listarHistorialPropio({ ...filtrosBase, fecha_desde: dia, fecha_hasta: dia }, USUARIO_A_ID);
      assert.deepEqual(delegado, propio);
      assert.ok(propio.registros.some((r) => r.id === filasA[0]!.id));
    });

    await t.test("no-regresión forense — auditor.seed sigue viendo filas de B con detalle, IP y usuario", async () => {
      const sesionAuditor = { userId: USUARIO_AUDITOR_SEED_ID, nombreUsuario: "auditor.seed" };
      const r = await svc.listarAuditLog({ ...filtrosBase, usuario_id: USUARIO_B_ID }, sesionAuditor);
      const oraculo = await prisma.auditLog.findMany({
        where: { usuario_id: USUARIO_B_ID },
        orderBy: { created_at: "desc" },
        take: 100,
        include: { usuario: { select: { nombre_completo: true } } },
      });
      assert.equal(r.total, await prisma.auditLog.count({ where: { usuario_id: USUARIO_B_ID } }));
      assert.deepEqual(
        r.registros,
        oraculo.map((o) => ({
          id: o.id,
          usuario_id: o.usuario_id,
          usuario_nombre: o.usuario?.nombre_completo ?? null,
          accion: o.accion,
          tabla_afectada: o.tabla_afectada,
          registro_id: o.registro_id,
          ip: o.ip,
          created_at: o.created_at,
          valor_anterior: o.valor_anterior,
          valor_nuevo: o.valor_nuevo,
        })),
      );
    });

    await t.test("no-regresión forense — fecha_hasta conserva el lte a medianoche UTC (deuda DT-2, sin corregir en D8)", async () => {
      const sesionAuditor = { userId: USUARIO_AUDITOR_SEED_ID, nombreUsuario: "auditor.seed" };
      const hastaUtc = new Date(`${diaNegocioIso(filasA[0]!.created_at)}T00:00:00.000Z`);
      const r = await svc.listarAuditLog({ ...filtrosBase, usuario_id: USUARIO_A_ID, fecha_hasta: hastaUtc }, sesionAuditor);
      const esperado = await prisma.auditLog.count({ where: { usuario_id: USUARIO_A_ID, created_at: { lte: hastaUtc } } });
      assert.equal(r.total, esperado);
    });

    await t.test("solo lectura — el ledger no cambió y la cadena sigue íntegra", async () => {
      const despues = await leerVerificacion();
      assert.equal(despues.count, antes.count);
      assert.deepEqual(despues.cadena, antes.cadena);
    });
  },
);
