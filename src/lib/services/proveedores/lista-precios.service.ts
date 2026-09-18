import "server-only";

/**
 * @module lista-precios.service
 * @description HU-H2 (Módulo H) — Publicación y aprobación de versiones de
 * lista de precios de proveedor (`propose.md` / `spec.md` /
 * `design_HU-H2_pieza1_FINAL.md`, aprobados).
 *
 * T4 (`tasks_HU-H2_FINAL.md`) aportó las funciones auxiliares privadas de la
 * tabla de la sección 2 del Design. T5/T6/T7 agregan las 3 funciones
 * públicas/exportadas: `publicarNuevaVersionListaPrecio`,
 * `aprobarListaPrecioVersion`, `resolverListaPrecioVigente`. T8/T9/T10
 * (Server Action / Route Handlers) quedan fuera de esta entrega.
 *
 * Reglas transversales ya cerradas (no reinterpretar):
 *  - Ningún ítem sin precio previo aporta 0%/100% artificial al cálculo de
 *    variación — se excluye (propose.md, spec.md checklist paso 5).
 *  - Los códigos de error de dominio usan `ServiceError` (patrón calcado de
 *    `orden-compra.service.ts`), nunca una clase nueva.
 *  - `publicarNuevaVersionListaPrecio` y `aprobarListaPrecioVersion` NUNCA
 *    llaman `registrarAuditLog()` directo: emiten su evento post-COMMIT y
 *    `audit-log.listener.ts` (T3, ya implementado y con comentario explícito
 *    en ese sentido) es quien registra el log. El diagrama de
 *    `design_HU-H2_pieza1_FINAL.md` §4 muestra `registrarAuditLog(params, tx)`
 *    dentro de la transacción incluso para la publicación dentro del umbral,
 *    lo cual contradice `spec.md` Caso 1/Caso 5 ("NO debe existir un nuevo
 *    registro en audit_logs... no se cruzó el umbral") y el propio
 *    `audit-log.listener.ts` (comentario junto a la rama
 *    `proveedor:variacion_precio_critica`). Se siguió `spec.md` + el listener
 *    ya aprobado — ver DUDA/BLOQUEO en el reporte de T5-T7.
 */

import { Prisma } from "@prisma/client";
import type { ListaPrecioVersion } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import { UMBRAL_VARIACION_CRITICA_PORCENTUAL } from "@/lib/services/proveedores/lista-precios.constants";
import type { ProveedorVariacionPrecioCriticaItemPayload } from "@/lib/events/event-types";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (propose.md, "Decisiones de diseño" punto 5 — ya
// sembrados en `prisma/seed.ts`, no se crean permisos nuevos). Mismo patrón
// exacto de naming/export que `PERMISO_CREAR_ORDEN_COMPRA` en
// `orden-compra.service.ts`: punto de verdad compartido por el Route Handler
// y la Server Action (T8/T9/T10).
// ──────────────────────────────────────────────────────────────────────────────

/** Requerido para publicar una versión dentro del umbral normal (Comprador, Supervisor de Compras). */
export const PERMISO_PUBLICAR_LISTA_PRECIO = "proveedores:publicar_lista";

/** Requerido EXCLUSIVAMENTE para aprobar una versión que superó el umbral crítico (Supervisor de Compras). */
export const PERMISO_APROBAR_LISTA_PRECIO_CRITICA =
  "proveedores:publicar_lista_critica";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos internos (no exportados) — shapes de los ítems de entrada/salida
// usados exclusivamente por los helpers de este módulo. No figuran en
// ningún contrato público cerrado; se definen acá porque ninguno de los 4
// documentos fuente los declara en otro lado.
// ──────────────────────────────────────────────────────────────────────────────

interface ItemInput {
  variante_sku_id: string;
  precio_unitario: number;
}

interface ItemConVariacion {
  variacion_porcentual: number | null;
}

interface ItemVersionCreateInput {
  lista_precio_version_id: string;
  variante_sku_id: string;
  precio_unitario: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Cálculo de variación porcentual (propose.md — "Cálculo de variación
// porcentual y evento crítico" · Design §2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Variación % de un ítem contra su precio previamente vigente.
 *
 * Firma EXACTA de la tabla de auxiliares privadas del Design: ambos
 * parámetros son `number` (no `number | null`). La regla cerrada de
 * propose.md/spec.md ("null si no hay precio anterior, ese ítem se excluye
 * del cálculo") se resuelve por composición: el llamador (T5, fuera de este
 * alcance) NO invoca esta función para un ítem sin precio previo — el `null`
 * de este helper cubre únicamente la guarda defensiva de división por cero
 * (`precio_anterior <= 0`), que en la práctica no debería ocurrir porque
 * `precio_unitario` es `.positive()` en el schema Zod. Ver DUDA/BLOQUEO en el
 * reporte de T4 sobre esta interpretación.
 */
function calcularVariacionPorcentual(
  precio_anterior: number,
  precio_nuevo: number,
): number | null {
  if (precio_anterior <= 0) return null;
  return ((precio_nuevo - precio_anterior) / precio_anterior) * 100;
}

/**
 * Máximo absoluto entre los ítems con variación no-`null`; `0` si todos son
 * `null` (primera publicación completa) — sin rama de código especial,
 * resuelto naturalmente por el valor inicial `0` del `reduce` (propose.md,
 * "Caso borde: primera publicación de una ListaPrecio").
 */
function calcularVariacionMaximaDelLote(items: ItemConVariacion[]): number {
  return items.reduce((maximo, item) => {
    if (item.variacion_porcentual === null) return maximo;
    return Math.max(maximo, item.variacion_porcentual);
  }, 0);
}

/** Compara la variación máxima del lote contra el umbral crítico parametrizado. */
function debeRequerirAprobacion(variacion_maxima: number): boolean {
  return variacion_maxima > UMBRAL_VARIACION_CRITICA_PORCENTUAL;
}

// ──────────────────────────────────────────────────────────────────────────────
// Validaciones de precondición (spec.md — Checklist de validaciones en orden
// de ejecución, pasos 1-4). Se ejecutan en este orden desde el llamador (T5):
// validarProveedorHomologado → validarExistenciaVariantes →
// validarFechaNoDuplicada.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pasos 1-2 del checklist de `spec.md`: existencia y homologación del
 * proveedor. Única lectura `proveedor.findUnique({ where: { id } })`, tal
 * como especifica la tabla de auxiliares privadas del Design (sección 2, fila
 * agregada tras auditoría cruzada). No aplica filtros adicionales de
 * `is_active`/`deleted_at` — el Design no los incluye para este helper (a
 * diferencia de `resolverContextoPrecios()` en `orden-compra.service.ts`, que
 * sí los aplica para HU-H3); se respeta literalmente lo documentado acá, sin
 * "mejorarlo".
 */
async function validarProveedorHomologado(
  proveedor_id: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const cliente = tx ?? prisma;
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: proveedor_id },
    select: { id: true, estado: true },
  });
  if (!proveedor) {
    throw new ServiceError("PROVEEDOR_INEXISTENTE", "El proveedor no existe");
  }
  if (proveedor.estado !== "HOMOLOGADO") {
    throw new ServiceError(
      "PROVEEDOR_NO_HOMOLOGADO",
      "Solo proveedores en estado HOMOLOGADO pueden publicar listas de precios",
    );
  }
}

/**
 * Paso 3 del checklist: existencia de cada `variante_sku_id` recibido. Si la
 * cantidad de resultados no coincide con la cantidad de ítems, al menos uno
 * no existe (spec.md, paso 3 literal — no se agrega deduplicación de SKUs
 * repetidos porque ni propose.md ni spec.md la piden para este endpoint).
 *
 * `proveedor_id` es parte de la firma exacta de la tabla de auxiliares
 * privadas del Design pero no se usa en el cuerpo: la existencia de una
 * `VarianteSKU` no depende del proveedor en el schema actual. Se conserva el
 * parámetro tal cual está documentado, sin "mejorar" la firma.
 */
async function validarExistenciaVariantes(
  proveedor_id: string,
  items: ItemInput[],
  tx?: Prisma.TransactionClient,
): Promise<void> {
  void proveedor_id;
  const cliente = tx ?? prisma;
  const skuIds = items.map((item) => item.variante_sku_id);
  const variantesExistentes = await cliente.varianteSKU.findMany({
    where: { id: { in: skuIds } },
    select: { id: true },
  });
  if (variantesExistentes.length !== skuIds.length) {
    throw new ServiceError("VARIANTE_SKU_INEXISTENTE", "La variante SKU no existe");
  }
}

/**
 * Paso 4 del checklist: `fecha_inicio_vigencia` no anterior a hoy ya la
 * cubre el `.refine()` de Zod (fuera de este service); acá se valida
 * exclusivamente la NO-duplicidad para el mismo proveedor, vía join a
 * `lista_precio.proveedor_id` (Design §2). Se filtra `is_active`/`deleted_at`
 * en ambos niveles (mismo criterio de soft-delete estricto aplicado en
 * `resolverContextoPrecios()` de `orden-compra.service.ts`) para no colisionar
 * contra una versión soft-deleted.
 */
async function validarFechaNoDuplicada(
  proveedor_id: string,
  fecha_inicio_vigencia: Date,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const cliente = tx ?? prisma;
  const existente = await cliente.listaPrecioVersion.findFirst({
    where: {
      fecha_inicio_vigencia,
      is_active: true,
      deleted_at: null,
      lista_precio: {
        proveedor_id,
        is_active: true,
        deleted_at: null,
      },
    },
    select: { id: true },
  });
  if (existente) {
    throw new ServiceError(
      "FECHA_DUPLICADA",
      "La fecha de vigencia ya existe para este proveedor",
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolución de "versión vigente" (propose.md, decisión de diseño 2) — base
// de la futura función pública `resolverListaPrecioVigente` (T7).
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Versión vigente: `publicada = true AND fecha_inicio_vigencia <= now()`,
 * `is_active`/`deleted_at` estrictos, orden descendente por
 * `fecha_inicio_vigencia`, `take(1)` implícito vía `findFirst`
 * (propose.md, decisión 2).
 *
 * Cuando se recibe `variante_sku_id`, el filtro NO se aplica en el `where`
 * de nivel superior de la resolución de "vigente" — eso podría saltar a una
 * versión más vieja que sí tenga la variante, lo cual es incorrecto: la
 * ausencia de esa variante en la versión vigente es información válida
 * ("esta variante no tiene precio en la lista vigente"), no un caso a
 * resolver buscando más atrás. Por eso la versión vigente se resuelve
 * primero SIN el filtro de variante, y recién después se chequea si esa
 * versión específica trae un `ListaPrecioItem` activo para la variante
 * pedida; si no lo trae, se devuelve `null` (corrección de precisión sobre
 * la duda reportada en T4, confirmada por el usuario).
 */
async function obtenerVersionVigente(
  proveedor_id: string,
  variante_sku_id?: string,
  tx?: Prisma.TransactionClient,
): Promise<ListaPrecioVersion | null> {
  const cliente = tx ?? prisma;
  const versionVigente = await cliente.listaPrecioVersion.findFirst({
    where: {
      publicada: true,
      is_active: true,
      deleted_at: null,
      fecha_inicio_vigencia: { lte: new Date() },
      lista_precio: {
        proveedor_id,
        is_active: true,
        deleted_at: null,
      },
    },
    orderBy: { fecha_inicio_vigencia: "desc" },
  });

  if (!versionVigente || !variante_sku_id) return versionVigente;

  const tieneVariante = await cliente.listaPrecioItem.findFirst({
    where: {
      lista_precio_version_id: versionVigente.id,
      variante_sku_id,
      is_active: true,
      deleted_at: null,
    },
    select: { id: true },
  });

  return tieneVariante ? versionVigente : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Shape de escritura (spec.md, paso 7 — INSERT masivo dentro de la
// transacción, después de crear la ListaPrecioVersion)
// ──────────────────────────────────────────────────────────────────────────────

function construirItemsVersion(
  version_id: string,
  items: ItemInput[],
): ItemVersionCreateInput[] {
  return items.map((item) => ({
    lista_precio_version_id: version_id,
    variante_sku_id: item.variante_sku_id,
    precio_unitario: item.precio_unitario,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Emisión post-COMMIT (spec.md, paso 8 · propose.md, "Patrón de emisión de
// eventos: fire-and-forget"). Ambas funciones registran la intención de
// emisión ANTES de invocar `domainEventBus.emit` — mitigación del riesgo
// conocido de pérdida de evento si el proceso cae entre el COMMIT y el emit
// (propose.md, mismo apartado). No existe un logger compartido en el
// proyecto (`src/lib/**`) para este propósito; se usa `console.info` como
// mínimo denominador consistente con la ausencia de una utilidad dedicada.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * La tabla de auxiliares privadas del Design describe el payload de este
 * helper como `{ proveedor_id, lista_precio_version_id, variacion_maxima }`,
 * pero el evento `proveedor:variacion_precio_critica`
 * (`ProveedorVariacionPrecioCriticaPayload`, event-types.ts, T2 — cerrado)
 * exige además `usuario_id` e `items_variacion_critica`. El gap se resolvió
 * reabriendo la firma pública de `publicarNuevaVersionListaPrecio` para
 * agregar `usuario_id` como 4to parámetro (decisión confirmada, ver T5):
 * `publicarNuevaVersionListaPrecio(proveedor_id, fecha_inicio_vigencia,
 * items, usuario_id)`, mismo patrón que `crearOrdenCompra(input, usuarioId)`
 * en `orden-compra.service.ts`. `propose.md`/`design_HU-H2_pieza1_FINAL.md`
 * se actualizan aparte para reflejar la firma de 4 parámetros. T5 debe
 * propagar ese `usuario_id` hasta acá y también usarlo en
 * `registrarAuditLog({ usuario_id, ... })` dentro de la transacción de
 * escritura.
 */
interface EmitirVariacionCriticaPayload {
  proveedor_id: string;
  lista_precio_version_id: string;
  variacion_maxima: number;
  usuario_id: string;
  items_variacion_critica: ProveedorVariacionPrecioCriticaItemPayload[];
}

/** Post-commit: emite `proveedor:variacion_precio_critica` SOLO si `variacion_maxima` supera el umbral. */
async function emitirVariacionCriticaSiCorresponde(
  payload: EmitirVariacionCriticaPayload,
): Promise<void> {
  if (!debeRequerirAprobacion(payload.variacion_maxima)) return;

  console.info(
    `[lista-precios] intención de emisión: proveedor:variacion_precio_critica (lista_precio_version_id=${payload.lista_precio_version_id})`,
  );

  domainEventBus.emit("proveedor:variacion_precio_critica", {
    usuario_id: payload.usuario_id,
    timestamp: new Date().toISOString(),
    proveedor_id: payload.proveedor_id,
    lista_precio_version_id: payload.lista_precio_version_id,
    variacion_porcentual_maxima: payload.variacion_maxima,
    items_variacion_critica: payload.items_variacion_critica,
  });
}

/**
 * Post-commit: emite `proveedor:lista_precio_aprobada` tras aprobar una
 * versión. Firma literal de la tabla de auxiliares privadas del Design — sin
 * extender: `aprobada_por_id` mapea 1:1 a `usuario_id` del payload del
 * evento y `timestamp` se genera acá (momento de la emisión), consistente
 * con el resto de eventos post-COMMIT del proyecto que tampoco reciben el
 * timestamp como parámetro.
 */
async function emitirListaAprobada(payload: {
  proveedor_id: string;
  lista_precio_version_id: string;
  aprobada_por_id: string;
}): Promise<void> {
  console.info(
    `[lista-precios] intención de emisión: proveedor:lista_precio_aprobada (lista_precio_version_id=${payload.lista_precio_version_id})`,
  );

  domainEventBus.emit("proveedor:lista_precio_aprobada", {
    usuario_id: payload.aprobada_por_id,
    timestamp: new Date().toISOString(),
    proveedor_id: payload.proveedor_id,
    lista_precio_version_id: payload.lista_precio_version_id,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Funciones públicas (T5-T7, `tasks_HU-H2_FINAL.md`) — contratos fijados por
// `propose.md` / `design_HU-H2_pieza1_FINAL.md` §2, "no reabrir".
// ──────────────────────────────────────────────────────────────────────────────

/**
 * T5 — Publica una nueva versión de lista de precios de proveedor
 * (`propose.md` "Contratos de función" · `spec.md` checklist de
 * `publicarNuevaVersionListaPrecio`, pasos 1-8).
 *
 * Orden de ejecución exacto, todo dentro de un único `prisma.$transaction`
 * (spec.md paso 7 / Design §4):
 *  1-3. `validarProveedorHomologado` → `validarExistenciaVariantes` →
 *       `validarFechaNoDuplicada` (mismo orden y mismo `tx` que las
 *       precondiciones de `resolverContextoPrecios()` en
 *       `orden-compra.service.ts`).
 *  4-5. Por cada ítem, se resuelve su precio previo vía
 *       `obtenerVersionVigente(proveedor_id, variante_sku_id, tx)`: si
 *       devuelve `null` (variante nueva o primera publicación), el ítem
 *       queda excluido del cálculo de variación (spec.md paso 5, sin 0%/100%
 *       artificial). `calcularVariacionMaximaDelLote` resuelve
 *       `variacion_porcentual_maxima` solo sobre los ítems con precio previo.
 *  6. `debeRequerirAprobacion` determina `publicada`/`requiere_aprobacion`.
 *  7. Alta de `ListaPrecio` (reusada si ya existe una para el proveedor —
 *     1:N confirmado en `propose.md`, "Cardinalidad Proveedor ↔ ListaPrecio")
 *     + `ListaPrecioVersion` + los N `ListaPrecioItem` (`construirItemsVersion`,
 *     T4). Se usa `createManyAndReturn` para recuperar el `id` de cada
 *     `ListaPrecioItem` recién creado sin una segunda ronda de queries — hace
 *     falta ese `id` para `items_variacion_critica.lista_precio_item_id` del
 *     evento crítico.
 *
 * NO se llama `registrarAuditLog()` en este paso (ver nota de cabecera del
 * módulo: contradice `spec.md` Caso 1/Caso 5 y el `audit-log.listener.ts` ya
 * aprobado, que es quien registra el log SOLO si se emite el evento crítico).
 *
 *  8. Post-commit: `emitirVariacionCriticaSiCorresponde` (T4) — ya filtra
 *     internamente por umbral, solo emite si corresponde.
 */
export async function publicarNuevaVersionListaPrecio(
  proveedor_id: string,
  fecha_inicio_vigencia: Date,
  items: ItemInput[],
  usuario_id: string,
): Promise<{
  lista_precio_version_id: string;
  publicada: boolean;
  requiere_aprobacion: boolean;
  variacion_porcentual_maxima: number;
}> {
  const resultado = await prisma.$transaction(async (tx) => {
    await validarProveedorHomologado(proveedor_id, tx);
    await validarExistenciaVariantes(proveedor_id, items, tx);
    await validarFechaNoDuplicada(proveedor_id, fecha_inicio_vigencia, tx);

    // Precio previo por ítem (spec.md paso 5): solo participan del cálculo
    // de variación los ítems que ya tenían un `ListaPrecioItem` previo en la
    // versión vigente de esa variante puntual.
    const itemsConPrecioPrevio: {
      item: ItemInput;
      precio_anterior: number;
      variacion_porcentual: number | null;
    }[] = [];

    for (const item of items) {
      const versionVigente = await obtenerVersionVigente(
        proveedor_id,
        item.variante_sku_id,
        tx,
      );
      if (!versionVigente) continue;

      const itemPrevio = await tx.listaPrecioItem.findFirst({
        where: {
          lista_precio_version_id: versionVigente.id,
          variante_sku_id: item.variante_sku_id,
          is_active: true,
          deleted_at: null,
        },
        select: { precio_unitario: true },
      });
      if (!itemPrevio) continue;

      const precio_anterior = itemPrevio.precio_unitario.toNumber();
      itemsConPrecioPrevio.push({
        item,
        precio_anterior,
        variacion_porcentual: calcularVariacionPorcentual(
          precio_anterior,
          item.precio_unitario,
        ),
      });
    }

    const variacion_porcentual_maxima = calcularVariacionMaximaDelLote(
      itemsConPrecioPrevio.map((i) => ({
        variacion_porcentual: i.variacion_porcentual,
      })),
    );
    const requiere_aprobacion = debeRequerirAprobacion(
      variacion_porcentual_maxima,
    );
    const publicada = !requiere_aprobacion;

    // `ListaPrecio` padre: 1:N respecto a Proveedor (sin `@@unique`), se
    // reusa la existente y no activa (soft-delete estricto), o se crea la
    // primera para este proveedor.
    let listaPrecio = await tx.listaPrecio.findFirst({
      where: { proveedor_id, is_active: true, deleted_at: null },
      select: { id: true },
    });
    if (!listaPrecio) {
      listaPrecio = await tx.listaPrecio.create({
        data: { proveedor_id },
        select: { id: true },
      });
    }

    const version = await tx.listaPrecioVersion.create({
      data: {
        lista_precio_id: listaPrecio.id,
        fecha_inicio_vigencia,
        variacion_porcentual_maxima,
        publicada,
        requiere_aprobacion,
      },
      select: { id: true },
    });

    const itemsCreados = await tx.listaPrecioItem.createManyAndReturn({
      data: construirItemsVersion(version.id, items),
      select: { id: true, variante_sku_id: true },
    });
    const itemIdPorSku = new Map(
      itemsCreados.map((i) => [i.variante_sku_id, i.id]),
    );

    const items_variacion_critica: ProveedorVariacionPrecioCriticaItemPayload[] =
      itemsConPrecioPrevio
        .filter(
          (i): i is typeof i & { variacion_porcentual: number } =>
            i.variacion_porcentual !== null,
        )
        .map((i) => ({
          // `!`: todo ítem de `items` fue creado en el paso anterior.
          lista_precio_item_id: itemIdPorSku.get(i.item.variante_sku_id)!,
          variante_sku_id: i.item.variante_sku_id,
          valor_anterior: i.precio_anterior,
          valor_nuevo: i.item.precio_unitario,
          variacion_porcentual: i.variacion_porcentual,
        }));

    return {
      lista_precio_version_id: version.id,
      publicada,
      requiere_aprobacion,
      variacion_porcentual_maxima,
      items_variacion_critica,
    };
  });

  // Post-COMMIT (spec.md paso 8): `emitirVariacionCriticaSiCorresponde` (T4)
  // ya filtra por umbral internamente.
  await emitirVariacionCriticaSiCorresponde({
    proveedor_id,
    lista_precio_version_id: resultado.lista_precio_version_id,
    variacion_maxima: resultado.variacion_porcentual_maxima,
    usuario_id,
    items_variacion_critica: resultado.items_variacion_critica,
  });

  return {
    lista_precio_version_id: resultado.lista_precio_version_id,
    publicada: resultado.publicada,
    requiere_aprobacion: resultado.requiere_aprobacion,
    variacion_porcentual_maxima: resultado.variacion_porcentual_maxima,
  };
}

/**
 * T6 — Aprueba una `ListaPrecioVersion` que había quedado pendiente por
 * superar el umbral crítico de variación (`propose.md` "Contratos de
 * función" · `spec.md` checklist de `aprobarListaPrecioVersion`, pasos 1-4).
 *
 * Precondiciones (spec.md, tabla de errores consolidada):
 *  - `404 VERSION_INEXISTENTE` — no existe o está soft-deleted.
 *  - `400 VERSION_YA_APROBADA` — `publicada = true` (ya aprobada, o nunca
 *    requirió aprobación).
 *
 * `proveedor_id` (necesario para el payload de `emitirListaAprobada`, T4) se
 * resuelve de la relación `lista_precio.proveedor_id` de la versión — NO es
 * un parámetro de esta función pública.
 *
 * NO se llama `registrarAuditLog()` acá (ver nota de cabecera del módulo):
 * `emitirListaAprobada` emite el evento post-COMMIT y
 * `audit-log.listener.ts` (T3) es quien registra el log.
 */
export async function aprobarListaPrecioVersion(
  version_id: string,
  aprobada_por_id: string,
): Promise<{
  lista_precio_version_id: string;
  publicada: boolean;
  aprobada_por_id: string;
  aprobada_at: Date;
}> {
  const resultado = await prisma.$transaction(async (tx) => {
    const version = await tx.listaPrecioVersion.findFirst({
      where: { id: version_id, is_active: true, deleted_at: null },
      select: {
        id: true,
        publicada: true,
        lista_precio: { select: { proveedor_id: true } },
      },
    });
    if (!version) {
      throw new ServiceError(
        "VERSION_INEXISTENTE",
        "La versión de lista de precios no existe",
      );
    }
    if (version.publicada) {
      throw new ServiceError(
        "VERSION_YA_APROBADA",
        "La versión de lista de precios ya ha sido aprobada",
      );
    }

    const aprobada_at = new Date();
    await tx.listaPrecioVersion.update({
      where: { id: version.id },
      data: {
        publicada: true,
        requiere_aprobacion: false,
        aprobada_por_id,
        aprobada_at,
      },
    });

    return {
      proveedor_id: version.lista_precio.proveedor_id,
      aprobada_at,
    };
  });

  // Post-COMMIT (spec.md paso 4): emite `proveedor:lista_precio_aprobada`.
  await emitirListaAprobada({
    proveedor_id: resultado.proveedor_id,
    lista_precio_version_id: version_id,
    aprobada_por_id,
  });

  return {
    lista_precio_version_id: version_id,
    publicada: true,
    aprobada_por_id,
    aprobada_at: resultado.aprobada_at,
  };
}

/**
 * T7 — Wrapper público de `obtenerVersionVigente` (T4): NO duplica su
 * lógica, expone la resolución de "versión vigente" para que la consuman
 * H3, H7 y H8 en piezas futuras (`propose.md`, decisión de diseño 2). Misma
 * firma exacta de 3 parámetros y mismo tipo de retorno que el helper privado.
 */
export async function resolverListaPrecioVigente(
  proveedor_id: string,
  variante_sku_id?: string,
  tx?: Prisma.TransactionClient,
): Promise<ListaPrecioVersion | null> {
  return obtenerVersionVigente(proveedor_id, variante_sku_id, tx);
}
