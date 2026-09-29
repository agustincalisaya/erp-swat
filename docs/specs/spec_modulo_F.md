# Especificación Técnica — Módulo F (Arquitectura Tecnológica y Conectividad)
## ERP SWAT Indumentarias — Sprint 4
## Revisión 1 — Primera especificación técnica del módulo. Cubre únicamente HU-F1, HU-F2 y HU-F3, las tres HU de Módulo F priorizadas en Sprint 4. HU-F4 (Docker/despliegue), HU-F5 (Log técnico de auditoría de F1/F3) y HU-F6 (estrategia de renderizado por superficie) no fueron priorizadas en este sprint — ver sección 6, Fuera de Alcance. No confundir esta numeración de HU con la numeración de sección de este documento.

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Trazabilidad Inalterable; Regla N.° 3 — Aislamiento de Dominio, patrón Adapter) · `Documento de Alcance Funcional y Técnico` (sección Módulo F) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja **Sprint 4**) · `schema.prisma` · `spec_modulo_D.md` (RBAC y `AuditLog`) · `spec_modulo_E.md` (consumidores HU-E1/E2/E3/E5/E9/E12/E13) · `spec_modulo_B.md` (consumidor HU-B1, medio de pago Mercado Pago) · `spec_modulo_G.md` (consumidor HU-G11)

---

## ⚠️ Decisiones del PO vigentes para este módulo

- **Mercado Pago es la única pasarela de pago del sistema.** No se implementa MODO ni ningún otro conector de pago. Si algún documento anterior (Alcance original, borradores previos) menciona MODO, no es la fuente de verdad — reportar, no corregir por cuenta propia.
- **No hay mensajería externa.** No se implementa conector de WhatsApp Business API ni de SMTP/Email bajo ninguna forma. Toda notificación del sistema es interna (bandeja dentro del propio ERP/storefront, HU-F3). Un consumidor que hoy documenta "notificación por WhatsApp/email" en un spec de otro módulo (ej. `spec_modulo_C.md`, canal de contacto preferido de HU-C9) se resuelve, en la práctica, contra este motor de notificaciones internas — el dato de canal preferido queda modelado en Módulo C pero no tiene consumidor real en este sprint (ver `spec_modulo_C.md`, sección 5).

---

## 1. Visión General

El Módulo F es la capa de integración tecnológica transversal del ERP: no tiene un actor de negocio propio que "use" el módulo directamente (a diferencia de Ventas o Clientes), sino que provee servicios de infraestructura que otros módulos consumen. En el alcance de Sprint 4, dos servicios:

- **Conector de Mercado Pago (HU-F1):** encapsula toda comunicación con la pasarela de pago detrás de un patrón Adapter, de forma que ningún módulo de negocio (B, E, G) invoque el SDK de Mercado Pago directamente. Es el único punto del sistema que retiene credenciales de pago.
- **Motor de Notificaciones internas (HU-F2 + HU-F3):** entrega, dentro del propio sistema, los avisos que en un ERP tradicional saldrían por email o WhatsApp — bandeja de notificaciones por usuario o por rol, alimentada por eventos de dominio de todo el sistema.

Bajo Next.js App Router, el módulo se implementa mediante **Route Handlers** (`app/api/integraciones/**`, `app/api/notificaciones/**`, `app/api/webhooks/**`) para las superficies consumidas por otros módulos, la PWA y Mercado Pago mismo (webhook), y **Server Actions** (`app/(dashboard)/administracion/**/actions.ts`) para los formularios de gestión de los roles de plataforma (matriz de roles en 2.1.1 y 2.2). Ambas superficies son wrappers finos: **está prohibido implementar lógica de negocio en el `route.ts` o en la Server Action**. Toda regla de dominio se delega en `lib/services/integraciones/*` (`conector-mercadopago.service.ts`) y `lib/services/notificaciones/*` (`plantilla-notificacion.service.ts`, `notificacion.service.ts`). El handler/action se limita a: (1) resolver la sesión y verificar el permiso granular vía `withPermission("integraciones:<accion>")` o `withPermission("notificaciones:<accion>")`, (2) parsear y validar el `body` con Zod, (3) invocar la función de servicio, (4) mapear el resultado al shape de respuesta JSON estándar de la sección 2.

**Regla N.° 1 aplicada al Módulo F (prohibición absoluta de `DELETE`):** ninguna entidad del módulo —`ConectorPago`, `PlantillaNotificacion`, `Notificacion`— admite `DELETE`. Toda baja se implementa como `UPDATE` sobre `is_active`, `deleted_at`, `deleted_by`, `deletion_reason` (con la excepción del "archivado" de una `Notificacion` individual por su destinatario, ver 2.3, que reutiliza el mismo mecanismo pero sin requerir `deletion_reason`, al no ser un evento de auditoría de negocio).

**Regla N.° 2 aplicada al Módulo F (trazabilidad inalterable):** toda alta, cambio de estado o rotación de credenciales de un Conector, y toda creación/edición de plantilla, emite un evento hacia el Módulo D para su encadenamiento SHA-256 (sección 4). Las credenciales de Mercado Pago se cifran en reposo con AES-256 (`lib/crypto/aes.ts`, mismo mecanismo ya usado por Módulo H para datos bancarios de proveedor) — nunca se persisten ni se loguean en texto plano, y ningún rol las lee en claro desde la interfaz.

**Regla N.° 3 aplicada al Módulo F (aislamiento de dominio, patrón Adapter):** ningún módulo de negocio (B, E, G) importa el SDK de Mercado Pago ni construye una llamada HTTP directa a su API. Todos consumen exclusivamente la interfaz estable exportada por `lib/integraciones/mercadopago/adapter.ts` (sección 3.1). Esto es exigencia explícita del criterio de aceptación de HU-F1, no una preferencia de diseño.

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### Convenciones generales

- **Route Handlers** (`app/api/**/route.ts`): toda respuesta exitosa devuelve `NextResponse.json({ data, error: null }, { status })`; todo error de negocio devuelve `NextResponse.json({ data: null, error: { code, message } }, { status })`, con `status` semántico (`400`, `404`, `409`, `422`).
- **Server Actions** (`"use server"`): retornan el objeto plano `{ data, error: null }` o `{ data: null, error: { code, message } }`, mismo shape que su Route Handler equivalente.
- Toda ruta de administración requiere sesión autenticada y permiso granular (Módulo D, RBAC) vía `withPermission("integraciones:<accion>")` o `withPermission("notificaciones:<accion>")`. La ruta de webhook (2.1.3) es la única excepción explícita: no hay sesión de usuario posible en una llamada entrante de Mercado Pago — se autentica por firma (ver 2.1.3), no por RBAC.

### 2.1. Conector de Mercado Pago (HU-F1)

#### 2.1.1. Alta y configuración del Conector

**Ruta:** `POST /app/api/integraciones/mercadopago/conectores/route.ts`
**Server Action equivalente:** `crearConectorMercadoPago()` en `app/(dashboard)/administracion/integraciones/actions.ts`
**Permiso requerido:** `integraciones:administrar_conector`. Roles habilitados (según la matriz del Alcance Funcional § Módulo F, sección 5 — incorporada en Sprint 4; el Alcance no está versionado en el repositorio, la redacción se tomó de la revisión del equipo): **Administrador de Plataforma** (alta, activación, health-check, bitácora y baja del Conector) y **Desarrollador/DevOps** (también rota credenciales y cambia el `entorno` de un Conector).

**A definir — granularidad de permisos por acción:** hoy un único permiso (`integraciones:administrar_conector`) cubre todas las rutas de 2.1.1 a 2.1.5, así que otorgarlo a Desarrollador/DevOps le daría también alta y baja del Conector, no solo rotación de credenciales y cambio de entorno. Queda a definir con el equipo si hace falta separar permisos por acción (ej. uno de rotación de credenciales distinto del de alta/baja) antes de sembrar ese rol — este documento no cambia el modelo de permisos. Además, ninguna ruta de 2.1 define todavía un contrato de "rotar credenciales" ni de "cambiar entorno" sobre un Conector existente (solo alta, health-check, bitácora y baja): también a definir.

```typescript
// src/lib/schemas/integraciones.schema.ts
import { z } from "zod";

export const CrearConectorMercadoPagoSchema = z.object({
  nombre: z.string().min(2),
  entorno: z.enum(["SANDBOX", "PRODUCCION"]),
  access_token: z.string().min(1, "El Access Token es obligatorio"),
  public_key: z.string().min(1, "La Public Key es obligatoria"),
  webhook_secret: z.string().min(1, "La clave secreta de webhooks es obligatoria"),
});
export type CrearConectorMercadoPagoInput = z.infer<typeof CrearConectorMercadoPagoSchema>;
```

**Comportamiento esperado:**
- Los tres campos sensibles (`access_token`, `public_key`, `webhook_secret`) se cifran con AES-256 (`lib/crypto/aes.ts`) **antes** de construir el objeto de escritura a Prisma — el valor en claro nunca llega a `prisma.conectorPago.create()`, nunca se loguea, y nunca viaja en la respuesta HTTP de éxito (se retorna una representación enmascarada, ver respuesta de ejemplo).
- **Un único Conector activo por `entorno` (criterio de aceptación explícito):** antes de crear o activar un Conector en un `entorno`, el servicio verifica que no exista otro `ConectorPago` con `entorno` igual y `estado = "ACTIVO"`; si existe, `409 Conflict`. Esta unicidad se valida en la capa de servicios dentro de la transacción (no hay `@@unique([entorno])` a nivel de schema, porque sí puede haber más de un Conector `INACTIVO` en el mismo entorno — históricos o en preparación).
- `estado` nace en `INACTIVO` — activar un Conector en `PRODUCCION` exige pasar antes por el health-check (2.1.2), que es quien transiciona a `ACTIVO`; un Conector `SANDBOX` puede activarse directamente, sin health-check obligatorio, dado que opera contra credenciales y usuarios de prueba de Mercado Pago.

**Respuesta `201 Created`:**
```json
{
  "data": {
    "conector_id": "uuid",
    "nombre": "Mercado Pago — Producción",
    "entorno": "PRODUCCION",
    "estado": "INACTIVO",
    "access_token_enmascarado": "APP_USR-••••••••3f2a",
    "public_key_enmascarada": "APP_USR-••••••••91bc"
  },
  "error": null
}
```

#### 2.1.2. Health-check y activación

**Ruta:** `POST /app/api/integraciones/mercadopago/conectores/[id]/health-check/route.ts`
**Permiso requerido:** `integraciones:administrar_conector`.

**Comportamiento esperado:**
- Descifra las credenciales del Conector, invoca una llamada de bajo costo contra la API de Mercado Pago (ej. `GET /v1/payment_methods` con el `access_token`) para validar que las credenciales son válidas y que el entorno responde.
- Si la llamada resuelve exitosamente: `estado = "ACTIVO"`, `ultimo_health_check_exitoso_at = now()`. Si falla (credenciales inválidas, timeout, entorno inaccesible): el Conector **permanece** en su estado previo (nunca se activa un Conector cuyo health-check falló) y se registra en la bitácora propia del Conector (2.1.4) como invocación fallida.
- **Requisito no negociable para `PRODUCCION` (criterio de aceptación explícito):** un Conector en `entorno = "PRODUCCION"` no puede transicionar a `ACTIVO` sin al menos un health-check exitoso registrado. La ruta de activación manual (`PATCH .../estado`, si se decide exponerla) debe rechazar esa transición con `422 HEALTH_CHECK_REQUERIDO` si nunca se ejecutó uno exitoso.

**Respuesta `200 OK` (health-check exitoso):**
```json
{ "data": { "conector_id": "uuid", "estado": "ACTIVO", "verificado_at": "2026-09-29T10:00:00.000Z" }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (health-check fallido):**
```json
{ "data": null, "error": { "code": "HEALTH_CHECK_FALLIDO", "message": "Mercado Pago rechazó las credenciales provistas" } }
```

#### 2.1.3. Webhook de confirmación de pago

**Ruta:** `POST /app/api/webhooks/mercadopago/route.ts`
**Autenticación:** por firma (`x-signature` / `x-request-id` de Mercado Pago, validados contra `webhook_secret` del Conector activo del entorno correspondiente), **no** por sesión ni por `withPermission` — este endpoint es invocado por Mercado Pago, no por un cliente autenticado del ERP.

**Comportamiento esperado:**
- **Validación de firma obligatoria (criterio de aceptación explícito):** el servicio recalcula la firma esperada a partir del payload crudo y `webhook_secret` descifrado del Conector activo de ese entorno, y la compara contra el header recibido. Un webhook cuya firma no valida se rechaza con `401` **sin** procesar su contenido ni invocar ningún consumidor — no se distingue entre "firma inválida" y "conector inexistente" en la respuesta pública (mismo criterio de no filtrar información de infraestructura que usa el resto del sistema en `401`/`403`).
- **Idempotencia (criterio de aceptación explícito, compartido con HU-E2):** el servicio persiste el `id` del evento de Mercado Pago (`payment_id` + `topic`) en una tabla/índice de deduplicación antes de despachar el evento interno; un webhook repetido (reintentos de Mercado Pago ante una respuesta lenta) no debe generar una segunda confirmación de pago aguas abajo. Este endpoint **no** confirma la venta ni mueve stock — únicamente valida, deduplica y despacha el evento `pago:webhook_confirmado` (sección 4) hacia sus consumidores reales (HU-E2 en Módulo E, HU-G11 en Módulo G), que son quienes ejecutan la lógica de negocio de confirmación.
- Responde `200 OK` inmediatamente tras despachar el evento (fire-and-forget hacia los consumidores) — Mercado Pago reintenta si no recibe un `2xx` en su ventana de timeout, así que la ruta no debe bloquear la respuesta esperando a que los consumidores terminen de procesar.

**Respuesta `200 OK`:**
```json
{ "data": { "recibido": true, "payment_id": "123456789", "duplicado": false }, "error": null }
```

**Respuesta `401 Unauthorized` (firma inválida):**
```json
{ "data": null, "error": { "code": "FIRMA_INVALIDA", "message": "No se pudo validar la autenticidad del webhook" } }
```

#### 2.1.4. Bitácora de invocaciones del Conector

**Ruta:** `GET /app/api/integraciones/mercadopago/conectores/[id]/bitacora/route.ts`
**Permiso requerido:** `integraciones:administrar_conector` (misma matriz que 2.1.1 — la bitácora operativa del Conector es de gestión, distinta del log de auditoría forense de HU-F5, fuera de alcance de este sprint, ver sección 6).

**Comportamiento esperado:**
- Registra, por cada invocación a la API de Mercado Pago hecha a través del Adapter (sección 3.1) — iniciar cobro, consultar pago, solicitar reembolso, health-check —, si fue exitosa o falló, con timestamp y un resumen del error (sin datos sensibles del pago). Es una bitácora **propia** del Conector, distinta del `AuditLog` global de Módulo D — no reemplaza la auditoría SHA-256 (sección 4), es una vista operativa de conveniencia (mismo criterio ya aplicado por `spec_modulo_A.md` sección 2.10 para distinguir el historial operativo del log forense).

**Respuesta `200 OK`:**
```json
{
  "data": {
    "items": [
      { "operacion": "INICIAR_COBRO", "exitosa": true, "created_at": "2026-09-29T14:00:00.000Z" },
      { "operacion": "CONSULTAR_PAGO", "exitosa": false, "detalle_error": "timeout", "created_at": "2026-09-29T14:05:00.000Z" }
    ],
    "paginacion": { "total": 214, "pagina_actual": 1, "total_paginas": 11, "por_pagina": 20 }
  },
  "error": null
}
```

#### 2.1.5. Baja lógica del Conector

**Ruta:** `PATCH /app/api/integraciones/mercadopago/conectores/[id]/baja/route.ts`
**Permiso requerido:** `integraciones:administrar_conector`.

**Comportamiento esperado:**
- `is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason` (obligatorio) — el Conector deja de ser candidato de "Conector activo" para su entorno, pero la bitácora histórica (2.1.4) permanece íntegra y consultable.
- Un Conector `ACTIVO` que se da de baja lógica también transiciona `estado = "INACTIVO"` en la misma operación — no puede quedar `is_active = false` y `estado = "ACTIVO"` simultáneamente.

**Respuesta `200 OK`:**
```json
{ "data": { "conector_id": "uuid", "is_active": false, "estado": "INACTIVO" }, "error": null }
```

### 2.2. Plantillas de notificación (HU-F2)

**Ruta (alta):** `POST /app/api/notificaciones/plantillas/route.ts`
**Ruta (edición):** `PATCH /app/api/notificaciones/plantillas/[id]/route.ts`
**Ruta (baja lógica):** `PATCH /app/api/notificaciones/plantillas/[id]/baja/route.ts`
**Server Action equivalente:** `crearPlantillaNotificacion()`, `editarPlantillaNotificacion()`, `darDeBajaPlantillaNotificacion()` en `app/(dashboard)/administracion/notificaciones/actions.ts`
**Permiso requerido:** `notificaciones:administrar_plantillas`. Roles habilitados (según la matriz del Alcance Funcional § Módulo F, sección 5 — incorporada en Sprint 4; el Alcance no está versionado en el repositorio, la redacción se tomó de la revisión del equipo): **Administrador de Plataforma** y **Marketing/Atención al Cliente** (ambos crean, editan y dan de baja plantillas).

**A definir — granularidad de permisos por acción:** si Marketing/Atención al Cliente debe tener exactamente las mismas acciones que el Administrador de Plataforma, alcanza con este único permiso; si no (ej. editar redacción sí, dar de baja no), habrá que separar permisos por acción. Queda a definir con el equipo antes de sembrar ese rol — este documento no cambia el modelo de permisos.

```typescript
export const CrearPlantillaNotificacionSchema = z.object({
  tipo_evento: z.string().min(1, "Debe asociarse a un tipo de evento de dominio"),
  asunto: z.string().min(1),
  cuerpo: z.string().min(1), // admite placeholders {{variable}}, ver 3.2
  prioridad_default: z.enum(["CRITICA", "ADVERTENCIA", "INFORMATIVA"]),
});
export type CrearPlantillaNotificacionInput = z.infer<typeof CrearPlantillaNotificacionSchema>;

export const EditarPlantillaNotificacionSchema = z.object({
  asunto: z.string().min(1).optional(),
  cuerpo: z.string().min(1).optional(),
  prioridad_default: z.enum(["CRITICA", "ADVERTENCIA", "INFORMATIVA"]).optional(),
}).strict(); // tipo_evento no es editable — ver 3.2
```

**Comportamiento esperado:**
- Cada plantilla se asocia a exactamente un `tipo_evento` (criterio de aceptación explícito) — el mismo string usado como nombre del evento de dominio en `lib/events/event-types.ts` (ej. `"inventario:stock_minimo_alcanzado"`, `"ventas:diferencia_arqueo_detectada"`). No hay relación de base de datos hacia una tabla de eventos (los eventos no son una entidad persistida) — es una coincidencia de string, validada como existente contra el enum/registro estático de tipos de evento del sistema en la capa de servicios (no en Zod, que no tiene acceso a ese registro sin acoplarse).
- **`tipo_evento` es inmutable tras el alta** (ver `.strict()` del schema de edición, que lo omite deliberadamente) — cambiar el evento asociado a una plantilla existente equivale a crear una plantilla nueva y dar de baja la anterior, para no perder trazabilidad de qué plantilla se usó en cada notificación históricamente enviada.
- Un cambio de redacción (`asunto`/`cuerpo`) no requiere intervención de DevOps ni un nuevo despliegue — es un `UPDATE` directo sobre la fila, consumido en tiempo real por el Motor de Notificaciones (HU-F3) en el próximo evento que dispare ese `tipo_evento`.
- **Texto por defecto cuando no hay plantilla activa (criterio de aceptación explícito):** si un evento de dominio no tiene ninguna `PlantillaNotificacion` con `is_active = true` para su `tipo_evento`, HU-F3 (sección 2.3) genera la notificación con un texto genérico por defecto (`DEFAULT_NOTIFICATION_TEXT`, constante en `lib/services/notificaciones/notificacion.service.ts`) en lugar de fallar o de omitir la notificación — un evento crítico (ej. `usuario:suspendido_automaticamente`) nunca debe quedar sin notificar por falta de plantilla.
- La baja lógica de una plantilla (`is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason`) hace que el Motor de Notificaciones caiga al texto por defecto para ese `tipo_evento` desde ese momento — no bloquea la generación de notificaciones futuras, solo pierde la redacción personalizada.
- **Una plantilla por evento en toda su historia (`schema.prisma`: `PlantillaNotificacion.tipo_evento @unique`, decisión de Sprint 4):** la unicidad es a nivel tabla, incluidas las plantillas dadas de baja. Consecuencia práctica: una vez dada de baja la plantilla de un `tipo_evento`, **no** se puede crear otra nueva para ese mismo evento — para volver a tener (o "reemplazar") la redacción personalizada de un evento se **reactiva y edita la plantilla existente**, nunca se crea una fila nueva. Es una limitación asumida, no un bug. **Cambio posible de un sprint futuro (no implementado):** reemplazar el `@unique` por un índice único parcial (`WHERE is_active = true`) si el equipo decide que hace falta conservar un historial de plantillas por evento.

**Respuesta `201 Created`:**
```json
{ "data": { "plantilla_id": "uuid", "tipo_evento": "ventas:diferencia_arqueo_detectada", "prioridad_default": "ADVERTENCIA" }, "error": null }
```

**Respuesta `400 Bad Request` (intento de editar `tipo_evento`):**
```json
{ "data": null, "error": { "code": "CAMPO_INMUTABLE", "message": "Unrecognized key(s) in object: 'tipo_evento'" } }
```

### 2.3. Motor de Notificaciones internas (HU-F3)

**Naturaleza de este subcomponente:** a diferencia de 2.1 y 2.2, HU-F3 no expone un endpoint de mutación de alta directa — las `Notificacion` se generan exclusivamente por un **listener del Event Bus** (`lib/events/listeners/notificacion.listener.ts`) suscripto a los eventos de dominio de la tabla de 3.3, siguiendo el mismo principio arquitectónico que `audit-log.listener.ts` de Módulo D: ningún módulo de negocio invoca `prisma.notificacion.create()` directamente, todos emiten su evento de dominio y el listener de F3 decide si corresponde generar una notificación.

**Dos superficies de consumo distintas (decisión de diseño explícita):** el personal interno (Cajero, Supervisor, Administrador, etc.) y el Cliente Web tienen sesiones de naturaleza distinta — `spec_modulo_E.md` (HU-E8) es explícito: *"La sesión del Cliente Web es independiente del RBAC del personal interno: un Cliente Web nunca accede a rutas del ERP."* En consecuencia, este módulo expone dos rutas paralelas sobre el mismo modelo `Notificacion`, cada una resolviendo el destinatario desde su propio tipo de sesión:

**Ruta (bandeja — personal interno):** `GET /app/api/notificaciones/route.ts`
**Ruta (bandeja — Cliente Web):** `GET /app/api/tienda/notificaciones/route.ts`
**Ruta (marcar leída, ambas superficies):** `PATCH /app/api/notificaciones/[id]/leer/route.ts` y `PATCH /app/api/tienda/notificaciones/[id]/leer/route.ts`
**Ruta (marcar todas leídas):** `PATCH /app/api/notificaciones/marcar-todas-leidas/route.ts` y su equivalente `/app/api/tienda/notificaciones/marcar-todas-leidas/route.ts`
**Ruta (archivar — baja lógica del lado del destinatario):** `PATCH /app/api/notificaciones/[id]/archivar/route.ts` y su equivalente en `/app/api/tienda/`
**Server Action equivalente:** `marcarNotificacionLeida()`, `archivarNotificacion()` en `app/(dashboard)/notificaciones/actions.ts` (personal interno) y en `app/(tienda)/mi-cuenta/notificaciones/actions.ts` (Cliente Web).
**Permiso requerido:** ninguno de RBAC granular más allá de sesión válida — una notificación solo es visible/operable por su propio destinatario (ver 3.3), la autorización es de **propiedad del recurso**, no de permiso.

```typescript
// src/lib/schemas/notificaciones.schema.ts
export const ListarNotificacionesQuerySchema = z.object({
  solo_no_leidas: z.coerce.boolean().default(false),
  prioridad: z.enum(["CRITICA", "ADVERTENCIA", "INFORMATIVA"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(50).default(20),
});
export type ListarNotificacionesQuery = z.infer<typeof ListarNotificacionesQuerySchema>;
```

**Comportamiento esperado:**
- **Resolución de destinatario (criterio de aceptación explícito):** una notificación puede dirigirse a un `usuario_id` puntual o a todos los usuarios de un `rol_id` — el modelo `Notificacion` persiste **una fila por destinatario final resuelto** en el momento de su generación (no una fila "por rol" que se resuelva en cada lectura), para que marcar una notificación como leída por un usuario no la marque leída para el resto de su rol. El listener de F3 expande `rol_id` → `UsuarioRol` activos → una `Notificacion` por `usuario_id` resultante, dentro de la misma operación que procesa el evento.
- **Contador de no leídas casi en tiempo real (criterio de aceptación explícito):** el endpoint de bandeja soporta el filtro `solo_no_leidas` para que el badge de contador de la UI pueda refrescarse con polling corto (frecuencia fuera del alcance de este documento — decisión de frontend) sin traer el listado completo; no se define en este sprint un mecanismo de push (WebSocket/SSE) — queda documentado como posible extensión futura, no bloqueante de HU-F3 tal como está redactada en el Backlog.
- **Clave de idempotencia (criterio de aceptación explícito, no negociable):** cada `Notificacion` se genera con una `clave_idempotencia` derivada determinísticamente del evento de origen y el destinatario (ej. `sha256(evento_id + ":" + usuario_id)`, o — cuando el evento no trae un `evento_id` propio — `sha256(tipo_evento + ":" + registro_id + ":" + usuario_id)`), con `@@unique([clave_idempotencia])` a nivel de schema. Un mismo evento de dominio nunca genera dos notificaciones al mismo destinatario — el listener usa `create` con captura de `P2002` (constraint de unicidad) tratado como no-op, mismo patrón de idempotencia que HU-H4 (`spec_modulo_H.md` sección 2.6).
- **Niveles de prioridad:** `CRITICA`, `ADVERTENCIA`, `INFORMATIVA` (enum `PrioridadNotificacion`). Las notificaciones `CRITICA` se destacan visualmente y se listan primero en el orden por defecto (`prioridad` desc de un `CASE` de severidad, luego `created_at` desc) — no es un `ORDER BY` alfabético sobre el enum.
- **Falla en la generación nunca bloquea la operación de origen (criterio de aceptación explícito):** el listener de F3 corre después del `COMMIT` de la transacción que originó el evento (patrón fire-and-forget, igual que `audit-log.listener.ts`); si la inserción de la `Notificacion` falla (ej. el usuario destinatario fue dado de baja entre el evento y su procesamiento), el error se loguea y **no** revierte ni reintenta contra la operación de negocio que ya se confirmó.
- **Aislamiento por tipo de sesión (criterio de aceptación explícito, ver nota de dos superficies arriba):** `GET /app/api/notificaciones` resuelve el destinatario desde la sesión RBAC de personal interno y solo devuelve notificaciones cuyo `usuario_id` coincide con esa sesión; `GET /app/api/tienda/notificaciones` resuelve desde la sesión de Cliente Web (HU-E8) y aplica el mismo filtro sobre su propio `cliente_web_usuario_id`. Ninguna de las dos rutas permite `usuario_id`/`cliente_web_usuario_id` como parámetro del cliente — se resuelve siempre server-side desde la sesión, nunca del query string ni del body.
- Marcar como leída (`leida_at = now()`) y archivar (`is_active = false`, `deleted_at`, `deleted_by` — sin `deletion_reason` obligatorio, al no ser un evento de negocio auditable sino una acción de bandeja personal) son idempotentes: repetir la acción sobre una notificación ya leída/archivada no es un error, retorna `200` sin cambios.

**Respuesta `200 OK` (bandeja):**
```json
{
  "data": {
    "items": [
      {
        "notificacion_id": "uuid",
        "tipo_evento": "ecommerce:pedido_listo_para_retiro",
        "prioridad": "INFORMATIVA",
        "asunto": "Tu pedido está listo para retirar",
        "cuerpo": "Tu pedido V-2026-004821 ya está listo para retirar en Sucursal Salta.",
        "leida_at": null,
        "created_at": "2026-09-29T16:00:00.000Z"
      }
    ],
    "no_leidas": 4,
    "paginacion": { "total": 23, "pagina_actual": 1, "total_paginas": 2, "por_pagina": 20 }
  },
  "error": null
}
```

**Respuesta `200 OK` (marcar leída, idempotente):**
```json
{ "data": { "notificacion_id": "uuid", "leida_at": "2026-09-29T16:05:00.000Z" }, "error": null }
```

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. Patrón Adapter obligatorio para Mercado Pago

`lib/integraciones/mercadopago/adapter.ts` exporta exclusivamente tres funciones — `iniciarCobro(input)`, `consultarPago(paymentId)`, `solicitarReembolso(paymentId, monto?)` — que internamente resuelven el Conector `ACTIVO` del entorno vigente (`NODE_ENV` mapeado a `SANDBOX`/`PRODUCCION`), descifran sus credenciales y realizan la llamada real al SDK/API de Mercado Pago. Ningún archivo fuera de `lib/integraciones/mercadopago/**` debe importar el SDK de Mercado Pago (`mercadopago` npm package) — Módulo B (HU-B1, medio de pago Mercado Pago en el POS), Módulo E (HU-E2, checkout) y Módulo G (HU-G11, conciliación) consumen únicamente estas tres funciones. Esta restricción es verificable estáticamente (ej. regla de ESLint `no-restricted-imports` sobre el paquete `mercadopago` fuera de esa carpeta) — se recomienda incorporarla como tarea de calidad, sin bloquear la implementación funcional de esta HU.

### 3.2. Placeholders de plantilla — resolución sin motor de templating externo

`{{variable}}` en `PlantillaNotificacion.cuerpo`/`asunto` se resuelve con un reemplazo de string simple (`String.prototype.replaceAll`, sin dependencia externa de templating) contra un diccionario de variables que cada evento de dominio provee en su payload — nombre del destinatario, número de pedido, estado, fecha estimada (criterio de aceptación explícito de la tabla de variables soportadas). Una variable presente en la plantilla sin valor correspondiente en el payload del evento se sustituye por cadena vacía, nunca lanza excepción — una plantilla mal configurada no debe poder tumbar el procesamiento de un evento de negocio real.

### 3.3. Consumidores iniciales del Motor de Notificaciones (tabla de suscripción)

El listener `notificacion.listener.ts` se suscribe, en Sprint 4, a los siguientes eventos ya existentes o introducidos por este mismo sprint (criterio de aceptación explícito del Backlog, "Consumidores iniciales"):

| Evento consumido | Origen | Prioridad default | Destinatario |
|---|---|---|---|
| `stock:umbral_critico_alcanzado` | Módulo A (HU-A7) | ADVERTENCIA | Rol Encargado de Depósito |
| `ventas:diferencia_arqueo_detectada` *(a confirmar nombre real contra HU-B2/HU-G1 — ver sección 6)* | Módulo B / G | ADVERTENCIA | Rol Tesorero Central |
| `usuario:suspendido_automaticamente` | Módulo D (D.2) | CRITICA | Usuario afectado + Rol Administrador |
| *(evento de ruptura de cadena de hashes — a confirmar nombre real contra Módulo D, ver sección 6)* | Módulo D (D.3/D.4) | CRITICA | Rol Auditor |
| *(evento de OC pendiente de aprobación — a confirmar nombre real contra Módulo H, ver sección 6)* | Módulo H | INFORMATIVA | Rol Supervisor de Compras |
| `ecommerce:pedido_pago_confirmado` (HU-E2/E12) | Módulo E | INFORMATIVA | Cliente Web dueño del pedido + Rol Operador de Pick & Pack |
| `ecommerce:pedido_listo_para_retiro` (HU-E3/E9/E12) | Módulo E | INFORMATIVA | Cliente Web dueño del pedido |
| `ecommerce:carrito_articulo_no_disponible` (HU-E1/E5) | Módulo E | ADVERTENCIA | Cliente Web dueño del carrito |
| `ecommerce:plazo_retiro_por_vencer` \| `ecommerce:pedido_vencido_sin_retiro` (HU-E13) | Módulo E | `plazo_retiro_por_vencer`: ADVERTENCIA · `pedido_vencido_sin_retiro`: CRITICA | Cliente Web dueño del pedido |

**Nota de relevamiento — tres nombres de evento sin confirmar:** los tres eventos marcados *"a confirmar"* en la tabla (diferencia de arqueo, ruptura de cadena de hashes, OC pendiente de aprobación) están descriptos en el criterio de aceptación de HU-F3 por su efecto de negocio, no por el nombre exacto del evento de dominio ya emitido por Módulos A/B/D/G/H. Antes de implementar el listener, confirmar contra `lib/events/event-types.ts` y las specs de esos módulos (`spec_modulo_D.md` sección 5, `spec_modulo_H.md`) el nombre real — no asumirlo. Los eventos de Módulo E de esta misma tabla sí están definidos en `spec_modulo_E.md` de este mismo sprint, así que no tienen esa ambigüedad.

### 3.4. Restricción de borrado físico (`onDelete: Restrict`)

Todas las relaciones de Prisma salientes de `ConectorPago`, `PlantillaNotificacion` y `Notificacion` usan `onDelete: Restrict`. Ninguna función de servicio del módulo invoca `prisma.<modelo>.delete()` ni `deleteMany()`.

---

## 4. Eventos de Dominio (EDA)

**Archivo:** `src/lib/events/event-types.ts`

El Módulo F es simultáneamente **emisor** (hacia Módulo D, para auditoría de sus propias mutaciones administrativas) y **consumidor** (el Motor de Notificaciones, de los eventos de toda la tabla de 3.3).

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `integracion:conector_creado` | 2.1.1, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ conector_id, entorno, usuario_id }` (sin credenciales) |
| `integracion:conector_estado_cambiado` | 2.1.2, 2.1.5, tras `COMMIT` | Módulo D | `{ conector_id, estado_anterior, estado_nuevo, usuario_id }` |
| `integracion:invocacion_fallida` | Cualquier llamada fallida del Adapter (3.1) | Módulo D | `{ conector_id, operacion, detalle_error }` |
| `pago:webhook_confirmado` | 2.1.3, tras validar firma y deduplicar | Módulo E (HU-E2), Módulo G (HU-G11) | `{ payment_id, estado_pago, monto, external_reference }` |
| `notificacion_plantilla:creada` \| `...actualizada` \| `...baja_logica` | 2.2, tras `COMMIT` | Módulo D | `{ plantilla_id, tipo_evento, usuario_id, valor_anterior?, valor_nuevo? }` |
| *(toda la tabla de 3.3)* | Módulos A/B/D/E/G/H | Módulo F (`notificacion.listener.ts`) | Payload propio de cada evento origen — ver sus specs respectivas |

### 4.1. Regla de exclusión de datos sensibles en el payload

Ningún evento de este módulo incluye en su payload el valor en claro de `access_token`, `public_key` ni `webhook_secret` de un Conector, ni datos de tarjeta del pago (el sistema nunca los recibe — HU-E2 es explícito: *"el sistema nunca recibe ni almacena datos de tarjeta"*). El emisor es responsable de excluir estos campos antes de publicar al bus — `audit-log.listener.ts` y `notificacion.listener.ts` no realizan sanitización adicional, misma convención que `spec_modulo_D.md` §5.1 y `spec_modulo_H.md` sección 4.

---

## 5. Fuera de Alcance (diferido)

- **HU-F4 — Despliegue Docker/Docker Compose:** no priorizada en Sprint 4. Es una tarea de infraestructura de todo el proyecto, no específica de este módulo funcional — se retoma cuando el equipo defina el sprint de estabilización/despliegue.
- **HU-F5 — Log técnico de auditoría del Conector y del Motor de Notificaciones:** no priorizada en Sprint 4. La bitácora operativa de 2.1.4 cubre una necesidad de conveniencia inmediata (ver el resultado de la última invocación), pero **no** es el log de auditoría forense con verificación SHA-256 que pide HU-F5 — cuando esa HU se planifique, debe seguir el mismo patrón ya usado por HU-A6/HU-B6/HU-H6 (servicio propio de solo lectura contra `AuditLog`, filtrado por dominio, sin función compartida `listarEventosPorDominio()` — ver la corrección explícita documentada en `spec_modulo_B.md` sección 2.6 sobre por qué esa función nunca se implementó).
- **HU-F6 — Estrategia de renderizado diferenciada por superficie (CSR/SSR/ISR/PWA offline):** no priorizada en Sprint 4. Es una decisión de arquitectura de frontend transversal a todos los módulos con UI (incluido el storefront de Módulo E construido en este mismo sprint) — se documentará cuando el equipo aborde específicamente performance y SEO del storefront, fuera del alcance funcional de este sprint.
- **Otras pasarelas de pago (MODO) y conectores de mensajería externa (WhatsApp Business API, SMTP/Email):** descartados explícitamente por directiva del PO — no reintroducir sin una nueva directiva documentada.
- **Push en tiempo real (WebSocket/SSE) para el contador de notificaciones:** HU-F3 no lo exige; el contador se resuelve por polling desde el frontend contra `GET /app/api/notificaciones?solo_no_leidas=true` (o su equivalente de Cliente Web). Si en un sprint futuro se requiere push real, es una extensión de este documento, no una reimplementación.
- **Confirmación de los tres nombres de evento marcados en la sección 3.3:** ver nota de relevamiento en esa misma sección — bloqueante solo para el listener de esos tres eventos puntuales, no para el resto de HU-F3.