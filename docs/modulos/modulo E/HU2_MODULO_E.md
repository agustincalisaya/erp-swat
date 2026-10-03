# HU-E2 — Pago online con Mercado Pago (Módulo E)

Task y decisiones: `docs/tasks/HU-E2.md` (§3.2 decisiones, §3.3 contrato de eventos, §3.4 desviaciones de spec F, §9.4 orden de operaciones).

## 1. Qué hace

| Paso | Dónde | Resultado |
|---|---|---|
| Checkout | `POST /api/tienda/checkout` (`{ cupon_codigo? }`) | Reserva (E1), aplica el cupón sobre el precio congelado, `PedidoVenta` RESERVADO (canal WEB, `canal.web.sistema`, sin turno de caja) + `PedidoVentaEcommerce` PAGO_PENDIENTE, y **después del commit** crea la preferencia de Checkout Pro (`external_reference` = id del `PedidoVentaEcommerce`, vence con la reserva, sin medios offline). Devuelve `checkout_url`. |
| Pago | Mercado Pago (Checkout Pro) | La tarjeta se carga en MP; SWAT solo guarda `mercadopago_preference_id` y `mercadopago_payment_id`. |
| Webhook | `POST /api/webhooks/mercadopago` | Firma `x-signature` válida → `consultarPago()` a MP → **aprobado**: en UNA transacción stock VENDIDO, `PedidoVenta` FACTURADO + `VentaMedioPago MERCADO_PAGO`, Factura B, `PAGO_CONFIRMADO`, cupón consumido; post-commit `ecommerce:pedido_pago_confirmado`. **Rechazado**: reservas liberadas (`PAGO_RECHAZADO`), cupón de baja, carrito reconstruido, `PedidoVenta` ANULADO, pedido web `PAGO_RECHAZADO` (activo), preferencia cerrada; post-commit `ecommerce:pago_rechazado`. Duplicado / ya resuelto → 200 sin efectos. Monto distinto, tardío, duplicado, huérfano → 200 + `ecommerce:pago_anomalo`. |
| Retorno | `/tienda/checkout/resultado?pedido=<id>` | Estado leído de la base (nunca de los query params de MP). |

## 2. Variables de entorno

| Variable | Para qué |
|---|---|
| `ENCRYPTION_KEY_PROVEEDORES` | **Obligatoria.** Sin ella el seed NO crea el `ConectorPago` y el webhook responde siempre 401. |
| `MP_SANDBOX_ACCESS_TOKEN`, `MP_SANDBOX_PUBLIC_KEY`, `MP_SANDBOX_WEBHOOK_SECRET` | Credenciales de prueba de MP. El seed las cifra en `ConectorPago`. Cambiarlas ⇒ `npx prisma db seed`. |
| `APP_PUBLIC_URL` | Base de `notification_url` y `back_urls` (sin barra final). |
| `MP_MODO=simulado` | Solo desarrollo: MP falso, sin red (ver §3). Vacío = MP real (sandbox). |

## 3. Probar sin Mercado Pago real (simulador + Postman)

Preparación (una vez):
```bash
# .env: ENCRYPTION_KEY_PROVEEDORES (openssl rand -hex 32), MP_MODO=simulado, APP_PUBLIC_URL=http://localhost:3000
npx prisma migrate deploy
npx prisma db seed            # crea el Conector SANDBOX (credenciales ficticias si no hay MP_SANDBOX_*)
npm run dev
```
`npm run mp:firmar -- --pago <id> --estado approved|rejected --monto <n> --ref <external_reference>` registra el pago simulado en `.mp-simulador/pagos.json` y **imprime URL, headers (`x-signature`, `x-request-id`) y body** listos para Postman (la firma vale 15 minutos). Sin `--estado` solo firma (útil para reenviar una notificación).

> Probar en una base de desarrollo crea pedidos/comprobantes reales en ella. Para empezar de cero: `npx prisma db seed` re-afirma los fixtures (no borra los pedidos creados).

### 3.1. Login + checkout (Postman: activar el cookie jar)
1. `POST http://localhost:3000/api/tienda/cuenta/login` · `Content-Type: application/json` · `{"email":"juan.perez@example.com","password":"abc123456789"}` → 200 y cookie `swat_tienda_session`.
2. `POST /api/tienda/carrito/items` · `{"variante_sku_id":"0929aab1-57fb-44bc-90b6-76417c76c016","cantidad":1}` (Camisa Táctica 3).
3. `POST /api/tienda/checkout` · `{"cupon_codigo":"SWAT10"}` (o `{}` sin cupón) → **201** con `pedido_venta_id`, `pedido_venta_ecommerce_id` (= `--ref`), `total` (neto) y `checkout_url`. Un body con `total`/`monto` → **400** (CA5).
   - Base: `pedidos_venta` RESERVADO, canal WEB, `turno_caja_id` NULL, `registrado_por_id` = canal.web.sistema; `pedidos_venta_ecommerce` PAGO_PENDIENTE con `mercadopago_preference_id`; `aplicaciones_cupon.confirmada = false`; `reservas` abiertas `CHECKOUT_WEB`.

### 3.2. Webhook aprobado
`npm run mp:firmar -- --pago 7000001 --estado approved --monto <total> --ref <pedido_venta_ecommerce_id>` → copiar a Postman: `POST /api/webhooks/mercadopago?data.id=7000001&type=payment`, headers `x-signature` / `x-request-id`, body impreso.
- Respuesta 200 `resultado: "CONFIRMADO"`.
- Base: `pedidos_venta_ecommerce` PAGO_CONFIRMADO con `mercadopago_payment_id = 7000001`; `pedidos_venta` FACTURADO con `fecha_facturacion`; `comprobantes_fiscales` 1 fila FACTURA_B; `venta_medios_pago` MERCADO_PAGO con `referencia = 7000001`; reservas con `fecha_fin_reserva` y `movimientos_stock` EGRESO RESERVADO→VENDIDO; `aplicaciones_cupon.confirmada = true`; `audit_logs` `PAGO_CONFIRMADO`; `notificaciones` "Recibimos tu pago"; `log_webhooks_pago` resultado CONFIRMADO.

### 3.3. Webhook duplicado
Reenviar **la misma** request (mismos headers, dentro de los 15 min) → 200 `resultado: "SIN_EFECTO"`. Base: sigue 1 comprobante, 1 medio de pago; `log_webhooks_pago` suma una fila SIN_EFECTO.

### 3.4. Firma inválida
Misma request cambiando un carácter de `v1=` (o sin `x-signature`) → **401** `FIRMA_INVALIDA`. Base: sin cambios y **sin** fila en `log_webhooks_pago`.

### 3.5. Monto distinto
Nuevo checkout (3.1) y `npm run mp:firmar -- --pago 7000002 --estado approved --monto 1 --ref <ref>` → 200 `resultado: "ANOMALIA"`, `motivo: "MONTO_DISCREPANTE"`. Base: pedido sigue PAGO_PENDIENTE / RESERVADO, reservas abiertas, stock sin cambios; `audit_logs` `PAGO_ANOMALO` con `monto_esperado`.

### 3.6. Webhook rechazado
Sobre el mismo pedido: `npm run mp:firmar -- --pago 7000003 --estado rejected --monto <total> --ref <ref>` → 200 `resultado: "RECHAZADO"`. Base: `pedidos_venta_ecommerce` PAGO_RECHAZADO e `is_active = true`; `pedidos_venta` ANULADO, `is_active = false`, `deletion_reason` "Pago rechazado por Mercado Pago (…)"; reservas cerradas + `movimientos_stock` INGRESO RESERVADO→DISPONIBLE (`LIBERACION-PAGO_RECHAZADO-…`); `stock_depositos.cantidad` vuelve; cupón con baja lógica; `carritos_web`/`items_carrito_web` con los artículos del pedido (el próximo `POST /api/tienda/checkout` crea un pedido NUEVO); `audit_logs` `PAGO_RECHAZADO`.

### 3.7. Pago tardío
- **Aprobado sobre un pedido rechazado:** después de 3.6, `npm run mp:firmar -- --pago 7000004 --estado approved --monto <total> --ref <ref>` → 200 `ANOMALIA` / `PAGO_TARDIO`; el pedido sigue PAGO_RECHAZADO.
- **Reserva vencida (aunque el job no la liberó):** nuevo checkout, luego en SQL
  `UPDATE reservas SET fecha_expiracion = now() - interval '1 minute' WHERE id IN (SELECT reserva_id FROM pedido_venta_items WHERE pedido_venta_id = '<pedido_venta_id>');`
  y webhook aprobado con el monto correcto → `ANOMALIA` / `PAGO_TARDIO`; nada se confirma.

### 3.8. Cupón que excede su límite al confirmar
1. SQL: `INSERT INTO cupones_descuento (id, codigo, tipo_beneficio, valor, vigente_desde, vigente_hasta, limite_uso_global, limite_uso_por_cliente, is_active, created_at) VALUES (gen_random_uuid(), 'UNICO1', 'PORCENTAJE', 10, now() - interval '1 day', now() + interval '1 day', 1, 5, true, now());`
2. Dos checkouts seguidos con `{"cupon_codigo":"UNICO1"}` (volver a agregar un artículo al carrito entre uno y otro): ambos pasan (ninguno confirmado todavía).
3. Webhook aprobado del primero → CONFIRMADO. Webhook aprobado del segundo → **200 `CONFIRMADO`** (se confirma igual) y `audit_logs` `PAGO_ANOMALO` con `motivo: CUPON_LIMITE_EXCEDIDO`.

## 4. Prueba real con Mercado Pago sandbox (túnel)

1. En MP Developers: crear una aplicación (Checkout Pro), copiar **credenciales de prueba** (Access Token y Public Key) y crear **usuarios de prueba** (vendedor y comprador).
2. Exponer la app: `ngrok http 3000` (o `cloudflared tunnel --url http://localhost:3000`). Tomar la URL HTTPS.
3. En MP → tu aplicación → **Webhooks**: URL `https://<túnel>/api/webhooks/mercadopago`, evento **Pagos**; copiar la **clave secreta**.
4. `.env`: `MP_SANDBOX_ACCESS_TOKEN`, `MP_SANDBOX_PUBLIC_KEY`, `MP_SANDBOX_WEBHOOK_SECRET`, `APP_PUBLIC_URL=https://<túnel>`, **`MP_MODO` vacío**. Luego `npx prisma db seed` (re-cifra las credenciales en el Conector) y reiniciar `npm run dev`.
5. Navegar la tienda **por la URL del túnel**, iniciar la compra, "Pagar con Mercado Pago" y pagar con el usuario comprador de prueba y las tarjetas de prueba de MP (el nombre del titular define el resultado: `APRO` aprobado, `OTHE` rechazado).
6. Si la URL del túnel cambia: actualizar `APP_PUBLIC_URL` y el webhook en MP. Las preferencias ya creadas conservan la URL vieja: re-sembrar quita la preferencia del pedido fixture; para otros pedidos, iniciar una compra nueva.
7. Control: `invocaciones_conector_pago` (cada llamada a MP), `log_webhooks_pago` (cada notificación con firma válida).

## 5. Tests

```bash
npm test                                                   # unit (firma, reglas del pago)
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "DROP DATABASE IF EXISTS swat_erp_test_e2" -c "CREATE DATABASE swat_erp_test_e2"
export TEST_DB="postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e2?schema=public"
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
HU_E2_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e2
```
`test:integration:e2` usa una pasarela falsa inyectada y `MP_MODO=simulado`: no necesita red ni credenciales.

Tests HTTP (`e1-http`, `b7`) — servidor APARTE sobre la misma base descartable:
```bash
# Misma ENCRYPTION_KEY_PROVEEDORES con la que se sembró $TEST_DB (si no es la del .env, exportarla antes).
# MP_MODO=simulado + APP_PUBLIC_URL: obligatorios desde HU-E2 (el checkout crea la preferencia).
# `next dev`, NO `next start`: con NODE_ENV=production el simulador está prohibido.
DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3101 npx next dev -p 3101   # en otra terminal
HU_E1_INTEGRATION_BASE_URL=http://localhost:3101 HU_E1_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e1-http
HU_B7_INTEGRATION_BASE_URL=http://localhost:3101 HU_B7_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:b7
```
(`b7` no usa Mercado Pago; corre contra el mismo servidor sin variables extra.) Resultado al 2026-10-01 sobre `swat_erp_test_e2`: e1-http 15/15 (dos corridas), b7 6/6.

## 6. Modo de la pasarela (`MP_MODO`)

| `MP_MODO` | `NODE_ENV` | Comportamiento |
|---|---|---|
| no definido, vacío o cualquier valor distinto de `simulado` (comparación exacta, sensible a mayúsculas) | cualquiera | API REAL de Mercado Pago (`api.mercadopago.com`) con las credenciales del Conector ACTIVO |
| `simulado` | distinto de `production` | Simulador local (sin red) |
| `simulado` | `production` | **Error** en cada operación del Adapter ("MP_MODO=simulado está prohibido en producción"): falla cerrado, nunca simula ni llama a MP. Checkout → 500; webhook → 500 (MP reintenta) |
