import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) del helper de "día calendario de negocio" (auditoría
 * transversal Módulo H, 2026-09-26, hallazgos A1/A2/D8). Corren bajo el
 * script `test` principal (`node --experimental-strip-types --test`), por
 * eso el import es relativo con extensión explícita — mismo patrón que
 * `evaluacion.calculo.test.ts` / `lista-precios.schema.test.ts`.
 */
import {
  diaCalendarioUtc,
  diaDeVigencia,
  diaNegocioIso,
  diasDesdeFechaSolo,
  esFechaSoloAnteriorAHoyNegocio,
  fechaDeVigenciaAlcanzada,
  hoyComoFechaSoloUtc,
  inicioDiaUtc,
  formatearFechaHoraNegocio,
  formatearFechaNegocio,
  sumarDiasCalendarioNegocio,
} from "./fecha-negocio.ts";

// ──────────────────────────────────────────────────────────────────────────
// diaNegocioIso — día calendario en huso horario de Argentina (UTC-3 fijo)
// ──────────────────────────────────────────────────────────────────────────

test("diaNegocioIso: un instante a las 04:00 UTC cae en el mismo día calendario en Argentina (01:00 local)", () => {
  assert.equal(diaNegocioIso(new Date("2026-09-26T04:00:00.000Z")), "2026-09-26");
});

test("diaNegocioIso: un instante a la 01:00 UTC todavía es el día ANTERIOR en Argentina (22:00 local del día previo)", () => {
  assert.equal(diaNegocioIso(new Date("2026-09-26T01:00:00.000Z")), "2026-09-25");
});

test("diaNegocioIso: exactamente las 03:00 UTC ya es medianoche en Argentina (inicio del nuevo día local)", () => {
  assert.equal(diaNegocioIso(new Date("2026-09-26T03:00:00.000Z")), "2026-09-26");
});

// ──────────────────────────────────────────────────────────────────────────
// diaCalendarioUtc — día calendario de una fecha-solo (medianoche UTC)
// ──────────────────────────────────────────────────────────────────────────

test("diaCalendarioUtc: lee el día en UTC, sin corrimiento por huso horario de Argentina", () => {
  assert.equal(diaCalendarioUtc(new Date("2026-09-26T00:00:00.000Z")), "2026-09-26");
  assert.equal(diaCalendarioUtc(new Date("2026-09-26T23:00:00.000Z")), "2026-09-26");
});

// ──────────────────────────────────────────────────────────────────────────
// esFechaSoloAnteriorAHoyNegocio — A1: "hoy" nunca es "anterior a hoy"
// ──────────────────────────────────────────────────────────────────────────

test("esFechaSoloAnteriorAHoyNegocio: la fecha de HOY nunca es anterior (bug A1 corregido)", () => {
  const hoy = new Date("2026-09-26T00:00:00.000Z");
  const ahora = new Date("2026-09-26T21:00:00.000Z"); // 18:00 hora Argentina, mismo día
  assert.equal(esFechaSoloAnteriorAHoyNegocio(hoy, ahora), false);
});

test("esFechaSoloAnteriorAHoyNegocio: ayer sí es anterior a hoy", () => {
  const ayer = new Date("2026-09-25T00:00:00.000Z");
  const ahora = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(esFechaSoloAnteriorAHoyNegocio(ayer, ahora), true);
});

test("esFechaSoloAnteriorAHoyNegocio: mañana no es anterior a hoy", () => {
  const manana = new Date("2026-09-27T00:00:00.000Z");
  const ahora = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(esFechaSoloAnteriorAHoyNegocio(manana, ahora), false);
});

test("esFechaSoloAnteriorAHoyNegocio: al filo de la medianoche local, 'hoy' sigue siendo el día de negocio correcto", () => {
  // 2026-09-26T01:00:00Z = 2026-09-25T22:00 hora Argentina → el día de
  // negocio de "ahora" es el 25, no el 26. Una fecha-solo del 26 (mañana
  // según el calendario de negocio) NO es anterior.
  const dia26 = new Date("2026-09-26T00:00:00.000Z");
  const ahora = new Date("2026-09-26T01:00:00.000Z");
  assert.equal(esFechaSoloAnteriorAHoyNegocio(dia26, ahora), false);
});

// ──────────────────────────────────────────────────────────────────────────
// diasDesdeFechaSolo — A2/D8: días calendario completos, sin redondear horas
// ──────────────────────────────────────────────────────────────────────────

test("diasDesdeFechaSolo: reproduce OC-2026-000004 — entrega comprometida hoy, recepción hoy a las 15:12 local = 0 días de atraso", () => {
  const fechaEntregaComprometida = new Date("2026-09-26T00:00:00.000Z");
  const fechaRecepcion = new Date("2026-09-26T18:12:00.000Z"); // 15:12 hora Argentina
  assert.equal(diasDesdeFechaSolo(fechaEntregaComprometida, fechaRecepcion), 0);
});

test("diasDesdeFechaSolo: recepción al día siguiente 00:30 hora local = 1 día de atraso", () => {
  const fechaEntregaComprometida = new Date("2026-09-26T00:00:00.000Z");
  const fechaRecepcion = new Date("2026-09-27T03:30:00.000Z"); // 00:30 hora Argentina del día siguiente
  assert.equal(diasDesdeFechaSolo(fechaEntregaComprometida, fechaRecepcion), 1);
});

test("diasDesdeFechaSolo: recepción a las 02:59 UTC del día siguiente todavía es 23:59 hora local del día comprometido = 0 días", () => {
  const fechaEntregaComprometida = new Date("2026-09-26T00:00:00.000Z");
  const fechaRecepcion = new Date("2026-09-27T02:59:00.000Z"); // 23:59 hora Argentina del día comprometido
  assert.equal(diasDesdeFechaSolo(fechaEntregaComprometida, fechaRecepcion), 0);
});

test("diasDesdeFechaSolo: recepción anticipada da un número negativo (el llamador decide el clamp a 0)", () => {
  const fechaEntregaComprometida = new Date("2026-09-26T00:00:00.000Z");
  const fechaRecepcion = new Date("2026-09-24T12:00:00.000Z");
  assert.equal(diasDesdeFechaSolo(fechaEntregaComprometida, fechaRecepcion), -2);
});

// ──────────────────────────────────────────────────────────────────────────
// hoyComoFechaSoloUtc / inicioDiaUtc
// ──────────────────────────────────────────────────────────────────────────

test("hoyComoFechaSoloUtc: es la medianoche UTC del día de negocio de 'ahora'", () => {
  const ahora = new Date("2026-09-26T18:12:00.000Z");
  assert.equal(hoyComoFechaSoloUtc(ahora).toISOString(), "2026-09-26T00:00:00.000Z");
});

test("inicioDiaUtc: convierte AAAA-MM-DD a su medianoche UTC", () => {
  assert.equal(inicioDiaUtc("2026-09-26").toISOString(), "2026-09-26T00:00:00.000Z");
});

// ──────────────────────────────────────────────────────────────────────────
// diaDeVigencia / fechaDeVigenciaAlcanzada — seguimiento post-A3
// (2026-09-26): vigencia por DÍA DE NEGOCIO, no por instante. Cubre la
// convención MIXTA real de `fecha_inicio_vigencia` (fecha-solo a medianoche
// UTC exacta desde la UI/schema, o un instante real desde algunos llamadores
// directos del service).
// ──────────────────────────────────────────────────────────────────────────

test("diaDeVigencia: medianoche UTC exacta se lee como fecha-solo (día UTC, sin corrimiento)", () => {
  assert.equal(diaDeVigencia(new Date("2026-09-27T00:00:00.000Z")), "2026-09-27");
});

test("diaDeVigencia: un instante con componente horario se lee en huso horario de Argentina", () => {
  // 2026-09-26T14:32:00Z = 11:32 hora Argentina, mismo día.
  assert.equal(diaDeVigencia(new Date("2026-09-26T14:32:00.000Z")), "2026-09-26");
  // 2026-09-27T01:00:00Z = 22:00 hora Argentina del día ANTERIOR.
  assert.equal(diaDeVigencia(new Date("2026-09-27T01:00:00.000Z")), "2026-09-26");
});

test("fechaDeVigenciaAlcanzada: caso del reporte — una fecha-solo de MAÑANA (medianoche UTC) NO está vigente a las 22:00 hora Argentina de HOY", () => {
  const fechaInicioVigenciaManana = new Date("2026-09-27T00:00:00.000Z"); // fecha-solo: "mañana"
  const hoy22hsArgentina = new Date("2026-09-27T01:00:00.000Z"); // 22:00 ART del día actual (26)
  assert.equal(fechaDeVigenciaAlcanzada(fechaInicioVigenciaManana, hoy22hsArgentina), false);
});

test("fechaDeVigenciaAlcanzada: la misma fecha-solo de MAÑANA SÍ está vigente justo a la medianoche real de Argentina", () => {
  const fechaInicioVigenciaManana = new Date("2026-09-27T00:00:00.000Z");
  const medianocheArgentinaDeManana = new Date("2026-09-27T03:00:00.000Z"); // 00:00 ART del día 27
  assert.equal(fechaDeVigenciaAlcanzada(fechaInicioVigenciaManana, medianocheArgentinaDeManana), true);
});

test("fechaDeVigenciaAlcanzada: un instante minutos antes de la medianoche de Argentina todavía no está vigente", () => {
  const fechaInicioVigenciaManana = new Date("2026-09-27T00:00:00.000Z");
  const unMinutoAntes = new Date("2026-09-27T02:59:00.000Z"); // 23:59 ART del día 26
  assert.equal(fechaDeVigenciaAlcanzada(fechaInicioVigenciaManana, unMinutoAntes), false);
});

test("fechaDeVigenciaAlcanzada: publicar con un instante real (new Date(), con hora) queda vigente de inmediato, sin correrse 1 día por leerlo en UTC", () => {
  // Simula `publicarNuevaVersionListaPrecio(proveedorId, new Date(), …)`
  // llamado directo (sin pasar por el schema): el instante y "ahora" son el
  // mismo momento real.
  const publicadoAhoraMismo = new Date("2026-09-26T14:32:00.000Z");
  assert.equal(fechaDeVigenciaAlcanzada(publicadoAhoraMismo, publicadoAhoraMismo), true);
});

test("fechaDeVigenciaAlcanzada: una fecha-solo de HOY está vigente (no exige que ya haya pasado el día completo)", () => {
  const hoy = new Date("2026-09-26T00:00:00.000Z");
  const masTardeHoy = new Date("2026-09-26T20:00:00.000Z"); // 17:00 hora Argentina
  assert.equal(fechaDeVigenciaAlcanzada(hoy, masTardeHoy), true);
});

test("fechaDeVigenciaAlcanzada: una fecha-solo del pasado sigue vigente", () => {
  const haceUnaSemana = new Date("2026-09-19T00:00:00.000Z");
  const ahora = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(fechaDeVigenciaAlcanzada(haceUnaSemana, ahora), true);
});

// ──────────────────────────────────────────────────────────────────────────
// sumarDiasCalendarioNegocio — plazo de retiro E12 (T06)
// ──────────────────────────────────────────────────────────────────────────

test("sumarDiasCalendarioNegocio: suma 1 día calendario preservando hora local", () => {
  // 2026-09-26T14:00:00Z = 11:00 hora Argentina
  const inicio = new Date("2026-09-26T14:00:00.000Z");
  const vencimiento = sumarDiasCalendarioNegocio(inicio, 1);
  assert.equal(vencimiento.toISOString(), "2026-09-27T14:00:00.000Z");
});

test("sumarDiasCalendarioNegocio: suma varios días calendario", () => {
  const inicio = new Date("2026-09-26T14:00:00.000Z");
  const vencimiento = sumarDiasCalendarioNegocio(inicio, 5);
  assert.equal(vencimiento.toISOString(), "2026-10-01T14:00:00.000Z");
});

test("sumarDiasCalendarioNegocio: cruza fin de mes", () => {
  const inicio = new Date("2026-09-30T18:00:00.000Z");
  const vencimiento = sumarDiasCalendarioNegocio(inicio, 2);
  assert.equal(vencimiento.toISOString(), "2026-10-02T18:00:00.000Z");
});

test("sumarDiasCalendarioNegocio: cruza fin de año", () => {
  const inicio = new Date("2026-12-31T20:00:00.000Z");
  const vencimiento = sumarDiasCalendarioNegocio(inicio, 3);
  assert.equal(vencimiento.toISOString(), "2027-01-03T20:00:00.000Z");
});

test("sumarDiasCalendarioNegocio: instante cercano a medianoche argentina", () => {
  // 2026-09-26T02:50:00Z = 2026-09-25 23:50 hora Argentina
  const inicio = new Date("2026-09-26T02:50:00.000Z");
  const vencimiento = sumarDiasCalendarioNegocio(inicio, 1);
  assert.equal(vencimiento.toISOString(), "2026-09-27T02:50:00.000Z");
});

// ──────────────────────────────────────────────────────────────────────────
// formatearFechaNegocio / formatearFechaHoraNegocio — presentación determinista
// (hydration SSR ↔ navegador, T19 HU-E13)
// ──────────────────────────────────────────────────────────────────────────

test("formateo de presentación: misma fecha ISO → mismo texto en hora Argentina, 24 h", () => {
  assert.equal(formatearFechaHoraNegocio("2026-10-08T22:44:00.000Z"), "08/10/2026 19:44");
  assert.equal(formatearFechaNegocio("2026-10-08T22:44:00.000Z"), "08/10/2026");
  assert.equal(formatearFechaHoraNegocio(new Date("2026-10-08T22:44:00.000Z")), "08/10/2026 19:44");
  // Corte de medianoche en hora Argentina, no en UTC.
  assert.equal(formatearFechaHoraNegocio("2026-10-09T02:59:00.000Z"), "08/10/2026 23:59");
  assert.equal(formatearFechaHoraNegocio("2026-10-09T03:00:00.000Z"), "09/10/2026 00:00");
  assert.equal(formatearFechaNegocio("2026-01-01T00:00:00.000Z"), "31/12/2025");
  // Sin texto dependiente de ICU: ni "a. m."/"p. m." ni nombres de mes ni espacios especiales.
  assert.match(formatearFechaHoraNegocio("2026-10-08T15:05:00.000Z"), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});

test("formateo de presentación: no depende de la zona horaria del proceso", () => {
  const original = process.env.TZ;
  const instante = "2026-10-08T22:44:00.000Z";
  const implicitas = new Set<string>();
  try {
    for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "America/Argentina/Salta"]) {
      process.env.TZ = tz;
      implicitas.add(new Date(instante).toLocaleString("es-AR"));
      assert.equal(formatearFechaHoraNegocio(instante), "08/10/2026 19:44", `TZ=${tz}`);
      assert.equal(formatearFechaNegocio("2026-10-09T02:59:00.000Z"), "08/10/2026", `TZ=${tz}`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
  // El runtime sí cambió de zona (el formateo implícito varió), y el helper no.
  assert.ok(implicitas.size > 1, "el cambio de TZ debe afectar al formateo implícito para que la prueba sea significativa");
});
