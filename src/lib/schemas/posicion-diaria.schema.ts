import { z } from "zod";

// Import RELATIVO con extensión explícita (`../utils/fecha-negocio.ts`), no el
// alias `@/…`: este módulo lo consume el test unitario nativo de Node
// (`node --experimental-strip-types --test`), que no resuelve los `paths` de
// tsconfig.json — mismo criterio que `lista-precios.schema.ts` y que
// `posicion-diaria.calculo.ts`.
import { diaNegocioIso, inicioDiaUtc } from "../utils/fecha-negocio.ts";

/**
 * Schemas Zod de HU-G7 — Posición diaria consolidada de Tesorería
 * (spec_modulo_G.md §9.8).
 *
 * Convención del módulo (spec §9.1, igual que `cuentas-por-pagar.schema.ts` y
 * `cuenta-propia.schema.ts`): estos schemas validan FORMA. La existencia real
 * de la cuenta, su estado `is_active` y la autorización por permiso son
 * responsabilidad de la capa de servicios (`posicion-diaria.service.ts`),
 * nunca de estos schemas.
 */

// ──────────────────────────────────────────────────────────────────────────────
// §9.8 — Día de negocio (AAAA-MM-DD)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Día calendario `AAAA-MM-DD`. Tres reglas: formato, día que exista de verdad
 * en el calendario (rechaza `2026-02-30`) y que NO sea futuro respecto del día
 * de negocio de Argentina (`diaNegocioIso`). Nunca se valida contra la
 * medianoche local, solo contra el día de negocio (misma familia de bug que
 * documenta `fecha-negocio.ts`).
 */
export const DiaIsoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "El día debe tener formato AAAA-MM-DD")
  .refine((valor) => {
    // `inicioDiaUtc` de un día inexistente (`2026-02-30`) da `Invalid Date`;
    // `.toISOString()` lanzaría `RangeError`, así que se corta antes. Un
    // formato inválido (`15/10/2026`) tampoco llega a ser una fecha válida.
    const fecha = inicioDiaUtc(valor);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
  }, "El día indicado no existe en el calendario")
  .refine((valor) => valor <= diaNegocioIso(), "El día no puede ser futuro");

// ──────────────────────────────────────────────────────────────────────────────
// §9.8 / G7-4 — Registro de un saldo diario (append-only)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registro de un `SaldoDiarioCuenta`. `cuenta_id` es un string NO vacío (los
 * `id` sembrados —`banco-nacion-cc-principal`, etc.— NO son UUID, mismo
 * criterio que `CuentaPropiaIdSchema`). El `saldo` viaja como STRING con como
 * máximo 2 decimales: se RECHAZA la 3.ª decimal en vez de redondearla
 * (design ADR-3: el redondeo silencioso es una pérdida de centavos).
 */
export const RegistrarSaldoDiarioSchema = z.object({
  cuenta_id: z.string().min(1, "La cuenta es obligatoria"),
  fecha: DiaIsoSchema,
  saldo: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,2})?$/, "El saldo admite como máximo 2 decimales"),
});

export type RegistrarSaldoDiarioInput = z.infer<typeof RegistrarSaldoDiarioSchema>;
