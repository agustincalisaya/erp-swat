/**
 * @module audit-log.service
 * @description Servicio de Ledger de Auditoría Forense (append-only, SHA-256 encadenado).
 *
 * Estado: STUB — Pendiente de implementación en HU-D (Módulo Auditoría).
 *
 * Comportamiento planificado (RULES.md §2):
 *  1. Obtener el `hash_actual` del último AuditLog (o "GENESIS" si el ledger está vacío).
 *  2. Calcular: hash_actual = SHA-256( JSON(payload) + hash_anterior ).
 *  3. Insertar el nuevo AuditLog dentro de la misma transacción Prisma (si se provee `tx`).
 *     Esto garantiza atomicidad: el log se crea o se revierte junto con la operación principal.
 *
 * Importante: La tabla `audit_logs` es append-only por diseño (no tiene soft-delete).
 * Ningún registro debe modificarse ni borrarse jamás.
 *
 * @see src/lib/crypto/hash-chain.ts
 * @see prisma/schema.prisma → model AuditLog
 * @todo Implementar en HU-D (Módulo Auditoría Forense)
 */
import "server-only";

import type { Prisma } from "@prisma/client";

export interface RegistrarAuditLogParams {
  usuario_id: string | null;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
  ip: string;
  valor_anterior?: unknown;
  valor_nuevo?: unknown;
}

/**
 * @stub Registra una entrada en el Ledger de Auditoría.
 * Pendiente de implementación completa en HU-D.
 *
 * En la implementación definitiva recibirá un `tx: Prisma.TransactionClient`
 * opcional para operar dentro de la transacción del llamador.
 */
export async function registrarAuditLog(
  _params: RegistrarAuditLogParams,
  _tx?: Prisma.TransactionClient,
): Promise<void> {
  // TODO (HU-D): implementar con hash-chain.ts y AuditLog Prisma insert.
  // Por ahora es un no-op para no bloquear HU-A3.
  // El evento de dominio `inventario:legajo_prueba_iniciado` cumple
  // el rol de trazabilidad temporal hasta que el Ledger esté operativo.
  return;
}
