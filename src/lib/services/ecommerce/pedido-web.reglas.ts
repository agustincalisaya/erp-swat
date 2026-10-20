/**
 * HU-E1 — Estado VISIBLE de un pedido web Pago Pendiente en la tienda.
 *
 * Solo lectura: NO cambia `PedidoVentaEcommerce.estado_ecommerce` (la
 * transición a ANULADO por TTL vencido es de HU-E7, spec_modulo_E.md §2.7 —
 * coordinación pendiente, ver docs/tasks/HU-E1.md). Mientras E7 no exista, un
 * pedido PAGO_PENDIENTE cuya reserva ya venció no puede mostrarse como
 * "pendiente de pago": se muestra "Reserva vencida", derivado de
 * `ttl_expiracion` (el vencimiento más próximo de sus reservas).
 * Función pura (sin Prisma) para testearla con node --test.
 */

export type EstadoVisiblePedidoWeb = "PAGO_PENDIENTE" | "RESERVA_VENCIDA";

export function derivarEstadoVisiblePedidoWeb(
  ttlExpiracion: Date,
  ahora: Date = new Date(),
): EstadoVisiblePedidoWeb {
  return ttlExpiracion.getTime() <= ahora.getTime() ? "RESERVA_VENCIDA" : "PAGO_PENDIENTE";
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-E15 — plazo de la reserva expresado en minutos (spec_modulo_E.md §6.1)
// ──────────────────────────────────────────────────────────────────────────────

/** E15-2: plazo informativo del carrito. Al navegador solo viajan minutos. */
export function minutosDePlazoCheckout(horas: number): number {
  return horas * 60;
}

/**
 * E15-4: minutos restantes de la reserva para el diálogo de confirmación,
 * redondeados hacia arriba. `<= 0` equivale a "RESERVA_VENCIDA" de
 * `derivarEstadoVisiblePedidoWeb` (mismo borde: `ttl <= ahora`).
 */
export function minutosRestantesReserva(ttlExpiracion: Date, ahora: Date = new Date()): number {
  return Math.ceil((ttlExpiracion.getTime() - ahora.getTime()) / 60_000);
}

/** Códigos de configuración que degradan al texto genérico (HU15 D2/C2). */
const CODIGOS_CONFIGURACION_DEGRADABLE = new Set(["CONFIGURACION_INVALIDA", "CONFIGURACION_NO_ENCONTRADA"]);

/**
 * E15-2 / D2: minutos del plazo de reserva, o `null` si la clave falta o es
 * inválida (sin default: el carrito muestra el texto genérico). Cualquier otro
 * error se propaga. `leerHoras` se inyecta para probarla sin base de datos.
 */
export async function resolverPlazoCheckoutMinutos(leerHoras: () => Promise<number>): Promise<number | null> {
  try {
    return minutosDePlazoCheckout(await leerHoras());
  } catch (error) {
    const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    if (typeof codigo === "string" && CODIGOS_CONFIGURACION_DEGRADABLE.has(codigo)) {
      // Solo el código: el mensaje incluye el valor configurado.
      console.error(`[checkout] Plazo de reserva no disponible: ${codigo}`);
      return null;
    }
    throw error;
  }
}
