/**
 * @module hash-chain
 * @description Módulo de encadenamiento SHA-256 para el Ledger de Auditoría Forense.
 *
 * Mecanismo (RULES.md §2, spec_modulo_D.md §4.2):
 *  - Cada nuevo registro de AuditLog calcula su `hash_actual` como:
 *    SHA-256( JSON(payload canónico) + hash_anterior )
 *  - El `hash_anterior` del primer registro (génesis) es el string "GENESIS".
 *  - Esta cadena garantiza inmutabilidad: cualquier alteración de un registro
 *    invalida todos los hashes subsiguientes, detectable mediante verificación.
 *
 * Única fuente de este cálculo (task_cali_auditoria_forense.md §4.2): tanto
 * la inserción (`audit-log.service.ts::registrarAuditLog`) como la
 * verificación (`audit-log.service.ts::verificarCadenaIntegridad`) llaman
 * a esta misma función — nunca reimplementar el algoritmo en otro lugar.
 *
 * Referencia: RULES.md §2 — "Encadenamiento de Hash SHA-256 (Blockchain-like hashing)"
 *
 * @see src/lib/services/auditoria/audit-log.service.ts
 */
import "server-only";

import { createHash } from "node:crypto";

/** Hash de encadenamiento del primer registro del ledger (no hay predecesor). */
export const HASH_GENESIS = "GENESIS";

/**
 * Payload tipado para el cálculo del hash encadenado. Debe coincidir
 * exactamente con los campos persistidos en `AuditLog` (excluyendo
 * `id`/`hash_anterior`/`hash_actual`/`created_at` — el propio hash y su
 * timestamp de inserción no pueden participar del cálculo que los produce).
 */
export interface HashChainPayload {
  usuario_id: string | null;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
  ip: string;
  valor_anterior: unknown;
  valor_nuevo: unknown;
}

/**
 * Canonicaliza un valor JSON-compatible para hashing: ordena recursivamente
 * las claves de cada objeto (alfabético), preservando el orden de arrays y
 * los valores primitivos tal cual.
 *
 * IMPRESCINDIBLE, no solo "prolijo" (hallazgo de prueba en runtime,
 * task_cali_auditoria_forense.md §7 punto 4): PostgreSQL `jsonb` NO
 * preserva el orden de inserción de las claves de un objeto — al leer
 * `valor_anterior`/`valor_nuevo` de vuelta desde `AuditLog`, Postgres las
 * devuelve reordenadas (por longitud de clave, no por orden de escritura).
 * `JSON.stringify` naive sobre el objeto reordenado produce una cadena
 * distinta a la que se usó para calcular `hash_actual` en el insert
 * original, aunque el contenido lógico sea idéntico — la verificación
 * fallaría en el 100% de las filas con payload multi-clave, no por
 * manipulación real sino por un artefacto de almacenamiento. Ordenar
 * claves acá hace el hash invariante a cualquier reordenamiento de
 * Postgres (o de quien construya el payload), porque insert y verify
 * siempre convergen a la MISMA forma canónica sin importar el orden de
 * entrada.
 */
function canonicalizarJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizarJson);
  }

  if (value !== null && typeof value === "object") {
    const claves = Object.keys(value as Record<string, unknown>).sort();
    const ordenado: Record<string, unknown> = {};
    for (const clave of claves) {
      ordenado[clave] = canonicalizarJson((value as Record<string, unknown>)[clave]);
    }
    return ordenado;
  }

  return value;
}

/**
 * Serializa el payload en forma canónica y determinística — ver
 * `canonicalizarJson()`. Sin esto, la verificación retroactiva (§4.4)
 * recalcularía un hash distinto al persistido para el mismo dato lógico.
 */
function serializarPayloadCanonico(payload: HashChainPayload): string {
  return JSON.stringify(
    canonicalizarJson({
      usuario_id: payload.usuario_id,
      accion: payload.accion,
      tabla_afectada: payload.tabla_afectada,
      registro_id: payload.registro_id,
      ip: payload.ip,
      valor_anterior: payload.valor_anterior ?? null,
      valor_nuevo: payload.valor_nuevo ?? null,
    }),
  );
}

/**
 * Calcula SHA-256( payloadCanónico + hashAnterior ). Función pura —no
 * consulta la base ni tiene efectos secundarios— para que insertar y
 * verificar usen exactamente el mismo cálculo.
 *
 * @param payload - Datos del registro (sin `hash_anterior`/`hash_actual`).
 * @param hashAnterior - `hash_actual` de la fila previa en la cadena, o
 *                        `HASH_GENESIS` si es el primer registro.
 */
export function calcularHashEncadenado(payload: HashChainPayload, hashAnterior: string): string {
  const payloadCanonico = serializarPayloadCanonico(payload);
  return createHash("sha256").update(payloadCanonico + hashAnterior).digest("hex");
}
