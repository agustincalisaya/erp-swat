# HU-F3 — Motor de notificaciones internas (Módulo F)

Contrato: `docs/specs/spec_modulo_F.md` Rev. 1 — §2.3 (contrato del Motor, líneas 207–276, con las decisiones de cierre de esta HU), §3.2 (placeholders, 284–286), §3.3 (tabla de consumidores, 288–304), §3.4 (`onDelete: Restrict`, 306–310) y §4 (eventos de dominio, 312–331); `spec_modulo_E.md` §4 (eventos de Módulo E consumidos, 898–931); `spec_modulo_D.md` §5 (`usuario:suspendido_automaticamente`, 287–312). Referencia funcional adicional: Alcance Módulo F §5.1 (minimización: el Motor no usa ni persiste datos de contacto). Este documento resume las decisiones, la evidencia y los hallazgos del desarrollo. La task (`docs/tasks/HU-F3.md`) es un artefacto local que no se versiona; todo lo relevante de ella está incorporado acá.

**Módulo:** F — Arquitectura Tecnológica y Conectividad · **Responsable:** Cali · **Sprint / estimación:** Sprint 4 · 5 SP
**Estado:** Implementada y verificada para el personal interno (backend + frontend). 6 de 8 CA aprobados; CA7 parcial (la superficie del Cliente Web quedó fuera de este PR por decisión de alcance) y CA8 con 3 consumidores **Bloqueados** por falta de evento de dominio en sus módulos de origen.
**Commit:** `3df302d` — `feat(notificaciones): motor de notificaciones internas (HU-F3)` (backend + frontend en un único commit, 19 archivos).

## 1. Historia de usuario y qué hace

**Como** Usuario del sistema (personal interno o Cliente Web), **necesito** recibir en una bandeja dentro del sistema las notificaciones de los eventos que requieren mi atención, **para** enterarme a tiempo de alertas, aprobaciones pendientes y cambios de estado sin depender de mensajería externa.

| Capacidad | Dónde | Resultado |
|---|---|---|
| Motor | `generarNotificaciones()` (`notificacion.service.ts`), núcleo puro `ejecutarMotorNotificaciones()` (`notificacion.reglas.ts`) | Resuelve destinatarios (usuarios puntuales + roles expandidos + cuentas web, sin duplicados), aplica la plantilla de HU-F2 o `DEFAULT_NOTIFICATION_TEXT` y persiste **una fila por destinatario** con el texto ya resuelto. Idempotente por `clave_idempotencia` (`P2002` = no-op). Nunca lanza: los errores se loguean y se cuentan |
| Listener | `src/lib/events/listeners/notificacion.listener.ts` | Única vía de generación. Tabla de suscripción declarativa, post-COMMIT y fire-and-forget; atrapa errores síncronos y asíncronos para que nunca lleguen al emisor |
| Bandeja | `GET /api/notificaciones` · página `/notificaciones` | Solo las activas del usuario de la sesión, CRITICA primero y luego más recientes, filtros por prioridad y "solo no leídas", paginación, `no_leidas` independiente de los filtros |
| Marcar leída | `PATCH /api/notificaciones/[id]/leer` · `marcarNotificacionLeidaAction()` | Idempotente: repetir devuelve el mismo `leida_at`. Ajena o inexistente ⇒ `404 NOTIFICACION_NO_ENCONTRADA` |
| Marcar todas leídas | `PATCH /api/notificaciones/marcar-todas-leidas` · `marcarTodasLeidasAction()` | `{ actualizadas: n }` |
| Archivar | `PATCH /api/notificaciones/[id]/archivar` · `archivarNotificacionAction()` | Baja lógica del lado del destinatario (`is_active`, `deleted_at`, `deleted_by`, sin `deletion_reason`). Idempotente. Ajena o inexistente ⇒ `404` |
| Campana | `CampanaNotificaciones.tsx` en el header (`Navbar.tsx`) | Contador de no leídas visible en todo el dashboard; polling cada 30 s, pausado con la pestaña oculta; resaltado en rojo si hay una CRITICA sin leer |
| Wrapper de HU-E1/E2 | `generarNotificacionClienteWeb()` | Se conserva con su firma original, ahora sobre el motor general |

## 2. Criterios de aceptación (8) — estado y evidencia

Evidencia: unitarios (`notificacion.reglas.test.ts`, `notificaciones.schema.test.ts`, `notificacion.service.test.ts`), `notificacion.http.integration.test.ts` (HTTP con login real + verificación en BD, `test:integration:f3-http`, 16/16 y re-ejecutable sobre base descartable) y capturas con sesión real (sección 8).

| CA | Criterio (Backlog) | Estado | Evidencia |
|---|---|---|---|
| CA1 | Cada usuario dispone de una bandeja con contador de no leídas, visible desde cualquier pantalla y actualizado casi en tiempo real | Aprobado | Campana en el header del layout de `(dashboard)` con polling a `?solo_no_leidas=true&page_size=1` (spec F §2.3: sin push). HTTP 1, 2 y 7 (`no_leidas`). Capturas `HU-F3_dashboard_con_campana.png` y `HU-F3_header_campana_critica.png` |
| CA2 | Una notificación puede dirigirse a un usuario puntual o a todos los usuarios de un rol | Aprobado | Unitarios "expansión de rol sin duplicados" y "usuario explícito dado de baja se descarta". HTTP 11 (Rol `ENCARGADO_DEPOSITO`) y 13 (`vendedor.seed` puntual + todos los `ADMINISTRADOR`, una fila por destinatario) |
| CA3 | Las notificaciones se generan a partir de eventos emitidos después del COMMIT; una falla al generarlas nunca bloquea ni revierte la operación de origen | Aprobado | Listener fire-and-forget (unitario source-regex "sin await hacia el emisor y con captura de errores síncronos y asíncronos"). Unitarios "error genérico en un destinatario no corta a los demás ni se propaga" y "si falla la resolución (BD caída) loguea y devuelve sin lanzar". HTTP 14: un error síncrono (fecha inválida) y uno asíncrono de BD (FK) no llegan al `emit()` |
| CA4 | Cada notificación tiene una clave de idempotencia derivada del evento de origen: un mismo evento nunca genera dos notificaciones al mismo destinatario | Aprobado | `clave_idempotencia @unique` + `P2002` = no-op (unitario). Clave `sha256(tipo:clave_origen:destinatario)`, con `clave_origen` por ocurrencia (sección 3.1). Nivel 3: sin claves repetidas. HTTP 12 (hallazgo esperado del Punto 5) |
| CA5 | Niveles de prioridad crítica, advertencia e informativa; las críticas se destacan y se listan primero | Aprobado | `orderBy: [{ prioridad: "asc" }, { created_at: "desc" }]` sobre el enum de Postgres, que ordena por declaración (Nivel 3: `enum_range` = `CRITICA, ADVERTENCIA, INFORMATIVA`). HTTP 13 (primer ítem del administrador = CRITICA). Captura `HU-F3_bandeja_critica_primero.png` (borde, ícono y chip rojos) |
| CA6 | El usuario puede marcar notificaciones como leídas, individualmente o todas, y archivarlas mediante baja lógica | Aprobado | HTTP 5 (leída e idempotente), 7 (todas), 8 (archivar: desaparece de la bandeja, `is_active=false`, `deleted_at`, `deleted_by`, `deletion_reason` null; repetir ⇒ 200). Unitario "sin DELETE físico" |
| CA7 | Un Cliente Web solo ve sus propias notificaciones; el personal interno solo ve las dirigidas a su usuario o a sus roles | **Parcial** | Personal interno: HTTP 6 (la notificación de Juan Pérez ⇒ 404 y queda intacta), 9 (`auditor.seed` ve 0) y 10 (401 sin sesión); el destinatario sale siempre de la sesión (unitario source-regex). **Cliente Web:** el servicio soporta el destinatario `CLIENTE_WEB` (unitario "escribe solo `cuenta_cliente_web_destinatario_id`"), pero las rutas `/api/tienda/notificaciones/**` y la UI de la tienda **no están en este PR** por decisión de alcance (HU-E8 ya está mergeada; ver H1). Casos 15–18 de la task sin ejecutar |
| CA8 | Consumidores iniciales: stock mínimo (A), diferencias de arqueo (B2/G1), bloqueo de usuario (D2), ruptura de la cadena de hashes (D4), OC pendientes de aprobación (H) y estados de pedidos web (E3, E9, E12, E13) | **Parcial** | Ver el desglose de abajo |

Desglose de CA8 por consumidor:

| Consumidor | Evento | Estado | Evidencia / motivo |
|---|---|---|---|
| Stock mínimo (Módulo A, HU-A7) | `stock:umbral_critico_alcanzado` → Rol `ENCARGADO_DEPOSITO`, ADVERTENCIA | Aprobado | HTTP 11: egreso real bajo el umbral ⇒ notificación con la plantilla de HU-F2 renderizada |
| Bloqueo de usuario (Módulo D, D.2) | `usuario:suspendido_automaticamente` → usuario afectado + Rol `ADMINISTRADOR`, CRITICA | Aprobado | HTTP 13: 5 logins fallidos reales ⇒ CRITICA con `DEFAULT_NOTIFICATION_TEXT` y `plantilla_id` null para ambos. Es el evento de la tabla §3.3; el bloqueo manual (`usuario:estado_cambiado`) no está en esa tabla |
| Diferencias de arqueo (B2/G1) | — | **Bloqueado** | No existe evento de diferencia de arqueo. Lo más cercano es `venta:turno_cerrado` (trae `diferencia` y `requiere_justificacion`), que no es un evento de diferencia. Decide el dueño de B2/G1 |
| Ruptura de la cadena de hashes (D.3/D.4) | — | **Bloqueado** | `POST /api/auditoria/verificar-cadena` detecta y reporta, pero no emite ningún evento. Hace falta uno nuevo en Módulo D |
| OC pendientes de aprobación (H) | — | **Bloqueado** | `EstadoOrdenCompra` no tiene un estado de pendiente de aprobación y `orden_compra:estado_cambiado` solo cubre ENVIAR/CONFIRMAR/CERRAR/CANCELAR. Decide el dueño de H |
| Estados de pedidos web (E) | `ecommerce:pedido_pago_confirmado` (activo, introducido por HU-E2) · `ecommerce:carrito_articulo_no_disponible` (activo, introducido por HU-E1) · `pedido_listo_para_retiro`, `plazo_retiro_por_vencer`, `pedido_vencido_sin_retiro` | **Parcial** | Las 2 suscripciones existentes se conservaron sobre el motor nuevo (integraciones E1 21/21 y E2 11/11). Los otros 3 eventos no están declarados en `event-types.ts`: cada dueño (HU-E12/E13) agrega su fila a la tabla de suscripción al declararlo. El rol Operador de Pick & Pack de `pedido_pago_confirmado` queda para HU-E12 (ver H6) |

## 3. Decisiones de producto y técnicas

### 3.1. Backend (Paso 0 y puntos abiertos de la task)

| # | Decisión | Opción elegida | Motivo |
|---|---|---|---|
| D1 | HU-E8 ya estaba mergeada (la task la daba como bloqueo) | La superficie del Cliente Web **no se implementa en este PR**; el servicio ya soporta el destinatario `CLIENTE_WEB` | Alcance acotado a personal interno, como dice la task |
| D2 | El Motor ya existía en versión mínima (HU-E1/E2) | Generalizar `generarNotificaciones()` como motor; `generarNotificacionClienteWeb()` queda como wrapper; se mantienen las 2 suscripciones `ecommerce:*` | No romper E1/E2 y no duplicar la lógica |
| PA 5 | Clave de idempotencia en eventos recurrentes | **Opción A: `clave_origen` por ocurrencia.** `${movimiento_id_origen}:${stock_deposito_id}` para el umbral (el payload real trae `movimiento_id_origen`; el par hace falta porque un movimiento multi-ítem emite una alerta por fila) y `${usuario_id}:${bloqueado_hasta.toISOString()}` para la suspensión. La fórmula del hash no cambia | Con el registro solo, una segunda alerta legítima sobre la misma fila nunca se notificaría (caso 12). Reflejado en spec F §2.3 |
| PA 6 | `z.coerce.boolean()` en `solo_no_leidas` | **Se copia textual** del spec y se documenta como bug conocido (igual que HU-B6). Test de evidencia: `"false"` parsea a `true` | Regla del proyecto: el schema del spec se copia textual. Documentado en spec F §2.3 |
| PA 8 | Shapes y códigos no definidos en el spec | Asunto por defecto "Tenés una novedad" (sin cambios) y cuerpo neutral "Hay una novedad que requiere tu atención." (antes decía "Ingresá a la tienda"); `404 NOTIFICACION_NO_ENCONTRADA`; `{ actualizadas: n }`; `{ notificacion_id, is_active: false }` | El texto por defecto lo leen las dos superficies; 404 y no 403 para no confirmar existencia (criterio de spec E §2.9) |
| PA 9 | Identificación del rol destinatario | **`Rol.nombre`** (`ENCARGADO_DEPOSITO`, `ADMINISTRADOR`) | Elegir a quién avisar no es autorización. Excepción explícita a "autorización siempre por permiso", documentada en spec F §2.3. Ver H6 |
| PA 3 | 3 consumidores sin evento | **Bloqueado** (sección 2) | No hay evento que suscribir; crearlos es de sus módulos |
| PA 4 | Inconsistencia de nombres F §3.3 vs E §4 | Verificado en el repo: **están alineados** | Ver H5 |
| Motor | Testear el motor con un "prisma" falso | El núcleo vive en `notificacion.reglas.ts` (sin `server-only` ni Prisma) con sus accesos a datos inyectados (`PuertosMotorNotificaciones`); `notificacion.service.ts` los conecta a Prisma | Los unitarios corren con `node --test` sin base de datos |
| Listener | Errores síncronos dentro del handler | `try/catch` alrededor de `armar(payload)` además del `.catch()` de la promesa | El `EventEmitter` despacha en el mismo stack que `emit()`: un `throw` en el handler rompería la operación de origen |
| `P2002` | Detección sin importar `@prisma/client` en el núcleo puro | `esViolacionUnicidad()` por `code === "P2002"` | Mantener `notificacion.reglas.ts` importable desde `node --test` |
| Marcar leída una archivada | El spec no lo dice (Punto 11) | Permitido: `marcarNotificacionLeida()` no filtra `is_active` | PROPUESTA de la task |

### 3.2. Frontend

| Decisión | Motivo |
|---|---|
| La campana reemplaza el botón deshabilitado que dejó HU-D9 en el `Navbar` (Server Component); la campana es un Client Component propio | El `Navbar` ya resolvía la sesión; solo la campana necesita estado y polling |
| Polling cada 30 s, pausado con `document.hidden`, con refetch inmediato al volver a la pestaña | Frecuencia: decisión de frontend (spec F §2.3), PROPUESTA de la task |
| Resaltado de crítica: el endpoint ordena CRITICA primero, así que con `page_size=1` el único ítem es CRITICA si y solo si hay alguna crítica sin leer | Un solo request por ciclo para contador y resaltado |
| La campana nunca envía `solo_no_leidas=false`; la página arma sus links sin el parámetro cuando es `false` | Punto abierto 6 |
| Página `/notificaciones` como RSC que llama al servicio con el destinatario de la sesión (mismo Zod que la ruta); filtros y paginación por query string | Mismo patrón que `/auditoria/logs` |
| Las Server Actions hacen `revalidatePath("/notificaciones")`; el cliente no llama `router.refresh()` | Un único disparador de refetch (lección HU-G10). No hay diálogos, así que no aplica la lección HU-H9 |
| Tras cada acción, la bandeja dispara el evento de ventana `notificaciones:cambiaron` y la campana se actualiza al instante | Evita esperar al próximo ciclo de polling |
| Sin ítem "Notificaciones" en el Sidebar: se accede desde la campana | La campana está en todas las pantallas |

### 3.3. PROPUESTAS aprobadas (códigos y shapes no definidos en el spec)

| Código / elemento | Status | Dónde |
|---|---|---|
| `NOTIFICACION_NO_ENCONTRADA` | 404 | Marcar leída, archivar (inexistente o ajena) |
| Respuesta `200` de marcar todas `{ actualizadas }` | 200 | Marcar todas leídas |
| Respuesta `200` de archivar `{ notificacion_id, is_active: false }` | 200 | Archivar |
| `NotificacionIdSchema` (UUID) | 400 | Marcar leída, archivar |
| `DEFAULT_NOTIFICATION_TEXT` neutral | — | Motor, sin plantilla activa |

## 4. Modelo de datos, migración y seed

**Sin migración.** El schema ya estaba migrado; no se tocó `prisma/schema.prisma`.

| Modelo (tabla) | Uso en HU-F3 |
|---|---|
| `Notificacion` (`notificaciones`) | `plantilla_id?` (null con texto por defecto), `tipo_evento`, `asunto` y `cuerpo` ya resueltos, `prioridad`, `clave_idempotencia @unique`, `usuario_destinatario_id?` / `cuenta_cliente_web_destinatario_id?` (CHECK `notificaciones_destinatario_unico_chk`: exactamente uno, verificado en Nivel 3), `leida_at?`, baja lógica, `created_at`. Índices `(destinatario, is_active, leida_at)` |
| `PlantillaNotificacion` (HU-F2) | Lectura con `obtenerPlantillaActivaPorEvento()` (el motor ya no hace la consulta inline) |
| `UsuarioRol` / `Rol` / `Usuario` | Expansión de roles: los tres activos, `Rol.nombre` en la lista |

**Seed:** no se modificó. Fixtures que usan los tests:

| Qué | Valor |
|---|---|
| Notificaciones de `encargado.seed` (`77b685fd-…`) | `STOCK_CT1_CENTRAL` leída y activa · `STOCK_B1_SHOWROOM` no leída y activa · `STOCK_CT1_SHOWROOM` leída y archivada (ADVERTENCIA, con plantilla) |
| Notificaciones de la cuenta web de Juan Pérez (`e9440ab2-…`) | V-2026-000008 no leída · V-2026-000009 leída · V-2026-000010 archivada (INFORMATIVA) |
| Fórmula de clave del seed | `sha256(tipo_evento:registro_id:destinatario_id)`, igual a la del motor (con `clave_origen` = `registro_id` en esos fixtures) |
| Stock para el E2E | `STOCK_DEPOSITO_SEED_ID` (`90bb1fa7-…`, 40 u., punto de pedido 10) y `STOCK_CT1_CENTRAL` (25 u., punto de pedido 8) |
| Evento sin plantilla | `usuario:suspendido_automaticamente` (texto por defecto) |

## 5. Contrato de endpoints

Los cuatro `route.ts` usan `withAuth` (sesión RBAC válida, sin permiso granular: la autorización es por propiedad del recurso). Envelope estándar `{ data, error }`. Rutas y Server Actions son wrappers finos sobre `notificacion.service.ts` (unitario "rutas: wrappers finos — sin prisma, con withAuth, delegan en el servicio"). El destinatario es siempre `{ tipo: "USUARIO", usuario_id: session.userId }`; ninguna ruta lee un destinatario de query o body.

### 5.1. Rutas

| Método | Ruta (`src/app/api/notificaciones/…`) | Respuestas |
|---|---|---|
| GET | `route.ts` | 200 `{ items[], no_leidas, paginacion: { total, pagina_actual, total_paginas, por_pagina } }` (textual del spec) · 400 `VALIDATION_ERROR` (con `fieldErrors`) · 401 · 500 |
| PATCH | `[id]/leer/route.ts` (sin body) | 200 `{ notificacion_id, leida_at }` (textual del spec) · 400 · 401 · 404 `NOTIFICACION_NO_ENCONTRADA` · 500 |
| PATCH | `marcar-todas-leidas/route.ts` (sin body) | 200 `{ actualizadas }` · 401 · 500 |
| PATCH | `[id]/archivar/route.ts` (sin body) | 200 `{ notificacion_id, is_active: false }` · 400 · 401 · 404 `NOTIFICACION_NO_ENCONTRADA` · 500 |

Query (`src/lib/schemas/notificaciones.schema.ts`): `ListarNotificacionesQuerySchema`, textual del spec (`solo_no_leidas` con el bug conocido, `prioridad?`, `page`, `page_size` máx. 50).

### 5.2. Server Actions (`src/app/(dashboard)/notificaciones/actions.ts`)

| Action | Equivale a |
|---|---|
| `marcarNotificacionLeidaAction(id)` | `PATCH …/[id]/leer` |
| `marcarTodasLeidasAction()` | `PATCH …/marcar-todas-leidas` |
| `archivarNotificacionAction(id)` | `PATCH …/[id]/archivar` |

Mismos códigos, más `UNAUTHORIZED` sin sesión. Destinatario desde `getServerSession()`.

### 5.3. Reglas del servicio (resumen)

- **Bandeja.** `where` con el destinatario + `is_active: true` + filtros; `count` del total con los filtros y `no_leidas` sin filtros; `skip/take` en base.
- **Marcar leída.** `updateMany` con guarda `leida_at: null` → relectura por `id` + destinatario: si existe, 200 con su `leida_at` (idempotente); si no, 404.
- **Archivar.** `updateMany` con guarda `is_active: true`; si `count === 0`, existente propia ⇒ 200 y ajena o inexistente ⇒ 404. `deleted_by` = id del destinatario.
- **Sin `delete`/`deleteMany`** y ninguna escritura de `Notificacion` fuera de `notificacion.service.ts` (unitarios source-regex sobre todo `src/`).
- **Sin eventos de auditoría** (spec F §4): leer o archivar es una acción de bandeja personal.

## 6. Eventos de dominio consumidos

HU-F3 no emite eventos propios. Tabla de suscripción activa (`SUSCRIPCIONES_NOTIFICACION`):

| Evento | Prioridad default | Destinatarios | `clave_origen` | Variables de plantilla |
|---|---|---|---|---|
| `stock:umbral_critico_alcanzado` | ADVERTENCIA | Rol `ENCARGADO_DEPOSITO` | `${movimiento_id_origen}:${stock_deposito_id}` | `cantidad_resultante`, `punto_pedido` |
| `usuario:suspendido_automaticamente` | CRITICA | Usuario afectado + Rol `ADMINISTRADOR` | `${usuario_id}:${bloqueado_hasta ISO}` | `intentos_fallidos`, `bloqueado_hasta` |
| `ecommerce:carrito_articulo_no_disponible` (HU-E1) | ADVERTENCIA | Cuenta web dueña del carrito (visitante ⇒ sin notificación) | `carrito_item_id` | `sku`, `motivo` |
| `ecommerce:pedido_pago_confirmado` (HU-E2) | INFORMATIVA | Cuenta web dueña del pedido | `pedido_venta_id` | `numero_venta` |

Los payloads no llevan datos de contacto ni sensibles (Alcance F §5.1, spec F §4.1); el `ip` del evento de suspensión no se pasa a la plantilla.

## 7. Hallazgos durante el desarrollo

| # | Sev. | Hallazgo | Tratamiento |
|---|---|---|---|
| H1 | — | **HU-E8 ya estaba mergeada** (PR #205/#206): `withSesionClienteWeb()` existe y la sesión expone `cuentaId`. La task la daba como bloqueo | La superficie del Cliente Web queda fuera de este PR por alcance. Notas para quien la implemente: usar `withSesionClienteWeb(…, { permitirPendiente: true })` si la bandeja debe verse con vinculación pendiente; la tienda vive en `(tienda)/tienda/*` (no existe `(tienda)/mi-cuenta/`) |
| H2 | — | **El Motor ya existía en versión mínima** (HU-E1/E2): servicio, reglas y listener con 2 suscripciones `ecommerce:*`, y `DEFAULT_NOTIFICATION_TEXT` con un cuerpo pensado solo para la tienda | Se extendió en lugar de reescribirse (D2) |
| H3 | — | **El endpoint de egreso de Módulo A es `POST /api/inventario/movimientos/ingreso`** con `estado_destino` `VENDIDO` / `RESERVADO` / `BAJA_MERMA` (restan stock). HU-A7 emite la alerta en **cada** egreso que deja la fila en el umbral o por debajo, no solo al cruzarlo | Con la clave por ocurrencia, cada egreso de ese tipo genera una notificación nueva. Documentado en spec F §2.3 como consecuencia conocida |
| H4 | — | **Hallazgo esperado del Punto 5 (caso 12):** con la clave por `registro_id`, una alerta nueva sobre `STOCK_CT1_CENTRAL` chocaría con la fila sembrada y no se notificaría nunca | Resuelto con la clave por ocurrencia; el test lo verifica sin tocar la fila sembrada |
| H5 | — | **F §3.3 y E §4 sí están alineados en el repo** (`ecommerce:carrito_articulo_no_disponible` en ambas; E §4 incluye `pedido_pago_confirmado` y `plazo_retiro_por_vencer`). La inconsistencia que describía la task venía de una copia desactualizada de las specs | Nada que coordinar con el dueño de E1/E5 sobre nombres |
| H6 | **Advertencia para HU-E12** | **`Rol.nombre` (PA 9) choca con `roles-hu-e10.test.ts`.** Ese test recorre todo `src/` (salvo `*.test.ts`) y falla si aparece `ADMINISTRADOR_ECOMMERCE` u `OPERADOR_PICK_PACK`, **incluso en un comentario** (pasó durante esta HU con un comentario del listener). Cuando el dueño de HU-E12 declare la suscripción de `ecommerce:pedido_pago_confirmado` al rol Operador de Pick & Pack por `Rol.nombre`, ese test va a fallar | No se resuelve en esta HU. Opciones para E10/E12: excluir el listener del chequeo con una excepción explícita, o identificar ese destinatario por permiso |
| H7 | **Alta (deuda de Módulo D, no de esta HU)** | **La suspensión automática rompe la cadena SHA-256 del `AuditLog`.** `audit-log.listener.ts` audita `usuario:suspendido_automaticamente` con `bloqueado_hasta` como `Date`; `canonicalizarJson()` (`src/lib/crypto/hash-chain.ts`) lo trata como un objeto sin claves y hashea `{}`, pero `verificar-cadena` lo relee de jsonb como string ISO y recalcula un hash distinto ⇒ `integra: false` desde ese registro. Afecta a toda suspensión automática real, con o sin HU-F3 | No se corrige acá (fuera de alcance, dueño D). El caso 13 de esta HU lo dispara, y por eso `test:integration:f2-http` falla en su chequeo de cadena cuando corre sobre la misma base de pruebas (sección 9) |
| H8 | Bajo | Los primeros tests source-regex daban falsos positivos con palabras de los comentarios (`await`, `prisma.notificacion.create()` en prosa) | Los tests quitan los comentarios antes de evaluar |
| H9 | — | Sin sesión, `/notificaciones` responde 200 con `<meta http-equiv="refresh" content="1;url=/login">` en `next dev` (redirect durante el streaming de la RSC) | Mismo comportamiento que `/administracion/notificaciones/plantillas` (HU-F2); informativo |

## 8. Verificación funcional (capturas con sesión real, 03/10/2026)

Capturas tomadas con **Chrome headless controlado por DevTools Protocol** (no con Claude in Chrome): login real por `POST /api/auth/login`, cookie de sesión de `encargado.seed` cargada en el navegador y PNG guardado directo a disco. Servidor `next dev -p 3103` contra la base descartable `swat_erp_qa_f3`, verificado antes (un login sumó una sesión en la base de QA y ninguna en `swat_erp_db`).

Datos preparados **con flujos reales**, sin escribir en la base: 5 logins fallidos de `encargado.seed` (CRITICA propia con texto por defecto) → reactivación por `PATCH /api/auth/usuarios/[id]/estado` con `admin.seed` (D.2, auditada) → egreso real que deja `STOCK_DEPOSITO_SEED_ID` en su punto de pedido (ADVERTENCIA nueva con la plantilla) → reposición del mismo stock con un ingreso real.

Archivos (en `docs/tasks/`, junto a la task, que no se versiona; mismo lugar que el resto de la evidencia gráfica local):

| Archivo | Muestra |
|---|---|
| `HU-F3_dashboard_con_campana.png` | `/home` con la campana en el header: badge "3" en rojo y campana resaltada por la crítica sin leer |
| `HU-F3_header_campana_critica.png` | Recorte ampliado del header (aria-label de la campana: "Notificaciones (3 sin leer, hay críticas)") |
| `HU-F3_bandeja_critica_primero.png` | `/notificaciones`: filtros (Todas / Críticas / Advertencias / Informativas / Solo no leídas), "3 sin leer", "Marcar todas como leídas", la CRITICA primero (borde izquierdo, fondo, ícono y chip rojos) y luego las ADVERTENCIA por fecha; la ya leída sin punto azul ni botón de marcar |
| `HU-F3_bandeja_filtro_criticas.png` | Filtro "Críticas" activo: solo la CRITICA |
| `HU-F3_bandeja_solo_no_leidas.png` | "Solo no leídas" activo: 3 ítems, CRITICA primero |

## 9. Cómo correr las pruebas

Scripts (`package.json`): los unitarios de HU-F3 están en `npm test` (`notificacion.reglas.test.ts`, `notificaciones.schema.test.ts`, `notificacion.service.test.ts`); la suite HTTP es `test:integration:f3-http`.

Variables (solo nombres; nunca valores ni secretos en archivos):

| Variable | Suite | Para qué |
|---|---|---|
| `HU_F3_INTEGRATION_DATABASE_URL` | `f3-http` | Base **local descartable** (los casos 11–13 disparan el motor de verdad). Sin ella, la suite se saltea |
| `HU_F3_INTEGRATION_BASE_URL` | `f3-http` | URL del servidor de test |
| `DATABASE_URL` | servidor de `f3-http` | Debe apuntar a la **misma** base que `HU_F3_INTEGRATION_DATABASE_URL` |

```bash
docker exec swat_erp_postgres createdb -U erpswat <base_descartable>
export TEST_DB="<url de la base descartable>"
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed

npm test

# HTTP: servidor aparte sobre la misma base (Next 16 permite un solo next dev por directorio).
DATABASE_URL=$TEST_DB npx next dev -p 3103
HU_F3_INTEGRATION_BASE_URL=http://localhost:3103 HU_F3_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:f3-http
```

**La suite HTTP es re-ejecutable sobre la misma base:** restaura por `UPDATE` los fixtures del encargado (el seed usa `upsert` con `update: {}` y no los restaura), archiva las notificaciones que generaron corridas previas, repone el stock con un ingreso real y reactiva a `vendedor.seed` por D.2. Nunca hace `DELETE`.

Resultados (03/10/2026):

| Corrida | Resultado |
|---|---|
| Unitarios (`npm test`, suite completa) | **617/617** |
| Unitarios de HU-F3 | `notificacion.reglas.test.ts` 16 (13 nuevos) · `notificaciones.schema.test.ts` 6 nuevos · `notificacion.service.test.ts` 13 |
| `test:integration:f3-http` | **16/16** contra `swat_erp_qa_f3` (14 casos de la task + Nivel 3 + el test contenedor). Corrida dos veces seguidas, 16/16 ambas |
| `test:integration:e1` / `test:integration:e2` (pasan por el listener reescrito) | **21/21** y **11/11**, sin regresiones |
| `test:integration:f2-http` sobre la misma base | 23/25: falla solo "Cadena SHA-256 íntegra" (y el test contenedor) por el **bug de Módulo D** de H7, que el caso 13 de F3 dispara en esa base. No es una regresión de esta HU |
| `tsc --noEmit` · `eslint` (archivos de la HU) | 0 errores (un warning previo en `ventas.schema.ts`, ajeno) |

## 10. Fuera de alcance y deuda

### 10.1. Fuera de alcance

Superficie del Cliente Web (`/api/tienda/notificaciones/**`, actions y UI de la tienda), declaración o emisión de eventos `ecommerce:*` (dueños de HU-E12/E13), CRUD de plantillas (HU-F2), push en tiempo real (WebSocket/SSE), canales externos (directiva del PO), log técnico (HU-F5), crear eventos nuevos en B/D/G/H para los consumidores bloqueados.

### 10.2. Deuda que sigue abierta

| Punto | Detalle |
|---|---|
| Superficie Cliente Web (CA7) | Rutas `/api/tienda/notificaciones/**` con `withSesionClienteWeb()`, actions y bandeja en la tienda. El servicio ya lo soporta |
| 3 consumidores Bloqueados (CA8) | Diferencia de arqueo (B2/G1), ruptura de cadena (D) y OC pendiente de aprobación (H): necesitan su evento de dominio |
| Filas de E12/E13 | `pedido_listo_para_retiro`, `plazo_retiro_por_vencer`, `pedido_vencido_sin_retiro` y el rol Operador de Pick & Pack en `pedido_pago_confirmado`, con la advertencia de H6 |
| Bug de Módulo D (H7) | Normalizar el `Date` antes de hashear (o pasar `bloqueado_hasta` como ISO en el payload de auditoría). Deuda de D |
| `solo_no_leidas` (PA 6) | Bug conocido, textual. PROPUESTA de corrección para el spec: `z.enum(["true","false"]).default("false").transform((v) => v === "true")` |
| Shape de paginación (Punto 7) | La respuesta copia el spec (`pagina_actual`, `por_pagina`); HU-B6 fijó `{ total, page, page_size }` como estándar real |
| Alta posterior a un rol (Punto 10) | Con expansión al generar, un usuario asignado a un rol después del evento no ve las notificaciones previas de ese rol. Consistente con el spec |
| Volumen de alertas de stock (H3) | Una notificación por egreso bajo el umbral. Si molesta, la regla está en la emisión de HU-A7 |
| Bases de QA | `swat_erp_qa_f3` sigue en el contenedor local (con la cadena de auditoría rota por H7); se puede borrar |

## 11. Lecciones de proceso

1. **El Paso 0 volvió a encontrar el terreno distinto de lo que asumía la task.** HU-E8 ya estaba mergeada, el Motor ya existía en versión mínima con 2 suscripciones `ecommerce:*`, había más eventos `ecommerce:*` declarados de los que decía la task, y las specs F y E ya estaban alineadas. Relevar antes de escribir evitó reimplementar el motor o romper E1/E2.
2. **Un test de otro módulo puede vigilar texto, no solo código.** `roles-hu-e10.test.ts` rompió la suite por un comentario. Antes de nombrar roles o permisos ajenos en `src/`, buscar los tests que recorren el árbol.
3. **Hacer puro el núcleo del motor pagó en tests.** Con los accesos a datos inyectados, los casos difíciles (P2002, falla de un destinatario, BD caída, rol sin usuarios) se prueban en milisegundos sin base de datos, y la integración HTTP queda para el recorrido real.
4. **Una base descartable propia por HU, y confirmar a qué base escribe el servidor.** Los casos 11–13 disparan el motor de verdad y mutan stock y usuarios. Antes de correrlos (y antes de las capturas) se confirmó con un login que el servidor escribía en `swat_erp_qa_f3` y no en `swat_erp_db`. Esa misma base mostró el bug de Módulo D (H7), que en la de desarrollo habría quedado mezclado con otros datos.

## 12. Archivos de la implementación

Todo en el commit `3df302d` (backend + frontend, 19 archivos).

**Nuevos**

- `src/app/api/notificaciones/route.ts`
- `src/app/api/notificaciones/[id]/leer/route.ts`
- `src/app/api/notificaciones/[id]/archivar/route.ts`
- `src/app/api/notificaciones/marcar-todas-leidas/route.ts`
- `src/app/(dashboard)/notificaciones/actions.ts`, `page.tsx`, `loading.tsx`
- `src/components/notificaciones/CampanaNotificaciones.tsx`
- `src/components/notificaciones/BandejaNotificaciones.tsx`
- `src/lib/services/notificaciones/notificacion.service.test.ts` (source-regex)
- `src/lib/services/notificaciones/notificacion.http.integration.test.ts`

**Modificados**

- `src/lib/services/notificaciones/notificacion.reglas.ts`: `DEFAULT_NOTIFICATION_TEXT` (neutral), `ejecutarMotorNotificaciones()`, `PuertosMotorNotificaciones`, `esViolacionUnicidad()`, `armarPaginacion()`
- `src/lib/services/notificaciones/notificacion.service.ts`: `generarNotificaciones()`, wrapper `generarNotificacionClienteWeb()`, `listarNotificaciones()`, `marcarNotificacionLeida()`, `marcarTodasLeidas()`, `archivarNotificacion()`; consume `obtenerPlantillaActivaPorEvento()` de HU-F2
- `src/lib/events/listeners/notificacion.listener.ts`: tabla de suscripción declarativa (2 suscripciones de HU-F3 + 2 preexistentes)
- `src/lib/schemas/notificaciones.schema.ts`: `ListarNotificacionesQuerySchema` (textual), `NotificacionIdSchema`
- `src/lib/schemas/notificaciones.schema.test.ts`, `src/lib/services/notificaciones/notificacion.reglas.test.ts`
- `src/components/layout/Navbar.tsx`: la campana reemplaza el botón deshabilitado
- `package.json`: `notificacion.service.test.ts` en `npm test` y el script `test:integration:f3-http`

**Documentación de cierre (fuera del commit de código):** `docs/specs/spec_modulo_F.md` §2.3 (decisiones de los Puntos 5, 6 y 9) y este documento.

**No se tocan:** `prisma/schema.prisma`, migraciones, `prisma/seed.ts`, `event-types.ts` (no se declaran eventos `ecommerce:*`), rutas `/api/tienda/**`. Ningún `DELETE` ni `deleteMany`; sin dependencias nuevas.
