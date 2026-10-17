"use server";

/**
 * @module actions — listas de precios de proveedor (HU-H2, Módulo H)
 * @description Server Action equivalente a
 * `POST /api/proveedores/[id]/lista-precios` (`docs/tasks/sdd/HU-H2/spec.md`),
 * para el formulario de publicación de una nueva versión de lista de precios
 * operado por Comprador / Supervisor de Compras.
 *
 * Wrapper fino (mismo patrón que `crearOrdenCompraAction` en
 * `src/app/(dashboard)/compras/ordenes/actions.ts`): resuelve sesión +
 * permiso `proveedores:publicar_lista`, parsea con Zod, invoca la MISMA
 * función de servicio que el Route Handler (T9) y devuelve el shape plano
 * `{ data, error }`. NINGUNA regla de negocio vive acá.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  esErrorItemsDuplicados,
  PublicarListaPreciosSchema,
  PreviewListaPreciosSchema,
  ListaPrecioVersionIdSchema,
} from "@/lib/schemas/lista-precios.schema";
import { ProveedorIdSchema } from "@/lib/schemas/proveedores.schema";
import {
  publicarNuevaVersionListaPrecio,
  previsualizarVariacionListaPrecios,
  aprobarListaPrecioVersion,
  PERMISO_PUBLICAR_LISTA_PRECIO,
  PERMISO_APROBAR_LISTA_PRECIO_CRITICA,
  type PreviewListaPreciosResultado,
} from "@/lib/services/proveedores/lista-precios.service";
import {
  obtenerComparativaPrecios,
  type ComparativaPreciosQuery,
} from "@/lib/services/proveedores/comparativa-precios.service";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(
  code: string,
  message: string,
): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

export interface ListaPrecioPublicada {
  lista_precio_version_id: string;
  publicada: boolean;
  requiere_aprobacion: boolean;
  variacion_porcentual_maxima: number;
}

/**
 * Server Action equivalente a `POST /api/proveedores/[id]/lista-precios`
 * (spec.md — "Endpoint de publicación").
 *
 * `revalidatePath`: se revalida la página de detalle del proveedor
 * (`/compras/proveedores/[id]`) — es donde vive la ficha de un proveedor
 * puntual (`src/app/(dashboard)/compras/proveedores/`) y, por lo tanto,
 * donde razonablemente se muestra su lista de precios vigente. Ni el Design
 * ni las Tasks fijan esta ruta de forma cerrada (decisión técnica menor, no
 * de negocio — ver reporte de T8).
 */
export async function publicarListaPrecios(
  proveedor_id: unknown,
  input: unknown,
): Promise<ActionResult<ListaPrecioPublicada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_PUBLICAR_LISTA_PRECIO))) {
    return fallo(
      "FORBIDDEN",
      `No tenés el permiso "${PERMISO_PUBLICAR_LISTA_PRECIO}"`,
    );
  }

  const parsedId = ProveedorIdSchema.safeParse(proveedor_id);
  if (!parsedId.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsedId.error.issues[0]?.message ?? "ID de proveedor inválido",
    );
  }

  const parsed = PublicarListaPreciosSchema.safeParse(input);
  if (!parsed.success) {
    if (esErrorItemsDuplicados(parsed.error)) {
      return fallo(
        "ITEMS_DUPLICADOS",
        "La lista no puede incluir la misma variante en más de un ítem",
      );
    }
    return fallo(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Datos inválidos",
    );
  }

  try {
    const data = await publicarNuevaVersionListaPrecio(
      parsedId.data,
      parsed.data.fecha_inicio_vigencia,
      parsed.data.items,
      session.userId,
    );
    revalidatePath(`/compras/proveedores/${parsedId.data}`);
    revalidatePath("/compras/listas-precios");
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[publicarListaPrecios] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a `POST /api/proveedores/[id]/lista-precios/preview`
 * — previsualiza la variación porcentual SIN persistir nada ("Calcular
 * variación" del formulario de publicación). Mismo gate que
 * `publicarListaPrecios` (`proveedores:publicar_lista`): quien puede
 * previsualizar es quien puede publicar.
 */
export async function previsualizarListaPreciosAction(
  proveedor_id: unknown,
  input: unknown,
): Promise<ActionResult<PreviewListaPreciosResultado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_PUBLICAR_LISTA_PRECIO))) {
    return fallo(
      "FORBIDDEN",
      `No tenés el permiso "${PERMISO_PUBLICAR_LISTA_PRECIO}"`,
    );
  }

  const parsedId = ProveedorIdSchema.safeParse(proveedor_id);
  if (!parsedId.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsedId.error.issues[0]?.message ?? "ID de proveedor inválido",
    );
  }

  const parsed = PreviewListaPreciosSchema.safeParse(input);
  if (!parsed.success) {
    if (esErrorItemsDuplicados(parsed.error)) {
      return fallo(
        "ITEMS_DUPLICADOS",
        "La lista no puede incluir la misma variante en más de un ítem",
      );
    }
    return fallo(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Datos inválidos",
    );
  }

  try {
    const data = await previsualizarVariacionListaPrecios(parsedId.data, parsed.data.items);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[previsualizarListaPreciosAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

export interface ListaPrecioAprobada {
  lista_precio_version_id: string;
  publicada: boolean;
  aprobada_por_id: string;
  aprobada_at: Date;
}

/**
 * Server Action equivalente a
 * `PATCH /api/proveedores/[id]/lista-precios/[version_id]/aprobar` — no
 * existía ningún wrapper Server Action para este endpoint (solo el Route
 * Handler). Mismo patrón 1:1 que `publicarListaPrecios`: resuelve sesión +
 * permiso EXCLUSIVO `proveedores:publicar_lista_critica`, valida con Zod,
 * invoca la MISMA función de servicio que el Route Handler y devuelve el
 * shape plano `{ data, error }`. `aprobada_por_id` sale SIEMPRE de
 * `session.userId` (spec.md), nunca de un parámetro del formulario.
 */
export async function aprobarListaPrecioVersionAction(
  proveedor_id: unknown,
  version_id: unknown,
): Promise<ActionResult<ListaPrecioAprobada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_APROBAR_LISTA_PRECIO_CRITICA))) {
    return fallo(
      "FORBIDDEN",
      `No tenés el permiso "${PERMISO_APROBAR_LISTA_PRECIO_CRITICA}"`,
    );
  }

  const parsedId = ProveedorIdSchema.safeParse(proveedor_id);
  if (!parsedId.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsedId.error.issues[0]?.message ?? "ID de proveedor inválido",
    );
  }

  const parsedVersionId = ListaPrecioVersionIdSchema.safeParse(version_id);
  if (!parsedVersionId.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsedVersionId.error.issues[0]?.message ?? "ID de versión inválido",
    );
  }

  try {
    const data = await aprobarListaPrecioVersion(
      parsedId.data,
      parsedVersionId.data,
      session.userId,
    );
    revalidatePath("/compras/listas-precios");
    revalidatePath(`/compras/proveedores/${parsedId.data}`);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[aprobarListaPrecioVersionAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/**
 * Server Action equivalente a `GET /api/proveedores/comparativa-precios`
 * (HU-H7) para la sección "Comparativa" de la pantalla de Listas de Precios.
 * `comparativa-precios.service.ts` no expone ninguna constante `PERMISO_*`
 * (a diferencia del resto de los services de este módulo) — el gate real
 * vive como literal `"proveedores:comparar_precios"` en
 * `route.ts` (`GET /api/proveedores/comparativa-precios`); se reusa el mismo
 * literal acá, sin inventar una constante nueva que no existe en el service.
 */
const PERMISO_COMPARAR_PRECIOS = "proveedores:comparar_precios";

export async function compararPreciosAction(
  query: ComparativaPreciosQuery,
): Promise<
  | { data: Awaited<ReturnType<typeof obtenerComparativaPrecios>>; error: null }
  | { data: null; error: { code: string; message: string } }
> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_COMPARAR_PRECIOS))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_COMPARAR_PRECIOS}"`);
  }

  try {
    const data = await obtenerComparativaPrecios(query);
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[compararPreciosAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
