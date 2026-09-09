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

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import { generarSku, claveCombinacionVariante, type Genero } from "@/lib/utils/sku";
import type {
  CrearProductoMaestroInput,
  GenerarVariantesMatrizInput,
  DesactivarProductoMaestroInput,
  EditarProductoMaestroInput,
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
      // Ajuste post-HU-A1: "Unidad de medida" salió del formulario de alta
      // (decisión de negocio) — la columna sigue NOT NULL en la base, así
      // que un caller que no la manda (el formulario) recibe este default.
      // Un consumidor directo del API que sí la mande explícita conserva ese valor.
      unidad_medida: input.unidad_medida?.trim() || "UNIDAD",
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
// Autocompletado de Rubro/Categoría — obtenerRubrosYCategoriasDistintos
// ──────────────────────────────────────────────────────────────────────────────

export interface RubrosYCategoriasDistintos {
  rubros: string[];
  categorias: string[];
}

/**
 * `distinct` de Prisma/Postgres compara por igualdad exacta de bytes —
 * "Indumentaria" e "indumentaria" cuentan como valores distintos ahí. La
 * deduplicación real (case-insensitive, con trim) pasa acá, en memoria:
 * conserva la primera variante de casing que aparece para cada clave
 * normalizada — simple y determinístico dado el `orderBy` de la consulta,
 * no hace falta elegir "la más usada" para que sea consistente.
 */
function deduplicarCaseInsensitive(valores: string[]): string[] {
  const vistos = new Map<string, string>();
  for (const valor of valores) {
    const trimmed = valor.trim();
    const clave = trimmed.toLowerCase();
    if (!vistos.has(clave)) vistos.set(clave, trimmed);
  }
  return Array.from(vistos.values());
}

/**
 * Valores distintos de `rubro` y `categoria` entre productos activos, para
 * alimentar el autocompletado del formulario de alta — sugerencias, no una
 * lista cerrada: el usuario sigue pudiendo tipear un valor nuevo. Selects
 * `distinct` separados por columna en vez de reutilizar
 * `listarProductosActivosParaListado()` — ese trae la fila completa
 * (id/codigo/nombre/rubro) pensada para la tabla del listado; acá alcanza
 * con dos columnas.
 */
export async function obtenerRubrosYCategoriasDistintos(): Promise<RubrosYCategoriasDistintos> {
  const [rubros, categorias] = await Promise.all([
    prisma.productoMaestro.findMany({
      where: { is_active: true },
      select: { rubro: true },
      distinct: ["rubro"],
      orderBy: { rubro: "asc" },
    }),
    prisma.productoMaestro.findMany({
      where: { is_active: true },
      select: { categoria: true },
      distinct: ["categoria"],
      orderBy: { categoria: "asc" },
    }),
  ]);

  return {
    rubros: deduplicarCaseInsensitive(rubros.map((r) => r.rubro)),
    categorias: deduplicarCaseInsensitive(categorias.map((c) => c.categoria)),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Listado de Productos Maestro — listarProductosActivosParaListado
// ──────────────────────────────────────────────────────────────────────────────

export interface ProductoMaestroListado {
  id: string;
  codigo_producto: string;
  nombre: string;
  rubro: string;
}

/**
 * Listado completo de `ProductoMaestro` activos para la pantalla
 * `/inventario/productos` (Cod Producto / Nombre / Rubro). Distinta de
 * `buscarProductosActivos()`: esa función tiene `take: 10` y busca por
 * nombre/código pensada para un combobox de búsqueda — acá no hay límite de
 * resultados ni filtro server-side, porque el filtrado (solo por nombre) se
 * hace en el cliente sobre la lista completa ya cargada.
 */
export async function listarProductosActivosParaListado(): Promise<ProductoMaestroListado[]> {
  return prisma.productoMaestro.findMany({
    where: { is_active: true },
    select: { id: true, codigo_producto: true, nombre: true, rubro: true },
    orderBy: { nombre: "asc" },
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
 * `proveedor_id` de cada variante se resuelve desde
 * `input.proveedor_por_combinacion` (obligatorio y completo — lo garantiza el
 * `.refine()` del schema) con la misma `claveCombinacionVariante()`. Antes del
 * `createMany` se valida explícitamente que cada proveedor referenciado exista,
 * esté activo y sea `HOMOLOGADO` (spec_modulo_A.md §3.7 — la capa de servicios
 * valida, no se delega solo en la FK), para no dejar caer la constraint a un 500.
 *
 * @throws {ServiceError} PRODUCTO_MAESTRO_NO_ENCONTRADO | PRODUCTO_MAESTRO_INACTIVO |
 *                        LIMITE_COMBINACIONES_EXCEDIDO | PROVEEDOR_NO_ENCONTRADO |
 *                        PROVEEDOR_NO_HOMOLOGADO
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

  // Validación explícita del proveedor habitual de cada combinación (spec §3.7):
  // debe existir, estar activo y ser HOMOLOGADO. Se chequean solo los ids que
  // efectivamente se van a usar (una consulta, no una por fila).
  const proveedorIdPorClave = new Map(
    combinaciones.map(({ talle, color, genero }) => {
      const clave = claveCombinacionVariante({ talle, color, genero });
      return [clave, input.proveedor_por_combinacion[clave]] as const;
    }),
  );
  const proveedorIdsRequeridos = [...new Set(proveedorIdPorClave.values())];
  const proveedores = await prisma.proveedor.findMany({
    where: { id: { in: proveedorIdsRequeridos } },
    select: { id: true, is_active: true, estado: true },
  });
  const proveedorPorId = new Map(proveedores.map((p) => [p.id, p]));

  for (const proveedorId of proveedorIdsRequeridos) {
    const proveedor = proveedorPorId.get(proveedorId);
    if (!proveedor || !proveedor.is_active) {
      throw new ServiceError(
        "PROVEEDOR_NO_ENCONTRADO",
        `No se encontró un Proveedor activo con id ${proveedorId}.`,
      );
    }
    if (proveedor.estado !== "HOMOLOGADO") {
      throw new ServiceError(
        "PROVEEDOR_NO_HOMOLOGADO",
        `El proveedor ${proveedorId} no está HOMOLOGADO — solo un proveedor homologado puede ser proveedor habitual de una variante.`,
      );
    }
  }

  const variantesAInsertar = combinaciones.map(({ talle, color, genero }) => {
    const clave = claveCombinacionVariante({ talle, color, genero });
    const sku = generarSku({
      codigoProducto: productoMaestro.codigo_producto,
      modelo: input.modelo,
      talle,
      codigoColor: color,
      genero,
    });
    const eanEscaneado = input.ean_por_combinacion?.[clave];

    return {
      producto_maestro_id: productoMaestro.id,
      proveedor_id: input.proveedor_por_combinacion[clave],
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

// ──────────────────────────────────────────────────────────────────────────────
// HU-A8 — editarProductoMaestro
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @throws {ServiceError} PRODUCTO_MAESTRO_NO_ENCONTRADO | PRODUCTO_MAESTRO_NOMBRE_DUPLICADO
 */
export async function editarProductoMaestro(
  productoMaestroId: string,
  input: EditarProductoMaestroInput,
  usuarioId: string,
) {
  const actual = await prisma.productoMaestro.findFirst({
    where: { id: productoMaestroId, is_active: true },
  });
  if (!actual) {
    throw new ServiceError("PRODUCTO_MAESTRO_NO_ENCONTRADO", `No se encontró un Producto Maestro activo con id ${productoMaestroId}.`);
  }

  const camposModificados = Object.keys(input) as (keyof EditarProductoMaestroInput)[];
  if (camposModificados.length === 0) {
    return { id: actual.id, campos_modificados: [], updated_at: actual.updated_at };
  }

  if (input.nombre !== undefined) {
    const nombreTrimmed = input.nombre.trim();
    if (nombreTrimmed.toLowerCase() !== actual.nombre.toLowerCase()) {
      const duplicado = await prisma.productoMaestro.findFirst({
        where: {
          id: { not: productoMaestroId },
          is_active: true,
          nombre: { equals: nombreTrimmed, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (duplicado) {
        throw new ServiceError("PRODUCTO_MAESTRO_NOMBRE_DUPLICADO", `Ya existe un Producto Maestro activo con el nombre "${nombreTrimmed}".`);
      }
    }
  }

  const valorAnterior: Record<string, unknown> = {};
  const valorNuevo: Record<string, unknown> = {};
  for (const campo of camposModificados) {
    valorAnterior[campo] = actual[campo as keyof typeof actual];
    valorNuevo[campo] = input[campo];
  }

  const actualizado = await prisma.productoMaestro.update({
    where: { id: productoMaestroId },
    data: input,
  });

  domainEventBus.emit("producto_maestro:actualizado", {
    producto_maestro_id: actualizado.id,
    usuario_id: usuarioId,
    campos_modificados: camposModificados,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo,
  });

  return { id: actualizado.id, campos_modificados: camposModificados, updated_at: actualizado.updated_at };
}

/** Roles autorizados para editar atributos operativos del catálogo (spec_modulo_A.md §2.7 / Alcance §5 RBAC). */
const ROLES_AUTORIZADOS_EDITAR_CATALOGO = ["ADMINISTRADOR", "ENCARGADO_DEPOSITO"] as const;

export async function usuarioPuedeEditarProductoMaestro(usuarioId: string): Promise<boolean> {
  const match = await prisma.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId,
      is_active: true,
      rol: { is_active: true, nombre: { in: [...ROLES_AUTORIZADOS_EDITAR_CATALOGO] } },
    },
    select: { id: true },
  });
  return match !== null;
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-A8 — obtenerProductoMaestroParaEdicion
// ──────────────────────────────────────────────────────────────────────────────

export interface ProductoMaestroParaEdicion {
  id: string;
  codigo_producto: string;
  nombre: string;
  descripcion: string | null;
  categoria: string;
  rubro: string;
  unidad_medida: string;
  proveedor_preferente: string | null;
  costo_estandar_referencia: Prisma.Decimal;
}

/**
 * Trae un `ProductoMaestro` activo por id, con los campos editables de
 * `EditarProductoMaestroSchema` más `id`/`codigo_producto` para contexto de
 * display en el formulario. Distinta de `buscarProductosActivos()`: esa es
 * búsqueda por texto con `select` mínimo (`take: 10`); esta es "uno por id,
 * con todos los campos editables".
 *
 * @throws {ServiceError} PRODUCTO_MAESTRO_NO_ENCONTRADO
 */
export async function obtenerProductoMaestroParaEdicion(
  id: string,
): Promise<ProductoMaestroParaEdicion> {
  const producto = await prisma.productoMaestro.findFirst({
    where: { id, is_active: true },
    select: {
      id: true,
      codigo_producto: true,
      nombre: true,
      descripcion: true,
      categoria: true,
      rubro: true,
      unidad_medida: true,
      proveedor_preferente: true,
      costo_estandar_referencia: true,
    },
  });

  if (!producto) {
    throw new ServiceError("PRODUCTO_MAESTRO_NO_ENCONTRADO", `No se encontró un Producto Maestro activo con id ${id}.`);
  }

  return producto;
}
