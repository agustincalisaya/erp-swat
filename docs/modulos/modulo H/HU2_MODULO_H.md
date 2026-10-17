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

---

> **Adenda — interfaz de usuario, agregada el 2026-09-26 (working tree, pendiente de commit).** Todo lo anterior en este documento describe el cierre original de HU-H2, que era 100% backend ("Fuera de alcance" arriba: "Cualquier interfaz de usuario"). Las dos secciones siguientes documentan la pantalla `/compras/listas-precios` construida después sobre ese mismo backend, con el mismo estándar de evidencia `archivo:línea` y el mismo formato adoptado en `HU3_MODULO_H.md` §3 y §7 (regenerado desde el código real, no desde notas de desarrollo). No se modifica ni se reescribe nada del contenido original de arriba.

## Cumplimiento de cada Criterio de Aceptación (interfaz de usuario)

La pantalla vive en `src/app/(dashboard)/compras/listas-precios/page.tsx` (RSC): resuelve sesión, calcula en paralelo `proveedores:publicar_lista` / `proveedores:publicar_lista_critica` / `proveedores:comparar_precios` (`page.tsx:65-69`) y redirige a `/no-autorizado` si el usuario no tiene ninguno de los dos primeros (`page.tsx:71`). Cada sección se oculta por separado según su propio permiso (`page.tsx:102`, `119`, `154`).

### ✅ Selección de proveedor y publicación de una nueva versión, con preview que no persiste nada

- **Selector de proveedor.** `SelectorProveedorListaPrecios.tsx` reusa `ComboboxFiltrable` sobre `listarProveedoresHomologados()` (`page.tsx:76-77`) — la lista que llega al combobox ya viene filtrada `estado = HOMOLOGADO` en el query (mismo mecanismo que documenta `HU3_MODULO_H.md` §5.1 para el selector de OC), no hay filtrado visual. El proveedor elegido pasa como `?proveedor=` en la URL (`SelectorProveedorListaPrecios.tsx:44`).
- **Preview sin persistencia.** El botón "Calcular variación" (`FormularioNuevaVersionListaPrecio.tsx:298-308`) invoca `calcularVariacion()` (`119-133`), que llama a la Server Action `previsualizarListaPreciosAction` (`actions.ts:128-171`), equivalente a `POST /api/proveedores/[id]/lista-precios/preview` (`src/app/api/proveedores/[id]/lista-precios/preview/route.ts`, gate `proveedores:publicar_lista`, el mismo permiso que publicar — `preview/route.ts:42-43`). Este endpoint es nuevo respecto del cierre original de HU-H2 (no figura en "Arquitectura y archivos" arriba). Ninguno de los dos caminos escribe en base: `previsualizarVariacionListaPrecios()` (`lista-precios.service.ts:694-733`) usa `prisma` directo, sin `tx` y sin ningún `create`/`update`.
- **Advertencia de umbral antes de confirmar.** Si `preview.requiere_aprobacion` es `true`, se muestra un `Alert` ámbar con el texto exacto *"La variación máxima calculada (…) supera el umbral de {preview.umbral}%. Si confirmás, la versión se publicará como pendiente de aprobación…"* (`FormularioNuevaVersionListaPrecio.tsx:286-296`), antes de que el usuario confirme — cumple la advertencia previa a la acción irreversible.
- **Persistencia real.** "Confirmar publicación" invoca `confirmarPublicacion()` (`135-158`), que llama a la Server Action `publicarListaPrecios` (`actions.ts:69-119`, ya existente en el cierre original de HU-H2), equivalente al `POST /api/proveedores/[id]/lista-precios` documentado arriba.

### ✅ El `POST` de publicación siempre responde `201`, incluso cuando queda pendiente de aprobación

- Verificado en el propio Route Handler: `route.ts:96` devuelve `NextResponse.json({ data: resultado, error: null }, { status: 201 })` de forma incondicional tras un `publicarNuevaVersionListaPrecio()` exitoso — la función nunca lanza una excepción por superar el umbral, solo devuelve `publicada: false` / `requiere_aprobacion: true` (`lista-precios.service.ts:485-488`, `539-546`). El `422`/`404` de la tabla `STATUS_POR_CODIGO` (`route.ts:35-41`) son exclusivamente para los `ServiceError` de precondición (proveedor inexistente/no homologado, fecha duplicada, ítems duplicados) — nunca para el resultado de negocio "requiere aprobación".
- **En la UI**, ese resultado se muestra como un estado, no como un error: `FormularioNuevaVersionListaPrecio.tsx:168-177` renderiza un `Alert` (ámbar si `requiere_aprobacion`, verde/esmeralda si no) con el texto *"Versión publicada. Pendiente de aprobación del Supervisor de Compras (superó el umbral de variación crítica)."* — nunca el `Alert variant="destructive"` que sí se usa para errores reales (`162-166`).

### ✅ Historial con los 4 estados agregados y quién publicó/aprobó cada versión

- **Los 4 estados** (`VIGENTE` / `HISTORICA` / `PENDIENTE_APROBACION` / `FUTURA`) los deriva `derivarEstadoListaPrecioVersion()` (`lista-precios.calculo.ts:140-148`), función pura cubierta por los 4 tests de estado del archivo de test (ver más abajo). Regla exacta, confirmada línea por línea:
  1. `!version.publicada` → `PENDIENTE_APROBACION` (línea 145). Por invariante documentado en el propio código (`lista-precios.calculo.ts:129-138` y `lista-precios.service.ts:488`: `publicada = !requiere_aprobacion` al crear la versión, y `aprobarListaPrecioVersion()` siempre pone ambos campos juntos — `service.ts:630-631`), esto ocurre exactamente cuando la versión quedó pendiente por superar el umbral crítico, nunca por otra razón.
  2. `version.fecha_inicio_vigencia > ahora` (con `publicada = true`) → `FUTURA` (línea 146).
  3. En cualquier otro caso, `esVigente ? "VIGENTE" : "HISTORICA"` (línea 147) — `esVigente` lo resuelve el llamador (`listarVersionesListaPrecio()`, `lista-precios.service.ts:769-815`) comparando el `id` de cada fila contra la versión que devuelve `obtenerVersionVigente(proveedor_id)` sin `variante_sku_id` (llamada en `795`, comparación en `809-813`); la "vigente" real de todo el módulo es la de mayor `fecha_inicio_vigencia` entre las `publicada = true` con `fecha_inicio_vigencia <= now()` (`service.ts:228-247`).
  - `EstadoListaPrecioVersionBadge.tsx:18-38` mapea los 4 valores a un badge de color (verde=Vigente, gris=Histórica, ámbar=Pendiente de aprobación, azul=Futura).
- **"Publicada por" / "Aprobada por".** `listarVersionesListaPrecio()` (`lista-precios.service.ts:769-815`) incluye las relaciones `creada_por`/`aprobada_por` (`nombre_completo`, `787-788`) en la misma query — no hay una segunda consulta ni N+1. La tabla del historial expone ambas columnas (`HistorialVersionesListaPrecio.tsx:102-103`) y sus celdas (`120-121`, con fallback `"—"` cuando `publicada_por_nombre`/`aprobada_por_nombre` es `null` — versiones sembradas antes de que `creada_por_id` existiera).
- **Botón "Aprobar" exclusivo del Supervisor.** La columna "Acción" y el botón solo se renderizan si `puedeAprobarCritica` es `true` (`HistorialVersionesListaPrecio.tsx:104`, `122-143`), resuelto en el RSC padre contra `proveedores:publicar_lista_critica` (`page.tsx:67`, `132`). Para una versión `PENDIENTE_APROBACION` sin ese permiso, la celda no existe — no es un botón deshabilitado, es la columna entera ausente. El botón invoca `aprobarListaPrecioVersionAction` (`actions.ts:190-233`), que revalida el mismo permiso server-side (`196-201`) antes de llamar a `aprobarListaPrecioVersion()` (ya existente en el cierre original).

### ✅ Contratos de los dos endpoints nuevos

| Endpoint | Gate | Notas |
|---|---|---|
| `POST /api/proveedores/[id]/lista-precios/preview` | `proveedores:publicar_lista` | `preview/route.ts:1-108`. `200` con el shape de `PreviewListaPreciosResultado` (`items[]`, `variacion_porcentual_maxima`, `requiere_aprobacion`, `umbral` — `lista-precios.calculo.ts:81-86`). No persiste nada. Mismos códigos de error de precondición que el `POST` real (`404`/`422`), sin `FECHA_DUPLICADA` (el preview no recibe fecha — `lista-precios.schema.ts:82-98`). |
| `GET /api/proveedores/[id]/lista-precios` | `proveedores:leer` | `route.ts:113-155`. `200` con `{ versiones: ListaPrecioVersionResumen[] }`. Gate de solo lectura, separado de `proveedores:publicar_lista` — mismo criterio que `ordenes_compra:leer` frente a `ordenes_compra:crear` documentado en `HU3_MODULO_H.md` §9.5. |

**Modelo de datos (agregado para la UI).** `ListaPrecioVersion.creada_por_id` (`schema.prisma:817`, nullable, FK `onDelete: Restrict` hacia `Usuario` vía la relación `"ListaPrecioVersionCreadaPor"` — `schema.prisma:68`, `831`) se agregó en la migración dedicada `prisma/migrations/20260926170301_lista_precio_version_creada_por/migration.sql`, no incluida en el cierre original de esta HU. Se completa con `usuario_id` (4to parámetro ya existente de `publicarNuevaVersionListaPrecio`, ver "Firma pública corregida durante el desarrollo" arriba) en `lista-precios.service.ts:511`. Nullable porque las versiones sembradas antes de esta migración no tienen ese dato — de ahí el fallback `"—"` en la UI.

## Bugs encontrados y corregidos — línea de tiempo real (interfaz de usuario)

Reconstruida sobre el mismo working tree (sin commits todavía — "pendiente de commit (working tree, 2026-09-26)" en cada punto donde `HU3_MODULO_H.md` citaría un hash). Cuatro bugs reales se encontraron y corrigieron durante la construcción de la UI de esta HU:

### Bug 1 — Zona horaria: `fecha_inicio_vigencia` se mostraba un día antes

Misma clase de bug que el Bug 1 de HU-H3 (`HU3_MODULO_H.md` §7: *"Zona horaria: la fecha de entrega se mostraba un día antes"*) — el mismo mecanismo, en una pantalla distinta.

- **Causa raíz.** `fecha_inicio_vigencia` es un valor date-only (`z.coerce.date()` sobre un `<input type="date">`), persistido a medianoche UTC. Formateado con la zona horaria local del servidor/navegador (UTC-3 en Argentina), `2026-10-01T00:00:00Z` se mostraba como "30 sept".
- **Fix.** `timeZone: "UTC"` fijado explícitamente en los dos formateadores de fecha-solo de esta UI: `HistorialVersionesListaPrecio.tsx:49-53` (función `fecha()`, con el razonamiento documentado en el docstring `41-48`) y `ComparativaPreciosCard.tsx:137-139` (mismo `Intl.DateTimeFormat`, con el comentario `133-136` que remite explícitamente a `HistorialVersionesListaPrecio` como "misma corrección").
- **Qué NO se tocó.** Los timestamps `created_at` de la tabla de auditoría (HU-H6, ver ese documento) son instantes reales (`new Date()` del servidor) y se muestran deliberadamente en hora local — igual que `fecha_envio`/`fecha_confirmacion`/`fecha_cierre` en HU-H3 (§7, Bug 1, "Detalle de diseño del fix").
- **Descartado.** Cambiar la persistencia a hora local: alteraría un dato que otros módulos/tests ya consumen como medianoche UTC; el valor guardado es correcto, solo la lectura estaba mal.

### Bug 2 — UUID en vez de nombre en "Aprobada por" (parte del historial de esta HU)

- **Síntoma.** La columna "Aprobada por" del historial mostraba `aprobada_por_id` crudo (un UUID) en vez del nombre del Supervisor.
- **Fix.** Se agregó el `include` de las relaciones `aprobada_por`/`creada_por` (`nombre_completo`) a la misma query de `listarVersionesListaPrecio()` (`lista-precios.service.ts:787-788`), consumido por `HistorialVersionesListaPrecio.tsx:120-121`.
- **Descartado.** Un join manual o una segunda query por fila (N+1): el `include` de Prisma resuelve ambos nombres en la misma consulta que ya trae las versiones.
- Esta misma clase de bug afectó también a la tabla de auditoría de proveedores (columnas "Usuario responsable"/"Proveedor") — ver `HU6_MODULO_H.md`, que documenta esa parte con un mecanismo distinto (batch separado, no `include`, porque el dato vive dentro del JSON del evento) para no duplicar la explicación acá.

### Bug 3 — Texto de proceso interno visible en la UI

- **Síntoma.** Una nota transitoria en el historial explicaba, en texto plano dirigido al usuario final, que "quién publicó" la versión no se guardaba todavía (antes de que existiera `creada_por_id`) — una referencia a un reporte de cierre de tarea, no información de negocio.
- **Fix.** El texto se eliminó por completo al agregarse `creada_por_id` (ver "Modelo de datos" arriba): ya no hace falta explicar una ausencia de dato que dejó de existir. Confirmado por grep (`Ver reporte de cierre`) sobre todo `src/`: cero resultados en el estado actual del working tree.
- Se revisaron además el resto de los strings renderizados de las dos pantallas de esta UI (Lista de Precios y Auditoría de Proveedores) buscando otro texto de proceso interno equivalente — no apareció ninguno más.

### Bug 4 — Ruptura de la cadena SHA-256 por precisión de punto flotante en el evento de HU-H2

El hallazgo original de precisión numérica del ledger ya está documentado arriba, en "Hallazgo fuera de alcance de esta HU", como un riesgo de infraestructura de Módulo D **no resuelto** (reportado al dueño de esa infraestructura, sin fix). Este bug es la misma familia de problema —pérdida de precisión de un `double` en el viaje de ida y vuelta por `jsonb`— pero reproducida de forma concreta contra el evento que esta HU emite, y corregida acá, en el punto de emisión, sin tocar Módulo D.

- **Evidencia.** Al publicar una versión crítica de 2 ítems sobre "Suministros Tácticos Cuyo S.A." (proveedor sembrado en esta misma sesión, `prisma/seed.ts:2237-2252`, con precios vigentes previos de `15600`/`45200` para las dos variantes — `seed.ts:2279-2281`) con precios nuevos de `20000` y `60000`, la verificación de integridad (`BotonVerificarCadena.tsx:73`, "Verificar integridad de la cadena") reportó *"Discrepancia detectada en el registro d8136bd4… (verificados 13 antes de la falla)"* (texto exacto del componente, `BotonVerificarCadena.tsx:97-100`).
- **Causa raíz.** El payload del evento `proveedor:variacion_precio_critica` (`valor_nuevo`, persistido como `jsonb` en `AuditLog`) contenía `variacion_porcentual` como `double` de precisión completa. `calcularHashEncadenado()` (`hash-chain.ts:109-112`) hashea el valor en memoria al insertar; `verificarCadenaIntegridad()` (`audit-log.service.ts:302`) recalcula el hash a partir del valor releído desde la base — y algunos `double` vuelven con el último dígito distinto:
  - `28.205128205128204` (en memoria, `(20000-15600)/15600*100`) → `28.2051282051282` (releído)
  - `32.743362831858406` (en memoria, `(60000-45200)/45200*100`) → `32.74336283185841` (releído)
  - `28.048780487804876` (el caso de la versión pendiente sembrada, `(21000-16400)/16400*100`, `seed.ts:2346`) sobrevivió el viaje de ida y vuelta sin cambios — por eso las pruebas anteriores con un solo ítem (el fixture sembrado, y una prueba de 2 ítems sobre InduSur el 2026-09-25) habían pasado.
  - **Precisión sobre el mecanismo exacto.** La pérdida de precisión ocurre en el viaje de ida y vuelta del payload `jsonb` de este evento, no al pasar por la columna `variacion_porcentual_maxima Decimal(14,2)` (el payload del evento nunca pasa por esa columna). La capa exacta responsable (parseo de números JSON del motor de Prisma vs. Postgres) no se aisló — se deja dicho explícitamente, no se afirma como demostrado.
- **Línea de tiempo, con honestidad sobre los pasos en falso.** El 2026-09-25 una investigación inicial atribuyó el problema a "más de un ítem"; un reintento ese mismo día con otro proveedor (InduSur, 2 ítems) pareció refutarlo porque esos valores concretos sobreviven el viaje de ida y vuelta sin cambios; recién el 2026-09-26, al reproducirse la ruptura con los valores de "Suministros Tácticos Cuyo", se identificó la causa real: depende del valor numérico exacto, no de la cantidad de ítems.
- **Fix.** `redondearPorcentaje()` (`lista-precios.service.ts:322-324`, `Math.round(v*100)/100`, misma escala que la columna `Decimal(14,2)`) aplicado dentro de `emitirVariacionCriticaSiCorresponde()` tanto a `variacion_porcentual_maxima` (`341`) como a cada `items_variacion_critica[].variacion_porcentual` (`344`), antes de emitir el evento. `audit-log.service.ts`/`hash-chain.ts` (Módulo D) quedaron intactos.
- **Verificación.** Reseteo de base + seed, repitiendo el mismo caso de 2 ítems sobre "Suministros Tácticos Cuyo" → *"Cadena íntegra — 6 registros verificados"* (texto exacto, `BotonVerificarCadena.tsx:86-89`). El evento de la versión pendiente sembrada ahora persiste `28.05`, no el valor de precisión completa.
- **Descartado.** Corregir en `registrarAuditLog()`/`canonicalizarJson()` (Módulo D, ticket de otro módulo — cambiar la canonicalización alteraría el hash de filas ya persistidas); guardar los números como string en el payload (cambiaría el contrato del evento que ya consume el listener/UI); releer la fila tras el `insert` para hashear el valor tal como quedó guardado (no atómico, más complejo, toca Módulo D).
- **Hallazgo abierto (explícito, no resuelto acá).** El riesgo general en Módulo D sigue existiendo: cualquier otro evento del proyecto que incluya decimales largos en el payload de auditoría puede romper la cadena de la misma forma. Esta corrección solo evita que el evento propio de HU-H2 dispare ese caso — no repara el mecanismo compartido, que sigue pendiente de que el equipo de Módulo D decida un fix (ver "Hallazgo fuera de alcance" y "Decisiones sujetas a revisión" arriba).

**Nota adicional (seed, no un bug de esta UI).** El seed ya no contiene ninguna lógica que borre filas de `AuditLog` — una versión anterior tenía un reintento que las eliminaba; se quitó porque el ledger es append-only.
