/**
 * @module auditoria-integridad.service
 * @description Verificación acotada de integridad de la cadena SHA-256 del
 * ledger forense (Módulo D), reutilizada por el dominio proveedores (HU-H6)
 * para señalar si un rango de eventos consultado podría estar afectado por
 * una ruptura de la cadena.
 *
 * HU-H6 (docs/tasks/sdd/HU-H6) — implementa exclusivamente T12 a T15
 * (`propose_HU-H6_FINAL.md`, `spec_HU-H6_FINAL.md`, `design_HU-H6_FINAL.md`,
 * `tasks_HU-H6_FINAL.md`). El endpoint (`route.ts`) es de tareas posteriores
 * (T16 en adelante) y no se toca desde este archivo.
 *
 * No reimplementa el algoritmo de hash ni el recorrido de la cadena: delega
 * 100% en `verificarCadenaIntegridad()` de Módulo D
 * (`src/lib/services/auditoria/audit-log.service.ts`), que es la ÚNICA
 * fuente de verdad sobre integridad del ledger — este archivo solo cachea su
 * resultado (TTL 30s, evitar recorrer TODO `AuditLog` en cada request) y
 * traduce el shape a lo que necesita el dominio proveedores.
 *
 * No importa `EventoAuditoriaProveedor` de `auditoria-proveedores.service.ts`
 * a propósito (Design, decisión cerrada): usa el tipo estructural mínimo
 * `ItemVerificableIntegridad` — cualquier objeto con `created_at` sirve, sin
 * acoplarse al DTO del otro archivo.
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  verificarCadenaIntegridad,
  type ResultadoVerificacionCadena,
} from "@/lib/services/auditoria/audit-log.service";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos (T13)
// ──────────────────────────────────────────────────────────────────────────────

export type ItemVerificableIntegridad = { created_at: Date | string };

export type VerificacionIntegridad = {
  integra: boolean;
  punto_ruptura_id: string | null;
  alcance: "global";
  afecta_rango_devuelto: boolean;
};

// ──────────────────────────────────────────────────────────────────────────────
// Cache TTL de verificarCadenaIntegridad() (T14)
// ──────────────────────────────────────────────────────────────────────────────

const TTL_INTEGRIDAD_MS = 30_000;

let cacheIntegridad: { resultado: ResultadoVerificacionCadena; expiraEn: number } | null = null;

/**
 * Envuelve `verificarCadenaIntegridad()` (Módulo D, sin parámetros) con un
 * cache TTL de módulo — esa función recorre TODO `AuditLog` en cada
 * invocación real, así que no conviene ejecutarla en cada request.
 *
 * NO calca el patrón `colaLedger` de `audit-log.service.ts`: esa variable es
 * una cola de serialización de ESCRITURAS (encadenamiento de promesas para
 * que dos `registrarAuditLog()` concurrentes nunca lean el mismo
 * `hash_anterior`). Acá el problema es otro — cachear por tiempo acotado el
 * RESULTADO de una lectura costosa — y no hay ningún mecanismo de ese tipo
 * en ese archivo para reutilizar; por eso este cache es una variable de
 * módulo `{ resultado, expiraEn }` simple, la forma más directa de resolver
 * exactamente este problema.
 */
async function obtenerCadenaIntegridadConCache(): Promise<ResultadoVerificacionCadena> {
  const ahora = Date.now();
  if (cacheIntegridad && cacheIntegridad.expiraEn > ahora) {
    return cacheIntegridad.resultado;
  }

  const resultado = await verificarCadenaIntegridad();
  cacheIntegridad = { resultado, expiraEn: ahora + TTL_INTEGRIDAD_MS };
  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// Verificación acotada a un rango de items (T15)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Verifica la integridad GLOBAL de la cadena (vía cache TTL) y determina si
 * una eventual ruptura afecta al rango de `items` efectivamente devuelto
 * (ej. el listado paginado de `listarEventosDeDominioProveedores`).
 *
 * `alcance` es siempre `'global'`: no existe una verificación de integridad
 * "por dominio" o "por rango" en Módulo D — la cadena SHA-256 es única para
 * TODO `AuditLog`. Lo que sí es acotado es `afecta_rango_devuelto`: compara
 * el `created_at` del punto de ruptura contra los `items` recibidos.
 *
 * `verificarCadenaIntegridad()` devuelve una unión discriminada real
 * `{ integra: true; registros_verificados } | { integra: false;
 * registros_verificados; primer_registro_divergente_id; hash_esperado;
 * hash_almacenado }` — el campo se llama `primer_registro_divergente_id`,
 * NO `punto_ruptura_id`; se traduce acá al nombre de campo que expone el
 * DTO de este dominio (mismo patrón de traducción entre capas que
 * `CANAL_POR_ACCION_REAL` en `auditoria-proveedores.service.ts`). Cuando
 * `integra` es `false`, ese campo es siempre `string` (nunca `null`) por el
 * propio tipo de Módulo D — el caso "punto de ruptura null" no existe.
 *
 * Si el `findUnique` por `primer_registro_divergente_id` no encuentra la
 * fila (AuditLog es append-only — nunca debería faltar), se lanza de forma
 * explícita: es un invariante violado (bug de referencia o violación del
 * append-only del ledger), nunca se esconde detrás de un
 * `afecta_rango_devuelto` fail-safe silencioso — decisión explícita del
 * usuario.
 */
export async function verificarIntegridadParaRango(
  items: ItemVerificableIntegridad[],
): Promise<VerificacionIntegridad> {
  const resultado = await obtenerCadenaIntegridadConCache();

  if (resultado.integra) {
    return { integra: true, punto_ruptura_id: null, alcance: "global", afecta_rango_devuelto: false };
  }

  const puntoRuptura = await prisma.auditLog.findUnique({
    where: { id: resultado.primer_registro_divergente_id },
    select: { created_at: true },
  });

  if (!puntoRuptura) {
    throw new Error(
      `Inconsistencia de índice forense: verificarCadenaIntegridad() reportó divergencia en el registro ${resultado.primer_registro_divergente_id}, pero no se encontró en AuditLog — posible violación del invariante append-only o error de referencia de tabla.`,
    );
  }

  const afectaRangoDevuelto = items.some(
    (item) => new Date(item.created_at) >= puntoRuptura.created_at,
  );

  return {
    integra: false,
    punto_ruptura_id: resultado.primer_registro_divergente_id,
    alcance: "global",
    afecta_rango_devuelto: afectaRangoDevuelto,
  };
}
