# Especificación Técnica — HU-B3 (Cotización/Presupuesto con reserva de stock)

## ERP SWAT Indumentarias — Módulo B

**Metodología:** Regenerado por relevamiento directo del código (no SDD ex-ante).
**Stack real:** Next.js (App Router, RSC + Server Actions + Route Handlers) · Prisma ORM · Zod · PostgreSQL.
**Fuente:** código en `src/` al 2026-09-17. Documento nuevo — no existía una versión previa de HU-B3 en `docs/modulos/modulo B/`.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Cajero POS, **necesito** emitir un Presupuesto para un cliente congelando automáticamente el stock cotizado, y convertirlo en un Pedido de Venta cuando el cliente acepta, **para** sostener el circuito de venta con cotización previa sin arriesgar el stock ofrecido mientras el cliente decide.

**Criterios de Aceptación (verificados contra el código real, `spec_modulo_B.md` §2.3/§3.1/§3.2):**

- [x] **CA1** — Alta de un `Presupuesto` en estado `EMITIDO`, congelando stock por cada ítem cotizado **exclusivamente** vía el servicio centralizado de Reserva de Módulo A (`crearReserva()`) — Módulo B no implementa lógica de congelamiento propia.
- [x] **CA2** — Vencimiento automático: un `Presupuesto` no aceptado dentro de su vigencia transiciona a `VENCIDO` (baja lógica) al ser leído nuevamente, sin intervención directa de Módulo B sobre el stock (la liberación de la Reserva es responsabilidad exclusiva del job de TTL de Módulo A).
- [x] **CA3** — Aceptación: conversión de un `Presupuesto EMITIDO` en un `PedidoVenta RESERVADO`, **reutilizando la misma Reserva** ya congelada — nunca se vuelve a descontar/congelar stock una segunda vez.
- [ ] **CA4** — Entregas parciales: un `PedidoVenta` originado en la aceptación de un presupuesto puede facturarse y remitarse en más de un evento (`RESERVADO → FACTURADO → REMITO_EMITIDO` repetible → `CERRADO`). **No implementado** — ver §7.
- [x] **CA5** — Baja lógica estricta: ningún `Presupuesto` ni `PedidoVenta` se elimina físicamente (Regla N.° 1).

El detalle de qué función/archivo cumple cada uno está en §3 y §9.

---

## 2. Arquitectura de la pantalla

Rutas: `/ventas/presupuestos` (listado), `/ventas/presupuestos/nueva` (alta), `/ventas/presupuestos/[id]` (detalle) → `src/app/(dashboard)/ventas/presupuestos/`.

### 2.1. `page.tsx` (listado) — React Server Component

- `export const dynamic = "force-dynamic"`.
- `getServerSession()` — sin sesión, `redirect("/login")`.
- Gate de acceso: `ventas:leer` (`PERMISO_VENTAS_LEER`) — sin el permiso, `redirect("/no-autorizado")`. Esto es distinto del patrón de HU-A7 (que renderiza un `<Alert>` inline sin redirigir): acá **sí** hay `redirect()` real.
- El botón "Nuevo presupuesto" se gatea aparte, en el propio JSX, con `ventas:emitir_cotizacion` (`puedeEmitir`) — un usuario con solo `ventas:leer` ve el listado pero no el CTA de alta.
- Componente interno `PresupuestosData` (async, dentro de `<Suspense>`) llama a `listarPresupuestos()`; si falla, `<Alert variant="destructive">` sin tirar abajo la página.
- Pasa el resultado a `TablaPresupuestos` (Client Component).

### 2.2. `nueva/page.tsx` (alta) — React Server Component

- Gate de acceso: `ventas:emitir_cotizacion` — sin el permiso, `redirect("/no-autorizado")`. A diferencia del listado, acá **no** hay gate separado de lectura: quien no puede emitir directamente no ve el formulario.
- Precarga en paralelo (`Promise.all`) los tres selectores del formulario: `listarClientesParaSelector()`, `listarVariantesParaCotizacion()` (ambos en `presupuesto.service.ts`) y `listarDepositosActivos()` (`lib/services/inventario/deposito.service.ts`, Módulo A — reutilizado, no hay una versión propia de Módulo B).
- Si la precarga falla, `<Alert variant="destructive">` en vez de romper el build/render.
- Delega el submit en `FormularioNuevoPresupuesto` (Client Component) contra la Server Action `crearPresupuestoAction`.

### 2.3. `[id]/page.tsx` (detalle) — React Server Component

- Gate de lectura: `ventas:leer`. Una segunda consulta de permiso (`ventas:emitir_cotizacion`, en paralelo con `obtenerPresupuesto(id)`) determina si se muestra el botón de aceptación.
- `obtenerPresupuesto(id)` ya aplica la transición perezosa `EMITIDO → VENCIDO` (§3.2) — esta lectura es, literalmente, "la próxima lectura" que dispara el vencimiento según la spec.
- `notFound()` si el presupuesto no existe.
- El botón "Aceptar y convertir a pedido" (`DialogAceptarPresupuesto`) solo se renderiza si: tiene el permiso, el estado (ya resuelto) es `EMITIDO`, y todavía no tiene `pedido_venta` vinculado.
- **HU-B3 no define una pantalla de detalle de `PedidoVenta` propia** (confirmado: no existe ningún `page.tsx` bajo una ruta `/ventas/pedidos*`) — el pedido generado se muestra inline en esta misma pantalla, con su número y badge de estado (`EstadoPedidoVentaBadge`).

### 2.4. `actions.ts` — Server Actions

Dos Server Actions, equivalentes exactos de los dos Route Handlers (§4), mismo shape `{ data, error }`:

- **`crearPresupuestoAction(input)`**: sesión + `ventas:emitir_cotizacion` + `CrearPresupuestoSchema.safeParse()` + `crearPresupuesto()` + `revalidatePath("/ventas/presupuestos")`.
- **`aceptarPresupuestoAction(presupuestoId)`**: sesión + `ventas:emitir_cotizacion` + `PresupuestoIdSchema.safeParse()` + `aceptarPresupuesto()` + `revalidatePath()` de listado y detalle.

Ambas repiten la verificación de permiso "a mano" (`getServerSession()` + `usuarioTienePermiso()`) en vez de usar el HOF `withPermission()` de los Route Handlers — es el patrón esperado para Server Actions (no son handlers HTTP, no hay HOF equivalente en el proyecto).

### 2.5. Client Components (`src/components/ventas/`)

- **`FormularioNuevoPresupuesto.tsx`**: único formulario de alta. `useState` manual con filas dinámicas de ítems (mismo patrón que `FormularioNuevaOrdenCompra.tsx`, sin `react-hook-form`/`useFieldArray`). Mejora UX no exigida por ningún CA: al elegir la variante de una fila, consulta `GET /api/inventario/variantes/[id]/stock-por-deposito` y anota cada `<option>` de depósito con "(N disp.)" — puramente informativo, la validación real de stock sigue viviendo server-side en `crearReserva()`.
- **`TablaPresupuestos.tsx`**: listado sin columna "Acciones" — toda la fila navega al detalle (mismo patrón que `TablaOrdenesCompra.tsx`).
- **`DialogAceptarPresupuesto.tsx`**: `AlertDialog` de confirmación + Server Action, sin datos adicionales a capturar.
- **`EstadoPresupuestoBadge.tsx`** / **`EstadoPedidoVentaBadge.tsx`**: badges puros de color por estado, punto único de verdad del mapeo estado→color.

Ningún Client Component de esta pantalla expone una acción de mutación fuera de las dos ya descriptas (alta y aceptación) — confirmado por lectura completa de los 5 archivos.

---

## 3. Capa de servicios — `lib/services/ventas/presupuesto.service.ts`

Único archivo de servicio de Módulo B con lógica de negocio real hoy (ver §7 sobre el resto de Módulo B). Seis funciones exportadas.

### 3.1. `crearPresupuesto(input, usuarioId)` → `Promise<PresupuestoCreado>`

Cumple **CA1**.

- Precondición: `cliente_id` existe y está activo (`prisma.cliente.findFirst`, consulta ad-hoc — Módulo C todavía no tiene capa de servicios propia, hallazgo confirmado en el propio comentario del archivo).
- Congela stock **por cada ítem, en orden secuencial** (no en paralelo) invocando `crearReserva()` de `lib/services/inventario/reserva.service.ts` — cada llamada abre y cierra su propia `$transaction`; Módulo B nunca envuelve esa atomicidad en la suya.
- `ttl_horas` pasado a `crearReserva()` = `vigencia_dias * 24` — **derivación explícita** de la vigencia del presupuesto a la ventana de la reserva.
- Alta atómica de `Presupuesto` + N `PresupuestoItem` en una `$transaction` propia de Módulo B (posterior a las N reservas ya confirmadas), cada ítem referenciando su `reserva_id`.
- **Falla parcial documentada, no corregida**: si el ítem N de M no puede congelarse (ej. `STOCK_INSUFICIENTE`), las reservas de los ítems 1..N-1 **no se liberan** — quedan "huérfanas" (sin `PresupuestoItem` que las referencie) hasta que el cron de TTL de Módulo A las libere naturalmente. Esto es una consecuencia directa y aceptada de la exclusividad de Módulo A sobre stock (§3.2 de la spec): Módulo B no implementa liberación propia ni siquiera para este caso de error.
- Evento post-COMMIT: `venta:presupuesto_emitido`.

### 3.2. `aplicarVencimientoSiCorresponde(presupuesto)` (privada) / `calcularEstadoEfectivo(estado, vigenciaHasta)` (exportada)

Cumple **CA2**.

- `aplicarVencimientoSiCorresponde` es la única función que **escribe** el vencimiento: `updateMany` condicionado al estado leído (`where: { id, estado: "EMITIDO" }`) — ante dos lecturas concurrentes del mismo presupuesto vencido, solo una persiste el cambio y emite `venta:presupuesto_vencido`; la otra recibe `count === 0` sin duplicar el evento.
- Es baja lógica **pura** sobre `Presupuesto`: nunca toca `Reserva` ni `StockDeposito` — la liberación real del stock congelado es responsabilidad exclusiva del cron de Módulo A (`liberarReservasVencidas()`), que corre de forma completamente independiente.
- Se invoca solo en lecturas puntuales (`obtenerPresupuesto`, `aceptarPresupuesto`) — **nunca** en `listarPresupuestos()`, para no disparar un `UPDATE` por fila en cada carga de grilla.
- `calcularEstadoEfectivo` es la versión de solo lectura (sin escritura) del mismo cálculo, usada por el listado para reflejar visualmente un vencimiento que todavía no pasó por una lectura individual.

### 3.3. `aceptarPresupuesto(presupuestoId, usuarioId)` → `Promise<PresupuestoAceptado>`

Cumple **CA3**.

- Valida, en orden: existencia (`PRESUPUESTO_NO_ENCONTRADO`, 404) → aplica vencimiento perezoso (`PRESUPUESTO_VENCIDO`, 409, si acababa de vencer) → estado `EMITIDO` + `is_active` + no `deleted_at` (`TRANSICION_INVALIDA`, 409) → sin `PedidoVenta` ya vinculado (`PRESUPUESTO_YA_CONVERTIDO`, 409).
- **Reutiliza la MISMA `reserva_id`** de cada `PresupuestoItem` en el `PedidoVentaItem` correspondiente — nunca vuelve a invocar `crearReserva()` (confirmado también por test source-regex, §5).
- El `Presupuesto` origen **permanece en estado `EMITIDO` para siempre** — el enum `EstadoPresupuesto` no tiene un valor "ACEPTADO"/"CONVERTIDO" (confirmado contra `schema.prisma`: solo `BORRADOR | EMITIDO | VENCIDO`). La UI distingue "aceptado" de "solo emitido" exclusivamente por la presencia de `presupuesto.pedido_venta`, no por el campo `estado`.
- `numero_venta` generado server-side (`V-<año>-<secuencia 6 díg.>`), con reintento (máx. 3 intentos) ante colisión `P2002` — pero **nunca** reintenta si la colisión es sobre `presupuesto_origen_id` (doble aceptación concurrente del mismo presupuesto): en ese caso corta directo con `PRESUPUESTO_YA_CONVERTIDO`.
- Evento post-COMMIT: `venta:presupuesto_aceptado`.

### 3.4. Lecturas — `listarPresupuestos()`, `obtenerPresupuesto(id)`

- `listarPresupuestos()` **no filtra por `is_active`**: un presupuesto `VENCIDO` (baja lógica) sigue en la grilla con su estado — el historial completo es visible, mismo criterio que `listarOrdenesCompra` de Módulo H.
- `obtenerPresupuesto(id)` aplica la transición perezosa de vencimiento antes de proyectar la respuesta (es la "próxima lectura" real que la spec exige como disparador).

### 3.5. Selectores — `listarClientesParaSelector()`, `listarVariantesParaCotizacion()`

- Ambas son consultas propias de Módulo B contra entidades de otros módulos (`Cliente` de Módulo C, `VarianteSKU` de Módulo A), de solo lectura, sin reutilizar los selectores equivalentes de otros módulos (ej. `listarVariantesParaOrden()` de Módulo H) — decisión explícita para no acoplar Ventas a Compras.
- `listarVariantesParaCotizacion()` tiene un tope defensivo de 500 filas (`MAX_VARIANTES_SELECTOR`).

---

## 4. Contrato de API

### 4.1. `POST /api/ventas/presupuestos` (alta)

**Autorización:** `withPermission("ventas:emitir_cotizacion")`.
**Body:** `CrearPresupuestoSchema` (§5).

| Status | Código | Cuándo |
|---|---|---|
| `201` | — | Alta exitosa |
| `400` | `VALIDATION_ERROR` | Body inválido contra Zod |
| `401` | `UNAUTHORIZED` | Sin sesión |
| `403` | `FORBIDDEN` | Sin `ventas:emitir_cotizacion` |
| `404` | `CLIENTE_NO_ENCONTRADO` / `VARIANTE_NO_ENCONTRADA` / `DEPOSITO_NO_ENCONTRADO` | Entidad referenciada inexistente/inactiva |
| `422` | `STOCK_INSUFICIENTE` | Propagado desde `crearReserva()` de Módulo A |
| `500` | `INTERNAL_ERROR` | Excepción no controlada |

**Respuesta `201`:**
```json
{ "data": { "presupuesto_id": "uuid", "estado": "EMITIDO", "vigencia_hasta": "2026-09-24T...", "reservas_generadas": 2 }, "error": null }
```

### 4.2. `PATCH /api/ventas/presupuestos/[id]/aceptar` (conversión)

**Autorización:** `withPermission("ventas:emitir_cotizacion")` — **mismo permiso que el alta**, no uno separado de "aceptar" (la spec no define uno distinto para esta transición).

| Status | Código | Cuándo |
|---|---|---|
| `200` | — | Conversión exitosa |
| `400` | `VALIDATION_ERROR` | `id` de path no es UUID |
| `401` / `403` | `UNAUTHORIZED` / `FORBIDDEN` | Igual que arriba |
| `404` | `PRESUPUESTO_NO_ENCONTRADO` | — |
| `409` | `PRESUPUESTO_VENCIDO` / `TRANSICION_INVALIDA` / `PRESUPUESTO_YA_CONVERTIDO` | — |
| `500` | `RESERVA_FALTANTE` / `INTERNAL_ERROR` | `RESERVA_FALTANTE`: invariante violada, ítem sin Reserva asociada (dato corrupto fuera del flujo normal) |

**Respuesta `200`:**
```json
{ "data": { "pedido_venta_id": "uuid", "presupuesto_id": "uuid", "estado": "RESERVADO" }, "error": null }
```

Ninguno de los dos Route Handlers implementa lógica de negocio propia — ambos son wrappers finos confirmados por lectura completa de sus ~65 líneas cada uno: resuelven permiso, parsean con Zod, invocan la función de servicio, mapean el resultado/excepción.

---

## 5. Esquema de validación real y discrepancias contra `spec_modulo_B.md` §2.3

```typescript
const CrearPresupuestoItemSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),          // ← extensión, ver abajo
  cantidad: z.number().int().positive(),
  precio_cotizado: z.number().positive(),
});

export const CrearPresupuestoSchema = z.object({
  cliente_id: z.string().uuid(),
  vigencia_dias: z.number().int().positive(),
  condiciones_comerciales: z.string().optional(),
  origen_reserva: z.enum(["LICITACION", "PEDIDO_INSTITUCIONAL"]).default("LICITACION"), // ← extensión, ver abajo
  items: z.array(CrearPresupuestoItemSchema).min(1),
});
```

**Discrepancia 1 — `deposito_id` por ítem (extensión autorizada, no un error):** el contrato de spec §2.3 no incluye este campo. El propio código (`ventas.schema.ts`) documenta la razón: el negocio tiene 3 depósitos reales sembrados, no uno único, así que el vendedor elige el depósito de origen por línea — mismo criterio que ya exige `CrearReservaSchema` de Módulo A (`deposito_id` obligatorio, confirmado en `inventario.schema.ts:369-376`). Sin este campo, `crearReserva()` no podría invocarse (es un parámetro requerido de su propio schema). Documentado en el código como decisión del equipo, con test dedicado (`ventas.schema.test.ts:70`) que exige el campo y lo valida como UUID.

**Discrepancia 2 — `origen_reserva` a nivel de presupuesto (extensión no contemplada por el contrato original):** la spec resuelve el origen "según el enum vigente hoy en `schema.prisma`" sin especificar un mecanismo programático para elegir entre `LICITACION` y `PEDIDO_INSTITUCIONAL`. El código expone esta elección como un campo explícito de todo el presupuesto (no por ítem — una cotización es de un único origen), con `"LICITACION"` como default. El propio Route Handler y la Server Action aceptan este campo transparentemente (viene incluido en `CrearPresupuestoInput`).

**Discrepancia 3 — comentario del código que sobre-afirma el seed:** el docstring de `ventas.schema.ts` (línea 43) dice que `"LICITACION"` es "el mismo valor que usan los tres casos de seed de esta HU". Relevado contra `prisma/seed.ts`: existe **un único** `prisma.presupuesto.upsert(...)` (`presupuestoLicitacion`, `PRESUPUESTO_LICITACION_ID`). Los "tres fixtures" a los que sí hace referencia correctamente `presupuesto.integration.test.ts:11` son `presupuestoLicitacion` + `pedidoVentaLicitacion` + `pedidoVentaRemitoParcial` — es decir, un Presupuesto y dos PedidoVenta, no tres Presupuestos. El comentario de `ventas.schema.ts` es impreciso; no afecta comportamiento, pero un futuro lector que busque "el segundo o tercer presupuesto de seed" no lo va a encontrar.

**Discrepancia 4 — TTL fijo del cron de liberación, ignora el `ttl_horas` derivado de `vigencia_dias`:** `crearPresupuesto()` deriva `ttl_horas = vigencia_dias * 24` y lo pasa a `crearReserva()`, que sí lo respeta al crear la Reserva. Pero `liberarReservasVencidas()` (el cron real de Módulo A) usa un `TTL_RESERVA_DEFAULT_HORAS` fijo de 72h para **todo** origen, ignorando el `ttl_horas` explícito con el que se creó la reserva — confirmado en `reserva.service.ts:326`, con un comentario propio del archivo: `// LIMITACIÓN CONOCIDA: cron aplica 72h fijo por origen, no respeta ttl_horas explícito de e-commerce`. Práctica: un `Presupuesto` con `vigencia_dias: 10` (240h) verá su Reserva liberada por el cron a las 72h si nadie la acepta antes — **antes** de que el propio `Presupuesto` transicione a `VENCIDO` en su próxima lectura (que sigue esperando a `vigencia_hasta`, calculado con las 240h reales). Esto es una limitación de Módulo A ya documentada ahí, no un defecto introducido por HU-B3, pero HU-B3 hereda su efecto: un presupuesto puede figurar `EMITIDO` con una Reserva que Módulo A ya liberó por su cuenta.

**Sin discrepancia (confirmando la spec):** el estado `EMITIDO → VENCIDO` es efectivamente perezoso (por lectura), tal como describe la spec ("decisión de implementación a definir por el equipo, no bloqueante") — el equipo optó por la variante perezosa, sin job propio de Módulo B.

---

## 6. Filtros/UI real

`TablaPresupuestos.tsx` **no tiene ningún filtro** — es un listado completo, sin buscador, sin filtro por cliente/estado/fecha, sin paginación (`listarPresupuestos()` trae todas las filas sin `skip`/`take`). Esto no incumple ningún CA: HU-B3 no exige capacidad de filtrado en su contrato (a diferencia de HU-A7). Documentado acá como estado real, no como carencia.

`FormularioNuevoPresupuesto.tsx` sí tiene comportamiento dinámico real, no exigido por ningún CA:

| Interacción | Comportamiento |
|---|---|
| Selección de variante en una fila | Dispara `GET /api/inventario/variantes/[id]/stock-por-deposito`; anota cada `<option>` de depósito con "(N disp.)". Descarta respuestas fuera de orden si el usuario cambia de variante antes de que resuelva la consulta anterior (`ultimaVarianteConsultadaRef`). Un error de red es silencioso — el `<select>` de depósito queda sin anotar, sin bloquear el alta. |
| Agregar/quitar ítem | Filas dinámicas vía `useState`, mínimo 1 fila siempre presente. |
| Validación local previa al submit | Cliente elegido, `vigencia_dias` entero positivo, cada fila cargada con cantidad entera positiva, precio positivo y depósito elegido — todo client-side, antes de invocar la Server Action (la validación real y definitiva sigue siendo server-side, vía Zod + `crearReserva()`). |

---

## 7. Capacidades evaluadas y descartadas / no implementadas

Búsqueda explícita (`grep`/`find` sobre `src/` completo) por rutas y servicios del resto de Módulo B descriptos en `spec_modulo_B.md`, para confirmar qué existe realmente además de HU-B3:

- **HU-B1 (venta de mostrador, `POST /api/ventas`)** — no existe `src/app/api/ventas/route.ts`. Confirmado también por `rbac-hu-b8.integration.test.ts:26-32`.
- **HU-B2 (turnos de caja, `/api/ventas/turnos/**`)** — no existe ningún Route Handler. El modelo `TurnoCaja` existe en el schema y tiene un registro de seed (`TURNO_CAJA_ABIERTO_ID`), pero sin servicio ni endpoint que lo opere.
- **HU-B4 (override de descuento, `/api/ventas/[id]/override-descuento`)** — no implementado. El campo `PedidoVentaItem.requiere_autorizacion` existe en el schema pero ningún servicio lo setea ni lo resuelve.
- **HU-B5 (cuenta corriente, `/api/ventas/cuentas-corrientes/**`)** — no implementado. `CuentaCorrienteCliente` y `CuentaCorrienteOperacion` existen en el schema (confirmado), sin ningún archivo bajo `lib/services/ventas/` que los use.
- **HU-B6 (log forense, `GET /api/ventas/auditoria`)** — no implementado.
- **HU-B7 (comprobante fiscal, `ComprobanteFiscal`)** — el modelo existe en el schema, sin `comprobante-fiscal.service.ts` ni ningún endpoint de emisión/consulta.
- **HU-B7 §2.8 (anulación de pedido, `PATCH /api/ventas/[id]/anular`)** — no implementado. La transición `RESERVADO → ANULADO` del enum `EstadoPedidoVenta` existe, pero ningún código la ejecuta.
- **CA4 de esta misma HU-B3 — entregas parciales (`RESERVADO → FACTURADO → REMITO_EMITIDO` repetible → `CERRADO`)**: **no implementado**. Los campos `PedidoVentaItem.cantidad_facturada`/`cantidad_entregada` existen en el schema y aparecen en el seed únicamente como **datos de fixture hardcodeados** (`pedidoVentaRemitoParcial`, estado `REMITO_EMITIDO`, `cantidad_facturada: 10`, `cantidad_entregada: 6`) — ningún servicio de la capa de aplicación produce esa transición ni actualiza esos contadores. Existe solo para que `EstadoPedidoVentaBadge` tenga un caso real que mostrar y para que `presupuesto.integration.test.ts` verifique una lectura, no una escritura. Esto significa que, con el código actual, **un `PedidoVenta` generado por HU-B3 nunca puede salir de `RESERVADO`** salvo manipulación directa de la base — un hallazgo relevante porque la propia spec marca las entregas parciales como "criterio de aceptación explícito" de HU-B3.

En síntesis: de las 5 rutas + 1 hallazgo de auditoría que describe `spec_modulo_B.md` completo (HU-B1 a HU-B7 + §2.8), **solo HU-B3 (alta y aceptación de Presupuesto) tiene código real** hoy. Esto no es un hallazgo nuevo de esta tarea — ya está documentado explícitamente en la cabecera de `rbac-hu-b8.integration.test.ts:26-39` como limitación conocida de cobertura, producto del orden de implementación del sprint.

---

## 8. Navegación — `Sidebar.tsx`

`src/components/layout/Sidebar.tsx`. Sección **"Ventas"** (ícono `Receipt`), con un único ítem:

```typescript
{
  label: "Ventas",
  icon: Receipt,
  items: [
    {
      label: "Presupuestos",
      href: "/ventas/presupuestos",
      icon: FileText,
      permiso: "ventas:leer",
    },
  ],
}
```

- Gateado por `ventas:leer` — sin ese permiso, el ítem completo (y la sección "Ventas" si queda vacía) se filtra del árbol, mismo mecanismo de ocultamiento que el resto del Sidebar.
- El botón "Nuevo presupuesto" y la acción de aceptar **no** tienen ítem de navegación propio — se gatean dentro de las páginas mismas por `ventas:emitir_cotizacion` (§2.1/§2.3), consistente con el comentario del propio Sidebar en esa sección.
- No hay ítem de Sidebar para Pedidos de Venta como entidad propia — coherente con que HU-B3 no define una pantalla de detalle de `PedidoVenta` independiente (§2.3).

---

## 9. Cumplimiento de cada Criterio de Aceptación

| CA | Cumplido por |
|---|---|
| **CA1** — Congelamiento automático de stock por ítem, vía Módulo A | `crearPresupuesto()` en `presupuesto.service.ts` (§3.1) + `POST /api/ventas/presupuestos` (§4.1) + `crearPresupuestoAction()` (§2.4) |
| **CA2** — Vencimiento automático `EMITIDO → VENCIDO` sin tocar stock directamente | `aplicarVencimientoSiCorresponde()` / `calcularEstadoEfectivo()` en `presupuesto.service.ts` (§3.2), invocado desde `obtenerPresupuesto()` y `aceptarPresupuesto()` |
| **CA3** — Aceptación `EMITIDO → RESERVADO`, reutilizando la Reserva | `aceptarPresupuesto()` en `presupuesto.service.ts` (§3.3) + `PATCH /api/ventas/presupuestos/[id]/aceptar` (§4.2) + `DialogAceptarPresupuesto.tsx` |
| **CA4** — Entregas parciales | **No cumplido.** Solo existe el dato de schema/fixture (§7); sin servicio que lo produzca. |
| **CA5** — Sin borrado físico, baja lógica estándar | Ausencia verificada: ningún `prisma.presupuesto.delete()`/`deleteMany()` ni equivalente sobre `PedidoVenta` en `presupuesto.service.ts`; `onDelete: Restrict` en todas las relaciones salientes de `Presupuesto`/`PresupuestoItem`/`PedidoVenta`/`PedidoVentaItem` (`schema.prisma`) |

---

## 10. Capacidades adicionales no exigidas por los CA

- **Consulta de stock por depósito en tiempo real** durante la carga del formulario de alta (`GET /api/inventario/variantes/[id]/stock-por-deposito`), puramente informativa — mejora de UX documentada en el propio componente como resultado de una tarea de mejora posterior (`task_mejora_ux_stock_deposito_presupuesto.md`), no exigida por ningún CA de HU-B3.
- **Doble gate de permiso en el listado**: `ventas:leer` para ver la grilla, `ventas:emitir_cotizacion` (evaluado aparte) para ver el CTA de alta — separación más fina que un único permiso de "acceso al módulo".
- **Defensa contra doble aceptación concurrente**: manejo explícito de `P2002` sobre el `@unique` de `presupuesto_origen_id`, distinguido del `@unique` de `numero_venta` (que sí reintenta hasta 3 veces) — no exigido literalmente por ningún CA, pero necesario para sostener la garantía "un Presupuesto genera a lo sumo un PedidoVenta" bajo concurrencia real.
- **Tope defensivo de 500 filas** en `listarVariantesParaCotizacion()` — protección de rendimiento del selector, no una regla de negocio.
- **Suite de tests dual**: `presupuesto.service.test.ts` (source-regex, sin DB, corre en `npm test` por defecto — documenta explícitamente que corre así porque los usuarios seed no tenían Rol asignado *antes* de HU-B8) + `presupuesto.integration.test.ts` (opt-in contra base real, `npm run test:integration:b3`) + `ventas.schema.test.ts` (validación pura de Zod).
