# HU-F1 — Divergencias de eventos (documentadas)

> Estado: **RESUELTA por HU-G11 (Sprint 4)**. La divergencia de contrato de la
> D2 quedó resuelta: **HU-G11 consume `ecommerce:pedido_pago_confirmado`**, el
> evento real que ya emite HU-E2. HU-F1 no modificó el webhook ni
> `src/lib/events/event-types.ts`; **HU-G11 sí agrega dos eventos propios**
> (`tesoreria:ingreso_web_registrado` y `tesoreria:contra_asiento_ingreso_registrado`)
> a `event-types.ts` y sus handlers en `audit-log.listener.ts`. Este documento
> registra las divergencias detectadas durante el SDD de HU-F1 (Sprint 4) y su
> resolución por HU-G11.

## D2 — Evento del pago confirmado: inconsistencia entre specs

| Fuente | Evento que nombra |
| --- | --- |
| `spec_modulo_F.md` §2.1.3 | El webhook despacha `pago:webhook_confirmado` a sus consumidores (E2 y **G11**). |
| `spec_modulo_G.md` §2.6 | G11 consume **`ecommerce:transaccion_pago_registrada`** (emitido por E2), no `pago:webhook_confirmado`. |
| **Realidad HU-E2 (código)** | E2 emite **`ecommerce:pedido_pago_confirmado`** (`PedidoPagoConfirmadoPayload`). Al momento del SDD de HU-F1, `ecommerce:transaccion_pago_registrada` no existía; **hoy sí existe**: HU-E6 escribe `TransaccionPagoLog` dentro de la transacción de E2 y emite ese evento post-commit, tanto en aprobados como en rechazados (`TransaccionPagoRegistradaPayload`, sin `fecha_aprobacion`). |

Además, el webhook implementado por HU-E2 **procesa la notificación de forma
síncrona** (`procesarNotificacionPago()` de
`src/lib/services/ecommerce/pago-web.service.ts`) — una desviación ya
documentada respecto de la spec F §2.1.3, que pedía un despacho
_fire-and-forget_ del evento.

### Opciones

- **(a)** El webhook emite `pago:webhook_confirmado` y E2 pasa a consumirlo.
  Impacto: cambio en Módulo E (zona ajena a HU-F1) + tocar el webhook.
- **(b) [DESCARTADA]** Se mantiene el flujo síncrono actual y G11 consume
  `ecommerce:transaccion_pago_registrada`. Cuando se evaluó era inviable porque
  el evento no existía; hoy existe (HU-E6), pero se descarta igual: también se
  emite en los rechazos y su payload no trae `fecha_aprobacion`, que G11 usa
  como `IngresoTesoreria.fecha`.

**Decisión del equipo:** **RESUELTA por HU-G11** — G11 consume
`ecommerce:pedido_pago_confirmado`, el evento real y ya emitido por HU-E2. La
desviación respecto de `spec_modulo_G.md` §2.6 queda documentada en el docstring
de `src/lib/events/listeners/ingreso-tesoreria.listener.ts`. El webhook
permanece intacto.

## Resolución HU-G11

HU-G11 (Módulo G, Sprint 4) resuelve la D2 consumiendo el evento **real** de
HU-E2 y documenta el mapeo payload → `IngresoTesoreria`:

| Campo `IngresoTesoreria` | Origen en `ecommerce:pedido_pago_confirmado` |
| --- | --- |
| `pedido_venta_id` | `payload.pedido_venta_id` |
| `mercadopago_payment_id` | `payload.mercadopago_payment_id` |
| `monto` | `payload.monto` |
| `fecha` | `new Date(payload.fecha_aprobacion)` |
| `estado` | constante `"PENDIENTE_CONCILIACION"` |
| `caja_virtual` | constante `"MERCADO_PAGO_CANAL_WEB"` |

- El listener reactivo
  (`src/lib/events/listeners/ingreso-tesoreria.listener.ts`) se auto-registra
  desde `domain-event-bus.ts` y consume `ecommerce:pedido_pago_confirmado`.
- La idempotencia es dual (`pedido_venta_id` OR `mercadopago_payment_id`).
- La transición `PENDIENTE_CONCILIACION → CONCILIADO` queda **fuera de
  alcance** (HU-G2).
- HU-E6 ya introdujo `ecommerce:transaccion_pago_registrada`. **G11 sigue
  escuchando `ecommerce:pedido_pago_confirmado`** (acordado con Rama el
  2026-10-08, implementado por el owner de E2 — `docs/tasks/HU-E2-integracion.md`
  §9, P-R3). La D2 (webhook síncrono) no cambia.
- El reproceso manual (`reprocesarIngresoWeb()`) considera pagado a todo pedido
  con `fecha_pago_confirmado` y `mercadopago_payment_id` no nulos, sin mirar
  `estado_ecommerce`: desde la integración con HU-E12 el pedido confirmado pasa
  a `EN_PREPARACION` en el mismo commit (P-R2 de la misma task).

## Eventos de dominio de F1 §4 — diferidos

La spec F §4 lista eventos propios del Conector
(`integracion:conector_creado`, `integracion:conector_estado_cambiado`,
`integracion:invocacion_fallida`). Requieren:

- agregar los tipos en `src/lib/events/event-types.ts` (archivo caliente,
  compartido), y
- un handler nuevo en `src/lib/events/listeners/audit-log.listener.ts`
  (prohibido modificar los handlers existentes; solo se podrían **agregar**).

Ninguno de esos archivos está en el alcance declarado de HU-F1, y la spec de
HU-F1 no los exige para la gestión del Conector. Por eso quedan **diferidos**:
la bitácora operativa (`InvocacionConectorPago`) ya cubre la trazabilidad de
invocaciones y el `AuditLog` de Módulo D sigue siendo la única vía forense.

## Sin cambio de comportamiento

HU-F1 no toca `src/lib/events/event-types.ts`, el webhook
(`src/app/api/webhooks/mercadopago/route.ts`) ni ningún listener. Estas
divergencias quedan registradas únicamente.
