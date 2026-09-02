/**
 * HU-G8 (Módulo G) — Mapa puro `accion` de `OrdenCompra` → rama reactiva de la
 * máquina de estados de `CuentaPorPagar` (spec_modulo_G.md §2.1–2.3 / §4.3).
 *
 * Extraído del listener (`cuenta-por-pagar.listener.ts`, que lleva
 * `import "server-only"`) para poder verificarlo bajo el test runner nativo de
 * Node (`node --experimental-strip-types --test`, `package.json#scripts.test`),
 * que no resuelve el alias `@/…` ni la condición `react-server` de
 * `server-only` — mismo criterio que `cuenta-por-pagar.calculo.ts`.
 *
 * Sin acceso a Prisma ni al bus de eventos: recibe la `accion` del payload de
 * `orden_compra:estado_cambiado` y devuelve qué rama del listener corresponde.
 */

/** Rama reactiva de HU-G8 que dispara cada acción de `OrdenCompra`. */
export type RamaCuentaPorPagar = "generar" | "consolidar" | "cancelar" | "ignorar";

/**
 * - `ENVIAR`   → `"generar"`    (genera la Cuenta por Pagar provisoria, §2.1)
 * - `CERRAR`   → `"consolidar"` (consolida a definitiva, §2.2)
 * - `CANCELAR` → `"cancelar"`   (cancela la provisoria, §2.3)
 * - `CONFIRMAR` y cualquier otra acción (incl. valores desconocidos) → `"ignorar"`
 *   (sin efecto sobre Cuentas por Pagar; el listener hace un no-op).
 *
 * Acepta `string` a propósito: el bus podría entregar una `accion` fuera del
 * union tipado y el listener nunca debe lanzar por eso (spec §3.6).
 */
export function resolverAccionCuentaPorPagar(accion: string): RamaCuentaPorPagar {
  switch (accion) {
    case "ENVIAR":
      return "generar";
    case "CERRAR":
      return "consolidar";
    case "CANCELAR":
      return "cancelar";
    default:
      return "ignorar";
  }
}
