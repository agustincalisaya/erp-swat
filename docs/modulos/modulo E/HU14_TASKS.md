# SDD — HU-E14: Tasks de implementación

## Alcance y reglas

- **HU:** HU-E14 (backlog Sprint 5, fila 10) — Operador de Pick & Pack: "ver en cada tarjeta de Preparación de pedidos los datos de la venta que necesito para despachar (número de venta, cliente y fecha) para vincular cada despacho con su venta sin salir a buscarla a otra pantalla". 2 SP.
- **Contrato normativo:** `docs/specs/spec_modulo_E.md` §6.3 (filas E14-1 a E14-5 y párrafo final). Contexto vigente: §2.10 (matriz de permisos y segregación: el Operador no accede a facturación ni pago), §2.12 (cola de preparación; por la nota Rev.7 la ruta real es `/api/ecommerce/preparacion/**`, no `pick-pack/**`) y §2.13.15 (convención de lectura administrativa: `total` como string de 2 decimales).
- **Reglas transversales (`RULES.md`):** baja lógica (§1: las consultas filtran `is_active = true` / `deleted_at IS NULL`; nunca `DELETE`, tampoco en tests), Ley 25.326 (§2: la proyección expone solo `Cliente.nombre`, nunca DNI, email ni teléfono), Adapter/Gateway (E14 no toca integraciones externas).
- No se amplía el alcance de §6.3. **No se crean endpoints nuevos** ni pantalla de detalle de pedido (E14-5).
- **Sin cambios de `prisma/schema.prisma` ni migraciones.** Verificado contra el schema: `PedidoVenta.numero_venta`, `PedidoVenta.total` (`Decimal(12,2)`), `PedidoVenta.cliente_id` (nullable) → `Cliente.nombre/is_active/deleted_at`, `PedidoVentaEcommerce.fecha_pago_confirmado`, `PedidoVentaItem.cantidad/is_active/deleted_at` y `VentaMedioPago.medio` (enum `MedioPagoVenta`) ya alcanzan. Si una task descubre que hace falta algo de schema, **frena y reporta**.
- Esta fase no implementa código ni ejecuta operaciones Git. Este archivo es el backlog técnico ejecutable de HU-E14.

### Hallazgos previos verificados contra el código

| Hallazgo | Estado | Evidencia |
|---|---|---|
| La cola ya devuelve `numero_venta`, `fecha_pago_confirmado` y unidades vía `progreso.total_requerido`; le falta el nombre del cliente. | **Confirmado.** `total_requerido` = suma de `cantidad` de ítems con `is_active: true, deleted_at: null`. El `include` de `pedido_venta` hoy selecciona solo `{ id, numero_venta }`. También se incluye `operador_asignado` (`id`, `nombre_completo`) pero no se expone en el DTO. | `pick-pack.service.ts:427-576` (`include` en 470-479, ítems en 487-501, `calcularProgreso` 401-415) |
| No hay endpoint de detalle; `DetallePreparacionDto` no se usa. El "detalle en preparación" es el panel de la consola, alimentado por el ítem de la cola y las respuestas de scan/completar. | **Confirmado.** `DetallePreparacionDto` no tiene ninguna referencia fuera de `pick-pack.types.ts`. `PreparacionPedidoPanel` recibe `ItemColaPreparacionJson` y se actualiza con `ResultadoConfirmarJson` / `ResultadoCompletarJson`. | `pick-pack.types.ts:50-63`, `PreparacionPedidoPanel.tsx:122-145` |
| Total = `PedidoVenta.total` (Decimal congelado). Medio = `VentaMedioPago` activo (solo `medio`; `referencia` es el `payment_id` y NO se expone). | **Confirmado.** `facturarPedidoVentaTx` crea **un** `VentaMedioPago` `{ medio: "MERCADO_PAGO", importe: total, referencia: payment_id }` por pedido web (`pago-web.service.ts:504`). El seed hace lo mismo para V-2026-000006/7 (`referencia: "1320000000006"` / `"1320000000007"`). | `pedido-venta.service.ts:499-535`, `seed.ts:4806-4816` |
| Las respuestas de tomar/scan/completar/prioridad/validar-retiro no exponen datos de pago. | **Confirmado.** Las cuatro rutas de `[pedidoVentaId]/**` devuelven `{ data }` tal cual del servicio (`ResultadoTomarPedido`, `ResultadoConfirmarItem`, `ResultadoCompletarPreparacion`, `PrioridadResultado`: sin total, medio ni payment_id). `validar-retiro` arma un literal `{ pedido_venta_id, numero, estado }`. | `pick-pack.types.ts:65-127`, `validar-retiro/route.ts:19` |

### Decisiones de diseño fijadas

| # | Decisión |
|---|---|
| D1 | `GET /api/ecommerce/preparacion` sigue protegida por `withPermission("ecommerce:leer_cola_preparacion", …)`. Dentro del handler, después de validar la query y **antes** de llamar al servicio, resuelve `usuarioTienePermiso(session.userId, "ecommerce:leer_historial_ordenes")` y pasa `listarColaPreparacion(parsed.data, { incluirDatosPago })`. El segundo parámetro es **opcional** con default `{ incluirDatosPago: false }` (default seguro): los callers existentes (`pick-pack.integration.test.ts`, `hu-e13.integration.test.ts`, `hu-e2-e12.integration.test.ts`) compilan sin cambios. `usuarioTienePermiso` no cachea: la revocación tiene efecto en el siguiente request. **Nunca** se compara nombre de rol. |
| D2 | **Proyección base** (sin pago): el ítem de cola agrega `cliente_nombre: string \| null` (solo `Cliente.nombre`) y `unidades_totales: number` (suma de `cantidad` de los `PedidoVentaItem` activos, la misma lista que alimenta `lineas`; por construcción igual a `progreso.total_requerido`). El `select` de `pedido_venta` pasa a `{ id, numero_venta, cliente: { select: { nombre, is_active, deleted_at } } }`. En modo base **no** se seleccionan `PedidoVenta.total`, `VentaMedioPago`, `TransaccionPagoLog` ni `ComprobanteFiscal`: no se consultan (no "se filtran después"). |
| D3 | **Proyección con pago:** solo si `incluirDatosPago === true`, el `select` de `pedido_venta` suma `total: true` y se hace **una** consulta extra `ventaMedioPago.findMany({ where: { pedido_venta_id: { in }, is_active: true, deleted_at: null }, select: { pedido_venta_id: true, medio: true }, orderBy: { created_at: "asc" } })` (nunca `referencia` ni `importe`). Cada ítem gana `pago: { total: string; medios: MedioPagoVenta[] }`, con `medios` sin duplicados en orden de alta (`[]` si no hay medio activo). En la proyección base la clave `pago` está **ausente** (no `null`, no `undefined` asignado). **Serialización del Decimal:** `PedidoVenta.total.toFixed(2)` → `string`, convención vigente de las lecturas administrativas del módulo E (`pedidos-pagados-admin.service.ts:92`, contrato §2.13.15 `total: string`; `anulacion-orden.service.ts:388`). Ver C6. |
| D4 | Tipos separados. `pick-pack.types.ts`: `ColaPreparacionItemDto` (base, + `cliente_nombre`, `unidades_totales`), `DatosPagoColaPreparacionDto`, `ColaPreparacionItemConPagoDto extends ColaPreparacionItemDto { pago }`, `PaginacionColaPreparacionDto` (base) y `PaginacionColaPreparacionConPagoDto`, `OpcionesColaPreparacion { incluirDatosPago?: boolean }`. `listarColaPreparacion` se declara con dos overloads: `(filtros, { incluirDatosPago: true }) → ConPago` y `(filtros, opciones?) → base` (el overload base **último**, para que `ReturnType<typeof listarColaPreparacion>` de `hu-e2-e12` siga resolviendo al tipo base). `pick-pack-client.ts`: `ItemColaPreparacionJson` (base), `PagoColaPreparacionJson`, `ItemColaPreparacionConPagoJson`, `ColaPreparacionJson.items: Array<ItemColaPreparacionJson \| ItemColaPreparacionConPagoJson>` y el guard `tieneDatosPago(item): item is ItemColaPreparacionConPagoJson` (`"pago" in item`). `DetallePreparacionDto` no se toca (DT-1). |
| D5 | Cliente no resoluble → `cliente_nombre: null`: `cliente_id` nulo, o `Cliente` con `is_active = false` o `deleted_at != null` (RULES §1). **No** se sigue `fusionado_en_id` (exponer al primario sería "otra identidad", prohibido por el párrafo final de §6.3; ver C5). La UI muestra la etiqueta fija **"Cliente no disponible"** (`TEXTO_CLIENTE_NO_DISPONIBLE` en `pick-pack-client.ts`, molde de `TEXTO_FECHA_PAGO_LEGACY`). |
| D6 | UI: `TarjetaPedidoCola` muestra número (ya está), cliente, fecha de pago (ya está, mismo formateador) y unidades totales (`"1 unidad"` / `"N unidades"`). Total y medio se renderizan **solo** si `tieneDatosPago(pedido)`; la tarjeta no recibe ningún flag de permiso nuevo y `page.tsx` no cambia. Labels de medio con `ETIQUETA_MEDIO_PAGO: Record<MedioPagoVentaJson, string>` en `pick-pack-client.ts` (fallback al valor crudo si llega uno desconocido); total con `Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })` sobre el string. Sin `<a>`/`Link` a detalle de pedido (E14-5). Se conservan intactas las acciones de HU-E12 (Tomar, Continuar preparación, ControlPrioridad) y la barra de progreso. `PreparacionPedidoPanel` no cambia. |
| D7 | tomar/scan/completar/prioridad/validar-retiro **no cambian**. Se agrega un test de regresión de servicio que fija el conjunto exacto de claves de `ResultadoTomarPedido`, `ResultadoConfirmarItem`, `ResultadoCompletarPreparacion` y `PrioridadResultado` y verifica que su JSON no contiene `pago`, `total`, `medio`, `referencia` ni el `payment_id` del fixture. `validar-retiro` ya arma un literal de 3 claves en la ruta: se deja constancia en la evidencia, sin test nuevo. |
| D8 | Sin cambios de schema ni migraciones. **Seed: alcanza con lo existente** (V-2026-000006 libre y V-2026-000007 tomado, ambos con cliente Juan Pérez activo, `PedidoVenta.total` y `VentaMedioPago` `MERCADO_PAGO`). "Cliente no disponible" se demuestra con fixtures propios de los tests de servicio y UI; no se agrega pedido al seed (ver C9; pendiente de confirmación). |
| D9 | `package.json` se edita **una única vez, en T01**: `test:integration:e14`, `test:integration:e14-http` (molde de `test:integration:e16` / `e16-http`) y `test:unit:e14` = `node --import tsx --test src/components/ecommerce/ConsolaPickPack.test.tsx src/components/ecommerce/pick-pack.client.test.ts` (los tests de componentes se corren con `tsx`, no con `--experimental-strip-types`; HU15_MODULO_E.md:99). Ninguna otra task toca `package.json`. |
| D10 | T04 agrega a `spec_modulo_E.md` una **nota aditiva de cierre** debajo del párrafo final de §6.3 (sin reescribir lo existente) y la evidencia en `docs/modulos/modulo E/HU14_MODULO_E.md`. |

---

## 1. Resumen ejecutivo

HU-E14 se divide en **4 tasks** que se ejecutan de corrido (los STOP originales quedaron anulados por el revisor, ver §8). No hay modelo, migración ni endpoint nuevo: el trabajo es ampliar la proyección de `listarColaPreparacion` en dos variantes (base y con pago) decididas por una opción explícita (T01), resolver el permiso de historial en el handler HTTP y verificar el JSON real por usuario (T02), mostrar los datos en la tarjeta sin lógica de permisos en el cliente (T03) y cerrar con verificación integral, evidencia y nota aditiva en la spec (T04).

---

## 2. Tabla resumida T01–T04

| ID | Título | Archivo(s) principal(es) | Dependencia | STOP | Riesgo merge |
|---|---|---|---|---|---|
| T01 | Servicio: proyección base / con pago, tipos y scripts | `src/lib/services/ecommerce/pick-pack.types.ts`, `pick-pack.service.ts`, `hu-e14.integration.test.ts` (nuevo), `package.json` (única edición) | Aprobación de este TASKS | No | Medio (`pick-pack.service.ts`, `package.json`) |
| T02 | HTTP: permiso de historial en el handler | `src/app/api/ecommerce/preparacion/route.ts`, `hu-e14.http.integration.test.ts` (nuevo) | T01 | ~~Sí~~ anulado | Bajo |
| T03 | UI: tarjeta con cliente, unidades y pago condicional | `src/components/ecommerce/pick-pack-client.ts`, `ConsolaPickPack.tsx` (+ sus tests) | T02 | ~~Sí~~ anulado | Bajo |
| T04 | Verificación integral, evidencia y nota §6.3 | `docs/modulos/modulo E/HU14_MODULO_E.md` (nuevo), `docs/specs/spec_modulo_E.md` (nota aditiva) | T01–T03 | No | Bajo |

### Mapa CA §6.3 → tasks

| CA / caso | T01 | T02 | T03 | T04 |
|---|---|---|---|---|
| E14-1 (número, cliente, `fecha_pago_confirmado`, unidades = suma de ítems vigentes; nada sustituido por facturación) | ✔ | ✔ (JSON) | ✔ (tarjeta) | ✔ |
| E14-2 (proyección base de cola y "detalle" sin total, medio ni datos fiscales) | ✔ (sin consulta) | ✔ (JSON operador) | ✔ (no renderiza lo que no llega) | ✔ |
| E14-3 (con `leer_historial_ordenes`: total congelado + medio desde la venta/pago registrado) | ✔ | ✔ (JSON admin) | ✔ | ✔ |
| E14-4 (permiso resuelto antes del `select`; verificación sobre el JSON HTTP) | ✔ (opción explícita) | ✔ | | ✔ |
| E14-5 (sin enlace a detalle; acciones HU-E12 intactas) | | | ✔ | ✔ |
| Párrafo final: autorización por permiso, nunca por rol | | ✔ | | ✔ |
| Párrafo final: etiqueta de cliente no disponible, sin otra identidad | ✔ (`null`) | | ✔ (etiqueta) | ✔ |
| Párrafo final: ambas proyecciones cubiertas en servicio y API | ✔ | ✔ | | ✔ |
| D7: tomar/scan/completar/prioridad sin datos de pago | ✔ (regresión) | | | ✔ |

---

## 3. Detalle completo de tasks

### T01 — Servicio: proyección base / con pago, tipos y scripts

- **Objetivo:** que `listarColaPreparacion` devuelva `cliente_nombre` y `unidades_totales` siempre, y el bloque `pago` solo cuando el caller lo pide explícitamente, sin consultar datos de pago en la variante base.
- **Dependencia previa:** aprobación de este TASKS.
- **Archivos autorizados:**
  - `src/lib/services/ecommerce/pick-pack.types.ts`
  - `src/lib/services/ecommerce/pick-pack.service.ts` (solo `listarColaPreparacion` y, si hace falta, un helper privado nuevo junto a ella)
  - `src/lib/services/ecommerce/hu-e14.integration.test.ts` (nuevo)
  - `package.json` — **única edición de HU-E14 (D9)**: `test:integration:e14`, `test:integration:e14-http`, `test:unit:e14`.
- **Archivos prohibidos:** `prisma/**`, `src/app/**`, `src/components/**`, `with-permission.ts`, `pedido-venta.service.ts`, el resto de funciones de `pick-pack.service.ts` (`tomarPedido`, `actualizarPrioridad`, `confirmarItem`, `completarPreparacion`, `admitirPedidoPagoConfirmado`), los tests existentes de pick-pack / hu-e13 / hu-e2-e12.
- **Cambios previstos:**
  - `pick-pack.types.ts` (D4):
    - `ColaPreparacionItemDto` gana `cliente_nombre: string | null` (JSDoc: solo `Cliente.nombre`; `null` si no resoluble, §6.3) y `unidades_totales: number` (JSDoc: suma de cantidades de ítems vigentes, E14-1).
    - `export interface DatosPagoColaPreparacionDto { total: string; medios: MedioPagoVenta[] }` (`import type { MedioPagoVenta } from "@prisma/client"`; JSDoc: `total` = `PedidoVenta.total.toFixed(2)`; sin `referencia`/`importe`).
    - `export interface ColaPreparacionItemConPagoDto extends ColaPreparacionItemDto { pago: DatosPagoColaPreparacionDto }`.
    - `export interface PaginacionColaPreparacionConPagoDto extends Omit<PaginacionColaPreparacionDto, "items"> { items: ColaPreparacionItemConPagoDto[] }`.
    - `export interface OpcionesColaPreparacion { incluirDatosPago?: boolean }`.
    - Ajustar el comentario de cabecera ("no exponen … pagos") para aclarar que la única excepción es `ColaPreparacionItemConPagoDto`, condicionada a `ecommerce:leer_historial_ordenes` (§6.3 E14-3). Corregir el comentario `GET /api/ecommerce/pick-pack/cola` → `/api/ecommerce/preparacion`.
  - `pick-pack.service.ts`, `listarColaPreparacion`:
    1. Overloads según D4; implementación `(filtros, opciones: OpcionesColaPreparacion = {})` con `const incluirDatosPago = opciones.incluirDatosPago === true`.
    2. Conteo y `$queryRaw` de ids/orden/paginación **sin cambios** (mismo `ORDER BY`, `LIMIT`, `OFFSET`).
    3. El `select` de `pedido_venta` se construye **antes** del `findMany` según el flag: base `{ id, numero_venta, cliente: { select: { nombre, is_active, deleted_at } } }` (del `Cliente` se seleccionan **solo** esos tres campos); con pago agrega `total: true`. Como una relación to-one de Prisma no admite `where`, el filtro de baja lógica del cliente (`is_active = true`, `deleted_at = null`) se aplica **en el mapeo** (paso 5). El `include` de `operador_asignado` **se conserva** (DT-4).
    4. Solo con pago: `ventaMedioPago.findMany` según D3 y `Map<pedido_venta_id, MedioPagoVenta[]>` sin duplicados.
    5. Mapeo: `cliente_nombre = c && c.is_active && c.deleted_at === null ? c.nombre : null`; `unidades_totales = lineasRaw.reduce((acc, l) => acc + l.cantidad, 0)`; si con pago, `pago: { total: pve.pedido_venta.total.toFixed(2), medios }`. En base el objeto literal **no** declara la clave `pago`.
    6. JSDoc: `@param opciones.incluirDatosPago` (lo decide el caller con `usuarioTienePermiso`, nunca por rol) y referencia a §6.3.
  - `package.json`: las tres entradas de D9, junto a `test:integration:e16-http`.
- **Tests obligatorios** (`hu-e14.integration.test.ts`; molde de `pick-pack.integration.test.ts`: `skip` sin `HU_E14_INTEGRATION_DATABASE_URL`, assert de nombre de base `/test/i`, fixtures propios creados con Prisma —cliente, `PedidoVenta` WEB `FACTURADO`, `PedidoVentaEcommerce` `PAGO_CONFIRMADO`/`EN_PREPARACION` con `fecha_pago_confirmado`, ítems, `VentaMedioPago` `MERCADO_PAGO` con `referencia` conocida—; nunca `delete`; bajas por `update` de `is_active`/`deleted_at`):
  1. **Proyección base sin `pago`:** para el ítem del fixture, `assert.equal(Object.hasOwn(item, "pago"), false)` y `assert.deepEqual(Object.keys(item).sort(), [...claves base])`; `JSON.stringify(item)` no contiene el `total`, `MERCADO_PAGO` ni la `referencia` del fixture, ni DNI/email/teléfono del cliente.
  2. **La base no consulta datos de pago:** el test instala un `PrismaClient` espía con `log: [{ emit: "event", level: "query" }]` en `globalThis.prisma` **antes** del `import()` dinámico de `pick-pack.service.ts` y de `db/prisma.ts` (que reutiliza `globalThis.prisma`), y captura el SQL de `listarColaPreparacion(filtros)`. Primero asierta que se capturó al menos una query sobre `pedidos_venta_ecommerce` (el test no puede pasar en verde sin capturar nada); después, que ninguna sentencia menciona `venta_medios_pago`, `log_transacciones_pago` ni `comprobantes_fiscales`, y ninguna selecciona la columna `"total"` de `pedidos_venta`. Con `{ incluirDatosPago: true }` sí aparecen `"total"` y `venta_medios_pago`, y nunca `"referencia"` ni `log_transacciones_pago`.
  3. **Proyección con pago:** `pago.total === pedido.total.toFixed(2)` leído de BD (fixture con centavos, p. ej. `12345.50` → `"12345.50"`), `pago.medios` deep-equal `["MERCADO_PAGO"]`; un `VentaMedioPago` dado de baja no aparece; un pedido sin medio activo → `medios: []`.
  4. **Cliente null:** pedido con `cliente_id = null` → `cliente_nombre: null`; cliente con `is_active = false` → `null`; cliente con `deleted_at` → `null`; cliente secundario fusionado (`fusionado_en_id` → primario activo) → `null` y el nombre del primario no aparece en el JSON.
  5. **Unidades:** pedido con ítems de cantidad 2 y 3 más un ítem de cantidad 5 dado de baja → `unidades_totales === 5 === progreso.total_requerido`, y `lineas` no incluye el ítem dado de baja.
  6. **Orden y paginación intactos:** para los mismos `{ page, page_size }` (incluido un page_size chico que corte la página), base y con pago devuelven el mismo `total` y la misma secuencia de `pedido_venta_id`; el orden respeta `prioridad_manual DESC NULLS LAST, fecha_pago_confirmado ASC NULLS LAST, id ASC` sobre los fixtures.
  7. **Regresión D7:** sobre un fixture propio, `tomarPedido`, `actualizarPrioridad`, `confirmarItem` y `completarPreparacion` devuelven exactamente sus claves documentadas y su `JSON.stringify` no contiene `pago`, `"total"`, `medio`, la `referencia` ni el total del fixture.
  - Regresión obligatoria: `pick-pack.integration.test.ts` (`HU_E12_PICK_PACK_INTEGRATION_DATABASE_URL`), `npm run test:integration:e13` (`hu-e13.integration.test.ts`) y `hu-e2-e12.integration.test.ts` (`HU_E2_E12_INTEGRATION_DATABASE_URL`), **sin modificarlos**. `npx tsc --noEmit`.
- **Definition of Done:** callers existentes compilan y pasan sin cambios; en modo base no hay SQL sobre pago/facturación (test 2); la clave `pago` está ausente en base; Decimal como string `toFixed(2)`; `package.json` con las tres entradas y ninguna otra modificación.
- **CA que cubre:** E14-1, E14-2, E14-3, E14-4 (lado servicio), párrafo final (cliente no resoluble, ambas proyecciones), D7.
- **Qué NO incluye:** resolución del permiso (T02), UI (T03).

---

### T02 — HTTP: permiso de historial en el handler

- **Objetivo:** que `GET /api/ecommerce/preparacion` entregue la proyección con pago solo a quien tiene `ecommerce:leer_historial_ordenes`, verificado sobre el JSON real.
- **Dependencia previa:** T01.
- **Archivos autorizados:**
  - `src/app/api/ecommerce/preparacion/route.ts`
  - `src/lib/services/ecommerce/hu-e14.http.integration.test.ts` (nuevo)
- **Archivos prohibidos:** `package.json`, `with-permission.ts`, `pick-pack.service.ts`, `pick-pack.types.ts`, subrutas `[pedidoVentaId]/**` y `validar-retiro/**`, `page.tsx`, componentes, `prisma/**`.
- **Cambios previstos:**
  - Handler `async (req, session) => …`: tras el `safeParse` exitoso y dentro del `try`, `const incluirDatosPago = await usuarioTienePermiso(session.userId, "ecommerce:leer_historial_ordenes");` y `listarColaPreparacion(parsed.data, { incluirDatosPago })`. Importar `usuarioTienePermiso` desde `@/lib/auth/with-permission`.
  - Cabecera del archivo: sumar "HU-E14: proyección con `pago` solo con `ecommerce:leer_historial_ordenes` (spec E §6.3)". Envelope y códigos (200/400/401/403/500) sin cambios.
- **Tests obligatorios** (`hu-e14.http.integration.test.ts`; molde de `hu-e13.http.integration.test.ts`: `skip` sin `HU_E14_HTTP_BASE_URL` / `HU_E14_HTTP_DATABASE_URL`, servidor real, `Jar` de cookies, `loginInterno` con contraseña de seed `abc123456789`; usa los pedidos del seed V-2026-000006 y V-2026-000007, sin mutarlos):
  1. **Operador:** `operador.pickpack.seed` → 200; los ítems de V-2026-000006/7 tienen `cliente_nombre === "Juan Pérez"` (nombre real del seed), `unidades_totales` 1 y 2, `fecha_pago_confirmado` string ISO, y **ningún** ítem tiene la clave `pago`; el body completo (`JSON.stringify`) no contiene `"pago"`, `MERCADO_PAGO`, `1320000000006`/`1320000000007`, el DNI ni el email de Juan Pérez.
  2. **Administrador:** `admin.ecommerce.seed` → 200; esos ítems tienen `pago.total === PedidoVenta.total.toFixed(2)` leído de la BD y `pago.medios` deep-equal `["MERCADO_PAGO"]`; el body no contiene los `payment_id` ni DNI/email.
  3. **Sin `leer_cola_preparacion` → 403:** usuario de test con un rol propio sin ese permiso (y, para cubrir el caso borde, **con** `leer_historial_ordenes`) → 403 `FORBIDDEN`, sin `data`.
  4. **Revocación inmediata:** rol de test con `leer_cola_preparacion` + `leer_historial_ordenes` asignado a un usuario de test; GET → ítems con `pago`; `rolPermiso.update({ is_active: false })` del permiso de historial (baja lógica, sin re-login, misma cookie) → siguiente GET → 200 sin `pago` en ningún ítem. Rol, usuario y asignaciones con IDs/nombres únicos por corrida; no se tocan los roles del seed.
  5. Sin sesión → 401 (regresión).
- **Definition of Done:** la ruta decide la proyección solo por permiso; JSON verificado para ambos usuarios del seed; revocación con efecto en el request siguiente; ningún archivo fuera de los autorizados.
- **CA que cubre:** E14-2, E14-3, E14-4 (JSON HTTP), párrafo final (permiso, nunca rol).
- **Qué NO incluye:** UI.

> ~~STOP después de T02~~ — anulado por el revisor (ver §8).

---

### T03 — UI: tarjeta con cliente, unidades y pago condicional

- **Objetivo:** mostrar en `TarjetaPedidoCola` los datos de despacho y, si el JSON los trae, total y medio, sin decidir nada por permiso en el cliente.
- **Dependencia previa:** T02 aprobado.
- **Archivos autorizados:**
  - `src/components/ecommerce/pick-pack-client.ts`
  - `src/components/ecommerce/pick-pack.client.test.ts`
  - `src/components/ecommerce/ConsolaPickPack.tsx`
  - `src/components/ecommerce/ConsolaPickPack.test.tsx`
- **Archivos prohibidos:** `package.json`, `page.tsx` (no recibe flags nuevos), `PreparacionPedidoPanel.tsx`, `RetiroPedidoPanel.tsx`, `PedidosWebAdmin.tsx`, servicios, rutas, `prisma/**`.
- **Cambios previstos:**
  - `pick-pack-client.ts` (sigue siendo módulo puro, sin `@prisma/client`):
    - `ItemColaPreparacionJson` + `cliente_nombre: string | null`, `unidades_totales: number`.
    - `export type MedioPagoVentaJson = "EFECTIVO" | "TRANSFERENCIA" | "E_CHEQ" | "MERCADO_PAGO" | "TARJETA" | "CUENTA_CORRIENTE";` (espejo del enum Prisma).
    - `PagoColaPreparacionJson { total: string; medios: MedioPagoVentaJson[] }`, `ItemColaPreparacionConPagoJson`, `ColaPreparacionJson.items` como unión, `tieneDatosPago()` (D4).
    - `export const TEXTO_CLIENTE_NO_DISPONIBLE = "Cliente no disponible";` y `formatearClienteCola(nombre: string | null): string`.
    - `export const ETIQUETA_MEDIO_PAGO: Record<MedioPagoVentaJson, string>` (`Efectivo`, `Transferencia`, `E-Cheq`, `Mercado Pago`, `Tarjeta`, `Cuenta corriente`) y `formatearMediosPago(medios: string[]): string` (unión con ", ", fallback al valor crudo, `"Sin medio registrado"` si viene vacío).
    - `formatearTotalPago(total: string): string` (`Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })`, molde `PedidosWebAdmin.tsx:49`).
    - `formatearUnidades(n: number): string` → `"1 unidad"` / `"N unidades"`.
  - `ConsolaPickPack.tsx`, `TarjetaPedidoCola`:
    - Prop `pedido: ItemColaPreparacionJson | ItemColaPreparacionConPagoJson`.
    - Bajo el número: cliente (`formatearClienteCola`), fecha de pago (formateador existente) y unidades totales (`formatearUnidades(pedido.unidades_totales)`), en una lista de datos (`<dl>`) legible en mobile.
    - Si `tieneDatosPago(pedido)`: filas "Total" (`formatearTotalPago`) y "Medio de pago" (`formatearMediosPago`). No hay rama por permiso ni por rol.
    - Sin `<a>`/`Link` nuevos. Acciones HU-E12, badges de prioridad/estado y barra de progreso sin cambios.
    - Cabecera del componente: reemplazar "No renderiza PII … payment ids" por "Renderiza solo el nombre del cliente destinatario (§2.10/§6.3); total y medio solo si el servidor los incluye; nunca QR, payment ids ni códigos escaneados".
  - Actualizar los fixtures existentes (`pedidoBase` y similares en ambos tests) con `cliente_nombre` y `unidades_totales` para que compilen; sin cambiar sus asserts.
- **Tests obligatorios** (`npm run test:unit:e14`):
  - `ConsolaPickPack.test.tsx` (`renderToStaticMarkup`):
    1. **Sin `pago`:** muestra número, `"Juan Pérez"` (fixture), fecha formateada y `"3 unidades"`; **no** contiene "Total", "Medio de pago", "Mercado Pago" ni `$`.
    2. **Con `pago`:** además muestra el total formateado (p. ej. `"$ 12.345,50"` según `es-AR`) y "Mercado Pago".
    3. **Cliente no disponible:** `cliente_nombre: null` → contiene `"Cliente no disponible"` y ningún otro nombre.
    4. **E14-5:** el markup de la tarjeta (con y sin pago) no contiene `<a ` ni `href=`; con `puedePreparar` sigue mostrando "Tomar pedido" / "Continuar preparación" y con `puedePriorizar` el control de prioridad (regresión de los casos existentes).
    5. Fuente (`readFileSync`): `TarjetaPedidoCola` no referencia `leer_historial_ordenes`, `puedeVerPago` ni nombres de rol.
  - `pick-pack.client.test.ts`: `tieneDatosPago` (con/sin clave), `formatearClienteCola(null)`, `ETIQUETA_MEDIO_PAGO` cubre los 6 valores, `formatearMediosPago([])` y valor desconocido, `formatearTotalPago("12345.50")`, `formatearUnidades(1|2)`.
  - Verificación manual en `npm run dev` con el seed: `operador.pickpack.seed` ve V-2026-000006/7 con cliente, fecha y unidades, sin total ni medio; `admin.ecommerce.seed` ve además total y "Mercado Pago". Capturas para T04.
  - `npx tsc --noEmit`, `npm run lint`.
- **Definition of Done:** la tarjeta muestra los datos de E14-1, el pago solo cuando llega en el JSON, la etiqueta fija de cliente no disponible, sin enlace a detalle y con todas las acciones de HU-E12.
- **CA que cubre:** E14-1 (UI), E14-2/E14-3 (render condicionado al JSON), E14-5, párrafo final (etiqueta).
- **Qué NO incluye:** cambios en el panel de preparación ni en la pantalla de retiro.

> ~~STOP después de T03~~ — anulado por el revisor (ver §8).

---

### T04 — Verificación integral, evidencia y nota §6.3

- **Objetivo:** demostrar §6.3 completo y dejar la evidencia de cierre.
- **Dependencia previa:** T01–T03.
- **Archivos autorizados:**
  - `docs/modulos/modulo E/HU14_MODULO_E.md` (nuevo)
  - `docs/specs/spec_modulo_E.md` — solo nota aditiva (D10).
- **Archivos prohibidos:** código fuente, `package.json`, `prisma/**`.
- **Cambios previstos / verificación:**
  - Nota aditiva debajo del párrafo final de §6.3, p. ej. "**Cierre HU-E14 (DD/MM/2026) — registro no normativo.**" con: ruta real `GET /api/ecommerce/preparacion`; campos base `cliente_nombre` (`null` → UI "Cliente no disponible"; sin seguir `fusionado_en_id`) y `unidades_totales`; bloque `pago: { total: string (2 decimales), medios: MedioPagoVenta[] }` presente solo con `ecommerce:leer_historial_ordenes`, ausente en la base; sin endpoint de detalle (el "detalle de preparación" es el panel alimentado por la cola y las respuestas de scan/completar). Sin editar ni renumerar texto existente.
  - `npm run test:unit:e14`, `npm run test:integration:e14`, `npm run test:integration:e14-http`.
  - Regresión: `pick-pack.integration.test.ts`, `npm run test:integration:e13`, `hu-e2-e12.integration.test.ts`, `npm run test:integration:e13-http` (usa la consola/cola con los usuarios del seed), `npm test`.
  - `npx tsc --noEmit`, `npm run lint`, `npm run build`.
  - `HU14_MODULO_E.md`: tabla CA → test, decisiones D1–D10, hallazgos verificados, conflictos y su resolución, deuda técnica, capturas de operador y administrador, constancia de que `validar-retiro` arma un literal sin datos de pago.
- **Tests obligatorios:** los listados arriba, todos verdes (o con salida registrada si alguno se omite por falta de base de test).
- **Definition of Done:** todo verde; evidencia escrita; diff de `spec_modulo_E.md` solo agrega líneas.
- **CA que cubre:** verificación de E14-1…E14-5 y del párrafo final.

---

## 4. Dependencias entre tasks

```
T01 (servicio + tipos + package.json)
  ↓
T02 (HTTP: permiso de historial)
  ↓
T03 (UI: tarjeta)
  ↓
T04 (verificación + evidencia + nota §6.3)
```

- Ejecución secuencial T01 → T02 → T03 → T04 sin confirmación intermedia (§8).

---

## 5. Archivos permitidos por tarea

| Tarea | Archivos permitidos |
|---|---|
| T01 | `src/lib/services/ecommerce/pick-pack.types.ts`, `src/lib/services/ecommerce/pick-pack.service.ts` (solo `listarColaPreparacion` + helper privado), `src/lib/services/ecommerce/hu-e14.integration.test.ts`, `package.json` (**única edición**: `test:integration:e14`, `test:integration:e14-http`, `test:unit:e14`) |
| T02 | `src/app/api/ecommerce/preparacion/route.ts`, `src/lib/services/ecommerce/hu-e14.http.integration.test.ts` |
| T03 | `src/components/ecommerce/pick-pack-client.ts`, `pick-pack.client.test.ts`, `ConsolaPickPack.tsx`, `ConsolaPickPack.test.tsx` |
| T04 | `docs/modulos/modulo E/HU14_MODULO_E.md`, `docs/specs/spec_modulo_E.md` (solo nota aditiva en §6.3) |

`package.json` solo figura en T01 (D9). `prisma/**` no figura en ninguna task (D8).

---

## 6. Tests obligatorios por tarea

| Tarea | Tests |
|---|---|
| T01 | `hu-e14.integration.test.ts` (casos 1–7) + regresión `pick-pack.integration.test.ts`, `test:integration:e13`, `hu-e2-e12.integration.test.ts`; `tsc --noEmit`. |
| T02 | `hu-e14.http.integration.test.ts` (casos 1–5). |
| T03 | `test:unit:e14` (`ConsolaPickPack.test.tsx` casos 1–5 + existentes, `pick-pack.client.test.ts`), verificación manual en dev, `tsc`, `lint`. |
| T04 | `npm test`, `test:unit:e14`, suites de integración E14/E12/E13/E2-E12, `tsc --noEmit`, `lint`, `build`. |

---

## 7. Definition of Done por tarea

Cada task se considera Done cuando:

1. Todos los cambios previstos están implementados en los archivos autorizados.
2. Los tests obligatorios pasan (con salida registrada si alguno se omite por falta de base de test).
3. No se modificaron archivos prohibidos ni `prisma/schema.prisma` / migraciones / seed.
4. No se amplió el alcance de §6.3 (sin endpoint ni pantalla de detalle nuevos).
5. Se completó el STOP obligatorio si corresponde.
6. Se documentaron riesgos o dependencias pendientes.

---

## 8. Puntos de parada obligatorios

- **STOP después de T02 y después de T03: ANULADOS** por decisión del revisor (21/10/2026). T01 → T02 → T03 → T04 se ejecutan de corrido; cada task cierra con sus tests, `tsc` y `lint`, y se marca en §12.
- **Se frena solo ante bloqueo real:** archivo fuera de los autorizados, cambio de schema/migración, o contradicción con la spec no resoluble dentro del plan.
- **STOP implícito ante schema o seed:** si cualquier task detecta que necesita tocar `schema.prisma`, una migración o `seed.ts`, se frena y se reporta (D8).

---

## 9. Conflictos detectados entre spec y código

1. **C1 — `AGENTS.md` no existe.** `CLAUDE.md` lo importa (`@AGENTS.md`) pero el archivo no está en la raíz; las reglas de Next.js viven en el bloque de `CLAUDE.md`. No bloquea E14 (no hay APIs de Next.js nuevas). Se informa al equipo.
2. **C2 — §2.12 histórico vs ruta y DTO reales.** §2.12 describe `/api/ecommerce/pick-pack/cola` y un JSON con `fecha_pago`; el código expone `/api/ecommerce/preparacion` con `fecha_pago_confirmado`. La nota Rev.7 de §2.12 ya da prioridad a las rutas reales y §6.3 usa `fecha_pago_confirmado`. **Se sigue el código**; T04 lo deja escrito en la nota de cierre.
3. **C3 — "Detalle de preparación" (E14-2) sin endpoint.** E14-2 habla de la proyección "de cola y del detalle de preparación", pero no existe endpoint de detalle y `DetallePreparacionDto` está muerto. **Interpretación:** el detalle es `PreparacionPedidoPanel`, alimentado por el ítem de la cola (misma proyección) y por las respuestas de scan/completar (sin datos de pago, D7). No se crea endpoint; el DTO muerto queda como DT-1.
4. **C4 — §2.10/§2.12 "para este rol".** §2.12 dice que el `select` "omite esos campos por completo **para este rol**". Se implementa por permiso (`leer_historial_ordenes`), como exige §2.10 y el párrafo final de §6.3; el efecto para el rol Operador es el mismo. §2.10 limitaba el nombre del destinatario a "la validación del QR"; §6.3 (Rev.10, que prevalece) lo extiende a la tarjeta de cola. Sin acción.
5. **C5 — Clientes fusionados.** Un pedido histórico puede apuntar al cliente secundario de una fusión (HU-C5), que queda con `is_active = false`, `deleted_at` y `fusionado_en_id` → primario. Por RULES §1 y D5 → `cliente_nombre: null` / "Cliente no disponible". Seguir la redirección mostraría el nombre del primario, que el párrafo final de §6.3 prohíbe ("sin exponer otra identidad"). Coherente con `retiro-e3.service.ts:156-157`, que también rechaza cliente inactivo (ese pedido tampoco se puede retirar por DNI: comportamiento previo, fuera de alcance). Queda como riesgo operativo R1. **RESUELTA (revisor, 21/10/2026):** "Cliente no disponible", sin seguir `fusionado_en_id`.
6. **C6 — Convención de `Decimal` mixta en el módulo E.** Las lecturas de checkout/carrito/mis pedidos usan `number` (`toNumber()`); las lecturas administrativas usan `string` con `toFixed(2)` (§2.13.15 `pedidos/pagados`, `anulacion-orden.service.ts`, `cupon.service.ts`). Como `pago` es un dato administrativo, **se adopta `string` `toFixed(2)`** (D3). Se documenta en la nota de cierre.
7. **C7 — Etiqueta de cliente ausente distinta en otra pantalla.** `PedidosWebAdmin.tsx:175` usa "Cliente sin identificar". §6.3 pide "dato no disponible"; se propone **"Cliente no disponible"** para la tarjeta y no se toca `PedidosWebAdmin` (fuera de alcance). **RESUELTA:** "Cliente no disponible"; `PedidosWebAdmin` sin cambios.
8. **C8 — "Medio de pago" en singular vs N medios.** E14-3 habla de "medio de pago"; el modelo permite varios `VentaMedioPago` por venta. Un pedido web siempre tiene uno (`MERCADO_PAGO`), pero se expone `medios: MedioPagoVenta[]` para no perder información si hubiera más (D3). **RESUELTA:** lista; la UI la une con coma (DM-1).
9. **C9 — Seed y "cliente no disponible".** El seed no tiene un pedido web en cola con cliente no resoluble. Agregar uno exige pedido, ítems, reservas, comprobante e ingreso con `numero_venta` contiguo (`seed.ts:4447-4452`: los números siguen `generarNumeroVenta()` = `count + 1`) y altera la cola que ven otras suites con el seed. **Propuesta:** no tocar el seed; el caso se demuestra con fixtures de T01 (servicio) y T03 (markup). **RESUELTA:** seed sin cambios.
10. **C10 — Suites de pick-pack fuera de `package.json`.** `pick-pack.integration.test.ts` y `hu-e2-e12.integration.test.ts` no tienen script npm (se corren por ruta con su variable de entorno). No se agregan en E14 para no ampliar el alcance de la edición única de D9; T04 las corre por ruta directa.

---

## 10. Deuda técnica registrada

| ID | Descripción | Origen | Acción sugerida |
|---|---|---|---|
| DT-1 | `DetallePreparacionDto` (`pick-pack.types.ts:50-63`) no tiene consumidores y describe una ruta `GET /.../pick-pack/[id]` inexistente. | C3 | Borrarlo o implementarlo en una HU que cree la pantalla de detalle (fuera de E14). |
| DT-2 | Tres mapas de etiquetas de `MedioPagoVenta`: `comprobante-web-pdf.ts:136`, `reporte-mensual.resumen.tsx:55` y el nuevo de `pick-pack-client.ts`. | D6 | Unificar en un módulo puro compartido cuando una HU toque los tres. |
| DT-3 | Convención de serialización de `Decimal` mixta en el módulo E (`number` en lecturas públicas, `string` en administrativas). | C6 | Fijarla en la spec del módulo en una revisión transversal. |
| DT-4 | `listarColaPreparacion` incluye `operador_asignado` (`id`, `nombre_completo`) sin exponerlo. | Hallazgo T01 | **Se conserva en E14 (revisor).** Quitar el `include` en una tarea de limpieza posterior. |
| DT-5 | `confirmarItem` devuelve además `pve_id` y `cantidad_confirmada_anterior`, y `completarPreparacion` devuelve `pve_id` y `vencimiento_iso`; las rutas `scan`/`completar` los serializan tal cual. No son datos de pago ni PII. | Hallazgo T01 (test D7) | Proyectar el DTO documentado en esas rutas o en el servicio, en una tarea de HU-E12. El test D7 de E14 fija el conjunto actual de claves. |
| DT-6 | Fallas preexistentes ajenas a E14: E9 devuelve `historial_estados` y `verificarE9Terminal` (`hu-e13.test-fixtures.ts:675`) espera el conjunto viejo (T12 de `hu-e13.integration` y 3 casos de `hu-e13.e2e.http`); además un ANULADO legacy aparece en el listado E9 (`hu-e13.e2e.http.integration.test.ts:417`). | Regresión T01/T04 | Reportar al owner de E9/E13. |

---

## 11. Decisiones menores tomadas durante la implementación

_(Se completa durante T01–T04. Ninguna puede contradecir §6.3 ni D1–D10.)_

| # | Decisión | Dónde |
|---|---|---|
| DM-1 | `pago.medios` es una lista `MedioPagoVenta[]`; la tarjeta la muestra con las etiquetas de `ETIQUETA_MEDIO_PAGO` unidas con `", "`. | `pick-pack-client.ts` |
| DM-2 | El `select` de `pedido_venta` usa `total: incluirDatosPago` (booleano): con `false` Prisma no incluye la columna en el SQL, verificado por el espía de queries. | `pick-pack.service.ts` |
| DM-3 | Base de test `swat_erp_test_e13_hu14` (migrate + seed): el prefijo `e13_` lo exige `exigirDbDeTest` de las suites HU-E13; se usa la misma base para E14, E12, E2-E12 y el servidor HTTP (`next dev -p 3114`). Queda además `swat_erp_test_e14`, creada al principio y sin uso posterior. | entorno local |
| DM-4 | `hu-e14.integration.test.ts` saca de la cola sus propios pedidos al terminar (baja lógica de `PedidoVentaEcommerce`, sin DELETE): la primera corrida, sin esa limpieza, dejó pedidos con prioridad alta que rompían el test de orden de `pick-pack.integration.test.ts`. También espera 500 ms antes de `$disconnect` para no cortar la auditoría post-commit de `completarPreparacion`. | `hu-e14.integration.test.ts` |
| DM-5 | El test D7 fija el conjunto real de claves de scan/completar, incluidos los campos internos (DT-5), en lugar del DTO documentado: `confirmarItem`/`completarPreparacion` están fuera de los archivos autorizados. | `hu-e14.integration.test.ts` |
| DM-6 | Test HTTP con roles propios `TEST_E14_*` (nombres únicos por corrida) y contraseña del seed; el 403 se prueba con un usuario que tiene `leer_historial_ordenes` pero no `leer_cola_preparacion`. | `hu-e14.http.integration.test.ts` |
| DM-7 | La tarjeta muestra los datos en una lista de definición (`<dl>`) en un `CardContent` propio; cliente no disponible en itálica atenuada. Moneda con `Intl.NumberFormat("es-AR", { currency: "ARS" })`. Medio vacío → «Sin medio registrado». | `ConsolaPickPack.tsx`, `pick-pack-client.ts` |
| DM-8 | Tests existentes ajustados solo por el cambio de forma esperado: `pedidoBase` de `ConsolaPickPack.test.tsx` y `pick-pack.client.test.ts` gana `cliente_nombre` y `unidades_totales`. Ningún assert previo cambió. | tests de componentes |

---

## 12. Avance

| Task | Estado | Notas |
|---|---|---|
| T01 | ✅ Completa | `test:integration:e14` 8/8; regresión pick-pack 53/53, e2-e12 12/12, e13 10/12 (DT-6, ajena); tsc y eslint OK. |
| T02 | ✅ Completa | `test:integration:e14-http` 6/6; tsc y eslint OK. |
| T03 | ✅ Completa | `test:unit:e14` 38/38; tsc y eslint OK. Verificación visual en navegador pendiente del revisor. |
| T04 | ✅ Completa | `npm test` 1264/1264, lint 0 errores, build OK, e13-http 5/10 (DT-6, ajena); nota §6.3 y `HU14_MODULO_E.md`. |
