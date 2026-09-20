// HU-H8 — Costo de reposición vigente (spec_modulo_H.md §2.11 /
// propose_HU-H8_FINAL.md §2.1 / §3.2). Tipos (T3) + descubrimiento acotado
// (T4); el resto de las auxiliares privadas y el orquestador público llegan
// en T5-T7.

import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolverListaPrecioVigente } from "@/lib/services/proveedores/lista-precios.service";

export type CriterioSeleccionCostoReposicion =
  | "MENOR_PRECIO_VIGENTE"
  | "PROVEEDOR_PREFERENTE"; // reservado, no emitido en HU-H8 (ver Propose §2.1)

export interface CostoReposicionVigente {
  variante_sku_id: string;
  proveedor_id: string;
  precio_unitario: number;
  fecha_inicio_vigencia: Date;
  criterio_seleccion: CriterioSeleccionCostoReposicion;
}

interface Candidato {
  id: string;
}

interface ItemVigenteCandidato {
  precio_unitario: number;
  fecha_inicio_vigencia: Date;
}

interface CandidatoResuelto {
  proveedorId: string;
  precio_unitario: number;
  fecha_inicio_vigencia: Date;
}

/**
 * Paso C — Descubrimiento acotado de proveedores candidatos para
 * `varianteSkuId`: homologados, activos, con al menos una `ListaPrecioItem`
 * activa para esta variante dentro de una `ListaPrecioVersion` publicada.
 * Filtro completo dentro de una única consulta (evita N+1) — mismo patrón de
 * anidamiento que `resolverCandidatosPorVariante` (HU-H7,
 * comparativa-precios.service.ts), incluyendo `deleted_at: null` en los tres
 * niveles (Proveedor, ListaPrecio, ListaPrecioVersion). No filtra por
 * `ahora`: la vigencia temporal la resuelve `resolverListaPrecioVigente` en
 * el paso D+E.
 */
async function descubrirCandidatosAcotados(
  prisma: PrismaClient,
  varianteSkuId: string,
): Promise<Candidato[]> {
  return prisma.proveedor.findMany({
    where: {
      estado: "HOMOLOGADO",
      is_active: true,
      deleted_at: null,
      listas_precio: {
        some: {
          is_active: true,
          deleted_at: null,
          versiones: {
            some: {
              is_active: true,
              deleted_at: null,
              publicada: true,
              items: {
                some: {
                  variante_sku_id: varianteSkuId,
                  is_active: true,
                },
              },
            },
          },
        },
      },
    },
    select: { id: true },
  });
}

/**
 * Pasos D+E combinados — Resuelve el ítem vigente de `proveedorId` para
 * `varianteSkuId`.
 *
 * Paso D: delega en `resolverListaPrecioVigente` (HU-H2, reutilizada, no
 * reimplementada). Esa función NO acepta un `ahora` inyectado — usa
 * `new Date()` internamente (`lista-precios.service.ts`, helper privado
 * `obtenerVersionVigente`) — por lo tanto el parámetro `ahora` de esta
 * función no se propaga a Paso D; queda documentado como limitación
 * conocida, decisión confirmada con el usuario en el Apply de T5. Sin
 * versión vigente → `null`.
 *
 * Paso E: con la versión vigente, busca el ítem puntual por
 * `lista_precio_version_id` + `variante_sku_id`, con `is_active: true` y
 * `deleted_at: null` (mismo patrón usado por `obtenerVersionVigente` para
 * este mismo modelo). Sin ítem → `null`. `precio_unitario` se convierte de
 * `Prisma.Decimal` a `number` (misma convención de HU-H7).
 */
async function resolverItemVigente(
  prisma: PrismaClient,
  proveedorId: string,
  varianteSkuId: string,
  _ahora: Date,
): Promise<ItemVigenteCandidato | null> {
  const versionVigente = await resolverListaPrecioVigente(proveedorId, varianteSkuId, prisma);
  if (!versionVigente) return null;

  const item = await prisma.listaPrecioItem.findFirst({
    where: {
      lista_precio_version_id: versionVigente.id,
      variante_sku_id: varianteSkuId,
      is_active: true,
      deleted_at: null,
    },
  });
  if (!item) return null;

  return {
    precio_unitario: Number(item.precio_unitario),
    fecha_inicio_vigencia: versionVigente.fecha_inicio_vigencia,
  };
}

/**
 * Paso F — Selecciona el ganador entre los candidatos ya resueltos (Pasos
 * D+E). Función pura, sin acceso a base de datos.
 *
 * Desempate: `precio_unitario` ASC → `fecha_inicio_vigencia` DESC (más
 * reciente primero) → `proveedor_id` ASC (lexicográfico, comparación de
 * strings directa — evita `localeCompare`, cuyo resultado puede variar
 * según el locale/ICU del entorno de ejecución; el Design exige un
 * desempate determinista y los IDs son UUID, donde el orden lexicográfico
 * simple ya es exacto).
 *
 * `CandidatoResuelto` (T3) no incluye `variante_sku_id` — es el mismo valor
 * para todos los candidatos de una llamada (viene fijo desde el
 * orquestador, Paso C ya acotó el descubrimiento a una sola variante), así
 * que no tiene sentido cargarlo en cada candidato individual. Se recibe acá
 * como segundo parámetro en lugar de dejar que T7 lo parchee después del
 * `return`: mantiene `seleccionarGanador` como la única función que arma el
 * objeto `CostoReposicionVigente` completo (evita duplicar el shape del
 * tipo de salida en dos lugares distintos del servicio).
 */
function seleccionarGanador(
  resueltos: CandidatoResuelto[],
  varianteSkuId: string,
): CostoReposicionVigente | null {
  if (resueltos.length === 0) return null;

  const [ganador] = [...resueltos].sort((a, b) => {
    if (a.precio_unitario !== b.precio_unitario) {
      return a.precio_unitario - b.precio_unitario;
    }

    const diffFecha = b.fecha_inicio_vigencia.getTime() - a.fecha_inicio_vigencia.getTime();
    if (diffFecha !== 0) return diffFecha;

    if (a.proveedorId < b.proveedorId) return -1;
    if (a.proveedorId > b.proveedorId) return 1;
    return 0;
  });

  return {
    variante_sku_id: varianteSkuId,
    proveedor_id: ganador.proveedorId,
    precio_unitario: ganador.precio_unitario,
    fecha_inicio_vigencia: ganador.fecha_inicio_vigencia,
    criterio_seleccion: "MENOR_PRECIO_VIGENTE",
  };
}

/**
 * Orquestador público (Design §2.1, Spec §3.2). Resuelve defaults
 * (`prisma` singleton real del proyecto, `ahora = new Date()`), ejecuta
 * Paso C → Pasos D+E **en paralelo** vía `Promise.all` (Design §2.4, no
 * secuencial) → Paso F. Nunca lanza por causa de negocio: `null` es la
 * única señal de "sin costo vigente". Una excepción real (fallo de DB) se
 * propaga tal cual — el try/catch que la traduce a 500 vive en el Route
 * Handler (T9), no acá.
 */
export async function obtenerCostoReposicionVigente(
  varianteSkuId: string,
  options?: { prisma?: PrismaClient; ahora?: Date },
): Promise<CostoReposicionVigente | null> {
  const db = options?.prisma ?? prisma;
  const ahora = options?.ahora ?? new Date();

  const candidatos = await descubrirCandidatosAcotados(db, varianteSkuId);
  if (candidatos.length === 0) return null;

  const itemsVigentes = await Promise.all(
    candidatos.map((candidato) => resolverItemVigente(db, candidato.id, varianteSkuId, ahora)),
  );

  const resueltos: CandidatoResuelto[] = candidatos
    .map((candidato, i) => {
      const item = itemsVigentes[i];
      if (!item) return null;
      return {
        proveedorId: candidato.id,
        precio_unitario: item.precio_unitario,
        fecha_inicio_vigencia: item.fecha_inicio_vigencia,
      };
    })
    .filter((resuelto): resuelto is CandidatoResuelto => resuelto !== null);

  return seleccionarGanador(resueltos, varianteSkuId);
}
