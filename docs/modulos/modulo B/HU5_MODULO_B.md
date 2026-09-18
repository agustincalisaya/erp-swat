# Especificación Técnica — HU-B5 (Cuenta corriente de cliente y autorización de excepción de crédito)

## ERP SWAT Indumentarias — Módulo B

**Metodología:** Regenerado por relevamiento directo del código (no SDD ex-ante).
**Stack real:** Next.js (App Router, RSC + Server Actions + Route Handlers) · Prisma ORM · Zod · PostgreSQL · bus de eventos de dominio (`domainEventBus`) → `AuditLog` de Módulo D.
**Fuente:** código en `src/` del commit `dd4624c` ("Agregue la HU-B5", rama `feature/HU-B5`, 2026-09-18) y los resultados de las corridas de testing de esa misma jornada. `docs/tasks/task_HU-B5.md` y `spec_modulo_B.md` se citan solo para señalar diferencias contra el código (§12); **no son la fuente** de este documento. Documento nuevo — no existía una versión previa de HU-B5 en `docs/modulos/modulo B/`.
**Estado de integración:** el código está commiteado y pusheado en `origin/feature/HU-B5`, **pero no está mergeado a `develop`** (verificado con `git merge-base --is-ancestor`). La rama además apila HU-B3/B4/B8, que tampoco están en `develop` (ver §12, punto 19).

**Organización del documento:** Parte 1 (§1–§9) es la referencia técnica del código tal como quedó; Parte 2 (§10–§14) es el historial de desarrollo: relevamiento, decisiones de diseño del PR, diferencias contra el task file y el spec, resultados de testing y pendientes.

---

# PARTE 1 — REFERENCIA TÉCNICA

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Cajero POS o Supervisor de Ventas, **necesito** consultar la cuenta corriente de un cliente y registrar operaciones a cuenta contra su límite de crédito, y **como** Supervisor de Ventas **necesito** aprobar o rechazar con motivo las operaciones que exceden ese límite, **para** que ninguna venta a crédito por encima del límite se concrete sin un responsable identificado y sin un evento sensible trazable en el log de auditoría.

Referencia funcional: Backlog HU-B5. Referencia contractual: `spec_modulo_B.md` §2.5 (consulta y alta), §3.3 (eventos post-`COMMIT`), §3.4 (sin `DELETE` físico) y §4 (eventos). El endpoint de resolución (§3.4 de este documento) **no está en el spec**: es una decisión de diseño de la tarea (ver §11, D1).

### 1.1. Notas de alcance (léanse antes que el resto)

- **La cuenta corriente y su límite son preexistentes.** No existe endpoint ni UI de alta de `CuentaCorrienteCliente` ni de modificación de `limite_credito_autorizado`; la única cuenta existente es la del seed (Juan Pérez). Alta de cuenta: fuera de alcance.
- **Integración con HU-B1 pendiente.** HU-B1 (venta de mostrador con `medio_pago: CUENTA_CORRIENTE`) no tiene código. Cuando exista, deberá invocar `registrarOperacionCuentaCorriente()` dentro de su transacción; queda como cambio posterior coordinado con el dueño de HU-B1. **Hoy nada en la aplicación invoca el alta de operaciones salvo el endpoint/Server Action y los tests.**
- **El `plan_de_pagos` solo se modela.** Se persiste como JSON en `CuentaCorrienteOperacion` y viaja en el evento de alta; su consumo (proyección de flujo de ingresos, cobro contra hito) es de Módulo G y no está implementado.
- **`saldo_actual` solo crece.** Ningún código de este módulo lo reduce: no hay registro de pagos recibidos ni de notas de crédito (ver §7).

### 1.2. Criterios de Aceptación

Derivados de `spec_modulo_B.md` §2.5 y del task file (que no los numeran; se numeran acá para la trazabilidad de §8), verificados contra el código real:

- [x] **CA1** — Consulta: `GET` devuelve `{ cliente_id, limite_credito_autorizado, saldo_actual, disponible }` con `disponible = límite − saldo`.
- [x] **CA2** — Alta dentro del límite (`monto ≤ disponible`): la operación se crea `APROBADA` y suma al `saldo_actual`.
- [x] **CA3** — Alta fuera del límite (`monto > disponible`): la operación se **persiste** `RETENIDA` (no se rechaza de plano), **no** toca el saldo, y la request responde `422 LIMITE_CREDITO_EXCEDIDO` con el `id` de la operación creada en `error.details.operacion_id`.
- [x] **CA4** — Aprobar una `RETENIDA`: pasa a `APROBADA`, `autorizado_por_id` = usuario de la sesión, y `saldo_actual += monto`.
- [x] **CA5** — Rechazar una `RETENIDA`: pasa a `RECHAZADA`, `autorizado_por_id` = usuario de la sesión, `saldo_actual` intacto.
- [x] **CA6** — Solo una operación `RETENIDA` admite resolución; cualquier otro estado origen responde `409 TRANSICION_INVALIDA`, validado dentro de la transacción del `UPDATE`.
- [x] **CA7** — La resolución es exclusiva del Supervisor de Ventas: `403` para `cajero.seed`, incluso sobre su propia operación retenida.
- [x] **CA8** — **Evento sensible obligatorio:** toda resolución emite `venta:excepcion_credito_resuelta` **después** del `COMMIT`, con `autorizacion_id` de correlación, y el listener lo materializa en `AuditLog` con encadenamiento SHA-256.
- [x] **CA9** — El alta emite `venta:operacion_cuenta_corriente_registrada` después del `COMMIT`, tanto para `APROBADA` como para `RETENIDA`.
- [x] **CA10** — Sin lógica de negocio en `route.ts` ni en la Server Action, y sin `DELETE` físico (RULES.md Regla N.° 1).

El detalle de qué función/archivo cumple cada uno está en §4 y §8.

---

## 2. Modelo de datos y enum `EstadoOperacionCC`

Sin migración propia: los modelos y el enum ya estaban en la migración `20260917005858_sprint3_modulo_b_ventas_y_cuenta_corriente`.

### 2.1. `CuentaCorrienteCliente` (`cuentas_corrientes_cliente`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (uuid) | PK |
| `cliente_id` | `String` `@unique` | Relación 1:1 con `Cliente` |
| `limite_credito_autorizado` | `Decimal(12,2)` default `0` | |
| `saldo_actual` | `Decimal(12,2)` default `0` | Solo cuenta operaciones `APROBADA` |
| `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`, `created_at`, `updated_at` | | Soft delete estándar de RULES.md §1 |

### 2.2. `CuentaCorrienteOperacion` (`cuenta_corriente_operaciones`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (uuid) | PK |
| `cuenta_corriente_id` | `String` | FK `Restrict` |
| `pedido_venta_id` | `String` | FK `Restrict` |
| `monto` | `Decimal(12,2)` | |
| `plan_de_pagos` | `Json?` | Cronograma `[{ hito, porcentaje, fecha_estimada? }]`; sin tabla hija |
| `estado` | `EstadoOperacionCC` default `APROBADA` | |
| `autorizado_por_id` | `String?` | FK `Restrict` a `Usuario`; `null` hasta que un Supervisor resuelve |
| soft delete + timestamps | | Idem |

**No existe columna del usuario que registró la operación** (ver §11, D2).

### 2.3. Enum `EstadoOperacionCC` y máquina de estados

Valores (confirmados contra `schema.prisma` y contra el `CREATE TYPE` de la migración): `APROBADA`, `RETENIDA`, `RECHAZADA`. El estado terminal de rechazo **ya existía** (`RECHAZADA`); esta HU no modificó el enum.

| Origen | Evento | Destino | `autorizado_por_id` | Efecto en `saldo_actual` |
|---|---|---|---|---|
| — | Alta con `monto ≤ disponible` | `APROBADA` | `null` | `+ monto` |
| — | Alta con `monto > disponible` | `RETENIDA` | `null` | ninguno |
| `RETENIDA` | Resolución `APROBAR` | `APROBADA` | Supervisor de la sesión | `+ monto` |
| `RETENIDA` | Resolución `RECHAZAR` | `RECHAZADA` | Supervisor de la sesión | ninguno |
| `APROBADA` / `RECHAZADA` | cualquier resolución | — | — | `409 TRANSICION_INVALIDA` |

`APROBADA` y `RECHAZADA` son terminales. **Consecuencia de modelado:** una `APROBADA` puede tener `autorizado_por_id` nulo (aprobada directa, dentro del límite) o no nulo (aprobada por excepción de un Supervisor); la UI usa esa diferencia para el badge (§6.3). El `default` del enum (`APROBADA`) no es la única defensa: el servicio siempre setea el estado explícitamente.

### 2.4. `disponible` y saldos

`disponible = limite_credito_autorizado − saldo_actual`, calculado con `Prisma.Decimal` (sin aritmética de `float`) y convertido a `number` recién en la respuesta. Las operaciones `RETENIDA` y `RECHAZADA` **no** entran en el saldo, así que no reducen el `disponible`. Como aprobar una `RETENIDA` no revalida el límite (§4.4), `saldo_actual` puede superar el límite y `disponible` ser **negativo**; en ese caso todo alta nueva de monto positivo queda `RETENIDA`.

---

## 3. Contrato de API

### 3.1. Schemas Zod (`src/lib/schemas/ventas.schema.ts`)

`RegistrarOperacionCuentaCorrienteSchema` copiado de `spec_modulo_B.md` §2.5; `ResolverExcepcionCreditoSchema` copiado de `docs/tasks/task_HU-B5.md` §2.3:

```typescript
export const RegistrarOperacionCuentaCorrienteSchema = z.object({
  pedido_venta_id: z.string().uuid(),
  monto: z.number().positive(),
  plan_de_pagos: z.array(z.object({
    hito: z.string().min(1),
    porcentaje: z.number().positive().max(100),
    fecha_estimada: z.coerce.date().optional(),
  })).optional(),
});

export const ResolverExcepcionCreditoSchema = z.object({
  decision: z.enum(["APROBAR", "RECHAZAR"]),
  motivo: z.string().min(1, "El motivo es obligatorio"),
});
```

Además, `ClienteCuentaCorrienteIdSchema` y `OperacionCuentaCorrienteIdSchema` (UUID de path param). Las validaciones de existencia (cuenta, pedido, operación) **no** están en Zod: son del servicio. El schema **no** valida que los porcentajes del plan sumen 100 ni que `monto` sea comparable con el total del pedido.

Convención de errores de los tres Route Handlers: `id` de path inválido → `400 VALIDATION_ERROR` sin `fieldErrors`; body inválido (incluye JSON malformado, que se parsea como `null`) → `400 VALIDATION_ERROR` con `fieldErrors`. Cualquier `ServiceError` sin mapeo explícito cae en `400`.

### 3.2. `GET /api/ventas/cuentas-corrientes/[cliente_id]`

`src/app/api/ventas/cuentas-corrientes/[cliente_id]/route.ts`. Gate: `withPermission("ventas:gestionar_cuenta_corriente")`.

| Status | Código | Cuándo |
|---|---|---|
| `200` | — | Cuenta activa encontrada |
| `400` | `VALIDATION_ERROR` | `cliente_id` no es UUID |
| `401` | `UNAUTHORIZED` | Sin sesión |
| `403` | `FORBIDDEN` | Sin `ventas:gestionar_cuenta_corriente` |
| `404` | `CUENTA_CORRIENTE_NO_ENCONTRADA` | El cliente no tiene cuenta activa |
| `500` | `INTERNAL_ERROR` | Excepción no controlada |

```json
{ "data": { "cliente_id": "uuid", "limite_credito_autorizado": 500000, "saldo_actual": 120000, "disponible": 380000 }, "error": null }
```

Sin Server Action equivalente (consulta de uso interno).

### 3.3. `POST /api/ventas/cuentas-corrientes/[cliente_id]/operaciones`

`.../[cliente_id]/operaciones/route.ts`. Gate: `withPermission("ventas:gestionar_cuenta_corriente")` (Cajero POS y Supervisor de Ventas). **Body:** `RegistrarOperacionCuentaCorrienteSchema`. **Path:** `cliente_id`.

| Status | Código | Cuándo |
|---|---|---|
| `201` | — | Operación creada `APROBADA` (dentro del límite) |
| `400` | `VALIDATION_ERROR` | Path o body inválido |
| `401` / `403` | `UNAUTHORIZED` / `FORBIDDEN` | Sin sesión / sin permiso |
| `404` | `CUENTA_CORRIENTE_NO_ENCONTRADA` | El cliente no tiene cuenta activa |
| `404` | `PEDIDO_VENTA_NO_ENCONTRADO` | El pedido no existe |
| `422` | `PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE` | `pedido.cliente_id !== cliente_id` |
| `422` | `PEDIDO_VENTA_NO_OPERABLE` | Pedido `ANULADO` o `is_active: false` |
| `422` | `LIMITE_CREDITO_EXCEDIDO` | `monto > disponible`: la operación **quedó persistida** `RETENIDA` |
| `500` | `INTERNAL_ERROR` | Excepción no controlada |

**Respuesta `201`:**

```json
{ "data": { "operacion_id": "uuid", "estado": "APROBADA" }, "error": null }
```

**Respuesta `422 LIMITE_CREDITO_EXCEDIDO`** (la operación ya está committeada al responder):

```json
{ "data": null, "error": { "code": "LIMITE_CREDITO_EXCEDIDO", "message": "La operación excede el límite de crédito disponible; requiere autorización de un Supervisor de Ventas", "details": { "operacion_id": "uuid" } } }
```

Este Route Handler es el único de los tres que propaga `error.details` (solo cuando el `ServiceError` lo trae), siguiendo el precedente de HU-G10.

### 3.4. `PATCH /api/ventas/cuentas-corrientes/operaciones/[id]/resolver`

`.../operaciones/[id]/resolver/route.ts`. Gate: `withPermission("ventas:autorizar_excepcion_credito")` — **exclusivo del Supervisor de Ventas**; el Cajero recibe `403` sin llegar al servicio. **Body:** `ResolverExcepcionCreditoSchema`. **Path:** `id` (de la `CuentaCorrienteOperacion`). El usuario autorizante es **el de la sesión** (`session.userId`): no hay `supervisor_credencial` en el body.

| Status | Código | Cuándo |
|---|---|---|
| `200` | — | Resolución aplicada |
| `400` | `VALIDATION_ERROR` | `id` no UUID, `decision` fuera de enum o `motivo` vacío |
| `401` / `403` | `UNAUTHORIZED` / `FORBIDDEN` | Sin sesión / sin `ventas:autorizar_excepcion_credito` |
| `404` | `OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA` | La operación no existe o `is_active: false` |
| `409` | `TRANSICION_INVALIDA` | La operación no está `RETENIDA` |
| `500` | `INTERNAL_ERROR` | Excepción no controlada |

```json
{ "data": { "operacion_id": "uuid", "estado": "APROBADA", "autorizacion_id": "uuid" }, "error": null }
```

`estado` es `"APROBADA"` o `"RECHAZADA"` según la `decision`. Respuesta `409`:

```json
{ "data": null, "error": { "code": "TRANSICION_INVALIDA", "message": "Solo una operación en estado RETENIDA puede resolverse" } }
```

### 3.5. Server Actions (`src/app/(dashboard)/ventas/cuentas-corrientes/actions.ts`)

Equivalentes de los Route Handlers, mismo shape plano `{ data, error }` (con `error.details` opcional). El sufijo `Action` evita el choque de nombres con las funciones homónimas del servicio (patrón de HU-B4). Cada una verifica a mano `getServerSession()` + `usuarioTienePermiso()`, parsea con Zod, invoca el **mismo** servicio y revalida la caché:

- `registrarOperacionCuentaCorrienteAction(clienteId, input)` — permiso `ventas:gestionar_cuenta_corriente`; `revalidatePath` del detalle del cliente tanto en éxito como ante `LIMITE_CREDITO_EXCEDIDO` (la retenida ya está committeada). **No tiene consumidor en la UI** (§7).
- `resolverExcepcionCreditoAction(operacionId, input)` — permiso `ventas:autorizar_excepcion_credito`; `revalidatePath("/ventas/cuentas-corrientes", "layout")`. Es la que invoca el Dialog (§6.4).

---

## 4. Capa de servicios — `lib/services/ventas/cuenta-corriente.service.ts`

Archivo nuevo. Exporta los permisos (`PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE`, `PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO`), las tres funciones de negocio y dos lecturas para la UI (§4.7). Los Route Handlers y las Server Actions no contienen lógica de negocio ni importan `prisma` (verificado por un test, §13.1).

### 4.1. `consultarCuentaCorriente(clienteId)` → `Promise<CuentaCorrienteConsulta>`

`findFirst({ cliente_id, is_active: true, deleted_at: null })`; si no hay resultado, `CUENTA_CORRIENTE_NO_ENCONTRADA`. Devuelve los cuatro campos de CA1.

### 4.2. `registrarOperacionCuentaCorriente(clienteId, input)` → `Promise<{ operacion_id, estado: "APROBADA" }>`

Cumple **CA2, CA3, CA9**. Orden real de operaciones:

1. **Antes de la transacción:** `monto = new Decimal(input.monto).toDecimalPlaces(2)` y serialización del plan (`fecha_estimada` de `Date` a ISO-8601 para el JSON).
2. **Dentro de una única `prisma.$transaction`**:
   1. **Bloqueo de la cuenta:** `SELECT id, limite_credito_autorizado, saldo_actual FROM cuentas_corrientes_cliente WHERE cliente_id = … AND is_active = true AND deleted_at IS NULL FOR UPDATE`. Sin resultado → `CUENTA_CORRIENTE_NO_ENCONTRADA`.
   2. **Pedido:** `pedidoVenta.findUnique(id)` → inexistente: `PEDIDO_VENTA_NO_ENCONTRADO`; de otro cliente: `PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE`; `!is_active` o `estado === "ANULADO"`: `PEDIDO_VENTA_NO_OPERABLE`.
   3. **Límite:** `disponible = limite − saldo` con la fila ya bloqueada; `aprobada = monto ≤ disponible` (**comparación inclusiva**: un monto igual al disponible se aprueba).
   4. **Alta:** `create` con `estado` `APROBADA`/`RETENIDA` y `autorizado_por_id: null`.
   5. **Saldo:** solo si `aprobada`, `update` con `saldo_actual: { increment: monto }`.
3. **`COMMIT`.**
4. **Post-`COMMIT`:** `domainEventBus.emit("venta:operacion_cuenta_corriente_registrada", …)` (siempre, con `estado` real).
5. Si no quedó aprobada, **recién entonces** se lanza `ServiceError("LIMITE_CREDITO_EXCEDIDO", …, { operacion_id })`. El error se lanza fuera de la transacción a propósito: si se lanzara dentro, el `ROLLBACK` descartaría la operación retenida.

### 4.3. `resolverExcepcionCredito(operacionId, input, usuarioAutorizanteId)` → `Promise<{ operacion_id, estado, autorizacion_id }>`

Cumple **CA4–CA8**. Orden real:

1. **Antes de la transacción:** `autorizacionId = crypto.randomUUID()` (§4.6).
2. **Dentro de una única `prisma.$transaction`**:
   1. **Lectura:** `cuentaCorrienteOperacion.findFirst({ id, is_active: true })` con `monto`, `pedido_venta_id`, `cuenta_corriente.cliente_id` y `pedido_venta.registrado_por_id`. Sin resultado → `OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA`.
   2. **Guardia atómica de estado origen:** `updateMany({ where: { id, is_active: true, estado: "RETENIDA" }, data: { estado: APROBADA|RECHAZADA, autorizado_por_id } })`; si `count !== 1` → `TRANSICION_INVALIDA`.
   3. **Saldo:** solo si `APROBAR`, `cuentaCorrienteCliente.update` con `saldo_actual: { increment: operacion.monto }`.
3. **`COMMIT`.**
4. **Post-`COMMIT`:** `emit("venta:excepcion_credito_resuelta", …)` (§5.2).

### 4.4. Reglas de negocio: límite y concurrencia

**Validación de límite.** Se revalida siempre server-side, dentro de la transacción y con la fila de la cuenta bloqueada; el cliente nunca envía un `disponible`. Una operación que excede el límite no se rechaza: se persiste `RETENIDA` y espera al Supervisor. Al **aprobar** una `RETENIDA` **no** se revalida el límite: el saldo puede terminar por encima del límite (p. ej. el fixture de seed: 120.000 + 413.000 = 533.000 sobre un límite de 500.000). Es el sentido de la "excepción de crédito", no un defecto.

**Concurrencia en el alta — `SELECT … FOR UPDATE`.** Bajo `READ COMMITTED`, dos altas simultáneas del mismo cliente leerían el mismo `saldo_actual` y podrían aprobarse ambas superando el límite. El `FOR UPDATE` serializa las altas de una misma cuenta: la segunda espera al `COMMIT` de la primera y calcula `disponible` con el saldo ya actualizado. Verificado con un test (dos altas de 250.000 con 380.000 disponibles → una `APROBADA`, una `RETENIDA`; solo la aprobada suma al saldo).

**Concurrencia en la resolución — `updateMany` con guardia de estado.** La lectura previa no es suficiente (dos Supervisores podrían leer `RETENIDA` a la vez). El `updateMany({ where: { estado: "RETENIDA" } })` es atómico: el segundo `UPDATE` no encuentra fila en `RETENIDA` y devuelve `count: 0` → `409`. Solo quien gana la guardia incrementa el saldo. Verificado con un test (dos `APROBAR` simultáneos → uno `200`, uno `TRANSICION_INVALIDA`; el saldo suma **una sola vez**).

**No cubierto por test:** la concurrencia **cruzada** (un alta simultánea con una resolución sobre la misma cuenta). Por diseño es coherente (el `increment` es atómico en SQL y el alta relee el saldo tras adquirir el lock), pero no hay un test dedicado.

### 4.5. Orden de validaciones y códigos de error

- **Alta:** `CUENTA_CORRIENTE_NO_ENCONTRADA` (404) → `PEDIDO_VENTA_NO_ENCONTRADO` (404) → `PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE` (422) → `PEDIDO_VENTA_NO_OPERABLE` (422) → cálculo de límite → `LIMITE_CREDITO_EXCEDIDO` (422, tras el `COMMIT`).
- **Resolución:** `OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA` (404) → `TRANSICION_INVALIDA` (409).

`TRANSICION_INVALIDA` reutiliza el código que el resto del módulo usa para "esta operación no aplica al estado actual del recurso".

### 4.6. `autorizacion_id` — id de correlación

Mismo criterio que HU-B4 (`HU4_MODULO_B.md` §3.5, no se repite la justificación completa): `crypto.randomUUID()` generado por el servicio **antes del `COMMIT`**, devuelto en la respuesta `200`, incluido en el payload del evento y persistido dentro de `valor_nuevo` del `AuditLog`. **No** es el `id` real de la fila de `AuditLog` (Módulo D la materializa de forma asíncrona, fire-and-forget); es trazable por búsqueda dentro de `valor_nuevo`.

### 4.7. Lecturas para la UI

- **`listarCuentasCorrientes()`** → cuentas activas ordenadas por nombre de cliente, con límite, saldo, `disponible` y cantidad de operaciones `RETENIDA` activas. Sin paginación.
- **`obtenerCuentaCorrienteDetalle(clienteId)`** → `CuentaCorrienteDetalle | null`: resumen + operaciones activas (orden `created_at desc`) con `numero_venta`, `monto`, `estado`, `autorizado_por_id`/`autorizado_por_nombre`, `plan_de_pagos` y `created_at`.

### 4.8. Límites conocidos

Marcados como **[test]** los verificados por un test y **[código]** los relevados solo leyendo el código, sin test dedicado ni ejecución:

- **[código]** `monto` se redondea a 2 decimales antes de operar; Zod solo exige `positive()`, así que un `monto` como `0.004` se convierte en `0.00` y se aprobaría por 0. Tampoco hay guarda para montos que excedan `Decimal(12,2)`; el comportamiento (error de base → `500`) no fue ejercitado.
- **[código]** No hay control de duplicados: un mismo pedido admite varias operaciones a cuenta, y no se compara `monto` con `PedidoVenta.total`.
- **[código]** No se valida que los porcentajes del `plan_de_pagos` sumen 100 ni que las fechas sean futuras.
- **[código]** El alta solo rechaza pedidos `ANULADO`/inactivos; un pedido en cualquier otro estado (incluido `CERRADO`) se acepta.
- **[código]** La resolución no revisa si el pedido de la operación fue anulado después ni si la cuenta sigue activa.
- **[código]** Varias operaciones `RETENIDA` de la misma cuenta pueden aprobarse una tras otra sin revalidar el límite: el saldo puede acumular un exceso arbitrario (consecuencia directa de §4.4).
- **[código]** El permiso `ventas:autorizar_excepcion_credito` se valida **una sola vez**, en el gate del Route Handler/Server Action y **fuera** de la transacción (a diferencia de HU-B4, que re-valida al autorizante dentro de ella). Una revocación entre el gate y el `COMMIT` del mismo request no se detecta.
- **[código]** Un usuario con ambos permisos (el Supervisor de Ventas hereda los del Cajero) puede registrar una operación y resolverla él mismo (auto-aprobación permitida, §11 D3); no hay control "solicitante ≠ autorizante" y ningún test lo ejercita.

---

## 5. Eventos de dominio y auditoría

`src/lib/events/event-types.ts` declara los dos eventos en `DomainEventMap`. Ambos se emiten **después del `COMMIT`**, nunca dentro de la transacción (spec §3.3).

### 5.1. `venta:operacion_cuenta_corriente_registrada` — tras el alta (`APROBADA` y `RETENIDA`)

```typescript
interface OperacionCuentaCorrienteRegistradaPayload {
  operacion_id: string;
  cliente_id: string;
  pedido_venta_id: string;
  monto: number;
  estado: "APROBADA" | "RETENIDA";
  plan_de_pagos?: Array<{ hito: string; porcentaje: number; fecha_estimada?: string }>; // ISO-8601; se omite si no vino plan
}
```

`operacion_id` y `estado` son agregados a la tabla de `spec_modulo_B.md` §4 (cuyo "payload mínimo" es `{ cliente_id, pedido_venta_id, monto, plan_de_pagos? }`): sin `estado`, un consumidor no podría distinguir una operación imputada al saldo de una retenida.

**Este evento no tiene ningún consumidor hoy.** No existe handler en `audit-log.listener.ts` (el alta **no** genera fila en `AuditLog`) ni un listener de Módulo G, que el spec nombra como consumidor. Se emite y se descarta.

### 5.2. `venta:excepcion_credito_resuelta` — tras la resolución (**evento sensible**)

```typescript
interface ExcepcionCreditoResueltaPayload {
  autorizacion_id: string;        // id de correlación (§4.6)
  operacion_id: string;
  pedido_venta_id: string;
  cliente_id: string;
  usuario_solicitante_id: string; // PedidoVenta.registrado_por_id (limitación, §11 D2)
  usuario_autorizante_id: string; // usuario de la sesión (Supervisor)
  decision: "APROBAR" | "RECHAZAR";
  motivo: string;
  monto: number;
}
```

No figura en la tabla de `spec_modulo_B.md` §4; se agregó siguiendo el mismo namespacing `venta:*`. A diferencia de los eventos de HU-B4, **no incluye `dispositivo` ni `timestamp`** (el payload lo define así el task file; el momento queda en `AuditLog.created_at`).

### 5.3. Fila resultante en `AuditLog` (handler nuevo en `audit-log.listener.ts`, `void registrarAuditLog(...)`)

| Campo | Valor |
|---|---|
| `usuario_id` | `usuario_autorizante_id` |
| `accion` | `EXCEPCION_CREDITO_APROBADA` o `EXCEPCION_CREDITO_RECHAZADA` (según `decision`) |
| `tabla_afectada` | `cuenta_corriente_operaciones` |
| `registro_id` | `operacion_id` |
| `ip` | `"internal-event"` |
| `valor_anterior` | `{ estado: "RETENIDA" }` |
| `valor_nuevo` | `{ estado (APROBADA\|RECHAZADA), autorizacion_id, usuario_solicitante_id, pedido_venta_id, cliente_id, decision, motivo, monto }` |

Observaciones: (a) el `usuario_id` es el **autorizante**; el solicitante queda en `valor_nuevo`; (b) `registro_id` apunta a la operación (la fila realmente mutada), a diferencia de HU-B4 que apunta al pedido; (c) el encadenamiento SHA-256 lo aplica `registrarAuditLog()` como en todo el sistema: `hash_anterior` es el `hash_actual` del registro previo del ledger y `hash_actual` se calcula sobre el registro + `hash_anterior`.

---

## 6. Frontend

### 6.1. Listado — `/ventas/cuentas-corrientes/page.tsx` (RSC)

`dynamic = "force-dynamic"`. Sin sesión → `redirect("/login")`; sin `ventas:gestionar_cuenta_corriente` → `redirect("/no-autorizado")`. Tabla con cliente, límite, saldo, disponible (en rojo si es negativo), badge "N pendiente(s)" de operaciones retenidas y enlace "Ver cuenta". Estado vacío con texto propio. Sin filtros ni paginación.

### 6.2. Detalle — `/ventas/cuentas-corrientes/[cliente_id]/page.tsx` (RSC)

Mismos redirects; `notFound()` si el UUID es inválido o la cuenta no existe. Tres tarjetas (límite, saldo, disponible) y una tabla de operaciones: pedido (enlace a `/ventas/pedidos/[id]`, más el resumen del plan de pagos), fecha, monto, badge de estado (con "Resuelta por {nombre}" cuando hay autorizante) y la acción de resolución. La acción **"Resolver excepción"** se renderiza solo si `usuarioTienePermiso(..., "ventas:autorizar_excepcion_credito")` **y** `op.estado === "RETENIDA"`.

### 6.3. `EstadoOperacionCCBadge.tsx` — los 3 estados

Badge puro que decide por el enum `estado` (una sola fuente de verdad; no infiere el resultado de un par de flags como el gate binario que causó el bug de HU-B4, `HU4_MODULO_B.md` §6):

| `estado` | `autorizado_por_id` | Render |
|---|---|---|
| `RETENIDA` | — | Badge ámbar **"Retenida — pendiente"** |
| `RECHAZADA` | — | Badge rojo **"Rechazada"** |
| `APROBADA` | `null` | Badge verde **"Aprobada"** |
| `APROBADA` | no nulo | Badge verde **"Aprobada por excepción"** |
| otro valor | — | Badge gris con el texto literal del estado |

### 6.4. `DialogResolverExcepcionCredito.tsx`

`AlertDialog` + `useState` manual + Server Action, sin `react-hook-form` (mismo patrón que `DialogAutorizarOverrideDescuento`). Toggle **Aprobar / Rechazar** (default Aprobar) y **motivo** obligatorio (`trim()`); el botón de confirmación —verde o rojo según la decisión— se habilita solo con motivo. El texto avisa que al aprobar el saldo puede quedar sobre el límite y que ambas decisiones quedan como evento sensible. **No tiene selector de Supervisor** (§11 D5): quien resuelve es el usuario de la sesión. Tras el éxito cierra, limpia y `router.refresh()`; un error del servidor se muestra en un `Alert`.

### 6.5. Navegación

`Sidebar.tsx`: nueva entrada "Cuentas corrientes" (ícono `Wallet`) en la sección "Ventas", con `permiso: "ventas:gestionar_cuenta_corriente"` (la ve Cajero POS y Supervisor de Ventas). El bloqueo real por URL vive en cada `page.tsx`.

---

## 7. Fuera de alcance explícito / capacidades no implementadas

- **Integración desde HU-B1** (`medio_pago: CUENTA_CORRIENTE` disparando el alta dentro de `pedido-venta.service.ts`) — HU-B1 sin código; queda como cambio posterior coordinado. Ver §1.1.
- **Consumo del `plan_de_pagos` por Módulo G** — solo se modela y viaja en el evento (§5.1), que hoy no tiene consumidor.
- **Alta de `CuentaCorrienteCliente` y edición del límite** — sin endpoint ni UI; la cuenta se asume preexistente.
- **Pagos recibidos y notas de crédito sobre la cuenta** — el spec §2.5 habla de un "historial de movimientos (facturas emitidas, pagos recibidos, notas de crédito)", pero el modelo solo tiene operaciones a cuenta y **ningún código reduce `saldo_actual`**. No hay forma de saldar una cuenta desde el módulo.
- **Formulario de alta de operación en la UI** — existen la Server Action y el endpoint, pero ninguna pantalla los invoca (la UI es de consulta y resolución). Tampoco hay enlace desde una ficha de cliente (no existe ficha en `(dashboard)/clientes`, solo `nuevo`).
- **Cancelación de pedido con liberación de stock y reversión por Nota de Crédito** — cubiertas por otras HU/spec; esta HU no las reimplementa.
- **Renombre del enum `OrigenReserva`** — deuda técnica documentada, sin relación con esta HU.
- **Re-validación del límite al aprobar una `RETENIDA`** — descartada a propósito (§4.4).
- **Control "solicitante ≠ autorizante"** — descartado a propósito (§11 D3).
- **Auditoría del alta (`AuditLog`) y consumidor de Módulo G del evento de alta** — no implementados (§5.1, §14).

---

## 8. Cumplimiento de cada Criterio de Aceptación

| CA | Cumplido por |
|---|---|
| **CA1** — Consulta | `consultarCuentaCorriente()` (§4.1) + `GET …/[cliente_id]` (§3.2); verificado por `test:integration:b5` y `b5-http` (shape exacto de spec §2.5) |
| **CA2** — Alta dentro del límite | `registrarOperacionCuentaCorriente()` (§4.2); subtests "dentro del límite" y "monto exactamente igual al disponible" (`b5`), `201` en `b5-http` |
| **CA3** — Alta fuera del límite (`RETENIDA` + `422`) | §4.2 pasos 3–5; subtest "fuera del límite" (fila `RETENIDA`, saldo intacto, `details.operacion_id`) en `b5` y `b5-http` |
| **CA4** — Aprobar | `resolverExcepcionCredito()` (§4.3); subtest "fixture RETENIDA: APROBAR" (saldo 120.000 → 533.000) |
| **CA5** — Rechazar | Idem; subtest "fixture RETENIDA: RECHAZAR" (saldo intacto) |
| **CA6** — Solo `RETENIDA` admite resolución | `updateMany` con guardia (§4.4); subtests de reintento sobre el fixture resuelto, sobre la `APROBADA` de seed y la concurrencia de resoluciones; `409` con body exacto en `b5-http` |
| **CA7** — Exclusivo del Supervisor | `withPermission("ventas:autorizar_excepcion_credito")` en el `PATCH`; `b5-http`: `403` con `cajero.seed` sobre el fixture y sobre su propia retenida (que sigue `RETENIDA`); test unitario que verifica el gate único y que la ruta no referencia el permiso del Cajero |
| **CA8** — Evento sensible post-`COMMIT` en `AuditLog` | §5.2–5.3 + handler del listener; `b5`: payload completo del evento, fila de `AuditLog` con `autorizacion_id`, hash SHA-256 recalculado y enlazado al registro previo |
| **CA9** — Evento de alta post-`COMMIT` | §5.1; `b5`: el evento se recibe con `estado` `APROBADA` y `RETENIDA`; unitario de orden respecto de la `$transaction` |
| **CA10** — Sin lógica en wrappers / sin `DELETE` | Unitarios: los Route Handlers y las acciones no importan `prisma` ni usan `$transaction`; el servicio no invoca `delete()`/`deleteMany()` |

---

## 9. Capacidades adicionales no exigidas por los CA

- **Validaciones sobre el pedido** (cuenta/pedido inexistente, pedido de otro cliente, pedido anulado/inactivo): el task file no las definía; se agregaron con aprobación (§11 D6).
- **Lecturas y pantallas de consulta** (`listarCuentasCorrientes`, `obtenerCuentaCorrienteDetalle`, listado y detalle): hacen operable y verificable el flujo sin HU-B1.
- **Doble red de gating en UI:** entrada de Sidebar por permiso, redirect por página y acción de resolución gateada en el RSC **y** en la Server Action/Route Handler.
- **Suite triple:** unitarios source-regex (`npm test`), integración a nivel de servicio contra base real (`test:integration:b5`) y HTTP con login real (`test:integration:b5-http`).
- **Tests de concurrencia reales** para el `FOR UPDATE` y la guardia `updateMany`.
- **Reseteo del fixture por `UPDATE`** dentro del propio test, para que la suite sea re-ejecutable.

---

# PARTE 2 — HISTORIAL DE DESARROLLO

## 10. Contexto y relevamiento previo (Paso 0)

La HU se implementó en dos fases: un **Paso 0 de relevamiento sin código**, con reporte de discrepancias y espera de confirmación explícita, y luego la implementación con las decisiones confirmadas. El Paso 0 leyó `RULES.md`, `spec_modulo_B.md`, `schema.prisma`, `prisma/seed.ts`, `pedido-venta.service.ts` y el endpoint de override de HU-B4.

Hallazgos del Paso 0 que condicionaron el diseño:

1. **El enum sí cubría el rechazo** (`RECHAZADA`, en schema y en la migración): no se migró nada.
2. **Fixtures presentes y coherentes con el task file:** cuenta de Juan Pérez (límite 500.000 / saldo 120.000), operación `APROBADA` de 45.000 sobre V-2026-000001 y operación `RETENIDA` de 413.000 sobre V-2026-000003, sin resolver. Observación: el `saldo_actual` sembrado (120.000) no es la suma de las operaciones sembradas; es dato de seed, no derivado.
3. **El evento no llegaba a `AuditLog` solo con `event-types.ts`:** el task pedía agregar el tipo pero no el handler del listener; sin él, la verificación de Nivel 3 habría fallado. Se agregó el handler (D9).
4. **No hay columna del solicitante** en `CuentaCorrienteOperacion`, y el payload del evento la exige (D2).
5. **El `422` no tenía lugar para el `id`** de la operación creada en el shape `{ data: null, error: { code, message } }` (D4).
6. **HU-B5 no definía** validaciones sobre el pedido, ni concurrencia, ni lecturas para la UI.
7. **El fixture RETENIDA se consume al resolverse** y el seed (`upsert` con `update: {}`) no lo restaura: hizo falta un reseteo en los tests (D11).
8. Menores: rutas del task sin el prefijo `src/`; `CLAUDE.md` referencia un `@AGENTS.md` inexistente (ajeno a la HU, ignorado por decisión).

## 11. Decisiones de diseño del PR

Confirmadas explícitamente antes de implementar.

**D1 — Endpoint de resolución nuevo (`PATCH …/operaciones/[id]/resolver`).** El spec §2.5 define el permiso `ventas:autorizar_excepcion_credito` pero **no expone ningún endpoint** para que el Supervisor apruebe o rechace una operación retenida (a diferencia de HU-B4, que tiene su `POST /[id]/override-descuento` dedicado). Se resolvió con el mismo patrón que HU-B4 y la anulación de pedido (§2.8 del spec): un `PATCH` dedicado, de un solo propósito, gateado por el permiso exclusivo del Supervisor. Consecuencia: el spec §2.5 quedó desactualizado respecto del código (§12, punto 4).

**D2 — Origen de `usuario_solicitante_id`: `PedidoVenta.registrado_por_id`, sin migración.** Alternativa descartada: agregar una columna `registrado_por_id` a `CuentaCorrienteOperacion` (exigía migración con aprobación explícita a mitad de sprint y backfill del seed). Razón de la elegida: coincide con el único camino productivo previsto —la integración con HU-B1, donde pedido y operación nacen en la misma sesión—. **Limitación conocida:** si otro usuario registra la operación a mano por el endpoint, el evento sensible atribuye la solicitud al usuario que creó el pedido, no al que registró la operación. Documentada en el docstring del servicio y a documentar en el PR.

**D3 — Auto-aprobación permitida, sin control adicional.** Un usuario con ambos permisos (el Supervisor de Ventas, que hereda los del Cajero) puede registrar una operación y resolverla él mismo. Mismo criterio que HU-B4: la integridad descansa en `withPermission` (solo el Supervisor llega al `PATCH`) y en el `AuditLog` (que registra solicitante y autorizante), no en un control extra. **Decisión consciente**, no omisión.

**D4 — `422` con el id en `error.details.operacion_id`.** Precedente HU-G10 (`ServiceError.details`, que solo se serializa en las rutas que lo propagan). La operación `RETENIDA` debe estar committeada **antes** de lanzar el error, por eso el `throw` ocurre después de la transacción y del evento (§4.2). La Server Action devuelve el mismo `details`.

**D5 — El autorizante es la sesión; sin `supervisor_credencial` ni selector.** A diferencia de HU-B4 (gate del Cajero + Supervisor nombrado en el body y re-validado dentro de la transacción), acá el gate ya es el permiso exclusivo del Supervisor, así que quien resuelve es quien tiene la sesión. Se evitó copiar el patrón de doble validación donde no aplica; el costo es que el permiso se valida una sola vez, fuera de la transacción (§4.8).

**D6 — Validaciones adicionales sobre el alta.** `404` cuenta/pedido inexistente; `422` pedido de otro cliente y `422` pedido `ANULADO`/inactivo. El task file no las definía; sin ellas el endpoint aceptaría operaciones contra cualquier pedido.

**D7 — Concurrencia:** `SELECT … FOR UPDATE` en el alta y `updateMany({ where: { estado: "RETENIDA" } })` con `count === 1` en la resolución (§4.4).

**D8 — No revalidar el límite al aprobar una `RETENIDA`.** El saldo puede quedar por encima del límite; es el comportamiento esperado de una excepción de crédito.

**D9 — Handler de auditoría en `audit-log.listener.ts`** para `venta:excepcion_credito_resuelta`, mismo patrón que `venta:descuento_fuera_margen`, incluyendo `usuario_solicitante_id` (§5.3).

**D10 — Funciones de lectura extra para la UI** (`listarCuentasCorrientes`, `obtenerCuentaCorrienteDetalle`) más la vista de listado y detalle: sin ellas el Supervisor no tendría cómo descubrir ni resolver una operación retenida (el `GET` de §3.2 solo devuelve los cuatro campos de resumen).

**D11 — Reseteo del fixture por `UPDATE` (nunca `DELETE`) en los tests** y scripts `test:integration:b5` / `b5-http` en `package.json`. Las altas ad-hoc crean sus propios `PedidoVenta` y se dan de baja lógica al terminar.

## 12. Diferencias entre lo implementado y el task file / el spec

Relevadas contrastando el código commiteado contra `docs/tasks/task_HU-B5.md` y `spec_modulo_B.md`. Las marcadas ✔ están aprobadas explícitamente; las marcadas ⚠ **quedan abiertas**.

| # | Punto | Task file / spec | Código real |
|---|---|---|---|
| 1 | Rutas | `app/api/...`, `app/(dashboard)/...` | `src/app/api/...`, `src/app/(dashboard)/...` ✔ |
| 2 | `422` con el id | Task: "junto con el `id`"; spec §2.5: `{ data: null, error: { code, message } }` | `error.details.operacion_id` ✔ (D4) |
| 3 | Respuesta de éxito del `POST` | Spec §2.5 no la define; task: "200/201" | `201 { operacion_id, estado: "APROBADA" }` |
| 4 ⚠ | Spec sin actualizar | §2.5 no lista el `PATCH …/resolver`; §4 no lista `venta:excepcion_credito_resuelta` | El código los implementa; el spec **no fue modificado** por este PR |
| 5 | Payload del evento de alta | Spec §4: `{ cliente_id, pedido_venta_id, monto, plan_de_pagos? }` | Agrega `operacion_id` y `estado`; `plan_de_pagos.fecha_estimada` como string ISO |
| 6 ⚠ | Evento de alta "ya definido" | Task §2.5: "ya definidos en spec §4" | No estaba en `event-types.ts`; se creó en este PR. Además **no tiene consumidor** (ni `AuditLog` ni Módulo G) |
| 7 | `usuario_solicitante_id` | Task §2.3: "quien generó la operación original" | `PedidoVenta.registrado_por_id` ✔ (D2, limitación conocida) |
| 8 | Patrón de gate | Task §1: "gate único + validación interna del autorizante dentro de la transacción" | El autorizante es la sesión; el permiso se valida solo en el gate, sin `supervisor_credencial` ni re-validación interna (D5) |
| 9 | Campos de auditoría del evento sensible | Task §2.3 no incluye `dispositivo`/`timestamp` | Coincide con el task; difiere de HU-B4 (sí los captura). El spec §3.3 exige dispositivo y momento a sus tres eventos sensibles (anulación, descuento, cambio de precio), entre los que no está este |
| 10 | Historial de la cuenta | Spec §2.5: "facturas emitidas, pagos recibidos, notas de crédito" | Solo operaciones a cuenta; ningún código reduce `saldo_actual` (§7) |
| 11 | Unitarios de comportamiento | Task §4 Nivel 1: casos de `registrar`/`resolver` (dentro/fuera de límite, aprobar, rechazar, transición inválida) | Los unitarios son source-regex (el servicio no es importable en Node por `server-only`); el comportamiento se ejecuta en Nivel 3 |
| 12 | "Corridas separadas" | Task §5: aprobación y rechazo "en corridas separadas" | Dos subtests en **la misma corrida**, con reseteo del fixture por `UPDATE` entre ellos (no dos ejecuciones independientes) |
| 13 | UI de entrada | Task §2.6: desde la ficha del cliente **o** listado propio | Solo listado propio; no hay ficha de cliente ni formulario de alta de operación (la acción existe sin consumidor de UI) |
| 14 | Badge | Task §2.6: reusar el patrón de 3 estados de `AutorizacionItemBadge` | Decide por el enum `estado` (no por flags) y añade la variante "Aprobada por excepción" |
| 15 | Dialog | Task §2.6: "mismo patrón que el override de descuento" | Sin selector de Supervisor (D5) |
| 16 | Validaciones sobre el pedido | Task §2.2: no las define | Agregadas ✔ (D6) |
| 17 | Redondeo de `monto` | No especificado | `toDecimalPlaces(2)` antes de operar (§4.8) |
| 18 | Nombres | Task §2.3: `resolverExcepcionCredito()` como Server Action | La Server Action es `resolverExcepcionCreditoAction` (sufijo, patrón HU-B4) ✔ |
| 19 ⚠ | "Mergeado" | El pedido de este documento asumía código mergeado | **No está en `develop`**: vive en `feature/HU-B5` (pusheada). La rama apila HU-B3/B4/B8, que tampoco están en `develop` |
| 20 | Task file interno | Task §5: "los tres puntos de Fuera de alcance" | La §3 del task lista **cinco** puntos; sin efecto sobre el código |
| 21 ⚠ | Descripción de PR | Task §5: documentar en el PR la dependencia con HU-B1 | No existe descripción de PR en el repositorio; pendiente al abrirlo |

## 13. Testing — tres niveles

**Procedencia.** Las corridas de integración y HTTP se ejecutaron el 2026-09-18 sobre el código idéntico al commit `dd4624c` (el commit solo agregó archivos ya presentes en el working tree; el árbol estaba limpio), contra el Postgres local en Docker y el `next dev` en `localhost:3000`. Para este documento **solo se re-ejecutaron los unitarios de servicio y de schema** (sección 13.1); los resultados de 13.2 y 13.3 son los de la corrida original, no una nueva.

### 13.1. Nivel 1 — Unitarios (`npm test`: **318/318**)

Corrida real: `tests 318 · pass 318 · fail 0`, sin regresiones en el resto de la suite. `tsc --noEmit` → exit 0. `eslint` sobre los archivos tocados por la HU → sin errores (no se corrió sobre el proyecto completo).

| Archivo | Tests | Cubre |
|---|---|---|
| `cuenta-corriente.service.test.ts` (source-regex, sin DB) | **17/17** (re-ejecutado para este documento) | Permisos exportados = códigos del seed · un único `withPermission` por ruta y el `PATCH` con el permiso exclusivo del Supervisor (sin referenciar el del Cajero) · route/action sin `prisma` ni `$transaction` · `disponible` calculado dentro de la transacción tras el `FOR UPDATE` · `APROBADA`/`RETENIDA` según `monto.lte(disponible)` · `increment` del saldo solo si aprobada · validaciones de cuenta/pedido · `LIMITE_CREDITO_EXCEDIDO` lanzado tras el `COMMIT` y el evento, con `details.operacion_id` · evento único, post-transacción · guardia `updateMany`/`count !== 1` · `APROBAR` suma y `RECHAZAR` no · el resolver no revalida el límite · `randomUUID()` antes de la transacción · payload completo del evento sensible · solicitante desde `registrado_por_id` · sin `delete()`/`deleteMany()` · eventos tipados y handler del listener |
| `ventas.schema.test.ts` | +6 nuevos (**25/25** en el archivo, re-ejecutado) | Alta válida sin plan · `monto` 0/negativo y UUID inválido · validación de cada hito del plan y coerción de `fecha_estimada` a `Date` · `decision`/`motivo` de la resolución · UUID de path params |

### 13.2. Nivel 2 — HTTP con login real (`npm run test:integration:b5-http`: **14/14** = 1 raíz + 13 subtests)

Sesiones reales de `cajero.seed` y `supervisor.ventas.seed` contra `next dev`.

| Endpoint | Verificado |
|---|---|
| `GET` | Sin sesión → `401` · `cajero.seed` y `supervisor.ventas.seed` → `200` con el shape exacto de spec §2.5 · UUID inválido → `400` · cliente sin cuenta → `404 CUENTA_CORRIENTE_NO_ENCONTRADA` |
| `POST` | Sin sesión → `401` · body inválido → `400` · pedido inexistente → `404` · pedido de otro cliente → `422` · dentro de límite → `201 APROBADA` (con plan de pagos) · fuera de límite → `422 LIMITE_CREDITO_EXCEDIDO` con `error.details.operacion_id` y operación `RETENIDA` en BD con saldo intacto |
| `PATCH` | Sin sesión → `401` · `cajero.seed` → `403` sobre el fixture **y** sobre su propia retenida (sigue `RETENIDA`) · supervisor: motivo vacío → `400`, id inválido → `400`, id inexistente → `404` · `APROBAR` y `RECHAZAR` sobre el fixture → `200`, estado y saldo correctos, fila en `AuditLog` con el `autorizacion_id` de la respuesta · repetir → `409` con body exacto · flujo completo alta `422` → resolución `200` sobre una retenida creada por el Cajero |

### 13.3. Nivel 3 — Base de datos contra el fixture real (`npm run test:integration:b5`: **12/12** = 1 raíz + 11 subtests)

Contra Postgres real con el seed aplicado. Las aserciones leen la base con Prisma (`findUnique`/`findMany`), **no con SQL crudo**; el estado inicial y final del fixture se contrastó además a mano con `psql`.

- **Fixture de seed:** cuenta 500.000 / 120.000 / disponible 380.000; operación `APROBADA` y operación `RETENIDA` (413.000, `autorizado_por_id` nulo, sobre V-2026-000003).
- **Alta:** dentro del límite (saldo sube, evento `APROBADA`, plan de pagos persistido con `fecha_estimada` ISO) · fuera del límite (`RETENIDA` persistida, saldo intacto, `details.operacion_id`, evento `RETENIDA`) · monto igual al disponible → `APROBADA` (inclusivo) · validaciones 404/422 sin rastro en el saldo.
- **Fixture RETENIDA resuelto con `APROBAR` y con `RECHAZAR`** (subtests independientes, con reseteo por `UPDATE` entre ambos): estado y `autorizado_por_id` = supervisor; saldo `120.000 → 533.000` solo al aprobar; evento con el payload completo (solicitante = `cajero.seed`); fila de `AuditLog` con `usuario_id` autorizante, `valor_anterior { estado: "RETENIDA" }` y `autorizacion_id` de correlación; **hash SHA-256 recalculado** con `calcularHashEncadenado` igual al `hash_actual`, y `hash_anterior` igual al `hash_actual` del registro previo del ledger; reintentos de resolución → `TRANSICION_INVALIDA` sin cambiar el saldo.
- **Otros:** resolver la `APROBADA` de seed → `TRANSICION_INVALIDA`; operación inexistente → `OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA`.
- **Concurrencia:** dos altas simultáneas de 250.000 con 380.000 disponibles → una `APROBADA` y una `RETENIDA`, saldo `+250.000`; dos resoluciones simultáneas → una gana, la otra `TRANSICION_INVALIDA`, el saldo suma una sola vez.

Estado de la base al cierre de la corrida: fixture restaurado por `UPDATE` (cuenta en 120.000, operación de seed `RETENIDA`); operaciones y pedidos ad-hoc dados de baja lógica (`is_active: false`). Las filas de `audit_logs` son append-only y **quedan como residuo** (3 `EXCEPCION_CREDITO_*` de la corrida de servicio y las de la corrida HTTP).

### 13.4. Verificación de la UI (smoke, no QA visual)

Sesiones reales (`curl`) contra las páginas renderizadas en el servidor: con `supervisor.ventas.seed`, el detalle de Juan Pérez muestra la operación `Retenida`, la `Aprobada`, el pedido V-2026-000003 y el botón "Resolver excepción"; con `cajero.seed`, muestra lo mismo **sin** el botón; sin sesión, el listado redirige (`307`) a `/login`. **No se hizo QA visual en navegador real** (a diferencia de HU-B4): no se verificó el layout, el Dialog abierto ni el flujo completo de resolución desde la UI.

### 13.5. Regresión sobre suites existentes de Módulo B

`test:integration:b3` → 10/10 · `test:integration:b4-http` → 6/6 · `test:integration:b8` → 8/8. **`test:integration:b4` → 6/9 (3 fallos)**: el subtest que afirma que el ítem de `V-2026-000003` está pendiente de autorización (y el que depende de él) falla porque ese ítem **ya estaba autorizado en la base local** por una sesión de QA manual previa ("QA visual HU-B4", 2026-09-18 03:46, ~20 h antes de esta corrida). No es una regresión de HU-B5: es fixture consumido, la misma situación que ya documenta `HU4_MODULO_B.md` §7.2. Sigue **sin restaurarse** (no se pidió) y las corridas de B4 dejaron 2 filas `DESCUENTO_FUERA_MARGEN` de tests ad-hoc.

## 14. Pendientes y deuda documentada

1. **Mergear** `feature/HU-B5` (junto con su base B3/B4/B8) a `develop`; abrir el PR con la descripción que documente: la dependencia pendiente con HU-B1, la limitación de `usuario_solicitante_id` (D2) y la auto-aprobación como decisión consciente (D3).
2. **Actualizar `spec_modulo_B.md`** (§2.5: el `PATCH …/resolver` y el shape del `422` con `details`; §4: `venta:excepcion_credito_resuelta` y los campos agregados a `venta:operacion_cuenta_corriente_registrada`) y, si corresponde, `task_HU-B5.md`.
3. **Decidir sobre la auditoría del alta:** `venta:operacion_cuenta_corriente_registrada` no genera fila en `AuditLog` (RULES.md §2 exige registrar toda acción que modifica el estado) y no tiene consumidor de Módulo G. Un handler de auditoría es un cambio de pocas líneas.
4. **Integración HU-B1** → `registrarOperacionCuentaCorriente()` desde `pedido-venta.service.ts`, coordinada con su dueño.
5. **Consumo del `plan_de_pagos` por Módulo G** y **registro de pagos/notas de crédito** que reduzcan el saldo (hoy `saldo_actual` solo crece).
6. **Guardas de entrada** ante los límites de §4.8 (monto que redondea a 0, tope de `Decimal(12,2)`, suma de porcentajes del plan, duplicados por pedido) si el negocio los necesita.
7. **Restaurar el fixture de HU-B4** en la base de desarrollo para poder re-ejecutar `test:integration:b4`.
8. **QA visual en navegador real** de `/ventas/cuentas-corrientes` (no realizado).
