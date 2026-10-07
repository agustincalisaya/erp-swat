# HU-G11 — Registro automático de ingresos por cobros online en Tesorería (Módulo G)

Contrato: `docs/specs/spec_modulo_G.md` — §2.6 (HU-G11: contrato del ingreso y la consulta), §4 (eventos), §5/§7 (permisos y pendientes); `docs/specs/spec_modulo_E.md` — §2.13 (contra-asiento del reintegro de E13); `docs/specs/hu-f1-divergencias-evento.md` (divergencia de evento, resuelta por esta HU). Referencia operativa: `prompt_HU-G11.md`. Este documento resume las decisiones, la evidencia y los hallazgos del desarrollo. Los artefactos SDD viven en Engram (`sdd/hu-g11-ingreso-tesoreria/*`).

**Módulo:** G — Gestión de Caja y Tesorería · **Responsable:** Ramiro V. Castagnaro (Rama) · **Sprint / estimación:** Sprint 4 · 5 SP
**Estado:** Implementada y verificada (backend). **15/15 CA aprobados**; veredicto `pass_with_warnings` (0 blockers). La **divergencia de evento F-vs-G quedó RESUELTA** consumiendo el evento real.
**Commits:** `ef90076` → `690872f` (9 commits, 14 archivos, +1241/−17) sobre la rama `HU-G11` (base `origin/develop` `d4bdfcc`).

## 1. Historia de usuario y qué hace

**Como** Tesorero Central, **necesito** que cada cobro online confirmado (Mercado Pago) quede registrado automáticamente como un ingreso en Tesorería —y poder consultarlos y reprocesarlos manualmente— **para** conciliar la caja virtual del canal web sin intervención manual ni doble imputación.

La HU **proyecta** cada pago web confirmado a `IngresoTesoreria` mediante un listener reactivo (patrón ya usado por `cuenta-por-pagar.listener.ts`), y modela el reintegro de E13 como un `ContraAsientoIngreso` inmutable.

| Capacidad | Dónde | Resultado |
|---|---|---|
| Listener | `src/lib/events/listeners/ingreso-tesoreria.listener.ts` | Consume `ecommerce:pedido_pago_confirmado`; guard de registro único; IIFE async con `try/catch` que loguea y **nunca relanza**; emite `tesoreria:ingreso_web_registrado` **post-COMMIT** solo si se creó la fila. |
| Ingreso | `registrarIngresoWeb(payload)` (`ingreso-tesoreria.service.ts`) | Crea `IngresoTesoreria` con `estado="PENDIENTE_CONCILIACION"`, `caja_virtual="MERCADO_PAGO_CANAL_WEB"`; **sin turno de caja**; idempotencia por doble `@unique`. |
| Contra-asiento | `registrarContraAsiento(payload)` | Reintegro de **HU-E13**: un `ContraAsientoIngreso` por pedido (`pedido_venta_id @unique`), ligado al ingreso original; nunca lo edita ni lo elimina. |
| Consulta | `listarIngresosWeb(filtros)` + `GET /api/tesoreria/ingresos-web` | Paginado con filtros `estado` y rango de fechas; shape `{ registros, total, page, page_size }`. |
| Reproceso | `reprocesarIngresoWeb(pedidoVentaId)` + `POST /api/tesoreria/ingresos-web/reprocesar` | Recuperación manual idempotente desde el `PedidoVentaEcommerce` ya confirmado (no hay cola de reintentos en el proyecto). |

## 2. Criterios de aceptación (15) — estado y evidencia

Evidencia: `npm test` (763/763, exit 0), `npm run lint` (0 errores / 4 warnings preexistentes), `npm run build` (OK), `npx prisma db seed` (OK) + inspección de código y consulta de solo lectura a la BD. Reporte completo: Engram `sdd/hu-g11-ingreso-tesoreria/verify-report` (#219).

| CA | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Al confirmarse un pago web, el listener crea **una** fila `IngresoTesoreria` con `PENDIENTE_CONCILIACION` + `MERCADO_PAGO_CANAL_WEB` | Aprobado | `registrarIngresoWeb` + listener; test unitario |
| 2 | Los cobros web **no** se imputan a ningún `TurnoCaja` | Aprobado | `IngresoTesoreria` no tiene relación con turnos (schema) |
| 3 | Idempotencia: repetir el mismo `mercadopago_payment_id` o `pedido_venta_id` → no-op | Aprobado | Doble `@unique` + pre-check + captura `P2002` → `null`; test unitario (ambas claves) |
| 4 | Una falla del listener **no revierte** la venta; logueada y recuperable por reproceso | Aprobado | `catch` que loguea y no relanza; `POST …/reprocesar` |
| 5 | El reproceso manual es idempotente y usa el `PedidoVentaEcommerce` confirmado | Aprobado | `reprocesarIngresoWeb`; no-op si ya existe / no confirmado |
| 6 | `GET /api/tesoreria/ingresos-web` filtra por estado + fechas y pagina | Aprobado | `FiltrosIngresosWebSchema` + `listarIngresosWeb`; shape del spec |
| 7 | Un reintegro de E13 crea **un** `ContraAsientoIngreso`; nunca edita/elimina el ingreso; repetir = no-op | Aprobado (unitario) | `registrarContraAsiento`; `pedido_venta_id @unique` + `P2002`. Ver W2: sin caller hasta E13 |
| 8 | Los 2 eventos están tipados y sus handlers **agregados** en `audit-log.listener.ts`; existentes intactos | Aprobado | 3 loci en `event-types.ts`; 2 handlers add-only |
| 9 | El listener se auto-registra desde `domain-event-bus.ts` una única vez | Aprobado | 5.º import dinámico + `listenersRegistrados`; guard `registrado` |
| 10 | Ambos endpoints usan `withPermission("tesoreria:leer_ingresos_web")` + Zod + `{ data, error }` | Aprobado | Rutas thin wrappers |
| 11 | Prohibido `prisma.*.delete()` | Aprobado | Entidades inmutables; sin `delete`/`deleteMany` |
| 12 | No se implementa la transición a `CONCILIADO` ni cola de reintentos | Aprobado | Fuera de alcance (HU-G2) |
| 13 | Se consume `ecommerce:pedido_pago_confirmado` y la desviación queda documentada/resuelta | Aprobado | Docstring del listener + `docs/specs/hu-f1-divergencias-evento.md` |
| 14 | `npm test`, `npm run lint`, `npm run build` pasan | Aprobado | 763/763 · 0 errores · build OK |
| 15 | Sin cambios en `prisma/schema.prisma` ni migraciones; `ecommerce/*` y `cuenta-por-pagar.*` intactos | Aprobado | `git diff --stat` no toca schema/migraciones ni esas zonas |

## 3. Decisiones de producto y técnicas

| # | Decisión | Opción elegida | Motivo |
|---|---|---|---|
| D1 | Evento consumido | **`ecommerce:pedido_pago_confirmado`** (el evento real de HU-E2) | El evento que nombra spec G §2.6 (`ecommerce:transaccion_pago_registrada`) **no existe** (es de HU-E6, sin implementar); esperarlo bloquearía la HU. Decisión ya tomada en el prompt |
| D2 | Emisión del evento de seguimiento | **Post-COMMIT**: el service retorna el payload; el **listener** emite | Patrón del proyecto (`cuenta-por-pagar.listener.ts`); nunca dentro de `$transaction` |
| D3 | Idempotencia | Doble `@unique` (`pedido_venta_id`, `mercadopago_payment_id`) + **pre-check en la transacción + captura `P2002`** | Race-safe ante dos entregas concurrentes del webhook |
| D4 | `fecha` del ingreso | `payload.fecha_aprobacion` (alta); en reproceso `PedidoVentaEcommerce.fecha_pago_confirmado ?? created_at` | `PedidoVentaEcommerce` **no** tiene `monto`/`fecha_aprobacion`; no se inventan columnas |
| D5 | `monto` en reproceso | `PedidoVenta.total` | Misma fuente que el evento real (`PedidoVenta.total` neto de cupón) |
| D6 | `estado` / `caja_virtual` | `String` con `"PENDIENTE_CONCILIACION"` y constante `"MERCADO_PAGO_CANAL_WEB"` | El schema lo modela así; **no** hay enum ni catálogo (spec §2.6) |
| D7 | Alcance del permiso | `tesoreria:leer_ingresos_web` → **TESORERO_CENTRAL + ADMINISTRADOR + AUDITOR** (decisión del usuario) | Suma roles al seed compartido (`prisma/seed.ts`), autorizado por el usuario |

## 4. Modelo de datos, migración y seed

**Sin migración.** Los modelos ya existían; no se tocó `prisma/schema.prisma` ni `prisma/migrations/`.

| Modelo (tabla) | Uso en HU-G11 |
|---|---|
| `IngresoTesoreria` (`ingresos_tesoreria`) | `pedido_venta_id @unique`, `mercadopago_payment_id @unique`, `monto Decimal(12,2)`, `fecha`, `estado` (String, `PENDIENTE_CONCILIACION`/`CONCILIADO`), `caja_virtual` (String, constante), relación `pedido_venta` (Restrict), `contra_asientos[]`. **Sin soft delete** (nunca se elimina). |
| `ContraAsientoIngreso` (`contra_asientos_ingreso`) | `ingreso_original_id`, `pedido_venta_id @unique`, `monto`, `motivo`; asiento inmutable, sin soft delete. |

**Seed (modificado — decisión del usuario):** se sumaron ADMINISTRADOR y AUDITOR a `tesoreria:leer_ingresos_web` en el loop de asignación de roles (`prisma/seed.ts`), quedando `TESORERO_CENTRAL + ADMINISTRADOR + AUDITOR`. Verificado con `npx prisma db seed` + consulta de solo lectura.

## 5. Contrato de endpoints

Rutas thin wrappers: `withPermission("tesoreria:leer_ingresos_web")` + Zod (`safeParse` → 400 `VALIDATION_ERROR` con `fieldErrors`) + service + envelope `{ data, error }`. **Ninguna regla de negocio vive en el handler.**

| Método | Ruta (`src/app/api/tesoreria/ingresos-web/…`) | Respuestas |
|---|---|---|
| GET | `route.ts` | 200 `{ registros[], total, page, page_size }` · 400 `VALIDATION_ERROR` · 401 · 403 · 500 `INTERNAL_ERROR` |
| POST | `reprocesar/route.ts` | 200 `{ data: payload \| null, error: null }` (idempotente) · 400 · 401 · 403 · 500 |

**Schemas** (`src/lib/schemas/ingresos-web.schema.ts`): `ReprocesarIngresoWebSchema { pedido_venta_id: uuid }`, `FiltrosIngresosWebSchema { estado?, fecha_desde?, fecha_hasta?, page, page_size }`.

### 5.1. Reglas del service

- **`registrarIngresoWeb`**: `$transaction`; pre-check de `pedido_venta_id` **o** `mercadopago_payment_id` existente → `null`; `create` con los defaults; captura `P2002` → `null`. Retorna el payload del evento o `null`.
- **`registrarContraAsiento`**: resuelve `ingreso_original_id` por `pedido_venta_id`; `create`; `P2002` → no-op. Nunca edita/elimina el ingreso.
- **`listarIngresosWeb`**: `count` + `findMany` con filtros; montos serializados `.toFixed(2)`.
- **`reprocesarIngresoWeb`**: reconstruye el payload desde el `PedidoVentaEcommerce` confirmado + su `PedidoVenta`; no-op si no está confirmado o ya existe.
- **Sin eventos propios fuera del bus**; sin escritura directa de `AuditLog`.

## 6. Eventos de dominio

**Consume:** `ecommerce:pedido_pago_confirmado` (HU-E2) — el evento **real**; el de spec G §2.6 no existe.

**Emite (nuevos, tipados en los 3 loci de `event-types.ts` + `TIPOS_EVENTO_DOMINIO`):**
- `tesoreria:ingreso_web_registrado` — `{ ingreso_id, pedido_venta_id, mercadopago_payment_id, monto, fecha, estado, caja_virtual }` (sin datos sensibles).
- `tesoreria:contra_asiento_ingreso_registrado` — `{ contra_asiento_id, ingreso_original_id, pedido_venta_id, monto, motivo }`.

**Auditoría:** 2 handlers **agregados** (nunca modificados los existentes) en `audit-log.listener.ts` → `tabla_afectada` `"ingresos_tesoreria"` / `"contra_asientos_ingreso"`, `accion: "CREATE"`, `ip: "internal-event"`.

**Auto-registro:** 5.º import dinámico en `domain-event-bus.ts` (tras `audit-log`, `cuenta-por-pagar`, `notificacion`, `anulacion-orden`) + entrada en `listenersRegistrados`.

## 7. Hallazgos

| # | Sev. | Hallazgo | Tratamiento |
|---|---|---|---|
| H1 | — | El evento que manda consumir spec G §2.6 (`ecommerce:transaccion_pago_registrada`) **no existe**; el real es `ecommerce:pedido_pago_confirmado`. | **RESUELTO**: se consume el real y se corrige `docs/specs/hu-f1-divergencias-evento.md` (WU8). |
| H2 | — | `spec_modulo_G.md` §5 tiene una **nota obsoleta** ("requiere migración nueva") que contradice el estado real (los modelos ya existían). | Documentado; no se tocó el schema. Deuda de doc del spec. |
| H3 | Baja | `PedidoVentaEcommerce` **no** tiene `monto`/`fecha_aprobacion`. | El reproceso usa `PedidoVenta.total` y `fecha_pago_confirmado ?? created_at` (D4/D5), sin inventar columnas. |
| H4 | Media (deuda) | `registrarContraAsiento` **no tiene caller** y `tesoreria:contra_asiento_ingreso_registrado` **nunca se emite** hasta que HU-E13 lo cablee (`ecommerce:pedido_cancelado` no está tipado). | Dependencia externa, **no** un defecto de G11. CA7 cubierto por unitarias hoy. |
| H5 | Baja | El reproceso responde `200 {data|null}` mientras spec G §2.6 muestra `201 {…, reprocesado:true}`. | Suggestion de verify; a reconciliar (impl o spec). |
| H6 | Baja | Falta un test de **integración DB** del reproceso/`P2002` real (las unitarias usan un fixture aislado). | Warning W1; recomendado un `test:integration:g11`. |

## 8. Verificación funcional

Reporte: Engram `sdd/hu-g11-ingreso-tesoreria/verify-report` (#219), admitido por `gentle-ai sdd-verify-validate` (`valid: true`).

| Corrida | Resultado |
|---|---|
| `npm test` | **763/763** (exit 0) — 22 nuevas |
| `npm run lint` | **0 errores** / 4 warnings preexistentes, exit 0 |
| `npm run build` | **OK** (ambas rutas emitidas) |
| `npx prisma db seed` | **OK** |
| RolPermiso (solo lectura) | `ADMINISTRADOR`, `AUDITOR`, `TESORERO_CENTRAL` |

**Veredicto:** `pass_with_warnings` — 15/15 CA, 9/9 requisitos, 15/15 escenarios, **0 blockers**.

## 9. Cómo correr las pruebas

```bash
# Prerrequisitos (.env): DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY_PROVEEDORES
npx prisma migrate status   # debe decir "up to date"
npx prisma db seed          # idempotente; asigna los roles del permiso
npm test                    # unitarias (incluye los 3 *.test.ts nuevos)
npm run lint
npm run build
```

> `npm test` enumera los archivos **explícitamente** en `package.json` (sin glob). Los 3 `*.test.ts` nuevos ya están enumerados.

## 10. Fuera de alcance y deuda

- **Transición `PENDIENTE_CONCILIACION → CONCILIADO`**: HU-G2 (conciliación contra la liquidación real de MP).
- **Catálogo de cajas virtuales**: no existe; `caja_virtual` es constante de código.
- **Cola de reintentos / job en background**: no hay; el reproceso es manual.
- **Cableado del contra-asiento**: lo hace HU-E13 (no hay `ecommerce:pedido_cancelado` tipado aún).
- **W1/W2/H5**: test de integración DB del reproceso; reconciliar el shape de respuesta del reproceso; corregir la nota obsoleta de spec G §5.

## 11. Lecciones de proceso

1. **La decisión de contrato se tomó ANTES de codear.** El prompt ya resolvió consumir el evento real; evitó bloquearse esperando `ecommerce:transaccion_pago_registrada` (HU-E6).
2. **El patrón de referencia pagó.** `cuenta-por-pagar.listener.ts` (guard + IIFE + catch que no relanza + emisión post-COMMIT) se imitó sin desviaciones.
3. **Un evento nuevo toca 3 lugares en `event-types.ts`.** La guarda `_registroCompleto` rompe el typecheck si falta la entrada en `TIPOS_EVENTO_DOMINIO` — buena red de seguridad.
4. **Idempotencia race-safe, no solo pre-check.** El doble `@unique` + captura de `P2002` cubre la carrera de dos webhooks concurrentes.
5. **Verificar el modelo antes de asumir columnas.** `PedidoVentaEcommerce` no tiene `monto`/`fecha_aprobacion`; el reproceso se resolvió sin inventar schema.

## 12. Archivos de la implementación

Rama `HU-G11` (base `origin/develop` `d4bdfcc`), commits `ef90076` → `690872f`. 14 archivos, +1241/−17.

**Nuevos**
- `src/lib/events/listeners/ingreso-tesoreria.listener.ts` (+ `.test.ts`)
- `src/lib/services/tesoreria/ingreso-tesoreria.service.ts` (+ `.test.ts`)
- `src/lib/schemas/ingresos-web.schema.ts` (+ `.test.ts`)
- `src/app/api/tesoreria/ingresos-web/route.ts`
- `src/app/api/tesoreria/ingresos-web/reprocesar/route.ts`

**Modificados**
- `src/lib/events/event-types.ts`: 2 payloads + `DomainEventMap` + `TIPOS_EVENTO_DOMINIO`
- `src/lib/events/domain-event-bus.ts`: 5.º import dinámico + `listenersRegistrados`
- `src/lib/events/listeners/audit-log.listener.ts`: 2 handlers (add-only)
- `prisma/seed.ts`: `tesoreria:leer_ingresos_web` → +ADMINISTRADOR +AUDITOR
- `docs/specs/hu-f1-divergencias-evento.md`: divergencia RESUELTA
- `package.json`: enumeración de los `*.test.ts` nuevos

**No se tocan:** `prisma/schema.prisma`, migraciones, `src/lib/services/ecommerce/**`, `src/lib/services/tesoreria/cuenta-por-pagar.*`. Ningún `DELETE`/`deleteMany`; sin dependencias nuevas.

**Documentación de cierre:** este documento (`docs/modulos/modulo G/HU11_MODULO_G.md`) y `docs/specs/hu-f1-divergencias-evento.md`.
