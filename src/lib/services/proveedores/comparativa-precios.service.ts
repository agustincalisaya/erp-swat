import "server-only";

/**
 * @module comparativa-precios.service
 * @description Capa de dominio de HU-H7 — Vista comparativa de precios entre
 * proveedores (`docs/specs/spec_modulo_H.md` §2.10,
 * `docs/tasks/sdd/HU-H7/spec_HU-H7_FINAL.md`, `design_HU-H7_FINAL.md`).
 *
 * Bloque T1-T5 (Apply): solo imports y tipos de apoyo — SIN lógica de negocio
 * todavía. Las auxiliares privadas (T6-T11) y el orquestador público
 * `obtenerComparativaPrecios` (T12) se implementan en los próximos bloques.
 *
 * Reglas transversales ya cerradas (no reinterpretar):
 *  - El filtro por `categoria` se resuelve exclusivamente por
 *    `ProductoMaestro.categoria` (vía `VarianteSKU.producto_maestro_id`),
 *    NUNCA cruzando contra `Proveedor.categorias` (spec_modulo_H.md §2.10,
 *    nota de corrección).
 *  - `puntaje_total` y `tiempo_entrega_promedio_dias` ausentes → `null`,
 *    NUNCA `0` (Design §2.2, Spec paso 3.3/3.4).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolverListaPrecioVigente } from "@/lib/services/proveedores/lista-precios.service";
import { differenceInCalendarDays } from "date-fns";
import { ServiceError } from "@/lib/errors/service-error";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de apoyo (Design §2, bloque de tipos) — internos al servicio, no
// exportados salvo el resultado público. `precio_unitario` usa `Prisma.Decimal`
// (no el `Decimal` bare del Design) para coincidir con la convención real del
// proyecto — ver `Prisma.Decimal` en orden-compra.service.ts / cuenta-por-pagar.service.ts.
// ──────────────────────────────────────────────────────────────────────────────

type CandidatoConItem = {
  proveedor_id: string;
  razon_social: string;
  precio_unitario: Prisma.Decimal; // Decimal en dominio; se serializa en el route
  fecha_inicio_vigencia: Date;
};

type ComparativaItem = {
  proveedor_id: string;
  razon_social: string;
  precio_unitario: number;
  fecha_inicio_vigencia: string; // ISO
  puntaje_total: number | null;
  tiempo_entrega_promedio_dias: number | null;
};

type ComparativaPreciosResult = {
  variante_sku_id: string | null;
  categoria: string | null;
  proveedores: ComparativaItem[];
};

/**
 * Input ya parseado del orquestador público (T12). Declarado ACÁ, no
 * importado desde `route.ts`: el Design (§3, "Orden de dependencia de
 * creación") fija que el servicio se crea primero y no depende del route, y
 * que "el servicio nunca importa el schema" — ni siquiera solo el tipo
 * inferido, para no invertir esa dirección de dependencia. `route.ts` (T13)
 * declara `ComparativaPreciosQuerySchema` con Zod y pasa `parsed.data`, que
 * satisface esta forma por tipado estructural — sin ningún import cruzado
 * entre los dos archivos.
 */
export type ComparativaPreciosQuery = {
  variante_sku_id?: string;
  categoria?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Auxiliares privadas (Design §2.2, T6) — no exportadas.
//
// Firma real de `resolverCandidatosPorVariante` — CORREGIDA respecto de la
// redacción original de Design/Tasks (`(proveedor_id, variantesSkuIds)`):
// esa firma contradecía el contrato HTTP real (`ComparativaPreciosQuerySchema`
// solo expone `variante_sku_id` único opcional, nunca un array ni un
// `proveedor_id`) y el propio paso 3.1 de la Spec, donde los `proveedor_id`
// candidatos se DESCUBREN consultando `ListaPrecioItem` por la variante, no
// se reciben como parámetro. Confirmado explícitamente por el usuario en esta
// sesión — el Design/Tasks se corrigen aparte, este archivo ya usa la firma
// real: `resolverCandidatosPorVariante(varianteSkuId: string)`.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Rama `variante_sku_id` de `obtenerComparativaPrecios` (Spec §2.10 paso 3.1
 * / 3.2 · Design §2.2). Descubre los `Proveedor` HOMOLOGADOS que tengan al
 * menos un `ListaPrecioItem` (en cualquier versión) para esa variante,
 * resuelve la versión vigente de cada uno vía `resolverListaPrecioVigente`
 * (HU-H2) y arma el candidato con el ítem vigente de esa variante.
 *
 * Guarda defensiva (Design §2.2, "Guarda defensiva ante duplicados"):
 * `ListaPrecioItem` no tiene `@@unique([lista_precio_version_id,
 * variante_sku_id])` en `schema.prisma`, así que más de un ítem activo para
 * la misma variante dentro de la misma versión vigente es corrupción de
 * datos (bug de HU-H2 o inserción manual), nunca un caso de negocio. Se
 * lanza `ServiceError` fail-fast — SIN aplicar el desempate por menor precio
 * que sí usa `resolverCandidatosPorCategoria` (T7): ese desempate solo tiene
 * sentido cuando el proveedor tiene ítems en variantes distintas dentro de
 * una misma categoría, nunca para dos ítems de la MISMA variante-versión.
 *
 * Convención de error: `ServiceError` directo con `code:
 * "DUPLICADO_LISTA_PRECIO_ITEM"` — el proyecto no tiene ninguna subclase de
 * error de dominio (confirmado contra todo `src/lib/services/**`); crear una
 * clase nueva solo para este caso rompería esa convención sin necesidad,
 * dado que el catch de T14 puede distinguir el caso por `error.code` igual
 * que distingue cualquier otro código de `ServiceError` en el resto del
 * proyecto.
 */
async function resolverCandidatosPorVariante(
  varianteSkuId: string,
): Promise<CandidatoConItem[]> {
  const proveedoresConItem = await prisma.proveedor.findMany({
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
              items: {
                some: {
                  variante_sku_id: varianteSkuId,
                  is_active: true,
                  deleted_at: null,
                },
              },
            },
          },
        },
      },
    },
    select: { id: true, razon_social: true },
  });

  const candidatos = await Promise.all(
    proveedoresConItem.map(async (proveedor): Promise<CandidatoConItem | null> => {
      const versionVigente = await resolverListaPrecioVigente(proveedor.id, varianteSkuId);
      if (!versionVigente) return null; // sin versión vigente con esta variante → no es candidato

      const itemsVigentes = await prisma.listaPrecioItem.findMany({
        where: {
          lista_precio_version_id: versionVigente.id,
          variante_sku_id: varianteSkuId,
          is_active: true,
          deleted_at: null,
        },
      });

      if (itemsVigentes.length > 1) {
        throw new ServiceError(
          "DUPLICADO_LISTA_PRECIO_ITEM",
          `Corrupción de datos: la ListaPrecioVersion ${versionVigente.id} tiene ${itemsVigentes.length} ListaPrecioItem activos para la variante ${varianteSkuId} — se esperaba a lo sumo uno.`,
        );
      }

      const item = itemsVigentes[0];
      if (!item) return null; // defensivo: resolverListaPrecioVigente ya confirmó existencia

      return {
        proveedor_id: proveedor.id,
        razon_social: proveedor.razon_social,
        precio_unitario: item.precio_unitario,
        fecha_inicio_vigencia: versionVigente.fecha_inicio_vigencia,
      };
    }),
  );

  return candidatos.filter((c): c is CandidatoConItem => c !== null);
}

/**
 * Rama `categoria` de `obtenerComparativaPrecios` (Spec §2.10 paso 3.1 rama
 * categoría / 3.2.1 desempate · Design §2.2). Descubre los `Proveedor`
 * HOMOLOGADOS que tengan al menos un `ListaPrecioItem` (en cualquier
 * versión) cuya `VarianteSKU` pertenezca a un `ProductoMaestro` con esa
 * `categoria`, resuelve la versión vigente de cada uno vía
 * `resolverListaPrecioVigente` **sin variante** (misma función que T6, otro
 * modo de uso) y, dentro de esa versión, se queda con el ítem de la
 * categoría de **menor `precio_unitario`**.
 *
 * Filtro exclusivo por `ProductoMaestro.categoria` (cadena
 * `ListaPrecioItem.variante_sku_id → VarianteSKU.producto_maestro_id →
 * ProductoMaestro.categoria`, campo/relación confirmados contra
 * `schema.prisma`) — NUNCA se consulta ni se filtra por `Proveedor.categorias`
 * (spec_modulo_H.md §2.10, nota de corrección: ese campo no sincroniza con
 * las categorías reales de producto y produce falsos negativos confirmados
 * contra el propio seed).
 *
 * Desempate intra-proveedor (paso 3.2.1) — a diferencia de la guarda
 * fail-fast de `resolverCandidatosPorVariante` (T6): acá **si** hay N≥2
 * ítems vigentes del mismo proveedor en la misma categoría es un caso de
 * negocio legítimo (dos productos distintos del mismo rubro), no corrupción
 * de datos — un proveedor puede vender más de un insumo de la misma
 * categoría. Se resuelve con `orderBy: { precio_unitario: "asc" }, take: 1`
 * directo en la consulta (evita traer todos los ítems para ordenar en JS).
 * Sin campo `criterio_seleccion` — ese campo es exclusivo de HU-H8, no de
 * esta HU (Spec §2.10, restricciones duras).
 */
async function resolverCandidatosPorCategoria(categoria: string): Promise<CandidatoConItem[]> {
  const filtroVarianteEnCategoria = {
    is_active: true,
    deleted_at: null,
    producto_maestro: {
      categoria,
      is_active: true,
      deleted_at: null,
    },
  } satisfies Prisma.VarianteSKUWhereInput;

  const proveedoresConItem = await prisma.proveedor.findMany({
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
              items: {
                some: {
                  is_active: true,
                  deleted_at: null,
                  variante_sku: filtroVarianteEnCategoria,
                },
              },
            },
          },
        },
      },
    },
    select: { id: true, razon_social: true },
  });

  const candidatos = await Promise.all(
    proveedoresConItem.map(async (proveedor): Promise<CandidatoConItem | null> => {
      const versionVigente = await resolverListaPrecioVigente(proveedor.id);
      if (!versionVigente) return null; // sin versión vigente publicada → no es candidato

      // Desempate 3.2.1 resuelto en la propia query: el primer resultado ya
      // es el de menor precio_unitario entre los ítems vigentes de esta
      // categoría para este proveedor.
      const [itemMenorPrecio] = await prisma.listaPrecioItem.findMany({
        where: {
          lista_precio_version_id: versionVigente.id,
          is_active: true,
          deleted_at: null,
          variante_sku: filtroVarianteEnCategoria,
        },
        orderBy: { precio_unitario: "asc" },
        take: 1,
      });

      if (!itemMenorPrecio) return null; // versión vigente sin ítems de esta categoría

      return {
        proveedor_id: proveedor.id,
        razon_social: proveedor.razon_social,
        precio_unitario: itemMenorPrecio.precio_unitario,
        fecha_inicio_vigencia: versionVigente.fecha_inicio_vigencia,
      };
    }),
  );

  return candidatos.filter((c): c is CandidatoConItem => c !== null);
}

/**
 * Puntaje de evaluación más reciente de un proveedor (Spec §2.10 paso 3.4 ·
 * Design §2.2). Mismo precedente exacto que `registrarEvaluacion()` en
 * `evaluacion.service.ts` (HU-H5): `EvaluacionProveedor.puntaje_total` es
 * `Decimal` en el schema (`@db.Decimal(5, 2)`), así que se convierte con
 * `Number(...)` — la misma conversión que ya usa ese servicio
 * (`evaluacion.service.ts:91`), nunca `.toNumber()`.
 *
 * Sin evaluación previa → `null`, NUNCA `0` (restricción dura de la Spec: un
 * proveedor sin evaluar no es lo mismo que un proveedor con puntaje cero).
 */
async function obtenerPuntajeTotal(proveedorId: string): Promise<number | null> {
  const evaluacion = await prisma.evaluacionProveedor.findFirst({
    where: {
      proveedor_id: proveedorId,
      is_active: true,
      deleted_at: null,
    },
    orderBy: { fecha_evaluacion: "desc" },
    take: 1,
    select: { puntaje_total: true },
  });

  return evaluacion ? Number(evaluacion.puntaje_total) : null;
}

/**
 * Tiempo de entrega promedio de un proveedor — Opción B (Spec §2.10,
 * "Definición determinística de tiempo de entrega comprometido histórico" ·
 * Design §2.2). Universo: `OrdenCompra` del proveedor con
 * `estado ∈ {RECIBIDA_COMPLETA, CERRADA}` (valores confirmados contra el
 * enum real `EstadoOrdenCompra`, `schema.prisma`) y `is_active = true`. Por
 * cada OC se toma la `Recepcion` de mayor `fecha_recepcion` (relación
 * directa `OrdenCompra.recepciones: Recepcion[]`, sin tabla intermedia —
 * resuelto en una sola query con el `orderBy`/`take` anidado, sin N+1).
 *
 * Fórmula: `differenceInCalendarDays(recepcion.fecha_recepcion,
 * oc.fecha_entrega_comprometida)`. Orden de argumentos confirmado: `date-fns`
 * resta el segundo argumento del primero, así que un valor positivo significa
 * que la recepción ocurrió DESPUÉS de lo comprometido (atraso) y uno
 * negativo que ocurrió ANTES (adelanto) — signo correcto sin invertir nada.
 *
 * Una OC sin `fecha_entrega_comprometida` (nullable en el schema) se excluye
 * del cálculo — no hay desvío que medir sin fecha comprometida. Sin deltas
 * computables (0 OCs válidas, o ninguna con fecha comprometida) → `null`,
 * NUNCA `0`. Redondeo a 1 decimal.
 */
async function calcularTiempoEntregaPromedio(proveedorId: string): Promise<number | null> {
  const ordenesConRecepcion = await prisma.ordenCompra.findMany({
    where: {
      proveedor_id: proveedorId,
      is_active: true,
      deleted_at: null,
      estado: { in: ["RECIBIDA_COMPLETA", "CERRADA"] },
    },
    select: {
      fecha_entrega_comprometida: true,
      recepciones: {
        where: { is_active: true, deleted_at: null },
        orderBy: { fecha_recepcion: "desc" },
        take: 1,
        select: { fecha_recepcion: true },
      },
    },
  });

  const deltas: number[] = [];
  for (const oc of ordenesConRecepcion) {
    if (!oc.fecha_entrega_comprometida) continue; // sin fecha comprometida → no se puede medir el desvío

    const [recepcionMasReciente] = oc.recepciones;
    if (!recepcionMasReciente) continue; // defensivo: OC en estado válido sin Recepcion registrada

    deltas.push(
      differenceInCalendarDays(recepcionMasReciente.fecha_recepcion, oc.fecha_entrega_comprometida),
    );
  }

  if (deltas.length === 0) return null;

  const promedio = deltas.reduce((acumulado, delta) => acumulado + delta, 0) / deltas.length;
  return Math.round(promedio * 10) / 10;
}

/**
 * Arma una fila del array `proveedores` final (Spec §2.10 paso 3.6 · Design
 * §2.2). Función pura — sin `await`, sin acceso a `prisma`.
 *
 * Conversión `Decimal → number` con `Number(...)`, misma convención
 * confirmada en T8 (`evaluacion.service.ts:91`), nunca `.toNumber()`.
 * `fecha_inicio_vigencia` se serializa a ISO string. `puntaje` y
 * `tiempoEntrega` se pasan tal cual — **preservan `null`**, nunca se
 * sustituyen por `0` ni se omiten del objeto.
 */
function armarComparativaItem(
  candidato: CandidatoConItem,
  puntaje: number | null,
  tiempoEntrega: number | null,
): ComparativaItem {
  return {
    proveedor_id: candidato.proveedor_id,
    razon_social: candidato.razon_social,
    precio_unitario: Number(candidato.precio_unitario),
    fecha_inicio_vigencia: candidato.fecha_inicio_vigencia.toISOString(),
    puntaje_total: puntaje,
    tiempo_entrega_promedio_dias: tiempoEntrega,
  };
}

/**
 * Ordena la comparativa final (Spec §2.10 paso 3.7 · Design §2.2):
 * `precio_unitario asc`, tie-breaker `razon_social asc`. Retorna una copia
 * ordenada — no muta el array recibido (`[...items].sort(...)`, nunca
 * `items.sort(...)` en el propio parámetro).
 *
 * Tie-breaker con `localeCompare("es")`, no `<`/`>` directo: una comparación
 * lexicográfica simple ordena mal razones sociales con acentos/ñ (ej. "Ñuñoa"
 * quedaría después de "Zeta" con `<`/`>`, que compara por code point);
 * `localeCompare` con locale `"es"` da el orden alfabético correcto
 * independientemente del locale por defecto del runtime donde corra el proceso.
 */
function ordenarComparativa(items: ComparativaItem[]): ComparativaItem[] {
  return [...items].sort((a, b) => {
    const diferenciaPrecio = a.precio_unitario - b.precio_unitario;
    if (diferenciaPrecio !== 0) return diferenciaPrecio;
    return a.razon_social.localeCompare(b.razon_social, "es");
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Función pública (Design §2.1, T12) — único punto de entrada del servicio.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Orquestador único de HU-H7 (Spec §2.10, pasos 3.1-3.9 · Design §2.1).
 * Elige la rama por criterio, enriquece cada candidato con puntaje y tiempo
 * de entrega, arma y ordena las filas, aplica la guarda de vacío y retorna
 * el resultado con el shape de `ComparativaPreciosResult`.
 */
export async function obtenerComparativaPrecios(
  input: ComparativaPreciosQuery,
): Promise<ComparativaPreciosResult> {
  let candidatos: CandidatoConItem[];

  if (input.variante_sku_id !== undefined) {
    candidatos = await resolverCandidatosPorVariante(input.variante_sku_id);
  } else if (input.categoria !== undefined) {
    candidatos = await resolverCandidatosPorCategoria(input.categoria);
  } else {
    // Defensivo, no un caso de negocio de la tabla de errores de la Spec: el
    // contrato Zod de `route.ts` (T13, dos `.refine()`) ya garantiza
    // "exactamente uno presente" antes de que el input llegue acá. Si esto
    // se dispara es un caller bypaseando esa validación (ej. un test que
    // invoca el servicio directo) — error de programación, no un 4xx de
    // negocio, por eso un `Error` plano y no un `ServiceError` con code.
    throw new Error(
      "obtenerComparativaPrecios: input debe traer exactamente uno de variante_sku_id o categoria",
    );
  }

  // Promise.all simple, no allSettled: obtenerPuntajeTotal y
  // calcularTiempoEntregaPromedio (T8/T9) ya resuelven sus propios casos
  // esperados de ausencia de datos devolviendo `null` (Spec pasos 3.3/3.4 y
  // 3.5) — una excepción acá sería un bug real (ej. una query rota) que
  // conviene que tire abajo toda la respuesta y sea visible de inmediato, no
  // que se trague en silencio candidato por candidato.
  const items = ordenarComparativa(
    await Promise.all(
      candidatos.map(async (candidato) => {
        const [puntaje, tiempoEntrega] = await Promise.all([
          obtenerPuntajeTotal(candidato.proveedor_id),
          calcularTiempoEntregaPromedio(candidato.proveedor_id),
        ]);
        return armarComparativaItem(candidato, puntaje, tiempoEntrega);
      }),
    ),
  );

  if (items.length === 0) {
    throw new ServiceError(
      "SIN_PROVEEDORES_COMPARABLES",
      "No hay proveedores homologados con precio vigente para el criterio indicado",
    );
  }

  return {
    variante_sku_id: input.variante_sku_id ?? null,
    categoria: input.categoria ?? null,
    proveedores: items,
  };
}
