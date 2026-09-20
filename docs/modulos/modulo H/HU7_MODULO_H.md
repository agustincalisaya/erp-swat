# HU-H7 — Vista Comparativa de Precios entre Proveedores (Módulo H)

**Issue de GitHub:** _(a completar por Tomás al abrir el PR)_
**Rama:** `feature/HU-H7-precios-proveedores`
**Sprint:** Sprint 3, Módulo H (Proveedores y Abastecimiento)
**Rol:** Comprador / Supervisor de Compras

## Resumen

Se implementó un endpoint de solo lectura que compara, para un mismo insumo (por `variante_sku_id` o por `categoria`), el precio unitario vigente de cada proveedor homologado candidato, junto con su puntaje de evaluación más reciente y su tiempo de entrega promedio histórico. Es un caso de uso de consulta pura: una capa de servicios (`comparativa-precios.service.ts`) con un orquestador público y 6 auxiliares privadas, y un único Route Handler `GET`. No agrega interfaz de usuario ni modifica `schema.prisma`. Reutiliza `resolverListaPrecioVigente()` (HU-H2) como único mecanismo de resolución de "versión vigente" — mismo criterio que ya usa HU-H3.

Durante el desarrollo se corrigieron 6 discrepancias reales entre los documentos de diseño (`propose`/`spec`/`design`/`tasks` `_FINAL.md`) y el comportamiento real del código y del schema — la más significativa de ellas cambió por completo el criterio de filtrado por categoría (ver "Correcciones durante el desarrollo"). Toda la capa de código (T1-T14) y los 8 casos de testing (T15-T22) están cerrados con evidencia real.

## Objetivo

Darle a Compras una herramienta de apoyo a la decisión de compra: comparar en una sola consulta el precio vigente, la confiabilidad histórica (puntaje de evaluación) y la puntualidad de entrega de todos los proveedores homologados que puedan surtir un mismo insumo, sin tener que consultarlos uno por uno.

## Alcance

**Implementado en este PR:**

- Endpoint `GET /api/proveedores/comparativa-precios`, con dos criterios de filtro mutuamente excluyentes y obligatorios (uno de los dos): `variante_sku_id` o `categoria`.
- Resolución de candidatos por `variante_sku_id`: todo `Proveedor` homologado con al menos un `ListaPrecioItem` vigente para esa variante exacta, sin desempate (la vigencia resuelve un ítem único por proveedor).
- Resolución de candidatos por `categoria`: todo `Proveedor` homologado con al menos un `ListaPrecioItem` vigente cuya variante pertenezca a un `ProductoMaestro` con esa categoría, con desempate intra-proveedor por menor `precio_unitario` cuando el proveedor tiene 2+ ítems vigentes en la misma categoría.
- Enriquecimiento de cada candidato con `puntaje_total` (última `EvaluacionProveedor`, `null` si no hay ninguna) y `tiempo_entrega_promedio_dias` (Opción B: desvío promedio contra `fecha_entrega_comprometida`, `null` si no hay OCs computables).
- Orden final `precio_unitario asc`, tie-breaker `razon_social asc` (con `localeCompare("es")` para orden alfabético correcto con acentos/ñ).
- Guarda de vacío (`422 SIN_PROVEEDORES_COMPARABLES`) y guarda defensiva ante corrupción de datos (`500 ERROR_INTERNO`, ver sección dedicada más abajo).
- Permiso granular nuevo `proveedores:comparar_precios`, sembrado y asignado directo a Comprador y Supervisor de Compras — ningún otro rol.

**Fuera de alcance de este PR:**

- Cualquier interfaz de usuario. Mismo criterio que HU-H2/HU-H6: esta HU es 100% contrato de backend.
- Campo `criterio_seleccion` en la respuesta — es exclusivo de HU-H8 (costo de reposición vigente), no de esta HU (restricción dura de la Spec §2.10).
- Ventana temporal configurable para `tiempo_entrega_promedio_dias` (ej. "últimos 12 meses") — la Spec la deja como parámetro de configuración opcional a futuro; no se implementó ningún recorte, el universo es todo el historial de OCs del proveedor.
- Corrección del bug preexistente de `usuarioRol.upsert()` en `prisma/seed.ts` (HU-B8) — hallazgo ajeno a esta HU, ver sección dedicada más abajo.

## Modelo de datos

No se modificó `schema.prisma`. Todos los modelos consumidos (`Proveedor`, `ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem`, `VarianteSKU`, `ProductoMaestro`, `EvaluacionProveedor`, `OrdenCompra`, `Recepcion`) ya estaban migrados de HUs anteriores.

Cadena de relaciones real usada para resolver la categoría de un ítem (confirmada contra el schema, no asumida): `ListaPrecioItem.variante_sku_id → VarianteSKU.id` (relación `variante_sku`), `VarianteSKU.producto_maestro_id → ProductoMaestro.id` (relación `producto_maestro`), `ProductoMaestro.categoria` (`String`). En ningún punto de esta cadena participa `Proveedor.categorias` — ver "Correcciones durante el desarrollo".

`EvaluacionProveedor.puntaje_total` es `Decimal @db.Decimal(5, 2)`, no `number` — se convierte con `Number(...)`, misma conversión ya usada en `evaluacion.service.ts` (HU-H5), nunca `.toNumber()`.

`OrdenCompra.recepciones: Recepcion[]` es una relación directa, sin tabla intermedia — permite resolver "la `Recepcion` de mayor `fecha_recepcion` por OC" con un `orderBy`/`take` anidado en una sola query, sin N+1.

## Reglas de negocio implementadas

**Filtro por `categoria`, exclusivo por `ProductoMaestro.categoria`.** Nunca se consulta ni se filtra por `Proveedor.categorias` — decisión cerrada tras un relevamiento de solo lectura (ver "Correcciones durante el desarrollo", corrección #2). `resolverCandidatosPorCategoria` resuelve el desempate intra-proveedor directo en la query (`orderBy: { precio_unitario: "asc" }, take: 1`), evitando traer todos los ítems para ordenar en JS.

**Filtro por `variante_sku_id`, sin desempate.** `resolverCandidatosPorVariante` no recibe ningún `proveedor_id` de entrada: descubre los candidatos consultando `ListaPrecioItem` por la variante (ver corrección #4). Por diseño, la vigencia resuelve como máximo un ítem por proveedor para una variante exacta — si apareciera más de uno, es corrupción de datos, no un caso de negocio (ver "Guarda defensiva" abajo).

**`puntaje_total` y `tiempo_entrega_promedio_dias` ausentes → `null`, nunca `0`.** Restricción dura de la Spec, verificada en T20/T21: un proveedor sin evaluación no es lo mismo que un proveedor con puntaje cero, y un proveedor sin OCs computables no es lo mismo que un proveedor con cero días de desvío.

**Tiempo de entrega — Opción B (desvío contra fecha comprometida).** `differenceInCalendarDays(Recepcion.fecha_recepcion, OrdenCompra.fecha_entrega_comprometida)`, promediado sobre OCs con `estado ∈ {RECIBIDA_COMPLETA, CERRADA}` y `is_active = true`, redondeado a 1 decimal. Positivo = atraso (recepción después de lo comprometido), negativo = adelanto. Una OC sin `fecha_entrega_comprometida` se excluye del cálculo. Confirmado con evidencia directa del schema y de `lista-precios.service.ts`/`orden-compra.service.ts` — ver corrección #1.

**Promise.all simple para el enriquecimiento por candidato**, no `Promise.allSettled`: `obtenerPuntajeTotal` y `calcularTiempoEntregaPromedio` ya resuelven sus propios casos esperados de ausencia de datos devolviendo `null`; una excepción ahí sería un bug real (ej. una query rota) que conviene que se propague y sea visible de inmediato, no que se trague en silencio candidato por candidato.

**Gate de permiso.** `proveedores:comparar_precios` vía `withPermission`, asignado directo a Comprador y Supervisor de Compras. Ver "Shape real del 403" (corrección #6) sobre una discrepancia conocida entre lo documentado y el mecanismo real de auth.

## Arquitectura y archivos

**Archivos nuevos:**

- `src/lib/services/proveedores/comparativa-precios.service.ts` — 1 función pública (`obtenerComparativaPrecios`) y 6 auxiliares privadas (`resolverCandidatosPorVariante`, `resolverCandidatosPorCategoria`, `obtenerPuntajeTotal`, `calcularTiempoEntregaPromedio`, `armarComparativaItem`, `ordenarComparativa`), más los tipos de apoyo `CandidatoConItem`, `ComparativaItem`, `ComparativaPreciosResult`, `ComparativaPreciosQuery`.
- `src/app/api/proveedores/comparativa-precios/route.ts` — `ComparativaPreciosQuerySchema` (Zod, co-localizado) y el Route Handler `GET`, envuelto en `withPermission`.

**Archivos modificados:**

- `prisma/seed.ts` — permiso `proveedores:comparar_precios` (catálogo + asignación directa a Comprador y Supervisor de Compras).
- `docs/specs/spec_modulo_H.md` — sección 2.10, punto 1 corregido + nota de corrección explícita sobre el filtro por categoría (ver corrección #2).
- `package.json` / `package-lock.json` — `date-fns` agregado como dependencia real (ver callout más abajo).

`ComparativaPreciosQuery` está declarado localmente en el servicio, no importado desde `route.ts`: el Design fija que el servicio se crea primero y no depende del route, y que "el servicio nunca importa el schema" — ni siquiera solo el tipo inferido. `route.ts` pasa `parsed.data` (`z.infer` de `ComparativaPreciosQuerySchema`), que satisface esa forma por tipado estructural, sin ningún import cruzado entre los dos archivos.

## Guarda defensiva de `resolverCandidatosPorVariante` — decisión de arquitectura

`ListaPrecioItem` no tiene ningún `@@unique([lista_precio_version_id, variante_sku_id])` en el schema. Si la resolución de "vigente" encontrara más de un `ListaPrecioItem` activo para la misma variante dentro de la misma versión, eso es corrupción de datos (bug de HU-H2 o inserción manual), nunca un caso de negocio — por eso `resolverCandidatosPorVariante` lanza `ServiceError("DUPLICADO_LISTA_PRECIO_ITEM", ...)` fail-fast, sin aplicar ningún desempate silencioso. Esto es deliberadamente distinto de `resolverCandidatosPorCategoria`, donde el desempate por menor precio SÍ es un caso de negocio legítimo: un proveedor puede vender legítimamente dos productos distintos dentro de la misma categoría, pero nunca dos precios vigentes distintos para la misma variante exacta dentro de la misma versión. Un desempate silencioso en ese segundo caso enmascararía un bug real y propagaría un precio potencialmente erróneo hacia esta HU y hacia HU-H8 (costo de reposición), que dependen del mismo modelo.

El Route Handler mapea este error a `500 ERROR_INTERNO` sin exponer el detalle real al cliente (`console.error` interno para diagnóstico) — nunca un código `4xx` propio, porque no es un caso de negocio del cliente sino una falla de integridad de datos.

## Correcciones durante el desarrollo

Seis correcciones reales se detectaron durante el pipeline de esta HU (relevamiento previo + implementación), verificando los documentos de diseño ya cerrados contra el schema, el código real del proyecto, y — en un caso — los propios datos del seed. Ninguna quedó sin resolver antes de este cierre:

1. **Fórmula de tiempo de entrega, confirmada como Opción B con evidencia de schema.** `differenceInCalendarDays(Recepcion.fecha_recepcion, OrdenCompra.fecha_entrega_comprometida)` — desvío contra fecha comprometida, no duración real del ciclo (la Spec dejaba ambas alternativas abiertas). Confirmado el orden de argumentos (`date-fns` resta el segundo del primero: positivo = atraso, negativo = adelanto) y la relación directa `OrdenCompra.recepciones: Recepcion[]` sin tabla intermedia, contra el schema real y contra `lista-precios.service.ts`/`orden-compra.service.ts`.

2. **Corrección completa del filtro por categoría — de `Proveedor.categorias` a `ProductoMaestro.categoria`.** La redacción original de `spec_modulo_H.md` §2.10 decía "todos los `Proveedor` homologados cuyo array `categorias` contenga ese valor, restringido además a los que tengan al menos un ítem vigente en esa categoría". Un relevamiento de solo lectura, previo a la implementación, encontró:
   - Grep de `Proveedor.categorias` en todo `src/`: **cero usos como restricción de negocio** — el campo solo aparece en el ciclo CRUD/UI del propio Proveedor (validación Zod al alta, persistencia, formulario, badge de listado). Ningún Route Handler ni servicio lo usa para filtrar o restringir nada.
   - El Documento de Alcance Funcional §3.1 describe el campo como dato puramente descriptivo del legajo comercial, al mismo nivel que datos impositivos y contactos — no como un control operativo.
   - Evidencia concreta y no hipotética contra el propio seed: `proveedorHomologado` (`categorias: ["Textil Táctico", "Calzado"]`, `prisma/seed.ts:456`) queda excluido de sus propias categorías reales de producto (`ProductoMaestro.categoria = "Camisas"` para CAMPOL/CAMTAC, `"Botas"` para BORCEG, vía `VarianteSKU.producto_maestro_id`) bajo la interpretación literal original — cero overlap entre ambos conjuntos de strings.

   La corrección se aplicó primero en `spec_modulo_H.md` §2.10 (con una nota de corrección explícita ahí), y de ahí se propagó a `spec_HU-H7_FINAL.md`, `design_HU-H7_FINAL.md`, `tasks_HU-H7_FINAL.md` y al código: el filtro por `categoria` se resuelve **exclusivamente** por `ProductoMaestro.categoria`, vía `VarianteSKU.producto_maestro_id`.

3. **Nombres de tabla/campo en las queries SQL de testing.** El borrador de trabajo (`docs/tasks/sdd/HU-H7/spec.md`) usaba nombres PascalCase entre comillas inventados (`"Proveedor"`, `"ListaPrecio"`, `"ListaPrecioItem"`, y un modelo `"ProductoVariante"` que no existe en el schema) en vez de los nombres reales `@@map` (`proveedores`, `listas_precio`, `listas_precio_version`, `listas_precio_item`, `variantes_sku`, `productos_maestros`), y un campo `ListaPrecio.fecha_fin_vigencia` que no existe en ningún lado del schema — la vigencia real de una `ListaPrecioVersion` es `publicada = true AND fecha_inicio_vigencia <= now()` (confirmado contra `resolverListaPrecioVigente()`, HU-H2). Se corrigieron las 4 queries afectadas (no 3, como se había estimado inicialmente), más un caso adicional en la query de verificación de permisos del Caso 8 (T22): usaba `Permiso.nombre`, campo que no existe — el campo real es `Permiso.codigo`.

4. **Firma corregida de `resolverCandidatosPorVariante`.** El Design/Tasks documentaban `(proveedor_id, variantesSkuIds)` como parámetros. Esa firma contradecía tanto el contrato HTTP real (`ComparativaPreciosQuerySchema` solo expone un `variante_sku_id` único opcional — nunca un array ni un `proveedor_id`) como el propio paso 3.1 de la Spec, donde los `proveedor_id` candidatos se **descubren** consultando `ListaPrecioItem` por la variante, no se reciben como parámetro. Firma real implementada: `resolverCandidatosPorVariante(varianteSkuId: string): Promise<CandidatoConItem[]>`.

5. **`ErrorDuplicadoListaPrecioItem` nunca existió como clase.** El Design/Tasks nombraban el error de la guarda defensiva (ver sección dedicada arriba) como si fuera su propia clase de error. El único mecanismo real de error de dominio en todo el proyecto es `ServiceError` (`src/lib/errors/service-error.ts`), instanciado directo con un `code: string` — confirmado contra un grep de `extends ServiceError`/`extends Error` en todo `src/lib/services/**`: **cero subclases** en toda la base de código. Se usa `ServiceError("DUPLICADO_LISTA_PRECIO_ITEM", mensaje)` directo, sin crear ninguna clase nueva.

6. **Shape real del 403.** La Spec/Tasks documentaban `{ code: "SIN_PERMISO", message: "No autorizado para comparar precios entre proveedores" }`. `withPermission` — el único mecanismo real de permisos del proyecto, sin ningún parámetro para personalizar `code`/`message` por ruta — siempre devuelve `{ code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta acción" }`. Confirmado que **ningún** Route Handler hermano de `proveedores/` personaliza este 403 (`route.ts`, `auditoria/route.ts`, `[id]/lista-precios/route.ts`). Se usó `withPermission` tal cual, sin envolverlo — el 403 real de este endpoint es `FORBIDDEN`, no `SIN_PERMISO`. Confirmado también en runtime durante T22.

## Nueva dependencia real — acción requerida del equipo

> ⚠️ **`date-fns` pasó a ser una dependencia real y declarada de este PR.** Antes solo existía como peerDependency **opcional** de `@base-ui/react` (`^4.0.0`, nunca resuelta, ausente de `node_modules` de nivel superior) — no había ninguna versión instalada. Se agregó `"date-fns": "^4.4.0"` a `package.json` (necesaria para `differenceInCalendarDays` en `calcularTiempoEntregaPromedio`). **El equipo tiene que correr `npm install` antes de pullear esta rama** — sin eso, `tsc` falla con `Cannot find module 'date-fns'`.

## Hallazgo fuera de alcance de esta HU — bug preexistente en `usuarioRol.upsert()` (HU-B8)

Durante la verificación runtime, `npx prisma db seed` crasheó con `P2002` (`Unique constraint failed on the fields: (id)`) en `usuarioRol.upsert()`, línea ~2587 de `prisma/seed.ts` — una fila huérfana de `UsuarioRol` que quedó de antes de la corrección post-HU-B4 de `ROL_CAJERO_POS_ID`/`ROL_SUPERVISOR_VENTAS_ID`. No bloqueó esta HU: el permiso y las asignaciones de rol de HU-H7 se insertan antes en el script y quedaron confirmados en la base de datos pese al crash posterior. Ya fue reportado por separado al dueño de HU-B8, con el detalle forense completo (mecanismo exacto, evidencia SQL) — no se repite acá, mismo criterio que usó HU-H2 con su hallazgo de Módulo D.

## Verificación

**Verificación en runtime, no solo compilación.** Se ejecutaron los 8 casos de testing definidos (T15-T22 de `tasks_HU-H7_FINAL.md`) contra un servidor `next dev` real y la base PostgreSQL real de desarrollo (`swat_erp_db`), autenticando por HTTP como los roles reales (Comprador, Auditor) vía el endpoint de login real — no simulado.

**Fixtures de datos creados para la verificación** (documentados acá, no en "Alcance" — no son parte del comportamiento de la HU): al momento de testear, el seed real solo tenía un proveedor con `ListaPrecioVersion` vigente (el segundo proveedor homologado, "QA Fixture HU-H2", tenía su única versión con `fecha_inicio_vigencia` futura — no vigente), sin ningún escenario natural de ≥2 candidatos ni de desempate. Se insertaron 4 fixtures mínimos vía `INSERT` SQL directo, sin tocar `main()` de `prisma/seed.ts`: 1 `ListaPrecioVersion` + 2 `ListaPrecioItem` (uno para el camino feliz de T15/T16, otro para el desempate de T16) + 1 `OrdenCompra` + 1 `Recepcion` (para la rama con valor real de T21). Existe un script de rollback SQL exacto para estos 4 fixtures, en el orden correcto respetando FKs, ya entregado al usuario.

**Resultado de los 8 casos:**

| Caso | Descripción | Resultado |
| --- | --- | --- |
| T15 | Comparativa por `variante_sku_id`, camino feliz | `200`, orden `precio_unitario asc` correcto, 6 campos por fila |
| T16 | Comparativa por `categoria`, desempate intra-proveedor | `200`, proveedor aparece una sola vez con el `precio_unitario` mínimo, confirmado exacto contra SQL directo, sin `criterio_seleccion` |
| T17 | Ambos criterios a la vez | `400 VALIDACION_QUERY_INVALIDA`, mensaje exacto del 2º `.refine()` ("mutuamente excluyentes") |
| T18 | Ningún criterio | `400 VALIDACION_QUERY_INVALIDA`, mensaje exacto del 1º `.refine()` |
| T19 | Criterio válido sin candidatos | `422 SIN_PROVEEDORES_COMPARABLES`, mensaje exacto de la Spec |
| T20 | Proveedor candidato sin evaluación previa | `puntaje_total: null` explícito, nunca `0` — confirmado sin necesidad de fixture adicional |
| T21 | Proveedor candidato sin órdenes computables + rama con valor real | `tiempo_entrega_promedio_dias: null` en la rama sin datos; en la rama con fixture, `+5` (atraso), coincide exacto contra SQL manual, signo confirmado |
| T22 | Acceso sin el permiso + sub-caso positivo | `403 FORBIDDEN` (no `SIN_PERMISO`, ver corrección #6) para un rol sin el permiso; Comprador accede con éxito en todos los casos anteriores |

Los 8 casos pasaron con el comportamiento esperado.

## Decisiones sujetas a revisión

- **Shape real del 403 (`FORBIDDEN`, no `SIN_PERMISO`).** No es una decisión de esta HU sino una limitación estructural heredada de `withPermission` (sin parámetro para personalizar `code`/`message` por ruta), que ya comparten todos los Route Handlers hermanos de `proveedores/`. Si en algún momento se decide que el proyecto necesita códigos de error de permiso personalizables por endpoint, es un cambio a `with-permission.ts` que afecta a todo el proyecto, no algo que corresponda resolver dentro de esta HU.
- **Bug preexistente de `usuarioRol.upsert()` (HU-B8).** No es una decisión de esta HU, pero su resolución queda pendiente de que el dueño de HU-B8 decida el fix — ver sección dedicada arriba.
- **Ventana temporal de `tiempo_entrega_promedio_dias` sin acotar.** La Spec deja explícitamente abierta la posibilidad de un recorte configurable (ej. "últimos 12 meses") como mejora futura; no se implementó ningún límite en esta HU — el promedio se calcula sobre todo el historial de OCs del proveedor.
- **Nota agregada durante Apply de HU-H8.** Los códigos de error `VALIDACION_QUERY_INVALIDA`/`ERROR_INTERNO` de esta HU, documentados en su momento como la convención confirmada del proyecto, resultaron ser la excepción dentro de Módulo H — un relevamiento posterior (HU-H8) contó los 5 Route Handlers reales del módulo y encontró que 4 de 5 (`proveedores/[id]/route.ts` de H1, `[id]/lista-precios/route.ts` de H2, `auditoria/route.ts` de H6, `verificar-cadena/route.ts` de D.3) usan `VALIDATION_ERROR`/`INTERNAL_ERROR` en inglés. No se corrige el código de esta HU — ya mergeada y en producción, sin motivo funcional para tocarla — pero queda esta nota para que ninguna HU futura copie el patrón de H7 pensando que es el estándar del proyecto: el estándar real es el inglés.
