/**
 * HU-B9 — Lista de Precios de Venta (spec_modulo_B.md §2.9).
 *
 * Origen: HU-E1 introdujo (aprobado por el owner) la función de resolución
 * server-side, con la firma exacta de spec B §2.9, y su versión por lote
 * (para el catálogo web, sin N+1). HU-B9 completó el archivo: segundo
 * parámetro opcional `{ prisma }` del resolver, `obtenerSugerenciaPrecio`,
 * `consultarPrecioVentaVigente` y `publicarVersionListaPrecioVenta` (rutas
 * `/api/ventas/lista-precios/**`). Sin UI en esta iteración (API primero).
 *
 * Regla de vigencia (spec B §2.9): versión con `is_active = true` y
 * `vigente_desde <= now()`, la más reciente. Resolución POR VARIANTE: si la
 * versión más reciente no trae ítem para un SKU, se busca en la versión
 * anterior activa que sí lo traiga ("ni en ninguna versión anterior activa" —
 * mismo criterio que el fix A3 de `obtenerVersionVigente()` de Módulo H).
 * Una versión con `vigente_desde` futura NUNCA se aplica antes de tiempo.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { CrearVersionListaPrecioVentaInput } from "@/lib/schemas/ventas.schema";
import { obtenerCostoReposicionVigente } from "@/lib/services/proveedores/costo-reposicion.service";
import { obtenerConfiguracion } from "@/lib/services/sistema/configuracion.service";
import { calcularPrecioSugerido, validarBajoCosto } from "@/lib/services/ventas/lista-precio-venta.calculo";

/** Único permiso de HU-B9 (seed: exclusivo SUPERVISOR_VENTAS). Gatea las 3 rutas y las 2 actions. */
export const PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS = "ventas:gestionar_lista_precios";

export interface PrecioVentaVigente {
  precio_venta: Prisma.Decimal;
  lista_precio_version_id: string;
}

/** Cliente Prisma (singleton o `tx` del llamador) sobre el que se resuelve. */
type ClienteDb = Prisma.TransactionClient | typeof prisma;

/**
 * Precio de venta vigente de una variante, o `null` si no tiene ítem activo
 * en ninguna versión vigente. El llamador traduce `null` a su propio error
 * de negocio (ej. `SKU_SIN_PRECIO_VIGENTE`, `ARTICULO_NO_DISPONIBLE`).
 *
 * HU-B9 (PROPUESTA aceptada, no rompe la firma de spec B §2.9): `opciones.prisma`
 * permite resolver dentro de la transacción del llamador (B1/B3/E2), mismo
 * patrón que `obtenerCostoReposicionVigente(id, { prisma })` de HU-H8.
 */
export async function resolverPrecioVentaVigente(
  variante_sku_id: string,
  opciones?: { prisma?: Prisma.TransactionClient },
): Promise<PrecioVentaVigente | null> {
  const precios = await resolverPreciosConCliente(opciones?.prisma ?? prisma, [variante_sku_id], new Date());
  return precios.get(variante_sku_id) ?? null;
}

/**
 * Versión por lote de `resolverPrecioVentaVigente()`: una sola consulta para N
 * variantes. Las variantes sin precio vigente quedan fuera del `Map`.
 */
export async function resolverPreciosVentaVigentes(
  variante_sku_ids: readonly string[],
  ahora: Date = new Date(),
): Promise<Map<string, PrecioVentaVigente>> {
  return resolverPreciosConCliente(prisma, variante_sku_ids, ahora);
}

/**
 * HU-B9 — cuerpo original de `resolverPreciosVentaVigentes()` (HU-E1), movido
 * sin cambios de consulta ni de orden para que el resolver singular pueda
 * usar el `tx` del llamador. Única implementación de la resolución (spec B
 * §2.9: "la única vía").
 */
async function resolverPreciosConCliente(
  db: ClienteDb,
  variante_sku_ids: readonly string[],
  ahora: Date,
): Promise<Map<string, PrecioVentaVigente>> {
  const resultado = new Map<string, PrecioVentaVigente>();
  if (variante_sku_ids.length === 0) return resultado;

  const items = await db.listaPrecioVentaItem.findMany({
    where: {
      variante_sku_id: { in: [...new Set(variante_sku_ids)] },
      is_active: true,
      deleted_at: null,
      version: {
        is_active: true,
        deleted_at: null,
        vigente_desde: { lte: ahora },
        lista: { is_active: true, deleted_at: null },
      },
    },
    select: {
      variante_sku_id: true,
      precio_venta: true,
      version_id: true,
      version: { select: { vigente_desde: true, created_at: true } },
    },
    // Más reciente primero; `created_at` desempata dos versiones con el mismo
    // `vigente_desde`.
    orderBy: [{ version: { vigente_desde: "desc" } }, { version: { created_at: "desc" } }],
  });

  for (const item of items) {
    if (resultado.has(item.variante_sku_id)) continue;
    resultado.set(item.variante_sku_id, {
      precio_venta: item.precio_venta,
      lista_precio_version_id: item.version_id,
    });
  }
  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-B9 §4.2 — Consulta HTTP de precio vigente (wrapper del resolver)
// ──────────────────────────────────────────────────────────────────────────────

export interface PrecioVentaVigenteConsulta {
  variante_sku_id: string;
  precio_venta: number;
  lista_precio_version_id: string;
  vigente_desde: Date;
}

/**
 * Delega en `resolverPrecioVentaVigente()` (nunca reimplementa la resolución)
 * y agrega `vigente_desde` de la versión resuelta (shape de spec §2.9).
 *
 * @throws {ServiceError} SKU_SIN_PRECIO_VIGENTE (404)
 */
export async function consultarPrecioVentaVigente(
  variante_sku_id: string,
): Promise<PrecioVentaVigenteConsulta> {
  const precio = await resolverPrecioVentaVigente(variante_sku_id);
  if (!precio) {
    throw new ServiceError("SKU_SIN_PRECIO_VIGENTE", "La variante no tiene un precio de venta vigente");
  }
  const version = await prisma.listaPrecioVentaVersion.findUniqueOrThrow({
    where: { id: precio.lista_precio_version_id },
    select: { vigente_desde: true },
  });
  return {
    variante_sku_id,
    precio_venta: precio.precio_venta.toNumber(),
    lista_precio_version_id: precio.lista_precio_version_id,
    vigente_desde: version.vigente_desde,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-B9 §4.3 — Sugerencia de precio por SKU
// ──────────────────────────────────────────────────────────────────────────────

export interface SugerenciaPrecioVenta {
  variante_sku_id: string;
  costo_reposicion_referencia: number | null;
  margen: number;
  precio_sugerido: number | null;
}

/**
 * Sugerencia = costo de reposición (HU-H8, función de servicio, no HTTP) ×
 * (1 + margen de `ConfiguracionSistema`), sin redondeo comercial (Punto
 * abierto 8). Margen SIN default: si la clave falta, se propaga
 * `CONFIGURACION_NO_ENCONTRADA` (spec D §6.3). Sin costo → `200` con
 * `costo_reposicion_referencia`/`precio_sugerido` en `null` (Punto abierto 7).
 *
 * Rechaza SKU inexistente o dado de baja con el mismo error que publicación:
 * `VARIANTE_NO_ENCONTRADA` (422). Solo un SKU activo y vigente puede recibir
 * una sugerencia de precio de venta.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA (422)
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA (404)
 * @throws {ServiceError} CONFIGURACION_INVALIDA (500) — valor no numérico o negativo.
 */
export async function obtenerSugerenciaPrecio(variante_sku_id: string): Promise<SugerenciaPrecioVenta> {
  const { valor } = await obtenerConfiguracion("VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA");
  const margen = Number(valor);
  if (valor.trim() === "" || !Number.isFinite(margen) || margen < 0) {
    throw new ServiceError(
      "CONFIGURACION_INVALIDA",
      `VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA debe ser un número no negativo (valor actual: "${valor}")`,
    );
  }

  const variante = await prisma.varianteSKU.findFirst({
    where: { id: variante_sku_id, is_active: true, deleted_at: null },
    select: { id: true },
  });
  if (!variante) {
    throw new ServiceError(
      "VARIANTE_NO_ENCONTRADA",
      `La variante ${variante_sku_id} no existe o está dada de baja`,
    );
  }

  const costo = await obtenerCostoReposicionVigente(variante_sku_id);
  const costo_reposicion_referencia = costo?.precio_unitario ?? null;

  return {
    variante_sku_id,
    costo_reposicion_referencia,
    margen,
    precio_sugerido: calcularPrecioSugerido(costo_reposicion_referencia, margen),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-B9 §4.1 — Publicación de una versión (inmutable)
// ──────────────────────────────────────────────────────────────────────────────

export interface VersionListaPrecioVentaPublicada {
  version_id: string;
  lista_id: string;
  vigente_desde: Date;
  items_publicados: number;
  items_bajo_costo: number;
}

/**
 * Publica una `ListaPrecioVentaVersion` nueva con sus ítems. Nunca hace
 * `update`/`updateMany` sobre versiones o ítems existentes (inmutabilidad) ni
 * `delete` (Regla N.° 1). Orden de validación de la task §4.1: duplicados →
 * lista única activa → variantes existentes/activas → bajo costo.
 *
 * Costo de reposición: `obtenerCostoReposicionVigente()` tipa su cliente como
 * `PrismaClient`, NO como `TransactionClient`, así que no se le pasa el `tx`
 * (task §4.1 paso 3, rama "si la firma no acepta tx"): se invoca ANTES de
 * abrir la transacción, sobre el singleton. `costo_reposicion_referencia` es
 * un snapshot de lectura al publicar; un cambio de lista de proveedor entre
 * esa lectura y el COMMIT queda fuera (ventana de milisegundos, documentado).
 * Si el bajo costo falla, se lanza dentro de la `$transaction` → rollback,
 * nada persistido.
 *
 * Emisión post-COMMIT de `precio_venta:version_publicada` (evento sensible).
 * `version_anterior_id` viaja solo en el evento (para el AuditLog), no en el
 * valor de retorno: la respuesta del POST no cambia.
 *
 * @throws {ServiceError} ITEM_DUPLICADO_EN_VERSION (400)
 * @throws {ServiceError} LISTA_PRECIO_VENTA_NO_CONFIGURADA (409)
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA (422)
 * @throws {ServiceError} MOTIVO_BAJO_COSTO_REQUERIDO (422) — `details.variante_sku_id`.
 */
export async function publicarVersionListaPrecioVenta(
  input: CrearVersionListaPrecioVentaInput,
  usuarioId: string,
): Promise<VersionListaPrecioVentaPublicada> {
  const skuIds = input.items.map((item) => item.variante_sku_id);
  if (new Set(skuIds).size !== skuIds.length) {
    throw new ServiceError(
      "ITEM_DUPLICADO_EN_VERSION",
      "La versión no puede incluir la misma variante en más de un ítem",
    );
  }

  // Secuencial a propósito (no `Promise.all`): una versión puede traer cientos
  // de ítems y cada costo son varias consultas — no saturar el pool.
  const costoPorSku = new Map<string, number | null>();
  for (const id of skuIds) {
    const costo = await obtenerCostoReposicionVigente(id);
    costoPorSku.set(id, costo?.precio_unitario ?? null);
  }

  const { version_anterior_id, ...resultado } = await prisma.$transaction(async (tx) => {
    const listas = await tx.listaPrecioVenta.findMany({
      where: { is_active: true, deleted_at: null },
      select: { id: true },
      take: 2,
    });
    if (listas.length !== 1) {
      throw new ServiceError(
        "LISTA_PRECIO_VENTA_NO_CONFIGURADA",
        "Debe existir exactamente una Lista de Precios de Venta activa para publicar una versión",
      );
    }
    const lista_id = listas[0].id;

    const activas = await tx.varianteSKU.findMany({
      where: { id: { in: skuIds }, is_active: true, deleted_at: null },
      select: { id: true },
    });
    const idsActivos = new Set(activas.map((v) => v.id));
    const faltante = skuIds.find((id) => !idsActivos.has(id));
    if (faltante) {
      throw new ServiceError(
        "VARIANTE_NO_ENCONTRADA",
        `La variante ${faltante} no existe o está dada de baja`,
      );
    }

    const filas = input.items.map((item) => {
      const costo = costoPorSku.get(item.variante_sku_id) ?? null;
      const validacion = validarBajoCosto(item.precio_venta, costo, item.motivo_bajo_costo);
      if (!validacion.ok) {
        throw new ServiceError(
          "MOTIVO_BAJO_COSTO_REQUERIDO",
          "El precio propuesto para la variante está por debajo del costo de reposición; debe declararse un motivo",
          { variante_sku_id: item.variante_sku_id },
        );
      }
      return {
        variante_sku_id: item.variante_sku_id,
        precio_venta: item.precio_venta,
        costo_reposicion_referencia: costo,
        confirmado_bajo_costo: validacion.confirmado_bajo_costo,
        // El motivo solo se persiste cuando efectivamente justifica un bajo costo.
        motivo_bajo_costo: validacion.confirmado_bajo_costo ? item.motivo_bajo_costo!.trim() : null,
      };
    });

    // Versión reemplazada (Punto abierto 3, resuelto): la activa que rige en el
    // instante en que empieza a regir la nueva (`vigente_desde <=`), así una
    // versión programada a futuro no cuenta como "anterior". Leída ANTES del
    // create y solo lectura (inmutabilidad). `null` si no hay ninguna.
    const anterior = await tx.listaPrecioVentaVersion.findFirst({
      where: { lista_id, is_active: true, deleted_at: null, vigente_desde: { lte: input.vigente_desde } },
      orderBy: [{ vigente_desde: "desc" }, { created_at: "desc" }],
      take: 1,
      select: { id: true },
    });

    const version = await tx.listaPrecioVentaVersion.create({
      data: { lista_id, vigente_desde: input.vigente_desde, publicado_por_id: usuarioId },
      select: { id: true, vigente_desde: true },
    });
    await tx.listaPrecioVentaItem.createMany({
      data: filas.map((fila) => ({ ...fila, version_id: version.id })),
    });

    return {
      version_id: version.id,
      version_anterior_id: anterior?.id ?? null,
      lista_id,
      vigente_desde: version.vigente_desde,
      items_publicados: filas.length,
      items_bajo_costo: filas.filter((fila) => fila.confirmado_bajo_costo).length,
    };
  });

  // Post-COMMIT: evento sensible → audit-log.listener.ts (SHA-256).
  domainEventBus.emit("precio_venta:version_publicada", {
    version_id: resultado.version_id,
    version_anterior_id,
    lista_id: resultado.lista_id,
    publicado_por_id: usuarioId,
    vigente_desde: resultado.vigente_desde.toISOString(),
    items_publicados: resultado.items_publicados,
    items_bajo_costo: resultado.items_bajo_costo,
  });

  return resultado;
}
