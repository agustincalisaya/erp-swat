/**
 * HU-F3 — Reglas puras del Motor de Notificaciones (spec_modulo_F.md §2.3/§3.2).
 * Sin Prisma ni `server-only`: importables desde `node --test`.
 *
 * MÍNIMO introducido por HU-E1 (aprobado por el owner). El owner de HU-F3
 * completa el Motor (más consumidores de la tabla §3.3, bandejas, rutas).
 */
import { createHash } from "node:crypto";

/**
 * Clave de idempotencia de una notificación para un evento SIN `evento_id`
 * propio (spec F §2.3): `sha256(tipo_evento:registro_id:destinatario_id)`.
 * Misma fórmula que los fixtures de `prisma/seed.ts` (bloque HU-F3).
 */
export function calcularClaveIdempotencia(
  tipoEvento: string,
  registroId: string,
  destinatarioId: string,
): string {
  return createHash("sha256").update(`${tipoEvento}:${registroId}:${destinatarioId}`).digest("hex");
}

/**
 * Reemplaza `{{variable}}` por su valor (spec F §3.2): `replaceAll`, sin motor
 * de templating. Una variable sin valor se sustituye por cadena vacía, nunca
 * lanza — una plantilla mal configurada no tumba el procesamiento del evento.
 */
export function renderizarPlantilla(
  texto: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_coincidencia, nombre: string) => {
    const valor = variables[nombre];
    return valor === null || valor === undefined ? "" : String(valor);
  });
}
