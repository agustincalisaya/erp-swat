/**
 * HU-E4 — Cupones de descuento (spec_modulo_E.md §2.4.a–§2.4.e, Rev. 3).
 *
 * Ciclo de una aplicación:
 *  1. Checkout (E2): `aplicarCuponTx()` lockea el cupón, valida estado y
 *     capacidad (`C + P`) y crea la `CuponAplicacion` pendiente con
 *     `reserva_hasta` = vencimiento de la reserva de stock del pedido.
 *  2. Pago aprobado: `confirmarAplicacionCuponTx()` → `confirmada = true`. No
 *     pide capacidad: la reserva ya ocupaba el lugar.
 *  3. Pago rechazado: `darDeBajaAplicacionCuponTx()` → baja lógica.
 *  4. Pedido vencido: `ejecutarMantenimientoCupones()` da de baja las
 *     pendientes con `reserva_hasta <= ahora` y los cupones vencidos o agotados.
 *
 * Capacidad (§2.4.b): `C` = confirmadas (todo el historial); `P` = pendientes
 * activas con `reserva_hasta > ahora`. Se admite una aplicación nueva solo si
 * `C + P < límite`. `P` filtra por `reserva_hasta`, así que una reserva vencida
 * deja de ocupar lugar aunque el mantenimiento todavía no haya corrido.
 *
 * Concurrencia: el lock de la fila del cupón (`SELECT … FOR UPDATE`) serializa
 * a los checkouts que usan ese cupón. El checkout ya tiene los locks de stock
 * antes de llegar acá: el orden es siempre stock → cupón. El reloj (`ahora`)
 * es el de la aplicación, tomado DESPUÉS del lock (Gate 3, A2).
 *
 * Eventos: las funciones `…Tx` devuelven los datos y quien abre la
 * transacción emite después del COMMIT (patrón de E8).
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { CrearCuponInput, EditarCuponInput, FiltroCuponesInput } from "@/lib/schemas/cupon.schema";
import { obtenerUsuarioCanalWebId } from "@/lib/services/ecommerce/usuario-canal-web";

export type TipoBeneficio = "PORCENTAJE" | "MONTO_FIJO";
export type EstadoCupon = "DADO_DE_BAJA" | "NO_INICIADO" | "VENCIDO" | "AGOTADO" | "VIGENTE";

export interface AplicarCuponInput {
  codigo: string;
  cliente_id: string;
  pedido_venta_id: string;
  /** Total del pedido a precios congelados (HU-B9), antes del descuento. */
  subtotal: Prisma.Decimal;
  /** Vencimiento de la reserva de stock del pedido (mismo TTL de E2). */
  reserva_hasta: Date;
}

export interface CuponAplicado {
  cupon_aplicacion_id: string;
  cupon_id: string;
  monto_descontado: Prisma.Decimal;
  reserva_hasta: Date;
  /** Hora de la aplicación (tomada después del lock). */
  aplicado_en: Date;
}

/** Datos de una transición de aplicación, para el evento post-COMMIT. */
export interface TransicionAplicacionCupon {
  cupon_id: string;
  aplicacion_id: string;
  pedido_venta_id: string;
  ocurrido_en: Date;
}

export interface AplicacionCuponLiberada extends TransicionAplicacionCupon {
  motivo: string;
}

/** `deletion_reason` de las aplicaciones liberadas por vencimiento del pedido. */
export const MOTIVO_TTL_CHECKOUT_VENCIDO = "TTL_CHECKOUT_VENCIDO";

const APLICACION_VIGENTE = { is_active: true, deleted_at: null } as const;

// ──────────────────────────────────────────────────────────────────────────────
// Eventos (§4) — se llaman SIEMPRE después del COMMIT
// ──────────────────────────────────────────────────────────────────────────────

/** Checkout (E2): actor = la cuenta del Cliente Web. */
export function emitirCuponAplicado(
  aplicado: CuponAplicado,
  datos: { cuenta_id: string; cliente_id: string; pedido_venta_id: string },
): void {
  domainEventBus.emit("ecommerce:cupon_aplicado", {
    cupon_id: aplicado.cupon_id,
    actor_tipo: "cuenta",
    actor_id: datos.cuenta_id,
    ocurrido_en: aplicado.aplicado_en.toISOString(),
    aplicacion_id: aplicado.cupon_aplicacion_id,
    pedido_venta_id: datos.pedido_venta_id,
    cliente_id: datos.cliente_id,
    monto_descontado: aplicado.monto_descontado.toFixed(2),
    reserva_hasta: aplicado.reserva_hasta.toISOString(),
  });
}

/** Pago confirmado (E2): actor = usuario de sistema "Canal Web". */
export function emitirCuponConsumido(consumo: TransicionAplicacionCupon, actorId: string): void {
  domainEventBus.emit("ecommerce:cupon_consumido", {
    cupon_id: consumo.cupon_id,
    actor_tipo: "sistema",
    actor_id: actorId,
    ocurrido_en: consumo.ocurrido_en.toISOString(),
    aplicacion_id: consumo.aplicacion_id,
    pedido_venta_id: consumo.pedido_venta_id,
  });
}

/** Rechazo del pago (E2) o vencimiento del pedido: actor = usuario de sistema "Canal Web". */
export function emitirCuponAplicacionLiberada(liberada: AplicacionCuponLiberada, actorId: string): void {
  domainEventBus.emit("ecommerce:cupon_aplicacion_liberada", {
    cupon_id: liberada.cupon_id,
    actor_tipo: "sistema",
    actor_id: actorId,
    ocurrido_en: liberada.ocurrido_en.toISOString(),
    aplicacion_id: liberada.aplicacion_id,
    pedido_venta_id: liberada.pedido_venta_id,
    motivo: liberada.motivo,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Estado derivado y capacidad (§2.4.b)
// ──────────────────────────────────────────────────────────────────────────────

interface DatosEstadoCupon {
  is_active: boolean;
  deleted_at: Date | null;
  vigente_desde: Date;
  vigente_hasta: Date;
  limite_uso_global: number | null;
}

/** Estado derivado del cupón, en el orden de la spec. `confirmados` = `C`. */
export function derivarEstadoCupon(cupon: DatosEstadoCupon, confirmados: number, ahora: Date): EstadoCupon {
  if (!cupon.is_active || cupon.deleted_at) return "DADO_DE_BAJA";
  if (ahora < cupon.vigente_desde) return "NO_INICIADO";
  if (ahora > cupon.vigente_hasta) return "VENCIDO";
  if (cupon.limite_uso_global !== null && confirmados >= cupon.limite_uso_global) return "AGOTADO";
  return "VIGENTE";
}

interface Ocupacion {
  /** `C`: aplicaciones confirmadas (todo el historial). */
  confirmados: number;
  /** `P`: pendientes activas con reserva vigente. */
  reservas: number;
}

interface OcupacionCupon {
  global: Ocupacion;
  /** `C` y `P` del cliente indicado (ceros si no se indica). */
  cliente: Ocupacion;
  /** Aplicaciones en todo el historial (también las liberadas). */
  aplicaciones: number;
}

const SIN_OCUPACION: OcupacionCupon = {
  global: { confirmados: 0, reservas: 0 },
  cliente: { confirmados: 0, reservas: 0 },
  aplicaciones: 0,
};

/**
 * `C` y `P` (global y del cliente) en UN solo statement: en READ COMMITTED
 * cada statement tiene su snapshot, así que leerlos por separado deja que un
 * pago confirme entre ambas lecturas y la reserva no se cuente ni como `P` ni
 * como `C` (Verify F01). El pago no lockea el cupón (K2).
 */
async function leerOcupacion(
  db: Prisma.TransactionClient,
  cuponIds: string[],
  ahora: Date,
  clienteId: string | null = null,
): Promise<Map<string, OcupacionCupon>> {
  const pendienteVigente = Prisma.sql`NOT "confirmada" AND "is_active" AND "deleted_at" IS NULL
    AND "reserva_hasta" > (${ahora.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const delCliente = Prisma.sql`"cliente_id" = ${clienteId}`;
  const filas = await db.$queryRaw<
    { cupon_id: string; c: bigint; p: bigint; c_cliente: bigint; p_cliente: bigint; total: bigint }[]
  >`
    SELECT "cupon_id",
      COUNT(*) FILTER (WHERE "confirmada") AS c,
      COUNT(*) FILTER (WHERE ${pendienteVigente}) AS p,
      COUNT(*) FILTER (WHERE "confirmada" AND ${delCliente}) AS c_cliente,
      COUNT(*) FILTER (WHERE ${pendienteVigente} AND ${delCliente}) AS p_cliente,
      COUNT(*) AS total
    FROM "aplicaciones_cupon"
    WHERE "cupon_id" IN (${Prisma.join(cuponIds)})
    GROUP BY "cupon_id"`;
  return new Map(
    filas.map((f) => [
      f.cupon_id,
      {
        global: { confirmados: Number(f.c), reservas: Number(f.p) },
        cliente: { confirmados: Number(f.c_cliente), reservas: Number(f.p_cliente) },
        aplicaciones: Number(f.total),
      },
    ]),
  );
}

/** Lock de la fila del cupón hasta el fin de la transacción (parametrizado). */
async function bloquearCupon(tx: Prisma.TransactionClient, cuponId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "cupones_descuento" WHERE "id" = ${cuponId} FOR UPDATE`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Checkout y pago (integración con HU-E2)
// ──────────────────────────────────────────────────────────────────────────────

function calcularDescuentoBruto(tipoBeneficio: string, valor: Prisma.Decimal, subtotal: Prisma.Decimal): Prisma.Decimal {
  return tipoBeneficio === "PORCENTAJE"
    ? subtotal.mul(valor).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : valor;
}

/**
 * Descuento redondeado a centavos (half-up), recortado al subtotal. El recorte
 * es una salvaguarda: `aplicarCuponTx` rechaza antes todo descuento que cubra
 * el subtotal (K5).
 */
export function calcularDescuento(
  tipoBeneficio: string,
  valor: Prisma.Decimal,
  subtotal: Prisma.Decimal,
): Prisma.Decimal {
  return Prisma.Decimal.min(calcularDescuentoBruto(tipoBeneficio, valor, subtotal), subtotal);
}

/**
 * Valida el cupón y crea su `CuponAplicacion` pendiente dentro del `tx` del
 * checkout (§2.4.c). Un error revierte el checkout completo.
 *
 * @throws {ServiceError} CUPON_NO_ENCONTRADO | CUPON_INACTIVO | CUPON_NO_VIGENTE |
 *         CUPON_VENCIDO | CUPON_LIMITE_ALCANZADO | CUPON_NO_APLICABLE (422)
 */
export async function aplicarCuponTx(tx: Prisma.TransactionClient, input: AplicarCuponInput): Promise<CuponAplicado> {
  const encontrado = await tx.cuponDescuento.findUnique({
    where: { codigo: input.codigo.trim().toUpperCase() },
    select: { id: true },
  });
  if (!encontrado) throw new ServiceError("CUPON_NO_ENCONTRADO", "El cupón indicado no existe");

  await bloquearCupon(tx, encontrado.id);
  const cupon = await tx.cuponDescuento.findUniqueOrThrow({ where: { id: encontrado.id } });
  const ahora = new Date();

  const { global, cliente } = (await leerOcupacion(tx, [cupon.id], ahora, input.cliente_id)).get(cupon.id) ?? SIN_OCUPACION;
  switch (derivarEstadoCupon(cupon, global.confirmados, ahora)) {
    case "DADO_DE_BAJA":
      throw new ServiceError("CUPON_INACTIVO", "El cupón indicado no está activo");
    case "NO_INICIADO":
      throw new ServiceError("CUPON_NO_VIGENTE", "El cupón indicado todavía no está vigente");
    case "VENCIDO":
      throw new ServiceError("CUPON_VENCIDO", "El cupón indicado está vencido");
    default:
      break;
  }
  if (cupon.limite_uso_global !== null && global.confirmados + global.reservas >= cupon.limite_uso_global) {
    throw new ServiceError("CUPON_LIMITE_ALCANZADO", "El cupón alcanzó su límite de uso");
  }
  if (cliente.confirmados + cliente.reservas >= cupon.limite_uso_por_cliente) {
    throw new ServiceError("CUPON_LIMITE_ALCANZADO", "Ya usaste este cupón la cantidad de veces permitida");
  }

  if (calcularDescuentoBruto(cupon.tipo_beneficio, cupon.valor, input.subtotal).gte(input.subtotal)) {
    throw new ServiceError("CUPON_NO_APLICABLE", "El cupón no puede cubrir el total del pedido");
  }
  const montoDescontado = calcularDescuento(cupon.tipo_beneficio, cupon.valor, input.subtotal);

  const aplicacion = await tx.cuponAplicacion.create({
    data: {
      cupon_id: cupon.id,
      pedido_venta_id: input.pedido_venta_id,
      cliente_id: input.cliente_id,
      monto_descontado: montoDescontado,
      confirmada: false,
      reserva_hasta: input.reserva_hasta,
    },
    select: { id: true },
  });
  return {
    cupon_aplicacion_id: aplicacion.id,
    cupon_id: cupon.id,
    monto_descontado: montoDescontado,
    reserva_hasta: input.reserva_hasta,
    aplicado_en: ahora,
  };
}

/**
 * Consumo del cupón al confirmarse el pago (§2.4.d). No pide capacidad: la
 * reserva ya ocupaba el lugar. Conserva el control de E2 como salvaguarda para
 * datos anteriores a E4: informa si el cupón YA había alcanzado su límite sin
 * contar esta aplicación (`limite_excedido`), sin rechazar el pago.
 */
export async function confirmarAplicacionCuponTx(
  tx: Prisma.TransactionClient,
  aplicacionId: string,
): Promise<{ limite_excedido: boolean; consumo: TransicionAplicacionCupon }> {
  const aplicacion = await tx.cuponAplicacion.findFirst({
    where: { id: aplicacionId, ...APLICACION_VIGENTE },
    select: {
      cliente_id: true,
      pedido_venta_id: true,
      cupon: { select: { id: true, limite_uso_global: true, limite_uso_por_cliente: true } },
    },
  });
  if (!aplicacion) throw new ServiceError("CUPON_APLICACION_NO_ENCONTRADA", "La aplicación del cupón no está vigente");

  const { cupon } = aplicacion;
  const otrasConfirmadas = { cupon_id: cupon.id, confirmada: true, ...APLICACION_VIGENTE, id: { not: aplicacionId } };
  const usosGlobales = await tx.cuponAplicacion.count({ where: otrasConfirmadas });
  const usosCliente = await tx.cuponAplicacion.count({ where: { ...otrasConfirmadas, cliente_id: aplicacion.cliente_id } });
  const limiteExcedido =
    (cupon.limite_uso_global !== null && usosGlobales >= cupon.limite_uso_global) ||
    usosCliente >= cupon.limite_uso_por_cliente;

  await tx.cuponAplicacion.update({ where: { id: aplicacionId }, data: { confirmada: true } });
  return {
    limite_excedido: limiteExcedido,
    consumo: {
      cupon_id: cupon.id,
      aplicacion_id: aplicacionId,
      pedido_venta_id: aplicacion.pedido_venta_id,
      ocurrido_en: new Date(),
    },
  };
}

/**
 * Pago rechazado: la aplicación pendiente se da de baja lógica y deja de
 * ocupar capacidad (§2.4.d). Devuelve la liberación (o `null` si la
 * aplicación ya no estaba pendiente) para el evento post-COMMIT.
 */
export async function darDeBajaAplicacionCuponTx(
  tx: Prisma.TransactionClient,
  aplicacionId: string,
  baja: { deleted_by: string; deletion_reason: string; ahora?: Date },
): Promise<AplicacionCuponLiberada | null> {
  const ahora = baja.ahora ?? new Date();
  const { count } = await tx.cuponAplicacion.updateMany({
    where: { id: aplicacionId, ...APLICACION_VIGENTE, confirmada: false },
    data: {
      is_active: false,
      deleted_at: ahora,
      deleted_by: baja.deleted_by,
      deletion_reason: baja.deletion_reason,
    },
  });
  if (count === 0) return null;
  const aplicacion = await tx.cuponAplicacion.findUniqueOrThrow({
    where: { id: aplicacionId },
    select: { cupon_id: true, pedido_venta_id: true },
  });
  return { ...aplicacion, aplicacion_id: aplicacionId, ocurrido_en: ahora, motivo: baja.deletion_reason };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mantenimiento (§2.4.d) — lo invocan el cron y el script de reservas
// ──────────────────────────────────────────────────────────────────────────────

export type MotivoBajaAutomatica = "VENCIMIENTO" | "LIMITE_GLOBAL_AGOTADO";

export interface CuponDadoDeBaja {
  cupon_id: string;
  motivo: string;
  actor_tipo: "usuario" | "sistema";
  actor_id: string;
  ocurrido_en: Date;
}

function emitirCuponBaja(baja: CuponDadoDeBaja): void {
  domainEventBus.emit("ecommerce:cupon_baja", {
    cupon_id: baja.cupon_id,
    actor_tipo: baja.actor_tipo,
    actor_id: baja.actor_id,
    ocurrido_en: baja.ocurrido_en.toISOString(),
    motivo: baja.motivo,
  });
}

export interface ResultadoMantenimientoCupones {
  aplicaciones_liberadas: string[];
  cupones_dados_de_baja: { cupon_id: string; motivo: MotivoBajaAutomatica }[];
}

/**
 * Da de baja las aplicaciones pendientes con `reserva_hasta <= ahora`
 * (`TTL_CHECKOUT_VENCIDO`). Cada baja es un `updateMany` condicional: si el
 * pago la confirmó o la liberó entretanto, no se toca. Cada `updateMany` es su
 * propio commit: el evento se emite apenas commitea.
 */
async function liberarAplicacionesVencidas(actorId: string): Promise<AplicacionCuponLiberada[]> {
  const ahora = new Date();
  const pendienteVencida = { confirmada: false, ...APLICACION_VIGENTE, reserva_hasta: { lte: ahora } };
  const candidatas = await prisma.cuponAplicacion.findMany({
    where: pendienteVencida,
    select: { id: true, cupon_id: true, pedido_venta_id: true },
  });
  const liberadas: AplicacionCuponLiberada[] = [];
  for (const candidata of candidatas) {
    const { count } = await prisma.cuponAplicacion.updateMany({
      where: { id: candidata.id, ...pendienteVencida },
      data: { is_active: false, deleted_at: ahora, deleted_by: actorId, deletion_reason: MOTIVO_TTL_CHECKOUT_VENCIDO },
    });
    if (count === 0) continue;
    const liberada: AplicacionCuponLiberada = {
      cupon_id: candidata.cupon_id,
      aplicacion_id: candidata.id,
      pedido_venta_id: candidata.pedido_venta_id,
      ocurrido_en: ahora,
      motivo: MOTIVO_TTL_CHECKOUT_VENCIDO,
    };
    emitirCuponAplicacionLiberada(liberada, actorId);
    liberadas.push(liberada);
  }
  return liberadas;
}

/**
 * Da de baja los cupones activos en estado VENCIDO (`VENCIMIENTO`) o AGOTADO
 * (`LIMITE_GLOBAL_AGOTADO`); si aplican los dos, vencimiento. Cada candidato
 * se lockea y se reevalúa en su propia transacción corta (idempotente).
 */
async function darDeBajaCuponesVencidosOAgotados(
  actorId: string,
): Promise<(CuponDadoDeBaja & { motivo: MotivoBajaAutomatica })[]> {
  const activo = { is_active: true, deleted_at: null } as const;
  const [vencidos, conLimite] = await Promise.all([
    prisma.cuponDescuento.findMany({ where: { ...activo, vigente_hasta: { lt: new Date() } }, select: { id: true } }),
    prisma.cuponDescuento.findMany({
      where: { ...activo, limite_uso_global: { not: null } },
      select: { id: true, limite_uso_global: true },
    }),
  ]);
  const confirmados = conLimite.length
    ? await prisma.cuponAplicacion.groupBy({
        by: ["cupon_id"],
        where: { cupon_id: { in: conLimite.map((c) => c.id) }, confirmada: true },
        _count: { _all: true },
      })
    : [];
  const confirmadosPorCupon = new Map(confirmados.map((g) => [g.cupon_id, g._count._all]));
  const agotados = conLimite.filter((c) => (confirmadosPorCupon.get(c.id) ?? 0) >= c.limite_uso_global!);
  const candidatos = [...new Set([...vencidos, ...agotados].map((c) => c.id))];

  const bajas: (CuponDadoDeBaja & { motivo: MotivoBajaAutomatica })[] = [];
  for (const cuponId of candidatos) {
    const baja = await prisma.$transaction(async (tx) => {
      await bloquearCupon(tx, cuponId);
      const cupon = await tx.cuponDescuento.findUniqueOrThrow({ where: { id: cuponId } });
      const ahora = new Date();
      const { global } = (await leerOcupacion(tx, [cuponId], ahora)).get(cuponId) ?? SIN_OCUPACION;
      const estado = derivarEstadoCupon(cupon, global.confirmados, ahora);
      if (estado !== "VENCIDO" && estado !== "AGOTADO") return null;
      const motivo: MotivoBajaAutomatica = estado === "VENCIDO" ? "VENCIMIENTO" : "LIMITE_GLOBAL_AGOTADO";
      await tx.cuponDescuento.update({
        where: { id: cuponId },
        data: { is_active: false, deleted_at: ahora, deleted_by: actorId, deletion_reason: motivo },
      });
      return { cupon_id: cuponId, motivo, actor_tipo: "sistema" as const, actor_id: actorId, ocurrido_en: ahora };
    });
    if (!baja) continue;
    emitirCuponBaja(baja);
    bajas.push(baja);
  }
  return bajas;
}

/**
 * Mantenimiento de cupones (Gate 3, A1): libera las aplicaciones de pedidos
 * vencidos y da de baja los cupones vencidos o agotados. Actor: el usuario de
 * sistema "Canal Web". Idempotente: correrla dos veces no repite bajas.
 */
export async function ejecutarMantenimientoCupones(): Promise<ResultadoMantenimientoCupones> {
  const actorId = await obtenerUsuarioCanalWebId();
  const liberadas = await liberarAplicacionesVencidas(actorId);
  const bajas = await darDeBajaCuponesVencidosOAgotados(actorId);
  return {
    aplicaciones_liberadas: liberadas.map((l) => l.aplicacion_id),
    cupones_dados_de_baja: bajas.map((b) => ({ cupon_id: b.cupon_id, motivo: b.motivo })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Administración (§2.4.e) — rutas /api/ecommerce/cupones
// ──────────────────────────────────────────────────────────────────────────────

export interface CuponDto {
  id: string;
  codigo: string;
  tipo_beneficio: TipoBeneficio;
  /** Decimal como string, 2 decimales. */
  valor: string;
  vigente_desde: string;
  vigente_hasta: string;
  /** `null` = ilimitado. */
  limite_uso_global: number | null;
  limite_uso_por_cliente: number;
  is_active: boolean;
  deleted_at: string | null;
  deletion_reason: string | null;
  estado: EstadoCupon;
  /** `C`. */
  usos_confirmados: number;
  /** `P`. */
  reservas_vigentes: number;
  /** `null` si es ilimitado; si no, `max(0, global − C − P)`. */
  capacidad_disponible: number | null;
  /** Alguna aplicación en todo su historial (también las liberadas). */
  tiene_aplicaciones: boolean;
  created_at: string;
  updated_at: string;
}

type FilaCupon = Prisma.CuponDescuentoGetPayload<object>;

/** Arma los DTO con `C`, `P` e historial, leídos en un único statement. */
async function construirDtos(db: Prisma.TransactionClient, filas: FilaCupon[], ahora: Date): Promise<CuponDto[]> {
  if (filas.length === 0) return [];
  const ocupaciones = await leerOcupacion(db, filas.map((f) => f.id), ahora);

  return filas.map((fila) => {
    const ocupacion = ocupaciones.get(fila.id) ?? SIN_OCUPACION;
    const usos = ocupacion.global.confirmados;
    const reservadas = ocupacion.global.reservas;
    return {
      id: fila.id,
      codigo: fila.codigo,
      tipo_beneficio: fila.tipo_beneficio as TipoBeneficio,
      valor: fila.valor.toFixed(2),
      vigente_desde: fila.vigente_desde.toISOString(),
      vigente_hasta: fila.vigente_hasta.toISOString(),
      limite_uso_global: fila.limite_uso_global,
      limite_uso_por_cliente: fila.limite_uso_por_cliente,
      is_active: fila.is_active,
      deleted_at: fila.deleted_at?.toISOString() ?? null,
      deletion_reason: fila.deletion_reason,
      estado: derivarEstadoCupon(fila, usos, ahora),
      usos_confirmados: usos,
      reservas_vigentes: reservadas,
      capacidad_disponible:
        fila.limite_uso_global === null ? null : Math.max(0, fila.limite_uso_global - usos - reservadas),
      tiene_aplicaciones: ocupacion.aplicaciones > 0,
      created_at: fila.created_at.toISOString(),
      updated_at: fila.updated_at.toISOString(),
    };
  });
}

async function dtoDe(db: Prisma.TransactionClient, fila: FilaCupon): Promise<CuponDto> {
  const [dto] = await construirDtos(db, [fila], new Date());
  return dto;
}

const noEncontrado = () => new ServiceError("CUPON_NO_ENCONTRADO", "El cupón indicado no existe");
const codigoExistente = () => new ServiceError("CUPON_CODIGO_EXISTENTE", "Ya existe un cupón con ese código");

export async function listarCupones(filtro: FiltroCuponesInput): Promise<CuponDto[]> {
  const porEstado: Prisma.CuponDescuentoWhereInput =
    filtro.estado === "ACTIVOS"
      ? { is_active: true, deleted_at: null }
      : filtro.estado === "INACTIVOS"
        ? { OR: [{ is_active: false }, { deleted_at: { not: null } }] }
        : {};
  const filas = await prisma.cuponDescuento.findMany({
    where: { ...porEstado, ...(filtro.q ? { codigo: { contains: filtro.q } } : {}) },
    orderBy: { created_at: "desc" },
  });
  return construirDtos(prisma, filas, new Date());
}

/** Incluye los dados de baja. @throws {ServiceError} CUPON_NO_ENCONTRADO */
export async function obtenerCupon(id: string): Promise<CuponDto> {
  const fila = await prisma.cuponDescuento.findUnique({ where: { id } });
  if (!fila) throw noEncontrado();
  return dtoDe(prisma, fila);
}

/** @throws {ServiceError} CUPON_CODIGO_EXISTENTE (409; también contra cupones dados de baja) */
export async function crearCupon(input: CrearCuponInput, actorId: string): Promise<CuponDto> {
  const existente = await prisma.cuponDescuento.findUnique({ where: { codigo: input.codigo }, select: { id: true } });
  if (existente) throw codigoExistente();
  let fila: FilaCupon;
  try {
    fila = await prisma.cuponDescuento.create({
      data: {
        codigo: input.codigo,
        tipo_beneficio: input.tipo_beneficio,
        valor: new Prisma.Decimal(input.valor),
        vigente_desde: new Date(input.vigente_desde),
        vigente_hasta: new Date(input.vigente_hasta),
        limite_uso_global: input.limite_uso_global,
        limite_uso_por_cliente: input.limite_uso_por_cliente,
      },
    });
  } catch (error) {
    // Carrera entre dos altas con el mismo código: la unicidad la da la base.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw codigoExistente();
    throw error;
  }
  domainEventBus.emit("ecommerce:cupon_creado", {
    cupon_id: fila.id,
    actor_tipo: "usuario",
    actor_id: actorId,
    ocurrido_en: fila.created_at.toISOString(),
    codigo: fila.codigo,
    tipo_beneficio: fila.tipo_beneficio,
    valor: fila.valor.toFixed(2),
    vigente_desde: fila.vigente_desde.toISOString(),
    vigente_hasta: fila.vigente_hasta.toISOString(),
    limite_uso_global: fila.limite_uso_global,
    limite_uso_por_cliente: fila.limite_uso_por_cliente,
  });
  return dtoDe(prisma, fila);
}

type CampoEditable = keyof EditarCuponInput;
interface ValoresEditables {
  tipo_beneficio: string;
  valor: Prisma.Decimal;
  vigente_desde: Date;
  vigente_hasta: Date;
  limite_uso_global: number | null;
  limite_uso_por_cliente: number;
}

function valoresDeEntrada(input: EditarCuponInput): Partial<ValoresEditables> {
  return {
    ...(input.tipo_beneficio !== undefined ? { tipo_beneficio: input.tipo_beneficio } : {}),
    ...(input.valor !== undefined ? { valor: new Prisma.Decimal(input.valor) } : {}),
    ...(input.vigente_desde !== undefined ? { vigente_desde: new Date(input.vigente_desde) } : {}),
    ...(input.vigente_hasta !== undefined ? { vigente_hasta: new Date(input.vigente_hasta) } : {}),
    ...(input.limite_uso_global !== undefined ? { limite_uso_global: input.limite_uso_global } : {}),
    ...(input.limite_uso_por_cliente !== undefined ? { limite_uso_por_cliente: input.limite_uso_por_cliente } : {}),
  };
}

function mismoValor(a: unknown, b: unknown): boolean {
  if (a instanceof Prisma.Decimal && b instanceof Prisma.Decimal) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/** Valor serializable para el evento (`antes`/`despues`). */
function serializar(valor: unknown): unknown {
  if (valor instanceof Prisma.Decimal) return valor.toFixed(2);
  if (valor instanceof Date) return valor.toISOString();
  return valor;
}

/** Con aplicaciones solo se amplían límites (K4): global finito → mayor o ilimitado; por cliente → mayor. */
function esAmpliacion(campo: CampoEditable, antes: unknown, despues: unknown): boolean {
  if (campo === "limite_uso_global") {
    return antes !== null && (despues === null || (despues as number) > (antes as number));
  }
  if (campo === "limite_uso_por_cliente") return (despues as number) > (antes as number);
  return false;
}

interface CuponEditado {
  cupon: CuponDto;
  editado_en: Date | null;
  /** Solo los campos cambiados; vacíos si el PATCH no cambió nada. */
  antes: Record<string, unknown>;
  despues: Record<string, unknown>;
}

/**
 * Edición con la política de K4. Lockea la fila del cupón (K6).
 *
 * @throws {ServiceError} CUPON_NO_ENCONTRADO (404) | CUPON_INACTIVO (409) |
 *         VALIDATION_ERROR (400, `details.fieldErrors`) | CUPON_EDICION_RESTRINGIDA (409)
 */
export async function editarCupon(id: string, input: EditarCuponInput, actorId: string): Promise<CuponDto> {
  const resultado = await prisma.$transaction(async (tx): Promise<CuponEditado> => {
    await bloquearCupon(tx, id);
    const fila = await tx.cuponDescuento.findUnique({ where: { id } });
    if (!fila) throw noEncontrado();
    if (!fila.is_active || fila.deleted_at) {
      throw new ServiceError("CUPON_INACTIVO", "Un cupón dado de baja no se puede editar");
    }

    const nuevos = valoresDeEntrada(input);
    const cambiados = (Object.keys(nuevos) as CampoEditable[]).filter((campo) => !mismoValor(fila[campo], nuevos[campo]));
    if (cambiados.length === 0) return { cupon: await dtoDe(tx, fila), editado_en: null, antes: {}, despues: {} };

    // Las reglas cruzadas se validan contra el resultado final (lo guardado + lo enviado).
    const final = { ...fila, ...nuevos };
    const fieldErrors: Record<string, string[]> = {};
    if (final.tipo_beneficio === "PORCENTAJE" && final.valor.gte(100)) {
      fieldErrors.valor = ["El porcentaje debe ser menor que 100"];
    }
    if (final.vigente_hasta <= final.vigente_desde) {
      fieldErrors.vigente_hasta = ["El fin de vigencia debe ser posterior al inicio"];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ServiceError("VALIDATION_ERROR", "Los datos enviados no son válidos", { fieldErrors });
    }

    const tieneAplicaciones = (await tx.cuponAplicacion.count({ where: { cupon_id: id } })) > 0;
    if (tieneAplicaciones && !cambiados.every((campo) => esAmpliacion(campo, fila[campo], nuevos[campo]))) {
      throw new ServiceError(
        "CUPON_EDICION_RESTRINGIDA",
        "El cupón ya tiene aplicaciones: solo se pueden ampliar sus límites de uso",
      );
    }

    const data = Object.fromEntries(cambiados.map((campo) => [campo, nuevos[campo]]));
    const actualizada = await tx.cuponDescuento.update({ where: { id }, data });
    return {
      cupon: await dtoDe(tx, actualizada),
      editado_en: actualizada.updated_at,
      antes: Object.fromEntries(cambiados.map((campo) => [campo, serializar(fila[campo])])),
      despues: Object.fromEntries(cambiados.map((campo) => [campo, serializar(nuevos[campo])])),
    };
  });
  if (resultado.editado_en) {
    domainEventBus.emit("ecommerce:cupon_editado", {
      cupon_id: id,
      actor_tipo: "usuario",
      actor_id: actorId,
      ocurrido_en: resultado.editado_en.toISOString(),
      antes: resultado.antes,
      despues: resultado.despues,
    });
  }
  return resultado.cupon;
}

/**
 * Baja manual (§2.4.e). Repetida sobre un cupón ya dado de baja: devuelve el
 * cupón sin cambios. No cancela reservas vigentes: esas compras conservan el
 * descuento hasta pagar o vencer. Lockea la fila del cupón.
 *
 * @throws {ServiceError} CUPON_NO_ENCONTRADO (404)
 */
export async function darDeBajaCupon(id: string, motivo: string, actorId: string): Promise<CuponDto> {
  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearCupon(tx, id);
    const fila = await tx.cuponDescuento.findUnique({ where: { id } });
    if (!fila) throw noEncontrado();
    if (!fila.is_active || fila.deleted_at) return { cupon: await dtoDe(tx, fila), baja: null };
    const ahora = new Date();
    const actualizada = await tx.cuponDescuento.update({
      where: { id },
      data: { is_active: false, deleted_at: ahora, deleted_by: actorId, deletion_reason: motivo },
    });
    const baja: CuponDadoDeBaja = { cupon_id: id, motivo, actor_tipo: "usuario", actor_id: actorId, ocurrido_en: ahora };
    return { cupon: await dtoDe(tx, actualizada), baja };
  });
  if (resultado.baja) emitirCuponBaja(resultado.baja);
  return resultado.cupon;
}
