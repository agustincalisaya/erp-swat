/**
 * Resolución del `ConectorPago` ACTIVO del entorno y bitácora de invocaciones
 * (spec_modulo_F.md §2.1/§2.1.4/§3.1). Las credenciales viven cifradas en la
 * base (AES-256-GCM, `lib/crypto/aes.ts`) y solo se descifran acá, en memoria,
 * para la llamada; nunca se loguean ni salen de esta carpeta.
 *
 * // HU-F1 agregó `obtenerConectorPorId()` (descifra por id, para el
 * // health-check sobre un Conector INACTIVO) y las operaciones
 * // `SOLICITAR_REEMBOLSO`/`HEALTH_CHECK` a `OperacionConector`.
 */
import "server-only";

import type { EntornoConectorPago, EstadoConectorPago } from "@prisma/client";
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

/** Conector resuelto por id con sus credenciales descifradas (HU-F1). */
export interface ConectorResuelto {
  id: string;
  nombre: string;
  entorno: EntornoConectorPago;
  estado: EstadoConectorPago;
  access_token: string;
  public_key: string;
  webhook_secret: string;
  ultimo_health_check_exitoso_at: Date | null;
}

/**
 * Conector por id con sus credenciales descifradas (HU-F1). Necesario para el
 * health-check de un Conector recién creado (INACTIVO), que
 * `obtenerConectorActivo()` no devuelve.
 *
 * @throws {ServiceError} CONECTOR_NO_ENCONTRADO
 */
export async function obtenerConectorPorId(id: string): Promise<ConectorResuelto> {
  const conector = await prisma.conectorPago.findFirst({
    where: { id, is_active: true, deleted_at: null },
    select: {
      id: true,
      nombre: true,
      entorno: true,
      estado: true,
      access_token_cifrado: true,
      access_token_iv: true,
      public_key_cifrada: true,
      public_key_iv: true,
      webhook_secret_cifrado: true,
      webhook_secret_iv: true,
      ultimo_health_check_exitoso_at: true,
    },
  });
  if (!conector) {
    throw new ServiceError("CONECTOR_NO_ENCONTRADO", "El Conector indicado no existe o fue dado de baja");
  }
  return {
    id: conector.id,
    nombre: conector.nombre,
    entorno: conector.entorno,
    estado: conector.estado,
    access_token: decrypt({ ciphertext: conector.access_token_cifrado, iv: conector.access_token_iv }),
    public_key: decrypt({ ciphertext: conector.public_key_cifrada, iv: conector.public_key_iv }),
    webhook_secret: decrypt({ ciphertext: conector.webhook_secret_cifrado, iv: conector.webhook_secret_iv }),
    ultimo_health_check_exitoso_at: conector.ultimo_health_check_exitoso_at,
  };
}

export type OperacionConector =
  | "INICIAR_COBRO"
  | "CONSULTAR_PAGO"
  | "CERRAR_COBRO"
  | "SOLICITAR_REEMBOLSO"
  | "HEALTH_CHECK";

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
