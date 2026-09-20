# HU-H6 — Consola de Auditoría Forense de Proveedores (Módulo H)

**Issue de GitHub:** _(a completar por Tomás al abrir el PR)_
**Rama:** `feature/HU-H6-variaciones-precios-homologacion-proveedores`
**Sprint:** Sprint 3, Módulo H (Proveedores y Abastecimiento)
**Rol:** Auditor

## Resumen

Se implementó una consola de solo lectura sobre el ledger forense del Módulo D (`AuditLog`), filtrada al dominio proveedores: eventos de cambio de estado, variación crítica de precio, aprobación de lista de precios y (a futuro) consulta de legajo bancario. Incluye verificación opcional de integridad de la cadena SHA-256, acotada al rango de eventos efectivamente devuelto por la página consultada. La implementación es exclusivamente de backend — dos servicios y un endpoint HTTP — sin ningún cambio sobre Módulo D ni sobre el schema de Prisma. HU-H2 (publicación de lista de precios) es el consumidor principal de eventos reales hoy disponibles para probar el dominio end-to-end.

## Objetivo

Darle al Auditor visibilidad forense filtrable sobre todo lo que ocurre en el dominio proveedores — sin que tenga que conocer la heterogeneidad interna de cómo cada evento se persiste en `AuditLog` — y permitirle, opcionalmente, confirmar que el tramo de la cadena que está consultando no fue alterado, sin pagar el costo de un recorrido completo del ledger en cada consulta.

## Alcance

**Implementado en este PR:**

- Listado paginado y filtrable de eventos del dominio proveedores (`proveedor_id`, `tipo_evento`, `usuario_id`, `fecha_desde`, `fecha_hasta`), con resolución de `proveedor_id` aun cuando ese dato vive dentro del JSON del evento y no en `registro_id`.
- Sanitización denylist recursiva y case-insensitive sobre `valor_anterior`/`valor_nuevo`, como segunda capa de defensa (los emisores ya excluyen datos bancarios/credenciales por diseño).
- Verificación de integridad de la cadena SHA-256, opt-in vía `verificar_integridad=true`, con cache TTL de 30 segundos para no pagar el recorrido completo de `AuditLog` en cada consulta, y cálculo de `afecta_rango_devuelto` acotado a la página efectivamente consultada (no solo al estado global del ledger).
- Endpoint `GET /api/proveedores/auditoria`, gateado por el permiso `auditoria:leer_historico` vía `withPermission` — único rol con acceso: Auditor.

**Fuera de alcance de este PR:**

- Cualquier modificación de Módulo D. `verificarCadenaIntegridad()` y `registrarAuditLog()` (`audit-log.service.ts`) quedan intactos — este PR solo los consume.
- El emisor de `proveedor:legajo_bancario_consultado`. El canal está incluido desde el día 1 en `ACCIONES_DOMINIO_PROVEEDORES` (decisión cerrada del Propose), pero no tiene ningún código que lo emita hoy — probablemente HU-H1.
- Cualquier interfaz de usuario — mismo criterio que HU-H2: esta HU es 100% contrato de backend, pensado para consumo por Postman/frontend futuro.
- El índice recomendado sobre `AuditLog.created_at` (no bloqueante para esta fase).

## Modelo de datos

No se modificó `schema.prisma`. HU-H6 es 100% lectura sobre `AuditLog` (`@@map("audit_logs")`, Módulo D). `AuditLog` no tiene ningún campo de dominio ni `proveedor_id` propio — el filtrado por dominio se resuelve enteramente en código de aplicación, con una lista explícita y cerrada de `tabla_afectada` (`TABLAS_DOMINIO_PROVEEDORES = ['proveedores', 'listas_precio_version']`) y de `accion` (ver "Reglas de negocio implementadas" y "Correcciones durante el desarrollo"). Si en el futuro se agrega una tabla o acción nueva al dominio, se actualiza esa lista en este módulo — nunca se toca Módulo D.

## Reglas de negocio implementadas

**Resolución no uniforme de `proveedor_id`.** No hay una convención única: si `tabla_afectada === 'proveedores'`, el propio registro ES el proveedor y `proveedor_id = registro_id`; para cualquier otra tabla del dominio (`listas_precio_version`), el `registro_id` referencia otra entidad y `proveedor_id` se busca dentro del JSON (`valor_nuevo` primero, `valor_anterior` como fallback, `null` si no aparece en ninguno). El filtro por `proveedor_id` en el `where` de Prisma usa un `OR` de 3 cláusulas que refleja exactamente esta heterogeneidad — no se puede simplificar sin dejar de encontrar eventos reales.

**Traducción canal ↔ `accion` real.** El contrato público (`tipo_evento`, y la constante `ACCIONES_DOMINIO_PROVEEDORES`) usa los nombres de canal del event bus (`proveedor:estado_cambiado`, etc.), pero eso nunca es lo que se persiste en `AuditLog.accion`. La traducción entre ambos vive internamente (ver "Correcciones durante el desarrollo") — el cliente HTTP nunca la ve.

**Sanitización en lectura — denylist recursiva.** Se aplica sobre `valor_anterior`/`valor_nuevo` de cada evento, recursivamente sobre objetos y arrays, reemplazando el VALOR de cualquier clave del conjunto cerrado de claves sensibles (credenciales, datos bancarios) por `'[REDACTADO]'`, preservando la forma del JSON. Es defensa en profundidad: la garantía primaria es que ningún emisor incluya esos datos en el payload del evento.

**Verificación de integridad opt-in y acotada.** `alcance` es siempre `'global'` — no existe una verificación de integridad "por dominio", la cadena SHA-256 es única para todo `AuditLog`. Lo que sí es acotado es `afecta_rango_devuelto`: compara el `created_at` del punto de ruptura contra los ítems de la página efectivamente devuelta, no contra todo el ledger. El resultado de `verificarCadenaIntegridad()` se cachea 30 segundos (variable de módulo) para que paginar no dispare un recorrido completo por cada request.

**Gate de acceso.** El endpoint está envuelto en `withPermission("auditoria:leer_historico", handler)` — 401 sin sesión, 403 sin el permiso, verificado en runtime que el orden es estructural (sin sesión nunca se llega a evaluar el permiso). Nota sobre este permiso en "Decisiones sujetas a revisión".

## Arquitectura y archivos

**Archivos nuevos:**

- `src/lib/services/proveedores/auditoria-proveedores.service.ts` — constantes de dominio (`TABLAS_DOMINIO_PROVEEDORES`, `ACCIONES_DOMINIO_PROVEEDORES`, `CLAVES_PROHIBIDAS`), tipos públicos, `esClaveProhibida()`, `sanitizarValorAuditoria()`, `resolverProveedorId()`, `construirWhereProveedores()`, `mapearFilaAEvento()`, y la función pública `listarEventosDeDominioProveedores()` (2 queries — `count` + `findMany` — en `$transaction`, paginado, ordenado `created_at DESC, id DESC`).
- `src/lib/services/proveedores/auditoria-integridad.service.ts` — tipos `ItemVerificableIntegridad`/`VerificacionIntegridad` (no importa el DTO del archivo anterior, a propósito — tipo estructural mínimo), cache TTL de `verificarCadenaIntegridad()` (`obtenerCadenaIntegridadConCache()`, `TTL_INTEGRIDAD_MS = 30_000`), y la función pública `verificarIntegridadParaRango()`.
- `src/app/api/proveedores/auditoria/route.ts` — `errorResponse()`/`okResponse()`, `ConsultarAuditoriaProveedoresQuerySchema` (Zod), y el `GET` envuelto en `withPermission("auditoria:leer_historico", ...)`.

**Archivos modificados:** ninguno. HU-H6 es exclusivamente consumidora de Módulo D y de los eventos ya emitidos por HU-H2 (y, a futuro, HU-H1) — no toca `audit-log.listener.ts`, `audit-log.service.ts` ni ningún service de otro dominio.

## Correcciones durante el desarrollo

Tres correcciones reales se detectaron durante la implementación, verificando el Propose/Spec ya cerrados contra el código real del proyecto — ninguna quedó sin resolver antes de mergear:

- **Traducción canal ↔ `accion` real, faltante en el diseño original.** `ACCIONES_DOMINIO_PROVEEDORES` son nombres de canal del event bus (`proveedor:estado_cambiado`, `proveedor:variacion_precio_critica`, `proveedor:lista_precio_aprobada`, `proveedor:legajo_bancario_consultado`), pero `audit-log.listener.ts` nunca persiste esos strings en `AuditLog.accion` — persiste `UPDATE_ESTADO`, `VARIACION_CRITICA` y `LISTA_PRECIO_APROBADA` respectivamente (el cuarto canal no tiene emisor todavía). Filtrar `accion IN ACCIONES_DOMINIO_PROVEEDORES` directo, tal como especificaba el diseño original, compila limpio pero no encuentra ninguna fila real — el listado quedaría vacío siempre. Se resolvió con una tabla de traducción interna (`ACCION_REAL_POR_CANAL`/`CANAL_POR_ACCION_REAL`) en `auditoria-proveedores.service.ts`, usada dentro de `construirWhereProveedores()` y `mapearFilaAEvento()`; el contrato público (`tipo_evento`) sigue exponiendo nombres de canal, la traducción es invisible al cliente HTTP.
- **Shape de retorno real de `verificarCadenaIntegridad()`, distinto del asumido.** El diseño original asumía `{ integra, punto_ruptura_id }`. El shape real de Módulo D (`audit-log.service.ts`) es una unión discriminada con el campo `primer_registro_divergente_id` — nunca `punto_ruptura_id`, y nunca `null` cuando `integra === false` (garantizado por el propio tipo). Se tradujo internamente en `auditoria-integridad.service.ts`, sin cambiar el contrato de este endpoint (`punto_ruptura_id` sigue siendo el nombre expuesto en `VerificacionIntegridad`). De paso se corrigió que el cache TTL no calca ningún patrón de `colaLedger` de `audit-log.service.ts` — esa variable es una cola de serialización de escrituras (para que dos `registrarAuditLog()` concurrentes no lean el mismo `hash_anterior`), un problema de forma distinta al de cachear por tiempo el resultado de una lectura costosa; no había nada real que copiar, y el cache quedó como una variable de módulo simple `{ resultado, expiraEn }`.
- **Shape de error propuesto, incompatible con el único mecanismo de auth+RBAC real del proyecto.** Se proponía `{ codigo, mensaje, detalles }` en español para las 5 respuestas del endpoint. El único mecanismo real de auth+RBAC (`withPermission`/`withAuth`, `src/lib/auth/with-permission.ts`) devuelve un shape FIJO `{ code: "UNAUTHORIZED"/"FORBIDDEN", message: <texto fijo> }` para 401/403 — no personalizable por endpoint sin modificar un archivo compartido por todos los Route Handlers del proyecto. Decisión: no esquivar `withPermission` (sería el único endpoint del proyecto que lo hace, generando divergencia de mantenimiento) y en cambio alinear TODO el shape de error del endpoint —incluidos 400 y 500— al shape real `{ code, message }`, sin `detalles`: `VALIDATION_ERROR` para 400 (mismo código que ya usa `proveedores/[id]/lista-precios/route.ts`), `INTERNAL_ERROR` para 500 (mismo código que usan ese archivo y `auditoria/verificar-cadena/route.ts`).

Los tres hallazgos comparten la misma causa: el diseño describía el comportamiento esperado en abstracto, sin haber leído el código ya existente que ese comportamiento debía integrar (`audit-log.listener.ts`, `audit-log.service.ts`, `with-permission.ts`). Los tres quedaron corregidos en el código y reflejados en `spec_HU-H6_FINAL.md` antes de este documento de cierre.

## Verificación

**Verificación en runtime, no solo compilación.** Se ejecutaron los 11 sub-casos (T20-T30 del checklist de la Spec, Casos 1 a 7) contra un servidor `next dev` real y una base PostgreSQL real (`swat_erp_db`), con el ledger ya conteniendo la ruptura real documentada de HU-H2 (no se recreó ninguna condición simulada). Precondición confirmada por SQL directo: `verificarCadenaIntegridad()` reportó `{"integra": false, "primer_registro_divergente_id": "4276bd2d-7ac9-4664-b6e5-ce646d6af9da", ...}` sobre un ledger de 8 filas, con `proveedorHomologado` presente y sus dos eventos de HU-H2 ya persistidos.

**Resultado de los 11 sub-casos:**

| Caso | Descripción | Resultado |
| --- | --- | --- |
| T20 | Listar sin filtros | `200`, `verificacion_integridad: null`, paginación `{total:3, pagina_actual:1, total_paginas:1, por_pagina:20}`, orden `created_at DESC` confirmado |
| T21 | Filtrar por `proveedor_id` | `200`, 2 ítems (`variacion_precio_critica` + `lista_precio_aprobada` de HU-H2), excluye correctamente un evento de otro proveedor — valida el `OR` de 3 cláusulas y la traducción canal/accion a la vez |
| T22 | Filtrar por `tipo_evento` | `200`, 1 ítem, `tipo_evento` expuesto como nombre de canal (no como `VARIACION_CRITICA`) |
| T23 | Fechas invertidas → `400` | `400`, `{"code":"VALIDATION_ERROR","message":"Parámetros de consulta inválidos.","fieldErrors":{}}` — ver limitación abajo |
| T24 | Caso 5 Request A — página con la ruptura | `200`, `punto_ruptura_id` coincide exacto con el confirmado por SQL, `afecta_rango_devuelto: true` |
| T25 | Caso 5 Request B — página anterior a la ruptura | `200`, mismo `punto_ruptura_id`, `afecta_rango_devuelto: false` — confirma que el cálculo es por página, no por estado global |
| T26 | `403` — Comprador y Supervisor de Compras | Ambos `403 {"code":"FORBIDDEN","message":"No tenés el permiso requerido..."}` |
| T27 | `401` — sin sesión | `401 {"code":"UNAUTHORIZED","message":"Sesión requerida"}`; orden 401-antes-403 confirmado por código (`withPermission = withAuth(innerHandler)`), no solo empíricamente |
| T28 | `verificar_integridad=false` explícito | `200`, `verificacion_integridad: null` — ver limitación abajo |
| T29 | `verificar_integridad=algo_invalido` | `400`, `fieldErrors: {"verificar_integridad":["Invalid enum value. Expected 'true' \| 'false', received 'algo_invalido'"]}` |
| T30 | Sin el parámetro | `200`, idéntico a T20/T28 (`.default('false')` del schema) |

Los 11 casos pasaron con el comportamiento esperado. Dos limitaciones quedaron declaradas explícitamente en vez de darse por sentadas:

- **`fieldErrors` vacío para el `.refine()` a nivel de objeto (T23).** El error de `fecha_desde > fecha_hasta` se valida con `.refine()` sobre el objeto completo del schema, no sobre un campo individual — Zod no le asigna `path`, así que `safeParse().error.flatten().fieldErrors` vuelve `{}`. El `400` es correcto, pero el mensaje específico (`"fecha_desde debe ser anterior o igual a fecha_hasta"`) no llega al cliente en ningún campo de la respuesta. Para un error de campo individual (ej. `verificar_integridad` inválido, T29) sí llega el detalle esperado.
- **T28 no pudo instrumentarse empíricamente.** No se pudo confirmar con evidencia runtime que `verificar_integridad=false` evita el full scan de `verificarCadenaIntegridad()`. Se intentó timing (con y sin el TTL de 30s vencido) sin diferencia medible, pero es inconcluyente: el ledger de prueba solo tenía 8 filas, un scan completo es trivial de por sí. El cliente Prisma del proyecto no tiene query logging habilitado. La garantía de que `false` no dispara el scan sigue siendo por lectura de código (`if (verificar_integridad) {...}` en `route.ts`), declarada explícitamente como tal, no asumida como demostrada.

## Decisiones sujetas a revisión

- **`auditoria:leer_historico` es un permiso compartido entre tres dominios, no exclusivo de HU-H6.** El permiso que gatea este endpoint fue originalmente creado para HU-C10 (Módulo C, dominio clientes) — el propio `seed.ts` ya documenta esa reutilización como divergencia de nomenclatura conocida y aceptada (también cubre un scope "ventas"). Con HU-H6 pasa a ser un tercer dominio compartiendo el mismo permiso: cualquier usuario con `auditoria:leer_historico` obtiene lectura de auditoría de clientes, ventas y proveedores a la vez, sin forma de otorgar uno sin los otros. **Es una limitación de diseño RBAC preexistente que esta HU hereda, no que introduce** — hoy solo el rol Auditor lo tiene (confirmado por SQL), por eso el Caso 6 dio el resultado esperado, pero si en el futuro se necesita separar el acceso a auditoría por dominio, esto va a requerir permisos granulares nuevos, no un cambio de esta HU.
- **`fieldErrors` vacío para errores de validación a nivel de objeto (T23).** No es un bug de esta HU — es el comportamiento estándar de Zod para `.refine()` sin `path` — pero si a futuro se necesita que el cliente reciba el mensaje específico de "fecha_desde debe ser anterior o igual a fecha_hasta", el schema tendría que agregar un `path: ["fecha_hasta"]` explícito al `.refine()`. Queda anotado para quien decida esa mejora, no se tocó en esta ronda porque el schema ya está cerrado (Spec §2.2).
- **`proveedor:legajo_bancario_consultado` sin emisor.** El canal está en `ACCIONES_DOMINIO_PROVEEDORES` desde el día 1 (decisión cerrada del Propose) pero no es certificable end-to-end hasta que exista el emisor real (probable HU-H1) — se testeó únicamente con un `AuditLog` sembrado manualmente, fuera del alcance de la corrida runtime de T20-T30.
