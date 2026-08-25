/**
 * @module producto.service
 * @description HU-A1 — Sección 6 de `docs/tasks/task_relos.md`: alta de
 * `ProductoMaestro` y generación en lote de `VarianteSKU` mediante producto
 * cartesiano talle × color × género.
 *
 * Cumplimiento normativo:
 *  - RULES.md §1 — Soft Delete estricto: solo lectura de `is_active: true`,
 *    ningún DELETE físico en este archivo.
 *  - spec_modulo_A.md §4 — el evento se emite DESPUÉS de que la operación
 *    resuelva exitosamente, nunca dentro de una transacción. Este service no
 *    escribe `AuditLog` directamente: emite al bus y `audit-log.listener.ts`
 *    reacciona (patrón unificado, ver docstring de ese listener).
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import { generarSku, claveCombinacionVariante, type Genero } from "@/lib/utils/sku";
import type {
  CrearProductoMaestroInput,
  GenerarVariantesMatrizInput,
  DesactivarProductoMaestroInput,
} from "@/lib/schemas/inventario.schema";

/** Límite de combinaciones por invocación (sección 6.2) — evita cargas masivas accidentales. */
const MAX_COMBINACIONES_POR_INVOCACION = 200;

// ──────────────────────────────────────────────────────────────────────────────
// 6.1 — crearProductoMaestro
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Inserta un `ProductoMaestro` (sin variantes — eso es un paso explícito y
 * separado, `generarVariantesMatriz()`). Emite `producto_maestro:creado` tras
 * el commit.
 *
 * Nota: un ProductoMaestro con 0 variantes es un estado válido esperado
 * (Paso 1 de 2 del wizard) — no se valida acá a propósito, ver HU-A1 para el
 * análisis completo (decisión de negocio confirmada: no se bloquea).
 *
 * @throws {ServiceError} PRODUCTO_MAESTRO_NOMBRE_DUPLICADO
 */
export async function crearProductoMaestro(
  input: CrearProductoMaestroInput,
  usuarioId: string,
) {
  const nombreTrimmed = input.nombre.trim();

  // Regla de negocio HU-A1: no puede haber dos ProductoMaestro activos con
  // el mismo nombre (case-insensitive, trim). codigo_producto queda afuera
  // a propósito — dos productos distintos pueden compartirlo (ver docstring
  // del modelo en schema.prisma). Un producto dado de baja no bloquea la
  // reutilización de su nombre, de ahí el filtro is_active: true.
  const duplicado = await prisma.productoMaestro.findFirst({
    where: { is_active: true, nombre: { equals: nombreTrimmed, mode: "insensitive" } },
    select: { id: true },
  });

  if (duplicado) {
    throw new ServiceError(
      "PRODUCTO_MAESTRO_NOMBRE_DUPLICADO",
      `Ya existe un Producto Maestro activo con el nombre "${nombreTrimmed}".`,
    );
  }

  const producto = await prisma.productoMaestro.create({
    data: {
      codigo_producto: input.codigo_producto,
      nombre: input.nombre,
      descripcion: input.descripcion,
      rubro: input.rubro,
      categoria: input.categoria,
      unidad_medida: input.unidad_medida,
      proveedor_preferente: input.proveedor_preferente,
      costo_estandar_referencia: input.costo_estandar_referencia,
    },
  });

  domainEventBus.emit("producto_maestro:creado", {
    producto_maestro_id: producto.id,
    nombre: producto.nombre,
    usuario_id: usuarioId,
  });

  return producto;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mejora post-HU-A1 — buscarProductosActivos
// ──────────────────────────────────────────────────────────────────────────────

export interface ProductoMaestroActivoResumen {
  id: string;
  nombre: string;
  codigo_producto: string;
}

/**
 * Búsqueda liviana de `ProductoMaestro` activos por nombre o código de
 * producto — soporta el camino alternativo "agregar variantes a un producto
 * existente" (sin pasar por el alta de Paso 1). Solo `is_active: true`: un
 * producto dado de baja no debe ofrecerse como destino de variantes nuevas
 * (la regla de negocio la aplica igual `generarVariantesMatriz()` con
 * PRODUCTO_MAESTRO_NO_ENCONTRADO/INACTIVO — este filtro es solo para no
 * mostrarlo en el buscador, no reemplaza esa validación).
 */
export async function buscarProductosActivos(query: string): Promise<ProductoMaestroActivoResumen[]> {
  const texto = query.trim();
  if (texto.length < 2) return [];

  return prisma.productoMaestro.findMany({
    where: {
      is_active: true,
      OR: [
        { nombre: { contains: texto, mode: "insensitive" } },
        { codigo_producto: { contains: texto, mode: "insensitive" } },
      ],
    },
    select: { id: true, nombre: true, codigo_producto: true },
    orderBy: { nombre: "asc" },
    take: 10,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Selector jerárquico de umbrales — listarProductosConVariantes
// ──────────────────────────────────────────────────────────────────────────────

export interface ProductoConVariantesResumen {
  id: string;
  nombre: string;
}

/**
 * task_cali_selector_umbrales.md — sección 3: segundo nivel del selector
 * jerárquico (Depósito → Producto → Variante). Lista **todos** los
 * `ProductoMaestro` activos que tengan al menos una `VarianteSKU` activa —
 * deliberadamente sin filtrar por si esas variantes ya tienen `StockDeposito`
 * en el depósito elegido (permite configurar umbrales antes de que llegue
 * mercadería nueva, decisión de negocio confirmada en la sección 1 de esa
 * tarea).
 */
export async function listarProductosConVariantes(): Promise<ProductoConVariantesResumen[]> {
  return prisma.productoMaestro.findMany({
    where: {
      is_active: true,
      variantes: { some: { is_active: true } },
    },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 6.2 — generarVariantesMatriz
// ──────────────────────────────────────────────────────────────────────────────

export interface VarianteMatrizGenerada {
  id: string;
  sku: string;
  ean_qr: string | null;
}

export interface ResultadoGenerarVariantesMatriz {
  variantes_creadas: number;
  variantes_omitidas_duplicadas: number;
  variantes: VarianteMatrizGenerada[];
}

/**
 * Genera el producto cartesiano `talles × colores × generos`, construye el
 * `sku` determinístico de cada combinación con `generarSku()` y resuelve su
 * `ean_qr`: si `input.ean_por_combinacion` trae una entrada para la key de esa
 * combinación (`claveCombinacionVariante()` — EAN-13 real, cargado por
 * escaneo/tipeo en el preview de la Matriz de Variantes), se usa ese valor;
 * si no, queda `NULL` — `VarianteSKU.ean_qr` es nullable justamente para no
 * inventar un valor cuando el EAN-13 real todavía no se conoce (se completa
 * después, por HU-A2 al primer ingreso a depósito).
 * Inserta todo en lote con `skipDuplicates` para que reintentos no fallen
 * ante SKUs ya existentes (idempotencia).
 *
 * No requiere `StockDeposito` — eso lo crea HU-A2 al primer ingreso.
 *
 * @throws {ServiceError} PRODUCTO_MAESTRO_NO_ENCONTRADO | PRODUCTO_MAESTRO_INACTIVO |
 *                        LIMITE_COMBINACIONES_EXCEDIDO
 */
export async function generarVariantesMatriz(
  input: GenerarVariantesMatrizInput,
  usuarioId: string,
): Promise<ResultadoGenerarVariantesMatriz> {
  const totalCombinaciones = input.talles.length * input.colores.length * input.generos.length;

  if (totalCombinaciones > MAX_COMBINACIONES_POR_INVOCACION) {
    throw new ServiceError(
      "LIMITE_COMBINACIONES_EXCEDIDO",
      `La matriz solicitada genera ${totalCombinaciones} combinaciones, ` +
        `por encima del límite de ${MAX_COMBINACIONES_POR_INVOCACION} por invocación.`,
    );
  }

  // Verifica existencia y is_active ANTES de generar — no confiar únicamente
  // en la FK (spec_modulo_A.md §3.7: la capa de servicios valida explícitamente).
  const productoMaestro = await prisma.productoMaestro.findFirst({
    where: { id: input.producto_maestro_id, is_active: true },
  });

  if (!productoMaestro) {
    throw new ServiceError(
      "PRODUCTO_MAESTRO_NO_ENCONTRADO",
      `No se encontró un Producto Maestro activo con id ${input.producto_maestro_id}.`,
    );
  }

  // Producto cartesiano en memoria — sin acceso a BD por combinación.
  const combinaciones: { talle: string; color: string; genero: Genero }[] = [];
  for (const talle of input.talles) {
    for (const color of input.colores) {
      for (const genero of input.generos) {
        combinaciones.push({ talle, color, genero });
      }
    }
  }

  const variantesAInsertar = combinaciones.map(({ talle, color, genero }) => {
    const sku = generarSku({
      codigoProducto: productoMaestro.codigo_producto,
      modelo: input.modelo,
      talle,
      codigoColor: color,
      genero,
    });
    const eanEscaneado = input.ean_por_combinacion?.[claveCombinacionVariante({ talle, color, genero })];

    return {
      producto_maestro_id: productoMaestro.id,
      sku,
      ean_qr: eanEscaneado ?? null,
      talle: talle.trim().toUpperCase(),
      color: color.trim().toUpperCase(),
      genero,
      modelo: input.modelo.trim().toUpperCase(),
    };
  });

  const resultadoInsercion = await prisma.varianteSKU.createMany({
    data: variantesAInsertar,
    skipDuplicates: true, // idempotencia: SKUs ya existentes se omiten sin fallar la operación completa
  });

  // Se relee lo insertado para devolver ids reales — createMany no retorna las filas creadas.
  const variantesCreadas = await prisma.varianteSKU.findMany({
    where: {
      sku: { in: variantesAInsertar.map((v) => v.sku) },
      is_active: true,
    },
    select: { id: true, sku: true, ean_qr: true },
  });

  domainEventBus.emit("variantes:generadas", {
    producto_maestro_id: productoMaestro.id,
    cantidad_generadas: resultadoInsercion.count,
    usuario_id: usuarioId,
  });

  return {
    variantes_creadas: resultadoInsercion.count,
    variantes_omitidas_duplicadas: variantesAInsertar.length - resultadoInsercion.count,
    variantes: variantesCreadas,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 5.3 — desactivarProductoMaestro
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Baja lógica de un `ProductoMaestro`. `deletion_reason` es obligatorio
 * únicamente cuando el producto tiene stock remanente (`StockDeposito.cantidad
 * > 0`, activo) en cualquiera de sus variantes — un producto sin stock puede
 * darse de baja sin motivo explícito. No toca `VarianteSKU` individuales
 * (baja lógica de variante es HU-A6, fuera de alcance acá).
 *
 * @throws {ServiceError} PRODUCTO_MAESTRO_NO_ENCONTRADO | MOTIVO_REQUERIDO
 */
export async function desactivarProductoMaestro(
  productoMaestroId: string,
  input: DesactivarProductoMaestroInput,
  usuarioId: string,
) {
  const productoMaestro = await prisma.productoMaestro.findFirst({
    where: { id: productoMaestroId, is_active: true },
  });

  if (!productoMaestro) {
    throw new ServiceError(
      "PRODUCTO_MAESTRO_NO_ENCONTRADO",
      `No se encontró un Producto Maestro activo con id ${productoMaestroId}.`,
    );
  }

  const stockRemanente = await prisma.stockDeposito.findFirst({
    where: {
      is_active: true,
      cantidad: { gt: 0 },
      variante_sku: { producto_maestro_id: productoMaestroId, is_active: true },
    },
    select: { id: true },
  });

  if (stockRemanente && !input.deletion_reason) {
    throw new ServiceError(
      "MOTIVO_REQUERIDO",
      "El producto tiene stock remanente en depósito: el motivo de baja es obligatorio.",
    );
  }

  const productoDesactivado = await prisma.productoMaestro.update({
    where: { id: productoMaestroId },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: usuarioId,
      deletion_reason: input.deletion_reason ?? null,
    },
  });

  domainEventBus.emit("producto_maestro:desactivado", {
    producto_maestro_id: productoDesactivado.id,
    deletion_reason: productoDesactivado.deletion_reason,
    usuario_id: usuarioId,
  });

  return productoDesactivado;
}
