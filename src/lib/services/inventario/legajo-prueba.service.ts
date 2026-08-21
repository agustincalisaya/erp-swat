/**
 * @module legajo-prueba.service
 * @description Orquestador de la HU-A3: registra la transición de una unidad de stock
 * al estado «En Prueba» y la vincula al efectivo institucional receptor.
 *
 * Cumplimiento normativo:
 *  - RULES.md §1 — Soft Delete estricto: nunca DELETE físico.
 *  - RULES.md §2 — AES-256-GCM: `efectivo_placa` y `efectivo_organismo` cifrados antes
 *    de persistir. La clave nunca viaja a la BD ni aparece en logs.
 *  - RULES.md §2 — AuditLog (stub activo; Ledger SHA-256 completo en HU-D).
 *  - spec_modulo_A_HU3.md §1 — Operación atómica vía `prisma.$transaction`.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { encrypt, decrypt } from "@/lib/crypto/aes";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { registrarAuditLog } from "@/lib/services/auditoria/audit-log.service";
import { ServiceError } from "@/lib/errors/service-error";
import type { IniciarLegajoPruebaInput } from "@/lib/schemas/inventario.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface LegajoPruebaCreado {
  legajo_prueba_id: string;
  movimiento_stock_id: string;
  variante_sku_id: string;
  deposito_origen_id: string;
  cantidad: number;
  fecha_inicio_prueba: Date;
}

/** LegajoPrueba con campos sensibles ya descifrados (solo para uso en servidor). */
export interface LegajoPruebaDecifrado {
  id: string;
  variante_sku_id: string;
  efectivo_placa: string; // descifrado en memoria
  efectivo_organismo: string; // descifrado en memoria
  fecha_inicio_prueba: Date;
  fecha_fin_prueba: Date | null;
  registrado_por_id: string;
  created_at: Date;
  variante_sku: {
    sku: string;
    talle: string;
    color: string;
    genero: string;
    modelo: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Operación principal: asignarStockEnPrueba
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registra la asignación de una unidad de stock al estado EN_PRUEBA.
 *
 * Secuencia atómica dentro de `prisma.$transaction`:
 *  1. Verifica existencia y stock suficiente en `StockDeposito`.
 *  2. Verifica que no haya un `LegajoPrueba` activo para la misma variante.
 *  3. Cifra `efectivo_placa` y `efectivo_organismo` con AES-256-GCM.
 *  4. Decrementa `StockDeposito.cantidad` atómicamente (updateMany condicionado).
 *  5. Crea `MovimientoStock` tipo EGRESO con estado_destino "EN_PRUEBA".
 *  6. Crea `LegajoPrueba` con los campos cifrados.
 *  7. Registra en AuditLog (stub en Sprint 1, Ledger SHA-256 en HU-D).
 *
 * FUERA de la transacción: emite el evento de dominio `inventario:legajo_prueba_iniciado`.
 *
 * @param input    - Datos validados por `IniciarLegajoPruebaSchema`.
 * @param usuarioId - ID del usuario autenticado que realiza la operación.
 * @param ip        - IP del cliente para el AuditLog.
 * @returns Resumen de los registros creados.
 * @throws {ServiceError} STOCK_DEPOSITO_NO_ENCONTRADO | STOCK_INSUFICIENTE |
 *                        LEGAJO_PRUEBA_YA_ACTIVO
 */
export async function asignarStockEnPrueba(
  input: IniciarLegajoPruebaInput,
  usuarioId: string,
  ip: string,
): Promise<LegajoPruebaCreado> {
  // ─── Cifrado PREVIO a la transacción ──────────────────────────────────────
  // encrypt() se llama fuera de la tx para no mantener la clave en memoria
  // más tiempo del necesario dentro del contexto transaccional de Prisma.
  const placaCifrada = encrypt(input.efectivo_placa);
  const organismoCifrado = encrypt(input.efectivo_organismo);

  // ─── Transacción atómica ──────────────────────────────────────────────────
  const resultado = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // 1. Verificar existencia de StockDeposito con stock suficiente
      const stockDeposito = await tx.stockDeposito.findFirst({
        where: {
          variante_sku_id: input.variante_sku_id,
          deposito_id: input.deposito_origen_id,
          is_active: true,
          deleted_at: null,
        },
      });

      if (!stockDeposito) {
        throw new ServiceError(
          "STOCK_DEPOSITO_NO_ENCONTRADO",
          `No se encontró stock activo para la variante ${input.variante_sku_id} ` +
            `en el depósito ${input.deposito_origen_id}.`,
        );
      }

      if (stockDeposito.cantidad < input.cantidad) {
        throw new ServiceError(
          "STOCK_INSUFICIENTE",
          `Stock insuficiente. Disponible: ${stockDeposito.cantidad}, ` +
            `solicitado: ${input.cantidad}.`,
        );
      }

      // 2. (Eliminado) — No se restringe la cantidad de LegajosPrueba simultáneos
      // por VarianteSKU. Un VarianteSKU es un MODELO GENÉRICO (talle + color),
      // no un número de serie unitario. Si hay 10 unidades en stock, 10 efectivos
      // pueden tener simultáneamente un legajo activo para esa misma variante.
      // La única barrera es el stock disponible, verificada en el paso siguiente.

      // 3. Decrementar StockDeposito atómicamente (patrón updateMany condicionado)
      // La condición `cantidad: { gte: input.cantidad }` es evaluada atómicamente
      // por PostgreSQL dentro de la transacción — evita race conditions.
      const updateResult = await tx.stockDeposito.updateMany({
        where: {
          id: stockDeposito.id,
          is_active: true,
          cantidad: { gte: input.cantidad },
        },
        data: {
          cantidad: { decrement: input.cantidad },
        },
      });

      // Si count === 0, otra transacción concurrente ganó la carrera
      if (updateResult.count === 0) {
        throw new ServiceError(
          "STOCK_INSUFICIENTE",
          "Stock insuficiente (condición de concurrencia detectada).",
        );
      }

      // 4. Crear MovimientoStock (registro inmutable — nunca se actualiza)
      const movimiento = await tx.movimientoStock.create({
        data: {
          variante_sku_id: input.variante_sku_id,
          deposito_origen_id: input.deposito_origen_id,
          tipo_movimiento: "EGRESO",
          estado_origen: "DISPONIBLE",
          estado_destino: "EN_PRUEBA",
          cantidad: input.cantidad,
          comprobante_referencia: null,
          registrado_por_id: usuarioId,
        },
      });

      // 5. Crear LegajoPrueba con campos sensibles cifrados
      const legajoPrueba = await tx.legajoPrueba.create({
        data: {
          variante_sku_id: input.variante_sku_id,
          registrado_por_id: usuarioId,
          efectivo_placa: placaCifrada, // AES-256-GCM — nunca texto plano en BD
          efectivo_organismo: organismoCifrado, // AES-256-GCM — nunca texto plano en BD
        },
      });

      // 6. AuditLog (stub Sprint 1 — no-op; Ledger SHA-256 encadenado en HU-D)
      await registrarAuditLog(
        {
          usuario_id: usuarioId,
          accion: "CREATE",
          tabla_afectada: "legajos_prueba",
          registro_id: legajoPrueba.id,
          ip,
          valor_anterior: null,
          valor_nuevo: {
            variante_sku_id: input.variante_sku_id,
            deposito_origen_id: input.deposito_origen_id,
            cantidad: input.cantidad,
            // los campos cifrados nunca se loguean en claro
          },
        },
        tx,
      );

      return {
        legajo_prueba_id: legajoPrueba.id,
        movimiento_stock_id: movimiento.id,
        variante_sku_id: legajoPrueba.variante_sku_id,
        deposito_origen_id: input.deposito_origen_id,
        cantidad: input.cantidad,
        fecha_inicio_prueba: legajoPrueba.fecha_inicio_prueba,
      };
    },
  );

  // ─── Emisión de evento de dominio (FUERA de la transacción) ───────────────
  // Se emite solo si la tx commitió exitosamente.
  // Los futuros listeners (audit-log.listener, notificaciones) se suscriben aquí.
  domainEventBus.emit("inventario:legajo_prueba_iniciado", {
    legajo_prueba_id: resultado.legajo_prueba_id,
    variante_sku_id: resultado.variante_sku_id,
    deposito_origen_id: resultado.deposito_origen_id,
    movimiento_stock_id: resultado.movimiento_stock_id,
    cantidad: resultado.cantidad,
    usuario_id: usuarioId,
    ip,
  });

  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// Consulta: listar legajos prueba activos (con descifrado en memoria)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos los `LegajoPrueba` activos y en curso (sin fecha_fin_prueba).
 * Los campos `efectivo_placa` y `efectivo_organismo` se descifran en memoria
 * antes de retornar. NUNCA persistir el resultado descifrado.
 *
 * @returns Array de legajos con datos descifrados. Solo para consumo en Server.
 */
export async function listarLegajosPruebaActivos(): Promise<
  LegajoPruebaDecifrado[]
> {
  const legajos = await prisma.legajoPrueba.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      fecha_fin_prueba: null,
      variante_sku: {
        is_active: true,
        deleted_at: null,
      },
    },
    include: {
      variante_sku: {
        select: {
          sku: true,
          talle: true,
          color: true,
          genero: true,
          modelo: true,
        },
      },
    },
    orderBy: { fecha_inicio_prueba: "desc" },
  });

  // Descifrado en memoria — los datos en texto plano NUNCA salen de este scope
  return legajos.map((legajo) => ({
    id: legajo.id,
    variante_sku_id: legajo.variante_sku_id,
    efectivo_placa: decrypt(legajo.efectivo_placa),
    efectivo_organismo: decrypt(legajo.efectivo_organismo),
    fecha_inicio_prueba: legajo.fecha_inicio_prueba,
    fecha_fin_prueba: legajo.fecha_fin_prueba,
    registrado_por_id: legajo.registrado_por_id,
    created_at: legajo.created_at,
    variante_sku: legajo.variante_sku,
  }));
}
