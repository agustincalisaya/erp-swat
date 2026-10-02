/**
 * Resolución del `ConectorPago` ACTIVO del entorno y bitácora de invocaciones
 * (spec_modulo_F.md §2.1/§2.1.4/§3.1). Las credenciales viven cifradas en la
 * base (AES-256-GCM, `lib/crypto/aes.ts`) y solo se descifran acá, en memoria,
 * para la llamada; nunca se loguean ni salen de esta carpeta.
 *
 * // PROVISORIO HU-E2 — completar en HU-F1 (owner: Rama): sin alta,
 * // health-check, baja ni bitácora HTTP del Conector.
 */
import "server-only";

import type { EntornoConectorPago } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decrypt } from "@/lib/crypto/aes";
import { ServiceError } from "@/lib/errors/service-error";

export interface ConectorActivo {
  id: string;
  entorno: EntornoConectorPago;
  access_token: string;
  webhook_secret: string;
}

/** spec F §3.1: `NODE_ENV` mapeado a SANDBOX/PRODUCCION. */
export function entornoVigente(): EntornoConectorPago {
  return process.env.NODE_ENV === "production" ? "PRODUCCION" : "SANDBOX";
}

/**
 * Conector ACTIVO del entorno vigente con sus credenciales descifradas.
 *
 * @throws {ServiceError} CONECTOR_NO_CONFIGURADO
 */
export async function obtenerConectorActivo(): Promise<ConectorActivo> {
  const entorno = entornoVigente();
  const conector = await prisma.conectorPago.findFirst({
    where: { entorno, estado: "ACTIVO", is_active: true, deleted_at: null },
    orderBy: { updated_at: "desc" },
    select: {
      id: true,
      entorno: true,
      access_token_cifrado: true,
      access_token_iv: true,
      webhook_secret_cifrado: true,
      webhook_secret_iv: true,
    },
  });
  if (!conector) {
    throw new ServiceError("CONECTOR_NO_CONFIGURADO", `No hay un Conector de Mercado Pago ACTIVO para ${entorno}`);
  }
  return {
    id: conector.id,
    entorno: conector.entorno,
    access_token: decrypt({ ciphertext: conector.access_token_cifrado, iv: conector.access_token_iv }),
    webhook_secret: decrypt({ ciphertext: conector.webhook_secret_cifrado, iv: conector.webhook_secret_iv }),
  };
}

export type OperacionConector = "INICIAR_COBRO" | "CONSULTAR_PAGO" | "CERRAR_COBRO";

/**
 * Bitácora operativa (spec F §2.1.4): una fila por llamada a Mercado Pago, sin
 * datos sensibles del pago. Nunca hace fallar la operación de negocio.
 */
export async function registrarInvocacion(
  conectorId: string,
  operacion: OperacionConector,
  exitosa: boolean,
  detalleError?: string,
): Promise<void> {
  try {
    await prisma.invocacionConectorPago.create({
      data: { conector_id: conectorId, operacion, exitosa, detalle_error: detalleError?.slice(0, 500) ?? null },
    });
  } catch (error) {
    console.error("[mercadopago/conector] No se pudo registrar la invocación:", error);
  }
}
