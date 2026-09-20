# HU-H8 — Costo de Reposición Vigente de una VarianteSKU (Módulo H)

**Rama:** `feature/HU-H8-costo-repo-prod`
**Sprint:** Sprint 3, Módulo H (Proveedores y Abastecimiento)
**Rol:** Sistema — endpoint de integración servicio-a-servicio, sin rol humano

## Resumen

Se implementó un endpoint de integración servicio-a-servicio que expone el costo de reposición vigente de una `VarianteSKU`: entre todos los proveedores homologados con precio vigente para esa variante, devuelve el de menor `precio_unitario`, con desempate determinístico de 3 criterios ante empate exacto. Es un caso de uso de solo lectura — una capa de servicios (`costo-reposicion.service.ts`) con un orquestador público y 3 auxiliares privadas, y un único Route Handler `GET`. No agrega interfaz de usuario ni modifica `schema.prisma`. Reutiliza `resolverListaPrecioVigente()` (HU-H2) como único mecanismo de resolución de "versión vigente" — mismo criterio que ya usan HU-H3 y HU-H7.

HU-H8 es distinta en naturaleza a las HUs anteriores de este módulo: el actor no es un rol humano (Comprador, Auditor, etc.) sino **"Sistema"**. El endpoint HTTP está pensado para Módulo B, que todavía no existe en este sprint — mismo patrón de integración futura ya aceptado en el Backlog para HU-A10 (servicio centralizado, contrato estable, sin usuario técnico inventado). Módulo D, que sí existe hoy, no consume el endpoint HTTP: invoca `obtenerCostoReposicionVigente()` directo desde la capa de servicio, intra-proceso, sin pasar por `withPermission` ni por HTTP.

Durante el desarrollo se corrigieron 2 discrepancias reales entre los documentos de diseño (`propose`/`spec`/`design`/`tasks` `_FINAL.md`) y el schema/código real del proyecto, y se resolvieron con evidencia real las 9 verificaciones técnicas que la Spec dejaba abiertas para Apply (ver "Correcciones durante el desarrollo"). Toda la capa de código (T1-T9) y los 8 casos de testing (T10-T17, con un subcaso extra de cobertura) están cerrados con evidencia real.

## Objetivo

Darle a cualquier proceso que necesite calcular márgenes o decidir compras (hoy Módulo D intra-proceso, a futuro Módulo B vía HTTP) una única fuente de verdad para "cuánto cuesta hoy reponer esta variante", sin que ese proceso tenga que conocer la lógica de homologación de proveedores, de vigencia de listas de precio, ni de desempate entre proveedores con el mismo precio.

## Alcance

**Implementado en este PR:**

- Endpoint `GET /api/proveedores/costo-reposicion/[variante_sku_id]`, gateado por el permiso granular nuevo `proveedores:leer_costo_reposicion`.
- Algoritmo de 3 pasos: (C) descubrimiento acotado de proveedores candidatos en una sola query, (D+E) resolución de vigencia por candidato en paralelo, (F) selección del ganador con desempate de 3 criterios.
- Respuesta `200` con `variante_sku_id`, `proveedor_id`, `precio_unitario`, `fecha_inicio_vigencia`, `criterio_seleccion` (siempre `"MENOR_PRECIO_VIGENTE"` en esta HU).
- `404 SIN_COSTO_REPOSICION_DISPONIBLE` cuando no hay ningún candidato (variante sin proveedor homologado con ítem vigente, o variante inexistente — fusionados a propósito, anti-fuga de existencia).
- `400 VALIDATION_ERROR` cuando `variante_sku_id` no es un UUID válido.
- Permiso `proveedores:leer_costo_reposicion`, sembrado en el catálogo, **sin asignar a ningún rol humano de producción**.

**Fuera de alcance de este PR:**

- Cualquier interfaz de usuario, Server Action, o consumo desde una pantalla. Esta HU es 100% contrato de backend servicio-a-servicio.
- `proveedor_preferente_id` como criterio de desempate alternativo. El desempate es siempre por menor precio vigente — ver "Reglas de negocio implementadas" para la investigación completa que respalda esta decisión.
- Cualquier mecanismo de autenticación inter-servicio nuevo (API key, token de servicio, usuario técnico). `withPermission` sigue siendo el único guardián HTTP; la emisión de credenciales para un futuro Módulo B queda explícitamente fuera de esta HU.
- Exports de no-cache (`dynamic`/`revalidate`/`fetchCache`) en el Route Handler — se investigó y se confirmó que hubieran sido código muerto (ver corrección #5 más abajo).
- Cambios de schema Prisma. No hay migración de datos.

## Modelo de datos

No se modificó `schema.prisma`. Todos los modelos consumidos (`Proveedor`, `ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem`, `VarianteSKU`) ya estaban migrados de HUs anteriores (HU-H2, HU-H7).

Cadena de relaciones real usada para el descubrimiento de candidatos (confirmada contra el schema, no asumida — ver corrección #1): `Proveedor.listas_precio → ListaPrecio[].versiones → ListaPrecioVersion[].items → ListaPrecioItem[]`. Son **3 niveles de anidamiento**, no 2 — no existe ninguna relación directa `Proveedor.versiones` ni `ListaPrecioVersion.proveedor_id`.

`ListaPrecioItem.precio_unitario` es `Decimal @db.Decimal(10, 2)`, no `number` — se convierte con `Number(...)`, misma conversión ya usada en HU-H7.

## Reglas de negocio implementadas

**Descubrimiento acotado de candidatos, en una sola query (Paso C).** `descubrirCandidatosAcotados` filtra `Proveedor` por `estado = "HOMOLOGADO"`, `is_active = true`, `deleted_at = null`, anidado a través de `listas_precio.some → versiones.some → items.some` (con `is_active`/`deleted_at` en cada nivel intermedio, `publicada: true` a nivel de versión, `variante_sku_id` + `is_active: true` a nivel de ítem). El filtro por variante va **dentro** de esta query de descubrimiento, no como N llamadas posteriores a `resolverListaPrecioVigente` sobre proveedores irrelevantes — evita un N+1 evitable sobre todo el padrón de proveedores.

**Resolución de vigencia por candidato, en paralelo (Pasos D+E combinados).** `resolverItemVigente` delega en `resolverListaPrecioVigente()` (HU-H2, reutilizada, no reimplementada) para resolver la versión vigente de cada candidato, y busca el `ListaPrecioItem` puntual de esa versión para la variante pedida (`is_active: true`, `deleted_at: null`). El orquestador resuelve todos los candidatos con `Promise.all`, no con un bucle secuencial: no hay dependencia de orden (el desempate final ya lo define `seleccionarGanador`), no hay transacción ni estado mutable compartido entre candidatos, y el volumen es acotado (1-5 candidatos típicos).

**Selección del ganador — desempate de 3 criterios, confirmado por Tomás.** Ante candidatos con distinto `precio_unitario`, gana el menor. Ante **empate exacto** de precio, el desempate es: `precio_unitario ASC` → `fecha_inicio_vigencia DESC` (más reciente primero) → `proveedor_id ASC` (lexicográfico, comparación de strings directa, sin `localeCompare`, cuyo resultado puede variar según el locale/ICU del entorno). Este desempate de 3 niveles fue una decisión de producto confirmada explícitamente por Tomás durante el Propose — evita comportamiento no determinístico en un servicio que otros módulos consumen para calcular márgenes reales.

**`proveedor_preferente_id` — decisión de NO implementarlo en esta HU, con investigación real.** El único campo con nombre similar en todo el schema, `ProductoMaestro.proveedor_preferente`, es un campo `String?` puramente descriptivo de Módulo A, **sin ninguna FK ni relación a `Proveedor`** — confirmado contra el commit fundacional que introdujo el proveedor habitual por variante y contra `docs/modulos/modulo A/PROVEEDOR_OBLIGATORIO_VARIANTE_SKU.md` ("`ProductoMaestro.proveedor_preferente` es un campo distinto y no relacionado — no se tocó"). No hay ningún mecanismo real de "proveedor preferente" reutilizable en el proyecto. El tipo `CriterioSeleccionCostoReposicion` conserva `"PROVEEDOR_PREFERENTE"` en la unión únicamente por estabilidad de contrato a futuro; el servicio de esta HU nunca lo emite. Implementarlo requeriría una migración nueva con una FK real — deuda futura explícitamente fuera de HU-H8.

**Permiso servicio-a-servicio, sin usuario/rol técnico en el seed.** `proveedores:leer_costo_reposicion` se sembró en el catálogo de permisos (necesario para que `withPermission` lo pueda validar) sin asignarlo a ningún rol humano de producción ni exponerlo en ningún menú. Se investigó si existía un usuario/rol técnico reutilizable en el seed: no existe ninguno. El precedente citado en el Propose, HU-A10 (`inventario:reservar_stock` / `inventario:confirmar_reserva`), **no resultó ser análogo**: en el seed real esos dos permisos terminaron asignados directamente a roles humanos (`ENCARGADO_DEPOSITO` + `ADMINISTRADOR`), no dejados sin asignar a la espera de un fixture — la hipótesis del Propose no se confirmó. No se replicó ese patrón: la decisión de diseño de esta HU es explícita y no depende de ese precedente. La asignación para tests se resuelve con un fixture puntual, no con un usuario de producción.

## Arquitectura y archivos

**Archivos nuevos:**

- `src/lib/schemas/costo-reposicion.schema.ts` — `CostoReposicionParamsSchema` (Zod, archivo separado — mismo criterio de HU-H6/HU-H7 de mantener los schemas en `src/lib/schemas/`) y el tipo inferido `CostoReposicionParams`.
- `src/lib/services/proveedores/costo-reposicion.service.ts` — 1 función pública (`obtenerCostoReposicionVigente`) y 3 auxiliares privadas (`descubrirCandidatosAcotados`, `resolverItemVigente`, `seleccionarGanador`), más los tipos de apoyo `CriterioSeleccionCostoReposicion`, `CostoReposicionVigente`, `Candidato`, `ItemVigenteCandidato`, `CandidatoResuelto`.
- `src/app/api/proveedores/costo-reposicion/[variante_sku_id]/route.ts` — Route Handler `GET`, envuelto en `withPermission`, `context.params: Promise<{...}>`.
- `src/lib/services/proveedores/costo-reposicion.http.integration.test.ts` — suite de integración HTTP end-to-end (T10-T17), ver "Verificación".

**Archivos modificados:**

- `prisma/seed.ts` — permiso `proveedores:leer_costo_reposicion` (solo catálogo, sin asignación a rol).
- `package.json` — script `test:integration:h8-http`.

Orden de dependencia de creación (de hojas a raíz): schema → servicio → route. El schema se crea primero por ser hoja sin dependencias nuevas; el servicio no depende de ningún archivo nuevo (solo de `resolverListaPrecioVigente`, HU-H2, ya existente); el route cierra la cadena una vez que schema y servicio exponen contratos estables. Sin barrels/`index.ts` intermedios — mismo criterio que HU-H6/HU-H7.

## Correcciones durante el desarrollo

Ocho correcciones/verificaciones reales se detectaron durante el pipeline de esta HU (relevamiento previo + implementación + testing), verificando los documentos de diseño ya cerrados contra el schema, el código real del proyecto, y — en un caso — la propia Spec de testing de esta misma HU. Ninguna quedó sin resolver antes de este cierre:

1. **Relación Prisma real de 3 niveles, no 2 (T4).** El Design original de `descubrirCandidatosAcotados` asumía una relación directa `Proveedor.versiones` que no existe — ni siquiera hubiera compilado contra el schema real (`Unknown field versiones on ProveedorWhereInput`). La relación real es `Proveedor.listas_precio → ListaPrecio[].versiones → ListaPrecioVersion[].items`. Se corrigió con el precedente exacto ya implementado en HU-H7 (`comparativa-precios.service.ts:111-140`, `resolverCandidatosPorVariante`), incluyendo los filtros `deleted_at: null` en los tres niveles.

2. **Filtro por `ListaPrecioItem` movido al descubrimiento acotado, no como N llamadas posteriores.** El propio Propose ya identificaba el riesgo de N+1 (invocar `resolverListaPrecioVigente` sobre todo el padrón de proveedores). Se cerró moviendo el filtro por `variante_sku_id` + `is_active` **dentro** de la query única de `descubrirCandidatosAcotados` (Paso C), acotando el universo real de proveedores a resolver en el Paso D+E a los que efectivamente tienen un ítem para esa variante (típicamente 1-5, no todo el padrón).

3. **Firma real de `resolverListaPrecioVigente` — posicional, sin soporte para `ahora` inyectado (T5).** El Design/Spec asumían un options object `{ prisma, ahora }`. La firma real (`lista-precios.service.ts:641-647`) es posicional: `(proveedor_id, variante_sku_id?, tx?)`. Más importante: esa función **no acepta `ahora` inyectado en ningún punto** — su helper interno hardcodea `new Date()`. Se aceptó esta limitación como decisión de diseño: el parámetro `ahora` del orquestador `obtenerCostoReposicionVigente` queda en el contrato público por consistencia, pero no se propaga a esta llamada. Se rechazaron dos alternativas (extender la función compartida de HU-H2, o reimplementar la resolución de vigencia localmente) por blast radius innecesario y por contradecir la decisión ya cerrada de reutilizar, no reimplementar. Impacto acotado al Caso 6 de testing (no-cache), que de todas formas es una prueba de integración en tiempo real.

4. **Sin exports de no-cache — hubieran sido código muerto (T8).** El Design/Propose asumían necesarios `dynamic`/`revalidate`/`fetchCache`. Confirmado contra la documentación oficial de Next 16.3.4 (bundleada en `node_modules`) que los Route Handlers GET **no cachean por defecto** — esos exports existen para _habilitar_ cacheo, no para prohibirlo. Ningún `route.ts` real del proyecto los usa tampoco. Agregarlos hubiera sido código muerto.

5. **Códigos de error reales `VALIDATION_ERROR`/`INTERNAL_ERROR` — patrón mayoritario del módulo, no el de HU-H7 (T9).** El Propose/Spec originales asumían `VALIDACION_RUTA_INVALIDA`/`INTERNAL_SERVER_ERROR`, copiando el patrón en español de `comparativa-precios/route.ts` (HU-H7). Se contaron los 5 Route Handlers reales del módulo: 4 de 5 (`proveedores/[id]/route.ts` de H1, `[id]/lista-precios/route.ts` de H2, `auditoria/route.ts` de H6, `verificar-cadena/route.ts` de D.3) usan `VALIDATION_ERROR`/`INTERNAL_ERROR` en inglés. HU-H7 resultó ser la **excepción** del módulo, no la convención — se agregó una nota retroactiva a `HU7_MODULO_H.md` aclarando esto (ya reflejada en su sección "Decisiones sujetas a revisión"), sin tocar el código de H7 ya mergeado. HU-H8 adopta el patrón mayoritario real: `VALIDATION_ERROR` (400) / `INTERNAL_ERROR` (500).

6. **`params` como `Promise<{...}>` (T8).** Confirmado contra `with-permission.ts:42` y contra route.ts reales del proyecto con path param dinámico — mismo patrón que H1/H2, sin sorpresas de versión.

7. **Corrección de las queries SQL de ejemplo de la propia Spec de testing de esta HU (T10-T17, hallazgo N10).** Las 6 queries SQL de evidencia de `spec_HU-H8_FINAL.md` §6 asumían una columna `lpv.proveedor_id` directa sobre `listas_precio_version`, que no existe en el schema real — esa FK vive en `listas_precio`, su padre (confirmado real contra Postgres: `column lpv.proveedor_id does not exist`). El join correcto de 4 tablas es `listas_precio_item → listas_precio_version → listas_precio → proveedores`. **No afectó el código de producción** — ese join nunca se implementó ahí, solo en las queries de ejemplo del propio documento de testing. Corregido tanto en el archivo de test real como en las 6 queries de ejemplo de `spec_HU-H8_FINAL.md` §6, con nota de consolidación agregada al documento — la Spec queda copy-pasteable de nuevo.

8. **Comentario desactualizado en `costo-reposicion.schema.ts` (cosmético, sin impacto de comportamiento).** El comentario de cabecera del schema todavía citaba `VALIDACION_RUTA_INVALIDA` (nombre pre-corrección #5). Corregido a `VALIDATION_ERROR` — cambio de un comentario, sin tocar lógica.

## Un comportamiento de `resolverListaPrecioVigente` expuesto con más claridad durante esta HU

Durante el armado de los fixtures de testing se hizo evidente un comportamiento de `resolverListaPrecioVigente` (HU-H2) que ya existía desde su implementación original, pero que ninguna HU anterior había ejercitado de una forma que lo expusiera con tanta claridad: la "versión vigente" de un proveedor se resuelve de forma **global** — la `ListaPrecioVersion` publicada con `fecha_inicio_vigencia` más reciente entre **todas** las listas de precio de ese proveedor, sin filtrar por variante — y recién **después** se chequea si esa versión puntual trae un `ListaPrecioItem` para la variante pedida. Si no lo trae, la función devuelve `null` directamente; no "busca más atrás" en versiones anteriores que sí podrían tener la variante. Esto es una decisión de diseño ya cerrada de HU-H2 (documentada en `lista-precios.service.ts:229-243`: "la ausencia de esa variante en la versión vigente es información válida... no un caso a resolver buscando más atrás"), **no un bug** de esta HU ni de H2. La implicancia práctica para cualquier fixture o dato real: un mismo proveedor no puede tener ítems "vigentes" simultáneos para dos variantes distintas si sus versiones respectivas tienen fechas distintas — solo cuenta la última.

## Verificación

**Verificación en runtime, no solo compilación.** Se ejecutaron los 8 casos de testing definidos (T10-T17 de `tasks_HU-H8_FINAL.md`, más un subcaso extra de cobertura) contra un servidor `next dev` real y la base PostgreSQL real de desarrollo, autenticando por HTTP vía el endpoint de login real — no simulado.

**Fixtures de datos creados para la verificación** (documentados acá, no en "Alcance" — no son parte del comportamiento de la HU): el permiso `proveedores:leer_costo_reposicion` no está asignado a ningún rol del seed, así que se armó un Rol/Usuario de fixture propio del archivo de test, con ese permiso y con `proveedores:publicar_lista` (necesario solo para poder ejecutar el POST real de HU-H2 del Caso 6). Cada caso de testing usa su(s) propio(s) `Proveedor`/`VarianteSKU` dedicado — nunca un proveedor compartido entre casos, precisamente por el comportamiento de resolución global de `resolverListaPrecioVigente` descripto arriba. Todos los fixtures (proveedores, variantes, listas/versiones/ítems, rol) se crean y destruyen dentro del propio test (`t.after`). El `Usuario`/`Rol` de fixture terminan con **baja lógica permanente**, no `DELETE`: el POST real del Caso 6 generó una fila de `AuditLog` con FK `Restrict` hacia ese usuario (ledger append-only, nunca se borra ni se reescribe) — mismo comportamiento que tendría la baja real de cualquier usuario del sistema que haya operado alguna vez, no un leak de datos de test.

**Resultado de los 8 casos:**

| Caso | Descripción                                                                                                   | Resultado                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| T10  | Camino feliz, candidato único                                                                                 | `200`, `criterio_seleccion: "MENOR_PRECIO_VIGENTE"`, precio y proveedor confirmados exacto contra SQL directo                                |
| T11  | Múltiples candidatos, distinto precio                                                                         | `200`, gana el de menor `precio_unitario`, confirmado contra `ORDER BY precio ASC`                                                           |
| T12  | Empate exacto de precio → desempate por fecha (+ subcaso extra: triple empate → desempate por `proveedor_id`) | `200` en ambos, gana la `fecha_inicio_vigencia` más reciente; en el subcaso de empate total, gana el `proveedor_id` lexicográficamente menor |
| T13  | Sin candidato                                                                                                 | `404 SIN_COSTO_REPOSICION_DISPONIBLE`, confirmado `COUNT(*) = 0`                                                                             |
| T14  | `variante_sku_id` con formato inválido (3 variantes de string)                                                | `400 VALIDATION_ERROR` en los 3 casos; verificado por lectura de código que no se ejecuta ninguna query cuando falla la validación           |
| T15  | No-cache                                                                                                      | Publicada una nueva `ListaPrecioVersion` vía endpoint real de HU-H2; el segundo GET, sin reiniciar el proceso, refleja el precio nuevo       |
| T16  | Autorización (sin sesión / sin permiso / con permiso)                                                         | `401` sin sesión, `403` sin el permiso, `200` con el permiso — los 3 contra el servidor real                                                 |
| T17  | Ítem con borrado lógico (`is_active = false`)                                                                 | `404`, no expone el precio del ítem borrado — confirmado que ni el Paso C ni el Paso E lo dejan pasar                                        |

Los 8 casos, más el subcaso de empate total, pasaron con el comportamiento esperado.

## Decisiones sujetas a revisión

- **`proveedor_preferente_id` como desempate alternativo.** Deuda futura explícitamente fuera de esta HU — requeriría una migración nueva con una FK real hacia `Proveedor`, no reutilizable desde `ProductoMaestro.proveedor_preferente` (campo distinto y sin relación, ver "Reglas de negocio implementadas"). Si en algún momento se decide implementarlo, es un cambio de diseño que afecta el contrato de `criterio_seleccion` de esta HU, no un ajuste menor.
- **Sin usuario/rol técnico para el permiso servicio-a-servicio.** El permiso queda sembrado sin asignar. Si Módulo B llega a implementarse con una necesidad real de autenticación inter-servicio, esa emisión de credenciales es un diseño nuevo que queda completamente fuera de esta HU — no se anticipó ningún mecanismo acá.
