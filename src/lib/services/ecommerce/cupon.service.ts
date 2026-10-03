/**
 * HU-E4 — Cupones de descuento: SOLO lo que consume el checkout/pago de HU-E2
 * (spec_modulo_E.md §2.4). Sin ABM de cupones ni rutas de administración.
 *
 * // PROVISORIO HU-E2 — completar en HU-E4 (owner: Tomas)
 *
 * Ciclo (spec §2.4, "consumo diferido al pago confirmado"):
 *  1. Checkout: `aplicarCuponTx()` valida y crea la `CuponAplicacion` con
 *     `confirmada = false` (reserva optimista del uso).
 *  2. Pago aprobado: `confirmarAplicacionCuponTx()` → `confirmada = true`.
 *  3. Pago rechazado: `darDeBajaAplicacionCuponTx()` → baja lógica, no cuenta.
 *
 * NOTA PARA TOMAS (task HU-E2 §3.2, Q3): el límite cuenta solo aplicaciones
 * `confirmada = true` (spec literal), así que dos checkouts concurrentes pueden
 * pasar la validación de un cupón de uso único. Al confirmar NO se revalida
 * (no se rechaza un pago ya cobrado): `confirmarAplicacionCuponTx()` informa
 * `limite_excedido` y HU-E2 emite `ecommerce:pago_anomalo`
 * (CUPON_LIMITE_EXCEDIDO). La prevención de fondo queda en HU-E4.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { ServiceError } from "@/lib/errors/service-error";

export interface AplicarCuponInput {
  codigo: string;
  cliente_id: string;
  pedido_venta_id: string;
  /** Total del pedido a precios congelados (HU-B9), antes del descuento. */
  subtotal: Prisma.Decimal;
  ahora?: Date;
}

export interface CuponAplicado {
  cupon_aplicacion_id: string;
  cupon_id: string;
  monto_descontado: Prisma.Decimal;
}

const APLICACION_VIGENTE = { is_active: true, deleted_at: null } as const;

async function contarUsosConfirmados(
  tx: Prisma.TransactionClient,
  cuponId: string,
  filtro: { cliente_id?: string; excluir_aplicacion_id?: string } = {},
): Promise<number> {
  return tx.cuponAplicacion.count({
    where: {
      cupon_id: cuponId,
      confirmada: true,
      ...APLICACION_VIGENTE,
      ...(filtro.cliente_id ? { cliente_id: filtro.cliente_id } : {}),
      ...(filtro.excluir_aplicacion_id ? { id: { not: filtro.excluir_aplicacion_id } } : {}),
    },
  });
}

/** `Math.max(0, …)` del total y redondeo a centavos (spec §2.4). */
export function calcularDescuento(
  tipoBeneficio: string,
  valor: Prisma.Decimal,
  subtotal: Prisma.Decimal,
): Prisma.Decimal {
  const bruto =
    tipoBeneficio === "PORCENTAJE"
      ? subtotal.mul(valor).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : valor;
  return Prisma.Decimal.min(bruto, subtotal);
}

/**
 * Valida el cupón (vigencia, `is_active`, límite global y por cliente) y crea
 * su `CuponAplicacion` sin confirmar, dentro del `tx` del checkout.
 *
 * @throws {ServiceError} CUPON_NO_ENCONTRADO | CUPON_INACTIVO | CUPON_VENCIDO | CUPON_LIMITE_ALCANZADO (422)
 */
export async function aplicarCuponTx(tx: Prisma.TransactionClient, input: AplicarCuponInput): Promise<CuponAplicado> {
  const ahora = input.ahora ?? new Date();
  const cupon = await tx.cuponDescuento.findFirst({
    where: { codigo: input.codigo.trim().toUpperCase() },
    select: {
      id: true,
      tipo_beneficio: true,
      valor: true,
      vigente_desde: true,
      vigente_hasta: true,
      limite_uso_global: true,
      limite_uso_por_cliente: true,
      is_active: true,
      deleted_at: true,
    },
  });
  if (!cupon) throw new ServiceError("CUPON_NO_ENCONTRADO", "El cupón indicado no existe");
  if (!cupon.is_active || cupon.deleted_at) throw new ServiceError("CUPON_INACTIVO", "El cupón indicado no está activo");
  if (ahora < cupon.vigente_desde || ahora > cupon.vigente_hasta) {
    throw new ServiceError("CUPON_VENCIDO", "El cupón indicado no está vigente");
  }

  if (cupon.limite_uso_global !== null && (await contarUsosConfirmados(tx, cupon.id)) >= cupon.limite_uso_global) {
    throw new ServiceError("CUPON_LIMITE_ALCANZADO", "El cupón alcanzó su límite de uso");
  }
  if ((await contarUsosConfirmados(tx, cupon.id, { cliente_id: input.cliente_id })) >= cupon.limite_uso_por_cliente) {
    throw new ServiceError("CUPON_LIMITE_ALCANZADO", "Ya usaste este cupón la cantidad de veces permitida");
  }

  const montoDescontado = calcularDescuento(cupon.tipo_beneficio, cupon.valor, input.subtotal);
  const aplicacion = await tx.cuponAplicacion.create({
    data: {
      cupon_id: cupon.id,
      pedido_venta_id: input.pedido_venta_id,
      cliente_id: input.cliente_id,
      monto_descontado: montoDescontado,
      confirmada: false,
    },
    select: { id: true },
  });
  return { cupon_aplicacion_id: aplicacion.id, cupon_id: cupon.id, monto_descontado: montoDescontado };
}

/**
 * Consumo del cupón al confirmarse el pago (spec §2.4). No revalida: informa si
 * el cupón YA había alcanzado su límite sin contar esta aplicación (Q3).
 */
export async function confirmarAplicacionCuponTx(
  tx: Prisma.TransactionClient,
  aplicacionId: string,
): Promise<{ limite_excedido: boolean }> {
  const aplicacion = await tx.cuponAplicacion.findFirst({
    where: { id: aplicacionId, ...APLICACION_VIGENTE },
    select: {
      cliente_id: true,
      cupon: { select: { id: true, limite_uso_global: true, limite_uso_por_cliente: true } },
    },
  });
  if (!aplicacion) throw new ServiceError("CUPON_APLICACION_NO_ENCONTRADA", "La aplicación del cupón no está vigente");

  const { cupon } = aplicacion;
  const usosGlobales = await contarUsosConfirmados(tx, cupon.id, { excluir_aplicacion_id: aplicacionId });
  const usosCliente = await contarUsosConfirmados(tx, cupon.id, {
    cliente_id: aplicacion.cliente_id,
    excluir_aplicacion_id: aplicacionId,
  });
  const limiteExcedido =
    (cupon.limite_uso_global !== null && usosGlobales >= cupon.limite_uso_global) ||
    usosCliente >= cupon.limite_uso_por_cliente;

  await tx.cuponAplicacion.update({ where: { id: aplicacionId }, data: { confirmada: true } });
  return { limite_excedido: limiteExcedido };
}

/** Pago rechazado: la aplicación no cuenta contra el límite (spec §2.4). Baja lógica. */
export async function darDeBajaAplicacionCuponTx(
  tx: Prisma.TransactionClient,
  aplicacionId: string,
  baja: { deleted_by: string; deletion_reason: string; ahora?: Date },
): Promise<void> {
  await tx.cuponAplicacion.updateMany({
    where: { id: aplicacionId, ...APLICACION_VIGENTE, confirmada: false },
    data: {
      is_active: false,
      deleted_at: baja.ahora ?? new Date(),
      deleted_by: baja.deleted_by,
      deletion_reason: baja.deletion_reason,
    },
  });
}
