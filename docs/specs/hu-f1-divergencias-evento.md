# HU-F1 — Divergencias de eventos (documentadas, no resueltas)

> Estado: **PENDIENTE de decisión del equipo**. HU-F1 no modifica el webhook ni
> `src/lib/events/event-types.ts`; este documento registra las divergencias
> detectadas durante el SDD de HU-F1 (Sprint 4) para que la decisión se tome de
> forma explícita entre los dueños de Módulo E (HU-E2) y Módulo G (HU-G11).

## D2 — Evento del pago confirmado: inconsistencia entre specs

| Fuente | Evento que nombra |
| --- | --- |
| `spec_modulo_F.md` §2.1.3 | El webhook despacha `pago:webhook_confirmado` a sus consumidores (E2 y **G11**). |
| `spec_modulo_G.md` §2.6 | G11 consume **`ecommerce:transaccion_pago_registrada`** (emitido por E2), no `pago:webhook_confirmado`. |

Además, el webhook implementado por HU-E2 **procesa la notificación de forma
síncrona** (`procesarNotificacionPago()` de
`src/lib/services/ecommerce/pago-web.service.ts`) — una desviación ya
documentada respecto de la spec F §2.1.3, que pedía un despacho
_fire-and-forget_ del evento.

### Opciones

- **(a)** El webhook emite `pago:webhook_confirmado` y E2 pasa a consumirlo.
  Impacto: cambio en Módulo E (zona ajena a HU-F1) + tocar el webhook.
- **(b) [recomendada]** Se mantiene el flujo síncrono actual y G11 consume
  `ecommerce:transaccion_pago_registrada` (coherente con `spec_modulo_G.md`
  §2.6, el contrato que G11 ya espera). Impacto: ninguno sobre el webhook ni
  sobre Módulo E.

**Decisión del equipo:** _pendiente_ — no resuelta unilateralmente por HU-F1
(criterio de aceptación 13). Hasta que se confirme, el webhook permanece
intacto.

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
