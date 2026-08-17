/**
 * @module hash-chain
 * @description Módulo de encadenamiento SHA-256 para el Ledger de Auditoría Forense.
 *
 * Estado: STUB — Pendiente de implementación en HU-D (Módulo de Auditoría).
 *
 * Descripción del mecanismo planificado (RULES.md §2):
 *  - Cada nuevo registro de AuditLog calcula su `hash_actual` como:
 *    SHA-256( JSON(datosTransaccion) + hash_anterior )
 *  - El `hash_anterior` del primer registro (génesis) es el string "GENESIS".
 *  - Esta cadena garantiza inmutabilidad: cualquier alteración de un registro
 *    invalida todos los hashes subsiguientes, detectable mediante verificación.
 *
 * Referencia: RULES.md §2 — "Encadenamiento de Hash SHA-256 (Blockchain-like hashing)"
 *
 * @see src/lib/services/auditoria/audit-log.service.ts
 * @todo Implementar en HU-D (Módulo Auditoría Forense)
 */
import "server-only";

/**
 * Payload tipado para el cálculo del hash encadenado.
 * Se completará cuando se implemente el Ledger completo en HU-D.
 */
export interface HashChainPayload {
  tabla_afectada: string;
  registro_id: string | null;
  accion: string;
  valor_anterior: unknown;
  valor_nuevo: unknown;
  usuario_id: string | null;
  ip: string;
  timestamp: string;
}

/**
 * @stub Calcula SHA-256( JSON(payload) + hashAnterior ).
 * Implementación completa en HU-D (Módulo Auditoría).
 */
export async function calcularHashEncadenado(
  _payload: HashChainPayload,
  _hashAnterior: string,
): Promise<string> {
  // TODO (HU-D): implementar con node:crypto → createHash("sha256")
  throw new Error(
    "[hash-chain] calcularHashEncadenado() aún no implementado. " +
      "Pendiente HU-D (Módulo Auditoría Forense).",
  );
}
