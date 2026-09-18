# HU-H2 — Publicación de Lista de Precios de Proveedor (Módulo H)

**Issue de GitHub:** _(a completar por Tomás al abrir el PR)_
**Rama:** `feature/HU-H2-lista-precios-proveedor`
**Sprint:** Sprint 3, Módulo H (Proveedores y Abastecimiento)
**Rol:** Comprador / Supervisor de Compras

## Resumen

Se implementó el registro de nuevas versiones de lista de precios de un proveedor, con vigencia, validación de variación porcentual contra un umbral crítico, y bloqueo de la publicación hasta aprobación del Supervisor de Compras cuando ese umbral se supera. Toda la operación queda auditada con un evento SHA-256 encadenado hacia el Módulo D. La implementación incluye capa de servicios, Server Action, y dos endpoints HTTP; no agrega interfaz de usuario (ver "Fuera de alcance"). Como parte de esta HU se migró también HU-H3 (Emisión de Orden de Compra), que hasta ahora resolvía el precio vigente contra un seed temporal, para que use el mecanismo real construido acá.

## Objetivo

Controlar el impacto de las variaciones de precio de insumos sobre los márgenes de rentabilidad del negocio, con trazabilidad auditada, permitiendo a Compras registrar nuevas listas de precios sin sobrescribir el historial y sin que una variación de precio significativa pase sin control de un Supervisor.

## Alcance

**Implementado en este PR:**

- Publicación de una nueva `ListaPrecioVersion`, siempre como versión nueva e inmutable — nunca se actualiza una versión existente.
- Cálculo de variación porcentual por ítem contra la versión previamente vigente, excluyendo del cálculo los ítems sin precio previo (variante nueva o primera publicación completa), sin asignarles ningún valor artificial.
- Bloqueo de la publicación (`requiere_aprobacion = true`) cuando la variación máxima supera el umbral crítico parametrizado, y endpoint de aprobación exclusivo del Supervisor de Compras.
- Vínculo de cada Orden de Compra a la versión de lista vigente en el momento de su emisión, vía la migración de HU-H3 (ver "Migración de HU-H3" más abajo) — sin alterar retroactivamente órdenes ya emitidas ante publicaciones posteriores.
- Evento de auditoría SHA-256 encadenado (`proveedor:variacion_precio_critica`) ante toda variación crítica, y evento separado (`proveedor:lista_precio_aprobada`) al aprobar.
- Migración de HU-H3: `resolverContextoPrecios()` ahora invoca la función compartida `resolverListaPrecioVigente()` en vez de su query manual — mismo mecanismo que van a reusar HU-H7 y HU-H8.

**Fuera de alcance de este PR:**

- Cualquier interfaz de usuario. Se verificó explícitamente (Glob/Grep en todo `src/app`) que ningún componente visual consume la Server Action ni los endpoints, y se confirmó contra el Product Backlog que los 5 criterios de aceptación de HU-H2 son 100% de comportamiento de backend — la UI (vista comparativa, historial) está descripta a nivel de subcomponente en el Alcance Funcional, pero corresponde a HU-H6/H7/H8, no a esta HU.
- Entidad de configuración global para el umbral crítico. Se usó una constante de código (`UMBRAL_VARIACION_CRITICA_PORCENTUAL = 20`, en `lista-precios.constants.ts`), mismo criterio que ya usa el proyecto para `UMBRAL_MINIMO_HOMOLOGACION` (HU-H5) — no existe en ningún módulo una entidad de configuración parametrizable por Dirección, y no se creó una para esta HU. **Este valor queda marcado explícitamente como pendiente de validación con Dirección** (ver "Decisiones sujetas a revisión").
- Corrección del bug de precisión numérica en el mecanismo de auditoría del Módulo D (ver "Hallazgo fuera de alcance de esta HU" más abajo) — pertenece a infraestructura de Sprint 1, no a HU-H2.

## Modelo de datos

No se modificó `schema.prisma` en esta HU. Los modelos `ListaPrecio`, `ListaPrecioVersion` y `ListaPrecioItem` ya estaban migrados desde una migración anterior del proyecto (`20260831050501_add_lista_precio_and_proveedor_bank_data`) y no necesitaron ningún campo nuevo — todas las reglas de negocio de esta HU se resolvieron en código de aplicación.

`ListaPrecio` se mantiene 1:N respecto a `Proveedor` (sin `@@unique([proveedor_id])`) — confirmado contra el Documento de Alcance Funcional §2.2 ("Cada proveedor mantiene una o más listas de precios versionadas"), no es una ambigüedad de schema sino cardinalidad correcta tal como está.

`OrdenCompraItem` no tiene una FK `lista_precio_version_id` — el vínculo con la versión usada al emitir una orden vive únicamente en el payload del evento de dominio `orden_compra:creada`, nunca como columna persistida (esto ya era así antes de esta HU, en el código de HU-H3).

## Reglas de negocio implementadas

**Cálculo de variación porcentual.** Por cada ítem de la publicación, se calcula `((precio_nuevo - precio_previo) / precio_previo) * 100` contra el precio de esa misma variante en la versión previamente vigente. Si el ítem no tenía precio previo (variante nueva agregada a una lista existente, o primera publicación completa del proveedor), ese ítem se excluye del cálculo — no aporta ni `0%` ni `100%` de forma artificial. `variacion_porcentual_maxima` es el máximo entre los ítems que sí tenían precio previo; si ninguno lo tenía, queda en `0`.

**Primera publicación, sin rama de código especial.** Cuando `variacion_porcentual_maxima` da `0` (todos los ítems sin precio previo), el flujo normal de comparación contra el umbral ya resuelve `publicada = true` sin aprobación, porque `0` nunca supera un umbral positivo. No existe un `if` separado para "es la primera publicación" — es deliberado: una rama especial abriría una vía de publicación sin control para un Comprador sin el permiso `_critica`.

**Umbral crítico.** Constante de código `UMBRAL_VARIACION_CRITICA_PORCENTUAL = 20`, en `lista-precios.constants.ts`, mismo patrón que `evaluacion.constants.ts` (HU-H5). No hay entidad de configuración global en el proyecto; ninguna se creó para esta HU. Valor sujeto a validación con Dirección (ver más abajo).

**Gate de permiso en el camino crítico.** `publicarNuevaVersionListaPrecio` NO chequea ningún permiso adicional cuando la variación supera el umbral — un Comprador (con `proveedores:publicar_lista`) que supera el umbral simplemente obtiene `requiere_aprobacion = true`. Esto se verificó explícitamente contra la matriz RBAC del Alcance Funcional §5, que modela la fila "Publicar variación de precio por encima del umbral crítico" como Comprador `△ solicita` / Supervisor `✓ directo` — el "directo" del Supervisor es exactamente `aprobarListaPrecioVersion`, que sí exige `proveedores:publicar_lista_critica`.

**Validación de proveedor.** `validarProveedorHomologado` cubre, en una sola lectura, existencia (`404 PROVEEDOR_INEXISTENTE`) y homologación (`422 PROVEEDOR_NO_HOMOLOGADO`) — este helper no estaba en la primera versión del diseño de esta HU y se agregó tras una auditoría cruzada contra la Spec (ver "Correcciones durante el desarrollo").

**Emisión de eventos, patrón fire-and-forget.** Mismo patrón ya usado en Módulo D: el evento se emite después del `COMMIT`, nunca dentro de la transacción. Mitigación del riesgo conocido (pérdida de evento entre commit y emit): un log previo a la emisión que deja registrada la intención, documentado como deuda técnica conocida.

## Arquitectura y archivos

**Archivos nuevos:**

- `src/lib/services/proveedores/lista-precios.constants.ts` — `UMBRAL_VARIACION_CRITICA_PORCENTUAL`.
- `src/lib/services/proveedores/lista-precios.service.ts` — 3 funciones públicas (`publicarNuevaVersionListaPrecio`, `aprobarListaPrecioVersion`, `resolverListaPrecioVigente`) y 10 auxiliares privadas (`validarProveedorHomologado`, `validarExistenciaVariantes`, `validarFechaNoDuplicada`, `calcularVariacionPorcentual`, `calcularVariacionMaximaDelLote`, `debeRequerirAprobacion`, `obtenerVersionVigente`, `construirItemsVersion`, `emitirVariacionCriticaSiCorresponde`, `emitirListaAprobada`).
- `src/lib/schemas/lista-precios.schema.ts` — `PublicarListaPreciosSchema` (Zod), reusa `ProveedorIdSchema` ya existente en `proveedores.schema.ts`.
- `src/app/(dashboard)/compras/listas-precios/actions.ts` — Server Action `publicarListaPrecios()`.
- `src/app/api/proveedores/[id]/lista-precios/route.ts` — Route Handler `POST`.
- `src/app/api/proveedores/[id]/lista-precios/[version_id]/aprobar/route.ts` — Route Handler `PATCH`.

**Archivos modificados:**

- `src/lib/events/event-types.ts` — se agregaron `ProveedorVariacionPrecioCriticaPayload` (con `usuario_id`, `proveedor_id`, `lista_precio_version_id`, `variacion_porcentual_maxima`, y el array anidado `items_variacion_critica`) y `ProveedorListaPrecioAprobadaPayload`, y sus entradas en `DomainEventMap`.
- `src/lib/events/listeners/audit-log.listener.ts` — dos ramas nuevas (`VARIACION_CRITICA`, `LISTA_PRECIO_APROBADA`) que invocan `registrarAuditLog()`. El service (`lista-precios.service.ts`) nunca llama a `registrarAuditLog()` directamente — solo emite eventos; una llamada directa además del evento duplicaría el registro de auditoría.
- `src/lib/services/proveedores/orden-compra.service.ts` — dentro de `resolverContextoPrecios()`, se reemplazó únicamente el paso de resolución de la versión vigente (antes una query manual `tx.listaPrecioVersion.findFirst(...)`) por una llamada a `resolverListaPrecioVigente(proveedorId, undefined, tx)`. Los otros tres pasos de esa función (validación de proveedor homologado, validación de variantes activas, armado del Map de precios) no se tocaron — pertenecen a HU-H3, no a esta HU.
- `docs/specs/spec_modulo_H.md` — actualizadas las 3 referencias a la migración pendiente de HU-H3 (sección 2.3, sección 2.4, y la nota de acción de Sprint 3) para reflejar que la migración ya se hizo y que el seed temporal del "Camino A" se mantiene como fixture de datos, no como mecanismo de resolución de precio.

## Firma pública corregida durante el desarrollo

`publicarNuevaVersionListaPrecio` quedó con 4 parámetros, no 3: `(proveedor_id, fecha_inicio_vigencia, items, usuario_id)`. La firma original de 3 parámetros (definida en Propose) no podía satisfacer su propio contrato de evento — `ProveedorVariacionPrecioCriticaPayload` exige `usuario_id`, que ninguna versión anterior de la firma recibía. Se agregó como 4to parámetro explícito, mismo patrón que `crearOrdenCompra(input, usuarioId)`.

## Correcciones durante el desarrollo

Tres correcciones reales se detectaron durante la implementación, mediante auditoría cruzada entre los documentos de diseño ya cerrados y el código real del proyecto — ninguna quedó sin resolver antes de mergear:

- **Helper de validación de proveedor faltante.** El primer diseño de la capa de servicios cubría la validación de variantes y de fecha duplicada, pero omitía por completo la validación de existencia/homologación del proveedor que la especificación ya exigía como primeros dos pasos del flujo. Se agregó `validarProveedorHomologado`.
- **Path de archivo documentado incorrectamente.** La documentación de diseño decía `src/lib/events/audit-log.listener.ts`; el archivo real del proyecto está en `src/lib/events/listeners/audit-log.listener.ts`. Se corrigió la documentación, no el código (el código ya apuntaba al archivo correcto).
- **Contradicción en el diagrama de flujo interno.** Una versión intermedia del diagrama de diseño mostraba una llamada directa a `registrarAuditLog()` dentro de la transacción de escritura, en todo camino — contradiciendo tanto la nota al pie del propio diagrama como los criterios de aceptación verificables de la especificación (que exigen cero filas nuevas de auditoría cuando la publicación no cruza el umbral). Se confirmó y documentó explícitamente: el service nunca llama a `registrarAuditLog()` directo, solo emite eventos.

## Verificación

**Verificación en runtime, no solo compilación.** Siguiendo el estándar del equipo (compilar o pasar unit tests nunca es evidencia suficiente por sí sola), se ejecutaron los 6 casos de prueba definidos, contra la base de datos de desarrollo real, en un orden estricto no arbitrario: proveedor inexistente → proveedor no homologado → primera publicación → bloqueo por umbral crítico → aprobación → publicación normal. Este orden es intencional: el caso de bloqueo por umbral está calibrado contra la versión vigente actual del proveedor de prueba, así que la publicación normal debe correr al final para no alterar esa base de comparación.

Para cada caso se verificaron tres capas de evidencia: la respuesta HTTP, el estado persistido en base de datos (vía SQL directo), y — para los dos casos que tocan auditoría — el encadenamiento de hash de la fila generada.

**Resultado de los 6 casos**, sobre una base de datos reseteada al estado limpio del seed real del proyecto:

| Caso                                   | Resultado                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Proveedor inexistente                  | `404 PROVEEDOR_INEXISTENTE`, cero filas creadas                                                                             |
| Proveedor no homologado                | `422 PROVEEDOR_NO_HOMOLOGADO`, cero filas creadas                                                                           |
| Primera publicación (sin lista previa) | `201`, `variacion_porcentual_maxima: 0`, sin fila de auditoría                                                              |
| Bloqueo por umbral crítico             | `201`, `publicada: false`, `requiere_aprobacion: true`, variación real `37.93%`, fila de auditoría con hash generado        |
| Aprobación de la versión bloqueada     | `200`, `publicada: true`, `aprobada_por_id` = usuario de sesión, nueva fila de auditoría con evento `LISTA_PRECIO_APROBADA` |
| Publicación normal (dentro del umbral) | `201`, `publicada: true`, variación real `5%`, cero filas de auditoría                                                      |

Los seis casos pasaron con el comportamiento esperado. El único hallazgo de la verificación runtime no es un defecto de código de esta HU, sino de un mecanismo compartido (ver siguiente sección).

**Verificación de la migración de HU-H3 (T15, Pieza 2) — sin evidencia documentada hasta ahora.** El Design de Pieza 2 marcó explícitamente un riesgo de regresión: tras migrar `resolverContextoPrecios()`, la resolución de precio de HU-H3 deja de mirar la versión histórica V1 sembrada (`LISTA_PRECIO_VERSION_ID`, "Camino A") y pasa a resolver contra la versión vigente real más reciente — con la consecuencia esperada de que las variantes que solo existen en V1 (`VARIANTE_CAMISA_TACTICA_3`, `VARIANTE_BORCEGOS_2`) empiecen a fallar con `422 SKU_SIN_PRECIO_VIGENTE` (T15, `tasks_HU-H2_FINAL.md`). Ningún documento de cierre anterior registra evidencia de que esto se haya confirmado. Se verificó ahora, en vivo, contra el código y la base de desarrollo actuales: `POST /api/ordenes-compra` con `VARIANTE_CAMISA_TACTICA_3` sobre `proveedorHomologado` devuelve `422 SKU_SIN_PRECIO_VIGENTE` tal como predice el Design; la misma orden con una variante de la versión vigente real (`VARIANTE_BORCEGOS_1`, publicada durante la verificación de esta HU) congela `precio_unitario = 63000` — el precio de la versión vigente real en ese momento, no el de V1 (`42000`) ni el original de V2 sembrado (`43500`). Confirma que la migración funciona de punta a punta contra datos reales, no solo a nivel de import/compilación.

## Hallazgo fuera de alcance de esta HU — bug de precisión en el mecanismo de auditoría (Módulo D)

Durante la verificación del caso de bloqueo por umbral, `verificarCadenaIntegridad()` reportó una rotura en la cadena SHA-256. Se investigó a fondo antes de asumir que era un defecto de esta HU, descartando con evidencia directa: reordenamiento de claves al persistir (`canonicalizarJson()` maneja correctamente arrays anidados de objetos), renormalización de Postgres/`jsonb` (verificado con un `SELECT` puro, el string numérico entra y sale byte-idéntico), y condición de carrera por referencia mutable (el cálculo del hash y el `INSERT` corren en el mismo tramo síncrono, sin ningún `await` entre medio).

La causa raíz real: `calcularHashEncadenado()` hashea los números de JavaScript a precisión completa (hasta 17 dígitos significativos), pero Prisma trunca los campos de tipo `Json` a 16 dígitos significativos al serializarlos hacia Postgres. Cualquier valor numérico que necesite ese 17mo dígito para representarse exacto (típicamente, el resultado de una división que no cae en un número redondo) genera una fila cuyo hash nunca vuelve a verificar. Se confirmó reproduciéndolo dos veces, en corridas frescas contra el código actual — no es una fila vieja de otro estado del código.

Este mecanismo (`hash-chain.ts`, `audit-log.service.ts`) es infraestructura de Módulo D construida en Sprint 1, no código de esta HU. El criterio de aceptación de HU-H2 sobre auditoría ("genera evento SHA-256 encadenado") se cumple: el hash que este código calcula es correcto sobre los datos reales; la rotura ocurre después, en la capa de persistencia compartida. Se reportó formalmente al integrante dueño de esa infraestructura, junto con un prompt de auditoría de impacto para dimensionar cuántos otros módulos podrían estar expuestos al mismo problema antes de decidir un fix — no se implementó ninguna corrección sobre código ajeno a esta HU.

## Decisiones sujetas a revisión

- **`UMBRAL_VARIACION_CRITICA_PORCENTUAL = 20`**: ningún documento del proyecto (Alcance Funcional, Backlog, ni la spec de Módulo H) cuantifica nunca el umbral — todos dicen "parametrizado por Dirección" sin número. Se fijó en 20 siguiendo el mismo criterio que `UMBRAL_MINIMO_HOMOLOGACION`, explícitamente marcado en código como pendiente de validación real con Dirección.
- **Bug de precisión del Módulo D**: no es una decisión de esta HU, pero su resolución (y con ella, la integridad completa del ledger de auditoría) queda pendiente de que el equipo de Módulo D decida una estrategia de fix — ver sección anterior.
