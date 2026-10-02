/**
 * Usuario de sistema "Canal Web" (spec_modulo_E.md §2.2, seed `canal.web.sistema`):
 * registrante de los PedidoVenta de canal WEB, de sus reservas y movimientos, y
 * emisor de su comprobante (HU-E1/HU-E2). Archivo propio para que checkout y
 * pago web lo compartan sin importarse entre sí.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

export const NOMBRE_USUARIO_CANAL_WEB = "canal.web.sistema";

/** @throws {ServiceError} CANAL_WEB_SIN_USUARIO_SISTEMA */
export async function obtenerUsuarioCanalWebId(db: Prisma.TransactionClient = prisma): Promise<string> {
  const usuario = await db.usuario.findFirst({
    where: { nombre_usuario: NOMBRE_USUARIO_CANAL_WEB, is_active: true, deleted_at: null },
    select: { id: true },
  });
  if (!usuario) {
    throw new ServiceError(
      "CANAL_WEB_SIN_USUARIO_SISTEMA",
      `No existe el usuario de sistema ${NOMBRE_USUARIO_CANAL_WEB} (registrante de los pedidos web)`,
    );
  }
  return usuario.id;
}
