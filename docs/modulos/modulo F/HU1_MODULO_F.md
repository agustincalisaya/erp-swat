# HU-F1 — Conector de Mercado Pago: ABM del Conector, health-check, bitácora, baja y reembolso (Módulo F)

Contrato: `docs/specs/spec_modulo_F.md` Rev. 1 — §2.1.1–§2.1.5 (rutas y comportamiento), §2.1.4 (bitácora operativa), §3.1 (patrón Adapter obligatorio), §4 (eventos de dominio) y §4.1 (exclusión de datos sensibles en payloads); `RULES.md` (Regla N.° 1 baja lógica, N.° 2 trazabilidad, N.° 3 aislamiento de dominio). Referencia operativa: `prompt_HU-F1.md`. Este documento resume las decisiones, la evidencia y los hallazgos del desarrollo. Los artefactos SDD viven en Engram (`sdd/hu-f1-conector-mercadopago/*`).

**Módulo:** F — Arquitectura Tecnológica y Conectividad · **Responsable:** Ramiro V. Castagnaro (Rama) · **Sprint / estimación:** Sprint 4 · 3 SP
**Estado:** Implementada y verificada (backend + UI). **15/15 CA aprobados**; veredicto `pass_with_warnings` (0 blockers, 0 critical). Quedan **dos divergencias de contrato entre grupos reportadas y NO resueltas** (ver §7).
**Commits:** `397183c` → `c83b61d` (8 commits, 17 archivos, +1676/−22) sobre la rama `HU-F1` (base `develop`).

## 1. Historia de usuario y qué hace

**Como** Administrador de Plataforma (con el permiso `integraciones:administrar_conector`), **necesito** dar de alta, verificar, auditar operativamente y dar de baja el Conector de Mercado Pago —y que el dominio pueda solicitar reembolsos— **para** operar la única pasarela de pago del sistema con credenciales cifradas y trazabilidad, sin que ningún módulo de negocio toque la API de Mercado Pago.

Esta HU **completa** una implementación parcial del Sprint 3/4 (HU-E2 dejó el Adapter, el Conector, la firma, el simulador y el webhook marcados `// PROVISORIO HU-E2 — completar en HU-F1`). **No se reescribió** ninguna pieza base.

| Capacidad | Dónde | Resultado |
|---|---|---|
| Reembolso | `solicitarReembolso(paymentId, monto?)` (`adapter.ts`) | `POST /v1/payments/{id}/refunds`; `monto` omitido ⇒ total, presente ⇒ parcial. Devuelve `ReembolsoSolicitado`. Lo consume **HU-E13**. |
| Health-check | `healthCheck({ accessToken })` (`adapter.ts`) + `ejecutarHealthCheck()` (service) | `GET /v1/payment_methods` de bajo costo a través del Adapter; activa el Conector con la regla de dos pasos en PRODUCCION. |
| Alta del Conector | `POST /api/integraciones/mercadopago/conectores` · `crearConectorMercadoPago()` | Cifra los 3 campos sensibles con AES-256 antes de persistir; nace `INACTIVO`; un único `ACTIVO` por entorno (409); respuesta enmascarada. |
| Bitácora | `GET …/[id]/bitacora` | Paginado sobre `InvocacionConectorPago` (orden `created_at desc`), sin datos sensibles. |
| Baja | `PATCH …/[id]/baja` | Baja lógica con motivo obligatorio; deja `is_active=false` **y** `estado=INACTIVO` en la misma operación. |
| Panel | `(dashboard)/administracion/integraciones` | Lista de conectores, alta (5 campos), health-check, bitácora paginada y baja; credenciales siempre enmascaradas. |

## 2. Criterios de aceptación (15) — estado y evidencia

Evidencia: `npm test` (741/741, exit 0), `npm run lint` (0 errores / 4 warnings preexistentes, exit 0), `npm run build` (OK), más inspección de código y una sonda de BD de solo lectura. Reporte completo: Engram `sdd/hu-f1-conector-mercadopago/verify-report` (#207).

| CA | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | `adapter.ts` exporta `solicitarReembolso`; `OperacionConector` incluye `SOLICITAR_REEMBOLSO`; tipo en `tipos.ts`; funciona con `MP_MODO=simulado` | Aprobado | `adapter.reembolso.test.ts` (12) — rama simulada determinística; `conector.ts` union actualizado |
| 2 | Alta con `estado=INACTIVO`, cifra los 3 campos con AES-256, nunca devuelve texto plano (enmascarado) | Aprobado | `conector-pago.service.test.ts` (12): `encrypt` antes de `create`, `enmascararCredencial`; respuesta `APP_USR-••••••••3f2a` |
| 3 | Segundo Conector `ACTIVO` en el mismo entorno → 409 | Aprobado — **modificado por P-R5** | Originalmente en el alta. Desde el 2026-10-08 (P-R5, acordado con Rama, `docs/tasks/HU-E2-integracion.md` §9) el alta **no** controla la unicidad (pueden coexistir varios `INACTIVO`); el 409 `CONECTOR_ACTIVO_EXISTENTE` sale del **health-check** si hay OTRO `ACTIVO` en el entorno: antes de llamar a MP y otra vez al activar, en una transacción con lock por entorno |
| 4 | Health-check válido → `ACTIVO` + `ultimo_health_check_exitoso_at`; inválido → mantiene estado + 422 `HEALTH_CHECK_FALLIDO` | Aprobado | `ejecutarHealthCheck()`; rama fallida registra la invocación y no cambia el estado |
| 5 | PRODUCCION no queda `ACTIVO` sin health-check exitoso → 422 `HEALTH_CHECK_REQUERIDO` | Aprobado | Regla de **dos pasos** (ratificada por el PO): 1.er éxito registra `ultimo_health_check_exitoso_at` y responde 422; 2.º éxito activa |
| 6 | `GET …/[id]/bitacora` → `items` + `paginacion` (page/page_size, máx. 50), sin datos sensibles | Aprobado | `listarBitacora()` con `count`+`findMany`; `BitacoraQuerySchema` |
| 7 | `PATCH …/[id]/baja` exige `deletion_reason`; `is_active=false` **y** `estado=INACTIVO`; bitácora histórica intacta | Aprobado | `darDeBajaConector()` en `$transaction`; sin `delete()` |
| 8 | Las 4 rutas usan `withPermission` + Zod + `{ data, error }`; códigos mapeados | Aprobado | `STATUS_POR_CODIGO`; `VALIDATION_ERROR` con `fieldErrors` |
| 9 | Texto plano de `access_token`/`public_key`/`webhook_secret` no aparece en logs, payloads ni respuestas | Aprobado | Máscara en el service; nunca se loguea el valor en claro |
| 10 | El service **no** hace `fetch` directo a MP (todo por el Adapter); sin SDK `mercadopago` | Aprobado | Regla ESLint `no-restricted-imports` + revisión de imports |
| 11 | Prohibido `prisma.*.delete()` | Aprobado | Baja lógica; sin `delete`/`deleteMany` en el código nuevo |
| 12 | La bitácora registra también `SOLICITAR_REEMBOLSO` y `HEALTH_CHECK` | Aprobado (con warning) | Las rutas reales registran vía `llamarMercadoPago` → `registrarInvocacion`; ver W1 en §8 |
| 13 | Inconsistencia de evento F-vs-G reportada y documentada, no resuelta unilateralmente | Aprobado | `docs/specs/hu-f1-divergencias-evento.md`; webhook intacto |
| 14 | `npm test`, `npm run lint`, `npm run build` pasan | Aprobado | 741/741 · 0 errores · build OK |
| 15 | Sin cambios en `prisma/schema.prisma` ni migraciones; `ecommerce/*` intacto; `firma.test.ts` verde | Aprobado | `git diff --stat` no toca schema/migraciones; `firma.test.ts` sigue verde |

## 3. Decisiones de producto y técnicas

| # | Decisión | Opción elegida | Motivo |
|---|---|---|---|
| D1 | Contrato de `solicitarReembolso` | `(paymentId: string, monto?: number) => Promise<ReembolsoSolicitado>`; `monto` omitido = total, presente = parcial (`{ amount }`). `ReembolsoSolicitado { refund_id, payment_id, monto, estado }`; `EstadoReembolsoDominio = APROBADO\|PENDIENTE\|RECHAZADO` | Es el contrato rígido que consume **HU-E13**; inmutable |
| D2 | Evento del pago confirmado | **NO resuelto** (ver §7) | Contrato entre grupos (F §2.1.3 vs G §2.6) |
| D3 | Dónde vive el health-check | En el **Adapter** (`adapter.healthCheck()`), no en el service | §2.1.4 lo lista entre las operaciones del Adapter y §3.1 prohíbe que el service conozca la API de MP; el service solo persiste el estado |
| P1 | Regla de PRODUCCION | **Dos pasos**: 1.er health-check exitoso sobre un PRODUCCION registra `ultimo_health_check_exitoso_at` pero responde `422 HEALTH_CHECK_REQUERIDO`; el 2.º éxito activa (`ACTIVO`). SANDBOX activa al primer éxito | Ratificado por el PO: hace testeable el 422 de CA5 y garantiza que nunca quede `ACTIVO` sin un check previo registrado |
| P2 | Credenciales del conector a verificar | `obtenerConectorPorId(id)` (descifra por id) + `ctx` opcional en `llamarMercadoPago` | El health-check puede correr sobre un Conector `INACTIVO`; `obtenerConectorActivo()` solo devuelve el `ACTIVO` |
| P3 | Enmascarado | `enmascararCredencial(v)` en el service → `APP_USR-••••••••3f2a` | El valor en claro nunca sale del service |
| P4 | 404 en el reembolso | Se extendió `llamarMercadoPago` para mapear `404 → PAGO_NO_ENCONTRADO` en `CONSULTAR_PAGO` **y** `SOLICITAR_REEMBOLSO` | Un reembolso sobre un pago inexistente es exactamente `PAGO_NO_ENCONTRADO` |
| P5 | Ramas simuladas | Viven en `adapter.ts` (determinísticas); **no** se toca `simulador.ts` | El simulador solo cubre `consultarPago`; es base protegida de HU-E2 |
| P6 | Lista de conectores en la UI | `listarConectores()` en el service (DTO enmascarado) + lectura directa desde el Server Component `page.tsx` | R4.6 exige lista; no se agrega una 5.ª ruta pública (contrato de 4 rutas) |
| P7 | Unicidad de Conector activo | Validada en el service, dentro de `prisma.$transaction` (no hay `@@unique([entorno])`) | Puede haber varios `INACTIVO` históricos; la unicidad es de negocio |

## 4. Modelo de datos, migración y seed

**Sin migración.** El schema ya tenía todo; no se tocó `prisma/schema.prisma` ni `prisma/migrations/`.

| Modelo (tabla) | Uso en HU-F1 |
|---|---|
| `ConectorPago` (`conectores_pago`) | `access_token_cifrado/_iv`, `public_key_cifrada/_iv`, `webhook_secret_cifrado/_iv` (AES-256-GCM), `estado` (nace `INACTIVO`), `ultimo_health_check_exitoso_at`, baja lógica (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`), `@@index([entorno, estado, is_active])` |
| `InvocacionConectorPago` (`invocaciones_conector_pago`) | Bitácora operativa append-only: `operacion` (`String`), `exitosa`, `detalle_error`, `created_at`; `onDelete: Restrict` |
| `WebhookPagoLog` (`log_webhooks_pago`) | Traza del webhook (HU-E2); **no modificado** por F1 |

**Seed:** no se modificó. Ya siembra `conector_pago_sandbox` con credenciales **ficticias** cifradas (solo si `ENCRYPTION_KEY_PROVEEDORES` está definida) + 3 `InvocacionConectorPago`, y el permiso `integraciones:administrar_conector` (MODULO_F).

## 5. Contrato de endpoints

Todas las rutas son wrappers finos: `withPermission("integraciones:administrar_conector")` + Zod (`safeParse` → 400 `VALIDATION_ERROR` con `fieldErrors`) + service + envelope `{ data, error }`. En Next 16 el `params` es `Promise`. **Ninguna ruta implementa reglas de negocio.**

### 5.1. Rutas (`src/app/api/integraciones/mercadopago/conectores/…`)

| Método | Ruta | Respuestas |
|---|---|---|
| POST | `route.ts` | 201 `{ conector_id, nombre, entorno, estado, access_token_enmascarado, public_key_enmascarada }` · 400 · 401 · 403 · 409 `CONECTOR_ACTIVO_EXISTENTE` · 500 |
| POST | `[id]/health-check/route.ts` | 200 `{ conector_id, estado, verificado_at }` · 401 · 403 · 404 `CONECTOR_NO_ENCONTRADO` · 422 `HEALTH_CHECK_FALLIDO` / `HEALTH_CHECK_REQUERIDO` · 500 |
| GET | `[id]/bitacora/route.ts` | 200 `{ items[], paginacion: { total, pagina_actual, total_paginas, por_pagina } }` · 400 · 401 · 403 · 500 |
| PATCH | `[id]/baja/route.ts` | 200 `{ conector_id, is_active: false, estado: "INACTIVO" }` · 400 · 401 · 403 · 500 |

### 5.2. Server Action (`src/app/(dashboard)/administracion/integraciones/actions.ts`)

| Action | Equivale a |
|---|---|
| `crearConectorMercadoPago()` | `POST …/conectores` (sesión + permiso + Zod + service + `revalidatePath`) |

### 5.3. Reglas del service (`conector-pago.service.ts`)

- **`crearConector`**: `encrypt()` de los 3 campos → `{ciphertext, iv}`; en `$transaction`: si existe otro `ACTIVO` del mismo entorno ⇒ `409 CONECTOR_ACTIVO_EXISTENTE`; si no, `create` con `estado=INACTIVO`. Devuelve DTO enmascarado.
- **`ejecutarHealthCheck`**: carga por id (`obtenerConectorPorId`); `adapter.healthCheck({accessToken})`; fallo ⇒ `422 HEALTH_CHECK_FALLIDO` (estado intacto); éxito SANDBOX ⇒ `ACTIVO`; éxito PRODUCCION sin check previo ⇒ registra y `422 HEALTH_CHECK_REQUERIDO`; con check previo ⇒ `ACTIVO`.
- **`listarBitacora`**: `count`+`findMany` (`created_at desc`, `skip/take`) → `items` + `paginacion`.
- **`darDeBajaConector`**: `$transaction` `update({ is_active:false, deleted_at, deleted_by, deletion_reason, estado:"INACTIVO" })`; **nunca** `delete()`.
- **`listarConectores`**: lista enmascarada para la UI.
- **Sin eventos propios de auditoría** en esta HU (ver §7).

## 6. Eventos de dominio

**HU-F1 no emite eventos propios en este alcance.** La spec F §4 define `integracion:conector_creado`, `integracion:conector_estado_cambiado` e `integracion:invocacion_fallida` (consumidos por Módulo D), pero **`event-types.ts` es un archivo caliente/compartido ausente de la lista de archivos de la HU**, por lo que se **difirió** su declaración (ver §7). No se modificó el webhook ni ningún listener.

## 7. Hallazgos y divergencias (reportadas, no resueltas)

| # | Sev. | Hallazgo | Tratamiento |
|---|---|---|---|
| H1 | **Alta (contrato entre grupos)** | **Inconsistencia de evento:** `spec_modulo_F.md` §2.1.3 dice que el webhook despacha `pago:webhook_confirmado` a sus consumidores (E2 y **G11**); `spec_modulo_G.md` §2.6 dice que **G11 consume `ecommerce:transaccion_pago_registrada`** (de E2). El webhook actual procesa **síncronamente** (desviación documentada de HU-E2). | **NO resuelto unilateralmente.** Opción recomendada (b): mantener el flujo síncrono y que G11 consuma `ecommerce:transaccion_pago_registrada`. Cambiar a `pago:webhook_confirmado` toca Módulo E (ajeno) y requiere coordinar con Chiki (E2). Documentado en `docs/specs/hu-f1-divergencias-evento.md`. |
| H2 | Media (alcance) | **Eventos propios de F1 diferidos:** `integracion:conector_creado|estado_cambiado|invocacion_fallida` (spec F §4) requieren editar `event-types.ts` (caliente) + listener, ausentes de la lista de archivos de la HU. | Diferido y documentado; la auditoría forense de esas mutaciones queda como deuda (ver §10). |
| H3 | Media (desvío justificado) | **`eslint.config.mjs` modificado:** se agregó `src/lib/services/integraciones/**` a los `ignores` de la regla `no-restricted-imports` (consumo interno del Conector). | Necesario para que el service (HU-F1) consuma el Adapter sin romper lint (CA10). La restricción del SDK `mercadopago` **sigue aplicando** al service. Evaluado como correcto y mínimo por verify. |
| H4 | Baja | El apply introdujo un **mojibake** (`Usá` → `Usǭ`) al editar `eslint.config.mjs`. | Corregido en `c83b61d`; sin mojibake remanente en los archivos tocados. |
| H5 | Baja | `.next/dev/types/routes.d.ts` (caché generada, gitignored) estaba corrupta y rompía `tsc`/`next build`. | Eliminada y regenerada por el build. |
| H6 | Baja (dev-only) | Con `MP_MODO=simulado`, las ramas simuladas de reembolso/health-check cortan antes de `llamarMercadoPago`, así que esas invocaciones no se escriben en `InvocacionConectorPago` en dev. | Mismo patrón que las ramas simuladas preexistentes de HU-E2; las rutas reales (producción) sí registran. Ver W1 (§8). |
| H7 | Baja | La ruta de health-check no tiene body (solo path param), por lo que no usa Zod. | Desvío literal de la redacción de CA8, sin gap real de validación. Ver W2 (§8). |

## 8. Verificación funcional

Reporte: Engram `sdd/hu-f1-conector-mercadopago/verify-report` (#207), admitido por `gentle-ai sdd-verify-validate` (`valid: true`).

| Corrida | Resultado |
|---|---|
| `npm test` | **741/741** (exit 0) — +32 nuevos: adapter reembolso (12), schemas (8), service (12) |
| `npm run lint` | **0 errores** / 4 warnings **preexistentes** (ninguno en archivos nuevos), exit 0 |
| `npm run build` | **OK** — las 4 rutas nuevas + `/administracion/integraciones` presentes |
| Sonda de BD (solo lectura) | Las 3 credenciales del Conector sembrado se almacenan como **ciphertext hex + IV** (sin texto plano) |

**Warnings (no bloqueantes):**
- **W1** — gap de observabilidad dev-only (H6): en `MP_MODO=simulado` no se registran `HEALTH_CHECK`/`SOLICITAR_REEMBOLSO` en la bitácora.
- **W2** — la ruta de health-check no usa Zod (H7).

**Veredicto:** `pass_with_warnings` — 15/15 CA, 8/8 requisitos, 14/14 escenarios, **0 blockers**.

## 9. Cómo correr las pruebas

```bash
# Prerrequisitos (.env): DATABASE_URL, JWT_SECRET,
#   ENCRYPTION_KEY_PROVEEDORES (64 hex), MP_MODO=simulado, APP_PUBLIC_URL
npx prisma migrate status   # debe decir "up to date"
npm test                    # unitarios (incluye los 3 *.test.ts nuevos)
npm run lint
npm run build
```

> `npm test` enumera los archivos **explícitamente** en `package.json` (sin glob). Los `*.test.ts` nuevos ya están enumerados. El runner `node --experimental-strip-types --test` **no** carga `.env`, por eso los tests fijan `process.env.MP_MODO` cuando hace falta.

## 10. Fuera de alcance y deuda

- **Eventos propios de F1** (`integracion:*`, spec F §4): declarar en `event-types.ts` (con acuerdo del equipo) + handler en `audit-log.listener.ts` (solo agregar, no modificar los existentes).
- **Divergencia D2** (evento del pago confirmado): decisión de equipo pendiente (F vs G).
- **Transición `PENDIENTE_CONCILIACION → CONCILIADO`**: es de HU-G2, fuera de alcance.
- **Rotación de credenciales / cambio de entorno** de un Conector existente: no definidos en spec F §2.1 (solo alta, health-check, bitácora y baja).
- **HU-F5** (log técnico de auditoría forense del Conector): fuera de Sprint 4; la bitácora operativa de §2.1.4 no lo reemplaza.
- **W1/W2**: mejoras menores (registrar en la bitácora también en modo simulado; Zod en la ruta de health-check si se le agrega body).

## 11. Lecciones de proceso

1. **Relevar antes de escribir evitó reescribir la base.** CodeGraph + lectura directa confirmaron que Adapter/Conector/firma/simulador/webhook eran base aprobada; el alcance real era *completar* (reembolso + ABM), no rehacer.
2. **El health-check sobre un Conector INACTIVO necesita descifrar por id.** `obtenerConectorActivo()` solo devuelve el `ACTIVO`; hizo falta `obtenerConectorPorId(id)` — un hallazgo que no estaba explícito en la spec.
3. **El cifrado ya tenía precedente en la propia carpeta.** `lib/crypto/aes.ts` es la única capa AES-256-GCM; el Conector ya la usaba para `decrypt`. No se inventó nada: se usó `encrypt` en el alta.
4. **Una regla ESLint puede bloquear un diseño obligatorio.** La regla que restringía el consumo del Conector a e-commerce/webhook chocaba con CA10; se resolvió con una excepción mínima y documentada, sin aflojar la prohibición del SDK.
5. **Los tests del repo son source-regex para módulos `server-only`.** El runner no importa módulos con `@/`/`server-only`; se sigue el patrón del repo (`aes.test.ts`, `proveedor.service.test.ts`) y se afirma el comportamiento por contratos de fuente + Zod.
6. **Un mojibake al editar un archivo existente es un riesgo real.** PowerShell 5.1 / editores pueden corromper acentos; conviene verificar `git diff` de líneas no intencionales tras editar archivos con UTF-8.

## 12. Archivos de la implementación

Rama `HU-F1` (base `develop`), commits `397183c` → `c83b61d`. 17 archivos, +1676/−22.

**Nuevos**
- `src/lib/schemas/integraciones.schema.ts` (+ `.test.ts`)
- `src/lib/services/integraciones/conector-pago.service.ts` (+ `.test.ts`)
- `src/app/api/integraciones/mercadopago/conectores/route.ts`
- `src/app/api/integraciones/mercadopago/conectores/[id]/health-check/route.ts`
- `src/app/api/integraciones/mercadopago/conectores/[id]/bitacora/route.ts`
- `src/app/api/integraciones/mercadopago/conectores/[id]/baja/route.ts`
- `src/app/(dashboard)/administracion/integraciones/actions.ts`
- `src/app/(dashboard)/administracion/integraciones/page.tsx`
- `src/lib/integraciones/mercadopago/adapter.reembolso.test.ts`
- `docs/specs/hu-f1-divergencias-evento.md`

**Modificados**
- `src/lib/integraciones/mercadopago/tipos.ts`: `EstadoReembolsoDominio`, `ReembolsoSolicitado`
- `src/lib/integraciones/mercadopago/conector.ts`: `OperacionConector` += `SOLICITAR_REEMBOLSO` | `HEALTH_CHECK`; `obtenerConectorPorId()`
- `src/lib/integraciones/mercadopago/adapter.ts`: `solicitarReembolso()`, `healthCheck()`, `mapearEstadoReembolso()`, `ctx` opcional en `llamarMercadoPago`, 404→`PAGO_NO_ENCONTRADO` para reembolso, ramas simuladas
- `eslint.config.mjs`: excepción `src/lib/services/integraciones/**` en `no-restricted-imports`
- `package.json`: enumeración de los `*.test.ts` nuevos

**No se tocan:** `prisma/schema.prisma`, migraciones, `prisma/seed.ts`, `event-types.ts`, `audit-log.listener.ts`, `firma.ts`, `simulador.ts`, el webhook, `src/lib/services/ecommerce/**`. Ningún `DELETE`/`deleteMany`; sin dependencias nuevas (SDK `mercadopago` prohibido).

**Documentación de cierre:** este documento (`docs/modulos/modulo F/HU1_MODULO_F.md`) y `docs/specs/hu-f1-divergencias-evento.md`.
