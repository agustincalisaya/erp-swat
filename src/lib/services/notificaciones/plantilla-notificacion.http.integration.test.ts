import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-F2 — Nivel 2 (HTTP, login real) + Nivel 3 (verificación en BD) de
 * docs/tasks/HU-F2.md §7. Mismo patrón que `lista-precio-venta.http.integration.test.ts`:
 * `withPermission()` depende de `cookies()`, así que 401/403 solo se prueban
 * contra un servidor real apuntando a la base de test.
 *
 * Casos 1–19 de la tabla del task, en orden.
 *
 * PRECONDICIÓN — base descartable recién sembrada: el caso 1 da de alta la
 * plantilla de `usuario:suspendido_automaticamente` (sin plantilla en el seed
 * a propósito). Por `tipo_evento @unique` esa fila queda para siempre (sin
 * DELETE, RULES.md Regla N.° 1): al terminar se la deja DADA DE BAJA (el Motor
 * sigue cayendo al texto por defecto, que es lo que el fixture ejercita), pero
 * una segunda corrida exige volver a sembrar la base. Todas las mutaciones,
 * incluida la restauración del cuerpo de `stock:umbral_critico_alcanzado`,
 * pasan por la API: quedan auditadas y la cadena SHA-256 sigue íntegra.
 *
 * Opt-in: `HU_F2_INTEGRATION_BASE_URL` + `HU_F2_INTEGRATION_DATABASE_URL`
 * (la MISMA base a la que apunta el servidor); `skip` si falta alguna.
 */

const BASE_URL = process.env.HU_F2_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_F2_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";

const USUARIO_ADMIN_PLATAFORMA_SEED_ID = "245b3307-a299-4cf5-b1c6-238b45455848";
const EVENTO_SIN_PLANTILLA = "usuario:suspendido_automaticamente";
const EVENTO_SEMBRADO = "stock:umbral_critico_alcanzado";
const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

async function loginReal(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login falló para ${email}: ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login para ${email} no devolvió cookie de sesión`);
  return setCookie!.split(";")[0]!;
}

test(
  "HU-F2 — endpoints de plantillas de notificación contra un servidor real (casos 1–19 + BD)",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 180_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const { prisma } = await import("../../db/prisma.ts");

    const previa = await prisma.plantillaNotificacion.findUnique({
      where: { tipo_evento: EVENTO_SIN_PLANTILLA },
    });
    assert.equal(
      previa,
      null,
      `Precondición: "${EVENTO_SIN_PLANTILLA}" ya tiene plantilla — re-sembrar la base descartable antes de correr este test.`,
    );
    const sembrada = await prisma.plantillaNotificacion.findUniqueOrThrow({
      where: { tipo_evento: EVENTO_SEMBRADO },
    });
    assert.equal(sembrada.is_active, true, `Precondición: la plantilla de "${EVENTO_SEMBRADO}" debe estar activa.`);

    const admin = await loginReal("admin.plataforma.seed@erp-swat.local");
    const administrador = await loginReal("admin.seed@erp-swat.local");
    const encargado = await loginReal("encargado.seed@erp-swat.local");
    const auditor = await loginReal("auditor.seed@erp-swat.local");

    const headers = (cookie: string | null) => ({
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    });
    const URL_ALTA = `${BASE_URL}/api/notificaciones/plantillas`;
    const url = (id: string, sufijo = "") => `${URL_ALTA}/${id}${sufijo}`;

    /** `cookie: null` = sin sesión (un `undefined` tomaría el default `admin`). */
    async function llamar(metodo: "POST" | "PATCH", destino: string, body?: unknown, cookie: string | null = admin) {
      const res = await fetch(destino, {
        method: metodo,
        headers: headers(cookie),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    }

    const ALTA = {
      tipo_evento: EVENTO_SIN_PLANTILLA,
      asunto: "Usuario suspendido automáticamente",
      cuerpo: "El usuario {{nombre_usuario}} fue suspendido por intentos fallidos.",
      prioridad_default: "CRITICA",
    };
    let plantillaCaso1: string | null = null;
    const inicio = new Date();
    const conteoInicial = await prisma.plantillaNotificacion.count();

    t.after(async () => {
      // Restauraciones por API (auditadas), nunca escritura directa ni DELETE.
      await llamar("PATCH", url(sembrada.id), { cuerpo: sembrada.cuerpo }).catch(() => undefined);
      if (plantillaCaso1) {
        const fila = await prisma.plantillaNotificacion.findUnique({ where: { id: plantillaCaso1 } });
        if (fila?.is_active) {
          await llamar("PATCH", url(plantillaCaso1, "/baja"), {
            deletion_reason: "cleanup test HU-F2 http: el evento vuelve al texto por defecto",
          }).catch(() => undefined);
        }
      }
      await prisma.$disconnect();
    });

    await t.test("1 — alta sobre evento sin plantilla → 201 con el shape del spec", async () => {
      const r = await llamar("POST", URL_ALTA, ALTA);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.error, null);
      assert.deepEqual(Object.keys(r.body.data).sort(), ["plantilla_id", "prioridad_default", "tipo_evento"]);
      assert.equal(r.body.data.tipo_evento, EVENTO_SIN_PLANTILLA);
      assert.equal(r.body.data.prioridad_default, "CRITICA");
      plantillaCaso1 = r.body.data.plantilla_id;
    });

    await t.test("2 — alta duplicada activa → 409 PLANTILLA_YA_EXISTE", async () => {
      const r = await llamar("POST", URL_ALTA, ALTA);
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "PLANTILLA_YA_EXISTE");
    });

    await t.test("3 — alta sobre evento sembrado → 409 PLANTILLA_YA_EXISTE", async () => {
      const r = await llamar("POST", URL_ALTA, { ...ALTA, tipo_evento: EVENTO_SEMBRADO });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "PLANTILLA_YA_EXISTE");
    });

    await t.test("4 — evento inexistente → 422 TIPO_EVENTO_DESCONOCIDO", async () => {
      const r = await llamar("POST", URL_ALTA, { ...ALTA, tipo_evento: "evento:inexistente" });
      assert.equal(r.status, 422);
      assert.equal(r.body.error.code, "TIPO_EVENTO_DESCONOCIDO");
    });

    await t.test("5 — alta sin asunto → 400 VALIDATION_ERROR", async () => {
      const { asunto: _omitido, ...sinAsunto } = ALTA;
      const r = await llamar("POST", URL_ALTA, sinAsunto);
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, "VALIDATION_ERROR");
    });

    await t.test("6 — edición del cuerpo de la plantilla sembrada → 200 con el shape aprobado", async () => {
      const nuevo = `${sembrada.cuerpo} (editado por test HU-F2)`;
      const r = await llamar("PATCH", url(sembrada.id), { cuerpo: nuevo });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.data, {
        plantilla_id: sembrada.id,
        tipo_evento: EVENTO_SEMBRADO,
        asunto: sembrada.asunto,
        cuerpo: nuevo,
        prioridad_default: sembrada.prioridad_default,
      });
    });

    await t.test("6b — edición con body vacío {} → 400 VALIDATION_ERROR (Punto abierto 8)", async () => {
      const r = await llamar("PATCH", url(sembrada.id), {});
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, "VALIDATION_ERROR");
    });

    await t.test("7 — PATCH con tipo_evento → 400 CAMPO_INMUTABLE con el mensaje textual del spec", async () => {
      const r = await llamar("PATCH", url(sembrada.id), { tipo_evento: "usuario:creado", cuerpo: "x" });
      assert.equal(r.status, 400);
      assert.deepEqual(r.body, {
        data: null,
        error: { code: "CAMPO_INMUTABLE", message: "Unrecognized key(s) in object: 'tipo_evento'" },
      });
    });

    await t.test("8 — PATCH sobre UUID inexistente → 404 PLANTILLA_NO_ENCONTRADA", async () => {
      const r = await llamar("PATCH", url(UUID_INEXISTENTE), { cuerpo: "x" });
      assert.equal(r.status, 404);
      assert.equal(r.body.error.code, "PLANTILLA_NO_ENCONTRADA");
    });

    await t.test("9 — baja de la plantilla del caso 1 → 200 con el shape aprobado", async () => {
      const r = await llamar("PATCH", url(plantillaCaso1!, "/baja"), {
        deletion_reason: "Prueba HU-F2: baja lógica",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.data, {
        plantilla_id: plantillaCaso1,
        tipo_evento: EVENTO_SIN_PLANTILLA,
        is_active: false,
      });
    });

    await t.test("10 — baja repetida → 409 PLANTILLA_YA_DADA_DE_BAJA", async () => {
      const r = await llamar("PATCH", url(plantillaCaso1!, "/baja"), { deletion_reason: "otra vez" });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "PLANTILLA_YA_DADA_DE_BAJA");
    });

    await t.test("11 — baja sin motivo {} → 400 VALIDATION_ERROR", async () => {
      const r = await llamar("PATCH", url(sembrada.id, "/baja"), {});
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, "VALIDATION_ERROR");
    });

    await t.test("12 — administrador.seed (sin el permiso) → 403 en las 4 rutas", async () => {
      for (const [metodo, destino, body] of [
        ["POST", URL_ALTA, ALTA],
        ["PATCH", url(sembrada.id), { cuerpo: "x" }],
        ["PATCH", url(sembrada.id, "/baja"), { deletion_reason: "x" }],
        ["PATCH", url(plantillaCaso1!, "/reactivar"), undefined],
      ] as const) {
        const r = await llamar(metodo, destino, body, administrador);
        assert.equal(r.status, 403, destino);
        assert.equal(r.body.error.code, "FORBIDDEN");
      }
    });

    await t.test("13 — encargado.seed → 403", async () => {
      const r = await llamar("PATCH", url(sembrada.id), { cuerpo: "x" }, encargado);
      assert.equal(r.status, 403);
    });

    await t.test("14 — sin sesión → 401", async () => {
      const r = await llamar("POST", URL_ALTA, ALTA, null);
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, "UNAUTHORIZED");
    });

    await t.test("15 — alta sobre evento con plantilla dada de baja → 409 PLANTILLA_DADA_DE_BAJA (remite a reactivar)", async () => {
      const r = await llamar("POST", URL_ALTA, ALTA);
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "PLANTILLA_DADA_DE_BAJA");
      assert.match(r.body.error.message, new RegExp(`${plantillaCaso1}/reactivar`));
    });

    await t.test("16 — edición sobre plantilla dada de baja → 409 PLANTILLA_DADA_DE_BAJA", async () => {
      const r = await llamar("PATCH", url(plantillaCaso1!), { cuerpo: "no debería aplicarse" });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "PLANTILLA_DADA_DE_BAJA");
    });

    await t.test("17 — reactivar plantilla dada de baja → 200, is_active: true", async () => {
      const r = await llamar("PATCH", url(plantillaCaso1!, "/reactivar"));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.data, {
        plantilla_id: plantillaCaso1,
        tipo_evento: EVENTO_SIN_PLANTILLA,
        is_active: true,
      });
    });

    await t.test("18 — reactivar plantilla ya activa → 409 PLANTILLA_YA_ACTIVA", async () => {
      const r = await llamar("PATCH", url(plantillaCaso1!, "/reactivar"));
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, "PLANTILLA_YA_ACTIVA");
    });

    await t.test("19 — reactivar UUID inexistente → 404 PLANTILLA_NO_ENCONTRADA", async () => {
      const r = await llamar("PATCH", url(UUID_INEXISTENTE, "/reactivar"));
      assert.equal(r.status, 404);
      assert.equal(r.body.error.code, "PLANTILLA_NO_ENCONTRADA");
    });

    await t.test("BD — la plantilla del caso 1 quedó reactivada con los campos de baja limpios; el caso 16 no la editó", async () => {
      const fila = await prisma.plantillaNotificacion.findUniqueOrThrow({ where: { id: plantillaCaso1! } });
      assert.equal(fila.is_active, true);
      assert.equal(fila.deleted_at, null);
      assert.equal(fila.deleted_by, null);
      assert.equal(fila.deletion_reason, null);
      assert.equal(fila.cuerpo, ALTA.cuerpo);
    });

    await t.test("BD — sin DELETE: el conteo nunca baja (+1 por el caso 1)", async () => {
      assert.equal(await prisma.plantillaNotificacion.count(), conteoInicial + 1);
    });

    await t.test("BD — AuditLog: una fila por alta/edición/baja/reactivación, usuario admin.plataforma.seed", async () => {
      // El listener escribe fire-and-forget: se espera a que aparezcan las 4 filas.
      let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
      for (let intento = 0; intento < 40 && filas.length < 4; intento++) {
        await new Promise((res) => setTimeout(res, 50));
        filas = await prisma.auditLog.findMany({
          where: { tabla_afectada: "plantillas_notificacion", created_at: { gte: inicio } },
          orderBy: { created_at: "asc" },
        });
      }
      assert.deepEqual(
        filas.map((f) => [f.accion, f.registro_id]),
        [
          ["CREATE", plantillaCaso1],
          ["UPDATE", sembrada.id],
          ["DELETE_LOGICO", plantillaCaso1],
          ["REACTIVACION", plantillaCaso1],
        ],
      );
      for (const fila of filas) {
        assert.equal(fila.usuario_id, USUARIO_ADMIN_PLATAFORMA_SEED_ID);
        assert.match(fila.hash_actual, /^[0-9a-f]{64}$/);
      }
      assert.deepEqual(filas[2].valor_nuevo, {
        is_active: false,
        deletion_reason: "Prueba HU-F2: baja lógica",
      });
      assert.deepEqual(filas[3].valor_anterior, { is_active: false });
    });

    await t.test("Cadena SHA-256 íntegra: POST /api/auditoria/verificar-cadena con auditor.seed → integra: true", async () => {
      const res = await fetch(`${BASE_URL}/api/auditoria/verificar-cadena`, {
        method: "POST",
        headers: headers(auditor),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.integra, true, JSON.stringify(body.data));
    });
  },
);
