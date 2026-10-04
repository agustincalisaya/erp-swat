# SDD — HU-E12: Tasks de implementación (fase 4)

## Alcance y reglas

- SPEC congelada: `docs/modulos/modulo E/HU12_MODULO_E.md`
- No se amplía el alcance aprobado.
- No se implementa código, Prisma, seed, servicios, rutas, componentes ni tests en esta fase.
- No se realizan operaciones Git.
- Este archivo es el backlog técnico ejecutable de HU-E12.

---

## 1. Resumen ejecutivo

HU-E12 se divide en 10 tasks secuenciales con 4 puntos de parada obligatorios. Cada task produce artefactos verificables y no modifica archivos fuera de su lista autorizada. La dependencia principal es el modelo/migración (T01); luego el RBAC (T02) y los schemas (T03) pueden avanzar en paralelo. El núcleo de dominio (T04, T05, T06) se implementa por etapas, seguido de eventos/auditoría (T07), Route Handlers (T08), frontend (T09) y verificación/documentación final (T10).

---

## 2. Tabla resumida T01–T10

| ID | Título | Archivo(s) principal(es) | Dependencia | STOP obligatorio | Riesgo merge |
|---|---|---|---|---|---|
| T01 | Modelo y migración HU-E12 | `prisma/schema.prisma`, `prisma/migrations/<timestamp>_hu_e12_pick_pack/migration.sql` | Aprobación PLAN | Sí | Alto |
| T02 | RBAC Pick&Pack | `prisma/seed.ts`, `src/lib/services/ecommerce/roles-hu-e10.test.ts`, `src/lib/services/ecommerce/rbac-hu-e10.integration.test.ts` | T01 aprobado | No | Alto |
| T03 | Schemas y DTO | `src/lib/schemas/pick-pack.schema.ts`, `src/lib/services/ecommerce/pick-pack.types.ts`, `src/lib/schemas/pick-pack.schema.test.ts` | T01 aprobado | No | Bajo |
| T04 | Núcleo de cola y asignación | `src/lib/services/ecommerce/pick-pack.service.ts` | T01, T02, T03 | Sí | Medio |
| T05 | Escaneo e idempotencia | `src/lib/services/ecommerce/pick-pack.service.ts`, tests | T04 aprobado | No | Medio |
| T06 | Completar preparación, QR y plazo | `src/lib/services/ecommerce/pick-pack.service.ts`, `src/lib/utils/fecha-negocio.ts`, tests | T04 aprobado | No | Medio |
| T07 | Eventos y auditoría | `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`, tests | T04, T05, T06 | Sí | Alto |
| T08 | Route Handlers | `src/app/api/ecommerce/pick-pack/**/route.ts`, tests | T07 aprobado | No | Bajo |
| T09 | Frontend Pick&Pack | `src/app/(dashboard)/ecommerce/pick-pack/**`, componentes, tests | T08 aprobado | Sí | Bajo |
| T10 | Verificación integral y documentación | `docs/specs/spec_modulo_E.md`, reports de tests | T01–T09 | No | Alto |

---

## 3. Detalle completo de tasks

### T01 — Modelo y migración HU-E12

- **ID:** T01
- **Título:** Modelo y migración HU-E12
- **Objetivo:** Incorporar únicamente la persistencia necesaria para `fecha_pago_confirmado` y el progreso durable de preparación.
- **Dependencia previa:** Aprobación del PLAN de implementación.
- **Archivos autorizados:**
  - `prisma/schema.prisma`
  - `prisma/migrations/<timestamp>_hu_e12_pick_pack/migration.sql`
- **Archivos explícitamente prohibidos:**
  - `prisma/seed.ts`
  - `src/lib/services/**`
  - `src/app/**`
  - `src/lib/events/**`
  - Cualquier archivo de test que no sea de validación del modelo.
- **Cambios previstos:**
  - En `PedidoVentaEcommerce`: agregar `fecha_pago_confirmado DateTime?`.
  - Crear modelo `PedidoPreparacionEscaneo` mapeado a `pedido_preparacion_escaneos` con:
    - `id` UUID `@id`
    - `pedido_venta_item_id` String, FK obligatoria a `PedidoVentaItem`, `onDelete: Restrict`
    - `operador_id` String, FK obligatoria a `Usuario`, `onDelete: Restrict`
    - `scan_id` String `@unique`
    - `codigo_escaneado` String
    - `is_active` Boolean `@default(true)`
    - `deleted_at` DateTime?
    - `deleted_by` String?
    - `deletion_reason` String?
    - `created_at` DateTime `@default(now())`
    - `updated_at` DateTime `@updatedAt`
    - Relaciones inversas en `PedidoVentaItem` y `Usuario`.
    - `@@index([pedido_venta_item_id, is_active, deleted_at])`
  - No agregar `cantidad_confirmada` a `PedidoVentaItem`.
- **Criterios de aceptación técnicos:**
  - `prisma validate` pasa sin errores.
  - `prisma generate` produce tipos correctos incluyendo relaciones nuevas.
  - La migración SQL crea columna nullable, tabla, FKs restrictivas, índice compuesto e índice único sobre `scan_id`.
  - No se ejecuta backfill de `fecha_pago_confirmado` en datos productivos.
  - Pedidos históricos mantienen `fecha_pago_confirmado = null`.
- **Tests obligatorios:**
  - Validación del schema con `prisma validate`.
  - Generación del cliente.
  - Revisión manual de la migración SQL.
  - Aplicación de la migración en PostgreSQL de test y verificación de índices/FK/unique.
  - Verificación de que registros históricos permanecen `null`.
- **Condición de salida:** El modelo y la migración representan exactamente la SPEC sin modificar datos históricos.
- **Riesgos:**
  - Alto riesgo de conflicto con otras HU que toquen `prisma/schema.prisma` o migraciones.
  - Posible colisión de nombres de relaciones inversas con convenciones Prisma.
- **Qué NO incluye:**
  - Backfill de fechas productivas.
  - Servicios, endpoints, componentes, seed, eventos ni auditoría.

---

### T02 — RBAC Pick&Pack

- **ID:** T02
- **Título:** RBAC Pick&Pack
- **Objetivo:** Agregar `ecommerce:priorizar_cola` exclusivamente al rol Administrador E-commerce y actualizar los tests E10 correspondientes.
- **Dependencia previa:** T01 aprobado (para evitar modificar seed mientras el modelo aún puede cambiar).
- **Archivos autorizados:**
  - `prisma/seed.ts`
  - `src/lib/services/ecommerce/roles-hu-e10.test.ts`
  - `src/lib/services/ecommerce/rbac-hu-e10.integration.test.ts`
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `src/lib/auth/with-permission.ts`
  - Servicios, rutas, componentes.
- **Cambios previstos:**
  - Declarar constante UUID para `PERMISO_ECOMMERCE_PRIORIZAR_COLA_ID`.
  - Crear permiso `ecommerce:priorizar_cola` con `modulo: "MODULO_E"`.
  - Agregar el permiso únicamente a la lista de `rolAdministradorEcommerce`.
  - Asegurar que `rolOperadorPickPack` no lo reciba.
  - Actualizar `roles-hu-e10.test.ts`:
    - Nuevo permiso y UUID.
    - Conteos actualizados (9 permisos, Administrador con 9, Operador con 3).
    - Exclusiones: Operador no tiene priorizar; Administrador no tiene preparar ni validar retiro automáticamente.
  - Actualizar `rbac-hu-e10.integration.test.ts`:
    - Matriz `MATRIZ_ECOMMERCE` actualizada.
    - Verificar `ecommerce:priorizar_cola` para admin true, operador false.
  - Actualizar fixtures artificiales pagados del seed para establecer `fecha_pago_confirmado` sintética coherente cuando representen pedidos pagados (datos de prueba nuevos, no backfill productivo).
- **Criterios de aceptación técnicos:**
  - Administrador E-commerce: leer cola = sí, priorizar = sí, preparar = no (salvo permiso ya existente explícito), validar retiro = no.
  - Operador Pick&Pack: leer = sí, preparar = sí, priorizar = no.
  - Nunca se autoriza por nombre de rol.
  - Los UUID de HU-E10 permanecen únicos.
  - Los tests de regex y matriz pasan.
- **Tests obligatorios:**
  - `npm test` incluyendo `roles-hu-e10.test.ts`.
  - `npm run test:integration:e10` contra base real con seed aplicado.
- **Condición de salida:** Matriz RBAC coherente y tests E10 actualizados.
- **Riesgos:**
  - Alto riesgo de merge con otros cambios de seed (otras HU).
  - Si se modifica incorrectamente, un Administrador podría quedar sin priorizar o un Operador podría obtenerlo.
- **Qué NO incluye:**
  - Implementación de lógica de priorización.
  - Modificación de permisos existentes `leer_cola_preparacion`, `preparar_pedido`, `validar_retiro_qr`.
  - Backfill de fechas productivas.

---

### T03 — Schemas y DTO

- **ID:** T03
- **Título:** Schemas y DTO
- **Objetivo:** Definir contratos de entrada y salida antes de escribir el servicio.
- **Dependencia previa:** T01 aprobado.
- **Archivos autorizados:**
  - `src/lib/schemas/pick-pack.schema.ts`
  - `src/lib/services/ecommerce/pick-pack.types.ts`
  - `src/lib/schemas/pick-pack.schema.test.ts`
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - Servicios, rutas, componentes, listeners.
- **Cambios previstos:**
  - Crear schemas Zod:
    - `ColaPreparacionQuerySchema` (paginación, filtros opcionales).
    - `PedidoPickPackIdSchema` (UUID).
    - `ConfirmarItemPreparacionSchema` (`scan_id` UUID, `codigo` string no vacío).
    - `PriorizarPedidoSchema` (`prioridad_manual` entero 1..100 o `null`).
    - Schemas auxiliares para respuestas si son necesarios.
  - Crear tipos DTO en `pick-pack.types.ts`:
    - Entrada/salida de cola sin QR, DNI, Mercado Pago ni datos fiscales sensibles.
    - `fecha_pago_confirmado` puede ser `null` únicamente para legacy.
    - Progreso por SKU.
    - Resultados de toma, confirmación, completar y prioridad.
- **Criterios de aceptación técnicos:**
  - Todos los schemas validan correctamente casos válidos e inválidos.
  - `scan_id` es UUID obligatorio.
  - `codigo` es string no vacío.
  - `prioridad_manual` acepta 1..100 o `null`; rechaza 0, 101, fracciones, strings.
  - DTOs no exponen información sensible.
- **Tests obligatorios:**
  - `pick-pack.schema.test.ts` cubriendo validaciones de query, path ID, confirmación, prioridad y DTOs.
- **Condición de salida:** Contratos tipados y tests de validación completos.
- **Riesgos:**
  - Bajo riesgo de merge.
  - Riesgo de exponer campos sensibles si el DTO no se diseña con select estricto.
- **Qué NO incluye:**
  - Lógica de negocio.
  - Implementación de endpoints o servicios.
  - Acceso a base de datos.

---

### T04 — Núcleo de cola y asignación

- **ID:** T04
- **Título:** Núcleo de cola y asignación
- **Objetivo:** Implementar admisión, listado de cola, toma y prioridad en el servicio de dominio.
- **Dependencia previa:** T01, T02 y T03 aprobados.
- **Archivos autorizados:**
  - `src/lib/services/ecommerce/pick-pack.service.ts` (crear)
  - Helpers privados dentro del mismo archivo si son necesarios.
  - Tests unitarios e integración en `src/lib/services/ecommerce/pick-pack.test.ts` y `src/lib/services/ecommerce/pick-pack.integration.test.ts`.
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `src/lib/events/**`
  - `src/app/**`
  - `src/components/**`
- **Cambios previstos:**
  - Implementar:
    - `admitirPedidoPagoConfirmado(tx, pedidoVentaId)`
    - `listarColaPreparacion(...)`
    - `tomarPedido(pedidoVentaId, actorId)`
    - `actualizarPrioridad(pedidoVentaId, actorId, prioridadManual)`
  - Admisión:
    - Acepta `Prisma.TransactionClient`.
    - No abre segunda transacción.
    - Valida WEB, `PAGO_CONFIRMADO`, `fecha_pago_confirmado` no nula.
    - Pasa a `EN_PREPARACION` sin asignar operador.
    - Reintento válido idempotente.
  - Cola:
    - Orden: `prioridad_manual DESC NULLS LAST`, `fecha_pago_confirmado ASC NULLS LAST`, `PedidoVenta.id ASC`.
    - Incluye pedidos libres y tomados en `EN_PREPARACION`.
    - Legacy `null` visible.
    - Proyección mínima, sin datos sensibles.
  - Toma:
    - Lock del agregado.
    - Solo un operador gana.
    - Reintento del mismo actor idempotente.
    - Otro actor recibe conflicto.
    - Estado no cambia.
  - Prioridad:
    - Solo si `operador_asignado_id IS NULL` y estado `EN_PREPARACION`.
    - Valor 1..100 o `null`.
- **Criterios de aceptación técnicos:**
  - Cola devuelve orden contractual.
  - Pedidos legacy aparecen al final del grupo de igual prioridad.
  - Admisión falla sin fecha y permite rollback externo.
  - Toma concurrente resuelve exactamente un ganador.
  - Prioridad rechaza pedido tomado o fuera de estado.
- **Tests obligatorios:**
  - Unitarios: reglas de orden, admisión idempotente, validaciones de prioridad.
  - Integración PostgreSQL aislado:
    - admisión y rollback externo;
    - orden con prioridad/fechas/legacy null;
    - dos operadores tomando simultáneamente;
    - prioridad permitida y rechazada.
- **Condición de salida:** Cola operativa y asignación concurrentemente segura.
- **Riesgos:**
  - Medio riesgo de merge con servicios compartidos.
  - Riesgo de consulta N+1 al construir progreso; debe resolverse en una sola consulta o batch eficiente.
- **Qué NO incluye:**
  - Escaneo ni completar.
  - Eventos ni auditoría.
  - QR, token ni plazo.
  - Endpoints ni UI.

**STOP obligatorio después de T04.**

---

### T05 — Escaneo e idempotencia

- **ID:** T05
- **Título:** Escaneo e idempotencia
- **Objetivo:** Implementar `confirmarItem` usando `PedidoPreparacionEscaneo` como fuente de verdad.
- **Dependencia previa:** T04 aprobado.
- **Archivos autorizados:**
  - `src/lib/services/ecommerce/pick-pack.service.ts`
  - `src/lib/services/ecommerce/pick-pack.test.ts`
  - `src/lib/services/ecommerce/pick-pack.integration.test.ts`
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `src/lib/events/**`
  - `src/app/**`
  - `src/components/**`
- **Cambios previstos:**
  - Implementar `confirmarItem(pedidoVentaId, actorId, { scan_id, codigo })`.
  - Reglas:
    - Pedido WEB, `EN_PREPARACION`, activo.
    - Actor es operador asignado.
    - Resuelve código por `ean_qr` o `sku` dentro de la transacción.
    - Selecciona primera línea pendiente por `(created_at ASC, id ASC)` cuando un SKU se repite.
    - Una lectura = una unidad cuantitativa.
    - Nunca supera `PedidoVentaItem.cantidad`.
  - Concurrencia:
    - Bloquear agregado y líneas del pedido en orden estable antes de contar/insertar.
    - No usar `COUNT` seguido de `INSERT` sin lock.
  - Idempotencia:
    - `scan_id` existente + mismos datos → retornar progreso actual sin insertar.
    - `scan_id` existente + payload incompatible → `409`.
    - `scan_id` nuevo + cupo disponible → insertar.
  - Preparar metadata post-commit para `ecommerce:unidad_preparacion_confirmada` solo cuando se insertó una nueva confirmación.
- **Criterios de aceptación técnicos:**
  - Confirmación persistente y visible en progreso.
  - Dos scans concurrentes del último cupo no exceden cantidad.
  - `scan_id` duplicado idéntico es idempotente.
  - `scan_id` duplicado incompatible devuelve `409`.
  - Código ajeno no inserta ni genera evento.
- **Tests obligatorios:**
  - Unitarios: resolución de SKU, primera línea pendiente, idempotencia, exceso.
  - Integración PostgreSQL aislado:
    - dos scans concurrentes del último cupo;
    - `scan_id` duplicado idéntico e incompatible;
    - mismo SKU con distintos `scan_id`;
    - SKU repetido en líneas y desempate;
    - código ajeno;
    - scan de otro operador.
- **Condición de salida:** Progreso persistente, concurrente e idempotente.
- **Riesgos:**
  - Riesgo de race condition si no se bloquea correctamente.
  - Riesgo de dependencia circular si se reutiliza `resolverCodigoEscaneo` global dentro de `tx`.
- **Qué NO incluye:**
  - Emisión final del evento (pertenece a T07).
  - Completar preparación ni QR.
  - Endpoints ni UI.

---

### T06 — Completar preparación, QR y plazo

- **ID:** T06
- **Título:** Completar preparación, QR y plazo
- **Objetivo:** Implementar `completarPreparacion` con generación de token y cálculo de vencimiento.
- **Dependencia previa:** T04 aprobado.
- **Archivos autorizados:**
  - `src/lib/services/ecommerce/pick-pack.service.ts`
  - `src/lib/utils/fecha-negocio.ts`
  - `src/lib/utils/fecha-negocio.test.ts`
  - Tests de servicio e integración.
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `src/lib/events/**`
  - `src/app/**`
  - `src/components/**`
- **Cambios previstos:**
  - Implementar `completarPreparacion(pedidoVentaId, actorId)`.
  - Reglas:
    - Actor = operador asignado.
    - Estado `EN_PREPARACION`.
    - Todas las líneas activas con confirmadas === requeridas.
    - Al menos una línea requerida.
    - Leer `ConfiguracionSistema.clave = ECOMMERCE_PLAZO_RETIRO_DIAS` dentro de la transacción.
    - Validar entero positivo; si falla, rollback completo.
    - Capturar instante de transición.
    - Generar token con `randomBytes(32).toString("base64url")`.
    - Calcular vencimiento sumando días calendario en `America/Argentina/Buenos_Aires` conservando hora local.
    - Escribir atómicamente: estado `LISTO_PARA_RETIRO`, `codigo_qr_retiro`, `plazo_retiro_vencimiento`.
  - Repetición:
    - Mismo token, mismo plazo, cero efectos nuevos.
  - Preparar metadata post-commit para `ecommerce:pedido_listo_para_retiro` solo en la primera transición.
- **Criterios de aceptación técnicos:**
  - Incompleto → sin cambio, sin token, sin evento.
  - Configuración inválida → rollback completo, sin QR, sin cambio de estado.
  - Primera finalización exitosa → token único y vencimiento coherentes.
  - Doble completar → token y plazo estables, sin nuevo evento.
  - No se expone el token en DTOs.
- **Tests obligatorios:**
  - Unitarios: cálculo de plazo en medianoche, configuración inválida.
  - Integración PostgreSQL aislado:
    - completar incompleto;
    - completar correcto;
    - configuración ausente/inválida y rollback;
    - token único;
    - doble completar;
    - último scan concurrente vs completar;
    - scan de otro operador.
- **Condición de salida:** Preparación puede finalizar de forma segura e idempotente.
- **Riesgos:**
  - Riesgo de cálculo de zona horaria; debe usarse utilidad existente aprobada.
  - Colisión de token único; debe manejarse como conflicto seguro sin dejar estado listo sin token.
- **Qué NO incluye:**
  - Emisión final del evento (T07).
  - Generación de imagen PNG/base64 (E9).
  - Endpoints ni UI.

---

### T07 — Eventos y auditoría

- **ID:** T07
- **Título:** Eventos y auditoría
- **Objetivo:** Integrar las mutaciones E12 con `DomainEventMap` y `AuditLog`.
- **Dependencia previa:** T04, T05 y T06 implementados y aprobados.
- **Archivos autorizados:**
  - `src/lib/events/event-types.ts`
  - `src/lib/events/listeners/audit-log.listener.ts`
  - Tests específicos E12.
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `src/lib/services/ecommerce/pick-pack.service.ts` (solo lectura del contrato; no modificar lógica de dominio)
  - `src/app/**`
  - `src/components/**`
- **Cambios previstos:**
  - En `event-types.ts` agregar tipos y entradas en `DomainEventMap`:
    - `ecommerce:pedido_admitido_cola`
    - `ecommerce:pedido_tomado`
    - `ecommerce:prioridad_preparacion_cambiada`
    - `ecommerce:unidad_preparacion_confirmada`
    - `ecommerce:pedido_listo_para_retiro`
  - En `audit-log.listener.ts` registrar handlers que persistan en `AuditLog`:
    - admisión a cola;
    - toma/asignación;
    - cambio de prioridad;
    - preparación completada / transición a `LISTO_PARA_RETIRO`;
    - QR generado como hecho sin valor;
    - unidad confirmada (payload aprobado, sin código literal, QR, DNI ni Mercado Pago).
  - Asegurar emisión **post-commit** en los servicios T04–T06.
  - Implementar idempotencia de eventos: reintentos no emiten duplicados.
  - Fallo de listener no revierte mutación confirmada.
  - No implementar outbox.
- **Criterios de aceptación técnicos:**
  - Ningún evento se emite dentro de una transacción no confirmada.
  - `ecommerce:unidad_preparacion_confirmada` se emite y audita solo para scans nuevos exitosos.
  - Reintento de `scan_id` no genera evento ni asiento adicional.
  - Scan rechazado no genera evento de confirmación.
  - `ecommerce:pedido_listo_para_retiro` se emite solo una vez.
  - AuditLog no almacena token QR, DNI, Mercado Pago ni PII innecesaria.
- **Tests obligatorios:**
  - `pick-pack.eventos.test.ts`:
    - scan nuevo → un evento y un asiento;
    - reintento mismo `scan_id` → cero eventos adicionales;
    - scan rechazado → cero eventos;
    - dos unidades con `scan_id` distintos → dos hechos auditados;
    - doble completar → un solo evento listo;
    - fallo de listener → mutación persistida.
  - `pick-pack.audit.integration.test.ts` contra PostgreSQL aislado.
- **Condición de salida:** Todas las mutaciones de E12 quedan trazables y los eventos no se duplican.
- **Riesgos:**
  - Alto riesgo de merge en `event-types.ts` y `audit-log.listener.ts` (archivos compartidos).
  - Riesgo de romper serialización del ledger si no se respeta la cola existente.
- **Qué NO incluye:**
  - Implementación de outbox.
  - Lógica de negocio de escaneo/cola/completar.
  - Endpoints ni UI.

**STOP obligatorio después de T07.**

---

### T08 — Route Handlers

- **ID:** T08
- **Título:** Route Handlers
- **Objetivo:** Exponer la API aprobada como adaptadores finos sobre el servicio.
- **Dependencia previa:** T07 aprobado.
- **Archivos autorizados:**
  - `src/app/api/ecommerce/pick-pack/cola/route.ts`
  - `src/app/api/ecommerce/pick-pack/[id]/tomar/route.ts`
  - `src/app/api/ecommerce/pick-pack/[id]/confirmar-item/route.ts`
  - `src/app/api/ecommerce/pick-pack/[id]/completar/route.ts`
  - `src/app/api/ecommerce/pick-pack/[id]/prioridad/route.ts`
  - Tests HTTP.
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `src/lib/services/ecommerce/pick-pack.service.ts` (solo consumo)
  - `src/lib/events/**`
  - `src/components/**`
- **Cambios previstos:**
  - Implementar métodos y permisos:
    - `GET /api/ecommerce/pick-pack/cola` → `ecommerce:leer_cola_preparacion`
    - `PATCH /api/ecommerce/pick-pack/[id]/tomar` → `ecommerce:preparar_pedido`
    - `POST /api/ecommerce/pick-pack/[id]/confirmar-item` → `ecommerce:preparar_pedido`
    - `PATCH /api/ecommerce/pick-pack/[id]/completar` → `ecommerce:preparar_pedido`
    - `PATCH /api/ecommerce/pick-pack/[id]/prioridad` → `ecommerce:priorizar_cola`
  - Actor siempre `session.userId`; nunca aceptar `operador_id` del cliente.
  - Validar path ID y body con Zod.
  - Mapear `ServiceError` a HTTP: 400, 401, 403, 404, 409, 500 según SPEC.
  - Respuesta `{ data, error }`.
  - No implementar `/validar-retiro` (E3).
- **Criterios de aceptación técnicos:**
  - Cada ruta responde con el permiso y status correctos.
  - Errores de validación Zod devuelven 400.
  - Sin sesión → 401.
  - Sin permiso → 403.
  - Pedido no WEB/inexistente → 404.
  - Conflicto de dominio/concurrencia → 409.
  - Configuración inválida en completar → 500.
- **Tests obligatorios:**
  - `pick-pack.http.integration.test.ts` con servidor Next real y PostgreSQL aislado:
    - 401 sin sesión;
    - 403 sin permiso;
    - Operador: cola, tomar, escanear, completar;
    - Admin ecommerce: leer cola, priorizar, rechazado en tomar/escanear/completar;
    - 400/404/409 en escenarios de dominio.
- **Condición de salida:** API protegida por permisos y reglas de dominio.
- **Riesgos:**
  - Bajo riesgo de merge.
  - Riesgo de no manejar correctamente `params` como `Promise` en Next.js 16.
- **Qué NO incluye:**
  - Lógica de negocio (vive en el servicio).
  - Pantallas ni componentes.
  - `/validar-retiro`.

---

### T09 — Frontend Pick&Pack

- **ID:** T09
- **Título:** Frontend Pick&Pack
- **Objetivo:** Crear la experiencia operativa Mobile-First para operador y administrador.
- **Dependencia previa:** T08 aprobado.
- **Archivos autorizados:**
  - `src/app/(dashboard)/ecommerce/pick-pack/page.tsx`
  - `src/app/(dashboard)/ecommerce/pick-pack/[id]/page.tsx`
  - `src/app/(dashboard)/ecommerce/pick-pack/prioridades/page.tsx`
  - `src/components/ecommerce/pick-pack/ColaPreparacion.tsx`
  - `src/components/ecommerce/pick-pack/DetallePreparacion.tsx`
  - `src/components/ecommerce/pick-pack/AccionesPreparacion.tsx`
  - `src/components/ecommerce/pick-pack/EscaneoPreparacion.tsx`
  - `src/components/ecommerce/pick-pack/PrioridadPreparacion.tsx`
  - `src/components/inventario/escaner/CameraBarcodeScanner.tsx` (modificación mínima si se demuestra necesaria)
  - `src/components/layout/Sidebar.tsx` (solo si es estrictamente necesario y por permiso)
  - Tests de componentes.
- **Archivos explícitamente prohibidos:**
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `src/lib/services/**`
  - `src/lib/events/**`
  - `src/app/api/**`
- **Cambios previstos:**
  - Página de cola para operador: lista, estado de asignación, botón tomar, navegación a detalle.
  - Página de detalle: progreso por SKU, cámara, feedback de lectura, completar (deshabilitado visualmente mientras falte progreso; la validación real permanece en servidor).
  - Página de prioridades para administrador: lista y controles de prioridad 1..100 o quitar (`null`).
  - Reutilizar `CameraBarcodeScanner`; no crear otro scanner.
  - Generar un UUID nuevo por lectura física; reutilizar el mismo `scan_id` solo para reintentar la misma petición al servidor.
  - Manejar debounce para permitir dos unidades físicas del mismo SKU consecutivas:
    - Si las pruebas demuestran que el debounce actual lo impide, exponer configuración de `debounceMs` desde `CameraBarcodeScanner.tsx` sin cambiar el valor por defecto de otros módulos.
  - Legacy: mostrar exactamente `"Fecha de pago no disponible (registro anterior)"` cuando `fecha_pago_confirmado` sea `null`.
  - Sidebar: agregar entradas solo si es necesario, siempre por permiso, nunca por nombre de rol.
- **Criterios de aceptación técnicos:**
  - Vista operador no muestra datos financieros, QR, DNI ni Mercado Pago.
  - Vista administrador permite priorizar y no permite preparar.
  - El scanner reutilizado funciona y permite leer dos unidades reales del mismo SKU.
  - El botón completar se deshabilita visualmente cuando falta progreso.
  - Feedback claro para conflictos 409 y errores 400/403/404.
- **Tests obligatorios:**
  - `PickPackOperador.test.tsx`:
    - cola vacía/con pedidos;
    - progreso;
    - código válido/incorrecto;
    - cantidad completa;
    - completar bloqueado;
    - conflicto concurrente.
  - `PickPackPrioridades.test.tsx`:
    - priorización autorizada;
    - intento de priorizar sin permiso.
  - `EscaneoPreparacion.test.tsx`:
    - scanner no disponible;
    - fallback ZXing;
    - dos unidades del mismo SKU;
    - reintento idéntico.
- **Condición de salida:** Flujo Pick&Pack usable en móvil sin duplicar infraestructura existente.
- **Riesgos:**
  - Riesgo de dependencia de permisos en renderizado del sidebar.
  - Riesgo de experiencia de scanner en dispositivos reales no cubierta por tests de componente.
- **Qué NO incluye:**
  - Generación de imagen QR (E9).
  - Validación de retiro (E3).
  - Notificaciones directas (F3).

**STOP obligatorio después de T09.**

---

### T10 — Verificación integral y documentación

- **ID:** T10
- **Título:** Verificación integral y documentación
- **Objetivo:** Demostrar cumplimiento completo de HU-E12 y corregir la documentación general.
- **Dependencia previa:** T01–T09 aprobados.
- **Archivos autorizados:**
  - `docs/specs/spec_modulo_E.md`
  - `docs/modulos/modulo E/HU12_MODULO_E.md` (solo sección final de evidencia/estado si la convención documental lo admite; no reescribir la SPEC)
  - Scripts/reportes de ejecución de tests.
- **Archivos explícitamente prohibidos:**
  - Cualquier archivo de código fuente funcional.
  - `prisma/schema.prisma`, `prisma/seed.ts`.
- **Cambios previstos:**
  - Ejecutar y verificar:
    - tests schemas;
    - tests servicio;
    - tests E10 afectados;
    - integración PostgreSQL;
    - concurrencia;
    - eventos;
    - auditoría;
    - HTTP/RBAC;
    - componentes UI;
    - `tsc --noEmit`;
    - `lint`;
    - `build`;
    - diff check.
  - Verificaciones explícitas:
    - dos operadores;
    - último cupo concurrente;
    - `scan_id` idempotencia;
    - doble completar;
    - token estable;
    - rollback configuración;
    - legacy null;
    - permisos;
    - ausencia de datos sensibles en DTOs/eventos/auditoría;
    - auditoría por unidad confirmada;
    - fallo de listener/F3 sin rollback.
  - Actualizar `docs/specs/spec_modulo_E.md` para corregir discrepancias:
    - endpoints previstos vs existentes;
    - `POST` confirmar-item;
    - admisión vs toma;
    - E12 genera token;
    - F3 notifica;
    - E9 muestra QR;
    - `/validar-retiro` pertenece a E3;
    - prioridad mediante `ecommerce:priorizar_cola`.
- **Criterios de aceptación técnicos:**
  - Todos los tests obligatorios pasan.
  - Build exitoso.
  - Documentación general coherente con la implementación.
  - SPEC de HU-E12 permanece congelada.
- **Tests obligatorios:**
  - Suite completa de HU-E12.
  - Tests E10 afectados.
  - Validación TypeScript, lint y build.
- **Condición de salida:** Todos los criterios de aceptación demostrados o dependencias externas claramente marcadas.
- **Riesgos:**
  - Alto riesgo de encontrar inconsistencias que requieran revisión de tasks anteriores.
  - Riesgo de modificar accidentalmente la SPEC congelada.
- **Qué NO incluye:**
  - Nueva funcionalidad no aprobada.
  - Cambios en Prisma, seed o servicios.

---

## 4. Dependencias entre tasks

```
T01 (Modelo y migración)
  ↓
T02 (RBAC) ─────┐
T03 (Schemas) ────┤
                 ↓
                T04 (Cola y asignación)
                 ↓
        ┌───────┴───────┐
        ↓               ↓
       T05 (Escaneo)   T06 (Completar)
        └───────┬───────┘
                ↓
               T07 (Eventos y auditoría)
                ↓
               T08 (Route Handlers)
                ↓
               T09 (Frontend)
                ↓
               T10 (Verificación y documentación)
```

**Tareas parcialmente paralelizables:**
- T02 y T03 pueden avanzar en paralelo una vez aprobado T01, siempre que no se modifiquen archivos compartidos.
- T05 y T06 dependen de T04 pero pueden desarrollarse en paralelo entre sí; sin embargo, recomendable terminar T05 antes de T06 para validar progreso completo.

---

## 5. Archivos permitidos por tarea

| Tarea | Archivos permitidos |
|---|---|
| T01 | `prisma/schema.prisma`, `prisma/migrations/<timestamp>_hu_e12_pick_pack/migration.sql` |
| T02 | `prisma/seed.ts`, `src/lib/services/ecommerce/roles-hu-e10.test.ts`, `src/lib/services/ecommerce/rbac-hu-e10.integration.test.ts` |
| T03 | `src/lib/schemas/pick-pack.schema.ts`, `src/lib/services/ecommerce/pick-pack.types.ts`, `src/lib/schemas/pick-pack.schema.test.ts` |
| T04 | `src/lib/services/ecommerce/pick-pack.service.ts`, `src/lib/services/ecommerce/pick-pack.test.ts`, `src/lib/services/ecommerce/pick-pack.integration.test.ts`, `src/lib/services/ecommerce/pick-pack.admision.integration.test.ts` |
| T05 | `src/lib/services/ecommerce/pick-pack.service.ts`, tests |
| T06 | `src/lib/services/ecommerce/pick-pack.service.ts`, `src/lib/utils/fecha-negocio.ts`, `src/lib/utils/fecha-negocio.test.ts`, tests |
| T07 | `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`, tests |
| T08 | `src/app/api/ecommerce/pick-pack/**/route.ts`, tests |
| T09 | `src/app/(dashboard)/ecommerce/pick-pack/**`, `src/components/ecommerce/pick-pack/**`, `src/components/inventario/escaner/CameraBarcodeScanner.tsx` (mínimo), `src/components/layout/Sidebar.tsx` (mínimo), tests |
| T10 | `docs/specs/spec_modulo_E.md`, `docs/modulos/modulo E/HU12_MODULO_E.md` (solo evidencia), reportes de tests |

---

## 6. Tests obligatorios por tarea

| Tarea | Tests |
|---|---|
| T01 | `prisma validate`, `prisma generate`, revisión SQL, migración en PostgreSQL de test, índices/FK/unique, históricos null. |
| T02 | `roles-hu-e10.test.ts`, `rbac-hu-e10.integration.test.ts`. |
| T03 | `pick-pack.schema.test.ts`. |
| T04 | `pick-pack.test.ts`, `pick-pack.integration.test.ts`, `pick-pack.admision.integration.test.ts`. |
| T05 | `pick-pack.test.ts`, `pick-pack.integration.test.ts`. |
| T06 | `pick-pack.test.ts`, `pick-pack.integration.test.ts`, `fecha-negocio.test.ts`. |
| T07 | `pick-pack.eventos.test.ts`, `pick-pack.audit.integration.test.ts`. |
| T08 | `pick-pack.http.integration.test.ts`. |
| T09 | `PickPackOperador.test.tsx`, `PickPackPrioridades.test.tsx`, `EscaneoPreparacion.test.tsx`. |
| T10 | Suite completa E12, tests E10 afectados, `tsc --noEmit`, `lint`, `build`, diff check. |

---

## 7. Definition of Done por tarea

Cada task se considera Done cuando:

1. Todos los cambios previstos están implementados en los archivos autorizados.
2. Los tests obligatorios pasan.
3. No se modificaron archivos prohibidos.
4. No se amplió el alcance de la SPEC.
5. Se completó el punto STOP obligatorio si corresponde.
6. Se documentaron riesgos o dependencias pendientes.

---

## 8. Puntos de parada obligatorios

- **STOP después de T01:** revisar modelo y migración antes de avanzar.
- **STOP después de T04:** revisar cola, admisión y asignación antes de escaneo/completar.
- **STOP después de T07:** revisar eventos y auditoría antes de exponer API.
- **STOP después de T09:** revisar frontend antes de verificación integral.

---

## 9. Conflictos detectados entre TASKS, PLAN y SPEC

**No se detectaron conflictos sustanciales.** Las tres decisiones finales de la fase 3.1 quedan correctamente reflejadas:

- T07 cubre `ecommerce:unidad_preparacion_confirmada` y su auditoría, sin contradecir la trazabilidad operacional de `PedidoPreparacionEscaneo`.
- T01/T02/T04 cubren pedidos legacy `fecha_pago_confirmado = null` sin backfill productivo, con orden `NULLS LAST` y mensaje de UI aprobado.
- T02 actualiza fixtures del seed con fechas sintéticas coherentes, diferenciando claramente datos de prueba de datos históricos.

**Puntos de coordinación (no conflictos):**

1. **T07 y servicios T04–T06:** T05/T06 deben devolver metadata de evento pendiente o depender de un mecanismo post-commit común; T07 solo tipa y conecta. Recomendable definir en T04 una convención clara de "retorno de evento pendiente" para mantener la separación transaccional.
2. **T09 y `CameraBarcodeScanner`:** si se modifica el componente reutilizable, debe hacerse de forma que no altere el comportamiento por defecto de otros módulos.
3. **T10 y documentación:** `docs/specs/spec_modulo_E.md` pertenece a otras HU/Epics; su edición requiere coordinación con sus owners.

---

## 10. Estado final de ejecución (T10)

| Task | Descripción | Estado final |
|---|---|---|
| T01 | Modelo y migración (`fecha_pago_confirmado`, `PedidoPreparacionEscaneo`) | ✅ Aprobada — migración `20261001212437_hu_e12_pick_pack` aplica en base limpia |
| T02 | RBAC (`ecommerce:priorizar_cola` + matriz/seed/tests) | ✅ Aprobada |
| T03 | Schemas Zod y DTO | ✅ Aprobada |
| T04 | Núcleo de cola, admisión y asignación | ✅ Aprobada |
| T05 | Escaneo e idempotencia `scan_id` | ✅ Aprobada |
| T06 | Completar, QR (randomBytes 32 base64url) y plazo | ✅ Aprobada |
| T07 | Eventos y auditoría | ✅ Aprobada |
| T07.1 | Ajuste de aislamiento de emisiones post-commit (listener fallido no revierte commit) | ✅ Aprobada — ajuste surgido en ejecución |
| T07.5 | Integración productiva E2→E12 (`admitirPedidoPagoConfirmado` última mutación del tx de `confirmarPago`, jerarquía de locks `PedidoVenta → PedidoVentaEcommerce → PedidoVentaItem(s)`, `fecha_pago_confirmado` desde `date_approved`) | ✅ Aprobada — ajuste surgido en ejecución |
| T08 | Route Handlers (`/api/ecommerce/preparacion/**`) + suite HTTP | ✅ Aprobada — paths fijados por instrucción T08 (desviación documentada en HU12 §10.2); incluye remoción no funcional de `"use server"` en `pick-pack.service.ts` |
| T09 | Frontend `/ecommerce/preparacion` (cola, prioridad, toma, scanner, manual, completar) | ✅ Aprobada |
| T10 | Verificación integral y documentación | ✅ Completada — esta sección, HU12 §10, `docs/manuales/MANUAL_HU-E12.md` |

**Suite final:** 192 pass / 0 fail / 0 skip (conteo TAP con wrappers) — suites E2, E2→E12, E12 dominio, eventos, auditoría, HTTP, frontend y fecha-negocio, sobre PostgreSQL 16 aislado con ejecución serial.

**Incumplimientos de SPEC:** ninguno. Desviación aprobada y documentada: paths HTTP de T08 (`/api/ecommerce/preparacion/**`) vs. rutas previstas de la SPEC §5.

**Deuda transversal registrada (fuera de E12):** serialización in-process del ledger AuditLog multiproceso; event bus sin entrega durable; `spec_modulo_E.md` §2.12 pendiente de alineación con su owner.
