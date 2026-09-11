# Especificación Técnica — Módulo G (Gestión de Caja y Tesorería)
## Contenido para Sprint 2 — HU-G8 + HU-G10 (recorte por asignación de equipo)
## Revisión 3 — incorpora HU-G10 (registro de pago con evidencia) sobre la Revisión 2 verificada contra el repositorio
## Revisión 4 — HU-G10 implementada y verificada en runtime (2026-09-10); reconcilia el pseudocódigo de la Rev. 3 contra el código real

> **Estado de HU-G10 al 2026-09-10.** Implementada y verificada. Se entregó en tres PRs encadenados (`feature-branch-chain`, sin rama-tracker intermedia): **PR1** `feature/HU-G10-pago-backend` (contrato backend, base `develop`), **PR2a** `feature/HU-G10-pago-ui-lista` (consola de solo lectura), **PR2b** `feature/HU-G10-pago-ui-form` (form + server actions + modal). El bloqueante de HU-H9 quedó resuelto (`ComprobanteProveedor` mergeado). Cinco decisiones fijadas en la Rev. 3 se implementaron con ajustes respecto del pseudocódigo — ver anotaciones `— implementado (2026-09-10)` en §2.4, §3.7, §4.1, §4.2 y §5. Verificación en runtime: Fase 11 corrida dos veces (pre y post-merge de `origin/develop`), `verificar-cadena → integra: true`, `audit_logs` 3 → 10 (delta +7, sin filas de más), + walkthrough de browser de la consola.

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM 6 · TypeScript (strict) · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Trazabilidad Inalterable, hash SHA-256 encadenado) · `Documento de Alcance Funcional y Técnico` (sección Módulo G; sección 2.1 "Flujo de estados de una Orden de Compra"; sección 3.4 corregida — Módulo H como fuente de la proyección de egresos junto con B/C/E; sección 5 y 5.1 — matriz de acceso y restricción de datos bancarios) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja `Sprint 2`, HU-G8, HU-G10, HU-H9) · `schema.prisma` (modelos `CuentaPorPagar`, `OrdenCompra`, `OrdenCompraItem`, `Recepcion`, `RecepcionItem`, `Proveedor`) · `spec_modulo_H.md` (evento `orden_compra:estado_cambiado`, emitido por HU-H3; modelo `ComprobanteProveedor`, HU-H9)

---

## ⚠️ Alcance de este documento

**Este documento NO cubre todo el Módulo G.** Cubre **HU-G8** (Compromisos de Pago / Cuenta por Pagar) y **HU-G10** (registro del pago con medio de pago, cuenta de origen y comprobante de proveedor asociado), las dos HU de Módulo G asignadas en Sprint 2. HU-G7 (posición diaria de tesorería) y el resto de Módulo G quedan fuera por asignación de equipo, no por decisión del PO.

**HU-G10 no crea un endpoint ni una función de servicio paralela.** Amplía directamente `marcarCuentaPorPagarPagada()` y `MarcarPagadaSchema`, ya entregados y testeados por HU-G8 (sección 2.4 de la Revisión 2), agregando los campos de evidencia de pago. No hay una segunda vía de mutación sobre la transición `DEFINITIVA → PAGADA`.

**El modelo `CuentaPorPagar` y el enum `EstadoCuentaPorPagar` YA EXISTEN migrados** (`prisma/schema.prisma:1151-1183` — model `1151-1176`, enum `1178-1183`; migración `20260831031138_sprint2`). HU-G8 no creó modelo nuevo. **HU-G10 sí requiere una migración adicional** — ver sección 5: campos nuevos en `CuentaPorPagar` y la relación hacia `ComprobanteProveedor` (HU-H9), que hoy no existe en `schema.prisma`.

**Estado de las dependencias externas:**

| Dependencia | Estado |
|---|---|
| Evento `orden_compra:estado_cambiado` (HU-H3) | ✅ Confirmado y mergeado. Se emite en las transiciones a `ENVIADA`, `CONFIRMADA`, `CERRADA` y `CANCELADA` (`src/lib/services/proveedores/orden-compra.service.ts:437-449`). |
| Evento propio de "recepción total cerrada" (HU-H4) | ❌ **No se necesita.** La hipótesis de la Revisión 1 quedó confirmada: el evento genérico de HU-H3 ya cubre la transición `RECIBIDA_COMPLETA → CERRADA` y alcanza para disparar la consolidación a `DEFINITIVA`. Ver sección 2.2. |
| `recepcion.service.ts` (HU-H4) | ✅ Integrado. Deja la OC en `RECIBIDA_COMPLETA` por el camino real; habilita la verificación end-to-end de `PROVISORIO → DEFINITIVA` y el recálculo del `monto` sobre `RecepcionItem.cantidad_aceptada`. Ver secciones 2.2 y 5. |
| Modelo `ComprobanteProveedor` (HU-H9) | 🔴 **Bloqueante para HU-G10.** No existe todavía en `schema.prisma` — verificado, sin coincidencias en el repo actual. HU-G10 exige asociar al menos un comprobante vigente de la misma OC como precondición (`422` si no existe); sin el modelo migrado, la validación del paso 2 en 2.4 no tiene contra qué consultar. No bloquea HU-G8, que ya está cerrada. Coordinar con quien tome HU-H9 antes de implementar esta ampliación. |

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

Definición real en `src/lib/events/event-types.ts:302-313` (verificada). **La Revisión 1 asumía nombres incorrectos.** Shape real:

```typescript
interface OrdenCompraEstadoCambiadoPayload {
  orden_compra_id: string;
  numero_orden: string;
  estado_anterior: EstadoOrdenCompra;      // era `string` suelto hasta el commit b3dbf89 (09/09/2026)
  estado_nuevo: EstadoOrdenCompra;         // (NO "nuevo_estado")
  accion: "ENVIAR" | "CONFIRMAR" | "CERRAR" | "CANCELAR";
  cambiado_por: string;                    // usuario_id         (NO "usuario_id")
  fecha_entrega_comprometida: string | null; // presente solo en CONFIRMAR, ISO 8601
  deletion_reason: string | null;         // presente solo en CANCELAR (baja lógica de la OC)
}
```

`EstadoOrdenCompra` se importa de `@prisma/client` (`import type`). El endurecimiento del tipo (`string` → `EstadoOrdenCompra`) en `b3dbf89` protege la guarda de 2.2 ante un rename del enum — ver §5.

Valores de `EstadoOrdenCompra` (`schema.prisma:881-889`): `BORRADOR`, `ENVIADA`, `CONFIRMADA`, `RECEPCION_PARCIAL`, `RECIBIDA_COMPLETA`, `CERRADA`, `CANCELADA`.
`CANCELAR` solo es válido desde `[BORRADOR, ENVIADA]` (`orden-compra.service.ts:72-77`, const `TRANSICIONES`).

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

**`fecha_vencimiento`:** queda `null`. `Proveedor.condiciones_pago` **sí existe migrado** (`schema.prisma:690`, `String?`), pero es **texto libre** ("Contado", "30 días", "60 días FF") — no parseable de forma confiable a una cantidad de días. Ningún criterio de aceptación de HU-G8 define el cálculo del vencimiento. Queda `null` hasta que el campo se estructure en otra HU.

---

### 2.2. Rama — Consolidación a Cuenta por Pagar definitiva (criterios 3 y 4)

**Disparador:** `payload.accion === "CERRAR"` (`estado_nuevo === "CERRADA"`), con guarda adicional `estado_anterior === "RECIBIDA_COMPLETA"` — para no reaccionar ante otras rutas hacia `CERRADA` que no correspondan al cierre por conciliación de factura.

**Hipótesis de la Revisión 1 — CONFIRMADA.** El evento `orden_compra:estado_cambiado` ya cubre la transición `RECIBIDA_COMPLETA → CERRADA` (acción `CERRAR`, `orden-compra.service.ts:72-77` const `TRANSICIONES`). **HU-G8 no necesita un evento propio de HU-H4** para saber *cuándo* consolidar. Para saber *qué* `Recepcion` asociar, se resuelve por query directa contra `Recepcion` (no por evento).

**Servicio:** `consolidarCuentaPorPagarDefinitiva(payload)`.

**Comportamiento — dentro de `prisma.$transaction`:**

1. `findFirst` de la `CuentaPorPagar` activa en `PROVISORIO` de esa `orden_compra_id` (`select: { id, monto }`). Si no existe, **loguea con `orden_compra_id` y retorna `null` — no lanza excepción** (el listener no tiene un llamador HTTP al que responder).
2. Recalcula `monto` sobre lo **efectivamente recibido y validado** (criterio 4): `Σ(cantidad_aceptada × precio_unitario)` sobre los `RecepcionItem` activos de **todas** las `Recepcion` activas de la orden, agrupado por `orden_compra_item_id` (`calcularMontoDesdeRecepcion` → helper puro `calcularMontoDesdeItemsAceptados`, mismo tratamiento `Prisma.Decimal` que 2.1). **Es `cantidad_aceptada`, no `cantidad_recibida`** — ver nota en sección 5. Esto lo distingue del PROVISORIO (2.1), que suma lo pedido (`cantidad_solicitada`). Cualquier diferencia con el monto provisorio previo **se toma en silencio** — es el comportamiento esperado, no una excepción a resolver. La discrepancia queda trazada por los campos `monto_anterior` / `monto_nuevo` del evento hacia el `AuditLog` (sección 4).
3. Resuelve `recepcion_id`: la `Recepcion` activa más reciente de esa orden (`findFirst({ where: { orden_compra_id, is_active: true }, orderBy: { fecha_recepcion: "desc" }, select: { id: true } })`).
4. `updateMany({ where: { id, estado: "PROVISORIO", is_active: true }, data: { estado: "DEFINITIVA", monto, recepcion_id } })` (escritura guardada, concurrencia optimista). Si `count === 0`, retorna `null`.

**No crea una fila nueva** — reemplaza sobre el mismo registro (un solo ciclo de vida).

**Post-commit:** emite `cuenta_por_pagar:estado_cambiado` con `accion: "DEFINIR"` (`monto_anterior` = monto provisorio leído en el paso 1; `monto_nuevo` = recalculado; `recepcion_id`).

**Estado (HU-H4 ya integrada):** el paso 2 recalcula sobre `RecepcionItem.cantidad_aceptada` y el paso 3 devuelve el `recepcion_id` real de cierre. La rama `PROVISORIO → DEFINITIVA` está **verificada end-to-end en runtime** por el camino real `CONFIRMADA → RECEPCION_PARCIAL → RECIBIDA_COMPLETA → CERRADA` (`recepcion.service.ts` deja el estado `RECIBIDA_COMPLETA`; `CERRAR` de HU-H3 emite el evento que dispara la consolidación). Ya no es un diferimiento.

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

### 2.4. Mutación — Marcar Cuenta por Pagar como pagada (criterio 5, ampliada por HU-G10)

**Ruta:** `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar` → `src/app/api/tesoreria/cuentas-por-pagar/[id]/pagar/route.ts`
**Permiso requerido:** `cuentas_por_pagar:pagar` (rol `TESORERO_CENTRAL` únicamente). Sin cambios respecto a HU-G8 — HU-G10 no introduce un permiso nuevo, amplía el contrato del mismo endpoint.
**Enforcement:** `withAuth(handler)` + `usuarioTienePermiso(session.userId, "cuentas_por_pagar:pagar")` inline (patrón de `src/app/api/ordenes-compra/[id]/estado/route.ts`, porque el permiso es específico de la ruta).

Esta sigue siendo la **única mutación manual** de HU-G8/HU-G10. No hay modelo `OrdenPago` propio: "efectivizar" es este mismo endpoint, que persiste el resultado directamente sobre `CuentaPorPagar`. **HU-G10 no habilita pago parcial** — sigue siendo todo-o-nada: `estado: PAGADA` + `fecha_pago`, ahora acompañados de la evidencia de cómo y contra qué documentación se pagó.

**Decisión de equipo — ratificada e implementada (2026-09-10).** Los tres campos nuevos (`medio_pago`, `cuenta_origen_id`, `comprobante_proveedor_ids`) son **obligatorios** en el body. Se agregó además `observaciones` como campo opcional (no contemplado en la Rev. 3) acotado a 500 caracteres, y `fecha_pago` pasó a ser explícitamente **retrodatable con tope "no futura"**. Rama: `feature/HU-G10-pago-backend`. Archivos: `src/lib/schemas/cuentas-por-pagar.schema.ts` (`MEDIOS_PAGO`, `esFechaPagoNoFutura`, `MarcarPagadaSchema`).

```typescript
export const MarcarPagadaSchema = z.object({
  fecha_pago: z
    .coerce.date()
    .default(() => new Date())
    .refine((d) => esFechaPagoNoFutura(d), "La fecha de pago no puede ser futura"),
  medio_pago: z.enum(MEDIOS_PAGO), // MEDIOS_PAGO = ["TRANSFERENCIA","CHEQUE","EFECTIVO"] as const — espejo del enum Prisma MedioPago
  cuenta_origen_id: z
    .string()
    .refine(esCuentaOrigenValida, "La cuenta de origen no existe"), // valida contra el catálogo const (ver §5), NO .uuid()
  comprobante_proveedor_ids: z
    .array(z.string().uuid())
    .min(1, "Debés imputar al menos un comprobante")
    .refine((ids) => new Set(ids).size === ids.length, "No podés imputar el mismo comprobante dos veces"),
  observaciones: z
    .string()
    .max(500, "Las observaciones no pueden superar los 500 caracteres")
    .optional(),
});
// Implementado (2026-09-10). La route usa MarcarPagadaSchema.safeParse(body) — ya no
// `body ?? {}`: un body vacío falla la validación de campos obligatorios.
// `cuenta_origen_id` NO es un uuid: es un id del catálogo const `src/lib/tesoreria/cuentas-origen.ts`,
// validado por membership (`esCuentaOrigenValida`), sin FK real (ver §5).
// `fecha_pago` acepta pasado, rechaza futuro (`esFechaPagoNoFutura`, helper puro testeable).
```

**Servicio:** `marcarCuentaPorPagarPagada(cuentaPorPagarId, input, usuarioId)` — misma firma que en HU-G8, sin cambios en el orden de argumentos.

**Comportamiento — dentro de `prisma.$transaction`:**

1. `findFirst` por `id` (`select: { id, estado, is_active, monto, orden_compra_id, orden_compra: { select: { numero_orden: true, proveedor_id: true } } }`).
   - No existe → `ServiceError("CUENTA_POR_PAGAR_NO_ENCONTRADA")`.
   - `!is_active` → `ServiceError("TRANSICION_INVALIDA")`.
   - `estado !== "DEFINITIVA"` → `ServiceError("TRANSICION_INVALIDA", "No es posible pagar una cuenta en estado " + estado)`.
2. **HU-G10 — implementado (2026-09-10), validación TODO-O-NADA (no "al menos uno").** Se cargan los comprobantes realmente existentes con `tx.comprobanteProveedor.findMany({ where: { id: { in: comprobante_proveedor_ids } }, select: { id, orden_compra_id, is_active } })` — **sin** filtro `is_active`, para poder distinguir `ANULADO` de `INEXISTENTE`.
   **2b.** Se resuelven los ids ya imputados a **otra** `CuentaPorPagar` en estado `PAGADA` (`tx.cuentaPorPagarComprobante.findMany(... cuenta_por_pagar_id: { not: id }, cuenta_por_pagar: { is: { estado: "PAGADA" } })`) → `idsYaImputadosEnOtrosPagos`.
   **3.** `const detalles = validarComprobantesDePago(idsSolicitados, encontrados, cuenta.orden_compra_id, idsYaImputadosEnOtrosPagos)` (helper puro, `src/lib/services/tesoreria/cuenta-por-pagar.comprobantes.ts`). Devuelve un `DetalleComprobanteInvalido { id, motivo }` por **cada** id que no se puede imputar; `motivo` es un CÓDIGO de un enum de 5 valores:

   ```typescript
   type MotivoComprobanteInvalido =
     | "NINGUNO_ENVIADO"   // el array llegó vacío (id: "")
     | "ANULADO"           // existe pero is_active: false
     | "DE_OTRA_OC"        // existe y activo, pero de otra orden_compra_id
     | "INEXISTENTE"       // no está en `encontrados`
     | "YA_IMPUTADO";      // ya imputado a otra CuentaPorPagar PAGADA
   ```

   Precedencia cuando aplican varios motivos: `INEXISTENTE > DE_OTRA_OC > ANULADO > YA_IMPUTADO` (`cuenta-por-pagar.comprobantes.ts`, JSDoc del helper). El backend nunca emite texto humano para el motivo — lo mapea la capa HTTP / el frontend. Si `detalles.length > 0` → `throw new ServiceError("COMPROBANTE_PROVEEDOR_REQUERIDO", "Hay comprobantes que no se pueden imputar a este pago", detalles)` → **rollback total, no se persiste nada** (a diferencia de la Rev. 3, que exigía solo ≥1 válido y persistía todos los ids recibidos).
4. `updateMany({ where: { id, estado: "DEFINITIVA", is_active: true }, data: { estado: "PAGADA", fecha_pago, medio_pago, cuenta_origen_id, observaciones } })`. Si `count === 0` → `ServiceError("TRANSICION_INVALIDA", "El estado de la cuenta cambió durante la operación; reintentá")`.
5. **HU-G10 — implementado.** Dentro de la misma transacción, `createMany` sobre `CuentaPorPagarComprobante` (una fila por cada id — como llegado a este punto todos son válidos, no hay ids inválidos que persistir). La tabla existe en `schema.prisma` (`model CuentaPorPagarComprobante`, migración `20260909231426_hu_g10_registro_pago_cxp`), sin bloque de baja lógica propio: la vigencia deriva del `is_active` del `ComprobanteProveedor` referenciado.

`fecha_pago = input.fecha_pago ?? new Date()`.

**Post-commit (dentro del servicio, como `orden-compra.service.ts:432`):** emite `cuenta_por_pagar:estado_cambiado` con `accion: "PAGAR"`, `estado_anterior: "DEFINITIVA"`, `estado_nuevo: "PAGADA"`, `fecha_pago: fecha_pago.toISOString()`, `proveedor_id`, y —**HU-G10, implementado (2026-09-10)**— `medio_pago`, `cuenta_origen_id`, `comprobante_proveedor_ids`, `observaciones`. Estos 4 campos son parte del contrato del payload (§4.1) y valen `null` en las otras 3 acciones (`CREAR`/`DEFINIR`/`CANCELAR`), que los emiten explícitamente en `null`.

**Notificación al Módulo H (criterio 5 — "reflejarlo en el historial del proveedor"):** sin cambios respecto a HU-G8. El evento `cuenta_por_pagar:estado_cambiado` se emite con `proveedor_id` en el payload, para que Módulo H pueda reaccionar filtrando `accion === "PAGAR"`; no se define un evento dedicado. **Hoy Módulo H no tiene ningún listener suscripto a ese evento** — el único suscriptor es el handler de auditoría (ver §4.4). Consumir el evento del lado de H queda pendiente de ese módulo.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "cuenta_por_pagar_id": "uuid",
    "estado_anterior": "DEFINITIVA",
    "estado_nuevo": "PAGADA",
    "fecha_pago": "2026-09-10T14:00:00.000Z",
    "medio_pago": "TRANSFERENCIA",
    "cuenta_origen_id": "banco-nacion-cc-principal",
    "comprobante_proveedor_ids": ["uuid"],
    "observaciones": "texto libre o null"
  },
  "error": null
}
```

**Errores** (envelope `{ data: null, error: { code, message } }`, mapa local `STATUS_POR_CODIGO`):

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `id` de path inválido, o body inválido (`fieldErrors`) — ahora incluye la ausencia de `medio_pago`/`cuenta_origen_id`/`comprobante_proveedor_ids` si se optó por obligatorios |
| `FORBIDDEN` | 403 | El usuario no tiene `cuentas_por_pagar:pagar` |
| `CUENTA_POR_PAGAR_NO_ENCONTRADA` | 404 | No existe la fila |
| `TRANSICION_INVALIDA` | 409 | La cuenta no está `DEFINITIVA` (está `PROVISORIO`, `PAGADA` o `CANCELADA`), o cambió durante la operación |
| `COMPROBANTE_PROVEEDOR_REQUERIDO` | 422 | **HU-G10 — implementado.** Al menos un id en `comprobante_proveedor_ids` no se puede imputar (o el array llegó vacío). El envelope agrega `error.details: [{ id, motivo }]` con `motivo ∈ { NINGUNO_ENVIADO, ANULADO, DE_OTRA_OC, INEXISTENTE, YA_IMPUTADO }` (código, no texto). Rechazo total: nada se persiste. `error.details` viaja por un 3er argumento opcional agregado a `ServiceError` (`src/lib/errors/service-error.ts`) y se propaga en la route con `...(err.details ? { details: err.details } : {})` |
| `INTERNAL_ERROR` | 500 | Error inesperado |

> El código es **`TRANSICION_INVALIDA`**, no el `ESTADO_INVALIDO` que asumía la Revisión 1 — es la convención `ServiceError` ya usada por Módulo H. `COMPROBANTE_PROVEEDOR_REQUERIDO` sigue la misma convención de nombre-en-mayúsculas descriptivo.
>
> **HU-G10 (2026-09-10).** `ServiceError` no tenía canal para datos estructurados: se le agregó un 3er argumento opcional `details?: unknown` (`readonly`). Auditados ~40 catch blocks de `src/app/api` — ninguno hace `...err` (todos arman `{ code, message }` explícito), así que el campo opcional no filtra en ningún endpoint preexistente; solo `.../pagar` lo expone.

**Orden de validación en la route:** (1) `id` de path → (2) body → (3) permiso → (4) precondición de estado (paso 1 del servicio) → (5) precondición de comprobante (paso 2 del servicio, nuevo en HU-G10).

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

> **Nunca `include: true` sobre `Proveedor`.** El `Proveedor` tiene `datos_bancarios_cifrado` y `datos_bancarios_iv` (`schema.prisma:704,708`), que el Alcance §5.1 restringe a Tesorero Central y Administrador únicamente, con independencia de este permiso de lectura general. El `select` explícito los excluye siempre. La verificación (7.5) debe aseverar que el objeto `proveedor` de cada fila trae **solo** los 5 campos de la whitelist.
>
> **HU-G10 (2026-09-10) — el `select` NO se amplió.** `listarCuentasPorPagar` quedó sin cambios: la consola de Tesorería (PR2a) consume este listado filtrado a `estado=DEFINITIVA`, donde `medio_pago`/`cuenta_origen_id`/`observaciones` siempre serían `null`; el read-back del pago (modal de PR2b) se arma con el body del `200` de `PATCH .../pagar`, no con este `select`. Si HU-G7 necesita mostrar el detalle de pago (medio, cuenta de origen, observaciones, comprobantes imputados) de cuentas `PAGADA` desde el listado, hay que agregar esos campos al `select` y la relación `comprobantes: { select: { comprobante_proveedor_id: true } }` en ese momento.

No existe UI propia para este endpoint en Sprint 2 (no hay HU-G7 que la consuma). Su propósito ahora es permitir verificación con evidencia (Postman) de las tres ramas del listener y de la mutación de pago.

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. El `PROVISORIO` nunca es deuda exigible
Es informativo. El `GET` (2.5) expone `estado` por fila tal cual. Excluir `PROVISORIO` de cualquier agregado de "deuda pendiente" o proyección de caja es **responsabilidad de HU-G7**, no de HU-G8. El modelo no lo impide a nivel de constraint (mismo criterio en el JSDoc de `CuentaPorPagar` en `schema.prisma:1142-1150`).

### 3.2. Transiciones de estado exclusivamente vía listener o el endpoint de pago
No existe (ni debe existir) un `PATCH` genérico de `estado` sobre `CuentaPorPagar`. Las únicas mutaciones válidas son las tres ramas automáticas de 2.1/2.2/2.3 y la mutación manual de 2.4.

### 3.3. Auditoría SHA-256 reutilizando el mecanismo existente
Ninguna sección implementa hashing propio. Todas las transiciones emiten `cuenta_por_pagar:estado_cambiado`, consumido por `iniciarAuditLogListener()` en `src/lib/events/listeners/audit-log.listener.ts`, que llama `registrarAuditLog(...)`. **Ningún servicio de dominio llama `registrarAuditLog()` directamente.** Cada transición es un registro de auditoría independiente — nunca se agrupan. Tras las escrituras, `/api/auditoria/verificar-cadena` debe seguir reportando la cadena íntegra.

### 3.4. Restricción de borrado físico
`CuentaPorPagar` usa el bloque estándar de baja lógica (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`), ya migrado. La transición a `CANCELADA` (2.3) **no** es baja lógica: `is_active` permanece `true`. `deletion_reason` se reutiliza como motivo de la cancelación funcional.

### 3.5. Idempotencia de listeners
Cada rama es idempotente: la rama de creación verifica un `PROVISORIO` activo previo; las ramas de actualización usan `updateMany` guardado por `estado` y tratan `count === 0` como no-op (retornan `null`), no como error. `iniciarCuentaPorPagarListener()` tiene guarda de registro único (`let registrado = false`).

#### 3.5.1. Asimetría de guardas de `estado_anterior` entre las 3 ramas — intencional

Solo `consolidarCuentaPorPagarDefinitiva` (2.2) lleva una guarda explícita de `estado_anterior` (`if (payload.estado_anterior !== "RECIBIDA_COMPLETA") return null`, `cuenta-por-pagar.service.ts:316`). `generarCuentaPorPagarProvisoria` (2.1) y `cancelarCuentaPorPagar` (2.3) **no la tienen, y es correcto que no la tengan** — no es un olvido.

El criterio es *qué pasa si la rama se dispara desde un estado no esperado* (por un cambio futuro en la máquina de estados de Módulo H, que HU-G8 no controla):

| Rama | Se defiende por | Si se dispara desde un estado "equivocado" |
|---|---|---|
| `generar` (2.1) | **Existencia**: `if (existente PROVISORIO) return null` | Crea un `PROVISORIO` sobre `Σ cantidad_solicitada`, o no-op si ya hay uno. Una OC que sale de `BORRADOR` *debe* tener compromiso provisorio → **sin resultado incorrecto**. |
| `consolidar` (2.2) | **Estado**: `estado_anterior === "RECIBIDA_COMPLETA"` | Recalcula el monto con `calcularMontoDesdeRecepcion`, que suma `RecepcionItem.cantidad_aceptada` sobre las `Recepcion` de la orden. Disparada desde, p. ej., un hipotético `CONFIRMADA → CERRADA` (cierre sin recepción), sumaría **sobre cero filas** → **`DEFINITIVA` con `monto: 0.00`**: una deuda finalizada de $0 para una orden nunca recibida. **Resultado de negocio incorrecto** → por eso lleva la guarda de estado. |
| `cancelar` (2.3) | **Inexistencia**: `if (!provisoria) return null`, y el `updateMany` filtra por `estado: "PROVISORIO"` | Cancela el `PROVISORIO` si existe. Si la OC se cancela, su compromiso *debe* morir; el filtro por `PROVISORIO` impide tocar una `DEFINITIVA`/`PAGADA` → **sin resultado incorrecto**. |

`consolidar` es la única rama donde dispararse desde el estado equivocado **escribe un dato incorrecto** en vez de hacer un no-op. Los gates por existencia/inexistencia de un `PROVISORIO` activo de las otras dos son, además, más robustos que una guarda de estado para lo que esas ramas hacen: cubren también los reintentos del bus (una guarda de `estado_anterior` no).

Agregar una guarda simétrica `estado_anterior !== "BORRADOR"` a `generar` fue **evaluado y descartado** (decisión del 09/09/2026): no previene ningún resultado incorrecto, su hazard real (`PROVISORIO` duplicado) ya lo cubre la idempotencia, y podría inducir a un lector futuro a asumir una razón semántica que no existe.

> **Sobre `orden-compra.service.ts:72-77` (`const TRANSICIONES`):** hoy tanto `ENVIAR` (`origenes: ["BORRADOR"]`) como `CERRAR` (`origenes: ["RECIBIDA_COMPLETA"]`) tienen **un único origen**, validado por `cambiarEstadoOrdenCompra` antes de emitir el evento. La guarda de `consolidar` es por eso *redundante hoy* contra la máquina de estados actual (lo dice su propio comentario) — se mantiene como blindaje del contrato entre módulos porque su ausencia habilitaría un write incorrecto ante un cambio en Módulo H; la de `generar` no aportaría esa protección.

### 3.6. Fallo del listener — sin conciliación en este slice
El evento `orden_compra:estado_cambiado` es post-commit fire-and-forget: si `generarCuentaPorPagarProvisoria` falla, la OC ya está `ENVIADA` y no hay `CuentaPorPagar`. **No hay job de conciliación en HU-G8.** La recuperación es replay manual, guiado por el `console.error` (que debe incluir `orden_compra_id`). Detectar OC en `ENVIADA` sin `CuentaPorPagar` asociada es el lugar natural de HU-G7. Cada rama del listener envuelve `servicio + emit` en un `try/catch` que loguea y **nunca relanza** hacia el bus.

### 3.7. Comprobante de Proveedor vigente como precondición de pago (HU-G10)
**Implementado (2026-09-10) como validación TODO-O-NADA, no "al menos uno".** Cada id en `comprobante_proveedor_ids` debe corresponder a un `ComprobanteProveedor` (HU-H9) `is_active: true` de la **misma** `OrdenCompra` de la `CuentaPorPagar`, y no estar ya imputado a otra `CuentaPorPagar` `PAGADA`. Si cualquiera falla (o el array llega vacío) → `422 COMPROBANTE_PROVEEDOR_REQUERIDO` con `details` por-id y rollback total. "Vigente" = `is_active: true` (una anulación de HU-H9 es baja lógica pura). La validación vive solo en la capa de servicios (`validarComprobantesDePago`, helper puro sin I/O); el schema Zod solo valida formato (`uuid`, `min(1)`, sin ids repetidos) y nunca existencia real, siguiendo la convención del proyecto. La regla no se relaja por tener `cuentas_por_pagar:pagar`: el permiso autoriza a *intentar*, no reemplaza la precondición documental. Archivos: `src/lib/services/tesoreria/cuenta-por-pagar.comprobantes.ts` (+ `.test.ts`), paso 2/2b/3 de 2.4 en `cuenta-por-pagar.service.ts`.

---

## 4. Eventos de Dominio (EDA)

| Evento | Disparado por | Consumidor | Payload |
|---|---|---|---|
| `orden_compra:estado_cambiado` *(consumido)* | HU-H3 | Listener de 2.1/2.2/2.3 | Ver "Payload consumido" arriba — shape real de `event-types.ts:302-313` |
| `cuenta_por_pagar:estado_cambiado` *(nuevo)* | 2.1, 2.2, 2.3, 2.4 | `audit-log.listener.ts` | Ver abajo |

### 4.1. `CuentaPorPagarEstadoCambiadoPayload`

Se agrega a `src/lib/events/event-types.ts` (interface después de `ProveedorEstadoCambiadoPayload`, más una entrada en `DomainEventMap`). Convenciones: `monto_*` como `string` (`Prisma.Decimal` serializado), fechas ISO 8601 o `null`.

Shape **real** (`src/lib/events/event-types.ts:391-420`, verificado 2026-09-10 — incluye los 4 campos de HU-G10 al final):

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
  medio_pago: "TRANSFERENCIA" | "CHEQUE" | "EFECTIVO" | null; // HU-G10 — presente solo en PAGAR
  cuenta_origen_id: string | null;          // HU-G10 — presente solo en PAGAR. Id del catálogo `cuentas-origen.ts`, sin FK
  comprobante_proveedor_ids: string[] | null; // HU-G10 — presente solo en PAGAR
  observaciones: string | null;              // HU-G10 — presente solo en PAGAR
}
```

> **HU-G10 — implementado (2026-09-10).** Los 4 campos son parte del contrato (`src/lib/events/event-types.ts:412-420`, verificado). Solo `PAGAR` los emite con valor; `CREAR`/`DEFINIR`/`CANCELAR` los emiten explícitamente en `null` (obligado por el tipo compartido — si no fueran nullable, `next build` rompería en los 3 emisores no-PAGAR y en el listener). Ese `null` **no** llega al `AuditLog`: el handler de §4.2 los omite con spreads falsy, así que el `valor_nuevo` de las 3 acciones no-PAGAR queda byte-idéntico a HU-G8.

### 4.2. Handler de auditoría

Bloque `domainEventBus.on("cuenta_por_pagar:estado_cambiado", ...)` agregado dentro de `iniciarAuditLogListener()`, después del bloque de `proveedor:estado_cambiado`:

- `usuario_id: payload.cambiado_por`
- `accion: payload.accion === "CREAR" ? "CREATE" : "UPDATE_ESTADO"` — **incluido `CANCELAR`, que mapea a `UPDATE_ESTADO`, no a `DELETE_LOGICO`** (la fila sigue `is_active: true`; es un cambio de estado, no una baja lógica). Diverge a propósito del handler de `orden_compra:estado_cambiado`, que mapea su `CANCELAR` a `DELETE_LOGICO`. Llevar un comentario como el de `audit-log.listener.ts:392-394`.
- `tabla_afectada: "cuentas_por_pagar"`
- `registro_id: payload.cuenta_por_pagar_id`
- `ip: "internal-event"` (evento de servicio post-commit sin request HTTP)
- `valor_anterior`: `null` en `CREAR`; si no, `{ estado: payload.estado_anterior, monto: payload.monto_anterior }`
- `valor_nuevo` (real, `audit-log.listener.ts:513-536`): base `{ estado, accion, monto: monto_nuevo, orden_compra_id, numero_orden, proveedor_id }` + spreads condicionales `...(recepcion_id ? { recepcion_id } : {})` (DEFINIR), `...(fecha_pago ? { fecha_pago } : {})` (PAGAR), `...(deletion_reason ? { deletion_reason } : {})` (CANCELAR), y **HU-G10 — implementado (2026-09-10)**: cuatro spreads **separados** (no uno combinado) `...(medio_pago ? { medio_pago } : {})`, `...(cuenta_origen_id ? { cuenta_origen_id } : {})`, `...(comprobante_proveedor_ids?.length ? { comprobante_proveedor_ids } : {})`, `...(observaciones ? { observaciones } : {})`. Los 4 solo aparecen en `PAGAR`; para las otras 3 acciones las guardas son falsy y el `valor_nuevo` queda byte-idéntico al de HU-G8. Un solo `registrarAuditLog` por evento — el contrato de la cadena SHA-256 no cambia.

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
- **El `monto` de la `DEFINITIVA` usa `cantidad_aceptada`, no `cantidad_recibida`.** El criterio 4 dice "sobre lo efectivamente **recibido y validado**". `cantidad_recibida` es lo que llegó físicamente; `cantidad_aceptada` es lo que además pasó control (la mercadería recibida pero rechazada por calidad/discrepancia queda con `cantidad_aceptada < cantidad_recibida` y una `RecepcionDiscrepancia`). Facturar sobre `cantidad_recibida` incluiría unidades no validadas; por eso `calcularMontoDesdeRecepcion` suma `cantidad_aceptada`. Ejemplo verificado: OC de 368000 pedidos, ítem con 3 de 10 unidades rechazadas por calidad ⇒ `DEFINITIVA` = 320600, no 368000.
- **`fecha_vencimiento` del `PROVISORIO`** — `null`. `Proveedor.condiciones_pago` existe pero es texto libre. Estructurar el campo es materia de otra HU.
- **`recepcion_id` en la consolidación** — resuelto (HU-H4 integrada): la `Recepcion` activa más reciente de la orden. El `monto` de la `DEFINITIVA` se recalcula sobre `RecepcionItem.cantidad_aceptada` (ver nota anterior).
- **Tipado de la guarda del disparador de 2.2 — resuelto (2026-09-09).** La guarda es `if (payload.estado_anterior !== "RECIBIDA_COMPLETA") return null;` (`cuenta-por-pagar.service.ts:316`). Hasta esta fecha `OrdenCompraEstadoCambiadoPayload.estado_anterior` / `estado_nuevo` estaban tipados como `string` suelto, así que un rename del valor `RECIBIDA_COMPLETA` en el enum `EstadoOrdenCompra` sin actualizar esta línea habría pasado `tsc` y fallado **en silencio en runtime** (la `CuentaPorPagar` nunca pasaría de `PROVISORIO` a `DEFINITIVA`). Ambos campos pasaron a tiparse como `EstadoOrdenCompra` (importado de `@prisma/client`, `src/lib/events/event-types.ts`). Ahora la comparación de la línea 316 está **protegida por `tsc`**: un rename del valor del enum sin tocar esta línea produce `error TS2367 — 'EstadoOrdenCompra' y '"RECIBIDA_COMPLETA"' no tienen overlap` (verificado). El fallo silencioso ya no es posible. **Esta mejora de tipado es independiente de la decisión de la Daily sobre simplificar el enum** — no cambia ningún valor de `EstadoOrdenCompra` ni el string comparado; solo endurece el tipo del campo que ya existía. Si la Daily decide renombrar/eliminar `RECIBIDA_COMPLETA`, el compilador va a señalar exactamente esta línea (y las de HU-H3 en `orden-compra.service.ts`, ya tipadas contra el enum).
- **Sin uniqueness a nivel DB** de un `PROVISORIO` activo por OC (no se permite migración en esta HU). La garantía es solo de capa de aplicación; un doble-emit genuinamente simultáneo podría crear dos filas. Aceptado.
- **HU-G7 y el resto de Módulo G** — fuera de este documento.

### Pendientes específicos de HU-G10

- **`ComprobanteProveedor` (HU-H9) — resuelto (2026-09-10).** El modelo está mergeado; el bloqueante ya no aplica.
- **Campos nuevos en `CuentaPorPagar` + enum `MedioPago` — resuelto (2026-09-10).** Migración aditiva `20260909231426_hu_g10_registro_pago_cxp` (`feature/HU-G10-pago-backend`): `enum MedioPago { TRANSFERENCIA CHEQUE EFECTIVO }`; `medio_pago MedioPago?`, `cuenta_origen_id String?`, `observaciones String?` en `CuentaPorPagar` (todas nullable, sin backfill: filas `PAGADA` previas quedan legítimamente en `NULL`).
- **Tabla intermedia `CuentaPorPagarComprobante` — resuelto (2026-09-10).** Creada en la misma migración: `cuenta_por_pagar_id`, `comprobante_proveedor_id`, `created_at`, FKs `onDelete: Restrict`, `@@unique([cuenta_por_pagar_id, comprobante_proveedor_id])`, **sin** bloque de baja lógica (la vigencia deriva del `is_active` del `ComprobanteProveedor`; la fila es un hecho histórico inmutable de una cuenta en estado terminal).
- **`cuenta_origen_id` sin entidad real — resuelto por catálogo const (2026-09-10).** No se creó modelo `CuentaBancaria`/`CajaChica`. La columna queda `String?` **sin FK**; la validación de existencia se hace contra un catálogo const de backend (`src/lib/tesoreria/cuentas-origen.ts`, `{ id, label }[]`, función `esCuentaOrigenValida`) que hoy trae entradas placeholder marcadas `// TODO`. Cuando exista la entidad real, los `id` del catálogo son estables y se convierten en FK sin reescritura de datos. Documentado en JSDoc de la columna como referencia libre.
- **Ratificación de "obligatorio" — ratificada (2026-09-10).** Los tres son obligatorios en el body; ver §2.4.

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
| 7 | `CERRAR → DEFINITIVA` end-to-end | **Cerrado** — verificado en runtime por el camino real de HU-H4 (`ENVIAR → CONFIRMAR → recepción física → RECIBIDA_COMPLETA → CERRAR`); misma fila `PROVISORIO → DEFINITIVA`, `monto` sobre `cantidad_aceptada`, `recepcion_id` real |
| 8 | `PATCH .../pagar` con `comprobante_proveedor_ids` vigentes de la misma OC → `PAGADA` + `medio_pago`/`cuenta_origen_id`/`observaciones` persistidos + N filas en `cuentas_por_pagar_comprobantes` + `audit_logs` PAGAR con los 4 campos en `valor_nuevo` | **Cerrado (2026-09-10)** — Fase 11, corrida pre y post-merge de `origin/develop`, PASS 27/27 |
| 9 | `PATCH .../pagar` con array vacío, o ids inexistentes / anulados / de otra OC / duplicados / ya imputados → `400` (schema) o `422 COMPROBANTE_PROVEEDOR_REQUERIDO` con `error.details: [{ id, motivo }]`, sin persistir nada | **Cerrado (2026-09-10)** — Fase 11: 8×400 + 3×422 (ANULADO/DE_OTRA_OC/INEXISTENTE), cada uno con guarda SQL "estado sigue DEFINITIVA, join=0". `YA_IMPUTADO` y `NINGUNO_ENVIADO` cubiertos por unit test, no por HTTP (ver §5) |
| 10 | `PATCH .../pagar` con body faltando `medio_pago`/`cuenta_origen_id`/`comprobante_proveedor_ids`, o `fecha_pago` futura, o `observaciones` > 500, o `cuenta_origen_id` fuera de catálogo → `400 VALIDATION_ERROR` | **Cerrado (2026-09-10)** — Fase 11 |
| 11 | Re-pago de una `CuentaPorPagar` ya `PAGADA` → `409 TRANSICION_INVALIDA` (verificado también en la consola de PR2b: alerta inline, form editable, sin redirect) | **Cerrado (2026-09-10)** — Fase 11 + walkthrough de browser |
| 12 | `/api/auditoria/verificar-cadena` reporta `integra: true` tras la secuencia completa; `audit_logs` avanza exactamente 1 por transición; el `valor_nuevo` de `DEFINIR`/`CANCELAR` queda byte-idéntico a pre-HU-G10 (guardas falsy) | **Cerrado (2026-09-10)** — Fase 11: `integra: true` en baseline (3 registros) y final (10), delta **+7** sin filas de más |

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
| `src/lib/events/event-types.ts` | **Hecho (2026-09-10)** — `CuentaPorPagarEstadoCambiadoPayload` + `DomainEventMap` (HU-G8); HU-G10 sumó **4** campos nullable (`medio_pago`, `cuenta_origen_id`, `comprobante_proveedor_ids`, `observaciones`), `PAGAR`-only |
| `src/lib/events/domain-event-bus.ts` | Modificar (HU-G8) — segundo import dinámico de registro. Sin cambios en HU-G10 |
| `src/lib/events/listeners/audit-log.listener.ts` | **Hecho (2026-09-10)** — handler de `cuenta_por_pagar:estado_cambiado`; HU-G10 sumó 4 spreads condicionales separados en `valor_nuevo`, `PAGAR`-only (byte-idéntico para las otras acciones) |
| `src/lib/events/listeners/cuenta-por-pagar.listener.ts` | Crear (HU-G8) — listener reactivo (ramas 2.1/2.2/2.3). Sin cambios en HU-G10 |
| `src/lib/services/tesoreria/cuenta-por-pagar.service.ts` | **Hecho (2026-09-10)** — HU-G10 amplió `marcarCuentaPorPagarPagada()` (pasos 2/2b/3 de validación de comprobantes + `createMany` sobre `CuentaPorPagarComprobante` + emit ampliado). `listarCuentasPorPagar` **NO se tocó** (ver §2.5) |
| `src/lib/schemas/cuentas-por-pagar.schema.ts` | **Hecho (2026-09-10)** — HU-G10 agregó `MEDIOS_PAGO`, `esFechaPagoNoFutura` y amplió `MarcarPagadaSchema` (`medio_pago` `z.enum`, `cuenta_origen_id` `.refine(esCuentaOrigenValida)`, `comprobante_proveedor_ids` `.array().min(1)` + refine anti-duplicados, `observaciones` `.max(500).optional()`, `fecha_pago` `.refine` no-futura) |
| `src/lib/errors/service-error.ts` | **Hecho (2026-09-10)** — 3er argumento opcional `details?: unknown` (`readonly`) para el `422` estructurado. Cross-módulo; auditados ~40 catch blocks de `src/app/api`, ninguno hace `...err` → no filtra en endpoints preexistentes |
| `src/lib/tesoreria/cuentas-origen.ts` (+ `cuentas-origen.test.ts`) | **Creado (2026-09-10)** — catálogo const `{ id, label }[]` de cuentas de origen (entradas placeholder marcadas `// TODO`) + `esCuentaOrigenValida` / `listarCuentasOrigen`. Sin `server-only` (lo importan el schema y el form) |
| `src/lib/services/tesoreria/cuenta-por-pagar.comprobantes.ts` (+ `.test.ts`) | **Creado (2026-09-10)** — helper puro `validarComprobantesDePago` (5 motivos, precedencia `INEXISTENTE > DE_OTRA_OC > ANULADO > YA_IMPUTADO`), testeable sin Prisma |
| `src/app/api/tesoreria/cuentas-por-pagar/route.ts` | **Sin cambios en HU-G10** — el `select` del listado no se amplió (ver §2.5) |
| `src/app/api/tesoreria/cuentas-por-pagar/[id]/pagar/route.ts` | **Hecho (2026-09-10)** — `STATUS_POR_CODIGO` += `COMPROBANTE_PROVEEDOR_REQUERIDO: 422`; `safeParse(body)` (ya no `body ?? {}`); passthrough de `error.details`; el `200` devuelve los 4 campos nuevos |
| `prisma/schema.prisma` | **Hecho (2026-09-10)** — `enum MedioPago { TRANSFERENCIA CHEQUE EFECTIVO }`; `medio_pago`/`cuenta_origen_id`/`observaciones` (nullable) en `CuentaPorPagar`; `model CuentaPorPagarComprobante` (sin soft-delete). Ya no bloqueado (HU-H9 mergeado) |
| `prisma/migrations/20260909231426_hu_g10_registro_pago_cxp/migration.sql` | **Creado (2026-09-10)** — migración aditiva (CREATE TYPE + 3 ADD COLUMN nullable + CREATE TABLE + unique/index/FKs); sin `DROP`/`UPDATE`, sin backfill |
| `prisma/seed.ts` | **Sin cambios en HU-G10** — reutiliza `cuentas_por_pagar:pagar` (los cambios de la fila son de HU-G8) |
| `src/lib/services/tesoreria/cuenta-por-pagar.monto.test.ts` | Crear (HU-G8) — unit test de `calcularMontoDesdeItems` |
| `src/lib/services/tesoreria/cuenta-por-pagar.estado.test.ts` | Crear (HU-G8) — unit test de `esTransicionValidaCuentaPorPagar` + mapeo de ramas del listener |
| `src/lib/schemas/cuentas-por-pagar.pago.test.ts` | **Creado (2026-09-10)** — unit test del `MarcarPagadaSchema` ampliado (campos requeridos, `.max(500)`, array vacío, ids duplicados, `medio_pago` inválido, `fecha_pago` futura). *(El nombre real es este, bajo `schemas/`, no `services/tesoreria/cuenta-por-pagar.pago.test.ts` como decía esta fila en la Rev. 3.)* |
| `package.json` | **Hecho (2026-09-10)** — los 3 `.test.ts` nuevos de HU-G10 (`cuentas-origen`, `cuenta-por-pagar.comprobantes`, `cuentas-por-pagar.pago`) agregados a la lista `node --test` de la línea 10 |
| `src/app/(dashboard)/tesoreria/cuentas-por-pagar/{page.tsx,actions.ts}` · `src/components/tesoreria/{ListaCuentasPorPagar,FormularioRegistroPago,ModalPagoRegistrado}.tsx` · `src/components/layout/Sidebar.tsx` | **Creado (2026-09-10, PR2a/PR2b)** — consola de solo lectura + form de pago + modal read-back + entrada de sidebar. Detalle en `HU10_MODULO_G.md` |
