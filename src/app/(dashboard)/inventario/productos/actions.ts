"use server";

/**
 * @module actions — productos (HU-A1)
 * @description Server Actions equivalentes a los Route Handlers REST de
 * `app/api/inventario/productos/` — alta de Producto Maestro y generación en
 * lote de Variantes SKU (task_relos.md sección 6). Se invocan directamente
 * desde Client Components sin pasar por un fetch manual.
 *
 * A diferencia de los Route Handlers (que devuelven `NextResponse`), las
 * Server Actions retornan un objeto plano `{ data, error }` — mismo shape
 * que `app/(dashboard)/inventario/depositos/actions.ts`.
 *
 * Deliberadamente SIN `revalidatePath()`: esta página no lista nada
 * server-fetched que necesite invalidarse (Paso 4/8 — "no requiere fetch
 * inicial, es pantalla de creación"). Se probó agregarlo y causaba un bug
 * real: el refresh de router que dispara `revalidatePath` sobre la MISMA
 * ruta remonta `FormularioProductoMaestro`/`MatrizVariantes` desde su HTML
 * SSR (formulario en blanco), destruyendo el estado local que decide qué
 * paso del flujo mostrar — el usuario perdía la matriz recién generada.
 */
import { getServerSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";
import {
  CrearProductoMaestroSchema,
  GenerarVariantesMatrizSchema,
  EditarProductoMaestroSchema,
  type EditarProductoMaestroInput,
} from "@/lib/schemas/inventario.schema";
import {
  crearProductoMaestro as crearProductoMaestroService,
  generarVariantesMatriz as generarVariantesMatrizService,
  buscarProductosActivos as buscarProductosActivosService,
  obtenerRubrosYCategoriasDistintos as obtenerRubrosYCategoriasDistintosService,
  editarProductoMaestro as editarProductoMaestroService,
  usuarioPuedeEditarProductoMaestro,
  obtenerProductoMaestroParaEdicion as obtenerProductoMaestroParaEdicionService,
  type ResultadoGenerarVariantesMatriz,
  type RubrosYCategoriasDistintos,
} from "@/lib/services/inventario/producto.service";
import {
  listarProveedoresHomologados as listarProveedoresHomologadosService,
  type ProveedorParaSelector,
} from "@/lib/services/proveedores/orden-compra.service";

type ActionError = { code: string; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Shape serializable del `ProductoMaestro` creado. A diferencia del Route
 * Handler (que serializa vía `NextResponse.json`/`JSON.stringify`, donde el
 * `Decimal` de Prisma se auto-convierte por su `toJSON()`), las Server
 * Actions cruzan el límite cliente/servidor por serialización RSC, que NO
 * soporta instancias de clase como `Decimal` — de ahí la conversión
 * explícita a `number` acá.
 */
export interface ProductoMaestroCreado {
  id: string;
  codigo_producto: string;
  nombre: string;
  descripcion: string | null;
  rubro: string;
  categoria: string;
  unidad_medida: string;
  proveedor_preferente: string | null;
  costo_estandar_referencia: number;
}

type CrearProductoMaestroResult =
  | { data: ProductoMaestroCreado; error: null }
  | { data: null; error: ActionError };

type GenerarVariantesMatrizResult =
  | { data: ResultadoGenerarVariantesMatriz; error: null }
  | { data: null; error: ActionError };

/** Shape serializable mínima de un `ProductoMaestro` activo devuelto por el buscador. */
export interface ProductoMaestroActivoResumen {
  id: string;
  nombre: string;
  codigo_producto: string;
}

type BuscarProductosActivosResult =
  | { data: ProductoMaestroActivoResumen[]; error: null }
  | { data: null; error: ActionError };

/**
 * Server Action de lectura liviana — mejora post-HU-A1: permite buscar un
 * `ProductoMaestro` activo existente para saltar directo al Paso 2 (matriz
 * de variantes) sin repetir el alta de Paso 1. Solo `is_active: true`, ver
 * docstring de `buscarProductosActivos()` en `producto.service.ts`.
 */
export async function buscarProductosActivos(query: string): Promise<BuscarProductosActivosResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const productos = await buscarProductosActivosService(query);
    return { data: productos, error: null };
  } catch (err) {
    console.error("[buscarProductosActivos action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

type ObtenerRubrosYCategoriasResult =
  | { data: RubrosYCategoriasDistintos; error: null }
  | { data: null; error: ActionError };

/**
 * Server Action de lectura liviana — alimenta el autocompletado de Rubro y
 * Categoría en el formulario de alta (son sugerencias, no una lista
 * cerrada). Ver docstring de `obtenerRubrosYCategoriasDistintos()` en
 * `producto.service.ts`.
 */
export async function obtenerRubrosYCategorias(): Promise<ObtenerRubrosYCategoriasResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const resultado = await obtenerRubrosYCategoriasDistintosService();
    return { data: resultado, error: null };
  } catch (err) {
    console.error("[obtenerRubrosYCategorias action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

type ListarProveedoresParaSelectorResult =
  | { data: ProveedorParaSelector[]; error: null }
  | { data: null; error: ActionError };

/**
 * Server Action de lectura liviana — lista de proveedores HOMOLOGADO para el
 * `<select>` de "proveedor habitual" por fila en la Matriz de Variantes y para
 * el `ComboboxFiltrable` de la edición de variante (HU-A8). Reutiliza
 * `listarProveedoresHomologados()` de Módulo H (misma query: `estado =
 * HOMOLOGADO`, `is_active = true`, `deleted_at = null`) para no duplicar la
 * consulta — decisión de la task, es solo lectura sin lógica de Compras.
 * Solo requiere sesión, sin permiso granular (mismo criterio que
 * `buscarProductosActivos()`).
 */
export async function listarProveedoresParaSelector(): Promise<ListarProveedoresParaSelectorResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const proveedores = await listarProveedoresHomologadosService();
    return { data: proveedores, error: null };
  } catch (err) {
    console.error("[listarProveedoresParaSelector action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

/** Server Action equivalente a `POST /api/inventario/productos`. */
export async function crearProductoMaestro(formData: unknown): Promise<CrearProductoMaestroResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const parsed = CrearProductoMaestroSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  try {
    const producto = await crearProductoMaestroService(parsed.data, session.userId);
    return {
      data: {
        id: producto.id,
        codigo_producto: producto.codigo_producto,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        rubro: producto.rubro,
        categoria: producto.categoria,
        unidad_medida: producto.unidad_medida,
        proveedor_preferente: producto.proveedor_preferente,
        costo_estandar_referencia: producto.costo_estandar_referencia.toNumber(),
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { data: null, error: { code: err.code, message: err.message } };
    }

    console.error("[crearProductoMaestro action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

/**
 * Server Action equivalente a `POST /api/inventario/productos/[id]/variantes/generar`.
 * `productoMaestroId` se pasa explícito (no viaja dentro de `formData`) —
 * mismo criterio que la ruta REST: el recurso sobre el que se opera lo fija
 * el llamador, no el payload.
 */
export async function generarVariantesMatriz(
  productoMaestroId: string,
  formData: unknown,
): Promise<GenerarVariantesMatrizResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const parsed = GenerarVariantesMatrizSchema.safeParse({
    ...(typeof formData === "object" && formData !== null ? formData : {}),
    producto_maestro_id: productoMaestroId,
  });

  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  try {
    const resultado = await generarVariantesMatrizService(parsed.data, session.userId);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { data: null, error: { code: err.code, message: err.message } };
    }

    console.error("[generarVariantesMatriz action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

type EditarProductoMaestroResult =
  | { data: Awaited<ReturnType<typeof editarProductoMaestroService>>; error: null }
  | { data: null; error: ActionError };

/**
 * HU-A8 — Server Action equivalente a `PATCH /api/inventario/productos/[id]/editar`.
 *
 * EXCEPCIÓN deliberada al patrón del resto de este archivo: a diferencia de
 * `crearProductoMaestro()`/`generarVariantesMatriz()` (que solo exigen sesión
 * válida), esta función agrega el mismo chequeo de rol
 * (`usuarioPuedeEditarProductoMaestro()`) que ya protege su Route Handler
 * equivalente. Es una mutación privilegiada nueva (HU-A8, no existía en
 * HU-A1) — omitir el chequeo acá dejaría un segundo camino sin protección
 * hacia `editarProductoMaestro()` del service. No se toca el criterio de las
 * funciones vecinas de este archivo.
 */
export async function editarProductoMaestro(
  id: string,
  input: EditarProductoMaestroInput,
): Promise<EditarProductoMaestroResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const autorizado = await usuarioPuedeEditarProductoMaestro(session.userId);
  if (!autorizado) {
    return {
      data: null,
      error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para editar el catálogo" },
    };
  }

  const parsed = EditarProductoMaestroSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  try {
    const producto = await editarProductoMaestroService(id, parsed.data, session.userId);
    return { data: producto, error: null };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { data: null, error: { code: err.code, message: err.message } };
    }

    console.error("[editarProductoMaestro action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

type ObtenerProductoMaestroParaEdicionResult =
  | { data: ProductoMaestroCreado; error: null }
  | { data: null; error: ActionError };

/**
 * HU-A8 — trae un `ProductoMaestro` activo por id para precargar el
 * formulario de edición. Reutiliza el shape `ProductoMaestroCreado` (mismos
 * campos exactos) en vez de declarar una interfaz nueva — el `Decimal` de
 * Prisma se convierte a `number` acá, mismo criterio que `crearProductoMaestro()`
 * (límite de serialización RSC, ver docstring de `ProductoMaestroCreado`).
 */
export async function obtenerProductoMaestroParaEdicion(
  id: string,
): Promise<ObtenerProductoMaestroParaEdicionResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const producto = await obtenerProductoMaestroParaEdicionService(id);
    return {
      data: {
        id: producto.id,
        codigo_producto: producto.codigo_producto,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        rubro: producto.rubro,
        categoria: producto.categoria,
        unidad_medida: producto.unidad_medida,
        proveedor_preferente: producto.proveedor_preferente,
        costo_estandar_referencia: producto.costo_estandar_referencia.toNumber(),
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { data: null, error: { code: err.code, message: err.message } };
    }

    console.error("[obtenerProductoMaestroParaEdicion action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}
