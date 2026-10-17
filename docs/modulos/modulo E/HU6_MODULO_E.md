# HU-E6 — Log de auditoría de transacciones de pago online (Módulo E)

Contrato: `docs/specs/spec_modulo_E.md` — §2.6 (HU-E6: log, doble permiso, mecanismo de acceso), §4 (eventos), §5/§5.1 (fuera de alcance); `Documento de Alcance Funcional y Técnico` (Módulo E §5/§5.1); `Alineamientos HU - E12 - E6.md` §2 (hallazgo reportado); `schema.prisma`. Referencia operativa: `prompt_HU-E6.md`. Este documento resume las decisiones, la evidencia y los hallazgos del desarrollo. Los artefactos SDD viven en Engram (`sdd/hu-e6-auditoria-pagos/*`).

**Módulo:** E — E-commerce / Click & Collect · **Responsable:** Ramiro V. Castagnaro (Rama) · **Sprint / estimación:** Sprint 4 · 5 SP
**Estado:** Implementada y verificada (backend). **12/12 CA aprobados**; veredicto final `pass_with_warnings` (0 blockers). Requirió **una remediación acotada** tras un primer verify fallido (ver §7/§8).
**Commits:** `b0a2ef6` → `8269a12` (9 commits, ~18 archivos) sobre la rama `HU-E6` (base `origin/develop` `f3522c3`).

## 1. Historia de usuario y qué hace

**Como** Auditor (y, con acceso aprobado, Administrador E-commerce), **necesito** un registro forense inmutable de cada transacción de pago online —con el dato de facturación protegido y auditable— **para** responder reclamos y cumplir con la Ley N.° 25.326 sin exponer datos sensibles.

La HU tiene **dos mitades**: (a) la **escritura** del log operativo `TransaccionPagoLog` + el evento sensible, en el flujo de pago de HU-E2; y (b) la **lectura** forense con doble permiso + el mecanismo de solicitud de acceso.

| Capacidad | Dónde | Resultado |
|---|---|---|
| Escritura del log (R1) | `pago-web.service.ts` (`confirmarPago`/`rechazarPago`) | Inserta **una** fila `TransaccionPagoLog` **dentro** del `$transaction` de E2 (aprobado y rechazado), con facturación cifrada AES-256; emite `ecommerce:transaccion_pago_registrada` **post-COMMIT**. |
| Lectura forense (R2) | `GET /api/ecommerce/auditoria/pagos` + `auditoria-pagos.service.ts` | Auditor = acceso completo (`TransaccionPagoLog` + mitad `AuditLog` filtrada); Administrador E-commerce = solo con acceso aprobado y vigente, si no `403 ACCESO_LOG_PAGOS_NO_APROBADO`. Paginado, filtrable, solo lectura. |
| Acceso cifrado auditado (R3) | `GET …/pagos/[id]/facturacion` | Solo Auditor: descifra el dato de facturación y emite `ecommerce:acceso_dato_cifrado_auditado` **una vez por lectura**. |
| Solicitud de acceso (R4) | `POST …/solicitar-acceso` + `PATCH …/solicitar-acceso/[id]` | `AccesoLogPagos` registra solicitud (Administrador) y aprobación (Auditor), con **expiración** configurable. |

## 2. Criterios de aceptación (12) — estado y evidencia

Evidencia: `npm test` (794/794, exit 0), `npm run lint` (0 errores / 4 warnings preexistentes), `npm run build` (OK), migración aplicada + seed. Reporte completo: Engram `sdd/hu-e6-auditoria-pagos/verify-report` (#229).

| CA | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Cada transacción (aprobada/rechazada) inserta **una** fila `TransaccionPagoLog` con facturación cifrada AES-256 | Aprobado | Insert en ambos `$transaction`; `encrypt()` → `datos_facturacion_cifrados` + `_iv` |
| 2 | Post-COMMIT se emite `ecommerce:transaccion_pago_registrada` + handler agregado | Aprobado | `emitirEventoPostCommitSeguroE2`; handler add-only |
| 3 | `GET /api/ecommerce/auditoria/pagos` con Auditor → acceso completo, paginado y filtrable | Aprobado | `obtenerLogPagos` + mitad `AuditLog` filtrada (W1) |
| 4 | Administrador E-commerce sin acceso aprobado → `403 ACCESO_LOG_PAGOS_NO_APROBADO` | Aprobado | `resolverAccesoLogPagos` |
| 5 | Log de solo lectura; hash-chain es el de `AuditLog` (sin cadena propia) | Aprobado | Sin edición/borrado; sin cadena en `TransaccionPagoLog` |
| 6 | Toda lectura del dato cifrado por Auditor emite `ecommerce:acceso_dato_cifrado_auditado` (una vez) | Aprobado | `GET …/[id]/facturacion` → `obtenerFacturacionPago` → `decryptAndAuditBilling` |
| 7 | El texto plano de facturación nunca aparece en logs/respuestas/payloads | Aprobado | Solo se descifra en la respuesta al Auditor; nunca se loguea |
| 8 | Prohibido `prisma.*.delete()`; sin datos de tarjeta | Aprobado | Revisión; el sistema nunca recibe tarjeta |
| 9 | Decisión de aprobador + duración documentada | Aprobado | Auditor aprobador + expiración configurable (§7) |
| 10 | `npm test`, `npm run lint`, `npm run build` pasan | Aprobado | 794/794 · 0 errores · build OK |
| 11 | `pago-web.service.ts` modificado solo con autorización de Chiki; sin tocar otro módulo | Aprobado | Autorización (decisión 1b); `git diff` acotado |
| 12 | Sin cambio de `schema.prisma` salvo la migración aprobada de R4 | Aprobado | Solo `AccesoLogPagos` (aditiva) |

## 3. Decisiones de producto y técnicas

| # | Decisión | Opción elegida | Motivo |
|---|---|---|---|
| D1 | Quién modifica `pago-web.service.ts` (zona de Chiki/HU-E2) | **Chiki autoriza a Rama** (opción b) | Sin esto, R1 no se podía implementar |
| D2 | Aprobador y duración del acceso (R4) | **Auditor aprueba** + **expiración configurable** en `ConfiguracionSistema` (`ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS`, default 30) | El Alcance nombra al Auditor; la duración no estaba definida → parametrizada (no hardcode) |
| D3 | Encaje del cifrado | `encrypt()` → `datos_facturacion_cifrados` + `datos_facturacion_iv` | **La columna IV YA existía** (el prompt estaba desactualizado); sin migración |
| D4 | `verificar_integridad` (Backlog↔spec) | Se implementa `verificarIntegridadLogPagos()` module-owned; **no** se expone en el query schema | Reporta la divergencia, no la resuelve en silencio |
| D5 | Extender `TransaccionPagoLog` | **No** (sin `proveedor`; `resultado_webhook` sigue `String`) | MP es la única pasarela; evita migración innecesaria |
| D6 | R3 — superficie del acceso cifrado | Endpoint **solo Auditor** `GET …/[id]/facturacion` (remediación) | Hace alcanzable el control de auditoría (Ley 25.326) |
| D7 | R2 — mitad forense | `obtenerLogPagos()` devuelve `{ items, total, page, auditoria: { items, total } }` | Surfacea la mitad `AuditLog` filtrada (W1) sin romper el shape base |

## 4. Modelo de datos, migración y seed

**Migración:** `20261007021440_add_acceso_log_pagos` (**aditiva**: `CREATE TABLE` + índice + 2 FK RESTRICT; sin `ALTER`/`DROP`).

| Modelo (tabla) | Uso en HU-E6 |
|---|---|
| `TransaccionPagoLog` (`log_transacciones_pago`) | Detalle operativo por transacción: `pedido_venta_ecommerce_id`, `mercadopago_payment_id`, `monto`, `estado_pago`, `resultado_webhook`, `datos_facturacion_cifrados` + `datos_facturacion_iv`, `created_at`. Append-only, sin soft delete. |
| `AccesoLogPagos` (`accesos_log_pagos`) — **NUEVO** | Solicitud/aprobación del acceso: `solicitante_id`, `aprobado_por_id?`, `estado`, `motivo_solicitud?`, `motivo_rechazo?`, `solicitada_en`, `aprobada_en?`, `expira_en?`, `is_active`, `created_at`, `updated_at`; relaciones `onDelete: Restrict`. |
| `AuditLog` (`audit_logs`, Módulo D) | Cadena SHA-256 forense escrita por `audit-log.listener` (los 2 eventos de E6). |

**Seed:** se agregó la clave `ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS = 30` en `ConfiguracionSistema`. Los permisos `auditoria:leer_forense` y `ecommerce:solicitar_acceso_log_pagos` ya estaban sembrados.

## 5. Contrato de endpoints

Rutas thin wrappers: `withPermission` + Zod (`safeParse` → 400 `VALIDATION_ERROR` con `fieldErrors`) + service + `{ data, error }` + `STATUS_POR_CODIGO`. **Ninguna regla de negocio vive en el handler.** Next 16: `params` es `Promise`.

| Método | Ruta (`src/app/api/ecommerce/auditoria/pagos/…`) | Respuestas |
|---|---|---|
| GET | `route.ts` | 200 `{ items[], total, page, auditoria: { items[], total } }` · 400 · 401 · 403 `ACCESO_LOG_PAGOS_NO_APROBADO` · 500 |
| GET | `[id]/facturacion/route.ts` | 200 `{ transaccion_id, datos_facturacion }` · 401 · 403 `FORBIDDEN` · 404 `TRANSACCION_NO_ENCONTRADA` · 500 |
| POST | `solicitar-acceso/route.ts` | 200/201 solicitud creada · 400 · 401 · 403 · 500 |
| PATCH | `solicitar-acceso/[id]/route.ts` | 200 aprobación/rechazo (Auditor) · 400 · 401 · 403 · 404 · 500 |

**Schemas** (`src/lib/schemas/ecommerce.schema.ts`): `ListarLogPagosQuerySchema` (`page`, `page_size` máx 50, `estado_pago?`, `fecha_desde?`, `fecha_hasta?`), `SolicitarAccesoLogPagosSchema`, `AccesoLogPagosIdSchema`, `TransaccionPagoLogIdSchema`.

### 5.1. Reglas del service

- **`obtenerLogPagos`**: Auditor = acceso completo; Administrador E-commerce = solo con `AccesoLogPagos` aprobado y no expirado; devuelve la mitad operativa + la forense (proyección segura, sin `valor_anterior`/`valor_nuevo`).
- **`obtenerFacturacionPago` / `decryptAndAuditBilling`**: solo Auditor; descifra con `lib/crypto/aes.ts` y emite `ecommerce:acceso_dato_cifrado_auditado` una vez.
- **`verificarIntegridadLogPagos`**: función module-owned (patrón `verificarCadenaHashesVentas`), no expuesta.
- **`finDeDia`**: normaliza `fecha_hasta` a fin de día UTC.
- **Sin `delete()`**; sin escritura directa de `AuditLog` (solo el bus).

## 6. Eventos de dominio

**Emite (nuevos, tipados en los 3 loci de `event-types.ts`):**
- `ecommerce:transaccion_pago_registrada` — `{ transaccion_id, pedido_venta_id, monto, estado_pago, mercadopago_payment_id }` (sin datos sensibles), post-COMMIT.
- `ecommerce:acceso_dato_cifrado_auditado` — `{ transaccion_id, usuario_auditor_id, timestamp }`, al leer el campo cifrado.

**Auditoría:** 2 handlers **agregados** (nunca modificados los existentes) en `audit-log.listener.ts` → `tabla_afectada = "log_transacciones_pago"`, `ip: "internal-event"`.

## 7. Hallazgos

| # | Sev. | Hallazgo | Tratamiento |
|---|---|---|---|
| H1 | — | **Premisa del prompt desactualizada:** `TransaccionPagoLog` SÍ tiene `datos_facturacion_iv`. | Corregido: `encrypt()` mapea directo, sin migración para el log. |
| H2 | **Alta (bloqueante, resuelto)** | `decryptAndAuditBilling()` emitía el evento pero **no tenía superficie HTTP** → R3/CA6 inalcanzable (código muerto). | **Remediación `8269a12`**: endpoint solo Auditor `GET …/[id]/facturacion` + `obtenerFacturacionPago()`. Re-verify PASS. |
| H3 | Media | La mitad `AuditLog` filtrada no se surfaceaba en la respuesta. | Resuelto en la remediación (bloque `auditoria`). |
| H4 | Media (deuda) | Faltan tests de **integración HTTP** (`test:integration:e6`); R1/R3 se apoyan en unitarias source-regex. | Documentado como deuda (W2). |
| H5 | Baja | `verificar_integridad` (Backlog) no está en el query schema (spec). | Función module-owned implementada; divergencia reportada. |
| H6 | Baja | R4: default de expiración (30 días) pendiente de validar con el PO. | Parametrizado en `ConfiguracionSistema` (config-only si cambia). |
| H7 | Baja | La mitad forense se devuelve a cualquier caller que pase el gate (incluye Administrador aprobado). | Proyección segura (sin JSON crudo); nota para el PO si debe ser solo Auditor. |

## 8. Verificación funcional

| Corrida | Resultado |
|---|---|
| `npm test` | **794/794** (exit 0) |
| `npm run lint` | **0 errores** / 4 warnings preexistentes, exit 0 |
| `npm run build` | **OK** (4 rutas E6 registradas) |
| `npx prisma migrate dev --name add_acceso_log_pagos` | aplicada (32 migraciones) |
| `npx prisma db seed` | OK (`ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS = 30`) |

**Historial de verificación:** verify #1 → **FAIL** (1 blocker: R3/CA6 inalcanzable) → remediación acotada `8269a12` → verify #2 → **PASS** (`pass_with_warnings`, 0 blockers; 12/12 CA, 5/5 requisitos, 9/9 escenarios).

## 9. Cómo correr las pruebas

```bash
# Prerrequisitos (.env): DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY_PROVEEDORES (64 hex)
npx prisma migrate status   # debe decir "up to date"
npx prisma generate         # tras aplicar migraciones
npx prisma db seed          # idempotente
npm test                    # unitarias (incluye los *.test.ts de E6)
npm run lint
npm run build
```

> `npm test` enumera los archivos **explícitamente** en `package.json` (sin glob).

## 10. Fuera de alcance y deuda

- **Conciliación/liquidación real de Mercado Pago** (HU-G2).
- **Tabla de auditoría con hash-chain propio**: el hash-chain es de `AuditLog` (Módulo D).
- **Extensión del modelo `TransaccionPagoLog`** (sin `proveedor`; payload como `String`).
- **Deuda:** tests de integración HTTP (`test:integration:e6`); validación del default de expiración con el PO; exposición de `verificar_integridad`.

## 11. Lecciones de proceso

1. **Relevar el schema antes de creer al prompt.** El prompt asumía que no existía la columna IV; existía. Evitó una migración innecesaria.
2. **Un evento nuevo toca 3 lugares en `event-types.ts`.** La guarda `_registroCompleto` rompe el typecheck si falta `TIPOS_EVENTO_DOMINIO`.
3. **Código correcto pero inalcanzable sigue siendo un blocker.** La verificación detectó que `decryptAndAuditBilling()` no tenía caller HTTP → el control de auditoría no existía en la práctica.
4. **La emisión post-COMMIT se reutiliza, no se reinventa.** Se usó `emitirEventoPostCommitSeguroE2` de HU-E2.
5. **El cifrado tiene una única capa.** `lib/crypto/aes.ts` (`ENCRYPTION_KEY_PROVEEDORES`); no se creó una nueva.

## 12. Archivos de la implementación

Rama `HU-E6` (base `origin/develop` `f3522c3`), commits `b0a2ef6` → `8269a12`.

**Nuevos**
- `src/lib/services/ecommerce/auditoria-pagos.service.ts` (+ `.test.ts`)
- `src/lib/events/listeners/audit-log.listener.e6.test.ts`
- `src/app/api/ecommerce/auditoria/pagos/route.ts`
- `src/app/api/ecommerce/auditoria/pagos/[id]/facturacion/route.ts`
- `src/app/api/ecommerce/auditoria/pagos/solicitar-acceso/route.ts`
- `src/app/api/ecommerce/auditoria/pagos/solicitar-acceso/[id]/route.ts`
- `prisma/migrations/20261007021440_add_acceso_log_pagos/migration.sql`

**Modificados**
- `src/lib/services/ecommerce/pago-web.service.ts` (R1, con autorización de Chiki)
- `src/lib/events/event-types.ts` (2 payloads + mapa + registro)
- `src/lib/events/listeners/audit-log.listener.ts` (2 handlers, add-only)
- `src/lib/schemas/ecommerce.schema.ts` (4 schemas)
- `prisma/schema.prisma` (modelo `AccesoLogPagos`)
- `prisma/seed.ts` (clave de expiración)
- `package.json` (enumeración de los `*.test.ts` nuevos)

**No se tocan:** `prisma/migrations/` aplicadas, `src/lib/services/auditoria/**` (solo se consume `registrarAuditLog`), otros módulos. Ningún `DELETE`/`deleteMany`; sin dependencias nuevas.

**Documentación de cierre:** este documento (`docs/modulos/modulo E/HU6_MODULO_E.md`).
