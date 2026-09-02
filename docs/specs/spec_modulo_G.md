# Especificación Técnica — Módulo G (Gestión de Caja y Tesorería)
## Contenido para Sprint 2 — SOLO HU-G8 (recorte por asignación de equipo)
## Revisión 2 — verificada contra el repositorio

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM 6 · TypeScript (strict) · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Trazabilidad Inalterable, hash SHA-256 encadenado) · `Documento de Alcance Funcional y Técnico` (sección Módulo G; sección 2.1 "Flujo de estados de una Orden de Compra"; sección 3.4 corregida — Módulo H como fuente de la proyección de egresos junto con B/C/E; sección 5 y 5.1 — matriz de acceso y restricción de datos bancarios) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja `Sprint 2`, HU-G8) · `schema.prisma` (modelos `CuentaPorPagar`, `OrdenCompra`, `OrdenCompraItem`, `Recepcion`, `RecepcionItem`, `Proveedor`) · `spec_modulo_H.md` (evento `orden_compra:estado_cambiado`, emitido por HU-H3)

---

## ⚠️ Alcance de este documento

**Este documento NO cubre todo el Módulo G.** Cubre exclusivamente **HU-G8** (Compromisos de Pago / Cuenta por Pagar), única HU de Módulo G asignada en Sprint 2. HU-G7 (posición diaria de tesorería) y el resto de Módulo G quedan fuera por asignación de equipo, no por decisión del PO.

**El modelo `CuentaPorPagar` y el enum `EstadoCuentaPorPagar` YA EXISTEN migrados** (`prisma/schema.prisma:906-938`, migración `20260831031138_sprint2`). Esta HU **no crea modelo nuevo ni migración de schema**. El único cambio adyacente a la base de datos es el alta de dos permisos en `prisma/seed.ts`.

**Estado de las dependencias externas de HU-G8:**

| Dependencia | Estado |
|---|---|
| Evento `orden_compra:estado_cambiado` (HU-H3) | ✅ Confirmado y mergeado. Se emite en las transiciones a `ENVIADA`, `CONFIRMADA`, `CERRADA` y `CANCELADA` (`src/lib/services/proveedores/orden-compra.service.ts:432-444`). |
| Evento propio de "recepción total cerrada" (HU-H4) | ❌ **No se necesita.** La hipótesis de la Revisión 1 quedó confirmada: el evento genérico de HU-H3 ya cubre la transición `RECIBIDA_COMPLETA → CERRADA` y alcanza para disparar la consolidación a `DEFINITIVA`. Ver sección 2.2. |
| `recepcion.service.ts` (HU-H4, Emir) | ⏳ No implementado. No bloquea la **construcción** de HU-G8, pero sí la **verificación en runtime** de la ruta `PROVISORIO → DEFINITIVA` (nada produce `RECIBIDA_COMPLETA` todavía). Ver sección 5. |

---

## 1. Visión General

HU-G8 es una **máquina de estados reactiva**. No expone un formulario de alta manual: reacciona a `orden_compra:estado_cambiado` (Módulo H) para mantener sincronizado el ciclo `PROVISORIO → DEFINITIVA → PAGADA` (más `CANCELADA`) de `CuentaPorPagar`.

La especificación define:

- **Un listener** (`src/lib/events/listeners/cuenta-por-pagar.listener.ts`) con tres ramas reactivas (2.1, 2.2, 2.3).
- **Un evento de dominio nuevo** `cuenta_por_pagar:estado_cambiado` (sección 4), consumido por el listener de auditoría existente.
- **Una mutación manual acotada** — marcar una Cuenta por Pagar `DEFINITIVA` como `PAGADA` (2.4).
- **Un endpoint de consulta** de solo lectura (2.5), base futura de HU-G7 y superficie de verificación vía Postman.

No hay UI de creación propia en el alcance de HU-G8.

**Patrón arquitectónico nuevo:** este es el primer listener del proyecto que **escribe estado de dominio** dentro de su propia `prisma.$transaction` y **emite un evento de seguimiento** post-commit. Todos los listeners existentes solo apéndican al `AuditLog`. El docstring del listener debe dejar constancia de que es el patrón de referencia para futuras proyecciones entre módulos.

---

## 2. Interfaces y Contratos

### Payload consumido — `OrdenCompraEstadoCambiadoPayload`

Definición real en `src/lib/events/event-types.ts:265-276` (verificada). **La Revisión 1 asumía nombres incorrectos.** Shape real:

```typescript
interface OrdenCompraEstadoCambiadoPayload {
  orden_compra_id: string;
  numero_orden: string;
  estado_anterior: string;                 // EstadoOrdenCompra
  estado_nuevo: string;                    // EstadoOrdenCompra  (NO "nuevo_estado")
  accion: "ENVIAR" | "CONFIRMAR" | "CERRAR" | "CANCELAR";
  cambiado_por: string;                    // usuario_id         (NO "usuario_id")
  fecha_entrega_comprometida: string | null; // presente solo en CONFIRMAR, ISO 8601
  deletion_reason: string | null;         // presente solo en CANCELAR (baja lógica de la OC)
}
```

Valores de `EstadoOrdenCompra` (`schema.prisma:719-727`): `BORRADOR`, `ENVIADA`, `CONFIRMADA`, `RECEPCION_PARCIAL`, `RECIBIDA_COMPLETA`, `CERRADA`, `CANCELADA`.
`CANCELAR` solo es válido desde `[BORRADOR, ENVIADA]` (`orden-compra.service.ts:67-72`).

El listener **discrimina por `payload.accion`**, no por `estado_nuevo`.

---

### 2.1. Rama — Generación de Cuenta por Pagar provisoria (criterios 1 y 2)

**Disparador:** `payload.accion === "ENVIAR"` (transición `BORRADOR → ENVIADA`, la que requiere aprobación previa del Supervisor de Compras — no existe un estado `APROBADA` en `EstadoOrdenCompra`).

**Servicio:** `generarCuentaPorPagarProvisoria(payload)` en `src/lib/services/tesoreria/cuenta-por-pagar.service.ts`.

**Comportamiento — dentro de `prisma.$transaction`:**

1. **Idempotencia:** `findFirst` de una `CuentaPorPagar` activa en `PROVISORIO` para esa `orden_compra_id`. Si ya existe, retorna `null` (no escribe, no error) — evita duplicados ante reintentos del bus.
2. Recalcula `monto = Σ(cantidad_solicitada × precio_unitario)` sobre los `OrdenCompraItem` con `is_active: true` de esa orden. El cálculo usa `Prisma.Decimal` (`precio_unitario.mul(cantidad_solicitada)` reducido con `.add`), **nunca `number` de JavaScript ni `.toNumber()`**. `OrdenCompraItem.precio_unitario` es `Decimal(10,2)` y `cantidad_solicitada` es `Int`; el resultado en escala 2 entra sin redondeo en `CuentaPorPagar.monto Decimal(12,2)`. (`Prisma.aggregate._sum` no puede expresar un producto por fila, por eso se usa `findMany` + reduce.)
3. Resuelve `proveedor_id` y `numero_orden` (del payload o vía `tx.ordenCompra` con `select`).
4. `tx.cuentaPorPagar.create({ data: { orden_compra_id, monto, estado: "PROVISORIO", fecha_vencimiento: null, recepcion_id: null, is_active: true }, select: { id: true, monto: true } })`.

**Post-commit:** emite `cuenta_por_pagar:estado_cambiado` con `accion: "CREAR"` (`estado_anterior: null`, `monto_anterior: null`, `monto_nuevo: monto.toString()`). Patrón fire-and-forget, después de que la transacción resuelve.

**`fecha_vencimiento`:** queda `null`. `Proveedor.condiciones_pago` **sí existe migrado** (`schema.prisma:530`, `String?`), pero es **texto libre** ("Contado", "30 días", "60 días FF") — no parseable de forma confiable a una cantidad de días. Ningún criterio de aceptación de HU-G8 define el cálculo del vencimiento. Queda `null` hasta que el campo se estructure en otra HU.

---

### 2.2. Rama — Consolidación a Cuenta por Pagar definitiva (criterios 3 y 4)

**Disparador:** `payload.accion === "CERRAR"` (`estado_nuevo === "CERRADA"`), con guarda adicional `estado_anterior === "RECIBIDA_COMPLETA"` — para no reaccionar ante otras rutas hacia `CERRADA` que no correspondan al cierre por conciliación de factura.

**Hipótesis de la Revisión 1 — CONFIRMADA.** El evento `orden_compra:estado_cambiado` ya cubre la transición `RECIBIDA_COMPLETA → CERRADA` (acción `CERRAR`, `orden-compra.service.ts:67-72`). **HU-G8 no necesita un evento propio de HU-H4** para saber *cuándo* consolidar. Para saber *qué* `Recepcion` asociar, se resuelve por query directa contra `Recepcion` (no por evento).

**Servicio:** `consolidarCuentaPorPagarDefinitiva(payload)`.

**Comportamiento — dentro de `prisma.$transaction`:**

1. `findFirst` de la `CuentaPorPagar` activa en `PROVISORIO` de esa `orden_compra_id` (`select: { id, monto }`). Si no existe, **loguea con `orden_compra_id` y retorna `null` — no lanza excepción** (el listener no tiene un llamador HTTP al que responder).
2. Recalcula `monto` sobre los `OrdenCompraItem` activos actuales (misma fórmula que 2.1). El criterio 4 pide que el monto se calcule **siempre sobre lo efectivamente recibido y validado**; hasta que exista HU-H4 no hay `RecepcionItem`, así que hoy se recalcula sobre lo pedido. Cualquier diferencia con el monto provisorio previo **se toma en silencio** — es el comportamiento esperado, no una excepción a resolver. La discrepancia queda trazada por los campos `monto_anterior` / `monto_nuevo` del evento hacia el `AuditLog` (sección 4).
3. Resuelve `recepcion_id`: la `Recepcion` activa más reciente de esa orden (`findFirst({ where: { orden_compra_id, is_active: true }, orderBy: { fecha_recepcion: "desc" }, select: { id: true } })`). **Hoy devuelve `null`** porque no hay filas `Recepcion` (HU-H4 no implementado).
4. `updateMany({ where: { id, estado: "PROVISORIO", is_active: true }, data: { estado: "DEFINITIVA", monto, recepcion_id } })` (escritura guardada, concurrencia optimista). Si `count === 0`, retorna `null`.

**No crea una fila nueva** — reemplaza sobre el mismo registro (un solo ciclo de vida).

**Post-commit:** emite `cuenta_por_pagar:estado_cambiado` con `accion: "DEFINIR"` (`monto_anterior` = monto provisorio leído en el paso 1; `monto_nuevo` = recalculado; `recepcion_id`).

**Ruta hacia adelante (HU-H4):** cuando exista `recepcion.service.ts`, el paso 2 recalculará sobre `RecepcionItem.cantidad_recibida` y el paso 3 devolverá el `recepcion_id` real de cierre. La verificación end-to-end de esta rama queda **diferida a HU-H4** (ver sección 5); su comportamiento a nivel unitario sí es verificable ahora.

---

### 2.3. Rama — Cancelación de Cuenta por Pagar (estado `CANCELADA`)

**Disparador:** `payload.accion === "CANCELAR"` (`estado_nuevo === "CANCELADA"`).

**Servicio:** `cancelarCuentaPorPagar(payload)`.

**Comportamiento — dentro de `prisma.$transaction`:**

1. `findFirst` de la `CuentaPorPagar` activa en `PROVISORIO` de esa `orden_compra_id`. Si no existe (caso: OC cancelada desde `BORRADOR`, que nunca generó `CuentaPorPagar`), **retorna `null` — no es un error**, es un evento válido sin efecto sobre este módulo.
2. `updateMany({ where: { id, estado: "PROVISORIO", is_active: true }, data: { estado: "CANCELADA", deletion_reason: payload.deletion_reason } })`.

**La fila permanece `is_active: true`**, con `deleted_at` y `deleted_by` en `null`. La transición a `CANCELADA` **no es baja lógica del registro** — el registro sigue consultable, solo cambia su `estado`. `deletion_reason` se reutiliza únicamente como portador del motivo de la cancelación funcional. Un comentario en el código debe dejar esto explícito para que nadie "complete" la tripleta de baja lógica.

**Post-commit:** emite `cuenta_por_pagar:estado_cambiado` con `accion: "CANCELAR"` (`monto_anterior === monto_nuevo`, `deletion_reason` seteado).

---

### 2.4. Mutación — Marcar Cuenta por Pagar como pagada (criterio 5)

**Ruta:** `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar` → `src/app/api/tesoreria/cuentas-por-pagar/[id]/pagar/route.ts`
**Permiso requerido:** `cuentas_por_pagar:pagar` (rol `TESORERO_CENTRAL` únicamente).
**Enforcement:** `withAuth(handler)` + `usuarioTienePermiso(session.userId, "cuentas_por_pagar:pagar")` inline (patrón de `src/app/api/ordenes-compra/[id]/estado/route.ts`, porque el permiso es específico de la ruta).

Esta es la **única mutación manual** de HU-G8. No hay modelo `OrdenPago` propio: "efectivizar" es este endpoint, que persiste el resultado directamente sobre `CuentaPorPagar`. **No exige evidencia de pago** (medio, referencia, comprobante) ni admite **pago parcial** — es todo-o-nada: `estado: PAGADA` + `fecha_pago`.

```typescript
export const MarcarPagadaSchema = z.object({
  fecha_pago: z.coerce.date().default(() => new Date()),
});
// El body es opcional; en la route se usa MarcarPagadaSchema.safeParse(body ?? {}).
```

**Servicio:** `marcarCuentaPorPagarPagada(cuentaPorPagarId, input, usuarioId)` (orden de argumentos igual a `cambiarEstadoOrdenCompra`).

**Comportamiento — dentro de `prisma.$transaction`:**

1. `findFirst` por `id` (`select: { id, estado, is_active, monto, orden_compra_id, orden_compra: { select: { numero_orden: true, proveedor_id: true } } }`).
   - No existe → `ServiceError("CUENTA_POR_PAGAR_NO_ENCONTRADA")`.
   - `!is_active` → `ServiceError("TRANSICION_INVALIDA")`.
   - `estado !== "DEFINITIVA"` → `ServiceError("TRANSICION_INVALIDA", "No es posible pagar una cuenta en estado " + estado)`.
2. `updateMany({ where: { id, estado: "DEFINITIVA", is_active: true }, data: { estado: "PAGADA", fecha_pago } })`. Si `count === 0` → `ServiceError("TRANSICION_INVALIDA", "El estado de la cuenta cambió durante la operación; reintentá")`.

`fecha_pago = input.fecha_pago ?? new Date()`.

**Post-commit (dentro del servicio, como `orden-compra.service.ts:432`):** emite `cuenta_por_pagar:estado_cambiado` con `accion: "PAGAR"`, `estado_anterior: "DEFINITIVA"`, `estado_nuevo: "PAGADA"`, `fecha_pago: fecha_pago.toISOString()`, `proveedor_id`.

**Notificación al Módulo H (criterio 5 — "reflejarlo en el historial del proveedor"):** el payload lleva `proveedor_id`. Módulo H se suscribe a `cuenta_por_pagar:estado_cambiado` filtrando `accion === "PAGAR"`; no se define un evento dedicado. Decisión de implementación reversible: si más adelante hace falta un `proveedor:pago_registrado` propio, se agrega sin tocar el path de escritura de HU-G8.

**Respuesta `200 OK`:**
```json
{
  "data": { "cuenta_por_pagar_id": "uuid", "estado_anterior": "DEFINITIVA", "estado_nuevo": "PAGADA", "fecha_pago": "2026-09-10T14:00:00.000Z" },
  "error": null
}
```

**Errores** (envelope `{ data: null, error: { code, message } }`, mapa local `STATUS_POR_CODIGO`):

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `id` de path inválido, o body inválido (`fieldErrors`) |
| `FORBIDDEN` | 403 | El usuario no tiene `cuentas_por_pagar:pagar` |
| `CUENTA_POR_PAGAR_NO_ENCONTRADA` | 404 | No existe la fila |
| `TRANSICION_INVALIDA` | 409 | La cuenta no está `DEFINITIVA` (está `PROVISORIO`, `PAGADA` o `CANCELADA`), o cambió durante la operación |
| `INTERNAL_ERROR` | 500 | Error inesperado |

> El código es **`TRANSICION_INVALIDA`**, no el `ESTADO_INVALIDO` que asumía la Revisión 1 — es la convención `ServiceError` ya usada por Módulo H.

**Orden de validación en la route:** (1) `id` de path → (2) body → (3) permiso.

---

### 2.5. Consulta — Listado de Cuentas por Pagar

**Ruta:** `GET /api/tesoreria/cuentas-por-pagar` → `src/app/api/tesoreria/cuentas-por-pagar/route.ts`
**Permiso requerido:** `cuentas_por_pagar:leer`.
**Enforcement:** `withPermission(PERMISO_LEER_CUENTAS_POR_PAGAR, handler)` (HOF, porque el acceso está totalmente determinado por el permiso).

```typescript
export const FiltrosListadoCuentasPorPagarSchema = z.object({
  estado: z.enum(["PROVISORIO", "DEFINITIVA", "PAGADA", "CANCELADA"]).optional(),
  orden_compra_id: z.string().uuid().optional(),
  proveedor_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});
```

> Convención de paginación **`page` / `page_size`** y respuesta `{ registros, total, page, page_size }`, alineada al precedente real del proyecto (`src/app/api/auditoria/logs/route.ts`, `auditoria.schema.ts`). Reemplaza la forma `pagina` / `por_pagina` del borrador.

**Comportamiento:**

- Parseo: `Object.fromEntries(req.nextUrl.searchParams.entries())` → `safeParse` → `400 VALIDATION_ERROR` con `fieldErrors` si falla.
- `where: { is_active: true, ...(estado && { estado }), ...(orden_compra_id && { orden_compra_id }), ...(proveedor_id && { orden_compra: { proveedor_id } }) }`.
- `Promise.all([ prisma.cuentaPorPagar.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * page_size, take: page_size, select: <árbol> }), prisma.cuentaPorPagar.count({ where }) ])`. (No se usa `prisma.$transaction([...])` para pares de lectura — no hay precedente en el código.)
- Cada fila expone su `estado` tal cual, incluido `PROVISORIO` (ver 3.1).
- `monto` se mapea a **`string`** vía `.toString()` (no `.toNumber()`) — un valor monetario en un contrato de API no debe pasar por IEEE-754. El formateo de presentación es responsabilidad de la UI.

**Árbol de `select` (whitelist del proveedor — restricción de datos sensibles):**

```typescript
select: {
  id: true, orden_compra_id: true, recepcion_id: true, monto: true, estado: true,
  fecha_vencimiento: true, fecha_pago: true, is_active: true, deletion_reason: true, created_at: true,
  orden_compra: {
    select: {
      id: true, numero_orden: true, estado: true, fecha_emision: true,
      proveedor: {
        select: { id: true, razon_social: true, nombre_fantasia: true, cuit: true, estado: true },
      },
    },
  },
}
```

> **Nunca `include: true` sobre `Proveedor`.** El `Proveedor` tiene `datos_bancarios_cifrado` y `datos_bancarios_iv` (`schema.prisma:544,548`), que el Alcance §5.1 restringe a Tesorero Central y Administrador únicamente, con independencia de este permiso de lectura general. El `select` explícito los excluye siempre. La verificación (7.5) debe aseverar que el objeto `proveedor` de cada fila trae **solo** los 5 campos de la whitelist.

No existe UI propia para este endpoint en Sprint 2 (no hay HU-G7 que la consuma). Su propósito ahora es permitir verificación con evidencia (Postman) de las tres ramas del listener y de la mutación de pago.

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. El `PROVISORIO` nunca es deuda exigible
Es informativo. El `GET` (2.5) expone `estado` por fila tal cual. Excluir `PROVISORIO` de cualquier agregado de "deuda pendiente" o proyección de caja es **responsabilidad de HU-G7**, no de HU-G8. El modelo no lo impide a nivel de constraint (mismo criterio en el JSDoc de `CuentaPorPagar` en `schema.prisma:897-905`).

### 3.2. Transiciones de estado exclusivamente vía listener o el endpoint de pago
No existe (ni debe existir) un `PATCH` genérico de `estado` sobre `CuentaPorPagar`. Las únicas mutaciones válidas son las tres ramas automáticas de 2.1/2.2/2.3 y la mutación manual de 2.4.

### 3.3. Auditoría SHA-256 reutilizando el mecanismo existente
Ninguna sección implementa hashing propio. Todas las transiciones emiten `cuenta_por_pagar:estado_cambiado`, consumido por `iniciarAuditLogListener()` en `src/lib/events/listeners/audit-log.listener.ts`, que llama `registrarAuditLog(...)`. **Ningún servicio de dominio llama `registrarAuditLog()` directamente.** Cada transición es un registro de auditoría independiente — nunca se agrupan. Tras las escrituras, `/api/auditoria/verificar-cadena` debe seguir reportando la cadena íntegra.

### 3.4. Restricción de borrado físico
`CuentaPorPagar` usa el bloque estándar de baja lógica (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`), ya migrado. La transición a `CANCELADA` (2.3) **no** es baja lógica: `is_active` permanece `true`. `deletion_reason` se reutiliza como motivo de la cancelación funcional.

### 3.5. Idempotencia de listeners
Cada rama es idempotente: la rama de creación verifica un `PROVISORIO` activo previo; las ramas de actualización usan `updateMany` guardado por `estado` y tratan `count === 0` como no-op (retornan `null`), no como error. `iniciarCuentaPorPagarListener()` tiene guarda de registro único (`let registrado = false`).

### 3.6. Fallo del listener — sin conciliación en este slice
El evento `orden_compra:estado_cambiado` es post-commit fire-and-forget: si `generarCuentaPorPagarProvisoria` falla, la OC ya está `ENVIADA` y no hay `CuentaPorPagar`. **No hay job de conciliación en HU-G8.** La recuperación es replay manual, guiado por el `console.error` (que debe incluir `orden_compra_id`). Detectar OC en `ENVIADA` sin `CuentaPorPagar` asociada es el lugar natural de HU-G7. Cada rama del listener envuelve `servicio + emit` en un `try/catch` que loguea y **nunca relanza** hacia el bus.

---

## 4. Eventos de Dominio (EDA)

| Evento | Disparado por | Consumidor | Payload |
|---|---|---|---|
| `orden_compra:estado_cambiado` *(consumido)* | HU-H3 | Listener de 2.1/2.2/2.3 | Ver "Payload consumido" arriba — shape real de `event-types.ts:265-276` |
| `cuenta_por_pagar:estado_cambiado` *(nuevo)* | 2.1, 2.2, 2.3, 2.4 | `audit-log.listener.ts` | Ver abajo |

### 4.1. `CuentaPorPagarEstadoCambiadoPayload`

Se agrega a `src/lib/events/event-types.ts` (interface después de `ProveedorEstadoCambiadoPayload`, más una entrada en `DomainEventMap`). Convenciones: `monto_*` como `string` (`Prisma.Decimal` serializado), fechas ISO 8601 o `null`.

```typescript
interface CuentaPorPagarEstadoCambiadoPayload {
  cuenta_por_pagar_id: string;
  orden_compra_id: string;
  numero_orden: string;
  proveedor_id: string;
  estado_anterior: "PROVISORIO" | "DEFINITIVA" | "PAGADA" | "CANCELADA" | null; // null solo en CREAR
  estado_nuevo:    "PROVISORIO" | "DEFINITIVA" | "PAGADA" | "CANCELADA";
  accion: "CREAR" | "DEFINIR" | "PAGAR" | "CANCELAR";
  cambiado_por: string;
  monto_anterior: string | null;  // null en CREAR; en DEFINIR = monto provisorio previo al recálculo
  monto_nuevo: string;
  recepcion_id: string | null;    // presente solo en DEFINIR
  fecha_vencimiento: string | null; // siempre null en HU-G8
  fecha_pago: string | null;      // presente solo en PAGAR
  deletion_reason: string | null; // presente solo en CANCELAR
}
```

### 4.2. Handler de auditoría

Bloque `domainEventBus.on("cuenta_por_pagar:estado_cambiado", ...)` agregado dentro de `iniciarAuditLogListener()`, después del bloque de `proveedor:estado_cambiado`:

- `usuario_id: payload.cambiado_por`
- `accion: payload.accion === "CREAR" ? "CREATE" : "UPDATE_ESTADO"` — **incluido `CANCELAR`, que mapea a `UPDATE_ESTADO`, no a `DELETE_LOGICO`** (la fila sigue `is_active: true`; es un cambio de estado, no una baja lógica). Diverge a propósito del handler de `orden_compra:estado_cambiado`, que mapea su `CANCELAR` a `DELETE_LOGICO`. Llevar un comentario como el de `audit-log.listener.ts:412-417`.
- `tabla_afectada: "cuentas_por_pagar"`
- `registro_id: payload.cuenta_por_pagar_id`
- `ip: "internal-event"` (evento de servicio post-commit sin request HTTP)
- `valor_anterior`: `null` en `CREAR`; si no, `{ estado: payload.estado_anterior, monto: payload.monto_anterior }`
- `valor_nuevo`: `{ estado, accion, monto: monto_nuevo, orden_compra_id, numero_orden, proveedor_id, ...(recepcion_id ? { recepcion_id } : {}), ...(fecha_pago ? { fecha_pago } : {}), ...(deletion_reason ? { deletion_reason } : {}) }`

Los campos planos `monto_anterior` / `monto_nuevo` son la única traza de una discrepancia de monto en la consolidación (2.2) — se reconstruyen a `valor_*` en el handler, como hacen los demás handlers del proyecto (ninguno recibe un `valor_*` pre-armado).

### 4.3. Registro del listener

`src/lib/events/domain-event-bus.ts`: se agrega un **segundo** `void import("@/lib/events/listeners/cuenta-por-pagar.listener").then(({ iniciarCuentaPorPagarListener }) => iniciarCuentaPorPagarListener())` inmediatamente después del import del audit-log listener. El import del audit-log queda **primero** (el `EventEmitter` despacha en orden de registro, así el asiento de auditoría de la propia OC se encola antes del trabajo de CxP).

### 4.4. Seguridad del grafo de eventos

El grafo es un DAG de profundidad máxima 2:

```
orden_compra:estado_cambiado ─┬─► audit-log.listener ──► AuditLog        (no emite)
                              └─► cuenta-por-pagar.listener ──► escritura CxP
                                        └──► cuenta_por_pagar:estado_cambiado
                                                    └─► audit-log.listener ──► AuditLog (no emite)

PATCH /pagar ──► marcarCuentaPorPagarPagada ──► cuenta_por_pagar:estado_cambiado ──► audit-log.listener (terminal)
```

`cuenta_por_pagar:estado_cambiado` tiene exactamente un suscriptor (el handler de auditoría), que no emite nada. `cuenta-por-pagar.listener` se suscribe solo a `orden_compra:*`, nunca a su propio evento. No hay ciclo.

---

## 5. Pendientes de Verificación / Fuera de Alcance

- **`cuentas_por_pagar:leer` para `CAJERO_POS` — diferido.** Por decisión ya tomada (Alcance §3.4 / §5 corregidos), `cuentas_por_pagar:leer` debería incluir el rol `CAJERO_POS` además de `TESORERO_CENTRAL`, `AUDITOR` y `ADMINISTRADOR`. **El rol `CAJERO_POS` no existe todavía en el repositorio** (`prisma/seed.ts`). Esto **no** es un cambio de la decisión de diseño: es una **dependencia de secuencia con Módulo B / RBAC**. Nota para quien implemente Módulo B: al crear `CAJERO_POS`, agregar su vínculo con `cuentas_por_pagar:leer`. HU-G8 siembra el permiso vinculado a los 3 roles existentes.
- **Verificación end-to-end de `PROVISORIO → DEFINITIVA` — diferida a HU-H4.** Nada produce `RECIBIDA_COMPLETA` sin `recepcion.service.ts`. El comportamiento a nivel unitario se cubre ahora; el end-to-end con evidencia Postman + SQL queda pendiente. Chequeo manual puntual posible: forzar la OC sembrada a `RECIBIDA_COMPLETA` vía Prisma Studio.
- **`fecha_vencimiento` del `PROVISORIO`** — `null`. `Proveedor.condiciones_pago` existe pero es texto libre. Estructurar el campo es materia de otra HU.
- **`recepcion_id` en la consolidación** — `null` hasta HU-H4. Cuando exista, se resuelve a la `Recepcion` de cierre real y el `monto` se recalcula sobre `RecepcionItem.cantidad_recibida`.
- **Sin uniqueness a nivel DB** de un `PROVISORIO` activo por OC (no se permite migración en esta HU). La garantía es solo de capa de aplicación; un doble-emit genuinamente simultáneo podría crear dos filas. Aceptado.
- **HU-G7 y el resto de Módulo G** — fuera de este documento.

---

## 6. Plan de Verificación en Runtime (RULES.md)

Evidencia obligatoria: **Postman + SQL + capturas**. Compilar sin errores **no** es evidencia. Cada PR encadenado lleva su propia evidencia parcial en su checklist.

| # | Verificación | Estado |
|---|---|---|
| 1 | OC `ENVIAR` → se crea fila `PROVISORIO` con el `monto` sumado; re-emisión no crea otra | Verificable ahora |
| 2 | OC `CANCELAR` desde `ENVIADA` → fila a `CANCELADA`, `deletion_reason` seteado, `is_active` sigue `true` | Verificable ahora |
| 3 | OC `CANCELAR` desde `BORRADOR` → sin fila, sin error | Verificable ahora |
| 4 | `PATCH .../pagar` sobre fila `DEFINITIVA` sembrada a mano → `PAGADA` + `fecha_pago`; sobre `PROVISORIO`/`PAGADA`/`CANCELADA` → `409 TRANSICION_INVALIDA`; sin permiso → `403` | Verificable ahora |
| 5 | `GET` con filtros `estado` + `proveedor_id` + paginación; el objeto `proveedor` expone **solo** los 5 campos de la whitelist (sin `datos_bancarios_*`) | Verificable ahora |
| 6 | `/api/auditoria/verificar-cadena` reporta la cadena íntegra tras todo lo anterior | Verificable ahora |
| 7 | `CERRAR → DEFINITIVA` end-to-end | **Diferido (HU-H4)** — unitario cubierto; chequeo puntual con Prisma Studio |

---

## 7. Permisos (seed)

`prisma/seed.ts`, patrón granular de HU-H3 (constantes UUID fijas, upsert idempotente):

| Código | `modulo` | Roles vinculados |
|---|---|---|
| `cuentas_por_pagar:leer` | `MODULO_G` | `TESORERO_CENTRAL`, `AUDITOR`, `ADMINISTRADOR` (y `CAJERO_POS` cuando exista — ver §5) |
| `cuentas_por_pagar:pagar` | `MODULO_G` | `TESORERO_CENTRAL` |

- No se crea `cuentas_por_pagar:cancelar` — la cancelación es automática vía listener, no un endpoint manual.
- No se crea el rol `CAJERO_POS`.
- El placeholder `tesoreria:operar` (`MODULO_G`) queda **supersedido**: se elimina su vínculo `RolPermiso` con `TESORERO_CENTRAL` (vía `deleteMany`), se actualiza la descripción de la fila `Permiso` para dejar constancia, y **la fila `Permiso` se conserva** (no se borra — precedente de vínculos revocados en `seed.ts`, y para no orfanar referencias históricas del `AuditLog`).

---

## 8. Archivos afectados

| Archivo | Acción |
|---|---|
| `src/lib/events/event-types.ts` | Modificar — `CuentaPorPagarEstadoCambiadoPayload` + entrada en `DomainEventMap` |
| `src/lib/events/domain-event-bus.ts` | Modificar — segundo import dinámico de registro |
| `src/lib/events/listeners/audit-log.listener.ts` | Modificar — handler de `cuenta_por_pagar:estado_cambiado` |
| `src/lib/events/listeners/cuenta-por-pagar.listener.ts` | **Crear** — listener reactivo (ramas 2.1/2.2/2.3) |
| `src/lib/services/tesoreria/cuenta-por-pagar.service.ts` | **Crear** — carpeta `tesoreria/` nueva; lógica transaccional + helpers puros + constantes de permiso |
| `src/lib/schemas/cuentas-por-pagar.schema.ts` | **Crear** — Zod (`CuentaPorPagarIdSchema`, `MarcarPagadaSchema`, `FiltrosListadoCuentasPorPagarSchema`) |
| `src/app/api/tesoreria/cuentas-por-pagar/route.ts` | **Crear** — `GET` listado |
| `src/app/api/tesoreria/cuentas-por-pagar/[id]/pagar/route.ts` | **Crear** — `PATCH` pago |
| `prisma/seed.ts` | Modificar — dos permisos + vínculos de rol; retiro del vínculo `tesoreria:operar` |
| `src/lib/services/tesoreria/cuenta-por-pagar.monto.test.ts` | **Crear** — unit test de `calcularMontoDesdeItems` |
| `src/lib/services/tesoreria/cuenta-por-pagar.estado.test.ts` | **Crear** — unit test de `esTransicionValidaCuentaPorPagar` + mapeo de ramas del listener |
| `package.json` | Modificar — agregar los dos `.test.ts` nuevos a la lista `node --test` de la línea 10 (si no, no corren) |
