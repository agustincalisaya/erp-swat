# Documentación técnica de cierre — HU-G10 (Registro de pago de Cuenta por Pagar)

## ERP SWAT Indumentarias — Módulo G (Gestión de Caja y Tesorería)

**Documento escrito desde el código real** el 2026-09-10, releyendo archivo por
archivo el estado de las tres ramas de HU-G10 tras el merge de `origin/develop`
del día (`feature/HU-G10-pago-backend @ 4c129cd`, `feature/HU-G10-pago-ui-lista @
9a69a0e`, `feature/HU-G10-pago-ui-form @ 4b3f15b`). Mismo estándar que
`HU8_MODULO_G.md`: lo que se afirma acá está anclado a `archivo:línea`, y todo lo
que no coincide con lo discutido durante la implementación está marcado como
hallazgo (§9), no forzado para que "cierre bien".

> **Estado (2026-09-10).** HU-G10 está **mergeada a `develop`**. Se entregó en
> tres PRs encadenados (`feature-branch-chain`, sin rama-tracker intermedia),
> mergeados en orden: **PR #131** (`043732d`, contrato backend) → **PR #132**
> (`5ab92d7`, consola de solo lectura) → **PR #133** (`3c22773`, form + actions
> + modal). `origin/develop` quedó en `3c22773`. Los tres fueron merge commits
> regulares (no squash): todos los commits de feature listados en §10 están en la
> historia de `develop`.
>
> Verificado que el merge de las tres ramas **no tocó ningún archivo de HU-G10**
> más allá de lo que traía cada rama: `git diff 4b3f15b origin/develop` sobre el
> set de archivos de la HU → vacío; el diffstat de cada merge coincide con el diff
> propio de su rama (14 archivos / +675−23 en PR #131, 3 / +215−1 en PR #132, 4 /
> +773−6 en PR #133), sin "evil-merge". Todas las anclas `archivo:línea` de este
> documento siguen válidas contra `develop`.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Tesorero Central, **necesito** una sección para registrar el pago de una
Cuenta por Pagar indicando medio de pago, cuenta de origen y comprobante de
proveedor asociado, **para** dejar evidencia formal y auditable de cómo y contra
qué documentación se efectivizó cada pago a proveedores.

| # | Criterio de aceptación (Product Backlog, hoja `Sprint 2`, HU-G10) |
|---|---|
| 1 | Sección de UI nueva (frontend + backend). Es la primera pantalla de Tesorería del sistema — HU-G8 no tiene frontend. |
| 2 | Amplía `marcarCuentaPorPagarPagada()` y `MarcarPagadaSchema` de HU-G8 — **no** crea una función ni un endpoint paralelo. |
| 3 | Una Cuenta por Pagar se paga contra una sola OC (1:1 por diseño). |
| 4 | Solo el Tesorero Central ejecuta la acción — reutiliza el permiso `cuentas_por_pagar:pagar` ya seedeado, sin permiso nuevo. |
| 5 | Precondición: la Cuenta por Pagar debe estar en estado `DEFINITIVA`. Si no → `409 Conflict`. |
| 6 | Debe asociarse al menos un Comprobante de Proveedor (HU-H9) vigente de la misma OC. Sin comprobante → `422`. |
| 7 | Campos nuevos del input, **los tres obligatorios**: `medio_pago`, `cuenta_origen_id`, `comprobante_proveedor_ids`. |
| 8 | Los pagos parciales quedan fuera de alcance — no se modifica ese comportamiento de HU-G8. |
| 9 | La transición sigue emitiendo un evento auditado con hash SHA-256, ahora incluyendo los campos nuevos en el payload. |

**Fuentes normativas:** `RULES.md` (Regla N.° 1 — prohibición de `DELETE` físico;
Regla N.° 2 — trazabilidad inalterable con hash SHA-256 encadenado),
`docs/specs/spec_modulo_G.md` (Revisión 4 — reconcilia el pseudocódigo de la Rev. 3
con esta implementación), Product Backlog hoja `Sprint 2` (HU-G10, HU-G8, HU-H9).

---

## 2. Visión General de la implementación

HU-G10 **no agrega una máquina de estados nueva**. Amplía la transición
`DEFINITIVA → PAGADA` que ya existía en HU-G8 (`marcarCuentaPorPagarPagada`) con la
evidencia del pago, y le pone la primera UI a Módulo G.

### 2.1. Flujo UI → action → service → evento → auditoría

```
  /tesoreria/cuentas-por-pagar            (RSC, gate cuentas_por_pagar:leer)
        │  lista CuentaPorPagar DEFINITIVA  ← listarCuentasPorPagar({ estado: "DEFINITIVA" })
        ▼
  ListaCuentasPorPagar (client)  ── fila "Registrar pago" (solo si puedePagar) ──►
        ▼
  FormularioRegistroPago (client, RHF + zodResolver)
        │  al abrir  ──► obtenerComprobantesDeCuentaAction(cuentaPorPagarId)   (gate :leer)
        │              ── resuelve la OC y devuelve los ComprobanteProveedor vigentes
        │  al enviar  ──► registrarPagoCuentaPorPagarAction(id, input)          (gate :pagar)
        ▼
  marcarCuentaPorPagarPagada(id, input, usuarioId)      cuenta-por-pagar.service.ts:495
        │  $transaction:
        │   1. findFirst + guarda DEFINITIVA           :519  → 404 / 409
        │   2. findMany ComprobanteProveedor           :528  (sin filtro is_active)
        │   2b. findMany join, ya imputados en PAGADA  :534
        │   3. validarComprobantesDePago(...)          :547  → 422 + details:[{id,motivo}]
        │   4. updateMany  DEFINITIVA → PAGADA          :565  (+ medio_pago, cuenta_origen_id, observaciones)
        │   5. createMany  CuentaPorPagarComprobante    :583  (1 fila por id)
        │  post-COMMIT:
        ▼
  domainEventBus.emit("cuenta_por_pagar:estado_cambiado", { accion:"PAGAR", ... , :603
        medio_pago, cuenta_origen_id, comprobante_proveedor_ids, observaciones })   :619-622
        ▼
  audit-log.listener.ts:502  (único suscriptor)  ──► registrarAuditLog
        │  valor_nuevo :513, con 4 spreads condicionales PAGAR-only :527-534
        ▼
  AuditLog  (cadena SHA-256, vía colaLedger — sin cambios de contrato respecto de HU-G8)

  200 OK  { cuenta_por_pagar_id, estado_anterior, estado_nuevo, fecha_pago,
            medio_pago, cuenta_origen_id, comprobante_proveedor_ids, observaciones }
        ▼
  ModalPagoRegistrado (client)  ── read-back del body del 200, sin fetch nuevo ──►
        "Cerrar"  ──► router.refresh()  ──► el listado pasa a 0 DEFINITIVA
```

### 2.2. Arquitectura de las 3 ramas (`feature-branch-chain`, sin tracker)

| PR | Rama | Base | Contenido | Verificable de forma aislada por |
|----|------|------|-----------|----------------------------------|
| **PR1** | `feature/HU-G10-pago-backend` | `develop` | Contrato backend: migración, `MedioPago`, `ServiceError.details`, catálogo `cuentas-origen`, schema, helper `validarComprobantesDePago`, servicio, evento/audit, route, 28 tests unit | curl/Postman + SQL + `verificar-cadena` (Fase 11) |
| **PR2a** | `feature/HU-G10-pago-ui-lista` | `feature/HU-G10-pago-backend` | Consola de **solo lectura**: `page.tsx` (gate `:leer`, lista DEFINITIVA), `ListaCuentasPorPagar` sin columna "Acciones", entrada de sidebar | `tsc` + `next build` + walkthrough de acceso |
| **PR2b** | `feature/HU-G10-pago-ui-form` | `feature/HU-G10-pago-ui-lista` | Form de pago + server actions + modal read-back; restaura la columna "Acciones". Incluye 2 fixes de verificación (§7) | walkthrough de browser + Fase 11 (no toca backend) |

**Por qué `feature-branch-chain` sin rama-tracker.** El backlog pide "un solo PR
para toda la HU-G10 si el alcance lo permite". El forecast de la fase de tareas
estimó ~560–690 líneas autoradas, por encima del presupuesto de revisión de 800 y
muy por encima del default de 400. Partirlo en tres slices independientemente
verificables (contrato / lectura / escritura) protege el foco de revisión: PR1
concentra todo el riesgo (migración, contrato de evento, cadena de auditoría,
cambio cross-módulo en `ServiceError`) y es curl-verificable; PR2a es una pantalla
de solo lectura; PR2b es presentación pura sobre el contrato ya congelado.
`feature/HU-G10` estaba idéntico a `origin/develop` (sin commits propios), así que
PR1 corta contra `develop` directo — no se creó una rama-tracker vacía.

### 2.3. Archivos que componen la HU (estado real)

**Backend (PR1)**

| Archivo | Rol |
|---|---|
| `src/lib/services/tesoreria/cuenta-por-pagar.service.ts` | `marcarCuentaPorPagarPagada` (`:495`) ampliado — pasos 2/2b/3 de validación + `createMany` en la tabla intermedia + emit con los 4 campos. `listarCuentasPorPagar` **sin cambios**. Los 3 emisores no-PAGAR (`:305`, `:406`, `:476`) pasan los 4 campos en `null` explícito. |
| `src/lib/services/tesoreria/cuenta-por-pagar.comprobantes.ts` | **Nuevo.** Helper puro `validarComprobantesDePago` (`:42`), `type MotivoComprobanteInvalido` (`:13`), `interface DetalleComprobanteInvalido` (`:20`). Sin `server-only`. |
| `src/lib/tesoreria/cuentas-origen.ts` | **Nuevo.** Catálogo const `CUENTAS_ORIGEN` (`:23`, entradas placeholder marcadas `// TODO(HU futura)`), `listarCuentasOrigen` (`:33`), `esCuentaOrigenValida` (`:38`). Sin `server-only` — lo importan el schema (server) y el form (client). |
| `src/lib/schemas/cuentas-por-pagar.schema.ts` | `MEDIOS_PAGO` (`:27`), `esFechaPagoNoFutura` (`:34`), `MarcarPagadaSchema` ampliado (`:46`). |
| `src/lib/errors/service-error.ts` | 3er argumento opcional `details?: unknown` (`:16`), propiedad `readonly details?` (`:14`). Cross-módulo. |
| `src/lib/events/event-types.ts` | `CuentaPorPagarEstadoCambiadoPayload` (`:391`) + 4 campos nullable `PAGAR`-only (`:413-419`); `DomainEventMap` (`:657`). |
| `src/lib/events/listeners/audit-log.listener.ts` | Handler de `cuenta_por_pagar:estado_cambiado` (`:502`); `valor_nuevo` (`:513`) con 4 spreads condicionales separados (`:527-534`). |
| `src/app/api/tesoreria/cuentas-por-pagar/[id]/pagar/route.ts` | `STATUS_POR_CODIGO` += `COMPROBANTE_PROVEEDOR_REQUERIDO: 422` (`:37`); `safeParse(body)` (`:51`); passthrough de `error.details` (`:109`); el `200` devuelve los 4 campos. |
| `prisma/schema.prisma` | `enum MedioPago` (`:1211`); `medio_pago` (`:1172`), `cuenta_origen_id` (`:1177`), `observaciones` (`:1180`) en `CuentaPorPagar`; `model CuentaPorPagarComprobante` (`:1226`, sin bloque de baja lógica). |
| `prisma/migrations/20260909231426_hu_g10_registro_pago_cxp/migration.sql` | **Nuevo.** Aditiva: `CREATE TYPE` + 3 `ADD COLUMN` nullable + `CREATE TABLE` + unique/index/FKs. Sin `DROP`/`UPDATE`, sin backfill. |
| `src/lib/schemas/cuentas-por-pagar.pago.test.ts` · `src/lib/tesoreria/cuentas-origen.test.ts` · `src/lib/services/tesoreria/cuenta-por-pagar.comprobantes.test.ts` | **Nuevos.** 28 tests. Agregados a `package.json` línea 10. |

**Frontend (PR2a / PR2b)**

| Archivo | Rol |
|---|---|
| `src/app/(dashboard)/tesoreria/cuentas-por-pagar/page.tsx` | RSC. `dynamic = "force-dynamic"` (`:39`); `getServerSession()` → `redirect("/login")` (`:48-49`); `usuarioTienePermiso(:leer)` → `redirect("/no-autorizado")` (`:51-55`); resuelve `puedePagar` (`:57`); `listarCuentasPorPagar({ estado: "DEFINITIVA", … })` (`:67`). |
| `src/app/(dashboard)/tesoreria/cuentas-por-pagar/actions.ts` | `"use server"`. `obtenerComprobantesDeCuentaAction` (`:72`, gate `:leer`), `registrarPagoCuentaPorPagarAction` (`:126`, gate `:pagar`, llama la misma función de servicio que el route). `ActionResult<T>` local con `details?`. **Sin `revalidatePath`** (`:160-164`, ver §7 Bug 1). |
| `src/components/tesoreria/ListaCuentasPorPagar.tsx` | Client. Tabla de CxP DEFINITIVA (monto formato ARS). `puedePagar` (`:30`) → columna "Acciones" con `<FormularioRegistroPago>` o "Sin permiso" (`:92`). |
| `src/components/tesoreria/FormularioRegistroPago.tsx` | Client. RHF + `zodResolver(MarcarPagadaSchema)`. `MOTIVO_LABEL` (`:59`) mapea el código de `details[].motivo` a texto español. `router.refresh()` en el `onClose` del modal (`:445-449`). |
| `src/components/tesoreria/ModalPagoRegistrado.tsx` | Client. Read-back del body del `200`. `formatearFechaPago` (`:49-50`) toma Y/M/D del ISO en UTC (ver §7 Bug 2). |
| `src/components/layout/Sidebar.tsx` | Sección "Tesorería" (`:133`, `icon: Wallet`), item "Cuentas por Pagar" (`:142`, `icon: Banknote`, `permiso: "cuentas_por_pagar:leer"`), filtrado por `usuarioTienePermiso` (`:161`). |

---

## 3. Cumplimiento de cada Criterio de Aceptación

> **Cómo se verificó.** Backend: 28 tests unit (helpers puros) + **Fase 11**
> (script `fase11-hu-g10-reverificacion.sh`, curl + SQL + `verificar-cadena`),
> corrida **dos veces** — antes y después del merge de `origin/develop` — con
> resultado idéntico (PASS 27/27). Frontend: walkthrough de browser de 11 pasos +
> 2 adiciones (invocación directa del server sin sesión / con rol sin permiso;
> diagnóstico instrumentado del "freeze"). CI **no** corre tests ni `tsc` suelto
> ni `migrate deploy` (ver §9).

### ✅ CA1 — Sección de UI nueva (frontend + backend)

Backend: PR1 (contrato). Frontend: `/tesoreria/cuentas-por-pagar` (`page.tsx`) +
`ListaCuentasPorPagar` + `FormularioRegistroPago` + `ModalPagoRegistrado` +
entrada de sidebar (PR2a/PR2b). **Verificación (walkthrough):** login
`tesorero.seed` → el sidebar muestra "Tesorería → Cuentas por Pagar" → la consola
lista la CxP `DEFINITIVA` (`OC-2026-0001`, `$ 284.400,00`). **Estado: CUMPLIDO.**

### ✅ CA2 — Amplía la función y el schema de HU-G8, sin vía paralela

`marcarCuentaPorPagarPagada` (`cuenta-por-pagar.service.ts:495`) es la misma
función, misma firma `(cuentaPorPagarId, input, usuarioId)`. `MarcarPagadaSchema`
(`cuentas-por-pagar.schema.ts:46`) es el mismo schema, con campos agregados. El
endpoint sigue siendo `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar`. No hay
`registrarPagoCuentaPorPagar()` ni `/ordenes-pago` ni modelo `OrdenPago`. El
server action `registrarPagoCuentaPorPagarAction` (`actions.ts:126`) es un wrapper
fino que llama a esa misma función. **Estado: CUMPLIDO.**

### ✅ CA3 — Una Cuenta por Pagar se paga contra una sola OC (1:1)

`CuentaPorPagar` tiene una única `orden_compra_id`. La validación de comprobantes
(`validarComprobantesDePago`, `comprobantes.ts:42`) exige que **todos** los ids
pertenezcan a `cuenta.orden_compra_id` — un id de otra OC → `motivo: "DE_OTRA_OC"`
→ `422`. **Verificación (Fase 11, caso 9):** `PATCH .../pagar` con `[C1, COTH]`
(COTH de `OC-2026-0002`) → `422`, `error.details: [{ id: <COTH>, motivo:
"DE_OTRA_OC" }]`, guarda SQL: `estado` sigue `DEFINITIVA`, `join = 0`. **Estado:
CUMPLIDO CON EVIDENCIA REAL.**

### ✅ CA4 — Solo Tesorero Central; reutiliza `cuentas_por_pagar:pagar`, sin permiso nuevo

`route.ts:66` — `usuarioTienePermiso(session.userId, PERMISO_PAGAR_CUENTA_POR_PAGAR)`
inline; `PERMISO_PAGAR_CUENTA_POR_PAGAR === "cuentas_por_pagar:pagar"`.
`actions.ts:150` — el server action gatea con el mismo permiso. `prisma/seed.ts`
**no fue modificado por HU-G10** — el permiso ya lo sembró HU-G8, exclusivo de
`TESORERO_CENTRAL`. **Verificación (walkthrough, adición 1 — rechazo real del
servidor, no botón escondido):** `fetch` directo a `/pagar` — **sin sesión →
`401 UNAUTHORIZED`**; **como `auditor.seed` (tiene `:leer`, no `:pagar`) →
`403 FORBIDDEN` "No tenés el permiso \"cuentas_por_pagar:pagar\"..."**; `auditor`
`GET` del listado → `200`. En la UI: `auditor` ve la fila sin botón ("Sin
permiso"); `comprador.seed` (sin permisos de CxP) es redirigido a
`/no-autorizado` y no ve el item de sidebar. **Estado: CUMPLIDO CON EVIDENCIA
REAL.**

### ✅ CA5 — Precondición estado `DEFINITIVA`, si no `409`

`cuenta-por-pagar.service.ts:519` — `if (!cuenta.is_active || cuenta.estado !==
"DEFINITIVA") throw new ServiceError("TRANSICION_INVALIDA", "No es posible pagar
una cuenta en estado " + cuenta.estado)`. El route mapea `TRANSICION_INVALIDA →
409` (`STATUS_POR_CODIGO`). Además, `updateMany` (`:565`) está guardado por
`where: { estado: "DEFINITIVA" }` → `count === 0` (carrera) → `409`.
**Verificación (Fase 11, caso 6 + walkthrough paso 9):** re-pago de una CxP ya
`PAGADA` → `409 TRANSICION_INVALIDA`; en la UI, el form muestra un `<Alert>`
inline "No es posible pagar una cuenta en estado PAGADA", queda editable, sin
redirect. **Estado: CUMPLIDO CON EVIDENCIA REAL.**

### ✅ CA6 — Al menos un Comprobante de Proveedor vigente de la misma OC; sin comprobante `422`

Implementado como **validación todo-o-nada** (más estricta que "≥1", ver §5):
`validarComprobantesDePago` (`comprobantes.ts:42`) devuelve un
`DetalleComprobanteInvalido` por **cada** id que no se puede imputar; cualquier
detalle → `throw new ServiceError("COMPROBANTE_PROVEEDOR_REQUERIDO", …, detalles)`
(`service.ts:553`) → rollback total → `422` con `error.details: [{ id, motivo }]`.
`motivo` es un código: `NINGUNO_ENVIADO | ANULADO | DE_OTRA_OC | INEXISTENTE |
YA_IMPUTADO` (precedencia `INEXISTENTE > DE_OTRA_OC > ANULADO > YA_IMPUTADO`).
"Vigente" = `is_active: true`. **Verificación (Fase 11, casos 9):** array vacío →
`400` (lo frena el `.min(1)` de Zod); `[C1, C3-anulado]` → `422`
`motivo: "ANULADO"`; `[C1, ghost-uuid]` → `422` `motivo: "INEXISTENTE"`; cada uno
con guarda SQL "no persistió nada". En la UI (walkthrough paso 8): al enviar con
un comprobante que se anuló entre la carga y el submit, el checkbox de ese
comprobante muestra "Comprobante anulado" inline. **Estado: CUMPLIDO CON EVIDENCIA
REAL.**

### ✅ CA7 — `medio_pago` / `cuenta_origen_id` / `comprobante_proveedor_ids` obligatorios

`MarcarPagadaSchema` (`cuentas-por-pagar.schema.ts:46`): `medio_pago:
z.enum(MEDIOS_PAGO)`, `cuenta_origen_id: z.string().refine(esCuentaOrigenValida)`,
`comprobante_proveedor_ids: z.array(z.string().uuid()).min(1)...` — ninguno
`.optional()`. El route usa `safeParse(body)` (ya no `body ?? {}`), así que un
body vacío falla la validación. **Verificación (Fase 11, casos 10):** body vacío,
o faltando cualquiera de los tres, o `medio_pago: "TARJETA"`, o `cuenta_origen_id`
fuera de catálogo, o `fecha_pago` futura, o `observaciones` de 501 caracteres →
`400 VALIDATION_ERROR`. **Estado: CUMPLIDO CON EVIDENCIA REAL.**

### ✅ CA8 — Pagos parciales fuera de alcance

`marcarCuentaPorPagarPagada` sigue siendo todo-o-nada: `updateMany` pone
`estado: "PAGADA"` + `fecha_pago` en una sola escritura, sin ningún campo de
"monto pagado" ni estado intermedio. No hay endpoint ni parámetro de pago
parcial. El `monto` de la CxP no se toca. **Estado: CUMPLIDO (por ausencia
deliberada).**

### ✅ CA9 — El evento auditado SHA-256 ahora incluye los campos nuevos

El emit de `PAGAR` (`service.ts:603`) suma `medio_pago`, `cuenta_origen_id`,
`comprobante_proveedor_ids`, `observaciones` (`:619-622`). El handler de auditoría
(`audit-log.listener.ts:502`) los vuelca en `valor_nuevo` con 4 spreads
condicionales `PAGAR`-only (`:527-534`); para `CREAR`/`DEFINIR`/`CANCELAR` las
guardas son falsy y el `valor_nuevo` queda **byte-idéntico** a HU-G8. Un solo
`registrarAuditLog` por evento — sin cambio de contrato en la cadena.
**Verificación (Fase 11, casos 8 y 12):** SQL del último `audit_logs` `PAGAR` →
`valor_nuevo` con los 4 campos; `verificar-cadena` → **`integra: true`** en
baseline (3 registros) y final (10); `audit_logs` avanza exactamente **+7**
(4 altas de comprobante + 1 `CERRAR` OC + 1 `DEFINIR` CxP + 1 `PAGAR` CxP), sin
filas de más → la cadena no se bifurcó. **Estado: CUMPLIDO CON EVIDENCIA REAL.**

### Resumen

| CA | Estado | Ancla principal |
|---|---|---|
| 1 | ✅ Cumplido | `page.tsx:39`, `actions.ts:126`, `Sidebar.tsx:133` |
| 2 | ✅ Cumplido | `cuenta-por-pagar.service.ts:495`, `cuentas-por-pagar.schema.ts:46` |
| 3 | ✅ Cumplido con evidencia real | `comprobantes.ts:42` (`DE_OTRA_OC`), Fase 11 caso 9 |
| 4 | ✅ Cumplido con evidencia real | `route.ts:66`, `actions.ts:150`; 401/403 directos + gating de UI |
| 5 | ✅ Cumplido con evidencia real | `cuenta-por-pagar.service.ts:519`, `:565`; Fase 11 caso 6 + walkthrough paso 9 |
| 6 | ✅ Cumplido con evidencia real | `comprobantes.ts:42`, `service.ts:553`; Fase 11 casos 9 |
| 7 | ✅ Cumplido con evidencia real | `cuentas-por-pagar.schema.ts:46`; Fase 11 casos 10 |
| 8 | ✅ Cumplido (por ausencia deliberada) | `cuenta-por-pagar.service.ts:565` |
| 9 | ✅ Cumplido con evidencia real | `service.ts:603`, `audit-log.listener.ts:527-534`; Fase 11 casos 8 y 12 |

---

## 4. Contratos reales

### 4.1. Payload del evento — `CuentaPorPagarEstadoCambiadoPayload`

`src/lib/events/event-types.ts:391-420` (verificado 2026-09-10). Base de HU-G8 +
4 campos de HU-G10 al final:

```typescript
interface CuentaPorPagarEstadoCambiadoPayload {
  // ... base HU-G8: cuenta_por_pagar_id, orden_compra_id, numero_orden, proveedor_id,
  //     estado_anterior, estado_nuevo, accion, cambiado_por, monto_anterior, monto_nuevo,
  //     recepcion_id, fecha_vencimiento, fecha_pago, deletion_reason ...
  medio_pago: "TRANSFERENCIA" | "CHEQUE" | "EFECTIVO" | null; // :413 — presente solo en PAGAR
  cuenta_origen_id: string | null;                            // :415 — id del catálogo, sin FK
  comprobante_proveedor_ids: string[] | null;                 // :417
  observaciones: string | null;                               // :419
}
```

Los 4 son `| null` **por obligación del tipo compartido**: `DomainEventMap`
(`:657`) usa una sola interface para las 4 acciones. Si no fueran nullable, `tsc`
/ `next build` fallaría en los 3 emisores no-PAGAR (`service.ts:305`, `:406`,
`:476`) y en la firma del listener. Esos 3 emisores pasan `medio_pago: null,
cuenta_origen_id: null, comprobante_proveedor_ids: null, observaciones: null`
explícitos.

### 4.2. `valor_nuevo` del `AuditLog` (handler)

`audit-log.listener.ts:513-536` — base `{ estado, accion, monto, orden_compra_id,
numero_orden, proveedor_id }` + spreads condicionales. Los 4 de HU-G10 son spreads
**separados** (no uno combinado):

```typescript
...(payload.medio_pago ? { medio_pago: payload.medio_pago } : {}),                 // :527
...(payload.cuenta_origen_id ? { cuenta_origen_id: payload.cuenta_origen_id } : {}),
...(payload.comprobante_proveedor_ids?.length
  ? { comprobante_proveedor_ids: payload.comprobante_proveedor_ids } : {}),
...(payload.observaciones ? { observaciones: payload.observaciones } : {}),         // :534
```

Para `CREAR`/`DEFINIR`/`CANCELAR` las 4 guardas son falsy → `valor_nuevo`
byte-idéntico a HU-G8.

### 4.3. Zod — `MarcarPagadaSchema`

`src/lib/schemas/cuentas-por-pagar.schema.ts:46`:

```typescript
export const MEDIOS_PAGO = ["TRANSFERENCIA", "CHEQUE", "EFECTIVO"] as const;      // :27
export function esFechaPagoNoFutura(fecha: Date, ahora: Date = new Date()): boolean; // :34

export const MarcarPagadaSchema = z.object({
  fecha_pago: z.coerce.date().default(() => new Date())
    .refine((d) => esFechaPagoNoFutura(d), "La fecha de pago no puede ser futura"),
  medio_pago: z.enum(MEDIOS_PAGO),
  cuenta_origen_id: z.string().refine(esCuentaOrigenValida, "La cuenta de origen no existe"),
  comprobante_proveedor_ids: z.array(z.string().uuid()).min(1, "Debés imputar al menos un comprobante")
    .refine((ids) => new Set(ids).size === ids.length, "No podés imputar el mismo comprobante dos veces"),
  observaciones: z.string().max(500, "Las observaciones no pueden superar los 500 caracteres").optional(),
});
```

`cuenta_origen_id` **no** es `uuid` — es un id del catálogo const
`src/lib/tesoreria/cuentas-origen.ts` (`esCuentaOrigenValida`, `:38`).

### 4.4. Helper de validación de comprobantes

`src/lib/services/tesoreria/cuenta-por-pagar.comprobantes.ts`:

```typescript
export type MotivoComprobanteInvalido =                                // :13
  | "NINGUNO_ENVIADO" | "ANULADO" | "DE_OTRA_OC" | "INEXISTENTE" | "YA_IMPUTADO";
export interface DetalleComprobanteInvalido { id: string; motivo: MotivoComprobanteInvalido } // :20
export function validarComprobantesDePago(                             // :42
  idsSolicitados, encontrados, ordenCompraId, idsYaImputadosEnOtrosPagos,
): DetalleComprobanteInvalido[];
// precedencia cuando varios motivos aplican: INEXISTENTE > DE_OTRA_OC > ANULADO > YA_IMPUTADO
```

### 4.5. Endpoints y server actions

| Superficie | Ancla | Contrato |
|---|---|---|
| `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar` | `route.ts:40` | Body `MarcarPagadaSchema`. `200` → `{ cuenta_por_pagar_id, estado_anterior, estado_nuevo, fecha_pago, medio_pago, cuenta_origen_id, comprobante_proveedor_ids, observaciones }`. Errores: `400 VALIDATION_ERROR` · `401 UNAUTHORIZED` · `403 FORBIDDEN` · `404 CUENTA_POR_PAGAR_NO_ENCONTRADA` · `409 TRANSICION_INVALIDA` · `422 COMPROBANTE_PROVEEDOR_REQUERIDO` (con `error.details: [{ id, motivo }]`) · `500`. |
| `GET /api/tesoreria/cuentas-por-pagar` | (HU-G8) | Sin cambios en HU-G10. La consola lo consume con `estado=DEFINITIVA`. |
| `obtenerComprobantesDeCuentaAction(cuentaPorPagarId)` | `actions.ts:72` | Gate `:leer`. Resuelve la OC de la CxP y devuelve sus `ComprobanteProveedor` vigentes. `ActionResult<ComprobanteVigente[]>`. |
| `registrarPagoCuentaPorPagarAction(id, input)` | `actions.ts:126` | Gate `:pagar`. `MarcarPagadaSchema.safeParse` → `marcarCuentaPorPagarPagada`. `ActionResult` con `error.details?`. **Sin `revalidatePath`** (§7 Bug 1). |

---

## 5. Decisiones de diseño y por qué se tomaron así

### 5.1. Validación todo-o-nada de comprobantes, no "al menos uno"

El backlog dice "al menos un comprobante vigente". El pseudocódigo de la Rev. 3
del spec lo implementaba con `count(...) > 0` y luego persistía **todos** los ids
recibidos, incluidos los inválidos, en la tabla intermedia. Eso deja links basura:
un pago podría quedar imputado a un comprobante anulado o de otra OC, y eso es
evidencia de pago errónea. Se ratificó (2026-09-10) que **cualquier** id inválido
rechaza el request entero con `422`, sin persistir nada. La tabla intermedia solo
contiene ids que pasaron la validación completa.

### 5.2. `422` estructurado: `details: [{ id, motivo }]`, motivo como código

El `422` no lleva un mensaje genérico. Lleva un detalle por id inválido, con el
`motivo` como **código** de un enum de 5 valores, no como texto humano — mismo
criterio que el resto de los `ServiceError` del proyecto (`TRANSICION_INVALIDA`,
etc.): el backend devuelve códigos, el frontend los mapea a texto
(`FormularioRegistroPago.tsx:59`, `MOTIVO_LABEL`). Esto le permite al form marcar
**exactamente** qué checkbox sacar de la selección. `NINGUNO_ENVIADO` cubre el
array vacío llegado por un llamador directo del server action (por HTTP lo frena
antes el `.min(1)` de Zod con `400`). `YA_IMPUTADO` cubre el rechazo global de
doble imputación entre pagos (§5.5).

### 5.3. `cuenta_origen_id`: catálogo const de backend, sin FK real

No existe un modelo `CuentaBancaria`/`CajaChica` en el dominio, y HU-G10 no lo
crea (fuera de alcance de Sprint 2). La columna queda `String?` **sin FK**. La
validación de existencia se hace contra un catálogo const
(`src/lib/tesoreria/cuentas-origen.ts`, `{ id, label }[]`) que hoy trae entradas
placeholder marcadas `// TODO(HU futura)`. El schema Zod valida membership
(`esCuentaOrigenValida`); el form consume la misma const para su `<select>` —
única fuente de verdad, sin deriva entre lo que la UI ofrece y lo que el backend
acepta. Cuando exista la entidad real, los `id` del catálogo son estables y se
convierten en FK sin reescribir datos.

### 5.4. `observaciones` — campo agregado que la Rev. 3 no contemplaba

La Rev. 3 del spec ya mencionaba un `observaciones` opcional en el
`MarcarPagadaSchema` pero no en el modelo Prisma. Se ratificó incluirlo: columna
`observaciones String?` en `CuentaPorPagar` + campo opcional en el schema, acotado
a **500 caracteres, tope duro** (`.max(500)` → `400` en overflow, nunca truncado
silencioso — mismo criterio que el rechazo de comprobantes inválidos: se rechaza
con error explícito, no se acepta una versión degradada de lo que el usuario
mandó).

### 5.5. `fecha_pago` retrodatable con tope "no futura"

El pago puede haberse ejecutado en el banco ayer y registrarse hoy. El form
expone `fecha_pago`; el schema acepta fechas pasadas y **rechaza futuras**
(`esFechaPagoNoFutura`, helper puro testeable, `schema.prisma`/schema Zod). Sigue
teniendo default "ahora" cuando se omite.

### 5.6. Rechazo global de doble imputación (`YA_IMPUTADO`)

Un comprobante ya imputado a **otra** `CuentaPorPagar` en estado `PAGADA` no puede
volver a imputarse. El `@@unique([cuenta_por_pagar_id, comprobante_proveedor_id])`
de la tabla intermedia solo garantiza idempotencia *dentro* del mismo pago; el
rechazo global se hace en el servicio (`service.ts:534`, `findMany` sobre la join
contra `cuenta_por_pagar.estado === "PAGADA"`, excluyendo el id actual). Como
CxP↔OC es 1:1, en la práctica no debería ocurrir salvo por error de carga.

### 5.7. Listado propio de Tesorería, no RBAC de Módulo H

La consola necesita un punto de entrada para el Tesorero Central. Ese rol solo
tiene `cuentas_por_pagar:leer` + `:pagar` — **ningún permiso de Módulo H**, así que
no puede llegar a un detalle de OC ni a una pantalla de compras. La consola es una
**sola tabla filtrada de `CuentaPorPagar` propia de esta HU** (estado
`DEFINITIVA`), consumiendo el listado de HU-G8 ya cerrado. **No es HU-G7**
(posición diaria de tesorería, que agrega cobros de Módulo B/E y mermas de Módulo
A) ni la absorbe.

### 5.8. `feature-branch-chain` sin rama-tracker

Ver §2.2. El corte en 3 slices sale del forecast de tamaño (por encima del
presupuesto de revisión), no de una razón funcional; `feature/HU-G10` estaba en
`origin/develop` sin commits propios, así que PR1 corta contra `develop` directo.

### 5.9. `listarCuentasPorPagar` no se tocó

El `select` del listado no expone `medio_pago`/`cuenta_origen_id`/`observaciones`
ni la relación `comprobantes`. La consola lo consume filtrado a `DEFINITIVA`
(donde esos campos siempre serían `null`), y el read-back post-pago del modal se
arma con el body del `200` de `/pagar`, no con el listado. Agregar esos campos al
`select` es trabajo de HU-G7 si necesita mostrar el detalle de pago de cuentas
`PAGADA` desde la grilla (anotado en `spec_modulo_G.md §2.5`).

---

## 6. Integración con otras HU

### 6.1. HU-H9 ya no bloquea

La Rev. 3 del spec marcaba HU-G10 como 🔴 bloqueada por HU-H9 (`ComprobanteProveedor`
no migrado). Al momento de implementar, HU-H9 estaba mergeada: el modelo existe,
con `orden_compra_id`, `proveedor_id` (desnormalizado — su JSDoc cita a HU-G10
como uno de los motivos), `is_active`, y `listarComprobantesPorOrdenCompra` ya
disponible. HU-G10 lo consume tal cual: la vigencia es `is_active: true` (HU-H9 no
tiene campo `estado`; la anulación es baja lógica pura).

### 6.2. Coordinación con HU-G8 (mismo autor)

HU-G10 amplía un contrato ya cerrado de HU-G8 (PR #111). El riesgo técnico de
tocar el `MarcarPagadaSchema`, el `marcarCuentaPorPagarPagada` y el payload de
`cuenta_por_pagar:estado_cambiado` —compartidos por las 4 transiciones— se mitigó
repitiendo la **verificación runtime completa de HU-G8** (las 4 transiciones +
`verificar-cadena`), no solo los criterios nuevos. Resultado: `integra: true`,
`valor_nuevo` de `DEFINIR`/`CANCELAR` byte-idéntico, `audit_logs` +1 por
transición. El `valor_nuevo` byte-idéntico es lo que garantiza que la cadena
SHA-256 de HU-G8 no se recalcula distinto.

### 6.3. Merge limpio con PR #130 (`develop` d0e5358 → 7df38f9)

Mientras HU-G10 estaba en revisión, `develop` avanzó con **PR #130**
(`fix(seed): proveedores:leer para Auditor` + refactor de diálogos de
`AccionesProveedorMenu`). Se hizo `git merge --no-commit origin/develop` en
`feature/HU-G10-pago-backend`: resolución **100% automática, cero conflictos**
(evidencia: `git ls-files -u` vacío, `git diff --check` exit 0, sin marcadores en
el árbol). PR #130 tocó `prisma/seed.ts` + 5 archivos de
`src/components/compras/` — **cero solapamiento** con los 14 archivos de HU-G10;
`schema.prisma` no lo tocó PR #130, así que no hay interacción con la migración.
La Fase 11 se re-corrió post-merge con resultado idéntico.

### 6.4. Módulo H — todavía sin consumidor del evento de pago

Igual que en HU-G8: el evento `cuenta_por_pagar:estado_cambiado` se emite con
`proveedor_id` para que Módulo H pueda reaccionar filtrando `accion === "PAGAR"`,
pero **no hay ningún listener del lado de H suscripto** (único suscriptor:
`audit-log.listener.ts:502`). Es una capacidad preparada, no una notificación
efectiva. HU-G10 no cambia esto.

---

## 7. Bugs encontrados y corregidos — línea de tiempo real

Ambos se encontraron durante el **walkthrough de browser de PR2b**, no en la Fase
11 (que es backend). Ambos se corrigieron en `feature/HU-G10-pago-ui-form` y se
re-verificaron.

### Bug 1 — `revalidatePath` en la action impedía renderizar el modal de confirmación (`a092282`)

**Síntoma.** Al pagar desde la consola, el pago se persistía bien (SQL:
`PAGADA`, join, `audit_logs`), pero el `ModalPagoRegistrado` con el read-back
nunca se veía; el listado pasaba a 0 DEFINITIVA sin que el usuario cerrara nada.

**Diagnóstico — dos vías independientes.**
1. `grep "router.refresh()"` sobre todo PR2b: el único está en el `onClose` de
   `<ModalPagoRegistrado>` (`FormularioRegistroPago.tsx:445-449`) — donde dice la
   decisión de diseño. Pero `registrarPagoCuentaPorPagarAction` llamaba
   `revalidatePath("/tesoreria/cuentas-por-pagar")`, y en un Server Action de Next
   16 eso refetchea la ruta **apenas la action retorna** — no hace falta
   `router.refresh()`. La página RSC se re-renderiza con la lista vacía → la fila
   pagada se desmonta → y con ella `<FormularioRegistroPago>` y su hijo
   `<ModalPagoRegistrado>`, en el mismo commit en que debería montarse. El
   `router.refresh()` del `onClose` era código muerto.
2. **Probe instrumentado de runtime** (sin depender del screenshot de CDP):
   `setInterval` @80ms registrando `{ dt, cantidad de [role=dialog], filas de
   tabla }` + listeners de `error`/`unhandledrejection` + `PerformanceObserver`
   de `longtask`. Resultado: **136 samples en ~11s, max gap 95ms, 0 errores, 0
   longtasks > 200ms**. El timeline saltaba de `dialogs:1` (form) directo a
   `dialogs:0` — ningún estado con el modal. El main thread **nunca se bloqueó**:
   el "freeze" percibido era de la capa CDP/automatización, no de la app (ver §8).

**Fix.** Se eliminó `revalidatePath` de `registrarPagoCuentaPorPagarAction`
(`actions.ts:160-164`, + su import de `next/cache`). `grep revalidatePath` sobre
todo `actions.ts`: aparecía solo en ese import + esa llamada — no había otra
razón para tenerlo. El único disparador de refresh queda el `router.refresh()`
del `onClose` del modal (intención original del Design).

**Re-verificación.** Probe post-fix: timeline `dialogs:1 → dialogs:2` con
`"Pago registrado — OC-2026-0001 … PAGADA"` en el segundo dialog, y `rows:1` (la
fila sigue presente). Walkthrough paso 5: submit → modal con el read-back →
"Cerrar" → `router.refresh()` → listado a 0 DEFINITIVA. `tsc`/`eslint`/`build`
verdes.

### Bug 2 — `fecha_pago` en el modal mostraba un día de menos (`4b3f15b`)

**Síntoma.** El modal mostraba `9/9/2026` para un pago registrado con
`fecha_pago = 2026-09-10`. La DB estaba correcta (`2026-09-10 00:00:00`).

**Causa.** `ModalPagoRegistrado` formateaba con
`new Date(data.fecha_pago).toLocaleDateString("es-AR")`, usando la zona horaria
local del browser. `fecha_pago` es una fecha de calendario que en la DB queda a
medianoche UTC (`z.coerce.date()` sobre un `YYYY-MM-DD`); en UTC-3,
`toLocaleDateString` la corre al día anterior.

**Fix.** `formatearFechaPago` (`ModalPagoRegistrado.tsx:49-50`) toma año/mes/día
del ISO string en UTC (`new Date(fecha).toISOString().slice(0,10).split("-")`),
sin pasar por la zona local. La DB no cambia. Alcance: solo el modal, que es el
único lugar que muestra `fecha_pago`.

**Re-verificación (caso cerca de medianoche).** Elegí `2026-09-10` en el form →
DB `fecha_pago = 2026-09-10 00:00:00`, audit `valor_nuevo.fecha_pago =
2026-09-10T00:00:00.000Z` → **el modal muestra `10/09/2026`**. `tsc`/`eslint`/
`build` verdes.

---

## 8. Qué NO se implementó, y por qué

### 8.1. `YA_IMPUTADO` y `NINGUNO_ENVIADO` no ejercitados por HTTP

`NINGUNO_ENVIADO` (`422`) es inalcanzable por HTTP: el `.min(1)` de
`comprobante_proveedor_ids` frena el array vacío con `400` antes de llegar al
servicio. Solo aparece si un server action llama directo a
`validarComprobantesDePago`. `YA_IMPUTADO` end-to-end requiere una segunda OC con
recepción + `CERRAR` para tener una 2ª `CuentaPorPagar` `DEFINITIVA` y pagarla con
un comprobante ya imputado. Ambos motivos están cubiertos por el unit test
`cuenta-por-pagar.comprobantes.test.ts`; la Fase 11 los deja documentados como
"cubierto por unit test, no por HTTP".

### 8.2. Encabezado de sección "Tesorería" del sidebar visible para roles sin acceso

Para un usuario sin `cuentas_por_pagar:leer` (ej. `comprador.seed`), el item
"Cuentas por Pagar" se oculta correctamente (`Sidebar.tsx:161`,
`usuarioTienePermiso`), pero el **encabezado** de la sección "Tesorería"
(`:133`) sigue renderizando con cero items debajo. Cosmético, no funcional. El
`SeccionSidebar` filtra ítems, no la sección contenedora cuando queda vacía.

### 8.3. `fecha_emision` con el mismo patrón de TZ que el Bug 2

`ListaCuentasPorPagar.tsx` (`formatearFecha`) y `FormularioRegistroPago.tsx`
(`:306`, en el checklist de comprobantes) formatean `fecha_emision` con
`new Date(...).toLocaleDateString("es-AR")` — el mismo patrón local-TZ que causó
el Bug 2, pero sobre otro campo. **No se corrigió**: el hallazgo #1 se acotó
explícitamente a `fecha_pago` en el modal. Si `fecha_emision` también es una fecha
de calendario a medianoche UTC, tiene el mismo off-by-one latente. Queda anotado
para una decisión aparte.

### 8.4. `hoyLocalISO()` del default del input de fecha — no es un bug

`FormularioRegistroPago.tsx:84` calcula "hoy" en hora **local** para el default
del `<input type="date">`. Eso es correcto: el usuario elige un día de calendario
local. El desajuste del Bug 2 era solo de *presentación* del valor ya guardado.

### 8.5. Consumidor del evento de pago del lado de Módulo H

Pendiente de Módulo H, igual que en HU-G8 (§6.4).

### 8.6. Modelo `CuentaBancaria`/`CajaChica` y validación referencial de `cuenta_origen_id`

Fuera de alcance de Sprint 2. `cuenta_origen_id` queda como referencia libre
validada contra el catálogo const (§5.3).

---

## 9. Hallazgos: dónde el código o la doc no coincidían con lo que se contó

Ninguno invalida un criterio de aceptación.

### 9.1. El shape de payload de referencia era de otro evento

Durante la exploración se usó como referencia un shape de payload
(`estado_nuevo: EstadoOrdenCompra`, `monto` singular, etc.) que en realidad es
`OrdenCompraEstadoCambiadoPayload` (`event-types.ts:302-313`), el evento
**consumido**, no `CuentaPorPagarEstadoCambiadoPayload` (`:391`), que usa una
unión de estados de CxP, `monto_anterior`/`monto_nuevo` y varios campos nullable.
La consecuencia práctica: los 4 campos nuevos van sí o sí `| null` o `next build`
rompe en los 3 emisores no-PAGAR + el listener. Se detectó al aterrizar el diseño
contra el código; el spec (Rev. 4) ya refleja el shape real.

### 9.2. `ServiceError` no tenía canal para datos estructurados

`src/lib/errors/service-error.ts` solo tenía `code` y `message`. El `422` con
`details: [{ id, motivo }]` obligó a agregar un 3er argumento opcional al
constructor (`details?: unknown`, `:16`; propiedad `readonly details?`, `:14`).
Es un archivo compartido fuera de Módulo G. Auditados **~40 catch blocks de
`src/app/api`**: ninguno hace `...err` (todos arman `{ code, message }`
explícito), así que el campo opcional no filtra en ningún endpoint preexistente;
solo `.../pagar` lo propaga (`route.ts:109`).

### 9.3. CI no cubre tests, ni `tsc` suelto, ni `migrate deploy`

`.github/workflows/ci.yml` corre `npm ci → lint → prisma generate → build`.
`npm test` es una **lista multi-archivo hardcodeada** en `package.json` línea 10
(no un glob), así que un `.test.ts` nuevo que no se agregue a esa línea nunca
corre y CI no lo detecta. Los 3 tests nuevos de HU-G10 están agregados. La
verificación real de HU-G10 es la Fase 11 en runtime, no CI.

### 9.4. Comentario desactualizado en `FormularioRegistroPago.tsx:447-448`

El `onClose` del modal todavía tiene el comentario `// El revalidatePath de la
action dejó el listado stale; recién al cerrar el read-back se refetchea` — que
describe el comportamiento **anterior** al fix del Bug 1 (el `revalidatePath` ya
no está en la action). El `router.refresh()` sigue siendo correcto y necesario;
solo el comentario quedó viejo. Menor. Anotado para limpiar en un pase futuro o
al mergear.

### 9.5. El `select` del listado nunca se amplió

La Rev. 3 del spec mostraba `medio_pago: true, cuenta_origen_id: true,
comprobantes: {...}` en el `select` de `listarCuentasPorPagar`. **No se
implementó** (decisión §5.9). El spec (Rev. 4) sacó esas líneas y dejó la nota.

---

## 10. Referencias cruzadas

| Recurso | Dónde |
|---|---|
| Spec reconciliada | `docs/specs/spec_modulo_G.md` **Revisión 4** (2026-09-10) — anotaciones `— implementado (2026-09-10)` en §2.4, §3.7, §4.1, §4.2, §5, §6, §8 |
| Doc de cierre de HU-G8 | `docs/modulos/modulo G/HU8_MODULO_G.md` (§8.4 marcaba HU-G10 como bloqueada — ver §6.1 acá) |
| Doc de HU-H9 | `docs/modulos/modulo H/HU9_MODULO_H.md` (§1.4 — "Asociación a `CuentaPorPagar` … HU-G10, Módulo G") |
| **PR1** — contrato backend | **PR #131**, mergeado a `develop` en `043732d`. Rama `feature/HU-G10-pago-backend` (base `develop`). Commits `dddbbce`, `ed3a13f`, `66e650d` + merge `4c129cd` de `origin/develop` (PR #130) |
| **PR2a** — consola solo lectura | **PR #132**, mergeado a `develop` en `5ab92d7`. Rama `feature/HU-G10-pago-ui-lista` (base `feature/HU-G10-pago-backend`). Commits `4623b41`, `9a69a0e` |
| **PR2b** — form + actions + modal | **PR #133**, mergeado a `develop` en `3c22773` (HEAD de `develop`). Rama `feature/HU-G10-pago-ui-form` (base `feature/HU-G10-pago-ui-lista`). Commits `cc111bb`, `e5d48c6`, `a092282` (fix Bug 1), `4b3f15b` (fix Bug 2) |
| **PR #130** (de un compañero) | `origin/develop` d0e5358 → 7df38f9. `fix(seed): proveedores:leer` para Auditor + refactor de diálogos de `AccionesProveedorMenu`. Merge limpio, cero solapamiento (§6.3) |
| Fase 11 — script | `fase11-hu-g10-reverificacion.sh`. Corrida **pre-merge** y **post-merge** de `origin/develop`, resultado idéntico: **PASS 27 / FAIL 0**, `verificar-cadena → integra: true` (baseline 3 registros, final 10), `audit_logs` delta **+7** |
| Walkthrough de browser | 11 pasos (login, sidebar, listado, form, modal, casos 422 inline, gating de permisos) + 2 adiciones (rechazo real del servidor sin sesión/sin permiso → 401/403; diagnóstico instrumentado del "freeze" → artefacto de CDP, no de la app) |
