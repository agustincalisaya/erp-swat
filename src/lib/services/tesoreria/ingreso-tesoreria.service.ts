import "server-only";

/**
 * @module ingreso-tesoreria.service
 * @description Capa de dominio de HU-G11 (spec_modulo_G.md §2.6). Registro
 * reactivo de ingresos de Tesorería por cobros online de Mercado Pago:
 * `registrarIngresoWeb`, `registrarContraAsiento`, `listarIngresosWeb` y el
 * `reprocesarIngresoWeb` de recuperación manual.
 *
 * Reglas transversales (RULES.md §1/§2, spec G §2.6):
 *  - Idempotencia con doble guarda: `IngresoTesoreria.pedido_venta_id` y
 *    `mercadopago_payment_id` son `@unique`; el pre-check dentro de la
 *    transacción + la captura de `P2002` tornan el reintento un no-op (nunca
 *    una segunda fila, nunca un error).
 *  - Los cobros web NO se imputan a ningún `TurnoCaja` (no hay relación con
 *    turnos por diseño): `caja_virtual` es una constante de código.
 *  - `estado` es `String` con dos valores (`PENDIENTE_CONCILIACION` /
 *    `CONCILIADO`); la transición a `CONCILIADO` es de HU-G2, fuera de alcance.
 *  - Sin soft delete: ninguna de las dos entidades se elimina. PROHIBIDO
 *    `prisma.*.delete()` / `deleteMany()`.
 *  - Ninguna escritura de `AuditLog` acá: el Módulo D la resuelve
 *    `audit-log.listener.ts` a partir de los eventos que emite el listener.
 *  - Toda escritura vive en un único `prisma.$transaction`; los eventos de
 *    seguimiento los emite el listener POST-COMMIT, nunca el service.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type {
  ContraAsientoIngresoRegistradoPayload,
  IngresoWebRegistradoPayload,
} from "@/lib/events/event-types";

// ──────────────────────────────────────────────────────────────────────────────
// Permiso granular (spec_modulo_G.md §2.6 / §7) — un permiso por acción.
// Punto de verdad compartido por Route Handlers y HOFs de auth.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_LEER_INGRESOS_WEB = "tesoreria:leer_ingresos_web";

/**
 * Constante de código (spec G §2.6): no existe catálogo de cajas virtuales.
 * Los cobros web no se imputan a ningún `TurnoCaja`.
 */
export const ESTADO_INGRESO_PENDIENTE_CONCILIACION = "PENDIENTE_CONCILIACION";
export const CAJA_VIRTUAL_MERCADO_PAGO_WEB = "MERCADO_PAGO_CANAL_WEB";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Entrada de `registrarIngresoWeb`. Es estructuralmente compatible con
 * `PedidoPagoConfirmadoPayload` (HU-E2), el evento real consumido por el
 * listener; el `reprocesarIngresoWeb` reconstruye el mismo shape.
 */
export interface IngresoWebInput {
  pedido_venta_id: string;
  mercadopago_payment_id: string;
  monto: Prisma.Decimal | number;
  /** ISO 8601 — fecha del pago confirmado. */
  fecha_aprobacion: string;
}

export interface ContraAsientoIngresoInput {
  pedido_venta_id: string;
  monto: Prisma.Decimal | number;
  motivo: string;
}

export type ResultadoRegistrarContraAsiento =
  | ({ resultado: "CREADO" | "YA_EXISTENTE" } & ContraAsientoIngresoRegistradoPayload)
  | { resultado: "INGRESO_ORIGINAL_NO_ENCONTRADO"; pedido_venta_id: string };

/** Filtros del listado (`GET /api/tesoreria/ingresos-web`). Sin soft delete. */
export interface FiltrosIngresosWeb {
  estado?: string;
  fecha_desde?: Date;
  fecha_hasta?: Date;
  page: number;
  page_size: number;
}

export interface IngresoWebResumen {
  id: string;
  pedido_venta_id: string;
  mercadopago_payment_id: string;
  /** `Decimal` serializado con `.toFixed(2)` — nunca `number`. */
  monto: string;
  /** ISO 8601. */
  fecha: string;
  estado: string;
  caja_virtual: string;
  /** ISO 8601. */
  created_at: string;
}

export interface ListadoIngresosWeb {
  registros: IngresoWebResumen[];
  total: number;
  page: number;
  page_size: number;
}

/** `true` si el error es un conflicto de unicidad de Prisma (`P2002`). */
function esConflictoUnicidad(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.6 — Registro de un ingreso web (idempotente, doble guarda)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Crea el `IngresoTesoreria` de un pago web confirmado. Idempotente por
 * `pedido_venta_id` OR `mercadopago_payment_id`: si ya existe un ingreso con
 * cualquiera de las dos claves, retorna `null` sin escribir ni emitir (es el
 * caso de un reintento del webhook o del reproceso). Race-safe: dos llamadas
 * concurrentes que pasen el pre-check colisionan contra el `@@unique` y la
 * segunda captura `P2002` como no-op.
 *
 * Retorna el payload del evento de seguimiento (el listener lo emite
 * POST-COMMIT) o `null` si fue no-op.
 */
export async function registrarIngresoWeb(
  input: IngresoWebInput,
): Promise<IngresoWebRegistradoPayload | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existente = await tx.ingresoTesoreria.findFirst({
        where: {
          OR: [
            { pedido_venta_id: input.pedido_venta_id },
            { mercadopago_payment_id: input.mercadopago_payment_id },
          ],
        },
        select: { id: true },
      });
      if (existente) return null;

      const creado = await tx.ingresoTesoreria.create({
        data: {
          pedido_venta_id: input.pedido_venta_id,
          mercadopago_payment_id: input.mercadopago_payment_id,
          monto: new Prisma.Decimal(input.monto),
          fecha: new Date(input.fecha_aprobacion),
          estado: ESTADO_INGRESO_PENDIENTE_CONCILIACION,
          caja_virtual: CAJA_VIRTUAL_MERCADO_PAGO_WEB,
        },
        select: {
          id: true,
          monto: true,
          fecha: true,
          estado: true,
          caja_virtual: true,
        },
      });

      return {
        ingreso_id: creado.id,
        pedido_venta_id: input.pedido_venta_id,
        mercadopago_payment_id: input.mercadopago_payment_id,
        monto: creado.monto.toFixed(2),
        fecha: creado.fecha.toISOString(),
        estado: creado.estado,
        caja_virtual: creado.caja_virtual,
      };
    });
  } catch (error) {
    if (esConflictoUnicidad(error)) return null;
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.6 — Contra-asiento de un reintegro (inmutable, idempotente)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Crea UN `ContraAsientoIngreso` vinculado al `IngresoTesoreria` original
 * (resuelto por `pedido_venta_id`) para el reintegro de HU-E13.
 * `pedido_venta_id @unique` ⇒ un pedido nunca genera dos contra-asientos
 * (repetir = `YA_EXISTENTE` por pre-check o por `P2002`). NUNCA edita ni elimina
 * el ingreso original (asiento inmutable).
 */
export async function registrarContraAsiento(
  input: ContraAsientoIngresoInput,
): Promise<ResultadoRegistrarContraAsiento> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existente = await tx.contraAsientoIngreso.findUnique({
        where: { pedido_venta_id: input.pedido_venta_id },
        select: { id: true, ingreso_original_id: true, pedido_venta_id: true, monto: true, motivo: true },
      });
      if (existente) {
        return {
          resultado: "YA_EXISTENTE",
          contra_asiento_id: existente.id,
          ingreso_original_id: existente.ingreso_original_id,
          pedido_venta_id: existente.pedido_venta_id,
          monto: existente.monto.toFixed(2),
          motivo: existente.motivo,
        };
      }

      const ingreso = await tx.ingresoTesoreria.findUnique({
        where: { pedido_venta_id: input.pedido_venta_id },
        select: { id: true },
      });
      if (!ingreso) {
        return {
          resultado: "INGRESO_ORIGINAL_NO_ENCONTRADO",
          pedido_venta_id: input.pedido_venta_id,
        };
      }

      const creado = await tx.contraAsientoIngreso.create({
        data: {
          ingreso_original_id: ingreso.id,
          pedido_venta_id: input.pedido_venta_id,
          monto: new Prisma.Decimal(input.monto),
          motivo: input.motivo,
        },
        select: { id: true, monto: true },
      });

      return {
        resultado: "CREADO",
        contra_asiento_id: creado.id,
        ingreso_original_id: ingreso.id,
        pedido_venta_id: input.pedido_venta_id,
        monto: creado.monto.toFixed(2),
        motivo: input.motivo,
      };
    });
  } catch (error) {
    if (!esConflictoUnicidad(error)) throw error;
    const existente = await prisma.contraAsientoIngreso.findUnique({
      where: { pedido_venta_id: input.pedido_venta_id },
      select: { id: true, ingreso_original_id: true, pedido_venta_id: true, monto: true, motivo: true },
    });
    if (!existente) throw error;
    return {
      resultado: "YA_EXISTENTE",
      contra_asiento_id: existente.id,
      ingreso_original_id: existente.ingreso_original_id,
      pedido_venta_id: existente.pedido_venta_id,
      monto: existente.monto.toFixed(2),
      motivo: existente.motivo,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.6 — Listado paginado de ingresos web (solo lectura)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Listado paginado para `GET /api/tesoreria/ingresos-web`. Filtra por `estado`
 * y rango de fechas. Sin `incluirInactivos` (no hay soft delete). `monto` y
 * las fechas se serializan (`Decimal.toFixed(2)` / ISO 8601).
 */
export async function listarIngresosWeb(
  filtros: FiltrosIngresosWeb,
): Promise<ListadoIngresosWeb> {
  const where: Prisma.IngresoTesoreriaWhereInput = {
    ...(filtros.estado && { estado: filtros.estado }),
    ...((filtros.fecha_desde || filtros.fecha_hasta) && {
      fecha: {
        ...(filtros.fecha_desde && { gte: filtros.fecha_desde }),
        ...(filtros.fecha_hasta && { lte: filtros.fecha_hasta }),
      },
    }),
  };

  const [filas, total] = await Promise.all([
    prisma.ingresoTesoreria.findMany({
      where,
      orderBy: { fecha: "desc" },
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
      select: {
        id: true,
        pedido_venta_id: true,
        mercadopago_payment_id: true,
        monto: true,
        fecha: true,
        estado: true,
        caja_virtual: true,
        created_at: true,
      },
    }),
    prisma.ingresoTesoreria.count({ where }),
  ]);

  const registros: IngresoWebResumen[] = filas.map((f) => ({
    id: f.id,
    pedido_venta_id: f.pedido_venta_id,
    mercadopago_payment_id: f.mercadopago_payment_id,
    monto: f.monto.toFixed(2),
    fecha: f.fecha.toISOString(),
    estado: f.estado,
    caja_virtual: f.caja_virtual,
    created_at: f.created_at.toISOString(),
  }));

  return {
    registros,
    total,
    page: filtros.page,
    page_size: filtros.page_size,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.6 — Reproceso manual (recuperación de una falla del listener)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recuperación manual: vuelve a invocar `registrarIngresoWeb` a partir del
 * `PedidoVentaEcommerce` ya confirmado del pedido. Es el mecanismo de
 * "pendiente y reintentable" (no hay cola automática en el proyecto).
 *
 * `PedidoVentaEcommerce` NO tiene `monto` ni `fecha_aprobacion`: el monto
 * confirmado es `PedidoVenta.total` y la fecha es `fecha_pago_confirmado`.
 *
 * "Pagado" = `fecha_pago_confirmado` y `mercadopago_payment_id` no nulos, sin
 * mirar `estado_ecommerce` (task HU-E2-integracion §9, P-R2): HU-E2 fija la
 * fecha en la misma transacción que confirma el pago, y HU-E12 admite el
 * pedido a la cola en ese mismo commit, así que `PAGO_CONFIRMADO` nunca
 * persiste — el pedido ya está en `EN_PREPARACION` o más adelante. Un pago
 * rechazado guarda `mercadopago_payment_id` pero no la fecha: queda afuera.
 * Idempotente: repetir un pedido ya registrado retorna `null` sin error.
 */
export async function reprocesarIngresoWeb(
  pedidoVentaId: string,
): Promise<IngresoWebRegistradoPayload | null> {
  const pve = await prisma.pedidoVentaEcommerce.findUnique({
    where: { pedido_venta_id: pedidoVentaId },
    select: {
      mercadopago_payment_id: true,
      fecha_pago_confirmado: true,
      is_active: true,
    },
  });
  if (
    !pve ||
    !pve.is_active ||
    !pve.fecha_pago_confirmado ||
    !pve.mercadopago_payment_id
  ) {
    console.error(
      "[ingreso-tesoreria.service] reprocesarIngresoWeb: pedido web sin pago confirmado",
      { pedido_venta_id: pedidoVentaId },
    );
    return null;
  }

  const pedido = await prisma.pedidoVenta.findUnique({
    where: { id: pedidoVentaId },
    select: { total: true },
  });
  if (!pedido) {
    console.error(
      "[ingreso-tesoreria.service] reprocesarIngresoWeb: PedidoVenta inexistente",
      { pedido_venta_id: pedidoVentaId },
    );
    return null;
  }

  return registrarIngresoWeb({
    pedido_venta_id: pedidoVentaId,
    mercadopago_payment_id: pve.mercadopago_payment_id,
    monto: pedido.total,
    fecha_aprobacion: pve.fecha_pago_confirmado.toISOString(),
  });
}
