# HU-F2 — Plantillas de notificación interna (Módulo F)

Contrato: `docs/specs/spec_modulo_F.md` Rev. 1 — §1 (Visión General, líneas 18–33), §2.2 (contrato de plantillas, 163–206), §3.2 (placeholders, 276–278), §3.4 (`onDelete: Restrict`, 298–302), §4 (eventos de dominio, 304–323) y "⚠️ Decisiones del PO vigentes". Referencia funcional adicional: Alcance Módulo F §4.1 (auditoría de cambios en plantillas) y §5 (matriz RBAC). Este documento resume las decisiones, la evidencia y los hallazgos del desarrollo. La task (`docs/tasks/HU-F2.md`) es un artefacto local que no se versiona; todo lo relevante de ella está incorporado acá.

**Módulo:** F — Arquitectura Tecnológica y Conectividad · **Responsable:** Cali · **Sprint / estimación:** Sprint 4 · 2 SP
**Estado:** Implementada y verificada (backend + frontend). 2 de 5 CA quedan parciales por dependencias fuera de esta HU: el texto por defecto lo aplica el Motor de Notificaciones (HU-F3), que todavía no consume los eventos de referencia (CA3), y no existe catálogo de variables por evento (CA1, Punto abierto 5).
**Commit:** `bcd0e31` — `feat(notificaciones): HU-F2 — plantillas de notificación interna` (backend + frontend en un único commit, 22 archivos).

## 1. Historia de usuario y qué hace

**Como** Administrador de Plataforma, **necesito** crear y editar plantillas de notificación interna con variables de negocio parametrizables, **para** personalizar los mensajes automáticos del sistema sin requerir un nuevo despliegue de software.

| Capacidad | Dónde | Resultado |
|---|---|---|
| Alta | `POST /api/notificaciones/plantillas` · `crearPlantillaNotificacionAction()` | Crea una `PlantillaNotificacion` para un `tipo_evento` del registro de eventos. Una plantilla por evento en toda su historia (`tipo_evento @unique`): un evento con plantilla activa ⇒ `409 PLANTILLA_YA_EXISTE`; con plantilla dada de baja ⇒ `409 PLANTILLA_DADA_DE_BAJA`, con el endpoint de reactivación en el mensaje. Emite `notificacion_plantilla:creada` post-COMMIT |
| Edición | `PATCH /api/notificaciones/plantillas/[id]` · `editarPlantillaNotificacionAction()` | Cambia `asunto`, `cuerpo` y/o `prioridad_default` de una plantilla activa. `tipo_evento` es inmutable (`400 CAMPO_INMUTABLE`). Body vacío ⇒ `400`. Una dada de baja ⇒ `409 PLANTILLA_DADA_DE_BAJA` (la edición no reactiva). Emite `notificacion_plantilla:actualizada` con valor anterior y nuevo |
| Baja lógica | `PATCH /api/notificaciones/plantillas/[id]/baja` · `darDeBajaPlantillaNotificacionAction()` | `is_active = false` + `deleted_at`, `deleted_by`, `deletion_reason` (motivo obligatorio). Nunca `DELETE`. Emite `notificacion_plantilla:baja_logica` |
| Reactivación | `PATCH /api/notificaciones/plantillas/[id]/reactivar` · `reactivarPlantillaNotificacionAction()` | Sin body. Limpia los 4 campos de baja; conserva la redacción previa. Ya activa ⇒ `409 PLANTILLA_YA_ACTIVA`. Emite `notificacion_plantilla:reactivada` |
| Lectura para HU-F3 | `obtenerPlantillaActivaPorEvento(tipo_evento)` | Función interna, sin endpoint ni permiso: plantilla activa (`is_active: true`, `deleted_at: null`) o `null`. Contrato para el Motor de Notificaciones |
| Pantalla del Administrador de Plataforma | `/administracion/notificaciones/plantillas` · Sidebar "Administración → Plantillas de notificación" | Tabla con filtro de estado (Activas por defecto / Dadas de baja / Todas), diálogos de crear, editar, dar de baja (motivo obligatorio) y reactivar. `router.refresh()` antes de cerrar cada diálogo y toast de éxito |

## 2. Criterios de aceptación (5) — estado y evidencia

Evidencia: unitarios (`notificaciones.schema.test.ts`, `event-types.test.ts`, `plantilla-notificacion.service.test.ts`, 31 tests), `plantilla-notificacion.http.integration.test.ts` (HTTP con login real + verificación en BD, `test:integration:f2-http`, 25/25 sobre base descartable recién sembrada) y la verificación manual en el navegador (sección 8).

| CA | Criterio (Backlog) | Estado | Evidencia |
|---|---|---|---|
| CA1 | Cada plantilla se asocia a un tipo de evento de dominio e incluye variables parametrizables: nombre del destinatario, Nº de pedido, estado, fecha estimada | **Parcial** | Asociación a un evento: `tipo_evento` validado contra el registro (HTTP 1 y 4 → `422 TIPO_EVENTO_DESCONOCIDO`), inmutable (HTTP 7). Variables: asunto y cuerpo aceptan `{{variable}}` y se guardan tal cual (QA: `rol:creado` con `{{nombre}}`). **Las cuatro variables que nombra el CA no están definidas para ningún evento**: no hay catálogo de variables por evento (Punto abierto 5, sigue abierto). El reemplazo de las variables lo hace HU-F3 |
| CA2 | Un cambio de redacción no requiere intervención de DevOps ni nuevo despliegue | Aprobado | La edición es un `UPDATE` sobre la fila (HTTP 6; QA paso 2, el cuerpo nuevo se ve al reabrir el diálogo sin recargar). El Motor lee la plantilla en el momento de cada evento: **verificado leyendo el código** de `generarNotificacionClienteWeb()` (`notificacion.service.ts`, HU-F3), **no probado con un evento real** en esta HU |
| CA3 | Si un evento no tiene plantilla activa, el sistema usa un texto por defecto | **Parcial** | Parte de F2: `obtenerPlantillaActivaPorEvento()` devuelve `null` sin plantilla activa (unitario "obtenerPlantillaActivaPorEvento filtra is_active y deleted_at"), y la baja no bloquea notificaciones (HTTP 9; QA paso 3). **El texto por defecto lo aplica HU-F3** (`DEFAULT_NOTIFICATION_TEXT`, fuera de alcance): hoy `notificacion.listener.ts` solo escucha `ecommerce:carrito_articulo_no_disponible` y `ecommerce:pedido_pago_confirmado`, así que el caso de referencia del seed (`usuario:suspendido_automaticamente`) no genera ninguna notificación y el texto por defecto no se ejecutó ni se probó de punta a punta |
| CA4 | La baja lógica de una plantilla registra `is_active=false`, `deleted_at`, `deleted_by`, `deletion_reason` | Aprobado | HTTP 9, 10 y 11; unitario "baja: updateMany con guarda is_active: true y los 4 campos de soft delete" y "sin DELETE físico"; HTTP "BD — sin DELETE: el conteo nunca baja". QA pasos 3 y 5 verificados en BD |
| CA5 | Toda creación o edición de plantilla genera un evento auditado con hash SHA-256 en el Módulo D | Aprobado | HTTP "BD — AuditLog: una fila por alta/edición/baja/reactivación, usuario admin.plataforma.seed" y "Cadena SHA-256 íntegra… → integra: true". Unitarios "emite … post-COMMIT" (4 eventos). QA: 5 asientos (CREATE, UPDATE, DELETE_LOGICO, REACTIVACION, DELETE_LOGICO) y cadena íntegra sobre 30 registros |

## 3. Decisiones de producto y técnicas

### 3.1. Backend (Paso 0 y puntos abiertos de la task)

| # | Decisión | Opción elegida | Motivo |
|---|---|---|---|
| PA 1 | Reemplazo de plantilla vs `tipo_evento @unique` a nivel tabla (incluye bajas). El spec §2.2 dice a la vez "cambiar el evento equivale a crear una nueva y dar de baja la anterior" y "se reactiva y edita la existente", pero no define endpoint de reactivación | **Opción (b): endpoint propio** `PATCH /[id]/reactivar` con su evento `notificacion_plantilla:reactivada` (`accion: REACTIVACION`). Alta sobre evento con plantilla dada de baja ⇒ `409 PLANTILLA_DADA_DE_BAJA`; la edición de una dada de baja ⇒ mismo `409` (no reactiva) | El `PATCH` de edición mantiene una sola semántica y la reactivación queda auditada de forma explícita. El índice único parcial (opción c) requería migración |
| PA 2 | Códigos de error y shapes no definidos en el spec | **Todas las PROPUESTAS aprobadas** (tabla 3.3) | Mismo estilo de códigos semánticos que el resto del proyecto |
| PA 4 | Validación de `tipo_evento` en runtime: `event-types.ts` solo exportaba el tipo `DomainEventMap`, y el seed ya tiene plantillas para `ecommerce:*` que todavía no existen en el mapa | **Opción (i).** `TIPOS_EVENTO_DOMINIO` en `event-types.ts` (`as const satisfies readonly DomainEventName[]` + chequeo de tipo `_registroCompleto` + test de completitud contra la fuente) **más** `TIPOS_EVENTO_DECLARADOS_SPRINT_4` en `plantilla-notificacion.service.ts`, rotulada PROPUESTA, con `ecommerce:pedido_listo_para_retiro`, `ecommerce:pedido_vencido_sin_retiro` y `ecommerce:plazo_retiro_por_vencer` (spec E §4) | Permite configurar plantillas antes de que HU-E12/E13 definan esos eventos, sin tocar el mapa real (es de sus dueños). La lista se borra cuando los agreguen al `DomainEventMap` |
| PA 8 | Edición con body vacío `{}` (el schema del spec lo acepta) | `400 VALIDATION_ERROR` ("Debe indicar al menos un campo a modificar"), con un `.refine()` aplicado **después** del `.strict()` del spec (`EditarPlantillaNotificacionBodySchema`); el schema textual no cambia. Si los valores enviados son idénticos a los actuales, igual se hace `update` y se emite el evento | Un `200` que no hace nada es engañoso. Mismo criterio que el resto del repo para ediciones sin diff |
| Discrepancia 2 | El mínimo de HU-F3 ya existía (`notificacion.service.ts`, introducido por HU-E1/E2) y hace inline la misma consulta que pide `obtenerPlantillaActivaPorEvento()` | Se implementó con el **mismo `where`** (`is_active: true, deleted_at: null`), **sin tocar** `notificacion.service.ts`, con una nota en el código para que HU-F3 pase a consumirla | Diff acotado a la HU; el refactor del consumidor es de HU-F3 |
| Edición | La task describía "leer → `update`" | `findFirst` + `updateMany` con guarda `is_active: true` dentro de la `$transaction`, y relectura de `valor_nuevo` en la misma transacción. Aprobado en revisión | Una baja concurrente no queda editada por detrás; consistente con baja y reactivación |
| Select de eventos | El registro tiene 74 tipos, incluidos eventos técnicos (por ejemplo `usuario:sesion_iniciada` o los propios `notificacion_plantilla:*`) | Sin filtrar | No hay catálogo de eventos "notificables" definido (Punto abierto 5) |
| Nombres de Server Actions | El spec §2.2 dice `crearPlantillaNotificacion()` sin sufijo; la task, `…Action()` | Sufijo `Action` (task) | No chocar con las funciones homónimas del servicio; patrón HU-B4/B5/B9 |

### 3.2. Frontend

| Decisión | Motivo |
|---|---|
| **Discrepancia 7:** tabla propia con los datos que entrega la página del servidor y filtro de estado en el cliente; **no** se usa `TablaFiltroPaginada` | `TablaFiltroPaginada` exige un `cargarPagina` asíncrono, es decir, un endpoint o action de listado, y el spec no define `GET` de listado. Mismo criterio que la pantalla de HU-B9 |
| **Pregunta F2:** la tabla muestra también las plantillas dadas de baja, con el filtro en "Activas" por defecto | Necesario para reactivarlas desde la UI. **Excepción a RULES.md Regla N.° 1** ("solo Auditoría ve inactivos"), limitada a quien tiene `notificaciones:administrar_plantillas` |
| Editar y Baja solo en filas Activas; Reactivar solo en filas en Baja (sin motivo) | Refleja los `409` del backend |
| El select de Crear solo ofrece eventos sin plantilla (ni activa ni dada de baja) | Una plantilla por evento en toda su historia; el `409` del servidor sigue vigente para la API |
| Sin `revalidatePath` en las Server Actions: el único disparador de refetch es el `router.refresh()` de cada diálogo, que corre **antes** de cerrarlo | Lección HU-H9 (refresh antes del cierre) y HU-G10 (commit `a092282`: dos disparadores de refetch pueden desmontar el modal antes de tiempo) |
| Los cuatro diálogos viven a nivel tabla, no por fila; cada apertura los remonta con un `key` nuevo para arrancar con estado limpio | Al cambiar de estado, la fila sale del filtro y se desmontaría junto con su modal. El remontaje reemplaza a un `setState` dentro de `useEffect`, que rechaza la regla `react-hooks/set-state-in-effect` |
| `loading.tsx` en la ruta como estado de carga | La task pide estado de carga; es el primer `loading.tsx` del repo, sin patrón previo |
| Sidebar: sección nueva "Administración" con el ítem "Plantillas de notificación" gateado por `notificaciones:administrar_plantillas` | `Sidebar.tsx` oculta las secciones que quedan vacías, así que sin el permiso no aparece. El route group `administracion/` no existía y se creó con esta pantalla |

### 3.3. PROPUESTAS aprobadas (códigos y shapes no definidos en el spec)

| Código / elemento | Status | Dónde |
|---|---|---|
| `TIPO_EVENTO_DESCONOCIDO` | 422 | Alta |
| `PLANTILLA_YA_EXISTE` | 409 | Alta |
| `PLANTILLA_DADA_DE_BAJA` | 409 | Alta, edición |
| `PLANTILLA_NO_ENCONTRADA` | 404 | Edición, baja, reactivación |
| `PLANTILLA_YA_DADA_DE_BAJA` | 409 | Baja |
| `PLANTILLA_YA_ACTIVA` | 409 | Reactivación |
| `DarDeBajaPlantillaNotificacionSchema` (`deletion_reason` con `.trim()`) | — | Baja |
| Respuesta `200` de edición `{ plantilla_id, tipo_evento, asunto, cuerpo, prioridad_default }` | 200 | Edición |
| Respuesta `200` de baja `{ plantilla_id, tipo_evento, is_active: false }` | 200 | Baja |
| Respuesta `200` de reactivación `{ plantilla_id, tipo_evento, is_active: true }` | 200 | Reactivación |
| Endpoint de reactivación completo | — | Reactivación (PA 1) |
| `findFirst` + `updateMany` con guarda dentro de `$transaction`, emisión post-COMMIT | — | Edición, baja, reactivación |

## 4. Modelo de datos, migración y seed

**Sin migración.** El schema ya estaba migrado; no se tocó `prisma/schema.prisma`.

| Modelo (tabla) | Uso en HU-F2 |
|---|---|
| `PlantillaNotificacion` (`plantillas_notificacion`) | `tipo_evento String @unique` (inmutable; único a nivel tabla, incluidas las dadas de baja), `asunto`, `cuerpo` (admite `{{variable}}`), `prioridad_default` (`PrioridadNotificacion`), bloque de baja lógica `is_active` / `deleted_at` / `deleted_by` / `deletion_reason`, `created_at` / `updated_at`. Relación `notificaciones Notificacion[]` (no se usa en esta HU) |
| Enum `PrioridadNotificacion` | `CRITICA`, `ADVERTENCIA`, `INFORMATIVA` |

**Seed:** no se modificó en esta HU. Fixtures que usan los tests:

| Qué | Valor |
|---|---|
| Plantillas sembradas (5) | `stock:umbral_critico_alcanzado` (ADVERTENCIA), `ecommerce:pedido_listo_para_retiro` (INFORMATIVA), `ecommerce:pedido_vencido_sin_retiro` (CRITICA), `ecommerce:pedido_pago_confirmado` (INFORMATIVA, bloque HU-F2 del seed agregado por HU-E2) y `ecommerce:carrito_articulo_no_disponible` (ADVERTENCIA, bloque HU-E1) |
| Evento sin plantilla a propósito | `usuario:suspendido_automaticamente` (caso de texto por defecto; precondición del test HTTP) |
| Permiso `notificaciones:administrar_plantillas` | `5a8c727d-0c7e-4f24-b2d7-376d9dd2b948`, `MODULO_F`, asignado **solo** a `ADMINISTRADOR_PLATAFORMA` (`1e0efc5b-586f-431a-b1d4-f4dbdab7c60a`) |
| Usuario con el permiso | `admin.plataforma.seed` (`245b3307-a299-4cf5-b1c6-238b45455848`) |

## 5. Contrato de endpoints

Los cuatro `route.ts` exportan solo su método HTTP y usan `withPermission(PERMISO_ADMINISTRAR_PLANTILLAS)` (`"notificaciones:administrar_plantillas"`). Envelope estándar `{ data, error }`. Rutas y Server Actions son wrappers finos sobre `plantilla-notificacion.service.ts` (unitarios "Route Handlers: wrappers finos con el permiso, sin prisma" y "Server Actions: verifican el permiso y no usan prisma").

### 5.1. Rutas

| Método | Ruta (`src/app/api/notificaciones/plantillas/…`) | Respuestas |
|---|---|---|
| POST | `route.ts` | 201 `{ plantilla_id, tipo_evento, prioridad_default }` (textual del spec) · 400 `VALIDATION_ERROR` (con `fieldErrors`) · 401 · 403 · 409 `PLANTILLA_YA_EXISTE` / `PLANTILLA_DADA_DE_BAJA` · 422 `TIPO_EVENTO_DESCONOCIDO` · 500 |
| PATCH | `[id]/route.ts` | 200 `{ plantilla_id, tipo_evento, asunto, cuerpo, prioridad_default }` · 400 `VALIDATION_ERROR` / `CAMPO_INMUTABLE` · 401 · 403 · 404 `PLANTILLA_NO_ENCONTRADA` · 409 `PLANTILLA_DADA_DE_BAJA` · 500 |
| PATCH | `[id]/baja/route.ts` | 200 `{ plantilla_id, tipo_evento, is_active: false }` · 400 `VALIDATION_ERROR` (con `fieldErrors`) · 401 · 403 · 404 `PLANTILLA_NO_ENCONTRADA` · 409 `PLANTILLA_YA_DADA_DE_BAJA` · 500 |
| PATCH | `[id]/reactivar/route.ts` (sin body) | 200 `{ plantilla_id, tipo_evento, is_active: true }` · 400 `VALIDATION_ERROR` · 401 · 403 · 404 `PLANTILLA_NO_ENCONTRADA` · 409 `PLANTILLA_YA_ACTIVA` · 500 |

Bodies (`src/lib/schemas/notificaciones.schema.ts`):
- Alta: `CrearPlantillaNotificacionSchema`, textual del spec: `{ tipo_evento (min 1), asunto (min 1), cuerpo (min 1), prioridad_default (enum) }`.
- Edición: `EditarPlantillaNotificacionSchema` textual del spec (`asunto?`, `cuerpo?`, `prioridad_default?`, `.strict()`) envuelto en `EditarPlantillaNotificacionBodySchema` (rechaza `{}`). `errorEdicion()` traduce el error a `CAMPO_INMUTABLE` cuando hay un issue `unrecognized_keys` que incluye `tipo_evento`, aunque también falle el `.refine()`.
- Baja: `DarDeBajaPlantillaNotificacionSchema`: `{ deletion_reason: string.trim().min(1) }`.
- Id de ruta: `PlantillaNotificacionIdSchema` (UUID).

### 5.2. Server Actions (`src/app/(dashboard)/administracion/notificaciones/actions.ts`)

| Action | Equivale a | Resultado |
|---|---|---|
| `crearPlantillaNotificacionAction(input)` | `POST /api/notificaciones/plantillas` | `{ data, error }` plano con los mismos códigos, más `UNAUTHORIZED` / `FORBIDDEN`. `VALIDATION_ERROR` devuelve el primer issue de Zod, sin `fieldErrors` |
| `editarPlantillaNotificacionAction(plantillaId, input)` | `PATCH …/[id]` | Ídem; `CAMPO_INMUTABLE` vía `errorEdicion()` |
| `darDeBajaPlantillaNotificacionAction(plantillaId, input)` | `PATCH …/[id]/baja` | Ídem |
| `reactivarPlantillaNotificacionAction(plantillaId)` | `PATCH …/[id]/reactivar` | Ídem |

`listarPlantillasNotificacion()` no tiene ruta ni Server Action: la página del servidor la llama directo y revalida el permiso (el spec no define `GET` de listado, Punto abierto 3).

### 5.3. Errores

| Código | HTTP | Mensaje | Caso |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Mensaje de Zod | Body inválido, `id` no UUID ("El identificador de la plantilla debe ser un UUID válido"), edición con `{}` ("Debe indicar al menos un campo a modificar"), baja sin motivo o con motivo solo de espacios |
| `CAMPO_INMUTABLE` | 400 | "Unrecognized key(s) in object: 'tipo_evento'" (textual del spec) | Edición con `tipo_evento` en el body |
| `PLANTILLA_NO_ENCONTRADA` | 404 | "La plantilla indicada no existe" | Edición, baja o reactivación sobre un id inexistente |
| `PLANTILLA_YA_EXISTE` | 409 | "Ya existe una plantilla activa para "`<tipo_evento>`"" | Alta sobre un evento con plantilla activa (`P2002` sobre fila activa) |
| `PLANTILLA_DADA_DE_BAJA` | 409 | Alta: "La plantilla de "`<tipo_evento>`" está dada de baja. Reactivala con PATCH /api/notificaciones/plantillas/`<id>`/reactivar en lugar de crear una nueva." · Edición: "La plantilla está dada de baja. Reactivala antes de modificarla." | Alta sobre un evento con plantilla dada de baja (`P2002` sobre fila inactiva); edición de una dada de baja, incluida una baja concurrente entre la lectura y el `updateMany` |
| `PLANTILLA_YA_DADA_DE_BAJA` | 409 | "La plantilla ya fue dada de baja" | Baja repetida o concurrente |
| `PLANTILLA_YA_ACTIVA` | 409 | "La plantilla ya está activa" | Reactivación de una plantilla activa o reactivación concurrente. **No estaba en el spec original** (PA 1) |
| `TIPO_EVENTO_DESCONOCIDO` | 422 | ""`<tipo_evento>`" no es un tipo de evento de dominio registrado" | Alta con un evento fuera del registro |
| `UNAUTHORIZED` / `FORBIDDEN` | 401 / 403 | — | Sin sesión / sin el permiso (HTTP 12: `administrador.seed` recibe 403 en las 4 rutas; HTTP 13: `encargado.seed`; HTTP 14: sin sesión) |
| `INTERNAL_ERROR` | 500 | "Error interno del servidor" | Error inesperado |

### 5.4. Reglas del servicio (resumen)

- **Registro de eventos.** `TIPOS_EVENTO_PLANTILLA` = `TIPOS_EVENTO_DOMINIO` + `TIPOS_EVENTO_DECLARADOS_SPRINT_4`, ordenado (74 tipos). Se valida antes de escribir.
- **Alta.** Sin chequeo previo de duplicados: la unicidad la garantiza el `@unique`. Ante `P2002` se lee la fila existente por `tipo_evento` **sin filtrar `is_active`** (a propósito: hay que distinguir activa de dada de baja) y se traduce a `PLANTILLA_YA_EXISTE` o `PLANTILLA_DADA_DE_BAJA`.
- **Edición, baja y reactivación.** Dentro de `$transaction`: `findFirst` por `id` para distinguir inexistente de estado incorrecto → `updateMany` con guarda (`is_active: true` en edición y baja, `is_active: false` en reactivación) → si `count === 0`, la carrera se traduce al `409` correspondiente. La edición relee la fila dentro de la transacción para armar `valor_nuevo`.
- **Eventos.** Se emiten siempre **después** de la `$transaction` (o del `create`). El servicio nunca escribe `AuditLog`.
- **Sin `delete`/`deleteMany`** sobre `plantillaNotificacion` (unitario "sin DELETE físico").

## 6. Eventos auditados

Cuatro eventos nuevos en `DomainEventMap` (`src/lib/events/event-types.ts`), emitidos con `domainEventBus.emit()` **después del COMMIT**. `audit-log.listener.ts` es la única vía de escritura a `AuditLog`: los cuatro handlers usan `domainEventBus.on(…, (payload) => { void registrarAuditLog({…}) })`, sin `await`.

| Evento | Disparado por | Payload | `accion` | `valor_anterior` | `valor_nuevo` |
|---|---|---|---|---|---|
| `notificacion_plantilla:creada` | Alta | `{ plantilla_id, tipo_evento, usuario_id, valor_nuevo: { asunto, cuerpo, prioridad_default } }` | `CREATE` | `null` | `{ tipo_evento, asunto, cuerpo, prioridad_default }` |
| `notificacion_plantilla:actualizada` | Edición | `{ plantilla_id, tipo_evento, usuario_id, valor_anterior, valor_nuevo }`, ambos `{ asunto, cuerpo, prioridad_default }` en ese orden de claves | `UPDATE` | Redacción previa | Redacción nueva (releída en la transacción) |
| `notificacion_plantilla:baja_logica` | Baja | `{ plantilla_id, tipo_evento, usuario_id, valor_anterior: { is_active: true }, valor_nuevo: { is_active: false, deletion_reason } }` | `DELETE_LOGICO` | `{ is_active: true }` | `{ is_active: false, deletion_reason }` |
| `notificacion_plantilla:reactivada` | Reactivación | `{ plantilla_id, tipo_evento, usuario_id, valor_anterior: { is_active: false }, valor_nuevo: { is_active: true } }` | `REACTIVACION` (la misma que `usuario:reactivado`) | `{ is_active: false }` | `{ is_active: true }` |

En los cuatro: `usuario_id` = `usuario_id` del payload, `tabla_afectada = "plantillas_notificacion"` (el `@@map`), `registro_id = plantilla_id`, `ip = "internal-event"`. Los valores `CREATE` / `UPDATE` / `DELETE_LOGICO` son los genéricos vigentes del listener (precedente HU-H9), confirmados en el Paso 0. Ningún payload lleva datos sensibles (spec F §4.1).

## 7. Hallazgos durante el desarrollo

| # | Sev. | Hallazgo | Tratamiento |
|---|---|---|---|
| H1 | — | **El mínimo de HU-F3 ya existía** (Paso 0, discrepancia 2). `notificacion.service.ts` (con `DEFAULT_NOTIFICATION_TEXT` y `generarNotificacionClienteWeb()`), `notificacion.reglas.ts` (`renderizarPlantilla`) y `notificacion.listener.ts` los introdujeron HU-E1/E2. `generarNotificacionClienteWeb()` ya consulta la plantilla activa inline | Se implementó `obtenerPlantillaActivaPorEvento()` con el mismo `where`, sin tocar ese archivo, con nota para HU-F3 (sección 3.1) |
| H2 | — | **El seed tiene 5 plantillas, no 3** como decía la tabla §2 de la task (Paso 0, discrepancia 1): también `ecommerce:carrito_articulo_no_disponible` (HU-E1) y `ecommerce:pedido_pago_confirmado` (HU-E2), cuyos eventos sí existen en `DomainEventMap` | Sin impacto en los casos de prueba; quedan dentro del registro de eventos |
| H3 | — | **El spec §2.2 se contradice a sí mismo** sobre el reemplazo de una plantilla (crear nueva y dar de baja la anterior vs. reactivar y editar la existente) | Resuelto con PA 1, opción (b) |
| H4 | — | **El "fix de `router.refresh()`" de HU-H9** se aplicó solo a `FormularioRegistrarComprobante.tsx`; en `DialogAnularComprobante` se verificó que el bug no se reproducía y quedó cerrar → refrescar | HU-F2 sigue lo que pide la task (refrescar antes de cerrar) en los cuatro diálogos |
| H5 | Bajo | **Bug del test HTTP, caso 14.** El helper `llamar(metodo, destino, body?, cookie = admin)` recibía `undefined` para "sin sesión", y un `undefined` explícito activa el valor por defecto: la request iba con la sesión de admin y daba `409` en lugar de `401`. En la primera corrida (contra la base de desarrollo) la suite dio 23/25: ese caso más el test que agrupa a los demás | Se pasó a `cookie: string \| null` y `null` para sin sesión (incluido en `bcd0e31`). El 401 se volvió a comprobar con curl y la suite completa dio 25/25 sobre base descartable recién sembrada (sección 9) |
| H6 | Bajo | **Lint `react-hooks/set-state-in-effect`** en los tres diálogos, que reiniciaban su estado con `setState` dentro de `useEffect` al abrirse | Se quitó el `useEffect`: la tabla remonta cada diálogo con un `key` nuevo en cada apertura y el estado inicial sale de las props |
| H7 | — | **Clic perdido en la automatización del navegador.** Con la pestaña de Chrome en `visibilityState: "hidden"` (abierta en segundo plano), Base UI no termina la animación de salida del diálogo: el overlay queda montado en `data-ending-style` y se come el siguiente clic | Efecto del entorno, no del producto: afecta a cualquier diálogo del componente compartido de `ui/`. La verificación funcional se hizo con la pestaña visible (sección 8), sin overlays colgados |
| H8 | — | **La base de desarrollo (`swat_erp_db`) está sembrada con una versión anterior del seed:** tenía 3 plantillas y le faltan las de HU-E1/E2 | Informativo; no se re-sembró |
| H9 | — | **El test HTTP no es re-ejecutable sobre la misma base.** El caso 1 crea la plantilla de `usuario:suspendido_automaticamente`, y por `tipo_evento @unique` sin `DELETE` esa fila queda para siempre (el test la deja dada de baja, así que el evento sigue usando el texto por defecto) | El test verifica la precondición al arrancar y avisa si la base no está recién sembrada. Documentado en la sección 9 |

## 8. Verificación funcional en el navegador (03/10/2026)

Recorrido hecho con **Claude in Chrome**, con la pestaña **visible** (`visibilityState: "visible"`; ver H7), contra el `next dev` de desarrollo en `:3000` y la base `swat_erp_db`, confirmada como descartable para esta prueba. Usuario: `admin.plataforma.seed`. Evento de prueba: `rol:creado`, que no está en el seed, para no tocar fixtures de otros tests. Antes del primer paso se dejó una marca en `window` para detectar recargas completas de la página; siguió presente hasta el final, y al terminar no quedó ningún overlay de diálogo montado.

| # | Paso | Resultado |
|---|---|---|
| 1 | Crear: evento `rol:creado` (ofrecido por el select porque no tenía plantilla), asunto "Nuevo rol creado (prueba HU-F2)", cuerpo con `{{nombre}}`, prioridad Informativa | El diálogo se cerró, toast "Plantilla creada" y la fila `rol:creado` apareció en "Activas" sin recargar |
| 2 | Editar el cuerpo | Toast "Plantilla actualizada"; la columna "Actualizada" pasó de 5:33 a 5:34, y al reabrir Editar el cuerpo ya era el nuevo |
| 3 | Dar de baja con motivo | Toast "Plantilla dada de baja"; la fila salió de "Activas" y el contador pasó a "Dadas de baja (2)", donde se ve con estado Baja |
| 4 | Reactivar | El diálogo mostró el motivo de la baja; toast "Plantilla reactivada" y la fila volvió a "Activas" |
| 5 | Baja final, para dejar la base limpia | Toast de baja; `rol:creado` queda dada de baja y el evento vuelve al texto por defecto |

Verificado en BD al terminar:
- `rol:creado` quedó con `is_active = false`, `deleted_at` informado, el motivo de la última baja y el cuerpo editado.
- Cinco asientos de auditoría para esa plantilla, en orden: `CREATE`, `UPDATE`, `DELETE_LOGICO`, `REACTIVACION`, `DELETE_LOGICO`.
- `POST /api/auditoria/verificar-cadena` con `auditor.seed` ⇒ `integra: true` sobre 30 registros.
- No se tocó `stock:umbral_critico_alcanzado` ni ninguna otra plantilla del seed.

Antes del recorrido se capturaron la tabla y los cuatro diálogos abiertos sin confirmar, y se comprobó que la sección "Administración" aparece en el Sidebar para `admin.plataforma.seed`.

**Estado que queda en `swat_erp_db`:** dos plantillas dadas de baja que no estaban en el seed: `usuario:suspendido_automaticamente` (de la primera corrida del test HTTP) y `rol:creado` (de este recorrido). Ninguna se puede volver a crear por `tipo_evento @unique`; ambos eventos usan el texto por defecto.

## 9. Cómo correr las pruebas

Scripts (`package.json`): los tres unitarios de HU-F2 están en `npm test`; la suite HTTP es `test:integration:f2-http`.

Variables (solo nombres; nunca valores ni secretos en archivos):

| Variable | Suite | Para qué |
|---|---|---|
| `HU_F2_INTEGRATION_DATABASE_URL` | `f2-http` | Base **descartable recién sembrada** donde el test verifica su estado. Sin ella, la suite se saltea |
| `HU_F2_INTEGRATION_BASE_URL` | `f2-http` | URL del servidor de test |
| `DATABASE_URL` | servidor de `f2-http` | Debe apuntar a la **misma** base que `HU_F2_INTEGRATION_DATABASE_URL` |

```bash
# Base descartable migrada y sembrada (el seed crea las plantillas, el permiso y admin.plataforma.seed)
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "CREATE DATABASE <base_descartable>"
export TEST_DB="<url de la base descartable>"
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed

npm test

# HTTP: servidor APARTE sobre la misma base (Next 16 permite un solo next dev por directorio).
DATABASE_URL=$TEST_DB npx next build
DATABASE_URL=$TEST_DB npx next start -p 3102
HU_F2_INTEGRATION_BASE_URL=http://localhost:3102 HU_F2_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:f2-http
```

**La suite HTTP no es re-ejecutable sobre la misma base** (H9): exige que `usuario:suspendido_automaticamente` no tenga plantilla y aborta con un mensaje claro si ya la tiene. Para volver a correrla hay que crear y sembrar otra base.

Resultados (03/10/2026):

| Corrida | Resultado |
|---|---|
| Unitarios de HU-F2 | **31/31**: `notificaciones.schema.test.ts` 12 · `event-types.test.ts` 4 · `plantilla-notificacion.service.test.ts` 15 |
| Unitarios (`npm test`, suite completa) | **585/585** |
| `test:integration:f2-http` | **25/25** contra `swat_erp_qa_f2` (base descartable creada, migrada y sembrada para esta corrida) y `next start -p 3102`. Antes de correrla se confirmó que el servidor escribía en esa base y no en `swat_erp_db` (un login sumó una sesión en la de QA y ninguna en la de desarrollo) |
| `tsc --noEmit` · `eslint` (archivos de la HU) | 0 errores |
| `next build` | OK |

Los 25 de la suite HTTP son 24 casos más el test contenedor que cuenta el runner: los 19 de la task, el 6b (edición con body vacío ⇒ 400), tres verificaciones en BD (plantilla reactivada con los campos de baja limpios, conteo sin `DELETE`, asientos de `AuditLog`) y la verificación de la cadena SHA-256 (`integra: true`). La primera corrida, contra la base de desarrollo, dio 23/25 por el bug del test descripto en H5.

## 10. Limitación conocida, fuera de alcance y deuda

### 10.1. Limitación conocida: `valor_anterior` sin bloqueo de fila

En la edición, `valor_anterior` se lee con `findFirst` **antes** del `updateMany`, sin `SELECT … FOR UPDATE`. Si dos ediciones de la misma plantilla llegan casi al mismo tiempo, el `valor_anterior` del asiento de auditoría de una de ellas puede no reflejar la redacción que efectivamente reemplazó. `valor_nuevo` sí es exacto (se relee dentro de la transacción, con la fila ya bloqueada por el `UPDATE`). Mismo criterio que HU-H9. Resolverlo requiere SQL directo con `FOR UPDATE`; se dejó documentado y no se resolvió en esta HU.

### 10.2. Fuera de alcance

Generación de notificaciones, reemplazo de placeholders, `DEFAULT_NOTIFICATION_TEXT` y el listener del Motor (HU-F3); conector de Mercado Pago (HU-F1); log técnico (HU-F5, no priorizada); mensajería externa (directiva del PO); definición de los eventos `ecommerce:*` reales en `event-types.ts` (sus dueños de HU-E12/E13).

### 10.3. Deuda que sigue abierta

| Punto | Detalle |
|---|---|
| Catálogo de variables por evento (PA 5) | El CA1 nombra "nombre del destinatario, Nº de pedido, estado, fecha estimada", pero las claves reales dependen del payload de cada evento. Sin catálogo, la UI no puede sugerir variables válidas. **Sigue abierto**; por eso CA1 queda parcial |
| Texto por defecto de punta a punta (CA3) | Depende de que HU-F3 suscriba los eventos de la tabla §3.3 del spec, empezando por `usuario:suspendido_automaticamente` |
| Rol Marketing/Atención al Cliente (PA 6) | El Alcance F §5 le da crear, editar y dar de baja plantillas, pero el rol no está sembrado. El permiso queda exclusivo del Administrador de Plataforma. El spec §2.2 deja a definir si ese rol necesita permisos separados por acción |
| `TIPOS_EVENTO_DECLARADOS_SPRINT_4` | Borrarla cuando HU-E12/E13 agreguen los tres eventos `ecommerce:*` al `DomainEventMap` |
| Consumo de `obtenerPlantillaActivaPorEvento()` | `generarNotificacionClienteWeb()` sigue con su consulta inline; HU-F3 debería pasar a usar la función (nota en el código) |
| Eventos de ejemplo del spec (PA 7) | El spec §2.2 cita `inventario:stock_minimo_alcanzado` y `ventas:diferencia_arqueo_detectada`, que no son eventos reales. No se usaron en los tests |
| Base de desarrollo | Re-sembrar `swat_erp_db` si se quiere volver a tener `usuario:suspendido_automaticamente` y `rol:creado` sin plantilla (sección 8) |

## 11. Lecciones de proceso

1. **El Paso 0 encontró código de otra HU antes de crear nada.** La task pedía crear `obtenerPlantillaActivaPorEvento()` como contrato para HU-F3, pero el relevamiento mostró que HU-E1/E2 ya habían introducido un mínimo del Motor de Notificaciones (`notificacion.service.ts`, `notificacion.reglas.ts`, `notificacion.listener.ts`) con la misma consulta inline. Sin ese relevamiento, F2 habría documentado `DEFAULT_NOTIFICATION_TEXT` y el reemplazo de variables como trabajo pendiente de F3 sin saber que ya existían, o habría tocado un archivo ajeno. Se resolvió con el mismo `where`, sin tocar el archivo de F3 y dejando la nota para su dueño. También fue el Paso 0 el que mostró que `event-types.ts` no tenía lista en runtime, que el seed tenía 5 plantillas y no 3, y que el route group `administracion/` no existía.
2. **Las decisiones pendientes se llevan a la task antes de implementar, no se dejan en el chat.** Los puntos abiertos 1, 2, 4 y 8, las PROPUESTAS y las discrepancias del Paso 0 se decidieron en la conversación, pero antes de escribir código se volcaron a `docs/tasks/HU-F2.md` (sección 4.1-bis, resumen 4.3-bis, puntos marcados RESUELTO con su planteo original) y se revisó el diff de la task. Así la implementación tuvo una sola fuente de verdad, y este documento se escribió contra la task y el código, no contra el historial del chat.
3. **El resultado de un test se confirma corriéndolo de nuevo, no se infiere.** El caso 14 se arregló y se comprobó a mano, pero la evidencia que vale es la corrida completa sobre una base recién sembrada (25/25), no la suma de la corrida parcial y una comprobación con curl.
4. **Las pantallas se prueban en el navegador, y con la pestaña visible.** El clic perdido de H7 parecía un bug de la UI y era del entorno. El flujo real (refresh antes del cierre, toast, cambio de filtro) solo se pudo verificar con la pestaña visible.

## 12. Archivos de la implementación

Todo en el commit `bcd0e31` (backend + frontend, 22 archivos).

**Nuevos**

- `src/lib/schemas/notificaciones.schema.ts` (+ `notificaciones.schema.test.ts`): `PlantillaNotificacionIdSchema`, `CrearPlantillaNotificacionSchema`, `EditarPlantillaNotificacionSchema`, `EditarPlantillaNotificacionBodySchema`, `DarDeBajaPlantillaNotificacionSchema`, `errorEdicion()`
- `src/lib/services/notificaciones/plantilla-notificacion.service.ts`: `crearPlantillaNotificacion`, `editarPlantillaNotificacion`, `darDeBajaPlantillaNotificacion`, `reactivarPlantillaNotificacion`, `obtenerPlantillaActivaPorEvento`, `listarPlantillasNotificacion`, `PERMISO_ADMINISTRAR_PLANTILLAS`, `TIPOS_EVENTO_PLANTILLA` y `TIPOS_EVENTO_DECLARADOS_SPRINT_4` (privada)
- `src/lib/services/notificaciones/plantilla-notificacion.service.test.ts`, `plantilla-notificacion.http.integration.test.ts`
- `src/lib/events/event-types.test.ts`
- `src/app/api/notificaciones/plantillas/route.ts`
- `src/app/api/notificaciones/plantillas/[id]/route.ts`
- `src/app/api/notificaciones/plantillas/[id]/baja/route.ts`
- `src/app/api/notificaciones/plantillas/[id]/reactivar/route.ts`
- `src/app/(dashboard)/administracion/notificaciones/actions.ts` (route group nuevo)
- `src/app/(dashboard)/administracion/notificaciones/plantillas/page.tsx`, `loading.tsx`
- `src/components/notificaciones/TablaPlantillasNotificacion.tsx`
- `src/components/notificaciones/DialogPlantillaNotificacion.tsx` (crear y editar)
- `src/components/notificaciones/DialogBajaPlantillaNotificacion.tsx`
- `src/components/notificaciones/DialogReactivarPlantillaNotificacion.tsx`
- `src/components/notificaciones/prioridad.ts`

**Modificados**

- `src/lib/events/event-types.ts`: 4 interfaces de payload + `PlantillaNotificacionRedaccion`, 4 entradas en `DomainEventMap`, `TIPOS_EVENTO_DOMINIO` y el chequeo `_registroCompleto`
- `src/lib/events/listeners/audit-log.listener.ts`: 4 handlers `notificacion_plantilla:*`
- `src/components/layout/Sidebar.tsx`: sección "Administración" con "Plantillas de notificación" (`notificaciones:administrar_plantillas`)
- `package.json`: los 3 unitarios en `npm test` y el script `test:integration:f2-http`

**No se tocan:** `prisma/schema.prisma`, migraciones, `prisma/seed.ts`, `notificacion.service.ts` / `notificacion.reglas.ts` / `notificacion.listener.ts` (HU-F3), los eventos `ecommerce:*` de HU-E12/E13. Ningún `DELETE` ni `deleteMany`; sin dependencias nuevas.
