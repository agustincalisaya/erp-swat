# HU-C1 — Alta de Cliente con validación de unicidad por DNI

**Módulo:** C — Gestión de Clientes
**Responsable:** CH1K10 (autor del commit `048c356`, "feat:Dar de alta a un cliente")
**Estado:** Implementada (schema, service, endpoint REST, Server Action, pantalla `/clientes/nuevo`, evento de auditoría). Las direcciones pertenecen a HU-C3 y la consulta preventiva previa al alta a HU-C5; ver Sección 10 para el estado histórico de la validación del formulario.

## 1. Objetivo

Permitir que un Vendedor o un Administrador de CRM dé de alta un cliente identificado por su DNI, garantizando que **nunca existan dos clientes con el mismo DNI**: si el DNI ya está registrado, el sistema no crea un duplicado ni devuelve un error, sino que **recupera el registro existente**.

**Criterios de aceptación** (fuente: `spec_modulo_C.md §2.1`):

1. El alta valida la unicidad del DNI antes de crear el registro.
2. Si ya existe un `Cliente` con ese `dni`, la operación **no crea un duplicado**: retorna el registro existente ("recuperar en vez de duplicar"). Es distinto de un `409 Conflict`: la respuesta es `200 OK`, no un error.
3. El alta es transaccional (`prisma.$transaction`) y deja el cliente en `is_active = true`.
4. El alta **exige** el registro simultáneo de un `ConsentimientoCliente` en la misma transacción — no existe un `Cliente` sin al menos un consentimiento inicial.
5. Permiso requerido: `clientes:crear` (Vendedor, Administrador de CRM).

**Discrepancias entre `spec_modulo_C.md §2.1` y lo implementado, documentadas explícitamente (mismo criterio que HU-A11 con `crearIngreso` vs. `registrarIngresoStock`):**

| Punto | Spec §2.1 | Implementación real | Motivo |
|---|---|---|---|
| Campo `direccion` en `CrearClienteSchema` | Presente en el snippet | **Ausente** | Ver Sección 5.1 |
| `posibles_duplicados` en la respuesta | Presente (alerta no bloqueante) | **Ausente** | Ver Sección 5.4 |
| Alcance de "ya existe" | "Cliente **activo** con ese `dni`" | Recupera **cualquier** cliente con ese DNI, activo o dado de baja | `dni` es `@unique` a nivel de DB: no se puede crear un segundo registro aunque el primero esté inactivo. Ver Sección 5.2 |

## 2. Modelo de datos involucrado

Esta sección cubre **solo lo que HU-C1 efectivamente toca**. El detalle campo por campo del modelo `Cliente` (tipos, nullables, índices, enums, RBAC sembrado) está en `docs/modulos/modulo C/HU-C1c.md` y no se repite acá.

**`Cliente` — qué escribe el alta:**

| Campo | Valor que escribe HU-C1 |
|---|---|
| `dni` | `input.dni` (7-8 dígitos; `@unique` a nivel de DB) |
| `nombre` | `input.nombre` |
| `telefono` | `input.telefono ?? null` |
| `email` | `input.email ?? null` |
| `segmento` | No se envía: nace `MINORISTA` por default de schema |
| `canal_preferido` | No se envía: queda `null` (lo define HU-C9) |
| `is_active` | No se envía: nace `true` por default de schema |
| `fusionado_en_id`, `deleted_*` | No se envían: quedan `null` |

**`ConsentimientoCliente` — qué escribe el alta:** exactamente **una** fila por cliente nuevo, con valores fijos hardcodeados en el service (no vienen del formulario ni de Zod):

| Campo | Valor |
|---|---|
| `cliente_id` | id del `Cliente` recién creado |
| `alcance` | `"VENTA_ASISTIDA"` (literal del enum `AlcanceConsentimiento`) |
| `finalidad` | `"Venta asistida — consentimiento mínimo registrado en el alta del cliente (HU-C1)"` |

**Lo que HU-C1 NO toca:** `DireccionCliente` (cero filas creadas por el alta — HU-C3), la relación histórica `fusionado_en_id`, soft delete (HU-C6). El modelo `Cliente` **no** tiene columna "creado por": quién dio de alta al cliente vive únicamente en el `AuditLog` (Sección 7).

## 3. Arquitectura de la solución

```
FormularioAltaCliente.tsx ──► crearCliente() [Server Action] ─┐
   (/clientes/nuevo)            clientes/actions.ts            │
                                                               ├─► crearCliente() [service] ─► prisma.$transaction ─► crearClienteTx()
POST /api/clientes  ──────────────────────────────────────────┘     cliente.service.ts                                  │
   route.ts (withPermission)                                                │                              ┌────────────┴────────────┐
                                                                            │                              │ findUnique({dni})        │
                                                                            │                              │  ├─ existe → es_nuevo:false
                                                                            │                              │  └─ no → Cliente.create
                                                                            │                              │          + ConsentimientoCliente.create
                                                                            ▼                              └──────────────────────────┘
                                                        (post-COMMIT, solo si es_nuevo) domainEventBus.emit("cliente:creado")
                                                                            ▼
                                                        audit-log.listener.ts → AuditLog (CREATE, tabla "clientes")
```

La regla de HU-A11 se mantiene: el Route Handler y la Server Action son **wrappers finos**; toda la lógica de negocio vive en `cliente.service.ts` y no se reimplementa en ninguna otra capa.

### 3.1 Schema Zod — `src/lib/schemas/clientes.schema.ts`

`CrearClienteSchema` (único schema de Cliente que existe hoy):

| Campo | Validación | Mensaje de error |
|---|---|---|
| `dni` | `z.string().regex(/^\d{7,8}$/)` | "El DNI debe tener 7 u 8 dígitos" |
| `nombre` | `z.string().min(2)` | "El nombre es obligatorio" |
| `telefono` | `z.string().optional()` | — (sin validación de formato) |
| `email` | `z.string().email().optional()` | "Email inválido" |

Exporta también `CrearClienteInput` (`z.infer`). El mismo schema se usa en tres lugares: el Route Handler, la Server Action y el `zodResolver` del formulario.

### 3.2 Service — `src/lib/services/clientes/cliente.service.ts`

| Función | Rol | Abre transacción | Emite evento |
|---|---|---|---|
| `crearClienteTx(tx, input)` (`cliente.service.ts:94`) | Núcleo reutilizable. Recibe el `tx` del caller. Pre-check por DNI; si no existe, crea `Cliente` + `ConsentimientoCliente`. Devuelve `{ cliente, esNuevo }`. | No | No |
| `crearCliente(input, usuarioId)` (`cliente.service.ts:147`) | Wrapper público. Abre `prisma.$transaction`, delega en `crearClienteTx`, emite el evento post-COMMIT si `esNuevo`. Devuelve `{ cliente_id, dni, es_nuevo }`. | Sí | Sí (solo alta nueva) |

`crearClienteTx` sigue el mismo patrón que `registrarIngresoStockTx` (`movimiento.service.ts`): el caller es dueño de los límites de la transacción y del evento, lo que permite que otras HUs de Cliente reutilicen el núcleo dentro de su propia transacción.

**Carrera de altas concurrentes:** el pre-check corre dentro de la transacción, pero dos altas simultáneas con el mismo DNI nuevo pueden pasarlo ambas antes de que cualquiera haga el `INSERT`. La que pierde recibe `P2002` (violación del `@unique` de `dni`); `crearCliente` lo captura, busca el registro ganador con `findUniqueOrThrow` y devuelve `es_nuevo: false`. Nunca se propaga como error (mismo patrón que la "Race CUIT" de `crearProveedor`).

### 3.3 Endpoint REST — `POST /api/clientes` (`src/app/api/clientes/route.ts`)

Envuelto en `withPermission("clientes:crear", ...)`. Valida el body con `CrearClienteSchema` y delega en `crearCliente()`. Shape de respuesta: `{ data, error }`.

| Status | Cuándo | Body |
|---|---|---|
| `201 Created` | Alta nueva (`es_nuevo: true`) | `{ data: { cliente_id, dni, es_nuevo: true }, error: null }` |
| `200 OK` | DNI ya existente (`es_nuevo: false`) | `{ data: { cliente_id, dni, es_nuevo: false }, error: null }` |
| `400` | Body inválido | `{ data: null, error: { code: "VALIDATION_ERROR", message, fieldErrors } }` |
| `401` | Sin sesión | (lo resuelve `withPermission`) |
| `403` | Sesión válida sin el permiso | `{ code: "FORBIDDEN", ... }` |
| `500` | Error inesperado | `{ code: "INTERNAL_ERROR", ... }` |

### 3.4 Server Action — `crearCliente()` (`src/app/(dashboard)/clientes/actions.ts:37`)

Equivalente al endpoint para el formulario. Resuelve sesión (`getServerSession`), verifica el permiso (`usuarioTienePermiso`), parsea con Zod, invoca **la misma** `crearCliente()` del service y hace `revalidatePath("/clientes")`. Devuelve `ActionResult<ClienteCreado>` con shape `{ data, error }` (igual que el Route Handler, a diferencia de las Server Actions del Módulo A, que usan `{ success, data?, error? }`). Los errores se devuelven como valor, no se lanzan: `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR` (primer mensaje de Zod), `INTERNAL_ERROR`.

Como el formulario invoca la Server Action y no el endpoint, **el código HTTP 200/201 no llega a la UI**: el discriminador que consume la pantalla es `data.es_nuevo`.

### 3.5 Componente de formulario y pantalla

- `src/app/(dashboard)/clientes/nuevo/page.tsx` — ruta `/clientes/nuevo`. Server Component sin datos que precargar; solo monta el título "Nuevo Cliente" y `FormularioAltaCliente`.
- `src/components/clientes/FormularioAltaCliente.tsx` — componente cliente. `react-hook-form` + `zodResolver(CrearClienteSchema)` (mismo patrón que `FormularioProductoMaestro.tsx`). Campos: **DNI** (`maxLength=8`), **Nombre**, **Teléfono** (opcional), **Email** (opcional, `type="email"`). Botón "Dar de alta" (muestra "Guardando…" mientras envía).
- Manejo del resultado: si `error`, muestra un `Alert` destructivo con `error.message` encima del formulario. Si hay `data`, reemplaza el formulario por un `Alert` verde cuyo texto depende de `es_nuevo` (alta nueva vs. recuperado) y un botón "Cargar otro cliente" que resetea el formulario.
- Navegación: entrada "Nuevo Cliente" en la sección "Clientes" del `Sidebar.tsx`, visible solo con el permiso `clientes:crear`. Además, `src/proxy.ts` amplía su `matcher` con `/clientes/:path*`, de modo que un usuario sin sesión es redirigido a `/login`.

## 4. Eventos de dominio y auditoría

| Evento | Emitido por | Cuándo | Payload |
|---|---|---|---|
| `cliente:creado` | `crearCliente()` | **Solo** si `es_nuevo === true`, post-COMMIT, fire-and-forget | `{ cliente_id, dni, usuario_id, es_nuevo: true }` |

- **Recuperar un DNI existente no emite nada:** no hay transición nueva que auditar.
- El payload **excluye deliberadamente `telefono` y `email`** (regla de exclusión de datos personales del payload).
- El listener (`audit-log.listener.ts:759`) registra un `AuditLog` con `accion: "CREATE"`, `tabla_afectada: "clientes"`, `registro_id: cliente_id`, `valor_anterior: null`, `valor_nuevo: { dni }` e `ip: "unknown"` (el payload no lleva IP — mismo criterio que `producto_maestro:creado`).
- Los tipos viven en `src/lib/events/event-types.ts` (`ClienteCreadoPayload`, entrada `"cliente:creado"` en `DomainEventMap`).
- `cliente:creado` no se reutiliza para otras mutaciones de Cliente: cada HU futura que mute el modelo necesita su propio evento y listener.

## 5. Decisiones de diseño

### 5.1 El alta no incluye dirección (HU-C3)

El snippet original de `spec_modulo_C.md §2.1` traía `direccion: z.string().optional()`, pero se omitió deliberadamente. Justificación:

- El "Comportamiento esperado" de §2.1 no describe ningún manejo de dirección.
- `Cliente` no tiene columna de dirección: toda dirección se modela en `DireccionCliente` (HU-C3, entidad separada con su propio endpoint, schema y permiso), **incluida la primera que se cargue en el alta** (lo dice el propio `schema.prisma`).
- Aceptar un campo `direccion` obligaría a implementar un comportamiento que el spec no define (¿crear una `DireccionCliente`? ¿de qué tipo, facturación o envío?), invadiendo HU-C3.

Consecuencia: el alta nunca crea filas en `DireccionCliente`, y el formulario no tiene campo de dirección.

### 5.2 `es_nuevo` (200 vs. 201) en vez de `409 Conflict`

Un DNI repetido **no es una condición de error**: es el caso de uso normal de un vendedor que no sabe si el cliente ya existe y lo da de alta "por las dudas". Por eso el service devuelve `es_nuevo: false` y el endpoint responde `200` en lugar de lanzar un `ServiceError` mapeado a `409`.

- **Idempotencia:** repetir la misma alta N veces produce siempre el mismo `cliente_id`.
- **La UI nunca ve un error:** el formulario muestra un mensaje informativo verde, no un `Alert` destructivo.
- **El registro recuperado no se modifica:** los datos enviados en el intento (nombre, teléfono, email) se descartan. Corregir datos de un cliente existente es territorio de HU-C2.
- **Recupera activos e inactivos:** el pre-check no filtra por `is_active`/`deleted_at`. Consecuencia para HU-C6: dar de baja un cliente **no libera su DNI** para un alta nueva.
- **Seguridad frente a concurrencia:** el `P2002` de la carrera se traduce al mismo resultado (Sección 3.2).

### 5.3 Consentimiento inicial con valor fijo (HU-C4 lo amplía)

El spec exige que no exista un `Cliente` sin consentimiento, pero `CrearClienteSchema` no trae `alcance` ni `finalidad` (esos campos son de `RegistrarConsentimientoSchema`, HU-C4). Decisión de producto: el alta registra siempre el **mínimo** — `alcance: VENTA_ASISTIDA` con una `finalidad` de texto fijo — definido como constante en el service, no como campo del formulario.

- Mantiene la invariante ("todo cliente tiene ≥ 1 consentimiento") sin agregar campos que el Vendedor no necesita completar en el mostrador.
- `VENTA_ASISTIDA` es el alcance mínimo: no habilita `COMUNICACIONES_COMERCIALES`, así que no se asume consentimiento de marketing.
- HU-C4 (`POST /clientes/[id]/consentimientos`) es la vía para ampliarlo o revocarlo; este service nunca lo reemplaza ni lo borra.

### 5.4 Consulta preventiva fuera del servicio de HU-C1 (HU-C5)

`spec_modulo_C.md §2.1` menciona una alerta no bloqueante de "posibles duplicados" (coincidencia aproximada nombre + contacto), pero la lógica que la produce está descripta en HU-C5 (§2.5), no en HU-C1. Implementarla acá obligaría a construir la mitad de HU-C5 (la consulta de coincidencia aproximada) sin el alcance propio de HU-C5. Queda deliberadamente fuera: ni el schema, ni la respuesta del service, ni el endpoint incluyen el campo. HU-C1 conserva la unicidad exacta por DNI; HU-C5 ofrece la consulta preventiva y una alerta aproximada antes de confirmar.

## 6. RBAC

| Permiso | VENDEDOR | ADMINISTRADOR_CRM | AUDITOR |
|---|:---:|:---:|:---:|
| `clientes:crear` | ✅ | ✅ | ❌ |

- El permiso se declara una sola vez (`PERMISO_CREAR` en `cliente.service.ts`) y lo consumen el Route Handler y la Server Action.
- **Capa 1 (REST):** `withPermission("clientes:crear")` → `401` sin sesión, `403` sin permiso.
- **Capa 2 (Server Action):** repite sesión + `usuarioTienePermiso` antes de tocar el service (mismo criterio que las Server Actions del Módulo A).
- **UI:** el Sidebar oculta "Nuevo Cliente" si el usuario no tiene el permiso. **La página `/clientes/nuevo` en sí no tiene un chequeo de permiso** (`page.tsx` no lo hace): un usuario con sesión pero sin `clientes:crear` que acceda por URL ve el formulario, pero al enviarlo la Server Action responde `FORBIDDEN` ("No tenés el permiso "clientes:crear""). La autorización real está en las capas 1 y 2, no en la página.
- El rol `ADMINISTRADOR` (Módulo D) **no** tiene ningún permiso `clientes:*`; no es equivalente a `ADMINISTRADOR_CRM`.
- El seed (`prisma/seed.ts`) no asigna `VENDEDOR` ni `ADMINISTRADOR_CRM` a ningún usuario de prueba: para probar la pantalla desde un login hay que crear uno primero.

## 7. Cómo se validó

**Un único archivo de tests: integración.** No existen tests unitarios de HU-C1 (ni del schema Zod, ni del service con Prisma mockeado, ni del formulario), y el script `npm test` no incluye ningún archivo de clientes.

**`src/lib/services/clientes/cliente.integration.test.ts`** (`npm run test:integration:c1`). Corre contra una base real y se **saltea (`skip`) si no está definida la variable `HU_C1_INTEGRATION_DATABASE_URL`**; por eso no se ejecuta en `npm test` ni en un entorno sin esa variable. Usa `crearCliente()` directo (no pasa por HTTP ni por la Server Action) y cubre:

| Escenario | Qué verifica |
|---|---|
| Alta con DNI nuevo | Devuelve `es_nuevo: true`; el `Cliente` tiene los datos enviados, `is_active = true`, `segmento = MINORISTA`, `canal_preferido = null` |
| Consentimiento inicial | Existe exactamente 1 `ConsentimientoCliente` con `alcance = VENTA_ASISTIDA`, `is_active = true` y `finalidad` no vacía |
| Alta repitiendo el DNI | Devuelve el mismo `cliente_id` con `es_nuevo: false`; sigue habiendo 1 solo `Cliente` con ese DNI; nombre/teléfono no fueron pisados; sigue habiendo 1 solo consentimiento |
| Concurrencia | Dos altas simultáneas con el mismo DNI nuevo (`Promise.allSettled`) producen un único `Cliente` y ambas devuelven el mismo `cliente_id` |
| Auditoría | Hay exactamente 1 `AuditLog` (`CREATE`, tabla `clientes`, `usuario_id` correcto, `valor_nuevo = { dni }`); la recuperación **no** generó un segundo asiento |

**Lo que ningún test cubre hoy:** las validaciones del schema Zod (DNI de 6 o 9 dígitos, DNI con letras, nombre de 1 carácter, email inválido), el mapeo de status del endpoint (`200`/`201`/`400`/`401`/`403`), el chequeo de permiso de la Server Action, y el comportamiento del formulario. Se verificó manualmente con `safeParse` que el schema devuelve los mensajes esperados para DNI, nombre y email inválidos (ver también Sección 10).

## 8. Cómo probar manualmente

1. Crear (o asignar) un usuario con rol `VENDEDOR` o `ADMINISTRADOR_CRM` — el seed no trae ninguno.
2. Iniciar sesión y confirmar que el Sidebar muestra "Clientes → Nuevo Cliente"; ir a `/clientes/nuevo`.
3. **Alta nueva:** completar DNI (ej. `30123456`), Nombre y Email → "Dar de alta". Verificar el mensaje verde "Cliente con DNI 30123456 creado correctamente." y, en base, 1 `Cliente` + 1 `ConsentimientoCliente` (`VENTA_ASISTIDA`) + 1 `AuditLog` `CREATE` sobre `clientes`.
4. **DNI existente:** "Cargar otro cliente" y repetir el mismo DNI con otro nombre. Verificar el mensaje "Ya existía un cliente con DNI 30123456 — se recuperó el registro existente, no se creó un duplicado.", que el nombre original no cambió y que no hay un segundo `AuditLog`.
5. **Validaciones:** DNI de 6 dígitos o con letras → "El DNI debe tener 7 u 8 dígitos"; nombre de 1 carácter → "El nombre es obligatorio"; email `abc` → "Email inválido".
6. **Permiso:** con un usuario `AUDITOR`, confirmar que el Sidebar no muestra "Nuevo Cliente" y que un `POST /api/clientes` responde `403`.
7. **REST:** `POST /api/clientes` con DNI nuevo → `201`; repetido → `200` con el mismo `cliente_id`.

## 9. Impacto en otros archivos

`prisma/seed.ts` (permisos `clientes:*` y roles `VENDEDOR`/`ADMINISTRADOR_CRM`), `Sidebar.tsx` (sección "Clientes"), `src/proxy.ts` (`matcher`), `event-types.ts` y `audit-log.listener.ts` (evento `cliente:creado`), `package.json` (script `test:integration:c1`).

## 10. Estado actual y pendientes

**Completo y verificable en código:**
- Alta transaccional con unicidad por DNI y recuperación idempotente (`es_nuevo`).
- Consentimiento inicial obligatorio en la misma transacción.
- Endpoint REST y Server Action sobre el mismo service, con RBAC en dos capas.
- Auditoría solo de altas nuevas.
- Resolución de la carrera de altas concurrentes.

**Gap confirmado — el campo Email opcional no se puede dejar vacío:** `FormularioAltaCliente` inicializa `email` (y `telefono`) con `""`, pero el schema define `email: z.string().email().optional()`, y `""` **no** es `undefined`: falla la validación de email. Verificado con `safeParse`: `{ dni: "30123456", nombre: "Juan", telefono: "", email: "" }` devuelve `success: false` con el mensaje "Email inválido". Efecto: aunque el placeholder dice "Opcional", **hoy no se puede dar de alta un cliente sin email desde la pantalla**; el mismo payload sin la clave `email` sí es válido por la vía REST. Una consecuencia relacionada: un `telefono` vacío pasa la validación y se guarda como `""` en lugar de `null` (`input.telefono ?? null` no convierte cadenas vacías). No se corrigió en esta HU; la corrección natural es normalizar `""` a `undefined` antes de validar (o `z.literal("")` como alternativa en el schema).

**Pendientes / territorio de otras HUs:**
- Dirección del cliente → HU-C3.
- Consulta preventiva previa a confirmar el alta → HU-C5.
- Ampliar o revocar el consentimiento inicial → HU-C4.
- Corregir datos de un cliente existente (incluida una eventual recuperación con datos distintos) → HU-C2.
- Tests unitarios del schema y del endpoint; usuario de prueba con rol `VENDEDOR` en el seed.
