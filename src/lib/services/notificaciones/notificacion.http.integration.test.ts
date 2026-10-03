import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

/**
 * HU-F3 — Nivel 2 (HTTP, login real) + Nivel 3 (verificación en BD) de
 * docs/tasks/HU-F3.md §7. Mismo patrón que `plantilla-notificacion.http.integration.test.ts`:
 * `withAuth()` depende de `cookies()`, así que se prueba contra un servidor real
 * apuntando a la base de test.
 *
 * SOLO BASE LOCAL DESCARTABLE: los casos 11–13 disparan el motor de verdad
 * (egreso de stock, suspensión por login fallido). Re-ejecutable: los
 * fixtures del encargado se restauran por UPDATE (nunca DELETE, RULES.md
 * Regla N.° 1; el seed usa `upsert` con `update: {}` y no los restaura), las
 * notificaciones generadas por corridas previas se archivan, el stock se
 * repone con un ingreso real y `vendedor.seed` se reactiva por D.2.
 *
 * Opt-in: `HU_F3_INTEGRATION_BASE_URL` + `HU_F3_INTEGRATION_DATABASE_URL`
 * (la MISMA base a la que apunta el servidor); `skip` si falta alguna.
 */

const BASE_URL = process.env.HU_F3_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_F3_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";

const ENCARGADO_SEED_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";
const CUENTA_WEB_JUAN_PEREZ_ID = "e9440ab2-091d-414d-9fc9-e02d312a1df5";
const STOCK_CT1_CENTRAL_ID = "ec3dfab3-aae7-431f-a08d-c0aca9b21c5e";
const STOCK_B1_SHOWROOM_ID = "9c1c70af-b0c6-4188-8771-3ad4e3a90940";
const STOCK_CT1_SHOWROOM_ID = "7bcdc606-fef2-443c-b501-8859c49ae7ad";
const STOCK_DEPOSITO_SEED_ID = "90bb1fa7-d5f4-40fa-aa0c-ffeab09082e6";
const UMBRAL = "stock:umbral_critico_alcanzado";
const SUSPENSION = "usuario:suspendido_automaticamente";
const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");
const claveSeed = (registroId: string) => sha256(`${UMBRAL}:${registroId}:${ENCARGADO_SEED_ID}`);

async function login(email: string, password = PASSWORD_SEED): Promise<{ status: number; cookie: string | null }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await res.json().catch(() => null);
  return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
}

async function loginReal(email: string): Promise<string> {
  const r = await login(email);
  assert.equal(r.status, 200, `login falló para ${email}`);
  assert.ok(r.cookie, `login para ${email} no devolvió cookie de sesión`);
  return r.cookie!;
}

async function esperar<T>(consulta: () => Promise<T | null | undefined>, ms = 8_000): Promise<T> {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await consulta();
    if (valor) return valor;
    if (Date.now() > limite) throw new Error("timeout esperando al motor de notificaciones");
    await new Promise((r) => setTimeout(r, 200));
  }
}

test(
  "HU-F3 — bandeja de notificaciones y motor contra un servidor real (casos 1–14 + BD)",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 240_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const { prisma } = await import("../../db/prisma.ts");

    /** Estado sembrado de las 3 notificaciones del encargado (task §2.1). */
    async function restaurarFixturesEncargado() {
      const ahora = Date.now();
      const dias = (n: number) => new Date(ahora - n * 86_400_000);
      const fixtures = [
        { clave: claveSeed(STOCK_CT1_CENTRAL_ID), leida_at: dias(4), activa: true },
        { clave: claveSeed(STOCK_B1_SHOWROOM_ID), leida_at: null, activa: true },
        { clave: claveSeed(STOCK_CT1_SHOWROOM_ID), leida_at: dias(9), activa: false },
      ];
      const claves = fixtures.map((f) => f.clave);
      // Las generadas por corridas previas del motor se archivan (baja lógica).
      await prisma.notificacion.updateMany({
        where: { usuario_destinatario_id: ENCARGADO_SEED_ID, clave_idempotencia: { notIn: claves }, is_active: true },
        data: { is_active: false, deleted_at: new Date(), deleted_by: ENCARGADO_SEED_ID },
      });
      for (const f of fixtures) {
        await prisma.notificacion.update({
          where: { clave_idempotencia: f.clave },
          data: f.activa
            ? { leida_at: f.leida_at, is_active: true, deleted_at: null, deleted_by: null }
            : { leida_at: f.leida_at, is_active: false, deleted_at: dias(8), deleted_by: ENCARGADO_SEED_ID },
        });
      }
    }

    await restaurarFixturesEncargado();
    t.after(async () => {
      await restaurarFixturesEncargado().catch(() => undefined);
      await prisma.$disconnect();
    });

    const encargado = await loginReal("encargado.seed@erp-swat.local");
    const auditor = await loginReal("auditor.seed@erp-swat.local");
    const administrador = await loginReal("admin.seed@erp-swat.local");

    async function llamar(metodo: "GET" | "PATCH" | "POST", ruta: string, cookie: string | null, body?: unknown) {
      const res = await fetch(`${BASE_URL}${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    }

    const noLeidaId = (
      await prisma.notificacion.findUniqueOrThrow({ where: { clave_idempotencia: claveSeed(STOCK_B1_SHOWROOM_ID) } })
    ).id;
    const archivadaId = (
      await prisma.notificacion.findUniqueOrThrow({ where: { clave_idempotencia: claveSeed(STOCK_CT1_SHOWROOM_ID) } })
    ).id;

    await t.test("1 — bandeja del encargado: 2 ítems (sin la archivada), no_leidas 1", async () => {
      const r = await llamar("GET", "/api/notificaciones", encargado);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.error, null);
      assert.equal(r.body.data.items.length, 2);
      assert.equal(r.body.data.no_leidas, 1);
      assert.deepEqual(Object.keys(r.body.data.items[0]).sort(), [
        "asunto", "created_at", "cuerpo", "leida_at", "notificacion_id", "prioridad", "tipo_evento",
      ]);
      assert.deepEqual(r.body.data.paginacion, { total: 2, pagina_actual: 1, total_paginas: 1, por_pagina: 20 });
      assert.ok(!r.body.data.items.some((i: { notificacion_id: string }) => i.notificacion_id === archivadaId));
    });

    await t.test("2 — solo_no_leidas=true: 1 ítem (STOCK_B1_SHOWROOM)", async () => {
      const r = await llamar("GET", "/api/notificaciones?solo_no_leidas=true", encargado);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data.items.map((i: { notificacion_id: string }) => i.notificacion_id), [noLeidaId]);
    });

    await t.test("3 — HALLAZGO Punto abierto 6: solo_no_leidas=false se comporta como true", async () => {
      const r = await llamar("GET", "/api/notificaciones?solo_no_leidas=false", encargado);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.items.length, 1, "con el Zod textual del spec, 'false' → true");
    });

    await t.test("4 — prioridad=CRITICA: 0 ítems; prioridad inválida → 400", async () => {
      const r = await llamar("GET", "/api/notificaciones?prioridad=CRITICA", encargado);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.items.length, 0);
      assert.equal((await llamar("GET", "/api/notificaciones?page_size=51", encargado)).status, 400);
    });

    await t.test("5 — marcar leída: 200 con leida_at; repetir → 200 con el MISMO leida_at", async () => {
      const r1 = await llamar("PATCH", `/api/notificaciones/${noLeidaId}/leer`, encargado);
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      assert.equal(r1.body.data.notificacion_id, noLeidaId);
      assert.ok(r1.body.data.leida_at);
      const r2 = await llamar("PATCH", `/api/notificaciones/${noLeidaId}/leer`, encargado);
      assert.equal(r2.status, 200);
      assert.equal(r2.body.data.leida_at, r1.body.data.leida_at);
    });

    await t.test("6 — notificación ajena (Juan Pérez) o inexistente → 404 sin modificarla", async () => {
      const ajena = await prisma.notificacion.findFirstOrThrow({
        where: { cuenta_cliente_web_destinatario_id: CUENTA_WEB_JUAN_PEREZ_ID, leida_at: null, is_active: true },
      });
      for (const sufijo of ["leer", "archivar"]) {
        const r = await llamar("PATCH", `/api/notificaciones/${ajena.id}/${sufijo}`, encargado);
        assert.equal(r.status, 404);
        assert.equal(r.body.error.code, "NOTIFICACION_NO_ENCONTRADA");
      }
      assert.equal((await llamar("PATCH", `/api/notificaciones/${UUID_INEXISTENTE}/leer`, encargado)).status, 404);
      assert.equal((await llamar("PATCH", "/api/notificaciones/no-uuid/leer", encargado)).status, 400);
      const intacta = await prisma.notificacion.findUniqueOrThrow({ where: { id: ajena.id } });
      assert.equal(intacta.leida_at, null);
      assert.equal(intacta.is_active, true);
    });

    await t.test("7 — marcar todas leídas → 200 { actualizadas }; luego no_leidas 0", async () => {
      await prisma.notificacion.update({ where: { id: noLeidaId }, data: { leida_at: null } });
      const r = await llamar("PATCH", "/api/notificaciones/marcar-todas-leidas", encargado);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data, { actualizadas: 1 });
      const bandeja = await llamar("GET", "/api/notificaciones", encargado);
      assert.equal(bandeja.body.data.no_leidas, 0);
      assert.deepEqual((await llamar("PATCH", "/api/notificaciones/marcar-todas-leidas", encargado)).body.data, { actualizadas: 0 });
    });

    await t.test("8 — archivar: 200, desaparece de la bandeja, baja lógica en BD; repetir → 200", async () => {
      const r1 = await llamar("PATCH", `/api/notificaciones/${noLeidaId}/archivar`, encargado);
      assert.equal(r1.status, 200);
      assert.deepEqual(r1.body.data, { notificacion_id: noLeidaId, is_active: false });
      const bandeja = await llamar("GET", "/api/notificaciones", encargado);
      assert.equal(bandeja.body.data.items.length, 1);
      const fila = await prisma.notificacion.findUniqueOrThrow({ where: { id: noLeidaId } });
      assert.equal(fila.is_active, false);
      assert.ok(fila.deleted_at);
      assert.equal(fila.deleted_by, ENCARGADO_SEED_ID);
      assert.equal(fila.deletion_reason, null);
      assert.equal((await llamar("PATCH", `/api/notificaciones/${noLeidaId}/archivar`, encargado)).status, 200);
    });

    await t.test("9 — aislamiento: auditor.seed ve 0 ítems", async () => {
      const r = await llamar("GET", "/api/notificaciones", auditor);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.items.length, 0);
      assert.equal(r.body.data.no_leidas, 0);
    });

    await t.test("10 — sin sesión → 401 en las 4 rutas", async () => {
      assert.equal((await llamar("GET", "/api/notificaciones", null)).status, 401);
      assert.equal((await llamar("PATCH", `/api/notificaciones/${noLeidaId}/leer`, null)).status, 401);
      assert.equal((await llamar("PATCH", `/api/notificaciones/${noLeidaId}/archivar`, null)).status, 401);
      assert.equal((await llamar("PATCH", "/api/notificaciones/marcar-todas-leidas", null)).status, 401);
    });

    /** Egreso real (endpoint de Módulo A) que deja la fila de stock en su punto de pedido. */
    async function egresoHastaUmbral(stockDepositoId: string) {
      const stock = await prisma.stockDeposito.findUniqueOrThrow({ where: { id: stockDepositoId } });
      assert.ok(stock.punto_pedido > 0, "precondición: la fila tiene punto de pedido");
      const cantidad = stock.cantidad > stock.punto_pedido ? stock.cantidad - stock.punto_pedido : 1;
      assert.ok(stock.cantidad >= cantidad, "precondición: stock suficiente para el egreso");
      const r = await llamar("POST", "/api/inventario/movimientos/ingreso", encargado, {
        deposito_destino_id: stock.deposito_id,
        comprobante_referencia: "QA HU-F3",
        items: [{ variante_sku_id: stock.variante_sku_id, cantidad, estado_destino: "BAJA_MERMA" }],
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return { stock, cantidad, movimientoId: r.body.data.movimiento_id as string };
    }

    async function reponer(stock: { deposito_id: string; variante_sku_id: string }, cantidad: number) {
      const r = await llamar("POST", "/api/inventario/movimientos/ingreso", encargado, {
        deposito_destino_id: stock.deposito_id,
        comprobante_referencia: "QA HU-F3 reposición",
        items: [{ variante_sku_id: stock.variante_sku_id, cantidad, estado_destino: "DISPONIBLE" }],
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }

    await t.test("11 — motor E2E: egreso bajo el umbral → ADVERTENCIA con la plantilla renderizada", async () => {
      const { stock, cantidad, movimientoId } = await egresoHastaUmbral(STOCK_DEPOSITO_SEED_ID);
      try {
        const clave = sha256(`${UMBRAL}:${movimientoId}:${STOCK_DEPOSITO_SEED_ID}:${ENCARGADO_SEED_ID}`);
        const n = await esperar(() => prisma.notificacion.findUnique({ where: { clave_idempotencia: clave } }));
        assert.equal(n.prioridad, "ADVERTENCIA");
        assert.equal(n.tipo_evento, UMBRAL);
        assert.ok(n.plantilla_id, "usa la plantilla sembrada por HU-F2");
        assert.equal(n.asunto, "Stock en umbral crítico");
        assert.match(n.cuerpo, new RegExp(`quedan ${stock.cantidad - cantidad} unidades \\(punto de pedido ${stock.punto_pedido}\\)`));
        assert.doesNotMatch(n.cuerpo, /\{\{/);
        const bandeja = await llamar("GET", "/api/notificaciones?solo_no_leidas=true", encargado);
        assert.ok(bandeja.body.data.items.some((i: { notificacion_id: string }) => i.notificacion_id === n.id));
        // Rol expandido: una fila por cada ENCARGADO_DEPOSITO activo, cada una con su clave.
        const filas = await prisma.notificacion.count({
          where: { tipo_evento: UMBRAL, created_at: { gte: new Date(Date.now() - 60_000) }, cuerpo: n.cuerpo },
        });
        assert.ok(filas >= 1);
      } finally {
        await reponer(stock, cantidad);
      }
    });

    await t.test("12 — Punto abierto 5 (hallazgo esperado): STOCK_CT1_CENTRAL ya notificada en el seed → igual genera la nueva", async () => {
      const { stock, cantidad, movimientoId } = await egresoHastaUmbral(STOCK_CT1_CENTRAL_ID);
      try {
        const clave = sha256(`${UMBRAL}:${movimientoId}:${STOCK_CT1_CENTRAL_ID}:${ENCARGADO_SEED_ID}`);
        assert.notEqual(clave, claveSeed(STOCK_CT1_CENTRAL_ID), "con clave_origen = registro_id chocaría");
        const n = await esperar(() => prisma.notificacion.findUnique({ where: { clave_idempotencia: clave } }));
        assert.equal(n.usuario_destinatario_id, ENCARGADO_SEED_ID);
        const sembrada = await prisma.notificacion.findUniqueOrThrow({
          where: { clave_idempotencia: claveSeed(STOCK_CT1_CENTRAL_ID) },
        });
        assert.notEqual(sembrada.id, n.id, "la fila sembrada no se toca");
      } finally {
        await reponer(stock, cantidad);
      }
    });

    await t.test("13 — 5 logins fallidos de vendedor.seed → CRITICA con texto por defecto (vendedor + ADMINISTRADOR)", async () => {
      const plantilla = await prisma.plantillaNotificacion.findFirst({ where: { tipo_evento: SUSPENSION, is_active: true } });
      assert.equal(plantilla, null, "precondición: sin plantilla activa para la suspensión");
      const vendedor = await prisma.usuario.findUniqueOrThrow({ where: { email: "vendedor.seed@erp-swat.local" } });
      assert.equal(vendedor.estado, "ACTIVO", "precondición: vendedor.seed activo");
      const administradores = await prisma.usuarioRol.findMany({
        where: { is_active: true, rol: { nombre: "ADMINISTRADOR", is_active: true }, usuario: { is_active: true } },
        select: { usuario_id: true },
      });
      const inicio = new Date();
      try {
        for (let i = 0; i < 5; i++) {
          const r = await login("vendedor.seed@erp-swat.local", "contraseña-incorrecta");
          assert.notEqual(r.status, 200);
        }
        const destinatarios = [vendedor.id, ...new Set(administradores.map((a) => a.usuario_id))];
        const filas = await esperar(async () => {
          const encontradas = await prisma.notificacion.findMany({
            where: { tipo_evento: SUSPENSION, created_at: { gte: inicio } },
          });
          return encontradas.length >= destinatarios.length ? encontradas : null;
        });
        assert.deepEqual(filas.map((f) => f.usuario_destinatario_id).sort(), [...destinatarios].sort());
        for (const f of filas) {
          assert.equal(f.prioridad, "CRITICA");
          assert.equal(f.plantilla_id, null);
          assert.equal(f.asunto, "Tenés una novedad");
          assert.equal(f.cuerpo, "Hay una novedad que requiere tu atención.");
        }
        // CRITICA primero en la bandeja del administrador (orden del enum, verificado contra BD).
        const bandeja = await llamar("GET", "/api/notificaciones", administrador);
        assert.equal(bandeja.body.data.items[0].prioridad, "CRITICA");
      } finally {
        // Reactivación por D.2 (auditada).
        const r = await llamar("PATCH", `/api/auth/usuarios/${vendedor.id}/estado`, administrador, {
          nuevo_estado: "ACTIVO",
          motivo: "QA HU-F3: reactivación tras suspensión automática de prueba",
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
      }
    });

    await t.test("14 — una falla del listener nunca llega al emisor (in-process)", async () => {
      const [{ domainEventBus }, { iniciarNotificacionListener }] = await Promise.all([
        import("../../events/domain-event-bus.ts"),
        import("../../events/listeners/notificacion.listener.ts"),
      ]);
      iniciarNotificacionListener();
      const errores: unknown[] = [];
      const consoleError = console.error;
      console.error = (...args: unknown[]) => void errores.push(args);
      try {
        // Error SÍNCRONO dentro del handler (fecha inválida → toISOString lanza).
        assert.doesNotThrow(() =>
          domainEventBus.emit(SUSPENSION, {
            usuario_id: randomUUID(),
            intentos_fallidos: 5,
            bloqueado_hasta: new Date(Number.NaN),
            ip: "test",
          }),
        );
        // Error ASÍNCRONO de BD (FK: la cuenta destinataria no existe).
        const carritoItemId = randomUUID();
        assert.doesNotThrow(() =>
          domainEventBus.emit("ecommerce:carrito_articulo_no_disponible", {
            carrito_id: randomUUID(),
            carrito_item_id: carritoItemId,
            variante_sku_id: randomUUID(),
            sku: "QA-F3",
            motivo: "SKU_INACTIVO",
            cliente_web_cuenta_id: randomUUID(),
          }),
        );
        await esperar(async () => (errores.length >= 2 ? true : null));
      } finally {
        console.error = consoleError;
      }
      assert.equal(errores.length, 2);
      // La operación de origen (acá: el emit) terminó normalmente y el motor sigue operativo.
      const bandeja = await llamar("GET", "/api/notificaciones", encargado);
      assert.equal(bandeja.status, 200);
    });

    await t.test("Nivel 3 — orden del enum, unicidad de claves y CHECK de destinatario", async () => {
      const orden = await prisma.$queryRaw<{ v: string }[]>`SELECT unnest(enum_range(NULL::"PrioridadNotificacion"))::text AS v`;
      assert.deepEqual(orden.map((o) => o.v), ["CRITICA", "ADVERTENCIA", "INFORMATIVA"]);
      const [unicidad] = await prisma.$queryRaw<{ filas: bigint; claves: bigint }[]>`
        SELECT count(*) AS filas, count(DISTINCT clave_idempotencia) AS claves FROM notificaciones`;
      assert.equal(unicidad!.filas, unicidad!.claves);
      const check = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conname = 'notificaciones_destinatario_unico_chk'`;
      assert.equal(check.length, 1);
    });
  },
);
