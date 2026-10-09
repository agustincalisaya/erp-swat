# HU-E2 — Pago online con Mercado Pago y comprobante fiscal digital (Módulo E)

**Issue de GitHub:** #<completar número de ticket>
**Rama:** `feature/HU-E-02` (mergeada a `develop`) + integración en `feature/HU-E2-integracion`
**Sprint:** Sprint 4, Módulo E (Canal de Venta Online)
**Rol:** Cliente Web

## Resumen

Se implementó el pago online de los pedidos de la tienda web mediante Mercado Pago (Checkout Pro). Al iniciar la compra, el sistema reserva el stock, registra el `PedidoVenta` del canal `WEB` con el precio congelado y el cupón aplicado, y crea una preferencia de pago por pedido; el cliente paga en el sitio de Mercado Pago y nunca carga datos de tarjeta en SWAT. La confirmación llega por un webhook autenticado por firma: el sistema consulta el pago a la API de Mercado Pago y, en una única transacción, pasa el stock a `VENDIDO`, factura el pedido con Factura B, consume el cupón, registra la transacción de pago (HU-E6) y admite el pedido en la cola de preparación (HU-E12). Un pago rechazado libera la reserva de inmediato, anula el `PedidoVenta` y reconstruye el carrito para reintentar. Los pagos que no corresponde aplicar (monto distinto, tardío, duplicado, huérfano) se registran como anomalías auditadas sin modificar el pedido. La entrega original incluyó versiones mínimas provisorias de HU-F1, HU-E4 y HU-F3, que en la integración posterior quedaron reemplazadas o adoptadas por sus owners.

## Objetivo

Permitir que el Cliente Web complete el pago online de su pedido mediante Mercado Pago y reciba la confirmación con su comprobante fiscal digital, para tener respaldo inmediato de la compra sin exponer datos de tarjeta al sistema de SWAT.

## Alcance

**Implementado:**

- **CA1 — Pago íntegro en Mercado Pago:** Checkout Pro con una preferencia por pedido (`external_reference` = `PedidoVentaEcommerce.id`); la tarjeta se carga en Mercado Pago. SWAT solo persiste `mercadopago_preference_id`, `mercadopago_checkout_url` y `mercadopago_payment_id`.
- **CA2 — Webhook autenticado:** `POST /api/webhooks/mercadopago` valida `x-signature` + `x-request-id` contra la clave secreta del Conector `ACTIVO`; una firma inválida o ausente responde `401 FIRMA_INVALIDA` sin procesar ni registrar nada. Excepciones: los avisos en formato IPN (`?id=…&topic=…`, sin `type`) responden `200 SIN_EFECTO` sin procesar y solo dejan traza; y **solo en SANDBOX**, un aviso de pago con HMAC distinto se procesa igual (ver "Limitación de Mercado Pago con cuentas de prueba" en deuda técnica).
- **CA3 — Idempotencia:** transición condicionada `UPDATE … WHERE estado_ecommerce = 'PAGO_PENDIENTE'` como guarda de negocio, más `mercadopago_payment_id @unique`. Una notificación repetida o concurrente nunca genera una segunda confirmación.
- **CA4 — Pedido de Venta del Módulo B:** `PedidoVenta` con `canal = WEB`, registrado por el usuario de sistema `canal.web.sistema`, sin turno de caja (`turno_caja_id = null`) ni intervención de un Cajero POS.
- **CA5 — Importe del servidor:** el total sale de los precios congelados al iniciar el checkout (HU-B9) menos el cupón (HU-E4); el body del checkout solo admite `cupon_codigo` (un body con `total` o `monto` responde `400`). Al confirmar, el monto informado por Mercado Pago debe coincidir centavo a centavo con `PedidoVenta.total` y la moneda debe ser `ARS`.
- **CA6 — Confirmación en un único flujo transaccional:** stock `RESERVADO → VENDIDO` (Módulo A), `PedidoVenta` `RESERVADO → FACTURADO` con `VentaMedioPago MERCADO_PAGO`, Factura B simulada (HU-B7), consumo del cupón, fila `TransaccionPagoLog` `APROBADO` (HU-E6) y admisión a la cola `EN_PREPARACION` (HU-E12), todo en un solo commit. El ingreso de Tesorería (HU-G11) se registra por evento post-commit.
- **CA7 — Rechazo:** liberación inmediata de las reservas (motivo `PAGO_RECHAZADO`), `PedidoVentaEcommerce` en `PAGO_RECHAZADO` y activo (no se elimina), `PedidoVenta` `ANULADO` con baja lógica, cupón dado de baja, carrito reconstruido para un nuevo checkout y fila `TransaccionPagoLog` `RECHAZADO`. El rechazo queda auditado (`ecommerce:pago_rechazado`).
- Páginas de la tienda: `/tienda/checkout/pendiente` (botón "Pagar con Mercado Pago") y `/tienda/checkout/resultado` (estado leído siempre de la base).
- Simulador local de Mercado Pago (`MP_MODO=simulado`, prohibido en producción) y script `npm run mp:firmar` para probar el webhook sin cuenta de Mercado Pago.

**Fuera de alcance:**

- Reembolsos: la operación `solicitarReembolso()` la aportó HU-F1 y la consume HU-E13; E2 no reembolsa (pagos tardíos y duplicados se resuelven manualmente).
- Health-check, alta, baja, bitácora y panel del Conector de Mercado Pago (HU-F1, Rama).
- Cola de preparación, toma y escaneo de pedidos (HU-E12, Emir). E2 solo invoca la admisión dentro de su transacción.
- ABM, mantenimiento y reglas completas de cupones (HU-E4, Tomas). E2 consume `aplicarCuponTx()`, `confirmarAplicacionCuponTx()` y `darDeBajaAplicacionCuponTx()`.
- Checkout Bricks (se eligió Checkout Pro).
- Re-reserva de stock ante un pago tardío y anulación de órdenes no abonadas (HU-E7).

## Modelo de datos

**Migración `20261001200000_hu_e2_pago_mercadopago`** (no toca el índice único parcial `carritos_web_cuenta_activa_key` de HU-E1):

- `PedidoVentaEcommerce.mercadopago_payment_id String? @unique` — antes sin unicidad. Un pago de Mercado Pago se imputa a un único pedido; PostgreSQL admite varios `NULL`.
- `PedidoVentaEcommerce.mercadopago_preference_id String? @unique` — **nuevo.** Una preferencia de Checkout Pro por pedido; reintentar el pago reutiliza la guardada.
- `PedidoVentaEcommerce.mercadopago_checkout_url String?` — **nuevo.** `init_point` de la preferencia, para devolverlo sin volver a llamar a Mercado Pago.
- `WebhookPagoLog`: se **quitó** `@@unique([mercadopago_payment_id, topic])` (pasa a traza append-only), se agregaron `request_id String?` (header `x-request-id`) y `resultado String @default("RECIBIDO")` (`CONFIRMADO` | `RECHAZADO` | `PENDIENTE` | `SIN_EFECTO` | `ANOMALIA` | `ERROR`), y el índice `@@index([mercadopago_payment_id])`.

**Enums existentes reutilizados (sin cambios):** `EstadoEcommerce` (`PAGO_PENDIENTE`, `PAGO_CONFIRMADO`, `PAGO_RECHAZADO`, `EN_PREPARACION`, …), `CanalVenta.WEB`, `TipoComprobanteVenta.FACTURA_B`, `MedioPagoVenta.MERCADO_PAGO`, `OrigenReserva.CHECKOUT_WEB` (de HU-E1) y `EstadoPedidoVenta` (`RESERVADO`, `FACTURADO`, `ANULADO`).

**Campos y modelos de otras HU que E2 escribe dentro de su transacción:**

- `PedidoVentaEcommerce.fecha_pago_confirmado` (columna de la migración `hu_e12_pick_pack`): E2 la fija con `date_approved` en la misma transición que confirma el pago.
- `PedidoVentaEcommerce.estado_ecommerce = EN_PREPARACION`: lo escribe `admitirPedidoPagoConfirmado(tx, pedidoVentaId)` de HU-E12, como última mutación de dominio del commit de E2.
- `TransaccionPagoLog` (HU-E6): una fila `APROBADO` o `RECHAZADO` dentro de la transacción, con `datos_facturacion_cifrados` + `datos_facturacion_iv` (AES-256-GCM) y `resultado_webhook` sin datos de tarjeta ni de facturación. Las anomalías dejan una fila `ANOMALIA` fuera de la transacción (ver reglas). Los comentarios de `estado_pago` en el schema ya incluyen `ANOMALIA` (sin migración).
- `ComprobanteFiscal` (`FACTURA_B`, simulado), `VentaMedioPago` (`MERCADO_PAGO`, `referencia = payment_id`), `MovimientoStock` (`RESERVADO → VENDIDO` / `RESERVADO → DISPONIBLE`), `CuponAplicacion` (`confirmada` o baja lógica) y `CarritoWeb` / `ItemCarritoWeb` (reconstrucción tras el rechazo).
- `IngresoTesoreria` (HU-G11): **no** lo escribe E2; lo crea el listener de G11 a partir de `ecommerce:pedido_pago_confirmado`.

## Reglas de negocio implementadas

- **Importe calculado en el servidor:** `PedidoVenta.total` se calcula con los precios congelados y queda neto del cupón (`aplicarDescuentoPedidoVentaTx()`, nunca negativo). La preferencia lleva una sola línea ("Pedido V-AAAA-NNNNNN — SWAT Indumentarias", `quantity = 1`, `unit_price = total`). El webhook nunca toma estado, monto ni referencia del body: los obtiene de `consultarPago()`.
- **Firma obligatoria:** esquema real de Mercado Pago. Header `x-signature: ts=<ts>,v1=<hex>`, manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (con `data.id` en minúsculas) firmado con HMAC-SHA256 y la clave secreta del Conector `ACTIVO`, comparación en tiempo constante (`timingSafeEqual`) y tolerancia anti-replay de 15 minutos. Sin Conector `ACTIVO`, sin firma o con firma alterada → `401 FIRMA_INVALIDA`, sin distinguir la causa.
- **Idempotencia por transición condicionada:** cada transacción empieza con `updateMany … WHERE estado_ecommerce = 'PAGO_PENDIENTE'`; si no afecta filas, la notificación se clasifica (`clasificarAprobadoSobreResuelto()`): mismo `payment_id` → `SIN_EFECTO`; pedido `PAGO_RECHAZADO` o `ANULADO` → `PAGO_TARDIO`; otro `payment_id` → `PAGO_DUPLICADO`. Un `P2002` sobre `mercadopago_payment_id` también se trata como `PAGO_DUPLICADO`.
- **Factura B fija:** el Cliente Web no elige el tipo de comprobante; se emite `FACTURA_B` simulada (HU-B7) con `emitido_por_id = canal.web.sistema`.
- **Canal `WEB` sin caja:** el pedido lo registra el usuario de sistema `canal.web.sistema` (`usuario-canal-web.ts`), sin turno de caja ni Cajero POS.
- **Rechazo:** liberación inmediata de las reservas (`liberarReservasTx(…, "PAGO_RECHAZADO")`), `PedidoVenta` `RESERVADO → ANULADO` con baja lógica (`anularPedidoVentaTx()`, `deletion_reason` "Pago rechazado por Mercado Pago (<status_detail>)"), `PedidoVentaEcommerce` `PAGO_RECHAZADO` activo, baja lógica de la aplicación del cupón y carrito reconstruido con variante y cantidad (`reconstruirCarritoDesdePedidoTx()`; si la cuenta ya tiene un carrito activo, los ítems se suman). El reintento es un checkout **nuevo**, que re-valida, re-reserva y re-congela precios.
- **Pago pendiente:** `pending` / `in_process` no transicionan nada: `200` y traza `PENDIENTE`. La notificación siguiente del mismo pago resuelve.
- **Anomalías (nada se confirma ni se libera; respuesta `200` a Mercado Pago; evento `ecommerce:pago_anomalo`):**
  - `MONTO_DISCREPANTE`: monto o moneda distintos de `PedidoVenta.total` / `ARS`. El pedido queda `PAGO_PENDIENTE` con la reserva intacta.
  - `PAGO_TARDIO`: aprobado sobre un pedido `PAGO_RECHAZADO` o `ANULADO`, o con alguna reserva vencida aunque el job no la haya liberado. Reembolso manual.
  - `PAGO_DUPLICADO`: otro pago aprobado para un pedido ya resuelto.
  - `PAGO_HUERFANO`: `external_reference` ausente, no UUID o sin pedido. Sin fila en `TransaccionPagoLog` (no hay pedido y la FK es obligatoria); queda en `WebhookPagoLog` y `AuditLog`.
  - `CUPON_LIMITE_EXCEDIDO`: **único motivo con el pago sí confirmado.** El cupón ya había alcanzado su límite sin contar esta aplicación (con la capacidad `C + P` de HU-E4 solo ocurre con datos previos a E4). No genera fila `ANOMALIA`: la fila `APROBADO` lleva `"motivo":"CUPON_LIMITE_EXCEDIDO"` en `resultado_webhook`.
  - `MONTO_DISCREPANTE`, `PAGO_TARDIO` y `PAGO_DUPLICADO` dejan una fila `TransaccionPagoLog` con `estado_pago = "ANOMALIA"` y el motivo como primer campo de `resultado_webhook`, idempotente por `(mercadopago_payment_id, motivo)` mediante `pg_advisory_xact_lock` (sin migración).
- **Vencimiento y cierre de la preferencia:** la preferencia vence con la reserva del checkout (`expiration_date_to`, la menor `fecha_expiracion` de las reservas) y excluye medios offline (`ticket`, `atm`) y pagos en revisión (`binary_mode`). Al rechazarse el pago, la preferencia se cierra (`cerrarCobro()`, `expiration_date_to = ahora`) de forma best-effort post-commit: si falla, un aprobado posterior cae en `PAGO_TARDIO`.
- **Sin datos de tarjeta:** el sistema nunca recibe ni guarda números de tarjeta, CVV ni datos del medio de pago; los payloads de eventos y `resultado_webhook` tampoco llevan datos de facturación en claro.
- **Llamadas de red fuera de las transacciones:** la preferencia se crea después del commit del checkout (si Mercado Pago falla, el pedido queda `PAGO_PENDIENTE` y la preferencia se crea en el reintento) y la consulta del pago se hace antes de abrir la transacción.

## Arquitectura y archivos

**Archivos nuevos:**

- `src/lib/integraciones/mercadopago/tipos.ts` — puerto de dominio (`IniciarCobroInput`, `CobroIniciado`, `PagoConsultado`, `EstadoPagoDominio`). HU-F1 agregó `ReembolsoSolicitado` y `EstadoReembolsoDominio`.
- `src/lib/integraciones/mercadopago/conector.ts` — `obtenerConectorActivo()` (Conector `ACTIVO` del entorno con credenciales descifradas) y `registrarInvocacion()` (bitácora `InvocacionConectorPago`). HU-F1 agregó `obtenerConectorPorId()` y las operaciones `SOLICITAR_REEMBOLSO` / `HEALTH_CHECK`.
- `src/lib/integraciones/mercadopago/adapter.ts` — `iniciarCobro()`, `consultarPago()` y `cerrarCobro()` por HTTP con `fetch` (sin SDK), timeout de 10 s y errores mapeados a `ServiceError` (`PASARELA_TIMEOUT`, `PASARELA_NO_DISPONIBLE`, `PASARELA_RECHAZO_CREDENCIALES`, `PAGO_NO_ENCONTRADO`, `PASARELA_RESPUESTA_INVALIDA`, `CONECTOR_NO_CONFIGURADO`). **HU-F1 (Rama) lo completó** con `solicitarReembolso()`, `healthCheck()`, `codigoErrorPorStatus()` y el contexto opcional de credenciales; el archivo es de HU-F1.
- `src/lib/integraciones/mercadopago/firma.ts` + `firma.test.ts` — validación pura de la firma y `generarFirmaWebhook()` para tests y script.
- `src/lib/integraciones/mercadopago/simulador.ts` — simulador local de `consultarPago()` (`.mp-simulador/pagos.json`); las ramas simuladas del resto de las operaciones viven en `adapter.ts`.
- `src/app/api/webhooks/mercadopago/route.ts` — webhook sin sesión: firma, filtro `type = payment`, procesamiento síncrono y traza.
- `src/lib/services/ecommerce/pago-web.service.ts` — `obtenerOCrearPreferencia()`, `procesarNotificacionPago()` (con pasarela inyectable para tests), confirmación, rechazo, anomalías, `obtenerResultadoPago()` y `registrarTrazaWebhook()`.
- `src/lib/services/ecommerce/pago-web.reglas.ts` + `pago-web.reglas.test.ts` — reglas puras: referencia UUID, comparación de montos en centavos, vigencia de reservas y clasificación del aprobado sobre un pedido resuelto.
- `src/lib/services/ecommerce/usuario-canal-web.ts` — resolución del usuario `canal.web.sistema`.
- `src/app/(tienda)/tienda/checkout/resultado/page.tsx` — página de retorno de Mercado Pago (`back_urls`).
- `scripts/firmar-webhook-mp.ts` (`npm run mp:firmar`) — registra pagos simulados y genera notificaciones firmadas para Postman.
- `src/lib/services/ecommerce/hu-e2.integration.test.ts` — integración sobre base descartable con pasarela falsa.
- `src/lib/services/ecommerce/cupon.service.ts` — creado como mínimo provisorio de HU-E4; **reemplazado** por la versión completa de HU-E4 (Tomas).

**Archivos modificados:**

- `prisma/schema.prisma` y migración `hu_e2_pago_mercadopago` — cambios de "Modelo de datos".
- `prisma/seed.ts` — Conector SANDBOX (credenciales de `MP_SANDBOX_*` o ficticias; creado solo si no hay otro `ACTIVO`), plantilla de notificación `ecommerce:pedido_pago_confirmado`, fixture `PAGO_PENDIENTE` (`V-2026-000004`) y `fecha_pago_confirmado` en los pedidos sembrados pagados.
- `src/lib/services/inventario/reserva.service.ts` (Módulo A) — `confirmarReservaPorVentaTx()` (con `confirmarReservaPorVenta()` como wrapper de firma idéntica), `liberarReservasTx()` y `emitirReservasLiberadas()`; motivo `PAGO_RECHAZADO` en `ReservaLiberadaPayload`.
- `src/lib/services/ventas/pedido-venta.service.ts` (Módulo B) — `facturarPedidoVentaTx()`, `anularPedidoVentaTx()` y `aplicarDescuentoPedidoVentaTx()`, sin cambiar firmas existentes.
- `src/lib/services/ecommerce/checkout.service.ts` — `iniciarCheckout(sesion, input = {})` con cupón y preferencia post-commit; `checkout_url` real.
- `src/lib/services/ecommerce/carrito.service.ts` — `reconstruirCarritoDesdePedidoTx()`.
- `src/lib/schemas/ecommerce.schema.ts` — `IniciarCheckoutSchema` (`cupon_codigo` opcional, `.strict()`).
- `src/app/api/tienda/checkout/route.ts` — body opcional validado con `IniciarCheckoutSchema`.
- `src/lib/services/ecommerce/respuesta-tienda.ts` — status de `CUPON_*` (`422`) y `PASARELA_*` (`502` / `503`).
- `src/app/(tienda)/tienda/checkout/pendiente/page.tsx` — botón "Pagar con Mercado Pago" y redirección a `/resultado` si el pedido ya se resolvió.
- `src/lib/events/event-types.ts` — `PedidoPagoConfirmadoPayload`, `PagoRechazadoPayload`, `PagoAnomaloPayload`, `MotivoPagoAnomalo`.
- `src/lib/events/listeners/audit-log.listener.ts` — handlers `PAGO_CONFIRMADO`, `PAGO_RECHAZADO` y `PAGO_ANOMALO` sobre `pedidos_venta_ecommerce`.
- `src/lib/events/listeners/notificacion.listener.ts` — suscripción de `ecommerce:pedido_pago_confirmado` al Cliente Web (adoptada por HU-F3).
- `eslint.config.mjs` — regla `no-restricted-imports`: el SDK `mercadopago` está prohibido en todo `src/`; el simulador solo se importa desde `lib/integraciones/mercadopago/**`; el Adapter y el Conector solo los consumen `lib/services/ecommerce/**`, el webhook y (por excepción agregada por HU-F1) `lib/services/integraciones/**`.
- `package.json` — tests unitarios nuevos y scripts `test:integration:e2` y `mp:firmar`.
- `.env.example` — `MP_SANDBOX_*`, `APP_PUBLIC_URL`, `MP_MODO`; `.gitignore` — `.mp-simulador/`.
- `src/lib/services/ecommerce/hu-e1.integration.test.ts` — espera `checkout_url` no nulo.

## Flujo transaccional

**Webhook (fuera de toda transacción):** validación de firma → `type ≠ payment` → `200 SIN_EFECTO` (sin traza) → `consultarPago(payment_id)` (si Mercado Pago no encuentra el pago → `SIN_EFECTO`; si falla → `500` para que Mercado Pago reintente) → `PENDIENTE` → `200` → referencia inválida o sin pedido → `PAGO_HUERFANO` → confirmación o rechazo. Al final, el route registra la traza en `WebhookPagoLog` con el resultado (o `ERROR` si se respondió `500`).

**Confirmación (`APROBADO`), una `prisma.$transaction` (timeout 15 s):**

1. `SELECT … FOR UPDATE` de `PedidoVenta` (jerarquía de locks acordada con HU-E12: `PedidoVenta → PedidoVentaEcommerce → ítems`).
2. Transición condicionada `PAGO_PENDIENTE → PAGO_CONFIRMADO` con `mercadopago_payment_id` y `fecha_pago_confirmado = date_approved`. Si no afecta filas → rollback y clasificación (`SIN_EFECTO` / `PAGO_TARDIO` / `PAGO_DUPLICADO`).
3. Lectura del pedido con el lock tomado y control de monto y moneda → si no coincide, rollback y `MONTO_DISCREPANTE`.
4. Control de reservas vigentes y `confirmarReservaPorVentaTx()` por ítem (`RESERVADO → VENDIDO`) → reserva vencida o ya cerrada: rollback y `PAGO_TARDIO`.
5. `facturarPedidoVentaTx()`: `PedidoVenta` `RESERVADO → FACTURADO`, `fecha_facturacion`, `cantidad_facturada` y `VentaMedioPago MERCADO_PAGO`.
6. `emitirComprobanteFiscal()`: Factura B simulada.
7. `confirmarAplicacionCuponTx()`, si el pedido tiene cupón (informa `limite_excedido`).
8. **HU-E12:** `admitirPedidoPagoConfirmado(tx, pedidoVentaId)` → `PAGO_CONFIRMADO → EN_PREPARACION`. Si falla, se revierte toda la confirmación.
9. **HU-E6:** `TransaccionPagoLog` `APROBADO` con facturación cifrada.
10. COMMIT. **Post-commit:** `stock:reserva_liberada { VENTA }` por reserva → `ecommerce:pedido_pago_confirmado` → `ecommerce:transaccion_pago_registrada` → `ecommerce:cupon_consumido` (si hubo cupón) → `ecommerce:pedido_admitido_cola` → `ecommerce:pago_anomalo { CUPON_LIMITE_EXCEDIDO }` (si corresponde) → `200`.

**Rechazo (`RECHAZADO`), una `prisma.$transaction`:**

1. Transición condicionada `PAGO_PENDIENTE → PAGO_RECHAZADO` con `mercadopago_payment_id`. Si no afecta filas → `200 SIN_EFECTO`.
2. Lectura de ítems, reservas, cliente y cuenta web.
3. `liberarReservasTx(…, "PAGO_RECHAZADO")`: `RESERVADO → DISPONIBLE` (las reservas ya cerradas se saltean).
4. `darDeBajaAplicacionCuponTx()`, si hay cupón.
5. `reconstruirCarritoDesdePedidoTx()`.
6. `anularPedidoVentaTx()`: `PedidoVenta` `ANULADO` con baja lógica.
7. **HU-E6:** `TransaccionPagoLog` `RECHAZADO` con facturación cifrada.
8. COMMIT. **Post-commit:** `stock:reserva_liberada { PAGO_RECHAZADO }` → `ecommerce:pago_rechazado` → `ecommerce:transaccion_pago_registrada` → `ecommerce:cupon_aplicacion_liberada` (si hubo cupón) → `cerrarCobro(preference_id)` best-effort → `200`.

**Anomalías:** la transacción de confirmación se revierte; después, `registrarTransaccionAnomala()` inserta la fila `ANOMALIA` en una transacción corta con lock por `(payment_id, motivo)` y emite `ecommerce:transaccion_pago_registrada`; luego se emite `ecommerce:pago_anomalo` y se responde `200`.

Los eventos se emiten siempre después del commit mediante `emitirEventoPostCommitSeguroE2()`, que captura las excepciones síncronas de los listeners para que nunca conviertan un pago ya confirmado en un error del webhook.

## Eventos de dominio

Todos se emiten post-commit por el bus en proceso (`domain-event-bus.ts`), **sin outbox**. Los consumidores deben ser **idempotentes por `mercadopago_payment_id`**, porque E2 no garantiza entrega exactamente una vez.

- **`ecommerce:pedido_pago_confirmado`** — `{ pedido_venta_id, pedido_venta_ecommerce_id, numero_venta, cliente_id, cliente_web_cuenta_id, mercadopago_payment_id, monto, moneda: "ARS", fecha_aprobacion, comprobante_id, cupon_aplicacion_id }` (`monto` = `PedidoVenta.total` neto de cupón). Consumidores: `audit-log.listener.ts` (`PAGO_CONFIRMADO`), `notificacion.listener.ts` (HU-F3, aviso "Recibimos tu pago" al Cliente Web, `clave_origen = pedido_venta_id`) y `ingreso-tesoreria.listener.ts` (HU-G11, `IngresoTesoreria` idempotente por `pedido_venta_id` o `mercadopago_payment_id`). Ya **no** es el disparador de la cola de HU-E12, que admite el pedido dentro de la transacción.
- **`ecommerce:pago_rechazado`** — `{ pedido_venta_id, pedido_venta_ecommerce_id, numero_venta, cliente_id, cliente_web_cuenta_id, mercadopago_payment_id, monto, moneda, fecha_rechazo, motivo_rechazo, reserva_ids, carrito_id }`. Consumidor: `audit-log.listener.ts` (`PAGO_RECHAZADO`).
- **`ecommerce:pago_anomalo`** — `{ motivo, mercadopago_payment_id, estado_pago_mp, pedido_venta_ecommerce_id, pedido_venta_id, monto_informado, moneda_informada, monto_esperado }`, con `motivo` ∈ `MONTO_DISCREPANTE | PAGO_TARDIO | PAGO_DUPLICADO | PAGO_HUERFANO | CUPON_LIMITE_EXCEDIDO`. Consumidor: `audit-log.listener.ts` (`PAGO_ANOMALO`).
- **`ecommerce:transaccion_pago_registrada`** (HU-E6, emitido desde `pago-web.service.ts`) — `{ transaccion_id, pedido_venta_id, monto, estado_pago: "APROBADO" | "RECHAZADO" | "PENDIENTE" | "ANOMALIA", mercadopago_payment_id }`, sin datos de facturación. Consumidor: `audit-log.listener.ts` (`TRANSACCION_PAGO_REGISTRADA`). HU-G11 no lo consume.
- **`ecommerce:pedido_admitido_cola`** (HU-E12, emitido desde `pago-web.service.ts` con el payload que arma `admitirPedidoPagoConfirmado()`) — consumidores: auditoría y notificación al rol `OPERADOR_PICK_PACK` (HU-F3).
- **`ecommerce:cupon_consumido`** / **`ecommerce:cupon_aplicacion_liberada`** (HU-E4) — emitidos por E2 al confirmar o rechazar con cupón.
- **`stock:reserva_liberada`** (Módulo A, existente) — una emisión por reserva, con `motivo_liberacion: "VENTA"` (confirmación) o `"PAGO_RECHAZADO"` (rechazo).

No se emite `pago:webhook_confirmado` (spec F §2.1.3): el webhook procesa de forma síncrona y no existe en `event-types.ts`.

## Integración con otras HU

| HU | Owner | Qué consume o aporta a E2 | Estado |
|---|---|---|---|
| HU-F1 — Conector de Mercado Pago | Rama | Aporta alta, health-check, bitácora, baja y `solicitarReembolso()` sobre la base del Adapter de E2. Desde la integración, el único Conector `ACTIVO` por entorno se controla al activar (health-check → `409 CONECTOR_ACTIVO_EXISTENTE`). Webhook, firma, simulador, script y `WebhookPagoLog` quedan con owner HU-E2 | Integrado |
| HU-B7 — Comprobante fiscal | (a confirmar) | E2 usa `emitirComprobanteFiscal(tx, …)` con `FACTURA_B`; la transición `RESERVADO → FACTURADO` la agregó E2 (`facturarPedidoVentaTx()`) | Integrado |
| HU-B9 — Precio congelado | (a confirmar) | `PedidoVentaItem.precio_unitario` congelado al iniciar el checkout | Integrado |
| HU-E1 — Carrito y checkout | (a confirmar) | E2 completa el paso 5 del checkout (preferencia), reconstruye el carrito al rechazarse y reutiliza `buscarPedidoPendienteVigente()` / `obtenerPedidoWebPendiente()` | Integrado |
| HU-E4 — Cupones | Tomas | `aplicarCuponTx()` en el checkout, `confirmarAplicacionCuponTx()` al confirmar y `darDeBajaAplicacionCuponTx()` al rechazar; reemplazó el `cupon.service.ts` provisorio de E2 | Integrado |
| HU-E6 — Log de pagos | Rama | Escribe `TransaccionPagoLog` dentro de la transacción de E2 (`APROBADO`, `RECHAZADO`) y, desde la integración, las filas `ANOMALIA`; emite `ecommerce:transaccion_pago_registrada` | Integrado |
| HU-E8 — Sesión de Cliente Web | (a confirmar) | `withSesionClienteWeb()` en el checkout; `vinculacion_pendiente` bloquea la compra | Integrado |
| HU-E12 — Cola de preparación | Emir | `admitirPedidoPagoConfirmado(tx, …)` como última mutación de la confirmación; `fecha_pago_confirmado` como orden de la cola | Integrado |
| HU-G11 — Ingreso de Tesorería | Rama | Escucha `ecommerce:pedido_pago_confirmado`; el reproceso manual considera "pagado" a todo pedido con `fecha_pago_confirmado` y `mercadopago_payment_id` no nulos | Integrado |
| HU-F3 — Notificaciones | Cali | Adoptó la suscripción de E2 (`pedido_pago_confirmado` → Cliente Web) y agregó `pedido_admitido_cola` → rol `OPERADOR_PICK_PACK` | Integrado |

## Manual de usuario

### Pago online con Mercado Pago

**Rol:** Cliente Web

**¿Qué permite hacer esta pantalla?**

Permite pagar en línea un pedido de la tienda web mediante Mercado Pago. Al iniciar la compra, el sistema reserva los artículos durante un tiempo limitado; el cliente paga en el sitio de Mercado Pago (tarjeta de crédito o débito, u otros medios online habilitados) y, al volver a la tienda, ve el estado real de su pedido y, si el pago se aprobó, los datos de la Factura B emitida.

**Requisitos previos**

- Tener una cuenta de Cliente Web e iniciar sesión. Una cuenta con vinculación pendiente de validación en sucursal no puede comprar online.
- Tener artículos en el carrito con stock disponible.
- Opcional: un código de cupón de descuento vigente.
- Contar con un medio de pago aceptado por Mercado Pago. No se admiten medios en efectivo (Rapipago, Pago Fácil ni cajeros).

**Paso a paso**

1. Ingrese a la tienda, agregue los artículos al carrito y abra el **Carrito**.
2. Revise los artículos y el **Total**. Si tiene un cupón, escríbalo en el campo **"Código de cupón (opcional)"**.
3. Haga clic en **"Iniciar compra"**. Si no inició sesión, el botón dice **"Ingresar para comprar"** y lo lleva a la pantalla de ingreso.
4. El sistema reserva los artículos y lo lleva a la pantalla **"Reservamos tu compra"** (`/tienda/checkout/pendiente`), que muestra el número de pedido, el total (con el desglose del cupón, si aplicó) y la hora hasta la que quedan reservados los artículos.
5. Haga clic en **"Pagar con Mercado Pago"**. El sistema lo redirige al sitio de Mercado Pago.
6. Complete el pago en Mercado Pago con el medio de pago que prefiera.
7. Al terminar, Mercado Pago lo devuelve a la pantalla de resultado de la tienda (`/tienda/checkout/resultado`), que muestra el estado del pedido leído del sistema. Si todavía figura como pendiente, haga clic en **"Actualizar"** después de unos segundos.

**Capturas de pantalla del paso a paso:**

- [Insertar captura del carrito con el campo de cupón y el botón "Iniciar compra"]
- [Insertar captura de la pantalla "Reservamos tu compra" con el botón "Pagar con Mercado Pago"]
- [Insertar captura del checkout de Mercado Pago]
- [Insertar captura de la pantalla "¡Pago confirmado!" con los datos de la Factura B]
- [Insertar captura de la pantalla "El pago fue rechazado" con el botón "Ir al carrito y reintentar"]
- [Insertar captura de la pantalla "Estamos esperando la confirmación del pago" con el botón "Actualizar"]

**Resultado esperado**

- **Pago aprobado:** la pantalla muestra **"¡Pago confirmado!"** con el número de pedido, el total, la Factura B emitida (con su CAE simulado) y el aviso de que se le informará cuando el pedido esté listo para retirar en Sucursal Salta. El cliente recibe la notificación "Recibimos tu pago" y el pedido ingresa a la cola de preparación.
- **Pago rechazado:** la pantalla muestra **"El pago fue rechazado"**. La reserva se libera y los artículos vuelven al carrito; con **"Ir al carrito y reintentar"** se inicia una compra nueva con otro medio de pago.
- **Pago pendiente:** la pantalla muestra **"Estamos esperando la confirmación del pago"**. El pedido se actualiza cuando Mercado Pago confirma o rechaza el pago; mientras tanto, los artículos siguen reservados hasta el vencimiento indicado.

**Errores comunes**

- **"Tu carrito está vacío"**: no hay artículos para comprar; agregue productos desde el catálogo.
- **"No hay stock suficiente para uno o más artículos"**: el detalle indica el SKU y las unidades disponibles; ajuste la cantidad o quite el artículo.
- **"El artículo no está disponible para la compra"**: el artículo dejó de venderse online; quítelo del carrito para continuar.
- **"El cupón indicado no existe"**, **"El cupón indicado no está activo"**, **"El cupón indicado todavía no está vigente"**, **"El cupón indicado está vencido"**: revise el código o inicie la compra sin cupón.
- **"El cupón alcanzó su límite de uso"** o **"Ya usaste este cupón la cantidad de veces permitida"**: el cupón ya no admite más usos.
- **"El cupón no puede cubrir el total del pedido"**: el descuento no es aplicable a ese pedido.
- **"Ya hay una compra en curso para tu carrito; reintentá en unos segundos"**: se envió la compra dos veces seguidas; espere y vuelva a intentar.
- **No aparece el botón "Iniciar compra"**: la cuenta tiene la vinculación pendiente de validación de identidad en sucursal ("Tu cuenta está pendiente de validación de identidad en sucursal"); debe validarse en la sucursal antes de comprar online.
- **"No pudimos conectar con Mercado Pago"**: la reserva sigue vigente; haga clic en **"Reintentá"** en unos segundos.
- **"Reserva vencida"**: el pago no se confirmó antes del vencimiento y los artículos se liberaron; arme el carrito nuevamente.
- **Sesión vencida**: el sistema redirige a la pantalla de ingreso y, después de ingresar, vuelve al carrito o al pedido.
- **"No encontramos esa compra pendiente"** / **"No encontramos esa compra"**: el enlace no corresponde a un pedido de la cuenta con la que se ingresó.

## Verificación

**Resultados de la última corrida** (2026-10-08, rama `feature/HU-E2-integracion`, base descartable `swat_erp_test_e2`, nunca sobre la base de desarrollo; regresión final después de quitar el log temporal de diagnóstico, sin recrear la base: `tsc`, lint, unitarios, `e2` y `hu-e2-e12`; el resto de las filas son de la corrida anterior con la base recreada y sembrada):

| Corrida | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 errores |
| `npm run lint` | 0 errores, 4 warnings preexistentes (ajenos a E2) |
| `npm test` (unitarios) | 812/815. Las 3 fallas son preexistentes y de otros owners (ver deuda técnica) |
| `test:integration:e2` | 13/13 |
| `hu-e2-e12.integration.test.ts` (HU-E12, sin script npm) | 12/12 |
| `test:integration:e1` / `e1-http` | 21/21 / 15/15 |
| `test:integration:e4` / `e7` | 27/27 / 11/11 |
| `test:integration:b4` / `b7` | 22/22 / 6/6 |
| `prisma migrate diff` (base de test → `schema.prisma`) | Migración vacía |

`test:integration:e2` cubre: checkout con cupón (total neto, `CuponAplicacion` sin confirmar, misma preferencia en el reintento); cupón inexistente; confirmación completa (stock, Factura B, `EN_PREPARACION`, eventos, `TransaccionPagoLog` `APROBADO` cifrado e `IngresoTesoreria` único ante notificaciones repetidas); reproceso de G11 de un pedido `EN_PREPARACION` sin ingreso; dos notificaciones concurrentes del mismo pago; pago duplicado, monto distinto (con reenvíos concurrentes) y pagos tardíos, cada uno con una sola fila `ANOMALIA`; rechazo completo (fila `RECHAZADO`, carrito reconstruido, preferencia cerrada, nuevo checkout); límite del cupón con dos checkouts; pago huérfano sin fila; y `CUPON_LIMITE_EXCEDIDO` con solo la fila `APROBADO`.

**Casos probados manualmente:** los escenarios de la guía de Postman (aprobado, duplicado, firma alterada, monto distinto, rechazado, pago tardío) se ejecutaron el 2026-10-01 como prueba HTTP sobre un `next dev` temporal contra la base de test, con `MP_MODO=simulado` (registro de `docs/tasks/HU-E2.md` §8). La ejecución por el owner en Postman sobre la versión integrada: (a confirmar). La prueba contra Mercado Pago sandbox real: **aprobada el 2026-10-08** (detalle abajo).

**Prueba en Mercado Pago sandbox real (2026-10-08, OK).** Sobre `swat_erp_db` local con `MP_MODO` vacío y túnel ngrok. El Conector `SANDBOX` tenía las credenciales `APP_USR-` de la cuenta vendedor de prueba y la clave secreta del panel, y el health-check dio OK. El webhook estaba configurado en el panel de MP (modo de prueba y productivo, evento Pagos) y la preferencia no envía `notification_url`. Se pagó con el comprador de prueba y una tarjeta de prueba aprobada (`APRO`).
- Los avisos IPN (`topic=payment` y `topic=merchant_order`) respondieron `200 SIN_EFECTO` con su traza.
- Los avisos `data.id` + `type=payment` llegaron con HMAC distinto (limitación de MP con cuentas de prueba) y se procesaron por el fallback SANDBOX: `200 CONFIRMADO`.
- "Simular notificación" del panel pasó la firma (`200 SIN_EFECTO`, pago inexistente `123456`).
- Pagos confirmados y estado de la base después de la prueba:

| Tabla | `182164365927` → V-2026-000018 | `183171107114` → V-2026-000015 |
|---|---|---|
| `log_webhooks_pago` | `FIRMA_NO_VERIFICADA_SANDBOX` + `CONFIRMADO` | `FIRMA_NO_VERIFICADA_SANDBOX` + `CONFIRMADO` (antes: una fila `SIN_EFECTO` de su aviso IPN) |
| `pedidos_venta_ecommerce` | `EN_PREPARACION`, `fecha_pago_confirmado` 2026-10-08 23:57:01 | `EN_PREPARACION`, `fecha_pago_confirmado` 2026-10-08 23:07:57 |
| `pedidos_venta` | `FACTURADO`, total 22800.00 | `FACTURADO`, total 22800.00 |
| `comprobantes_fiscales` | 1 `FACTURA_B` | 1 `FACTURA_B` |
| `log_transacciones_pago` | 1 `APROBADO` | 1 `APROBADO` |
| `ingresos_tesoreria` | 1 `PENDIENTE_CONCILIACION` | 1 `PENDIENTE_CONCILIACION` |

El caso rechazado (`OTHE`) no se probó en sandbox real; está cubierto por `test:integration:e2` y por la prueba con el simulador.

### Guía de prueba con el simulador (Postman + mp:firmar)

Preparación (una vez):

```bash
# .env: ENCRYPTION_KEY_PROVEEDORES (openssl rand -hex 32), MP_MODO=simulado, APP_PUBLIC_URL=http://localhost:3000
npx prisma migrate deploy
npx prisma db seed            # crea el Conector SANDBOX (credenciales ficticias si no hay MP_SANDBOX_*)
npm run dev
```

`npm run mp:firmar -- --pago <id> --estado approved|rejected|in_process --monto <n> --ref <external_reference>` registra el pago simulado en `.mp-simulador/pagos.json` e imprime URL, headers (`x-signature`, `x-request-id`) y body listos para Postman (la firma vale 15 minutos y usa la clave secreta del Conector `ACTIVO`, o `--secret`). Sin `--estado` solo firma (sirve para reenviar una notificación).

> Probar en una base de desarrollo crea pedidos y comprobantes reales en ella. `npx prisma db seed` re-afirma los fixtures, pero no borra los pedidos creados.

1. **Login y checkout** (activar el cookie jar de Postman):
   - `POST http://localhost:3000/api/tienda/cuenta/login` · `{"email":"juan.perez@example.com","password":"<contraseña del seed de desarrollo>"}` → `200` y cookie `swat_tienda_session`.
   - `POST /api/tienda/carrito/items` · `{"variante_sku_id":"0929aab1-57fb-44bc-90b6-76417c76c016","cantidad":1}` (Camisa Táctica 3).
   - `POST /api/tienda/checkout` · `{"cupon_codigo":"SWAT10"}` (o `{}`) → `201` con `pedido_venta_id`, `pedido_venta_ecommerce_id` (= `--ref`), `total` neto y `checkout_url`. Un body con `total` o `monto` → `400`.
   - Base: `pedidos_venta` `RESERVADO`, canal `WEB`, `turno_caja_id` NULL, `registrado_por_id` = `canal.web.sistema`; `pedidos_venta_ecommerce` `PAGO_PENDIENTE` con `mercadopago_preference_id`; `aplicaciones_cupon.confirmada = false`; reservas abiertas `CHECKOUT_WEB`.
2. **Webhook aprobado:** `npm run mp:firmar -- --pago 7000001 --estado approved --monto <total> --ref <pedido_venta_ecommerce_id>` → en Postman `POST /api/webhooks/mercadopago?data.id=7000001&type=payment` con los headers y el body impresos → `200 resultado: "CONFIRMADO"`. Base: `pedidos_venta_ecommerce` `EN_PREPARACION` con `mercadopago_payment_id = 7000001` y `fecha_pago_confirmado`; `pedidos_venta` `FACTURADO`; 1 `comprobantes_fiscales` `FACTURA_B`; `venta_medios_pago` `MERCADO_PAGO`; movimientos `RESERVADO → VENDIDO`; `aplicaciones_cupon.confirmada = true`; `log_transacciones_pago` 1 fila `APROBADO`; `ingresos_tesoreria` 1 fila `PENDIENTE_CONCILIACION`; `audit_logs` `PAGO_CONFIRMADO`; notificación "Recibimos tu pago"; `log_webhooks_pago` `CONFIRMADO`.
3. **Webhook duplicado:** reenviar la misma request (dentro de los 15 minutos) → `200 SIN_EFECTO`. Sigue 1 comprobante, 1 medio de pago, 1 fila `APROBADO` y 1 ingreso; `log_webhooks_pago` suma una fila `SIN_EFECTO`.
4. **Firma inválida:** cambiar un carácter de `v1=` (o quitar `x-signature`) → `401 FIRMA_INVALIDA`, sin cambios y sin fila en `log_webhooks_pago`.
5. **Monto distinto:** nuevo checkout y `npm run mp:firmar -- --pago 7000002 --estado approved --monto 1 --ref <ref>` → `200 ANOMALIA` / `MONTO_DISCREPANTE`. El pedido sigue `PAGO_PENDIENTE` / `RESERVADO` con las reservas abiertas; `log_transacciones_pago` 1 fila `ANOMALIA` (`{"motivo":"MONTO_DISCREPANTE",…}`); `audit_logs` `PAGO_ANOMALO` con `monto_esperado`.
6. **Webhook rechazado:** sobre el mismo pedido, `--pago 7000003 --estado rejected --monto <total>` → `200 RECHAZADO`. Base: `pedidos_venta_ecommerce` `PAGO_RECHAZADO` e `is_active = true`; `pedidos_venta` `ANULADO`, `is_active = false`, `deletion_reason` "Pago rechazado por Mercado Pago (…)"; reservas cerradas con movimiento `RESERVADO → DISPONIBLE`; stock restituido; cupón dado de baja; carrito con los artículos del pedido; `log_transacciones_pago` 1 fila `RECHAZADO`; `audit_logs` `PAGO_RECHAZADO`.
7. **Pago tardío:**
   - Aprobado sobre un pedido rechazado: después del paso 6, `--pago 7000004 --estado approved --monto <total>` → `200 ANOMALIA` / `PAGO_TARDIO`; el pedido sigue `PAGO_RECHAZADO`; 1 fila `ANOMALIA` aunque se reenvíe.
   - Reserva vencida (aunque el job no la haya liberado): nuevo checkout y luego, en SQL, `UPDATE reservas SET fecha_expiracion = now() - interval '1 minute' WHERE id IN (SELECT reserva_id FROM pedido_venta_items WHERE pedido_venta_id = '<pedido_venta_id>');` y webhook aprobado con el monto correcto → `ANOMALIA` / `PAGO_TARDIO`; nada se confirma.
8. **Cupón que excede su límite al confirmar:** con la capacidad `C + P` de HU-E4, un segundo checkout con un cupón de uso único ya se rechaza con `CUPON_LIMITE_ALCANZADO`, de modo que el caso solo se reproduce simulando datos previos a E4: checkout con un cupón vigente, luego `UPDATE cupones_descuento SET limite_uso_global = 0 WHERE codigo = '<codigo>';` y webhook aprobado → `200 CONFIRMADO`, `audit_logs` `PAGO_ANOMALO` con `motivo: CUPON_LIMITE_EXCEDIDO` y una sola fila `APROBADO` con ese motivo en `resultado_webhook`.

### Prueba en Mercado Pago sandbox (cargando las credenciales por el panel de F1, alta + health-check)

1. En Mercado Pago Developers: crear una aplicación (Checkout Pro), obtener las **credenciales de prueba** (Access Token y Public Key) y crear **usuarios de prueba** (vendedor y comprador).
2. Exponer la app con un túnel HTTPS (`ngrok http 3000` o `cloudflared tunnel --url http://localhost:3000`).
3. En Mercado Pago → la aplicación → **Webhooks**, en **modo de prueba y en modo productivo**: URL `https://<túnel>/api/webhooks/mercadopago`, evento **Pagos**; copiar la **clave secreta**. Es la **única** vía de notificación: la preferencia no envía `notification_url`, porque los avisos que llegan por ella no firman con la clave del panel (comprobado en sandbox: `401` por HMAC distinto). Con cuentas de prueba los pagos llegan con `live_mode: true`, por eso hace falta también la URL de modo productivo.
4. `.env`: `APP_PUBLIC_URL=https://<túnel>` (solo para las `back_urls`), **`MP_MODO` vacío** y `ENCRYPTION_KEY_PROVEEDORES` definida (no cambiarla después de cargar credenciales). Reiniciar `npm run dev`.
5. Cargar las credenciales en el Conector:
   - **Base existente:** en `/administracion/integraciones` (rol `ADMINISTRADOR_PLATAFORMA`, permiso `integraciones:administrar_conector`): dar de baja el Conector sembrado → alta de un Conector `SANDBOX` con Access Token, Public Key y clave secreta (nace `INACTIVO`) → **health-check** (lo activa; si todavía hay otro `ACTIVO` en `SANDBOX` responde `409 CONECTOR_ACTIVO_EXISTENTE`). Volver a sembrar después es seguro: el seed no toca el Conector nuevo ni reactiva el sembrado.
   - **Base nueva:** alternativamente, cargar `MP_SANDBOX_ACCESS_TOKEN`, `MP_SANDBOX_PUBLIC_KEY` y `MP_SANDBOX_WEBHOOK_SECRET` en el `.env` antes del **primer** `npx prisma db seed`.
6. Navegar la tienda por la URL del túnel, iniciar la compra, "Pagar con Mercado Pago" y pagar con el usuario comprador de prueba y las tarjetas de prueba de Mercado Pago (el nombre del titular define el resultado: `APRO` aprobado, `OTHE` rechazado).
7. Si la URL del túnel cambia: actualizar `APP_PUBLIC_URL` y la URL del webhook en el panel de Mercado Pago (ambos modos). Las preferencias ya creadas conservan las `back_urls` anteriores; iniciar una compra nueva.
8. **Firma de los pagos reales (limitación de MP):** con cuentas de prueba de Checkout Pro, MP firma los avisos de pagos reales con la clave del usuario **vendedor de prueba**, que no tiene acceso al panel de Webhooks; la clave cargada en el Conector (la del panel de la cuenta real) no la reproduce y el HMAC no coincide, aunque el manifest y los headers sean correctos. "Simular notificación" del panel sí pasa la firma. Por eso, **solo con el Conector `SANDBOX`**, un aviso `?data.id=…&type=payment` con `x-signature` y `x-request-id` presentes y `ts` dentro de la ventana pero **HMAC distinto** se procesa igual: `console.warn` en el servidor y una fila `FIRMA_NO_VERIFICADA_SANDBOX` en `log_webhooks_pago` (además de la fila del resultado normal). El pago se valida igual contra la API de MP (`consultarPago`: `external_reference` y monto). Faltan headers, formato inválido o `ts` fuera de ventana → `401` también en SANDBOX. En PRODUCCION no hay excepción.
9. Control: `invocaciones_conector_pago` (cada llamada real a Mercado Pago) y `log_webhooks_pago` (cada notificación con firma válida, más los avisos en formato IPN). Los avisos en formato IPN (`?id=…&topic=payment|merchant_order`, sin `type`) responden `200 SIN_EFECTO` sin validar firma ni procesar, y dejan una fila `SIN_EFECTO` con su `topic`; así Mercado Pago no los reintenta. Solo se procesa el formato webhook (`?data.id=…&type=payment`) con firma válida.

### Recetas de tests de integración

```bash
npm test                                                   # unitarios (incluye firma y reglas del pago)
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "DROP DATABASE IF EXISTS swat_erp_test_e2" -c "CREATE DATABASE swat_erp_test_e2"
export TEST_DB="postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e2?schema=public"
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
DATABASE_URL=$TEST_DB HU_E2_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e2
# HU-E2 → HU-E12 (sin script npm; la receta de cabecera del archivo apunta a otro contenedor y puerto):
DATABASE_URL=$TEST_DB HU_E2_E12_INTEGRATION_DATABASE_URL=$TEST_DB node --conditions=react-server --import tsx --test --test-concurrency=1 src/lib/services/ecommerce/hu-e2-e12.integration.test.ts
```

`test:integration:e2` usa una pasarela falsa inyectada y `MP_MODO=simulado`: no necesita red ni credenciales.

Tests HTTP (`e1-http`, `b7`) — servidor aparte sobre la misma base descartable (Next 16 no admite dos `next dev` simultáneos en el mismo proyecto: detener el de desarrollo antes):

```bash
# Misma ENCRYPTION_KEY_PROVEEDORES con la que se sembró $TEST_DB.
# MP_MODO=simulado + APP_PUBLIC_URL: obligatorios desde HU-E2 (el checkout crea la preferencia).
# `next dev`, NO `next start`: con NODE_ENV=production el simulador está prohibido.
DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3101 npx next dev -p 3101   # en otra terminal
HU_E1_INTEGRATION_BASE_URL=http://localhost:3101 HU_E1_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e1-http
HU_B7_INTEGRATION_BASE_URL=http://localhost:3101 HU_B7_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:b7
```

`b7` no usa Mercado Pago; corre contra el mismo servidor sin variables extra.

### Modos de la pasarela (tabla MP_MODO / NODE_ENV)

| `MP_MODO` | `NODE_ENV` | Comportamiento |
|---|---|---|
| no definido, vacío o cualquier valor distinto de `simulado` (comparación exacta, sensible a mayúsculas) | cualquiera | API real de Mercado Pago (`api.mercadopago.com`) con las credenciales del Conector `ACTIVO` |
| `simulado` | distinto de `production` | Simulador local (sin red). `consultarPago()` lee `.mp-simulador/pagos.json`; `iniciarCobro()`, `cerrarCobro()`, `solicitarReembolso()` y `healthCheck()` responden con ramas simuladas del Adapter. No se registran invocaciones en la bitácora |
| `simulado` | `production` | Error en cada operación del Adapter ("MP_MODO=simulado está prohibido en producción"): falla cerrado, nunca simula ni llama a Mercado Pago. Checkout → `500`; webhook → `500` (Mercado Pago reintenta) |

## Actualizaciones post-entrega

La entrega original (2026-10-01) incluyó mínimos provisorios de HU-F1, HU-E4 y HU-F3 porque esas HU no estaban implementadas. En la integración (rama `feature/HU-E2-integracion`, 2026-10-08) quedaron así:

- **HU-E6 (Rama) modificó `pago-web.service.ts` con autorización del owner de E2:** inserta `TransaccionPagoLog` dentro de las transacciones de confirmación y rechazo, con facturación cifrada, y emite `ecommerce:transaccion_pago_registrada`. Supera la decisión original P7 de E2 ("E2 no escribe `TransaccionPagoLog`").
- **HU-E12 (Emir) admite el pedido dentro de la transacción de E2:** `admitirPedidoPagoConfirmado()` deja el pedido en `EN_PREPARACION` en el mismo commit, se agregó el lock previo de `PedidoVenta` y la columna `fecha_pago_confirmado`. `PAGO_CONFIRMADO` es hoy un estado transitorio que no persiste. Supera las decisiones originales P6 y D-E2-7.
- **HU-E4 (Tomas) reemplazó el cupón provisorio:** la capacidad cuenta confirmadas y reservas pendientes vigentes (`C + P`) con lock del cupón, lo que resuelve el sobreconsumo con checkouts concurrentes señalado por E2 (Q3).
- **HU-F3 (Cali) adoptó el listener:** la suscripción de `ecommerce:pedido_pago_confirmado` al Cliente Web forma parte de la tabla declarativa de F3, que agregó el aviso al rol `OPERADOR_PICK_PACK` por `ecommerce:pedido_admitido_cola`.
- **HU-F1 (Rama) completó el Adapter:** `solicitarReembolso()`, `healthCheck()`, la gestión del Conector (alta, health-check, bitácora, baja y panel) y la excepción de ESLint para `lib/services/integraciones/**`. No reescribió la base de E2.
- **HU-G11 (Rama) consume `ecommerce:pedido_pago_confirmado`:** registra el `IngresoTesoreria` por evento post-commit. Junto con lo anterior, supera la decisión original D-E2-8 sobre los consumidores del evento (`pago:webhook_confirmado` sigue sin emitirse).
- **Acuerdos con Rama del 2026-10-08, implementados por el owner de E2:**
  - Las 6 marcas PROVISORIO quedaron eliminadas; el webhook, la firma, el simulador, el script y `WebhookPagoLog` tienen owner HU-E2.
  - El reproceso de G11 decide "pagado" por fecha de pago y `payment_id`.
  - Las anomalías se registran en `TransaccionPagoLog` como `ANOMALIA`.
  - F1 controla el único Conector `ACTIVO` al activar.
  - El seed nunca reactiva ni pisa un Conector.

## Deuda técnica y decisiones sujetas a revisión

- **Eventos post-commit sin outbox (R8):** si el proceso cae entre el commit de la confirmación y la emisión, o si un listener falla, el pedido queda confirmado y facturado sin `IngresoTesoreria` ni asiento de auditoría. Mercado Pago no reintenta (ya recibió `200`) y un reintento tampoco re-emitiría. Mitigación disponible: reproceso manual de G11 (`POST /api/tesoreria/ingresos-web/reprocesar`). Mitigación de fondo: tabla outbox, a decidir por el equipo.
- **Pago tardío y reembolso manual (R9):** tras un rechazo, el comprador puede reintentar dentro de la misma preferencia; el cierre de la preferencia es best-effort y, si falla, un aprobado posterior queda como `PAGO_TARDIO` (cobrado sin venta). Lo mismo ocurre con los duplicados. El reembolso es manual hasta que HU-E13 consuma `solicitarReembolso()`.
- **`ENCRYPTION_KEY_PROVEEDORES` obligatoria para confirmar y rechazar:** desde HU-E6, la transacción de confirmación y la de rechazo cifran los datos de facturación; sin la clave, el webhook responde `500` y Mercado Pago reintenta. Ya era necesaria para descifrar las credenciales del Conector.
- **Fila `ANOMALIA` best-effort:** si falla su inserción, se registra en el log del servidor y el webhook responde igual `200`, por lo que la fila forense puede perderse (el evento `ecommerce:pago_anomalo` sí se emite).
- **Rechazo sin cuenta web:** si el pedido no tiene `CuentaClienteWeb` asociada, el rechazo lanza `CUENTA_WEB_NO_ENCONTRADA` y el webhook responde `500` en cada reintento de Mercado Pago (observado en el código, no se cubre en tests).
- **Página de resultado con estados posteriores:** `/tienda/checkout/resultado` muestra "¡Pago confirmado!" para todo estado activo distinto de `PAGO_RECHAZADO` y `PAGO_PENDIENTE`. Hoy es correcto (`EN_PREPARACION`, `LISTO_PARA_RETIRO`, `ENTREGADO`; una orden anulada por HU-E7 queda con la extensión dada de baja y la página muestra "No encontramos esa compra"). Si HU-E13 deja activos pedidos `CANCELADO` o `VENCIDO_SIN_RETIRO`, también caerían en esa rama: (a confirmar cuando exista HU-E13).
- **Desviaciones respecto de spec F** (a reflejar en `spec_modulo_F.md`):
  - El webhook procesa la confirmación de forma síncrona y responde `500` ante una falla para que Mercado Pago reintente.
  - La deduplicación por `(payment_id, topic)` se reemplazó por idempotencia de negocio; `WebhookPagoLog` es una traza append-only.
  - La firma usa el manifest real de Mercado Pago, no el payload crudo.
  - No se emite `pago:webhook_confirmado`.
  - El Adapter usa la API REST con `fetch`, no el SDK.
  - Spec G §2.6 indica que G11 consuma `ecommerce:transaccion_pago_registrada`; G11 consume `ecommerce:pedido_pago_confirmado` (registrado en `docs/specs/hu-f1-divergencias-evento.md`).
- **Pendiente con Rama (P-R1 a P-R5):** acordados el 2026-10-08 e implementados por el owner de E2 en `feature/HU-E2-integracion`; Rama los revisa en la PR.
  - **P-R1:** se quitaron las marcas PROVISORIO; esos archivos tienen owner HU-E2.
  - **P-R2:** criterio de "pagado" del reproceso de G11 y `fecha_pago_confirmado` en el seed.
  - **P-R3:** G11 sigue en `pedido_pago_confirmado`.
  - **P-R4:** filas `ANOMALIA` y `CUPON_LIMITE_EXCEDIDO` con la opción (a).
  - **P-R5:** unicidad del Conector `ACTIVO` en la activación y seed sin reactivación.
  - **Deudas propias de F1:** los eventos `integracion:*` (spec F §4) siguen diferidos, y en modo simulado no se registran invocaciones en la bitácora.
- **Avisos para Emir y Cali (no se tocan en la rama de integración):**
  - **Emir (HU-E3):** dos tests de fuente de `pedido-venta.service.test.ts` (líneas 151 y 157) fallan en Windows por buscar un salto de línea `\n` en un archivo con CRLF.
  - **Emir (HU-E12):** `hu-e2-e12.integration.test.ts` no tiene script en `package.json` y su receta apunta a otro contenedor y puerto.
  - **Cali (HU-F3):** el test `notificacion.service.test.ts:93` no incluye `ecommerce:pedido_listo_para_retiro`, y el comentario de `prisma/seed.ts` sobre las plantillas indica que la de `pedido_pago_confirmado` no se siembra, aunque sí se siembra.
- **Limitación de Mercado Pago con cuentas de prueba (fallback de firma SOLO SANDBOX):** MP firma los webhooks de pagos reales de cuentas de prueba con la clave del usuario vendedor de prueba, inaccesible desde el panel; el HMAC nunca coincide con la clave del Conector. `decidirFirmaWebhook()` (`firma.ts`) acepta en SANDBOX un aviso de pago con HMAC distinto (solo esa causa) y lo deja trazado como `FIRMA_NO_VERIFICADA_SANDBOX`; la autenticidad del pago descansa en la consulta a la API de MP. Consecuencia: en SANDBOX cualquiera que conozca la URL puede forzar consultas a MP por un `payment_id` (sin efectos si el pago no es de un pedido nuestro o el monto no coincide). En PRODUCCION la firma es obligatoria y **no se pudo probar con un pago real** hasta tener credenciales productivas: hay que verificar en la primera venta real que los avisos firmen con la clave del panel. Tests: `firma.test.ts` (decisión por entorno y causa).
- **Prueba en sandbox real:** el pago aprobado se probó el 2026-10-08 (ver Verificación). El rechazado (`OTHE`) quedó sin probar contra MP real. La firma en PRODUCCION queda por verificar con la primera venta real.
