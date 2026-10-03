# Especificación Técnica — Módulo E (E-commerce / Tienda Online)
## ERP SWAT Indumentarias — Sprint 4
## Revisión 2 — HU-E8 (Registro e inicio de sesión del Cliente Web): contrato cerrado y sincronizado con la implementación. Revisión aditiva: las secciones 2.8.a a 2.8.g, 3.7, la extensión de la sección 4 y el cierre de la sección 5 (al inicio de su lista) se agregan dentro de cada sección sin alterar lo existente; el contenido de la Revisión 1 no se reescribe y ninguna sección se renumera.
## Revisión 1 — Primera especificación técnica del módulo (HU-E1 a HU-E13)

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable; Regla N.° 3 — Aislamiento de Dominio) · `Documento de Alcance Funcional y Técnico` (sección Módulo E) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja **Sprint 4**, HU-E1 a HU-E13) · `schema.prisma` · `spec_modulo_A.md` (sección 2.9, servicio centralizado de reserva — congelamiento/liberación de stock, único punto de contacto con inventario) · `spec_modulo_B.md` (sección 2.1/HU-B1, patrón de venta; sección 2.9/HU-B9, resolución server-side de precio; sección 2.7/HU-B7, comprobante fiscal simulado) · `spec_modulo_C.md` (sección 2.1/HU-C1, alta de Cliente; sección 2.4/HU-C4, consentimiento de datos personales) · `spec_modulo_D.md` (RBAC, auditoría, `ConfiguracionSistema` §6) · `spec_modulo_F.md` (sección 2.1/HU-F1, Conector Mercado Pago; sección 2.3/HU-F3, Motor de Notificaciones internas y aislamiento por tipo de sesión) · `spec_modulo_G.md` (HU-G11, registro del ingreso de cobros online) · `spec_modulo_H.md` (patrón de referencia de formato, cifrado AES-256 y consola de auditoría forense por dominio)

**Changelog de la Revisión 2 (HU-E8):**
| Sección Rev.1 | Estado previo | Acción en Rev.2 |
|---|---|---|
| 2.8 Ruta de blanqueo | `POST .../blanquear-password`, Server Action en `ventas/pos/actions.ts`, contraseña temporal o redefinición forzada | Reemplazada: vinculación y recuperación desde la pantalla `/ecommerce/cuentas-web`; recuperación por código de un uso (2.8.e) |
| 2.8 Permiso | `ventas:validar_identidad_cliente_web` provisional, "Vendedor/Cajero" | Confirmado ese nombre, **solo rol `VENDEDOR`** (2.8.a) |
| 2.8 N intentos | Clave de configuración "a agregar" | `ECOMMERCE_CUENTA_WEB_MAX_INTENTOS = 5` y `ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS = 15` (2.8.d) |
| 2.8 Nombre mínimo | 1 carácter | 2 caracteres, alineado con C1 (2.8.b) |
| 2.8 Consentimiento | `acepta_consentimiento` | `acepta_tratamiento` (literal `true`) y `acepta_comunicaciones` opcional (2.8.b) |
| 2.8 Vinculación | Sin contrato ("a definir en implementación") | Contrato en 2.8.e, con reasignación de acceso |
| 2.8 Registro, baja, aislamiento de pendientes | Sin contrato | 2.8.b, 2.8.f |
| 2.8 Sesión y login | Contrato de E1 | Sin cambios de contrato; bloqueo y aislamiento de pendientes en 2.8.c, 2.8.d y 2.8.f |
| 3 Reglas de negocio | Sin reglas de la cuenta web | Sección 3.7 |
| 4 Eventos | Cuatro eventos de cuenta | Se agregan `ecommerce:cuenta_web_recuperacion_habilitada` y `ecommerce:cuenta_web_password_redefinida` |
| 5 Fuera de alcance | Endpoint de vinculación y clave de intentos de login pendientes | Resueltos; se agrega la baja definitiva (re-registro y reactivación diferidos) |

---

## ⚠️ Alcance del módulo — Click & Collect exclusivamente

Las 13 HU de Módulo E, tal como quedaron redactadas en el Backlog (hoja Sprint 4), no modelan envío a domicilio en ningún criterio de aceptación: el único circuito de entrega es **retiro en la sucursal de Salta contra código QR y verificación de DNI** (HU-E3, HU-E9, HU-E12). Este documento no introduce envío a domicilio ni ninguna entidad de dirección de entrega — `DireccionCliente` (Módulo C, HU-C3) no es consumida por ningún endpoint de este módulo. Si el negocio necesita envío a domicilio en un sprint futuro, es una ampliación de alcance nueva, no cubierta aquí (ver también la nota actualizada en `spec_modulo_C.md` sección 5).

**Dos tipos de sesión, arquitectónicamente separados (criterio de aceptación explícito, HU-E8):** el Cliente Web **no** es un rol del RBAC interno y nunca accede a rutas del ERP administrativo; el personal interno (Administrador E-commerce, Operador de Pick & Pack) opera exclusivamente por RBAC granular de Módulo D. Este documento expone dos familias de rutas completamente separadas: `app/api/tienda/**` + `app/(tienda)/**/actions.ts` (storefront público y área de cliente, sesión de Cliente Web) y `app/api/ecommerce/**` + `app/(dashboard)/ecommerce/**/actions.ts` (backoffice de e-commerce, sesión RBAC de personal interno) — mismo principio de dos superficies ya aplicado por `spec_modulo_F.md` sección 2.3 para notificaciones.

---

## 1. Visión General

El Módulo E — E-commerce/Tienda Online es el canal de venta digital del ERP: un storefront público con catálogo, carrito y checkout con pago online, más un backoffice de administración de catálogo web, cupones y logística de preparación (Click & Collect). Módulo E **no reimplementa** ninguna capacidad ya resuelta por otro módulo — es una capa de orquestación que compone servicios ya existentes: el catálogo y el stock son de Módulo A (sección 2.9, HU-A10), la venta en sí se registra como un `PedidoVenta` de Módulo B con `canal = WEB` (misma entidad, mismo comprobante fiscal de HU-B7, mismo precio server-side de HU-B9), el pago se procesa a través del Conector de Mercado Pago de Módulo F (HU-F1) y las notificaciones al cliente y al Operador se emiten exclusivamente por el Motor de Notificaciones internas de Módulo F (HU-F3) — **este módulo nunca envía SMS, email ni WhatsApp**, coherente con la directiva del PO ya documentada en `spec_modulo_F.md` (solo Mercado Pago, sin mensajería externa).

**Extensión de estado propia, sin modificar la máquina de estados de Módulo B (Regla N.° 3 — aislamiento de dominio):** el ciclo de vida específico de e-commerce (`Pago Pendiente → Pago Confirmado → En Preparación → Listo para Retiro → Entregado`, más `Pago Rechazado`, `Anulado`, `Cancelado` y `Vencido sin retiro`) es más granular que la máquina de estados de `PedidoVenta` (`BORRADOR/EMITIDO/RESERVADO/FACTURADO/REMITO_EMITIDO/CERRADO/ANULADO`, `spec_modulo_B.md` sección 3.1) y no la reemplaza ni la bifurca: Módulo E agrega una entidad de extensión 1:1, `PedidoVentaEcommerce` (sección 2.2), que vive junto al `PedidoVenta` de Módulo B y lleva su propio campo `estado_ecommerce`. La correspondencia entre ambos estados está documentada en la sección 3.1 de este documento. Módulo B no necesita conocer los detalles de Click & Collect; Módulo E no reimplementa ninguna transición de la máquina de estados de venta.

Bajo Next.js App Router: **Route Handlers** (`app/api/tienda/**/route.ts`, `app/api/ecommerce/**/route.ts`) para integraciones e interacciones no-formulario (catálogo, carrito, webhook de pago, escaneo de QR desde la PWA del Operador), y **Server Actions** (`app/(tienda)/**/actions.ts`, `app/(dashboard)/ecommerce/**/actions.ts`) para formularios. Ambas superficies son wrappers finos — la lógica de dominio vive exclusivamente en `lib/services/ecommerce/*` (`catalogo-web.service.ts`, `carrito.service.ts`, `checkout.service.ts`, `cupon.service.ts`, `cuenta-cliente-web.service.ts`, `pick-pack.service.ts`).

**Regla N.° 1 aplicada al Módulo E:** ninguna entidad del módulo —`CuentaClienteWeb`, `CarritoWeb`, `CuponDescuento`, `ProductoWebContenido`, `PedidoVentaEcommerce`— admite `DELETE`. Toda baja es `UPDATE` sobre `is_active`, `deleted_at`, `deleted_by`, `deletion_reason` (con la única excepción documentada en 2.1 para carritos abandonados, que igual usa el mismo mecanismo de baja lógica, no una eliminación real). Toda relación saliente usa `onDelete: Restrict`.

**Regla N.° 2 aplicada al Módulo E:** los datos de la cuenta de Cliente Web (contraseña, datos de facturación de cada transacción) son información personal alcanzada por la Ley N.° 25.326. La contraseña se almacena exclusivamente con una función de derivación de clave con sal (`argon2id`, mismo estándar que `spec_modulo_D.md` para el RBAC interno — nunca un hash simple ni texto plano). Los datos de facturación de cada transacción de pago se cifran en reposo con AES-256 (`lib/crypto/aes.ts`, sección 2.6, mismo módulo centralizado ya usado por Módulo H para datos bancarios y por Módulo F para credenciales del Conector). Toda transacción de pago, toda anulación y toda cancelación de pedido pagado son **eventos sensibles** con encadenamiento SHA-256 hacia el Módulo D (sección 4).

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### Convenciones generales

- **Route Handlers**: `{ data, error: null }` / `{ data: null, error: { code, message } }`, `status` semántico (`400`/`401`/`403`/`404`/`409`/`422`).
- **Server Actions**: mismo shape que su Route Handler equivalente.
- Rutas de `app/api/ecommerce/**` y `app/(dashboard)/ecommerce/**` requieren sesión RBAC de personal interno y permiso granular vía `withPermission("ecommerce:<accion>")` (matriz de permisos definida por HU-E10, sección 2.10).
- Rutas de `app/api/tienda/**` y `app/(tienda)/**` que exigen sesión de Cliente Web la validan mediante un middleware propio, `withSesionClienteWeb()` — **no** es `withPermission` de Módulo D, es un mecanismo de sesión y propiedad de recurso completamente separado (ver ⚠️ arriba). Rutas de catálogo (2.1, 2.11) son públicas, sin sesión.
- El webhook de Mercado Pago (2.2.3) es la única ruta de todo el módulo sin sesión de ningún tipo — se autentica por firma, mismo patrón que `spec_modulo_F.md` sección 2.1.3.

### 2.1. Catálogo con disponibilidad real-time y carrito persistente (HU-E1)

**Ruta (listado/detalle, público):** `GET /app/api/tienda/catalogo/route.ts`, `GET /app/api/tienda/catalogo/[producto_web_id]/route.ts`
**Ruta (carrito):** `GET /app/api/tienda/carrito/route.ts`, `POST /app/api/tienda/carrito/items/route.ts`, `PATCH /app/api/tienda/carrito/items/[id]/route.ts`, `DELETE /app/api/tienda/carrito/items/[id]/route.ts` *(baja lógica del ítem del carrito, no `DELETE` físico — ver nota de nomenclatura de ruta abajo)*
**Server Action equivalente:** `agregarAlCarrito()`, `actualizarCantidadCarrito()`, `quitarDelCarrito()` en `app/(tienda)/carrito/actions.ts`
**Permiso:** ninguno para navegar el catálogo (público); el carrito no exige sesión de Cliente Web (visitante), solo la exige el checkout (2.2).

**Nota de nomenclatura de ruta:** la ruta HTTP usa el verbo `DELETE` por convención REST (quitar un ítem del carrito), pero internamente ejecuta baja lógica (`is_active = false`) sobre `CarritoWebItem` — nunca `prisma.carritoWebItem.delete()`, consistente con la Regla N.° 1. Mismo criterio que cualquier baja lógica expuesta bajo una ruta semánticamente `DELETE` en el resto del ERP.

```typescript
// src/lib/schemas/ecommerce.schema.ts
export const AgregarAlCarritoSchema = z.object({
  variante_sku_id: z.string().uuid(),
  cantidad: z.number().int().positive(),
});
export type AgregarAlCarritoInput = z.infer<typeof AgregarAlCarritoSchema>;

export const ActualizarCantidadCarritoSchema = z.object({
  cantidad: z.number().int().positive(),
});
```

**Modelo de datos:**
```prisma
model CarritoWeb {
  id                  String   @id @default(uuid())
  carrito_token       String?  @unique // cookie de visitante sin sesión; null una vez fusionado a una cuenta
  cuenta_cliente_web_id String? @unique
  cuenta_cliente_web  CuentaClienteWeb? @relation(fields: [cuenta_cliente_web_id], references: [id], onDelete: Restrict)
  items               CarritoWebItem[]
  is_active           Boolean  @default(true)
  deleted_at          DateTime?
  deleted_by          String?
  deletion_reason     String?
  updated_at          DateTime @updatedAt
  created_at          DateTime @default(now())
  @@map("carritos_web")
}

model CarritoWebItem {
  id              String   @id @default(uuid())
  carrito_id      String
  carrito         CarritoWeb @relation(fields: [carrito_id], references: [id], onDelete: Restrict)
  variante_sku_id String
  variante_sku    VarianteSKU @relation(fields: [variante_sku_id], references: [id], onDelete: Restrict)
  cantidad        Int
  is_active       Boolean  @default(true)
  deleted_at      DateTime?
  deleted_by      String?
  deletion_reason String?
  created_at      DateTime @default(now()) // Sprint 4, cierre: faltaba — ningún motivo documentado para omitirlo
  @@unique([carrito_id, variante_sku_id])
  @@map("items_carrito_web")
}
```

**Comportamiento esperado:**
- **Sin copia propia de disponibilidad (criterio de aceptación explícito):** el catálogo y el carrito consultan en tiempo real la disponibilidad de `StockDeposito` de Módulo A, filtrada por el depósito configurado para el canal web (`ConfiguracionSistema.ECOMMERCE_DEPOSITO_CANAL_WEB_ID`, `spec_modulo_D.md` sección 6). Un artículo agotado en mostrador se refleja agotado en la web de forma inmediata, sin caché ni proceso batch de sincronización.
- **Precio desde HU-B9 (criterio de aceptación explícito):** el precio mostrado en catálogo y carrito se resuelve con `resolverPrecioVentaVigente()` (`spec_modulo_B.md` sección 2.9). Un SKU sin precio de venta vigente no se muestra como comprable.
- **Carrito de visitante y carrito persistente (criterio de aceptación explícito):** un visitante sin sesión arma un carrito identificado por `carrito_token` (cookie firmada, sin PII). Al iniciar sesión (HU-E8), el servicio fusiona el carrito del visitante con el carrito persistente de la cuenta (`cuenta_cliente_web_id`) — sumando cantidades de ítems repetidos, respetando el stock disponible al momento de la fusión (no se valida contra Módulo A en la fusión en sí, solo al iniciar el checkout).
- **Bloqueo por desactivación de artículo (criterio de aceptación explícito, comparte contrato con HU-E5):** si un `ProductoWebContenido`/SKU de un carrito se desactiva (`visibilidad_web = false` o baja lógica) antes de completar el checkout, la confirmación del checkout se bloquea con `422 ARTICULO_NO_DISPONIBLE`, identificando el artículo afectado, y se emite el evento `ecommerce:carrito_articulo_no_disponible` (sección 4) que el listener de HU-F3 traduce en una notificación interna al cliente.
- **Carritos abandonados (criterio de aceptación explícito, comparte contrato con HU-E5):** un job programado desactiva por baja lógica (`is_active = false`, sin `deletion_reason` obligatorio, al no ser un evento de negocio auditable) los carritos sin actividad por más del plazo configurable (`ConfiguracionSistema`, clave a agregar — ver sección 5). El registro nunca se elimina; alimenta métricas de conversión (HU-E7 lo referencia para el análisis de abandono).

**Respuesta `200 OK` (carrito):**
```json
{ "data": { "carrito_id": "uuid", "items": [ { "variante_sku_id": "uuid", "cantidad": 2, "precio_unitario": 45000.00, "subtotal": 90000.00 } ], "total": 90000.00 }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (artículo no disponible):**
```json
{ "data": null, "error": { "code": "ARTICULO_NO_DISPONIBLE", "message": "Uno o más artículos del carrito ya no están disponibles", "details": { "variante_sku_id": "uuid" } } }
```

### 2.2. Checkout y pago con Mercado Pago (HU-E2)

**Ruta (iniciar checkout):** `POST /app/api/tienda/checkout/route.ts`
**Ruta (webhook de confirmación):** `POST /app/api/webhooks/mercadopago/route.ts` *(la misma ruta única ya definida por `spec_modulo_F.md` sección 2.1.3 — Módulo E no define un webhook propio, es consumidor del mismo evento `pago:webhook_confirmado` que emite el Conector)*
**Server Action equivalente:** `iniciarCheckout()` en `app/(tienda)/checkout/actions.ts`
**Permiso:** exige sesión de Cliente Web activa (`withSesionClienteWeb()`) — iniciar checkout sin sesión responde `401 SESION_CLIENTE_WEB_REQUERIDA` (criterio de aceptación explícito de HU-E1: navegar y armar carrito no requiere sesión, iniciar checkout sí).

```typescript
export const IniciarCheckoutSchema = z.object({
  cupon_codigo: z.string().optional(), // HU-E4
});
export type IniciarCheckoutInput = z.infer<typeof IniciarCheckoutSchema>;
```

**Modelo de datos (extensión 1:1 de `PedidoVenta`, ver Visión General):**
```prisma
enum EstadoEcommerce {
  PAGO_PENDIENTE
  PAGO_CONFIRMADO
  PAGO_RECHAZADO
  EN_PREPARACION
  LISTO_PARA_RETIRO
  ENTREGADO
  ANULADO
  CANCELADO
  VENCIDO_SIN_RETIRO
}

model PedidoVentaEcommerce {
  id                     String   @id @default(uuid())
  pedido_venta_id        String   @unique
  pedido_venta           PedidoVenta @relation(fields: [pedido_venta_id], references: [id], onDelete: Restrict)
  estado_ecommerce       EstadoEcommerce @default(PAGO_PENDIENTE)
  mercadopago_payment_id String?
  cupon_aplicacion_id    String?  @unique
  cupon_aplicacion       CuponAplicacion? @relation(fields: [cupon_aplicacion_id], references: [id], onDelete: Restrict)
  codigo_qr_retiro       String?  @unique
  plazo_retiro_vencimiento DateTime?
  operador_asignado_id   String?
  operador_asignado      Usuario? @relation(fields: [operador_asignado_id], references: [id], onDelete: Restrict)
  prioridad_manual       Int?
  is_active              Boolean  @default(true)
  deleted_at             DateTime?
  deleted_by             String?
  deletion_reason        String?
  updated_at             DateTime @updatedAt
  created_at             DateTime @default(now())
  @@map("pedidos_venta_ecommerce")
}
```

**Comportamiento esperado (inicio de checkout, dentro de `prisma.$transaction`):**
1. Valida stock y precio vigente de cada ítem del carrito (`resolverPrecioVentaVigente()`, `spec_modulo_B.md` sección 2.9). Un SKU sin precio o desactivado responde `422 ARTICULO_NO_DISPONIBLE` (2.1).
2. Aplica el cupón si se indicó (`spec_modulo_...` sección 2.4 de este documento, HU-E4) y valida contra el total — el total nunca queda negativo.
3. Invoca el servicio centralizado de reserva de Módulo A (`spec_modulo_A.md` sección 2.9, `POST /app/api/inventario/reservas/route.ts`) por cada ítem, con `origen_reserva` **a confirmar** (ver Nota de relevamiento abajo) y `ttl_horas` explícito y acotado — leído de `ConfiguracionSistema.ECOMMERCE_CHECKOUT_TTL_HORAS` (`spec_modulo_D.md` sección 6, ya reservada para este propósito), nunca el default general de 72h (mismo criterio ya corregido en `spec_modulo_A.md` sección 2.9, Revisión 3).
4. Crea el `PedidoVenta` de Módulo B (`canal = WEB`, `estado = RESERVADO`, usuario registrante = usuario de sistema "Canal Web") con sus `PedidoVentaItem` al precio congelado, y el `PedidoVentaEcommerce` asociado (`estado_ecommerce = PAGO_PENDIENTE`). **Módulo E no reimplementa la creación de `PedidoVenta`** — invoca la función de servicio de Módulo B (`pedido-venta.service.ts`), mismo principio de reutilización que ya exige `spec_modulo_B.md` sección 3.2 para stock.
5. Invoca el Conector de Mercado Pago de Módulo F (`spec_modulo_F.md` sección 2.1) para generar la preferencia de pago (`checkout_pro` o `checkout_bricks`, a definir en implementación — no bloqueante de este contrato) y devuelve al cliente la URL/token de checkout de Mercado Pago.

**Comportamiento esperado (confirmación vía webhook, consumidor de `pago:webhook_confirmado` de Módulo F):**
- El listener de Módulo E (`checkout.service.ts`, suscripto al mismo evento que dispara `spec_modulo_F.md` sección 2.1.3) resuelve el `PedidoVentaEcommerce` por `mercadopago_payment_id` / referencia externa del pago.
- **Idempotencia (criterio de aceptación explícito, heredado del contrato de Módulo F):** un webhook duplicado nunca genera doble confirmación — mismo patrón de idempotencia por clave única que HU-A10/HU-H4/HU-F3.
- **Importe nunca enviado por el navegador (criterio de aceptación explícito):** el importe cobrado es el total ya congelado en el `PedidoVenta` al iniciar el checkout (precios de HU-B9 + cupón de HU-E4) — el webhook de Mercado Pago informa el monto efectivamente cobrado y el servicio lo **valida** contra ese total congelado; una discrepancia se trata como evento a auditar, no se confía ciegamente en el monto del webhook.
- **Confirmación exitosa, en un único flujo transaccional:** stock `Reservado → Vendido` vía Módulo A (`PATCH /app/api/inventario/reservas/[id]/confirmar/route.ts`); se emite el comprobante fiscal de HU-B7 tipo Factura B (el cliente no elige tipo de comprobante — a diferencia de HU-B1); se emite el evento de ingreso hacia Módulo G (HU-G11, `spec_modulo_G.md`); se registra la transacción con SHA-256 (HU-E6, sección 2.6); `PedidoVenta.estado → FACTURADO`, `PedidoVentaEcommerce.estado_ecommerce → PAGO_CONFIRMADO` y, en el mismo commit, ingresa a la cola de preparación (`estado_ecommerce → EN_PREPARACION` es responsabilidad de HU-E12, sección 2.12 — este flujo deja el pedido en `PAGO_CONFIRMADO`, HU-E12 es quien lo toma).
- **Pago rechazado:** libera la reserva de inmediato vía Módulo A (mismo endpoint de liberación, no el job de TTL), `PedidoVentaEcommerce.estado_ecommerce → PAGO_RECHAZADO`, `PedidoVenta.estado` permanece `RESERVADO` hasta su propia liberación o hasta que el cliente reintente con un nuevo checkout (un nuevo `PedidoVenta`, no una reutilización del rechazado). El rechazo se registra como evento auditado.

**Respuesta `201 Created` (checkout iniciado):**
```json
{ "data": { "pedido_venta_id": "uuid", "checkout_url": "https://www.mercadopago.com.ar/checkout/...", "total": 87000.00, "ttl_expiracion": "2026-09-28T15:30:00.000Z" }, "error": null }
```

**Respuesta `401 Unauthorized` (sin sesión de Cliente Web):**
```json
{ "data": null, "error": { "code": "SESION_CLIENTE_WEB_REQUERIDA", "message": "Debe iniciar sesión para completar la compra" } }
```

**Nota de relevamiento — `origen_reserva` para checkout web, no cubierto por el enum actual:** `spec_modulo_A.md` sección 2.9 define `OrigenReserva` como `SENIA | LICITACION | PEDIDO_INSTITUCIONAL` (mismo enum ya señalado como con "residuo terminológico" en `spec_modulo_B.md`, sección ⚠️ inicial). Ninguno de los tres valores describe con precisión una reserva de checkout e-commerce. Este documento **no agrega un valor nuevo al enum por cuenta propia** — es una decisión de Módulo A, cuyo owner debe confirmar si corresponde agregar `WEB` (o reutilizar `SENIA` por analogía de "reserva de corto plazo con vencimiento acotado") antes de implementar HU-E1/E2. Reportado, no resuelto unilateralmente.

### 2.3. Ciclo Click & Collect y código QR de retiro (HU-E3)

**Sin endpoint propio de transición de estado:** esta HU no expone una ruta nueva — describe el **contrato de ciclo completo** que las secciones 2.2 (pago), 2.9 (Mis pedidos, visualización del QR) y 2.12 (cola de preparación, transición y validación del QR) ya implementan cada una en su propio endpoint. Esta sección documenta la relación entre ellas para que el ciclo completo quede trazable en un solo lugar.

**Comportamiento esperado:**
- Ciclo: `Pago Confirmado` (2.2) → `En Preparación` (2.12, ingreso automático a la cola) → `Listo para Retiro` (2.12, al completar la preparación — genera `codigo_qr_retiro`) → `Entregado` (2.12, al validar QR + DNI).
- El código QR (2.9) es visible **únicamente** en `estado_ecommerce = LISTO_PARA_RETIRO` y deja de ser válido al pasar a `ENTREGADO`, `CANCELADO` o `VENCIDO_SIN_RETIRO` — la validación de vigencia del QR se resuelve siempre contra `PedidoVentaEcommerce.estado_ecommerce`, nunca contra un campo de expiración propio del QR (el QR en sí no tiene TTL — lo que expira es el estado del pedido).
- La validación de identidad en el retiro (QR + DNI, un tercero no autorizado no puede retirar) es responsabilidad de 2.12.
- El plazo de retiro y su vencimiento (`VENCIDO_SIN_RETIRO`) son responsabilidad de HU-E13 (sección 2.13).

### 2.4. Cupones de descuento (HU-E4)

**Ruta (alta/edición/baja, Administrador E-commerce):** `POST /app/api/ecommerce/cupones/route.ts`, `PATCH /app/api/ecommerce/cupones/[id]/route.ts`, `PATCH /app/api/ecommerce/cupones/[id]/baja/route.ts`
**Server Action equivalente:** `crearCupon()`, `editarCupon()`, `darDeBajaCupon()` en `app/(dashboard)/ecommerce/cupones/actions.ts`
**Permiso requerido:** `ecommerce:gestionar_cupones` (exclusivo Administrador E-commerce, HU-E10).

```typescript
export const CrearCuponSchema = z.object({
  codigo: z.string().min(3).toUpperCase(),
  tipo_beneficio: z.enum(["PORCENTAJE", "MONTO_FIJO"]),
  valor: z.number().positive(),
  vigente_desde: z.coerce.date(),
  vigente_hasta: z.coerce.date(),
  limite_uso_global: z.number().int().positive().optional(),
  limite_uso_por_cliente: z.number().int().positive().default(1),
}).refine((d) => d.vigente_hasta > d.vigente_desde, { message: "vigente_hasta debe ser posterior a vigente_desde", path: ["vigente_hasta"] })
  .refine((d) => d.tipo_beneficio !== "PORCENTAJE" || d.valor <= 100, { message: "Un descuento porcentual no puede superar 100", path: ["valor"] });
export type CrearCuponInput = z.infer<typeof CrearCuponSchema>;
```

**Modelo de datos:**
```prisma
model CuponDescuento {
  id                     String   @id @default(uuid())
  codigo                 String   @unique
  tipo_beneficio         String   // "PORCENTAJE" | "MONTO_FIJO"
  valor                  Decimal  @db.Decimal(12, 2)
  vigente_desde          DateTime
  vigente_hasta          DateTime
  limite_uso_global      Int?
  limite_uso_por_cliente Int      @default(1)
  aplicaciones           CuponAplicacion[]
  is_active              Boolean  @default(true)
  deleted_at             DateTime?
  deleted_by             String?
  deletion_reason        String?
  created_at             DateTime @default(now())
  @@map("cupones_descuento")
}

model CuponAplicacion {
  id              String   @id @default(uuid())
  cupon_id        String
  cupon           CuponDescuento @relation(fields: [cupon_id], references: [id], onDelete: Restrict)
  pedido_venta_id String
  cliente_id      String
  monto_descontado Decimal @db.Decimal(12, 2)
  confirmada      Boolean  @default(false) // true recién al confirmarse el pago (HU-E2) — ver comportamiento
  is_active       Boolean  @default(true)  // Sprint 4, cierre: baja lógica al rechazarse el pago o vencer la reserva — ver comportamiento
  deleted_at      DateTime?
  deleted_by      String?
  deletion_reason String?
  created_at      DateTime @default(now())
  @@map("aplicaciones_cupon")
}
```

**Comportamiento esperado:**
- **Validación server-side al aplicar (criterio de aceptación explícito):** vigencia (`now()` entre `vigente_desde`/`vigente_hasta`), `is_active = true`, límite global (conteo de `CuponAplicacion.confirmada = true`) y límite por cliente (mismo conteo filtrado por `cliente_id`, resuelto contra la cuenta de Cliente Web de HU-E8). Un cupón inválido rechaza con `422` y el motivo específico (`CUPON_VENCIDO`, `CUPON_LIMITE_ALCANZADO`, `CUPON_INACTIVO`, `CUPON_NO_ENCONTRADO`).
- **Único cupón por pedido, no acumulable (criterio de aceptación explícito):** `IniciarCheckoutSchema` (2.2) acepta un único `cupon_codigo`; no existe forma de aplicar dos cupones al mismo `PedidoVenta`.
- **Base de cálculo (criterio de aceptación explícito):** el descuento se calcula sobre los precios de `ListaPrecioVenta` (HU-B9) ya congelados en el pedido — nunca sobre un total declarado por el cliente. El total resultante nunca puede quedar negativo (`Math.max(0, total - descuento)`).
- **Consumo diferido al pago confirmado (criterio de aceptación explícito, no negociable):** al iniciar el checkout se crea `CuponAplicacion` con `confirmada = false` (reserva optimista del uso, para que el límite se respete incluso con checkouts concurrentes en curso) — recién al confirmarse el pago (2.2) se setea `confirmada = true`. Si el pago es rechazado o la reserva vence (liberación por TTL), la `CuponAplicacion` correspondiente pasa a inactiva (baja lógica) y **no** cuenta contra el límite de uso.
- Baja lógica estándar; el historial de aplicaciones de un cupón desactivado se conserva íntegro.

**Respuesta `200 OK` (cupón aplicado, dentro del flujo de checkout):**
```json
{ "data": { "cupon_id": "uuid", "monto_descontado": 4500.00, "total_con_descuento": 40500.00 }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (cupón vencido):**
```json
{ "data": null, "error": { "code": "CUPON_VENCIDO", "message": "El cupón indicado no está vigente" } }
```

### 2.5. Visibilidad web independiente del inventario físico (HU-E5)

**Ruta:** `PATCH /app/api/ecommerce/catalogo/[producto_web_id]/visibilidad/route.ts`
**Server Action equivalente:** `cambiarVisibilidadWeb()` en `app/(dashboard)/ecommerce/catalogo/actions.ts`
**Permiso requerido:** `ecommerce:gestionar_catalogo` (Administrador E-commerce, HU-E10).

```typescript
export const CambiarVisibilidadWebSchema = z.object({
  visibilidad_web: z.boolean(),
  motivo: z.string().optional(), // no obligatorio: es una decisión comercial reversible, no una baja lógica definitiva
});
export type CambiarVisibilidadWebInput = z.infer<typeof CambiarVisibilidadWebSchema>;
```

**Comportamiento esperado:**
- **Indicador propio e independiente (criterio de aceptación explícito):** `ProductoWebContenido.visibilidad_web` (sección 2.11) es un campo de Módulo E, sin relación con `VarianteSku.is_active` de Módulo A. Un artículo puede estar activo en inventario y no visible en la tienda, y viceversa (aunque un artículo inactivo en inventario nunca se muestra como comprable, por la resolución de stock/precio de 2.1 — la independencia es de la bandera en sí, no del resultado final visible al cliente).
- La desactivación web en sí (`visibilidad_web = false`) es un `UPDATE` reversible, no una baja lógica con `deletion_reason` obligatorio — es una decisión comercial temporal, distinta de la baja lógica completa del contenido (2.11).
- Contrato compartido con HU-E1 (2.1): desactivar un artículo con ítems en carritos activos dispara `ecommerce:carrito_articulo_no_disponible` para cada carrito afectado.

**Respuesta `200 OK`:**
```json
{ "data": { "producto_web_id": "uuid", "visibilidad_web": false }, "error": null }
```

### 2.6. Log de auditoría de transacciones de pago (HU-E6)

**Ruta:** `GET /app/api/ecommerce/auditoria/pagos/route.ts`
**Permisos requeridos (dos niveles, mismo patrón que HU-A6/HU-B6/HU-H6):** `auditoria:leer_forense` (exclusivo Auditor — acceso completo a todas las transacciones); `ecommerce:solicitar_acceso_log_pagos` (Administrador E-commerce — **acceso solo a solicitud aprobada**, criterio de aceptación explícito y más restrictivo que el patrón habitual de "Supervisor con alcance reducido" de los otros módulos: el Administrador E-commerce **no** tiene lectura directa del log de pagos, debe solicitarla).

**Nota de relevamiento — mecanismo de "solicitud aprobada" sin precedente en el resto del ERP:** ningún otro módulo (A, B, H) modela un flujo de aprobación previa para que un rol no-Auditor acceda a su consola forense — todos usan el patrón "Auditor: alcance completo, Supervisor/rol equivalente: alcance reducido pero directo, sin aprobación previa" (`spec_modulo_B.md` sección 2.6, `spec_modulo_A.md` HU-A6, `spec_modulo_H.md` HU-H6). Este documento no inventa el mecanismo de aprobación (a quién se le solicita, cuánto dura el acceso otorgado, si expira) porque el Backlog no lo especifica — se deja como endpoint `POST /app/api/ecommerce/auditoria/pagos/solicitar-acceso/route.ts` con contrato **a definir**, gateado por el mismo permiso `ecommerce:solicitar_acceso_log_pagos`, y una nota explícita de que su aprobador y expiración deben confirmarse con el PO antes de implementar — no asumido silenciosamente como "igual al resto de los módulos".

```typescript
export const ListarLogPagosQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(50).default(20),
  estado_pago: z.enum(["APROBADO", "RECHAZADO", "PENDIENTE"]).optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
});
export type ListarLogPagosQuery = z.infer<typeof ListarLogPagosQuerySchema>;
```

**Modelo de datos:**
```prisma
model TransaccionPagoLog {
  id                        String   @id @default(uuid())
  pedido_venta_ecommerce_id String
  pedido_venta_ecommerce    PedidoVentaEcommerce @relation(fields: [pedido_venta_ecommerce_id], references: [id], onDelete: Restrict)
  mercadopago_payment_id    String
  monto                     Decimal  @db.Decimal(12, 2)
  estado_pago               String   // "APROBADO" | "RECHAZADO" | "PENDIENTE"
  resultado_webhook         String   // payload relevante del webhook, sin datos de tarjeta (nunca los recibe, ver 1.)
  datos_facturacion_cifrados String  // AES-256, lib/crypto/aes.ts — email/nombre de facturación del comprador al momento de la transacción
  created_at                DateTime @default(now())
  @@map("log_transacciones_pago")
}
```

**Comportamiento esperado:**
- Cada transacción de pago (confirmada o rechazada, 2.2) inserta una fila en `TransaccionPagoLog` y emite el evento sensible `ecommerce:transaccion_pago_registrada` (sección 4) hacia Módulo D, con encadenamiento SHA-256 — el log de auditoría de esta sección es de solo lectura sobre `AuditLog` filtrado (mismo patrón forense que HU-B6/HU-A6/HU-H6), **no** una tabla de auditoría propia con su propio hash-chain: `TransaccionPagoLog` guarda el detalle operativo (incluidos los datos cifrados), el hash-chain vive exclusivamente en `AuditLog` de Módulo D.
- **Cifrado AES-256 en reposo (criterio de aceptación explícito):** `datos_facturacion_cifrados` se cifra con el módulo centralizado de Módulo H (`lib/crypto/aes.ts`) — nunca un cifrado propio de Módulo E, mismo principio de capa de crypto dedicada que `spec_modulo_A.md` sección 3.6.
- **Acceso a campos cifrados audita su propio acceso (criterio de aceptación explícito, no negociable):** toda lectura de `datos_facturacion_cifrados` por un Auditor (nunca por el Administrador E-commerce, que no tiene este alcance ni con acceso aprobado — su solicitud de acceso cubre metadatos de transacción, no el campo cifrado) emite un evento adicional `ecommerce:acceso_dato_cifrado_auditado` (sección 4), distinto del evento de la transacción en sí.
- El sistema **nunca** recibe ni almacena datos de tarjeta — coherente con `spec_modulo_F.md` sección 2.1 (el checkout de tarjeta ocurre íntegramente dentro de Mercado Pago).

**Respuesta `200 OK`:**
```json
{ "data": { "items": [ { "transaccion_id": "uuid", "pedido_venta_id": "uuid", "monto": 87000.00, "estado_pago": "APROBADO", "timestamp": "2026-09-28T14:02:11.000Z" } ], "total": 1, "page": 1 }, "error": null }
```

**Respuesta `403 Forbidden` (Administrador E-commerce sin acceso aprobado):**
```json
{ "data": null, "error": { "code": "ACCESO_LOG_PAGOS_NO_APROBADO", "message": "El acceso al log de auditoría de pagos requiere una solicitud aprobada" } }
```

### 2.7. Anulación manual de orden web no abonada (HU-E7)

**Ruta:** `PATCH /app/api/ecommerce/pedidos/[id]/anular/route.ts`
**Server Action equivalente:** `anularOrdenNoAbonada()` en `app/(dashboard)/ecommerce/pedidos/actions.ts`
**Permiso requerido:** `ecommerce:anular_orden_no_abonada` (exclusivo Administrador E-commerce).

```typescript
export const AnularOrdenNoAbonadaSchema = z.object({
  deletion_reason: z.string().min(1, "El motivo de anulación es obligatorio"),
});
export type AnularOrdenNoAbonadaInput = z.infer<typeof AnularOrdenNoAbonadaSchema>;
```

**Comportamiento esperado:**
- Solo aplica sobre un `PedidoVentaEcommerce` en `estado_ecommerce = PAGO_PENDIENTE` o `PAGO_RECHAZADO` (no abonado) — cualquier otro estado responde `409 TRANSICION_INVALIDA` (un pedido ya `PAGO_CONFIRMADO` se cancela por HU-E13, no se anula por esta ruta).
- **Reversión de reserva sin eliminar el registro (criterio de aceptación explícito):** invoca la liberación de Módulo A sobre la `Reserva` asociada (`spec_modulo_A.md` sección 2.9) — el `PedidoVenta` y el intento de compra permanecen en el historial, baja lógica estándar (`is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason` obligatorio) tanto en `PedidoVenta` como en `PedidoVentaEcommerce` (`estado_ecommerce → ANULADO`).
- **Alimenta métricas de conversión (criterio de aceptación explícito):** el registro del carrito/orden abandonada no se descarta — queda disponible para el Módulo D (Tablero de Comando, `spec_modulo_D.md`, fuera de alcance de implementación de este documento, ya señalado como diferido en `spec_modulo_B.md` sección 5).
- **Automático por vencimiento de reserva (Dado/Cuando/Entonces del criterio de aceptación):** si el TTL de la reserva vence sin pago (job de Módulo A, `spec_modulo_A.md` sección 2.9 Revisión 3), el mismo efecto de anulación se dispara automáticamente — el job de TTL libera el stock; el listener de Módulo E que consume `stock:reserva_liberada` (motivo `TTL_VENCIDO`) es quien transiciona `PedidoVentaEcommerce.estado_ecommerce → ANULADO` cuando el `PedidoVenta` de origen es de canal `WEB` (correlación por `reserva_id` → `pedido_venta_id`). Esta transición automática **no** pasa por el endpoint de esta sección (que es exclusivamente la vía manual del Administrador).
- **Evento sensible (criterio de aceptación explícito):** toda anulación (manual o automática por TTL) emite `ecommerce:orden_anulada` (sección 4) con encadenamiento SHA-256.

**Respuesta `200 OK`:**
```json
{ "data": { "pedido_venta_id": "uuid", "estado_ecommerce": "ANULADO", "stock_liberado": true }, "error": null }
```

**Respuesta `409 Conflict` (ya abonada):**
```json
{ "data": null, "error": { "code": "TRANSICION_INVALIDA", "message": "Solo una orden no abonada (Pago Pendiente o Pago Rechazado) puede anularse por esta vía" } }
```

### 2.8. Registro e inicio de sesión de Cliente Web (HU-E8)

> **Revisión 2 (HU-E8):** el texto anterior de esta sección es el de la Revisión 1 y se conserva como antecedente. **Reemplazado en Rev.2: ver 2.8.a a 2.8.g** en lo siguiente: la ruta `POST /app/api/ecommerce/cuentas-web/[id]/blanquear-password/route.ts`, la Server Action `blanquearPasswordClienteWeb()` en `ventas/pos/actions.ts` y la "contraseña temporal o redefinición forzada" (reemplazadas por vinculación y recuperación por código desde `/ecommerce/cuentas-web`, 2.8.e y 2.8.f); el schema `RegistrarCuentaClienteWebSchema` (`nombre` pasa a mínimo 2 caracteres y `acepta_consentimiento` se reemplaza por `acepta_tratamiento` y `acepta_comunicaciones`, 2.8.b); la clave "a agregar" de intentos fallidos (2.8.d); el "endpoint de vinculación a definir en implementación" (2.8.e); y la nota de relevamiento sobre el nombre del permiso (2.8.a lo confirma). El modelo `CuentaClienteWeb` de arriba se amplía con tres campos de recuperación (2.8.e).

**Ruta (registro):** `POST /app/api/tienda/cuenta/registro/route.ts`
**Ruta (login):** `POST /app/api/tienda/cuenta/login/route.ts`
**Ruta (baja lógica de cuenta):** `PATCH /app/api/tienda/cuenta/baja/route.ts`
**Ruta (blanqueo de contraseña, uso exclusivo de Vendedor en sucursal — ver comportamiento):** `POST /app/api/ecommerce/cuentas-web/[id]/blanquear-password/route.ts`
**Server Action equivalente:** `registrarCuentaClienteWeb()`, `iniciarSesionClienteWeb()` en `app/(tienda)/cuenta/actions.ts`; `blanquearPasswordClienteWeb()` en `app/(dashboard)/ventas/pos/actions.ts` (vive junto a las acciones de POS, invocada por el Vendedor en sucursal — no es una pantalla propia de e-commerce).
**Permiso requerido:** ninguno para registro/login (público, es la propia cuenta que se crea); `ventas:validar_identidad_cliente_web` (rol Vendedor/Cajero, a confirmar el nombre exacto del permiso con el owner de RBAC — ver nota) para el blanqueo presencial.

```typescript
export const RegistrarCuentaClienteWebSchema = z.object({
  nombre: z.string().min(1),
  dni: z.string().regex(/^\d{7,8}$/),
  telefono: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  acepta_consentimiento: z.literal(true, { errorMap: () => ({ message: "Debe aceptar el consentimiento de tratamiento de datos personales" }) }),
});
export type RegistrarCuentaClienteWebInput = z.infer<typeof RegistrarCuentaClienteWebSchema>;

export const IniciarSesionClienteWebSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
```

**Modelo de datos:**
```prisma
model CuentaClienteWeb {
  id                   String   @id @default(uuid())
  cliente_id           String   @unique
  cliente              Cliente  @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  email                String   @unique
  password_hash        String   // argon2id
  token_version        Int      @default(0) // incrementado en baja lógica/blanqueo — invalida sesiones emitidas antes
  intentos_fallidos     Int      @default(0)
  bloqueada_hasta       DateTime?
  vinculacion_pendiente Boolean  @default(false) // true si el DNI ya existe como Cliente de mostrador sin validar
  is_active             Boolean  @default(true)
  deleted_at            DateTime?
  deleted_by             String?
  deletion_reason       String?
  created_at            DateTime @default(now())
  @@map("cuentas_cliente_web")
}
```

**Comportamiento esperado:**
- **Alta de Cliente en Módulo C, sin copia propia (criterio de aceptación explícito):** el registro invoca el alta de Cliente de Módulo C (`spec_modulo_C.md` sección 2.1, HU-C1) — Módulo E no persiste nombre/DNI/teléfono/email de forma independiente, solo `email` y `password_hash` propios de la cuenta de acceso.
- **Consentimiento obligatorio (criterio de aceptación explícito):** el registro exige `acepta_consentimiento` y crea el registro de Consentimiento en Módulo C (`spec_modulo_C.md` sección 2.4, HU-C4) con fecha y alcance — sin este paso, el alta no se completa.
- **Un DNI, una única cuenta web activa (criterio de aceptación explícito):** `CuentaClienteWeb.cliente_id` es `@unique` — un segundo intento de registro con el mismo DNI responde `409 CUENTA_WEB_YA_EXISTE`.
- **Vinculación pendiente si el DNI ya es Cliente de mostrador (criterio de aceptación explícito, no negociable):** si el DNI corresponde a un `Cliente` ya existente (dado de alta por mostrador), la cuenta se crea con `vinculacion_pendiente = true` y **queda inhabilitada para operar** (no puede iniciar checkout) hasta que un Vendedor valide la identidad del titular presencialmente y confirme la vinculación (endpoint de vinculación **a definir en implementación** — el Backlog no especifica su contrato exacto más allá de "un Vendedor valida"; no se inventa aquí un flujo de validación de identidad no descripto).
- **Contraseña (criterio de aceptación explícito, no negociable):** `argon2id` con sal — nunca texto plano ni hash reversible, mismo estándar que Módulo D para el RBAC interno.
- **Bloqueo por intentos fallidos (criterio de aceptación explícito):** tras N intentos fallidos consecutivos (`ConfiguracionSistema`, clave a agregar — ver sección 5), `bloqueada_hasta` se setea y se genera un evento en el log de auditoría (`ecommerce:cuenta_web_bloqueada`).
- **Recuperación de contraseña, exclusivamente presencial (criterio de aceptación explícito, no negociable — sin canal externo):** no existe flujo de "olvidé mi contraseña" por email/SMS. Un Vendedor valida el DNI del titular en la sucursal y ejecuta el blanqueo vía el endpoint de arriba, que incrementa `token_version` (invalidando toda sesión activa) y genera una contraseña temporal o exige que el cliente la redefina en su próximo login (decisión de UX no bloqueante de este contrato).
- **Sesión independiente del RBAC interno (criterio de aceptación explícito, ver ⚠️ Alcance):** la sesión de Cliente Web se emite como JWT propio, firmado con un secreto distinto al de las sesiones RBAC de Módulo D, con claim `token_version` verificado contra `CuentaClienteWeb.token_version` en cada request — un Cliente Web nunca obtiene un token válido para rutas `app/api/ecommerce/**` ni para ninguna ruta del ERP administrativo.
- **Fusión de carrito al iniciar sesión:** ver 2.1.
- **Baja lógica de la cuenta (criterio de aceptación explícito):** `is_active = false`, `deleted_at/by/reason`, incrementa `token_version` (revoca sesiones activas) — **no** afecta al `Cliente` de Módulo C ni a su historial de compras, que persisten independientemente de la cuenta de acceso web.
- **Eventos auditados (criterio de aceptación explícito):** alta, bloqueo, vinculación y baja generan evento auditado hacia Módulo D (sección 4).

**Respuesta `201 Created` (registro):**
```json
{ "data": { "cuenta_id": "uuid", "cliente_id": "uuid", "vinculacion_pendiente": false }, "error": null }
```

**Respuesta `409 Conflict` (DNI ya tiene cuenta):**
```json
{ "data": null, "error": { "code": "CUENTA_WEB_YA_EXISTE", "message": "El DNI indicado ya tiene una cuenta de Cliente Web activa" } }
```

**Respuesta `423 Locked` (cuenta bloqueada por intentos fallidos):**
```json
{ "data": null, "error": { "code": "CUENTA_BLOQUEADA", "message": "La cuenta está bloqueada temporalmente por intentos fallidos; la recuperación es presencial en sucursal" } }
```

**Nota de relevamiento — nombre del permiso para la validación presencial de identidad:** el Backlog no nombra el permiso ni confirma si es exclusivo de "Vendedor" (rol que Módulo B usa como "Cajero POS"/"Supervisor de Ventas", sin un rol "Vendedor" propio confirmado contra `seed.ts`) o si aplica a cualquier rol con acceso al POS. Se usa `ventas:validar_identidad_cliente_web` como nombre provisional, a confirmar contra el RBAC real de Módulo D antes de implementar — no asumido como ya sembrado.

### 2.8.a. Interfaces (Revisión 2 — HU-E8)

**Fecha de cierre:** 02/10/2026. Contrato aprobado y sincronizado con el código de `fix/HU-E8-deuda`. Donde la Revisión 2 difiere de lo implementado, esta sección describe el **código** y lo marca como *Nota de sincronización*.

| Operación | Ruta | Autorización | Respuesta OK |
|---|---|---|---|
| Registro | `POST /app/api/tienda/cuenta/registro/route.ts` | Pública | `201 { cuenta_id, cliente_id, vinculacion_pendiente }`, sin cookie de sesión |
| Login | `POST /app/api/tienda/cuenta/login/route.ts` (existe, HU-E1) | Pública | `200 { cuenta_id, email, vinculacion_pendiente, carrito_fusionado }` + cookie de sesión |
| Logout | `POST /app/api/tienda/cuenta/logout/route.ts` (existe, HU-E1) | Pública (solo borra la cookie) | Contrato de HU-E1 sin cambios |
| Baja propia | `PATCH /app/api/tienda/cuenta/baja/route.ts` | Sesión web **vinculada** (`withSesionClienteWeb`) | `200 { cuenta_id }` y borra la cookie |
| Redefinir contraseña | `POST /app/api/tienda/cuenta/redefinir-password/route.ts` | Pública con código válido | `200 { cuenta_id }`, sin sesión automática |
| Buscar cuenta por DNI | `GET /app/api/ecommerce/cuentas-web/route.ts?dni=` | `ventas:validar_identidad_cliente_web` | `200 { cuenta }` o `404 CUENTA_WEB_NO_ENCONTRADA` |
| Validar vinculación | `POST /app/api/ecommerce/cuentas-web/[id]/validar-vinculacion/route.ts` | `ventas:validar_identidad_cliente_web` | `200` (2.8.e) |
| Habilitar recuperación | `POST /app/api/ecommerce/cuentas-web/[id]/habilitar-recuperacion/route.ts` | `ventas:validar_identidad_cliente_web` | `201 { codigo, expira_en }` |

Las rutas internas usan `withPermission(PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB, …)`; la constante vive en `src/lib/auth/permisos-ecommerce.ts` (no en un `route.ts`, porque un Route Handler solo puede exportar métodos HTTP y opciones de segmento, y `next build` falla ante cualquier otro export). El permiso `ventas:validar_identidad_cliente_web` se asigna **solo al rol `VENDEDOR`**. El actor de las operaciones internas es siempre `session.userId`, nunca el body; el `cuentaId` de la baja es siempre el de la sesión web.

Las rutas son wrappers finos; la lógica vive en `lib/services/ecommerce/cuenta-cliente-web.service.ts` (`registrarCuentaClienteWeb`, `autenticarCuentaClienteWeb`, `validarVinculacionCuentaWeb`, `habilitarRecuperacionCuentaWeb`, `redefinirPasswordCuentaWeb`, `darDeBajaCuentaWeb`, `buscarCuentaWebPorDni`). Envelope estándar `{ data, error }`; input inválido: `400 VALIDATION_ERROR` con `fieldErrors`.

*Nota de sincronización:* la Rev.1 ubicaba la validación en una Server Action del POS; la implementación la expone como Route Handlers de `api/ecommerce/cuentas-web` y una pantalla propia (`/ecommerce/cuentas-web`), sin tocar archivos de Módulo B.

### 2.8.b. Registro (Revisión 2 — HU-E8)

**Input** (Zod, `src/lib/schemas/cuenta-cliente-web.schema.ts`, `RegistroCuentaWebSchema`):

```typescript
{
  nombre: string,        // trim, min 2
  dni: string,           // /^\d{7,8}$/
  telefono: string,      // trim, no vacío
  email: string,         // email válido, trim + minúsculas
  password: string,      // min 8, sin trim ni transformación
  acepta_tratamiento: true,            // literal true: obligatorio
  acepta_comunicaciones: boolean       // opcional en la UI, default false
}
```

La casilla de comunicaciones existe porque `crearClienteTx` exige una decisión comercial explícita; sin ella, el sistema registraría un rechazo que el cliente no expresó. **Casilla obligatoria:** "Acepto el tratamiento de mis datos personales (Ley 25.326) para gestionar mi cuenta y mis compras en la tienda web de SWAT Indumentarias." **Casilla opcional:** "Acepto recibir comunicaciones comerciales." Ninguna viene marcada por defecto.

**Comportamiento:**

1. El hash se deriva con `hashPassword()` de `lib/auth/password.ts` (Argon2id) **antes** de abrir la transacción.
2. También antes de la transacción se resuelve el usuario de sistema "Canal Web" activo con `obtenerUsuarioCanalWebId()` (`src/lib/services/ecommerce/usuario-canal-web.ts`, de HU-E2). Si no existe o está inactivo, error operativo (`CANAL_WEB_SIN_USUARIO_SISTEMA`; la ruta responde `500`), porque `crearClienteTx` no valida la actividad del actor.
3. Dentro de la transacción se lee el Cliente por DNI (`id`, `is_active`, `deleted_at`), porque `crearClienteTx` no devuelve el estado de un Cliente existente:
   - **Existe inactivo:** `409 REGISTRO_WEB_NO_DISPONIBLE`.
   - **No existe:** `crearClienteTx(tx, input, usuarioIdCanalWeb)` con nombre, DNI, teléfono, email y la decisión comercial (`ACEPTA` si `acepta_comunicaciones`, si no `RECHAZA`); el consentimiento de tratamiento queda registrado por C1 en la misma transacción. Cuenta con `vinculacion_pendiente = false`. **Módulo C no se modifica.**
   - **Existe y está activo, sin cuenta:** no se llama a `crearClienteTx`; cuenta con `vinculacion_pendiente = true`. Los datos y el consentimiento del Cliente **no se modifican**.
   - **Existe con cuenta:** `409 CUENTA_WEB_YA_EXISTE`.
4. Si `crearClienteTx` devuelve `esNuevo = false` (un alta concurrente del mismo DNI entre la lectura y la creación), la cuenta queda **pendiente**: `resolverClienteCreadoEnRegistro()` (`registro-cuenta-web.reglas.ts`) relee el Cliente y lo rechaza si quedó inactivo.
5. Email ya usado por otra cuenta (activa o no): `409 REGISTRO_WEB_NO_DISPONIBLE`.
6. Carrera entre dos registros del mismo DNI o email: el `P2002` se traduce al `409` correspondiente (`CUENTA_WEB_YA_EXISTE` si ya existe una cuenta para ese DNI, si no `REGISTRO_WEB_NO_DISPONIBLE`). Nunca se devuelve como éxito una cuenta creada por otro request.
7. Después del COMMIT se emite `ecommerce:cuenta_web_registrada` con actor `cuenta`, el flag de pendiente y la evidencia de aceptación del reclamante (`acepta_tratamiento`, `acepta_comunicaciones`, instante del servidor).

**Mensajes:** `CUENTA_WEB_YA_EXISTE`: "Ya existe una cuenta web para este DNI". `REGISTRO_WEB_NO_DISPONIBLE`: "No es posible completar el registro con los datos indicados." No se revela qué dato coincide ni se devuelven datos del Cliente.

*Nota de sincronización:* el orden de las verificaciones es el del código: un Cliente **inactivo** responde `REGISTRO_WEB_NO_DISPONIBLE` aunque tenga cuenta (el contrato original listaba "con cuenta, activa o no" antes).

**Limitación conocida (D6):** `cliente_id` y `email` son únicos incluyendo cuentas dadas de baja. Una cuenta dada de baja es definitiva en este sprint: ese DNI y ese email no pueden volver a registrarse. La reactivación o el re-registro quedan como deuda de backlog (sección 5).

### 2.8.c. Contraseña y sesión (Revisión 2 — HU-E8)

- Hash con `hashPassword` / `verifyPassword` de `lib/auth/password.ts` (Argon2id; el formato PHC incluye la sal). No se crea criptografía nueva.
- La sesión es la de HU-E1 sin cambios de contrato: cookie `swat_tienda_session`, secreto `JWT_SECRET_CLIENTE_WEB`, HS256, claims `sub` (id de cuenta) y `tv` (`token_version`), duración `DURACION_SESION_CLIENTE_WEB_HORAS` (168). En cada request la verificación exige firma válida con el secreto web, cuenta y Cliente activos y `tv` igual al `token_version` persistido. La sesión expone `vinculacionPendiente`.
- Nunca se registra la contraseña, el hash, el JWT ni el código de recuperación en eventos ni en logs.

### 2.8.d. Login y bloqueo (Revisión 2 — HU-E8)

1. Email normalizado (trim + minúsculas). Email inexistente, cuenta inactiva o contraseña incorrecta: `401 CREDENCIALES_INVALIDAS`, "Email o contraseña incorrectos". Solo una contraseña incorrecta sobre una cuenta activa incrementa el contador.
2. Si `bloqueada_hasta > now()`: `423 CUENTA_BLOQUEADA` con el envelope de la Rev.1 (mensaje exacto: "La cuenta está bloqueada temporalmente por intentos fallidos; la recuperación es presencial en sucursal"), **sin verificar la contraseña** y sin extender el bloqueo.
3. Si `bloqueada_hasta <= now()` (bloqueo vencido): se reinicia el contador antes de evaluar el intento.
4. Contraseña incorrecta: `intentos_fallidos + 1` bajo `SELECT … FOR UPDATE` de la fila de la cuenta (la verificación Argon2 se hace fuera de la transacción para no retener el lock; si `token_version` cambió entre la lectura y el lock, no se emite sesión). Al llegar a `ECOMMERCE_CUENTA_WEB_MAX_INTENTOS`: `bloqueada_hasta = now() + ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS` y evento `ecommerce:cuenta_web_bloqueada`, **una sola vez por transición** aunque lleguen requests concurrentes. Ese intento responde `423`.
5. Contraseña correcta: contador en 0, `bloqueada_hasta = null`, se emite la sesión. Si la cuenta está vinculada, se fusiona el carrito de visitante con el servicio de HU-E1 (comportamiento actual); si está pendiente, **no se fusiona** y la cookie de visitante se conserva.
6. El bloqueo no incrementa `token_version`: las sesiones ya emitidas siguen vigentes.
7. Si faltan las claves de configuración o no son enteros positivos: `500 INTERNAL_ERROR` con el mensaje genérico "Error interno. Intentá más tarde." (`ErrorConfiguracionCuentaWeb`, que no es un `ServiceError`), **sin el nombre de la clave en la respuesta** (queda solo en el log del servidor). Nunca se usa un valor por defecto silencioso. Aplica a login y redefinición, únicos lectores de las claves (`obtenerMaxIntentosCuentaWeb()`, `obtenerBloqueoMinutosCuentaWeb()` en `configuracion.service.ts`).

Valores sembrados (`ConfiguracionSistema`, módulo `E`): `ECOMMERCE_CUENTA_WEB_MAX_INTENTOS = 5`, `ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS = 15`.

### 2.8.e. Operaciones presenciales del Vendedor (Revisión 2 — HU-E8)

**Pantalla:** `/ecommerce/cuentas-web` (dashboard, entrada "Cuentas web" en el Sidebar), solo para usuarios con `ventas:validar_identidad_cliente_web` (la página lo verifica en el servidor). El Vendedor busca por DNI y ve nombre del Cliente, email de la cuenta y estado (Activa, Pendiente, Bloqueada, Dada de baja; "Bloqueada" solo si `bloqueada_hasta > now`). Una cuenta dada de baja se muestra con su fecha y **sin acciones**.

*Nota de sincronización:* `GET /api/ecommerce/cuentas-web?dni=` devuelve también cuentas dadas de baja (la pantalla las distingue por `is_active`/`deleted_at`). La pantalla no muestra la fecha de alta ni el vencimiento del código (la API devuelve `created_at` y `expira_en`).

**Modelo de datos (ampliación de `CuentaClienteWeb`, migración `20261002170000_hu_e8_cuenta_cliente_web_recuperacion`):**

```prisma
  recuperacion_codigo_digest   String?   @unique  // SHA-256 del código; nunca el código
  recuperacion_expira_en       DateTime?
  recuperacion_emitida_por_id  String?
  recuperacion_emitida_por     Usuario?  @relation("RecuperacionCuentaWebEmitidaPor", fields: [recuperacion_emitida_por_id], references: [id], onDelete: Restrict)
```

**Validar vinculación** (`POST …/[id]/validar-vinculacion`). El Vendedor verifica el DNI físico del titular y le muestra el email de la cuenta (la pantalla pregunta "¿El titular reconoce este email?").

- Body `{ email_reconocido: true }`: el titular reconoce el email. Se establece `vinculacion_pendiente = false`.
- Body `{ email_reconocido: false, email_titular: string }`: **el titular no reconoce el email (posible registro hecho por un tercero).** En la misma transacción se reemplaza el email por `email_titular` (normalizado y único; si está ocupado, `409 REGISTRO_WEB_NO_DISPONIBLE`), se reemplaza `password_hash` por el hash de un valor aleatorio descartado, se incrementa `token_version` (el tercero pierde toda sesión), se limpian contador y bloqueo, `vinculacion_pendiente = false` y se habilita la recuperación devolviendo el código en la misma respuesta. El titular define su contraseña en ese momento.
- La transición se serializa con `SELECT … FOR UPDATE` de la fila de la cuenta: un doble request (por ejemplo, doble clic del Vendedor) produce **una sola transición, un solo evento y un solo código**; la segunda respuesta es `200` sin código.
- Solo aplica a cuentas activas y pendientes. Sobre una cuenta ya vinculada responde `200` con su estado, sin cambios ni evento. Cuenta inactiva o inexistente: `404 CUENTA_WEB_NO_ENCONTRADA`.
- Respuesta `200 { cuenta_id, vinculacion_pendiente: false, acceso_reasignado: boolean, codigo?, expira_en? }`.
- Evento `ecommerce:cuenta_web_vinculada` con el Vendedor como actor y `acceso_reasignado`. Si hubo reasignación, también `ecommerce:cuenta_web_recuperacion_habilitada`.
- Los consentimientos del Cliente no se modifican.

**Habilitar recuperación** (`POST …/[id]/habilitar-recuperacion`). Solo cuentas activas **y vinculadas** (pendiente: `409 CUENTA_VINCULACION_PENDIENTE`, "La cuenta está pendiente de validación de identidad"; primero se valida la vinculación; inactiva o inexistente: `404`).

- Genera un código de 8 caracteres con `crypto.randomInt` sobre el alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sin `0 O 1 I L`).
- Persiste `recuperacion_codigo_digest` (SHA-256 del código en mayúsculas), `recuperacion_expira_en = now() + 15 min` y `recuperacion_emitida_por_id` (el Vendedor). Una nueva emisión **reemplaza** la anterior, que deja de servir.
- No cambia la contraseña ni el `token_version`.
- Respuesta `201 { codigo, expira_en }`. El código se muestra **una sola vez** en la pantalla del Vendedor, que se lo entrega al titular en persona (permanece visible hasta que el Vendedor hace otra búsqueda, edita el DNI o emite un código nuevo). Nunca se envía por email, SMS ni WhatsApp, ni va en la URL ni en los logs.
- Evento `ecommerce:cuenta_web_recuperacion_habilitada` (actor Vendedor, vencimiento; sin el código ni el digest).

### 2.8.f. Redefinición, baja y aislamiento de cuentas pendientes (Revisión 2 — HU-E8)

**Redefinir contraseña** (`POST /api/tienda/cuenta/redefinir-password`). Body `{ email, codigo, password, confirmacion }`, con `password === confirmacion`, `password` de mínimo 8 y `codigo` de exactamente 8 caracteres (se normaliza a mayúsculas).

- Un único `updateMany` condicional sobre la cuenta: email coincide, activa, vinculada, `recuperacion_codigo_digest = sha256(codigo)`, `recuperacion_expira_en > now()` **y bloqueo no vigente** (`bloqueada_hasta` nulo o `<= now()`). Si afecta una fila: nuevo `password_hash`, limpia los tres campos de recuperación, contador en 0, bloqueo en null y `token_version + 1`. Dos requests concurrentes con el mismo código producen un solo éxito, y una cuenta bloqueada no consume el código.
- Si no afecta ninguna fila, la lectura posterior solo decide la respuesta: bloqueo vigente → `423 CUENTA_BLOQUEADA` (no suma intento); en otro caso → `422 CODIGO_RECUPERACION_INVALIDO`, "El código no es válido o venció", sin distinguir la causa; si el email corresponde a una cuenta activa, cuenta como intento fallido (misma regla y mismo bloqueo que el login).
- No inicia sesión. La UI (`/tienda/recuperar`) redirige al login.
- Evento `ecommerce:cuenta_web_password_redefinida`.

**Baja propia** (`PATCH /api/tienda/cuenta/baja`). Sesión web vinculada; body `{ motivo: string (trim, no vacío), confirmar: true }`.

- La cuenta es la de la sesión; nunca un id del body.
- En una transacción: `is_active = false`, `deleted_at = now()`, `deleted_by = "cuenta_web:<cuenta_id>"`, `deletion_reason = motivo`, `token_version + 1` y limpia los campos de recuperación.
- Borra la cookie. El Cliente, sus consentimientos y sus pedidos no se tocan. Cuenta inexistente o ya dada de baja: `404`.
- Evento `ecommerce:cuenta_web_baja` con actor `cuenta` y el motivo.

**Aislamiento de cuentas pendientes.** Una cuenta pendiente puede iniciar sesión, ver el aviso de validación pendiente (`/tienda/cuenta`) y cerrar sesión. **No puede** usar el carrito persistente, fusionar, hacer checkout, consultar pedidos, comprobantes ni QR, ni darse de baja. Mientras tanto, navega catálogo y carrito como visitante.

- `withSesionClienteWeb()` **rechaza por defecto** las cuentas pendientes con `403 CUENTA_VINCULACION_PENDIENTE`, "Tu cuenta está pendiente de validación de identidad en sucursal". Acepta un segundo argumento de opciones: `permitirPendiente` (para endpoints que deban aceptar pendientes) y `mensajeSinSesion`.
- `SESION_CLIENTE_WEB_REQUERIDA` (`401`) dice "Debe iniciar sesión para continuar" por defecto y "Debe iniciar sesión para completar la compra" en `POST /api/tienda/checkout` (opción `mensajeSinSesion`).
- `contexto-tienda` (`resolverContextoTienda()`) trata a una cuenta pendiente como visitante: usa el carrito de la cookie de visitante y nunca el carrito de la cuenta. El carrito de una cuenta pendiente no ofrece compra: muestra el aviso con enlace a `/tienda/cuenta`.
- Las páginas que leen la sesión directamente, `/tienda/checkout/pendiente` y `/tienda/checkout/resultado` (esta última de HU-E2), nunca muestran datos de pedidos a una cuenta pendiente: la redirigen a `/tienda/cuenta`. Leen la sesión con `getSesionClienteWebVinculada()`; cualquier consumidor nuevo de la sesión web pasa por la misma guarda.
- `/tienda/cuenta` es la página de la cuenta: aviso de pendiente, cerrar sesión y baja propia (solo si está vinculada). Sin sesión redirige a `/tienda/ingresar`.

*Nota de sincronización:* la Rev.2 original citaba "sesión actual/aviso, logout" como endpoints que aceptan pendientes. En la implementación el aviso es una página (`/tienda/cuenta`, sobre `getSesionClienteWeb()`) y `logout` es público (solo borra la cookie): hoy ningún endpoint usa `permitirPendiente`.

### 2.8.g. Sincronización con la implementación — diferencias respecto del contrato original (Revisión 2 — HU-E8)

Cada diferencia entre el borrador de la Rev.2 y el código de `fix/HU-E8-deuda` quedó resuelta a favor del **código** y anotada en la subsección correspondiente. Resumen:

| Tema | Contrato original | Implementado (manda) | Subsección |
|---|---|---|---|
| Constante del permiso | Sin ubicación | `src/lib/auth/permisos-ecommerce.ts` | 2.8.a |
| Usuario "Canal Web" | "sin duplicar la consulta" | `obtenerUsuarioCanalWebId()` (`usuario-canal-web.ts`, HU-E2) | 2.8.b |
| Cliente creado con `esNuevo = false` | No contemplado | Cuenta pendiente (`resolverClienteCreadoEnRegistro`) | 2.8.b |
| Cliente inactivo con cuenta | `CUENTA_WEB_YA_EXISTE` | `REGISTRO_WEB_NO_DISPONIBLE` (se evalúa primero la actividad) | 2.8.b |
| Doble `validar-vinculacion` | Una transición | `SELECT … FOR UPDATE`: una transición, un evento, un código | 2.8.e |
| Configuración faltante o inválida | `500` operativo | `500 INTERNAL_ERROR` genérico, sin el nombre de la clave | 2.8.d |
| Bloqueo en la redefinición | Cuenta bloqueada: `423` | La condición de bloqueo va en el mismo `updateMany`; la lectura posterior solo decide 423 o 422 | 2.8.f |
| Textos de `CUENTA_BLOQUEADA` y `SESION_CLIENTE_WEB_REQUERIDA` | Los de la Rev.1 | Idénticos; el segundo, configurable por ruta | 2.8.d, 2.8.f |
| Páginas de la tienda | `/tienda/checkout/*` sin precisión | `/tienda/cuenta` y redirecciones de `pendiente` y `resultado`; carrito sin compra | 2.8.f |
| Endpoints que aceptan pendientes | "sesión actual/aviso, logout" | Ninguno usa `permitirPendiente`; el aviso es una página; `logout` es público | 2.8.f |
| Búsqueda por DNI | `200 { cuenta }` o `404` | También devuelve cuentas dadas de baja | 2.8.e |
| Pantalla del Vendedor | Fecha de alta y vencimiento del código | No se muestran (la API devuelve `created_at` y `expira_en`) | 2.8.e |
| Respuesta del login | `+ vinculacion_pendiente` | `{ cuenta_id, email, vinculacion_pendiente, carrito_fusionado }` | 2.8.a |
| Errores `404` | No especificados | `CUENTA_WEB_NO_ENCONTRADA` en rutas internas y baja | 2.8.e, 2.8.f |

### 2.9. Historial y estado de pedidos — "Mis pedidos" (HU-E9)

**Ruta (listado):** `GET /app/api/tienda/mis-pedidos/route.ts`
**Ruta (detalle, incluye QR):** `GET /app/api/tienda/mis-pedidos/[id]/route.ts`
**Permiso requerido:** sesión de Cliente Web (`withSesionClienteWeb()`).

**Comportamiento esperado:**
- **Alcance por sesión, nunca por parámetro (criterio de aceptación explícito, no negociable):** el listado y el detalle resuelven `cliente_id`/`cuenta_cliente_web_id` exclusivamente desde la sesión — un `id` de pedido ajeno responde `404` (no `403`, para no confirmar la existencia del recurso a un tercero), validado server-side sin excepción.
- **Estados visibles (criterio de aceptación explícito):** los nueve valores de `EstadoEcommerce` (2.2), mapeados a las etiquetas de negocio del Backlog (`PAGO_PENDIENTE` → "Pago Pendiente", etc.).
- **Detalle:** ítems (producto, talle, color, cantidad, precio congelado), comprobante fiscal descargable (`spec_modulo_B.md` sección 2.7, HU-B7), historial de cambios de estado con fecha/hora (derivado de los eventos de la sección 4 de este documento, filtrados por `pedido_venta_id` — consulta de solo lectura contra `AuditLog`, mismo patrón forense que 2.6 pero de alcance propio del cliente, no una consola de auditoría).
- **Código QR:** visible únicamente en `LISTO_PARA_RETIRO` (ver contrato completo en 2.3).
- **Notificación por cada cambio de estado (criterio de aceptación explícito):** cada transición de `estado_ecommerce` dispara una notificación interna en la bandeja del cliente vía HU-F3 (`spec_modulo_F.md` sección 2.3) — nunca un canal externo.
- Es de solo lectura: ninguna mutación de estado ocurre desde esta sección.

**Respuesta `200 OK` (detalle):**
```json
{
  "data": {
    "pedido_venta_id": "uuid",
    "numero_venta": "V-2026-004821",
    "estado_ecommerce": "LISTO_PARA_RETIRO",
    "codigo_qr_retiro": "data:image/png;base64,...",
    "items": [ { "variante_sku_id": "uuid", "producto": "Campera táctica", "talle": "L", "color": "Verde oliva", "cantidad": 1, "precio_unitario": 87000.00 } ],
    "comprobante_id": "uuid",
    "historial_estados": [ { "estado": "PAGO_CONFIRMADO", "timestamp": "2026-09-28T14:02:11.000Z" }, { "estado": "EN_PREPARACION", "timestamp": "2026-09-28T14:10:00.000Z" }, { "estado": "LISTO_PARA_RETIRO", "timestamp": "2026-09-28T16:45:00.000Z" } ]
  },
  "error": null
}
```

**Respuesta `404 Not Found` (pedido ajeno o inexistente):**
```json
{ "data": null, "error": { "code": "PEDIDO_NO_ENCONTRADO", "message": "El pedido solicitado no existe" } }
```

### 2.10. Roles Administrador E-commerce y Operador de Pick & Pack (HU-E10)

**Sin endpoint propio:** esta HU no expone rutas nuevas — define los roles y permisos que el resto de las secciones de este documento ya referencian, y confirma que se administran desde la pantalla de gestión de roles ya existente de Módulo D (`spec_modulo_D.md` sección 2, D.2 — sin frontend nuevo).

**Matriz de permisos (namespace `ecommerce:*`, conforme al Alcance Funcional § Módulo E):**

| Permiso | Administrador E-commerce | Operador de Pick & Pack |
|---|---|---|
| `ecommerce:gestionar_catalogo` | ✓ | — |
| `ecommerce:gestionar_cupones` | ✓ | — |
| `ecommerce:anular_orden_no_abonada` | ✓ | — |
| `ecommerce:cancelar_pedido_pagado` | ✓ | — |
| `ecommerce:leer_cola_preparacion` | ✓ (consulta) | ✓ (consulta + toma) |
| `ecommerce:priorizar_cola` | ✓ (prioridad manual de la cola, ver 2.12) | — |
| `ecommerce:preparar_pedido` | — | ✓ |
| `ecommerce:validar_retiro_qr` | — | ✓ |
| `ecommerce:leer_historial_ordenes` | ✓ (todos los clientes) | — |
| `ecommerce:exportar_metricas` | ✓ | — |
| `ecommerce:solicitar_acceso_log_pagos` | ✓ (con aprobación, ver 2.6) | — |

**`ecommerce:priorizar_cola` (Punto abierto 1 de HU-E10, resuelto por Cali + PO):** permiso propio, exclusivo del Administrador E-commerce. Antes "priorizar" se resolvía con `ecommerce:leer_cola_preparacion` + rol Administrador, pero ese permiso lo tienen los dos roles, así que solo se podía distinguirlos comparando el nombre del rol (contra el criterio de "autorización siempre por permiso" de abajo). Sembrado en `seed.ts` con UUID `6481fbee-c5d3-4c40-ad62-261588c1d0cf`.

**Comportamiento esperado:**
- **Segregación de funciones (criterio de aceptación explícito):** el Operador de Pick & Pack **no** tiene acceso a datos de facturación ni de pago bajo ninguna circunstancia — su superficie (2.12) expone únicamente ítems, SKU, cantidades, ubicación física y el nombre del destinatario para la validación del QR.
- **Autorización siempre por permiso, nunca por nombre de rol (criterio de aceptación explícito):** mismo principio que el resto del RBAC de Módulo D — ningún endpoint de este documento verifica `rol === "ADMINISTRADOR_ECOMMERCE"`, todos verifican el permiso granular correspondiente.
- **Seed idempotente (criterio de aceptación explícito):** ambos roles se siembran con un usuario de prueba cada uno, UUID generados aleatoriamente verificando ausencia de colisión con los ya existentes — mismo patrón que el resto de `seed.ts`.
- El Cliente Web **no** es un rol de este RBAC (ver ⚠️ Alcance del módulo).

### 2.11. Contenido comercial del catálogo online (HU-E11)

**Ruta:** `POST /app/api/ecommerce/catalogo/route.ts` (alta de contenido para un Producto Maestro), `PATCH /app/api/ecommerce/catalogo/[id]/route.ts`, `POST /app/api/ecommerce/catalogo/[id]/fotos/route.ts`, `PATCH /app/api/ecommerce/catalogo/[id]/fotos/[foto_id]/route.ts` (baja lógica de una foto / marcar como principal)
**Server Action equivalente:** `crearContenidoWeb()`, `editarContenidoWeb()`, `subirFotoProducto()` en `app/(dashboard)/ecommerce/catalogo/actions.ts`
**Permiso requerido:** `ecommerce:gestionar_catalogo` (Administrador E-commerce).

```typescript
export const CrearContenidoWebSchema = z.object({
  producto_maestro_id: z.string().uuid(),
  titulo_comercial: z.string().min(1),
  descripcion: z.string().min(1),
});
export type CrearContenidoWebInput = z.infer<typeof CrearContenidoWebSchema>;

export const SubirFotoProductoSchema = z.object({
  url: z.string().url(), // resuelta tras la subida a almacenamiento — este documento no define el mecanismo de storage, fuera de alcance (ver sección 5)
  es_principal: z.boolean().default(false),
});
```

**Modelo de datos:**
```prisma
model ProductoWebContenido {
  id                  String   @id @default(uuid())
  producto_maestro_id String   @unique
  producto_maestro    ProductoMaestro @relation(fields: [producto_maestro_id], references: [id], onDelete: Restrict)
  titulo_comercial    String
  descripcion         String
  visibilidad_web     Boolean  @default(false) // false hasta cumplir los requisitos de publicación (ver comportamiento)
  fotos               ProductoWebFoto[]
  is_active           Boolean  @default(true)
  deleted_at          DateTime?
  deleted_by          String?
  deletion_reason     String?
  updated_at          DateTime @updatedAt
  created_at          DateTime @default(now())
  @@map("contenidos_producto_web")
}

model ProductoWebFoto {
  id                       String   @id @default(uuid())
  producto_web_contenido_id String
  producto_web_contenido   ProductoWebContenido @relation(fields: [producto_web_contenido_id], references: [id], onDelete: Restrict)
  url                      String
  es_principal             Boolean  @default(false)
  orden                    Int      @default(0)
  is_active                Boolean  @default(true)
  deleted_at               DateTime?
  deleted_by               String?
  deletion_reason          String?
  created_at               DateTime @default(now()) // Sprint 4, cierre: faltaba — ningún motivo documentado para omitirlo
  @@map("fotos_producto_web")
}
```

**Comportamiento esperado:**
- **Sin duplicar el catálogo del Módulo A (criterio de aceptación explícito, no negociable):** `ProductoWebContenido` se asocia 1:1 al `ProductoMaestro` de Módulo A — talles, colores y géneros **siempre** se leen desde las `VarianteSku` reales, nunca desde una copia en Módulo E.
- **Hasta N fotos, formato y tamaño configurables (criterio de aceptación explícito):** `N`, los formatos admitidos (JPG/PNG/WebP) y el tamaño máximo se validan en el servicio contra `ConfiguracionSistema` (claves a agregar — ver sección 5), no hardcodeados.
- **Listado con filtros (criterio de aceptación explícito):** el storefront (2.1) filtra por categoría, talle, color, género y modelo, con búsqueda por texto y orden por precio/novedad, con paginación — filtros resueltos contra los atributos reales de `ProductoMaestro`/`VarianteSku` de Módulo A, join con `ProductoWebContenido` solo para título/descripción/fotos/visibilidad.
- **Requisitos de publicación (criterio de aceptación explícito, no negociable):** un producto solo se publica (aparece como comprable en el storefront) si tiene al menos una foto, una descripción, y al menos un SKU con precio de venta vigente (HU-B9) y `visibilidad_web = true` — la validación de "publicable" se resuelve en el momento de la consulta del catálogo (2.1), no como un estado persistido adicional en `ProductoWebContenido` (que solo persiste su propia bandera `visibilidad_web`; los otros dos requisitos —foto y precio— se validan dinámicamente contra sus propias fuentes de verdad).
- **Los cambios de contenido no afectan inventario ni POS (criterio de aceptación explícito):** `ProductoWebContenido` no tiene ninguna relación que module el comportamiento de Módulo A o Módulo B — es contenido de presentación exclusivamente.
- Baja lógica estándar de fotos y contenido.

**Respuesta `201 Created` (alta de contenido):**
```json
{ "data": { "producto_web_id": "uuid", "producto_maestro_id": "uuid", "visibilidad_web": false }, "error": null }
```

### 2.12. Cola de preparación y entrega Click & Collect (HU-E12)

**Ruta (consulta de cola):** `GET /app/api/ecommerce/pick-pack/cola/route.ts`
**Ruta (tomar pedido):** `PATCH /app/api/ecommerce/pick-pack/[id]/tomar/route.ts`
**Ruta (confirmar preparación, escaneo de código de barras por ítem):** `POST /app/api/ecommerce/pick-pack/[id]/confirmar-item/route.ts`
**Ruta (completar preparación → genera QR):** `PATCH /app/api/ecommerce/pick-pack/[id]/completar/route.ts`
**Ruta (validar retiro, escaneo de QR + DNI):** `POST /app/api/ecommerce/pick-pack/[id]/validar-retiro/route.ts`
**Ruta (priorizar manualmente, Administrador E-commerce):** `PATCH /app/api/ecommerce/pick-pack/[id]/prioridad/route.ts`
**Server Action equivalente:** las de escritorio del Operador viven en `app/(dashboard)/ecommerce/pick-pack/actions.ts`; el escaneo (confirmar ítem, validar retiro) se expone como Route Handler porque la PWA del Operador lo invoca directamente, no vía formulario de servidor.
**Permiso requerido:** `ecommerce:leer_cola_preparacion` (consulta, ambos roles); `ecommerce:preparar_pedido` (tomar/confirmar ítem/completar, exclusivo Operador); `ecommerce:validar_retiro_qr` (exclusivo Operador); `ecommerce:priorizar_cola` para priorizar (`PATCH .../prioridad`, exclusivo Administrador E-commerce — permiso propio de la matriz de 2.10, sin comparar el nombre del rol).

```typescript
export const ConfirmarItemPreparacionSchema = z.object({
  codigo_barras_escaneado: z.string().min(1),
});

export const ValidarRetiroSchema = z.object({
  codigo_qr: z.string().min(1),
  dni_receptor: z.string().regex(/^\d{7,8}$/),
});

export const PriorizarPedidoSchema = z.object({
  prioridad_manual: z.number().int(),
});
```

**Comportamiento esperado:**
- **Ingreso automático a la cola (criterio de aceptación explícito):** todo pedido con `estado_ecommerce = PAGO_CONFIRMADO` ingresa automáticamente a la cola (transición a `EN_PREPARACION` disparada por el mismo listener que procesa la confirmación de pago de 2.2, o por un `PATCH` explícito de "tomar" — el criterio de aceptación distingue "ingresa a la cola" de "el Operador lo toma": ingreso automático = aparece listado y ordenado por fecha de pago; "tomar" (`estado_ecommerce` permanece `EN_PREPARACION` pero con `operador_asignado_id` seteado) es la acción explícita del Operador).
- **Notificación al ingresar un pedido nuevo (criterio de aceptación explícito):** el rol Operador recibe notificación interna vía HU-F3 (dirigida por `rol_id`, expandida a cada usuario con ese rol activo — mismo mecanismo de expansión de destinatario de `spec_modulo_F.md` sección 2.3).
- **Confirmación por escaneo, ítem por ítem (criterio de aceptación explícito, no negociable):** cada `PATCH /confirmar-item` valida el código de barras escaneado contra los ítems del pedido — un SKU que no corresponde bloquea la confirmación con `409 ITEM_NO_CORRESPONDE_AL_PEDIDO`, sin afectar los ítems ya confirmados.
- **Completar preparación → QR (criterio de aceptación explícito):** al confirmar todos los ítems, `PATCH /completar` transiciona `estado_ecommerce → LISTO_PARA_RETIRO`, genera `codigo_qr_retiro` (token único, no reutilizable entre pedidos) y dispara la notificación de HU-E9/HU-F3 al cliente.
- **Validación de retiro — QR + DNI (criterio de aceptación explícito, no negociable):** `POST /validar-retiro` exige `codigo_qr` **y** `dni_receptor`; ambos deben corresponder al mismo pedido y al titular real — un tercero no autorizado no puede retirar (el DNI del receptor se valida contra el `Cliente` propietario del pedido, resuelto vía `PedidoVenta` → `cliente_id` → Módulo C). Solo entonces `estado_ecommerce → ENTREGADO` y se emite el remito (`spec_modulo_B.md` sección 2.3, `PedidoVenta.estado → REMITO_EMITIDO` y, al ser Click & Collect de entrega única sin saldo parcial pendiente, `→ CERRADO` en el mismo commit).
- **QR inválido, vencido o de otro pedido (criterio de aceptación explícito):** se rechaza con `422 QR_INVALIDO` y genera un evento auditado — sin excepción, incluso si el DNI es correcto pero el QR no corresponde.
- **Segregación de datos (criterio de aceptación explícito, ver 2.10):** el Operador solo ve nombre del destinatario y contenido del pedido — ningún endpoint de esta sección expone `TransaccionPagoLog` ni el total facturado al rol Operador (el `select`/`include` de Prisma en la capa de servicios omite esos campos por completo para este rol, no se filtran del lado del cliente).
- **Cada transición registra usuario y timestamp, evento auditado (criterio de aceptación explícito):** `ecommerce:pedido_tomado`, `ecommerce:item_confirmado` (opcional, ver sección 4), `ecommerce:pedido_listo_para_retiro`, `ecommerce:pedido_entregado`, `ecommerce:qr_invalido_rechazado` (sección 4).

**Respuesta `200 OK` (cola):**
```json
{ "data": { "items": [ { "pedido_venta_id": "uuid", "numero_venta": "V-2026-004821", "estado_ecommerce": "EN_PREPARACION", "operador_asignado": "uuid", "prioridad_manual": null, "fecha_pago": "2026-09-28T14:02:11.000Z" } ] }, "error": null }
```

**Respuesta `409 Conflict` (ítem no corresponde):**
```json
{ "data": null, "error": { "code": "ITEM_NO_CORRESPONDE_AL_PEDIDO", "message": "El artículo escaneado no pertenece a este pedido" } }
```

**Respuesta `422 Unprocessable Entity` (QR inválido):**
```json
{ "data": null, "error": { "code": "QR_INVALIDO", "message": "El código QR no es válido, está vencido o pertenece a otro pedido" } }
```

### 2.13. Cancelación de pedidos web pagados (HU-E13)

**Ruta (cancelación por el cliente, antes de preparación):** `PATCH /app/api/tienda/mis-pedidos/[id]/cancelar/route.ts`
**Ruta (cancelación por el Administrador, en cualquier estado previo a `ENTREGADO`):** `PATCH /app/api/ecommerce/pedidos/[id]/cancelar/route.ts`
**Server Action equivalente:** `cancelarPedidoPropio()` en `app/(tienda)/mis-pedidos/actions.ts`; `cancelarPedidoWeb()` en `app/(dashboard)/ecommerce/pedidos/actions.ts`
**Permiso requerido:** sesión de Cliente Web (ruta propia, exclusiva de su propio pedido — mismo criterio de alcance por sesión que 2.9); `ecommerce:cancelar_pedido_pagado` (ruta de Administrador).

```typescript
export const CancelarPedidoWebSchema = z.object({
  motivo: z.string().min(1, "El motivo es obligatorio"),
});
export type CancelarPedidoWebInput = z.infer<typeof CancelarPedidoWebSchema>;
```

**Comportamiento esperado:**
- **Ventana de autoservicio del cliente (criterio de aceptación explícito, no negociable):** el cliente cancela desde "Mis pedidos" únicamente en `estado_ecommerce = PAGO_CONFIRMADO`, antes de `EN_PREPARACION`. Una vez tomado por el Operador, la cancelación es exclusiva del Administrador E-commerce — la ruta de cliente responde `409 TRANSICION_INVALIDA` fuera de esa ventana.
- **Motivo obligatorio, baja lógica (criterio de aceptación explícito):** ambas rutas exigen `motivo`; el `PedidoVentaEcommerce.estado_ecommerce → CANCELADO` es baja lógica (`is_active = false`, `deleted_at/by/reason`) — el `PedidoVenta` de Módulo B **no** se anula (su `estado` permanece `FACTURADO`/`REMITO_EMITIDO`, según en qué punto se canceló): la reversión fiscal es exclusivamente vía Nota de Crédito (ver abajo), nunca una baja lógica del comprobante ya emitido (`spec_modulo_B.md` sección 3.4).
- **Reintegro, en un único flujo (criterio de aceptación explícito, no negociable):** (1) Nota de Crédito sobre el comprobante original (`spec_modulo_B.md` sección 2.7 patrón de reversión, nunca anulación de la factura); (2) contra-asiento en Tesorería (`spec_modulo_G.md`, HU-G11); (3) solicitud de reembolso a Mercado Pago a través del Conector (`spec_modulo_F.md` sección 2.1, endpoint de reembolso **a confirmar contra el contrato real del Conector** — HU-F1 tal como quedó especificado en `spec_modulo_F.md` no define explícitamente una ruta de reembolso saliente, solo alta/health-check/webhook/bitácora/baja — ver Nota de relevamiento abajo).
- **Idempotencia (criterio de aceptación explícito, no negociable):** un mismo pedido nunca genera dos reintegros — mismo patrón de clave de idempotencia que el resto del sistema (constraint único sobre `pedido_venta_id` en la entidad de reintegro, **a modelar** — este documento no define una entidad `ReintegroPedidoWeb` explícita porque el Backlog no detalla su forma; se dejan sus datos como parte del payload del evento de la sección 4 hasta que se confirme si necesita persistencia propia).
- **Vencimiento del plazo de retiro (criterio de aceptación explícito, comparte esta sección con la cancelación):** el plazo máximo (`ConfiguracionSistema.ECOMMERCE_PLAZO_RETIRO_DIAS`, `spec_modulo_D.md` sección 6, ya reservada) se cuenta desde `LISTO_PARA_RETIRO`. El cliente recibe un recordatorio (HU-F3) antes del vencimiento (momento exacto del recordatorio no especificado por el Backlog — **a definir**, no bloqueante). Vencido, `estado_ecommerce → VENCIDO_SIN_RETIRO` (job programado, mismo patrón de cron que la liberación de reservas de Módulo A) y las unidades vuelven a `Disponible` **a través del servicio de Módulo A** — ver Nota de relevamiento crítica abajo, esta operación no existe todavía en `spec_modulo_A.md`.
- **Notificación y evento sensible (criterio de aceptación explícito):** cancelación y vencimiento notifican internamente al cliente (HU-F3) y se registran como evento sensible con SHA-256 hacia Módulo D (sección 4).

**Respuesta `200 OK`:**
```json
{ "data": { "pedido_venta_id": "uuid", "estado_ecommerce": "CANCELADO", "nota_credito_id": "uuid" }, "error": null }
```

**Respuesta `409 Conflict` (fuera de ventana de autoservicio):**
```json
{ "data": null, "error": { "code": "TRANSICION_INVALIDA", "message": "El pedido ya está en preparación; la cancelación debe solicitarse al Administrador E-commerce" } }
```

**Nota de relevamiento crítica — reversión de stock `Vendido → Disponible`, sin endpoint en Módulo A:** `spec_modulo_A.md` sección 2.9 (HU-A10) expone únicamente: congelamiento (`Disponible → Reservado`), confirmación por venta (`Reservado → Vendido`, sin reversión) y liberación por TTL (`Reservado → Disponible`, solo aplica a reservas **no confirmadas**). Ninguna de las tres cubre el caso de HU-E13/HU-E7-vencimiento: una unidad ya `Vendido` (pago confirmado, comprobante ya emitido) que debe volver a `Disponible` por cancelación post-venta o por vencimiento del plazo de retiro. Esto **no** es una variación del TTL de reserva — es una reversión de venta ya cerrada, conceptualmente más cercana a la devolución de HU-A9 (`spec_modulo_A.md` sección 2.8, reclasificación de unidad en estado "Devuelto") que a una liberación de reserva. Este documento **no define unilateralmente** el endpoint necesario en Módulo A (violaría la exclusividad de Módulo A sobre la máquina de estados de stock, `spec_modulo_B.md` sección 3.2, aplicable también a Módulo E) — queda como bloqueante a resolver con el owner de Módulo A antes de implementar HU-E13: o se extiende HU-A9 para cubrir este caso, o se define una cuarta transición nueva en HU-A10. Reportado, no asumido.

**Nota de relevamiento — endpoint de reembolso saliente, ausente del contrato de HU-F1:** ver arriba, en "Reintegro, en un único flujo".

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. Correspondencia entre `PedidoVenta.estado` (Módulo B) y `PedidoVentaEcommerce.estado_ecommerce` (Módulo E)

| `estado_ecommerce` | `PedidoVenta.estado` correspondiente | Disparador |
|---|---|---|
| `PAGO_PENDIENTE` | `RESERVADO` | Inicio de checkout (2.2) |
| `PAGO_RECHAZADO` | `RESERVADO` (sin cambio — el pedido no avanza) | Webhook, pago rechazado (2.2) |
| `PAGO_CONFIRMADO` | `FACTURADO` | Webhook, pago aprobado (2.2) |
| `EN_PREPARACION` | `FACTURADO` (sin cambio) | Ingreso a cola / "tomar" (2.12) |
| `LISTO_PARA_RETIRO` | `FACTURADO` (sin cambio) | Completar preparación (2.12) |
| `ENTREGADO` | `REMITO_EMITIDO` → `CERRADO` (mismo commit, entrega única sin saldo parcial) | Validación de retiro (2.12) |
| `ANULADO` | `ANULADO` | Anulación manual o por TTL de reserva (2.7) |
| `CANCELADO` | Sin cambio respecto del estado al momento de cancelar (`FACTURADO` o `REMITO_EMITIDO`) — reversión es por Nota de Crédito, nunca por transición de `PedidoVenta.estado` | Cancelación (2.13) |
| `VENCIDO_SIN_RETIRO` | Sin cambio respecto de `REMITO_EMITIDO`/`FACTURADO` al momento del vencimiento — ver Nota de relevamiento crítica en 2.13 sobre la reversión de stock pendiente | Job de vencimiento de plazo de retiro (2.13) |

Toda transición de `estado_ecommerce` se valida contra esta tabla dentro de la misma transacción que la ejecuta — cualquier transición no listada responde `409 TRANSICION_INVALIDA`, mismo principio que `spec_modulo_B.md` sección 3.1.

### 3.2. Exclusividad del Módulo A sobre stock y del Módulo B sobre la venta

Módulo E **no implementa** lógica de congelamiento, liberación, descuento ni reversión de stock propia, ni lógica de máquina de estados de venta propia — toda operación de stock se resuelve invocando `spec_modulo_A.md` sección 2.9 (y su extensión pendiente para HU-E13, ver Nota de relevamiento crítica en 2.13); toda operación de venta (creación de `PedidoVenta`, emisión de comprobante, Nota de Crédito) se resuelve invocando `spec_modulo_B.md`. Mismo principio arquitectónico no negociable ya establecido por `spec_modulo_B.md` sección 3.2 para Módulo B respecto de Módulo A — Módulo E hereda la misma restricción respecto de ambos.

### 3.3. Patrón Adapter para Mercado Pago — sin acceso directo al SDK

Módulo E **nunca** invoca el SDK de Mercado Pago directamente — toda interacción de pago pasa por el Conector de Módulo F (`spec_modulo_F.md` sección 3.1, patrón Adapter obligatorio, Regla N.° 3 de `RULES.md`).

### 3.4. Restricción de borrado físico y patrón de baja lógica

Ninguna entidad de Módulo E expone o invoca `prisma.<modelo>.delete()` ni `deleteMany()`. Toda relación de Prisma saliente usa `onDelete: Restrict`.

### 3.5. Cifrado y trazabilidad

`datos_facturacion_cifrados` (2.6) es el único campo cifrado de Módulo E, con el módulo centralizado `lib/crypto/aes.ts` (mismo que Módulo H y Módulo F). Transacción de pago, anulación de orden, cancelación de pedido pagado y acceso a dato cifrado son eventos **sensibles** con encadenamiento SHA-256 reforzado hacia Módulo D — el resto de los eventos de este módulo (sección 4) son auditoría estándar.

### 3.6. Idempotencia transversal

Webhook de pago (2.2, heredado del contrato de HU-F1), consumo de cupón (2.4), y el reintegro de HU-E13 (pendiente de modelado explícito, ver Nota de relevamiento crítica en 2.13) siguen el mismo patrón de idempotencia por clave única ya establecido en `spec_modulo_A.md`/`spec_modulo_H.md`/`spec_modulo_F.md`: una operación repetida con la misma clave es un no-op, nunca un error ni una duplicación.

### 3.7. Reglas de negocio agregadas por la cuenta web (Revisión 2 — HU-E8)

- Toda escritura de `CuentaClienteWeb` respeta la Regla N.° 1: sin `DELETE`; la baja es lógica (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`).
- Las seis transiciones auditables de la cuenta (registro, bloqueo, vinculación, recuperación habilitada, contraseña redefinida y baja) se emiten con `domainEventBus.emit()` **después del COMMIT**, con el patrón vigente del proyecto; `audit-log.listener.ts` (un handler explícito por evento) es la única vía de escritura al `AuditLog`.
- El usuario "Canal Web" solo figura como autor técnico del alta en Módulo C. El actor real de la operación (la cuenta) queda en el payload del evento.
- Módulo E consume `crearClienteTx` de Módulo C sin modificarlo (Regla N.° 3) y no modifica el algoritmo de fusión de carritos de HU-E1.
- El código de recuperación solo se persiste como digest, se entrega una vez y en persona, y nunca aparece en eventos, logs ni URLs.

---

## 4. Eventos de Dominio (EDA)

**Archivo:** `src/lib/events/event-types.ts` (extiende la tabla de `spec_modulo_D.md` §5, namespace `ecommerce:*` — con la excepción de los eventos ya definidos por otros módulos que Módulo E consume sin redefinir: `pago:webhook_confirmado` de Módulo F, `stock:reserva_congelada`/`stock:reserva_liberada` de Módulo A, `venta:comprobante_emitido` de Módulo B).

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `ecommerce:carrito_articulo_no_disponible` | 2.1/2.5, al desactivarse un artículo con ítems en carritos activos | Módulo F (HU-F3, notificación al cliente) | `{ carrito_id, variante_sku_id, cliente_web_cuenta_id? }` |
| `ecommerce:pedido_pago_confirmado` | 2.2, tras `COMMIT` del procesamiento del webhook con pago aprobado (`estado_ecommerce → PAGO_CONFIRMADO`) | Módulo F (HU-F3, notificación al Cliente Web dueño del pedido y al Rol Operador de Pick & Pack — ingreso a la cola de 2.12) | `{ pedido_venta_id, numero_venta, cliente_web_cuenta_id }` |
| `ecommerce:transaccion_pago_registrada` | 2.2/2.6, tras `COMMIT` del webhook procesado — **evento sensible** | Módulo D (SHA-256 reforzado) | `{ transaccion_id, pedido_venta_id, monto, estado_pago, mercadopago_payment_id }` |
| `ecommerce:acceso_dato_cifrado_auditado` | 2.6, en cada lectura de `datos_facturacion_cifrados` por un Auditor — **evento sensible** | Módulo D (SHA-256 reforzado) | `{ transaccion_id, usuario_auditor_id, timestamp }` |
| `ecommerce:orden_anulada` | 2.7, manual o automática por TTL — **evento sensible** | Módulo D (SHA-256 reforzado) | `{ pedido_venta_id, usuario_id?, deletion_reason, automatico: boolean }` |
| `ecommerce:cuenta_web_registrada` / `ecommerce:cuenta_web_bloqueada` / `ecommerce:cuenta_web_vinculada` / `ecommerce:cuenta_web_baja` | 2.8, tras `COMMIT` de cada transición | Módulo D (auditoría estándar) | `{ cuenta_id, cliente_id, evento_especifico }` |
| `ecommerce:pedido_tomado` / `ecommerce:pedido_listo_para_retiro` / `ecommerce:pedido_entregado` / `ecommerce:qr_invalido_rechazado` | 2.12, cada transición de la cola de preparación | Módulo D (auditoría estándar; `qr_invalido_rechazado` es evento sensible); Módulo F (HU-F3, notificación al cliente) — solo `pedido_listo_para_retiro` | `{ pedido_venta_id, operador_id, timestamp, estado_ecommerce }` |
| `ecommerce:plazo_retiro_por_vencer` | 2.13, job programado, como recordatorio previo al vencimiento del plazo de retiro — momento exacto **a definir** (ver 2.13) | Módulo F (HU-F3, notificación al cliente) | `{ pedido_venta_id, numero_venta, cliente_web_cuenta_id, plazo_retiro_vencimiento }` |
| `ecommerce:pedido_cancelado` / `ecommerce:pedido_vencido_sin_retiro` | 2.13, cancelación o vencimiento de plazo — **evento sensible** | Módulo D (SHA-256 reforzado), Módulo F (HU-F3, notificación) | `{ pedido_venta_id, motivo?, nota_credito_id?, automatico: boolean }` |

**Regla de exclusión de datos sensibles en el payload (misma convención que el resto del ERP):** ningún evento de este módulo incluye datos de facturación cifrados, contraseñas ni el contenido completo del webhook de Mercado Pago en su payload — se referencia por `transaccion_id`/`pedido_venta_id`, dejando que la consulta de detalle se resuelva contra la entidad correspondiente si se necesita.

### Extensión de la Revisión 2 — HU-E8: eventos de la cuenta de Cliente Web

Reemplaza el contrato genérico `{ cuenta_id, cliente_id, evento_especifico }` de la fila de la Revisión 1 para `ecommerce:cuenta_web_*`. Payload base de todos: `{ cuenta_id, cliente_id, actor_tipo: "cuenta" | "usuario", actor_id, ocurrido_en }` (`CuentaWebEventoBase`, `src/lib/events/event-types.ts`). Consumidor: Módulo D (auditoría estándar, `tabla_afectada: cuentas_cliente_web`).

| Evento | Actor | Payload adicional |
|---|---|---|
| `ecommerce:cuenta_web_registrada` | `cuenta` | `vinculacion_pendiente`, `acepta_tratamiento`, `acepta_comunicaciones` |
| `ecommerce:cuenta_web_bloqueada` | `cuenta` | `intentos`, `bloqueada_hasta` |
| `ecommerce:cuenta_web_vinculada` | `usuario` (Vendedor) | `acceso_reasignado` |
| `ecommerce:cuenta_web_recuperacion_habilitada` (nuevo) | `usuario` (Vendedor) | `expira_en` |
| `ecommerce:cuenta_web_password_redefinida` (nuevo) | `cuenta` | — |
| `ecommerce:cuenta_web_baja` | `cuenta` | `motivo` |

Nunca se incluyen contraseña, hash, JWT, código ni digest.

---

## 5. Fuera de Alcance (diferido / bloqueado)

**Revisión 2 — HU-E8:**

- **Baja definitiva de la cuenta web (D6):** una cuenta dada de baja no admite re-registro ni reactivación (`cliente_id` y `email` únicos incluyendo cuentas inactivas). Deuda de backlog; no hay operación presencial que lo resuelva.
- **Cambios fuera de alcance de HU-E8:** HU-E4 y HU-E9 (más allá de la guarda de pendientes), HU-F3, pagos, perfil y edición de datos del Cliente desde la web, cambio de email por el titular, baja administrativa, mensajería externa, OAuth, cambios a Módulo C y al algoritmo de fusión de HU-E1.
- **Resuelto en Rev.2:** el contrato del endpoint de vinculación de la cuenta web a un Cliente de mostrador preexistente (2.8.e) y la clave de configuración del umbral de intentos fallidos de login (`ECOMMERCE_CUENTA_WEB_MAX_INTENTOS`, junto con `ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS`, sembradas en `prisma/seed.ts`).
- **Rate limiting de `redefinir-password`:** el hash Argon2id se calcula en cada request, también con la cuenta bloqueada o inexistente; el rate limiting queda fuera de alcance.

- **Envío a domicilio:** ninguna de las 13 HU de este documento lo modela — ver ⚠️ Alcance del módulo, al inicio. `DireccionCliente` (HU-C3, Módulo C) no es consumida por este módulo.
- **Reversión de stock `Vendido → Disponible` en Módulo A para HU-E13 (bloqueante):** ver Nota de relevamiento crítica en 2.13 — sin resolver, HU-E13 no puede implementarse en su totalidad (la cancelación fiscal/de tesorería sí puede avanzar; la reversión física de stock, no).
- **Endpoint de reembolso saliente del Conector de Mercado Pago (HU-F1):** `spec_modulo_F.md` no lo define — a confirmar y, de ser necesario, agregar a `spec_modulo_F.md` sección 2.1 antes de implementar HU-E13.
- **Mecanismo de "solicitud de acceso aprobada" al log de pagos (HU-E6):** sin precedente en el resto del ERP y sin contrato definido por el Backlog — ver Nota de relevamiento en 2.6.
- **Endpoint de vinculación de cuenta web a Cliente de mostrador preexistente (HU-E8):** el Backlog confirma que "un Vendedor valida la identidad del titular" pero no especifica el contrato del endpoint — a definir junto con el owner de Módulo C/RBAC.
  - *Revisión 2:* resuelto. Contrato en 2.8.e (validación de vinculación con reasignación de acceso, permiso `ventas:validar_identidad_cliente_web`, solo rol `VENDEDOR`).
- **Claves de `ConfiguracionSistema` adicionales, no incluidas en `spec_modulo_D.md` sección 6.2 (Sprint 4, Revisión 1):** este documento asume, sin haberlas agregado al catálogo sembrado de Módulo D, las siguientes claves nuevas: umbral de intentos fallidos de login de Cliente Web (2.8), plazo de carrito abandonado (2.1), cantidad máxima de fotos y tamaño máximo por foto (2.11). Deben agregarse a `spec_modulo_D.md` sección 6.2 antes de implementar — no se edita ese documento desde aquí para no invalidar su propia Revisión 1 sin coordinación explícita del owner de Módulo D.
  - *Revisión 2:* la clave de 2.8 quedó resuelta como `ECOMMERCE_CUENTA_WEB_MAX_INTENTOS` (más `ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS`), sembradas en `prisma/seed.ts` con módulo `E` (2.8.d). El catálogo de `spec_modulo_D.md` sección 6.2 **no** se actualizó desde aquí: sigue pendiente de coordinación con el owner de Módulo D. Las claves de 2.1 y 2.11 siguen pendientes.
- **Storage de imágenes (HU-E11):** este documento no define el mecanismo de almacenamiento de fotos de producto (S3, Vercel Blob u otro) — `ProductoWebFoto.url` asume una URL ya resuelta por un mecanismo externo a definir.
- **Mecanismo de push en tiempo real para notificaciones (heredado de `spec_modulo_F.md` sección 2.3):** el contador de "Mis pedidos"/bandeja se refresca por polling, no WebSocket/SSE — documentado como extensión futura no bloqueante, mismo criterio que Módulo F.
- **`origen_reserva` para checkout web, sin valor confirmado en el enum `OrigenReserva` de Módulo A:** ver Nota de relevamiento en 2.2 — bloqueante menor (tiene una salida de contingencia razonable, reutilizar `SENIA`, pero no confirmada).
- **Exportación de métricas (HU-E10, permiso `ecommerce:exportar_metricas`):** el permiso está definido en la matriz de 2.10 pero este documento no especifica ningún endpoint ni contrato de exportación — mismo patrón de diferimiento ya usado por `spec_modulo_B.md` sección 5 para su propia exportación de reportes (se asume resuelto por el futuro Tablero de Comando de Módulo D).