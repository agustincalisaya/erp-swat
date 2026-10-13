# HU-E13 TASKS — Revisión 2 — propuesta para aprobación

> **Estado al 08/10/2026:** HU-E13 **CERRADA — VERIFY PASS**. T00–T20 ejecutadas y aprobadas (✅). Las precondiciones y expresiones «pendiente/futura» que siguen son el registro histórico de cómo se autorizó cada task, no el estado actual. El registro final está en §4 y en `HU13_MODULO_E.md` §10.

## Cancelación y vencimiento de pedidos pagados — Módulo E

**Fuentes de verdad congeladas:**

1. `docs/specs/spec_modulo_E.md` — HU-E13, Revisión 3.
2. `docs/modulos/modulo E/HU13_MODULO_E.md` — PLAN Revisión 2 aprobada.
3. Addendum post-T17: SPEC §2.13.16 y PLAN §9 (reconciliación contractual aprobada), reflejados en T09, T11, T13, T14, T17, T18 y T19.

**Estado:** propuesta de tareas para auditoría. No constituye implementación ni evidencia de pruebas.

## Reglas de ejecución

- Ejecutar una sola task por autorización.
- Al terminar cada task: presentar diff, pruebas focales y riesgos; luego **STOP**. No iniciar la siguiente sin aprobación.
- Los archivos autorizados son un límite máximo, no una obligación de modificarlos todos.
- Si hace falta tocar un archivo no autorizado, cambiar un contrato o ampliar schema fuera de lo previsto: **STOP y nueva revisión**.
- No modificar SPEC ni PLAN durante estas tasks.
- No reinterpretar estados B/E históricos ni fabricar sagas, NC, refunds o movimientos retroactivos.
- No agregar `clave_idempotencia` a `ComprobanteFiscal` o `MovimientoStock` sin revisión explícita previa.
- Toda migration es aditiva: sin `DROP`, `TRUNCATE`, reset ni pérdida de datos.
- Los nombres finales de migrations deben usar el timestamp real al implementarse; este documento usa un placeholder.

---

## 1. Grafo de dependencias

```text
T00 Preflight legacy
 └─> T01 Prisma schema + migration
      └─> T02 Seed/configuración y verificación del permiso existente
           ├─> T03 Nota de Crédito B ──────┐
           ├─> T04 Compensación A ─────────┼─> [JOIN T03 + T04 + T05] ─> T07 Saga local ──┐
           ├─> T05 G11 discriminado ───────┘                                        │
           └─> T06 F1 idempotente ───────────────────────────────────────────────────┼─> [JOIN T07 + T06] ─> T08 Saga refund
                                                                                       │
T08 ─> T09 Eventos/AuditLog/F3 ───────────────┐                                         │
T08 ─> T10 E2/E12 cola y toma ────────────────┼─> [JOIN T08 + T10] ─> T11 APIs        │
                                              │                                         │
[JOIN T09 + T10 + T11] ─> T12 Cron ──────────┤                                         │
[JOIN T10 + T11] ───────> T13 E9 ────────────┤                                         │
[JOIN T11 + T13] ───────> T14 UI Cliente ────┤                                         │
[JOIN T11 + T12] ───────> T15 UI Admin ──────┤                                         │
T10 ────────────────────> T16 UI Pick & Pack ┘                                         │
                                                                                        │
[JOIN T09 + T10 + T11 + T12 + T13 + T14 + T15 + T16] ─> T17 Integración PostgreSQL
                                                                  └─> T18 Concurrencia/crashes
                                                                       └─> T19 VERIFY D17/R22
                                                                            └─> T20 Documentación
```

**Dependencias normativas:**

- `T00 → T01 → T02`.
- `T02 → T03`, `T02 → T04`, `T02 → T05`, `T02 → T06`.
- T07 exige T03 + T04 + T05 completadas.
- T08 exige T07 + T06.
- T09 exige T08. T10 exige T08.
- T11 exige T08 + T10.
- T12 exige T09 + T10 + T11.
- T13 exige T10 + T11.
- T14 exige T11 + T13.
- T15 exige T11 + T12.
- T16 exige T10.
- T17 exige T09 + T10 + T11 + T12 + T13 + T14 + T15 + T16 terminadas.
- `T17 → T18 → T19 → T20`.

**Orden recomendado:** T00 → T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20.

T03–T06 pueden prepararse en paralelo conceptualmente después de T02, pero cada una conserva su STOP individual. Las tasks de UI no comienzan antes de sus joins aprobados.

---

# TASKS

## T00 — Preflight legacy y baseline de regresión

**Objetivo:** demostrar que la implementación puede desplegarse sin reinterpretar historia comercial y fijar el baseline de suites existentes.

**Alcance exacto:** consultas read-only sobre snapshot pre-HU-E13; inventario por estados B/E, actividad, operador, scans, QR/plazo, factura, ingreso, reservas y pago; reporte de inconsistencias. No corregir datos.

**Archivos autorizados:** crear únicamente fixtures/scripts de diagnóstico bajo la ubicación de tests ya usada por el repo si son indispensables; no modificar datos productivos. Este documento no autoriza cambios a `schema.prisma`.

**Contrato:** todo pedido legacy conserva exactamente sus estados B/E. No crear saga, NC, refund o movimiento retroactivo. Un valor nuevo solo admite backfill si fuera obligatorio, inequívoco y previamente aprobado; hoy no hay ninguno identificado.

**Dependencias previas:** ninguna.

**Tests focales obligatorios:** snapshot con cada estado E; comparar estados B/E antes/después de ejecutar diagnóstico; baseline E2/E3/E6/E9/E12/G11/F1; verificar que el diagnóstico no emite escrituras.

**Criterio de aceptación:** reporte reproducible; baseline registrado; DB sin cambios; inconsistencias clasificadas como hallazgos, no corregidas.

**Criterio de STOP:** cualquier estado/dato que obligue a reinterpretar historia, o ausencia de evidencia de depósito/cantidad para un pedido que deba procesarse, se reporta y detiene el bloque afectado.

**Riesgos/regresiones:** consultas de diagnóstico con side effects; asumir que `EN_PREPARACION` sin operador equivale a `PAGO_CONFIRMADO`; fabricar fechas o transiciones.

**Cierre:** presentar evidencia y **STOP**.

---

## T01 — Prisma schema y migration aditiva HU-E13

**Objetivo:** incorporar la persistencia mínima de Rev.3 sin alterar datos comerciales existentes.

**Alcance exacto:** enum `NOTA_CREDITO`; vínculo no único al comprobante original; enums y modelos de cabecera, compensaciones e intentos; índices, uniques y FK `Restrict`; migration aditiva.

**Archivos autorizados:** `prisma/schema.prisma`; crear `prisma/migrations/<timestamp>_hu_e13_cancelacion_reintegro/migration.sql`; tests focales nuevos de constraints si la convención los ubica junto a servicios.

**Contrato:**

- `ReintegroPedidoWeb`: `pedido_venta_id`, `mercadopago_payment_id`, `nota_credito_id`, `contra_asiento_ingreso_id`, `intento_aprobado_id` únicos según SPEC.
- `ReintegroStockCompensacion`: `[reintegro_id, pedido_venta_item_id]`, `clave_idempotencia`, `movimiento_stock_id` únicos.
- `ReintegroRefundIntento`: `[reintegro_id, numero]`, `clave_idempotencia`, `refund_id` únicos e historial 1:N.
- `ComprobanteFiscal.comprobante_original_id` nullable, indexado, inmutable por servicio y no único global.
- No agregar claves genéricas a `ComprobanteFiscal` o `MovimientoStock`.
- Sin actualización de estados B/E ni backfill comercial.

**Dependencias previas:** T00 aprobada.

**Tests focales obligatorios:** `prisma validate`; generación de cliente; `migrate deploy` en DB vacía y snapshot pre-HU-E13; constraints únicos y FK; comparación de estados B/E antes/después; comprobantes/movimientos existentes intactos.

**Criterio de aceptación:** migration reversible mediante backup operacional, aditiva y desplegable en ambos escenarios; cliente Prisma compila; no cambia registros legacy.

**Criterio de STOP:** necesidad de `DROP`, reset, constraint genérica nueva en B/A, backfill ambiguo o modificación retrospectiva de estados.

**Riesgos/regresiones:** FK circular de intento aprobado; orden de creación de enums/tablas; locks de migration; identificador enum incorrecto; unique global accidental sobre comprobante original.

**Cierre:** presentar SQL/diff y pruebas; **STOP**.

---

## T02 — Seed, configuración y permiso existente

**Objetivo:** sembrar configuración HU-E13 y verificar RBAC sin crear permisos nuevos.

**Alcance exacto:** crear/sembrar únicamente la configuración `ECOMMERCE_RECORDATORIO_RETIRO_HORAS = 24` mediante upsert idempotente; verificar `>0` y `< ECOMMERCE_PLAZO_RETIRO_DIAS * 24`; comprobar que el permiso existente `ecommerce:cancelar_pedido_pagado` continúa en seed y asignado al Administrador E-commerce; exponer/reutilizar su constante si hace falta.

**Archivos autorizados:** `prisma/seed.ts`; tests de seed/configuración existentes o nuevos; `src/lib/auth/permisos-ecommerce.ts` solo para exponer/reutilizar la constante exacta ya sembrada.

**Contrato:** HU-E13 no inserta otro permiso, no cambia el nombre `ecommerce:cancelar_pedido_pagado` y no amplía roles sin autorización. Seed repetible; configuración única; permiso existente no duplicado; sin columna `recordatorio_enviado_at`; sin modificar estados/fixtures legacy salvo agregar fixtures nuevos claramente post-deploy para tests posteriores.

**Dependencias previas:** T01 aprobada.

**Tests focales obligatorios:** dos ejecuciones de seed; valor 24 único; una sola fila para `ecommerce:cancelar_pedido_pagado`; asignación vigente al Administrador E-commerce; ninguna asignación nueva; validaciones 0, negativo, igual/mayor al plazo y valor válido.

**Criterio de aceptación:** configuración y constante disponibles; permiso exacto presente, no duplicado y sin cambio de nombre/asignaciones.

**Criterio de STOP:** permiso ausente/incompatible con la SPEC, necesidad de insertarlo con otro nombre, crear otro permiso o ampliar roles.

**Riesgos/regresiones:** seed destructivo; sobreescribir configuración administrada; alterar asignaciones de otros roles.

**Cierre:** presentar evidencia y **STOP**.

---

## T03 — Nota de Crédito idempotente en Módulo B

**Objetivo:** emitir/reutilizar una única NC total HU-E13 sin mutar factura original ni estado B.

**Alcance exacto:** helper B `tx`-scoped; localizar original; validar pedido/monto/tipo; crear `NOTA_CREDITO`; vincular `comprobante_original_id`; coordinar creación y `ReintegroPedidoWeb.nota_credito_id` en una misma transacción compartida.

**Archivos autorizados:** `src/lib/services/ventas/comprobante-fiscal.service.ts`; sus tests unitarios/integración; helpers B directamente necesarios. No modificar schema fuera de T01.

**Contrato:** original inmutable; total completo; una NC HU-E13 por saga/pedido; otras NC fiscales futuras del mismo original no bloqueadas; `CREADO | YA_EXISTENTE`; sin clave genérica en `ComprobanteFiscal`.

**Dependencias previas:** T02 aprobada.

**Tests focales obligatorios:** creación; retry secuencial; carrera; rollback antes del commit; original ausente/ajeno; monto total; otra NC no HU-E13 coexistente; regresión FACTURA_A/B/TICKET.

**Criterio de aceptación:** NC y vínculo aparecen juntos o ninguno; retry devuelve el mismo ID; factura/B permanecen intactos.

**Criterio de STOP:** no puede cerrarse la ventana de creación/vínculo con transacción y constraints E13, o se demuestra necesaria una clave en `ComprobanteFiscal`.

**Riesgos/regresiones:** duplicar CAE/QR como evidencia distinta; reutilizar una NC ajena; cambiar `FACTURADO`; unique global fiscal excesivo.

**Cierre:** presentar pruebas focales y **STOP**.

---

## T04 — Compensación multi-item en Módulo A

**Objetivo:** implementar por línea la restitución idempotente `VENDIDO → DISPONIBLE` para múltiples ítems/SKU/depósitos.

**Alcance exacto:** servicio A `tx`-scoped; lock de `ReintegroStockCompensacion`; validar item/reserva/depósito/cantidad; incrementar stock; crear `MovimientoStock` + item compensatorio; vincular `movimiento_stock_id` en la misma transacción.

**Archivos autorizados:** crear `src/lib/services/inventario/compensacion-venta.service.ts` y tests; modificar helpers A estrictamente reutilizados; tipos/eventos A solo si son necesarios para representar el movimiento. No modificar `MovimientoStock` en Prisma.

**Contrato:** una hija por `pedido + item`; soportar SKU repetido en líneas distintas y depósitos distintos; `CREADO | YA_EXISTENTE`; procesar solo faltantes; no usar `liberarReservasTx()`; E nunca escribe directamente stock.

**Dependencias previas:** T02 aprobada.

**Tests focales obligatorios:** dos SKU; dos líneas mismo SKU; múltiples depósitos; cantidades exactas; retry; dos procesos sobre la misma hija; rollback entre operaciones; una hija completa y otra pendiente; regresión reservas/ingreso/stock.

**Criterio de aceptación:** cada línea incrementa exactamente una vez y queda vinculada al movimiento; toda falla de la transacción revierte stock, movimiento y vínculo.

**Criterio de STOP:** depósito/cantidad no derivable inequívocamente, necesidad de tocar stock desde E o necesidad demostrada de clave genérica en `MovimientoStock`.

**Riesgos/regresiones:** duplicar stock; compensar depósito incorrecto; agrupar líneas perdiendo idempotencia; afectar alertas/ingresos existentes.

**Cierre:** presentar matriz multi-item y **STOP**.

---

## T05 — Resultado discriminado e idempotencia G11

**Objetivo:** eliminar la ambigüedad de `registrarContraAsiento()` sin romper consumidores.

**Alcance exacto:** retorno `CREADO | YA_EXISTENTE | INGRESO_ORIGINAL_NO_ENCONTRADO`; recuperar ID en conflicto `P2002`; variante `tx`-scoped si se requiere; adaptar callers actuales.

**Archivos autorizados:** `src/lib/services/tesoreria/ingreso-tesoreria.service.ts`; test asociado; listeners/callers directos que dependan de `null`.

**Contrato:** un contra-asiento por pedido; ingreso original inmutable; “sin ingreso” nunca equivale a idempotencia exitosa.

**Dependencias previas:** T02 aprobada.

**Tests focales obligatorios:** tres resultados exactos; carrera; monto/motivo; ingreso intacto; regresión G11 y listener de ingreso.

**Criterio de aceptación:** todos los consumidores compilan y discriminan explícitamente; ID real disponible en creado/existente.

**Criterio de STOP:** un consumidor externo no puede migrarse compatiblemente o la unicidad actual no representa un contra-asiento por pedido.

**Riesgos/regresiones:** tratar `NO_ENCONTRADO` como éxito; emitir eventos dobles; romper retorno usado por listeners.

**Cierre:** presentar usos adaptados y **STOP**.

---

## T06 — Contrato idempotente F1

**Objetivo:** exigir y transmitir la clave persistida del intento en refunds totales.

**Alcance exacto:** firma del adapter; header adicional; simulador determinista por payment/key; mapeo aprobado/pendiente/rechazado y errores técnicos.

**Archivos autorizados:** `src/lib/integraciones/mercadopago/adapter.ts`; `adapter.reembolso.test.ts`; helper HTTP interno del adapter estrictamente necesario; callers actuales.

**Contrato:** `POST /v1/payments/{id}/refunds`; sin `amount` para HU-E13; header literal `X-Idempotency-Key`; retry técnico usa mismo intento/misma clave; no registrar secretos/clave completa.

**Dependencias previas:** T02 aprobada.

**Tests focales obligatorios:** método/URL/body/header exactos; misma clave retorna mismo refund; claves distintas representan intentos distintos; timeout, red, 429/5xx, rechazo y respuesta inválida; regresión F1 completa.

**Criterio de aceptación:** no existe vía de refund sin clave; adapter y simulador conservan contrato.

**Criterio de STOP:** endpoint/provider no acepta el header exigido por SPEC o algún caller requiere refund sin idempotencia.

**Riesgos/regresiones:** filtrar header en logs; enviar monto parcial; regenerar clave; romper health-check/webhook.

**Cierre:** presentar captura del request mock y **STOP**.

---

## T07 — Saga: inicio, terminal E y pasos locales

**Objetivo:** crear el núcleo durable hasta NC, stock y G11, sin llamada externa.

**Alcance exacto:** reglas puras de actor/estado; lock `PedidoVenta → PedidoVentaEcommerce → items`; transición condicionada; QR nulo; baja lógica E; B queda `FACTURADO`; cabecera + hijas stock; avance NC → líneas A → G11; marcadores de error/retry.

**Archivos autorizados:** crear `reintegro-pedido-web.service.ts`, `.reglas.ts`, tipos y tests bajo `src/lib/services/ecommerce/`; helper de lock compartido solo si E3/E12 pueden consumirlo sin cambiar contratos.

**Contrato:** cliente solo `PAGO_CONFIRMADO`; admin tres estados; vencimiento solo LISTO con plazo superado; una saga por pedido/pago; G11 no encontrado deja saga pendiente y no revierte terminal/NC/stock.

**Dependencias previas:** T03, T04 y T05 completadas y aprobadas.

**Tests focales obligatorios:** matrices actor/estado; motivo; QR; soft-delete; B intacto; cabecera/hijas atómicas; NC/stock/G11 creados o reutilizados; G11 faltante; retry de pasos incompletos; no eventos todavía si pertenecen a T09.

**Criterio de aceptación:** estado terminal y saga nacen juntos; pasos locales reanudables; ningún efecto duplicado.

**Criterio de STOP:** lock order incompatible con E3/E12, necesidad de llamada externa dentro de DB tx o de ampliar schema owner B/A.

**Riesgos/regresiones:** mezclar HU-E7; desactivar B; crear saga antes de ganar estado; lock inversion.

**Cierre:** presentar máquina local y **STOP**.

---

## T08 — Saga: refund, retry técnico y reintento manual

**Objetivo:** completar la máquina durable de intentos y garantizar como máximo un refund aprobado.

**Alcance exacto:** crear intento inicial antes de F1; llamada fuera de tx; persistir aprobado/rechazado/ambiguo; scheduling; acción de dominio para reintento manual con hijo nuevo; preservar historial.

**Archivos autorizados:** servicio/tipos/reglas/tests creados en T07; adapter solo si T06 dejó un ajuste estrictamente contractual no funcional.

**Contrato:**

- técnico: mismo hijo y misma key;
- definitivo: hijo/cabecera `RECHAZADO`, sin retry automático;
- manual: solo admin, motivo, nuevo número/key después de rechazo;
- `APROBADO` impide nuevos intentos;
- dos requests manuales concurrentes producen un solo hijo pendiente.

**Addendum temporal congelado:**

- al crear y commitear un intento `INICIAL` o `REINTENTO_MANUAL` `PENDIENTE`, persistir `proximo_reintento_at = ahora` antes de F1;
- para `TIMEOUT`, `RED`, `HTTP_429`, `HTTP_5XX` o `RESPUESTA_AMBIGUA`, incrementar `intentos_tecnicos` sobre el mismo hijo y, con `n` posterior al incremento, fijar `proximo_reintento_at = ahora + min(5 * 2^(n - 1), 360) minutos` (`5, 10, 20, 40, 80, 160, 320, 360...`), sin jitter, máximo ni transición por agotamiento;
- para respuesta remota `PENDING`, no incrementar `intentos_tecnicos` y fijar `proximo_reintento_at = ahora + 15 minutos`, conservando hijo/key;
- `APROBADO` y `RECHAZADO` fijan `proximo_reintento_at = null`;
- HTTP `400`, `401`, `403` y `404` son definitivos y se persisten como `RECHAZADO`, con diagnóstico seguro y sin retry automático; HTTP `429` y `5xx` siguen siendo técnicos.

**Dependencias previas:** T06 y T07 aprobadas.

**Tests focales obligatorios:** aprobación; timeout/resultado incierto; red; rechazo; retry misma key; reintento manual nueva key; historia previa intacta; dos retries técnicos; dos reintentos manuales; intento después de aprobado; crash antes/durante/después de F1.

**Criterio de aceptación:** una sola cabecera aprobada/intento enlazado; ninguna llamada F1 antes de completar pasos locales; evidencia de todos los intentos.

**Criterio de STOP:** posibilidad de dos refunds aprobados, llamada F1 bajo lock/tx o ambigüedad entre error técnico y rechazo definitivo.

**Riesgos/regresiones:** retry infinito de rechazado; crear hijo en timeout; perder respuesta aprobada; sobrescribir evidencia.

**Cierre:** presentar tabla de crashes y **STOP**.

---

## T09 — Eventos, AuditLog y F3

**Objetivo:** publicar y consumir los cuatro eventos Rev.3 con actores e idempotencia correctos.

**Alcance exacto:** tipos/mapa; emisión post-commit; handlers D/F3; claves por destinatario; auditoría sensible para cancelación, vencimiento, rechazo, reintento y aprobación.

**Archivos autorizados:** `src/lib/events/event-types.ts`; `domain-event-bus.ts` solo si hace falta registrar; `listeners/audit-log.listener.ts`; `listeners/notificacion.listener.ts`; tests focales nuevos/asociados; seed solo si la convención de plantilla lo exige y dentro del contrato T02.

**Contrato:** sin PII/QR/credenciales/error remoto; cancelación/vencimiento notifican Cliente Web + Administrador; recordatorio Cliente Web; actor sistema/web `AuditLog.usuario_id = null`; admin con ID; `deleted_by` automático Canal Web; listener fallido no revierte dominio.

**Addendum post-T17 (SPEC §2.13.16.1, PLAN §9.1):** reemplaza la frase «cancelación/vencimiento notifican Cliente Web + Administrador». `ecommerce:plazo_retiro_por_vencer`, `ecommerce:pedido_cancelado` y `ecommerce:pedido_vencido_sin_retiro` notifican únicamente a la cuenta del Cliente Web operable; ninguna notificación HU-E13 al rol `ADMINISTRADOR_ECOMMERCE`. La trazabilidad administrativa corresponde al AuditLog y a las vistas administrativas HU-E13. `ecommerce:pedido_vencido_sin_retiro` usa prioridad `CRITICA` según el Módulo F; las demás prioridades no cambian. Corrección pendiente de código: prioridad del vencimiento.

**Dependencias previas:** T08 aprobada.

**Tests focales obligatorios:** payloads; post-commit; no-op sin evento; retry sin duplicado; una notificación por destinatario; actor humano/web/sistema; hash-chain; rechazo y reintento como hechos separados.

**Criterio de aceptación:** eventos tipados, auditados y notificados exactamente una vez por hecho durable.

**Criterio de STOP:** evento requiere secreto/PII, se emite dentro de tx o F3 necesita canal externo no aprobado.

**Riesgos/regresiones:** doble listener; unhandled rejection; claves F3 inestables; actor incorrecto.

**Cierre:** presentar ledger/notificaciones focales y **STOP**.

---

## T10 — E2/E12: pago en cola y toma atómica

**Objetivo:** persistir `PAGO_CONFIRMADO` tras el pago y mover transición/asignación a la toma.

**Alcance exacto:** E2 conserva factura, stock vendido, ingreso, fecha y evento de cola; cola incluye `PAGO_CONFIRMADO` nuevo no tomado; toma nueva hace estado+operador atómicos; compatibilidad de lectura para `EN_PREPARACION` legacy sin reescribirlo; scan/completar siguen en `EN_PREPARACION` asignado.

**Archivos autorizados:** `pago-web.service.ts`; `pick-pack.service.ts`; `pick-pack.types.ts`; schema Pick & Pack; rutas de preparación existentes; tests E2/E12/Pick & Pack. UI queda fuera hasta T16.

**Contrato:** pago posterior al deploy termina `PAGO_CONFIRMADO`; visible inmediatamente; tomar hace `PAGO_CONFIRMADO → EN_PREPARACION + operador`; no nuevo estado; pedidos legacy conservan estados.

**Dependencias previas:** T08 aprobada.

**Tests focales obligatorios:** pago aprobado/repetido/rechazado; cola inmediata; dos operadores; retry mismo operador; prioridad; scans/completar; legacy no reescrito; cancelación cliente vs tomar; cancelación admin vs tomar.

**Criterio de aceptación:** E2/E12 cumplen nueva máquina sin degradar facturación, stock, cola, notificación o preparación.

**Criterio de STOP:** se requiere convertir estados legacy, queda `EN_PREPARACION` sin operador para pagos nuevos o cambia estado en la admisión.

**Riesgos/regresiones:** fixture histórico asumido como nuevo; evento de cola perdido; prioridad solo acepta estado anterior; carrera con E13.

**Cierre:** presentar regresión E2/E12 y **STOP**.

---

## T11 — APIs de cancelación y reintento manual

**Objetivo:** exponer contratos HTTP finos y seguros sobre la saga aprobada.

**Alcance exacto:** cancelación Cliente Web; cancelación admin; reintento manual; schemas estrictos; auth/ownership/RBAC; envelopes y errores.

**Archivos autorizados:** crear rutas `/api/tienda/mis-pedidos/[id]/cancelar`, `/api/ecommerce/pedidos/[id]/cancelar`, `/api/ecommerce/pedidos/[id]/reintegro/reintentar`; crear schema HU-E13 y test; error mapper e-commerce estrictamente necesario; constante de permiso existente.

**Contrato:** motivo obligatorio; cliente propio y solo `PAGO_CONFIRMADO`; admin tres estados; reintento solo `RECHAZADO`; 200 idempotente; 404 no revela pedido ajeno; 409 transición/proceso; sin actor desde body.

**Addendum post-T17 (SPEC §2.13.16.4, PLAN §9.3):** la respuesta pública de cancelación Cliente Web vigente es `{ pedido_venta_id, estado_ecommerce: "CANCELADO", reintegro_iniciado: true }`, sin `reintegro_id`, `nota_credito_id`, ID de intento, `refund_id`, payment ID, clave idempotente ni diagnóstico técnico. Formaliza lo ya implementado y aprobado; no cambia la lógica T11.

**Dependencias previas:** T08 y T10 aprobadas.

**Tests focales obligatorios:** 200/400/401/403/404/409; body strict; ID inválido; ownership; los tres estados admin; estados prohibidos; retry HTTP; dos requests manuales concurrentes.

**Criterio de aceptación:** rutas reflejan estado durable y no contienen lógica de dominio duplicada.

**Criterio de STOP:** endpoint necesita relajar ownership/RBAC, reutilizar `/anular` HU-E7 o exponer campos sensibles.

**Riesgos/regresiones:** IDOR; confusión `anular`/`cancelar`; devolver NC/refund inexistente como confirmado.

**Cierre:** presentar matriz HTTP y **STOP**.

---

## T12 — Cron: recordatorio, vencimiento y retries

**Objetivo:** integrar tres procesos idempotentes separados al mantenimiento existente.

**Alcance exacto:** seleccionar recordatorios; vencer LISTO con `plazo < ahora`; avanzar sagas pendientes elegibles; aislamiento por tarea/agregado; resultados seguros en cron/script.

**Archivos autorizados:** crear `mantenimiento-hu-e13.service.ts` y tests; modificar `mantenimiento-programado.ts` y tests; ruta cron existente; script/job existente solo para invocar/esperar las tareas.

**Contrato:** recordatorio 24 h configurable y clave F3 estable; sin columna; igualdad no vence; actor sistema; dos jobs un ganador; rechazados/aprobados fuera de retry; F1 nunca bajo locks.

**Addendum del selector de retry:** avanzar automáticamente únicamente filas con `ReintegroPedidoWeb.estado = PENDIENTE`, `proximo_reintento_at IS NOT NULL` y `proximo_reintento_at <= now()`. Cada pasada recupera y reutiliza el `ReintegroRefundIntento` `PENDIENTE` existente con el mismo número y clave; nunca crea un intento automático nuevo por timeout, red, `429`, `5xx`, respuesta ambigua o `PENDING` remoto. Las fechas se calculan exclusivamente según el addendum de T08.

**Dependencias previas:** T09, T10 y T11 aprobadas.

**Tests focales obligatorios:** ventana de recordatorio; duplicado; configuración inválida aislada; vencimiento; dos jobs; E3 vs vencimiento; G11 tardío; timeout F1; dos retries; coexistencia con reservas/cupones/carritos.

**Criterio de aceptación:** segunda pasada es no-op salvo pendientes programados; un fallo E13 no rompe mantenimiento previo.

**Criterio de STOP:** scheduler nuevo, retry de rechazado, vencimiento en igualdad o llamada externa durante tx.

**Riesgos/regresiones:** lotes largos; starvation; notificaciones duplicadas; alterar respuesta cron consumida externamente.

**Cierre:** presentar dos pasadas consecutivas y **STOP**.

---

## T13 — E9: historial de terminales inactivos

**Objetivo:** mantener `CANCELADO`/`VENCIDO_SIN_RETIRO` visibles solo para el dueño.

**Alcance exacto:** consulta listado/detalle; DTO con motivo/fechas/estado agregado de reintegro; QR nulo; soporte legacy sin saga; filtros operativos restantes intactos.

**Archivos autorizados:** `mis-pedidos.service.ts`; schema E9; rutas E9 solo por serialización; tests unitarios/integración/HTTP. UI queda en T14.

**Contrato:** OR histórico estrictamente dentro de cliente propio + canal WEB + estados HU-E13; inactivo no terminal oculto; sin refund_id/key/error/pago sensible.

**Addendum post-T17 (SPEC §2.13.16.2–§2.13.16.3, PLAN §9.2):** se mantiene la visibilidad histórica de `CANCELADO`/`VENCIDO_SIN_RETIRO`. El DTO Cliente Web E9 agrega:

- `motivo: string | null` = `PedidoVentaEcommerce.deletion_reason`;
- `fecha_terminacion: string | null` = `PedidoVentaEcommerce.deleted_at`;
- `reintegro_estado: PENDIENTE | APROBADO | RECHAZADO | null` = `ReintegroPedidoWeb.estado`, o `null` sin saga;
- `nota_credito: { tipo, fecha_emision, monto } | null`.

Reglas:

- `motivo` y `fecha_terminacion` son `null` donde no correspondan; se conservan la fecha del pedido y `plazo_retiro_vencimiento`.
- `comprobante` es siempre el comprobante fiscal original y una NC HU-E13 nunca lo reemplaza; `nota_credito` es la NC vinculada al original, o `null`; ambos usan el DTO mínimo `{ tipo, fecha_emision, monto }`, sin IDs internos.
- La lectura individual de comprobante E9 acepta la misma visibilidad histórica que el detalle.
- No se exponen `reintegro_id`, ID/número de intento, `refund_id`, `mercadopago_payment_id`, clave idempotente, `ultimo_error_codigo`, errores técnicos, G11, actor administrativo ni motivo de reintento manual.

Tests a adaptar: la aserción que hoy prohíbe `reintegro` en el detalle serializado pasa a verificar `reintegro_estado` y la ausencia de los campos prohibidos; agregar casos con NC emitida (original en `comprobante`, NC en `nota_credito`) y terminal legacy sin saga (`reintegro_estado = null`).

**Dependencias previas:** T10 y T11 aprobadas.

**Tests focales obligatorios:** dueño/ajeno; listado/detalle; terminal con y sin saga; inactivo no terminal; QR; cache privada; comprobante original/NC sin secretos; regresión E9.

**Criterio de aceptación:** historial visible sin reactivar registro ni ampliar operaciones permitidas.

**Criterio de STOP:** requiere eliminar globalmente filtros soft-delete o revelar datos operativos.

**Riesgos/regresiones:** IDOR; terminal entra en cola; cambiar paginación/orden; QR histórico expuesto.

**Cierre:** presentar matriz E9 y **STOP**.

---

## T14 — UI Cliente Web

**Objetivo:** permitir cancelación propia y visualizar historial/reintegro conforme a E9.

**Alcance exacto:** botón solo en `PAGO_CONFIRMADO`; diálogo motivo+confirmación; llamada a API; feedback `PENDIENTE/APROBADO/RECHAZADO`; refresh server-side; terminal histórico.

**Archivos autorizados:** `MisPedidosListado.tsx`, `DetallePedidoWeb.tsx`, páginas `/tienda/cuenta/pedidos/**`, tests de componentes E9/HU-E13.

**Contrato:** no acción fuera de `PAGO_CONFIRMADO`; UI no sustituye autorización; sin claves/refund_id/error interno; 409 de carrera refresca estado ganador.

**Addendum post-T17 (SPEC §2.13.16.2–§2.13.16.3):** el detalle Cliente Web puede mostrar motivo terminal, fecha de terminación, estado agregado del reintegro, comprobante original y Nota de Crédito opcional. Es presentación del contrato E9, no lógica financiera nueva: T14 no permite retry, no muestra detalles técnicos, no muestra claves ni IDs de pago o refund, y no crea polling.

**Dependencias previas:** T11 y T13 aprobadas.

**Tests focales obligatorios:** visibilidad por estado; motivo; pending; éxito/error; carrera; terminales; responsive/accesibilidad básica; no exposición de campos.

**Criterio de aceptación:** cliente puede iniciar cancelación válida y comprender estado durable sin datos sensibles.

**Criterio de STOP:** necesita self-fetch inseguro, actor/cliente en body o lógica de transición local.

**Riesgos/regresiones:** UI optimista falsa; doble submit; romper navegación/caché E9.

**Cierre:** presentar pruebas UI y **STOP**.

---

## T15 — UI administrativa de cancelación y reintegro

**Objetivo:** operar cancelaciones permitidas y resolver refunds rechazados desde una lectura administrativa durable específica de HU-E13.

**Precondición contractual — Addendum de lectura administrativa:** mantener `/ecommerce/pedidos` sin cambios como pantalla HU-E7 de `PAGO_PENDIENTE | PAGO_RECHAZADO` y crear `/ecommerce/pedidos/pagados`, nombre funcional **Pedidos pagados / Gestión de pedidos pagados**. La pantalla nueva exige únicamente `PERMISO_CANCELAR_PEDIDO_PAGADO = ecommerce:cancelar_pedido_pagado`; no exige permiso HU-E7, no autoriza por nombre de rol y no crea permiso.

**Alcance exacto:** Server Component + servicio dedicado, conceptualmente `listarPedidosPagadosAdmin(...)`; listar exclusivamente `PAGO_CONFIRMADO | EN_PREPARACION | LISTO_PARA_RETIRO | CANCELADO | VENCIDO_SIN_RETIRO`; motivo; estado seguro de saga; acción de reintento manual solo en `RECHAZADO` sin intento pendiente; feedback y refresh. No crear API pública de lectura adicional salvo necesidad técnica real.

**Filtro y paginación:** aplicar en PostgreSQL antes de paginar: `(is_active = true AND deleted_at IS NULL AND estado IN cancelables) OR (is_active = false AND deleted_at IS NOT NULL AND estado IN (CANCELADO, VENCIDO_SIN_RETIRO))`, más criterios normales de `PedidoVenta` WEB; ejecutar `count`, `orderBy`, `skip` y `take` sobre el conjunto completo. No incluir `PAGO_PENDIENTE`, `PAGO_RECHAZADO`, `ENTREGADO`, `ANULADO` ni anexar terminales después de paginar. La excepción es local y no modifica soft-delete global.

**DTO mínimo por fila:** `{ pedido_venta_id, numero, fecha, total, estado_ecommerce, plazo_retiro_vencimiento, reintegro: null | { estado: PENDIENTE | APROBADO | RECHAZADO, tiene_intento_pendiente }, acciones: { cancelar_pedido, reintentar_reintegro } }`. Puede conservar identificación comercial segura ya usada por administración, sin ampliar PII.

**Reglas calculadas por backend:**

- `acciones.cancelar_pedido = true` únicamente para `PAGO_CONFIRMADO | EN_PREPARACION | LISTO_PARA_RETIRO`;
- `acciones.reintentar_reintegro = true` únicamente si `ReintegroPedidoWeb.estado = RECHAZADO` y no existe `ReintegroRefundIntento.estado = PENDIENTE`;
- si no existe saga, `reintegro = null` y `reintentar_reintegro = false`;
- la UI no infiere elegibilidad desde estado comercial, tiempo, ausencia de refund ID ni mensajes visuales;
- T11 conserva autoridad definitiva ante carreras.

**Mutaciones:** `Cancelar pedido` usa `PATCH /api/ecommerce/pedidos/[id]/cancelar`; `Reintentar reintegro` usa `POST /api/ecommerce/pedidos/[id]/reintegro/reintentar`; ambas envían solo `{ motivo }` y refrescan/revalidan la lectura administrativa después de responder.

**Datos prohibidos:** no seleccionar, devolver ni renderizar ID de saga/intento, número de intento, clave idempotente, payment/refund ID, `nota_credito_id`, `contra_asiento_ingreso_id`, error técnico, actor/motivo histórico ni payload MP.

**Archivos autorizados:** nueva página `src/app/(dashboard)/ecommerce/pedidos/pagados/page.tsx`; componente administrativo HU-E13; servicio/DTO administrativo específico y tests. Navegación administrativa solo para incorporar “Pedidos pagados” según el patrón de permiso existente. Los archivos HU-E7 `/ecommerce/pedidos`, su servicio/DTO y permiso conservan su semántica.

**Dependencias previas:** T11, T12 y el Addendum de lectura administrativa T15 aprobados.

**Tests focales obligatorios:** permiso exacto sin permiso HU-E7 adicional; estados incluidos/excluidos; baja lógica local; count/orden/páginas; DTO sin secretos; fórmulas de ambas acciones; motivo; cancelación; rechazo; retry manual; intento pendiente; doble click; aprobado; carreras/409; refresh y errores seguros.

**Criterio de aceptación:** administrador autorizado puede operar el contrato completo desde `/ecommerce/pedidos/pagados`; HU-E7 permanece intacta; elegibilidad deriva de estado durable backend y no se accede a secretos.

**Criterio de STOP:** requiere permiso/rol/estado nuevo, altera contratos T07/T08/T11, expone internos, relaja soft-delete global o necesita inferir elegibilidad de reintento fuera del DTO aprobado.

**Riesgos/regresiones:** mezclar órdenes no pagadas HU-E7; paginar activos y anexar terminales; mostrar errores técnicos; habilitar segundo refund tras aprobado; tratar ocultación frontend como autorización.

**Cierre:** presentar contrato de lectura, matriz UI admin, evidencia de HU-E7 intacta y **STOP**.

---

## T16 — UI Pick & Pack con nueva semántica

**Objetivo:** representar correctamente pedidos nuevos `PAGO_CONFIRMADO` no tomados y `EN_PREPARACION` tomados.

**Alcance exacto:** cola, badges/acciones, toma y refresh; terminales/inactivos fuera; compatibilidad visual con legacy sin reescribirlo.

**Archivos autorizados:** `ConsolaPickPack.tsx`, `PreparacionPedidoPanel.tsx`, cliente Pick & Pack y tests de componentes asociados; página de preparación si es necesaria.

**Contrato:** tomar es la única acción que transiciona nuevo pedido; scans/completar solo tras toma; no crear estado nuevo; no mutar legacy para presentarlo.

**Dependencias previas:** T10 aprobada.

**Tests focales obligatorios:** cola nueva; toma; dos operadores/409; refresh; legacy visible conforme al servicio; terminal ausente; prioridad/progreso sin regresión.

**Criterio de aceptación:** UI refleja, no inventa, la máquina del servidor.

**Criterio de STOP:** UI necesita cambiar estados directamente o excluir datos legacy válidos para “normalizarlos”.

**Riesgos/regresiones:** botón scan antes de asignación; estado cacheado; romper consola móvil.

**Cierre:** presentar pruebas UI Pick & Pack y **STOP**.

---

## T17 — Integración real PostgreSQL end-to-end

**Objetivo:** demostrar el circuito completo con servicios/rutas reales y DB aislada.

**Alcance exacto:** checkout/pago → cola/toma o cancelación → NC/stock/G11/refund; preparación/LISTO → vencimiento o E3; recordatorio; E9; eventos; reintento manual.

**Archivos autorizados:** crear `hu-e13.integration.test.ts`, `hu-e13.http.integration.test.ts` y fixtures aislados; `package.json` solo para scripts siguiendo convención; no cambiar dominio para facilitar tests.

**Contrato:** usar PostgreSQL real migrado/seed; MP simulado determinista que respeta keys; no mocks para transacciones/constraints; DB identificada como test.

**Dependencias previas:** T09, T10, T11, T12, T13, T14, T15 y T16 terminadas y aprobadas.

**Tests focales obligatorios:** circuito cliente; admin en tres estados; vencimiento; multi-item/multi-depósito; NC; tres G11; aprobado/timeout/rechazo/manual; E9/F3/D; cron dos pasadas.

**Criterio de aceptación:** suite repetible desde DB fresca y desde snapshot migrado, sin limpiar mediante operaciones destructivas dentro de código productivo.

**Criterio de STOP:** la suite requiere bypass de auth, constraints o adapter real; usa DB no identificada como test.

**Riesgos/regresiones:** fixtures irreales; listener async no drenado; dependencia de orden; simulador más permisivo que F1.

**Addendum post-T17 (PLAN §9.6):** T17 detectó tres divergencias contractuales, resueltas en SPEC §2.13.16: destinatarios/prioridad F3 de T09, DTO E9/comprobantes de T13–T14 y respuesta de cancelación T11. Sus flujos funcionales PostgreSQL y HTTP pasaron; los resultados históricos de T17 no se modifican. T17 no se considera cerrada hasta aplicar las correcciones documentales y de código de T09, T13 y T14. El AuditLog multiproceso queda como gate de T18 y el seed legacy como precondición de T19.

**Cierre:** presentar resultados y **STOP**.

---

## T18 — Concurrencia y recuperación de crashes

**Objetivo:** verificar exhaustivamente exclusión mutua e idempotencia ante carreras/reintentos.

**Alcance exacto:** tests PostgreSQL coordinados con barreras/promesas; fallas inyectadas en fronteras de saga; no agregar lógica solo para test en producción.

**Archivos autorizados:** crear suite HU-E13 de concurrencia/crash; modificar helpers de test. Código productivo solo si la prueba revela un defecto dentro del contrato ya aprobado y requiere nueva autorización para esta task.

**Contrato:** un ganador y estado coherente en:

- cliente vs tomar;
- admin vs tomar;
- vencimiento vs E3;
- dos jobs;
- dos retries técnicos;
- dos reintentos manuales;
- doble inicio de cancelación/vencimiento;
- crash antes/después de cada commit y alrededor de F1.

**Dependencias previas:** T17 aprobada.

**Tests focales obligatorios:** todas las carreras anteriores en múltiples rondas; `40P01/P2034`; mismo header en retry; un movimiento por hija; una NC; un contra-asiento; como máximo un refund aprobado.

**Criterio de aceptación:** invariantes deterministas después de cada carrera; ninguna duplicación; retry DB nunca repite llamada externa.

**Criterio de STOP:** lock inversion, resultado no determinista o necesidad de nueva constraint no aprobada.

**Riesgos/regresiones:** test que pasa sin simultaneidad real; deadlock oculto; falsa garantía por simulador local.

**Addendum post-T17 — gate AuditLog multiproceso (PLAN §9.4):** la integridad SHA-256 del AuditLog debe conservarse con escritores desde **procesos distintos**; el lock en memoria del proceso (`colaLedger`) no es garantía suficiente.

- **Solución congelada, sin schema ni migration:**
  - cada append corre en su propia transacción PostgreSQL;
  - primero `pg_advisory_xact_lock` con clave fija dedicada al ledger AuditLog;
  - luego, en la misma transacción: deduplicación idempotente si corresponde, lectura del registro anterior por `created_at DESC, id DESC`, cálculo SHA-256 e `INSERT`;
  - el commit libera el lock.
- La cola en memoria puede mantenerse como optimización local, no como frontera de corrección.
- **Prueba obligatoria con procesos del sistema operativo distintos:** servidor + `job:reservas`, o dos procesos Node independientes. No alcanza `Promise.all` en un único proceso.
- Al finalizar: `verificarCadenaIntegridad().integra === true` y ausencia de AuditLog idempotente duplicado.
- **Archivo productivo autorizado adicional:** el servicio central de AuditLog del Módulo D (`src/lib/services/auditoria/audit-log.service.ts`), exclusivamente para resolver este defecto de concurrencia revelado por HU-E13.

**Cierre:** presentar resultados por carrera y **STOP**.

---

## T19 — VERIFY final D17/R22

**Objetivo:** ejecutar el gate integral que autoriza considerar HU-E13 implementada.

**Alcance exacto:** ejecutar, no ampliar funcionalidad; consolidar evidencia de todas las suites focales/integración, migration, cron y build.

**Archivos autorizados:** ninguno productivo. Solo reporte de resultados dentro de la posterior documentación de T20; si falla algo, volver a la task propietaria con nueva autorización.

**Contrato y evidencia mínima obligatoria:**

- pago → `PAGO_CONFIRMADO` y cola inmediata;
- toma → `EN_PREPARACION` + operador atómico;
- cancelación cliente;
- cancelación admin desde los tres estados;
- estados prohibidos y motivo obligatorio;
- vencimiento, QR consumido y B `FACTURADO`;
- recordatorio único;
- stock multi-item/SKU/depósitos;
- NC única y original inmutable;
- G11 creado/existente/no encontrado;
- refund aprobado;
- retry técnico con misma key;
- timeout/resultado incierto;
- rechazo definitivo sin retry automático;
- reintento manual con hijo/key nuevos;
- imposibilidad de doble refund aprobado;
- E9 histórico/IDOR/QR;
- F3 y AuditLog/hash/actores;
- cron aislado e idempotente;
- carreras E3/E12/E13, dos jobs/retries/manuales;
- snapshot legacy sin reinterpretación;
- regresión E2/E3/E6/E9/E12/G11/F1;
- suite completa, lint, typecheck y build.

**Dependencias previas:** T18 aprobada; T00–T17 quedan satisfechas transitivamente por el grafo.

**Tests focales obligatorios:** todos los anteriores; `prisma validate`; migration DB vacía + snapshot; suites unitarias/integración/HTTP/UI; mantenimiento dos veces; lint; typecheck; build.

**Criterio de aceptación:** todos los gates pasan con comandos/resultados reproducibles y sin exclusiones nuevas.

**Criterio de STOP:** cualquier fallo, flaky, warning de seguridad/datos, regresión o evidencia incompleta; no documentar como cerrado.

**Riesgos/regresiones:** ocultar fallos preexistentes sin evidencia; relajar lint/types/constraints; afirmar cobertura no ejecutada.

**Addendum post-T17 — precondición legacy del seed (PLAN §9.5):**

- Base vacía: `migrate` + seed normal.
- Snapshot legacy: `migrate deploy`; **no** ejecutar el seed global mientras exista el desajuste histórico `permiso.codigo` / UUID (`ecommerce:priorizar_cola`: mismo código, otro UUID → P2002).
- El snapshot puede requerir configuración dirigida de `ECOMMERCE_RECORDATORIO_RETIRO_HORAS` y provisionado idempotente del conector F1 con sus servicios productivos/de setup aprobados.
- No insertar datos comerciales retroactivos ni alterar permisos legacy durante HU-E13.
- **Riesgo de despliegue:** ejecutar hoy el seed completo sobre una producción que conserve el UUID histórico puede producir P2002. La corrección general del seed queda fuera de HU-E13.

**Cierre:** presentar matriz VERIFY y **STOP**.

---

## T20 — Documentación de cierre HU-E13

**Objetivo:** registrar implementación y evidencia ya aprobadas sin mezclar cambios funcionales.

**Alcance exacto:** actualizar exclusivamente documentación de cierre autorizada por el usuario en esa etapa; inventariar archivos, migrations, contratos, pruebas, resultados, riesgos remanentes y operación del cron.

**Archivos autorizados:** por defecto, este `HU13_TASKS.md` y/o `HU13_MODULO_E.md` solo si una autorización futura lo indica expresamente. SPEC permanece congelada salvo nueva revisión formal separada.

**Contrato:** describir estado real; no afirmar commit/PR/merge; no alterar decisiones; distinguir pruebas automáticas, manuales y pendientes.

**Dependencias previas:** T19 aprobada.

**Tests focales obligatorios:** revisión cruzada de referencias, comandos/resultados y lista de archivos contra el diff real; no requiere reimplementar ni reejecutar salvo evidencia vencida.

**Criterio de aceptación:** cierre auditable que coincide con código, migration y VERIFY aprobados.

**Criterio de STOP:** evidencia incompleta, discrepancia con SPEC/PLAN, o necesidad de modificar comportamiento para “cerrar” documentación.

**Riesgos/regresiones:** declarar completado lo no verificado; modificar fuente funcional congelada; mezclar documentación con fixes.

**Cierre:** presentar documento final y **STOP**.

---

## 2. Gates principales resumidos

| Gate | Tasks | Condición para avanzar |
|---|---|---|
| Datos/migration | T00–T02 | snapshot sin estados reinterpretados; schema aditivo; seed idempotente |
| Owners de dominio | T03–T06 | B/A/G/F con contratos aislados y regresiones verdes |
| Saga | T07–T08 | progreso durable, crash recovery y un solo refund aprobado |
| Integraciones E | T09–T13 | eventos, cola/toma, APIs, cron e historia cerrados |
| Presentación | T14–T16 | UI consume contratos aprobados, sin lógica de dominio |
| PostgreSQL/concurrencia | T17–T18 | circuito real y carreras deterministas |
| Release gate | T19 | D17/R22 + calidad completa |
| Cierre | T20 | documentación fiel a evidencia |

## 3. Contradicciones detectadas

No se detecta una incompatibilidad nueva entre la SPEC Rev.3, el PLAN Rev.2 y esta descomposición.

Los siguientes son criterios de STOP, no contradicciones resueltas por estas tasks:

- datos legacy sin evidencia suficiente se reportan y no se corrigen;
- si B/A no pueden cerrar creación + vínculo mediante la transacción y constraints HU-E13, no se agrega una clave genérica: se vuelve a revisión;
- si una carrera exige cambiar máquina de estados, permiso, canal o contrato F1, se vuelve a SPEC/PLAN.

---

## 4. Registro de ejecución y cierre T20 — 08/10/2026

**HU-E13: CERRADA — COMPLETADA / VERIFY PASS.** Todas las tasks quedaron aprobadas individualmente. La evidencia consolidada, el recorrido funcional, el checklist de despliegue y la deuda fuera de alcance están en `HU13_MODULO_E.md` §10.

| Task | Estado | Resultado aprobado |
|---|---|---|
| T00 | ✅ | Preflight legacy de solo lectura y baseline de regresión; anomalías reportadas sin corregir |
| T01 | ✅ | Schema Prisma y migration aditiva `20261008120000_hu_e13_reintegros` |
| T02 | ✅ | `ECOMMERCE_RECORDATORIO_RETIRO_HORAS = 24` idempotente; permiso existente reutilizado sin duplicar |
| T03 | ✅ | Nota de Crédito HU-E13 idempotente vinculada al original inmutable |
| T04 | ✅ | Compensación multi-item `VENDIDO → DISPONIBLE` por línea |
| T05 | ✅ | G11 discriminado `CREADO / YA_EXISTENTE / INGRESO_ORIGINAL_NO_ENCONTRADO` |
| T06 | ✅ | Refund F1 total con `X-Idempotency-Key` |
| T07 | ✅ | Saga: Paso 0 bajo locks, baja lógica y pasos locales |
| T08 | ✅ | Refund, retry técnico con backoff congelado y reintento manual |
| T09 | ✅ | Eventos, AuditLog y F3; corregido post-T17: solo Cliente Web y vencimiento `CRITICA` |
| T10 | ✅ | E2/E12: `PAGO_CONFIRMADO` en cola y toma atómica |
| T11 | ✅ | APIs de cancelación Cliente/Admin y reintento manual |
| T12 | ✅ | Cron: recordatorio, vencimiento y retries aislados e idempotentes |
| T13 | ✅ | E9 histórico; corregido post-T17: motivo, fechas, estado de reintegro y comprobante original + NC |
| T14 | ✅ | UI Cliente Web; corregida post-T17 y en T19 (formato de fechas determinista) |
| T15 | ✅ | UI administrativa `/ecommerce/pedidos/pagados` |
| T16 | ✅ | UI Pick & Pack con la nueva semántica de toma |
| T17 | ✅ | Integración PostgreSQL end-to-end (servicio 12 PASS, HTTP 10 PASS) |
| T18 | ✅ | Concurrencia, crash recovery y AuditLog multiproceso con `pg_advisory_xact_lock` (19 PASS) |
| T19 | ✅ | VERIFY D17 PASS en base fresca y clon legacy; `npm test` 806/3 baseline; tsc, lint y build PASS; UI manual validada |
| T20 | ✅ | Cierre documental en SPEC (nota no normativa §2.13.17), PLAN §10 y este registro |

**Incidencias de T19 resueltas sin defecto de dominio:** (1) hydration mismatch de fechas, resuelto con `formatearFechaNegocio`/`formatearFechaHoraNegocio` en `src/lib/utils/fecha-negocio.ts`; (2) la base local de trabajo tenía 29/33 migraciones y el detalle E9 fallaba en ese entorno, resuelto operativamente con backup y `migrate deploy`.

**R1–R22:** la documentación heredada no los enumera (solo R1, R2, R6, R9 y R15). T19 verificó D17 completo, los R identificables y todos los gates de T19. Queda como deuda documental preexistente, no como defecto funcional de HU-E13.

**Fuera de alcance, sin resolver:** seed legacy P2002; verificadores A/B ordenados solo por `created_at`; espera heurística de `pick-pack.audit`; flag experimental de `RetiroPedidoPanel`; base dedicada E9; pedidos legacy con evidencia inconsistente; fechas no deterministas en `PedidosWebAdmin`, `CuentasWebCliente` y `CuponesCliente`; cron sin `CRON_SECRET` en development. Detalle en `HU13_MODULO_E.md` §10.11.

Ninguna task posterior queda autorizada por este registro.

---

**HU-E13 TASKS REV2 LISTAS PARA AUDITORÍA**

**STOP.**
