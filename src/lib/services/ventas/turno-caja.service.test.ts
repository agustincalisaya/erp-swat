import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `turno-caja.service.ts` (mismo patrón que
 * `presupuesto.service.test.ts` / `reserva.test.ts` — sin mock de prisma, el
 * archivo no puede importarse en Node por `import "server-only"`).
 *
 * `turno-caja.calculo.test.ts` ya cubre el cálculo puro de saldo_esperado/
 * diferencia/requiereJustificacion; `turno-caja.integration.test.ts` cubre el
 * flujo completo contra Postgres real. Estos tests verifican el CONTRATO del
 * servicio a nivel de código fuente: permisos, códigos de error, orden de
 * validaciones y la regla de emisión post-escritura.
 */

const fuente = readFileSync(new URL("./turno-caja.service.ts", import.meta.url), "utf8");

const sliceAbrir = fuente.slice(
  fuente.indexOf("export async function abrirTurnoCaja"),
  fuente.indexOf("// ──", fuente.indexOf("export async function abrirTurnoCaja") + 10),
);

const sliceCerrar = fuente.slice(
  fuente.indexOf("export async function cerrarTurnoCaja"),
  fuente.indexOf("// ──", fuente.indexOf("export async function cerrarTurnoCaja") + 10),
);

// ── Permisos (contrato compartido con el seed y las rutas) ──────────────────

test("el permiso exportado coincide literalmente con el código sembrado en el seed", () => {
  assert.match(fuente, /PERMISO_VENTAS_GESTIONAR_TURNO_CAJA = "ventas:gestionar_turno_caja"/);

  const seed = readFileSync(new URL("../../../../prisma/seed.ts", import.meta.url), "utf8");
  assert.match(seed, /"ventas:gestionar_turno_caja"/);
});

test("las rutas de turno de caja quedan gateadas por withPermission con PERMISO_VENTAS_GESTIONAR_TURNO_CAJA", () => {
  const rutaAbrir = readFileSync(
    new URL("../../../app/api/ventas/turnos/route.ts", import.meta.url),
    "utf8",
  );
  const rutaCerrar = readFileSync(
    new URL("../../../app/api/ventas/turnos/[id]/cerrar/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(rutaAbrir, /withPermission\(\s*PERMISO_VENTAS_GESTIONAR_TURNO_CAJA/);
  assert.match(rutaCerrar, /withPermission\(\s*PERMISO_VENTAS_GESTIONAR_TURNO_CAJA/);
});

// ── abrirTurnoCaja() — un solo turno abierto por usuario ────────────────────

test("abrirTurnoCaja verifica fecha_cierre: null del mismo usuario ANTES de crear, sin constraint de DB", () => {
  const idxFind = sliceAbrir.indexOf("prisma.turnoCaja.findFirst");
  const idxCreate = sliceAbrir.indexOf("prisma.turnoCaja.create");
  assert.ok(idxFind > -1 && idxCreate > -1);
  assert.ok(idxFind < idxCreate);
  assert.match(sliceAbrir, /where: \{ usuario_id: usuarioId, fecha_cierre: null \}/);
});

test("abrirTurnoCaja rechaza un segundo turno abierto del mismo usuario con TURNO_YA_ABIERTO (409)", () => {
  assert.match(sliceAbrir, /new ServiceError\(\s*\n?\s*"TURNO_YA_ABIERTO"/);
});

test("abrirTurnoCaja emite venta:turno_abierto después de la escritura (regla de emisión post-escritura)", () => {
  const create = sliceAbrir.indexOf("prisma.turnoCaja.create");
  const emit = sliceAbrir.indexOf('domainEventBus.emit("venta:turno_abierto"');
  assert.ok(create > -1 && emit > create);
});

// ── cerrarTurnoCaja() — arqueo ciego, orden de validaciones ─────────────────

test("cerrarTurnoCaja valida existencia, luego fecha_cierre y luego titularidad, en ese orden", () => {
  const idxNoEncontrado = sliceCerrar.indexOf("TURNO_NO_ENCONTRADO");
  const idxYaCerrado = sliceCerrar.indexOf("TURNO_YA_CERRADO");
  const idxSinPermiso = sliceCerrar.indexOf("SIN_PERMISO_CIERRE");
  assert.ok(idxNoEncontrado > -1 && idxYaCerrado > -1 && idxSinPermiso > -1);
  assert.ok(idxNoEncontrado < idxYaCerrado);
  assert.ok(idxYaCerrado < idxSinPermiso);
});

test("cerrarTurnoCaja calcula saldo_esperado/diferencia SOLO acá — nunca antes de recibir el conteo físico", () => {
  assert.match(sliceCerrar, /prisma\.ventaMedioPago\.aggregate\(/);
  assert.match(sliceCerrar, /medio: "EFECTIVO"/);
  assert.match(sliceCerrar, /pedido_venta: \{ turno_caja_id: turnoCajaId, is_active: true \}/);
  assert.match(sliceCerrar, /calcularSaldoEsperado\(/);
  assert.match(sliceCerrar, /calcularDiferencia\(saldoEsperado, input\.conteo_fisico_declarado\)/);
});

test("cerrarTurnoCaja rechaza con JUSTIFICACION_REQUERIDA (422) sin persistir el cierre cuando corresponde", () => {
  const idxRequiere = sliceCerrar.indexOf("requiereJustificacion(diferencia, input.justificacion)");
  const idxThrow = sliceCerrar.indexOf("JUSTIFICACION_REQUERIDA");
  const idxUpdate = sliceCerrar.indexOf("prisma.turnoCaja.update");
  assert.ok(idxRequiere > -1 && idxThrow > -1 && idxUpdate > -1);
  // El throw de JUSTIFICACION_REQUERIDA ocurre ANTES del único `update` —
  // el turno no se cierra si la diferencia excede el umbral sin justificar.
  assert.ok(idxRequiere < idxThrow);
  assert.ok(idxThrow < idxUpdate);
});

test("cerrarTurnoCaja persiste fecha_cierre/saldo_esperado/conteo_fisico_declarado/diferencia/justificacion en una única escritura", () => {
  const update = sliceCerrar.slice(sliceCerrar.indexOf("prisma.turnoCaja.update"));
  assert.match(update, /fecha_cierre: new Date\(\)/);
  assert.match(update, /saldo_esperado: saldoEsperado/);
  assert.match(update, /conteo_fisico_declarado: input\.conteo_fisico_declarado/);
  assert.match(update, /diferencia,/);
  assert.match(update, /justificacion: justificacionFinal/);
  assert.doesNotMatch(sliceCerrar, /\$transaction/);
});

test("cerrarTurnoCaja emite venta:turno_cerrado después del update (regla de emisión post-escritura)", () => {
  const update = sliceCerrar.indexOf("prisma.turnoCaja.update");
  const emit = sliceCerrar.indexOf('domainEventBus.emit("venta:turno_cerrado"');
  assert.ok(update > -1 && emit > update);
});

test("cerrarTurnoCaja marca requiere_justificacion en el evento comparando la diferencia contra el umbral configurado, no un booleano hardcodeado", () => {
  assert.match(sliceCerrar, /const superaUmbral = Math\.abs\(diferencia\) > UMBRAL_DIFERENCIA_ARQUEO/);
  assert.match(sliceCerrar, /requiere_justificacion: superaUmbral/);
});

// ── obtenerTurnoAbiertoDeUsuario() — nunca expone saldo_esperado ────────────

test("obtenerTurnoAbiertoDeUsuario nunca selecciona ni devuelve saldo_esperado — solo fondo_fijo_inicial/fecha_apertura", () => {
  const bloque = fuente.slice(fuente.indexOf("export async function obtenerTurnoAbiertoDeUsuario"));
  assert.doesNotMatch(bloque, /saldo_esperado/);
  assert.match(bloque, /select: \{ id: true, fondo_fijo_inicial: true, fecha_apertura: true \}/);
});
