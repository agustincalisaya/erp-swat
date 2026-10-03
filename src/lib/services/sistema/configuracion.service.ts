/**
 * D.4 — Lectura de `ConfiguracionSistema` (spec_modulo_D.md §6).
 *
 * MÍNIMO introducido por HU-E1 (aprobado por el owner): solo la lectura
 * servidor-a-servidor de §6.3.1 (`obtenerConfiguracion(clave)`). El Route
 * Handler `GET/PATCH /api/configuracion/[clave]` y la mutación
 * (`configuracion:administrar`) siguen siendo alcance de D.4 — no están acá.
 *
 * Sin cache a propósito: HU-E1 exige disponibilidad en tiempo real, y un
 * cambio del depósito del canal web debe verse en el siguiente request.
 * Sin default silencioso (spec §6.3): una clave ausente es un error de
 * configuración, nunca un valor implícito en código.
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

/** Claves sembradas para Sprint 4 (spec_modulo_D.md §6.2). */
export const CLAVE_ECOMMERCE_DEPOSITO_CANAL_WEB_ID = "ECOMMERCE_DEPOSITO_CANAL_WEB_ID";
export const CLAVE_ECOMMERCE_CHECKOUT_TTL_HORAS = "ECOMMERCE_CHECKOUT_TTL_HORAS";
export const CLAVE_ECOMMERCE_CUENTA_WEB_MAX_INTENTOS = "ECOMMERCE_CUENTA_WEB_MAX_INTENTOS";
export const CLAVE_ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS = "ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS";

export interface ConfiguracionValor {
  clave: string;
  valor: string;
  modulo: string;
}

/**
 * Lee un parámetro por `clave` (lectura interna, sin RBAC — spec §6.3.1).
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA
 */
export async function obtenerConfiguracion(clave: string): Promise<ConfiguracionValor> {
  const fila = await prisma.configuracionSistema.findUnique({
    where: { clave },
    select: { clave: true, valor: true, modulo: true },
  });
  if (!fila) {
    throw new ServiceError(
      "CONFIGURACION_NO_ENCONTRADA",
      `No existe el parámetro de configuración ${clave}`,
    );
  }
  return fila;
}

/**
 * Depósito cuyo stock publica el canal web (HU-E1 CA1). Valida que el
 * depósito exista y siga activo: un depósito dado de baja es un error de
 * configuración, no "todo agotado".
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CANAL_WEB_NO_CONFIGURADO
 */
export async function obtenerDepositoCanalWebId(): Promise<string> {
  const { valor } = await obtenerConfiguracion(CLAVE_ECOMMERCE_DEPOSITO_CANAL_WEB_ID);
  const deposito = await prisma.deposito.findFirst({
    where: { id: valor, is_active: true, deleted_at: null },
    select: { id: true },
  });
  if (!deposito) {
    throw new ServiceError(
      "CANAL_WEB_NO_CONFIGURADO",
      "El depósito configurado para el canal web no existe o está inactivo",
    );
  }
  return deposito.id;
}

/**
 * TTL en horas de la reserva del checkout web (spec_modulo_E.md §2.2 paso 3):
 * se pasa explícito a la reserva, nunca el default de 72h.
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CONFIGURACION_INVALIDA
 */
async function obtenerEnteroPositivo(clave: string): Promise<number> {
  const { valor } = await obtenerConfiguracion(clave);
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ServiceError("CONFIGURACION_INVALIDA", `${clave} debe ser un entero positivo (valor actual: "${valor}")`);
  }
  return numero;
}

export async function obtenerTtlCheckoutHoras(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_CHECKOUT_TTL_HORAS);
}

export async function obtenerMaxIntentosCuentaWeb(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_CUENTA_WEB_MAX_INTENTOS);
}

export async function obtenerBloqueoMinutosCuentaWeb(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS);
}
