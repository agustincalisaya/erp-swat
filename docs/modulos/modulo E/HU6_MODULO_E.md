# HU-E6 — Log de auditoría de transacciones de pago online (Módulo E, Sprint 4)

Documento de implementación. Fuente normativa: `docs/specs/spec_modulo_E.md` §2.6/§4/§5.

## Alcance implementado

| Req | Entrega |
|-----|---------|
| R1 | Cada transacción de pago web (APROBADO/RECHAZADO) inserta UNA fila en `TransaccionPagoLog` dentro del `$transaction` del flujo de pago, con datos de facturación cifrados (AES-256-GCM) y `resultado_webhook` sin datos de tarjeta. Tras el COMMIT se emite `ecommerce:transaccion_pago_registrada`. |
| R2 | `GET /api/ecommerce/auditoria/pagos` — doble permiso (Auditor completo; Administrador E-commerce solo con acceso aprobado y vigente, si no `403 ACCESO_LOG_PAGOS_NO_APROBADO`). Filtros por `estado_pago` y rango de fechas (`finDeDia` UTC), paginado. Solo lectura. |
| R3 | `ecommerce:acceso_dato_cifrado_auditado` se emite EXACTAMENTE una vez por lectura del dato cifrado, vía `decryptAndAuditBilling()` (solo Auditor). El Administrador E-commerce nunca ve el campo cifrado. |
| R4 | `AccesoLogPagos` (nueva tabla `accesos_log_pagos`) registra solicitud y aprobación. `POST …/solicitar-acceso` (Administrador) y `PATCH …/solicitar-acceso/[id]` (Auditor). Expiración desde `ConfiguracionSistema`. |

## Archivos

- `src/lib/events/event-types.ts` — 2 payloads + 2 claves en `DomainEventMap` + 2 en `TIPOS_EVENTO_DOMINIO`.
- `src/lib/events/listeners/audit-log.listener.ts` — 2 handlers AGREGADOS (`TRANSACCION_PAGO_REGISTRADA`, `ACCESO_DATO_CIFRADO_AUDITADO`), con captura segura de fallos.
- `src/lib/services/ecommerce/pago-web.service.ts` — R1 (modificado con autorización de Chiki, owner de HU-E2). Solo se agregó la inserción del log + la emisión del evento; la lógica E2 existente no se reescribió.
- `src/lib/services/ecommerce/auditoria-pagos.service.ts` — R2/R3/R4 (nuevo, service de solo lectura + mecanismo de acceso).
- `src/lib/schemas/ecommerce.schema.ts` — `ListarLogPagosQuerySchema`, `SolicitarAccesoLogPagosSchema`, `AccesoLogPagosIdSchema`.
- `src/app/api/ecommerce/auditoria/pagos/**` — 3 rutas (GET, POST, PATCH).
- `prisma/schema.prisma` + `prisma/migrations/20261007021440_add_acceso_log_pagos/` — modelo `AccesoLogPagos` (migración aditiva).
- `prisma/seed.ts` — clave `ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS = 30`.

## Decisiones de diseño

- El log operativo vive en `TransaccionPagoLog`; el hash-chain vive EXCLUSIVAMENTE en `AuditLog` (Módulo D). `TransaccionPagoLog` no tiene cadena propia.
- El evento se emite post-COMMIT reutilizando `emitirEventoPostCommitSeguroE2` (helper ya existente de HU-E2). Nunca dentro de la transacción.
- Idempotencia heredada de la transición condicionada `updateMany` de HU-E2: un webhook duplicado no crea una segunda fila ni un segundo evento.
- Datos de facturación: se leen `Cliente` + `CuentaClienteWeb` DENTRO del mismo `$transaction` (el `PagoConsultado` de MP no los trae) y se cifran con `lib/crypto/aes.ts` (única capa, clave `ENCRYPTION_KEY_PROVEEDORES`).

## Divergencias documentadas

1. **Columna IV.** La spec §2.6 menciona solo `datos_facturacion_cifrados`, pero `encrypt()` devuelve `{ ciphertext, iv }`. `TransaccionPagoLog.datos_facturacion_iv` ya existía en el schema (agregado con confirmación del equipo, mismo patrón que `Proveedor.datos_bancarios_iv`). El IV se persiste en su propia columna; no se empaqueta dentro del ciphertext.
2. **`verificar_integridad` (Backlog ↔ spec).** El Product Backlog pide "encadenamiento SHA-256 verificable", pero el `ListarLogPagosQuerySchema` de spec §2.6 no lo incluye. Se implementó `verificarIntegridadLogPagos()` como función module-owned (patrón `verificarCadenaHashesVentas` de HU-B6) que recorre la cadena global de `AuditLog`; NO se expone en el query schema ni en la respuesta del endpoint. Divergencia reportada, pendiente de decisión del PO.
3. **R4 — aprobador y expiración.** El Alcance Funcional nombra al Auditor como aprobador (implementado). La duración no está definida en ningún documento: se implementó expiración por parámetro (`ECOMMERCE_ACCESO_LOG_PAGOS_EXPIRACION_DIAS`, default 30 días). **Valor pendiente de validar con el PO.**
4. **`pedido_venta_id` en la respuesta del log.** El shape de spec §2.6 pide `pedido_venta_id`; `TransaccionPagoLog` solo guarda `pedido_venta_ecommerce_id`. La respuesta devuelve el `PedidoVenta.id` real vía join a `PedidoVentaEcommerce.pedido_venta_id`, para consistencia con el payload del evento.
5. **`decryptAndAuditBilling()`.** Implementado como entry point module-owned reservado al Auditor, sin ruta dedicada en esta HU (el query schema de spec §2.6 no expone el campo cifrado). Queda como punto de integración para una vista de detalle futura.

## Fuera de alcance (R5)

- Conciliación/liquidación real de Mercado Pago (HU-G2).
- Tabla de auditoría con hash-chain propio: el hash-chain es de `AuditLog`.
- Extensión del modelo `TransaccionPagoLog`.
- `prisma.*.delete()` (baja lógica estricta, RULES.md Regla N.° 1).

## Tests

Unitarios (`npm test`): `auditoria-pagos.service.test.ts` (doble permiso, paginación, decrypt-once, integridad, R1 aprobado/rechazado y payload sin datos sensibles), `audit-log.listener.e6.test.ts` (2 handlers), `ecommerce.schema.test.ts` (bounds). Los integration tests HTTP opt-in (`test:integration:e6` / `e6-http`) quedan diferidos y se documentan como deuda de verificación.

## Validación

`npm test` (791 pass) · `npm run lint` (0 errores) · `npm run build` (OK) · `npx prisma migrate dev --name add_acceso_log_pagos` (aplicada) · `npx prisma generate` · `npx prisma db seed` (OK).
