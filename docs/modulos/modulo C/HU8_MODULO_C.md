# HU-C8 — Segmentación comercial (minorista / mayorista / cliente frecuente)

**Módulo:** C — Gestión de Clientes
**Responsable:** Ramiro V. Castagnaro (Rama) — rama `HU-C8` (PR #183). Verificado en el historial de merges de `develop`.
**Estado:** Implementada (schema Zod, service, ruta REST `PATCH`, Server Action, sección en la ficha, listado con columna de segmento, evento de auditoría con asiento `UPDATE`/`clientes`, tests unitarios + integración de servicio + HTTP). Asignación **manual** (los umbrales de volumen/frecuencia no existen como configuración — spec §5). Con una divergencia explícita respecto del prompt de orquestación: **Módulo B NO consume el segmento hoy** (Sección 1 y 5.3). Sin migración ni cambio de schema ni de seed.

## 1. Objetivo

Permitir que un Vendedor o Administrador de CRM clasifique comercialmente a un cliente como **Minorista**, **Mayorista** o **Cliente frecuente**, mediante una reasignación manual y granular (permiso propio), sin efectos colaterales sobre otras entidades del cliente.

**Criterios de aceptación** (fuente: `spec_modulo_C.md §2.8`, líneas 309–334):

1. `segmento` es un atributo simple de `Cliente` (`SegmentoComercial`), con los tres valores `MINORISTA`, `MAYORISTA`, `CLIENTE_FRECUENTE`.
2. `MINORISTA` es el **default** de todo cliente recién dado de alta, por default de columna — **sin** requerir una llamada explícita a este endpoint.
3. `MAYORISTA` habilitará condiciones de precio y plan de pagos de Módulo B; `CLIENTE_FRECUENTE` habilitará promociones, **sin alterar** el límite de crédito de la cuenta corriente.
4. Un cliente puede migrar de segmento en cualquier momento, sin perder historial de compras ni cuenta corriente; **no** hay tratamiento diferenciado de datos personales ni restricción de catálogo.
5. Endpoint `PATCH /api/clientes/[id]/segmento`, permiso **`clientes:gestionar_segmento`** — distinto de `clientes:editar` (partición deliberada de RBAC de §2.8).
6. Respuesta `200 OK`: `{ data: { cliente_id, segmento_anterior, segmento_nuevo }, error: null }`.
7. La asignación es **manual**: los umbrales de volumen/frecuencia **no existen** como entidad de configuración parametrizable (spec §5, l. 434), por lo que no hay cálculo automático ni disparo por eventos de venta.
8. La mutación se cubre bajo `cliente:actualizado` (post-COMMIT).

**Discrepancia entre el prompt de orquestación y el código (importante):**

| Punto | Afirmación del prompt | Realidad verificada en código | Consecuencia |
|---|---|---|---|
| Consumo por Módulo B | "Módulo B ya consume el segmento (consumidor real, ya construido)" | **FALSO.** Cero referencias a `segmento` / `MAYORISTA` / `CLIENTE_FRECUENTE` en `src/lib/services/ventas/**`, `src/app/api/ventas/**` y `src/components/ventas/**` (verificado con búsqueda recursiva) | El contrato de consumo se documenta como **FUTURO/pendiente**, no como existente. Ver 5.3 |

La spec §2.8 es explícita en que la asignación es manual en este sprint "independientemente de que Módulo B ya exista como consumidor" (l. 326) — pero el código muestra que Módulo B todavía **no** lee el segmento.

## 2. Modelo de datos involucrado

**Sin cambio de schema.** HU-C8 **no** modifica `prisma/schema.prisma`, no agrega migraciones y **no toca `seed.ts`**: `Cliente.segmento SegmentoComercial @default(MINORISTA)` y el enum `SegmentoComercial` ya existían. Verificado en `prisma/schema.prisma:1285` (`segmento SegmentoComercial @default(MINORISTA)`) y `:1376` (`enum SegmentoComercial { MINORISTA, MAYORISTA, CLIENTE_FRECUENTE }`). La columna es `NOT NULL DEFAULT 'MINORISTA'`.

**`Cliente` — qué escribe HU-C8:**

| Campo | Valor que escribe HU-C8 |
|---|---|
| `segmento` | `input.segmento` (`MINORISTA` / `MAYORISTA` / `CLIENTE_FRECUENTE`) |

Es el **único** campo escrito. El service lee `{ id, is_active, segmento }` para resolver el cliente y capturar el valor anterior (`cliente.service.ts:624`).

**Lo que HU-C8 NO toca:** `CuentaCorrienteCliente` (ni su límite de crédito), `PedidoVenta`/`Presupuesto`, `ConsentimientoCliente`, catálogo, ni ninguna otra tabla. Es una invariante explícita (Sección 5.4).

## 3. Arquitectura de la solución

```
SegmentoCliente.tsx ──► actualizarSegmentoCliente() [Server Action] ─┐
   (/clientes/[id])            clientes/actions.ts:158                │
                                                                      ├─► actualizarSegmentoCliente() [service] ─► prisma.$transaction ─► actualizarSegmentoClienteTx()
PATCH /api/clientes/[id]/segmento ────────────────────────────────────┘     cliente.service.ts:657                               │   cliente.service.ts:617
   route.ts (withPermission "clientes:gestionar_segmento")                                                       ┌────────────┴────────────┐
                                                                                                                 │ findUnique({id})          │
                                                                                                                 │  ├─ no/inactivo → 404     │
                                                                                                                 │  └─ guarda anterior        │
                                                                                                                 │     + update segmento      │
                                                                                                                 └───────────────────────────┘
                                                         (post-COMMIT) domainEventBus.emit("cliente:actualizado",
                                                              accion:"UPDATE", tabla_afectada:"clientes", registro_id:clienteId)
                                                                                                                       ▼
                                                                   audit-log.listener.ts:982 → AuditLog (UPDATE, tabla "clientes")
```

Route Handler y Server Action son **wrappers finos**; la lógica vive en `cliente.service.ts`.

### 3.1 Schema Zod — `src/lib/schemas/clientes.schema.ts`

`ActualizarSegmentoClienteSchema` (`clientes.schema.ts:93`):

| Campo | Validación | Mensaje de error |
|---|---|---|
| `segmento` | `z.enum(["MINORISTA", "MAYORISTA", "CLIENTE_FRECUENTE"])` | (error de enum de Zod) |

**Sin `.strict()`** (mismo criterio que los schemas hermanos): `cliente_id` no es parte del body; una clave espuria se descarta en silencio. `null`, `undefined` y campo ausente son inválidos (el test unitario lo cubre).

### 3.2 Service — `src/lib/services/clientes/cliente.service.ts`

| Función | Rol | Abre transacción | Emite evento |
|---|---|---|---|
| `actualizarSegmentoClienteTx(tx, clienteId, input)` (`:617`) | Núcleo reutilizable. `findUnique`; si no existe **o** `!is_active` → `CLIENTE_NO_ENCONTRADO`. Lee el valor anterior y escribe el nuevo **en el mismo `tx`**. Devuelve `{ anterior, nuevo }`. | No | No |
| `actualizarSegmentoCliente(clienteId, input, usuarioId)` (`:657`) | Wrapper público. Abre `prisma.$transaction`, delega en el `Tx` y emite `cliente:actualizado` post-COMMIT con `accion:"UPDATE"`/`tabla_afectada:"clientes"`/`registro_id:clienteId`. Devuelve `{ cliente_id, segmento_anterior, segmento_nuevo }`. | Sí | Sí |

`PERMISO_GESTIONAR_SEGMENTO = "clientes:gestionar_segmento"` (`:594`) — constante propia, **distinta** de `PERMISO_EDITAR`. El contrato de consumo futuro de Módulo B está documentado en el docstring de la sección (`:574`–`:586`).

### 3.3 Endpoint REST — `PATCH /api/clientes/[id]/segmento` (`src/app/api/clientes/[id]/segmento/route.ts`)

Envuelto en `withPermission("clientes:gestionar_segmento", …)` (`:41`). `STATUS_POR_CODIGO = { CLIENTE_NO_ENCONTRADO: 404 }` (`:33`).

| Status | Cuándo | Body |
|---|---|---|
| `200 OK` | Reasignación exitosa | `{ data: { cliente_id, segmento_anterior, segmento_nuevo }, error: null }` |
| `400` | Body inválido (valor fuera del enum, `null`, `""`, ausente) | `{ data: null, error: { code: "VALIDATION_ERROR", message, fieldErrors } }` |
| `401` | Sin sesión | (lo resuelve `withPermission`) |
| `403` | Sesión válida sin `clientes:gestionar_segmento` | `{ data: null, error: { code: "FORBIDDEN", message } }` |
| `404` | Cliente inexistente **o** inactivo | `{ data: null, error: { code: "CLIENTE_NO_ENCONTRADO", message } }` |
| `500` | Error inesperado | `{ data: null, error: { code: "INTERNAL_ERROR", message } }` |

**El shape de respuesta es el de la spec §2.8 (l. 333):** `{ cliente_id, segmento_anterior, segmento_nuevo }` — **no** `{ cliente_id, segmento }`.

### 3.4 Server Action — `actualizarSegmentoCliente(clienteId, input)` (`src/app/(dashboard)/clientes/actions.ts:158`)

Equivalente al endpoint para el formulario. Resuelve sesión (`UNAUTHORIZED`), verifica **`clientes:gestionar_segmento`** (`FORBIDDEN` — no `clientes:editar`), parsea con Zod (`VALIDATION_ERROR`), invoca la misma función del service y hace `revalidatePath("/clientes/${clienteId}")`. `clienteId` viaja como argumento explícito. Devuelve `ActionResult<SegmentoActualizado>`.

### 3.5 Componente y pantalla

- `src/app/(dashboard)/clientes/[id]/page.tsx` — la ficha lee `segmento` en el `select` (`:65`) y monta `<SegmentoCliente clienteId={cliente.id} segmento={cliente.segmento} />` (`:111`).
- `src/components/clientes/SegmentoCliente.tsx` — Client Component. `SegmentoCliente` (`:75`) monta el `SegmentoForm` (`:101`), que:
  - **Precarga** el valor actual: `defaultValues = { segmento }` (`:115`). **No hay centinela `""`** porque `segmento` es `NOT NULL` con default — el selector siempre arranca con un valor real.
  - Renderiza la línea "Valor actual: …" con la etiqueta del segmento.
  - Al confirmar hace `form.reset({ segmento: resultado.data.segmento_nuevo })` y `router.refresh()`.
- `src/components/clientes/TablaClientes.tsx` — el listado `/clientes` ya renderiza la columna **Segmento** (`:62` encabezado, `:97` celda con `SEGMENTO_LABEL[cliente.segmento]`).
- **`<select>` nativo** con `selectClassName` (`:58`) — no existe `src/components/ui/select.tsx`.

## 4. Eventos de dominio y auditoría

| Evento | Emitido por | Cuándo | Payload |
|---|---|---|---|
| `cliente:actualizado` | `actualizarSegmentoCliente()` (`cliente.service.ts:668`) | Post-COMMIT, fire-and-forget | `{ cliente_id, usuario_id, campos_modificados: ["segmento"], valor_anterior: { segmento: anterior }, valor_nuevo: { segmento: nuevo }, accion: "UPDATE", tabla_afectada: "clientes", registro_id: clienteId }` |

- El payload **no copia `email`/`telefono`** (minimización).
- El listener (`audit-log.listener.ts:982`) deriva `accion: "UPDATE"`, `tabla_afectada: "clientes"`, `registro_id: clienteId`; `campos_modificados` se pliega en `valor_nuevo`.
- **HU-C8 no toca `event-types.ts` ni `audit-log.listener.ts`:** solo emite el evento `cliente:actualizado` que ya existía y ya tenía los campos opcionales (agregados por HU-C9). Verificado: `git diff develop` de `src/lib/events/` vacío.
- El 404 **no emite** asiento.
- Cadena SHA-256 verificada por el endpoint de Módulo D (`{"integra":true,"registros_verificados":106}` en el verify #159).

## 5. Decisiones de diseño

### 5.1 Permiso granular separado `clientes:gestionar_segmento` — el punto central de la HU

La spec §2.8 (l. 313–315) modela "Gestionar segmentación comercial y direcciones de un cliente" como una única fila de matriz RBAC, pero **decide implementarla como dos permisos granulares distintos**: `clientes:gestionar_segmento` para el segmento y `clientes:editar` para direcciones/canal. Los dos roles habilitados (Vendedor, Administrador de CRM) son idénticos, así que **no hay divergencia de quién puede hacer qué** — es una decisión de granularidad que permite revocar acceso a uno de los dos sin afectar el otro.

Esto se probó **en vivo** (verify #159): un principal temporal con **solo `clientes:editar`** recibió `200` en `PATCH .../canal-contacto` pero **`403 FORBIDDEN`** en `PATCH .../segmento`, con la base sin cambios. `usuarioTienePermiso` es un test exacto de `Permiso.codigo` sin jerarquía ni implicación, y tanto la ruta como la Server Action importan `PERMISO_GESTIONAR_SEGMENTO` — nunca `PERMISO_EDITAR`.

### 5.2 Shape de respuesta `{ segmento_anterior, segmento_nuevo }` — no `{ cliente_id, segmento }`

La spec §2.8 fija el shape con el valor **anterior y nuevo** (l. 333), a diferencia del canal de contacto (HU-C9) que solo devuelve el nuevo. Se respetó literalmente: el service captura el anterior en el mismo `tx` para que no pueda ser pisado por una escritura concurrente y lo devuelve junto con el nuevo.

### 5.3 Asignación manual, sin umbrales configurables — y Módulo B todavía no consume

Los umbrales de volumen/frecuencia que dispararían la asignación automática **no existen** como entidad de configuración parametrizable (spec §5, l. 434). Por eso:
- No hay tabla/entidad de configuración de umbrales.
- No hay cálculo automático ni disparo por eventos de venta.
- La asignación queda 100% en manos del usuario vía este endpoint.
- El default reside en la columna DB: el alta (HU-C1) nunca escribe `segmento` explícitamente.

**Cuando en el futuro se construya esa entidad de configuración, la automatización se puede agregar SIN refactor de este endpoint:** la escritura sigue siendo un `UPDATE` de `Cliente.segmento`.

**Módulo B NO consume el segmento hoy.** Verificado: cero referencias a `segmento`/`MAYORISTA`/`CLIENTE_FRECUENTE` en `src/lib/services/ventas/**`, `src/app/api/ventas/**`, `src/components/ventas/**`. El contrato se documenta como **futuro**: cuando Módulo B lo consuma, **debe** leerlo por `cliente_id` desde la fuente única `Cliente.segmento` (sin copia ni campo duplicado).

### 5.4 Invariante de cero efectos colaterales

Cambiar el segmento **no** toca:
- `CuentaCorrienteCliente` (ni su límite de crédito autorizado ni su saldo).
- `PedidoVenta` / `Presupuesto` (historial de compras intacto).
- El tratamiento de datos personales (consentimiento).
- El catálogo.

Esto se verificó en runtime (verify #159) con un probe independiente: un cliente con `CuentaCorrienteCliente` (`limite_credito_autorizado=1234.56`, `saldo_actual=100`) y un `ConsentimientoCliente` pasó de `MINORISTA` a `MAYORISTA` dejando el límite, el saldo, el `updated_at` de la CC y el consentimiento **byte-idénticos**. Está corroborado estáticamente: toda la adición de 129 líneas hace solo `tx.cliente.findUnique` + `tx.cliente.update({ data: { segmento } })`.

### 5.5 Cliente inexistente **o** inactivo ⇒ el mismo `404`

Mismo contrato que HU-C3/HU-C9: `if (!cliente || !cliente.is_active) throw new ServiceError("CLIENTE_NO_ENCONTRADO", …)`. Sin `CLIENTE_INACTIVO` ni `409`.

### 5.6 El selector precarga el valor actual y no tiene centinela vacío

A diferencia de HU-C9 (canal nullable), `segmento` es `NOT NULL` con default: **no existe estado vacío**. El selector siempre tiene un valor real y precargado (`FormValues = { segmento: SegmentoComercial }`), de modo que nunca arranca en la primera opción fingiendo ser el valor guardado. La operación es "reasignar", no "limpiar".

### 5.7 `<select>` nativo en vez de un componente `Select` shadcn

`src/components/ui/select.tsx` no existe; se usó `<select>` nativo con `selectClassName` (mismo criterio que HU-C3 y HU-C9).

## 6. RBAC

| Permiso | VENDEDOR | ADMINISTRADOR_CRM | AUDITOR |
|---|:---:|:---:|:---:|
| `clientes:gestionar_segmento` | ✅ | ✅ | ❌ |
| `clientes:leer` (lectura de la ficha) | ✅ | ✅ | ✅ |

- **Capa 1 (REST):** `withPermission("clientes:gestionar_segmento")` → `401` sin sesión, `403` sin permiso. `auditor.seed` tiene `clientes:leer` pero **no** `clientes:gestionar_segmento` → `403`.
- **Capa 2 (Server Action):** sesión + `usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_SEGMENTO)`.
- La partición respecto de `clientes:editar` se probó en vivo (Sección 5.1). La seed asigna `gestionar_segmento` a VENDEDOR y ADMINISTRADOR_CRM (`prisma/seed.ts:1529`, `:1547`); AUDITOR solo recibe `clientes:leer` + `auditoria:leer_historico` (`:1559`).

## 7. Cómo se validó

**Tests unitarios (corren en `npm test`):**

| Archivo | Qué cubre |
|---|---|
| `src/lib/schemas/segmento-cliente.schema.test.ts` | Acepta los 3 valores del enum; rechaza valor fuera del enum y minúsculas; `null`/`undefined`/ausente inválidos; `cliente_id` espurio se descarta |

**Tests de integración (opt-in por env var, `skip` por diseño si no está seteada):**

| Script | Archivo | Env var | Qué cubre |
|---|---|---|---|
| `npm run test:integration:c8` | `segmento-cliente.integration.test.ts` | `HU_C8_INTEGRATION_DATABASE_URL` | (a) un cliente recién creado nace `MINORISTA` por default de columna, sin llamar al endpoint; (b) `MINORISTA`→`MAYORISTA` con shape `{cliente_id, segmento_anterior, segmento_nuevo}`; (c) `MAYORISTA`→`CLIENTE_FRECUENTE`; (d1/d2) inexistente **e** inactivo → `CLIENTE_NO_ENCONTRADO` sin escritura; (e) asiento `UPDATE`/`clientes`/`registro_id=clienteId` con SHA-256 encadenado |
| `npm run test:integration:c8-http` | `segmento-cliente.http.integration.test.ts` | `HU_C8_INTEGRATION_BASE_URL` | Contra un servidor real: `401` sin sesión; `403` (`auditor.seed`); `200` con `vendedor.seed` y re-edición; `400` (enum inválido, `null`, `""`, ausente); `404` inexistente e inactivo; HTML SSR de la ficha que precarga el segmento actual |

**Verificado en esta revisión:** `npm test` corre **410 tests, 410 pass, 0 fail, 0 skip**. Los resultados de las suites de integración provienen de los reportes SDD (no los re-ejecuté): verify #159 → `test:integration:c8` 1/1, `test:integration:c8-http` **9/9** contra un `next start` real, y no-regresión de hermanas `c3` 1/1 y `c9` 1/1.

**Lo que ningún test cubre hoy (gaps honestos del verify #159):**
- **E-1/W-1** — el submit del formulario cliente en navegador (hidratación, Server Action, `router.refresh()`, `Alert` de error) no está automatizado.
- **E-2/W-3** — la invariante de cero efectos colaterales (R8) **no tiene guard automatizado en el repo**; se probó solo con un probe de runtime del verificador. Nada en `npm test` detectaría una regresión futura que tocara `CuentaCorrienteCliente`.
- **E-3** — la ausencia de asignación automática (R6) descansa en evidencia estática (cero referencias en Módulo B); ningún test crea un `PedidoVenta` de gran volumen y relee el segmento.
- **E-4** — la secuencia literal `FREQ→MAY→MIN` no se corrió (las transiciones libres se prueban con `MIN→MAY→FREQ` + reediciones).
- **E-5** — `fieldErrors` se probó en el borde del schema, no asserteando el body HTTP del `400`.

**Pitfalls operativos:**
- **Cold-compile:** la suite HTTP debe correr contra `npm start` (o rutas ya compiladas); un `next dev` frío puede tardar ~29s y consumir el timeout de 30s.
- **Concurrencia:** `test:integration:c8` assertea un conteo **exacto** de asientos `UPDATE`/`clientes` en la ventana de la corrida (líneas 237–241). Correrlo **en paralelo con `test:integration:c9`** (que hace lo mismo) inyecta filas de la otra suite y hace fallar a ambas. Deben correrse **secuencialmente**.

## 8. Cómo probar manualmente

1. Levantar el entorno y la seed (`npx prisma db seed`). La seed siembra `vendedor.seed` (rol VENDEDOR, con `clientes:gestionar_segmento`).
2. Iniciar sesión como `vendedor.seed@erp-swat.local` (contraseña `abc123456789`) y abrir `/clientes`. La columna **Segmento** debe mostrar "Minorista" para los clientes sembrados.
3. Entrar a la ficha de **Juan Pérez** (`30123456`, id `1a2b3c4d-eeee-4a1a-8a1a-000000000001`). La sección "Segmento comercial" debe mostrar "Valor actual: Minorista" con Minorista precargado.
4. Cambiar a `Mayorista` → "Guardar segmento". Esperado: `200` con `segmento_anterior: MINORISTA` / `segmento_nuevo: MAYORISTA`; la ficha y el listado reflejan el cambio.
5. Reasignar a `Cliente frecuente` y de vuelta a `Minorista` — sin restricciones de transición.
6. **Invariante:** si el cliente tuviera cuenta corriente, verificar que el cambio de segmento **no** alteró su límite ni saldo.
7. **REST:** `PATCH /api/clientes/<id>/segmento` con `{segmento:"MAYORISTA"}` → `200`; con `{"VIP"}`/`{segmento:null}`/`{}` → `400`; cliente inexistente → `404`; con `auditor.seed` (tiene `clientes:leer`, no `gestionar_segmento`) → `403`; con `vendedor.seed` → `200`.
8. **Auditoría:** verificar en `audit_logs` un asiento `accion=UPDATE`, `tabla_afectada=clientes`, `registro_id=<cliente_id>` con `valor_anterior`/`valor_nuevo` del segmento.

## 9. Impacto en otros archivos

| Archivo | Cambio |
|---|---|
| `src/lib/services/clientes/cliente.service.ts` | Se agregaron `PERMISO_GESTIONAR_SEGMENTO`, `actualizarSegmentoClienteTx`, `actualizarSegmentoCliente`, `SegmentoActualizado` + docstring del contrato de Módulo B |
| `src/lib/schemas/clientes.schema.ts` | Se agregó `ActualizarSegmentoClienteSchema` |
| `src/app/api/clientes/[id]/segmento/route.ts` | **Nuevo** — `PATCH` |
| `src/app/(dashboard)/clientes/actions.ts` | Se agregó la Server Action `actualizarSegmentoCliente` |
| `src/components/clientes/SegmentoCliente.tsx` | **Nuevo** |
| `src/app/(dashboard)/clientes/[id]/page.tsx` | Se agregó `segmento` al `select` y el montaje del componente |
| `package.json` | Scripts `test:integration:c8` y `test:integration:c8-http`; test unitario enumerado en `test` |

**Sin migración, sin cambio de schema y sin cambio de `seed.ts`.** **No** se tocaron `event-types.ts` ni `audit-log.listener.ts` (HU-C8 solo emite un evento existente).

## 10. Estado actual y pendientes

**Completo y verificable en código:**
- `PATCH /api/clientes/[id]/segmento` con los 3 valores del enum, permiso **propio** `clientes:gestionar_segmento`, respuesta `{cliente_id, segmento_anterior, segmento_nuevo}`.
- Default `MINORISTA` por columna (alta sin llamada al endpoint).
- Transiciones libres, sin máquina de estados.
- Persistencia transaccional con captura del valor anterior en el mismo `tx`.
- Asiento de auditoría `UPDATE`/`clientes`/`clienteId` con SHA-256 encadenado.
- Partición de RBAC respecto de `clientes:editar` probada en vivo.
- Invariante de cero efectos colaterales verificada en runtime.
- Sección en la ficha con precarga y columna de segmento en el listado.

**Gaps confirmados:**
- **La invariante de cero efectos colaterales no tiene guard automatizado en el repo** (E-2/W-3): se probó con un probe de runtime, no con un test de la suite.
- **La ausencia de asignación automática descansa en evidencia estática** (E-3).
- **El submit del formulario cliente no está automatizado** (E-1/W-1).
- **Concurrencia c8/c9:** correr sus suites en paralelo las hace fallar por el conteo exacto de asientos; deben correrse secuencialmente.

**Pendientes / territorio de otras HUs:**
- **Automatización del segmento por umbrales** → requiere primero la entidad de configuración global que **no existe** (spec §5, l. 434). Cuando se construya, la automatización se agrega sin refactor de este endpoint.
- **Consumo real por Módulo B** (condiciones de precio / plan de pagos) → **futuro**: hoy Módulo B tiene cero referencias al segmento. Cuando lo consuma, debe leerlo por `cliente_id` desde `Cliente.segmento`.
- **Consumo por Módulo E** (promociones de cliente frecuente) → diferido.
- `CuentaCorrienteCliente` es propiedad de Módulo B; HU-C8 **no** la toca.
