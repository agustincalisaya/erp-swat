# PLAN de Implementación — HU-E15 (Claridad en checkout y reserva de stock)

## Revisión 2 — APROBADO (20/10/2026)

> Revisión 2: incorpora las resoluciones del owner a las contradicciones C1–C7 (`HU15_TASKS.md` §3). D2 queda precisada (C2), P1 confirmada (C3) y D4 ajustada (C7, nueva D4.1).

## ERP SWAT Indumentarias — Módulo E — Sprint 5

**Fuente funcional única:** `docs/specs/spec_modulo_E.md` §6.1 (HU-E15, Revisión 10: E15-1 a E15-7, contrato de lectura y casos mínimos), complementada por §2.2 (checkout y pago E2), §2.6 (sin datos de tarjeta), §2.7.d (anulación automática por TTL) y §2.8.f (aislamiento de cuentas pendientes).
**Normas transversales:** `RULES.md` Regla N.° 1 (baja lógica y filtrado de inactivos), Regla N.° 2 (trazabilidad), Regla N.° 3 (Adapter de Mercado Pago).
**Estado:** APROBADO por el owner el 20/10/2026. **Cierre 20/10/2026: HU-E15 IMPLEMENTADA — T00–T08 cerradas**; registro final en §10.
**Alcance de este documento:** relevamiento, decisiones y plan técnico. No constituye implementación, TASKS ni evidencia de pruebas. Las tasks ejecutables están en `docs/modulos/modulo E/HU15_TASKS.md`.
**Fecha:** 20/10/2026.
**Stack real:** Next.js 16 App Router (leer `node_modules/next/dist/docs/` antes de tocar `app/`, ver `CLAUDE.md`) · TypeScript · Prisma · PostgreSQL 16 · Zod · `node:test`.

---

## 1. Objetivo e invariantes

HU-E15 es una HU **de presentación y lectura**: aclara al Cliente Web qué pasa al reservar, cuánto dura la reserva, con qué medio paga y cuánto paga, antes de salir a Mercado Pago. No cambia ninguna transición de estado.

Invariantes no negociables (spec §6.1 «Contrato de lectura» y §2.2):

- **I1.** No se modifica la semántica transaccional de HU-E1/E2 (`iniciarCheckout`, `ejecutarTransaccionCheckout`, `obtenerOCrearPreferencia`, webhook) ni la reserva de Módulo A (`crearReservaTx`, `liberarReservasVencidas`).
- **I2.** El body de `POST /api/tienda/checkout` no cambia: sigue siendo `{ cupon_codigo? }` estricto. No se acepta medio de pago ni importe del navegador (CA5 de E2, E15-3, E15-5).
- **I3.** El total mostrado es siempre `PedidoVenta.total` persistido (neto de cupón); nunca se recalcula en el cliente ni desde el carrito.
- **I4.** Al navegador nunca viaja la clave `ECOMMERCE_CHECKOUT_TTL_HORAS` ni las horas: solo minutos (carrito) y el `ttl_expiracion` ya existente (pantalla pendiente).
- **I5.** Ninguna acción nueva de la UI (abrir/cerrar diálogo, «Volver», selector) hace fetch, crea preferencia, reinicia ni extiende la reserva. Única excepción aprobada (D4.1): cerrar el diálogo en estado vencido ejecuta `router.refresh()`, que solo vuelve a leer la página en el servidor, sin mutación.
- **I6.** Sin migraciones, sin cambios de seed, sin cambios en el adapter de Mercado Pago, en el job/cron, en eventos ni en `AuditLog`. HU-E15 no produce mutaciones auditables (Regla 2 no requiere eventos nuevos).
- **I7.** La consulta por defecto sigue filtrando inactivos (Regla 1); la única excepción es una lectura acotada y documentada (§4, D7).

---

## 2. PASO 0 — Relevamiento verificado (estado real del repo al 20/10/2026)

### a) ¿Algún dato del TTL llega hoy al navegador?

| Dato | ¿Llega? | Evidencia |
|---|---|---|
| Clave `ECOMMERCE_CHECKOUT_TTL_HORAS` | **No.** Vive en `ConfiguracionSistema` (base), no en env; el lector es `server-only`. | `src/lib/services/sistema/configuracion.service.ts:14,23,95-97`; seed `prisma/seed.ts:3576` (valor `"1"`) |
| Horas | **No.** Solo se usan en el servidor para `crearReservaTx(... ttl_horas)`. | `src/lib/services/ecommerce/checkout.service.ts:349-353,501-514` |
| Minutos | **No existen** en ningún DTO. El carrito muestra texto genérico. | `src/components/tienda/CarritoCliente.tsx:177-179` («Al iniciar la compra reservamos el stock por un tiempo limitado…»); `CarritoVista` sin campo de plazo: `src/lib/services/ecommerce/carrito.service.ts:65-73` |
| `ttl_expiracion` (ISO absoluto) | **Sí**, en el JSON de `POST /api/tienda/checkout` (lo recibe `CarritoCliente`, que hoy solo usa `pedido_venta_id`). | `checkout.service.ts:102-103,582`; `CarritoCliente.tsx:61,78` |
| Hora de vencimiento formateada | **Sí**, renderizada server-side en `/tienda/checkout/pendiente`. | `src/app/(tienda)/tienda/checkout/pendiente/page.tsx:38-44,75`; `CheckoutPendienteVista.tsx:56` |
| Variables `NEXT_PUBLIC_*` relacionadas | **No hay.** | búsqueda en `src/` sin resultados |

### b) Forma exacta de la respuesta 201 de `POST /api/tienda/checkout`

- Route Handler: `src/app/api/tienda/checkout/route.ts:21-40`. `respuestaOk(checkout, checkout.reutilizado ? 200 : 201)` (`:36`). Envelope `{ data, error: null }`.
- `data` = `CheckoutIniciado` (`checkout.service.ts:94-108`):

```ts
{
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;   // external_reference de MP
  numero_venta: string;
  estado_ecommerce: "PAGO_PENDIENTE";
  total: number;                       // NETO (HU-B9 − cupón HU-E4) = PedidoVenta.total
  ttl_expiracion: string;              // ISO; mínimo de Reserva.fecha_expiracion
  checkout_url: string | null;         // init_point de Checkout Pro
  reutilizado: boolean;                // true → status 200 (D10)
}
```

- Si Mercado Pago falla después del commit: error `PASARELA_* | CONECTOR_NO_CONFIGURADO | APP_PUBLIC_URL_NO_CONFIGURADA` con `details.pedido_venta_id` (`checkout.service.ts:312-321`); el pedido ya quedó en Pago Pendiente y `CarritoCliente` navega a la pantalla pendiente (`CarritoCliente.tsx:66-71`).
- Sin sesión: `401 SESION_CLIENTE_WEB_REQUERIDA` «Debe iniciar sesión para completar la compra» (`route.ts:40`). Cuenta pendiente: `403 CUENTA_VINCULACION_PENDIENTE` (`withSesionClienteWeb`, spec §2.8.f; doble guarda en `checkout.service.ts:325-330`).
- Observación: hoy el éxito del POST **no** usa `total`/`ttl_expiracion`/`checkout_url` en el cliente: siempre navega a `/tienda/checkout/pendiente?pedido=…` (`CarritoCliente.tsx:78`), que vuelve a leer todo en el servidor.

### c) Componentes de diálogo

- Existen `src/components/ui/dialog.tsx` (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`; exports en `:149`) y `src/components/ui/alert-dialog.tsx` (`AlertDialog…`, `AlertDialogAction`, `AlertDialogCancel`; exports en `:127`). Ambos sobre primitivas ya instaladas (`DialogPrimitive` / `AlertDialogPrimitive`).
- `src/components/clientes/DialogBajaCliente.tsx:23-30` usa **`AlertDialog`** (`AlertDialog`, `AlertDialogCancel`, …).
- Antecedente del lado tienda: `src/components/ecommerce/CancelarPedidoWeb.tsx:7` usa **`Dialog`** controlado (`open`/`onOpenChange`) con guarda de doble submit.
- No hay `<Select>` ni `RadioGroup` en `src/components/ui/`. La convención documentada es control nativo con clases compartidas: `src/components/clientes/SegmentoCliente.tsx:23-25,57,157`.
- **No se agregan dependencias nuevas.**

### d) `/tienda/checkout/pendiente` cuando el job ya anuló el pedido

Secuencia del job (spec §2.7.d): `liberarReservasVencidas()` (`src/lib/services/inventario/reserva.service.ts:396-460`) emite `stock:reserva_liberada` con `TTL_VENCIDO` → `anulacion-orden.listener.ts` → `anularOrdenPorReservaVencida()` (`src/lib/services/ecommerce/anulacion-orden.service.ts:304-330`) → núcleo `ejecutarAnulacion`:

- `PedidoVentaEcommerce`: `estado_ecommerce = ANULADO`, `is_active = false`, `deleted_at = ahora`, `deleted_by = <id usuario Canal Web>`, `deletion_reason = "Reserva vencida sin pago (TTL)"` (`anulacion-orden.service.ts:137-147`; constante `MOTIVO_ANULACION_TTL` en `anulacion-orden.reglas.ts:27`).
- `PedidoVenta`: `RESERVADO → ANULADO` con baja lógica (`anularPedidoVentaTx`, `anulacion-orden.service.ts:174-185`).
- Aplicación de cupón pendiente: baja lógica (`:157-167`).

Comportamiento de la página (`src/app/(tienda)/tienda/checkout/pendiente/page.tsx`):

1. `obtenerPedidoWebPendiente(id, clienteId)` (`:64`) filtra `estado_ecommerce: "PAGO_PENDIENTE", is_active: true, deleted_at: null` y `pedido_venta.is_active: true` (`checkout.service.ts:216-222`) → **`null`**.
2. `obtenerResultadoPago(id, clienteId)` (`:67`) filtra `is_active: true, deleted_at: null` en la extensión (`src/lib/services/ecommerce/pago-web.service.ts:860-865`) → **`null`**.
3. Rama `!pedido` (`page.tsx:71-73`) → `CheckoutPendienteVista` con `pedido = null` → el cliente ve **«No encontramos esa compra pendiente» / «Agregá productos al carrito para iniciar una compra.»** (`CheckoutPendienteVista.tsx:22-31`), **no** «Reserva vencida».

Antes de que corra el job, el mismo pedido sí muestra «Reserva vencida» derivado de `ttl_expiracion` (`CheckoutPendienteVista.tsx:34-47`; regla pura `src/lib/services/ecommerce/pedido-web.reglas.ts:15-20`). El pedido anulado sí es visible en Mis pedidos como «Anulado» (`src/components/ecommerce/DetallePedidoWeb.tsx:186`). **Brecha:** E15-7 exige «Reserva vencida» sin presuponer que el job haya corrido, en ambos sentidos.

**Criterio confiable de «anulado por TTL»:** sí existe. El par `deletion_reason === MOTIVO_ANULACION_TTL` **y** `deleted_by === id del usuario de sistema Canal Web` en `PedidoVentaEcommerce` identifica únicamente la vía automática: la vía manual de HU-E7 escribe `deleted_by = actorId` de la sesión del Administrador (`anulacion-orden.service.ts:280-288`), por lo que aunque tipee el mismo texto no coincide el autor. No se usa `AuditLog` (`automatico: true`) para no acoplar la lectura al ledger.

### e) Framework y convención de tests

- Runner: **`node:test`** + `node:assert/strict`. Sin Jest/Vitest/Testing Library/jsdom.
- Unit puros (`.ts`): `node --experimental-strip-types --test <archivos>`; deben listarse explícitamente en el script `test` de `package.json:14` (ej. `src/lib/services/ecommerce/hu-e1.unit.test.ts`, que ya prueba `derivarEstadoVisiblePedidoWeb` en `:86-90`).
- Componentes: `src/components/**/*.test.ts(x)` con dos técnicas: render estático `renderToStaticMarkup` (`src/components/ecommerce/ConsolaPickPack.test.tsx:1-10`) y aserciones sobre la fuente con `readFileSync` + regex (`src/components/ecommerce/cancelar-pedido-web.test.ts:1-25`). Se ejecutan con `node --import tsx --test <archivo>`.
- Integración con PostgreSQL real: `node --conditions=react-server --import tsx --test --test-concurrency=1 <archivo>` con variable de base dedicada (patrón `HU_E1_INTEGRATION_DATABASE_URL`, `src/lib/services/ecommerce/hu-e1.integration.test.ts:9-23`) y script `test:integration:<hu>` en `package.json:33-49`.
- Tests existentes que tocan textos que cambian: `src/lib/services/ecommerce/hu-e8.http.integration.test.ts:174` (`assert.doesNotMatch(html, /Iniciar compra|Ingresar para comprar/)` para cuenta pendiente); `hu-e1.integration.test.ts:411` («Reserva vencida» antes del job).

### f) Lectura del carrito

- Página: `src/app/(tienda)/tienda/carrito/page.tsx:13-32` (Server Component). `resolverContextoTienda()` (`src/lib/services/ecommerce/contexto-tienda.ts:31-39`: cuenta vinculada → `{ cuentaId }`, visitante o cuenta pendiente → `{ carritoToken }`) y `obtenerCarrito(contexto.carrito)` (`carrito.service.ts:151-154`) → `CarritoVista` (`:65-73`). La página pasa `carrito`, `conSesion` y `compraBloqueada` a `CarritoCliente` (`page.tsx:30`).
- `obtenerCarrito` / `CarritoVista` tienen **otros tres consumidores**: `src/app/(tienda)/layout.tsx:20` (badge del header, en cada página de la tienda), `GET /api/tienda/carrito` (`src/app/api/tienda/carrito/route.ts:13`) y los resultados de mutación (`ResultadoMutacionCarrito`, `carrito.service.ts:160-164`).

---

## 3. Matriz SPEC → componentes

| CA | Estado actual | Cambio previsto | Componentes |
|---|---|---|---|
| E15-1 | «Iniciar compra» / «Ingresar para comprar» / sin botón en pendiente | Solo el texto «Iniciar compra» → «Proceder al pago» | `CarritoCliente.tsx:194` |
| E15-2 | Texto genérico, sin minutos | Lectura server-side de minutos + texto explicativo; degradación sin número | lector de minutos (servicio), `carrito/page.tsx`, `CarritoCliente.tsx` |
| E15-3 | No hay selector | Selector nativo informativo con única opción Mercado Pago | componente nuevo de tienda, `CheckoutPendienteVista.tsx` |
| E15-4 | `<a href={checkoutUrl}>` directo | Botón → diálogo con total, medio y minutos vivos; Continuar/Volver | componente cliente nuevo + regla pura de minutos |
| E15-5 | Total server-side ya mostrado | Diálogo recibe `pedido.total` de la lectura server-side; sin recálculo | `CheckoutPendienteVista.tsx`, componente nuevo |
| E15-6 | Alert de reintento con `checkoutUrl = null` | Se conserva tal cual; sin botón de diálogo | `CheckoutPendienteVista.tsx:70-78` |
| E15-7 | Vencida antes del job: OK; después del job: «No encontramos…» | Lectura acotada de pedido anulado por TTL + texto de vencida | `checkout.service.ts` (lector nuevo), `pendiente/page.tsx`, `CheckoutPendienteVista.tsx` |

---

## 4. Decisiones

### 4.1. Decisiones del owner (tomadas; no se reabren salvo contradicción con la spec)

- **D1 (E15-1).** El texto del botón pasa de «Iniciar compra» a «Proceder al pago». «Ingresar para comprar» para el visitante sin cambios. La cuenta pendiente sigue sin botón. Las guardas del servidor (`withSesionClienteWeb`, `reservarPedidoCheckout`) no cambian.
- **D2 (E15-2).** El servidor obtiene los minutos como `obtenerTtlCheckoutHoras() * 60` y los agrega a la lectura del carrito. Al cliente solo viaja el número de minutos. El texto informa los minutos y aclara que el stock se descuenta al reservar y se libera si el pago no se confirma en ese plazo. Si el lector lanza `CONFIGURACION_INVALIDA`, no hay default: se muestra el texto genérico actual sin número y la página no se rompe. **Precisión aprobada (C2):** `CONFIGURACION_INVALIDA` y `CONFIGURACION_NO_ENCONTRADA` se tratan igual; cualquier otro error no se atrapa.
- **D3 (E15-3).** En Pago pendiente, selector informativo nativo (convención `SegmentoCliente`) con una única opción habilitada, «Mercado Pago», con la aclaración de que incluye tarjeta de crédito y débito dentro de su checkout. Solo visual: no envía nada y el body del POST no cambia.
- **D4 (E15-4).** El link «Pagar con Mercado Pago» se reemplaza por un botón que abre un diálogo con total congelado, medio «Mercado Pago» y minutos restantes = `Math.ceil((ttl_expiracion − ahora) / 60000)`, calculados al abrir y refrescados mientras está abierto. «Continuar» navega a `checkout_url`. «Volver» solo cierra: sin fetch, sin mutación, sin extender ni reiniciar la reserva. Con minutos ≤ 0 desaparece «Continuar» y se muestra el estado vencido.
- **D4.1 (ajuste aprobado de D4, resuelve C7).** Mientras la reserva está vigente, «Volver» solo cierra el diálogo: sin request y sin `router.refresh()`. Si al abrir, o mientras está abierto, los minutos llegan a ≤ 0, el diálogo oculta «Continuar», muestra el mensaje de reserva vencida y ofrece «Volver al catálogo» (enlace a `/tienda/catalogo`). Cerrar el diálogo en ese estado vencido (botón de cierre, Escape u overlay) dispara `router.refresh()` para que la página se re-derive en el servidor y muestre «Reserva vencida». Es solo lectura, sin mutación.
- **D5 (E15-5).** El total del diálogo es `PedidoVenta.total` leído en el servidor (o el de la respuesta del checkout), ya neto de cupón. Nunca se recalcula ni se toma del carrito o del navegador.
- **D6 (E15-6).** Con `checkout_url = null` no se ofrece «Continuar» y se mantiene el aviso de reintento de HU-E2 tal cual. El diálogo nunca crea una preferencia.
- **D7 (E15-7).** «Reserva vencida» se muestra si `ttl_expiracion <= ahora`, sin depender del job. El texto explica que los artículos volvieron a estar disponibles y ofrece volver al catálogo y armar el carrito de nuevo. Para la brecha post-job se agrega una lectura explícita que incluye inactivos, acotada a cliente de la sesión, canal WEB y pedido ANULADO por vencimiento de TTL. Solo lectura; la consulta por defecto sigue filtrando inactivos.
- **D8 (fuera de alcance).** Migraciones de schema, cambios en el adapter de MP, cambios en el job, refactor de formateo de fechas, envío de notificaciones.

### 4.2. Decisiones de plan derivadas del relevamiento (aprobadas con el plan, 20/10/2026)

- **P1 — Dónde viajan los minutos (D2). CONFIRMADA por el owner (C3).** `CarritoVista`, `carrito.service.ts` y `GET /api/tienda/carrito` **no se modifican**. Los minutos **no** se agregan a `CarritoVista`, porque ese DTO también lo consumen el layout de toda la tienda, `GET /api/tienda/carrito` y cada mutación del carrito (§2.f): agregarlo leería configuración en cada request de la tienda y ampliaría el contrato JSON público de E1. Se agrega un lector server-side dedicado, `obtenerPlazoReservaCheckoutMinutos(): Promise<number | null>`, invocado **solo** por `carrito/page.tsx` como parte de la lectura de la página del carrito, y pasado a `CarritoCliente` como prop `plazoReservaMinutos: number | null`. Cumple «solo se agrega el plazo informativo en minutos a la lectura server-side del carrito» (spec §6.1). Ver Contradicción C3.
- **P2 — Degradación de configuración (D2). CONFIRMADA por el owner (C2).** El lector devuelve `null` ante `ServiceError` con código `CONFIGURACION_INVALIDA` **o** `CONFIGURACION_NO_ENCONTRADA` (clave ausente), con `console.error` sin el valor; cualquier otro error se propaga. Ver Contradicción C2.
- **P3 — Visibilidad del aviso de plazo (D2).** El aviso con minutos se muestra cuando hay botón de compra (visitante y cuenta vinculada); con cuenta pendiente se conserva el texto genérico (no tiene acción de checkout, §2.8.f).
- **P4 — Ubicación de la regla de minutos (D4).** Funciones puras nuevas en `src/lib/services/ecommerce/pedido-web.reglas.ts` (sin Prisma, testeables con `npm test`): `minutosRestantesReserva(ttl: Date, ahora: Date): number` (= `Math.ceil((ttl − ahora) / 60000)`) y `minutosDePlazoCheckout(horas: number): number` (= `horas * 60`). La condición de vencido del diálogo es `minutosRestantesReserva(...) <= 0`, equivalente a `derivarEstadoVisiblePedidoWeb(...) === "RESERVA_VENCIDA"` (`ttl <= ahora`) — se cubre la equivalencia en el borde exacto con un test.
- **P5 — Componentes nuevos (D3/D4).** `src/components/tienda/SelectorMedioPagoInformativo.tsx` (server-compatible, sin estado: `<fieldset>` con `<legend>` y un `<input type="radio" checked readOnly name="medio_pago_informativo">` + label; no está dentro de ningún `<form>` y no tiene `onChange` que dispare red) y `src/components/tienda/ConfirmarPagoDialog.tsx` (`"use client"`, `Dialog` controlado de `@/components/ui/dialog` como `CancelarPedidoWeb`; props `{ total: number; ttlExpiracion: string; checkoutUrl: string }`; intervalo de refresco de minutos solo mientras `abierto`; «Continuar» = `window.location.assign(checkoutUrl)`; «Volver» con reserva vigente = `setAbierto(false)`; estado vencido según D4.1: «Volver al catálogo» como enlace y cierre por cualquier vía = `setAbierto(false)` + `router.refresh()` de `next/navigation`). `CheckoutPendienteVista` sigue siendo server-compatible: solo compone ambos.
- **P6 — Lectura post-job (D7).** Función nueva `obtenerPedidoWebVencidoPorTtl(pedidoVentaId, clienteId, canalWebId)` en `checkout.service.ts`, invocada por `pendiente/page.tsx` **solo** cuando `obtenerPedidoWebPendiente` y `obtenerResultadoPago` devolvieron `null`. Predicado único:
  - `PedidoVentaEcommerce`: `estado_ecommerce = ANULADO`, `is_active = false`, `deleted_at != null`, `deletion_reason = MOTIVO_ANULACION_TTL`, `deleted_by = canalWebId`;
  - `PedidoVenta`: `id = pedidoVentaId`, `cliente_id = clienteId` (de la sesión), `canal = WEB` (sin filtro de `is_active`, porque la anulación lo dio de baja).
  - Devuelve el mismo `PedidoWebPendienteVista` con `estado_visible = "RESERVA_VENCIDA"`, `checkout_url = null`, `cupon = null` y `ttl_expiracion` = mínimo de `Reserva.fecha_expiracion` de los ítems activos (persistido y no alterado al liberar; si no hay, `deleted_at` de la extensión).
  - `canalWebId` se resuelve con `obtenerUsuarioCanalWebId()` (`src/lib/services/ecommerce/usuario-canal-web.ts:16-28`) desde la página. Excepción documentada a Regla 1, mismo patrón que §2.7.b y §2.13.9: lectura, acotada al dueño, sin reactivar ni exponer datos adicionales.
- **P7 — Tests de la regresión E8.** `hu-e8.http.integration.test.ts:174` se amplía a `/Iniciar compra|Proceder al pago|Ingresar para comprar/` para que la garantía «cuenta pendiente sin acción de checkout» no quede vacía tras el renombre.
- **P8 — Fuente del total en el diálogo (D5).** El flujo real navega siempre a `/tienda/checkout/pendiente` tras el POST (§2.b), así que el diálogo vive solo en esa página y usa `pedido.total` de `obtenerPedidoWebPendiente` (= `PedidoVenta.total`). No se agrega un diálogo en el carrito ni se usa el `total` de la respuesta del POST; así recarga y primera visita comparten exactamente la misma fuente (caso «recarga con el mismo total»).

---

## 5. Fases

### F0 — Preflight
Confirmar en la rama de trabajo las rutas y líneas de §2 (pueden haberse movido por merges de Sprint 5), baseline de `npm test`, `npm run typecheck`, `npm run lint` y de las suites E1/E2/E7/E8 de integración.

### F1 — Lectura de minutos (servidor)
Reglas puras de P4 y lector `obtenerPlazoReservaCheckoutMinutos()` (P1/P2). Sin cambios en `CarritoVista`.

### F2 — UI del carrito
Texto del botón (D1) y aviso con minutos o genérico (D2, P3). Ajuste de la regresión E8 (P7).

### F3 — Lectura post-job
`obtenerPedidoWebVencidoPorTtl` (P6) y su uso en `pendiente/page.tsx`.

### F4 — Selector informativo
`SelectorMedioPagoInformativo` (D3, P5) en la rama vigente de `CheckoutPendienteVista`.

### F5 — Diálogo de confirmación
`ConfirmarPagoDialog` (D4, D5, P5, P8) reemplazando el `<a>` directo.

### F6 — Estados de la vista
Enlace ausente (D6) intacto y texto de «Reserva vencida» (D7) unificado para pre-job y post-job.

### F7 — Tests
Matriz de §6.

### F8 — Documentación de cierre
Registro en este documento y en `HU15_TASKS.md`; sin editar la spec salvo autorización explícita.

---

## 6. Matriz de pruebas (casos mínimos de la spec §6.1)

| Caso | Nivel | Verificación |
|---|---|---|
| Con sesión vinculada | componente + integración HTTP | botón «Proceder al pago», aviso con N minutos, cupón visible |
| Sin sesión (visitante) | componente + integración HTTP | «Ingresar para comprar», aviso con minutos, POST → 401 → `/tienda/ingresar` sin cambios |
| Cuenta pendiente | integración HTTP (E8) | sin «Proceder al pago»/«Iniciar compra»/«Ingresar para comprar»; checkout 403; `/tienda/checkout/pendiente` redirige a `/tienda/cuenta` |
| Configuración inválida / ausente | unit (lector con dependencia inyectada o integración) | `null`, texto genérico, página 200 |
| Clave/horas no expuestas | componente + HTML | el HTML del carrito no contiene `ECOMMERCE_CHECKOUT_TTL_HORAS` ni «hora(s)» derivadas; solo minutos |
| Cupón | integración | diálogo y vista muestran `PedidoVenta.total` neto; `DesgloseCupon` intacto |
| Enlace ausente | componente | sin botón de diálogo ni «Continuar»; Alert «No pudimos conectar con Mercado Pago» + «Reintentá» idénticos a E2 |
| Reintento | integración | recargar la página crea la preferencia faltante (comportamiento E2 conservado); el diálogo no la crea |
| TTL antes / en / después | unit | `minutosRestantesReserva` para +61 s → 2, +60 s → 1, +1 ms → 1, 0 → 0 (vencido), −1 ms → ≤0; equivalencia con `derivarEstadoVisiblePedidoWeb` |
| Vencida pre-job | integración (existente E1 `:411`) | «Reserva vencida» con reservas vencidas no liberadas |
| Vencida post-job | integración nueva | tras `liberarReservasVencidas` + listener E7: «Reserva vencida», no «No encontramos…» |
| Post-job acotado | integración nueva | pedido anulado manualmente (E7, actor admin, mismo texto) → no se muestra como vencido; pedido ajeno → «No encontramos…»; pedido de mostrador → «No encontramos…» |
| «Volver» sin mutación (reserva vigente) | componente (fuente) + integración | «Volver» con reserva vigente no invoca `fetch` ni `router.refresh()`; filas de `PedidoVentaEcommerce` y `Reserva` (`fecha_expiracion`, `updated_at`) idénticas antes/después de cargar la página |
| Vencimiento con el diálogo abierto (D4.1) | componente (fuente) + unit | minutos ≤ 0 al abrir o durante el intervalo → sin «Continuar», mensaje de reserva vencida y «Volver al catálogo»; cerrar en ese estado llama `router.refresh()` exactamente en esa rama; sin `fetch`; tras el refresh la página renderiza «Reserva vencida» (cubierto por la lectura server-side pre-job/post-job) |
| Recarga con el mismo total | integración | dos lecturas de `obtenerPedidoWebPendiente` devuelven el mismo `total` = `PedidoVenta.total` = `total` de la respuesta 201 |
| Body del POST sin cambios | integración HTTP existente | `{ medio_pago }` o `{ total }` → 400 |

Comandos: `npm test` (unit listados en `package.json`), `node --import tsx --test <tests de componentes>`, `npm run test:integration:e15` (script nuevo), regresión `test:integration:e1`, `e2` (vía `node … hu-e2.integration.test.ts`), `e7`, `e8-http`; `npm run typecheck`, `npm run lint`, `next build`.

---

## 7. Archivos previstos

### Nuevos
- `src/components/tienda/SelectorMedioPagoInformativo.tsx`
- `src/components/tienda/ConfirmarPagoDialog.tsx`
- `src/components/tienda/checkout-e15.test.tsx` (componentes)
- `src/lib/services/ecommerce/hu-e15.unit.test.ts` (reglas puras)
- `src/lib/services/ecommerce/hu-e15.integration.test.ts`

### Modificados
- `src/lib/services/ecommerce/pedido-web.reglas.ts` (P4)
- `src/lib/services/ecommerce/checkout.service.ts` (lector de minutos P1/P2 y lectura post-job P6; sin tocar `iniciarCheckout`/transacción)
- `src/app/(tienda)/tienda/carrito/page.tsx`
- `src/components/tienda/CarritoCliente.tsx`
- `src/app/(tienda)/tienda/checkout/pendiente/page.tsx`
- `src/app/(tienda)/tienda/checkout/CheckoutPendienteVista.tsx`
- `src/components/tienda/compra.module.css` (solo clases nuevas)
- `src/lib/services/ecommerce/hu-e8.http.integration.test.ts` (P7)
- `package.json` (alta del unit test en `test` y script `test:integration:e15`)

### No tocar
`prisma/schema.prisma`, migraciones, `prisma/seed.ts`, `src/lib/integraciones/mercadopago/**`, `src/lib/services/ecommerce/pago-web.service.ts`, `src/lib/services/inventario/reserva.service.ts`, `src/lib/services/ecommerce/anulacion-orden.*`, `src/lib/events/**`, `src/app/api/tienda/checkout/route.ts`, `src/lib/schemas/ecommerce.schema.ts`, `src/lib/services/ecommerce/carrito.service.ts` (`CarritoVista`), `src/lib/services/sistema/configuracion.service.ts`, `src/app/api/cron/**`, `scripts/**`, `docs/specs/spec_modulo_E.md`.

---

## 8. Riesgos y controles

| Riesgo | Control |
|---|---|
| Hydration mismatch por calcular «ahora» en el cliente | Minutos calculados solo dentro del diálogo, al abrir (efecto/handler), nunca en el render inicial server-side |
| Intervalo huérfano | `setInterval` creado al abrir y limpiado al cerrar/desmontar |
| `router.refresh()` fuera de la rama vencida (D4.1) | Refresh solo en el handler de cierre cuando `minutos <= 0`; test de fuente que lo verifica |
| Doble fuente de verdad del vencido (página vs diálogo) | Misma regla pura (P4) y test de equivalencia en el borde |
| Lectura post-job demasiado amplia | Predicado de P6 con autor Canal Web + motivo exacto + cliente de sesión + canal WEB; tests negativos |
| `obtenerUsuarioCanalWebId` lanza si el usuario de sistema falta | Se invoca solo en la rama `null`; un fallo cae en `checkout/error.tsx` (estado seguro existente) |
| Regresión silenciosa del test E8 tras el renombre | P7 |
| Cambio de contrato público del carrito | P1: `CarritoVista` y `GET /api/tienda/carrito` intactos |
| Mobile-first | Diálogo con `DialogFooter` en columna en móvil (patrón `flex flex-col-reverse gap-2 sm:flex-row`, `cancelar-pedido-web.test.ts`) |

---

## 9. Contradicciones e incompatibilidades detectadas

Se listan completas en `HU15_TASKS.md` §3 (fuente única para la ejecución). **Todas resueltas por el owner el 20/10/2026:**

| ID | Tema | Resolución |
|---|---|---|
| C1 | Ruta de T2 mal citada en la spec | No se modifica la spec en esta HU; queda registrada para corrección posterior |
| C2 | D2 nombraba solo `CONFIGURACION_INVALIDA` | Confirmado: `CONFIGURACION_INVALIDA` y `CONFIGURACION_NO_ENCONTRADA` se tratan igual; otros errores no se atrapan (D2, P2) |
| C3 | Minutos en `CarritoVista` vs lector dedicado | Confirmado el lector dedicado (P1); `CarritoVista`, `carrito.service.ts` y `GET /api/tienda/carrito` no se modifican |
| C4 | Excepción a Regla 1 por lectura post-job | De acuerdo con lo documentado (P6) |
| C5 | Total de la respuesta del checkout vs lectura server-side | De acuerdo con lo documentado (P8) |
| C6 | «Proceder al pago» sobre una acción que reserva | De acuerdo con lo documentado (D1) |
| C7 | Diálogo vencido vs resto de la página | Ajuste a D4 → D4.1: cerrar el diálogo en estado vencido ejecuta `router.refresh()` |

---

## 10. Registro de ejecución

- 20/10/2026 — PLAN Revisión 2 aprobado por el owner con las resoluciones C1–C7.
- 20/10/2026 — **HU-E15 implementada; T00–T08 cerradas.** Detalle por task, desvíos y regresión en `HU15_TASKS.md` §4 (§4.5: regresión baseline vs final, sin diferencias salvo los tests nuevos; única falla, la conocida `hu-e2` P-R2 de §4.1).

### 10.1. Cumplimiento por criterio

| CA | Cumplido en | Evidencia |
|---|---|---|
| E15-1 | `CarritoCliente.tsx` (botón: «Proceder al pago» / «Ingresar para comprar» / sin botón con `compraBloqueada`); guardas server-side sin cambios | `checkout-e15.test.tsx` (E15-1); HTTP H1, H2, H3; `hu-e8.http.integration:174` |
| E15-2 | `obtenerPlazoReservaCheckoutMinutos` (`checkout.service.ts`) + `resolverPlazoCheckoutMinutos`/`minutosDePlazoCheckout` (`pedido-web.reglas.ts`); `carrito/page.tsx`; `AvisoPlazoReserva` en `CarritoCliente.tsx` | `hu-e15.unit` (D2/C2); `checkout-e15.test.tsx` (E15-2); HTTP H1, H3 (minutos, sin clave ni horas), H5 (inválida/ausente → 200 genérico) |
| E15-3 | `SelectorMedioPagoInformativo.tsx` en `CheckoutPendienteVista.tsx`; body del POST sin cambios | `checkout-e15.test.tsx` (E15-3); T07.5; HTTP H3 (`medio_pago`/`total` → 400; selector en HTML) |
| E15-4 | `ConfirmarPagoDialog.tsx` (total, «Mercado Pago», minutos con `minutosRestantesReserva`; Continuar/Volver; D4.1 vencida + `router.refresh()`) | `checkout-e15.test.tsx` (E15-4, D4.1); `hu-e15.unit` (bordes); T07.2 |
| E15-5 | Total = `PedidoVenta.total` leído por `obtenerPedidoWebPendiente` y pasado al diálogo; sin recálculo en cliente | T07.1 (cupón, recarga = respuesta 201 = persistido); HTTP H3 (sin mutación al abrir/recargar) |
| E15-6 | `CheckoutPendienteVista.tsx`: sin `checkoutUrl`, Alert de reintento E2 intacto y sin diálogo | `checkout-e15.test.tsx` (E15-6); T07.4 (enlace ausente; reintento crea una sola preferencia) |
| E15-7 | Pre-job: `derivarEstadoVisiblePedidoWeb`; post-job: `obtenerPedidoWebVencidoPorTtl` + `pendiente/page.tsx`; bloque único «Reserva vencida» | T03.1–T03.5; T07.2, T07.3; HTTP H4 (antes y después del job; ajeno no se revela) |

### 10.2. Pendientes fuera de esta HU

- **C1:** corregir en `spec_modulo_E.md:1922` la ruta de T2 (`docs/tareas tecnicas/T2-mercado-pago-local.md`). No se modificó la spec por resolución del owner.
- **Falla conocida §4.1:** actualizar `hu-e2.integration.test.ts` P-R2 a la semántica de HU-E13 R1 (`PAGO_CONFIRMADO`).
- **T07-E1:** la suite `hu-e7.integration` no es repetible sobre la misma base (anula un fixture del seed); conviene que use su propio pedido o documentarlo en `HU7_MODULO_E.md`.
- **T02-O1:** decidir si el texto genérico del carrito («Al iniciar la compra…») se alinea con «Proceder al pago».
- **Evidencia de navegador del diálogo** (§4.5 «Límite de la evidencia»): verificación manual con los pasos del reporte de cierre.
