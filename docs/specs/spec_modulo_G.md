# Especificación Técnica — Módulo G (Gestión de Caja y Tesorería)
## Revisión 6.1 — 15/10/2026: G3-3, G3-4 y cierre de §9 alineados con la Asignación (QR por Cluster 4) y con la vista de detalle; G4-5 alineado con el Backlog Sprint 5 (la NC usa el número de su venta original). Pendiente de revisión del PM.
## Revisión 6 — Sprint 5: HU-G3, G4, G5, G7 y G12 a G16. La sección 9 sustituye para esas HU las exclusiones históricas de §⚠️/§5 y corrige §3.1 para la presentación separada de PROVISORIO. Referencia principal de esta revisión: `sprint_5_swat_indumentarias_erp.md`; el Product Backlog Sprint 5 `(1)` y el Alcance Funcional `(1)` quedan como fuentes adicionales pendientes de cotejo.
## Contenido histórico de Sprint 2 (HU-G8 + HU-G10) y Sprint 4 (HU-G11), ampliado para Sprint 5 en §9
## Revisión 5 — Sprint 4: agrega HU-G11 (registro automático de ingresos por cobros online), sección 2.6 nueva. Consume `ecommerce:transaccion_pago_registrada` de `spec_modulo_E.md` (HU-E2/HU-E6) y el contrato de reintegro de HU-E13. Mismo patrón arquitectónico reactivo que HU-G8 (listener + entidad propia + evento de seguimiento). Sin cambios en las secciones de HU-G8/HU-G10 (Sprint 2).
## Revisión 4 — HU-G10 implementada y verificada en runtime (2026-09-10); reconcilia el pseudocódigo de la Rev. 3 contra el código real

> **Estado de HU-G10 al 2026-09-10.** Implementada y verificada. Se entregó en tres PRs encadenados (`feature-branch-chain`, sin rama-tracker intermedia): **PR1** `feature/HU-G10-pago-backend` (contrato backend, base `develop`), **PR2a** `feature/HU-G10-pago-ui-lista` (consola de solo lectura), **PR2b** `feature/HU-G10-pago-ui-form` (form + server actions + modal). El bloqueante de HU-H9 quedó resuelto (`ComprobanteProveedor` mergeado). Cinco decisiones fijadas en la Rev. 3 se implementaron con ajustes respecto del pseudocódigo — ver anotaciones `— implementado (2026-09-10)` en §2.4, §3.7, §4.1, §4.2 y §5. Verificación en runtime: Fase 11 corrida dos veces (pre y post-merge de `origin/develop`), `verificar-cadena → integra: true`, `audit_logs` 3 → 10 (delta +7, sin filas de más), + walkthrough de browser de la consola.

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM 6 · TypeScript (strict) · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Trazabilidad Inalterable, hash SHA-256 encadenado) · `Documento de Alcance Funcional y Técnico` (sección Módulo G; sección 2.1 "Flujo de estados de una Orden de Compra"; sección 3.4 corregida — Módulo H como fuente de la proyección de egresos junto con B/C/E; sección 5 y 5.1 — matriz de acceso y restricción de datos bancarios) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja `Sprint 2`, HU-G8, HU-G10, HU-H9; hoja `Sprint 4`, HU-G11) · `schema.prisma` (modelos `CuentaPorPagar`, `OrdenCompra`, `OrdenCompraItem`, `Recepcion`, `RecepcionItem`, `Proveedor`) · `spec_modulo_H.md` (evento `orden_compra:estado_cambiado`, emitido por HU-H3; modelo `ComprobanteProveedor`, HU-H9) · `spec_modulo_E.md` (sección 2.2/2.6/2.13, HU-E2/HU-E6/HU-E13 — origen del evento consumido por HU-G11, sección 2.6)

---

## ⚠️ Alcance de este documento

**Alcance histórico hasta Revisión 5.** Se cubrían **HU-G8** (Compromisos de Pago / Cuenta por Pagar), **HU-G10** (registro del pago) y **HU-G11** (cobros web). La Revisión 6 agrega HU-G3, G4, G5, G7 y G12–G16 en §9. HU-G2 (conciliación automática) y otras HU no priorizadas siguen fuera de esta especificación.

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

## 2.6. Registro automático de ingresos por cobros online (HU-G11, Sprint 4)

**Contenido agregado para Sprint 4.** Sección nueva — el resto de este documento (§1 a §2.5, HU-G8/HU-G10) corresponde a Sprint 2 y no se modifica. HU-G11 sigue el **mismo patrón arquitectónico ya establecido por HU-G8** (sección 1, "Patrón arquitectónico nuevo"): un listener reactivo que escribe estado de dominio propio dentro de su propia `prisma.$transaction` y emite un evento de seguimiento post-commit — no un endpoint de alta manual.

**Origen y dependencia:** consume `ecommerce:transaccion_pago_registrada`, emitido por Módulo E al confirmarse un pago web (`spec_modulo_E.md` secciones 2.2 y 2.6, HU-E2/HU-E6) — evento **sensible**, con encadenamiento SHA-256 propio hacia Módulo D, del cual este listener es un consumidor adicional (no reemplaza ni compite con el consumo de Módulo D). Módulo G no valida el pago en sí — esa responsabilidad es exclusiva de Módulo E/F; Módulo G únicamente proyecta el ingreso hacia Tesorería.

**Modelo de datos:**
```prisma
model IngresoTesoreria {
  id                     String   @id @default(uuid())
  pedido_venta_id        String   @unique // idempotencia por venta — ver comportamiento
  mercadopago_payment_id String   @unique // idempotencia por pago — segunda guarda, ver comportamiento
  monto                  Decimal  @db.Decimal(12, 2)
  fecha                  DateTime
  estado                 String   @default("PENDIENTE_CONCILIACION") // "PENDIENTE_CONCILIACION" | "CONCILIADO" — la transición a CONCILIADO es responsabilidad de HU-G2, fuera de este documento (ver Fuera de Alcance)
  caja_virtual           String   @default("MERCADO_PAGO_CANAL_WEB") // constante — no se crea un catálogo de cajas nuevo en esta HU, ver comportamiento
  contra_asientos        ContraAsientoIngreso[]
  created_at             DateTime @default(now())
  updated_at             DateTime @updatedAt // Sprint 4, cierre: `estado` transiciona (HU-G2) — deja constancia de cuándo
  @@map("ingresos_tesoreria")
}

model ContraAsientoIngreso {
  id                  String   @id @default(uuid())
  ingreso_original_id String
  ingreso_original    IngresoTesoreria @relation(fields: [ingreso_original_id], references: [id], onDelete: Restrict)
  pedido_venta_id     String   @unique // un reintegro por venta — idempotencia, ver comportamiento
  monto               Decimal  @db.Decimal(12, 2)
  motivo              String
  created_at          DateTime @default(now())
  // Sin is_active/deleted_at/deleted_by/deletion_reason: es un asiento contable inmutable por diseño
  // (nunca se edita ni se elimina — criterio de aceptación explícito), no una entidad con ciclo de baja lógica.
  @@map("contra_asientos_ingreso")
}
```

**Ruta (consulta, mismo patrón de 2.5):** `GET /api/tesoreria/ingresos-web` → `src/app/api/tesoreria/ingresos-web/route.ts`
**Permiso requerido:** `cuentas_por_pagar:leer` **no aplica** — se agrega un permiso propio `tesoreria:leer_ingresos_web` (namespace `MODULO_G`, mismo rol `TESORERO_CENTRAL` que el resto de este documento; ver sección 7 actualizada).

```typescript
export const FiltrosListadoIngresosWebSchema = z.object({
  estado: z.enum(["PENDIENTE_CONCILIACION", "CONCILIADO"]).optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});
export type FiltrosListadoIngresosWebInput = z.infer<typeof FiltrosListadoIngresosWebSchema>;
```

**Comportamiento esperado:**
- **Registro automático, sin turno de Cajero POS (criterio de aceptación explícito, no negociable):** al procesar `ecommerce:transaccion_pago_registrada`, el listener (`src/lib/events/listeners/ingreso-tesoreria.listener.ts`) crea una fila `IngresoTesoreria` con `identificador de pago de Mercado Pago, monto, fecha` y `estado = "PENDIENTE_CONCILIACION"`. Los cobros web **no** se imputan a ningún `TurnoCaja` de Módulo B (HU-B2) — se acreditan a la caja virtual constante `"MERCADO_PAGO_CANAL_WEB"`. Este documento no crea un catálogo de cajas nuevo (mismo criterio de "catálogo const sin entidad propia" ya usado por `cuenta_origen_id` de HU-G10, sección 5) — si en el futuro existen múltiples cajas virtuales, esa es una ampliación de HU-G7, no de esta sección.
- **Idempotencia con doble guarda (criterio de aceptación explícito: "un mismo identificador de pago de Mercado Pago nunca genera dos ingresos"):** `mercadopago_payment_id` es `@unique`. El listener usa `create` con captura de `P2002` tratado como no-op, mismo patrón de idempotencia que HU-A10/HU-H4/HU-F3/HU-E2. Se agrega además `pedido_venta_id` como `@unique` — no porque el criterio de aceptación lo pida explícitamente, sino porque `spec_modulo_E.md` (sección 3.6) garantiza que el webhook de origen ya es idempotente por pago; esta segunda guarda evita que un reprocesamiento manual (ver el punto de fallo, abajo) cree un ingreso duplicado si se reintenta con el mismo pedido pero, por algún error externo, un `mercadopago_payment_id` distinto.
- **Después del `COMMIT` de la venta, sin revertirla (criterio de aceptación explícito, no negociable — mismo patrón fire-and-forget que todo el proyecto):** el listener corre después del `COMMIT` de la transacción de Módulo E que confirmó el pago (sección 2.2 de `spec_modulo_E.md`). Una falla en este registro **no revierte la venta ya confirmada** — es el mismo principio ya documentado en la sección 3.6 de este propio documento ("Fallo del listener — sin conciliación en este slice") para HU-G8.
- **"Pendiente y reintentable, visible para el Tesorero" (criterio de aceptación explícito) — sin mecanismo de reintento automático en este proyecto (hallazgo de relevamiento, no resuelto silenciosamente):** el Backlog exige que una falla de este registro quede "pendiente y reintentable". Ningún listener existente en el ERP (ni el de HU-G8, según la sección 3.6 de este mismo documento, ni `audit-log.listener.ts`) implementa una cola de reintentos — el patrón establecido es fire-and-forget con logueo del error, sin reintento automático. Este documento **no inventa** una infraestructura de colas nueva para resolver esto. Se define, como salida mínima consistente con el patrón existente, un endpoint manual de reprocesamiento: `POST /api/tesoreria/ingresos-web/reprocesar/route.ts` (permiso `tesoreria:leer_ingresos_web`), que recibe un `pedido_venta_id` y vuelve a invocar el mismo servicio de creación de `IngresoTesoreria` a partir del `PedidoVentaEcommerce` ya confirmado — visible para el Tesorero como una acción manual, no como un reintento automático en background. Se reporta como decisión tomada para no dejar el criterio de aceptación sin cobertura, a confirmar con el equipo si se prefiere una cola de reintentos real antes de implementar.
- **Consulta por fecha y estado (criterio de aceptación explícito):** el endpoint de arriba filtra por `estado`/`fecha_desde`/`fecha_hasta`, mismo patrón de paginación `page`/`page_size` que 2.5.
- **Insumo de HU-G2 y HU-G7:** la transición `PENDIENTE_CONCILIACION → CONCILIADO` es responsabilidad de HU-G2 (conciliación automática de cobros electrónicos), todavía fuera de este documento. La posición diaria HU-G7 se define en la Revisión 6, §9.8, y consume este ingreso como fuente junto a Módulos B/C/H.
- **Contra-asiento por reintegro (criterio de aceptación explícito, no negociable):** un reintegro de Módulo E (`spec_modulo_E.md` sección 2.13, HU-E13) genera una fila `ContraAsientoIngreso` vinculada al `IngresoTesoreria` original — **nunca se edita ni se elimina** el ingreso original, el contra-asiento es un registro aparte, inmutable desde su creación (sin campos de baja lógica, ver modelo arriba — es un asiento contable, no una entidad de ciclo de vida). `pedido_venta_id` `@unique` en `ContraAsientoIngreso` evita que un mismo reintegro genere dos contra-asientos (idempotencia, coherente con el propio criterio de "un pedido nunca genera dos reintegros" ya definido en `spec_modulo_E.md` sección 2.13).
- **Evento auditado obligatorio:** tanto la creación de un `IngresoTesoreria` como la de un `ContraAsientoIngreso` emiten `tesoreria:ingreso_web_registrado` / `tesoreria:contra_asiento_ingreso_registrado` (sección 4) hacia Módulo D, con encadenamiento SHA-256 — mismo patrón que el resto de este documento.

**Respuesta `200 OK` (consulta):**
```json
{ "data": { "registros": [ { "ingreso_id": "uuid", "pedido_venta_id": "uuid", "mercadopago_payment_id": "...", "monto": "87000.00", "fecha": "2026-09-28T14:02:11.000Z", "estado": "PENDIENTE_CONCILIACION", "caja_virtual": "MERCADO_PAGO_CANAL_WEB" } ], "total": 1, "page": 1, "page_size": 25 }, "error": null }
```

**Respuesta `201 Created` (reprocesamiento manual):**
```json
{ "data": { "ingreso_id": "uuid", "pedido_venta_id": "uuid", "reprocesado": true }, "error": null }
```

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. El `PROVISORIO` nunca es deuda exigible
Es informativo. El `GET` (2.5) expone `estado` por fila tal cual. `PROVISORIO` se excluye del total de deuda exigible y del total de egresos proyectados; HU-G7 lo presenta aparte como **compromiso estimado** sin sumarlo con `DEFINITIVA` (Revisión 6, §9.8). Esta clasificación corresponde a HU-G7, no a HU-G8. El modelo no la impide a nivel de constraint.

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
| `ecommerce:transaccion_pago_registrada` *(consumido, Sprint 4)* | Módulo E, `spec_modulo_E.md` sección 2.2/2.6 (HU-E2/HU-E6) | Listener de 2.6 (`ingreso-tesoreria.listener.ts`) | Ver `spec_modulo_E.md` sección 4 — `{ transaccion_id, pedido_venta_id, monto, estado_pago, mercadopago_payment_id }` |
| `tesoreria:ingreso_web_registrado` / `tesoreria:contra_asiento_ingreso_registrado` *(nuevos, Sprint 4)* | 2.6 | `audit-log.listener.ts` | `{ ingreso_id \| contra_asiento_id, pedido_venta_id, monto, mercadopago_payment_id? }` |

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
- **Nota histórica hasta Revisión 5:** HU-G7 y otras HU del módulo estaban fuera. HU-G7 y las HU de Sprint 5 se incorporan en §9 de la Revisión 6; HU-G2 permanece fuera.

### Pendientes específicos de HU-G11 (Sprint 4)

- **Transición `PENDIENTE_CONCILIACION → CONCILIADO`** — responsabilidad de HU-G2, no definida en este documento. `IngresoTesoreria.estado` queda modelado con ambos valores, pero el endpoint/servicio que ejecuta la conciliación automática contra la liquidación real de Mercado Pago es de HU-G2.
- **Mecanismo de "pendiente y reintentable" ante fallo del listener** — resuelto en este documento con un endpoint manual de reprocesamiento (2.6), no con una cola de reintentos automática, por no existir ese patrón en ningún otro listener del proyecto. A confirmar con el equipo si se prefiere una solución de cola real antes de implementar (ver nota completa en 2.6).
- **Permiso `tesoreria:leer_ingresos_web` — alcance de roles a confirmar.** El Alcance Funcional no lo detalla con el mismo nivel que `cuentas_por_pagar:leer`; se siembra provisionalmente solo para `TESORERO_CENTRAL`.
- **Migración nueva, no incluida en este documento:** `model IngresoTesoreria`, `model ContraAsientoIngreso` y el permiso `tesoreria:leer_ingresos_web` no existen todavía en `schema.prisma`/`seed.ts` — a diferencia de HU-G8 (que reutilizó un modelo ya migrado), HU-G11 requiere migración nueva desde cero.

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
| `tesoreria:leer_ingresos_web` *(nuevo, Sprint 4, HU-G11)* | `MODULO_G` | `TESORERO_CENTRAL` (el Alcance no cita explícitamente a `AUDITOR`/`ADMINISTRADOR` para este permiso puntual — a confirmar antes de sembrar; no se asume por analogía con `cuentas_por_pagar:leer`) |

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

---

## 9. Contratos Sprint 5 (Revisión 6)

**Fuente y trazabilidad.** La referencia principal de criterios de esta revisión es `sprint_5_swat_indumentarias_erp.md`. El `Product Backlog - SWAT Indumentarias Sprint 5 (1).xlsx`, hoja `Sprint 5`, y el Alcance Funcional `(1)` Módulo G §§3.3–3.6 y matriz §5 se citan como fuentes adicionales pendientes de cotejo cuando estén disponibles; su mención no resuelve diferencias con el plan. Las tareas T1–T3 tienen contratos propios en `docs/tasks/sprint-5/`. G14 usa `obtenerResumenMensual`; G15 implementa `obtenerBloquesAdicionales` y cierra su integración con la UI de G14/G16; G7 presenta `PROVISORIO` separado de `DEFINITIVA`. Cada identificador `Gxx-n` permite trazar un requisito verificable de la HU indicada; cuando una viñeta del plan incluye dos reglas, se pueden desglosar aquí. Estas son especificaciones de módulo para derivar tasks, no tasks de implementación.

**Estado de la base compartida.** El backlog describe un PR 0 de fundación (commit `a147314` y complemento 14/10) con `CategoriaGasto`, `GastoOperativo`, `rangoMesNegocio`, `rangoMesFechaSolo`, rol `GERENTE`, `tesoreria:leer_reportes`, `ResumenMensualDto`, `obtenerResumenMensual` stub, `obtenerBloquesAdicionales` stub y eventos de gastos. **En este checkout (`a1c382c`) aún no están presentes**; los contratos de §9 son el objetivo de integración, no una afirmación sobre el código actual. Antes de derivar las tasks, el responsable de integración debe publicar las firmas/DTO reales del PR 0 y cotejarlas con esta sección; si difieren, ajustar aquí antes de implementar una HU. No se crean servicios competidores por cluster.

### 9.1. Convenciones compartidas, datos y permisos

- Todos los límites mensuales usan `America/Argentina/Buenos_Aires`: `[día 1 00:00, día 1 del mes siguiente 00:00)`, convertidos a instantes UTC al consultar `DateTime`. Las fechas solo-día de gastos/saldos se comparan por calendario argentino mediante `rangoMesFechaSolo`; no se convierten en instantes UTC a medianoche por intuición. Un mes vacío devuelve estructura completa y ceros.
- Importes monetarios se calculan con `Decimal` de Prisma o aritmética decimal exacta y se serializan como strings con dos decimales en DTO/CSV/PDF. Nunca se suman `number` de punto flotante ni se confía en totales del navegador. Se redondea al final de cada cálculo especificado.
- Cada Route Handler y Server Action verifica el permiso propio en el servidor. El seed usa UUID preasignados `...1111-...-000000000045` a `...056` del documento de Asignación; ninguna task elige UUIDs en paralelo. El rol `GERENTE` usa el UUID fijo `...2222-...-000000000006` y usuario `gerente.seed` de T3/PR 0. El nombre de rol documenta la matriz, pero las decisiones de acceso se hacen por permisos.
- G12/G13 consumen el modelo y helper del PR 0; no hacen una segunda migración de esos modelos. G5/G7 y D6 sí necesitan migraciones aditivas revisadas con `--create-only` y comprobación de índices manuales. La baja lógica usa `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`; ningún histórico se borra físicamente.
- Los eventos de dominio se emiten después del COMMIT y los consume D.3 para `AuditLog` hash-encadenado. Un evento no lleva CBU, alias, descripción sensible ni datos innecesarios. En operaciones cuyo éxito exige asiento auditable, se verifica la presencia del asiento en pruebas de integración; la semántica de fallo/reintento del bus in-process existente se declara en la task, sin afirmar atomicidad entre COMMIT y listener.

| Permiso | Habilitados según el plan Sprint 5 | Contrato |
|---|---|---|
| `tesoreria:gestionar_categorias_gasto` | Administrador | G12: altas, cambios y baja |
| `tesoreria:gestionar_gastos` | Tesorero Central | G13: altas, cambios y baja |
| `tesoreria:leer_reportes` | Tesorero Central, Auditor, Administrador, Cajero POS, Gerente | G14/G7: lectura agregada |
| `tesoreria:leer_desglose_gastos` | Todos los lectores anteriores salvo Cajero POS | G14/G16: categoría y filas de gastos |
| `tesoreria:exportar_reportes` | Gerente, Tesorero Central, Auditor | G16/G15: CSV y PDF; Administrador y Cajero POS excluidos |
| `tesoreria:leer_comprobantes` | Cajero POS, Tesorero Central, Auditor, Administrador | G3; Gerente excluido |
| `tesoreria:exportar_libro_iva` | Auditor, Administrador | G4; los demás excluidos |
| `tesoreria:gestionar_cuentas_bancarias` | Administrador | G5: gestión |
| `tesoreria:leer_cuentas_bancarias` | Tesorero Central, Auditor, Administrador, Gerente | G5: lectura enmascarada |
| `tesoreria:ver_datos_bancarios` | Tesorero Central, Administrador | G5: revelado explícito |
| `tesoreria:registrar_saldo_diario` | Tesorero Central | G7: registros append-only |

### 9.2. HU-G12 — Categorías de gasto (backlog fila 7)

| CA | Contrato verificable |
|---|---|
| G12-1 | Entidad `CategoriaGasto` del PR 0 con `id`, nombre obligatorio recortado, descripción opcional y estado activo; operaciones de alta, edición y baja en Tesorería. No se expone DELETE físico. |
| G12-2 | `nombre_normalizado` único entre activas e inactivas, insensible a mayúsculas/minúsculas y espacios extremos. La garantía se implementa también en base (índice/columna canónica revisada en migración PR 0); duplicado concurrente produce un error de dominio explícito, no un 500 ni dos filas. |
| G12-3 | Baja lógica con motivo recortado de ≥5 caracteres. La categoría deja de ofrecerse para altas de gastos, pero los registros históricos siguen mostrando su nombre. |
| G12-4 | Se permite la baja con gastos activos relacionados; no se actualizan ni anulan esos gastos. FK `onDelete: Restrict` conserva el historial. |
| G12-5 | Seed idempotente de Sueldos, Alquiler, Servicios, Impuestos y Otros con UUID fijos acordados en Asignación. Siguen siendo editables. |
| G12-6 | `tesoreria:gestionar_categorias_gasto` verificado en API/acción; 403 sin permiso y pantalla de no autorizado. El listado disponible para seleccionar una categoría en G13 respeta el permiso de G13 y no requiere permiso de gestión G12. |
| G12-7 | `categoria_gasto:creada`, `:editada`, `:dada_de_baja` identifican actor, categoría y valores anterior/nuevo no sensibles; D.3 los registra en cadena SHA-256. No-op de edición no genera evento. |

Superficie propuesta: listado y formulario bajo `/tesoreria/categorias-gasto`, API `/api/tesoreria/categorias-gasto` y `/[id]` con `GET/POST/PATCH`; la baja se distingue de la edición y exige motivo. El nombre de las rutas puede seguir las convenciones del PR 0, pero la respuesta de errores y las invariantes anteriores son obligatorias.

### 9.3. HU-G13 — Gastos operativos (backlog fila 8)

| CA | Contrato verificable |
|---|---|
| G13-1 | `GastoOperativo` del PR 0 guarda categoría, fecha solo-día, monto `Decimal(12,2)` y descripción no vacía; para el alta la categoría debe existir y estar activa. |
| G13-2 | Fecha ≤ día actual en Argentina; hoy es válido. El servidor valida la forma `AAAA-MM-DD` y no la deriva del huso del navegador. |
| G13-3 | Monto > 0 y escala ≤2: cadenas con tercera cifra decimal se rechazan, no se redondean silenciosamente. |
| G13-4 | Solo gasto activo editable. Si cambia de categoría, destino activo; si no cambia, conserva una categoría que se dio de baja luego del alta. Auditoría con antes/después. |
| G13-5 | Baja lógica con motivo ≥5 caracteres; inactivo no editable y excluido de todos los totales y detalles de G14/G15. |
| G13-6 | Listado de activos filtrable por mes argentino y categoría, con total calculado en servidor sobre exactamente el conjunto filtrado; cero en vacío. Históricos con categoría dada de baja conservan su etiqueta. |
| G13-7 | `tesoreria:gestionar_gastos` en servidor para mutaciones y acceso operativo, asignado a Tesorero Central. |
| G13-8 | El monto registrado es total, sin separación de IVA; el formulario y el reporte indican esa limitación. |
| G13-9 | Después del COMMIT emite `gasto_operativo:creado`, `:editado`, `:dado_de_baja` (declarados en PR 0) con `gasto_operativo_id`, `categoria_gasto_id`, `fecha`, `monto` y actor; D.3 audita las transiciones y D6 reevalúa el mes afectado. En una edición de fecha se reevalúan mes anterior y nuevo. |

Servicio único de alta/edición/baja y consulta bajo `src/lib/services/tesoreria/`; no se escribe directamente `GastoOperativo` desde el Route Handler. La task cubre validación de calendario, cambio de categoría inactiva, concurrencia de baja y suma filtrada.

### 9.4. HU-G14 — Núcleo del reporte mensual (backlog fila 9)

`obtenerResumenMensual(mes, permisos)` es la única función de cálculo, en `reporte-mensual.service.ts`, y devuelve el `ResumenMensualDto` del PR 0 en `snake_case` e importes string. La API y la pantalla solo proyectan este resultado; G16, G15 y D6 reutilizan la misma aritmética. Un adaptador de permiso **elimina** campos restringidos antes de serializar; ocultarlos con CSS no satisface G14-11.

| CA | Contrato verificable |
|---|---|
| G14-1 | Selector de `AAAA-MM`, rango argentino semiabierto de §9.1; mes sin fuentes devuelve líneas/totales en `0.00` y detalle vacío. |
| G14-2 | Base caja: ningún `Presupuesto`, `PedidoVenta` reservado, comprobante de proveedor no pagado o movimiento devengado entra solo por existir. |
| G14-3 | Ingresos web = suma de `IngresoTesoreria.monto` por `fecha` en rango, tanto `PENDIENTE_CONCILIACION` como `CONCILIADO`, una vez por ingreso. |
| G14-4 | Reintegros = suma positiva de `ContraAsientoIngreso.monto` por `created_at` en rango; línea `Reintegros web` se resta una sola vez, sin depender del mes del cobro original. |
| G14-5 | Mostrador = `VentaMedioPago.importe` activo de `PedidoVenta` activo con `canal = MOSTRADOR`, `estado IN (FACTURADO, REMITO_EMITIDO, CERRADO)` y `fecha_facturacion` en rango, agrupado por `medio`, excepto `CUENTA_CORRIENTE`; nunca suma `WEB` ni `ANULADO`. Una venta aún sin facturar queda fuera aunque haya medios persistidos. La facturación aproxima la fecha de cobro y se rotula como limitación. |
| G14-6 | Egresos = `CuentaPorPagar` activa `PAGADA` por `fecha_pago`, más `GastoOperativo` activo por fecha solo-día, ambos en rango. Los gastos se agrupan por categoría histórica; ni `PROVISORIO` ni `DEFINITIVA` suman como pago. |
| G14-7 | `ingresos = web + mostrador − reintegros`; `egresos = cuentas pagadas + gastos`; `resultado_neto = ingresos − egresos`; `porcentaje_egresos = egresos / ingresos × 100` solo si ingresos > 0, de lo contrario `null` presentado «—». |
| G14-8 | `CUENTA_CORRIENTE` de mostrador se calcula con la misma fecha/fuente de G14-5 y aparece únicamente como línea informativa, sin afectar ingresos, egresos ni resultado. |
| G14-9 | Detalle individual con fecha, concepto, fuente/id e importe para ingreso web, reintegro (signo negativo), medio de venta, cuenta pagada y gasto. Orden estable por fecha e id; ninguna fuente se duplica por joins a ítems/comprobantes. |
| G14-10 | Lectura con `tesoreria:leer_reportes` para los cinco perfiles de §9.1; sin permiso, 403 y no autorizado. |
| G14-11 | Categorías y filas individuales de gastos solo con `tesoreria:leer_desglose_gastos`; sin él se proyecta un único total de gastos operativos y no se consultan/envían conceptos ni categorías al navegador. G14 asigna este permiso al Gerente por seed, además de `tesoreria:leer_reportes`, y T3 verifica el desglose para Gerente y su ausencia para Cajero POS. |
| G14-12 | Servicio/DTO reutilizable conforme al contrato del PR 0. HU-G16 y D6 consumen su versión real, sin calcular totales en componentes ni duplicar SQL. |
| G14-13 | Nunca se usa nombre de rol en condicionales de autorización. |
| G14-14 | El reporte no separa IVA; se informa esta limitación en UI y exportaciones. |

**Extensión de pantalla de G14.** Debajo del detalle, la pantalla llama `obtenerBloquesAdicionales(mes, permisos)` y representa cada `{ titulo, columnas, filas }` como tabla genérica. El stub del PR 0 devuelve `[]`. G14 no contiene lógica específica de proveedor/comparativa; G15 la aporta. Esta es una ampliación técnica de la spec para integrar G15, sin reemplazar criterios del plan `.md`.

### 9.5. HU-G3 — Repositorio de comprobantes fiscales (backlog fila 11)

| CA | Contrato verificable |
|---|---|
| G3-1 | Consulta `ComprobanteFiscal` emitidos por HU-B7, relacionados a `PedidoVenta` de ambos canales. No reemite, copia ni corrige comprobantes al listar. |
| G3-2 | Filtros combinables: DNI/nombre de `Cliente`, período de `ComprobanteFiscal.created_at` en hora Argentina, `TipoComprobanteVenta` (A/B/Ticket/Nota de Crédito) y `PedidoVenta.canal`; orden `created_at DESC, id DESC`, paginación en base y conteo coherente. La búsqueda de cliente sin DNI usa el nombre registrado; no expone datos extra del cliente. |
| G3-3 | Vista y descarga de PDF para cualquier ID autorizado: reutiliza el renderizado/PDF de HU-E9/HU-B7, con `cae_simulado`, `qr_data_url` válido y leyenda visible `SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP`. QR inválido produce error controlado de dato histórico, nunca un PDF falsamente completo; el Cluster 4 corrige y siembra los QR válidos de los comprobantes existentes dentro de `seedSprint5Cluster4()` (Asignación y Coordinación del Sprint 5). La descarga admite visualización inline con `?disposicion=inline` (`Content-Disposition: inline`); sin el parámetro se descarga como adjunto y un valor desconocido es un error de validación. |
| G3-4 | Si `comprobante_original_id` está presente, la vista de la Nota de Crédito enlaza el original; el original muestra `notas_credito`. La relación proviene de la propia tabla, no de números inferidos. La UI ofrece la vista de detalle `/tesoreria/comprobantes/[id]`, con link de la NC a su original y del original a cada una de sus NC; el número y la columna «Vinculado» del listado enlazan a esa vista. |
| G3-5 | No hay método de edición/baja en el servicio, API ni UI. Reversión por emisión de Nota de Crédito según B7/E13. |
| G3-6 | `tesoreria:leer_comprobantes` cubre listado, vista y descarga; 403 para Gerente y cualquier usuario sin permiso. El permiso de cliente web de E9 no habilita el repositorio interno. |

Superficie: `/tesoreria/comprobantes` y `/api/tesoreria/comprobantes` (`GET`) más `GET /api/tesoreria/comprobantes/[id]` y `/[id]/pdf`; sus respuestas no alteran `/api/ventas/comprobantes/[id]` ni la descarga de E9. El servicio de consulta se reutiliza en G4 con una proyección fiscal controlada, sin pasar por una API paginada para generar el libro completo. Pruebas: ambos canales, filtros y frontera de día argentino, nota/original, PDF válido, 403, y ausencia de operaciones mutantes.

### 9.6. HU-G4 — Libro de IVA Digital interno (backlog fila 12)

| CA | Contrato verificable |
|---|---|
| G4-1 | Ventas por `ComprobanteFiscal.created_at` del período: A, B, Ticket y Notas de Crédito; estas se exportan con importes negativos. Compras por `ComprobanteProveedor.fecha_emision` del período, solo `is_active = true`. Cada comprobante aparece una vez, independiente de cuántos pagos/ítems tenga su venta u orden. |
| G4-2 | Para cada total absoluto, `neto = redondear(total / 1.21, 2)` e `IVA = total − neto`; luego se aplica el signo de Nota de Crédito a las tres columnas. Alícuota `21.00` aun para Facturas B/C y Tickets: simplificación explícita, nunca IVA real calculado por AFIP. |
| G4-3 | Dos descargas TXT UTF-8 (Ventas y Compras), separador `;`, una línea por comprobante, orden estable por fecha/id y columnas exactas: `fecha AAAAMMDD;tipo;pv 5 dígitos;número 8 dígitos;tipo_doc;número_doc;denominación;total;neto;iva;21.00`. Importes con punto y dos decimales; texto escapado/saneado para que `;`, CR o LF en nombres no rompa columnas. |
| G4-4 | Códigos de comprobante del subconjunto: A `001`, NC A `003`, B `006`, NC B `008`, C `011`, M `051`, Ticket `083`. Documentos: CUIT `80`, DNI `96`, consumidor final `99`. Una Nota de Crédito usa el tipo A/B del original si el enum vigente solo distingue `NOTA_CREDITO`; si no puede determinarse, error de dato explícito, no código inventado. |
| G4-5 | Ventas: PV `00001`; el número se deriva del número de venta de B7 mediante un mapeo numérico documentado, se completa a ocho dígitos y nunca se trunca. Si el origen no permite un número válido y único de ocho dígitos, la exportación informa un error controlado. Cada Nota de Crédito usa el **número de su venta original**, con el mismo mapeo a ocho dígitos que su factura, y el código de NC que corresponde al tipo del original (A → `003`, B → `008`), según el Backlog Sprint 5. La combinación `(tipo, PV, número)` no choca con la de la factura porque cambia el código de tipo, y HU-E13 admite una sola NC por pedido (reintegro total). Si un original tiene más de una NC, o el número de la venta no puede mapearse a ocho dígitos sin truncar, se informa un error controlado; no se inventa ningún número. Contraparte por DNI o `99` consumidor final. Compras: CUIT de proveedor y número desde `numero_comprobante` de H9. Si H9 no registra PV separable, se usa el valor por defecto documentado `00001`; si registra un PV válido, se conserva. Si no puede derivarse un número de comprobante válido de ocho dígitos, se informa un error controlado: no se inventa ni trunca. El valor por defecto se identifica en la documentación de la exportación. |
| G4-6 | En nombre de archivo, pantalla y documentación se rotula `SUBCONJUNTO INTERNO — COMPROBANTES SIMULADOS`; no se lo presenta como TXT oficial completo ni se envía a un organismo. Ejemplos de líneas abajo forman parte del contrato. |
| G4-7 | `tesoreria:exportar_libro_iva` en servidor para ambas descargas; solo Auditor y Administrador. 403 para Cajero POS, Tesorero Central y Gerente. |
| G4-8 | Cada descarga emite evento `tesoreria:libro_iva_exportado` con actor, período, tipo de libro y timestamp, que D.3 encadena; nunca incluye las líneas del archivo ni datos personales. |

**Ejemplos de formato** (datos ilustrativos simulados; se validan con fixtures que respeten el enum y numeración reales):

```text
20261001;006;00001;00001234;96;30111222;Cliente Ejemplo;121.00;100.00;21.00;21.00
20261003;008;00001;00001234;96;30111222;Cliente Ejemplo;-121.00;-100.00;-21.00;21.00
20261005;001;00002;00004567;80;30700111223;Proveedor Ejemplo;242.00;200.00;42.00;21.00
```

Estos ejemplos no autorizan inventar el `tipo` ni un número de comprobante ausente; la línea de NC ilustra la regla de G4-5: usa el número de su venta original (el mismo `00001234` de la factura) con el código de NC del tipo del original (`006` → `008`). El PV de compras sin dato explícito es la excepción `00001` de G4-5. La task de G4 debe documentar los mapeos reales de B7/E13 y H9, el caso de `Factura M` de compras y las pruebas con dos NC del mismo original, número de venta no numérico o de más de ocho dígitos y colisiones de `(tipo, PV, número)`. El formato es deliberadamente un subconjunto interno y no promete conformidad completa con el aplicativo fiscal externo.

### 9.7. HU-G5 — Cuentas bancarias y cajas propias (backlog fila 13)

| CA | Contrato verificable |
|---|---|
| G5-1 | Entidad `CuentaPropia` (nombre, `tipo = BANCARIA | CAJA`, banco, CBU, alias, `is_active` y campos de baja); para caja los tres datos bancarios son opcionales, para bancaria son obligatorios y se validan con errores de campo. Baja lógica con motivo obligatorio, sin DELETE. |
| G5-2 | CBU y alias se cifran por campo con el Gateway AES-256 ya usado en legajos de proveedores y `ENCRYPTION_KEY_PROVEEDORES`; no se persisten ni registran en texto plano, tampoco en `AuditLog`, excepciones, logs o seeds. La task verifica de forma directa el valor almacenado. |
| G5-3 | `tesoreria:leer_cuentas_bancarias`: listado y detalle enmascaran CBU/alias dejando como máximo 4 caracteres finales. `tesoreria:ver_datos_bancarios` adicional habilita una acción explícita de revelar valores; la respuesta se marca `Cache-Control: no-store`. Cajero POS recibe 403. Los permisos se evalúan por separado en servidor. |
| G5-4 | Toda lectura de CBU/alias por Auditor, incluso enmascarada, registra `tesoreria:datos_bancarios_consultados` con actor, cuenta y momento, nunca valores. La auditoría ocurre en el servicio de consulta, no depende de que la UI pinte el dato. |
| G5-5 | El seed crea idempotentemente los IDs de texto actuales de `src/lib/tesoreria/cuentas-origen.ts`: `banco-nacion-cc-principal`, `banco-galicia-cc-operativa`, `caja-chica-central`. HU-G10 lista solo activas y valida en servicio dentro de la operación de pago; una cuenta inexistente/inactiva produce error de validación. `CuentaPorPagar.cuenta_origen_id` sigue `String?` sin FK en este sprint. Se agrega una etiqueta de cuenta congelada al pagar (o campo equivalente), con backfill de los pagos anteriores desde las tres etiquetas actuales; así ID y etiqueta históricos sobreviven baja o renombre. La validación Zod estática que hoy importa el catálogo debe migrar a una validación de servicio: el cliente no decide validez. |
| G5-6 | La task verifica el cifrado de CBU de proveedor ya existente en H; no duplica el campo ni crea CBU de cliente. |
| G5-7 | Sin cartera de cheques/valores; `E_CHEQ` del POS es un medio de venta, no una cuenta propia. |
| G5-8 | Alta, edición y baja requieren `tesoreria:gestionar_cuentas_bancarias` (Administrador) y generan eventos D.3 con antes/después **solo de campos no sensibles**; para CBU/alias se registra `cambiado: true/false`, nunca el valor o fragmentos. |

El modelo requiere migración aditiva y `onDelete: Restrict` para sus futuros saldos. El servicio de G10 debe resolver etiquetas de IDs históricos sin fallar si la cuenta está inactiva; el formulario ofrece solo activas. Pruebas de regresión de pago G10, cifrado, respuestas enmascaradas/reveladas, 403, acceso de Auditor y ausencia de dato sensible en el log son parte del contrato de G5.

### 9.8. HU-G7 — Posición diaria consolidada (backlog fila 14)

| CA | Contrato verificable |
|---|---|
| G7-1 | Para un día consultado de Argentina, muestra cada `CuentaPropia` activa, caja virtual `MERCADO_PAGO_CANAL_WEB` y total líquido consolidado. No incluye una cuenta inactiva salvo que se abra una vista histórica explícita fuera de esta HU. |
| G7-2 | Cobros/reintegros virtuales se incluyen hasta antes de las 00:00 del día argentino siguiente. Saldos propios son fecha solo-día. La fecha elegida rige los **saldos líquidos**; las deudas y cuentas corrientes proyectadas reflejan **estado actual** al consultar, no reconstrucción histórica para esa fecha. La UI y la respuesta distinguen ambos cortes temporales para que una consulta pasada no parezca una proyección histórica. |
| G7-3 | Por cuenta/caja se toma el último `SaldoDiarioCuenta` con `fecha <= día consultado`, ordenado por fecha y secuencia de registro descendentes, mostrando fecha del asiento. Sin asiento: `sin saldo registrado` y exclusión del total (no se presume cero). |
| G7-4 | Tesorero Central con `tesoreria:registrar_saldo_diario` registra `cuenta_id`, fecha, saldo `Decimal(12,2)`, actor y `created_at`. Asientos append-only: sin UPDATE/DELETE; una corrección crea otro asiento del mismo día y prevalece el último por `created_at,id`. Cada alta genera auditoría SHA-256. |
| G7-5 | Caja virtual = suma histórica `IngresoTesoreria.monto` por `fecha` menos `ContraAsientoIngreso.monto` por `created_at`, hasta el límite de G7-2. No se suman `VentaMedioPago` web ni se presumen retiros. La pantalla indica que los retiros no están modelados. |
| G7-6 | Ningún turno POS con `fecha_cierre = null` aporta saldo esperado a la posición ni a la respuesta HTTP; se conserva el arqueo ciego B2. |
| G7-7 | Egresos proyectados: `CuentaPorPagar` activa `DEFINITIVA` como deuda exigible y `PROVISORIO` como compromiso estimado en bloque **separado**. Agrupar por fecha de vencimiento y `sin fecha de vencimiento`; no sumar ambos grupos ni mezclar `PAGADA/CANCELADA`. Esta regla sustituye la frase histórica de §3.1 que decía excluir `PROVISORIO` de toda proyección. El total de egresos proyectados incluye solo `DEFINITIVA`. |
| G7-8 | Ingresos proyectados: saldo actual de cada `CuentaCorrienteCliente` y, aparte, hitos con fecha estimada del plan de pagos. Los hitos son informativos y no se suman a fondos líquidos ni al saldo corriente. Se explica que no hay registro de cobranzas externas de cuenta corriente, por lo que el saldo puede incluir importes ya cobrados fuera del sistema. |
| G7-9 | No se proyectan ingresos futuros del canal web en este sprint. |
| G7-10 | Lectura con `tesoreria:leer_reportes` para los cinco perfiles de §9.1; registro de saldo con permiso separado G7-4. Las cuentas se identifican por nombre/ID, sin revelar CBU/alias por esta ruta aun a quien tiene permiso de revelar. |

`SaldoDiarioCuenta` requiere migración aditiva con FK restrictiva a `CuentaPropia`, índice `(cuenta_id, fecha, created_at)` y sin ruta de edición/baja. Un saldo puede ser cero; si el negocio admite sobregiro, un saldo negativo se muestra con signo y no se recorta. La suma consolidada incluye únicamente saldos conocidos y caja virtual; los bloques proyectados no alteran el total. La task prueba fecha límite argentina, dos correcciones mismo día, cuenta sin saldo, pago/reintegro en meses distintos, separación PROVISORIO/DEFINITIVA y no filtración de turno abierto.

### 9.9. HU-G16 — Gráficos y exportación (backlog fila 17)

| CA | Contrato verificable |
|---|---|
| G16-1 | Los «últimos 6 meses» son seis meses consecutivos terminando en el mes seleccionado en G14 (incluido); al cambiar el selector cambia la ventana. Cada barra tiene `ingresos` y `egresos` calculados por `obtenerResumenMensual`. El gráfico del mes desglosa gastos solo con `tesoreria:leer_desglose_gastos`; para Cajero POS muestra únicamente total de gastos operativos. Ningún gráfico obtiene datos más amplios que el DTO autorizado. |
| G16-2 | Recharts + chart de shadcn compatible con React 19 y variables `--chart-1`…`--chart-5`; si la instalación del proyecto no es compatible, el mismo DTO se representa con SVG local, sin cambiar el contrato de datos ni los criterios de accesibilidad (etiquetas y tabla equivalente). |
| G16-3 | CSV UTF-8 con BOM y separador `;`, números decimales y acentos legibles en Excel. PDF con `pdf-lib`, totales/tablas y leyenda de limitaciones; no incrusta gráficos interactivos. Ambos se generan desde el DTO del servidor para el mes solicitado, no desde DOM o datos enviados por el cliente. |
| G16-4 | Exportación con `tesoreria:exportar_reportes` solo para Gerente, Tesorero Central y Auditor. Administrador y Cajero POS pueden leer G14, pero reciben 403 al exportar. |
| G16-5 | Si falta `tesoreria:leer_desglose_gastos`, CSV/PDF omiten categorías y filas de gastos; la descarga no consulta un DTO privilegiado y luego lo oculta al final. |
| G16-6 | CSV/PDF agregan los bloques `{ titulo, columnas, filas }` devueltos por `obtenerBloquesAdicionales` al final, en orden, de forma genérica. Si el stub devuelve `[]`, no agregan encabezados vacíos. |
| G16-7 | Cada descarga emite `tesoreria:reporte_exportado` con actor, mes, formato y timestamp para D.3. Un fallo antes de entregar el archivo no genera un evento falso de éxito. |

El CSV escapa delimitador, comillas y saltos de línea de conceptos; aplica formato tabular consistente al bloque genérico sin ejecutar fórmulas provenientes de texto de usuario. La task compara totales de pantalla/CSV/PDF para el mismo DTO y prueba exportación con/sin desglose y 403. No instala una dependencia de gráficos si ya existe una versión compatible verificable.

### 9.10. HU-G15 — Bloques adicionales de análisis (backlog fila 18)

| CA | Contrato verificable |
|---|---|
| G15-1 | Implementa **solo** `obtenerBloquesAdicionales(mes, permisos)` del PR 0 y devuelve bloques genéricos `Egresos por proveedor` y `Comparación con el mes anterior` (`titulo`, `columnas`, `filas`). G14 los muestra y G16 los exporta automáticamente; G15 no duplica ni modifica sus renderizadores. |
| G15-2 | Proveedores: `CuentaPorPagar` activa `PAGADA` por `fecha_pago` del mes, agrupada por razón social del proveedor, con total pagado y **cantidad de comprobantes de proveedor distintos** vinculados a las cuentas pagadas. Un comprobante vinculado a más de una cuenta pagada del mismo proveedor y mes se cuenta una sola vez. El importe de cada cuenta se suma una sola vez antes de unir o contar comprobantes; no se multiplica por la relación con H9. Orden por importe descendente y desempate estable por nombre/id. |
| G15-3 | Comparación: `actual − anterior` para ingresos, egresos y resultado neto de `obtenerResumenMensual`; variación porcentual = diferencia / `abs(anterior)` × 100. Si anterior = 0, valor `null` mostrado «—»; se preserva signo en importes y porcentajes. |
| G15-4 | Ambos bloques requieren `tesoreria:leer_reportes` para lectura y `tesoreria:exportar_reportes` para salida; consumen el DTO autorizado. El bloque de proveedores no revela categorías/filas de gastos operativos al Cajero POS. |
| G15-5 | Pruebas de función con fixtures propios: mes vacío, base previa cero/negativa, múltiples comprobantes por pago y orden estable. Para verificar la regla de comprobante vinculado a más de una cuenta pagada, se prepara **solo en una base aislada de prueba de lectura** un histórico excepcional mediante fixture directo; la vía normal G10 lo rechaza como `YA_IMPUTADO` y no se modifica esa precondición. Se comprueba por separado la suma de pagos y el conteo de comprobantes distintos, y se documenta que el caso no se genera por la API de pago ni por el seed T1. La verificación visual se realiza cuando la pantalla G14 esté integrada. |

**Dependencias y cierre SDD.** G12 → G13 → datos T1; G3 → G4; G5 → G7; G14 → G16 en integración de pantalla. G15 puede implementar el stub de extensión en paralelo a G14/G16; su cierre funcional requiere G14 y G16 integrados. D6 puede consumir el stub del cálculo, pero su verificación final requiere el servicio real G14. Las tareas transversales tienen contratos y pruebas propios en `docs/tasks/tareas tecnicas/T1-seed-historico.md`, `T2-mercado-pago-local.md` y `T3-rol-gerente.md`. T1 aporta históricos a G3/G4/G14/G16/G15 (sus comprobantes nuevos ya se siembran con QR válido) y casos históricos para el cálculo reutilizado por D6; los QR válidos de los comprobantes que el seed ya sembraba los corrige el Cluster 4 en `seedSprint5Cluster4()`; la prueba de alertas operativas del mes actual pertenece a D6. T2 habilita la prueba local de E15 y del flujo de pago, mientras E16 se prueba por separado. T3 aporta Gerente y la identidad para verificar los permisos que asigna cada HU, incluido el desglose de G14. Cada task de HU debe citar sus IDs `Gxx-n`, los criterios del plan y el contrato de base compartida que consume; su PR debe demostrar permisos, persistencia y trazabilidad de auditoría con los casos aquí indicados.
