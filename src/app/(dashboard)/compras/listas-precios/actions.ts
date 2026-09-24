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
} from "@/lib/schemas/lista-precios.schema";
import { ProveedorIdSchema } from "@/lib/schemas/proveedores.schema";
import {
  publicarNuevaVersionListaPrecio,
  PERMISO_PUBLICAR_LISTA_PRECIO,
} from "@/lib/services/proveedores/lista-precios.service";

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
    return { data, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[publicarListaPrecios] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
