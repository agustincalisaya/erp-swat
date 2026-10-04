/**
 * HU-E4 — Texto legible del motivo de baja de un cupón. Módulo puro y apto
 * para el cliente (sin Prisma ni código de servidor). Los valores guardados
 * en la base no cambian: solo se traducen los códigos automáticos al mostrarlos.
 */
const MOTIVOS_AUTOMATICOS: Record<string, string> = {
  VENCIMIENTO: "Vencimiento",
  LIMITE_GLOBAL_AGOTADO: "Límite de uso agotado",
  // Motivo de nivel aplicación (MOTIVO_TTL_CHECKOUT_VENCIDO en cupon.service.ts).
  TTL_CHECKOUT_VENCIDO: "Reserva vencida",
};

/** Código automático → texto legible; cualquier otro valor (motivo manual) se devuelve sin cambios. */
export function textoMotivoBajaCupon(motivo: string): string {
  return Object.hasOwn(MOTIVOS_AUTOMATICOS, motivo) ? MOTIVOS_AUTOMATICOS[motivo] : motivo;
}
