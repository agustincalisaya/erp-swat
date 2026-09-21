# HU-C9 — Registrar canal de contacto preferido (WhatsApp / Email / Ambos)

**Módulo:** C — Gestión de Clientes
**Responsable:** Ramiro V. Castagnaro (Rama) — rama `HU-C9` (PR #182). Verificado en el historial de merges de `develop`.
**Estado:** Implementada (schema Zod, service, ruta REST `PATCH`, Server Action, sección en la ficha, evento de auditoría con asiento `UPDATE`/`clientes`, tests unitarios + integración de servicio + HTTP). Incluye un ajuste **aditivo y autorizado** al listener de auditoría compartido (Sección 5.1) y el contrato de consumo de Módulo F documentado como pendiente (Módulo F no existe). Sin migración ni cambio de schema.

## 1. Objetivo

Permitir que un Vendedor o Administrador de CRM registre el **canal de contacto preferido** de un cliente — WhatsApp, Email o Ambos — como atributo simple de `Cliente`, editable en cualquier momento y sin máquina de estados.

**Criterios de aceptación** (fuente: `spec_modulo_C.md §2.3`, líneas 119–161, y §4):

1. `canal_preferido` es un atributo simple de `Cliente` (no una entidad propia), con los tres valores del enum `CanalContacto`: `WHATSAPP`, `EMAIL`, `AMBOS`.
2. Es **editable en cualquier momento** (no hay transición prohibida ni estado terminal).
3. Endpoint `PATCH /api/clientes/[id]/canal-contacto`, permiso `clientes:editar` (reutilizado de HU-C2/C3).
4. Respuesta `200 OK`: `{ data: { cliente_id, canal_preferido }, error: null }`.
5. `null` **no** es un valor de entrada válido: no existe operación de "limpiar el canal".
6. La mutación se cubre bajo el evento `cliente:actualizado` (post-COMMIT); **no** hay evento propio (spec §4, l. 420).
7. El consumo real por el Motor de Notificaciones (Módulo F) queda documentado como integración pendiente — Módulo F no está construido en este sprint (spec §5, l. 431).

**Discrepancias / aclaraciones entre la spec y lo implementado:**

| Punto | Spec §2.3 | Implementación real | Motivo |
|---|---|---|---|
| Estado `null` del campo | La spec no describe explícitamente el `null`; el schema lo declara `CanalContacto?` (nullable, sin default) | `null` es un estado **legible y significativo** ("el cliente nunca eligió"), pero **no escribible** por la API | El `null` existe porque el alta (HU-C1) nunca setea el canal. La entrada solo acepta los 3 valores del enum; no hay operación de limpieza (ver 5.2) |
| Asiento de auditoría de `cliente:actualizado` | §4 define el evento con `{ cliente_id, usuario_id, campos_modificados[], valor_anterior, valor_nuevo }` | HU-C9 necesitó un ajuste **aditivo** al listener porque el handler compartido estaba hardcodeado a `CREATE`/`direcciones_cliente` (correcto para HU-C3) | Hallazgo clave — ver 5.1 |
| Permiso | `clientes:editar` | `clientes:editar` (reutilizado, sin permiso nuevo) | Coincide con §2.3 |

## 2. Modelo de datos involucrado

**Sin cambio de schema.** HU-C9 **no** modifica `prisma/schema.prisma` ni agrega migraciones: `Cliente.canal_preferido CanalContacto?` y el enum `CanalContacto` ya existían. Verificado en `prisma/schema.prisma:1284` (`canal_preferido CanalContacto?`, con el comentario "no se recibe en el alta (HU-C1) y se asume nulo hasta que el Vendedor lo defina") y `:1385` (`enum CanalContacto { WHATSAPP, EMAIL, AMBOS }`).

**`Cliente` — qué escribe HU-C9:**

| Campo | Valor que escribe HU-C9 |
|---|---|
| `canal_preferido` | `input.canal_preferido` (`WHATSAPP` / `EMAIL` / `AMBOS`) |

Es el **único** campo escrito. El service lee `{ id, is_active, canal_preferido }` para resolver el cliente y capturar el valor anterior (`cliente.service.ts:495`).

**Lo que HU-C9 NO toca:** ninguna otra tabla. No crea entidad espejo ni tabla de notificaciones. No borra nada (`delete()`/`deleteMany()` prohibidos).

## 3. Arquitectura de la solución

```
CanalContactoCliente.tsx ──► actualizarCanalContacto() [Server Action] ─┐
   (/clientes/[id])               clientes/actions.ts:120                │
                                                                         ├─► actualizarCanalContacto() [service] ─► prisma.$transaction ─► actualizarCanalContactoTx()
PATCH /api/clientes/[id]/canal-contacto ─────────────────────────────────┘     cliente.service.ts:529                              │   cliente.service.ts:488
   route.ts (withPermission "clientes:editar")                                                                      ┌───────────┴─────────────┐
                                                                                                                    │ findUnique({id})         │
                                                                                                                    │  ├─ no/inactivo → 404    │
                                                                                                                    │  └─ guarda anterior       │
                                                                                                                    │     + update canal        │
                                                                                                                    └──────────────────────────┘
                                                         (post-COMMIT) domainEventBus.emit("cliente:actualizado",
                                                              accion:"UPDATE", tabla_afectada:"clientes", registro_id:clienteId)
                                                                                                                      ▼
                                                                  audit-log.listener.ts:982 → AuditLog (UPDATE, tabla "clientes")
```

Route Handler y Server Action son **wrappers finos**; la lógica vive en `cliente.service.ts`.

### 3.1 Schema Zod — `src/lib/schemas/clientes.schema.ts`

`ActualizarCanalContactoSchema` (`clientes.schema.ts:69`):

| Campo | Validación | Mensaje de error |
|---|---|---|
| `canal_preferido` | `z.enum(["WHATSAPP", "EMAIL", "AMBOS"])` | (error de enum de Zod) |

**Sin `.strict()`** (mismo criterio que `AgregarDireccionClienteSchema`): `cliente_id` no es parte del body; una clave espuria se descarta en silencio. **`null` no es válido**: no existe operación de limpieza (el test unitario lo cubre).

### 3.2 Service — `src/lib/services/clientes/cliente.service.ts`

| Función | Rol | Abre transacción | Emite evento |
|---|---|---|---|
| `actualizarCanalContactoTx(tx, clienteId, input)` (`:488`) | Núcleo reutilizable. `findUnique`; si no existe **o** `!is_active` → `CLIENTE_NO_ENCONTRADO`. Lee el valor anterior y escribe el nuevo **en el mismo `tx`** (para que el anterior auditado no pueda ser pisado por una escritura concurrente). Devuelve `{ anterior, nuevo }`. | No | No |
| `actualizarCanalContacto(clienteId, input, usuarioId)` (`:529`) | Wrapper público. Abre `prisma.$transaction`, delega en el `Tx` y emite `cliente:actualizado` post-COMMIT con `accion:"UPDATE"`/`tabla_afectada:"clientes"`/`registro_id:clienteId`. Devuelve `{ cliente_id, canal_preferido }`. | Sí | Sí |

El contrato de consumo de Módulo F está documentado en el docstring de la sección (`:446`–`:465`).

### 3.3 Endpoint REST — `PATCH /api/clientes/[id]/canal-contacto` (`src/app/api/clientes/[id]/canal-contacto/route.ts`)

Envuelto en `withPermission("clientes:editar", …)`. `STATUS_POR_CODIGO = { CLIENTE_NO_ENCONTRADO: 404 }` (`:29`).

| Status | Cuándo | Body |
|---|---|---|
| `200 OK` | Actualización exitosa | `{ data: { cliente_id, canal_preferido }, error: null }` |
| `400` | Body inválido (valor fuera del enum, `null`, `""`, ausente) | `{ data: null, error: { code: "VALIDATION_ERROR", message, fieldErrors } }` |
| `401` | Sin sesión | (lo resuelve `withPermission`) |
| `403` | Sesión válida sin el permiso | `{ data: null, error: { code: "FORBIDDEN", message } }` |
| `404` | Cliente inexistente **o** inactivo | `{ data: null, error: { code: "CLIENTE_NO_ENCONTRADO", message } }` |
| `500` | Error inesperado | `{ data: null, error: { code: "INTERNAL_ERROR", message } }` |

### 3.4 Server Action — `actualizarCanalContacto(clienteId, input)` (`src/app/(dashboard)/clientes/actions.ts:120`)

Equivalente al endpoint para el formulario. Resuelve sesión (`UNAUTHORIZED`), verifica `clientes:editar` (`FORBIDDEN`), parsea con Zod (`VALIDATION_ERROR`), invoca la misma función del service y hace `revalidatePath("/clientes/${clienteId}")`. `clienteId` viaja como argumento explícito, nunca desde `input`. Devuelve `ActionResult<CanalContactoActualizado>`.

### 3.5 Componente y pantalla

- `src/app/(dashboard)/clientes/[id]/page.tsx` — la ficha lee `canal_preferido` en el `select` (`:65`) y monta `<CanalContactoCliente clienteId={cliente.id} canalPreferido={cliente.canal_preferido} />` (`:106`).
- `src/components/clientes/CanalContactoCliente.tsx` — Client Component. `CanalContactoCliente` (`:84`) monta el `CanalContactoForm` (`:110`), que:
  - **Precarga** el valor actual: `defaultValues = { canal_preferido: canalPreferido ?? "" }` (`:124`).
  - Renderiza una línea de estado visible "Valor guardado: …" y, con `null`, el texto **"Sin definir / no elegido"** (`SIN_DEFINIR`, `:75`). El `<select>` incluye una opción líder `<option value="">Sin definir / no elegido</option>` (`:167`), de modo que **nunca** presenta `WHATSAPP` como si fuera el valor guardado.
  - Enviar el centinela vacío falla el enum de Zod (`VALIDATION_ERROR`), así que el estado "sin definir" jamás se persiste como valor real.
  - Usa un tipo local `FormValues = { canal_preferido: CanalContacto | "" }` con un cast del resolver, porque `""` no es asignable a la unión del enum.
  - Al confirmar hace `form.reset({ canal_preferido: resultado.data.canal_preferido })` y `router.refresh()`.
- **`<select>` nativo** con `selectClassName` (`:64`) — no existe `src/components/ui/select.tsx` (mismo criterio que HU-C3).

## 4. Eventos de dominio y auditoría

| Evento | Emitido por | Cuándo | Payload |
|---|---|---|---|
| `cliente:actualizado` | `actualizarCanalContacto()` (`cliente.service.ts:540`) | Post-COMMIT, fire-and-forget | `{ cliente_id, usuario_id, campos_modificados: ["canal_preferido"], valor_anterior: { canal_preferido: anterior }, valor_nuevo: { canal_preferido: nuevo }, accion: "UPDATE", tabla_afectada: "clientes", registro_id: clienteId }` |

- El payload **no copia `email`/`telefono`** (minimización, spec §4).
- El listener (`audit-log.listener.ts:982`) deriva `accion: "UPDATE"`, `tabla_afectada: "clientes"`, `registro_id: clienteId`; `campos_modificados` se pliega en `valor_nuevo`.
- **No hay evento propio de HU-C9** (spec §4, l. 420: "la actualización del canal de contacto preferido sí se cubre bajo `cliente:actualizado`, no es un evento separado").
- El 404 (cliente inexistente o inactivo) **no emite** asiento: el service lanza antes de escribir.
- Cadena SHA-256 verificada por el endpoint de Módulo D (`POST /api/auditoria/verificar-cadena` → `{"integra":true,"registros_verificados":58}` en el verify #147).

## 5. Decisiones de diseño

### 5.1 El listener compartido estaba hardcodeado — hallazgo clave y fix aditivo

Cuando HU-C9 llegó, el handler de `cliente:actualizado` en `audit-log.listener.ts` (creado por HU-C3) tenía **hardcodeado**:

```ts
accion: "CREATE",
tabla_afectada: "direcciones_cliente",
registro_id: (payload.valor_nuevo?.id as string) ?? payload.cliente_id,
```

Eso era correcto para HU-C3 (alta de una dirección), pero **etiquetaría toda actualización de canal como una creación de dirección**, y pondría un `cliente_id` dentro de un `registro_id` de `direcciones_cliente` — una **referencia forense rota**. El arreglo fue **aditivo y autorizado por un humano**:

- `event-types.ts`: 3 campos **opcionales** en `ClienteActualizadoPayload` (`:821`–`:826`): `accion?: "CREATE" | "UPDATE"`, `tabla_afectada?: string`, `registro_id?: string`.
- `audit-log.listener.ts`: el handler deriva con `??` (`:985`–`:990`):
  ```ts
  accion: payload.accion ?? "CREATE",
  tabla_afectada: payload.tabla_afectada ?? "direcciones_cliente",
  registro_id: payload.registro_id ?? (payload.valor_nuevo?.id as string | undefined) ?? payload.cliente_id,
  ```

**Prueba de no-regresión de HU-C3:** cuando HU-C3 emite el mismo payload que ya emitía (los 3 campos ausentes), los `??` reproducen exactamente `CREATE` / `direcciones_cliente` / `valor_nuevo.id ?? cliente_id` — la fila de C3 queda **byte-idéntica**. La prueba es doble: `test:integration:c9` assertea que la fila de C9 es `UPDATE`/`clientes`/`clienteId` (prueba positiva de que la rama nueva dispara), y `test:integration:c3` sigue asserteando `CREATE`/`direcciones_cliente` (prueba negativa de que C3 no cambió). Ambas corren en el mismo build.

**Deuda operativa:** `event-types.ts` y `audit-log.listener.ts` son archivos compartidos ("hot") de Módulo D. El ajuste fue autorizado explícitamente, pero **el owner de Módulo D debía ser notificado** — la tarea quedó marcada como pendiente en el verify #147 (W-3/E5) y en el archive #148. Sigue pendiente.

### 5.2 `null` es semánticamente significativo y no escribible

El campo es nullable **solo** porque el alta (HU-C1) nunca setea el canal. `null` significa "el cliente nunca eligió" y es un estado de lectura legítimo. La API **no** acepta `null` como entrada: no existe una operación de "limpiar el canal" (spec §2.3, fuera de alcance). Consecuencia de diseño: una vez elegido un canal, no se puede volver a "sin definir" por la API. El selector muestra el estado `null` explícitamente, pero enviar el centinela vacío falla la validación.

### 5.3 Cliente inexistente **o** inactivo ⇒ el mismo `404`

Mismo contrato que HU-C3: `if (!cliente || !cliente.is_active) throw new ServiceError("CLIENTE_NO_ENCONTRADO", …)`. Sin `CLIENTE_INACTIVO` ni `409`, coherente con el contrato global de baja lógica.

### 5.4 Permiso reutilizado `clientes:editar` (no se creó un permiso nuevo)

El canal de contacto es parte de la "ficha editable" del cliente, igual que las direcciones. La spec §2.3 asigna `clientes:editar` a ambos. HU-C9 **no** introdujo un permiso granular propio (a diferencia de HU-C8, cuyo segmento sí tiene permiso separado por decisión de §2.8). Es una decisión de granularidad: editar contacto/direcciones/canal comparten un permiso.

### 5.5 Contrato de consumo de Módulo F — `null` es decisión del consumidor

Documentado en el docstring del service (`cliente.service.ts:455`–`:465`): la fuente **única** es `Cliente.canal_preferido`, leída por `cliente_id` (sin copia ni tabla espejo, para que el cambio de canal no se replique en dos lugares). Los tres valores son `WHATSAPP`/`EMAIL`/`AMBOS`. **El campo puede ser `null`:** el consumidor decide su propio fallback y **NO debe asumir un default** — qué hacer ante `null` es una decisión de producto de Módulo F, no de Módulo C. Módulo F **no** se construye este sprint; el dato se modela y persiste ahora para que ese sprint no requiera refactorizar.

### 5.6 El selector nunca finge un valor guardado

Requisito duro de producto: con `null`, el `<select>` debe arrancar en la opción "Sin definir / no elegido", **nunca** en `WHATSAPP` (la primera opción del enum). Se resolvió con `defaultValues = { canal_preferido: canalPreferido ?? "" }` más la opción líder con `value=""`. La ficha server-rendered lo evidencia: el verify #147 observó `<option value="" selected="">Sin definir / no elegido</option>` y que WhatsApp **no** estaba seleccionado.

### 5.7 `<select>` nativo en vez de un componente `Select` shadcn

`src/components/ui/select.tsx` no existe en el repo; se usó `<select>` nativo con `selectClassName` (mismo criterio que HU-C3, D2).

## 6. RBAC

| Permiso | VENDEDOR | ADMINISTRADOR_CRM | AUDITOR |
|---|:---:|:---:|:---:|
| `clientes:editar` | ✅ | ✅ | ❌ |

- **Capa 1 (REST):** `withPermission("clientes:editar")` → `401` sin sesión, `403` sin permiso. `auditor.seed` tiene `clientes:leer` pero **no** `clientes:editar` → `403`. `cajero.seed` no tiene ningún `clientes:*` → `403`.
- **Capa 2 (Server Action):** sesión + `usuarioTienePermiso(session.userId, PERMISO_EDITAR)`.
- La lectura del canal en la ficha se cubre con `clientes:leer` (gate de la página `/clientes/[id]`).
- `usuarioTienePermiso` es un test exacto de `Permiso.codigo`, sin jerarquía.

## 7. Cómo se validó

**Tests unitarios (corren en `npm test`):**

| Archivo | Qué cubre |
|---|---|
| `src/lib/schemas/canal-contacto.schema.test.ts` | Acepta los 3 valores del enum; rechaza un valor fuera del enum y minúsculas; **`null` inválido**; `cliente_id` espurio se descarta |

**Tests de integración (opt-in por env var, `skip` por diseño si no está seteada):**

| Script | Archivo | Env var | Qué cubre |
|---|---|---|---|
| `npm run test:integration:c9` | `canal-contacto.integration.test.ts` | `HU_C9_INTEGRATION_DATABASE_URL` | (a) `null`→`WHATSAPP` persistido con `valor_anterior:{canal_preferido:null}`; (b) `WHATSAPP`→`AMBOS` (re-edición); (c1/c2) inexistente **e** inactivo → `CLIENTE_NO_ENCONTRADO` sin escritura; (d) asiento `UPDATE`/`clientes`/`registro_id=clienteId` con SHA-256 intacto |
| `npm run test:integration:c9-http` | `canal-contacto.http.integration.test.ts` | `HU_C9_INTEGRATION_BASE_URL` | Contra un servidor real: `401` sin sesión; `403` (`auditor.seed`, `cajero.seed`); `200` con `vendedor.seed` y re-edición; `400` (enum inválido, `null`, `""`, ausente); `404` inexistente e inactivo; HTML SSR de la ficha que precarga el canal actual y muestra "Sin definir / no elegido" |

**Verificado en esta revisión:** `npm test` corre **410 tests, 410 pass, 0 fail, 0 skip**. Los resultados de las suites de integración provienen de los reportes SDD (no los re-ejecuté): verify #147 → `test:integration:c9` 1/1 y `test:integration:c9-http` **11/11** contra un `next start` real; `test:integration:c3` 1/1 (no-regresión).

**Lo que ningún test cubre hoy (gaps honestos del verify #147):**
- La **interacción cliente del selector** en navegador: hidratación, submit → Server Action, `router.refresh()`, el `Alert` de error, el estado "Guardando…". El repo no tiene harness de navegador.
- El **wrapper de la Server Action** no tiene test de runtime propio; su gemelo de ruta sí.
- El **contrato de Módulo F** es solo documentación (no hay consumidor).
- La integridad de la cadena se validó vía el endpoint de Módulo D + SQL, no por recómputo propio del verificador.

**Pitfalls operativos:**
- **Cold-compile:** la suite HTTP debe correr contra `npm start` (o rutas ya compiladas); un `next dev` frío puede tardar ~29s en el primer request y consumir el timeout de 30s.
- **Concurrencia:** `test:integration:c9` assertea un conteo **exacto** de asientos `UPDATE`/`clientes` en la ventana de la corrida. Correrlo **en paralelo con `test:integration:c8`** (que hace lo mismo) inyecta filas de la otra suite y hace fallar a ambas. Deben correrse **secuencialmente**.

## 8. Cómo probar manualmente

1. Levantar el entorno y la seed (`npx prisma db seed`). La seed siembra `vendedor.seed` (rol VENDEDOR, con `clientes:editar`).
2. Iniciar sesión como `vendedor.seed@erp-swat.local` (contraseña `abc123456789`) y abrir la ficha de **Juan Pérez** (`30123456`, id `1a2b3c4d-eeee-4a1a-8a1a-000000000001`). El canal sembrado es **WhatsApp**: la sección debe mostrar "Valor guardado: WhatsApp" con WhatsApp precargado.
3. Cambiar el canal a `Email` o `Ambos` → "Guardar canal". Esperado: `200`, la línea "Valor guardado" se actualiza y el selector conserva el valor.
4. Abrir la ficha de un cliente **sin** canal (por ejemplo, el duplicado sembrado `Juan Perez`, DNI `30987654`, id `1a2b3c4d-eeee-4a1a-8a1a-000000000002` — creado sin `canal_preferido`). Esperado: "Valor guardado: **Sin definir / no elegido**" y el selector arranca en esa opción, **no** en WhatsApp.
5. Intentar enviar la opción "Sin definir / no elegido" → `400 VALIDATION_ERROR` (no se puede "limpiar" el canal).
6. **REST:** `PATCH /api/clientes/<id>/canal-contacto` con `{canal_preferido:"WHATSAPP"}` → `200` con `{cliente_id, canal_preferido}`; con `{"TELEGRAM"}`/`{"canal_preferido":null}` → `400`; con `{}` → `400`; cliente inexistente → `404 CLIENTE_NO_ENCONTRADO`; con `cajero.seed` o `auditor.seed` → `403`.
7. **Auditoría:** verificar en `audit_logs` un asiento `accion=UPDATE`, `tabla_afectada=clientes`, `registro_id=<cliente_id>` con `valor_anterior`/`valor_nuevo` del canal.

## 9. Impacto en otros archivos

| Archivo | Cambio |
|---|---|
| `src/lib/services/clientes/cliente.service.ts` | Se agregaron `actualizarCanalContactoTx`, `actualizarCanalContacto`, `CanalContactoActualizado` + docstring del contrato Módulo F |
| `src/lib/schemas/clientes.schema.ts` | Se agregó `ActualizarCanalContactoSchema` |
| `src/app/api/clientes/[id]/canal-contacto/route.ts` | **Nuevo** — `PATCH` |
| `src/app/(dashboard)/clientes/actions.ts` | Se agregó la Server Action `actualizarCanalContacto` |
| `src/components/clientes/CanalContactoCliente.tsx` | **Nuevo** |
| `src/app/(dashboard)/clientes/[id]/page.tsx` | Se agregó `canal_preferido` al `select` y el montaje del componente |
| `src/lib/events/event-types.ts` | **Compartido (Módulo D):** 3 campos opcionales en `ClienteActualizadoPayload` |
| `src/lib/events/listeners/audit-log.listener.ts` | **Compartido (Módulo D):** el handler `cliente:actualizado` deriva `accion`/`tabla_afectada`/`registro_id` con `??` |
| `package.json` | Scripts `test:integration:c9` y `test:integration:c9-http`; test unitario enumerado en `test` |

**Sin migración y sin cambio de schema.** El único impacto fuera de Módulo C son los dos archivos compartidos de Módulo D, con ajuste **aditivo** (no rompe HU-C3) y **notificación al owner pendiente**.

## 10. Estado actual y pendientes

**Completo y verificable en código:**
- `PATCH /api/clientes/[id]/canal-contacto` con los 3 valores del enum, permiso `clientes:editar`, respuesta `{cliente_id, canal_preferido}`.
- Persistencia transaccional con captura del valor anterior en el mismo `tx`.
- Asiento de auditoría `UPDATE`/`clientes`/`clienteId` con SHA-256 encadenado.
- Ajuste aditivo del listener compartido con **no-regresión de HU-C3 probada** en runtime.
- Sección en la ficha con precarga del valor actual y estado explícito "Sin definir / no elegido".
- Contrato de consumo de Módulo F documentado (fuente única por `cliente_id`; `null` ⇒ el consumidor decide, no asumir default).

**Gaps confirmados:**
- **Notificación al owner de Módulo D pendiente** (W-3/E5): `event-types.ts` y `audit-log.listener.ts` son compartidos y fueron tocados con autorización; el dueño de Módulo D (Agustín) debía ser notificado y no lo fue.
- **La interacción cliente del selector no está automatizada** (hidratación + submit + `router.refresh()`).
- **La Server Action no tiene test de runtime propio** (solo inspección de fuente).
- **El contrato de Módulo F es solo documentación** — no hay consumidor.
- **Concurrencia c8/c9:** correr sus suites en paralelo las hace fallar por el conteo exacto de asientos; deben correrse secuencialmente.

**Pendientes / territorio de otras HUs:**
- Consumo real del canal por Módulo F (Motor de Notificaciones) → diferido (spec §5).
- Operación de "limpiar" el canal a `null` → fuera de alcance.
- Segmentación (HU-C8) y consulta unificada (HU-C7) → HUs hermanas de la misma rama de documentación.
