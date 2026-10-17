# HU-B9 — Lista de Precios de Venta versionada, única para mostrador y e-commerce (Módulo B)

Contrato: `docs/specs/spec_modulo_B.md` Rev. 6 — §2.9 (contrato completo, líneas 485–592), §3.4 (baja lógica/onDelete, 626–634), §4 (evento `precio_venta:version_publicada`, 638–659), §5 (Fuera de alcance); `spec_modulo_D.md` §6 (ConfiguracionSistema, 314–389; lectura servicio-a-servicio §6.3.1, línea 370); `spec_modulo_H.md` §2.11 (HU-H8, costo de reposición, 573–618). Referencia funcional adicional: Alcance Módulo B §3.4 "Lista de Precios de Venta". Este documento resume las decisiones, la evidencia y los hallazgos del desarrollo. La task (`docs/tasks/HU-B9.md`) es un artefacto local que no se versiona; todo lo relevante de ella está incorporado acá.

**Módulo:** B — Ventas y POS · **Responsable:** Cali · **Sprint / estimación:** Sprint 4 · 5 SP
**Estado:** Implementada y verificada (backend + frontend). 4 de 10 CA quedan parciales: el precio se resuelve server-side en e-commerce (E1/E2), pero el POS (HU-B1) y las cotizaciones (HU-B3) todavía reciben el precio del cliente — es el ajuste técnico fuera de alcance de esta HU (Punto abierto 2, sin dueño asignado).
**Commits:** `75e72fe` — `feat(ventas): backend de HU-B9 — lista de precios de venta versionada` · `e9ca0c9` — `feat(ventas): frontend de HU-B9 — pantalla de lista de precios de venta`.

## 1. Historia de usuario y qué hace

**Como** Supervisor de Ventas, **necesito** gestionar una Lista de Precios de Venta versionada, única para mostrador y e-commerce e independiente de las listas de proveedor, **para** que todos los canales cobren el mismo precio vigente por SKU, con historial auditable y un margen medible contra el costo de reposición.

| Capacidad | Dónde | Resultado |
|---|---|---|
| Publicar versión | `POST /api/ventas/lista-precios/versiones` · `publicarVersionListaPrecioVentaAction()` | Crea una `ListaPrecioVentaVersion` nueva con sus ítems en una única `$transaction`. **Nunca** modifica una versión existente. El costo de reposición se resuelve server-side y queda congelado en `costo_reposicion_referencia`. Un precio bajo costo sin motivo se rechaza y no persiste nada. Emite `precio_venta:version_publicada` post-COMMIT |
| Consultar precio vigente | `GET /api/ventas/lista-precios/vigente?variante_sku_id=` | Precio, versión y `vigente_desde` de la versión que resuelve el SKU. `404 SKU_SIN_PRECIO_VIGENTE` si no tiene ítem en ninguna versión vigente |
| Sugerencia de precio | `GET /api/ventas/lista-precios/sugerencia/[variante_sku_id]` · `obtenerSugerenciaPrecioAction()` | Costo de reposición (HU-H8) × (1 + margen de `ConfiguracionSistema`), sin redondeo. Sin costo ⇒ `200` con `null`; SKU inexistente o inactivo ⇒ `422 VARIANTE_NO_ENCONTRADA` |
| Resolución para consumidores | `resolverPrecioVentaVigente(id, { prisma? })` · `resolverPreciosVentaVigentes(ids)` | Única vía de resolución, sin RBAC ni caché, **por SKU** (si la versión más reciente no trae el SKU, cae a la anterior activa que lo traiga). Hoy la consume el catálogo web (E1) y, a través de él, el checkout (E2) |
| Pantalla del Supervisor | `/ventas/lista-precios` · Sidebar "Ventas → Lista de precios de venta" | Tabla de variantes activas con precio vigente, costo, sugerencia ("Aplicar"), precio nuevo editable y motivo que aparece solo si el precio queda bajo costo. Fecha `vigente_desde` única para la versión y botón "Publicar versión" con confirmación. Solo se publican las filas cargadas; el resto mantiene su precio |

## 2. Criterios de aceptación (10) — estado y evidencia

Evidencia: `lista-precio-venta.integration.test.ts` (servicio contra PostgreSQL, `test:integration:b9`), `lista-precio-venta.http.integration.test.ts` (HTTP con login real + verificación en BD, `test:integration:b9-http`), unitarios (`lista-precio-venta.calculo.test.ts`, `lista-precio-venta.service.test.ts`, `ventas.schema.test.ts`, `lista-precios-venta.calculo.test.ts`, `EditorListaPreciosVenta.test.tsx`) y el QA manual en el navegador (sección 8).

| CA | Criterio (Backlog) | Estado | Evidencia |
|---|---|---|---|
| CA01 | Entidad propia, separada de la lista de proveedor (Módulo H), estructura lista → versión → ítem por SKU | Aprobado | Schema ya migrado: `ListaPrecioVenta` / `ListaPrecioVentaVersion` / `ListaPrecioVentaItem`, sin relación con `ListaPrecio` de H. El servicio solo **consulta** el costo de H8 por función. Servicio: "resolver: CT1 resuelve a la v1 del seed; Camisa de Policía → null" |
| CA02 | Ninguna actualización sobrescribe la vigente; versión nueva con fecha de vigencia; **historial consultable** | **Parcial** | Inmutabilidad: unitario "sin delete/deleteMany ni update sobre versiones o ítems (inmutabilidad)" y HTTP "BD — v1 intacta: 6 ítems con los precios y costos del seed (inmutabilidad)". Versión con fecha: HTTP 5 y 9. **Historial consultable: sin endpoint ni pantalla** (Punto abierto 4) |
| CA03 | Sugerencia = costo de reposición × (1 + margen configurable); precio final editable | Aprobado | Servicio: "sugerencia CT1 → costo 15600, margen 0.35, sugerido 21060 exacto (sin redondeo)", "sugerencia Gorra (sin costo HU-H8) → nulls…", "CONFIGURACION_NO_ENCONTRADA si falta la clave del margen (sin default)". HTTP 1 y 2. Unitarios de `calcularPrecioSugerido`. Pantalla: input editable y botón "Aplicar" (QA) |
| CA04 | Precio bajo costo exige confirmación explícita con motivo obligatorio | Aprobado | Servicio: "bajo costo sin motivo → MOTIVO_BAJO_COSTO_REQUERIDO con details; NADA persistido (atomicidad)". HTTP 7 y 8, y "BD — costo congelado server-side y bajo costo con motivo en los ítems nuevos". Unitarios de `validarBajoCosto`, `requiereMotivo` y `construirPayloadVersion`. QA: el motivo aparece y desaparece, sin motivo la fila queda en rojo, confirmación con AlertDialog |
| CA05 | POS (B1), cotizaciones (B3) y e-commerce (E1/E2) resuelven el precio en el servidor y nunca aceptan uno del cliente | **Parcial** | E-commerce sí: `catalogo-web.service.ts` usa `resolverPreciosVentaVigentes()` y el checkout congela desde ahí (regresión `e1`/`e1-http`/`e2` sin cambios). **B1 y B3 todavía reciben el precio del cliente**: ajuste técnico de 3 SP sin dueño (Punto abierto 2). La función `resolverPrecioVentaVigente(id, { prisma })` queda lista para ellos |
| CA06 | El precio se congela al confirmar, cotizar o iniciar el checkout; una versión posterior no altera operaciones registradas | **Parcial** | No retroactividad: HTTP "BD — no-retroactividad: precios congelados de los pedidos web V-2026-000004…11 sin cambios". El congelamiento ocurre en el consumidor; en B1/B3 el valor congelado todavía no sale de esta lista (Punto abierto 2) |
| CA07 | SKU sin precio vigente no se vende en el POS ni aparece como comprable en la web | **Parcial** | Web sí: el resolver devuelve `null` (servicio "…Camisa de Policía → null"; HTTP 4 → 404 `SKU_SIN_PRECIO_VIGENTE`) y E1 lo trata como no comprable. **POS: pendiente** (Punto abierto 2) |
| CA08 | Descuentos (B4) y cupones (E4) se aplican sobre el precio de esta lista | **Parcial / no verificado en esta HU** | Cupones E4: `checkout.service.ts` aplica el cupón sobre los precios congelados de B9 (leído en el código, **sin test propio de B9**). Descuentos B4: se aplican sobre el precio enviado por el cliente (Punto abierto 2) |
| CA09 | Baja lógica de listas, versiones e ítems (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`) | **Parcial** | Las 4 columnas existen en los 3 modelos (schema). El resolver filtra `is_active`/`deleted_at` en ítem, versión y lista (unitario "resolver: filtra vigente_desde lte, is_active en ítem/versión/lista…"). Sin `DELETE` en el código. **Sin endpoint de baja** (Punto abierto 5) |
| CA10 | Cada publicación genera un evento auditado con cadena SHA-256, con usuario, fecha y hora, y **valores anterior y nuevo** | **Cumplido** | HTTP: "BD — AuditLog: un asiento PUBLICAR_VERSION_LISTA_PRECIO_VENTA por versión, usuario = supervisor" (ahora también verifica la cadena de `version_anterior_id` 5 → v1, 8 → 5, 9 → 8, 10 → 8) y "Cadena SHA-256 íntegra: … → integra: true". Servicio: "version_anterior_id: la segunda publicación apunta a la primera…" y "version_anterior_id: null en la primera versión…". Unitario: "publicar: version_anterior_id se lee dentro de la $transaction ANTES del create…". **`valor_anterior: { version_anterior_id }`** (Punto abierto 3, resuelto) |

## 3. Decisiones de producto y técnicas

### 3.1. Backend (Paso 0 y puntos abiertos de la task)

| # | Decisión | Opción elegida | Motivo |
|---|---|---|---|
| Paso 0 · ítem 3 | `lista-precio-venta.service.ts` ya existía (lo creó HU-E1 con `resolverPrecioVentaVigente` y `resolverPreciosVentaVigentes`) | **Se extendió, no se recreó.** La consulta de `resolverPreciosVentaVigentes` pasó a un helper privado compartido, con la misma firma y el mismo resultado | El catálogo de E1 depende de esa función. Su criterio coincidía con el de la task. Recrearla duplicaba "la única vía" de resolución que exige el spec. Se verificó con `hu-e1.integration.test.ts`: 21/21 antes y después (sección 11) |
| PA 1 | ¿Existe `obtenerConfiguracion()`? | Sí, existe y lanza `CONFIGURACION_NO_ENCONTRADA`. Margen sin valor por defecto | Spec D §6.3 prohíbe defaults implícitos |
| PA 3 | Evento sin "valores anterior y nuevo" (CA vs. spec) | **Resuelto (Cali + PO):** se agregó `version_anterior_id` (UUID de la versión que regía cuando empieza la nueva, o `null` si no hay ninguna) al payload, y el `AuditLog` registra `valor_anterior: { version_anterior_id }`. Spec B §4 actualizado | Cierra el hueco de auditoría sin tocar la inmutabilidad: la versión anterior solo se lee (dentro de la misma `$transaction`, antes del `create`). Reemplaza la Opción A original (`valor_anterior: null`) |
| PA 6 | Desempate cuando dos versiones tienen el mismo `vigente_desde` | `created_at desc` | Determinismo. Servicio: "dos versiones con el MISMO vigente_desde: gana la de created_at más reciente" |
| PA 7 | Forma de la sugerencia y caso sin costo | `{ variante_sku_id, costo_reposicion_referencia, margen, precio_sugerido }`. Sin costo: `200` con `null`. SKU inexistente o inactivo: `422 VARIANTE_NO_ENCONTRADA` | Distinguir "sin costo" (dato válido) de "SKU inválido" (error) |
| PA 8 | Redondeo del precio sugerido | Sin redondeo comercial: 2 decimales exactos. El seed redondea a la centena solo como fixture | Spec B §2.9 no pide redondeo; evitar artefactos de punto flotante |
| PA 9 | Resolución de `lista_id` | Debe haber exactamente una lista activa; si hay 0 o más de 1, `409 LISTA_PRECIO_VENTA_NO_CONFIGURADA` | El sistema tiene una sola lista para todos los canales |
| PA 10 | Permiso de `GET /vigente` | Se mantiene `ventas:gestionar_lista_precios` tal como dice el spec | Los consumidores internos usan la función de servicio sin RBAC, no HTTP |
| PA 12 | Valor de `AuditLog.accion` | `PUBLICAR_VERSION_LISTA_PRECIO_VENTA` | Convención de nombres del listener |
| PA 13 | `vigente_desde` en el pasado | **Opción A:** se permite | Coherente con el schema (`z.coerce.date()` sin mínimo) |
| Task §2.2 | Costo de reposición | Se obtiene server-side con `obtenerCostoReposicionVigente()` (función de servicio, no HTTP), antes de la transacción. Se congela en `costo_reposicion_referencia` | El schema de entrada no tiene campo de costo. La firma de H8 tipa `PrismaClient`, no `TransactionClient` |
| PROPUESTA | Segundo parámetro opcional `{ prisma?: TransactionClient }` en `resolverPrecioVentaVigente` | Aceptada | Que B1, B3 y E2 resuelvan dentro de su propia transacción sin romper la firma del spec |

### 3.2. Frontend (Paso 0 de frontend, ítems 8 a 11, aprobado el 03/10/2026)

| Decisión | Motivo |
|---|---|
| Datos calculados en la página del servidor con funciones de servicio. Margen leído **una vez**, precios vigentes en un solo lote, costo por variante en forma secuencial | Evitar N+1 llamadas por fila. No hay versión en lote del costo de H8 |
| Sin `vigente_desde` por fila: un único selector de fecha para la versión nueva | El campo es de la versión, no del SKU. No hace falta consultar versiones |
| Tabla propia con búsqueda en memoria; **no** se usan `TablaFiltroPaginada` ni `ComboboxFiltrable` | Ninguna pantalla de Ventas los usa. `TablaFiltroPaginada` pagina en el servidor y no admite edición por fila |
| Input de precio vacío, botón "Aplicar sugerencia" y solo se envían las filas cargadas, con aviso | La resolución es por SKU: las variantes no incluidas conservan su precio |
| `vigente_desde`: valor por defecto y mínimo `diaNegocioIso()`, enviado como `AAAA-MM-DDT00:00:00-03:00` | Evitar que una fecha sola se interprete como medianoche UTC. **No resuelve** la deuda de comparación por instante (sección 7) |
| Margen faltante o inválido: aviso arriba de la tabla y se sigue editando sin sugerencias | El error es de configuración global, no de una fila |
| Sidebar: ítem con su propio permiso, sin gate por sección | Es el patrón real del código (la §6 de la task decía "`ventas:leer` a nivel de sección") |
| Tests: lógica pura en `.calculo.ts` (reusa `validarBajoCosto`), render por SSR y gating cubierto por el QA en navegador | No hay en el repo tests de páginas con `redirect` ni tests con DOM |

## 4. Modelo de datos, migración y seed

**Sin migración.** El schema ya estaba migrado al empezar la HU; se usan los modelos existentes sin cambios en `prisma/schema.prisma`:

| Modelo (tabla) | Uso en HU-B9 |
|---|---|
| `ListaPrecioVenta` (`listas_precio_venta`) | Única lista activa; se resuelve dentro de la transacción de publicación (PA 9) |
| `ListaPrecioVentaVersion` (`versiones_lista_precio_venta`), `@@index([lista_id, vigente_desde])` | Una fila nueva por publicación (`lista_id`, `vigente_desde`, `publicado_por_id`). Nunca se actualiza |
| `ListaPrecioVentaItem` (`items_lista_precio_venta`), `@@unique([version_id, variante_sku_id])` | `precio_venta`, `costo_reposicion_referencia` (snapshot server-side), `confirmado_bajo_costo`, `motivo_bajo_costo` (solo si justifica un bajo costo). Alta con `createMany` |

Los tres modelos tienen el bloque de baja lógica completo (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`); el modelo del spec no lo muestra para el ítem, pero rige el schema real.

**Seed:** no se modificó en esta HU. Los fixtures que usan los tests ya estaban sembrados:

| Qué | Valor |
|---|---|
| Lista "Lista de Precios de Venta — General" | `16d1dbbf-b91e-4c07-93f0-007572d0d116` |
| Versión v1 | `f7bc2652-5022-4d5c-b235-be90b8f1677d`, `vigente_desde` = un día antes del seed, publicada por `supervisor.ventas.seed` |
| `VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA` | `"0.35"` (módulo `B`) |
| Permiso `ventas:gestionar_lista_precios` | `377cbaff-d5e6-4ea7-8d25-c63a42cdcec0`, `MODULO_B`, asignado **solo** a `SUPERVISOR_VENTAS` |
| Ítems de v1 | Costo = `obtenerCostoReposicionVigente()` real; precio = costo × 1,35 redondeado a la centena **por el seed**. Gorra Táctica sin costo (precio 9500); Camisa de Policía **sin ítem** (caso `SKU_SIN_PRECIO_VIGENTE`) |

## 5. Contrato de endpoints

Los tres `route.ts` exportan solo su método HTTP y usan `withPermission("ventas:gestionar_lista_precios")`. Envelope estándar `{ data, error }`. Las rutas y las Server Actions son wrappers finos sobre `lista-precio-venta.service.ts` (unitario "rutas y actions no acceden a prisma ni abren transacciones").

### 5.1. Rutas

| Método | Ruta (`src/app/api/ventas/lista-precios/…/route.ts`) | Respuestas |
|---|---|---|
| POST | `versiones` | 201 `{ version_id, lista_id, vigente_desde, items_publicados, items_bajo_costo }` · 400 `VALIDATION_ERROR` / `ITEM_DUPLICADO_EN_VERSION` · 401 · 403 · 409 `LISTA_PRECIO_VENTA_NO_CONFIGURADA` · 422 `MOTIVO_BAJO_COSTO_REQUERIDO` (con `details.variante_sku_id`) / `VARIANTE_NO_ENCONTRADA` · 500 |
| GET | `vigente?variante_sku_id=` | 200 `{ variante_sku_id, precio_venta, lista_precio_version_id, vigente_desde }` · 400 `VALIDATION_ERROR` · 401 · 403 · 404 `SKU_SIN_PRECIO_VIGENTE` · 500 |
| GET | `sugerencia/[variante_sku_id]` | 200 `{ variante_sku_id, costo_reposicion_referencia, margen, precio_sugerido }` (los dos del medio pueden ser `null`) · 400 `VALIDATION_ERROR` · 401 · 403 · 404 `CONFIGURACION_NO_ENCONTRADA` · 422 `VARIANTE_NO_ENCONTRADA` · 500 `CONFIGURACION_INVALIDA` / `INTERNAL_ERROR` |

`precio_venta`, `costo_reposicion_referencia` y `precio_sugerido` se devuelven como `number`. Body de publicación (`CrearVersionListaPrecioVentaSchema`, textual del spec): `{ vigente_desde: z.coerce.date(), items: [{ variante_sku_id, precio_venta (> 0), motivo_bajo_costo? }] }` con al menos un ítem. No hay campo de costo: se resuelve siempre en el servidor.

### 5.2. Server Actions (`src/app/(dashboard)/ventas/lista-precios/actions.ts`)

| Action | Equivale a | Resultado |
|---|---|---|
| `publicarVersionListaPrecioVentaAction(input)` | `POST …/versiones` | `{ data, error }` plano con los mismos códigos (más `UNAUTHORIZED` / `FORBIDDEN`); `VALIDATION_ERROR` devuelve el primer issue de Zod, sin `fieldErrors` |
| `obtenerSugerenciaPrecioAction(varianteSkuId)` | `GET …/sugerencia/[id]` | Ídem |

`consultarPrecioVentaVigente` no tiene Server Action: la pantalla usa directamente `resolverPreciosVentaVigentes()` desde la página del servidor.

### 5.3. Errores

| Código | HTTP | Mensaje | Caso |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Mensaje de Zod | Body o query inválidos (ej. `items: []` ⇒ "La versión debe incluir al menos un ítem", `precio_venta` 0, body no JSON, UUID inválido) |
| `ITEM_DUPLICADO_EN_VERSION` | 400 | "La versión no puede incluir la misma variante en más de un ítem" | Mismo SKU repetido; se rechaza antes de abrir la transacción |
| `LISTA_PRECIO_VENTA_NO_CONFIGURADA` | 409 | "Debe existir exactamente una Lista de Precios de Venta activa para publicar una versión" | 0 o más de 1 lista activa |
| `VARIANTE_NO_ENCONTRADA` | 422 | "La variante `<id>` no existe o está dada de baja" | Publicación o sugerencia sobre un SKU inexistente o inactivo |
| `MOTIVO_BAJO_COSTO_REQUERIDO` | 422 | "El precio propuesto para la variante está por debajo del costo de reposición; debe declararse un motivo" | Precio < costo sin motivo (o con motivo en blanco). `details.variante_sku_id`. Rollback completo |
| `SKU_SIN_PRECIO_VIGENTE` | 404 | "La variante no tiene un precio de venta vigente" | `GET /vigente` sin ítem vigente |
| `CONFIGURACION_NO_ENCONTRADA` | 404 | De `obtenerConfiguracion()` | Falta `VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA` |
| `CONFIGURACION_INVALIDA` | 500 | "VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA debe ser un número no negativo (valor actual: …)" | Margen vacío, no numérico o negativo |
| `UNAUTHORIZED` / `FORBIDDEN` | 401 / 403 | — | Sin sesión / sin el permiso (HTTP 14, 15 y 16: cajero y admin de e-commerce reciben 403 en las 3 rutas) |
| `INTERNAL_ERROR` | 500 | "Error interno del servidor" | Error inesperado |

### 5.4. Reglas del servicio (resumen)

- **Resolución.** Un solo `findMany` sobre ítems activos de versiones activas con `vigente_desde <= now()` y lista activa, ordenado por `vigente_desde desc, created_at desc`; se queda con el primero por SKU. Sin caché. Una versión futura nunca se aplica antes de tiempo (HTTP 9).
- **Publicación.** Orden: duplicados (fuera de la transacción) → costo por SKU con `obtenerCostoReposicionVigente()` (secuencial, fuera de la transacción) → dentro de la `$transaction`: lista única → variantes activas → bajo costo → `create` de la versión + `createMany` de los ítems. `costo_reposicion_referencia` es un snapshot de lectura; un cambio de la lista de proveedor entre esa lectura y el COMMIT queda fuera (ventana de milisegundos, documentado en el servicio).
- **Bajo costo.** `validarBajoCosto()` (pura): sin costo no aplica; precio igual al costo **no** es bajo costo; un motivo solo con espacios cuenta como ausente. El motivo solo se persiste cuando efectivamente justifica un bajo costo.

## 6. Eventos auditados

`precio_venta:version_publicada`, **evento sensible**, emitido con `domainEventBus.emit()` **después del COMMIT**. El servicio nunca escribe el `AuditLog` directamente (unitario "el servicio nunca escribe AuditLog directo"); `audit-log.listener.ts` es la única vía. Tipo en `src/lib/events/event-types.ts`.

Payload (literal del spec): `{ version_id, version_anterior_id, lista_id, publicado_por_id, vigente_desde (ISO), items_publicados, items_bajo_costo }`.

`version_anterior_id` es la versión activa de la lista que rige en el instante en que empieza a regir la nueva (`is_active`, sin `deleted_at`, `vigente_desde <=` el de la nueva, orden `vigente_desde DESC, created_at DESC`), leída dentro de la `$transaction` antes del `create`; `null` si no hay ninguna. Las versiones programadas a futuro no cuentan como anteriores: la +30 días del seed no le gana a la v1 (caso 5 → v1) y la del caso 9 no le gana a la 8 (caso 10 → 8). La consulta del prompt original no filtraba por fecha; el filtro `<=` se agregó con el OK de Cali al ver que el seed ya tiene una versión futura. Solo viaja en el evento; la respuesta `201` no cambia.

| Campo del `AuditLog` | Valor |
|---|---|
| `usuario_id` | `publicado_por_id` |
| `accion` | `PUBLICAR_VERSION_LISTA_PRECIO_VENTA` |
| `tabla_afectada` | `versiones_lista_precio_venta` |
| `registro_id` | `version_id` |
| `valor_anterior` | `{ version_anterior_id }` (`null` adentro si no había versión que rigiera antes) |
| `valor_nuevo` | El payload completo |

**Punto abierto 3, resuelto:** la implementación original registraba `valor_anterior: null` (Opción A: el payload del spec no traía ningún campo anterior). Cali y el PO decidieron ampliar el payload con `version_anterior_id`, y spec B §4 quedó actualizado. La cadena SHA-256 sigue íntegra (HTTP "Cadena SHA-256 íntegra…").

El evento **no** figura todavía en el enum `tipo_evento` de la consola de HU-B6 (sección 10.3).

## 7. Hallazgos durante el desarrollo

| # | Sev. | Hallazgo | Tratamiento |
|---|---|---|---|
| H1 | — | `lista-precio-venta.service.ts` ya existía, introducido por HU-E1 con el resolver y su versión por lote, consumida por `catalogo-web.service.ts` | Se extendió en lugar de recrearlo, sin cambio de comportamiento para E1 (sección 11) |
| H2 | Medio | **Comparación de vigencia por instante UTC, no por día de negocio.** `resolverPreciosVentaVigentes` / `resolverPrecioVentaVigente` comparan `vigente_desde <= now()` como instante exacto (heredado de HU-E1), no por día de negocio en hora argentina como el fix A3 de Módulo H (`fechaDeVigenciaAlcanzada`). Una versión publicada con fecha sola (medianoche UTC) queda vigente unas 3 horas antes de lo esperado | **No corregido en esta HU:** el contrato pide literalmente `lte: now()` y el catálogo de E1 depende del comportamiento actual. Mitigación en la pantalla: la fecha se envía como medianoche de Argentina con offset `-03:00` explícito (no cubre a quien llame la API con una fecha sola). Acción sugerida: task transversal coordinada con el dueño de E1 |
| H3 | Medio | **`b4-http` sin `DATABASE_URL` propia.** `pedido-venta.http.integration.test.ts` no tiene una variable de base propia (a diferencia de b5-http/b6-http) y cae por defecto a la base de desarrollo. Causó una escritura real en `swat_erp_db` durante el testing del backend de esta HU | La escritura se dio de **baja lógica** (Regla N.° 1, sin `DELETE`). No se corrigió el test por estar fuera del alcance de HU-B9. Pendiente: agregar `HU_B4_HTTP_INTEGRATION_DATABASE_URL` con el patrón de las demás suites HTTP del módulo. En la regresión del frontend se evitó apuntando todo el proceso a la base descartable (sección 9) |
| H4 | Bajo | El `.refine((d) => true, {})` de `ItemListaPrecioVentaSchema` es un no-op copiado textual del spec (aviso de ESLint preexistente) | Reportado, no corregido (Punto abierto 14) |

## 8. Verificación funcional de punta a punta (QA manual en el navegador, 03/10/2026)

QA hecho **manualmente** por Cali en el navegador, **no** con Claude in Chrome (la extensión quedó sin conectar en ese momento). Servidor de QA aparte: `next build` + `next start -p 3101` contra una base descartable migrada y recién sembrada (`swat_erp_qa_b9fe`), sin tocar la base de desarrollo. Se usó `next start` porque Next 16 permite un único `next dev` por directorio y el de desarrollo seguía corriendo; el build compiló sin errores, incluida `/ventas/lista-precios`. Usuarios del seed: `supervisor.ventas.seed` (con el permiso) y `cajero.seed` (sin él). Los 6 puntos pasaron:

| # | Verificado | Resultado |
|---|---|---|
| 1 | Valores de la tabla contra los fixtures del seed (por ejemplo, Camisa Táctica 1: vigente $21.100, costo $15.600, sugerido $21.060; Gorra Táctica "Sin costo"; Camisa de Policía "Sin precio" y sin sugerencia) | OK |
| 2 | El input de motivo aparece cuando el precio queda por debajo del costo y desaparece cuando deja de estarlo | OK |
| 3 | Sin motivo en una fila bajo costo: la publicación se bloquea y la fila queda marcada en rojo | OK |
| 4 | Publicación exitosa: confirmación con AlertDialog, toast de éxito y el precio vigente nuevo reflejado por `router.refresh()` sin recargar la página | OK |
| 5 | Gating, Supervisor: `supervisor.ventas.seed` ve la entrada "Lista de precios de venta" en el Sidebar y accede a la pantalla | OK |
| 6 | Gating, Cajero: `cajero.seed` no ve la entrada y la URL lo redirige a `/no-autorizado` | OK |

Antes del QA manual se hizo un smoke por HTTP contra el mismo servidor: sin sesión ⇒ `307` a `/login`; `cajero.seed` ⇒ `307` a `/no-autorizado` y sin el enlace en el Sidebar; `supervisor.ventas.seed` ⇒ `200` con las 7 variantes y los valores de la tabla de fixtures. Un login de prueba confirmó que el servidor escribía en la base de QA y no en `swat_erp_db`. Las bases descartables se borraron al terminar.

## 9. Cómo correr las pruebas

Scripts (`package.json`): `test:integration:b9` (servicio contra PostgreSQL) y `test:integration:b9-http` (HTTP con login real). Los unitarios de B9 (`lista-precio-venta.calculo.test.ts`, `lista-precio-venta.service.test.ts`, la parte de B9 de `ventas.schema.test.ts` y `lista-precios-venta.calculo.test.ts`) corren con `npm test`. El render SSR de la pantalla se corre aparte:

```bash
node --import tsx --experimental-test-module-mocks --test src/components/ventas/EditorListaPreciosVenta.test.tsx
```

(`--experimental-test-module-mocks` reemplaza el módulo de Server Actions, que fuera de Next falla al importar `server-only`; el router se provee con el `AppRouterContext` real de Next.)

Variables de las suites (solo nombres; nunca valores ni secretos en archivos):

| Variable | Suite | Para qué |
|---|---|---|
| `HU_B9_INTEGRATION_DATABASE_URL` | `b9` y `b9-http` | Base **descartable** donde el test prepara y verifica su estado. Sin ella, la suite se saltea |
| `HU_B9_INTEGRATION_BASE_URL` | `b9-http` | URL del servidor de test |
| `DATABASE_URL` | servidor de `b9-http` | Debe apuntar a la **misma** base que `HU_B9_INTEGRATION_DATABASE_URL` |

```bash
# Base descartable migrada y sembrada (el seed crea la lista, la v1, el margen y el permiso)
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "CREATE DATABASE <base_descartable>"
export TEST_DB="<url de la base descartable>"
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed

npm test
HU_B9_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:b9

# HTTP: servidor APARTE sobre la misma base, en otra terminal (no el next dev de desarrollo).
DATABASE_URL=$TEST_DB npx next dev -p 3101
HU_B9_INTEGRATION_BASE_URL=http://localhost:3101 HU_B9_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:b9-http
```

Si el mismo servidor se usa también para la regresión de E1/E2 (`e1-http`), necesita además los secretos y variables documentados en `docs/modulos/modulo E/HU1_MODULO_E.md` §9.1 (no se duplican acá). **Las suites HTTP modifican la base a la que apunta el servidor**; en particular `b4-http` no tiene variable de base propia (sección 7, H3): exportar `DATABASE_URL` hacia la base descartable en la shell que corre la regresión.

Resultados (03/10/2026):

| Corrida | Resultado |
|---|---|
| Unitarios (`npm test`) | **554/554** (541 al cerrar el backend + 13 del frontend) |
| `EditorListaPreciosVenta.test.tsx` (SSR) | 3/3 |
| `test:integration:b9` | **11/11** |
| `test:integration:b9-http` | **23/23** |
| Regresión de servicio | b1 9/9 · b2 14/14 · b3 10/10 · b4 9/9 · b5 12/12 · b6 14 OK + 5 salteados · b7 6/6 · b8 8/8 · h8 3/3 · e1 21/21 · e2 11/11 |
| Regresión HTTP | b4-http 6/6 · b5-http 14/14 · b6-http 10/10 · h8-http 16/16 · e1-http 15/15 |
| `tsc --noEmit` · `eslint` | 0 errores |
| `next build` | OK |

Los conteos incluyen el test contenedor que cuenta el runner (b9: 10 casos; b9-http: 22 casos).

**Re-corrida tras resolver el PA 3 (03/10/2026, base descartable `swat_erp_qa_b9`):** `npm test` 621/621 · `test:integration:b9` **13/13** (12 casos + contenedor: se sumaron los dos de `version_anterior_id`) · `tsc --noEmit` 0 errores. `test:integration:b9-http` **23/23** (servidor `next dev` sobre la misma base; incluye la cadena `version_anterior_id` y la cadena SHA-256 íntegra). Los 5 salteados de b6 son preexistentes: dependen de un usuario "master" que el seed no crea; no tienen relación con esta HU.

## 10. Limitación conocida, fuera de alcance y deuda

### 10.1. Limitación conocida: POS y cotizaciones todavía no consumen la lista (Punto abierto 2)

El ajuste técnico de HU-B1/B3/B4 (3 SP del Backlog: dejar de recibir el precio desde el cliente y resolverlo con `resolverPrecioVentaVigente(id, { prisma: tx })`) **no está en las HU asignadas y sigue sin dueño**. Hasta que se haga, CA05–CA08 quedan parciales: e-commerce cumple, mostrador y cotizaciones no.

### 10.2. Fuera de alcance

Consumo en E1/E2/E4/E11 (sus dueños), la tarea técnica de `ConfiguracionSistema` (se consume, no se construye), cambios en HU-H8 o en las listas de proveedor.

### 10.3. Deuda que sigue abierta

| Punto | Detalle |
|---|---|
| Historial de versiones (PA 4) | El CA pide historial consultable, pero el spec no define endpoint. Sin endpoint ni pantalla |
| Baja lógica de lista, versión e ítem (PA 5) | Las columnas existen; no hay endpoint de baja en el spec |
| Enum `tipo_evento` de HU-B6 (PA 11) | `precio_venta:version_publicada` no figura en el filtro de la consola de auditoría de Ventas. No se tocó B6 en esta task |
| `.refine((d) => true, {})` (PA 14) | No-op copiado textual del spec; aviso de ESLint preexistente |
| Vigencia por instante UTC (H2) | Task transversal sugerida con el dueño de E1 |
| `b4-http` sin base propia (H3) | Agregar `HU_B4_HTTP_INTEGRATION_DATABASE_URL` |

## 11. Lecciones de proceso

1. **Relevar antes de crear: el archivo ya existía.** El hallazgo más importante de esta HU salió del Paso 0: la task asumía que `lista-precio-venta.service.ts` había que crearlo, pero un `grep` de `resolverPrecioVentaVigente` mostró que HU-E1 ya lo había introducido, con la firma exacta del spec y con una versión por lote que el catálogo web consume en producción. Crear el archivo desde cero habría pisado código ajeno o, peor, dejado dos implementaciones de "la única vía" de resolución que exige el spec, que divergirían en el primer cambio. Se resolvió coordinando: se confirmó que el criterio de E1 coincidía con el de la task, se extendió el archivo existente y se movió la consulta a un helper privado compartido sin cambiar firma ni resultado. Se probó con la suite de E1 antes y después (21/21). La regla que queda: **el Paso 0 busca por nombre de función y de archivo antes de crear cualquier cosa**, y cuando aparece código de otra HU se extiende y se verifica con la suite de su dueño, no se reemplaza.
2. **Las suites de integración deben tener su propia base.** Una suite que cae por defecto a `DATABASE_URL` (H3) termina escribiendo en la base de desarrollo de quien la corre. La regresión se corre siempre con todas las variables apuntando a una base descartable.
3. **El contrato real manda sobre la documentación de la task.** El Paso 0 de frontend confirmó los shapes contra el código (por ejemplo, `CONFIGURACION_INVALIDA` y la ausencia de Server Action para `consultarPrecioVentaVigente`) en lugar de asumirlos desde la sección de contrato de la task.
4. **Las pantallas se prueban en el navegador.** El render SSR y la lógica pura no cubren el flujo interactivo (motivo condicional, diálogo, refresh); quedó cubierto por el QA manual (sección 8).

## 12. Archivos de la implementación

### 12.1. Backend (`75e72fe`)

**Nuevos**

- `src/app/api/ventas/lista-precios/versiones/route.ts`
- `src/app/api/ventas/lista-precios/vigente/route.ts`
- `src/app/api/ventas/lista-precios/sugerencia/[variante_sku_id]/route.ts`
- `src/app/(dashboard)/ventas/lista-precios/actions.ts`
- `src/lib/services/ventas/lista-precio-venta.calculo.ts` (+ `.test.ts`)
- `src/lib/services/ventas/lista-precio-venta.service.test.ts`
- `src/lib/services/ventas/lista-precio-venta.integration.test.ts`, `lista-precio-venta.http.integration.test.ts`

**Modificados**

- `src/lib/services/ventas/lista-precio-venta.service.ts` (de HU-E1: extendido con `obtenerSugerenciaPrecio`, `consultarPrecioVentaVigente`, `publicarVersionListaPrecioVenta`, la constante del permiso, el parámetro `{ prisma }` del resolver y el helper privado compartido)
- `src/lib/schemas/ventas.schema.ts` (+ `ventas.schema.test.ts`): `ItemListaPrecioVentaSchema`, `CrearVersionListaPrecioVentaSchema`, `PrecioVigenteQuerySchema`, `VarianteSkuIdSchema`
- `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`
- `package.json` (scripts `test:integration:b9` y `test:integration:b9-http`; unitarios en `npm test`)

### 12.2. Frontend (`e9ca0c9`)

**Nuevos**

- `src/app/(dashboard)/ventas/lista-precios/page.tsx`
- `src/components/ventas/EditorListaPreciosVenta.tsx` (+ `.test.tsx`)
- `src/components/ventas/DialogPublicarVersionListaPrecioVenta.tsx`
- `src/components/ventas/lista-precios-venta.calculo.ts` (+ `.test.ts`)

**Modificados**

- `src/components/layout/Sidebar.tsx` (entrada "Lista de precios de venta" con `ventas:gestionar_lista_precios`)
- `package.json` (`lista-precios-venta.calculo.test.ts` en `npm test`)

**No se tocan:** `prisma/schema.prisma`, migraciones, `prisma/seed.ts`, Módulo H (`costo-reposicion.service.ts`, listas de proveedor), `catalogo-web.service.ts` y demás consumidores de E, POS/cotizaciones de Módulo B, consola de HU-B6. Ningún `DELETE` ni `deleteMany`; sin dependencias nuevas.
