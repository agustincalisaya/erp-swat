# HU-C3 — Registrar más de una dirección (facturación y envío) de un cliente

**Módulo:** C — Gestión de Clientes
**Responsable:** Ramiro V. Castagnaro (Rama) — rama `HU-C3` (PR #175 y PR #179; ajuste posterior en PR #181, `fix/flujo-clientes`). Verificado en el historial de merges de `develop`.
**Estado:** Implementada (schema Zod, service, ruta REST `POST`/`GET`, Server Action, ficha `/clientes/[id]`, evento de auditoría, tests unitarios y de integración + suite HTTP). Con dos desviaciones de diseño documentadas (D1, D2 — Sección 5), una divergencia entre el prompt de orquestación y el código (el evento `cliente:actualizado` NO existía y fue agregado por esta HU — Sección 5.4) y una divergencia de permiso del listado respecto de la línea única de la spec (Sección 1). Sin migración ni cambio de schema.

## 1. Objetivo

Permitir que un cliente registre **más de una dirección**, cada una identificada por un `rotulo` libre y clasificada por `tipo` (`FACTURACION` o `ENVIO`), y garantizar la **regla estructural de obligatoriedad de facturación**: si el cliente registra al menos una dirección, debe existir entre ellas una de tipo `FACTURACION`.

**Criterios de aceptación** (fuente: `spec_modulo_C.md §2.3`, líneas 119–161):

1. Un cliente puede registrar más de una dirección, cada una con `rotulo` libre (ej. "Casa", "Depósito", "Sucursal 2") y `tipo` (`FACTURACION` / `ENVIO`). Las de tipo `ENVIO` son opcionales y **sin límite de cantidad**.
2. **Obligatoriedad de `FACTURACION`:** si el cliente registra al menos una dirección, debe existir una de tipo `FACTURACION`. Cargar una `ENVIO` como única dirección, sin ninguna `FACTURACION` **activa** previa, se rechaza con **`422 DIRECCION_FACTURACION_REQUERIDA`** y **cero escrituras**.
3. La obligatoriedad es **puramente estructural**: no depende de condición fiscal, IVA, CUIT ni de ningún dato del organismo (directiva del PO — no reintroducir). Un cliente **sin** direcciones no está obligado a tener una.
4. El alta usa permiso `clientes:editar`; el listado usa `clientes:leer`.
5. El listado se filtra por `is_active = true`, salvo consulta de Auditoría.
6. Respuesta `201 Created` del alta: `{ data: { direccion_id, rotulo, tipo }, error: null }`.
7. La mutación emite `cliente:actualizado` **post-COMMIT** (spec §3.3/§4).
8. `TipoDireccionCliente` es el enum ya fijado en `schema.prisma`; nunca se renombra ni se reemplaza por un enum propio.

**Discrepancias entre la spec y lo implementado, documentadas explícitamente:**

| Punto | Spec §2.3 | Implementación real | Motivo |
|---|---|---|---|
| Permiso del listado (`GET`) | La línea "Permiso requerido" (l. 125) nombra solo `clientes:editar` | `POST` usa `clientes:editar`; `GET` usa **`clientes:leer`** | Leer direcciones es una consulta, no una edición; `clientes:leer` ya existía como permiso de lectura de la ficha (§2.7). La spec no detalla el permiso del `GET` por separado. Ver 5.3 |
| Evento `cliente:actualizado` | La tabla §4 (l. 412) lo lista como si ya existiera para `2.2/2.3/2.8` | **No existía antes de HU-C3.** Esta HU creó el payload (`ClienteActualizadoPayload`), su entrada en `DomainEventMap` y un handler **nuevo** en `audit-log.listener.ts` | El prompt de orquestación asumía que ya existía; el código no lo tenía. Ver 5.4 |
| Valor de `campos_modificados` | §4 exige `campos_modificados[]` pero no fija el string | Se emite `["direcciones"]` (el design proponía `["direccion_creada"]`) | Micro-desviación D3, behavior-preserving. El test de integración lo assertea |

## 2. Modelo de datos involucrado

Esta sección cubre **solo lo que HU-C3 efectivamente toca**.

**Sin cambio de schema.** HU-C3 **no** modifica `prisma/schema.prisma` ni agrega migraciones: `DireccionCliente` y el enum `TipoDireccionCliente` ya existían (el modelo es compartido y no se reinventa). Lo verifiqué leyendo `prisma/schema.prisma:1320` (`model DireccionCliente`) y `:1395` (`enum TipoDireccionCliente { FACTURACION, ENVIO }`).

**`DireccionCliente` — qué escribe el alta:**

| Campo | Valor que escribe HU-C3 |
|---|---|
| `cliente_id` | El `[id]` del **path** de la ruta (jamás del body) |
| `rotulo` | `input.rotulo` |
| `tipo` | `input.tipo` (`FACTURACION` / `ENVIO`) |
| `direccion_completa` | `input.direccion_completa` |
| `is_active` | No se envía: nace `true` por default de schema |
| `deleted_*` | No se envían: quedan `null` |

**`DireccionCliente` — qué lee el listado** (`select` de `listarDireccionesCliente`, `cliente.service.ts:386`): `id`, `rotulo`, `tipo`, `direccion_completa`, `is_active`, `created_at`. Orden `created_at asc`.

**`Cliente` — qué lee HU-C3:** solo `{ id, is_active }` para el chequeo de existencia/estado (`cliente.service.ts:286`). **No escribe ningún campo de `Cliente`.**

**Lo que HU-C3 NO toca:** `Cliente` (ninguna escritura), `ConsentimientoCliente`, ni ninguna otra tabla. La baja lógica de una dirección está fuera de alcance.

## 3. Arquitectura de la solución

```
FormularioDireccion.tsx ──► agregarDireccionCliente() [Server Action] ─┐
   (DireccionesCliente)          clientes/actions.ts:82                 │
                                                                        ├─► agregarDireccionCliente() [service] ─► prisma.$transaction ─► agregarDireccionClienteTx()
POST /api/clientes/[id]/direcciones ────────────────────────────────────┘     cliente.service.ts:332                                │   cliente.service.ts:281
   route.ts (withPermission "clientes:editar")                                                                        ┌───────────┴────────────┐
                                                                                                                      │ findUnique({id})        │
GET /api/clientes/[id]/direcciones ─► listarDireccionesCliente()  ◄── listado RSC                                     │  ├─ no/inactivo → 404   │
   route.ts (withPermission "clientes:leer")                                                                          │  └─ tipo ENVIO → count   │
                                                                                                                      │        FACTURACION activa│
                                                                                                                      │        ├─ 0 → 422 (cero   │
                                                                                                                      │        │      escrituras) │
                                                                                                                      │        └─ ≥1 → create     │
                                                                                                                      └─────────────────────────┘
                                                         (post-COMMIT) domainEventBus.emit("cliente:actualizado")
                                                                                                                      ▼
                                                                  audit-log.listener.ts:982 → AuditLog (CREATE, tabla "direcciones_cliente")
```

Se mantiene la regla del proyecto: el Route Handler y la Server Action son **wrappers finos**; toda la lógica de negocio vive en `cliente.service.ts` (y en la regla pura `direccion-cliente.reglas.ts`, Sección 5.1).

### 3.1 Schema Zod — `src/lib/schemas/clientes.schema.ts`

`AgregarDireccionClienteSchema` (`clientes.schema.ts:44`):

| Campo | Validación | Mensaje de error |
|---|---|---|
| `rotulo` | `z.string().min(1)` | "El rótulo es obligatorio (ej. 'Casa', 'Depósito')" |
| `tipo` | `z.enum(["FACTURACION", "ENVIO"])` | (error de enum de Zod) |
| `direccion_completa` | `z.string().min(5)` | "La dirección es obligatoria" |

**Sin `.strict()` a propósito** (spec §2.3): `cliente_id` **no** es parte del contrato de entrada. Como Zod no es estricto por defecto, una clave `cliente_id` espuria en el body se **descarta en silencio** en lugar de rechazar el request. El servicio jamás lee `cliente_id` del input parseado.

### 3.2 Service — `src/lib/services/clientes/cliente.service.ts`

| Función | Rol | Abre transacción | Emite evento |
|---|---|---|---|
| `agregarDireccionClienteTx(tx, clienteId, input)` (`:281`) | Núcleo reutilizable. `findUnique` del cliente; si no existe **o** `!is_active` → `CLIENTE_NO_ENCONTRADO`. Si `tipo === "ENVIO"`, `count` (solo lectura) de `FACTURACION` activas y aplica `validarReglaDireccionEnvio` **antes** del `create`. Devuelve `{ direccion }`. | No | No |
| `agregarDireccionCliente(clienteId, input, usuarioId)` (`:332`) | Wrapper público. Abre `prisma.$transaction`, delega en el `Tx` y emite `cliente:actualizado` post-COMMIT. Devuelve `{ direccion_id, rotulo, tipo }`. | Sí | Sí |
| `listarDireccionesCliente(clienteId, options)` (`:377`) | Listado solo-lectura. `is_active = true` por defecto; `incluirInactivas: true` es el bypass de Auditoría. `orderBy created_at asc`. | No | No |

`validarReglaDireccionEnvio(tipo, hayFacturacionActiva)` vive en un módulo puro aparte (`direccion-cliente.reglas.ts:45`) — ver 5.1.

### 3.3 Endpoint REST — `src/app/api/clientes/[id]/direcciones/route.ts`

`POST` envuelto en `withPermission("clientes:editar", …)`; `GET` en `withPermission("clientes:leer", …)`. `STATUS_POR_CODIGO = { CLIENTE_NO_ENCONTRADO: 404, DIRECCION_FACTURACION_REQUERIDA: 422 }` (`:39`).

| Status | Cuándo | Body |
|---|---|---|
| `201 Created` | Alta exitosa | `{ data: { direccion_id, rotulo, tipo }, error: null }` |
| `400` | Body inválido | `{ data: null, error: { code: "VALIDATION_ERROR", message, fieldErrors } }` |
| `401` | Sin sesión | (lo resuelve `withPermission`) |
| `403` | Sesión válida sin el permiso | `{ data: null, error: { code: "FORBIDDEN", message } }` |
| `404` | Cliente inexistente **o** inactivo | `{ data: null, error: { code: "CLIENTE_NO_ENCONTRADO", message } }` |
| `422` | `ENVIO` sin `FACTURACION` activa previa | `{ data: null, error: { code: "DIRECCION_FACTURACION_REQUERIDA", message } }` |
| `500` | Error inesperado | `{ data: null, error: { code: "INTERNAL_ERROR", message } }` |

El `GET` devuelve `{ data: { direcciones: [...] }, error: null }` y habilita `incluirInactivas` solo si el usuario tiene `auditoria:leer_forense` (`route.ts:90`).

### 3.4 Server Action — `agregarDireccionCliente(clienteId, input)` (`src/app/(dashboard)/clientes/actions.ts:82`)

Equivalente al endpoint para el formulario. Resuelve sesión (`UNAUTHORIZED`), verifica `clientes:editar` (`FORBIDDEN`), parsea con Zod (`VALIDATION_ERROR`), invoca **la misma** `agregarDireccionCliente()` del service y hace `revalidatePath("/clientes/${clienteId}")`. `clienteId` viaja como **argumento explícito** (el `[id]` del path), nunca desde `input`. Devuelve `ActionResult<DireccionAgregada>` con shape `{ data, error }`.

### 3.5 Componente y pantalla

- `src/app/(dashboard)/clientes/[id]/page.tsx` — ficha `/clientes/[id]`. Server Component: resuelve sesión (`redirect("/login")`), exige `clientes:leer` (`redirect("/no-autorizado")`), lee el encabezado con `prisma.cliente.findUnique` (`:63`) y aplica `notFound()` si el cliente no existe **o** `!is_active` (`:69`). Trae las direcciones con `listarDireccionesCliente(id, { incluirInactivas })` y monta `<DireccionesCliente>`, `<CanalContactoCliente>` (HU-C9) y `<SegmentoCliente>` (HU-C8).
- `src/components/clientes/DireccionesCliente.tsx` — Client Component. `DireccionesForm` (`:94`) con `react-hook-form` + `zodResolver(AgregarDireccionClienteSchema)`; `ListaDirecciones` (`:216`) con badges `Facturación`/`Envío` y un badge "Inactiva" cuando corresponde. Al confirmar hace `router.refresh()`. Estado vacío que explica la regla de facturación primero.
- **`<select>` nativo** con la constante `selectClassName` (`:60`) para el campo `tipo` — no existe `src/components/ui/select.tsx` (ver 5.2).

## 4. Eventos de dominio y auditoría

| Evento | Emitido por | Cuándo | Payload |
|---|---|---|---|
| `cliente:actualizado` | `agregarDireccionCliente()` (`cliente.service.ts:343`) | Post-COMMIT, fire-and-forget | `{ cliente_id, usuario_id, campos_modificados: ["direcciones"], valor_anterior: null, valor_nuevo: { id, tipo, rotulo } }` |

- El payload **no copia `email` ni `telefono`** (regla de minimización, spec §4).
- El listener (`audit-log.listener.ts:982`) registra un `AuditLog` con `accion: "CREATE"`, `tabla_afectada: "direcciones_cliente"`, `registro_id` = id de la dirección creada, `valor_anterior: null`, `ip: "unknown"`. `campos_modificados` se **pliega dentro de `valor_nuevo`** porque `AuditLog` no tiene esa columna.
- Tipos: `ClienteActualizadoPayload` + entrada en `DomainEventMap` (`event-types.ts:815`, `:978`).
- **El 422 no emite nada:** la regla se aplica antes del `create`, así que la transacción revienta sin escrituras ni evento. Verificado por la suite de integración (conteo de asientos == altas exitosas).

## 5. Decisiones de diseño

### 5.1 La regla pura vive en un módulo alias-free (`direccion-cliente.reglas.ts`) — desviación D1

`validarReglaDireccionEnvio` **no** está en `cliente.service.ts` sino en `src/lib/services/clientes/direccion-cliente.reglas.ts`, un módulo sin `import "server-only"`, sin alias `@/` y sin I/O.

Motivo (feasibility-forced): el script `test` del proyecto corre `node --experimental-strip-types --test`, que **no resuelve alias de `tsconfig.json`** ni puede importar un módulo cuyo primer import sea `server-only` (su default export lanza al importarse). Con la regla dentro de `cliente.service.ts` (que es `server-only` y usa `@/`), la cobertura unitaria exigida era imposible. Semántica idéntica; precedentes del repo: `turno-caja.calculo.ts`, `evaluacion.calculo.ts`, `comprobante-proveedor-reglas.ts`.

### 5.2 `<select>` nativo en vez de un componente `Select` shadcn — desviación D2

`src/components/ui/select.tsx` **no existe** en el repo. Se usó un `<select>` nativo con la constante `selectClassName` (mismo par de clases del sistema de diseño que usan `SelectorJerarquicoStock`, `FormularioNuevoPresupuesto`, `FiltrosAuditoria`), en vez de introducir un componente nuevo.

### 5.3 Cliente inexistente **o** inactivo ⇒ el mismo `404`, sin `CLIENTE_INACTIVO`

El service implementa `if (!cliente || !cliente.is_active) throw new ServiceError("CLIENTE_NO_ENCONTRADO", …)`. El caso inactivo es **indistinguible** del inexistente a propósito: no existe un código `CLIENTE_INACTIVO` ni un `409`. Coherente con el contrato global de baja lógica (los `SELECT` operativos filtran `is_active = true`, spec §3.4) y con el `notFound()` de la ficha. La spec §2.3 marcaba este caso como decisión pendiente; quedó ratificado en el design como `404` para ambos.

### 5.4 El evento `cliente:actualizado` NO existía — HU-C3 lo agregó (aditivo)

El prompt de orquestación asumía que `cliente:actualizado` ya existía. **No era así:** el código solo tenía `cliente:creado` (HU-C1). HU-C3 tuvo que **crear** `ClienteActualizadoPayload`, su entrada en `DomainEventMap` (`event-types.ts`) y un handler **nuevo** en `audit-log.listener.ts` (`:982`). Fue estrictamente **aditivo**: ningún handler existente fue modificado (el diff del listener fue 27+/0−). Este evento es el que después reutilizaron HU-C9 y HU-C8 (ver sus documentos), y la razón por la que HU-C9 necesitó un ajuste aditivo en el listener.

### 5.5 Cero escrituras en el rechazo 422: la lectura precede al `create`

La regla se evalúa con un `count` **solo-lectura** de `FACTURACION` activas **antes** de cualquier `create`. Si falla, `validarReglaDireccionEnvio` lanza y la transacción revienta sin haber insertado una sola fila. Esto es lo que garantiza que el 422 implique **cero direcciones creadas y cero asientos de auditoría** — probado en la suite de integración (escenarios c1 y c2, y el conteo de asientos).

### 5.6 Contrato de consumo futuro — Módulo E (documentado, no construido)

Módulo E (checkout web) leerá las direcciones con `listarDireccionesCliente(clienteId, { incluirInactivas: false })` y consumirá `cliente_id`, `tipo`, `rotulo`, `direccion_completa`; las filas `tipo === "ENVIO"` son las candidatas a despacho. Módulo E **no** se construye este sprint (spec §5, l. 429). **Módulo B NO consume `DireccionCliente`**: su único punto de integración con Módulo C es la consulta unificada de HU-C7. El contrato está escrito en los docstrings de `agregarDireccionClienteTx` y `listarDireccionesCliente`.

## 6. RBAC

| Permiso | VENDEDOR | ADMINISTRADOR_CRM | AUDITOR |
|---|:---:|:---:|:---:|
| `clientes:editar` (POST) | ✅ | ✅ | ❌ |
| `clientes:leer` (GET) | ✅ | ✅ | ✅ |
| `auditoria:leer_forense` (bypass de inactivas en el GET) | ❌ | ❌ | ✅ |

- **Capa 1 (REST):** `withPermission("clientes:editar")` en el `POST` y `withPermission("clientes:leer")` en el `GET` → `401` sin sesión, `403` sin permiso.
- **Capa 2 (Server Action):** repite sesión + `usuarioTienePermiso(session.userId, PERMISO_EDITAR)` antes de tocar el service.
- **UI:** la ficha exige `clientes:leer` (`redirect("/no-autorizado")`). El bypass de inactivas se resuelve con `usuarioTienePermiso(…, "auditoria:leer_forense")`.
- `usuarioTienePermiso` es un test exacto de pertenencia a `Permiso.codigo` (sin jerarquía ni implicación) — ver `with-permission.ts:79`.

## 7. Cómo se validó

**Tests unitarios (corren en `npm test`, sin base de datos):**

| Archivo | Qué cubre |
|---|---|
| `src/lib/schemas/clientes.schema.test.ts` | `AgregarDireccionClienteSchema`: payload válido; ambos valores del enum; `rotulo` vacío; `tipo` fuera del enum; `direccion_completa` <5 y exactamente 5; `cliente_id` espurio se descarta. Además el normalizado de `email` de HU-C1 |
| `src/lib/services/clientes/direccion-cliente.reglas.test.ts` | `validarReglaDireccionEnvio`: `ENVIO` sin `FACTURACION` lanza `DIRECCION_FACTURACION_REQUERIDA`; `ENVIO` con `FACTURACION` no lanza; `FACTURACION` nunca depende del conteo previo |

**Tests de integración (opt-in por variable de entorno, `skip` por diseño si no está seteada):**

| Script | Archivo | Env var | Qué cubre |
|---|---|---|---|
| `npm run test:integration:c3` | `direccion-cliente.integration.test.ts` | `HU_C3_INTEGRATION_DATABASE_URL` | (a) FACTURACION como primera dirección; (b) N ENVIO sin límite; (c1/c2) ENVIO sin FACTURACION activa → `DIRECCION_FACTURACION_REQUERIDA` y **cero escrituras** (incluida la única FACTURACION inactiva); (d) listado default solo activas / `incluirInactivas`; (e) materialización en `audit_logs` con encadenamiento SHA-256 |
| `npm run test:integration:c3-http` | `direccion-cliente.http.integration.test.ts` | `HU_C3_INTEGRATION_BASE_URL` | Contra un servidor real: `401` sin sesión; `403` (`auditor.seed` tiene `clientes:leer` pero no `clientes:editar`; `cajero.seed` no tiene ningún `clientes:*`); `201`/`400`/`404`/`422`/`200`; `cliente_id` espurio del body descartado; HTML SSR de la ficha |

**Verificado en esta revisión:** `npm test` corre **410 tests, 410 pass, 0 fail, 0 skip** (incluye los unitarios de C3). El conteo y los resultados de las suites de integración provienen de los reportes de verificación SDD (no los re-ejecuté): verify #131 (`npm test` 357/357 en ese momento, `test:integration:c3` 1/1 contra Postgres real) y el `c3-http` 11/11 se documenta en el verify de HU-C9 (#147, 11/11 contra `next start`).

**Lo que ningún test cubre hoy:** el submit del formulario cliente en navegador (hidratación, Server Action + `router.refresh()`, el `Alert` de error y el estado "Guardando…"). El header de la suite HTTP lo declara explícitamente: "el submit del formulario cliente NO se ejercita acá — eso queda para un pase manual en navegador".

**Nota de honestidad sobre los artefactos SDD:** el verify #131 y el archive #133 dejaron abiertos W-1/W-2 ("no hay test HTTP de RBAC ni del mapeo de status; se recomienda agregar `test:integration:c3-http`"). **Esos warnings quedaron obsoletos respecto del código:** el repo HOY tiene `direccion-cliente.http.integration.test.ts` y el script `test:integration:c3-http` (commits `6bd23af` "test(HU-C3): verificar RBAC HTTP, mapeo de status y ficha SSR de direcciones" y `2dd607d` "feat(HU-C3): sembrar usuario vendedor.seed"). Cuando el artefacto y el código difieren, manda el código.

**Pitfall operativo de la suite HTTP:** debe correr contra un servidor **caliente** (`npm start` tras `npm run build`, o rutas ya compiladas). Sobre un `next dev` frío, el primer request a una ruta no compilada tarda ~29s y consume el timeout de 30s de la suite.

## 8. Cómo probar manualmente

1. Levantar el entorno (`docker compose ps`, `npx prisma migrate status`, `npx prisma db seed`). La seed siembra `vendedor.seed` (rol VENDEDOR, con `clientes:editar`/`clientes:leer`) — sin ese usuario no hay camino feliz navegable.
2. Iniciar sesión como `vendedor.seed@erp-swat.local` (contraseña de la seed: `abc123456789`) y abrir `/clientes`.
3. Entrar a la ficha de **Juan Pérez** (DNI `30123456`, id `1a2b3c4d-eeee-4a1a-8a1a-000000000001`). La ficha muestra sus dos direcciones sembradas: `Casa` / `Facturación` (`Belgrano 123, Salta Capital`) y `Depósito` / `Envío` (`Ruta 9 Km 4, Salta`).
4. **Alta de ENVIO con FACTURACION previa:** en el formulario, elegir Tipo `Envío`, Rótulo `Sucursal 2`, Dirección `Ruta 8 km 12` → "Agregar dirección". Esperado: la lista pasa a 3 direcciones (HTTP `201`).
5. **Regla 422:** crear un cliente nuevo (o usar uno sin direcciones), entrar a su ficha e intentar cargar una dirección de tipo `Envío` como primera. Esperado: `Alert` destructivo con el mensaje de `DIRECCION_FACTURACION_REQUERIDA`; la lista sigue vacía (cero escrituras).
6. **Corrección:** cargar primero una `Facturación` → `201`; recién entonces la `Envío` es aceptada.
7. **Validaciones:** Rótulo vacío → "El rótulo es obligatorio…"; Dirección `Casa` (4 caracteres) → "La dirección es obligatoria".
8. **REST:** `POST /api/clientes/<id>/direcciones` con `{rotulo,tipo,direccion_completa}` → `201`; el mismo POST con `cliente_id` espurio en el body → `201` y la fila queda en el cliente del path. Cliente inexistente → `404 CLIENTE_NO_ENCONTRADO`. Con `cajero.seed` → `403`.

## 9. Impacto en otros archivos

| Archivo | Cambio |
|---|---|
| `src/lib/services/clientes/cliente.service.ts` | Se agregaron `PERMISO_EDITAR`/`PERMISO_LEER`, `agregarDireccionClienteTx`, `agregarDireccionCliente`, `listarDireccionesCliente` y sus tipos |
| `src/lib/services/clientes/direccion-cliente.reglas.ts` | **Nuevo** — regla pura alias-free (D1) |
| `src/lib/schemas/clientes.schema.ts` | Se agregó `AgregarDireccionClienteSchema` |
| `src/app/api/clientes/[id]/direcciones/route.ts` | **Nuevo** — `POST`/`GET` |
| `src/app/(dashboard)/clientes/actions.ts` | Se agregó la Server Action `agregarDireccionCliente` |
| `src/app/(dashboard)/clientes/[id]/page.tsx` | **Nuevo** — ficha `/clientes/[id]` |
| `src/components/clientes/DireccionesCliente.tsx` | **Nuevo** |
| `src/app/(dashboard)/clientes/page.tsx` + `src/components/clientes/TablaClientes.tsx` | **Nuevos** — listado que conecta el alta con la ficha |
| `src/lib/events/event-types.ts` | `ClienteActualizadoPayload` + entrada `cliente:actualizado` |
| `src/lib/events/listeners/audit-log.listener.ts` | Handler **nuevo** `cliente:actualizado` (aditivo) |
| `prisma/seed.ts` | `vendedor.seed` (rol VENDEDOR) — sin él la ficha no era probable manualmente |
| `package.json` | Scripts `test:integration:c3` y `test:integration:c3-http`; 2 archivos unitarios enumerados en `test` |

**Sin migración y sin cambio de schema** (verificado: `prisma/schema.prisma` no figura en el cambio).

## 10. Estado actual y pendientes

**Completo y verificable en código:**
- Alta de direcciones `FACTURACION`/`ENVIO` con `rotulo` y `direccion_completa`, transaccional.
- Regla estructural de obligatoriedad de `FACTURACION` con rechazo `422` y **cero escrituras** (lectura antes del `create`).
- Listado filtrado por `is_active` con bypass de Auditoría.
- Endpoint REST y Server Action sobre el mismo service; RBAC en dos capas.
- Evento `cliente:actualizado` post-COMMIT (creado por esta HU, aditivo) y asiento de auditoría encadenado SHA-256.
- Ficha `/clientes/[id]` y listado `/clientes`.
- Cobertura: unitaria (schema + regla) e integración (servicio + HTTP).

**Gaps confirmados:**
- **El submit del formulario cliente no está automatizado** (hidratación + Server Action + `router.refresh()`): el header de la suite HTTP lo declara y queda para un pase manual en navegador.
- **La suite de integración deja filas de prueba** en la base de desarrollo (clientes/direcciones/asientos). `npx prisma db seed` no limpia datos extra; un reset es opcional para volver al baseline.
- **W-1/W-2 del archive quedaron obsoletos**: la suite HTTP ya existe en el repo (ver Sección 7). Quien lea el archive #133 debe contrastarlo con el código actual.

**Pendientes / territorio de otras HUs:**
- Editar o dar de baja lógica una dirección → fuera del alcance de HU-C3 (no hay endpoint).
- Consumo real de las direcciones por Módulo E (checkout web) → diferido (spec §5).
- Ficha completa con edición de contacto (HU-C2), consentimiento (HU-C4), prevención de duplicados (HU-C5), baja (HU-C6) y log (HU-C10) → territorio de otras HUs.
- La integración de Módulo B con Módulo C es solo HU-C7 (consulta unificada), no `DireccionCliente`.
