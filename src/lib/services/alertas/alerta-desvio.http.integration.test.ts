import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";

/**
 * HU-D6 — Nivel 3: panel de alertas y edición de umbrales por HTTP, con login
 * real, contra un servidor Next real y una base REAL descartable (Paso 8B).
 * `skip` sin `HU_D6_HTTP_INTEGRATION_DATABASE_URL`.
 *
 *   docker exec swat_erp_postgres psql -U erpswat -d postgres \
 *     -c "CREATE DATABASE swat_erp_test_d6_http TEMPLATE template0"
 *   DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
 *   npm run build
 *   HU_D6_HTTP_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:d6-http
 *
 * A diferencia de los otros *.http.integration.test.ts (que esperan un
 * servidor ya levantado), esta suite levanta su PROPIO `next start` (build de
 * producción) en un puerto libre, apuntado a la misma base, y garantiza su
 * cierre: el servidor corre detrás de un watchdog que vigila el PID de este
 * proceso y mata el árbol si el test muere (aun con un kill forzado), y además
 * `t.after` y los handlers de `exit`/`SIGINT`/`SIGTERM` matan el árbol
 * (`taskkill /T /F` en Windows, grupo de procesos en POSIX).
 *
 * Fixtures propias con marcador único; limpieza con el criterio de los tests
 * recientes (nunca se borra nada): las alertas de la suite se dan de baja
 * lógica y los umbrales vuelven a 70/85/100 en un `finally`.
 */

const DATABASE_URL = process.env.HU_D6_HTTP_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";
const PROVEEDOR_HOMOLOGADO_ID = "1a2b3c4d-6666-4a1a-8a1a-000000000001";
const RAIZ = process.cwd();
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Señales de una fuga de detalles internos en una respuesta de error. */
const FUGA = /\bat\s+\S+\s+\(|\bstack\b|prisma|invocation|node_modules|[a-z]:\\|\/src\/|Error:|ECONN|P\d{4}\b/i;

// ── Servidor propio con cierre garantizado ───────────────────────────────────

function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer();
    servidor.unref();
    servidor.on("error", rechazar);
    servidor.listen(0, () => {
      const direccion = servidor.address();
      servidor.close(() => resolver(typeof direccion === "object" && direccion ? direccion.port : 0));
    });
  });
}

/** Mata el proceso y TODOS sus hijos. Síncrono: sirve también dentro de `process.on("exit")`. */
function matarArbol(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Ya no existía.
  }
}

/**
 * Watchdog: lanza `next start` y lo mata (con todo su árbol) si el proceso que
 * lo lanzó deja de existir. Así ni un kill forzado del test deja servidores vivos.
 */
const WATCHDOG = `
const { spawn, execFileSync } = require("node:child_process");
const [padre, nextBin, puerto] = process.argv.slice(1);
const hijo = spawn(process.execPath, [nextBin, "start", "-p", puerto], { stdio: "inherit", env: process.env, detached: process.platform !== "win32" });
const matar = () => {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-hijo.pid, "SIGKILL");
  } catch {}
};
const vigilancia = setInterval(() => {
  try { process.kill(Number(padre), 0); } catch { matar(); process.exit(0); }
}, 500);
hijo.on("exit", (codigo) => { clearInterval(vigilancia); process.exit(codigo ?? 0); });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { matar(); process.exit(0); });
`;

async function levantarServidor(databaseUrl: string): Promise<{ base: string; proceso: ChildProcess; salida: () => string }> {
  const nextBin = path.join(RAIZ, "node_modules", "next", "dist", "bin", "next");
  assert.ok(existsSync(path.join(RAIZ, ".next", "BUILD_ID")), "falta el build de producción: correr `npm run build` antes");
  const puerto = await puertoLibre();
  let salida = "";
  const proceso = spawn(process.execPath, ["-e", WATCHDOG, String(process.pid), nextBin, String(puerto)], {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(puerto) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  proceso.stdout?.on("data", (d) => (salida = (salida + d).slice(-4000)));
  proceso.stderr?.on("data", (d) => (salida = (salida + d).slice(-4000)));
  const base = `http://localhost:${puerto}`;
  const limite = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/login`, { redirect: "manual" });
      if (r.status > 0) break;
    } catch {
      // Todavía no escucha.
    }
    if (proceso.exitCode !== null) throw new Error(`el servidor terminó al arrancar:\n${salida}`);
    if (Date.now() > limite) throw new Error(`el servidor no respondió en 60 s:\n${salida}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  return { base, proceso, salida: () => salida };
}

test(
  "HU-D6 — panel de alertas y umbrales por HTTP contra un servidor real",
  { skip: !DATABASE_URL, timeout: 600_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const servidor = await levantarServidor(DATABASE_URL!);
    const cerrar = () => matarArbol(servidor.proceso.pid);
    process.once("exit", cerrar);
    for (const senal of ["SIGINT", "SIGTERM"] as const) {
      process.once(senal, () => {
        cerrar();
        process.exit(130);
      });
    }
    console.log(`[hu-d6-http] servidor next start en ${servidor.base} (watchdog PID ${servidor.proceso.pid})`);
    // Opt-in, solo para probar el cierre ante una interrupción forzada del test.
    const pausa = Number(process.env.HU_D6_HTTP_PAUSA_MS ?? 0);
    if (pausa > 0) await new Promise((r) => setTimeout(r, pausa));

    const [{ prisma }, { listenersRegistrados }, { alertasPendientes }, servicio, configuracion] = await Promise.all([
      import("../../db/prisma.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../events/listeners/alerta-desvio.listener.ts"),
      import("./alerta-desvio.service.ts"),
      import("../sistema/configuracion.service.ts"),
    ]);
    const { evaluarStock, evaluarEgresos } = servicio;
    await listenersRegistrados;

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-d6-http] current_database() = ${db}`);

    const MARCADOR = `D6HT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const admin = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "administrador.seed" }, select: { id: true } });

    t.after(async () => {
      try {
        await alertasPendientes().catch(() => undefined);
        await configuracion.actualizarUmbralesEgresos({ informativa: 70, advertencia: 85, critica: 100 }, admin.id).catch(() => undefined);
        await prisma.alertaDesvio.updateMany({
          where: {
            is_active: true,
            OR: [{ variante_sku: { sku: { startsWith: MARCADOR } } }, { indicador: "EGRESOS_SOBRE_INGRESOS" }],
          },
          data: { is_active: false, deleted_at: new Date(), deleted_by: admin.id, deletion_reason: `Fixture ${MARCADOR}`, clave_activa: null },
        });
        await new Promise((r) => setTimeout(r, 500));
        await prisma.$disconnect();
      } finally {
        cerrar();
      }
    });

    // ── HTTP ─────────────────────────────────────────────────────────────────
    interface FilaApi {
      id: string;
      indicador: string;
      indicador_etiqueta: string;
      referencia: string;
      severidad: "CRITICA" | "ADVERTENCIA" | "INFORMATIVA";
      severidad_etiqueta: string;
      estado: "ACTIVA" | "RESUELTA";
      detalle: string;
      detalle_vigente: boolean;
      desde: string;
      desde_texto: string;
      resuelta_at: string | null;
      resuelta_texto: string | null;
    }
    interface PanelApi {
      alertas: FilaApi[];
      paginacion: { total: number; page: number; page_size: number; total_paginas: number };
      umbrales: Record<string, number> | null;
      fuente_egresos: Record<string, unknown>;
    }
    interface Envelope {
      data: unknown;
      error: { code: string; message: string; fieldErrors?: Record<string, string[]> } | null;
    }
    type Respuesta = { status: number; json: Envelope; texto: string; location: string | null };
    const errores: { ruta: string; status: number; texto: string }[] = [];
    async function llamar(metodo: string, ruta: string, cookie: string | null, body?: unknown): Promise<Respuesta> {
      const res = await fetch(`${servidor.base}${ruta}`, {
        method: metodo,
        redirect: "manual",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      });
      const texto = await res.text();
      let json = { data: null, error: null } as Envelope;
      try {
        json = JSON.parse(texto);
      } catch {
        // HTML o vacío.
      }
      if (res.status >= 400) errores.push({ ruta: `${metodo} ${ruta}`, status: res.status, texto });
      return { status: res.status, json, texto, location: res.headers.get("location") };
    }
    async function login(email: string): Promise<string> {
      const res = await fetch(`${servidor.base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD_SEED }),
      });
      await res.json().catch(() => null);
      const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? null;
      assert.equal(res.status, 200, `login falló para ${email}`);
      assert.ok(cookie);
      return cookie;
    }
    const administrador = await login("admin.seed@erp-swat.local");
    const gerente = await login("gerente.seed@erp-swat.local");
    const cajero = await login("cajero.seed@erp-swat.local");

    // ── Fixtures ─────────────────────────────────────────────────────────────
    let secuencia = 0;
    async function crearPar(cantidad: number, punto_pedido: number) {
      secuencia += 1;
      const producto = await prisma.productoMaestro.create({
        data: {
          codigo_producto: MARCADOR,
          nombre: `${MARCADOR} Producto ${secuencia}`,
          rubro: "Indumentaria",
          categoria: "Test HU-D6 HTTP",
          unidad_medida: "UNIDAD",
          costo_estandar_referencia: 1000,
        },
      });
      const variante = await prisma.varianteSKU.create({
        data: {
          producto_maestro_id: producto.id,
          proveedor_id: PROVEEDOR_HOMOLOGADO_ID,
          sku: `${MARCADOR}-${secuencia}`,
          talle: "M",
          color: "Negro",
          genero: "UNISEX",
          modelo: "Test",
        },
      });
      const deposito = await prisma.deposito.create({ data: { nombre: `${MARCADOR} Depósito ${secuencia}`, tipo: "CENTRAL" } });
      const stock = await prisma.stockDeposito.create({
        data: { variante_sku_id: variante.id, deposito_id: deposito.id, cantidad, punto_pedido },
      });
      return {
        varianteSkuId: variante.id,
        depositoId: deposito.id,
        stockId: stock.id,
        referencia: `${variante.sku} · ${deposito.nombre}`,
      };
    }
    type Par = Awaited<ReturnType<typeof crearPar>>;
    const fijarStock = (par: Par, cantidad: number) => prisma.stockDeposito.update({ where: { id: par.stockId }, data: { cantidad } });
    async function panel(cookie: string, query = "estado=todas&page_size=100") {
      const r = await llamar("GET", `/api/tesoreria/alertas?${query}`, cookie);
      assert.equal(r.status, 200, r.texto);
      return r.json.data as PanelApi;
    }
    const fila = (data: PanelApi, par: Par) => data.alertas.filter((a) => a.referencia === par.referencia);

    // ─────────────────────────────────────────────────────────────────────────

    await t.test("a — GET: 200 admin y gerente, 403 sin alertas:leer, 401 sin sesión y con sesión de Cliente Web, 400 con fieldErrors, 405", async () => {
      assert.equal((await llamar("GET", "/api/tesoreria/alertas", administrador)).status, 200);
      assert.equal((await llamar("GET", "/api/tesoreria/alertas", gerente)).status, 200);
      const prohibido = await llamar("GET", "/api/tesoreria/alertas", cajero);
      assert.equal(prohibido.status, 403);
      assert.deepEqual(prohibido.json, { data: null, error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta acción" } });
      const anonimo = await llamar("GET", "/api/tesoreria/alertas", null);
      assert.equal(anonimo.status, 401);
      assert.equal(anonimo.json.error!.code, "UNAUTHORIZED");

      // Cliente Web: su sesión es otra cookie y no vale como sesión interna.
      const loginWeb = await fetch(`${servidor.base}/api/tienda/cuenta/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "juan.perez@example.com", password: PASSWORD_SEED }),
      });
      await loginWeb.text();
      assert.equal(loginWeb.status, 200, "login de Cliente Web");
      const cookieWeb = loginWeb.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert.match(cookieWeb, /^swat_tienda_session=/);
      const web = await llamar("GET", "/api/tesoreria/alertas", cookieWeb);
      assert.equal(web.status, 401);
      assert.equal(web.json.error!.code, "UNAUTHORIZED");

      const invalido = await llamar("GET", "/api/tesoreria/alertas?estado=archivadas&nivel=alta&page=0&page_size=500", administrador);
      assert.equal(invalido.status, 400);
      assert.equal(invalido.json.error!.code, "VALIDATION_ERROR");
      assert.deepEqual(Object.keys(invalido.json.error!.fieldErrors ?? {}).sort(), ["estado", "nivel", "page", "page_size"]);

      for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
        const r = await llamar(metodo, "/api/tesoreria/alertas", administrador, {});
        assert.equal(r.status, 405, metodo);
        assert.equal(r.json.error!.code, "METHOD_NOT_ALLOWED");
      }
    });

    await t.test("b — contenido: filas legibles, detalle vigente y último desvío (D28), pestañas, nivel, orden, paginación, baja lógica", async () => {
      const activa = await crearPar(3, 5);
      await evaluarStock(activa); // ADVERTENCIA, la fila guarda 3
      await fijarStock(activa, 2); // sigue ADVERTENCIA: el valor vigente es 2
      const resuelta = await crearPar(0, 5);
      await evaluarStock(resuelta); // CRITICA con 0
      await fijarStock(resuelta, 50);
      await evaluarStock(resuelta); // RESUELTA: conserva «Stock 0 (punto de pedido 5)»
      const deBaja = await crearPar(0, 5);
      await evaluarStock(deBaja);
      await prisma.alertaDesvio.updateMany({
        where: { variante_sku_id: deBaja.varianteSkuId, is_active: true },
        data: { is_active: false, deleted_at: new Date(), deleted_by: admin.id, deletion_reason: `Fixture ${MARCADOR}`, clave_activa: null },
      });
      await alertasPendientes();

      const todas = await panel(gerente);
      const [filaActiva] = fila(todas, activa);
      assert.equal(filaActiva?.estado, "ACTIVA");
      assert.equal(filaActiva?.severidad, "ADVERTENCIA");
      assert.equal(filaActiva?.severidad_etiqueta, "Advertencia");
      assert.equal(filaActiva?.indicador_etiqueta, "Stock bajo el punto de pedido");
      assert.equal(filaActiva?.detalle, "Stock 2 (punto de pedido 5)");
      assert.equal(filaActiva?.detalle_vigente, true);
      assert.equal(filaActiva?.resuelta_at, null);
      assert.match(filaActiva?.desde_texto, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      const [filaResuelta] = fila(todas, resuelta);
      assert.equal(filaResuelta?.estado, "RESUELTA");
      assert.equal(filaResuelta?.severidad, "CRITICA");
      assert.equal(filaResuelta?.detalle, "Stock 0 (punto de pedido 5)", "D28: último desvío");
      assert.equal(filaResuelta?.detalle_vigente, false);
      assert.ok(filaResuelta?.resuelta_texto);
      assert.equal(fila(todas, deBaja).length, 0, "la baja lógica no aparece");
      for (const a of todas.alertas) assert.doesNotMatch(String(a.referencia), UUID);

      const activas = await panel(gerente, "estado=activas&page_size=100");
      assert.equal(fila(activas, activa).length, 1);
      assert.equal(fila(activas, resuelta).length, 0);
      assert.ok(activas.alertas.every((a) => a.estado === "ACTIVA"));
      const resueltas = await panel(gerente, "estado=resueltas&page_size=100");
      assert.equal(fila(resueltas, resuelta).length, 1);
      assert.ok(resueltas.alertas.every((a) => a.estado === "RESUELTA"));
      const criticas = await panel(gerente, "estado=todas&nivel=critica&page_size=100");
      assert.ok(criticas.alertas.length > 0 && criticas.alertas.every((a) => a.severidad === "CRITICA"));
      assert.equal(fila(criticas, activa).length, 0);
      assert.equal(activas.paginacion.total + resueltas.paginacion.total, todas.paginacion.total);

      const rango: Record<string, number> = { CRITICA: 0, ADVERTENCIA: 1, INFORMATIVA: 2 };
      for (let i = 1; i < todas.alertas.length; i += 1) {
        const [a, b] = [todas.alertas[i - 1]!, todas.alertas[i]!];
        assert.ok(rango[a.severidad]! < rango[b.severidad]! || (a.severidad === b.severidad && a.desde >= b.desde), `orden en ${i}`);
      }

      const ids: string[] = [];
      for (let page = 1; page <= todas.paginacion.total; page += 1) {
        const pagina = await panel(gerente, `estado=todas&page=${page}&page_size=1`);
        assert.equal(pagina.paginacion.total, todas.paginacion.total);
        assert.equal(pagina.paginacion.total_paginas, todas.paginacion.total);
        ids.push(...pagina.alertas.map((a) => a.id));
      }
      assert.deepEqual(ids, todas.alertas.map((a) => a.id), "páginas de 1 = mismo orden, sin repetidos ni faltantes");
    });

    await t.test("c — reevaluación al abrir: stock cambiado sin evento; egresos con G14 real", async () => {
      const sube = await crearPar(4, 5);
      const baja = await crearPar(4, 5);
      await evaluarStock(sube);
      await evaluarStock(baja);
      await fijarStock(sube, 40); // incremento sin evento (como compensarVentaPagada)
      await fijarStock(baja, 0); // decremento sin evento
      const antes = await panel(administrador, "estado=todas&page_size=100");
      // El GET reevalúa ANTES de listar: la misma respuesta ya refleja el estado nuevo.
      assert.equal(fila(antes, sube)[0]?.estado, "RESUELTA", "incremento sin evento: resuelta al abrir");
      assert.equal(fila(antes, sube)[0]?.detalle, "Stock 4 (punto de pedido 5)", "D28");
      assert.equal(fila(antes, baja)[0]?.severidad, "CRITICA", "decremento sin evento: sube a CRITICA al abrir");
      assert.equal(fila(antes, baja)[0]?.detalle, "Stock 0 (punto de pedido 5)");

      // El servidor usa G14 real; el estado depende de los ingresos del mes.
      const hoy = new Date();
      const referenciaHoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" }).format(hoy).slice(0, 7);
      const [anio, mes] = referenciaHoy.split("-").map(Number) as [number, number];
      const anterior = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
      const referenciaAnterior = `${anterior.anio}-${String(anterior.mes).padStart(2, "0")}`;
      const inyectado = (pct: number, reloj?: () => Date) => ({
        dependencias: {
          ...(reloj && { ahora: reloj }),
          obtenerUmbralesEgresos: async () => ({ informativa: 70, advertencia: 85, critica: 100 }),
          obtenerResumenMensual: async (a: number, m: number) => ({ periodo: { anio: a, mes: m }, porcentaje_egresos_sobre_ingresos: pct }) as never,
        },
      });
      await evaluarEgresos({ anio, mes }, inyectado(90));
      await evaluarEgresos(anterior, inyectado(80, () => new Date(`${referenciaAnterior}-15T15:00:00.000Z`)));
      const activaEgresos = (referencia: string) =>
        prisma.alertaDesvio.findFirst({ where: { indicador: "EGRESOS_SOBRE_INGRESOS", referencia, estado: "ACTIVA", is_active: true } });
      const idHoy = (await activaEgresos(referenciaHoy))!.id;
      const idAnterior = (await activaEgresos(referenciaAnterior))!.id;

      const data = await panel(administrador, "estado=todas&page_size=100");
      const { obtenerResumenMensual } = await import("../tesoreria/reporte-mensual.service.ts");
      const resumen = await obtenerResumenMensual(anio, mes, { incluir_desglose_gastos: false });
      assert.ok(Number(resumen.ingresos.total) > 0, "fixture del mes: ingresos positivos");
      assert.notEqual(resumen.porcentaje_egresos_sobre_ingresos, null);
      assert.deepEqual(data.fuente_egresos, {
        estado: "CALCULABLE", referencia: referenciaHoy,
        porcentaje: resumen.porcentaje_egresos_sobre_ingresos,
      });
      const [filaHoy, filaAnterior] = [data.alertas.find((a) => a.id === idHoy), data.alertas.find((a) => a.id === idAnterior)];
      assert.equal(filaHoy?.estado, "RESUELTA", "porcentaje debajo del umbral → resuelta");
      assert.equal(filaHoy?.detalle, "90,0% (umbral 85%)", "D28: conserva el último desvío");
      assert.equal(filaAnterior?.estado, "RESUELTA", "mes terminado → resuelta (D5)");
      assert.equal(filaAnterior?.detalle, "80,0% (umbral 70%)");
      assert.equal(await activaEgresos(referenciaHoy), null);
      assert.equal(await activaEgresos(referenciaAnterior), null);
      const pagina = await llamar("GET", "/tesoreria/alertas", administrador);
      assert.match(pagina.texto, /Egresos sobre ingresos de/);
      assert.doesNotMatch(pagina.texto, /No calculable \(los ingresos del mes son cero o negativos\)/);
    });

    await t.test("d — PATCH umbrales: admin cambia y el GET lo muestra; asiento real; 403/401/400/405; mismo conjunto sin cambio", async () => {
      try {
        const desde = new Date();
        const cambio = await llamar("PATCH", "/api/tesoreria/alertas/umbrales", administrador, { informativa: 60, advertencia: 80, critica: 95 });
        assert.equal(cambio.status, 200, cambio.texto);
        assert.deepEqual(cambio.json.data, {
          umbrales: { informativa: 60, advertencia: 80, critica: 95 },
          hubo_cambio: true,
          claves_cambiadas: ["TESORERIA_ALERTA_EGRESOS_INFORMATIVA_PCT", "TESORERIA_ALERTA_EGRESOS_ADVERTENCIA_PCT", "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT"],
        });
        assert.deepEqual((await panel(gerente)).umbrales, { informativa: 60, advertencia: 80, critica: 95 });

        // Asiento escrito por el SERVIDOR (su listener de auditoría), uno por clave.
        const limite = Date.now() + 10_000;
        let asientos: { registro_id: string | null; usuario_id: string | null; accion: string; valor_anterior: unknown; valor_nuevo: unknown }[] = [];
        while (Date.now() < limite) {
          asientos = await prisma.auditLog.findMany({
            where: { tabla_afectada: "configuraciones_sistema", created_at: { gte: desde } },
            select: { registro_id: true, usuario_id: true, accion: true, valor_anterior: true, valor_nuevo: true },
            orderBy: { created_at: "asc" },
          });
          if (asientos.length >= 3) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        assert.equal(asientos.length, 3);
        for (const a of asientos) {
          assert.equal(a.accion, "UPDATE");
          assert.equal(a.usuario_id, admin.id);
        }
        assert.deepEqual(asientos.find((a) => a.registro_id === "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT")?.valor_nuevo, {
          clave: "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT",
          valor: "95",
        });

        const igual = await llamar("PATCH", "/api/tesoreria/alertas/umbrales", administrador, { informativa: 60, advertencia: 80, critica: 95 });
        assert.equal(igual.status, 200);
        assert.equal((igual.json.data as { hubo_cambio: boolean }).hubo_cambio, false);

        assert.equal((await llamar("PATCH", "/api/tesoreria/alertas/umbrales", gerente, { informativa: 1, advertencia: 2, critica: 3 })).status, 403);
        assert.equal((await llamar("PATCH", "/api/tesoreria/alertas/umbrales", null, { informativa: 1, advertencia: 2, critica: 3 })).status, 401);
        const noJson = await llamar("PATCH", "/api/tesoreria/alertas/umbrales", administrador, "{no-json");
        assert.equal(noJson.status, 400);
        assert.equal(noJson.json.error!.code, "VALIDATION_ERROR");
        const invalido = await llamar("PATCH", "/api/tesoreria/alertas/umbrales", administrador, { informativa: "x", advertencia: 80, critica: 95, extra: 1 });
        assert.equal(invalido.status, 400);
        assert.ok(invalido.json.error!.fieldErrors);
        const noCreciente = await llamar("PATCH", "/api/tesoreria/alertas/umbrales", administrador, { informativa: 90, advertencia: 80, critica: 95 });
        assert.equal(noCreciente.status, 400);
        assert.match(noCreciente.json.error!.message, /estrictamente crecientes/);
        assert.equal((await llamar("GET", "/api/tesoreria/alertas/umbrales", administrador)).status, 405);
        assert.deepEqual(await configuracion.obtenerUmbralesEgresos(), { informativa: 60, advertencia: 80, critica: 95 }, "los rechazos no escribieron");
      } finally {
        await configuracion.actualizarUmbralesEgresos({ informativa: 70, advertencia: 85, critica: 100 }, admin.id);
      }
      assert.deepEqual((await panel(administrador)).umbrales, { informativa: 70, advertencia: 85, critica: 100 });
    });

    await t.test("e — páginas: redirecciones, formulario solo para el Administrador, ítem del Sidebar y filas de la fixture", async () => {
      const par = await crearPar(1, 5);
      await evaluarStock(par);
      const sinSesion = await llamar("GET", "/tesoreria/alertas", null);
      assert.ok([303, 307, 308].includes(sinSesion.status));
      assert.match(sinSesion.location ?? "", /\/login/);
      const sinPermiso = await llamar("GET", "/tesoreria/alertas", cajero);
      assert.ok([303, 307, 308].includes(sinPermiso.status));
      assert.match(sinPermiso.location ?? "", /\/no-autorizado/);

      const paginaGerente = await llamar("GET", "/tesoreria/alertas", gerente);
      assert.equal(paginaGerente.status, 200);
      assert.doesNotMatch(paginaGerente.texto, /Guardar umbrales/);
      assert.match(paginaGerente.texto, /Solo lectura: los modifica el Administrador\./);
      const paginaAdmin = await llamar("GET", "/tesoreria/alertas", administrador);
      assert.equal(paginaAdmin.status, 200);
      assert.match(paginaAdmin.texto, /Guardar umbrales/);
      for (const pagina of [paginaGerente, paginaAdmin]) {
        assert.ok(pagina.texto.includes(par.referencia.replace("·", "·")), "muestra la fila de la fixture");
        assert.match(pagina.texto, /href="\/tesoreria\/alertas"/, "ítem Alertas en el Sidebar");
        assert.match(pagina.texto, /Para stock: advertencia en o por debajo del punto de pedido, crítica en cero\./);
      }
      const homeCajero = await llamar("GET", "/home", cajero);
      assert.equal(homeCajero.status, 200);
      assert.doesNotMatch(homeCajero.texto, /href="\/tesoreria\/alertas"/, "sin alertas:leer no ve el ítem");
      const homeGerente = await llamar("GET", "/home", gerente);
      assert.match(homeGerente.texto, /href="\/tesoreria\/alertas"/);
    });

    await t.test("f — ninguna respuesta de error filtra mensajes internos ni stack traces", async () => {
      // a: 403, 401 ×2, 400, 405 ×4 · d: 403, 401, 400 ×3, 405.
      assert.ok(errores.length >= 14, `se recolectaron ${errores.length} respuestas de error`);
      for (const e of errores) {
        if (e.status >= 400 && e.texto.trim().startsWith("{")) {
          const json = JSON.parse(e.texto);
          assert.equal(json.data, null, e.ruta);
          assert.deepEqual(Object.keys(json.error).filter((k) => !["code", "message", "fieldErrors"].includes(k)), [], e.ruta);
          assert.match(json.error.code, /^[A-Z_]+$/, e.ruta);
        }
        assert.doesNotMatch(e.texto, FUGA, `${e.ruta} (${e.status})`);
      }
    });
  },
);
