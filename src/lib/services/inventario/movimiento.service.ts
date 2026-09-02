/**
 * HU-2 — Sección 5.1/5.2: resolución de códigos escaneados contra el
 * catálogo activo y registro transaccional del ingreso de mercadería.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import {
  IMPACTO_STOCK_POR_ESTADO_DESTINO,
  type ResolverCodigoEscaneoInput,
  type RegistrarIngresoPorEscaneoInput,
  type HistorialMovimientosQuery,
} from "@/lib/schemas/inventario.schema";
import {
  decrementarStockDepositoTx,
  emitirAlertaUmbralSiCorresponde,
} from "@/lib/services/inventario/stock.service";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface CodigoResuelto {
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  talle: string;
  color: string;
  /**
   * `VarianteSKU` es un modelo genérico (talle+color+género+modelo), no una
   * unidad serializada individual. El dato de trazabilidad unitaria todavía
   * no existe en el esquema, por lo que siempre se resuelve como `false`/`null`.
   */
  es_serializado: boolean;
  numero_serie: string | null;
}

/** HU-A11 (multi-ítem) — resultado de un ítem individual del lote registrado. */
export interface IngresoRegistradoItem {
  variante_sku_id: string;
  cantidad: number;
  estado_destino: string;
  numero_serie: string | null;
  /** Dirección en la que este ítem afectó el disponible — ver `IMPACTO_STOCK_POR_ESTADO_DESTINO`. */
  impacto_stock: "SUMA" | "RESTA";
  stock_resultante: { cantidad: number };
}

/** HU-A11 (multi-ítem) — una cabecera `MovimientoStock` con 1+ `MovimientoStockItem`. */
export interface IngresoRegistrado {
  movimiento_id: string;
  deposito_destino_id: string;
  items: IngresoRegistradoItem[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Autorización — ingreso de mercadería por escaneo
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Roles con autorización vigente para registrar ingreso de mercadería
 * (Hallazgo 1 — RBAC). Mismo criterio y misma lista que
 * `ROLES_AUTORIZADOS_BAJA_VARIANTE` en `variante.service.ts` (decisión D2,
 * HU-A6): no se usa `withPermission("inventario:operar")` porque el seed
 * solo otorga ese permiso a `ENCARGADO_DEPOSITO` y dejaría fuera a
 * `ADMINISTRADOR`. Un rol de solo lectura (ej. `AUDITOR`) queda excluido
 * por no figurar en esta lista.
 */
const ROLES_AUTORIZADOS_INGRESO_STOCK = ["ADMINISTRADOR", "ENCARGADO_DEPOSITO"] as const;

/**
 * Verifica si el usuario tiene al menos un rol activo autorizado para
 * resolver códigos y registrar el ingreso de mercadería, con la relación
 * `UsuarioRol → Rol` activa en ambos niveles (mismo patrón de
 * `usuarioPuedeBajarVariante()` en `variante.service.ts` y
 * `usuarioTienePermiso()` en `lib/auth/with-permission.ts`).
 *
 * Único punto de verdad reutilizado por la página, ambas Server Actions y
 * el Route Handler REST — evita que alguno de esos caminos quede sin la
 * misma verificación de rol (Hallazgo 1).
 *
 * @param usuarioId - `usuario_id` de la sesión autenticada.
 */
export async function usuarioPuedeRegistrarIngresoStock(usuarioId: string): Promise<boolean> {
  const match = await prisma.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId,
      is_active: true,
      rol: {
        is_active: true,
        nombre: { in: [...ROLES_AUTORIZADOS_INGRESO_STOCK] },
      },
    },
    select: { id: true },
  });

  return match !== null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolución de código escaneado
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve un código escaneado (EAN-13, Code128 o QR serializado como el
 * `sku`) contra el catálogo activo de `VarianteSKU`. Retorna `null` cuando
 * no hay coincidencia — el llamador decide cómo comunicar el "no encontrado".
 */
export async function resolverCodigoEscaneo(
  input: ResolverCodigoEscaneoInput,
): Promise<CodigoResuelto | null> {
  const variante = await prisma.varianteSKU.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
      OR: [{ ean_qr: input.codigo }, { sku: input.codigo }],
    },
    include: {
      producto_maestro: { select: { nombre: true } },
    },
  });

  if (!variante) return null;

  return {
    variante_sku_id: variante.id,
    sku: variante.sku,
    producto_nombre: variante.producto_maestro.nombre,
    talle: variante.talle,
    color: variante.color,
    es_serializado: false,
    numero_serie: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Registro de ingreso por escaneo
// ──────────────────────────────────────────────────────────────────────────────

/**
 * HU-A11 (multi-ítem) — Registra un lote de ingreso de mercadería resuelto
 * por escaneo: una cabecera `MovimientoStock` (`deposito_destino_id`,
 * `comprobante_referencia`) con un `MovimientoStockItem` por cada ítem del
 * carrito, TODO en una única `prisma.$transaction`:
 *  1. Verifica que el depósito destino y todas las variantes del lote
 *     existan y estén activas (una sola query batch para las variantes).
 *  2. Por cada ítem, según `IMPACTO_STOCK_POR_ESTADO_DESTINO[estado_destino]`:
 *     - SUMA: incrementa (o crea) el `StockDeposito` vía `upsert` sobre la
 *       clave compuesta `[variante_sku_id, deposito_id]`.
 *     - RESTA (`RESERVADO`, `VENDIDO`, `BAJA_MERMA`): decremento condicionado
 *       vía `decrementarStockDepositoTx()` (núcleo `tx`-scoped compartido con
 *       `decrementarStockConAlerta()`, `stock.service.ts`) — corre dentro de
 *       ESTA MISMA transacción, no en una separada.
 *  3. Crea la cabecera + `createMany` de ítems.
 *
 * Al estar todo en una sola transacción, un `STOCK_INSUFICIENTE` en
 * cualquier ítem revierte el lote completo (SUMA incluidos) — ya no hace
 * falta la compensación manual (`delete` post-falla) que existía cuando el
 * ingreso era de un solo ítem.
 *
 * FUERA de la transacción: emite `inventario:ingreso_stock_registrado`
 * (evento único con `items[]`) y, por cada ítem RESTA que cruzó
 * `punto_pedido`, `stock:umbral_critico_alcanzado` (vía
 * `emitirAlertaUmbralSiCorresponde()` — misma regla que usa
 * `decrementarStockConAlerta()`, sin duplicar lógica).
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA
 * @throws {ServiceError} DEPOSITO_NO_ENCONTRADO
 * @throws {ServiceError} STOCK_INSUFICIENTE
 */
export async function registrarIngresoStock(
  input: RegistrarIngresoPorEscaneoInput,
  usuarioId: string,
): Promise<IngresoRegistrado> {
  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const deposito = await tx.deposito.findFirst({
      where: { id: input.deposito_destino_id, is_active: true, deleted_at: null },
    });
    if (!deposito) {
      throw new ServiceError(
        "DEPOSITO_NO_ENCONTRADO",
        `No se encontró el depósito ${input.deposito_destino_id}.`,
      );
    }

    const varianteIds = [...new Set(input.items.map((item) => item.variante_sku_id))];
    const variantesActivas = await tx.varianteSKU.findMany({
      where: { id: { in: varianteIds }, is_active: true, deleted_at: null },
      select: { id: true },
    });
    const idsActivos = new Set(variantesActivas.map((v) => v.id));
    const varianteFaltante = varianteIds.find((id) => !idsActivos.has(id));
    if (varianteFaltante) {
      throw new ServiceError(
        "VARIANTE_NO_ENCONTRADA",
        `No se encontró la variante ${varianteFaltante} en el catálogo activo.`,
      );
    }

    const itemsCreacion: Prisma.MovimientoStockItemCreateManyMovimientoInput[] = [];
    const itemsResultado: IngresoRegistradoItem[] = [];
    const alertasPendientes: { stock_deposito_id: string; variante_sku_id: string; deposito_id: string; cantidad_resultante: number; punto_pedido: number }[] = [];

    for (const item of input.items) {
      const impacto = IMPACTO_STOCK_POR_ESTADO_DESTINO[item.estado_destino];
      let cantidadResultante: number;

      if (impacto === "SUMA") {
        const stockActualizado = await tx.stockDeposito.upsert({
          where: {
            variante_sku_id_deposito_id: {
              variante_sku_id: item.variante_sku_id,
              deposito_id: input.deposito_destino_id,
            },
          },
          update: {
            cantidad: { increment: item.cantidad },
            is_active: true,
            deleted_at: null,
          },
          create: {
            variante_sku_id: item.variante_sku_id,
            deposito_id: input.deposito_destino_id,
            cantidad: item.cantidad,
          },
        });
        cantidadResultante = stockActualizado.cantidad;
      } else {
        // Garantiza que exista la fila (en 0 si es la primera vez que se
        // toca esta combinación variante/depósito) para que el decremento
        // condicionado tenga un `stockDepositoId` sobre el cual aplicarse.
        const stockExistente = await tx.stockDeposito.upsert({
          where: {
            variante_sku_id_deposito_id: {
              variante_sku_id: item.variante_sku_id,
              deposito_id: input.deposito_destino_id,
            },
          },
          update: {},
          create: {
            variante_sku_id: item.variante_sku_id,
            deposito_id: input.deposito_destino_id,
            cantidad: 0,
          },
        });

        const decremento = await decrementarStockDepositoTx(tx, {
          stockDepositoId: stockExistente.id,
          cantidadSolicitada: item.cantidad,
        });
        cantidadResultante = decremento.cantidad_resultante;
        alertasPendientes.push(decremento);
      }

      itemsCreacion.push({
        variante_sku_id: item.variante_sku_id,
        cantidad: item.cantidad,
        estado_destino: item.estado_destino,
        numero_serie: item.numero_serie ?? null,
      });

      itemsResultado.push({
        variante_sku_id: item.variante_sku_id,
        cantidad: item.cantidad,
        estado_destino: item.estado_destino,
        numero_serie: item.numero_serie ?? null,
        impacto_stock: impacto,
        stock_resultante: { cantidad: cantidadResultante },
      });
    }

    const movimiento = await tx.movimientoStock.create({
      data: {
        deposito_destino_id: input.deposito_destino_id,
        tipo_movimiento: "INGRESO",
        comprobante_referencia: input.comprobante_referencia || null,
        registrado_por_id: usuarioId,
        items: { createMany: { data: itemsCreacion } },
      },
    });

    return { movimiento_id: movimiento.id, items: itemsResultado, alertasPendientes };
  });

  domainEventBus.emit("inventario:ingreso_stock_registrado", {
    movimiento_id: resultado.movimiento_id,
    deposito_destino_id: input.deposito_destino_id,
    items: resultado.items.map((item) => ({
      variante_sku_id: item.variante_sku_id,
      cantidad: item.cantidad,
      estado_destino: item.estado_destino,
      cantidad_resultante: item.stock_resultante.cantidad,
    })),
    usuario_id: usuarioId,
  });

  for (const alerta of resultado.alertasPendientes) {
    emitirAlertaUmbralSiCorresponde(alerta, resultado.movimiento_id);
  }

  return {
    movimiento_id: resultado.movimiento_id,
    deposito_destino_id: input.deposito_destino_id,
    items: resultado.items,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-A11 — Historial operativo de movimientos (spec_modulo_A.md §2.10)
//
// Query de solo lectura sobre `MovimientoStock`, distinta de la Consola de
// Auditoría Forense (HU-A6/Módulo D): no expone ni calcula hashes de
// integridad, es una vista de conveniencia operativa. No abre `$transaction`
// ni emite eventos de dominio.
// ──────────────────────────────────────────────────────────────────────────────

/** HU-A11 (multi-ítem) — una línea (`MovimientoStockItem`) dentro de una fila del historial. */
export interface MovimientoHistorialItemDetalle {
  variante_sku: string;
  producto_nombre: string;
  cantidad: number;
  estado_origen: string | null;
  estado_destino: string | null;
}

/**
 * Fila del historial de movimientos (contrato estable `{ items, paginacion }`
 * — no confundir con `items`, que acá son los `MovimientoStockItem` de esa
 * fila). `items_count`/`cantidad_total` son los que consume la columna
 * resumida de `HistorialMovimientos.tsx`; `items` completo alimenta
 * `DetalleMovimientoDialog.tsx` sin un segundo fetch.
 */
export interface MovimientoHistorialItem {
  movimiento_id: string;
  tipo_movimiento: string;
  deposito_origen: string | null;
  deposito_destino: string | null;
  items_count: number;
  cantidad_total: number;
  items: MovimientoHistorialItemDetalle[];
  comprobante_referencia: string | null;
  registrado_por: string;
  created_at: string;
}

export interface ListadoHistorialMovimientos {
  items: MovimientoHistorialItem[];
  paginacion: {
    total: number;
    pagina_actual: number;
    total_paginas: number;
    por_pagina: number;
  };
}

const HISTORIAL_MOVIMIENTOS_POR_PAGINA_MAX = 10;

/** Convierte una fecha `AAAA-MM-DD` al inicio del día en horario de Argentina (mismo criterio que `transferencia.service.ts`). */
function inicioDiaArgentina(fecha: string): Date {
  return new Date(`${fecha}T00:00:00-03:00`);
}

const MOVIMIENTO_HISTORIAL_SELECT = {
  id: true,
  tipo_movimiento: true,
  comprobante_referencia: true,
  created_at: true,
  deposito_origen: { select: { nombre: true } },
  deposito_destino: { select: { nombre: true } },
  registrado_por: { select: { email: true } },
  items: {
    where: { is_active: true },
    select: {
      cantidad: true,
      estado_origen: true,
      estado_destino: true,
      variante_sku: { select: { sku: true, producto_maestro: { select: { nombre: true } } } },
    },
  },
} satisfies Prisma.MovimientoStockSelect;

type MovimientoHistorialDb = Prisma.MovimientoStockGetPayload<{ select: typeof MOVIMIENTO_HISTORIAL_SELECT }>;

function mapearMovimientoHistorial(movimiento: MovimientoHistorialDb): MovimientoHistorialItem {
  const items: MovimientoHistorialItemDetalle[] = movimiento.items.map((item) => ({
    variante_sku: item.variante_sku.sku,
    producto_nombre: item.variante_sku.producto_maestro.nombre,
    cantidad: item.cantidad,
    estado_origen: item.estado_origen,
    estado_destino: item.estado_destino,
  }));

  return {
    movimiento_id: movimiento.id,
    tipo_movimiento: movimiento.tipo_movimiento,
    deposito_origen: movimiento.deposito_origen?.nombre ?? null,
    deposito_destino: movimiento.deposito_destino?.nombre ?? null,
    items_count: items.length,
    cantidad_total: items.reduce((acumulado, item) => acumulado + item.cantidad, 0),
    items,
    comprobante_referencia: movimiento.comprobante_referencia,
    registrado_por: movimiento.registrado_por.email,
    created_at: movimiento.created_at.toISOString(),
  };
}

/**
 * Listado paginado server-side de `MovimientoStock`, ordenado por
 * `created_at DESC`, con buscador de texto libre (mismo contrato de filtro
 * que HU-A5, sección 2.6) y filtros de depósito (origen U destino — un único
 * filtro simple), variante, tipo de movimiento y rango de fechas.
 *
 * `where: { is_active: true }` por defecto (Regla N.° 1 de RULES.md — ningún
 * SELECT operativo expone filas dadas de baja).
 */
export async function listarHistorialMovimientos(
  input: HistorialMovimientosQuery,
): Promise<ListadoHistorialMovimientos> {
  const porPagina = Math.min(input.por_pagina, HISTORIAL_MOVIMIENTOS_POR_PAGINA_MAX);

  const and: Prisma.MovimientoStockWhereInput[] = [];

  if (input.deposito_id) {
    and.push({
      OR: [{ deposito_origen_id: input.deposito_id }, { deposito_destino_id: input.deposito_id }],
    });
  }

  const busqueda = input.busqueda?.trim();
  if (busqueda) {
    // HU-A11 (multi-ítem): `variante_sku`/`producto_maestro` migraron a
    // `MovimientoStockItem` — se busca por "algún ítem activo de la cabecera
    // matchea" (`items: { some: ... } }`), no por un campo propio de la cabecera.
    and.push({
      items: {
        some: {
          is_active: true,
          OR: [
            { variante_sku: { sku: { contains: busqueda, mode: "insensitive" } } },
            {
              variante_sku: {
                producto_maestro: { nombre: { contains: busqueda, mode: "insensitive" } },
              },
            },
          ],
        },
      },
    });
  }

  if (input.fecha_desde || input.fecha_hasta) {
    const hastaExclusivo = input.fecha_hasta ? inicioDiaArgentina(input.fecha_hasta) : null;
    if (hastaExclusivo) hastaExclusivo.setUTCDate(hastaExclusivo.getUTCDate() + 1);
    and.push({
      created_at: {
        ...(input.fecha_desde ? { gte: inicioDiaArgentina(input.fecha_desde) } : {}),
        ...(hastaExclusivo ? { lt: hastaExclusivo } : {}),
      },
    });
  }

  const where: Prisma.MovimientoStockWhereInput = {
    is_active: true,
    ...(input.variante_sku_id
      ? { items: { some: { variante_sku_id: input.variante_sku_id, is_active: true } } }
      : {}),
    ...(input.tipo_movimiento ? { tipo_movimiento: input.tipo_movimiento } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };

  const skip = (input.pagina - 1) * porPagina;

  const [filas, total] = await Promise.all([
    prisma.movimientoStock.findMany({
      where,
      skip,
      take: porPagina,
      orderBy: { created_at: "desc" },
      select: MOVIMIENTO_HISTORIAL_SELECT,
    }),
    prisma.movimientoStock.count({ where }),
  ]);

  return {
    items: filas.map(mapearMovimientoHistorial),
    paginacion: {
      total,
      pagina_actual: input.pagina,
      total_paginas: Math.max(1, Math.ceil(total / porPagina)),
      por_pagina: porPagina,
    },
  };
}
