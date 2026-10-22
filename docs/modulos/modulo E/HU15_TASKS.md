# HU-E15 TASKS — Revisión 2 — APROBADO

> **Estado al 20/10/2026:** APROBADO por el owner, con las resoluciones C1–C7 de §3 (C7 ajusta D4 → D4.1 del PLAN). **HU-E15 CERRADA: T00–T08 ejecutadas**; registro en §4 (regresión en §4.5).

## Claridad en checkout y reserva de stock — Módulo E

**Fuentes de verdad congeladas:**

1. `docs/specs/spec_modulo_E.md` — §6.1 HU-E15 (Revisión 10): E15-1 a E15-7, «Contrato de lectura» y casos mínimos; complementan §2.2 (checkout/pago E2), §2.6 (sin datos de tarjeta), §2.7.d (anulación automática por TTL) y §2.8.f (aislamiento de cuentas pendientes).
2. `docs/modulos/modulo E/HU15_MODULO_E.md` — PLAN Revisión 2 aprobada: relevamiento PASO 0 (§2), decisiones del owner D1–D8 y D4.1, decisiones de plan P1–P8 (§4), matriz de pruebas (§6), archivos (§7), resoluciones C1–C7 (§9).
3. `RULES.md` — Regla N.° 1 (baja lógica, filtrado de inactivos), Regla N.° 2 (trazabilidad), Regla N.° 3 (Adapter de Mercado Pago).

**Estado:** APROBADO (20/10/2026). No constituye implementación ni evidencia de pruebas.

## Reglas de ejecución

- Ejecutar una sola task por autorización.
- Al terminar cada task: presentar diff, pruebas focales y riesgos; luego **STOP**. No iniciar la siguiente sin aprobación.
- **Autorización de ejecución continua T03–T08 (owner, 20/10/2026):** a partir de T03 las tasks se ejecutan en el orden del grafo sin STOP entre ellas. Se mantienen: archivos autorizados como límite máximo; al cerrar cada task, typecheck + lint + tests focales (si algo falla y se corrige dentro de los archivos autorizados, se corrige y se sigue; si no, STOP); todos los «Criterio de STOP» de cada task; STOP ante cualquier contradicción con la spec o el plan, sin resolverla unilateralmente; sin operaciones de git. T07 corre la regresión completa contra el baseline de T00 sobre `swat_erp_test_e15` (única falla aceptada: `hu-e2` P-R2, §4.1) y apaga cualquier servidor levantado verificando el puerto libre. Reporte único al cierre de T08.
- Los archivos autorizados son un límite máximo, no una obligación de modificarlos todos.
- Si hace falta tocar un archivo no autorizado, cambiar un contrato o ampliar alcance: **STOP y nueva revisión**.
- No modificar SPEC ni PLAN durante estas tasks (salvo el registro de ejecución de T08).
- Prohibido: migraciones, cambios de `prisma/schema.prisma` o `prisma/seed.ts`, cambios en el adapter de Mercado Pago, en `pago-web.service.ts`, en el job/cron de reservas, en `anulacion-orden.*`, en eventos/`AuditLog` y en el body de `POST /api/tienda/checkout`.
- Prohibido: dependencias nuevas de `package.json` (solo se permite editar scripts en T07).
- Ninguna acción de UI nueva puede hacer fetch, crear preferencia, reiniciar ni extender una reserva. Única excepción aprobada (D4.1): cerrar el diálogo de confirmación en estado vencido ejecuta `router.refresh()` (relectura server-side, sin mutación).
- Prohibido modificar `CarritoVista`, `src/lib/services/ecommerce/carrito.service.ts` y `GET /api/tienda/carrito` (resolución C3).
- No se modifica `docs/specs/spec_modulo_E.md` en esta HU (resolución C1).
- Antes de tocar `src/app/**`, leer la guía correspondiente en `node_modules/next/dist/docs/` (Next 16; ver `CLAUDE.md`).
- Sin operaciones de git salvo autorización explícita del owner.

---

## 1. Grafo de dependencias

```text
T00 Preflight y baseline
 ├─> T01 Lectura de minutos (servidor) ──> T02 UI carrito (botón + aviso) ──────────────┐
 ├─> T03 Lectura de pedido vencido post-job ───────────────────────────────┐             │
 └─> T04 Selector informativo ──> T05 Diálogo de confirmación ──> T06 Estados de la vista (enlace ausente / vencida)
                                                                            │  (requiere T03)
                                                                            └─────────────┴─> T07 Tests de integración y regresión ──> T08 Documentación de cierre
```

T04, T05 y T06 se serializan porque comparten `CheckoutPendienteVista.tsx`. T03 puede correr en paralelo con T01/T02/T04/T05, pero debe estar aprobada antes de T06.

---

# TASKS

## T00 — Preflight y baseline

**Objetivo:** confirmar en la rama de trabajo que el relevamiento de `HU15_MODULO_E.md` §2 sigue vigente y fijar la línea base de pruebas.

**Alcance exacto:** releer y citar ruta:línea de: `CarritoCliente.tsx` (botón y aviso), `carrito/page.tsx`, `obtenerCarrito`/`CarritoVista` y sus consumidores, `obtenerTtlCheckoutHoras`, `CheckoutIniciado`, `obtenerPedidoWebPendiente`, `obtenerResultadoPago`, `pendiente/page.tsx`, `CheckoutPendienteVista.tsx`, núcleo de anulación (`deleted_by`, `deletion_reason`, `MOTIVO_ANULACION_TTL`), `obtenerUsuarioCanalWebId`, `ui/dialog.tsx`. Correr baseline: `npm test`, `npm run typecheck`, `npm run lint`, `test:integration:e1`, `test:integration:e7`, `test:integration:e8-http` y `hu-e2.integration.test.ts` contra base de test.

**Archivos autorizados:** ninguno (solo lectura). Registro en la respuesta de cierre.

**Contrato:** si cualquier hecho de §2 cambió (otro criterio de anulación por TTL, `CarritoVista` ya con plazo, diálogo inexistente, otra forma de la respuesta 201), se reporta antes de seguir.

**Dependencias previas:** aprobación de PLAN y TASKS.

**Tests focales obligatorios:** baseline completo arriba listado; anotar fallos preexistentes.

**Criterio de aceptación:** relevamiento confirmado o diferencias reportadas; baseline registrado con conteos pass/fail/skip.

**Criterio de STOP:** el criterio «anulado por TTL» (motivo exacto + `deleted_by` Canal Web) dejó de ser distinguible de la vía manual; o baseline con fallos en suites E1/E2/E7/E8 no explicados.

**Riesgos/regresiones:** confundir fallos preexistentes con regresiones posteriores.

**Cierre:** presentar relevamiento confirmado + baseline y **STOP**.

---

## T01 — Lectura de minutos del plazo de reserva (servidor)

**Objetivo:** disponer server-side del plazo informativo en minutos sin exponer clave ni horas (E15-2, D2, P1, P2, P4).

**Alcance exacto:**
- En `pedido-web.reglas.ts`: funciones puras `minutosDePlazoCheckout(horas: number): number` (= `horas * 60`) y `minutosRestantesReserva(ttl: Date, ahora: Date): number` (= `Math.ceil((ttl − ahora) / 60000)`).
- En `checkout.service.ts`: `obtenerPlazoReservaCheckoutMinutos(): Promise<number | null>` que llama a `obtenerTtlCheckoutHoras()` y devuelve `minutosDePlazoCheckout(horas)`; ante `ServiceError` `CONFIGURACION_INVALIDA` o `CONFIGURACION_NO_ENCONTRADA` devuelve `null` y loguea solo el código; otros errores se propagan.
- No se modifica `CarritoVista`, `obtenerCarrito`, `configuracion.service.ts` ni la transacción de checkout.

**Archivos autorizados:** `src/lib/services/ecommerce/pedido-web.reglas.ts`, `src/lib/services/ecommerce/checkout.service.ts` (solo la función nueva y su import), `src/lib/services/ecommerce/hu-e15.unit.test.ts` (nuevo).

**Contrato:** sin default numérico; el retorno es minutos enteros positivos o `null`. El nombre de la clave no aparece en ningún valor devuelto.

**Dependencias previas:** T00 aprobada.

**Tests focales obligatorios:** `minutosDePlazoCheckout(1) = 60`; `minutosRestantesReserva` en +61 s → 2, +60 s → 1, +1 ms → 1, 0 → 0, −1 ms → 0 o negativo; equivalencia `minutosRestantesReserva(t, a) <= 0` ⇔ `derivarEstadoVisiblePedidoWeb(t, a) === "RESERVA_VENCIDA"` en los mismos bordes. Si el lector se prueba con dependencia inyectada: `CONFIGURACION_INVALIDA` → `null`, `CONFIGURACION_NO_ENCONTRADA` → `null`, otro error → propaga.

**Criterio de aceptación:** reglas puras verdes con `node --experimental-strip-types --test`; typecheck limpio.

**Criterio de STOP:** hace falta modificar `obtenerTtlCheckoutHoras`, `CarritoVista` o agregar un default.

**Riesgos/regresiones:** importar `server-only` en `pedido-web.reglas.ts` (rompería `npm test`); redondeo distinto al de la decisión D4.

**Cierre:** presentar diff + tests y **STOP**.

---

## T02 — UI del carrito: texto del botón y aviso de plazo

**Objetivo:** cumplir E15-1 y la parte visible de E15-2 (D1, D2, P1, P3, P7).

**Alcance exacto:**
- `carrito/page.tsx`: llamar `obtenerPlazoReservaCheckoutMinutos()` y pasar `plazoReservaMinutos` a `CarritoCliente`.
- `CarritoCliente.tsx`: nueva prop `plazoReservaMinutos: number | null`; botón «Iniciar compra» → «Proceder al pago» (visitante «Ingresar para comprar» y cuenta pendiente sin botón, sin cambios); aviso: con número → «Al proceder al pago reservamos tu stock durante {N} minutos: esa cantidad deja de estar disponible para otros compradores. Si el pago no se confirma en ese plazo, la reserva se libera.» (texto final ajustable sin cambiar el contenido); sin número → texto genérico actual. Con cuenta pendiente se mantiene el texto genérico (P3).
- `hu-e8.http.integration.test.ts:174`: regex ampliada a `/Iniciar compra|Proceder al pago|Ingresar para comprar/`.

**Archivos autorizados:** `src/app/(tienda)/tienda/carrito/page.tsx`, `src/components/tienda/CarritoCliente.tsx`, `src/components/tienda/compra.module.css` (solo clases nuevas si hacen falta), `src/lib/services/ecommerce/hu-e8.http.integration.test.ts` (solo la línea 174), `src/components/tienda/checkout-e15.test.tsx` (nuevo).

**Contrato:** guardas del servidor sin cambios; `iniciarCompra` y el body del POST idénticos; el HTML no contiene `ECOMMERCE_CHECKOUT_TTL_HORAS` ni horas.

**Dependencias previas:** T01 aprobada.

**Tests focales obligatorios:** render (`renderToStaticMarkup`) o fuente de `CarritoCliente`: con sesión → «Proceder al pago»; sin sesión → «Ingresar para comprar»; `compraBloqueada` → ningún botón de compra; `plazoReservaMinutos = 60` → «60 minutos»; `null` → texto genérico sin número; fuente sin cambio del `fetch` del checkout.

**Criterio de aceptación:** E15-1 y E15-2 visibles; regresión E8 sigue verde con la regex ampliada.

**Criterio de STOP:** el lector necesita cambiar `CarritoVista` o el layout; la página se rompe ante configuración inválida.

**Riesgos/regresiones:** la página del carrito pasa a depender de una lectura extra de configuración (degradación cubierta por T01); texto de «Proceder al pago» puede inducir a pensar que ya se paga (ver C6).

**Cierre:** presentar diff + tests y **STOP**.

---

## T03 — Lectura de pedido vencido post-job

**Objetivo:** cerrar la brecha de E15-7 cuando el job ya anuló el pedido (D7, P6).

**Alcance exacto:**
- `checkout.service.ts`: `obtenerPedidoWebVencidoPorTtl(pedidoVentaId, clienteId, canalWebId): Promise<PedidoWebPendienteVista | null>` con el predicado exacto de PLAN P6 (extensión `ANULADO`, `is_active = false`, `deleted_at` no nulo, `deletion_reason = MOTIVO_ANULACION_TTL`, `deleted_by = canalWebId`; pedido propio, canal WEB). Devuelve `estado_visible: "RESERVA_VENCIDA"`, `checkout_url: null`, `cupon: null`, `ttl_expiracion` = mínimo de `Reserva.fecha_expiracion` de ítems activos (o `deleted_at` si no hay).
- `pendiente/page.tsx`: solo en la rama donde `obtenerPedidoWebPendiente` y `obtenerResultadoPago` son `null`, resolver `obtenerUsuarioCanalWebId()` e invocar la lectura nueva; si devuelve vista, renderizar el estado vencido existente.

**Archivos autorizados:** `src/lib/services/ecommerce/checkout.service.ts` (función nueva e imports de `MOTIVO_ANULACION_TTL`), `src/app/(tienda)/tienda/checkout/pendiente/page.tsx`, `src/lib/services/ecommerce/hu-e15.integration.test.ts` (nuevo).

**Contrato:** solo lectura; ninguna otra consulta relaja `is_active`; `obtenerPedidoWebPendiente` y `obtenerResultadoPago` sin cambios; sin escribir en base; nada de `AuditLog`.

**Dependencias previas:** T00 aprobada.

**Tests focales obligatorios (integración PostgreSQL):** pedido Pago Pendiente con reserva vencida → correr `liberarReservasVencidas` + esperar listener E7 (`esperarAnulacionesPendientes`) → la lectura nueva devuelve vista vencida; mismo pedido de otro cliente → `null`; pedido anulado manualmente por admin con el mismo `deletion_reason` → `null`; pedido de canal MOSTRADOR → `null`; pedido `PAGO_RECHAZADO`/anulado por rechazo → `null`; ninguna fila modificada por la lectura (`updated_at` intacto).

**Criterio de aceptación:** pantalla post-job muestra «Reserva vencida»; casos negativos siguen en «No encontramos…» o en su página actual.

**Criterio de STOP:** el criterio de TTL requiere leer `AuditLog`, comparar textos libres sin autor o modificar el núcleo de anulación; o aparece otra vía que escriba el mismo motivo con `deleted_by` Canal Web.

**Riesgos/regresiones:** lectura demasiado amplia (excepción a Regla 1); `obtenerUsuarioCanalWebId` lanzando en la rama `null` (cae en `checkout/error.tsx`).

**Cierre:** presentar diff + tests y **STOP**.

---

## T04 — Selector informativo de medio de pago

**Objetivo:** cumplir E15-3 (D3, P5).

**Alcance exacto:** componente `SelectorMedioPagoInformativo` (server-compatible, sin estado): `<fieldset>` + `<legend>Medio de pago</legend>` + un único `<input type="radio" checked readOnly>` «Mercado Pago» con aclaración «Incluye tarjeta de crédito y débito dentro del checkout de Mercado Pago.» Convención de clases de controles nativos (`SegmentoCliente.tsx:57`). Se inserta en la rama de reserva vigente de `CheckoutPendienteVista`.

**Archivos autorizados:** `src/components/tienda/SelectorMedioPagoInformativo.tsx` (nuevo), `src/app/(tienda)/tienda/checkout/CheckoutPendienteVista.tsx` (solo inserción), `src/components/tienda/compra.module.css` (clases nuevas), `src/components/tienda/checkout-e15.test.tsx`.

**Contrato:** sin `<form>`, sin `onChange` con red, sin `name` que viaje en ningún request; ninguna otra opción de pago.

**Dependencias previas:** T00 aprobada.

**Tests focales obligatorios:** render estático: una única opción, marcada, texto «Mercado Pago» y aclaración de tarjetas; fuente sin `fetch`, `form` ni `action`; no aparece en estados vencido/no encontrado.

**Criterio de aceptación:** selector visible solo con reserva vigente; accesible (fieldset/legend/label asociado).

**Criterio de STOP:** se pide enviar el medio elegido al servidor o agregar opciones de pago.

**Riesgos/regresiones:** usuario interpreta que puede elegir (mitigado con una sola opción marcada y texto aclaratorio).

**Cierre:** presentar diff + tests y **STOP**.

---

## T05 — Diálogo de confirmación antes de Mercado Pago

**Objetivo:** cumplir E15-4 y E15-5 (D4, D4.1, D5, P5, P8).

**Alcance exacto:**
- `ConfirmarPagoDialog` (`"use client"`), props `{ total: number; ttlExpiracion: string; checkoutUrl: string }`. Botón disparador «Pagar con Mercado Pago» que abre un `Dialog` controlado de `@/components/ui/dialog`.
- Contenido: total (`formatearPrecio(total)`), medio «Mercado Pago», minutos restantes con `minutosRestantesReserva(new Date(ttlExpiracion), new Date())` calculados al abrir y refrescados con intervalo (≤ 30 s) solo mientras está abierto; limpieza al cerrar/desmontar.
- Reserva vigente: «Continuar» → `window.location.assign(checkoutUrl)`; «Volver» → solo cerrar (sin request, sin `router.refresh()`).
- Estado vencido (D4.1): si al abrir o durante el intervalo los minutos son ≤ 0, se oculta «Continuar», se muestra el mensaje de reserva vencida y «Volver al catálogo» (enlace a `/tienda/catalogo`). Cerrar el diálogo en ese estado, por cualquier vía (botón, Escape, overlay, `onOpenChange(false)`), ejecuta `router.refresh()` (`useRouter` de `next/navigation`) para que la página se re-derive en el servidor y muestre «Reserva vencida».
- `CheckoutPendienteVista`: reemplazar el `<a href={checkoutUrl}>` por el componente pasándole `pedido.total` y `pedido.ttl_expiracion` (lectura server-side). Se conserva la nota «Tus datos de tarjeta nunca pasan por SWAT Indumentarias».

**Archivos autorizados:** `src/components/tienda/ConfirmarPagoDialog.tsx` (nuevo), `src/app/(tienda)/tienda/checkout/CheckoutPendienteVista.tsx`, `src/components/tienda/compra.module.css` (clases nuevas), `src/components/tienda/checkout-e15.test.tsx`.

**Contrato:** el diálogo no hace llamadas de red ni mutaciones (sin `fetch`, Server Actions, POST); `router.refresh()` solo en el cierre del estado vencido (D4.1) y en ningún otro camino; el total nunca se calcula en el cliente; los minutos no se calculan en el render server-side (evita hydration mismatch).

**Dependencias previas:** T01 y T04 aprobadas.

**Tests focales obligatorios:** fuente: usa `Dialog` de `@/components/ui/dialog`; no contiene `fetch(`, `POST` ni Server Actions; «Continuar» usa el `checkoutUrl` recibido; `clearInterval` presente; condición `<= 0` oculta «Continuar» y muestra mensaje de vencida + enlace a `/tienda/catalogo`; `router.refresh()` aparece una sola vez y solo dentro de la rama de cierre con minutos ≤ 0; «Volver» con reserva vigente solo cambia estado (sin `router.refresh()`). Render estático de la vista vigente: muestra el disparador y no el `<a>` directo. Unit de minutos ya cubierto en T01.

**Criterio de aceptación:** E15-4 y E15-5 cumplidos; diálogo usable en 360 px (footer en columna en móvil).

**Criterio de STOP:** el diálogo necesita datos que no vienen de la lectura server-side, necesita crear/consultar la preferencia o necesita refrescar fuera del estado vencido.

**Riesgos/regresiones:** intervalo huérfano; `router.refresh()` disparado con reserva vigente; bloqueadores de navegación en `window.location.assign`; reloj del cliente desfasado (aceptado: la reserva la decide el servidor y MP vence la preferencia con la misma expiración).

**Cierre:** presentar diff + tests y **STOP**.

---

## T06 — Estados de la vista: enlace ausente y reserva vencida

**Objetivo:** cumplir E15-6 y la presentación de E15-7 (D6, D7) integrando T03 y T05.

**Alcance exacto:**
- Enlace ausente: la rama `checkoutUrl = null` conserva **sin cambios** el `Alert` «No pudimos conectar con Mercado Pago» + «Reintentá» de HU-E2; no se renderiza el disparador del diálogo.
- Reserva vencida (pre-job por `estado_visible` y post-job por T03): texto que explica que la reserva venció, que los artículos volvieron a estar disponibles y que puede volver al catálogo y armar el carrito de nuevo; acción «Volver al catálogo». Mismo bloque para ambas procedencias. Sin selector ni diálogo.

**Archivos autorizados:** `src/app/(tienda)/tienda/checkout/CheckoutPendienteVista.tsx`, `src/app/(tienda)/tienda/checkout/pendiente/page.tsx` (solo si hace falta pasar props), `src/components/tienda/checkout-e15.test.tsx`.

**Contrato:** el reintento sigue siendo recargar la página (E2); ningún botón nuevo crea preferencia.

**Dependencias previas:** T03 y T05 aprobadas.

**Tests focales obligatorios:** render estático con `checkoutUrl = null` → Alert y enlace de reintento idénticos, sin disparador; con `estado_visible = "RESERVA_VENCIDA"` → texto de vencida, enlace al catálogo, sin selector ni disparador (es lo que muestra la página tras el `router.refresh()` de D4.1); con reserva vigente y URL → selector + disparador.

**Criterio de aceptación:** E15-6 y E15-7 cumplidos en presentación.

**Criterio de STOP:** hace falta cambiar `urlDePago` o `obtenerOCrearPreferencia`.

**Riesgos/regresiones:** romper el texto del reintento que conocen los usuarios/tests de E2.

**Cierre:** presentar diff + tests y **STOP**.

---

## T07 — Tests de integración y regresión (casos mínimos de la spec)

**Objetivo:** cubrir la matriz de `HU15_MODULO_E.md` §6 y verificar que E1/E2/E4/E7/E8 no regresionan.

**Alcance exacto:** completar `hu-e15.integration.test.ts` y `checkout-e15.test.tsx`; registrar `hu-e15.unit.test.ts` en el script `test` y crear `test:integration:e15` en `package.json`.

**Casos:** con y sin sesión; cuenta pendiente (sin acción de checkout, 403, redirección); configuración inválida/ausente (texto genérico, página 200); cupón (total neto en vista/diálogo = `PedidoVenta.total`); enlace ausente (Alert E2); reintento (recarga crea preferencia, diálogo no); TTL antes/en/después (unit) y vencida pre-job/post-job (integración); «Volver» sin mutación con reserva vigente (reservas y extensión sin cambios en `fecha_expiracion`/`updated_at` tras renderizar la página; sin `router.refresh()`); vencimiento con el diálogo abierto (D4.1: sin «Continuar», mensaje vencido, «Volver al catálogo», cierre → `router.refresh()` → la página muestra «Reserva vencida», y la base sigue sin cambios); recarga con el mismo total (dos lecturas = respuesta 201); body del POST con `medio_pago` o `total` → 400.

**Archivos autorizados:** `src/lib/services/ecommerce/hu-e15.integration.test.ts`, `src/lib/services/ecommerce/hu-e15.unit.test.ts`, `src/components/tienda/checkout-e15.test.tsx`, `package.json` (solo scripts `test` y `test:integration:e15`).

**Contrato:** tests contra base aislada (`HU_E15_INTEGRATION_DATABASE_URL`), nunca development/producción; sin cambios de código productivo en esta task.

**Dependencias previas:** T02 y T06 aprobadas.

**Tests focales obligatorios:** los listados + regresión `test:integration:e1`, `hu-e2.integration.test.ts`, `test:integration:e4`, `test:integration:e7`, `test:integration:e8-http`; `npm test`, `npm run typecheck`, `npm run lint`, build Next.js.

**Criterio de aceptación:** matriz completa en verde, 0 skipped no justificados, regresiones sin diferencias con el baseline de T00.

**Criterio de STOP:** un caso solo pasa modificando código productivo o la semántica de E1/E2/E7.

**Riesgos/regresiones:** flakiness por reloj en bordes del TTL (usar `ahora` inyectado en reglas y fechas controladas en fixtures).

**Cierre:** presentar resultados y **STOP**.

---

## T08 — Documentación de cierre

**Objetivo:** registrar implementación, evidencia y riesgos residuales.

**Alcance exacto:** completar §10 de `HU15_MODULO_E.md` y §4 de este documento (estado de cada task, comandos y conteos, desvíos). Dejar C1 registrada como pendiente de corrección posterior de la spec, fuera de esta HU.

**Archivos autorizados:** `docs/modulos/modulo E/HU15_MODULO_E.md`, `docs/modulos/modulo E/HU15_TASKS.md`. `docs/specs/spec_modulo_E.md` **no** se modifica (resolución C1).

**Dependencias previas:** T07 aprobada.

**Tests focales obligatorios:** ninguno nuevo; citar la evidencia de T07.

**Criterio de aceptación:** registro completo y trazable a cada CA E15-1…E15-7.

**Criterio de STOP:** la documentación exige reinterpretar un contrato.

**Riesgos/regresiones:** declarar evidencia no ejecutada.

**Cierre:** presentar documentación y **STOP**.

---

## 2. Gates principales resumidos

| Gate | Condición |
|---|---|
| G0 | PLAN y TASKS aprobados; T00 confirma relevamiento y baseline |
| G1 | Ningún dato de TTL distinto de minutos (carrito) y `ttl_expiracion` (pendiente) llega al navegador |
| G2 | Body de `POST /api/tienda/checkout` y transacción E1/E2 intactos (diff sin cambios en `route.ts`, `ejecutarTransaccionCheckout`, `pago-web.service.ts`) |
| G3 | Diálogo y selector sin red ni mutación; «Volver» con reserva vigente verificado sin cambios en base ni refresh; `router.refresh()` solo al cerrar en estado vencido (D4.1) |
| G4 | Lectura post-job acotada: tests negativos (ajeno, manual, mostrador, rechazado) en verde; consultas por defecto sin cambios |
| G5 | Sin migraciones, seed, eventos ni dependencias nuevas |
| G6 | Matriz §6 del PLAN y regresiones E1/E2/E4/E7/E8 en verde; typecheck, lint y build OK |

---

## 3. Contradicciones detectadas

**Estado: todas RESUELTAS por el owner el 20/10/2026.** El texto original de cada una se conserva como antecedente; la resolución vigente es la línea **Resolución**.

- **C1 — Ruta de la tarea transversal T2 mal citada en la spec.** `spec_modulo_E.md:1922` remite a `docs/tasks/tareas tecnicas/T2-mercado-pago-local.md`; el archivo real es `docs/tareas tecnicas/T2-mercado-pago-local.md`. No afecta los CA. Propuesta: corrección de redacción en la spec, solo con autorización (T08).
  - **Resolución (RESUELTA):** no se modifica la spec en esta HU. Queda registrada para corrección posterior.
- **C2 — Degradación de configuración más amplia que la decisión D2.** D2 dice «si el lector lanza `CONFIGURACION_INVALIDA`». `obtenerTtlCheckoutHoras()` lanza además `CONFIGURACION_NO_ENCONTRADA` cuando la clave falta (`configuracion.service.ts:44-56,86-97`). Si solo se atrapa `CONFIGURACION_INVALIDA`, una clave ausente rompería la página del carrito, contra el espíritu de D2 («la página no se rompe»). El plan (P2) trata ambos códigos igual: texto genérico, sin default.
  - **Resolución (RESUELTA — CONFIRMADO):** `CONFIGURACION_INVALIDA` y `CONFIGURACION_NO_ENCONTRADA` se tratan igual: texto genérico sin número, sin default, la página del carrito no se rompe. Cualquier otro error no se atrapa. Aplica a T01 y T02.
- **C3 — «Agregar los minutos a la lectura del carrito» vs. alcance de `CarritoVista`.** D2 y spec §6.1 hablan de agregar el plazo «a la lectura server-side del carrito». `CarritoVista` es también el contrato de `GET /api/tienda/carrito`, de las respuestas de mutación y del layout de toda la tienda (`(tienda)/layout.tsx:20`, `api/tienda/carrito/route.ts:13`, `carrito.service.ts:160-164`). Agregarle el campo ampliaría el JSON público de E1 y leería configuración en cada request de la tienda. El plan (P1) lo resuelve con un lector dedicado invocado solo por `carrito/page.tsx` y pasado como prop: sigue siendo lectura server-side del carrito y al cliente solo viaja el número.
  - **Resolución (RESUELTA — CONFIRMADO):** lector dedicado invocado solo desde `carrito/page.tsx` y pasado como prop a `CarritoCliente`. `CarritoVista`, `carrito.service.ts` y `GET /api/tienda/carrito` **no** se modifican (incorporado a las Reglas de ejecución).
- **C4 — Excepción a la Regla N.° 1 por la lectura post-job.** `RULES.md:14` exige filtrar inactivos salvo Auditoría. D7 (y E15-7, que no admite depender del job) obliga a leer una extensión `ANULADO` con `is_active = false` y un `PedidoVenta` dado de baja. Precedentes en la spec: §2.7.b (búsqueda sin filtrar `is_active` para devolver 409) y §2.13.9 (visibilidad histórica de terminales en E9). Se documenta como desvío justificado, acotado (cliente de sesión, canal WEB, `ANULADO`, motivo `MOTIVO_ANULACION_TTL` y autor Canal Web), de solo lectura y sin exponer datos adicionales. **Criterio de TTL confiable: sí existe** (`anulacion-orden.reglas.ts:27`; `anulacion-orden.service.ts:137-147,280-288,304-322`): no hace falta inventar uno. Dependencia frágil registrada: si HU-E7 cambia el texto o el autor de la vía automática, T03 debe actualizarse.
  - **Resolución (RESUELTA):** de acuerdo con lo documentado (PLAN P6).
- **C5 — E15-4/E15-5 hablan del total de «la respuesta del checkout», pero el flujo actual no usa esa respuesta.** Tras el POST, `CarritoCliente` navega siempre a `/tienda/checkout/pendiente` (`CarritoCliente.tsx:78`), que relee todo en el servidor; `checkout_url`, `total` y `ttl_expiracion` de la respuesta 201 no se usan. No es contradicción de contrato (D5 admite cualquiera de las dos fuentes y ambas son `PedidoVenta.total`), pero el plan (P8) fija una única fuente —la lectura server-side de la pantalla pendiente— y el diálogo existe solo allí. El caso «recarga con el mismo total» se verifica comparando la respuesta 201 con dos lecturas posteriores.
  - **Resolución (RESUELTA):** de acuerdo con lo documentado (PLAN P8).
- **C6 — «Proceder al pago» nombra una acción que primero reserva.** El botón del carrito ejecuta `POST /api/tienda/checkout`, que reserva stock y crea el pedido; el pago ocurre después, en Mercado Pago, tras el diálogo. El texto lo fija la spec (E15-1) y D1, por lo que se implementa tal cual; el aviso de plazo de T02 mitiga la ambigüedad explicando que al continuar se reserva. Se registra para UX, sin reabrir la decisión.
  - **Resolución (RESUELTA):** de acuerdo con lo documentado (D1 sin cambios).
- **C7 — Vencimiento dentro del diálogo vs. resto de la página.** D4 pide que con minutos ≤ 0 el diálogo oculte «Continuar» y muestre el estado vencido; el resto de la página (selector, total, hora) sigue renderizado como vigente hasta la próxima recarga, porque el estado de la página se deriva en el servidor. No contradice la spec (E15-7 se cumple al recargar y la reserva/preferencia vencen igual en servidor y MP). El plan no agrega `router.refresh()` automático para respetar «sin fetch, sin mutación» del diálogo; el enlace del estado vencido del diálogo lleva al catálogo. Si se prefiere refrescar la página al vencer, es un cambio de D4 a confirmar.
  - **Resolución (RESUELTA — AJUSTE a D4, nueva D4.1 del PLAN):** mientras la reserva está vigente, «Volver» solo cierra el diálogo (sin request, sin `router.refresh()`). Si al abrir o mientras está abierto los minutos llegan a ≤ 0, el diálogo oculta «Continuar», muestra el mensaje de reserva vencida y ofrece «Volver al catálogo». Cerrar el diálogo en ese estado vencido dispara `router.refresh()` para que la página se re-derive en el servidor y muestre «Reserva vencida». Solo lectura, sin mutación. Impacta T05 (alcance, contrato, tests, STOP), T06 (test de la vista tras el refresh), T07 (caso nuevo), G3 y la matriz §6 del PLAN.

---

## 4. Registro de ejecución

| Task | Estado | Fecha | Evidencia |
|---|---|---|---|
| PLAN + TASKS | APROBADO (Revisión 2, resoluciones C1–C7) | 20/10/2026 | Respuesta del owner a §3 |
| T00 | Aprobada | 20/10/2026 | Relevamiento §2 del PLAN confirmado sin diferencias. Baseline: `npm test` 1232/1232; `typecheck` OK; `lint` 0 errores / 6 warnings preexistentes fuera de E15; `hu-e1.integration` 21/21; `hu-e2.integration` 11 pass / 2 fail (falla conocida, ver abajo); `hu-e4.integration` 27/27; `hu-e7.integration` 11/11; `hu-e8.http.integration` 13/13 |
| T01 | Aprobada | 20/10/2026 | `minutosDePlazoCheckout`, `minutosRestantesReserva`, `resolverPlazoCheckoutMinutos` (`pedido-web.reglas.ts`) + `obtenerPlazoReservaCheckoutMinutos` (`checkout.service.ts`). `hu-e15.unit.test.ts` 8/8 (+ `hu-e1.unit` 11/11); typecheck OK; lint 0 errores (6 warnings preexistentes). Desvío aprobado: ver §4.3 |
| T02 | Aprobada | 20/10/2026 | Botón «Proceder al pago», `AvisoPlazoReserva` y prop `plazoReservaMinutos` (`CarritoCliente.tsx`), lectura en `carrito/page.tsx`, regex de `hu-e8.http.integration.test.ts:174` ampliada. `checkout-e15.test.tsx` 8/8; `hu-e8.http.integration` 13/13; HTML real verificado (visitante, Juan Pérez vinculado, María Gómez pendiente, configuración inválida y ausente → 200 con texto genérico); typecheck OK; lint 0 errores. Desvío: T02-D1 (§4.3) |
| — | Autorización | 20/10/2026 | El owner autoriza ejecución continua T03–T08 (ver Reglas de ejecución) |
| T03 | Completa (ejecución continua) | 20/10/2026 | `obtenerPedidoWebVencidoPorTtl` (`checkout.service.ts`) con predicado P6 (ANULADO, baja lógica, `deleted_by` = Canal Web, `MOTIVO_ANULACION_TTL`, cliente de sesión, canal WEB) y uso en `pendiente/page.tsx` solo cuando las lecturas E1/E2 devuelven `null`. `hu-e15.integration` T03.1–T03.5 6/6 (post-job vencida, ajeno, manual con mismo motivo, rechazado, vigente y mostrador; lectura sin mutación); `hu-e1.unit` + `hu-e15.unit` 19/19; typecheck OK; lint OK |
| T04 | Completa (ejecución continua) | 20/10/2026 | `SelectorMedioPagoInformativo.tsx` (fieldset/legend, un único radio marcado «Mercado Pago» + aclaración de tarjetas, sin form/handlers/red) insertado en la rama vigente de `CheckoutPendienteVista.tsx`; clases nuevas en `compra.module.css`. `checkout-e15.test.tsx` 12/12 (4 nuevos E15-3); typecheck OK; lint OK |
| T05 | Completa (ejecución continua) | 20/10/2026 | `ConfirmarPagoDialog.tsx` (`"use client"`, `Dialog` controlado; total recibido del servidor, «Mercado Pago», minutos con `minutosRestantesReserva` al abrir + intervalo de 15 s solo abierto; «Continuar» → `window.location.assign(checkoutUrl)`; «Volver» solo cierra; vencida → sin «Continuar», mensaje + «Volver al catálogo», cierre → `router.refresh()`) reemplaza el `<a href={checkoutUrl}>` de `CheckoutPendienteVista.tsx`. `checkout-e15.test.tsx` 20/20 (8 nuevos); typecheck OK; lint OK |
| T06 | Completa (ejecución continua) | 20/10/2026 | Sin cambios de comportamiento: la vista ya conservaba el Alert de reintento E2 sin diálogo (E15-6) y un único bloque «Reserva vencida» con explicación y «Volver al catálogo» (E15-7), al que `pendiente/page.tsx` llega antes y después del job (T03). Se documentó la garantía en la cabecera de `CheckoutPendienteVista.tsx`. `checkout-e15.test.tsx` 24/24 (4 nuevos E15-6/E15-7); typecheck OK; lint OK |
| T07 | Completa (ejecución continua, retomada tras la pausa §4.4) | 20/10/2026 | `hu-e15.integration` 17/17 (servicio T03.1–T03.5 + T07.1–T07.5; HTTP H1–H5); `checkout-e15.test.tsx` 24/24; `hu-e15.unit` 8/8 dentro de `npm test`; `package.json` con `test` y `test:integration:e15`. Regresión completa sin diferencias con el baseline salvo los tests nuevos (tabla §4.5); build OK; servidores apagados y puertos 3000/3101 libres |
| T08 | Completa (ejecución continua) | 20/10/2026 | `HU15_MODULO_E.md` §10 (estado de cierre, §10.1 cumplimiento E15-1…E15-7, §10.2 pendientes fuera de la HU) y este registro completos. `spec_modulo_E.md` sin cambios (C1) |

### 4.1. Falla conocida del baseline (ajena a E15, no se corrige en esta HU)

- **`hu-e2.integration.test.ts` — subtest «P-R2 — reproceso G11 de un pedido EN_PREPARACION cuyo evento post-commit se perdió (R8)».** En `:296` espera `estado_ecommerce === "EN_PREPARACION"` tras confirmar el pago y recibe `PAGO_CONFIRMADO`. Causa: HU-E13 R1 (spec §2.13.1) cambió la confirmación de pago para persistir `PAGO_CONFIRMADO`, y este test de E2 no se actualizó. Cuenta como 2 fails en el reporte (el subtest y la suite que lo contiene). La regresión de T07 se compara contra este mismo resultado: E15 no debe agregar fallas nuevas en esa suite.

### 4.2. Entorno de test usado

- **Base:** `swat_erp_test_e15` (PostgreSQL del `docker-compose`, contenedor `swat_erp_postgres`), creada en T00 con `prisma migrate deploy` y el seed vigente. Motivo: `swat_erp_test_e1` y `swat_erp_test_e2` están atrasadas 11 migraciones; no se tocaron, ni tampoco la base de desarrollo `swat_erp_db`.
- **URL:** `postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e15?schema=public`, pasada por las variables `HU_E{n}_INTEGRATION_DATABASE_URL` de cada suite.
- **Servidor HTTP para suites `*.http.integration`:** `next dev -p 3101` con `DATABASE_URL` apuntando a esa base, `MP_MODO=simulado` y `APP_PUBLIC_URL=http://localhost:3101` (procedimiento de `HU8_MODULO_E.md:280-283`), levantado solo mientras corren las pruebas.

### 4.5. Regresión final T07 — baseline (T00) vs final

Ambas corridas sobre `swat_erp_test_e15` recién sembrada (la final, tras recrearla por T07-E1), servidor `next dev -p 3101` para las suites HTTP.

| Verificación | Baseline T00 | Final T07 | Diferencia |
|---|---|---|---|
| `npm test` | 1232 / 1232 | 1240 / 1240 | +8 (`hu-e15.unit.test.ts`) |
| `npm run typecheck` | OK | OK | — |
| `npm run lint` | 0 errores / 6 warnings | 0 errores / 6 warnings | mismos 6 warnings, fuera de E15 |
| `hu-e1.integration` | 21 / 21 | 21 / 21 | — |
| `hu-e2.integration` | 11 pass / 2 fail (P-R2) | 11 pass / 2 fail (P-R2) | — (falla conocida §4.1) |
| `hu-e4.integration` | 27 / 27 | 27 / 27 | — |
| `hu-e7.integration` | 11 / 11 | 11 / 11 | — |
| `hu-e8.http.integration` | 13 / 13 | 13 / 13 | — (línea 174 ampliada en T02) |
| `hu-e15.integration` | — | 17 / 17 | nueva |
| Componentes (`checkout-e15` + `cancelar-pedido-web`, `mis-pedidos`, `ConsolaPickPack`) | — | 55 / 55 | 24 nuevos de E15 |
| `next build` | — | OK | — |

**Gates:** G1–G6 cumplidos (G2 verificado: sin cambios en `route.ts` del checkout, `ejecutarTransaccionCheckout`, `pago-web.service.ts`, schema, seed, adapter ni job).

**Límite de la evidencia:** la interacción del diálogo en navegador (abrir, refresco del contador, cierre en estado vencido con `router.refresh()`) se verifica sobre la fuente (`checkout-e15.test.tsx`) y por las reglas puras; no se automatizó un navegador. Sus resultados server-side (página «Reserva vencida» tras recargar, sin mutación) sí están cubiertos por H3/H4. Ver pasos manuales en el reporte de cierre.

### 4.4. Punto de pausa — 20/10/2026 (pedido del owner) — RESUELTO

**Retomado el 20/10/2026:** estado verificado (archivos completos, typecheck OK, lint 0 errores); pasos 1–5 de abajo ejecutados (ver §4.5).

**Task:** T07 (tests de integración y regresión). T00–T06 completas.

**Hecho en T07 antes de la pausa:**
- `hu-e15.integration.test.ts` ampliado: nivel servicio T07.1–T07.5 (total congelado con cupón y recarga, bordes del TTL, vencida pre-job, enlace ausente + reintento E2, body sin medio ni importe) y test HTTP H1–H5 (visitante, cuenta pendiente, vinculada con selector/diálogo/total, vencida antes y después del job, configuración inválida/ausente). Corrida completa: **17/17 pass** contra `next dev -p 3101` sobre `swat_erp_test_e15`.
- `package.json`: `hu-e15.unit.test.ts` agregado al script `test`; script nuevo `test:integration:e15`. JSON válido.
- Primera pasada de regresión (base reutilizada): e1 21/21, e2 11/13 (falla conocida P-R2), e4 27/27, e7 9/11 (subtest 2b, ver T07-E1), e8-http 13/13.
- Base `swat_erp_test_e15` recreada desde cero (T07-E1).

**Paso exacto donde se interrumpió:** lanzamiento de la segunda pasada de regresión sobre la base recreada (e1, e2, e4, e7, e8-http, e15). **El owner rechazó esa ejecución: no corrió.** El servidor de test se apagó y el puerto 3101 quedó libre; no quedan procesos `next` ni de tests del proyecto.

**Pendiente para retomar T07:**
1. Levantar `next dev -p 3101` sobre `swat_erp_test_e15` (§4.2).
2. Segunda pasada de regresión en el orden del baseline + `test:integration:e15`.
3. `npm test` completo (incluye ahora `hu-e15.unit.test.ts`), `node --import tsx --test src/components/tienda/checkout-e15.test.tsx`, `typecheck`, `lint`.
4. `next build` (con el servidor de test apagado, comparte `.next`).
5. Apagar servidor y verificar puerto libre; registrar la tabla de regresión.

**Estado de los archivos:** ninguno a medio editar. Tras la última edición: `typecheck` OK, `eslint` de `hu-e15.integration.test.ts` OK, `package.json` válido.

### 4.3. Desvíos aprobados

- **T01-D1 (aprobado por el owner, 20/10/2026).** La degradación de configuración de P2 (`CONFIGURACION_INVALIDA` / `CONFIGURACION_NO_ENCONTRADA` → `null`, otros errores se propagan, log solo con el código) vive en la función pura `resolverPlazoCheckoutMinutos(leerHoras)` de `pedido-web.reglas.ts`, con el lector inyectado, en lugar de dentro de `checkout.service.ts`. Motivo: `checkout.service.ts` es `server-only` y usa Prisma, por lo que no puede importarse desde un unit test con `--experimental-strip-types`. `obtenerPlazoReservaCheckoutMinutos()` de `checkout.service.ts` sigue siendo la función pública (envuelve `resolverPlazoCheckoutMinutos(obtenerTtlCheckoutHoras)`). Comportamiento idéntico; archivos dentro de los autorizados de T01.
- **T02-D1.** Los tests de componentes (`checkout-e15.test.tsx`) aseveran sobre la fuente en lugar de renderizar con `renderToStaticMarkup`: los componentes de la tienda importan CSS modules que Node no carga fuera del bundler (mismo molde que `cancelar-pedido-web.test.ts`). El render real se verifica por HTTP contra `next dev` (T02 y T07). Un stub de CSS habría requerido un archivo no autorizado.
- **T07-E1 (entorno).** En la primera pasada de regresión, `hu-e7.integration` subtest «2b» falló porque la propia suite E7 anula el fixture del seed `PEDIDO_WEB_PAGO_RECHAZADO` (autor Administrador, motivo «Fixture rechazado sin reintento», un solo asiento, de la corrida del baseline) y no es repetible sobre la misma base. E15 no toca ese fixture. Se recreó la base descartable `swat_erp_test_e15` (`DROP DATABASE … WITH (FORCE)` + `CREATE` + `migrate deploy` + seed) para comparar contra el baseline en igualdad de condiciones; el fixture volvió a `PAGO_RECHAZADO` activo.
- **T02-O1 (observación, sin cambio).** El texto genérico de D2 («Al iniciar la compra reservamos el stock por un tiempo limitado…») convive con el botón «Proceder al pago»; se conservó literal porque D2 manda «el texto genérico actual».
