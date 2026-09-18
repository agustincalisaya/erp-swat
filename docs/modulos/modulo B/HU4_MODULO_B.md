# Especificación Técnica — HU-B4 (Override de descuento y cambio manual de precio)

## ERP SWAT Indumentarias — Módulo B

**Metodología:** Regenerado por relevamiento directo del código (no SDD ex-ante).
**Stack real:** Next.js (App Router, RSC + Server Actions + Route Handlers) · Prisma ORM · Zod · PostgreSQL · bus de eventos de dominio (`domainEventBus`) → `AuditLog` de Módulo D.
**Fuente:** código en `src/` al 2026-09-18, `docs/tasks/HU-B4.md` y `docs/tasks/RESULTADO_qa_visual_HU-B3_B4_B8.md`. Documento nuevo — no existía una versión previa de HU-B4 en `docs/modulos/modulo B/`.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Supervisor de Ventas, **necesito** autorizar con mi propia credencial un descuento que excede el margen habilitado al Cajero, o un cambio manual del precio de lista, sobre un ítem de un Pedido de Venta que quedó en espera de aprobación, **para** que ninguna excepción comercial se aplique sin un responsable identificado y sin dejar un evento sensible trazable en el log de auditoría.

Referencia contractual: `spec_modulo_B.md` §2.4 (contrato, schema Zod y respuestas), §3.1 (transiciones atómicas) y §4 (eventos `venta:descuento_fuera_margen` / `venta:cambio_precio_manual`).

### 1.1. Nota de desacoplamiento de HU-B1 (léase antes que el resto)

`spec_modulo_B.md` §2.4 describe narrativamente que, ante un descuento fuera de margen, "el `PedidoVenta` o la línea de venta en curso transiciona a un estado de espera de aprobación" dentro de un flujo de venta de mostrador. **HU-B1 (venta de mostrador) no tiene código implementado** — no existe `POST /api/ventas` ni servicio propio (ver §8).

Decisión de alcance explícita de la tarea (`docs/tasks/HU-B4.md` §0), reflejada tal cual en el código:

- El contrato técnico real de HU-B4 opera sobre un **`PedidoVentaItem` ya persistido**, identificado dentro de un `PedidoVenta` existente (`[id]` de la ruta). §2.4 no impone ninguna precondición de que ese pedido provenga de un flujo de mostrador en vivo ni de un turno de caja abierto.
- El "estado de espera" **se modela en el ítem** (`requiere_autorizacion: true` + `autorizado_por_id: null`), **no** en un estado propio de `PedidoVenta` (el enum `EstadoPedidoVenta` no tiene un valor de espera de aprobación).
- La implementación **no depende de HU-B1** y se apoya hoy en los `PedidoVenta`/`PedidoVentaItem` que produce **HU-B3** (`crearPresupuesto()` → `aceptarPresupuesto()`), la única HU de Módulo B con código real que crea estas entidades.
- Caso de referencia: el fixture de seed `V-2026-000003` (`PEDIDO_VENTA_REMITO_PARCIAL_ID`, estado `REMITO_EMITIDO`), cuyo ítem sobre `VARIANTE_BORCEGOS_2_ID` nace con `requiere_autorizacion: true` y `autorizado_por_id: null`.
- Cuando exista HU-B1, podrá generar ítems con `requiere_autorizacion: true` y consumir este mismo endpoint sin cambios. Marcar el ítem como pendiente al detectar que el descuento excede el margen es responsabilidad de HU-B1, no de HU-B4.

Consecuencia práctica: **hoy ninguna UI ni servicio de la aplicación produce un ítem con `requiere_autorizacion: true`**. Los únicos ítems pendientes existen por seed (`V-2026-000003`) o por inserción directa (fixtures de test y de QA).

### 1.2. Criterios de Aceptación

Derivados de `spec_modulo_B.md` §2.4 (la spec no los numera; se numeran acá para la trazabilidad de §9), verificados contra el código real:

- [x] **CA1** — Autorización exitosa: un Supervisor con `ventas:autorizar_excepcion_descuento`, identificado por `supervisor_credencial.usuario_id`, autoriza un ítem pendiente; se aplica el descuento y/o el precio, el ítem queda `autorizado_por_id` = Supervisor y `requiere_autorizacion = false`, y la respuesta es `200 { autorizacion_id, descuento_aplicado, autorizado_por }`.
- [x] **CA2** — Rechazo `403 SIN_PERMISO_AUTORIZACION` (código y mensaje exactos de spec §2.4) cuando el usuario autorizante no existe, está inactivo o no tiene el permiso.
- [x] **CA3** — **Evento sensible obligatorio** (criterio de aceptación explícito de la spec): toda autorización exitosa emite hacia Módulo D con solicitante, autorizante, porcentaje aplicado, motivo, dispositivo de origen y timestamp.
- [x] **CA4** — Atomicidad: validaciones + ajuste dentro de una única `prisma.$transaction`; el/los evento(s) se emiten **después** del `COMMIT` (spec §3.1 / §3.3).
- [x] **CA5** — Rechazo `409 TRANSICION_INVALIDA` cuando el pedido no tiene un ítem pendiente que coincida con lo solicitado (incluye el reintento sobre un ítem ya autorizado); `404 PEDIDO_VENTA_NO_ENCONTRADO` si el pedido no existe.
- [ ] **CA6** — Recargos por financiación en cuotas ("mismo patrón" según spec §2.4): **no implementado como caso propio** — ver §8.

El detalle de qué función/archivo cumple cada uno está en §3 y §9.

---

## 2. Contrato de API

### 2.1. Schema Zod — `AutorizarOverrideDescuentoSchema` (`src/lib/schemas/ventas.schema.ts`)

Copiado **textualmente** de `spec_modulo_B.md` §2.4 (la tarea prohíbe modificar el `.refine`, los tipos o los mensajes):

```typescript
export const AutorizarOverrideDescuentoSchema = z.object({
  variante_sku_id: z.string().uuid().optional(),
  descuento_porcentual_solicitado: z.number().min(0).max(100).optional(),
  precio_lista_modificado: z.number().positive().optional(),
  motivo: z.string().min(1, "El motivo es obligatorio"),
  supervisor_credencial: z.object({
    usuario_id: z.string().uuid(),
  }),
}).refine(
  (d) => d.descuento_porcentual_solicitado !== undefined || d.precio_lista_modificado !== undefined,
  { message: "Debe indicarse un descuento porcentual o un precio de lista modificado", path: ["descuento_porcentual_solicitado"] }
);
export type AutorizarOverrideDescuentoInput = z.infer<typeof AutorizarOverrideDescuentoSchema>;
```

Puntos relevantes del contrato:

- El `.refine` exige **al menos uno** de `descuento_porcentual_solicitado` / `precio_lista_modificado`; **no** los declara mutuamente excluyentes (se pueden enviar ambos — ver §3.4 y §4).
- `supervisor_credencial` transporta **solo `usuario_id`** — no hay contraseña ni token del Supervisor en el contrato (ver §5.3 para las consecuencias).
- `variante_sku_id` es opcional (ver §3.4 sobre cómo se resuelve el ítem cuando falta).
- `PedidoVentaIdSchema` (mismo archivo) valida el `id` de path como UUID.

### 2.2. Endpoint — `POST /api/ventas/[id]/override-descuento`

`src/app/api/ventas/[id]/override-descuento/route.ts`.

**Autorización de acceso al endpoint:** `withPermission("ventas:aplicar_descuento_margen")` — **un único gate** a nivel de Route Handler (el Cajero invoca la ruta para *solicitar*). La validación de que quien **autoriza** tenga `ventas:autorizar_excepcion_descuento` ocurre **dentro del servicio**, contra `supervisor_credencial.usuario_id` (§3.3). No hay un segundo `withPermission()` en la ruta: `withPermission()` acepta un único código de permiso.

> **Discrepancia resuelta con la tarea:** `docs/tasks/HU-B4.md` §1.3 pedía contrastar este criterio de dos niveles contra el patrón de HU-B6 §2.6. Relevado: **HU-B6 no tiene código** (`GET /api/ventas/auditoria` no existe, §8), así que no hay patrón real de doble gate con qué contrastar. Se mantuvo el diseño de la tarea y quedó documentado en el docstring del Route Handler y del servicio.

**Body:** `AutorizarOverrideDescuentoSchema`. **Path:** `id` (UUID del `PedidoVenta`).

| Status | Código | Cuándo |
|---|---|---|
| `200` | — | Autorización exitosa |
| `400` | `VALIDATION_ERROR` | `id` de path no es UUID, o body inválido contra Zod (incluye el `.refine`; devuelve además `fieldErrors`) |
| `401` | `UNAUTHORIZED` | Sin sesión |
| `403` | `FORBIDDEN` | La **sesión** no tiene `ventas:aplicar_descuento_margen` (gate del endpoint) |
| `403` | `SIN_PERMISO_AUTORIZACION` | El **usuario autorizante** (`supervisor_credencial.usuario_id`) no existe, está inactivo o no tiene `ventas:autorizar_excepcion_descuento` |
| `404` | `PEDIDO_VENTA_NO_ENCONTRADO` | El pedido no existe o `is_active: false` |
| `409` | `TRANSICION_INVALIDA` | Sin ítem pendiente que coincida (o ítem ya autorizado) |
| `500` | `INTERNAL_ERROR` | Excepción no controlada |

Cualquier otro `ServiceError` cae en `400` (`STATUS_POR_CODIGO[...] ?? 400`). Los dos `403` son distintos y **no deben confundirse**: uno gatea a quien llama, el otro a quien autoriza.

**Respuesta `200`:**

```json
{ "data": { "autorizacion_id": "uuid", "descuento_aplicado": 12.5, "autorizado_por": "uuid" }, "error": null }
```

`descuento_aplicado` es `null` cuando la autorización fue **exclusivamente** un cambio de precio (§3.4). `autorizacion_id` es un **id de correlación**, no el `id` de una fila de `AuditLog` (§3.5).

`dispositivo` (campo del evento sensible) se resuelve en el Route Handler desde el header `User-Agent` (`"unknown"` si falta) — mismo mecanismo que `usuario:sesion_iniciada` en `src/app/api/auth/login/route.ts`, único precedente real de captura de "dispositivo de origen" hallado en el proyecto.

El Route Handler no implementa lógica de negocio: resuelve permiso, parsea con Zod, delega en `autorizarOverrideDescuento()` y mapea resultado/excepción.

### 2.3. Server Action — `autorizarOverrideDescuentoAction()` (`src/app/(dashboard)/ventas/pos/actions.ts`)

Equivalente exacto del Route Handler, mismo shape `{ data, error }`. Primer Server Action de la carpeta `ventas/pos/` (no existe HU-B1). Verifica "a mano" `getServerSession()` + `usuarioTienePermiso(..., "ventas:aplicar_descuento_margen")` (mismo patrón que las Server Actions de HU-B3), parsea `PedidoVentaIdSchema` + `AutorizarOverrideDescuentoSchema`, resuelve `dispositivo` con `headers().get("user-agent")`, invoca el **mismo** servicio y hace `revalidatePath("/ventas/pedidos/[id]")`.

---

## 3. Capa de servicios — `lib/services/ventas/pedido-venta.service.ts`

Archivo nuevo: HU-B3 solo creó `presupuesto.service.ts`; este es el primer servicio que opera sobre `PedidoVenta`/`PedidoVentaItem` **post-creación**. Exporta `autorizarOverrideDescuento()` (escritura) y dos lecturas para la UI (`obtenerPedidoVenta()`, `listarSupervisoresVentas()`, §5).

### 3.1. `autorizarOverrideDescuento(pedidoVentaId, input, usuarioSolicitanteId, dispositivo)` → `Promise<OverrideDescuentoAutorizado>`

Cumple **CA1–CA5**. Orden real de operaciones:

1. **Antes de abrir la transacción:** `autorizacionId = crypto.randomUUID()` (§3.5).
2. **Dentro de una única `prisma.$transaction`**, en este orden:
   1. **Pedido:** `tx.pedidoVenta.findFirst({ id, is_active: true })` → si no existe, `PEDIDO_VENTA_NO_ENCONTRADO`.
   2. **Ítem pendiente:** `tx.pedidoVentaItem.findFirst({ pedido_venta_id, requiere_autorizacion: true, [variante_sku_id si vino] })` → si no hay, `TRANSICION_INVALIDA` ("El pedido no tiene ningún ítem pendiente de autorización que coincida con lo solicitado").
   3. **Ítem ya autorizado:** si el ítem hallado tiene `autorizado_por_id !== null` → `TRANSICION_INVALIDA` ("Este ítem ya fue autorizado").
   4. **Autorizante:** `tx.usuario.findFirst(...)` con **una sola condición** que exige, sobre `supervisor_credencial.usuario_id`: `is_active`, `deleted_at: null`, `estado: "ACTIVO"` y un rol activo con un `RolPermiso` activo cuyo `Permiso.codigo` sea `ventas:autorizar_excepcion_descuento` (activo). Si no hay resultado → `SIN_PERMISO_AUTORIZACION` ("Solo un Supervisor de Ventas puede autorizar excepciones de descuento").
   5. **Ajuste:** `tx.pedidoVentaItem.update` con `autorizado_por = supervisorId`, `requiere_autorizacion = false` y, según el input, `descuento_porcentual` y/o `precio_unitario` (§3.4).
3. **`COMMIT`.**
4. **Post-`COMMIT`:** emisión de los eventos (§4) con `timestamp = new Date().toISOString()`.
5. Retorna `{ autorizacion_id, descuento_aplicado: input.descuento_porcentual_solicitado ?? null, autorizado_por: supervisorId }`.

### 3.2. Criterio de gate único + validación interna del autorizante

Dos permisos distintos, dos lugares distintos, dos usuarios distintos:

| Permiso | Se valida | Contra quién | Dónde |
|---|---|---|---|
| `ventas:aplicar_descuento_margen` | Gate del endpoint | El usuario de la **sesión** (quien solicita, el Cajero) | `withPermission()` en el Route Handler / `usuarioTienePermiso()` en la Server Action |
| `ventas:autorizar_excepcion_descuento` | Validación de negocio | `supervisor_credencial.usuario_id` (quien autoriza) — **nunca** `usuarioSolicitanteId` | Dentro de la `$transaction` del servicio |

`usuarioSolicitanteId` (la sesión) **solo** viaja al payload del evento como `usuario_solicitante_id`; jamás participa de la validación de autorización (spec §2.4: "la credencial autorizante es la del Supervisor"). Un test dedicado exige por regex que la consulta use `supervisor_credencial.usuario_id` y no `usuarioSolicitanteId` (§7).

La consulta del autorizante corre **dentro de la misma transacción** para no dejar una ventana entre "el permiso se validó" y "el ítem se actualizó" frente a una revocación concurrente, y usa el mismo criterio de "usuario funcional" (activo, no eliminado, `estado: ACTIVO`) que `filtroAdministradorFuncional()` de `with-permission.ts`. La resolución `UsuarioRol → RolPermiso → Permiso` se hace en cada llamada, sin cachear (mismo principio de revocación inmediata de Módulo D).

### 3.3. Orden de validaciones y códigos de error

`PEDIDO_VENTA_NO_ENCONTRADO` (404) → `TRANSICION_INVALIDA` (409, sin ítem pendiente) → `TRANSICION_INVALIDA` (409, ya autorizado) → `SIN_PERMISO_AUTORIZACION` (403). El pedido se valida antes que el ítem y el ítem antes que el permiso del Supervisor (un test source-regex verifica el orden). `TRANSICION_INVALIDA` reutiliza el código que el resto del módulo usa para "esta operación no aplica al estado actual del recurso".

### 3.4. Decisiones que la spec no resolvía literalmente

Todas están documentadas en el código y en el PR de la HU:

| Punto | Decisión implementada |
|---|---|
| `precio_lista_modificado` no tiene columna propia en `PedidoVentaItem` | Se persiste como ajuste directo de **`precio_unitario`** (única columna que representa "precio de lista" a nivel de ítem). El precio previo se captura antes del `update` para el evento. |
| Ambos campos a la vez (`.refine` solo exige al menos uno) | Se aplican **ambos** ajustes en el mismo `update` y se emiten **ambos** eventos con el **mismo** `autorizacion_id`. |
| `variante_sku_id` ausente (campo opcional) | Se toma el ítem pendiente que devuelva `findFirst` (sin `orderBy`). Es seguro para el caso de referencia (un único ítem pendiente por pedido); con **más de un** ítem pendiente y sin `variante_sku_id`, el ítem elegido no está determinado por el contrato. La UI siempre envía `variante_sku_id`. |
| `descuento_aplicado` en un cambio de precio puro | `null` (spec §2.4 solo define `descuento_aplicado`, no un campo de precio en la respuesta). |
| `dispositivo` | `User-Agent` del request (§2.2). |
| Reintento sobre un ítem ya autorizado | El `where` de la búsqueda exige `requiere_autorizacion: true`, y el primer autorizar lo pasa a `false`. Por lo tanto el reintento normal cae en el **primer** `TRANSICION_INVALIDA` ("sin ítem pendiente que coincida"). La rama "Este ítem ya fue autorizado" solo es alcanzable con un estado incoherente (`requiere_autorizacion: true` **y** `autorizado_por_id` no nulo) — funciona como defensa en profundidad. El código HTTP (`409`) es el mismo en ambos casos. |

### 3.5. Decisión de diseño — `autorizacion_id` es un id de correlación, no el `id` real de `AuditLog`

`spec_modulo_B.md` §2.4 decía originalmente que `autorizacion_id` es "el id del AuditLog". **Se resolvió, antes de implementar, que eso no es posible**, y la spec fue corregida (§2.4 tiene ahora una "Corrección de redacción (HU-B4)"). Justificación completa:

1. **Regla de escritura asíncrona de Módulo D.** `spec_modulo_D.md` (línea 17) define que Módulo D "consume de forma asíncrona los eventos de dominio… para materializar" el `AuditLog`. En el código, `audit-log.listener.ts` implementa esa regla **sin excepciones**: los ~30 handlers existentes son `domainEventBus.on(..., (payload) => { void registrarAuditLog(...) })` — *fire-and-forget*, jamás `await`. Ningún servicio del proyecto escribe `AuditLog` de forma directa/sincrónica: es una regla no-negociable, ya corregida una vez en el historial del proyecto (docstring del listener, corrección de HU-1/HU-2) y fundamentada en `spec_modulo_A.md` §4 ("la regla aplica sin excepción… para evitar que un consumidor lento bloquee el commit").
2. **Consecuencia:** cuando el servicio de Módulo B retorna, la fila de `AuditLog` **todavía no existe** (o existe pero el servicio no tiene forma de conocer su `id`). Ningún endpoint puede devolver sincrónicamente el `id` real de esa fila.
3. **Alternativa descartada — hacer esperable el listener.** El `EventEmitter` de `domain-event-bus.ts` no soporta listeners esperables (todos los handlers son `void`). Cambiarlo solo para HU-B4 exigiría tocar la firma genérica del bus y afectaría a todos los eventos ya emitidos por el resto del sistema: riesgo desproporcionado para una sola HU.
4. **Alternativa descartada — escribir `AuditLog` desde el servicio.** Violaría la regla de unificación anterior (punto 1).
5. **Resolución adoptada.** Módulo B genera `autorizacionId = crypto.randomUUID()` **antes del `COMMIT`**, lo devuelve en la respuesta `200`, lo incluye en el payload de los eventos y el listener lo persiste **dentro de `valor_nuevo`** del `AuditLog` real. El id queda **trazable y buscable** contra el ledger sin acoplar el servicio a la escritura asíncrona.
6. **Contrato observable sin cambios:** sigue siendo un `uuid` en el mismo campo `autorizacion_id` de la respuesta. Solo cambió la redacción de la spec ("id de correlación resoluble contra el `AuditLog`").
7. **Verificado en runtime:** el test HTTP de integración confirma que el `autorizacion_id` de la respuesta aparece dentro de `valor_nuevo` de la fila real de `AuditLog` (§7).

**Sobre las tablas:** no se creó ninguna tabla de autorizaciones propia; Módulo B no es propietario de `AuditLog` (nota de diseño en `schema.prisma`, junto a `PedidoVentaItem`).

### 3.6. Límites conocidos (relevados leyendo el código; sin test dedicado)

- **Concurrencia:** el ítem se lee y luego se actualiza por `id` sin una condición de guarda en el `update` ni un lock explícito. Bajo `READ COMMITTED`, dos autorizaciones simultáneas sobre el mismo ítem podrían pasar ambas la validación. No hay un test de concurrencia para este caso (a diferencia de `aceptarPresupuesto()` en HU-B3, que sí protege la doble aceptación con un `@unique`).
- **Lectura sin filtro de `is_active` del pedido:** `obtenerPedidoVenta()` (§5) no filtra `is_active` del `PedidoVenta` (sí filtra los ítems), mientras que la escritura sí exige `is_active: true`. Hoy no hay ningún flujo que desactive un pedido, así que no tiene efecto observable.

### 3.7. Lecturas para la UI

- **`obtenerPedidoVenta(id)`** → `PedidoVentaDetalle | null`: pedido + cliente + ítems activos (orden `created_at asc`) con `sku`, descripción (`producto · modelo · talle/color`), cantidad, precio, `descuento_porcentual`, `requiere_autorizacion`, `autorizado_por_id` y `autorizado_por_nombre`.
- **`listarSupervisoresVentas()`** → usuarios activos y `ACTIVO` con `ventas:autorizar_excepcion_descuento`, ordenados por `nombre_completo`. Alimenta el selector nominal del Dialog (§5.3).

---

## 4. Eventos de dominio y auditoría

`src/lib/events/event-types.ts` declara los dos eventos en `DomainEventMap`; `src/lib/events/listeners/audit-log.listener.ts` registra un handler por evento. **Ambos son sensibles** (spec §2.4/§4), pero no existe una distinción de código entre evento "sensible" y "estándar" al escribir `AuditLog`: es una distinción narrativa de la spec.

Ambos se emiten **después del `COMMIT`**, nunca dentro de la transacción (spec §3.3).

### 4.1. `venta:descuento_fuera_margen` — se emite si vino `descuento_porcentual_solicitado`

```typescript
interface DescuentoFueraMargenPayload {
  autorizacion_id: string;        // id de correlación (§3.5)
  pedido_venta_id: string;
  usuario_solicitante_id: string; // usuario de la SESIÓN (el Cajero)
  usuario_autorizante_id: string; // supervisor_credencial.usuario_id
  porcentaje_aplicado: number;
  motivo: string;
  dispositivo: string;            // User-Agent
  timestamp: string;              // ISO-8601
}
```

Spec §4 + `autorizacion_id` agregado por la decisión de §3.5.

### 4.2. `venta:cambio_precio_manual` — se emite si vino `precio_lista_modificado`

```typescript
interface CambioPrecioManualPayload {
  autorizacion_id: string;
  pedido_venta_id: string;
  variante_sku_id: string;
  usuario_autorizante_id: string;
  precio_anterior: number;
  precio_nuevo: number;
  motivo: string;
}
```

Si vienen **ambos** campos, se emiten los dos eventos con el mismo `autorizacion_id`.

### 4.3. Fila resultante en `AuditLog` (vía listener, `void registrarAuditLog(...)`)

| Campo | `venta:descuento_fuera_margen` | `venta:cambio_precio_manual` |
|---|---|---|
| `usuario_id` | `usuario_autorizante_id` | `usuario_autorizante_id` |
| `accion` | `DESCUENTO_FUERA_MARGEN` | `CAMBIO_PRECIO_MANUAL` |
| `tabla_afectada` | `pedidos_venta` (el `@@map` en minúsculas) | `pedidos_venta` |
| `registro_id` | `pedido_venta_id` | `pedido_venta_id` |
| `ip` | `"internal-event"` | `"internal-event"` |
| `valor_anterior` | `null` | `{ precio_unitario: precio_anterior }` |
| `valor_nuevo` | `{ autorizacion_id, usuario_solicitante_id, porcentaje_aplicado, motivo, dispositivo, timestamp }` | `{ autorizacion_id, variante_sku_id, precio_unitario: precio_nuevo, motivo }` |

Observaciones: (a) el `usuario_id` del `AuditLog` es el **autorizante**; el solicitante queda dentro de `valor_nuevo` (solo en el evento de descuento); (b) el evento de descuento **no** incluye `variante_sku_id`, por lo que en el `AuditLog` queda identificado el pedido pero no el ítem — coherente con el payload de spec §4, que tampoco lo define.

---

## 5. Frontend

### 5.1. Pantalla — `/ventas/pedidos/[id]/page.tsx` (React Server Component)

- `dynamic = "force-dynamic"`. Sin sesión → `redirect("/login")`. Sin `ventas:leer` → `redirect("/no-autorizado")`. Pedido inexistente → `notFound()`.
- En paralelo: `obtenerPedidoVenta(id)` y `usuarioTienePermiso(..., "ventas:autorizar_excepcion_descuento")`. Solo si el usuario puede autorizar se invoca `listarSupervisoresVentas()`.
- Tabla de ítems: variante (SKU + descripción), cantidad, precio unitario, descuento, autorización y una columna de acción. Fila de total del pedido.
- Por cada ítem, la acción **"Autorizar excepción"** (`DialogAutorizarOverrideDescuento`) se muestra solo si `puedeAutorizar && requiere_autorizacion && autorizado_por_id === null`.
- **Es una pantalla mínima por diseño** (`docs/tasks/HU-B4.md` §2): no es gestión de `PedidoVenta`, no tiene listado `/ventas/pedidos` y **no tiene ítem propio en el Sidebar** (la sección "Ventas" sigue mostrando solo "Presupuestos"). Se accede por URL directa o desde el `pedido_venta_id` que `aceptarPresupuesto()` (HU-B3) expone en `/ventas/presupuestos/[id]`.
- Observación sobre el flujo real en UI: como el Dialog solo se renderiza para quien tiene `ventas:autorizar_excepcion_descuento`, la sesión que opera la pantalla es la de un Supervisor (confirmado en el QA visual: `cajero.seed` **no** ve el botón, `supervisor.ventas.seed` sí). El flujo "Cajero solicita, Supervisor aporta su identidad" existe a nivel de **API** (así lo ejercita el test HTTP con la sesión de `cajero.seed`), no a nivel de esta pantalla.

### 5.2. `AutorizacionItemBadge.tsx` — los 3 estados

Badge puro del par `requiere_autorizacion` / `autorizado_por_id`. `requiere_autorizacion` **por sí solo no alcanza** para decidir el estado (ver §6):

| # | `requiere_autorizacion` | `autorizado_por_id` | Render |
|---|---|---|---|
| 1 | `false` | `null` | `null` — sin autorización pendiente ni resuelta |
| 2 | `true` | (siempre `null` por invariante del servicio) | Badge ámbar **"Pendiente de autorización"** |
| 3 | `false` | no nulo | Badge verde **"Autorizado"** |

En la pantalla, junto al badge "Autorizado" se muestra "Autorizado por {nombre}" (`autorizado_por_nombre`). Cuando no hay estado que mostrar (caso 1), la celda muestra "—".

### 5.3. Selector nominal de Supervisor y su justificación de seguridad

`DialogAutorizarOverrideDescuento.tsx` (`AlertDialog` + `useState` manual + Server Action, sin `react-hook-form`; mismo patrón que `ModalReclasificacion` y `DialogAceptarPresupuesto`). Formulario:

- **Tipo de ajuste:** toggle "Descuento porcentual" / "Precio de lista modificado" — mutuamente explicativo en la UI, aunque el schema permite ambos. Descuento: número en `[0, 100]`; precio: número `> 0`.
- **Supervisor autorizante:** `<select>` con la lista de `listarSupervisoresVentas()` (más un placeholder).
- **Motivo:** obligatorio.
- El botón "Confirmar autorización" se habilita solo con valor válido + motivo + Supervisor elegido. Tras el éxito: cierra, limpia y `router.refresh()`.

**Por qué un selector nominal y no re-autenticación.** La tarea dejó abierta la pregunta de cómo identificar al Supervisor autorizante en la UI (`docs/tasks/HU-B4.md` §2: "relevar este punto contra el equipo/PO antes de asumir un diseño"). La decisión, confirmada con el usuario antes de implementar (queda documentada en el docstring del componente y de `listarSupervisoresVentas()`), fue el selector nominal, por estas razones:

1. **El contrato no admite otra cosa.** `AutorizarOverrideDescuentoSchema` está copiado literalmente de la spec y `supervisor_credencial` solo transporta `usuario_id`; el endpoint no recibe contraseña ni token del Supervisor. Una re-autenticación exigiría cambiar el contrato de la spec.
2. **La autorización real no depende de la UI.** El backend **re-valida** dentro de la transacción que el `usuario_id` elegido exista, esté activo y tenga `ventas:autorizar_excepcion_descuento` (§3.2). Elegir a alguien sin el permiso devuelve `403 SIN_PERMISO_AUTORIZACION`; el selector es una comodidad, no un control de seguridad.
3. **La lista ya está restringida** a usuarios con el permiso (`listarSupervisoresVentas()`); el QA visual confirmó que hoy contiene exactamente una opción real ("Supervisor de Ventas Seed (Módulo B)").
4. **El Dialog solo se renderiza** para quien tiene el permiso de autorizar (gate en el RSC padre).
5. **Trazabilidad:** aun sin credencial, la operación queda registrada como evento sensible con solicitante (sesión), autorizante (elegido), motivo, dispositivo y timestamp, con `autorizacion_id` resoluble contra el ledger.
6. **Transparencia al usuario:** el propio formulario declara "Selector nominal — el sistema no pide contraseña acá; la autorización se valida server-side contra el permiso real de la persona elegida".

**Límite conocido (consecuencia directa del contrato):** al no haber prueba de identidad del Supervisor, el sistema garantiza que **la persona nombrada tiene el permiso**, pero no que **esa persona esté presente y haya consentido**. Quien invoca el endpoint puede nombrar a cualquier Supervisor válido. Si el negocio necesita esa garantía, requiere ampliar el contrato de spec §2.4 (credencial o segundo factor) — fuera del alcance de HU-B4.

---

## 6. Bug post-QA corregido — el badge "Autorizado" nunca se renderizaba

Se documenta como parte del historial de la HU. Detectado en el QA visual de HU-B4 (`RESULTADO_qa_visual_HU-B3_B4_B8.md`, punto 3 de HU-B4), con la suite de servicio/integración de la ronda anterior en verde.

### 6.1. Síntoma

Tras autorizar con `descuento_porcentual_solicitado = 12.5` (y, en un pedido ad-hoc, con `precio_lista_modificado`), la base quedaba **correcta**:

```
requiere_autorizacion = f
autorizado_por_id     = 1a2b3c4d-4444-4a1a-8a1a-000000000005
descuento_porcentual  = 12.50
```

pero la columna "Autorización" mostraba "—" en lugar del badge "Autorizado", tanto tras `router.refresh()` como tras un hard reload (no era caché ni timing). Era un defecto **puramente de presentación**: el dato y la seguridad del flujo nunca estuvieron comprometidos.

### 6.2. Causa raíz

`page.tsx` decidía qué mostrar con `item.requiere_autorizacion ? <AutorizacionItemBadge …/> : <span>—</span>`, y `AutorizacionItemBadge.tsx` empezaba con `if (!requiereAutorizacion) return null;`. Pero `requiere_autorizacion` **pasa a `false` exactamente cuando la autorización se completa** (es la misma columna que el servicio actualiza al autorizar). Resultado: la rama que debía renderizar "Autorizado" era **código inalcanzable** — el `return null` de arriba (y el ternario de la página) cortaban siempre antes. El campo usado como condición única para "mostrar algo" es el mismo que se apaga cuando debería mostrarse el éxito. Es "el otro lado" de la lógica de gating del botón (que sí funcionaba: `puedeAutorizar && requiere_autorizacion && autorizado_por_id === null`).

### 6.3. Fix aplicado

- **`AutorizacionItemBadge.tsx`:** ahora distingue los **3 estados del par** `requiere_autorizacion` / `autorizado_por_id` (§5.2): pendiente si `requiere_autorizacion`; "Autorizado" si `!requiere_autorizacion && autorizado_por_id !== null`; `null` en el resto.
- **`page.tsx` línea 145:** la condición de render pasó a `item.requiere_autorizacion || item.autorizado_por_id !== null`, de modo que la celda entra a la rama del badge también cuando el ítem ya fue resuelto.
- **Test de regresión:** `AutorizacionItemBadge.test.tsx` (3 tests, uno por estado).

### 6.4. Defecto visual asociado — header "DESCUENTOAUTORIZACIÓN"

En la primera ronda de QA, los textos "DESCUENTO" y "AUTORIZACIÓN" del header se veían pegados. La ronda 1 lo atribuyó a "celda de Autorización vacía". **Esa atribución era incorrecta**: la re-verificación posterior al fix del badge mostró que el defecto persistía con la celda ya llena. Causa real (medida con `getComputedStyle`): las celdas de la tabla solo tenían `py-3`, es decir `padding-left/right: 0px`; con "Descuento" alineado a la derecha y "Autorización" a la izquierda, los textos se tocaban (los `min-w-*` ya presentes ensanchaban las columnas, pero no separaban textos adyacentes).

**Fix:** `px-3` en los `<th>` y `<td>` de las columnas "Descuento" y "Autorización" (4 clases, sin otros cambios). Verificado en navegador: separación de **24 px** entre los textos (antes 0), sin regresión en las demás columnas ni en la fila de total.

### 6.5. Cierre

Re-verificado en Chrome real (rondas 2 y 3, `supervisor.ventas.seed`); ambos hallazgos cerrados, sin hallazgos abiertos. Detalle en §7.3.

---

## 7. Testing — tres niveles

### 7.1. Nivel 1 — Unitarios (`npm test`: **295/295**)

Corrida real del 2026-09-18, posterior al último fix de UI: `tests 295 · pass 295 · fail 0 · cancelled 0 · skipped 0`. Además, `tsc --noEmit` → exit 0 y `eslint .` (proyecto completo) → exit 0, 0 errores (3 warnings preexistentes en archivos ajenos a la HU).

De ese total, corresponden a HU-B4:

| Archivo | Tests | Cubre |
|---|---|---|
| `pedido-venta.service.test.ts` (source-regex, sin DB) | 14 | Permisos exportados = códigos del seed · ruta con un único `withPermission` de `ventas:aplicar_descuento_margen` · orden pedido → ítem → permiso · rechazo de ítem ya autorizado · validación contra `supervisor_credencial.usuario_id` (nunca `usuarioSolicitanteId`) · condición única activo + permiso · código/mensaje exactos de `SIN_PERMISO_AUTORIZACION` · mapeo descuento→`descuento_porcentual` y precio→`precio_unitario` · seteo de `autorizado_por`/`requiere_autorizacion: false` dentro de la transacción · `autorizacion_id` con `crypto.randomUUID()` antes de la `$transaction` · eventos post-`$transaction` · `autorizacion_id` en ambos payloads · ambos eventos cuando vienen ambos campos · `listarSupervisoresVentas` |
| `ventas.schema.test.ts` (validación pura de Zod) | 10 (los de `AutorizarOverrideDescuentoSchema` + `PedidoVentaIdSchema`) | Override válido por descuento / por precio / por ambos · rechazo sin ninguno (`.refine`) · motivo no vacío · descuento fuera de `[0, 100]` · precio no positivo · `usuario_id` UUID · `variante_sku_id` opcional · UUID de path |
| `AutorizacionItemBadge.test.tsx` (render SSR, 3 tests) | 3 | Los 3 estados del badge. **No forma parte del script `npm test`** (ese script usa `--experimental-strip-types`, que no procesa `.tsx` ni el alias `@/`): se corre con `node --import tsx --test src/components/ventas/AutorizacionItemBadge.test.tsx` → **3/3** (corrida real del 2026-09-18). |

Los tests de servicio son de tipo source-regex (verifican estructura del código, no ejecución contra base); la ejecución real la cubre el Nivel 2.

### 7.2. Nivel 2 — Integración contra base y servidor reales

| Script | Resultado | Qué ejercita |
|---|---|---|
| `npm run test:integration:b4` (`pedido-venta.integration.test.ts`) | **9/9** (1 test raíz + 8 subtests) | Fixture `V-2026-000003` pendiente · `PEDIDO_VENTA_NO_ENCONTRADO` · `variante_sku_id` sin match → `TRANSICION_INVALIDA` · autorizante sin permiso → `SIN_PERMISO_AUTORIZACION` · fixture ad-hoc propio (no toca el seed) · autorización por descuento + evento `venta:descuento_fuera_margen` · segunda autorización rechazada · cambio de precio + evento `venta:cambio_precio_manual` |
| `npm run test:integration:b4-http` (`pedido-venta.http.integration.test.ts`) | **6/6** (1 raíz + 5 subtests) | Sin sesión → `401` · sesión de `cajero.seed` con autorizante sin permiso → `403 SIN_PERMISO_AUTORIZACION` · sesión de `cajero.seed` + `supervisor.ventas.seed` como autorizante → `200` · repetir → `409 TRANSICION_INVALIDA` · el `autorizacion_id` de la respuesta HTTP aparece dentro de `valor_nuevo` del `AuditLog` real |
| `npm run test:integration:b8` (`rbac-hu-b8.integration.test.ts`) | **8/8** (1 raíz + 7 subtests), tras el fix de UUID | RBAC de HU-B8 sobre el que se apoya el gate de esta HU (roles `CAJERO_POS` / `SUPERVISOR_VENTAS` con los permisos `ventas:*`) |

**Sobre el fix de UUID (HU-B8):** el QA visual se hizo contra una base reseedeada con el fix de colisión de UUID del seed; tras el `migrate reset`, el header de cada usuario muestra el rol correcto (`CAJERO_POS` / `SUPERVISOR_VENTAS`) y no reaparecieron `VENDEDOR` / `ADMINISTRADOR_CRM` (roles de Módulo C). Es prerrequisito de HU-B4: sin el rol `SUPERVISOR_VENTAS` asignado, `supervisor.ventas.seed` no tendría `ventas:autorizar_excepcion_descuento`.

> **Nota de procedencia y reproducibilidad.** Los resultados 9/9, 6/6 y 8/8 son los reportados por la ronda de integración de la HU; la estructura (cantidad de tests/subtests por archivo) fue contrastada contra los archivos de test, pero **no se re-ejecutaron** al armar este documento. Además, el subtest `V-2026-000003: ítem … pendiente de autorización` de `test:integration:b4` afirma que el ítem del fixture está pendiente; el QA visual **autorizó** ese ítem en la base local (`requiere_autorizacion = f`, `autorizado_por_id` seteado). Para volver a correr esa suite hay que restaurar el fixture (reseed / reset de la base de desarrollo).

### 7.3. Nivel 3 — QA visual con navegador real (**CONFIRMADO**)

Chrome real (extensión Claude in Chrome) contra `localhost:3000`, `next dev` sobre Postgres local. Texto extraído del DOM + capturas + verificación directa en Postgres.

**HU-B4 — puntos verificados (ronda 1):** ítem BORCEGOS de `V-2026-000003` con badge "Pendiente de autorización" y botón "Autorizar excepción" (solo con sesión de Supervisor; `cajero.seed` no lo ve) ✔ · el `<select>` de Supervisor lista exactamente una opción real ✔ · autorización por descuento 12.5 % con base correcta (defecto de UI → §6) · autorización por `precio_lista_modificado` sobre el pedido ad-hoc `V-TEST-QA-PRECIO-1`, con `precio_unitario = 38000.00` en base y en tabla ✔ · un ítem ya autorizado no vuelve a ofrecer la acción ✔.

**Re-verificación del fix (rondas 2 y 3):**

| # | Verificación | Resultado |
|---|---|---|
| 1 | BORCEGOS de `V-2026-000003` (12.5 %) muestra badge "Autorizado" + "Autorizado por Supervisor de Ventas Seed (Módulo B)" | ✔ |
| 2 | Ítem ad-hoc de `V-TEST-QA-PRECIO-1` (`precio_lista_modificado`, $38.000,00) muestra el mismo badge y no reofrece autorizar | ✔ |
| 3 | Desaparece el colapso visual "DESCUENTOAUTORIZACIÓN" | ✔ tras `px-3` (24 px de separación) |
| 4 | Control negativo: CAMTAC-MANGA LARGA-M-VERDE-H (sin autorización) muestra "—" en Descuento y Autorización, sin badge | ✔ |

**Conclusión HU-B4 (QA visual): CONFIRMADO**, con los 4 puntos pasando y sin hallazgos abiertos.

---

## 8. Fuera de alcance explícito / capacidades no implementadas

- **HU-B1 (venta de mostrador, `POST /api/ventas`)** — no existe. No se implementó ni el flujo de venta en curso ni el **cálculo del "margen habilitado por perfil"** que decide si un descuento requiere este endpoint; esa decisión está tomada en el dato (`requiere_autorizacion: true`). Ver §1.1.
- **Recargos por financiación en cuotas** — spec §2.4 los describe como "mismo patrón". No se construyó UI, casos de prueba ni lógica propia: no existe ningún flujo de venta en cuotas real en el sistema, y el código no distingue este caso (**CA6 sin cumplir**).
- **HU-B5 (cuenta corriente)** — sin código de aplicación (solo el modelo de datos).
- **HU-B6 (log forense, `GET /api/ventas/auditoria`)** — no implementada. Por eso no hubo patrón real de doble gate con qué contrastar (§2.2). Los eventos de HU-B4 sí llegan al `AuditLog` de Módulo D, pero su consulta desde Ventas queda para HU-B6.
- **§2.8 (anulación de pedido, `PATCH /api/ventas/[id]/anular`)** — no tocada.
- **Listado completo `/ventas/pedidos`** (con filtros/paginación tipo `TablaFiltroPaginada`) — no construido; no hay ítem de Sidebar ni pantalla de gestión de pedidos. Solo existe el detalle mínimo `/ventas/pedidos/[id]`, alcanzable por URL o desde el detalle del presupuesto.
- **Tabla de autorizaciones propia** — descartada a propósito (§3.5); se reutiliza `AuditLog`.
- **Estado de espera propio en `PedidoVenta`** — descartado; el estado de espera vive en el ítem (§1.1).
- **Re-autenticación / credencial real del Supervisor** — no soportada por el contrato de spec §2.4 (§5.3).
- **Generación de ítems `requiere_autorizacion: true` desde la aplicación** — hoy ningún flujo lo hace (§1.1); solo seed y fixtures.

---

## 9. Cumplimiento de cada Criterio de Aceptación

| CA | Cumplido por |
|---|---|
| **CA1** — Autorización exitosa y respuesta `200` | `autorizarOverrideDescuento()` (§3.1) + `POST /api/ventas/[id]/override-descuento` (§2.2) + `autorizarOverrideDescuentoAction()` (§2.3) + `DialogAutorizarOverrideDescuento.tsx`; verificado por `test:integration:b4`/`b4-http` y QA visual |
| **CA2** — `403 SIN_PERMISO_AUTORIZACION` | Consulta del autorizante dentro de la `$transaction` (§3.2); cubierto por unitarios de regex, subtest de `b4` y subtest de `b4-http` |
| **CA3** — Evento sensible hacia Módulo D | Emisión de `venta:descuento_fuera_margen` / `venta:cambio_precio_manual` (§4) + handlers de `audit-log.listener.ts`; `autorizacion_id` verificado dentro de `valor_nuevo` del `AuditLog` real (`b4-http`) |
| **CA4** — Transacción única + eventos post-`COMMIT` | `prisma.$transaction` + emisión posterior (§3.1); unitario "eventos después de la `$transaction`" |
| **CA5** — `409 TRANSICION_INVALIDA` / `404` | Validaciones de §3.3; subtests de `b4` y `b4-http` (segunda autorización, `variante_sku_id` sin match, pedido inexistente) |
| **CA6** — Recargos por cuotas | **No cumplido** — fuera de alcance (§8) |

---

## 10. Capacidades adicionales no exigidas por los CA

- **Pantalla mínima de detalle de `PedidoVenta`** (`/ventas/pedidos/[id]`) con badge por ítem: no la exige ningún CA de la spec, pero es la superficie que hace **operable y verificable** el flujo sin HU-B1 (§5.1).
- **Doble red de seguridad sobre el autorizante:** el Dialog solo se muestra a quien tiene `ventas:autorizar_excepcion_descuento` (RSC) **y** el servicio re-valida el permiso real del `usuario_id` elegido dentro de la transacción.
- **Suite de tests triple:** `pedido-venta.service.test.ts` (source-regex, corre en `npm test`), `AutorizacionItemBadge.test.tsx` (render SSR, corrida aparte) e integración opt-in contra base real (`test:integration:b4` / `b4-http`), más el QA visual en navegador.
- **Test de trazabilidad end-to-end** del `autorizacion_id`: la respuesta HTTP se busca dentro de `valor_nuevo` del `AuditLog` real, cerrando la trazabilidad pese a la escritura asíncrona.
- **Fixtures de integración propios:** el subtest de autorización de `b4` crea un `PedidoVenta`/`PedidoVentaItem` ad-hoc y no muta el seed.
