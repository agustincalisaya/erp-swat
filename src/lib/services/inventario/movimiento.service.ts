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
} from "@/lib/schemas/inventario.schema";
import { decrementarStockConAlerta } from "@/lib/services/inventario/stock.service";

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

export interface IngresoRegistrado {
  movimiento_id: string;
  variante_sku_id: string;
  deposito_destino_id: string;
  cantidad: number;
  estado_destino: string;
  /** Dirección en la que este movimiento afectó el disponible — ver `IMPACTO_STOCK_POR_ESTADO_DESTINO`. */
  impacto_stock: "SUMA" | "RESTA";
  stock_resultante: { cantidad: number };
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
 * Registra el ingreso de mercadería resuelta por escaneo:
 *  1. Verifica que la variante exista y esté activa.
 *  2. Según `IMPACTO_STOCK_POR_ESTADO_DESTINO[estado_destino]`:
 *     - SUMA: incrementa (o crea) el `StockDeposito` vía `upsert` sobre la
 *       clave compuesta `[variante_sku_id, deposito_id]`, y crea el
 *       `MovimientoStock` inmutable tipo INGRESO, todo en una única
 *       transacción.
 *     - RESTA (`RESERVADO`, `VENDIDO`, `BAJA_MERMA`, `EN_TRANSITO`):
 *       delega el decremento condicionado y la alerta de umbral crítico en
 *       `decrementarStockConAlerta()` (HU-5, `stock.service.ts`) — única
 *       función autorizada a evaluar `punto_pedido` y emitir
 *       `stock:umbral_critico_alcanzado`. Esa función corre su propia
 *       transacción y exige el `movimiento_id` de origen ya creado, por lo
 *       que acá el `MovimientoStock` se crea primero (en una transacción
 *       corta junto con el `upsert` que garantiza la fila de
 *       `StockDeposito`) y luego se invoca el decremento. Si no hay stock
 *       suficiente, se compensa borrando el `MovimientoStock` recién creado
 *       para preservar la garantía de HU-2: stock insuficiente no deja
 *       rastro en `movimientos_stock`. Nota: esa compensación no es
 *       atómica con la creación (dos transacciones separadas), a diferencia
 *       del camino SUMA.
 *
 * FUERA de la transacción (o transacciones, en el caso RESTA): emite
 * `inventario:ingreso_stock_registrado`. La alerta `stock:umbral_critico_alcanzado`
 * para el caso RESTA la emite `decrementarStockConAlerta()` internamente —
 * no se duplica acá.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA
 * @throws {ServiceError} DEPOSITO_NO_ENCONTRADO
 * @throws {ServiceError} STOCK_INSUFICIENTE
 */
export async function registrarIngresoStock(
  input: RegistrarIngresoPorEscaneoInput,
  usuarioId: string,
): Promise<IngresoRegistrado> {
  const impacto = IMPACTO_STOCK_POR_ESTADO_DESTINO[input.estado_destino];

  if (impacto === "SUMA") {
    const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const variante = await tx.varianteSKU.findFirst({
        where: { id: input.variante_sku_id, is_active: true, deleted_at: null },
      });

      if (!variante) {
        throw new ServiceError(
          "VARIANTE_NO_ENCONTRADA",
          `No se encontró la variante ${input.variante_sku_id} en el catálogo activo.`,
        );
      }

      const deposito = await tx.deposito.findFirst({
        where: { id: input.deposito_destino_id, is_active: true, deleted_at: null },
      });

      if (!deposito) {
        throw new ServiceError(
          "DEPOSITO_NO_ENCONTRADO",
          `No se encontró el depósito ${input.deposito_destino_id}.`,
        );
      }

      const stockActualizado = await tx.stockDeposito.upsert({
        where: {
          variante_sku_id_deposito_id: {
            variante_sku_id: input.variante_sku_id,
            deposito_id: input.deposito_destino_id,
          },
        },
        update: {
          cantidad: { increment: input.cantidad },
          is_active: true,
          deleted_at: null,
        },
        create: {
          variante_sku_id: input.variante_sku_id,
          deposito_id: input.deposito_destino_id,
          cantidad: input.cantidad,
        },
      });

      const movimiento = await tx.movimientoStock.create({
        data: {
          variante_sku_id: input.variante_sku_id,
          deposito_destino_id: input.deposito_destino_id,
          tipo_movimiento: "INGRESO",
          estado_destino: input.estado_destino,
          cantidad: input.cantidad,
          comprobante_referencia: input.comprobante_referencia || null,
          registrado_por_id: usuarioId,
        },
      });

      return {
        movimiento_id: movimiento.id,
        cantidad_resultante: stockActualizado.cantidad,
      };
    });

    domainEventBus.emit("inventario:ingreso_stock_registrado", {
      movimiento_id: resultado.movimiento_id,
      variante_sku_id: input.variante_sku_id,
      deposito_destino_id: input.deposito_destino_id,
      cantidad: input.cantidad,
      cantidad_resultante: resultado.cantidad_resultante,
      usuario_id: usuarioId,
    });

    return {
      movimiento_id: resultado.movimiento_id,
      variante_sku_id: input.variante_sku_id,
      deposito_destino_id: input.deposito_destino_id,
      cantidad: input.cantidad,
      estado_destino: input.estado_destino,
      impacto_stock: impacto,
      stock_resultante: { cantidad: resultado.cantidad_resultante },
    };
  }

  // impacto === "RESTA": el decremento condicionado y la alerta de umbral
  // crítico son responsabilidad exclusiva de `decrementarStockConAlerta()`
  // (HU-5, stock.service.ts). Esa función corre su propia transacción y
  // exige el `movimiento_id` de origen ya creado, así que acá se crea
  // primero el `MovimientoStock` (junto con el `upsert` que garantiza la
  // fila de `StockDeposito`) y luego se invoca el decremento.
  const preparacion = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const variante = await tx.varianteSKU.findFirst({
      where: { id: input.variante_sku_id, is_active: true, deleted_at: null },
    });

    if (!variante) {
      throw new ServiceError(
        "VARIANTE_NO_ENCONTRADA",
        `No se encontró la variante ${input.variante_sku_id} en el catálogo activo.`,
      );
    }

    const deposito = await tx.deposito.findFirst({
      where: { id: input.deposito_destino_id, is_active: true, deleted_at: null },
    });

    if (!deposito) {
      throw new ServiceError(
        "DEPOSITO_NO_ENCONTRADO",
        `No se encontró el depósito ${input.deposito_destino_id}.`,
      );
    }

    // Garantiza que exista la fila (en 0 si es la primera vez que se toca
    // esta combinación variante/depósito) para que `decrementarStockConAlerta()`
    // tenga un `stockDepositoId` sobre el cual aplicar su propio decremento
    // condicionado.
    const stockExistente = await tx.stockDeposito.upsert({
      where: {
        variante_sku_id_deposito_id: {
          variante_sku_id: input.variante_sku_id,
          deposito_id: input.deposito_destino_id,
        },
      },
      update: {},
      create: {
        variante_sku_id: input.variante_sku_id,
        deposito_id: input.deposito_destino_id,
        cantidad: 0,
      },
    });

    const movimiento = await tx.movimientoStock.create({
      data: {
        variante_sku_id: input.variante_sku_id,
        deposito_destino_id: input.deposito_destino_id,
        tipo_movimiento: "INGRESO",
        estado_destino: input.estado_destino,
        cantidad: input.cantidad,
        comprobante_referencia: input.comprobante_referencia || null,
        registrado_por_id: usuarioId,
      },
    });

    return {
      movimiento_id: movimiento.id,
      stock_deposito_id: stockExistente.id,
      cantidad_antes: stockExistente.cantidad,
    };
  });

  let decremento: Awaited<ReturnType<typeof decrementarStockConAlerta>>;
  try {
    decremento = await decrementarStockConAlerta({
      stockDepositoId: preparacion.stock_deposito_id,
      cantidadSolicitada: input.cantidad,
      movimientoIdOrigen: preparacion.movimiento_id,
    });
  } catch (error) {
    if (error instanceof ServiceError && error.code === "STOCK_INSUFICIENTE") {
      // Compensación manual: `decrementarStockConAlerta()` corre en su
      // propia transacción, separada de la que creó el `MovimientoStock`
      // arriba, así que el rollback no es automático. Se borra el
      // movimiento recién creado para preservar la garantía de HU-2: stock
      // insuficiente no deja rastro en `movimientos_stock`.
      await prisma.movimientoStock.delete({ where: { id: preparacion.movimiento_id } });
      throw new ServiceError(
        "STOCK_INSUFICIENTE",
        `Stock disponible insuficiente en el depósito para restar ${input.cantidad} unidades (hay ${preparacion.cantidad_antes}).`,
      );
    }
    throw error;
  }

  domainEventBus.emit("inventario:ingreso_stock_registrado", {
    movimiento_id: preparacion.movimiento_id,
    variante_sku_id: input.variante_sku_id,
    deposito_destino_id: input.deposito_destino_id,
    cantidad: input.cantidad,
    cantidad_resultante: decremento.cantidad_resultante,
    usuario_id: usuarioId,
  });

  // `stock:umbral_critico_alcanzado` ya fue emitido, si correspondía, dentro
  // de `decrementarStockConAlerta()` — no se duplica acá (Hallazgo 4).

  return {
    movimiento_id: preparacion.movimiento_id,
    variante_sku_id: input.variante_sku_id,
    deposito_destino_id: input.deposito_destino_id,
    cantidad: input.cantidad,
    estado_destino: input.estado_destino,
    impacto_stock: impacto,
    stock_resultante: { cantidad: decremento.cantidad_resultante },
  };
}
