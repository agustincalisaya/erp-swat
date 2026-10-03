# HU-E1 — Catálogo online con disponibilidad real-time y carrito persistente

**Módulo:** E — Canal de Venta Online (E-commerce / Click & Collect)
**Responsable:** Lautaro Vilte
**Prioridad / estimación:** 1 · 5 SP
**Spec:** `docs/specs/spec_modulo_E.md` §2.1 (y §2.2 pasos 1, 3 y 4 — checkout parcial, decisión D1).
**Task y decisiones aprobadas:** `docs/tasks/HU-E1.md` §3.1 y §13.
**Estado:** Implementada (catálogo, carrito de visitante y de cuenta, fusión, checkout parcial hasta Pago Pendiente). El pago con Mercado Pago es HU-E2; la anulación del pedido por TTL vencido es HU-E7 — ver Sección 10.

## 1. Objetivo

Que el Cliente Web navegue el catálogo con stock real del depósito del canal web, arme un carrito (sin sesión o con sesión) y llegue al checkout sin riesgo de sobreventa: el stock se reserva con TTL y, si el pago no llega a tiempo, vuelve solo a Disponible.

**Criterios de aceptación:**

1. El storefront consulta en tiempo real el modelo de disponibilidad del Módulo A, nunca una copia propia, filtrado por el depósito configurado para el canal web (por defecto, el Showroom).
2. Un artículo agotado en el mostrador se refleja agotado en la tienda web de inmediato.
3. El precio mostrado proviene de la versión vigente de la Lista de Precios de Venta (HU-B9). Un SKU sin precio vigente no se muestra como comprable.
4. Si un artículo de un carrito se desactiva antes de completar el checkout, la confirmación se bloquea, se muestra un aviso que identifica el artículo afectado y el cliente recibe una notificación interna (HU-F3).
5. Si el pago no se confirma dentro de la ventana, la reserva vence y el stock vuelve a "Disponible" automáticamente.
6. Un visitante sin sesión navega y arma un carrito; iniciar el checkout exige sesión de Cliente Web (HU-E8).
7. El carrito es persistente y está asociado a la cuenta; al iniciar sesión, el carrito del visitante se fusiona con el de la cuenta.

## 2. Arquitectura: E1 orquesta, no reimplementa

| Capacidad | Dueño | Qué usa E1 |
|---|---|---|
| Disponible por SKU y depósito | Módulo A | `obtenerStockDisponiblePorVariantes()` (`stock.service.ts`, mismo `where` que `obtenerStockDisponible()`) |
| Reserva con TTL | Módulo A | `crearReservaTx()` (D2), origen `CHECKOUT_WEB` (D3) |
| Liberación de vencidas | Módulo A | job `liberarReservasVencidas()` + `liberarReservasVencidasTx()` en el checkout (D4.2) |
| Precio vigente | HU-B9 | `resolverPreciosVentaVigentes()` (mínimo, `lista-precio-venta.service.ts`) |
| Alta del pedido | Módulo B | `crearPedidoVentaReservadoTx()` (`pedido-venta.service.ts`) |
| Depósito web / TTL | D.4 | `obtenerDepositoCanalWebId()` / `obtenerTtlCheckoutHoras()` (`configuracion.service.ts`) |
| Notificación al cliente | HU-F3 | listener mínimo de `ecommerce:carrito_articulo_no_disponible` |
| Sesión de Cliente Web | HU-E8 | `lib/auth/sesion-cliente-web.ts` (mínimo `TODO(HU-E8)`) |

Servicios propios de E1 (`src/lib/services/ecommerce/`):

- `comprabilidad.ts` — predicado ÚNICO `evaluarComprabilidad()` (puro), usado por catálogo, carrito y checkout.
- `catalogo-web.service.ts` — `resolverVariantesWeb()` (la vista web de N variantes: stock + precio + comprable), `listarCatalogo()`, `obtenerDetalleProductoWeb()`.
- `carrito.service.ts` — carrito de visitante/cuenta, `agregarAlCarrito()`, `actualizarCantidadCarrito()`, `quitarDelCarrito()`, `fusionarCarritoVisitante()`.
- `carrito.reglas.ts` — plan de fusión puro (`planificarFusion()`).
- `carrito-token.ts` — token del visitante + firma HMAC de la cookie.
- `checkout.service.ts` — `iniciarCheckout()`, `buscarPedidoPendienteVigente()` (D10 caso 2), `obtenerPedidoWebPendiente(id, clienteId)` (página de pendiente por id, con "Reserva vencida").
- `pedido-web.reglas.ts` — `derivarEstadoVisiblePedidoWeb()` (puro).
- `contexto-tienda.ts` / `respuesta-tienda.ts` — contexto (cuenta o visitante) desde cookies y mapeo de errores HTTP.

## 3. "Desactivado" y "comprable" (D6)

Un artículo es comprable si pasa, en este orden, los 5 controles; el primero que falla es el `motivo`:

| Motivo | Condición |
|---|---|
| `SKU_INACTIVO` | `VarianteSKU` con baja lógica |
| `PRODUCTO_INACTIVO` | `ProductoMaestro` con baja lógica |
| `NO_VISIBLE_WEB` | sin `ProductoWebContenido`, contenido dado de baja o `visibilidad_web = false` |
| `NO_PUBLICABLE` | sin foto activa o sin descripción (spec E §2.11) |
| `SIN_PRECIO_VIGENTE` | HU-B9 no devuelve precio |

El stock NO es parte del predicado: stock insuficiente responde `422 STOCK_INSUFICIENTE` y no notifica.

En el catálogo solo se LISTAN productos publicados (contenido activo y visible, Producto Maestro activo, foto y descripción). Por eso:

- **Camisa de Policía** (publicada, sin precio) → se lista con "No disponible para la compra".
- **Gorra Táctica** (tiene precio 9500, pero `visibilidad_web = false`, fixture de HU-E5) → no se lista y su detalle da **404**. Es el comportamiento esperado: un producto con la visibilidad web apagada no se publica (spec E §2.5).
- **Chaleco Táctico** (Producto Maestro inactivo) → no se lista.

A nivel variante (CA2), el selector del detalle muestra cada SKU con stock 0 como "— agotado" y el botón queda "Agotado" deshabilitado; el servidor lo rechaza igual con `422 STOCK_INSUFICIENTE`.

## 4. Modelo de datos y migración `20261001143427_hu_e1_carrito_web`

Sin modelos nuevos: `CarritoWeb` / `CarritoWebItem` ya existían (Sprint 4). La migración:

- `ALTER TYPE "OrigenReserva" ADD VALUE 'CHECKOUT_WEB'` (D3).
- `updated_at` en `items_carrito_web` y `cuentas_cliente_web` (D9, RULES §1).
- Saca el único total de `carritos_web.cuenta_cliente_web_id` y crea el índice único PARCIAL `carritos_web_cuenta_activa_key` (`WHERE is_active AND deleted_at IS NULL`): un solo carrito ACTIVO por cuenta, sin bloquear el job de carritos abandonados de HU-E5 (D5). Prisma 6 no modela índices parciales; `prisma migrate diff` contra la base migrada da vacío (no intenta borrarlo). `CuentaClienteWeb.carrito` pasó a `carritos CarritoWeb[]`.

Bajas lógicas (nunca `DELETE`):

| Situación | Fila | `deletion_reason` | `deleted_by` |
|---|---|---|---|
| Quitar ítem | `items_carrito_web` | `QUITADO_POR_CLIENTE` | cuenta, o `null` si es visitante |
| Fusión | carrito visitante | `FUSIONADO` (y `carrito_token = null`) | cuenta |
| Fusión | ítems del visitante | `FUSIONADO_EN_CARRITO_DE_CUENTA` | cuenta |
| Checkout | carrito de la cuenta | `convertido en pedido` | cuenta |

## 5. Checkout parcial y concurrencia

`POST /api/tienda/checkout` → `iniciarCheckout(sesion)`:

1. `vinculacion_pendiente` → `403 CUENTA_VINCULACION_PENDIENTE`.
2. **D10 — la idempotencia se decide por el CARRITO, no por la cuenta** (regla vigente desde 2026-10-01; reemplaza la versión "por cuenta", que devolvía un pedido viejo y dejaba el carrito nuevo lleno):
   1. **Carrito activo con ítems** → checkout normal (pasos 3 y 4): pedido NUEVO y el carrito pasa a "convertido en pedido" (`201`). Puede coexistir con otros pedidos `PAGO_PENDIENTE` vigentes de la misma cuenta.
   2. **Sin carrito activo con ítems y con un pedido `PAGO_PENDIENTE` vigente** (todas sus reservas activas y con `fecha_expiracion > now()`) → se devuelve ese pedido sin reservar (`200`, `reutilizado: true`): el doble clic.
   3. **Ni carrito con ítems ni pedido vigente** → `422 CARRITO_VACIO`. Un pedido con la reserva vencida no cuenta.

   Doble clic SIMULTÁNEO sobre el mismo carrito: las dos requests entran al paso 3; la segunda se bloquea en la conversión del carrito, ve `count = 0` y cae en el caso 2, devolviendo el pedido de ESE carrito (lo ubica por `Reserva.motivo = "Checkout web — carrito <id>"`, no "el último de la cuenta"). No se crea un pedido duplicado.
3. Una `$transaction` (READ COMMITTED):
   1. Baja lógica del carrito ("convertido en pedido") como PRIMERA sentencia.
   2. Ítems + comprabilidad + precio vigente → `422 ARTICULO_NO_DISPONIBLE` con `details.items[]` (todos los afectados).
   3. **D4.2:** `liberarReservasVencidasTx(tx, { depositoId, skuIds })` — reservas vencidas de esos SKU en el depósito web, aunque el job no haya corrido.
   4. `crearReservaTx()` por ítem (`CHECKOUT_WEB`, `ttl_horas = ECOMMERCE_CHECKOUT_TTL_HORAS`).
   5. `crearPedidoVentaReservadoTx()` (Módulo B, `RESERVADO`, canal `WEB`, registrante `canal.web.sistema`) + `PedidoVentaEcommerce` `PAGO_PENDIENTE`.
4. Después del commit: eventos de reservas liberadas/congeladas, `ecommerce:checkout_iniciado` y `ecommerce:carrito_convertido_en_pedido`. Si fue un 422 de artículo no disponible: un `ecommerce:carrito_articulo_no_disponible` por ítem (después del rollback; el carrito queda intacto).

**Concurrencia — `UPDATE` condicional, sin `SELECT … FOR UPDATE`:**

- Stock: `UPDATE stock_depositos SET cantidad = cantidad - n WHERE … AND cantidad >= n`. La segunda transacción espera el lock de la fila y reevalúa el `WHERE` contra el valor commiteado → `count = 0` → `STOCK_INSUFICIENTE` → rollback total. El stock nunca queda negativo ni se reserva dos veces la misma unidad.
- Mismo carrito: `UPDATE carritos_web … WHERE id = ? AND is_active` serializa dos checkouts de la misma cuenta; el segundo ve `count = 0` y devuelve el pedido del primero.
- Liberación: el núcleo `liberarReservaVencidaTx()` cierra la reserva (`WHERE fecha_fin_reserva IS NULL`) ANTES de reincrementar stock.
- `numero_venta` se calcula contando pedidos del año; ante colisión (`P2002`) el checkout se reintenta hasta 3 veces.

**Pedido Pago Pendiente con reserva vencida:** hoy queda `PAGO_PENDIENTE` / `RESERVADO` (la anulación es de HU-E7). La tienda lo muestra como **"Reserva vencida"** derivado de `ttl_expiracion` sin escribir en la base (`/tienda/checkout/pendiente?pedido=<id>`).

## 6. Endpoints y páginas

| Método | Ruta | Guard | Respuestas |
|---|---|---|---|
| GET | `/api/tienda/catalogo?q=&categoria=&page=&page_size=` | público | 200 · 400 · 503 `CANAL_WEB_NO_CONFIGURADO` |
| GET | `/api/tienda/catalogo/[producto_web_id]` | público | 200 · 404 `PRODUCTO_WEB_NO_ENCONTRADO` |
| GET | `/api/tienda/carrito` | cookie `swat_carrito` (visitante) o `swat_tienda_session` | 200 (carrito vacío si no hay) |
| POST | `/api/tienda/carrito/items` | ídem; sin carrito crea uno y setea `swat_carrito` | 201 · 404 · 422 `ARTICULO_NO_DISPONIBLE` / `STOCK_INSUFICIENTE` |
| PATCH | `/api/tienda/carrito/items/[id]` | ídem + propiedad del ítem | 200 · 404 `ITEM_CARRITO_NO_ENCONTRADO` · 422 |
| DELETE | `/api/tienda/carrito/items/[id]` | ídem — baja lógica | 200 · 404 |
| POST | `/api/tienda/checkout` | `withSesionClienteWeb` | 201 (D10 caso 1) · 200 `reutilizado` (caso 2) · 422 `CARRITO_VACIO` (caso 3) · 401 `SESION_CLIENTE_WEB_REQUERIDA` · 403 · 409 `CHECKOUT_EN_CURSO` · 422 artículo/stock · 503 |
| POST | `/api/tienda/cuenta/login` | público (HU-E8 provisional) + fusión (CA7) | 200 · 401 `CREDENCIALES_INVALIDAS` · 423 |
| POST | `/api/tienda/cuenta/logout` | público (borra la cookie) | 200 |

Ninguna ruta de la tienda usa `withPermission` ni la sesión del ERP: el Cliente Web no es un rol del RBAC interno.

Páginas (`app/(tienda)`, layout propio, mobile-first): `/tienda` (→ catálogo), `/tienda/catalogo`, `/tienda/catalogo/[producto_web_id]`, `/tienda/carrito`, `/tienda/ingresar`, `/tienda/checkout/pendiente?pedido=<pedido_venta_id>` (muestra el pedido que devolvió el checkout, por id; un id ajeno o inexistente se ve como "no encontrado").

## 7. Eventos de dominio y auditoría (Módulo D)

| Evento | Auditoría (`AuditLog`) | Otro consumidor |
|---|---|---|
| `ecommerce:carrito_articulo_no_disponible` | `CHECKOUT_BLOQUEADO` sobre `items_carrito_web` | HU-F3: notificación ADVERTENCIA (idempotente por ítem) |
| `ecommerce:carrito_fusionado` | `CARRITO_FUSIONADO` sobre `carritos_web` (origen) | — |
| `ecommerce:checkout_iniciado` | `CREATE` sobre `pedidos_venta_ecommerce` | — |
| `ecommerce:carrito_convertido_en_pedido` | `DELETE_LOGICO` sobre `carritos_web` | — |
| `stock:reserva_congelada` / `stock:reserva_liberada` | ya auditados por Módulo A | — |

El Cliente Web no es un `Usuario`: `usuario_id = null` y la cuenta va en `valor_nuevo`. Agregar/editar/quitar ítems no se audita (D8). Ningún payload lleva PII ni precios.

## 8. Configuración y job de reservas

- `.env`: `JWT_SECRET_CLIENTE_WEB` y `CARRITO_COOKIE_SECRET` (64 hex cada uno, `openssl rand -hex 32`; el primero distinto de `JWT_SECRET`). Ver `.env.example`.
- Job (D4): `npm run job:reservas` (una pasada) o `npm run job:reservas:watch` (cada 60 s; `JOB_RESERVAS_INTERVALO_SEG` lo cambia). Alternativa con Docker, con la app corriendo en el host: `docker compose --profile jobs up -d cron-reservas`.

## 9. Cómo probar

### 9.1. Tests automáticos

```bash
# Nivel 1 — unit (incluye hu-e1.unit.test.ts, reglas de notificación y reserva)
npm test

# Nivel 2 — servicios contra una base DESCARTABLE en el Postgres del docker-compose
docker exec swat_erp_postgres psql -U erpswat -d postgres -c "DROP DATABASE IF EXISTS swat_erp_test_e1" -c "CREATE DATABASE swat_erp_test_e1"
export TEST_DB="postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e1?schema=public"
DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
HU_E1_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e1

# Nivel 2 — HTTP: un servidor APARTE apuntando a la base de test (no el `next dev` de desarrollo).
# Desde HU-E2 el checkout crea la preferencia de Mercado Pago: el servidor necesita
# MP_MODO=simulado (sin red) y APP_PUBLIC_URL. El simulador está PROHIBIDO con
# NODE_ENV=production, así que el servidor de test es `next dev` (no `next start`).
# Si la base de test se sembró con otra ENCRYPTION_KEY_PROVEEDORES que la del .env,
# pasar la misma clave (el webhook descifra el Conector con ella).
DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3101 npx next dev -p 3101   # en otra terminal
HU_E1_INTEGRATION_BASE_URL=http://localhost:3101 HU_E1_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e1-http
```

> El servidor de test también necesita `JWT_SECRET_CLIENTE_WEB` y `CARRITO_COOKIE_SECRET` (64 caracteres hexadecimales cada una, `openssl rand -hex 32`, distintas de `JWT_SECRET`), además de `MP_MODO=simulado` y `APP_PUBLIC_URL`. Exportarlas solo en la shell que levanta `next dev`; nunca en archivos. Lo mismo vale para `test:integration:e8-http` (variables `HU_E8_INTEGRATION_BASE_URL` y `HU_E8_INTEGRATION_DATABASE_URL`). La base de test debe estar migrada (`prisma migrate deploy`) y sembrada (`prisma db seed`): el seed crea las claves `ECOMMERCE_CUENTA_WEB_*`.

> ⚠️ **`test:integration:e1-http` MODIFICA la base a la que apunta el servidor:** crea clientes, cuentas web, artículos, carritos, reservas y pedidos propios (no borra nada). Correrlo SIEMPRE contra la base de test (`swat_erp_test_e1`), nunca contra la base de desarrollo de alguien. Exige las dos variables y ambas deben apuntar a la MISMA base: el test prepara su estado por Prisma (`HU_E1_INTEGRATION_DATABASE_URL`) y lo verifica por HTTP (`HU_E1_INTEGRATION_BASE_URL`). Cada caso usa su propia cuenta y sus propios artículos (`hu-e1.test-fixtures.ts`), así que no depende del seed ni de pedidos previos y espera un único resultado. `test:integration:e1` también escribe en la base indicada (misma advertencia).

Resultados al cierre: unit 498/498 · `test:integration:e1` 21/21 · `test:integration:e1-http` 15/15 (contra `next start` sobre la base de test, 2 corridas seguidas) · regresión B1 9/9, B3 10/10, B4 9/9 · `tsc --noEmit` 0 · ESLint 0 errores (3 warnings preexistentes ajenos a E1).

### 9.2. Datos del seed

| Qué | Valor |
|---|---|
| Cliente Web de E1 | `carlos.ruiz@example.com` / `abc123456789` (carrito: CT2 ×1 + SKU inactivo ×1) |
| Cliente Web con vinculación pendiente | `maria.gomez@example.com` / `abc123456789` (checkout → 403) |
| Personal interno (no entra a la tienda) | `admin.seed@erp-swat.local` / `abc123456789` (login de tienda → 401) |
| Carrito de visitante | token `0b61c7bf18671e7ed1a096da1a17d9ea94c81004ed50d22a` (CT3 ×2 + CT2 ×1) |
| SKU inactivo | `CAMTAC-MANGA LARGA-XL-VERDE-H` (precio y stock 5, baja lógica) |
| Sin precio vigente | Camisa de Policía `CAMPOL-POLICÍA-M-AZUL-H` |
| Agotado en la web | Borcegos 38 `BORCEG-COMBATE-38-NEGRO-M` (Showroom = 0) |
| No visible | Gorra Táctica (404) · Producto inactivo: Chaleco Táctico |
| Depósito web / TTL | Showroom (`acafbd3f-…`) / 1 hora |

Re-correr `npx prisma db seed` restaura carritos y fixtures (no toca pedidos ya creados).

### 9.3. Cookie del visitante del seed (para probar la fusión)

La cookie `swat_carrito` es `<token>.<firma HMAC>`. Para la del seed:

```bash
node -e "require('dotenv').config({quiet:true});const c=require('crypto');const t='0b61c7bf18671e7ed1a096da1a17d9ea94c81004ed50d22a';console.log(t+'.'+c.createHmac('sha256',Buffer.from(process.env.CARRITO_COOKIE_SECRET,'hex')).update(t).digest('base64url'))"
```

En el navegador: DevTools → Application → Cookies → `http://localhost:3000` → nueva cookie `swat_carrito` con ese valor, path `/`. En Postman: pestaña Cookies del dominio `localhost`. Alternativa sin cookie del seed: navegar en incógnito y agregar productos como visitante (la cookie se crea sola).

### 9.4. Postman (base `http://localhost:3000`)

| Request | Body |
|---|---|
| `GET /api/tienda/catalogo?q=camisa` | — |
| `GET /api/tienda/catalogo/294e081c-f561-4cfe-98d8-1405326ba6db` (Camisa Táctica) | — |
| `POST /api/tienda/carrito/items` | `{ "variante_sku_id": "6fbb4612-9e6d-4661-b250-0bc62579089e", "cantidad": 1 }` (CT2) |
| `PATCH /api/tienda/carrito/items/{item_id}` | `{ "cantidad": 2 }` |
| `DELETE /api/tienda/carrito/items/{item_id}` | — |
| `POST /api/tienda/cuenta/login` | `{ "email": "carlos.ruiz@example.com", "password": "abc123456789" }` |
| `POST /api/tienda/checkout` | — (requiere la cookie `swat_tienda_session` del login) |
| `POST /api/tienda/cuenta/logout` | — |
| `POST /api/cron/check-pruebas-vencidas` | header `Authorization: Bearer <CRON_SECRET>` (o `npm run job:reservas`) |

Otros UUID útiles: CT3 `0929aab1-57fb-44bc-90b6-76417c76c016`, Policía `fadabd3f-991e-4e26-90f2-ad8cc97856c7`, Borcegos 38 `79f41b7f-a667-4867-b3cc-2c73f6134086`, SKU inactivo `9f8b39ba-97af-42fc-9915-2f46a5fe67f9`.

### 9.5. Checklist de verificación manual (un paso por CA)

Preparación: `npx prisma migrate deploy` → `npx prisma db seed` → `npm run dev` → en otra terminal `npm run job:reservas:watch`. Navegador A normal y navegador B en incógnito.

- [ ] **CA1 — disponible del depósito web.** Abrir `http://localhost:3000/tienda/catalogo/294e081c-f561-4cfe-98d8-1405326ba6db` (Camisa Táctica) y anotar el disponible de "Manga Corta · Negro · Talle L". Comparar con `SELECT cantidad FROM stock_depositos WHERE variante_sku_id='6fbb4612-9e6d-4661-b250-0bc62579089e' AND deposito_id='acafbd3f-3309-46f6-8199-3509ca1d37f9'` → coincide. Cambiar en Prisma Studio `configuraciones_sistema.ECOMMERCE_DEPOSITO_CANAL_WEB_ID` al Depósito Central (`a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a`), recargar: el número cambia al del Central sin reiniciar. Restaurar el Showroom.
- [ ] **CA2 — agotado en mostrador → agotado en la web.** En la ficha de Borcegos (`/tienda/catalogo/46390457-e84e-4045-9cd2-bd9010f6fbf2`) la variante "Talle 38" figura "— agotado" y el botón dice "Agotado". Después, con `cajero.seed` en el POS (o bajando `stock_depositos.cantidad` a 0 en Prisma Studio para el Talle 42 en el Showroom), recargar la ficha: el Talle 42 pasa a "— agotado" de inmediato, y si todas las variantes quedan en 0 el catálogo muestra el badge "Agotado".
- [ ] **CA3 — precio vigente / sin precio.** El precio de la Camisa Táctica coincide con `items_lista_precio_venta` de la versión con `vigente_desde` pasada (no la futura). (Que una versión con `vigente_desde` futura no se aplique lo cubre `test:integration:e1`, escenario CA3: la Gorra del seed no sirve para verlo en la UI porque no es visible.) La "Camisa de Policía" aparece con "No disponible para la compra" y sin botón activo. `POST /api/tienda/carrito/items` con su UUID → 422 `ARTICULO_NO_DISPONIBLE`, motivo `SIN_PRECIO_VIGENTE`.
- [ ] **CA4 — artículo desactivado bloquea el checkout.** Ingresar como Carlos en `/tienda/ingresar` → `/tienda/carrito`: el ítem `CAMTAC-MANGA LARGA-XL-VERDE-H` muestra "Este artículo fue discontinuado. Quitalo para poder continuar." → "Iniciar compra": se bloquea y el aviso nombra ese SKU. En Prisma Studio, `notificaciones` tiene una fila ADVERTENCIA para la cuenta de Carlos; reintentar no crea otra. Repetir apagando `visibilidad_web` de otro producto del carrito: mismo bloqueo (motivo NO_VISIBLE_WEB).
- [ ] **CA5 — la reserva vence y el stock vuelve.** Quitar el ítem inactivo → "Iniciar compra" → `/tienda/checkout/pendiente?pedido=<id>` muestra ese pedido con "Pago pendiente", la hora de vencimiento (1 h), y el disponible en la ficha baja; `/tienda/carrito` queda vacío (también con recarga forzada). Agregar otro producto e "Iniciar compra" de nuevo crea OTRO pedido (D10 caso 1), aunque el anterior siga pendiente. En Prisma Studio, poner `reservas.fecha_expiracion` en el pasado para esas reservas; esperar ≤ 60 s (job): el disponible vuelve, la reserva tiene `fecha_fin_reserva` y hay un `movimientos_stock` `INGRESO` RESERVADO→DISPONIBLE. `/tienda/checkout/pendiente` muestra "Reserva vencida" (el pedido sigue `PAGO_PENDIENTE` en la base: la anulación es de HU-E7).
- [ ] **CA6 — visitante arma carrito; checkout exige sesión.** En el navegador B (sin sesión) agregar productos al carrito: funciona y aparece la cookie `swat_carrito`. "Ingresar para comprar" lleva a `/tienda/ingresar?redirect=/tienda/carrito`. `POST /api/tienda/checkout` sin cookies → 401 `SESION_CLIENTE_WEB_REQUERIDA`. Con `maria.gomez@example.com` → 403 `CUENTA_VINCULACION_PENDIENTE`.
- [ ] **CA7 — carrito persistente y fusión.** Re-correr el seed. En el navegador B setear la cookie del visitante del seed (§9.3) y abrir `/tienda/carrito`: CT3 ×2 y CT2 ×1. Ingresar como Carlos: el carrito tiene CT2 ×2 (1+1), CT3 ×2 y el SKU inactivo. En el navegador A, ingresar con la misma cuenta: el carrito es idéntico. Salir y volver a entrar: sigue igual. En la base, el carrito `1fa6fdec-…` quedó `is_active=false`, `carrito_token=NULL`, `deletion_reason='FUSIONADO'`, y hay un `AuditLog` `CARRITO_FUSIONADO`.

Transversal: ninguna fila de `carritos_web` / `items_carrito_web` desaparece (solo bajas lógicas).

## 10. Estado actual y pendientes

- **HU-E7 (coordinación pendiente):** un pedido `PAGO_PENDIENTE` cuyas reservas vencieron queda `PAGO_PENDIENTE` / `RESERVADO`; E7 debe consumir `stock:reserva_liberada` (TTL_VENCIDO) y pasarlo a `ANULADO`. Mientras tanto la tienda lo muestra "Reserva vencida" (derivado, sin escritura).
- **HU-E2 (pendiente obligatorio):** `confirmarReservaPorVenta()` no valida `fecha_expiracion`; E2 debe resolverlo antes de confirmar pagos web (no se tocó en E1 porque afecta al mostrador). E2 agrega `checkout_url` (Mercado Pago) y el cupón (E4).
- **Mínimos de HU ajenas a completar por sus owners:** B9 (`lista-precio-venta.service.ts`: solo el resolver), F3 (listener de un solo evento, sin bandejas), E8 (`sesion-cliente-web.ts`, sin registro ni bloqueo por intentos), D.4 (solo lectura de configuración).
- **Módulo B:** `crearPedidoVentaReservadoTx()` / `generarNumeroVentaTx()` agregados en `pedido-venta.service.ts`; las copias privadas de `generarNumeroVenta` en `presupuesto.service.ts` y `venta-mostrador.service.ts` siguen duplicadas (deuda).
- **HU-E5:** el índice parcial ya permite que el job de carritos abandonados dé de baja el carrito y la cuenta tenga uno nuevo; el plazo no tiene clave de configuración todavía.
- No se implementaron las Server Actions equivalentes de la spec (`app/(tienda)/carrito/actions.ts`): la UI usa los Route Handlers.
- Filtros completos del catálogo (talle/color/género/orden) son de HU-E11; E1 tiene búsqueda por texto, categoría y paginación.
