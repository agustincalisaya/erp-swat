/**
 * @module variante.service
 * @description HU-A6 — Baja lógica (Soft Delete) de `VarianteSKU` con modal
 * de justificación (spec_modulo_A.md §2.5/§3.5/§4, spec_modulo_D.md §4).
 *
 * Cumplimiento normativo:
 *  - RULES.md §1 — Soft Delete estricto: solo lectura de `is_active: true`,
 *    ningún DELETE físico en este archivo. La baja es un `UPDATE` de los 4
 *    campos de soft delete (`is_active`, `deleted_at`, `deleted_by`,
 *    `deletion_reason`) — nunca se tocan `StockDeposito` ni
 *    `MovimientoStock` como efecto colateral (se preservan para trazabilidad).
 *  - spec_modulo_A.md §4 — el evento se emite DESPUÉS de que la operación
 *    resuelva exitosamente, nunca dentro de una transacción. Este service no
 *    escribe `AuditLog` directamente: emite al bus y `audit-log.listener.ts`
 *    reacciona (patrón unificado, ver docstring de ese listener).
 *
 * Autorización (decisión D2): los roles activos `ADMINISTRADOR` y
 * `ENCARGADO_DEPOSITO` pueden dar de baja variantes — verificado vía
 * `usuarioPuedeBajarVariante()`, exportada para que route handler y Server
 * Action compartan el mismo punto de verdad. No se usa
 * `withPermission("inventario:operar")` porque el seed solo otorga ese
 * permiso a `ENCARGADO_DEPOSITO` y dejaría fuera a `ADMINISTRADOR`.
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";

/** Roles con autorización vigente para dar de baja variantes (decisión D2). */
const ROLES_AUTORIZADOS_BAJA_VARIANTE = ["ADMINISTRADOR", "ENCARGADO_DEPOSITO"] as const;

/** Resultado de `darDeBajaVariante()` — solo los 4 campos de soft delete. */
export interface VarianteDadaDeBaja {
  id: string;
  is_active: boolean;
  /** Nullable en el schema real (`VarianteSKU.deleted_at DateTime?`); tras el update siempre trae fecha. */
  deleted_at: Date | null;
  deletion_reason: string | null;
}

/**
 * Verifica si el usuario tiene al menos un rol activo autorizado para dar de
 * baja variantes (`ADMINISTRADOR` o `ENCARGADO_DEPOSITO`), con la relación
 * `UsuarioRol → Rol` activa en ambos niveles (mismo patrón de
 * `usuarioTienePermiso()` en `lib/auth/with-permission.ts`).
 *
 * @param usuarioId - `usuario_id` de la sesión autenticada.
 */
export async function usuarioPuedeBajarVariante(usuarioId: string): Promise<boolean> {
  const match = await prisma.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId,
      is_active: true,
      rol: {
        is_active: true,
        nombre: { in: [...ROLES_AUTORIZADOS_BAJA_VARIANTE] },
      },
    },
    select: { id: true },
  });

  return match !== null;
}

/**
 * Baja lógica de una `VarianteSKU`, consciente del stock remanente:
 *  - stock total = `SUM(StockDeposito.cantidad)` sobre registros ACTIVOS de
 *    la variante (nulo → 0, decisión D10);
 *  - si el stock es 0 → baja directa y silenciosa (`deletion_reason = null`);
 *  - si el stock es > 0 y no hay `motivo` → `ServiceError("MOTIVO_REQUERIDO")`
 *    SIN tocar la base (defensa en profundidad, R3);
 *  - el `UPDATE` solo toca los 4 campos de soft delete, y el evento
 *    `inventario:variante_baja_logica` se emite DESPUÉS del update — nunca
 *    dentro de `prisma.$transaction` (regla de emisión, spec A §4). La
 *    mutación es de una sola tabla, no requiere transacción.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA | MOTIVO_REQUERIDO
 */
export async function darDeBajaVariante(
  varianteId: string,
  usuarioId: string,
  motivo?: string,
  ip = "unknown",
): Promise<VarianteDadaDeBaja> {
  const variante = await prisma.varianteSKU.findFirst({
    where: { id: varianteId, is_active: true },
    select: { id: true },
  });

  if (!variante) {
    throw new ServiceError(
      "VARIANTE_NO_ENCONTRADA",
      `No se encontró una variante activa con id ${varianteId}.`,
    );
  }

  // Un único aggregate por baja (spec A §3.5): stock activo previo al update.
  const stockTotal =
    (
      await prisma.stockDeposito.aggregate({
        where: { variante_sku_id: varianteId, is_active: true },
        _sum: { cantidad: true },
      })
    )._sum.cantidad ?? 0;

  if (stockTotal > 0 && !motivo?.trim()) {
    throw new ServiceError(
      "MOTIVO_REQUERIDO",
      "La variante tiene stock remanente en depósito: el motivo de baja es obligatorio.",
    );
  }

  const varianteDadaDeBaja = await prisma.varianteSKU.update({
    where: { id: varianteId },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: usuarioId,
      deletion_reason: motivo?.trim() || null,
    },
    select: { id: true, is_active: true, deleted_at: true, deletion_reason: true },
  });

  // Emisión POST-operación: `AuditLog` lo escribe exclusivamente el listener.
  domainEventBus.emit("inventario:variante_baja_logica", {
    variante_sku_id: varianteDadaDeBaja.id,
    usuario_id: usuarioId,
    deletion_reason: varianteDadaDeBaja.deletion_reason,
    stock_total_al_momento: stockTotal,
    ip,
  });

  return varianteDadaDeBaja;
}