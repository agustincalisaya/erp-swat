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
| **Realidad HU-E2 (código)** | E2 emite **`ecommerce:pedido_pago_confirmado`** (`PedidoPagoConfirmadoPayload`). `ecommerce:transaccion_pago_registrada` **NO existe** (ni tipado ni emitido; `TransaccionPagoLog` tampoco se escribe — es HU-E6, sin implementar). |

Además, el webhook implementado por HU-E2 **procesa la notificación de forma
síncrona** (`procesarNotificacionPago()` de
`src/lib/services/ecommerce/pago-web.service.ts`) — una desviación ya
documentada respecto de la spec F §2.1.3, que pedía un despacho
_fire-and-forget_ del evento.

### Opciones

- **(a)** El webhook emite `pago:webhook_confirmado` y E2 pasa a consumirlo.
  Impacto: cambio en Módulo E (zona ajena a HU-F1) + tocar el webhook.
- **(b) [INVÁLIDA]** Se mantiene el flujo síncrono actual y G11 consume
  `ecommerce:transaccion_pago_registrada`. Impacto: ninguno sobre el webhook ni
  sobre Módulo E — **pero inviable**: ese evento no existe en el código.

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
- Si en el futuro HU-E6 introduce `ecommerce:transaccion_pago_registrada`, G11
  puede seguir escuchando su propio evento o migrar en una HU aparte — **no es
  requisito de HU-G11**.

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
