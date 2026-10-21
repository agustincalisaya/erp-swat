/**
 * HU-E11 / HU-E16 — Lock de la fila del contenido web ACTIVO
 * (spec_modulo_E.md §2.11.d y §6.2 "Concurrencia").
 *
 * Lo comparten las operaciones de fotos (`foto-web.service.ts`) y el cambio de
 * visibilidad (`visibilidad-web.service.ts`): así la validación de
 * publicabilidad del `false → true` queda serializada con la baja de la última
 * foto del mismo contenido. `editarContenidoWeb` conserva su propio SQL
 * (HU16_TASKS.md D13, deuda técnica DT-1).
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/errors/service-error";

/** `SELECT … FOR UPDATE` sobre el contenido; 404 si no existe o fue dado de baja. */
export async function bloquearContenidoActivo(tx: Prisma.TransactionClient, productoWebId: string): Promise<void> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM contenidos_producto_web
    WHERE id = ${productoWebId} AND is_active = true AND deleted_at IS NULL
    FOR UPDATE`;
  if (filas.length === 0) {
    throw new ServiceError("PRODUCTO_WEB_NO_ENCONTRADO", "El contenido web no existe o fue dado de baja");
  }
}
