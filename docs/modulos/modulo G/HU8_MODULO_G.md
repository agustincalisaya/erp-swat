# Documentación técnica de cierre — HU-G8 (Compromisos de Pago / Cuenta por Pagar)

## ERP SWAT Indumentarias — Módulo G (Gestión de Caja y Tesorería)

**Documento regenerado desde el código real** el 09/09/2026, releyendo archivo por
archivo el estado del repositorio en `develop` (último commit relevante `b3dbf89`).
Mismo estándar que la documentación de cierre de HU-H3 y del fix de HU-A7: lo que
se afirma acá está anclado a `archivo:línea`, y todo lo que no coincide con lo que
se supone que se hizo está marcado como hallazgo, no forzado para que "cierre bien".

> **Aviso de fechas.** El prompt de trabajo dice que la HU "se cerró hoy, 4 de
> septiembre". El merge de cierre real es **PR #111 (`99dbfe3`), del 3 de
> septiembre de 2026**. Los commits de HU-G8 van del **1 al 3 de septiembre**.
> El 9 de septiembre se aplicó un fix adicional posterior al cierre (`b3dbf89`,
> ver §7, Bug 4). El cuerpo del documento usa las fechas reales de `git`.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Tesorero Central, **necesito** recibir y procesar los compromisos de pago
provisorios generados al aprobarse una Orden de Compra, y consolidar la Cuenta por
Pagar definitiva al cerrarse la recepción total de mercadería, **para** proyectar
con exactitud las obligaciones de pago a proveedores y cerrar formalmente la deuda
solo sobre lo efectivamente recibido y validado.

| # | Criterio de aceptación |
|---|---|
| 1 | Al aprobarse una OC en Módulo H, se genera automáticamente un compromiso de pago provisorio, visible en la proyección de egresos de la posición diaria de tesorería (HU-G7). |
| 2 | El compromiso provisorio nunca se contabiliza como deuda cerrada ni afecta el saldo real hasta la recepción. |
| 3 | Al cerrarse la recepción total de la OC (Módulo H, estado "Recibida Completa" → "Cerrada"), se genera la Cuenta por Pagar definitiva, reemplazando al compromiso provisorio. |
| 4 | La Cuenta por Pagar definitiva se calcula siempre sobre lo efectivamente recibido y validado, nunca sobre lo simplemente pedido. |
| 5 | Al efectivizarse la Orden de Pago, el sistema confirma el cierre de la Cuenta por Pagar y notifica al Módulo H para reflejarlo en el historial del proveedor. |
| 6 | Cada transición (provisorio→definitivo→pagado) genera evento auditado con hash SHA-256. |

**Fuentes normativas:** `RULES.md` (Regla N.° 1 — prohibición de `DELETE` físico;
Regla N.° 2 — trazabilidad inalterable con hash SHA-256 encadenado),
`docs/specs/spec_modulo_G.md` (Revisión 3), Product Backlog hoja `Sprint 2`.

---

## 2. Visión General de la implementación

HU-G8 es una **máquina de estados reactiva**. No tiene formulario de alta manual:
reacciona al evento de dominio `orden_compra:estado_cambiado` (emitido por HU-H3)
y mantiene sincronizado el ciclo de vida de `CuentaPorPagar`.

```
                       orden_compra:estado_cambiado  (HU-H3, ya existía)
                                     │
                                     ▼
              cuenta-por-pagar.listener.ts  (discrimina por payload.accion)
                                     │
       ┌───────────────┬─────────────┴───────────────┐
   accion=ENVIAR    accion=CERRAR              accion=CANCELAR
       │               │                            │
   generar          consolidar                   cancelar
  PROVISORIO      PROVISORIO→DEFINITIVA        PROVISORIO→CANCELADA
       │               │                            │
       └───────────────┴──────── emit ──────────────┘
                                     │
                    cuenta_por_pagar:estado_cambiado  (evento nuevo de G8)
                                     │
                                     ▼
                     audit-log.listener.ts → registrarAuditLog → AuditLog (SHA-256)


   PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar   (mutación manual)
                                     │
                     marcarCuentaPorPagarPagada  DEFINITIVA→PAGADA
                                     │
                    cuenta_por_pagar:estado_cambiado (accion=PAGAR) → audit-log
```

**Patrón arquitectónico nuevo (spec §1).** Es el primer listener del proyecto que
**escribe estado de dominio** dentro de su propia `prisma.$transaction` y **emite
un evento de seguimiento** post-commit. El resto de los listeners solo apéndican al
`AuditLog`.

### 2.1. Modelo de datos

`CuentaPorPagar` y el enum `EstadoCuentaPorPagar` **ya venían migrados** antes de
que arrancara HU-G8: migración `prisma/migrations/20260831031138_sprint2/migration.sql`,
commit `32150a8` ("Nuevo schema.prisma + nueva seed.ts", autor **Cali**,
31/08/2026). Es el schema base de Sprint 2. HU-G8 **no creó ningún modelo** ni
migración de schema.

`prisma/schema.prisma:1151-1176`:

```prisma
model CuentaPorPagar {
  id                String               @id @default(uuid())
  orden_compra_id   String
  recepcion_id      String?
  monto             Decimal              @db.Decimal(12, 2)
  estado            EstadoCuentaPorPagar @default(PROVISORIO)
  fecha_vencimiento DateTime?
  fecha_pago        DateTime?
  is_active       Boolean   @default(true)   // bloque de baja lógica estándar
  deleted_at      DateTime?
  deleted_by      String?
  deletion_reason String?
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  orden_compra OrdenCompra @relation(fields: [orden_compra_id], references: [id], onDelete: Restrict)
  recepcion    Recepcion?  @relation(fields: [recepcion_id], references: [id], onDelete: Restrict)
  @@index([estado, is_active])
  @@index([orden_compra_id, estado])
  @@map("cuentas_por_pagar")
}

enum EstadoCuentaPorPagar { PROVISORIO  DEFINITIVA  PAGADA  CANCELADA }
```

Relaciones que consume HU-G8 pero pertenecen a otras HU:
`OrdenCompraItem.cantidad_solicitada` / `.precio_unitario` (HU-H3),
`RecepcionItem.cantidad_aceptada` / `.cantidad_recibida` y `Recepcion` (HU-H4).

### 2.2. Archivos que componen la HU (estado real hoy)

| Archivo | Rol |
|---|---|
| `src/lib/services/tesoreria/cuenta-por-pagar.service.ts` | **Núcleo.** Las 4 transiciones + `marcarCuentaPorPagarPagada` + `listarCuentasPorPagar` + helpers de lectura. Único archivo que accede a `prisma.cuentaPorPagar.*`. |
| `src/lib/services/tesoreria/cuenta-por-pagar.calculo.ts` | Helpers puros (sin I/O): `calcularMontoDesdeItems`, `calcularMontoDesdeItemsAceptados`, `esTransicionValidaCuentaPorPagar`. Sin `import "server-only"` — corren bajo el runner nativo de Node. |
| `src/lib/events/listeners/cuenta-por-pagar.listener.ts` | Listener reactivo a `orden_compra:estado_cambiado`. |
| `src/lib/events/listeners/cuenta-por-pagar.listener.routing.ts` | Mapa puro `accion → rama`. Extraído para testear sin Prisma ni bus. |
| `src/lib/events/event-types.ts` | `CuentaPorPagarEstadoCambiadoPayload` + entrada en `DomainEventMap`. También consume `OrdenCompraEstadoCambiadoPayload` (de HU-H3). |
| `src/lib/events/listeners/audit-log.listener.ts` | Handler de `cuenta_por_pagar:estado_cambiado` → `registrarAuditLog`. |
| `src/lib/events/domain-event-bus.ts` | Wiring: segundo import dinámico de registro del listener. |
| `src/lib/schemas/cuentas-por-pagar.schema.ts` | Zod: `CuentaPorPagarIdSchema`, `MarcarPagadaSchema`, `FiltrosListadoCuentasPorPagarSchema`. |
| `src/app/api/tesoreria/cuentas-por-pagar/route.ts` | `GET` listado paginado. |
| `src/app/api/tesoreria/cuentas-por-pagar/[id]/pagar/route.ts` | `PATCH` pago (`DEFINITIVA → PAGADA`). |
| `prisma/seed.ts` | Permisos `cuentas_por_pagar:leer` / `:pagar`, retiro del vínculo `tesoreria:operar`, y un fixture `CuentaPorPagar` PROVISORIO. |
| `src/lib/services/tesoreria/cuenta-por-pagar.monto.test.ts` | 5 tests — `calcularMontoDesdeItems`. |
| `src/lib/services/tesoreria/cuenta-por-pagar.recepcion-monto.test.ts` | 6 tests — `calcularMontoDesdeItemsAceptados` (agregado por el fix del criterio 4). |
| `src/lib/services/tesoreria/cuenta-por-pagar.estado.test.ts` | 6 tests — `esTransicionValidaCuentaPorPagar`. |
| `src/lib/events/listeners/cuenta-por-pagar.listener.routing.test.ts` | 5 tests — `resolverAccionCuentaPorPagar`. |

**Tests propios de HU-G8: 22.** No hay test de integración con base para el
servicio — la verificación de las transacciones fue runtime manual (ver §3).

### 2.3. La máquina de estados

`EstadoCuentaPorPagar`: `PROVISORIO → DEFINITIVA → PAGADA`, más `CANCELADA` como
salida terminal desde `PROVISORIO`. Transiciones válidas, en
`cuenta-por-pagar.calculo.ts:93-102` (`esTransicionValidaCuentaPorPagar`):

| Estado actual | Acción | Resultado |
|---|---|---|
| `PROVISORIO` | `DEFINIR` | `DEFINITIVA` |
| `PROVISORIO` | `CANCELAR` | `CANCELADA` |
| `DEFINITIVA` | `PAGAR` | `PAGADA` |

Cualquier otro par es inválido. `PAGADA` y `CANCELADA` son terminales. **No existe
un `PATCH` genérico de `estado`** (spec §3.2): las únicas mutaciones son las 3
ramas del listener + `marcarCuentaPorPagarPagada`.

El mapa `accion` de `OrdenCompra` → rama del listener, en
`cuenta-por-pagar.listener.routing.ts:28-39`:

| `payload.accion` (OrdenCompra) | Rama | Servicio |
|---|---|---|
| `ENVIAR` | `"generar"` | `generarCuentaPorPagarProvisoria` |
| `CERRAR` | `"consolidar"` | `consolidarCuentaPorPagarDefinitiva` |
| `CANCELAR` | `"cancelar"` | `cancelarCuentaPorPagar` |
| `CONFIRMAR` y cualquier otro valor | `"ignorar"` | no-op |

El listener discrimina **por `accion`, nunca por `estado_nuevo`**
(`cuenta-por-pagar.listener.ts:62`).

---

## 3. Cumplimiento de cada Criterio de Aceptación

> **Cómo se verificó.** HU-G8 no tiene tests de integración con base. Los 22 tests
> propios son unitarios sobre los helpers puros (aritmética `Decimal` y la tabla de
> transiciones). El circuito completo se verificó **en runtime**, contra la base
> sembrada, por HTTP: primero en los commits del 2–3 de septiembre (evidencia
> anotada en los mensajes de commit), y de nuevo el **09/09/2026** en una
> re-verificación de cumplimiento punta a punta que se cita abajo con datos
> concretos. Los identificadores `bbc42cd5-…`, `OC-2026-000007`, etc. son de esa
> corrida real.

### ✅ CA1 — OC "aprobada" → compromiso PROVISORIO automático, monto sobre lo pedido

**Implementación:**
- `cuenta-por-pagar.listener.ts:53` escucha `orden_compra:estado_cambiado`.
- `cuenta-por-pagar.listener.routing.ts:30-31` mapea `ENVIAR → "generar"`.
- `cuenta-por-pagar.service.ts:230` `generarCuentaPorPagarProvisoria`: dentro de un
  `prisma.$transaction`, verifica que no exista ya una `CuentaPorPagar` activa en
  `PROVISORIO` para esa OC (`:234`, idempotencia), calcula el monto y hace
  `tx.cuentaPorPagar.create` (`:259`) con `estado: "PROVISORIO"`,
  `recepcion_id: null`, `fecha_vencimiento: null`.
- Monto: `calcularMontoOrdenCompra` (`cuenta-por-pagar.service.ts:137`) →
  `findMany` de `OrdenCompraItem` activos (`where: { orden_compra_id, is_active:
  true, deleted_at: null }`, `select: { cantidad_solicitada, precio_unitario }`) →
  `calcularMontoDesdeItems` (`calculo.ts:40`): `Σ(cantidad_solicitada ×
  precio_unitario)` en `Prisma.Decimal`, sin `.toNumber()`.
- "Visible sin filtrar": `listarCuentasPorPagar` (`cuenta-por-pagar.service.ts:559`)
  arma `where: { is_active: true, ... }` — **sin filtro de `estado` por defecto**;
  el `GET` expone `estado` por fila tal cual (spec §3.1). Un `PROVISORIO` aparece
  en el listado sin que haya que pedirlo.

**Verificación real (09/09/2026):** OC nueva `OC-2026-000007` con 2 ítems
(10 × $15.800,00 + 5 × $42.000,00). `PATCH .../estado {"accion":"ENVIAR"}` →
HTTP 200 (`BORRADOR → ENVIADA`). ~1 s después el listener creó la `CuentaPorPagar`
`bbc42cd5-f611-4c7e-9835-8405f22baf80`, `estado = PROVISORIO`,
**`monto = 368000.00`** (= 10 × 15.800 + 5 × 42.000), `is_active = true`.
`GET /api/tesoreria/cuentas-por-pagar` (sin filtros, sesión `tesorero.seed`) →
HTTP 200, la fila aparece con `monto: "368000.00"`.

**Estado: CUMPLIDO**, con una salvedad: el criterio menciona que el compromiso es
"visible en la proyección de egresos de la posición diaria de tesorería (HU-G7)".
**Esa proyección no existe** — HU-G7 no está en el alcance de Sprint 2 (ver §8).
Lo que existe hoy es el listado crudo. El compromiso se genera y se puede
consultar; el widget agregado de posición diaria es responsabilidad de HU-G7.

### ✅ CA2 — El PROVISORIO no se contabiliza como deuda cerrada ni afecta el saldo real

**Implementación:** no hay constraint de base que lo impida; el diseño lo delega
como regla de capa (spec §3.1): excluir `PROVISORIO` de cualquier agregado de
"deuda pendiente" o proyección de caja es responsabilidad de **HU-G7**, no de
HU-G8. Lo que sí garantiza el código de esta HU: **ninguna función suma
`PROVISORIO` a ningún total** — no hay ningún agregado de deuda en todo el módulo.

**Verificación real (09/09/2026):** `rg` repo-wide de
`CuentaPorPagar`/`cuenta_por_pagar`/`cuentas_por_pagar`. Los **10** accesos reales
a la tabla (`prisma.cuentaPorPagar.*` / `tx.cuentaPorPagar.*`) están **todos** en
`cuenta-por-pagar.service.ts`. El único otro archivo que menciona el string es
`src/lib/services/proveedores/comprobante-proveedor.service.ts:82`, y es **un
comentario** (`/** …mismo patrón que CuentaPorPagar.monto */`). Ninguna HU
mergeada después de G8 (H9, A8, A11, Sidebar) introdujo lectura de esa tabla.

**Estado: CUMPLIDO**, entendiendo que "no afecta el saldo real" es una propiedad
que se sostiene porque **no hay ningún cálculo de saldo real construido** (eso es
HU-G7). El PROVISORIO nunca cambia de significado dentro de G8: nace y se queda
hasta que una recepción total lo consolida o una cancelación lo cierra.

### ✅ CA3 — CERRAR la OC → se genera la DEFINITIVA reemplazando al provisorio (misma fila)

**Implementación:**
- `cuenta-por-pagar.listener.routing.ts:32-33` mapea `CERRAR → "consolidar"`.
- `cuenta-por-pagar.service.ts:308` `consolidarCuentaPorPagarDefinitiva`:
  - **Guarda de contrato entre módulos**, `:316`:
    `if (payload.estado_anterior !== "RECIBIDA_COMPLETA") return null;` — solo
    consolida el cierre por conciliación de factura, no cualquier ruta hacia
    `CERRADA`.
  - `findFirst` de la `CuentaPorPagar` activa en `PROVISORIO` de esa OC (`:319`).
    Si no hay, loguea con `orden_compra_id` y **retorna `null`, no lanza** (el
    listener no tiene llamador HTTP).
  - `tx.cuentaPorPagar.updateMany` (`:361`) sobre **el `id` de la fila provisoria
    existente** (`where: { id: provisoria.id, estado: "PROVISORIO", is_active:
    true }`, `data: { estado: "DEFINITIVA", monto, recepcion_id }`). Guarda de
    concurrencia optimista: si `count === 0`, retorna `null`.
  - **No hay `create`** — es un `UPDATE` sobre la misma fila. Un único ciclo de
    vida por OC.

**Verificación real (09/09/2026):** partiendo de la `CuentaPorPagar`
`bbc42cd5-…` en `PROVISORIO` ($368.000,00). Flujo completo por el camino real:
`CONFIRMAR` → `POST /api/ordenes-compra/{id}/recepciones` (sesión
`encargado.seed`) con recepción total → OC pasa a `RECIBIDA_COMPLETA`. Luego
`PATCH .../estado {"accion":"CERRAR"}` → HTTP 200. ~1 s después:

| Antes de CERRAR | Después de CERRAR |
|---|---|
| `id = bbc42cd5-…` | `id = bbc42cd5-…` (**mismo**) |
| `estado = PROVISORIO` | `estado = DEFINITIVA` |
| `created_at = 05:13:33` | `created_at = 05:13:33` (**sin cambio**) — `updated_at` bumpeado |
| `recepcion_id = null` | `recepcion_id = 740b9c9f-…` (Recepción real) |
| filas `CuentaPorPagar` para la OC = 1 | filas para la OC = **1** (no se creó ninguna nueva) |

**Estado: CUMPLIDO CON EVIDENCIA REAL.** Este criterio dependía de que existiera
`recepcion.service.ts` (HU-H4) para producir el estado `RECIBIDA_COMPLETA` de
forma real; esa dependencia **está resuelta** (ver §6).

### ✅ CA4 — La DEFINITIVA se calcula sobre lo efectivamente recibido y validado

**Implementación:** `cuenta-por-pagar.service.ts:159`
`calcularMontoDesdeRecepcion` (helper introducido por el fix del criterio 4, ver
§7 Bug 3):
- `tx.recepcionItem.groupBy({ by: ["orden_compra_item_id"], where: { is_active:
  true, deleted_at: null, recepcion: { orden_compra_id, is_active: true,
  deleted_at: null } }, _sum: { cantidad_aceptada: true } })` — agrupa por ítem de
  OC sobre **todas las `Recepcion` activas** de la orden (cubre recepciones
  parciales acumuladas).
- Trae el `precio_unitario` de cada `OrdenCompraItem` **sin filtrar `is_active`**
  (`:181`): si el ítem se dio de baja lógica después de recibirse, igual se factura
  lo aceptado a su precio pactado.
- `calcularMontoDesdeItemsAceptados` (`calculo.ts:73`):
  `Σ(cantidad_aceptada × precio_unitario)` en `Prisma.Decimal`.
- **Es `cantidad_aceptada`, no `cantidad_recibida` ni `cantidad_solicitada`.**
  `cantidad_recibida` es lo que llegó físicamente; `cantidad_aceptada` es lo que
  además pasó control de calidad (la diferencia queda documentada como
  `RecepcionDiscrepancia`). El criterio pide "recibido **y validado**".
- `generarCuentaPorPagarProvisoria` **no cambió**: el PROVISORIO sigue sumando lo
  pedido (`cantidad_solicitada`), que es lo correcto para una proyección previa a
  la recepción.

**Verificación real (09/09/2026):** misma OC `OC-2026-000007`. Recepción con
rechazo por calidad:

| Ítem | precio | recibida | aceptada | discrepancia |
|---|---|---|---|---|
| CAMTAC | $15.800,00 | 10 | **7** | `CALIDAD` — "3 uds costura defectuosa" |
| BORCEG | $42.000,00 | 5 | 5 | — |

- monto PROVISORIO (sobre lo pedido) = 10 × 15.800 + 5 × 42.000 = **$368.000,00**
- monto DEFINITIVA (sobre lo aceptado) = 7 × 15.800 + 5 × 42.000 = **$320.600,00**

DB tras `CERRAR`: `monto = 320600.00`. Exacto antes → después: **368000.00 →
320600.00**. Las 3 unidades rechazadas no se facturan.

**Estado: CUMPLIDO CON EVIDENCIA REAL.** Este es el criterio donde la auditoría
final encontró un bug real (§7, Bug 3): antes del fix `ea5b8c5`, la DEFINITIVA
daba $368.000,00 (lo pedido).

### ⚠️ CA5 — Al pagar: se cierra la Cuenta por Pagar y se notifica al Módulo H

**Implementación:**
- `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar`
  (`route.ts:38`, `withAuth` + chequeo inline de `cuentas_por_pagar:pagar` en
  `:64`; orden de validación: `id` → body → permiso).
- `cuenta-por-pagar.service.ts:462` `marcarCuentaPorPagarPagada`: valida
  `estado === "DEFINITIVA"` (`:491`, si no → `TRANSICION_INVALIDA` 409),
  `updateMany` guardado (`:500`) → `estado: "PAGADA"`, `fecha_pago`.
- Post-COMMIT emite `cuenta_por_pagar:estado_cambiado` (`:523`) con
  `accion: "PAGAR"`, **`proveedor_id`**, `estado_anterior: "DEFINITIVA"`,
  `estado_nuevo: "PAGADA"`, `fecha_pago` (ISO 8601).
- **No hay un modelo `OrdenPago`.** El criterio 5 se resuelve con `fecha_pago` +
  `estado: PAGADA` directo sobre `CuentaPorPagar`. `MarcarPagadaSchema`
  (`cuentas-por-pagar.schema.ts:27-29`) solo lleva `fecha_pago` opcional (default
  "ahora"). No hay `medio_pago`, cuenta de origen, referencia bancaria, ni pago
  parcial (ver §5.2 y §8).

**Verificación real (09/09/2026):** `PATCH .../pagar` (sesión `tesorero.seed`) →
HTTP 200, `{"estado_anterior":"DEFINITIVA","estado_nuevo":"PAGADA","fecha_pago":
"2026-09-09T05:15:14.725Z"}`. DB: `estado = PAGADA`, `monto` sin cambio,
`fecha_pago` seteada. El asiento de auditoría (`audit_logs`, `accion` de payload
`PAGAR`) trae `proveedor_id = 1a2b3c4d-6666-4a1a-8a1a-000000000001`,
`numero_orden`, `fecha_pago`.

**Estado: CUMPLIDO PARCIAL / con salvedad documentada.** El pago cierra la cuenta
correctamente y el evento **se emite con `proveedor_id`**, que es lo que Módulo H
necesitaría para reflejarlo en el historial del proveedor. Pero **no existe ningún
listener del lado de Módulo H suscripto a `cuenta_por_pagar:estado_cambiado`**
(único suscriptor: `audit-log.listener.ts:502`). El docstring del payload
(`event-types.ts:378-382`) dice que el payload "lleva `proveedor_id` para que
Módulo H pueda suscribirse filtrando `accion === "PAGAR"` … ese listener del lado
de H todavía no existe" — está redactado como una capacidad preparada, no como una
afirmación de que ya ocurre. La parte "notifica al Módulo H" se cumple en el
sentido de que el evento está disponible y lleva los datos; consumirlo es
responsabilidad pendiente de Módulo H (ver §8).

### ✅ CA6 — Cada transición genera evento auditado con hash SHA-256

**Implementación:**
- Las 4 ramas emiten `cuenta_por_pagar:estado_cambiado`: `generar` (`accion:
  "CREAR"`), `consolidar` (`"DEFINIR"`), `cancelar` (`"CANCELAR"`),
  `marcarCuentaPorPagarPagada` (`"PAGAR"`).
- `audit-log.listener.ts:502` — único suscriptor: `registrarAuditLog({ usuario_id:
  payload.cambiado_por, accion: payload.accion === "CREAR" ? "CREATE" :
  "UPDATE_ESTADO", tabla_afectada: "cuentas_por_pagar", registro_id:
  payload.cuenta_por_pagar_id, valor_anterior, valor_nuevo })`.
- **Ningún servicio de dominio llama `registrarAuditLog` directamente** (spec
  §3.3) — todo pasa por el evento.
- `registrarAuditLog` (`src/lib/services/auditoria/audit-log.service.ts:121`)
  encadena cada registro con `hash_actual = SHA-256(datos + hash_anterior)` y
  **serializa las escrituras vía `colaLedger`** (`:104`, `:125-126`) — la
  protección de concurrencia que introdujo HU-A7 (ver §6). Cada transición es un
  asiento independiente; nunca se agrupan.

**Verificación real (09/09/2026):** las 4 transiciones (`CREAR` / `DEFINIR` /
`PAGAR` / `CANCELAR` — esta última mediante un segundo mini-flujo
`OC-2026-000008` → `ENVIAR` → `CANCELAR`) quedaron en `audit_logs`, cada una con
`hash_anterior` y `hash_actual` poblados y `proveedor_id` en el payload.
`POST /api/auditoria/verificar-cadena` (sesión `auditor.seed`) →
**`{"integra": true, "registros_verificados": 51}`**. Chequeo de enlace global:
51 filas, 50/50 enlaces `hash_anterior[n] == hash_actual[n-1]`, 0 rotos.

**Estado: CUMPLIDO CON EVIDENCIA REAL.**

### Resumen

| CA | Estado | Ancla principal |
|---|---|---|
| 1 | ✅ Cumplido (proyección HU-G7 fuera de alcance) | `cuenta-por-pagar.service.ts:230`, `:137` |
| 2 | ✅ Cumplido (propiedad sostenida por ausencia de agregado de deuda) | `spec_modulo_G.md §3.1` |
| 3 | ✅ Cumplido con evidencia real | `cuenta-por-pagar.service.ts:308`, `:361` |
| 4 | ✅ Cumplido con evidencia real (criterio del bug de la auditoría) | `cuenta-por-pagar.service.ts:159`, `calculo.ts:73` |
| 5 | ⚠️ Cumplido parcial — pago OK y evento emitido con `proveedor_id`; **falta el consumidor del lado de Módulo H** | `cuenta-por-pagar.service.ts:462`, `:523` |
| 6 | ✅ Cumplido con evidencia real | `audit-log.listener.ts:502`, `audit-log.service.ts:121` |

---

## 4. Contratos reales

### 4.1. Evento consumido — `OrdenCompraEstadoCambiadoPayload` (de HU-H3)

`src/lib/events/event-types.ts:302-313` (estado tras el fix `b3dbf89` del 09/09):

```typescript
export interface OrdenCompraEstadoCambiadoPayload {
  orden_compra_id: string;
  numero_orden: string;
  estado_anterior: EstadoOrdenCompra;   // era `string` hasta b3dbf89 — ver §7 Bug 4
  estado_nuevo: EstadoOrdenCompra;
  accion: "ENVIAR" | "CONFIRMAR" | "CERRAR" | "CANCELAR";
  cambiado_por: string;
  fecha_entrega_comprometida: string | null;   // solo en CONFIRMAR
  deletion_reason: string | null;              // solo en CANCELAR
}
```

Emitido por `src/lib/services/proveedores/orden-compra.service.ts:437` en toda
transición de estado de OC. HU-G8 **no** lo modificó al crearse (lo agregó HU-H3);
el fix del 09/09 sí endureció el tipo de dos campos.

### 4.2. Evento nuevo de G8 — `CuentaPorPagarEstadoCambiadoPayload`

`src/lib/events/event-types.ts:391-412`:

```typescript
export interface CuentaPorPagarEstadoCambiadoPayload {
  cuenta_por_pagar_id: string;
  orden_compra_id: string;
  numero_orden: string;
  proveedor_id: string;
  estado_anterior: "PROVISORIO" | "DEFINITIVA" | "PAGADA" | "CANCELADA" | null; // null solo en CREAR
  estado_nuevo:    "PROVISORIO" | "DEFINITIVA" | "PAGADA" | "CANCELADA";
  accion: "CREAR" | "DEFINIR" | "PAGAR" | "CANCELAR";
  cambiado_por: string;
  monto_anterior: string | null;   // null en CREAR; en DEFINIR = monto provisorio previo al recálculo
  monto_nuevo: string;
  recepcion_id: string | null;     // solo en DEFINIR
  fecha_vencimiento: string | null; // siempre null en HU-G8
  fecha_pago: string | null;       // solo en PAGAR
  deletion_reason: string | null;  // solo en CANCELAR
}
```

Los montos viajan como `string` (`Prisma.Decimal.toFixed(2)`), **nunca `number`**.
Un único suscriptor: `audit-log.listener.ts`.

> **Hallazgo (spec desactualizada).** `spec_modulo_G.md §4.1` (Revisión 3) muestra
> este payload con **tres campos adicionales** — `medio_pago`, `cuenta_origen_id`,
> `comprobante_proveedor_ids` — marcados como ampliación de **HU-G10**. Esos
> campos **no existen en el código**: HU-G10 está bloqueada por HU-H9 y no se
> implementó (ver §8). El payload real es solo el de HU-G8.

### 4.3. Contratos Zod

`src/lib/schemas/cuentas-por-pagar.schema.ts`:

| Schema | Uso | Forma |
|---|---|---|
| `CuentaPorPagarIdSchema` | path param del `PATCH` | `z.string().uuid()` |
| `MarcarPagadaSchema` | body del `PATCH .../pagar` | `{ fecha_pago: z.coerce.date().default(() => new Date()) }` — **eso es todo** |
| `FiltrosListadoCuentasPorPagarSchema` | query del `GET` | `{ estado?: enum(PROVISORIO\|DEFINITIVA\|PAGADA\|CANCELADA), orden_compra_id?: uuid, proveedor_id?: uuid, page: number≥1 =1, page_size: number 1..100 =25 }` |

Convención del proyecto: los `*_id` se validan solo como formato `uuid`; la
existencia real contra la base es responsabilidad de la capa de servicios.

### 4.4. Endpoints HTTP

| Método · Ruta | Gate | Comportamiento | Códigos |
|---|---|---|---|
| `GET /api/tesoreria/cuentas-por-pagar` | `withPermission("cuentas_por_pagar:leer")` (`route.ts:23-24`) | Listado paginado, `where: { is_active: true }` + filtros opcionales. `select` whitelist del proveedor (§5.3). | 200 · 400 `VALIDATION_ERROR` · 401 · 403 · 500 |
| `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar` | `withAuth` + `usuarioTienePermiso(..., "cuentas_por_pagar:pagar")` inline (`route.ts:64`) | `DEFINITIVA → PAGADA` + `fecha_pago`. | 200 · 400 · 401 · 403 · 404 `CUENTA_POR_PAGAR_NO_ENCONTRADA` · 409 `TRANSICION_INVALIDA` · 500 |

No hay endpoint de creación, ni de `DEFINIR`, ni de `CANCELAR` manuales — esas
transiciones solo ocurren reactivas al evento de OC.

---

## 5. Decisiones de diseño y por qué se tomaron así

### 5.1. Un solo modelo `CuentaPorPagar` con campo `estado`, no dos entidades

`CuentaPorPagar` + `EstadoCuentaPorPagar` **ya venían migrados** en el schema base
de Sprint 2 (`20260831031138_sprint2`, commit `32150a8`, autor **Cali**,
31/08/2026), **antes** de que arrancara la implementación de HU-G8 (primer commit
de la HU: `7482f2c`, 01/09/2026). La HU no eligió la forma del modelo — la recibió.

El diseño de un único ciclo de vida (`PROVISORIO → DEFINITIVA → PAGADA`, más
`CANCELADA`) sobre la misma fila, en lugar de dos entidades separadas
"compromiso provisorio" y "cuenta definitiva":

- Evita tener que reconciliar dos registros y decidir cuál es la fuente de verdad
  del monto en cada momento.
- Mantiene toda la trazabilidad de una obligación de pago en una sola fila con su
  `id` estable, que es lo que referencian el `AuditLog` (`registro_id`) y el
  `recepcion_id` de cierre.
- El criterio 3 dice explícitamente "**reemplazando** al compromiso provisorio" —
  un `UPDATE` de estado sobre la misma fila es la lectura literal de "reemplazar",
  no "crear otra y marcar la anterior".

### 5.2. No existe un modelo `OrdenPago`; el criterio 5 se resuelve con `fecha_pago` + `estado: PAGADA`

Confirmado contra el código: `marcarCuentaPorPagarPagada`
(`cuenta-por-pagar.service.ts:462`) hace un `updateMany` que setea `estado:
"PAGADA"` y `fecha_pago` sobre la misma `CuentaPorPagar`. **No hay** campos de
medio de pago, cuenta bancaria/caja de origen, número de orden de pago, ni soporte
de pago parcial. `MarcarPagadaSchema` solo tiene `fecha_pago` opcional.

Por qué la decisión de alcance se sostiene:
- El criterio 5 pide que "el sistema confirma el cierre de la Cuenta por Pagar y
  notifica al Módulo H" — no menciona medio de pago ni evidencia. El cierre
  (`estado: PAGADA` + `fecha_pago`) y la notificación (evento con `proveedor_id`)
  están.
- La captura de **medio de pago, cuenta de origen y comprobante** es exactamente
  el objeto de **HU-G10** (spec §2.4 Revisión 3, y hoja `Sprint 2` del Backlog),
  que amplía `marcarCuentaPorPagarPagada` sin crear una vía paralela. HU-G10 está
  **bloqueada** por HU-H9 (`ComprobanteProveedor` no migrado) y no se implementó.
- Pago parcial quedó fuera de alcance de forma explícita (spec §5, y la HU-G10 lo
  mantiene fuera).

### 5.3. El disparador del PROVISORIO es `Borrador → Enviada`, no un estado "Aprobada"

El enum `EstadoOrdenCompra` (`schema.prisma`) es `BORRADOR, ENVIADA, CONFIRMADA,
RECEPCION_PARCIAL, RECIBIDA_COMPLETA, CERRADA, CANCELADA` — **no hay "Aprobada"**.
El criterio 1 dice "al aprobarse una OC en Módulo H".

Interpretación adoptada (documentada en `prisma/seed.ts:1640-1643` y en la spec):
"aprobarse la OC" = el paso a `ENVIADA`. En HU-H3 ese paso **es** la aprobación:
el reparto "Comprador solicita / Supervisor emite" hace que `BORRADOR → ENVIADA`
requiera el permiso `ordenes_compra:enviar`, exclusivo del Supervisor de Compras.
Emitir la orden al proveedor es el acto de aprobación.

El routing lo fija en una sola línea: `resolverAccionCuentaPorPagar` mapea
`"ENVIAR" → "generar"` (`cuenta-por-pagar.listener.routing.ts:30-31`). Si el equipo
decide más adelante agregar un estado de aprobación separado, el cambio es
localizado a ese mapa.

### 5.4. `CERRAR → DEFINITIVA` reutiliza el evento genérico `orden_compra:estado_cambiado`, no un evento propio de HU-H4

HU-H3 ya emite `orden_compra:estado_cambiado` en **toda** transición de estado de
OC, incluida `CERRAR` (`orden-compra.service.ts:437`). La hipótesis de la Revisión
1 de la spec —que ese evento genérico alcanza y no hace falta un evento dedicado
"recepción total cerrada" de HU-H4— quedó **confirmada** (spec §2.2, tabla de
dependencias). HU-G8 no depende de HU-H4 para saber *cuándo* consolidar.

Lo que **sí** necesitó resolverse contra `Recepcion`/`RecepcionItem` porque **no
viene en el payload del evento**:

1. **El monto real.** El payload no trae cantidades. `calcularMontoDesdeRecepcion`
   (`cuenta-por-pagar.service.ts:159`) hace un `groupBy` sobre `RecepcionItem`
   para sumar `cantidad_aceptada`.
2. **La `Recepcion` de cierre** para el campo `recepcion_id` de la
   `CuentaPorPagar`. `consolidar` la resuelve por query (`:339`): la `Recepcion`
   activa más reciente de la orden (`orderBy: { fecha_recepcion: "desc" }`).

La guarda `estado_anterior === "RECIBIDA_COMPLETA"` (`:316`) evita reaccionar ante
otras rutas hacia `CERRADA` que no sean el cierre por conciliación de factura.
`consolidar` es la única de las 3 ramas del listener con guarda de `estado_anterior`
— asimetría intencional, ver §9.4 y `spec_modulo_G.md §3.5.1`.

### 5.5. `CANCELADA` mapea a `UPDATE_ESTADO` en el audit log, no a `DELETE_LOGICO`

`audit-log.listener.ts:505`: `accion: payload.accion === "CREAR" ? "CREATE" :
"UPDATE_ESTADO"` — `CANCELAR` cae en el `else` (`UPDATE_ESTADO`).

Esto **diverge a propósito** del handler de `orden_compra:estado_cambiado`
(`audit-log.listener.ts:398`), donde `CANCELAR` **sí** mapea a `DELETE_LOGICO`
porque cancelar una OC en HU-H3 es baja lógica (`is_active: false` + tripleta).

En HU-G8, `cancelarCuentaPorPagar` (`cuenta-por-pagar.service.ts:425`) hace
`updateMany ... data: { estado: "CANCELADA", deletion_reason:
payload.deletion_reason }` — **no toca `is_active`, ni `deleted_at`, ni
`deleted_by`**. Por `RULES.md` Regla N.° 1, la baja lógica es el bloque completo
(`is_active = false` + `deleted_*`). Acá la fila permanece `is_active: true`: es un
**cambio de estado funcional terminal**, no un soft-delete. La `CuentaPorPagar`
CANCELADA se sigue consultando en el listado. `deletion_reason` se **reutiliza**
solo como portador del motivo de la cancelación funcional (spec §3.4) — un
comentario en el código lo deja explícito para que nadie "complete" la tripleta.

**Verificación real (09/09/2026):** OC cancelada desde `ENVIADA` → CxP
`42566095-…` `estado = CANCELADA`, `monto` sin cambio, **`is_active = true`**,
`deletion_reason` con el motivo.

### 5.6. Permisos granulares de 2 segmentos (`cuentas_por_pagar:leer` / `:pagar`), y el placeholder `tesoreria:operar`

Mismo patrón que HU-H3 (`ordenes_compra:*`): un permiso por acción, constante UUID
fija, upsert idempotente. En `prisma/seed.ts`:

| Constante | Código | `modulo` | UUID (hoy) | Roles vinculados |
|---|---|---|---|---|
| `PERMISO_CXP_LEER_ID` (`seed.ts:158`) | `cuentas_por_pagar:leer` | `MODULO_G` | `1a2b3c4d-1111-4a1a-8a1a-000000000015` | `TESORERO_CENTRAL`, `AUDITOR`, `ADMINISTRADOR` (`seed.ts:1291`) |
| `PERMISO_CXP_PAGAR_ID` (`seed.ts:159`) | `cuentas_por_pagar:pagar` | `MODULO_G` | `...000000000016` | `TESORERO_CENTRAL` únicamente (`seed.ts:1302`) |

Por qué granular y no un placeholder de módulo: leer el listado y efectivizar un
pago son acciones con audiencias distintas (Auditor y Administrador leen; solo el
Tesorero paga). Un único `tesoreria:operar` no permite ese reparto.

**Qué pasó con el placeholder `tesoreria:operar`** (`PERMISO_TESORERIA_OPERAR_ID
= 1a2b3c4d-1111-4a1a-8a1a-000000000004`, `MODULO_G`), confirmado en el `seed.ts`
de hoy:

- Su **vínculo `RolPermiso` con `TESORERO_CENTRAL` se retira** vía `deleteMany`
  (`seed.ts:1282-1287`). Hoy: **0 vínculos de rol**.
- **La fila `Permiso` se conserva** (no se borra): `prisma.permiso.upsert`
  (`seed.ts:1042`) con la descripción reescrita a `"SUPERSEDIDO (HU-G8) —
  reemplazado por los permisos granulares cuentas_por_pagar:leer y
  cuentas_por_pagar:pagar. La fila Permiso se conserva para no orfanar referencias
  históricas del AuditLog; su vínculo con TESORERO_CENTRAL fue retirado."`
  (`seed.ts:1036-1040`).
- La fila sigue `is_active: true` — **no es baja lógica**, es un permiso vigente
  que simplemente ya no está asignado a nadie. Se conserva para que cualquier
  registro histórico del `AuditLog` que lo referencie no quede huérfano.

### 5.7. El `select` del proveedor en el listado es una allowlist explícita, no un `include`

`listarCuentasPorPagar` (`cuenta-por-pagar.service.ts:595-601`):

```typescript
proveedor: {
  select: { id: true, razon_social: true, nombre_fantasia: true, cuit: true, estado: true },
}
```

Cinco campos, `select` explícito, **nunca `include`**. Verificado contra el modelo
`Proveedor` real (`prisma/schema.prisma:682-727`), que hoy tiene:
`id, razon_social, nombre_fantasia, cuit, condiciones_pago, categorias, estado,
contacto_nombre, contacto_email, contacto_telefono, datos_bancarios_cifrado,
datos_bancarios_iv`, + bloque de baja lógica + timestamps + relaciones.

**Incluye:** `id`, `razon_social`, `nombre_fantasia`, `cuit`, `estado`.
**Excluye:** `condiciones_pago`, `categorias`, `contacto_nombre`,
`contacto_email`, `contacto_telefono`, **`datos_bancarios_cifrado`**,
**`datos_bancarios_iv`**, `is_active`, `deleted_at`, `deleted_by`,
`deletion_reason`, `created_at`, `updated_at`.

Motivo: Alcance §5.1 (restricción de datos bancarios del legajo del proveedor) +
Ley N.° 25.326. Un `include` traería `datos_bancarios_cifrado` / `_iv`; el `select`
explícito garantiza que ningún campo nuevo que gane el modelo `Proveedor` en el
futuro se filtre por accidente al listado de Tesorería.

**Verificación real (09/09/2026):** `GET /api/tesoreria/cuentas-por-pagar` →
`registros[].orden_compra.proveedor` tiene exactamente las llaves
`["cuit","estado","id","nombre_fantasia","razon_social"]`. Ningún campo bancario
ni de contacto. `orden_compra` a su vez expone solo
`["estado","fecha_emision","id","numero_orden","proveedor"]`.

---

## 6. Integración con otras HU — cómo se coordinó, no solo el resultado

### 6.1. HU-G8 no llama a ningún servicio de HU-H3 / HU-H4

Cero llamadas directas. Toda la coordinación pasa por **un** evento de dominio:
`orden_compra:estado_cambiado`, que **ya existía** antes de que arrancara HU-G8
(lo emite HU-H3 desde `orden-compra.service.ts`). El único punto de contacto es
`cuenta-por-pagar.listener.ts:53` (`domainEventBus.on("orden_compra:estado_cambiado", …)`).

En sentido inverso, HU-G8 emite `cuenta_por_pagar:estado_cambiado` — cuyo único
consumidor hoy es el listener de auditoría (Módulo D). Ningún servicio de H, H3 o
H4 lo consume.

### 6.2. El camino `CERRAR → DEFINITIVA` estuvo diferido casi toda la HU

Durante los primeros PRs (1–3, 01–02/09), **nada en el repo producía el estado
`RECIBIDA_COMPLETA` de forma real** — HU-H4 (`recepcion.service.ts`) todavía no
estaba integrada. `consolidarCuentaPorPagarDefinitiva` existía y compilaba, pero
solo se ejercitaba con datos sembrados a mano. La spec Revisión 2 lo marcaba como
diferimiento.

Cuando HU-H4 entró por un merge de `develop` (~02–03/09), se corrió el flujo
completo `ENVIAR → CONFIRMAR → recepción física → RECIBIDA_COMPLETA → CERRAR` por
**primera vez de punta a punta**. Y ahí apareció el bug del criterio 4 (§7, Bug 3):
la consolidación estaba sumando lo pedido, no lo aceptado. El gap había quedado
enmascarado justamente porque el camino nunca se había probado con recepciones
reales.

### 6.3. Colisión de UUID hardcodeado entre los permisos de HU-G8 y HU-H1

**Qué pasó.** Al crearse los permisos de HU-G8 (`52a0ea6`, 02/09), las constantes
eran:

```
PERMISO_CXP_LEER_ID  = "1a2b3c4d-1111-4a1a-8a1a-000000000010"
PERMISO_CXP_PAGAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000011"
```

En paralelo, HU-H1 (alta de proveedor) publicó en `develop` sus permisos granulares
de proveedor **en los mismos IDs**:

```
PERMISO_PROVEEDORES_CREAR_ID     = "...000000000010"
PERMISO_PROVEEDORES_EDITAR_ID    = "...000000000011"
PERMISO_PROVEEDORES_LEER_ID      = "...000000000012"
PERMISO_PROVEEDORES_HOMOLOGAR_ID = "...000000000013"
PERMISO_PROVEEDORES_BAJA_ID      = "...000000000014"
```

**Cómo se detectó y resolvió.** En el merge de `develop` hacia la rama de HU-G8
(`f984467`, 03/09), el conflicto en `prisma/seed.ts` sobre `...010` y `...011`.
Resolución: **se renumeraron los IDs de HU-G8** a los siguientes libres tras el
rango de HU-H1:

```
PERMISO_CXP_LEER_ID  = "1a2b3c4d-1111-4a1a-8a1a-000000000015"   (seed.ts:158, hoy)
PERMISO_CXP_PAGAR_ID = "1a2b3c4d-1111-4a1a-8a1a-000000000016"   (seed.ts:159, hoy)
```

**Por qué se movió HU-G8 y no HU-H1.** Los IDs de HU-H1 ya estaban publicados en
`develop`, con seeds corridos por otros integrantes del equipo sobre sus bases
locales. Cambiar `...010/...011` en H1 habría dejado filas `Permiso` huérfanas
(con el UUID viejo) en todas esas bases y roto los vínculos de rol ya sembrados.
HU-G8 todavía no había llegado a `develop`, así que renumerar de su lado no
afectaba a nadie. Los IDs finales `...015/...016` son los que están hoy y los que
imprime `npx prisma db seed` (`permiso_cuentas_por_pagar_leer_id`,
`permiso_cuentas_por_pagar_pagar_id`).

> Este es el mismo tipo de colisión que ya había ocurrido entre otros pares de HU
> en el rango `1a2b3c4d-1111-4a1a-8a1a-*` (el namespace compartido de permisos del
> seed). El rango hoy va del `...001` al `...020` (`...020` es `ordenes_compra:leer`,
> agregado después por el fix de HU-H3).

### 6.4. Verificación de que HU-H1 (cifrado bancario real) y HU-A8 (edición de VarianteSKU) no rompieron invariantes de HU-G8

Dos invariantes de HU-G8 dependen de decisiones de otras HU. Se re-confirmaron
contra el código actual:

**a) La whitelist de seguridad del listado, frente al cifrado bancario de HU-H1.**
HU-H1 agregó al modelo `Proveedor` los campos `datos_bancarios_cifrado` y
`datos_bancarios_iv` (ciphertext AES-256 + IV). El listado de G8 usa un `select`
explícito de 5 campos (§5.3) — no un `include` — así que esos dos campos **nunca
entran** en la respuesta, ahora ni si el modelo gana más campos. Verificado
09/09/2026 en runtime: las llaves del objeto `proveedor` son exactamente las 5.

**b) La inmutabilidad del `precio_unitario` snapshoteado en `OrdenCompraItem`,
frente a la edición de atributos de `VarianteSKU` de HU-A8.**
El monto PROVISORIO (`calcularMontoOrdenCompra`, `cuenta-por-pagar.service.ts:137`)
lee `OrdenCompraItem.precio_unitario` — el precio **congelado al emitir la OC** en
HU-H3, no la lista de precios vigente. HU-A8 permite editar atributos operativos de
`VarianteSKU` / `ProductoMaestro`, pero:
  - A8 toca `VarianteSKU` y `ProductoMaestro`, **no `OrdenCompraItem`**.
  - HU-H3 bloquea la edición de ítems de una OC en cualquier estado distinto de
    `BORRADOR` (`asegurarItemsEditables`). Una OC que ya generó `CuentaPorPagar`
    está como mínimo en `ENVIADA`.
  - Ni el PROVISORIO ni la DEFINITIVA leen `VarianteSKU.precio` — leen el snapshot
    del `OrdenCompraItem`.
La invariante sigue intacta: editar una variante no altera el monto de una
`CuentaPorPagar` ya generada.

### 6.5. HU-A7 — `colaLedger` y la cadena de auditoría

El listener de auditoría de HU-G8 emite eventos post-commit que terminan en
`registrarAuditLog` (Módulo D), el mismo ledger encadenado por SHA-256 que usan
todos los módulos.

**El fix de concurrencia `colaLedger`** (`src/lib/services/auditoria/audit-log.service.ts:104`,
`:121-126`) fue introducido por **HU-A7** en el commit `0788ac8` (02/09/2026,
"Refs: HU-A7"). Su motivo: dos escrituras casi simultáneas al ledger podían leer el
mismo `hash_anterior` y **bifurcar la cadena**. Fue **detectado durante la
integración H3↔H4**, no en HU-G8. La solución es una cola de serialización en
memoria que encadena cada llamada a `registrarAuditLog` detrás de la anterior —
corrige la causa raíz **para todos los módulos**, no solo el disparador puntual de
H4. Verificado por A7 con 25/50 escrituras paralelas concurrentes → 0 divergencias
(vs 24/25 sin el fix).

**¿Hubo alguna bifurcación de cadena atribuible a HU-G8?** No, y la HU llegó
protegida:

- Las **2 bifurcaciones preexistentes** que el mensaje de `0788ac8` documenta son
  de la integración H3↔H4, no de G8.
- El listener reactivo de G8 nació en `909aa08` (01/09), pero **HU-G8 no se
  mergeó a `develop` hasta PR #111 (`99dbfe3`, 03/09)** — bien después de que
  `colaLedger` entrara (`0788ac8`, 02/09). Nunca hubo una ventana en `develop`
  con el listener de G8 escribiendo al ledger sin la cola.
- Verificado 09/09/2026: `POST /api/auditoria/verificar-cadena` → `integra: true`
  sobre 51 registros, incluidos los 4 asientos de G8 (`CREAR` / `DEFINIR` /
  `PAGAR` / `CANCELAR`) del flujo de prueba.

**Nota de wiring (spec §4.3):** en `domain-event-bus.ts`, el import dinámico del
listener de G8 va **después** del import del `audit-log.listener` — el
`EventEmitter` despacha en orden de registro, así el asiento de auditoría de la
propia `OrdenCompra` se encola antes de que arranque la reacción de
`CuentaPorPagar`.

---

## 7. Bugs encontrados y corregidos — línea de tiempo real

Reconstruida desde `git log` (rango 01–09/09/2026, filtrando por `tesoreria` /
`cuenta-por-pagar` / `G8` y por los archivos de la HU). Fechas y hashes reales.

### Cadena de PRs (contexto)

| Fecha | Commit | Qué |
|---|---|---|
| 31/08 | `32150a8` (Cali) | Schema base de Sprint 2 — migración `20260831031138_sprint2` crea `cuentas_por_pagar` + enum. **Antes de HU-G8.** |
| 01/09 | `7482f2c` | **PR1** — contrato de evento + `cuenta-por-pagar.service.ts` (580 líneas) + `calculo.ts` + 2 test files. npm test 55/55. |
| 01/09 | `909aa08` | **PR2** — listener reactivo + routing + wiring del bus + handler de auditoría + test del routing. |
| 02/09 | `66b30ab` | **PR3** — schema Zod + 2 rutas HTTP. |
| 02/09 | `52a0ea6` | **PR4** — permisos en seed (en ese momento UUIDs `...010/...011`) + spec Módulo G Revisión 2. |
| 03/09 | `f4d97ac`, `f984467`, `a08b4fe` | Merges con `develop` (traen HU-H1, HU-H4, HU-A8, HU-A7). `f984467` resuelve la colisión de UUID. |
| 03/09 | `99dbfe3` | **Merge PR #111 → `develop`. Cierre original de HU-G8.** |

### Bug 1 — `monto` serializado con `.toString()` descartaba los ceros de escala

- **Commit del fix:** `c08ce78` — 02/09/2026.
- **Causa raíz:** los payloads de `cuenta_por_pagar:estado_cambiado` (las 3 ramas
  reactivas + `PAGAR`) y `listarCuentasPorPagar` serializaban el `monto`
  (`Prisma.Decimal`) con `.toString()`, que descarta los ceros de escala:
  `"11000"` en vez de `"11000.00"`. El contrato del payload dice `monto` como
  `string` de 2 decimales.
- **Fix:** `Decimal.toFixed(2)` en lugar de `.toString()`. Sigue siendo `string`
  (no `number`, no viola IEEE-754), pero garantiza 2 decimales fijos sea cual sea
  el camino aritmético que produjo el `Decimal`. `cuenta-por-pagar.service.ts`,
  12 inserciones / 8 borrados. npm test 60/60.

### Bug 2 — La descripción `SUPERSEDIDO` de `tesoreria:operar` no se aplicaba al re-seedear

- **Commit del fix:** `caf5f12` — 02/09/2026.
- **Causa raíz:** el `upsert` de `tesoreria:operar` llevaba solo
  `REACTIVAR_REFERENCIA_RBAC` en su rama `update`, que toca `is_active` + columnas
  de baja lógica pero **no `descripcion`**. En bases de dev que ya tenían la fila
  con el texto `PLACEHOLDER` viejo, re-correr el seed dejaba la descripción
  desactualizada — solo una base fresca recibía el texto `SUPERSEDIDO` vía
  `create`.
- **Fix:** se extrajo la descripción a la constante
  `DESCRIPCION_TESORERIA_OPERAR_SUPERSEDIDO` (`seed.ts:1036`) y se pasa **tanto en
  `create` como en `update: { ...REACTIVAR_REFERENCIA_RBAC, descripcion }`**
  (`seed.ts:1044-1053`). Confirmado en la base local: antes `"PLACEHOLDER ..."`,
  después del seed `"SUPERSEDIDO (HU-G8) ..."`. El vínculo con `TESORERO_CENTRAL`
  sigue retirado (0 links). Resolvió el único `WARNING` de `sdd-verify`. npm test
  88/88, `npx prisma db seed` idempotente. `prisma/seed.ts`, 15 / 6.

### Bug 3 — La DEFINITIVA se calculaba sobre lo pedido, no sobre lo recibido y validado (criterio 4)

- **Commit del fix:** `ea5b8c5` — 03/09/2026. **El bug que encontró la auditoría
  final de la HU.**
- **Causa raíz:** `consolidarCuentaPorPagarDefinitiva` reusaba
  `calcularMontoOrdenCompra` — **la misma función que el PROVISORIO**, que suma
  `OrdenCompraItem.cantidad_solicitada` (lo pedido). El criterio 4 exige que la
  DEFINITIVA se calcule sobre **lo efectivamente recibido y validado**. El gap
  quedó enmascarado mientras HU-H4 no existía y el camino `CERRAR → DEFINITIVA`
  nunca se probaba end-to-end (§6.2).
- **Cómo se expuso:** con HU-H4 integrada en un merge de `develop`, se ejecutó el
  flujo real por primera vez. Caso de prueba: una OC con **3 de 10 unidades de un
  ítem rechazadas por control de calidad**. Resultado observado:
  **DEFINITIVA = $368.000,00** (lo pedido: 10 × 15.800 + 5 × 42.000) en lugar de
  **$320.600,00** (lo aceptado: 7 × 15.800 + 5 × 42.000).
- **Fix:** nuevo helper `calcularMontoDesdeRecepcion` (`cuenta-por-pagar.service.ts:159`)
  que agrupa `RecepcionItem` por `orden_compra_item_id` sobre las `Recepcion`
  activas de la orden y suma **`cantidad_aceptada`** (no `cantidad_recibida` — el
  criterio pide recibido *y validado*, la aceptación es posterior al control de
  calidad). Helper puro nuevo `calcularMontoDesdeItemsAceptados` (`calculo.ts:73`).
  `generarCuentaPorPagarProvisoria` **no cambió**: sigue sumando lo pedido, que es
  correcto para una proyección previa a la recepción.
- **Verificación:** misma fila, `PROVISORIO 368000.00 → DEFINITIVA 320600.00`,
  `recepcion_id` real. 6 tests nuevos (`cuenta-por-pagar.recepcion-monto.test.ts`),
  112/112 total en ese momento.
- **Re-verificación 09/09/2026:** reproducido de punta a punta con datos frescos
  (OC-2026-000007, ítem CAMTAC recibida 10 / aceptada 7): `368000.00 → 320600.00`
  exacto. Ver §3 CA4.

### Bug 4 — `estado_anterior` / `estado_nuevo` tipados como `string` suelto: la guarda de `:316` podía fallar en silencio

- **Commit del fix:** `b3dbf89` — 09/09/2026. **Posterior al cierre de la HU (PR
  #111 ya mergeado).**
- **Causa raíz:** en `OrdenCompraEstadoCambiadoPayload` (`event-types.ts`), los
  campos `estado_anterior` y `estado_nuevo` estaban tipados como `string` suelto,
  no como el enum `EstadoOrdenCompra`. La guarda de
  `consolidarCuentaPorPagarDefinitiva` (`cuenta-por-pagar.service.ts:316`) compara
  ese campo contra el literal `"RECIBIDA_COMPLETA"`. Con el campo como `string`,
  si alguien renombrara ese valor del enum en el futuro **sin actualizar la línea
  316**, la comparación seguiría compilando (`tsc` no la marcaba) y fallaría **en
  silencio en runtime**: `consolidar` entraría siempre por el `return null`, la
  `CuentaPorPagar` nunca pasaría de `PROVISORIO` a `DEFINITIVA`, y el criterio 3
  dejaría de cumplirse sin ningún aviso. Ningún test automatizado lo cubría (la
  verificación `CERRAR → DEFINITIVA` es runtime manual).
- **Fix:** ambos campos pasan a `estado_anterior: EstadoOrdenCompra` /
  `estado_nuevo: EstadoOrdenCompra`, con `import type { EstadoOrdenCompra } from
  "@prisma/client"` al tope de `event-types.ts`. **No cambia ningún valor del
  enum ni el string comparado** — solo endurece el tipo del campo que ya existía.
- **Por qué no rompió nada:** el emisor (`orden-compra.service.ts:437`) ya pasaba
  valores tipados como `EstadoOrdenCompra`; los dos únicos consumidores del evento
  (`cuenta-por-pagar.listener.ts` y `audit-log.listener.ts`, este último solo
  escribe los valores dentro de campos `Json`) siguen compilando sin cambios.
  Ninguna HU mergeada después de G8 (H9, A8, A11, Sidebar) tiene un listener de
  `orden_compra:estado_cambiado`.
- **Verificación:** experimento controlado — renombrar temporalmente el literal de
  la línea 316 a un valor inexistente ahora produce `error TS2367: This comparison
  appears to be unintentional because the types 'EstadoOrdenCompra' and
  '"RECIBIDA_COMPLETA_RENOMBRADO"' have no overlap` (`tsc` exit 2). Revertido de
  inmediato. `npm test` 184/184, `tsc` y `eslint` limpios. Diff:
  `event-types.ts` (+1 import, 2 campos) + `spec_modulo_G.md` (bullet de §5
  reescrito de "⚠️ fragilidad" a "resuelto (2026-09-09)").
- **Contraste con HU-H3:** del lado de HU-H3, `orden-compra.service.ts:75` ya
  tipaba `TRANSICIONES.CERRAR.origenes` como `EstadoOrdenCompra[]`, así que ahí el
  mismo rename **sí** rompía la compilación. HU-H3 lo cazaba; HU-G8 no.

### Búsqueda de bugs adicionales y de reflows accidentales en el historial

- **Reflows de formateo del editor.** Se buscó en `git log` (todo el historial)
  por mensajes con `reflow` / `prettier` / `reformat` / `formato` / `whitespace` /
  `reindent`: **cero coincidencias**. Los commits del rango de HU-G8 se revisaron
  por churn de whitespace: `ea5b8c5` es un cambio de lógica limpio (63 / 5),
  `caf5f12` es el fix del Bug 2 (15 / 6), ninguno es un reflow disfrazado. Si
  algún reformateo automático se coló en el working tree durante los merges de esa
  sesión, **no llegó a commitearse** en ningún commit de la HU.
- **No se encontraron otros bugs** en el historial de commits de HU-G8 más allá de
  los 4 listados.

---

## 8. Qué NO se implementó, y por qué

### 8.1. El rol `CAJERO_POS` en `cuentas_por_pagar:leer` — diferido

Confirmado en el código actual (`prisma/seed.ts:1290`, comentario explícito; spec
§5 y §7): `cuentas_por_pagar:leer` debería incluir también `CAJERO_POS` según el
Alcance §3.4/§5, pero **ese rol no existe todavía en el repositorio**. No es un
cambio de la decisión de diseño — es una dependencia de secuencia con **Módulo B /
RBAC**, no planificado este sprint. HU-G8 siembra el permiso vinculado a los 3
roles que sí existen (`TESORERO_CENTRAL`, `AUDITOR`, `ADMINISTRADOR`). Nota para
quien implemente Módulo B: al crear `CAJERO_POS`, agregar su vínculo con
`cuentas_por_pagar:leer`.

### 8.2. El consumo del evento de pago del lado de Módulo H — pendiente de ese módulo

El criterio 5 pide "notifica al Módulo H para reflejarlo en el historial del
proveedor". HU-G8 **emite** `cuenta_por_pagar:estado_cambiado` con `accion:
"PAGAR"` y `proveedor_id` en el payload — todo lo que Módulo H necesitaría.

Pero **no existe ningún listener del lado de Módulo H** suscripto a ese evento.
Búsqueda 09/09/2026: el único suscriptor de `cuenta_por_pagar:estado_cambiado` es
`audit-log.listener.ts:502` (Módulo D). El docstring del payload
(`event-types.ts:378-382`) lo plantea como capacidad preparada, no como hecho: el
payload "lleva `proveedor_id` para que Módulo H pueda suscribirse filtrando
`accion === "PAGAR"` … ese listener del lado de H todavía no existe". Reflejar el
pago en la ficha del proveedor es responsabilidad pendiente de Módulo H.

### 8.3. HU-G7 (posición diaria de tesorería) — sin ninguna pantalla ni reporte agregado

Confirmado: no hay ningún endpoint de reporte agregado ni pantalla de "posición
diaria" / "proyección de egresos". Lo único construido para consultar
`CuentaPorPagar` es el listado crudo paginado `GET /api/tesoreria/cuentas-por-pagar`
(sin UI propia en el alcance de G8 — spec §1). El criterio 1 menciona que el
compromiso provisorio es "visible en la proyección de egresos de la posición
diaria de tesorería (HU-G7)": esa proyección **no existe**. HU-G7 está fuera del
alcance de Sprint 2 por asignación de equipo, no por decisión del PO (spec §Alcance).

### 8.4. HU-G10 (registro de pago con evidencia) — bloqueada por HU-H9

La spec Revisión 3 documenta HU-G10 como ampliación de `marcarCuentaPorPagarPagada`
con `medio_pago`, `cuenta_origen_id` y `comprobante_proveedor_ids`, más una tabla
intermedia `CuentaPorPagarComprobante`. **Nada de eso está en el código**:
`MarcarPagadaSchema` solo tiene `fecha_pago`; el payload del evento no tiene esos
campos; no hay migración. HU-G10 está **bloqueada** porque el modelo
`ComprobanteProveedor` (HU-H9) no estaba migrado a la fecha de la spec. (HU-H9 se
implementó después — commit `9d4a248` — pero HU-G10 sigue sin abordarse.)

### 8.5. `cuentas_por_pagar:cancelar` — no se crea a propósito

No hay permiso ni endpoint de cancelación manual. La cancelación de una
`CuentaPorPagar` es **siempre** automática: reacciona a la cancelación de la OC
(`accion: "CANCELAR"` en `orden_compra:estado_cambiado`). No hay una vía manual
que autorizar (spec §7).

### 8.6. Sin `unique` a nivel base de un `PROVISORIO` activo por OC

La garantía de "un solo `PROVISORIO` activo por orden" es únicamente de capa de
aplicación (`generarCuentaPorPagarProvisoria:234` verifica antes de crear). No hay
constraint de base (no se permitió migración en esta HU). Un doble-emit
genuinamente simultáneo del evento podría crear dos filas. Aceptado como riesgo
conocido (spec §5).

---

## 9. Hallazgos: dónde el código no coincide con lo que se contó

Ninguno invalida un criterio de aceptación, pero todos son reales y verificables.

### 9.1. Fecha de cierre

El prompt de trabajo dice que la HU "se cerró hoy, 4 de septiembre". El merge de
cierre real (**PR #111, `99dbfe3`**) es del **3 de septiembre**. Los commits de la
HU van del 1 al 3. El fix del tipado (`b3dbf89`) es del 9 de septiembre, posterior
al cierre.

### 9.2. Conteo de tests

El total de la suite hoy es **184**, no 146 — creció por los merges de otras HU
(H9, A8, A11, Sidebar). Los tests **propios de HU-G8** son **22** (monto 5,
recepción-monto 6, estado 6, routing 5). Al cierre original eran menos: el mensaje
de `ea5b8c5` menciona "112/112 total". No hay ningún test de integración con base
para el servicio de G8 — toda la verificación transaccional fue runtime manual.

### 9.3. Referencias/afirmaciones de la spec (`spec_modulo_G.md`) — corregidas el 09/09/2026

La auditoría encontró 4 desajustes en `spec_modulo_G.md`, todos **corregidos en el
mismo pase de trabajo del 09/09** (la spec queda lista para commit junto con este
documento). El contenido conceptual de la spec no cambió — eran anclajes y una cita
textual que quedaron atrás por el movimiento del código en los merges.

- **13 anclas `archivo:línea` desactualizadas** → actualizadas: `event-types.ts:265-276`
  → `302-313` (y el payload de G8 → `391-412`); `schema.prisma:906-938` → `1151-1183`;
  `schema.prisma:719-727` (enum `EstadoOrdenCompra`) → `881-889`; `schema.prisma:530`
  (`condiciones_pago`) → `690`; `schema.prisma:544,548` (`datos_bancarios_*`) →
  `704,708`; `schema.prisma:897-905` (JSDoc de `CuentaPorPagar`) → `1142-1150`;
  `orden-compra.service.ts:432-444` → `437-449`; `orden-compra.service.ts:67-72`
  (const `TRANSICIONES`) → `72-77`; `audit-log.listener.ts:412-417` → `392-394`;
  `audit-log.listener.ts` (`valor_nuevo` del handler) → `513-525`.
- **`estado_anterior: string` / `estado_nuevo: string`** en el contrato de §2 →
  actualizados a `EstadoOrdenCompra`, coherente con el fix `b3dbf89`.
- **3 campos de HU-G10** (`medio_pago`, `cuenta_origen_id`,
  `comprobante_proveedor_ids`) que §4.1/§4.2 mostraban **dentro** del contrato del
  payload → sacados de la `interface` y movidos a un blockquote "HU-G10 (no
  implementado)"; el `valor_nuevo` del handler de §4.2 también se recortó al shape
  real de HU-G8.
- **Claim "Módulo H se suscribe"** de §2.4 (afirmado en presente, y contradictorio
  con §4.4 —"un solo suscriptor") → reescrito a "el evento se emite con
  `proveedor_id` para que Módulo H pueda reaccionar; hoy no hay ningún listener de
  H suscripto". El mismo docstring en `event-types.ts` se corrigió con idéntico
  criterio (no es cambio de lógica, solo texto de comentario).

Además se agregó a la spec la **§3.5.1** — "Asimetría de guardas de `estado_anterior`
entre las 3 ramas del listener, intencional" (ver §9.4 acá).

### 9.4. Asimetría de guardas de `estado_anterior` entre las 3 ramas del listener — intencional (decisión documentada)

De las tres ramas reactivas, **solo `consolidarCuentaPorPagarDefinitiva` lleva una
guarda explícita de `estado_anterior`** (`!== "RECIBIDA_COMPLETA"`,
`cuenta-por-pagar.service.ts:316`). `generarCuentaPorPagarProvisoria` y
`cancelarCuentaPorPagar` **no la tienen** — se defienden por existencia /
inexistencia de un `PROVISORIO` activo (`if (existente) return null` /
`if (!provisoria) return null` + `updateMany` filtrado por `estado: "PROVISORIO"`).

Esto se auditó el 09/09/2026 y se confirmó **intencional, no un olvido**:
`consolidar` es la única rama donde dispararse desde un estado no esperado produce
un **resultado de negocio incorrecto** — `calcularMontoDesdeRecepcion` sumaría
sobre cero `RecepcionItem` y dejaría una `DEFINITIVA` con `monto: 0.00`. `generar`
(CREATE idempotente) y `cancelar` (cancelación condicionada a que exista un
`PROVISORIO`) no tienen ese hazard, y su gate por existencia además cubre los
reintentos del bus, cosa que una guarda de `estado_anterior` no haría. Agregar una
guarda simétrica a `generar` se evaluó y se descartó (Opción B). El detalle vive
ahora en `spec_modulo_G.md §3.5.1`.

> Nota sobre una premisa incorrecta que circuló durante la auditoría:
> `cancelarCuentaPorPagar` **no** tiene una guarda `estado_anterior === "ENVIADA"`
> — verificado contra el código (`cuenta-por-pagar.service.ts:395-449`). Se
> defiende solo por el `findFirst` de un `PROVISORIO` activo.

### 9.5. El fixture sembrado de `CuentaPorPagar`

`prisma/seed.ts:1646` siembra una `CuentaPorPagar` `PROVISORIO` con
`monto: 736000.0` "sobre lo solicitado (no lo recibido)" para una OC cuya
recepción sembrada es parcial. Es coherente con el diseño (el PROVISORIO suma lo
pedido), y el comentario del seed (`:1640-1643`) deja explícita la interpretación
de "aprobarse la OC" = paso a `ENVIADA`. No hay fixture de `DEFINITIVA` ni de
`PAGADA` — esos estados se ejercitan por el flujo real, no por seed.

### 9.6. Criterio 5 — "notifica al Módulo H" está a medias

Como se detalla en §3 CA5 y §8.2: el pago cierra la cuenta correctamente y el
evento se emite con `proveedor_id`, pero **no hay consumidor del lado de Módulo
H**. Si "notificar" se lee como "dejar el evento disponible con los datos", está
cumplido; si se lee como "Módulo H efectivamente actualiza el historial del
proveedor", eso todavía no ocurre en ningún lado del código.

---

## 10. Referencias cruzadas

| Recurso | Ubicación |
|---|---|
| Contrato completo de la HU | `docs/specs/spec_modulo_G.md` (Revisión 3) |
| Documentación de cierre de HU-H3 (formato de referencia) | `docs/modulos/modulo H/HU3_MODULO_H.md` |
| Reglas de baja lógica y trazabilidad | `RULES.md` (Reglas N.° 1 y N.° 2) |
| Fix de concurrencia del ledger (HU-A7) | commit `0788ac8`; `src/lib/services/auditoria/audit-log.service.ts:104` |
| Bug del criterio 4 | commit `ea5b8c5`; `src/lib/services/tesoreria/cuenta-por-pagar.service.ts:159` |
| Colisión de UUID G8 ↔ H1 | merge `f984467`; `prisma/seed.ts:158-159` |
| Fix de tipado post-cierre | commit `b3dbf89`; `src/lib/events/event-types.ts:305-306` |
| Merge de cierre original | PR #111 · commit `99dbfe3` (03/09/2026) |
