/**
 * HU-G8 (Módulo G) — Funciones puras de HU-G8: cálculo del monto de una
 * `CuentaPorPagar` y validación de su máquina de estados. Sin acceso a
 * Prisma-client ni a ningún I/O: reciben datos ya leídos y devuelven un
 * valor. `cuenta-por-pagar.service.ts` las re-exporta y es su único llamador
 * en producción.
 *
 * Import relativo con extensión explícita y SIN `import "server-only"` — a
 * propósito, mismo criterio que `proveedores/evaluacion.calculo.ts`: este
 * módulo debe poder importarse tal cual bajo el test runner nativo de Node
 * (`node --experimental-strip-types --test`, `package.json#scripts.test`),
 * que no resuelve el alias `@/…` ni la condición `react-server` de
 * `server-only`.
 */

import { Prisma } from "@prisma/client";
import type { EstadoCuentaPorPagar } from "@prisma/client";

/** Acción de la máquina de estados de `CuentaPorPagar` (HU-G8 §3.1). */
export type AccionCuentaPorPagar = "DEFINIR" | "PAGAR" | "CANCELAR";

/** Línea mínima necesaria para calcular el monto: cantidad (Int) × precio (Decimal(10,2)). */
export interface ItemMontoCuentaPorPagar {
  cantidad_solicitada: number;
  precio_unitario: Prisma.Decimal;
}

/**
 * HU-G8 §2.1 / §2.2 — `monto = Σ(cantidad_solicitada × precio_unitario)`.
 *
 * Todo el cálculo corre en `Prisma.Decimal`: `precio_unitario.mul(cantidad)`
 * por línea, reducido con `.add` sobre un acumulador `new Prisma.Decimal(0)`.
 * NUNCA se convierte a `number` ni se llama `.toNumber()` — un producto o
 * suma monetaria no debe pasar por IEEE-754. `precio_unitario` es `Decimal(10,2)`
 * y `cantidad_solicitada` es `Int`, así que el resultado entra en escala 2
 * dentro de `CuentaPorPagar.monto Decimal(12,2)` sin redondeo.
 *
 * Lista vacía ⇒ `Decimal(0)`.
 */
export function calcularMontoDesdeItems(
  items: ItemMontoCuentaPorPagar[],
): Prisma.Decimal {
  return items.reduce(
    (acc, it) => acc.add(it.precio_unitario.mul(it.cantidad_solicitada)),
    new Prisma.Decimal(0),
  );
}

/** Línea para el monto DEFINITIVO: cantidad efectivamente aceptada × precio. */
export interface ItemMontoAceptadoCuentaPorPagar {
  cantidad_aceptada: number;
  precio_unitario: Prisma.Decimal;
}

/**
 * HU-G8 §2.2 — `monto DEFINITIVO = Σ(cantidad_aceptada × precio_unitario)`.
 *
 * A diferencia de `calcularMontoDesdeItems` (que suma lo PEDIDO,
 * `cantidad_solicitada`, y sirve para el PROVISORIO), esta suma lo
 * efectivamente **recibido y validado**: `cantidad_aceptada` de los
 * `RecepcionItem` — NO `cantidad_recibida` (la mercadería que llegó pero fue
 * rechazada por calidad/discrepancia no se factura) ni `cantidad_solicitada`.
 * El criterio 4 de HU-G8 lo pide textualmente: "sobre lo efectivamente
 * recibido y validado, nunca sobre lo simplemente pedido".
 *
 * Mismo tratamiento `Prisma.Decimal` que `calcularMontoDesdeItems`: producto y
 * suma en Decimal, sin `.toNumber()`. Cada entrada ya viene agregada por
 * `orden_compra_item_id` (suma de `cantidad_aceptada` sobre TODAS las
 * `Recepcion` activas de la orden — cubre recepciones parciales acumuladas).
 * Un ítem sin ninguna recepción aporta `cantidad_aceptada: 0` ⇒ suma 0, no
 * rompe. Lista vacía ⇒ `Decimal(0)`.
 */
export function calcularMontoDesdeItemsAceptados(
  items: ItemMontoAceptadoCuentaPorPagar[],
): Prisma.Decimal {
  return items.reduce(
    (acc, it) => acc.add(it.precio_unitario.mul(it.cantidad_aceptada)),
    new Prisma.Decimal(0),
  );
}

/**
 * HU-G8 §3.1 / §3.2 — máquina de estados de `CuentaPorPagar`. Las únicas
 * transiciones válidas son:
 *  - `PROVISORIO` → `DEFINIR`   (consolidación a DEFINITIVA, §2.2)
 *  - `PROVISORIO` → `CANCELAR`  (cancelación funcional, §2.3)
 *  - `DEFINITIVA` → `PAGAR`     (mutación manual de pago, §2.4)
 *
 * Cualquier otro par `(estadoActual, accion)` es inválido (incluye reintentar
 * una acción sobre un estado terminal `PAGADA` / `CANCELADA`). Función pura:
 * no toca Prisma, decide solo sobre el par recibido para ser verificable sin DB.
 */
export function esTransicionValidaCuentaPorPagar(
  estadoActual: EstadoCuentaPorPagar,
  accion: AccionCuentaPorPagar,
): boolean {
  return (
    (estadoActual === "PROVISORIO" && accion === "DEFINIR") ||
    (estadoActual === "PROVISORIO" && accion === "CANCELAR") ||
    (estadoActual === "DEFINITIVA" && accion === "PAGAR")
  );
}
