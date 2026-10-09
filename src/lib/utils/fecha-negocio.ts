/**
 * @module fecha-negocio
 * @description Helper compartido de "día calendario de negocio" (auditoría
 * transversal Módulo H, 2026-09-26 —
 * `docs/modulos/modulo H/AUDITORIA_TRANSVERSAL_MODULO_H.md`, hallazgos
 * A1/A2/D8). Zona horaria de negocio: Argentina
 * (`America/Argentina/Buenos_Aires`, UTC-3 fijo — el país no observa horario
 * de verano desde 2009, así que un offset fijo es equivalente a resolver el
 * TZID real y evita traer una librería de zonas horarias).
 *
 * Nace para no repetir por 4ta vez la misma familia de bug (medianoche UTC
 * vs. medianoche local vs. instante real): HU-G10 (`fecha_pago`), Bug 1 de
 * HU-H3 (`estaEntregaVencida`, D8), Bug 1 de la UI de HU-H2, y ahora
 * A1 (`lista-precios.schema.ts`) / A2 (`evaluacion.calculo.ts`) de la
 * auditoría transversal. Generaliza el patrón ya usado —sin exportar— en
 * `inventario/movimiento.service.ts` / `inventario/transferencia.service.ts`
 * (`inicioDiaArgentina`).
 *
 * Convención de "fecha-solo" ya establecida en el proyecto (columnas
 * `DateTime` que en realidad representan un día calendario, ej.
 * `fecha_inicio_vigencia`, `fecha_entrega_comprometida`): se persisten a
 * medianoche **UTC** del día elegido — NO a medianoche de Argentina (ver
 * comentario de `orden-compra.service.ts` sobre el formateo de esas
 * columnas). Por eso `diaCalendarioUtc()` lee el día en UTC (para esos
 * valores), mientras que `diaNegocioIso()` lee el día en huso horario de
 * Argentina (para instantes reales: `new Date()`, `fecha_recepcion`, etc.).
 *
 * Módulo PURO: sin `server-only`, sin Prisma, sin alias `@/...` — importable
 * tanto desde código de aplicación (alias `@/lib/utils/fecha-negocio`) como
 * desde los módulos "puros" testeados con el runner nativo de Node
 * (`node --experimental-strip-types --test`), que no resuelve alias de
 * `tsconfig.json`; estos últimos deben importarlo con ruta relativa y
 * extensión explícita (mismo patrón que `evaluacion.calculo.ts` /
 * `lista-precios.calculo.ts`).
 */

import { addDays } from "date-fns";

const ZONA_HORARIA_NEGOCIO = "America/Argentina/Buenos_Aires";

const FORMATEADOR_DIA_NEGOCIO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FORMATEADOR_DIA_UTC = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Offset fijo de Argentina (UTC-3). El país no observa DST desde 2009, por lo
// que un offset constante es equivalente a resolver TZID para operaciones de
// día calendario.
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

/**
 * Día calendario de negocio (`AAAA-MM-DD`, huso horario de Argentina) de un
 * instante real. `ahora` es inyectable para tests — por defecto, `new Date()`
 * evaluado en el momento de la llamada (nunca se cachea "ahora").
 */
export function diaNegocioIso(ahora: Date = new Date()): string {
  // `en-CA` formatea como `AAAA-MM-DD` de forma nativa (sin post-proceso).
  return FORMATEADOR_DIA_NEGOCIO.format(ahora);
}

/**
 * Día calendario (`AAAA-MM-DD`) de un valor "fecha-solo" persistido a
 * medianoche UTC (`fecha_inicio_vigencia`, `fecha_entrega_comprometida`,
 * etc.). Lee en UTC a propósito: esos valores YA representan el día elegido
 * en su medianoche UTC — leerlos en huso de Argentina les restaría un día
 * (el mismo bug ya corregido para MOSTRARLOS en `HistorialVersionesListaPrecio.tsx`
 * / `ComparativaPreciosCard.tsx`; acá se corrige el mismo problema pero para
 * COMPARARLOS).
 */
export function diaCalendarioUtc(fechaSolo: Date): string {
  return FORMATEADOR_DIA_UTC.format(fechaSolo);
}

/** Medianoche UTC de un día calendario (`AAAA-MM-DD`) — misma convención de "fecha-solo" que usa la base. */
export function inicioDiaUtc(diaIso: string): Date {
  return new Date(`${diaIso}T00:00:00.000Z`);
}

/**
 * El día de negocio de "ahora" (o de un instante dado), representado como
 * "fecha-solo" a medianoche UTC — listo para comparar contra columnas como
 * `fecha_inicio_vigencia` con la misma convención que usa la base (ver
 * docstring del módulo).
 */
export function hoyComoFechaSoloUtc(ahora: Date = new Date()): Date {
  return inicioDiaUtc(diaNegocioIso(ahora));
}

/**
 * `true` si una fecha-solo (medianoche UTC) representa un día calendario
 * ANTERIOR al día de negocio de "ahora". El día de HOY nunca es "anterior"
 * (bug A1 de la auditoría transversal de Módulo H: el validador viejo
 * rechazaba la fecha de hoy comparando contra la medianoche LOCAL en vez del
 * día calendario).
 */
export function esFechaSoloAnteriorAHoyNegocio(
  fechaSolo: Date,
  ahora: Date = new Date(),
): boolean {
  return fechaSolo.getTime() < hoyComoFechaSoloUtc(ahora).getTime();
}

/**
 * Días calendario COMPLETOS entre una fecha-solo (medianoche UTC, ej.
 * `fecha_entrega_comprometida`) y un instante real (ej. `fecha_recepcion`),
 * sin redondear horas (bug A2/D8 de la auditoría transversal de Módulo H).
 * El instante se reduce a su día de negocio en Argentina
 * (`diaNegocioIso`); la fecha-solo se lee en UTC (`diaCalendarioUtc`) — cada
 * una con la convención que le corresponde (ver docstring del módulo).
 * Positivo si `instante` cae en un día de negocio posterior al de
 * `fechaSolo`; puede dar negativo (el llamador decide si aplica
 * `Math.max(0, …)`).
 */
export function diasDesdeFechaSolo(fechaSolo: Date, instante: Date): number {
  const diaFechaSolo = inicioDiaUtc(diaCalendarioUtc(fechaSolo));
  const diaInstante = inicioDiaUtc(diaNegocioIso(instante));
  return Math.round((diaInstante.getTime() - diaFechaSolo.getTime()) / MS_POR_DIA);
}

/**
 * Día de negocio (`AAAA-MM-DD`) de un valor `fecha_inicio_vigencia` (u otro
 * campo con la misma convención MIXTA en este proyecto: la mayoría de los
 * valores son fecha-solo a medianoche UTC EXACTA —origen: un
 * `<input type="date">` coercionado por Zod—, pero algunos llamadores
 * directos del service (tests de integración, el paso de versión crítica de
 * `prisma/seed.ts` antes de truncarlo, cualquier script) pasan un INSTANTE
 * real como `new Date()`).
 *
 * Detecta cuál de los dos es:
 *  - Medianoche UTC EXACTA (`00:00:00.000`) → se interpreta como fecha-solo
 *    (`diaCalendarioUtc`): representa el día calendario que alguien eligió,
 *    independiente de cualquier huso horario.
 *  - Cualquier otro valor (tiene componente horario) → es un instante real:
 *    se interpreta en huso horario de Argentina (`diaNegocioIso`), igual que
 *    cualquier otro instante del sistema (`fecha_recepcion`, etc.) — así
 *    "publicar ahora mismo" (`new Date()` real, con hora) sigue quedando
 *    vigente de inmediato en vez de correr 1 día por leerlo en UTC.
 *
 * Riesgo aceptado y documentado: un instante real que caiga EXACTO en
 * medianoche UTC (probabilidad ~1 en 86 400 000) se leería como fecha-solo.
 * Es el mismo orden de magnitud de riesgo que ya acepta el resto del
 * proyecto para esta clase de ambigüedad (ver `orden-compra.service.ts`,
 * comentario de formateo de fecha-solo).
 */
export function diaDeVigencia(valor: Date): string {
  const esFechaSolo =
    valor.getUTCHours() === 0 &&
    valor.getUTCMinutes() === 0 &&
    valor.getUTCSeconds() === 0 &&
    valor.getUTCMilliseconds() === 0;
  return esFechaSolo ? diaCalendarioUtc(valor) : diaNegocioIso(valor);
}

/**
 * `true` si `fechaInicioVigencia` (ver `diaDeVigencia`) ya alcanzó su día de
 * negocio respecto del día de negocio de `ahora`.
 *
 * Reemplaza la comparación de INSTANTES `fecha_inicio_vigencia <= new Date()`
 * que usaba `obtenerVersionVigente()` (`lista-precios.service.ts`): esa
 * comparación dejaba "vigente" una fecha-solo de MAÑANA hasta 3 h antes de
 * la medianoche real de Argentina — a partir de las 21:00 hora local, "mañana
 * a medianoche UTC" ya es `<= new Date()`. Seguimiento post-fix A3 de la
 * auditoría transversal Módulo H (2026-09-26), confirmado por el usuario.
 * `ahora` inyectable para tests.
 */
export function fechaDeVigenciaAlcanzada(
  fechaInicioVigencia: Date,
  ahora: Date = new Date(),
): boolean {
  return diaDeVigencia(fechaInicioVigencia) <= diaNegocioIso(ahora);
}

/**
 * Suma `dias` calendario de negocio (huso horario de Argentina) a un instante
 * real, preservando la hora local argentina. Argentina no observa horario de
 * verano, por lo que un offset fijo es suficiente; sin embargo, la operación se
 * realiza sobre componentes de día calendario (`addDays`) para respetar meses y
 * años, no como duración de 24h.
 *
 * `instante` se convierte primero al "tiempo local argentino" (UTC+3), se
 * suman los días calendario, y se vuelve a UTC. Así una lectura hecha a las
 * 14:00 AR el día N termina con vencimiento a las 14:00 AR del día N+dias.
 */
export function sumarDiasCalendarioNegocio(instante: Date, dias: number): Date {
  const tiempoArgentino = new Date(instante.getTime() + OFFSET_ARGENTINA_MS);
  const conDiasSumados = addDays(tiempoArgentino, dias);
  return new Date(conDiasSumados.getTime() - OFFSET_ARGENTINA_MS);
}

/**
 * Formateo de PRESENTACIÓN determinista (hydration SSR ↔ navegador, T19 HU-E13).
 *
 * `Intl.DateTimeFormat` sin `timeZone` usa la zona del runtime (el servidor y
 * el navegador pueden diferir), y `dateStyle`/`timeStyle` delegan el texto
 * ("oct", "p. m." con espacios especiales) a los datos ICU de cada runtime.
 * Acá la zona es la del negocio, el locale es-AR, el reloj de 24 h, y el texto
 * se arma desde las partes numéricas: mismo resultado en Node y en cualquier
 * navegador. Formato: `dd/mm/aaaa` y `dd/mm/aaaa HH:mm`.
 */
const FORMATEADOR_PARTES_NEGOCIO = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partesNegocio(instante: Date | string): Record<"day" | "month" | "year" | "hour" | "minute", string> {
  const partes: Record<string, string> = {};
  for (const parte of FORMATEADOR_PARTES_NEGOCIO.formatToParts(new Date(instante))) partes[parte.type] = parte.value;
  return partes as Record<"day" | "month" | "year" | "hour" | "minute", string>;
}

/** `dd/mm/aaaa` en huso horario de negocio. */
export function formatearFechaNegocio(instante: Date | string): string {
  const p = partesNegocio(instante);
  return `${p.day}/${p.month}/${p.year}`;
}

/** `dd/mm/aaaa HH:mm` (24 h) en huso horario de negocio. */
export function formatearFechaHoraNegocio(instante: Date | string): string {
  const p = partesNegocio(instante);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
