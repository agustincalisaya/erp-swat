# Especificación Técnica — Módulo E (E-commerce / Tienda Online)
## ERP SWAT Indumentarias — Sprint 4
## Cierre HU-E13, 08/10/2026 — registro NO normativo: HU-E13 COMPLETADA / VERIFY PASS (T00–T20). Agrega §2.13.17 como registro de cierre; no modifica ningún contrato de Rev.3 ni de sus addenda. Evidencia en `docs/modulos/modulo E/HU13_MODULO_E.md` §10.
## Addendum HU-E13 post-T17 — Reconciliación contractual aprobada: agrega §2.13.16. Sustituye, solo para HU-E13, los destinatarios F3 de cancelación/vencimiento (únicamente Cliente Web; vencimiento con prioridad `CRITICA`), amplía el DTO E9 con motivo, fecha de terminación, estado agregado del reintegro y Nota de Crédito separada del comprobante original, y formaliza la respuesta pública de cancelación Cliente Web. No modifica estados, saga, permisos, schema ni migrations.
## Addendum HU-E13 posterior a Rev.3 — Lectura administrativa mínima para T15: agrega §2.13.15 sin reescribir contratos anteriores. Mantiene `/ecommerce/pedidos` bajo HU-E7 y congela `/ecommerce/pedidos/pagados`, su permiso, alcance, DTO seguro, elegibilidad de acciones y paginación para la UI administrativa HU-E13.
## Revisión 9 — HU-E3 — Ajuste final de payload de retiro rechazado, 06/10/2026: modifica únicamente el contrato de `ecommerce:retiro_rechazado` en §2.3.d para incluir el ID opcional de la extensión y fijar su correspondencia con AuditLog. Todo el resto de las Revisiones 7 y 8 permanece vigente; Revisiones 1–8 conservan su numeración.
## Revisión 8 — HU-E3 — Corrección de consistencia contractual previa a TASKS, 06/10/2026: modifica únicamente la firma contractual del helper transaccional de Módulo B (§2.3.c) y la clave de idempotencia F3 de `ecommerce:pedido_listo_para_retiro` (§2.3.d). Todo el resto de la Revisión 7 continúa vigente; Revisiones 1–7 conservan su numeración.
## Revisión 7 — HU-E3 (retiro validado), 06/10/2026: contrato de `LISTO_PARA_RETIRO → ENTREGADO`, consumo de QR y aviso interno «listo». Revisión aditiva de §2.3 con sustituciones explícitas en §2.12 y §4; Revisiones 1–6 y las demás HU conservan prioridad y numeración.
## Revisión 6 — HU-E11 (Contenido comercial y búsqueda del catálogo online), 04/10/2026: contrato sincronizado con la implementación. Revisión aditiva: se agregan §2.11.a–§2.11.g, la extensión de eventos de la sección 4 y las notas Rev.6 de la sección 5. El contenido de §2.11 Rev.1 y de las Revisiones 1–5 se conserva íntegro; ninguna sección se renumera.
## Revisión 5 — HU-E7 (Anulación manual de orden web no abonada), 04/10/2026: contrato sincronizado con la implementación. Revisión aditiva: se agregan §2.7.a–§2.7.d, la extensión de eventos de la sección 4 y la nota Rev.5 de la sección 5. El contenido de §2.7 Rev.1, de §3.1 y de las Revisiones 1–4 se conserva íntegro; ninguna sección se renumera.
## Revisión 4 — HU-E5 (Visibilidad web independiente del inventario físico), 04/10/2026: contrato sincronizado con la implementación. Revisión aditiva: se agregan §2.5.a–§2.5.e, la extensión de eventos de la sección 4 y la nota Rev.4 de la sección 5. El contenido de §2.5 Rev.1 y de las Revisiones 1–3 se conserva íntegro; ninguna sección se renumera.
## Revisión 3 — HU-E4 (Cupones de descuento), 03/10/2026: contrato cerrado y sincronizado con implementación y re-verify independiente. Revisión aditiva: se agregan §2.4.a–§2.4.e, §3.8, eventos y exclusiones E4; se anota la sustitución de §2.4 Rev.1 y la integración con §2.2. Se conserva íntegro el contenido anterior, incluida HU-E8 Rev.2, sin renumerar otras HUs.
## Revisión 2 — HU-E8 (Registro e inicio de sesión del Cliente Web): contrato cerrado y sincronizado con la implementación. Revisión aditiva: las secciones 2.8.a a 2.8.g, 3.7, la extensión de la sección 4 y el cierre de la sección 5 (al inicio de su lista) se agregan dentro de cada sección sin alterar lo existente; el contenido de la Revisión 1 no se reescribe y ninguna sección se renumera.
## Revisión 1 — Primera especificación técnica del módulo (HU-E1 a HU-E13)

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable; Regla N.° 3 — Aislamiento de Dominio) · `Documento de Alcance Funcional y Técnico` (sección Módulo E) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja **Sprint 4**, HU-E1 a HU-E13) · `schema.prisma` · `spec_modulo_A.md` (sección 2.9, servicio centralizado de reserva — congelamiento/liberación de stock, único punto de contacto con inventario) · `spec_modulo_B.md` (sección 2.1/HU-B1, patrón de venta; sección 2.9/HU-B9, resolución server-side de precio; sección 2.7/HU-B7, comprobante fiscal simulado) · `spec_modulo_C.md` (sección 2.1/HU-C1, alta de Cliente; sección 2.4/HU-C4, consentimiento de datos personales) · `spec_modulo_D.md` (RBAC, auditoría, `ConfiguracionSistema` §6) · `spec_modulo_F.md` (sección 2.1/HU-F1, Conector Mercado Pago; sección 2.3/HU-F3, Motor de Notificaciones internas y aislamiento por tipo de sesión) · `spec_modulo_G.md` (HU-G11, registro del ingreso de cobros online) · `spec_modulo_H.md` (patrón de referencia de formato, cifrado AES-256 y consola de auditoría forense por dominio)

**Changelog de la Revisión 3 (HU-E4):**

| Sección previa | Contrato anterior | Contrato vigente en Rev.3 |
|---|---|---|
| 2.4 | Conteo solo confirmado junto a reserva optimista; ABM declarado | Sustituido para E4 por §2.4.a–e: C+P global/cliente en un statement; histórico, TTL UTC y ABM real |
| 2.2 | Aplicación y pago de E2 | Nota de sincronización: stock→cupón, reloj después del lock; TTL persistido; pago/rechazo conservan locks; datos congelados en pendiente/resultado |
| 2.4 validación | Valor numérico, porcentaje hasta 100; Server Actions declaradas | Valor string decimal, porcentaje <100, bruto ≥ subtotal no aplicable; Route Handlers, sin acciones nuevas; errores raíz en español |
| 2.4 edición/baja | Sin política de historial/concurrencia | Código inmutable, solo ampliar límites con historial, lock sin CAS; baja lógica idempotente |
| 3 reglas | Sin mantenimiento específico de capacidad | §3.8: C/P, confirmadas protegidas, cron/script compartidos con A y tareas independientes |
| 4 eventos | Sin los seis eventos de cupón | Payloads exactos `ecommerce:cupon_*`, listeners explícitos posteriores al COMMIT |
| 5 exclusiones | Alcance general | Sin historial de aplicaciones UI/API, reactivación, acumulación, neto cero ni devolución de usos por reembolso |

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

**Sincronización Rev.3 — integración E4:** se conserva input/response de checkout y la lógica/locks de pago y rechazo. La admisión reserva primero stock, después adquiere lock del cupón y toma `new Date()`; `aplicarCuponTx` consulta ocupación conjunta y crea la pendiente con `reserva_hasta` igual al menor vencimiento de stock del pedido. E2 transmite datos para emitir aplicado/consumido/liberado después del COMMIT. La reserva ocupa capacidad; Q3 rechaza una segunda admisión con límite 1, sin esperar al pago. La salvaguarda histórica `CUPON_LIMITE_EXCEDIDO` se conserva, sin incorporar lock de cupón al pago. Rechazo conserva "Pago rechazado por Mercado Pago". Lectores `obtenerPedidoWebPendiente` / `obtenerResultadoPago` y páginas `/tienda/checkout/pendiente` / `/tienda/checkout/resultado` muestran subtotal, código, descuento y neto persistidos mediante `DesgloseCupon`, sin recalcular precios HU-B9; sin cupón mantienen la vista anterior. El contrato operativo de cupones es §2.4.a–e, que prevalece sobre las menciones anteriores de E4.

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

**Revisión 7 — sustitución explícita:** queda reemplazada la afirmación de Revisión 1 «Sin endpoint propio de transición de estado». E3 **sí** expone una operación de validación y entrega. También quedan sustituidos la ruta por ID, el body `codigo_qr`/`dni_receptor`, el error `QR_INVALIDO` y la asignación de la entrega a E12 en 2.12; ese texto se conserva allí como antecedente histórico. E2 confirma pago y admite en la cola; E12 prepara y genera token/plazo; E9 presenta el QR propio; **E3 valida y entrega**; E13 vence/cancela/reintegra. E3 no rediseña esos flujos.

#### 2.3.a. Decisiones aprobadas y alcance

| ID | Contrato congelado |
|---|---|
| D1 | Todo retiro exige QR válido y DNI físico presentado, coincidente con `Cliente.dni` del titular de `PedidoVenta`. La comprobación adicional por fuerza/legajo queda fuera de E3: el modelo C actual no la soporta. |
| D2 | Solo notificación interna F3; sin WhatsApp, email ni SMS. |
| D3 | E3 es owner de `LISTO_PARA_RETIRO → ENTREGADO`; E12 conserva preparación y generación de QR/plazo. |
| D4 | E3 comprueba el plazo pero no transiciona a `VENCIDO_SIN_RETIRO`, cancela, libera stock ni reintegra; eso pertenece a E13. |
| D5 | Baja de `CuentaClienteWeb` no cancela el retiro de un pedido pagado. Pedido, extensión y Cliente sí deben estar activos y no eliminados. |
| D6 | Éxito: `estado_ecommerce = ENTREGADO`, `codigo_qr_retiro = null`; el plazo puede conservarse. |
| D7 | Reutilización del QR, doble clic o segundo operador: rechazo sin mutación; jamás éxito idempotente ni confirmación de que el token fue válido. |
| D8 | Sin `fecha_entrega`, `operador_entrega_id` ni clave de idempotencia nuevos; actor y hora quedan en evento/auditoría. Sin cambios de Prisma, migración o seed. |
| D9 | Autorizar mediante `ecommerce:validar_retiro_qr` existente, nunca por nombre de rol. |
| D10 | Retiro dentro de `/ecommerce/preparacion`, en sección/pestaña o composición equivalente, con scanner existente. |

#### 2.3.b. HTTP y entrada

**Endpoint único:** `POST /api/ecommerce/preparacion/validar-retiro` (`src/app/api/ecommerce/preparacion/validar-retiro/route.ts`). `withPermission("ecommerce:validar_retiro_qr")` resuelve al actor desde la sesión interna. No hay `pedido_venta_id` en URL, query ni body: el pedido se resuelve siempre a partir del token decodificado del QR. `Cache-Control: no-store` para la respuesta. Content type JSON y body estricto:

**Pedido determinado por el QR:** `codigo_qr_retiro` es único y resuelve exactamente un `PedidoVentaEcommerce` y su `PedidoVenta`. QR del pedido A + DNI del titular A entrega A; QR del pedido B del mismo titular + ese DNI entrega B. QR de un pedido de otro titular + DNI presentado, o QR inexistente/inválido, recibe `RETIRO_NO_VALIDO` sin mutación. Tener varios pedidos del mismo titular no crea ambigüedad: el QR determina el pedido. Nota UX: si el Cliente posee varios pedidos listos, el Operador debe verificar el número mostrado por la interfaz antes de realizar la entrega física.

```json
{ "qr_token": "contenido-decodificado-del-qr", "dni": "12345678" }
```

Schema Zod contractual propuesto (la forma exacta de los mensajes de validación puede seguir el patrón HTTP existente):

```typescript
export const ValidarRetiroSchema = z.object({
  qr_token: z.string().trim().min(1).max(128),
  dni: z.string().trim().regex(/^\d{7,8}$/),
}).strict();
```

`max(128)` limita entrada abusiva y admite el token productivo base64url de 32 bytes (43 caracteres) sin imponer una regex que pueda romper compatibilidad. El servidor normaliza con `trim`; para DNI, después del trim solo admite 7 u 8 dígitos, como los schemas existentes de Cliente. El formato no prueba identidad: la comparación contra `Cliente.dni` ocurre bajo la transacción. No se admiten campos extra, en particular IDs de pedido/extensión/cliente/cuenta/operador, estado, plazo o identidad derivada. El scanner entrega el **contenido completo decodificado** como `qr_token`; no se envía `data:image/...`, no se hace OCR y no se extrae ID del QR.

| HTTP | Error público | Regla |
|---|---|---|
| 400 | `VALIDATION_ERROR` | JSON inválido, campo faltante/extra o schema inválido. No incluir el valor rechazado en el mensaje ni en `fieldErrors`. |
| 401 | `UNAUTHORIZED` | Sin sesión RBAC interna. |
| 403 | `FORBIDDEN` | Sin `ecommerce:validar_retiro_qr`. |
| 422 | `RETIRO_NO_VALIDO` — «No fue posible validar el retiro» | Único rechazo público para QR inexistente, ajeno, ya consumido, estado no listo, plazo vencido, DNI incorrecto, pedido/extensión/Cliente dados de baja o Cliente inactivo. Un contenido formalmente aceptado por Zod pero no correspondiente a token real también cae aquí. |
| 500 | `INTERNAL_ERROR` — mensaje genérico | Inconsistencia interna de B/E o fallo técnico; rollback, sin revelar pedido, token ni DNI. |

No se define `409` para esta operación: revelaría diferencias de estado sin aportar una acción distinta al Operador. La ruta nunca devuelve motivos internos, SQL, valores recibidos ni presencia previa del token. Éxito `200`:

```json
{ "data": { "pedido_venta_id": "uuid", "numero": "V-2026-000123", "estado": "ENTREGADO" }, "error": null }
```

No incluye QR/token, DNI, email, datos de Cliente, pago, Mercado Pago ni hashes. La respuesta mínima muestra el número de venta tras el éxito; el Operador verifica el pedido determinado por el QR antes de la entrega física.

#### 2.3.c. Resolución, transacción y Módulo B

1. Tras autenticar/autorizar y validar el body, una **lectura preliminar sin locks** obtiene `pedido_venta_id` desde `PedidoVentaEcommerce.codigo_qr_retiro = qr_token`. No autoriza la entrega y su resultado jamás se comunica al cliente HTTP. Si no existe, emitir el rechazo auditable seguro de 2.3.d sin `pedido_venta_id` y devolver el `422` genérico.
2. Abrir una transacción. Adquirir locks en el orden E12: **(1) `PedidoVenta` por ID, (2) `PedidoVentaEcommerce` por `pedido_venta_id`, (3) `PedidoVentaItem` activos ordenados por `created_at, id`**, usando `SELECT ... FOR UPDATE` o el patrón equivalente de E12. Para estabilizar también la identidad frente a una baja concurrente de Módulo C, bloquear **después** la fila `Cliente` ligada al pedido, antes de comparar su DNI/soft delete y de escribir la entrega. La lectura preliminar no cambia este orden porque no retiene locks. Cualquier futuro mutador E13 sobre el mismo agregado debe respetar los tres primeros locks.
3. **Después de los locks**, volver a comprobar todas las condiciones: `PedidoVenta.canal = WEB`, `is_active = true`, `deleted_at = null`, `estado = FACTURADO`; extensión activa/no eliminada, `estado_ecommerce = LISTO_PARA_RETIRO`, token **igual al recibido** y no nulo, `plazo_retiro_vencimiento IS NULL OR >= ahora` (capturar `ahora` después de adquirir locks); `Cliente` ligado por `PedidoVenta.cliente_id`, activo/no eliminado y con DNI exactamente igual al normalizado. `CuentaClienteWeb` inactiva no bloquea. No aceptar un pedido sin Cliente titular.
4. Con los ítems ya bloqueados, comprobar que existen, que todos están facturados por completo (`cantidad_facturada = cantidad`), que `0 <= cantidad_entregada <= cantidad_facturada` y que no hay entrega parcial previa (`cantidad_entregada = 0`) para este retiro único. La ausencia de ítems o cantidades/estado B incoherentes es error interno con rollback, no una entrega parcial ni un `422` que revele datos. El helper B realiza/repite sus propias precondiciones bajo esos locks.
5. Invocar un helper transaccional **propiedad del dominio B**, por ejemplo `registrarEntregaTotalPedidoVentaTx(tx, pedidoVentaId)`. Debe usar el `tx` recibido, no abrir otra transacción; comprobar `PedidoVenta` WEB, `FACTURADO` y todos los ítems facturados; llevar cada `cantidad_entregada` de 0 a `cantidad_facturada = cantidad`, y el pedido por la secuencia contractual `FACTURADO → REMITO_EMITIDO → CERRADO` dentro del mismo commit. No crear entidad `Remito` nueva; en el modelo actual el estado y los contadores representan la entrega. No producir un segundo cobro ni comprobante fiscal. **Revisión 8:** el helper no recibe `actorId`: no audita ni emite eventos E3, no persiste operador de entrega y no necesita actor para modificar las entidades existentes. El orquestador E3 conserva `actor_id` en `ecommerce:pedido_entregado` y `ecommerce:retiro_rechazado` para auditoría post-commit. Si se demuestra una necesidad real del dominio B durante la implementación, **STOP y nueva revisión contractual** antes de cambiar la firma.
6. En la **misma transacción**, cambiar condicionalmente `PedidoVentaEcommerce` desde `LISTO_PARA_RETIRO` con el token vigente a `ENTREGADO` y `codigo_qr_retiro = null`. Comprobar que se actualizó una sola fila; cualquier fallo revierte también las escrituras B. Conservar `plazo_retiro_vencimiento`, `fecha_pago_confirmado`, `operador_asignado_id` y `prioridad_manual`.
7. Tras commit exitoso, emitir **una sola vez** `ecommerce:pedido_entregado` y devolver el DTO mínimo. Un fallo/rollback no emite éxito. El token consumido ya no es localizable por un segundo request; éste recibe el mismo `422` genérico que un token inexistente.

Un rechazo de negocio después de resolver el pedido no escribe B/E. Se emite el evento seguro `ecommerce:retiro_rechazado` después de resolver la transacción fallida, nunca dentro de una transacción que terminará en rollback. El evento/audit es independiente de la mutación de entrega; errores de listener no convierten un rechazo en éxito ni revierten un commit. La auditoría de entrega es post-commit, conforme al patrón actual de Módulo D.

**Concurrencia:** dos operadores o dos requests con el mismo QR compiten por `PedidoVenta`; el primero que confirma consume el token y cierra B/E. El segundo relee extensión bajo lock y rechaza sin entrega ni segundo evento `pedido_entregado`. En retiro frente a E13, quien obtiene primero los locks decide; el siguiente relee estado y plazo, y no realiza una transición incompatible. E13 conserva la lógica de vencimiento y debe usar el mismo orden. Nunca quedan `ENTREGADO` y `VENCIDO_SIN_RETIRO` para un mismo pedido.

#### 2.3.d. Eventos, F3 y auditoría

```typescript
type MotivoRetiroRechazado =
  | "TOKEN_NO_RESUELTO"
  | "PEDIDO_NO_OPERABLE"
  | "ESTADO_NO_LISTO"
  | "PLAZO_VENCIDO"
  | "DNI_NO_COINCIDE"
  | "CLIENTE_NO_OPERABLE";

type PedidoEntregadoPayload = {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  actor_id: string;
  estado_anterior: "LISTO_PARA_RETIRO";
  estado_nuevo: "ENTREGADO";
  timestamp: string;
};

type RetiroRechazadoPayload = {
  evento_id: string;
  actor_id: string;
  motivo: MotivoRetiroRechazado;
  timestamp: string;
  pedido_venta_id?: string;
  pedido_venta_ecommerce_id?: string;
};
```

Módulo D registra `pedido_entregado` como transición estándar con actor/hora e IDs. **Revisión 9 — mapping de `retiro_rechazado`:** si el token permitió resolver de forma segura la extensión y su pedido, el evento incluye ambos IDs opcionales y AuditLog usa `tabla_afectada = "pedidos_venta_ecommerce"` y `registro_id = pedido_venta_ecommerce_id`; `pedido_venta_id` queda solo como contexto técnico y no reemplaza el ID de la extensión en `registro_id`. Si el token no resolvió ninguna extensión, el evento omite ambos IDs y AuditLog usa la misma `tabla_afectada` con `registro_id = null` (por ejemplo, `motivo = TOKEN_NO_RESUELTO`). No hacer búsquedas adicionales solo para completar IDs después de un fallo. El motivo es enum acotado, nunca texto del usuario. Ni el payload ni la auditoría incluyen `qr_token`, `codigo_qr_retiro`, DNI, email o datos de pago; ninguno de ellos puede usarse como `registro_id`. Un fallo de consistencia interna puede registrarse mediante logging técnico seguro, sin tratarlo como entrega ni incluir secretos. No se suscribe `pedido_entregado` a F3 en esta HU.

**Cierre de brecha F3 al quedar listo:** E12 ya emite `ecommerce:pedido_listo_para_retiro` post-commit, pero el listener F3 actual no lo suscribe. Extender **solo** ese payload con `cliente_web_cuenta_id` y `numero_venta`, resueltos server-side desde el `PedidoVenta.cliente_id` y su `CuentaClienteWeb` dentro de la finalización E12; no aceptar destinatario desde el cliente, no incluir QR/token, DNI ni email. El registro de cuenta puede estar inactivo por baja posterior: eso no cambia el derecho de retiro; la visibilidad de la bandeja se rige por F3/E8. Para un pedido legacy sin cuenta vinculable, no inventar destinatario: permitir `cliente_web_cuenta_id: null`, omitir notificación y conservar estado/listo/auditoría. F3 suscribe el evento con prioridad `INFORMATIVA`, destinatario `cuenta_cliente_web_ids: [cliente_web_cuenta_id]` cuando no sea nulo, variables `{ numero_venta }`, `clave_origen = evento_id`. **Revisión 8:** `clave_origen` identifica la ocurrencia del evento, no el agregado; la misma ocurrencia de `ecommerce:pedido_listo_para_retiro` con el mismo destinatario produce una sola `Notificacion`. `numero_venta` es solo variable de plantilla y no integra la clave. `pedido_venta_id` conserva su uso como ID de dominio, pero no es `clave_origen` de F3. La plantilla `ecommerce:pedido_listo_para_retiro` ya existe en seed; no modificar seed ni crear mensajería externa. La falla de F3 post-commit no revierte `LISTO_PARA_RETIRO`.

Ningún log, `AuditLog`, evento, mensaje HTTP, URL, querystring o consola incluye `qr_token`, DNI completo, email o datos de pago. El body POST es el único transporte de QR y DNI, y no se persiste el DNI presentado.

#### 2.3.e. UI y pruebas contractuales

En `/ecommerce/preparacion`, agregar sección/pestaña **Retiro**, accesible por `ecommerce:validar_retiro_qr`. Reutilizar `CameraBarcodeScanner`/`useBarcodeScanner` (QR nativo y ZXing fallback) y el patrón manual de `PreparacionPedidoPanel`. Campos mínimos: scanner QR, entrada manual alternativa del contenido QR, DNI, botón «Validar y entregar», feedback genérico de error y confirmación «Pedido V-… entregado correctamente». Deshabilitar el botón mientras se envía; después del éxito limpiar token y DNI. No mostrar token procesado, DNI almacenado del Cliente, pagos ni facturación. La UI no es fuente de autoridad: el servidor revalida todo.

| Nivel | Casos obligatorios |
|---|---|
| Unitario | Zod: token vacío, límite, contenido formalmente aceptado, DNI trim + 7/8 dígitos, letras/puntuación/longitud inválidas, campos extra; reglas puras si se extraen. |
| Servicio/integración | QR + DNI correctos; DNI incorrecto; token inexistente; QR de pedido B del **mismo titular** + DNI correcto entrega exactamente B; QR de pedido B de **otro titular** + DNI presentado rechaza sin mutación; `EN_PREPARACION`, `ENTREGADO`, `CANCELADO`, `VENCIDO_SIN_RETIRO`; plazo vencido aún `LISTO`; bajas lógicas de pedido/extensión; Cliente inactivo/eliminado; cuenta web inactiva **sí permite** retiro válido; ítems inactivos o cantidades inconsistentes producen rollback; B termina `CERRADO` con `cantidad_entregada` completa; E termina `ENTREGADO`, token nulo y plazo conservado; actor/hora y un solo evento exitoso; rechazo auditado sin QR/DNI. |
| Concurrencia | Dos operadores con mismo QR y doble request: un éxito, un rechazo, una entrega B/E y una auditoría de entrega. QR reutilizado: rechazo. Carrera con mutación incompatible que siga el patrón E13: solo una transición gana y la otra relee bajo locks. |
| HTTP/RBAC | `400` JSON/schema/campos extra, `401`, `403`, éxito mínimo, `422` uniforme para causas sensibles, `500` seguro para inconsistencia, permiso correcto sin comparar nombre de rol, ninguna respuesta contiene token/DNI/PII/pago. |
| F3 | Evento `pedido_listo_para_retiro` crea exactamente una notificación interna para cuenta dueña, reemisión no duplica; payload sin token; sin WhatsApp/email; `pedido_entregado` no crea notificación. |
| UI | Scanner y entrada manual envían contenido decodificado; DNI y botón; éxito/error; limpieza tras éxito; sin datos sensibles renderizados. |

**Integración principal real:** Cliente A inicia sesión E8, crea carrito, hace checkout, E2 confirma pago y E12 admite; Operador toma, escanea ítems y completa; se comprueban `LISTO`, aviso interno F3 y QR propio E9; se decodifica el token real de ese QR y E3 entrega con DNI real; se verifican E `ENTREGADO`, B `CERRADO`, contadores, token `null` y QR ausente en E9. Cliente B/tercero con DNI incorrecto no puede retirar. La prueba no fija manualmente estado `LISTO`, token ni plazo.

**Archivos probables al implementar (esta revisión solo redacta SPEC):** nuevos `src/lib/schemas/retiro-e3.schema.ts`, `src/lib/services/ecommerce/retiro-e3.service.ts`, `src/app/api/ecommerce/preparacion/validar-retiro/route.ts` y tests E3; modificados `src/lib/services/ventas/pedido-venta.service.ts` (helper B), `src/lib/events/event-types.ts`, `src/lib/events/listeners/audit-log.listener.ts`, `src/lib/events/listeners/notificacion.listener.ts`, `src/lib/services/ecommerce/pick-pack.service.ts` solo para datos de destinatario del evento `LISTO`, y UI/tests de `/ecommerce/preparacion`. No modificar `mis-pedidos.service.ts`/DTO E9, `pago-web.service.ts` E2, lógica E13, `prisma/schema.prisma`, migraciones ni `prisma/seed.ts`. La integración puede invocar servicios E2/E9 sin editarlos.

### 2.4. Cupones de descuento (HU-E4)

**Sustitución explícita Rev.3:** el contrato E4 vigente está en **§2.4.a–§2.4.e** y §3.8 agregados a continuación. El texto de Rev.1 bajo este encabezado se conserva como antecedente; quedan sustituidos sus conteos solo de confirmadas, Server Actions previstas, schema numérico/porcentaje ≤100, respuesta aislada de aplicación y cualquier referencia contradictoria a reserva optimista. La implementación utiliza las cinco operaciones HTTP de §2.4.e y el checkout E2 existente; no hay endpoint público de aplicación o prevalidación. Las demás HUs y Rev.2 E8 se conservan.

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

### 2.4.a. Modelo persistido y migración (Revisión 3 — HU-E4)

Se reutilizan `CuponDescuento` (`cupones_descuento`) y `CuponAplicacion` (`aplicaciones_cupon`), sin tablas nuevas. Se agrega `updated_at DateTime @updatedAt` a ambos y `reserva_hasta DateTime?` a la aplicación. Tipo de beneficio persiste como String y se valida como `PORCENTAJE | MONTO_FIJO`. Importes siguen siendo Decimal; código único incluyendo cupones dados de baja. No se modifica el modelo de clientes C ni inventario A.

Migración `20261003120000_hu_e4_cupones_descuento`: `updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, backfill `updated_at = created_at`; TTL nullable `TIMESTAMP(3)` **sin zona**. Solo pendientes activas sin baja reciben el menor `fecha_expiracion` de las reservas relacionadas con items activos del pedido. Confirmadas e históricas quedan con TTL nulo; pendientes nuevas siempre guardan TTL. No agrega CHECKs ni índices parciales manuales, conforme al delta aprobado.

Seed de `SWAT10`, `INVIERNO5000`, `LANZAMIENTO15`: upserts que no reactivan bajas en update. El TTL del fixture pendiente se sincroniza con su reserva de stock, sin tocar campos de baja. La validación independiente de migración reportó **No difference detected** contra shadow de test; integración debe generar cliente Prisma y desplegar migraciones con el procedimiento del entorno.

### 2.4.b. Capacidad, estado y lectura coherente (Revisión 3 — HU-E4)

- **C:** todas las aplicaciones `confirmada = true`, incluidas las históricas inactivas o dadas de baja. Un reembolso no devuelve capacidad.
- **P:** `confirmada = false`, `is_active = true`, `deleted_at IS NULL`, `reserva_hasta > ahora`. TTL nulo o vencido no ocupa capacidad.
- Mismos predicados globales y por `cliente_id` de la cuenta web vinculada. Admisión exige `C+P < límite` para ambos; global nulo significa ilimitado.
- `leerOcupacion` ejecuta **un `$queryRaw` con `COUNT(*) FILTER`** para C/P globales, C/P del cliente y total histórico. Un pago entre dos statements no puede perder simultáneamente la pendiente y el consumo. Admisión, `construirDtos` y reevaluación definitiva de baja automática usan este mismo helper.
- Comparación UTC explícita: `reserva_hasta > (ahora.toISOString()::timestamptz AT TIME ZONE 'UTC')`. El resultado sin zona es compatible con la columna; no interpreta ese UTC como hora local de la sesión PostgreSQL. El re-verify probó −1/+1 minuto en UTC, Buenos Aires y Tokio.

Estado derivado por prioridad: `DADO_DE_BAJA` (inactivo o con deleted_at), `NO_INICIADO` (ahora < inicio), `VENCIDO` (ahora > fin), `AGOTADO` (C global ≥ límite finito), `VIGENTE`. Los extremos de vigencia son inclusivos. **P no produce agotamiento del maestro**: puede cerrar temporalmente admisión, sin dar de baja el cupón. Disponible = null si ilimitado; si finito, `max(0, límite_global−C−P)`. `tiene_aplicaciones` contempla todo el historial, incluso liberadas.

### 2.4.c. Aplicación en checkout y K5 (Revisión 3 — HU-E4)

Un único `cupon_codigo?` en checkout E2; se normaliza trim/mayúsculas. Orden stock→cupón: E2 reserva stock y llama a `aplicarCuponTx`; éste adquiere `SELECT ... FOR UPDATE` sobre el maestro, toma **reloj de aplicación después del lock** (Gate 3 A2), relee y valida estado/capacidad. Esta resolución sustituye la mención previa a reloj de BD. La aplicación pendiente conserva `reserva_hasta` igual al menor TTL de stock del pedido.

Precio/base: subtotal de items congelado por HU-B9. Cálculo Decimal, half-up a dos decimales. **K5:** porcentaje menor que 100 y descuento bruto ≥ subtotal → `CUPON_NO_APLICABLE` **antes** del recorte defensivo de `calcularDescuento`. Porcentaje/fijo deben dejar neto positivo; no venta gratis ni acumulación. Error revierte la transacción de admisión, sin pedido/aplicación parcialmente aceptados.

Errores 422 vía `respuesta-tienda.ts`: `CUPON_NO_ENCONTRADO`, `CUPON_INACTIVO`, `CUPON_NO_VIGENTE`, `CUPON_VENCIDO`, `CUPON_LIMITE_ALCANZADO`, `CUPON_NO_APLICABLE`. No se añade endpoint público previo ni cambia la respuesta de checkout E2. Pendiente/resultado leen subtotal/descuento/código persistidos mediante lectores con control de propiedad; `DesgloseCupon` conserva vista anterior cuando no existe cupón.

### 2.4.d. Consumo, liberación y mantenimiento (Revisión 3 — HU-E4)

Pago confirmado convierte P en C. **K2:** pago/rechazo conservan locks y lógica E2; no adquieren lock del maestro ni vuelven a reservar/revalidar capacidad. Se mantiene la salvaguarda histórica de límite excedido (`CUPON_LIMITE_EXCEDIDO`), sin transformarla en nueva condición de rechazo del pago. `pago-web.service.ts` transporta los datos devueltos por las funciones de cupón para eventos posteriores al COMMIT. Rechazo conserva **"Pago rechazado por Mercado Pago"**.

`ejecutarMantenimientoCupones()`:

1. Libera aplicaciones **no confirmadas**, activas y sin baja con `reserva_hasta <= ahora`; selección y update condicionado comparten `confirmada: false`. Motivo `TTL_CHECKOUT_VENCIDO`. Una confirmada con TTL pasado se conserva. Capacidad ya excluye una pendiente vencida aunque el mantenimiento se demore.
2. Preselecciona maestros vencidos o agotados por **C**, adquiere lock de cada maestro y reevalúa con `leerOcupacion` y reloj actual. Baja lógica por `VENCIMIENTO` o `LIMITE_GLOBAL_AGOTADO`; prevalece vencimiento. Idempotente, actor sistema Canal Web. No reactivación ni limpieza de historia.

Entry points: **POST `/api/cron/check-pruebas-vencidas`** y script `scripts/liberar-reservas-vencidas.ts` (`npm run job:reservas`, `job:reservas:watch`). `mantenimiento-programado.ts` ejecuta `liberarReservasVencidas` de A primero y luego E4, cada tarea con captura de error independiente. No se modifica `reserva.service.ts` ni se crea un job TTL E2 separado. El cron preserva el status de A (500 si falla, 200 si termina); resultado E4 en `mantenimiento_cupones`, con error genérico si falla. Bearer `CRON_SECRET` cuando está configurado; producción sin secreto es error.

En test, seed y server deben compartir `ENCRYPTION_KEY_PROVEEDORES` para el conector simulado, además de los secretos efímeros de sesión/carrito. Si se pierde la clave efímera, generar otra y resembrar **solo la base aislada de test** con el seed existente; no resetear ni reemplazar silenciosamente por development/producción. Claves fuera de archivos/reportes.

### 2.4.e. Administración, schemas y respuesta (Revisión 3 — HU-E4)

Página `/ecommerce/cupones`, componente `CuponesCliente`, entrada **Cupones en Clientes** junto a Cuentas web. Permiso exclusivo Administrador E-commerce: `ecommerce:gestionar_cupones` (`PERMISO_GESTIONAR_CUPONES`, `src/lib/auth/permisos-ecommerce.ts`). Página protegida en servidor y cinco métodos `withPermission`; actor `session.userId`, nunca body. Implementación mediante Route Handlers, sin las Server Actions previstas en Rev.1.

| Método | Ruta | Respuesta de éxito |
|---|---|---|
| GET | `/api/ecommerce/cupones?estado=ACTIVOS\|INACTIVOS\|TODOS&q=` | 200 `{ data: { items }, error: null }`; default ACTIVOS, q por código, `created_at` desc |
| POST | `/api/ecommerce/cupones` | 201 `{ data: { cupon }, error: null }` |
| GET | `/api/ecommerce/cupones/[id]` | 200 `{ data: { cupon }, error: null }`, incluye bajas |
| PATCH | `/api/ecommerce/cupones/[id]` | 200 `{ data: { cupon }, error: null }` |
| PATCH | `/api/ecommerce/cupones/[id]/baja` | 200 `{ data: { cupon }, error: null }`, repetición sin cambios ni evento |

DTO `cupon`: `id, codigo, tipo_beneficio, valor, vigente_desde, vigente_hasta, limite_uso_global, limite_uso_por_cliente, is_active, deleted_at, deletion_reason, estado, usos_confirmados, reservas_vigentes, capacidad_disponible, tiene_aplicaciones, created_at, updated_at`. `valor` texto decimal con dos decimales, fechas ISO, global/disponible nulos si ilimitados; `deleted_by` no forma parte del DTO.

Schemas estrictos `CrearCuponSchema`, `EditarCuponSchema`, `BajaCuponSchema`, `FiltroCuponesSchema` en `src/lib/schemas/cupon.schema.ts`:

- Código: trim/mayúsculas, 3–50 `[A-Z0-9_-]`, único incluso sobre bajas. Tipo `PORCENTAJE | MONTO_FIJO`; valor **string** decimal positivo, hasta dos decimales, compatible con Decimal(12,2). Porcentaje <100.
- Inicio/fin ISO con zona; fin > inicio. Global entero positivo nullable, default null; cliente entero positivo, default 1. q trim/mayúsculas, máximo 50; vacío se omite.
- PATCH sin código, actor ni campos de baja; al menos un campo. Servicio valida campos cruzados contra persistido. **K4:** sin aplicaciones se edita beneficio/ventana/límites; con cualquier historial solo se amplían límites (global finito→mayor/null; ilimitado no se reduce; cliente→mayor). Maestro dado de baja no se edita. **K6:** lock/relectura, sin CAS; no-op sin evento.
- Baja: motivo texto trim de 3–500; setea `is_active=false`, `deleted_at`, `deleted_by`, `deletion_reason`. Conserva descuentos de compras iniciadas. Repetida devuelve el estado actual sin evento.

`respuesta-cupones.ts` concentra `leerJson` y mapeo de errores. Validación 400: `{ data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos", fieldErrors, formErrors } }`. `null`, array y no-JSON reciben **"El cuerpo debe ser un objeto JSON"** en formErrors; motivo ausente **"El motivo es obligatorio"**. Otros: 401/403; 404 `CUPON_NO_ENCONTRADO`; 409 `CUPON_CODIGO_EXISTENTE`, `CUPON_INACTIVO`, `CUPON_EDICION_RESTRINGIDA`; 500 `INTERNAL_ERROR` genérico.

UI: alta exitosa muestra **Cupón creado**, limpia búsqueda y selecciona Todos; edición real **Cupón actualizado**. No-op cierra sin éxito y errores conservan formulario/mensaje; controles de envío deshabilitados. Motivo vacío/<3 impide submit, sin atribuirle respuesta API. Read-only traduce `VENCIMIENTO → Vencimiento`, `LIMITE_GLOBAL_AGOTADO → Límite de uso agotado` y conserva motivo manual; fecha sin doble punto mediante `motivo-baja-cupon.ts`/presentación. `TTL_CHECKOUT_VENCIDO → Reserva vencida` tiene mapping unitario, sin superficie de historial contractual (K8).

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

### 2.5.a. Dos operaciones: ocultar/mostrar y baja lógica (Revisión 4 — HU-E5)

El criterio 3 del backlog exige que "la desactivación web" sea baja lógica con `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`; esta sección (Rev.1) la define como `UPDATE` reversible. Se implementan **las dos**, como operaciones separadas (pendiente de validar con el PO):

- **Ocultar/mostrar** (este §2.5): `UPDATE` reversible de `visibilidad_web`, motivo opcional, sin tocar `is_active` ni `deleted_*`. Pedir el valor actual es un no-op: 200 con el estado, sin `UPDATE`, sin evento ni avisos.
- **Baja lógica del contenido** (criterio 3): `is_active = false`, `deleted_at`, `deleted_by` (actor de la sesión), `deletion_reason` obligatorio y `visibilidad_web = false`. Sin reactivación. §2.11 asigna la baja del contenido a HU-E11: E11 debe reutilizar `darDeBajaContenidoWeb()` (`src/lib/services/ecommerce/visibilidad-web.service.ts`) sin duplicar lógica.

Un contenido dado de baja no es operable: ambas operaciones responden `404 PRODUCTO_WEB_NO_ENCONTRADO`.

### 2.5.b. Interfaces (Revisión 4 — HU-E5)

**Ruta (baja lógica):** `PATCH /app/api/ecommerce/catalogo/[producto_web_id]/baja/route.ts` — mismo permiso `ecommerce:gestionar_catalogo`.
**Server Actions:** no se implementaron. Siguiendo el patrón real del Módulo E (cupones, cuentas web), la pantalla `/ecommerce/catalogo` llama a los Route Handlers; la Server Action `cambiarVisibilidadWeb()` nombrada arriba queda como desvío a validar por el equipo. El listado de la pantalla se lee desde el Server Component; no se agrega un `GET` de listado.

```typescript
// src/lib/schemas/ecommerce.schema.ts — bodies estrictos (campo extra → 400)
export const CambiarVisibilidadWebSchema = z.object({
  visibilidad_web: z.boolean(),
  motivo: z.string().trim().min(1).max(500).optional(),
}).strict();
export const BajaContenidoWebSchema = z.object({
  deletion_reason: z.string().trim().min(1).max(500),
}).strict();
```

**Respuesta `200 OK` (baja):**
```json
{ "data": { "producto_web_id": "uuid", "is_active": false, "deleted_at": "2026-10-05T14:02:11.000Z" }, "error": null }
```

Errores: `400 VALIDATION_ERROR` (id no UUID, body inválido, raíz no objeto, campo extra, motivo vacío) · `401` · `403` · `404 PRODUCTO_WEB_NO_ENCONTRADO` · `500 INTERNAL_ERROR`.

### 2.5.c. Aviso a carritos afectados (Revisión 4 — HU-E5)

Después del COMMIT, al ocultar un contenido —o al darlo de baja **si estaba visible**— se emite `ecommerce:carrito_articulo_no_disponible` por cada ítem activo de un carrito activo cuya variante pertenece al Producto Maestro del contenido, con `motivo: "NO_VISIBLE_WEB"` y el campo nuevo `origen: "VISIBILIDAD_WEB"` (ver sección 4). Los carritos de visitante emiten con `cliente_web_cuenta_id: null` y HU-F3 los descarta. La idempotencia de F3 sigue siendo por `carrito_item_id`: un ítem notifica una sola vez, sea por este aviso o por un checkout bloqueado. Una falla al avisar no revierte la operación ya confirmada.

### 2.5.d. Carritos abandonados (Revisión 4 — HU-E5, contrato compartido con §2.1)

Clave nueva `ECOMMERCE_CARRITO_ABANDONADO_DIAS` (módulo `E`, sembrada en `7`, valor pendiente de validar con el PO). Un carrito (de cuenta o de visitante) está abandonado si `carritos_web.updated_at` es estrictamente anterior a `ahora − plazo`. La baja es lógica: `is_active = false`, `deleted_at = ahora`, `deleted_by = null` (sistema), `deletion_reason = "ABANDONADO"`; los ítems no se tocan; no emite evento ni asiento de auditoría (no es un evento de negocio auditable, §2.1). Corre como tercera tarea, aislada, del coordinador `mantenimiento-programado.ts` (HU-E4), invocado por `POST /api/cron/check-pruebas-vencidas` (bloque `mantenimiento_carritos` en la respuesta, sin cambiar autenticación ni status) y por `npm run job:reservas`.

### 2.5.e. Independencia respecto de Módulo A (Revisión 4 — HU-E5)

Ninguna de las dos operaciones lee ni escribe `VarianteSKU`, `ProductoMaestro` ni `StockDeposito`. El listado de administración informa el estado del Producto Maestro solo como dato de lectura; no condiciona la visibilidad.

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

### 2.7.a. Interfaces (Revisión 5 — HU-E7)

- **Ruta:** `PATCH /api/ecommerce/pedidos/[id]/anular`, con `[id]` = `pedido_venta_id` (UUID de `PedidoVenta`, no el id de `PedidoVentaEcommerce`), coherente con la respuesta y el evento. Permiso `ecommerce:anular_orden_no_abonada` (constante `PERMISO_ANULAR_ORDEN_NO_ABONADA`), actor siempre de la sesión.
- **Sin Server Action (desvío a validar con el equipo):** no hay `actions.ts`; la pantalla `/ecommerce/pedidos` (Server Component con gate de permiso: sin sesión → `/login`, sin permiso → `/no-autorizado`) lista las órdenes no abonadas y su componente cliente llama al Route Handler, mismo criterio que cupones, cuentas web y catálogo (desvío ya registrado en HU-E5). Sidebar: "Pedidos web", debajo de "Catálogo web".
- **Schema:** el de §2.7 Rev.1 con `.trim()`, mensajes de raíz y `.strict()` (convención desde HU-E4/E5), sin tope de largo: raíz no objeto → "El cuerpo debe ser un objeto JSON"; campo extra (`actor_id`, `deleted_by`, `estado`…) → "El cuerpo contiene campos no permitidos"; vacío o solo espacios → "El motivo de anulación es obligatorio".
- **Errores:** 400 `VALIDATION_ERROR` · 401 `UNAUTHORIZED` · 403 `FORBIDDEN` · **404 `PEDIDO_WEB_NO_ENCONTRADO`** ("El pedido no existe o no es un pedido web": id inexistente o `PedidoVenta` de canal MOSTRADOR) · 409 `TRANSICION_INVALIDA` (mensaje de §2.7) · 500 `INTERNAL_ERROR`.

### 2.7.b. Caminos de anulación (Revisión 5 — HU-E7)

- La búsqueda es por `pedido_venta_id` **sin filtrar por `is_active`**, para que una segunda anulación responda 409 y no un 404 engañoso. *Desvío justificado respecto de `RULES.md` §1* (filtrar inactivos por defecto): la operación necesita ver la orden ya dada de baja para rechazarla con el código correcto; no se expone ningún dato del registro inactivo.
- **`PAGO_PENDIENTE`**, en una transacción: libera vía Módulo A **todas** las reservas activas de los ítems del pedido (§2.7 Rev.1 habla de "la Reserva" en singular; un pedido web tiene una por ítem), da de baja la aplicación de cupón pendiente (HU-E4, firmada por el usuario de sistema "Canal Web" como el resto de las liberaciones de E4), anula el `PedidoVenta` (`RESERVADO → ANULADO`, baja lógica con el actor y el motivo) y pasa la extensión a `ANULADO` con sus cuatro campos de baja.
- **`PAGO_RECHAZADO`:** HU-E2 ya liberó reservas y cupón y anuló el `PedidoVenta` con su propia baja lógica; la anulación solo pasa la extensión a `ANULADO` con baja lógica y no pisa la baja de E2. Si el `PedidoVenta` todavía está `RESERVADO` y activo (datos que no pasaron por el flujo real de E2), también se anula.
- **`stock_liberado`** es `true` solo si esta operación liberó al menos una reserva: en `PAGO_RECHAZADO` es `false` (el stock ya se había liberado).
- Nunca DELETE: ítems, reservas (cerradas, no dadas de baja), aplicación de cupón y transacciones de pago quedan en el historial; la orden anulada conserva sus cuatro campos de baja y su `deletion_reason` para las métricas de conversión del Módulo D (consumidor diferido, HU-D3).
- **Desvío respecto de §3.1 (no se reescribe §3.1):** §3.1 asocia `PAGO_RECHAZADO` a `PedidoVenta.estado = RESERVADO (sin cambio)`, pero HU-E2 implementó el rechazo anulando el `PedidoVenta` (`RESERVADO → ANULADO`, decisión P4 de E2). §2.7.b sigue el comportamiento real; el fixture `PEDIDO_WEB_PAGO_RECHAZADO_IDS` del seed todavía refleja §3.1.

### 2.7.c. Concurrencia (Revisión 5 — HU-E7)

Mismo orden de bloqueo que la confirmación del pago web: `PedidoVenta` `FOR UPDATE` y luego transición condicionada de la extensión (`estado_ecommerce` esperado + `is_active`). Si gana el pago, la anulación responde 409; si gana la anulación, el pago aprobado posterior se clasifica `PAGO_TARDIO` (E2). El rechazo del pago bloquea en el orden inverso: un deadlock (`40P01`) se reintenta localmente hasta 3 veces, cada intento relee el estado y los eventos se emiten una sola vez tras el intento que confirmó.

### 2.7.d. Vía automática por TTL (Revisión 5 — HU-E7)

- Listener `anulacion-orden.listener.ts`, registrado en `domain-event-bus.ts` después del de auditoría. Solo reacciona a `stock:reserva_liberada` con `motivo_liberacion = "TTL_VENCIDO"`: correlaciona `reserva_id` → ítem → `pedido_venta_id` y, si el pedido es `WEB` con la extensión activa en `PAGO_PENDIENTE`, aplica el mismo núcleo que la vía manual con `deleted_by` = usuario de sistema "Canal Web", `deletion_reason = "Reserva vencida sin pago (TTL)"` (`MOTIVO_ANULACION_TTL`) y `automatico: true`. Si alguna reserva de la orden seguía activa, también se libera. Cualquier otro caso se ignora sin error; varias reservas de una misma orden producen una sola anulación. Un error se loguea solo con su código y nunca rompe al emisor.
- Funciona en los tres lugares donde corre el TTL: el cron y la liberación en línea del checkout (proceso de Next) y `npm run job:reservas`, que espera `listenersRegistrados` antes de liberar y `esperarAnulacionesPendientes()` antes de desconectar Prisma.

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

**Story Points:** 3.
**Objetivo:** el Cliente Web consulta el historial de sus pedidos `WEB`, su estado actual y detalle, el comprobante asociado cuando está disponible y el QR de retiro únicamente si el pedido está efectivamente listo para retirar.

**Modelo:** no se crea `PedidoWeb` ni `OrdenWeb`. Se reutiliza el `PedidoVenta` del Módulo B con `canal = WEB` y su extensión 1:1 `PedidoVentaEcommerce` para el estado y los datos propios del canal online (2.2). "Historial" significa listado de compras propias y estado actual de cada una, no una cronología persistida de transiciones: HU-E9 no crea otra tabla, campos ni enum y no consulta `AuditLog` para construir `historial_estados`.

**Rutas definitivas implementadas:** `GET /app/api/tienda/mis-pedidos/route.ts` (`/api/tienda/mis-pedidos`) y `GET /app/api/tienda/mis-pedidos/[id]/route.ts` (`/api/tienda/mis-pedidos/[id]`). Las pantallas implementadas son `/tienda/cuenta/pedidos` y `/tienda/cuenta/pedidos/[id]`. HU-E8 provee `withSesionClienteWeb()` y la cookie `swat_tienda_session`; E9 las reutiliza. Cliente Web no usa `/api/ecommerce/**`, `/ecommerce/mis-pedidos` ni las antiguas rutas `/cuenta/pedidos`.

**Comportamiento implementado:**
- **Identidad y mitigación IDOR:** el flujo obligatorio es `sesión E8 → sesion.clienteId → servicio E9`. El frontend puede enviar únicamente `page`, `page_size` y el `pedidoId` de la URL; nunca `clienteId`, `cuentaId`, email o DNI. Sin sesión válida responde `401`; una cuenta con vinculación pendiente responde `403 CUENTA_VINCULACION_PENDIENTE`. El detalle consulta en un único predicado ID solicitado + `cliente_id` autenticado + canal WEB + registros activos. Pedido ajeno e inexistente producen el mismo `404 PEDIDO_NO_ENCONTRADO`.
- **Listado y baja lógica:** paginación server-side de 1–50 elementos (20 por defecto), pedidos `WEB` propios con extensión e-commerce y registros de negocio activos: `PedidoVenta.is_active = true`, `PedidoVenta.deleted_at = null`, `PedidoVentaEcommerce.is_active = true`, `PedidoVentaEcommerce.deleted_at = null`. Estados como `CANCELADO`, `ANULADO` o `PAGO_RECHAZADO` pueden mostrarse si el registro sigue activo. E9 no salta el soft delete para exponer inactivos.
- **Fecha principal:** se ordena por `PedidoVenta.created_at DESC` (con desempate estable por ID) y se presenta como «Fecha del pedido». `fecha_pago_confirmado` no sustituye esa fecha; puede incorporarse en el futuro como dato adicional.
- **Estados y detalle:** se usan los nueve valores existentes de `EstadoEcommerce`, sin crear estados nuevos. El detalle presenta número, fecha del pedido, total, ítems (producto, SKU, talle, color, cantidad y precio congelado), estado actual y comprobante asociado; omite datos de Mercado Pago, logs, auditoría, datos cifrados e información operativa Pick & Pack.
- **QR de retiro:** HU-E12 ya genera `codigo_qr_retiro` y `plazo_retiro_vencimiento`; E9 solo los lee y genera `qr_data_url` server-side. Se expone exclusivamente para el detalle propio cuando el estado es `LISTO_PARA_RETIRO`, el token existe y el plazo es nulo o `>= ahora`. Si el plazo venció, E9 oculta el QR pero no cambia el estado; es una defensa de presentación hasta que HU-E13 transicione a `VENCIDO_SIN_RETIRO`. También se oculta antes y después del estado listo.
- **Secreto y caché:** el token literal nunca se devuelve como campo JSON, aparece en listados, logs o eventos, ni se guarda en `localStorage`/`sessionStorage`. La respuesta que contiene `qr_data_url` usa `Cache-Control: private, no-store`; las páginas evitan prerender y caché compartida. El QR solo codifica el token opaco y no contiene DNI, nombre, email, monto ni Mercado Pago. No se reutiliza el QR fiscal.
- **Comprobante:** HU-E9 no lo genera. El DTO público mínimo es `{ tipo, fecha_emision, monto }` y exige pedido propio WEB activo con comprobante asociado. No expone `cae_simulado`, `es_simulado`, QR fiscal ni IDs internos innecesarios; tampoco reutiliza `/api/ventas/comprobantes/[id]`. Mientras no exista un PDF/documento real, la UI muestra «Comprobante no disponible para descarga» y no ofrece enlaces inválidos.

**Responsabilidades entre HU:** HU-E8 ya autentica al Cliente Web y provee `sesion.clienteId`; HU-E12 ya genera token y plazo al transicionar a `LISTO_PARA_RETIRO`; HU-E9 solo lee historial/detalle y presenta el QR y metadatos mínimos del comprobante. HU-E3 valida QR + identidad y transiciona a `ENTREGADO`. HU-E13 implementa cancelación, vencimiento y sus transiciones. HU-E9 no valida QR, solicita DNI, transiciona pedidos, genera notificaciones ni emite eventos de lectura.

**DTO público contractual implementado (ejemplo de detalle listo):**
```json
{
  "id": "uuid", "numero": "V-2026-004821", "fecha": "2026-09-28T14:02:11.000Z",
  "total": 87000.00, "estado": "LISTO_PARA_RETIRO",
  "items": [ { "producto": "Campera táctica", "sku": "SKU-EJEMPLO", "talle": "L", "color": "Verde oliva", "cantidad": 1, "precio_unitario": 87000.00 } ],
  "plazo_retiro_vencimiento": "2026-10-02T14:02:11.000Z",
  "qr_data_url": "data:image/png;base64,...",
  "comprobante": { "tipo": "FACTURA_B", "fecha_emision": "2026-09-28T14:05:00.000Z", "monto": 87000.00 }
}
```

**Respuesta HTTP contractual `404 Not Found` (pedido ajeno o inexistente):**
```json
{ "data": null, "error": { "code": "PEDIDO_NO_ENCONTRADO", "message": "El pedido solicitado no existe" } }
```

**Criterios de aceptación verificables:**
1. Historial y detalle solo de pedidos propios WEB activos; pedido ajeno e inexistente responden el mismo 404.
2. Sesión E8 obligatoria: sin sesión 401; cuenta pendiente 403; identidad siempre desde `sesion.clienteId`.
3. Paginación por `page`/`page_size`, fecha principal `PedidoVenta.created_at` y navegación bajo `/tienda/cuenta/pedidos`.
4. QR ausente antes y después de `LISTO_PARA_RETIRO`; visible solo con token y plazo vigente/nulo; oculto tras vencer sin mutar el estado.
5. Token literal y datos Mercado Pago/Pick & Pack ausentes del contrato público, listados, logs, eventos y storage del navegador.
6. Respuestas con QR privadas y no cacheables; páginas sin prerender o caché compartida.
7. Comprobante reducido a `tipo`, `fecha_emision` y `monto`, sin descarga ficticia ni endpoint administrativo.
8. Sin cambios Prisma, migraciones o seed y sin mutaciones/eventos producidos por la lectura.

**Archivos implementados:**
- `src/lib/schemas/mis-pedidos.schema.ts` — validación estricta de `page`, `page_size` e ID.
- `src/lib/services/ecommerce/mis-pedidos.service.ts` — listado paginado, detalle, DTOs, soft delete, QR condicional y comprobante mínimo.
- `src/app/api/tienda/mis-pedidos/route.ts` y `src/app/api/tienda/mis-pedidos/[id]/route.ts` — Route Handlers autenticados por HU-E8.
- `src/app/api/tienda/mis-pedidos/http.ts` — mapper E9 y wrapper local `conCachePrivada`; HU-E8 no fue modificada.
- `src/app/(tienda)/tienda/cuenta/pedidos/page.tsx` y `src/app/(tienda)/tienda/cuenta/pedidos/[id]/page.tsx` — páginas RSC autenticadas.
- `src/components/ecommerce/MisPedidosListado.tsx`, `src/components/ecommerce/DetallePedidoWeb.tsx` y `src/components/tienda/AccesoPedidosCuenta.tsx` — superficie frontend.
- Suites: `mis-pedidos.schema.test.ts`, `mis-pedidos.service.test.ts`, `mis-pedidos.service.integration.test.ts`, `http.test.ts`, `mis-pedidos.test.tsx`, `hu-e9.http.integration.test.ts` y `hu-e9-e8-e12.integration.test.ts`.

**Estado de implementación:**
- **IMPLEMENTADA Y VERIFICADA:** sesión E8, historial propio, detalle, IDOR uniforme, soft delete, paginación, QR condicional, comprobante mínimo, páginas finales y caché privada.
- **DEPENDENCIAS RESUELTAS:** HU-E8 autentica; HU-E2 confirma el pago y dispara admisión; HU-E12 genera token/plazo reales.
- **FUERA DE ALCANCE/PENDIENTE DE OTRAS HU:** validación y entrega HU-E3; cancelación/vencimiento HU-E13; documento descargable real HU-E2/Módulo B.

**Persistencia:** HU-E9 no requirió cambios en `prisma/schema.prisma`, migraciones ni `prisma/seed.ts`.

**Evidencia final:** schemas 7 pass; servicio 16 pass; mapper HTTP 6 pass; componentes 6 pass; integración HTTP real 8 pass / 0 skipped; integración real E8/E2/E12/E9 6 pass / 0 skipped; TypeScript, ESLint, `git diff --check` y build Next.js exitosos.

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

### 2.11.a. Interfaces (Revisión 6 — HU-E11)

**Parámetro de ruta:** donde §2.11 escribe `[id]` se usa `[producto_web_id]`: HU-E5 ya creó ese segmento en la misma carpeta y Next.js no admite dos nombres de segmento dinámico en el mismo nivel. Es una aclaración, no un cambio de contrato.
**Server Actions:** no se implementaron (mismo desvío que §2.5.b y §2.7.a, a validar por el equipo): la pantalla `/ecommerce/catalogo` llama a los Route Handlers y lee el listado desde el Server Component.
**Permiso:** `ecommerce:gestionar_catalogo` vía `withPermission` en las cuatro rutas del backoffice; el actor sale de la sesión.

| Método | Ruta | Body | Éxito |
|---|---|---|---|
| POST | `/api/ecommerce/catalogo` | `{ producto_maestro_id, titulo_comercial, descripcion }` | 201 `{ producto_web_id, producto_maestro_id, visibilidad_web: false }` |
| PATCH | `/api/ecommerce/catalogo/[producto_web_id]` | `{ titulo_comercial?, descripcion? }` (al menos uno) | 200 `{ producto_web_id, titulo_comercial, descripcion, visibilidad_web }` |
| POST | `/api/ecommerce/catalogo/[producto_web_id]/fotos` | `multipart/form-data`: `archivo` (File, único) y `es_principal` opcional (`"true"`/`"false"`) | 201 `{ foto_id, producto_web_id, url, es_principal, orden, is_active, deleted_at }` |
| PATCH | `/api/ecommerce/catalogo/[producto_web_id]/fotos/[foto_id]` | `{ es_principal: true }` **o** `{ deletion_reason }` | 200 con la foto en su estado final |
| GET | `/api/tienda/fotos/[archivo]` (público, sin sesión) | — | la imagen |
| GET | `/api/tienda/catalogo` (ampliado) | query `q`, `categoria`, `talle`, `color`, `genero`, `modelo`, `orden`, `page`, `page_size` | 200, formato de E1 + bloque `filtros` |

La baja lógica del contenido **no** es una ruta nueva: es `PATCH …/[producto_web_id]/baja` de HU-E5 (`darDeBajaContenidoWeb()`), reutilizada sin cambios.

```typescript
// src/lib/schemas/ecommerce.schema.ts — bodies estrictos (campo extra → 400), textos con trim
export const CrearContenidoWebSchema = z.object({
  producto_maestro_id: z.string().uuid(),
  titulo_comercial: z.string().trim().min(1),
  descripcion: z.string().trim().min(1),
}).strict();
export const EditarContenidoWebSchema = z.object({
  titulo_comercial: z.string().trim().min(1).optional(),
  descripcion: z.string().trim().min(1).optional(),
}).strict().refine((v) => v.titulo_comercial !== undefined || v.descripcion !== undefined);
// Desvío de §2.11: además de una URL absoluta acepta una ruta que empieza con "/"
// (el Adapter local guarda `/api/tienda/fotos/<uuid>.<ext>`). Valida el resultado
// YA resuelto por el Gateway, nunca lo que manda el cliente.
export const SubirFotoProductoSchema = z.object({
  url: z.union([z.string().url(), z.string().regex(/^\/(?!\/)\S+$/)]),
  es_principal: z.boolean().default(false),
});
// Exactamente una operación (equivale a un union de dos objetos estrictos).
export const ActualizarFotoWebSchema = z.object({
  es_principal: z.literal(true).optional(),
  deletion_reason: z.string().trim().min(1).optional(),
}).strict().superRefine(/* exactamente una de las dos */);
```

### 2.11.b. Almacenamiento de fotos (Revisión 6 — HU-E11)

§5 dejaba el mecanismo fuera de alcance; sin recibir el archivo no se pueden validar formato ni tamaño (criterio 2), así que HU-E11 lo resuelve con un **Gateway de almacenamiento de imágenes** propio del dominio (`almacenamiento-imagenes.gateway.ts`, Regla N.° 3) y un **Adapter de disco local** (`almacenamiento-imagenes.local.adapter.ts`). Pendiente de validar con el equipo.

- El servidor valida el **formato real por firma de bytes** (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`), nunca por la extensión ni por el `Content-Type` del cliente, y el **tamaño real** (`validacion-imagen.ts`, puro).
- El directorio sale de `CATALOGO_FOTOS_DIR` (relativo al proceso o absoluto); sin valor por defecto: si falta, las rutas de fotos responden 500. El nombre lo genera el servidor (`randomUUID()` + extensión del formato detectado); el nombre que manda el cliente nunca se usa. La escritura no sobrescribe (`wx`).
- `ProductoWebFoto.url` guarda la ruta relativa `/api/tienda/fotos/<uuid>.<ext>`.
- Ruta pública `GET /api/tienda/fotos/[archivo]`: `archivo` debe cumplir `^<uuid>\.(jpg|png|webp)$` y la ruta resuelta debe quedar dentro del directorio (sin path traversal); `Content-Type` por extensión, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, sin sesión. No consulta la base: una foto dada de baja se sigue sirviendo (contenido comercial, nombre no adivinable; la tienda deja de referenciarla).
- **Tope de memoria del multipart:** los Route Handlers no tienen límite de body por defecto. Antes de parsear, un `Content-Length` mayor que máximo + 64 KB responde 422 sin leer el cuerpo (con `Connection: close`); sin `Content-Length` se lee el stream con ese tope. El tamaño real del archivo se valida igual.
- **Archivos físicos:** nunca se borran (política del módulo coherente con la baja lógica). Si la transacción falla después de guardar, el archivo queda huérfano y se registra en el log (solo el nombre generado); la limpieza queda pendiente (§5).
- Un proveedor en la nube (S3, Vercel Blob u otro) es un Adapter nuevo, sin cambios en el dominio.

### 2.11.c. Configuración (Revisión 6 — HU-E11)

Tres claves nuevas de módulo `E`, sembradas con `upsert` y `update: {}`, con getter tipado en `configuracion.service.ts` que falla con `CONFIGURACION_INVALIDA` ante un valor inválido. Valores pendientes de validar con el PO; `spec_modulo_D.md` §6.2 no se edita desde acá.

| Clave | Valor sembrado | Getter |
|---|---|---|
| `ECOMMERCE_FOTOS_MAX_POR_PRODUCTO` | `8` | `obtenerFotosMaxPorProducto()` — entero positivo |
| `ECOMMERCE_FOTO_TAMANO_MAX_MB` | `5` | `obtenerFotoTamanoMaxBytes()` — entero positivo × 1024 × 1024 |
| `ECOMMERCE_FOTO_FORMATOS_PERMITIDOS` | `JPG,PNG,WEBP` | `obtenerFotoFormatosPermitidos()` — CSV, subconjunto no vacío de JPG/PNG/WEBP |

### 2.11.d. Reglas de contenido y fotos (Revisión 6 — HU-E11)

- **Alta:** una fila por Producto Maestro; el Producto Maestro debe existir y estar activo (si no, `404 PRODUCTO_MAESTRO_NO_ENCONTRADO`). Si ya hay contenido, **activo o dado de baja**, `409 CONTENIDO_WEB_EXISTENTE` (sin reactivación; dos altas concurrentes: una 201 y una 409 por el índice único). Nace con `visibilidad_web = false`; mostrarlo es la operación de §2.5.
- **Edición:** solo `titulo_comercial` y/o `descripcion`; un contenido dado de baja responde `404 PRODUCTO_WEB_NO_ENCONTRADO`. Pedir los valores actuales es un no-op (200 sin UPDATE ni evento).
- **Fotos:** toda operación toma `SELECT … FOR UPDATE` sobre la fila del contenido activo, que serializa las subidas concurrentes y los cambios de principal (no hay índice parcial en la base). Como máximo N fotos **activas** (una baja libera un lugar; N+1 subidas en paralelo dejan exactamente N). Cada foto nueva va al final (`orden` = máximo activo + 1). La primera foto activa queda principal; `es_principal = true` en la subida o en el PATCH desmarca la anterior en la misma transacción. Dar de baja la principal promueve a la activa de menor `orden`. Marcar como principal la que ya lo es: no-op.
- **Baja de foto:** `is_active = false`, `deleted_at`, `deleted_by` (actor), `deletion_reason` obligatorio. Una foto ya dada de baja, inexistente o de otro contenido responde `404 FOTO_WEB_NO_ENCONTRADA`. Las fotos no se dan de baja en cascada al dar de baja el contenido (quedan inaccesibles: toda operación exige contenido activo). Dar de baja la última foto de un contenido visible no avisa a los carritos (§2.1 solo lo pide al ocultar o dar de baja el contenido; el checkout ya bloquea con `ARTICULO_NO_DISPONIBLE`).
- **Modelo:** `ProductoWebFoto` agrega `updated_at DateTime @default(now()) @updatedAt` (faltaba según RULES Regla 1). Migración aditiva `20261004211846_hu_e11_foto_web_updated_at`: una sola columna `NOT NULL DEFAULT CURRENT_TIMESTAMP`.
- **Independencia (criterio 6):** ninguna operación lee ni escribe `VarianteSKU`, `StockDeposito`, `Reserva` ni Módulo B; el Producto Maestro solo se lee para validar el alta.

### 2.11.e. Publicación y detalle (Revisión 6 — HU-E11)

- `evaluarComprabilidad()` y `whereContenidoPublicado` (HU-E1) ya exigían foto activa, descripción, precio vigente y `visibilidad_web = true`: **no se modificaron**. Matiz documentado: un producto visible, con foto y descripción pero sin ningún SKU con precio vigente **se lista** y su detalle se muestra como "No disponible para la compra" (lo exige `hu-e1.integration.test.ts`); no aparece como comprable, que es la definición de "publicado" de §2.11. Una descripción de solo espacios no puede nacer por el alta ni la edición (`trim().min(1)`).
- El detalle de HU-E1 ya cumplía el criterio 4 (todas las fotos activas con la principal primero, descripción, precio vigente por variante y selector con disponibilidad leída en cada request). Sin cambios; verificado con tests.

### 2.11.f. Listado de la tienda (Revisión 6 — HU-E11)

- `ListarCatalogoQuerySchema` suma `talle`, `color`, `genero`, `modelo` (texto, `trim`, ≤ 100) y `orden` (`novedad` por defecto, `precio_asc`, `precio_desc`) a `q`, `categoria` y la paginación de E1. Sin `.strict()`: los parámetros extra se ignoran. Un valor inexistente de categoría/talle/color/género/modelo devuelve lista vacía; solo `orden`, `page`, `page_size` o un largo inválido dan `400 VALIDATION_ERROR`.
- Los filtros se resuelven contra `ProductoMaestro.categoria` y `VarianteSKU.talle/color/genero/modelo` reales. Los de variante los debe cumplir **una misma variante comprable** (`talle=M&color=Rojo` exige una variante M y Roja).
- `novedad`: `created_at` del contenido descendente. `precio_asc`/`precio_desc`: precio vigente más bajo entre las variantes comprables (HU-B9); los productos sin precio van al final en ambos sentidos; desempate `created_at desc`, `id`.
- Respuesta: el formato de E1 más `filtros: { categorias, talles, colores, generos, modelos }`, calculados sobre **todo** el catálogo publicado y comprable (no se acotan por los filtros activos), ordenados alfabéticamente.
- Implementación: una pasada liviana (ids, atributos y `created_at` de los contenidos publicados, sin descripción) + una sola llamada a `resolverPreciosVentaVigentes()` (vía única de HU-B9) + filtro, orden y paginación en memoria; solo la página se hidrata con `resolverVariantesWeb()` (stock en tiempo real). Sin N+1. **Limitación:** ids, atributos y precios del catálogo publicado se cargan en memoria por request.

### 2.11.g. Errores (Revisión 6 — HU-E11)

`{ data: null, error: { code, message } }`, mapeados en `respuesta-catalogo.ts` (backoffice):

| Status | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | id no UUID; body no objeto; campo extra; textos vacíos; PATCH de foto con ambas operaciones o ninguna; multipart ausente, sin `archivo`, con `archivo` repetido o de texto, `es_principal` inválido o campo extra; `orden`/`page`/`page_size`/largo inválido en el listado |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` | sin sesión / sin `ecommerce:gestionar_catalogo` |
| 404 | `PRODUCTO_WEB_NO_ENCONTRADO` | contenido inexistente o dado de baja |
| 404 | `PRODUCTO_MAESTRO_NO_ENCONTRADO` | Producto Maestro inexistente o inactivo en el alta |
| 404 | `FOTO_WEB_NO_ENCONTRADA` | foto inexistente, de otro contenido o dada de baja; en la ruta pública, nombre inválido o archivo inexistente |
| 409 | `CONTENIDO_WEB_EXISTENTE` | ya hay contenido (activo o dado de baja) para ese Producto Maestro |
| 409 | `LIMITE_FOTOS_ALCANZADO` | ya hay N fotos activas |
| 422 | `ARCHIVO_VACIO` / `ARCHIVO_DEMASIADO_GRANDE` / `FORMATO_IMAGEN_NO_ADMITIDO` | archivo de 0 bytes / mayor al máximo (real o por tope del cuerpo) / firma no reconocida o formato no habilitado |
| 500 | `INTERNAL_ERROR` | inesperado; configuración de fotos ausente o inválida; falta `CATALOGO_FOTOS_DIR` |

### 2.12. Cola de preparación y entrega Click & Collect (HU-E12)

**Revisión 7 — lectura obligatoria antes de los pasajes históricos siguientes:** la implementación E12 termina en `LISTO_PARA_RETIRO`; su ruta real es `/api/ecommerce/preparacion/**`. Toda referencia inferior a `/app/api/ecommerce/pick-pack/[id]/validar-retiro`, a `ValidarRetiroSchema` con `codigo_qr`/`dni_receptor`, a `422 QR_INVALIDO`, a la entrega como responsabilidad E12 o a la generación de notificación F3 ya operativa queda **sustituida por 2.3.b–2.3.d**. Las rutas/verbos de preparación escritos en la Revisión 1 son diseño histórico; consultar las rutas reales de E12 al implementar. E12 conserva la emisión del evento `pedido_listo_para_retiro`; E3 completa únicamente su payload de destinatario y la suscripción F3.

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
- **Completar preparación → QR (criterio de aceptación explícito):** al confirmar todos los ítems, `PATCH /completar` transiciona `estado_ecommerce → LISTO_PARA_RETIRO`, genera `codigo_qr_retiro` (token único, no reutilizable entre pedidos) y dispara el evento que HU-F3 consume para notificar al cliente; HU-E9 solo lee y presenta el QR.
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

### 2.13. Cancelación y vencimiento de pedidos pagados (HU-E13)

#### Revisión 3 — propuesta para revisión

Esta revisión sustituye íntegramente las Revisiones 1 y 2 de §2.13 y, únicamente para HU-E13, prevalece sobre las referencias históricas incompatibles de §2.2, §2.12, §3.1, §3.6, §4 y §5. Conserva D1–D17 y R1–R22, y ajusta exclusivamente stock multi-item, historial de intentos de refund, contrato F1 y constraints de Nota de Crédito. No constituye PLAN ni TASKS.

##### 2.13.1. Máquina de estados E y correspondencia con B

| Operación | Estado E de origen | Estado E final | Estado B antes/después | QR |
|---|---|---|---|---|
| Pago aprobado E2 | `PAGO_PENDIENTE` | `PAGO_CONFIRMADO` | `RESERVADO → FACTURADO` | sin cambio |
| Operador toma/inicia E12 | `PAGO_CONFIRMADO` | `EN_PREPARACION` | `FACTURADO`, sin cambio | sin cambio |
| Completar preparación E12 | `EN_PREPARACION` | `LISTO_PARA_RETIRO` | `FACTURADO`, sin cambio | genera `codigo_qr_retiro` y plazo |
| Cancelación por Cliente Web | solo `PAGO_CONFIRMADO` | `CANCELADO` | `FACTURADO`, sin cambio | `null` |
| Cancelación administrativa | `PAGO_CONFIRMADO`, `EN_PREPARACION` o `LISTO_PARA_RETIRO` | `CANCELADO` | `FACTURADO`, sin cambio | `null` |
| Vencimiento automático | solo `LISTO_PARA_RETIRO`, con `plazo_retiro_vencimiento < ahora` | `VENCIDO_SIN_RETIRO` | `FACTURADO`, sin cambio | `null` |
| Retiro E3 | `LISTO_PARA_RETIRO`, sin plazo vencido | `ENTREGADO` | transición comercial vigente de E3 hasta `CERRADO` | `null` |

`CANCELADO`, `VENCIDO_SIN_RETIRO` y `ENTREGADO` son terminales para E. No se admite cancelación desde `ENTREGADO`, `CANCELADO`, `VENCIDO_SIN_RETIRO`, `ANULADO` ni `PAGO_RECHAZADO`. HU-E13 no agrega estados a B y nunca ejecuta `FACTURADO → ANULADO`: la factura y `PedidoVenta.estado = FACTURADO` conservan la historia fiscal; la reversión se representa por hechos compensatorios nuevos.

**Contrato R1–R2 sobre E2/E12:** confirmar el pago persiste `PAGO_CONFIRMADO` e ingresa el pedido inmediatamente a la cola Pick & Pack, sin cambiarlo a `EN_PREPARACION`. La consulta de cola muestra `PAGO_CONFIRMADO` no tomado y `EN_PREPARACION` ya tomado, excluyendo siempre estados terminales e extensiones inactivas. El evento/notificación de nuevo pedido en cola se emite después del pago y no depende de adelantar el estado. Tomar/iniciar es una única operación atómica que, bajo los locks de §2.13.8, ejecuta conjuntamente `PAGO_CONFIRMADO → EN_PREPARACION` y asigna `operador_asignado_id`; nunca puede quedar `EN_PREPARACION` sin operador ni operador asignado en `PAGO_CONFIRMADO`. Completar o escanear preparación exige `EN_PREPARACION`.

##### 2.13.2. Cancelación por Cliente Web y por Administrador

**Rutas públicas de contrato:**

| Actor | Método y ruta | Autorización | Estados admitidos |
|---|---|---|---|
| Cliente Web | `PATCH /api/tienda/mis-pedidos/[id]/cancelar` | `withSesionClienteWeb`; el pedido debe pertenecer a `sesion.clienteId` | solo `PAGO_CONFIRMADO` |
| Administrador E-commerce | `PATCH /api/ecommerce/pedidos/[id]/cancelar` | sesión interna + `ecommerce:cancelar_pedido_pagado` | `PAGO_CONFIRMADO`, `EN_PREPARACION`, `LISTO_PARA_RETIRO` |

Ambas rutas reciben exclusivamente:

```typescript
const CancelarPedidoPagadoSchema = z.object({
  motivo: z.string().trim().min(1, "El motivo es obligatorio"),
}).strict();
```

El actor, `deleted_by` y alcance de propiedad nunca salen del body. La cancelación real aplica baja lógica a `PedidoVentaEcommerce` (`is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason = motivo`) y mantiene `estado_ecommerce = CANCELADO`. No desactiva `PedidoVenta`, no edita ni anula la factura y no elimina ítems, movimientos, pagos, comprobantes o registros del reintegro.

La respuesta exitosa representa el snapshot durable alcanzado y no promete que Mercado Pago ya haya aprobado el refund. Los IDs de pasos aún no completados son `null`:

```json
{
  "data": {
    "pedido_venta_id": "uuid",
    "estado_ecommerce": "CANCELADO",
    "reintegro_id": "uuid",
    "estado_reintegro": "PENDIENTE",
    "nota_credito_id": null
  },
  "error": null
}
```

> **Addendum post-T17:** para la ruta Cliente Web, este ejemplo queda sustituido por el contrato público de §2.13.16.4.

Una repetición sobre el mismo pedido devuelve `200` con los mismos identificadores y estado persistido, sin duplicar efectos. Un estado origen no autorizado responde `409 TRANSICION_INVALIDA`; pedido inexistente, ajeno, no WEB o no operable responde `404 PEDIDO_NO_ENCONTRADO` sin revelar existencia; motivo inválido responde `400 VALIDATION_ERROR`; falta de sesión/permiso interno responde `401/403`.

##### 2.13.3. Vencimiento automático y recordatorio

El mantenimiento compartido de §2.13.10 selecciona extensiones activas en `LISTO_PARA_RETIRO`:

- **recordatorio:** cuando `ahora >= plazo_retiro_vencimiento - ECOMMERCE_RECORDATORIO_RETIRO_HORAS` y todavía `ahora <= plazo_retiro_vencimiento`, emite `ecommerce:plazo_retiro_por_vencer` con una clave de origen estable derivada de `pedido_venta_id + plazo_retiro_vencimiento`; `Notificacion.clave_idempotencia` impide repetirlo. No se agrega columna de “recordatorio enviado”.
- **vencimiento:** solo cuando `plazo_retiro_vencimiento < ahora`; igualdad exacta todavía no está vencida. Bajo lock y transición condicionada cambia E a `VENCIDO_SIN_RETIRO`, consume el QR, aplica baja lógica con motivo estable `Plazo de retiro vencido`, y crea/reutiliza el mismo flujo de reintegro de una cancelación.

El recordatorio se dirige a la cuenta del Cliente Web operable. Cancelación y vencimiento generan notificación interna F3 para la cuenta operable y para el rol `ADMINISTRADOR_ECOMMERCE`. No se introducen email, SMS, WhatsApp ni otros canales externos.

> **Addendum post-T17:** los destinatarios de cancelación y vencimiento quedan sustituidos por §2.13.16.1: únicamente la cuenta del Cliente Web operable; ninguna notificación HU-E13 al rol `ADMINISTRADOR_ECOMMERCE`.

##### 2.13.4. Restitución de stock multi-item — contrato requerido de Módulo A

Módulo E nunca escribe directamente `StockDeposito`, `Reserva`, `MovimientoStock` ni `MovimientoStockItem`. Al crear la cabecera de saga genera una fila hija por cada `PedidoVentaItem` activo, congelando item, SKU, depósito y cantidad total vendida que debe restituirse:

```prisma
model ReintegroStockCompensacion {
  id                    String  @id @default(uuid())
  reintegro_id          String
  pedido_venta_item_id  String
  variante_sku_id       String
  deposito_id           String
  cantidad              Int
  clave_idempotencia    String  @unique
  movimiento_stock_id   String? @unique
  created_at            DateTime @default(now())
  completed_at          DateTime?

  reintegro             ReintegroPedidoWeb @relation(fields: [reintegro_id], references: [id], onDelete: Restrict)
  pedido_venta_item     PedidoVentaItem     @relation(fields: [pedido_venta_item_id], references: [id], onDelete: Restrict)
  movimiento_stock      MovimientoStock?    @relation(fields: [movimiento_stock_id], references: [id], onDelete: Restrict)

  @@unique([reintegro_id, pedido_venta_item_id])
  @@index([reintegro_id])
}
```

La clave estable es `HU-E13:STOCK:<pedido_venta_id>:<pedido_venta_item_id>`; identifica la operación E13 sobre esa línea aunque dos líneas compartan SKU. Módulo A expone una operación transaccional por compensación que recibe esa clave, item/SKU, depósito, cantidad, actor y motivo, y registra un movimiento inmutable:

```text
VENDIDO → DISPONIBLE
```

Cada ejecución retorna `CREADO { movimiento_stock_id } | YA_EXISTENTE { movimiento_stock_id }`. La unicidad de `clave_idempotencia` en la operación de A —además de la fila hija de E— cierra el crash entre aplicar stock y vincular el movimiento. El retry recorre las hijas sin `movimiento_stock_id`, recupera movimientos existentes y ejecuta solo faltantes; una hija completada nunca vuelve a incrementar stock. La etapa stock de la saga se considera completa únicamente cuando todas las compensaciones esperadas tienen `movimiento_stock_id` y `completed_at`.

Un pedido multi-item puede producir varios `MovimientoStock`, uno por línea compensada. La cabecera `ReintegroPedidoWeb` no guarda un `stock_movimiento_id` único. `liberarReservasTx()` no satisface este contrato porque solo opera `RESERVADO → DISPONIBLE` sobre reservas abiertas.

**Dependencia inter-módulo para revisión:** esta transición todavía no existe en el contrato vigente de Módulo A. R9 la exige y es compatible con la inmutabilidad de inventario si se implementa como movimiento compensatorio idempotente; HU-E13 queda bloqueada hasta que el owner de A acepte el contrato y su persistencia por clave.

##### 2.13.5. Nota de Crédito vinculada

La factura original es inmutable. HU-E13 admite exclusivamente reintegro **total**: no contempla montos parciales, selección de ítems ni múltiples devoluciones. Módulo B debe exponer una operación transaccional idempotente que cree una nueva `ComprobanteFiscal` de tipo `NOTA_CREDITO`, por exactamente el total efectivamente cobrado y facturado, con `comprobante_original_id` obligatorio apuntando al comprobante fiscal original del pedido. La Nota de Crédito conserva CAE/QR simulados bajo las mismas reglas de HU-B7 y nunca actualiza o desactiva el original.

Persistencia mínima prevista:

```prisma
enum TipoComprobanteVenta {
  FACTURA_A
  FACTURA_B
  TICKET
  NOTA_CREDITO
}

model ComprobanteFiscal {
  // campos vigentes
  comprobante_original_id String?
  comprobante_original    ComprobanteFiscal?  @relation("ReversionFiscal", fields: [comprobante_original_id], references: [id], onDelete: Restrict)
  notas_credito           ComprobanteFiscal[] @relation("ReversionFiscal")

  @@index([comprobante_original_id])
}
```

Para `NOTA_CREDITO`, `comprobante_original_id` es obligatorio a nivel de servicio; para factura/ticket debe ser `null`. El vínculo es inmutable, pero **no** es globalmente único: un comprobante original podría admitir en el futuro otras NC fiscales ajenas a HU-E13. La unicidad específica de esta historia se garantiza por `ReintegroPedidoWeb.pedido_venta_id @unique` —una saga por pedido— y `ReintegroPedidoWeb.nota_credito_id @unique` —una NC no puede pertenecer a dos reintegros—, más la validación de que esa NC sea `NOTA_CREDITO`, pertenezca al pedido y apunte a su comprobante original. El servicio B usa la clave estable `HU-E13:NC:<pedido_venta_id>` o una persistencia equivalente propia de B para crear/recuperar exactamente la NC de HU-E13; no deduce idempotencia de que el original tenga cualquier otra NC.

##### 2.13.6. Modelo persistente y máquina durable de la saga

HU-E13 agrega una única intención durable por pedido y pago. La fila se crea en la misma transacción que gana la transición E y **antes de cualquier llamada externa**. Sus marcadores permiten reconocer cada paso local incompleto sin depender de logs:

```prisma
enum EstadoReintegroPedidoWeb {
  PENDIENTE
  APROBADO
  RECHAZADO
}

enum TipoActorReintegro {
  CLIENTE_WEB
  USUARIO
  SISTEMA
}

model ReintegroPedidoWeb {
  id                          String                    @id @default(uuid())
  pedido_venta_id             String                    @unique
  mercadopago_payment_id      String                    @unique
  estado                      EstadoReintegroPedidoWeb  @default(PENDIENTE)
  monto_total                 Decimal                   @db.Decimal(12, 2)
  motivo                      String
  solicitado_por_tipo         TipoActorReintegro
  solicitado_por_id           String?
  nota_credito_id             String?                   @unique
  contra_asiento_ingreso_id   String?                   @unique
  intento_aprobado_id         String?                   @unique
  ultimo_error_codigo         String?
  proximo_reintento_at        DateTime?
  resuelto_at                 DateTime?
  created_at                  DateTime                  @default(now())
  updated_at                  DateTime                  @updatedAt

  compensaciones_stock        ReintegroStockCompensacion[]
  intentos_refund             ReintegroRefundIntento[]  @relation("IntentosRefund")
  intento_aprobado            ReintegroRefundIntento?   @relation("IntentoRefundAprobado", fields: [intento_aprobado_id], references: [id], onDelete: Restrict)
}

enum EstadoIntentoRefund {
  PENDIENTE
  APROBADO
  RECHAZADO
}

enum OrigenIntentoRefund {
  INICIAL
  REINTENTO_MANUAL
}

model ReintegroRefundIntento {
  id                    String               @id @default(uuid())
  reintegro_id          String
  numero                Int
  origen                OrigenIntentoRefund
  clave_idempotencia    String               @unique
  estado                EstadoIntentoRefund  @default(PENDIENTE)
  refund_id             String?              @unique
  error_codigo          String?
  motivo_reintento      String?
  creado_por_id         String?
  intentos_tecnicos     Int                  @default(0)
  ultimo_intento_at     DateTime?
  resuelto_at           DateTime?
  created_at            DateTime             @default(now())
  updated_at            DateTime             @updatedAt

  reintegro             ReintegroPedidoWeb   @relation("IntentosRefund", fields: [reintegro_id], references: [id], onDelete: Restrict)
  aprobado_para         ReintegroPedidoWeb?  @relation("IntentoRefundAprobado")

  @@unique([reintegro_id, numero])
  @@index([reintegro_id, estado])
}
```

La cabecera es histórica, única por pedido/pago y nunca se elimina. `nota_credito_id`, todas las `compensaciones_stock` completas y `contra_asiento_ingreso_id` determinan el progreso local sin depender de logs. El refund tiene historial 1:N: cada intento lógico conserva su propia clave, resultado y evidencia; nunca se sobrescribe un rechazo anterior.

Máquina durable de cabecera:

- `PENDIENTE`: pasos locales incompletos, intento refund pendiente o reintento manual habilitado en curso.
- `APROBADO`: exactamente un intento hijo aprobado está enlazado por `intento_aprobado_id`; terminal y no admite otro intento.
- `RECHAZADO`: el último intento lógico recibió rechazo remoto definitivo; detiene retries automáticos, permanece visible y admite únicamente la acción administrativa de §2.13.7 para crear un intento lógico posterior.

Máquina de cada intento hijo:

- `PENDIENTE`: admite retries **técnicos** con la misma `clave_idempotencia`.
- `APROBADO`: guarda `refund_id`; terminal.
- `RECHAZADO`: conserva rechazo y clave; terminal, nunca se reutiliza como nuevo intento lógico.

`ultimo_error_codigo`/`error_codigo` no contienen credenciales, payload completo de MP ni PII. El lock de cabecera, la condición `intento_aprobado_id IS NULL` y su unicidad impiden crear un intento manual después de una aprobación o enlazar dos refunds aprobados al mismo pedido.

##### 2.13.7. Orden exacto de la saga, crashes y fallas parciales

No existe ni se afirma atomicidad entre PostgreSQL y Mercado Pago. La saga avanza en el siguiente orden estricto; cada paso relee la cabecera y sus hijas, omite hechos completos y usa una transacción local corta:

0. **Ganar la operación y crear intención:** bajo los locks de §2.13.8, validar actor/estado y ejecutar la transición condicionada E a `CANCELADO` o `VENCIDO_SIN_RETIRO`; consumir QR; aplicar baja lógica; insertar `ReintegroPedidoWeb(PENDIENTE)` y todas las `ReintegroStockCompensacion` esperadas. Todo ocurre en un commit PostgreSQL antes de cualquier llamada externa. La unicidad pedido/pago recupera la misma cabecera en una repetición.
1. **Nota de Crédito total:** si `nota_credito_id` es nulo, B crea o recupera la NC HU-E13 por su clave estable y luego la vincula mediante update condicionado.
2. **Stock multi-item:** recorrer en orden estable las compensaciones sin movimiento; A crea o recupera cada `VENDIDO → DISPONIBLE` por la clave de la hija y se vincula el ID. Avanza aunque otras líneas ya estén completas; F1 queda bloqueado hasta completar todas.
3. **Contra-asiento:** si `contra_asiento_ingreso_id` es nulo, G11 devuelve `CREADO`, `YA_EXISTENTE` o `INGRESO_ORIGINAL_NO_ENCONTRADO`. Los dos primeros vinculan el mismo ID. El tercero deja cabecera `PENDIENTE`, persiste diagnóstico y programa retry; no revierte E, NC ni stock.
4. **Crear/recuperar intento refund:** solo con NC, todas las compensaciones y G11 completos. Si no existe intento hijo `PENDIENTE`, crear el primero con `numero = 1` y clave estable `HU-E13:REFUND:<pedido_venta_id>:<mercadopago_payment_id>:1`. La fila se confirma antes de llamar a F1.
5. **Refund total F1:** llamar fuera de toda transacción DB a `POST /v1/payments/{id}/refunds`, sin body parcial, enviando exactamente `X-Idempotency-Key: <intento.clave_idempotencia>`.
6. **Resultado remoto:** aprobado marca hijo `APROBADO`, guarda `refund_id` y enlaza atómicamente `intento_aprobado_id`, dejando cabecera `APROBADO`. Rechazo remoto definitivo marca hijo y cabecera `RECHAZADO`, audita y detiene retry automático. Timeout, red, rate limit, indisponibilidad o resultado incierto conservan hijo/cabecera `PENDIENTE` y programan retry técnico.

Persistencia observable ante cada crash:

| Punto de crash | Estado durable | Continuación idempotente |
|---|---|---|
| antes del commit 0 | E sin cambio; no existe saga | repetir operación completa |
| después del commit 0 | E terminal; cabecera `PENDIENTE`; hijas stock esperadas; pasos sin completar | comenzar por NC; no reabrir E |
| después de crear NC y antes de vincular | NC HU-E13 única existente; ID de cabecera puede ser nulo | recuperar por clave HU-E13 y vincular |
| entre líneas de stock | algunas hijas tienen movimiento y otras no | reutilizar completas y ejecutar solo hijas faltantes |
| después de aplicar una línea y antes de vincular | movimiento A existente; hija todavía nula | recuperar por clave de esa hija y vincular sin incrementar otra vez |
| con ingreso G11 ausente | E/NC/stock persistidos; contra-asiento nulo | retry de saga; no llamar F1 |
| después del contra-asiento y antes de vincular | contra-asiento único existente; campo nulo | G11 devuelve `YA_EXISTENTE`; vincular |
| después de crear intento y antes de F1 | hijo `PENDIENTE` con clave persistida | llamar F1 con esa clave |
| durante F1 o después de MP y antes de guardar | hijo `PENDIENTE`; resultado incierto | retry técnico con exactamente la misma clave |
| después de guardar rechazo definitivo | hijo y cabecera `RECHAZADO`; evidencia intacta | sin retry automático; queda habilitada acción manual |
| después de guardar aprobación | hijo/cabecera `APROBADO`, `intento_aprobado_id` y `refund_id` | no crear ni ejecutar otro intento |

**Retry técnico vs reintento manual:** timeout, red y resultado incierto nunca crean un hijo: incrementan `intentos_tecnicos` del intento `PENDIENTE` y reutilizan exactamente su clave. Un rechazo remoto definitivo cierra ese hijo. Luego, exclusivamente un Administrador E-commerce con `ecommerce:cancelar_pedido_pagado` puede ejecutar `POST /api/ecommerce/pedidos/[id]/reintegro/reintentar` con body estricto `{ motivo: string no vacío }`. Bajo lock de cabecera, la creación exige `estado = RECHAZADO`, `intento_aprobado_id = null` y ningún hijo `PENDIENTE`; crea un hijo `origen = REINTENTO_MANUAL` con `numero = max + 1`, nueva clave estable terminada en ese número, `motivo_reintento` y `creado_por_id`, conserva todos los hijos anteriores, cambia cabecera a `PENDIENTE`, audita y puede continuar la saga. Si la request se repite tras perder la respuesta y la cabecera ya está `PENDIENTE`, devuelve el último hijo manual pendiente sin crear otro; cualquier otro `PENDIENTE` responde `409 REINTEGRO_EN_PROCESO`. No existe acción manual después de `APROBADO`.

NC, cada compensación de stock y contra-asiento tienen unicidad propia y contrato `CREADO | YA_EXISTENTE`; el vínculo en E no es la única defensa. Los eventos de cancelación/vencimiento se emiten post-commit 0; cada rechazo, reintento manual y aprobación emite evento sensible post-commit. Un fallo de listener no revierte dominio.

**Contrato F1 cerrado:** Mercado Pago soporta y requiere `X-Idempotency-Key` en `POST /v1/payments/{id}/refunds`. Para HU-E13, F1 debe recibir la clave del intento persistido y enviarla literalmente en ese header. Todo retry técnico del mismo intento usa la misma clave; solo la acción manual posterior a un rechazo definitivo crea otro intento lógico y otra clave. La garantía remota de no duplicación se apoya en este contrato de MP, no solamente en la BD local.

##### Addendum posterior a Revisión 3 — política temporal congelada de retry

Este addendum aclara exclusivamente la programación temporal de los intentos ya definidos; no agrega estados, permisos, entidades ni variantes de idempotencia.

1. **Error técnico:** `TIMEOUT`, `RED`, `HTTP_429`, `HTTP_5XX` y `RESPUESTA_AMBIGUA` conservan el mismo `ReintegroRefundIntento`, `numero` y `clave_idempotencia`, e incrementan `intentos_tecnicos` en uno. Sea `n` el valor posterior al incremento: `delay_minutos = min(5 * 2^(n - 1), 360)` y `proximo_reintento_at = ahora + delay_minutos`. La secuencia es `5, 10, 20, 40, 80, 160, 320, 360, 360...`, sin jitter ni máximo de intentos técnicos. La cantidad de retries nunca cambia el intento o la cabecera a `RECHAZADO`.
2. **Respuesta remota `PENDING`:** intento y cabecera permanecen `PENDIENTE`, no se incrementa `intentos_tecnicos`, se fija `proximo_reintento_at = ahora + 15 minutos` y la próxima ejecución reutiliza la misma fila y clave.
3. **Creación durable:** al crear y confirmar cualquier intento `PENDIENTE`, tanto `INICIAL` como `REINTENTO_MANUAL`, se fija `proximo_reintento_at = ahora` antes de llamar F1. Así, un crash después del commit y antes o durante HTTP deja el mismo intento inmediatamente recuperable.
4. **Resultado terminal:** `APROBADO` y `RECHAZADO` fijan `proximo_reintento_at = null`.
5. **HTTP definitivo:** HTTP `400`, `401`, `403` y `404` se mapean a `RECHAZADO`, con diagnóstico seguro, sin retry automático y sin revertir efectos locales; queda habilitado el reintento manual posterior. HTTP `429` y todo HTTP `5xx` permanecen técnicos/reintentables.
6. **Selector automático T12:** solo es elegible una cabecera con `ReintegroPedidoWeb.estado = PENDIENTE`, `proximo_reintento_at IS NOT NULL` y `proximo_reintento_at <= now()`. El mantenimiento recupera el intento `PENDIENTE` existente; nunca crea otro intento automático por un retry técnico.

##### 2.13.8. Locks y concurrencia

Cancelación cliente, cancelación administrativa, vencimiento, toma E12 y retiro E3 usan el mismo orden global:

1. `PedidoVenta` por `pedido_venta_id FOR UPDATE`;
2. `PedidoVentaEcommerce FOR UPDATE`;
3. `PedidoVentaItem` activos en orden estable `created_at, id FOR UPDATE`;
4. registros dependientes adicionales en orden estable, sin invertir 1–3.

El reloj para vencimiento/retiro se toma después de adquirir los locks. Cada transición E usa `updateMany` condicionado por ID, estado origen, `is_active = true` y `deleted_at IS NULL`; exactamente una operación gana:

- retiro gana: E queda `ENTREGADO`; cancelación/vencimiento devuelven conflicto/no-op de job;
- cancelación gana: E queda `CANCELADO`; toma/retiro/vencimiento no avanzan;
- vencimiento gana: E queda `VENCIDO_SIN_RETIRO`; retiro/cancelación no avanzan;
- toma E12 gana contra cancelación cliente: E queda `EN_PREPARACION`; el cliente recibe `409`, mientras el Administrador todavía puede cancelar.

Los conflictos serializables/deadlocks reintentables repiten la transacción completa con límite acotado y releen el estado. Nunca se invoca F1 desde un intento transaccional reintentable.

##### 2.13.9. Baja lógica e historial E9

`CANCELADO` y `VENCIDO_SIN_RETIRO` permanecen visibles en listado y detalle de Mis pedidos aunque `PedidoVentaEcommerce.is_active = false`. E9 debe incluir expresamente extensiones terminales de HU-E13 dadas de baja, siempre restringidas por `PedidoVenta.cliente_id`, `canal = WEB` y propiedad de sesión. `PedidoVenta` permanece activo. La vista del cliente muestra estado, motivo, fechas y estado del reintegro, pero nunca `refund_id`, claves idempotentes, errores internos o datos de pago sensibles. El QR no se devuelve en estados terminales. El listado/detalle administrativo de pedidos debe mostrar `PENDIENTE`, `APROBADO` o `RECHAZADO` y un código operativo seguro para que `RECHAZADO` pueda resolverse manualmente; tampoco expone credenciales ni payload de MP.

Esta excepción de lectura histórica no reactiva la extensión ni permite operaciones posteriores; el resto de las consultas operativas continúa filtrando `is_active = true`.

> **Addendum post-T17:** la representación exacta de motivo, fechas, estado del reintegro, comprobante original y Nota de Crédito para el Cliente Web queda fijada en §2.13.16.2 y §2.13.16.3.

##### 2.13.10. Automatización y configuración

HU-E13 reutiliza `ejecutarMantenimientoProgramado()`, el endpoint protegido `POST /api/cron/check-pruebas-vencidas` y el script de mantenimiento existente. Agrega tres procesos idempotentes y aislados: (1) recordatorios, (2) vencimientos y (3) avance/retry de sagas `PENDIENTE` cuyo `proximo_reintento_at` sea nulo o haya llegado. El fallo de uno no impide reservas, cupones, carritos ni los otros procesos HU-E13; cada resultado se informa sin PII. `RECHAZADO` y `APROBADO` nunca son seleccionados por el retry automático.

Configuración de Módulo E:

| Clave | Valor por defecto | Validación | Uso |
|---|---:|---|---|
| `ECOMMERCE_PLAZO_RETIRO_DIAS` | existente | entero positivo | calcular `plazo_retiro_vencimiento` desde la transición a LISTO |
| `ECOMMERCE_RECORDATORIO_RETIRO_HORAS` | `24` | entero `> 0` y menor que `ECOMMERCE_PLAZO_RETIRO_DIAS × 24` | anticipación configurable del recordatorio |

`ECOMMERCE_RECORDATORIO_RETIRO_HORAS` se siembra con `24`. Una configuración ausente/inválida hace fallar solo la tarea de recordatorios con `CONFIGURACION_INVALIDA`; no impide el vencimiento por su plazo persistido ni vence anticipadamente ningún pedido.

##### 2.13.11. RBAC, eventos, F3 y AuditLog

- Cliente Web: autorización por sesión y propiedad, sin permiso RBAC interno.
- Administrador E-commerce: permiso ya reservado `ecommerce:cancelar_pedido_pagado`.
- Cron: autenticación técnica existente por `CRON_SECRET`, sin sesión humana.

Eventos post-COMMIT, incluidos en `DomainEventMap` y `TIPOS_EVENTO_DOMINIO`:

| Evento | Payload mínimo | F3 | AuditLog |
|---|---|---|---|
| `ecommerce:plazo_retiro_por_vencer` | `{ evento_id, pedido_venta_id, pedido_venta_ecommerce_id, numero_venta, cliente_web_cuenta_id, plazo_retiro_vencimiento, clave_origen }` | Cliente Web, `ADVERTENCIA`, clave estable | auditoría estándar de proceso automático |
| `ecommerce:pedido_cancelado` | `{ evento_id, pedido_venta_id, pedido_venta_ecommerce_id, reintegro_id, actor_tipo, actor_id, motivo, estado_anterior, estado_nuevo: "CANCELADO", timestamp }` | Cliente Web + rol Administrador E-commerce | sensible, transición terminal + intención durable |
| `ecommerce:pedido_vencido_sin_retiro` | `{ evento_id, pedido_venta_id, pedido_venta_ecommerce_id, reintegro_id, actor_tipo: "SISTEMA", actor_id: null, motivo, estado_anterior: "LISTO_PARA_RETIRO", estado_nuevo: "VENCIDO_SIN_RETIRO", timestamp }` | Cliente Web + rol Administrador E-commerce | sensible, actor automático |
| `ecommerce:reintegro_estado_cambiado` | `{ evento_id, reintegro_id, intento_refund_id, numero_intento, origen_intento, pedido_venta_id, estado_anterior, estado_nuevo, refund_id? }` | sin notificación adicional | sensible; rechazo, reintento manual y aprobación conservan historial; no incluye error remoto ni credenciales |

> **Addendum post-T17:** la columna F3 de `ecommerce:pedido_cancelado` y `ecommerce:pedido_vencido_sin_retiro` queda sustituida por §2.13.16.1 (Cliente Web únicamente; vencimiento `CRITICA`).

Idempotencia F3: `sha256(tipo_evento + clave_origen + destinatario)`. Para recordatorio, `clave_origen = pedido_venta_id + plazo_retiro_vencimiento`; para cancelación/vencimiento, `clave_origen = reintegro_id`; un retry del mismo hecho no duplica notificaciones.

Actor humano: cancelación web conserva `actor_tipo = CLIENTE_WEB` y cuenta en payload, con `AuditLog.usuario_id = null`; cancelación administrativa usa `actor_tipo = USUARIO`, `actor_id` y `AuditLog.usuario_id = actor_id`. Vencimiento/recordatorio usan `actor_tipo = SISTEMA`, `actor_id = null`, `AuditLog.usuario_id = null`; la baja lógica E usa como `deleted_by` el usuario técnico Canal Web existente porque el campo referencia un Usuario. Ningún evento incluye DNI, email, token QR, credenciales, payload de MP ni motivo técnico completo.

##### 2.13.12. Cambios Prisma, migration y seed estrictamente necesarios

1. Agregar `NOTA_CREDITO` a `TipoComprobanteVenta`.
2. Agregar `ComprobanteFiscal.comprobante_original_id` opcional, indexado e inmutable, **sin** constraint única global.
3. Crear enums `EstadoReintegroPedidoWeb`, `TipoActorReintegro`, `EstadoIntentoRefund` y `OrigenIntentoRefund`.
4. Crear cabecera `ReintegroPedidoWeb`, hijas `ReintegroStockCompensacion` 1:N e intentos `ReintegroRefundIntento` 1:N, con constraints de §§2.13.4–2.13.6.
5. Mantener `ReintegroPedidoWeb.pedido_venta_id`, `mercadopago_payment_id`, `nota_credito_id`, `contra_asiento_ingreso_id` e `intento_aprobado_id` únicos; en intentos, `clave_idempotencia`, `refund_id` y `[reintegro_id, numero]` únicos; en stock, `clave_idempotencia`, `movimiento_stock_id` y `[reintegro_id, pedido_venta_item_id]` únicos.
6. Agregar relaciones Prisma inversas necesarias, todas con `onDelete: Restrict`.
7. Crear migration aditiva para enums, columnas, tablas, FK, índices y constraints; sin reescribir comprobantes históricos.
8. Sembrar `ECOMMERCE_RECORDATORIO_RETIRO_HORAS = 24`.
9. No crear permiso nuevo: se reutiliza `ecommerce:cancelar_pedido_pagado` también para el reintento manual.
10. No agregar columna de recordatorio.

Módulo A debe persistir o reconocer la misma clave por compensación para que la unicidad no dependa solo de la hija E.

##### 2.13.13. Matriz de regresión obligatoria D17

| Dominio/HU | Garantías mínimas a conservar y ampliar |
|---|---|
| E2 | pago aprobado factura una sola vez, confirma stock `RESERVADO → VENDIDO`, registra pago/auditoría y ahora persiste `PAGO_CONFIRMADO`; webhook repetido no duplica; evento de cola sigue emitido |
| E3 | retiro válido conserva atomicidad B/E; plazo vencido no entrega; carrera retiro/vencimiento/cancelación deja un único terminal; QR consumido |
| E6 | log de pagos y dato cifrado no cambian ni exponen refund/motivos técnicos; accesos siguen protegidos |
| E9 | propiedad por cliente; CANCELADO/VENCIDO visibles históricamente; QR y datos sensibles ocultos; demás filtros activos sin regresión |
| E12 | cola incluye `PAGO_CONFIRMADO`; tomar hace `PAGO_CONFIRMADO → EN_PREPARACION`; prioridad, asignación, escaneo, completar y aviso LISTO permanecen; no se prepara un terminal |
| A | compensación exacta por cada item/SKU `VENDIDO → DISPONIBLE`; retry ejecuta solo faltantes y no duplica stock/movimientos; E no escribe tablas A |
| B | factura original intacta; una NC HU-E13 vinculada sin impedir otras NC futuras; B permanece FACTURADO; no `FACTURADO → ANULADO` |
| G11 | resultado exacto `CREADO | YA_EXISTENTE | INGRESO_ORIGINAL_NO_ENCONTRADO`; un contra-asiento; ingreso original inmutable; ausencia deja saga pendiente |
| F1 | refund total; retry técnico conserva `X-Idempotency-Key`; reintento manual crea intento/clave nuevos solo tras rechazo definitivo; jamás dos aprobados; sin secretos en logs |
| F3 | una notificación por evento/destinatario; recordatorio estable; solo canal interno |
| D | eventos sensibles encadenados; actor humano/web/sistema correcto; retries/no-op no duplican AuditLog de negocio |
| HTTP/RBAC | propiedad Cliente Web, permiso admin, motivos estrictos, envelopes/status y no enumeración de pedidos ajenos |
| Crash recovery | crash antes/después de cada frontera local/F1 no duplica stock, NC, contra-asiento o refund; intención PENDIENTE recuperable |

##### 2.13.14. Riesgos y contradicciones todavía abiertas

1. **R1–R2 contradicen el comportamiento E2/E12 vigente y el texto histórico de §2.12:** hoy el pago persiste directamente `EN_PREPARACION`. Rev.3 exige ingreso inmediato a cola conservando `PAGO_CONFIRMADO` y transición atómica al tomar. El contrato está cerrado, pero su implementación afecta consultas, eventos y regresiones E2/E12.
2. **R9 depende de contrato nuevo en A:** no existe hoy el movimiento idempotente multi-item `VENDIDO → DISPONIBLE`; no puede implementarse desde E ni reutilizar `liberarReservasTx`.
3. **No hay atomicidad PostgreSQL/MP:** el diseño acepta E terminal y efectos locales persistidos con saga `PENDIENTE`. La recuperación está definida en §2.13.7; no debe presentarse como transacción distribuida ni como “exactly once” basado solo en BD.
4. **Modelo fiscal nuevo:** `ComprobanteFiscal` vigente no soporta `NOTA_CREDITO` ni vínculo al original; B debe incorporar el vínculo no único y la idempotencia específica HU-E13.
5. **R15 amplía G11:** el contrato actual no distingue `YA_EXISTENTE` de `INGRESO_ORIGINAL_NO_ENCONTRADO`; debe ampliarse sin degradar consumidores vigentes.
6. **R6 contradice filtros actuales de E9:** hoy se excluyen extensiones inactivas. Rev.3 exige una excepción histórica por propiedad exclusivamente para `CANCELADO`/`VENCIDO_SIN_RETIRO`, mientras Pick & Pack debe seguir excluyéndolos.

Ya no es contradicción abierta el soporte de idempotencia de Mercado Pago: Rev.3 fija como contrato F1 que el endpoint requiere `X-Idempotency-Key`. Tampoco quedan abiertas la cifra del recordatorio (`24` horas), la representación del actor automático (`AuditLog.usuario_id = null`, Canal Web en `deleted_by`) ni el permiso administrativo.

##### 2.13.15. Addendum posterior a Rev.3 — lectura administrativa mínima para T15

Este addendum es aditivo y desbloquea exclusivamente la UI administrativa T15. No modifica HU-E7, T07/T08/T11, permisos, estados, saga, retry, F3/AuditLog, schema ni migrations.

**Separación de pantallas y permiso.** `/ecommerce/pedidos` permanece sin cambios como pantalla HU-E7 de órdenes no abonadas `PAGO_PENDIENTE | PAGO_RECHAZADO`, con su permiso vigente. HU-E13 utiliza la pantalla separada `/ecommerce/pedidos/pagados`, denominada **Pedidos pagados / Gestión de pedidos pagados**, accesible por el permiso existente `PERMISO_CANCELAR_PEDIDO_PAGADO = ecommerce:cancelar_pedido_pagado`. No se autoriza por nombre de rol, no se exige además el permiso HU-E7 y no se crea un permiso nuevo. La navegación puede incorporar una entrada separada “Pedidos pagados” bajo ese permiso sin cambiar la semántica de la entrada HU-E7.

**Lectura específica.** Un Server Component y servicio administrativo dedicado, conceptualmente `listarPedidosPagadosAdmin(...)` y adaptado al naming del repositorio, leen exclusivamente `PAGO_CONFIRMADO | EN_PREPARACION | LISTO_PARA_RETIRO | CANCELADO | VENCIDO_SIN_RETIRO`. No incluyen automáticamente `PAGO_PENDIENTE`, `PAGO_RECHAZADO`, `ENTREGADO` ni `ANULADO`. No se crea API pública de lectura adicional salvo necesidad técnica real.

La excepción de baja lógica es local a esta lectura:

- extensiones activas con `is_active = true AND deleted_at IS NULL` para `PAGO_CONFIRMADO | EN_PREPARACION | LISTO_PARA_RETIRO`;
- extensiones inactivas con `is_active = false AND deleted_at IS NOT NULL` exclusivamente para `CANCELADO | VENCIDO_SIN_RETIRO`.

`PedidoVenta` conserva los criterios normales aplicables al canal WEB. No se relaja ningún filtro global ni se hacen visibles `ANULADO` u otros inactivos.

**DTO administrativo mínimo por fila:**

```typescript
{
  pedido_venta_id: string;
  numero: string;
  fecha: string;
  total: string;
  estado_ecommerce:
    | "PAGO_CONFIRMADO"
    | "EN_PREPARACION"
    | "LISTO_PARA_RETIRO"
    | "CANCELADO"
    | "VENCIDO_SIN_RETIRO";
  plazo_retiro_vencimiento: string | null;
  reintegro: null | {
    estado: "PENDIENTE" | "APROBADO" | "RECHAZADO";
    tiene_intento_pendiente: boolean;
  };
  acciones: {
    cancelar_pedido: boolean;
    reintentar_reintegro: boolean;
  };
}
```

Puede reutilizar identificadores comerciales seguros de la lista administrativa vigente sin ampliar PII. `reintegro = null` cuando no existe `ReintegroPedidoWeb`; cuando existe, solo expone su estado agregado y si existe al menos un `ReintegroRefundIntento.estado = PENDIENTE`. No expone IDs de cabecera/intento, número de intento, clave idempotente, payment/refund ID, NC, contra-asiento, errores técnicos, actor/motivo histórico ni respuesta MP.

El backend calcula las ayudas de presentación:

```text
acciones.cancelar_pedido =
  estado_ecommerce IN (PAGO_CONFIRMADO, EN_PREPARACION, LISTO_PARA_RETIRO)

acciones.reintentar_reintegro =
  reintegro.estado = RECHAZADO
  AND reintegro.tiene_intento_pendiente = false
```

En cualquier otro caso son `false`. La UI no infiere elegibilidad desde `CANCELADO`, `VENCIDO_SIN_RETIRO`, tiempo, ausencia de refund ID ni mensajes visuales. T07/T11 siguen siendo autoridad al ejecutar.

**Paginación.** PostgreSQL aplica el filtro completo de estados, canal y baja lógica antes de `count`, `orderBy`, `skip` y `take`. Se reutilizan orden y límites del listado administrativo existente cuando sean compatibles. Está prohibido paginar activos y anexar terminales después.

T15 consume `acciones.cancelar_pedido` para `PATCH /api/ecommerce/pedidos/[id]/cancelar` y `acciones.reintentar_reintegro` para `POST /api/ecommerce/pedidos/[id]/reintegro/reintentar`; tras cada mutación refresca/revalida esta lectura durable. T11 resuelve carreras y conserva la autoridad definitiva.

##### 2.13.16. Addendum post-T17 — reconciliación contractual aprobada

Este addendum registra las decisiones aprobadas tras la integración PostgreSQL end-to-end de T17. Para HU-E13 prevalece sobre los textos de Rev.3 que contradice, citados en cada punto. No modifica máquina de estados, saga de reintegro, retry, permisos, schema ni migrations.

**2.13.16.1. Destinatarios y prioridad F3.** HU-E13 genera notificaciones internas F3 exclusivamente para la cuenta del Cliente Web operable:

| Evento | Destinatario F3 | Prioridad default |
|---|---|---|
| `ecommerce:plazo_retiro_por_vencer` | Cliente Web operable únicamente | `ADVERTENCIA` (sin cambio) |
| `ecommerce:pedido_cancelado` | Cliente Web operable únicamente | sin cambio por este addendum |
| `ecommerce:pedido_vencido_sin_retiro` | Cliente Web operable únicamente | `CRITICA`, según `spec_modulo_F.md` §3.3 |
| `ecommerce:reintegro_estado_cambiado` | sin notificación adicional (sin cambio) | — |

Ninguna notificación HU-E13 se dirige al rol `ADMINISTRADOR_ECOMMERCE`. La trazabilidad administrativa corresponde al AuditLog (§2.13.11) y a las vistas administrativas HU-E13 (§2.13.15). Esta decisión reemplaza, solo para HU-E13, la frase «Cancelación y vencimiento generan notificación interna F3 para la cuenta operable y para el rol `ADMINISTRADOR_ECOMMERCE`» de §2.13.3 y la columna F3 «Cliente Web + rol Administrador E-commerce» de §2.13.11. Las claves de idempotencia F3 de §2.13.11 no cambian.

**2.13.16.2. Contrato Cliente Web E9 ampliado.** Se mantiene la visibilidad histórica de §2.13.9 para `CANCELADO` y `VENCIDO_SIN_RETIRO`. El contrato E9 del Cliente Web agrega:

```typescript
{
  motivo: string | null;
  fecha_terminacion: string | null;
  reintegro_estado: "PENDIENTE" | "APROBADO" | "RECHAZADO" | null;
}
```

- `motivo` = `PedidoVentaEcommerce.deletion_reason`.
- `fecha_terminacion` = `PedidoVentaEcommerce.deleted_at`.
- `reintegro_estado` = `ReintegroPedidoWeb.estado` si existe saga; `null` si no existe, incluido un terminal legacy sin saga.
- En pedidos no terminales donde no corresponda: `motivo = null` y `fecha_terminacion = null`.
- Se conservan las fechas ya existentes: fecha del pedido y `plazo_retiro_vencimiento`.

Nunca se expone al Cliente Web: `reintegro_id`, ID de intento, número de intento, `refund_id`, `mercadopago_payment_id`, clave idempotente, `ultimo_error_codigo`, errores técnicos, datos G11, actor administrativo ni motivo de reintento manual.

**2.13.16.3. Comprobante original y Nota de Crédito en E9.**

- `comprobante` = comprobante fiscal **original** del pedido. Una Nota de Crédito HU-E13 nunca lo reemplaza en ese campo; el original permanece visible e inmutable.
- Se agrega `nota_credito: { tipo, fecha_emision, monto } | null`, que representa la NC vinculada al original; si no existe NC, `nota_credito = null`.
- Ambos usan el mismo DTO mínimo `{ tipo, fecha_emision, monto }`, sin IDs internos.
- La lectura individual de comprobante de E9 acepta la misma visibilidad histórica `CANCELADO`/`VENCIDO_SIN_RETIRO` que el detalle del pedido, siempre restringida al dueño, canal WEB y `PedidoVenta` activo.

**2.13.16.4. Respuesta pública de cancelación Cliente Web.** `PATCH /api/tienda/mis-pedidos/[id]/cancelar` responde en éxito, incluida la repetición idempotente:

```json
{
  "data": {
    "pedido_venta_id": "uuid",
    "estado_ecommerce": "CANCELADO",
    "reintegro_iniciado": true
  },
  "error": null
}
```

No expone `reintegro_id`, `nota_credito_id`, ID de intento, `refund_id`, payment ID, clave idempotente ni diagnóstico técnico. Esta forma es el contrato vigente y sustituye, para la ruta Cliente Web, el ejemplo de §2.13.2. No cambia la lógica ni los códigos de error de §2.13.2.

##### 2.13.17. Registro de cierre HU-E13 (no normativo) — 08/10/2026

Esta sección es un registro y **no** agrega, quita ni reinterpreta contratos: la autoridad sigue siendo Rev.3 con el addendum de retry, §2.13.15 y §2.13.16.

- **Estado:** HU-E13 COMPLETADA / VERIFY PASS; T00–T20 aprobadas. Implementación, evidencia, checklist de despliegue y riesgos en `docs/modulos/modulo E/HU13_MODULO_E.md` §10.
- **Dependencias resueltas:** las dependencias marcadas como bloqueantes en §2.13.4 y §5 (movimiento `VENDIDO → DISPONIBLE` de Módulo A y refund saliente de F1) quedaron implementadas en T04 y T06; esos pasajes se conservan como antecedente histórico.
- **Cambio transversal en Módulo D (T18):** el append del AuditLog se serializa en PostgreSQL con `pg_advisory_xact_lock` sobre una clave fija del ledger; lectura del anterior por `created_at DESC, id DESC` y verificación por `created_at ASC, id ASC`. Es una corrección de concurrencia multiproceso: el algoritmo SHA-256 y la canonicalización no cambiaron.
- **Presentación (T19):** las fechas de Mis pedidos, Pedidos pagados y Pick & Pack se formatean de forma determinista (`dd/mm/aaaa`, `dd/mm/aaaa HH:mm`, zona de negocio argentina) mediante `src/lib/utils/fecha-negocio.ts`.
- **R1–R22:** este documento declara que Rev.3 «conserva D1–D17 y R1–R22», pero R1–R22 no están enumerados en el repositorio (solo se citan R1, R2, R6, R9 y R15). Queda registrado como deuda documental preexistente; no es un defecto funcional de HU-E13.
- **Operación legacy:** no ejecutar el seed global sobre bases legacy mientras `ecommerce:priorizar_cola` conserve un UUID histórico distinto (P2002); usar `migrate deploy` más configuración dirigida.

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

### 3.8. Reglas de cupones (Revisión 3 — HU-E4)

K1–K8 y Gate 3 aprobados el 02/10/2026: capacidad C+P global/cliente leída conjuntamente (§2.4.b); lock de admisión después de stock, reloj posterior al lock; consumo al pago sin alterar sus locks; rechazo preservado; mantenimiento compartido e independiente de A; código inmutable y solo ampliación de límites con historial; bruto ≥ subtotal no aplicable; administración con lock sin CAS; seis eventos auditados post-COMMIT; sin historial UI/API ni reactivación. Sin DELETE/deleteMany sobre maestros/aplicaciones, sin cambios del algoritmo de stock, auditoría o fusión del carrito.

Correcciones verificadas el 03/10/2026: F01 statement único y dos regresiones checkout/pago (global y cliente); F02 nueve cuerpos/rutas inválidos con mismo envelope español; CA07 conserva confirmada con TTL vencido. Matriz independiente **676 pass / 0 fail / 0 skip**, tsc/lint/migración/build completos; Chrome independiente cerrado, con límites de evidencia explícitos en `docs/modulos/modulo E/HU4_MODULO_E.md`. No se extiende esa evidencia a deploy/integración remota o stress no ejecutado.

## 4. Eventos de Dominio (EDA)

**Revisión 7 — sustitución de la fila histórica E12/E3 de la tabla inferior:** `ecommerce:pedido_tomado` y `ecommerce:pedido_listo_para_retiro` pertenecen a E12; `ecommerce:pedido_entregado` y el nuevo `ecommerce:retiro_rechazado` pertenecen a E3. El nombre histórico `ecommerce:qr_invalido_rechazado` queda sustituido por `ecommerce:retiro_rechazado`, que cubre también DNI, estado, plazo y soft delete sin filtrar el motivo al HTTP. Los payloads exactos y las reglas de emisión son los de 2.3.d. F3 consume `pedido_listo_para_retiro` tras completar la suscripción; no consume `pedido_entregado`. Esta nota conserva la fila de Revisión 1 como historial sin considerarla contrato vigente.

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

### Extensión de eventos — Revisión 3 (HU-E4)

Se agregan seis eventos a `src/lib/events/event-types.ts`, cada uno con handler explícito en `audit-log.listener.ts`, emitidos con `domainEventBus.emit` **después del COMMIT**. Sin modificar el algoritmo SHA-256. Base: `{ cupon_id, actor_tipo: "usuario" | "cuenta" | "sistema", actor_id, ocurrido_en }`, fecha ISO y montos string decimal.

| Evento | Campos adicionales exactos |
|---|---|
| `ecommerce:cupon_creado` | `codigo`, `tipo_beneficio`, `valor`, `vigente_desde`, `vigente_hasta`, `limite_uso_global`, `limite_uso_por_cliente` |
| `ecommerce:cupon_editado` | `antes`, `despues`, solo campos cambiados |
| `ecommerce:cupon_baja` | `motivo` |
| `ecommerce:cupon_aplicado` | `aplicacion_id`, `pedido_venta_id`, `cliente_id`, `monto_descontado`, `reserva_hasta` |
| `ecommerce:cupon_consumido` | `aplicacion_id`, `pedido_venta_id` |
| `ecommerce:cupon_aplicacion_liberada` | `aplicacion_id`, `pedido_venta_id`, `motivo` |

Alta/edición/baja manual: usuario; aplicación: cuenta web; consumo/liberación/baja automática: sistema Canal Web. Aplicado/consumido usan `registro_id` de la aplicación; cupón en payload. `cliente_id` UUID seudónimo, sin DNI/contacto/secretos. No-op e idempotencia no duplican evento.

### Extensión de eventos — Revisión 4 (HU-E5)

Dos eventos nuevos, emitidos después del COMMIT, con handler explícito en `audit-log.listener.ts` (`usuario_id` = actor, `accion` = nombre del evento, `tabla_afectada: contenidos_producto_web`). Sin PII.

| Evento | Payload |
|---|---|
| `ecommerce:visibilidad_web_cambiada` | `{ producto_web_id, producto_maestro_id, visibilidad_anterior, visibilidad_nueva, motivo: string \| null, actor_id }` — solo si el valor cambió |
| `ecommerce:contenido_web_baja` | `{ producto_web_id, producto_maestro_id, deletion_reason, actor_id }` |

`ecommerce:carrito_articulo_no_disponible` agrega el campo opcional `origen?: "CHECKOUT" \| "VISIBILIDAD_WEB"` (ausente = `"CHECKOUT"`, retrocompatible). Su asiento de auditoría se etiqueta `CHECKOUT_BLOQUEADO` (sin origen o CHECKOUT, sin cambios respecto de HU-E1) o `ARTICULO_NO_DISPONIBLE_VISIBILIDAD_WEB` (con `origen` en `valor_nuevo`).

### Extensión de eventos — Revisión 5 (HU-E7)

| Evento | Payload | Asiento |
|---|---|---|
| `ecommerce:orden_anulada` (evento sensible, fila de la Rev.1 sin cambios) | `{ pedido_venta_id, usuario_id?, deletion_reason, automatico }` — `usuario_id` ausente en la vía automática | `usuario_id` = actor (manual) o `null` (automática, como E2 y el TTL); `accion` = evento; `pedidos_venta`, `registro_id = pedido_venta_id`; antes `{ is_active: true }` / después `{ estado_ecommerce: "ANULADO", is_active: false, deletion_reason, automatico }` |

Módulo A: `ReservaLiberadaPayload.motivo_liberacion` y `MotivoLiberacionInmediata` agregan `"ANULACION_ORDEN"` (aditivo y retrocompatible; ninguna lista cerrada depende del tipo) para la liberación por anulación, manual o automática. `spec_modulo_A.md` no se edita desde aquí: queda reportado para su owner. El asiento `RESERVA_LIBERADA` existente registra el motivo sin cambios.

### Extensión de eventos — Revisión 6 (HU-E11)

Cinco eventos nuevos en `src/lib/events/event-types.ts` (y en `TIPOS_EVENTO_DOMINIO`), emitidos con `domainEventBus.emit` **después del COMMIT** con captura local; handler explícito en `audit-log.listener.ts` con `.catch(codigoDiagnosticoAuditoria)`. `usuario_id` = actor, `accion` = nombre del evento, `ip = "internal-event"`. Un no-op no emite. El cambio colateral de principal viaja en el payload, sin asiento aparte. Sin PII ni el nombre original del archivo.

| Evento | Payload | Asiento (`tabla_afectada` / `registro_id`; antes → después) |
|---|---|---|
| `ecommerce:contenido_web_creado` | `{ producto_web_id, producto_maestro_id, titulo_comercial, descripcion, actor_id }` | `contenidos_producto_web` / contenido; `null` → `{ producto_maestro_id, titulo_comercial, descripcion, visibilidad_web: false }` |
| `ecommerce:contenido_web_editado` | `{ producto_web_id, producto_maestro_id, antes, despues, actor_id }` (solo campos cambiados) | `contenidos_producto_web` / contenido; `antes` → `despues` |
| `ecommerce:foto_web_subida` | `{ foto_id, producto_web_id, url, formato, tamano_bytes, es_principal, orden, principal_anterior_id, actor_id }` | `fotos_producto_web` / foto; `null` → todo menos `actor_id` |
| `ecommerce:foto_web_principal_cambiada` | `{ foto_id, producto_web_id, principal_anterior_id, actor_id }` | `fotos_producto_web` / foto; `{ es_principal: false, principal_anterior_id }` → `{ es_principal: true }` |
| `ecommerce:foto_web_baja` | `{ foto_id, producto_web_id, deletion_reason, era_principal, principal_promovida_id, actor_id }` | `fotos_producto_web` / foto; `{ is_active: true, es_principal }` → `{ is_active: false, deleted_by, deletion_reason, principal_promovida_id }` |

## 5. Fuera de Alcance (diferido / bloqueado)

**Rev.6 — E11:** reactivación de contenido o fotos dados de baja; recorte, redimensionado o compresión de imágenes; proveedor en la nube y CDN (un Adapter nuevo del Gateway de §2.11.b); procedimiento de limpieza de archivos huérfanos; volumen persistente para `CATALOGO_FOTOS_DIR` cuando la app se contenedorice (hoy `docker-compose.yml` solo levanta Postgres y el cron). Pendientes de validar con el equipo/PO: el almacenamiento por el servidor con Gateway y disco local (§2.11.b), los valores 8 / 5 MB / JPG-PNG-WebP (§2.11.c), la falta de reactivación del contenido dado de baja (§2.11.d) y la ausencia de Server Actions (§2.11.a).

**Rev.5 — E7:** reconstrucción del carrito del cliente, notificación al Cliente Web y cierre de la preferencia de Mercado Pago al anular (no los pide la spec; decisiones de producto pendientes); consumo de las métricas de conversión por el Módulo D (HU-D3); agendado del cron en despliegue. Pendientes de validar con el equipo/PO: pantalla mínima sin Server Action (§2.7.a) y listener spec-literal (§2.7.d).

**Rev.4 — E5:** reactivación de un contenido web dado de baja; Server Actions de §2.5 (desvío a validar); bandeja de notificaciones del Cliente Web en la tienda (superficie fuera de HU-F3); agendado del cron en despliegue (mismo pendiente que reservas y cupones). Pendientes de validar con el PO: las dos operaciones de §2.5.a y el plazo de 7 días de §2.5.d.

**Rev.3 — E4:** campañas ampliadas, acumulación, endpoint público de validación antes del checkout, pantalla/endpoint de historial de aplicaciones (K8; persisten datos y auditoría para D), reactivación, restitución de usos por reembolso E13, pedidos de neto cero, cambios de proveedor o algoritmo de reserva. No quedan gates de evidencia E4 pendientes al cierre documentado; deuda aceptada de UI/copy/accesibilidad no se incorpora como requisito nuevo. La integración/PR siguen siendo operaciones manuales pendientes.

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
  - *Revisión 4:* la clave de 2.1 quedó resuelta como `ECOMMERCE_CARRITO_ABANDONADO_DIAS` (default `7`, módulo `E`), sembrada en `prisma/seed.ts` (§2.5.d). `spec_modulo_D.md` §6.2 sigue sin actualizar (coordinación pendiente con el owner de Módulo D). Las claves de 2.11 siguen pendientes.
  - *Revisión 6:* las claves de 2.11 quedaron resueltas como `ECOMMERCE_FOTOS_MAX_POR_PRODUCTO` (8), `ECOMMERCE_FOTO_TAMANO_MAX_MB` (5) y `ECOMMERCE_FOTO_FORMATOS_PERMITIDOS` (`JPG,PNG,WEBP`), módulo `E`, sembradas en `prisma/seed.ts` (§2.11.c). `spec_modulo_D.md` §6.2 sigue sin actualizar (coordinación pendiente con el owner de Módulo D).
- **Storage de imágenes (HU-E11):** este documento no define el mecanismo de almacenamiento de fotos de producto (S3, Vercel Blob u otro) — `ProductoWebFoto.url` asume una URL ya resuelta por un mecanismo externo a definir.
  - *Revisión 6:* resuelto con un Gateway propio y un Adapter de disco local (§2.11.b); un proveedor en la nube queda como Adapter futuro.
- **Mecanismo de push en tiempo real para notificaciones (heredado de `spec_modulo_F.md` sección 2.3):** el contador de "Mis pedidos"/bandeja se refresca por polling, no WebSocket/SSE — documentado como extensión futura no bloqueante, mismo criterio que Módulo F.
- **`origen_reserva` para checkout web, sin valor confirmado en el enum `OrigenReserva` de Módulo A:** ver Nota de relevamiento en 2.2 — bloqueante menor (tiene una salida de contingencia razonable, reutilizar `SENIA`, pero no confirmada).
- **Exportación de métricas (HU-E10, permiso `ecommerce:exportar_metricas`):** el permiso está definido en la matriz de 2.10 pero este documento no especifica ningún endpoint ni contrato de exportación — mismo patrón de diferimiento ya usado por `spec_modulo_B.md` sección 5 para su propia exportación de reportes (se asume resuelto por el futuro Tablero de Comando de Módulo D).
