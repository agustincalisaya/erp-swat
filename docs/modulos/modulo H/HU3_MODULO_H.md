# Especificación Técnica — HU-H3 (Emisión y Seguimiento de Orden de Compra)

## ERP SWAT Indumentarias — Módulo H

## Documento de cierre — regenerado desde el código real el 04/09/2026

> **Cómo se escribió este documento.** No se partió de la spec previa ni de
> notas de desarrollo: se releyó archivo por archivo el código mergeado en
> `develop` al 04/09/2026 y se reconstruyó la línea de tiempo desde
> `git log`. Todo lo que se afirma acá tiene una referencia
> `archivo:línea` verificable. Donde el código **no** coincide con lo que la
> spec original definía, o donde un criterio quedó cumplido de forma parcial
> o por un camino distinto al especificado, está dicho de forma explícita en
> la sección 9 — no se maquilló nada para que "cierre bien".
>
> El antecedente es HU-A7: su documento de spec describía funcionalidad
> descartada y omitía funcionalidad agregada después. Este documento existe
> para no repetir eso.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Comprador, **necesito** emitir una orden de compra contra la lista de
precios vigente del proveedor homologado y hacer seguimiento de su estado hasta
el cierre, **para** garantizar la reposición de stock a tiempo para cumplir
compromisos de entrega de licitaciones institucionales.

| # | Criterio de aceptación |
|---|---|
| CA1 | El flujo de la OC: Borrador → Enviada → Confirmada → Recepción Parcial → Recibida Completa → Cerrada. |
| CA2 | La orden queda bloqueada para edición de ítems y cantidades una vez enviada al proveedor. |
| CA3 | El sistema alerta ante incumplimiento de la fecha de entrega comprometida. |
| CA4 | Cada recepción (parcial o total) dispara el alta de stock en el Módulo A con referencia a la OC y proveedor de origen. |
| CA5 | La cancelación es baja lógica con motivo obligatorio; la OC permanece en el historial para trazabilidad de la negociación. |

**Contrato de origen:** `docs/specs/spec_modulo_H.md` §2.4 (emisión), §2.5
(transiciones), §3.1 (máquina de estados), §3.4 (transacciones y eventos),
§3.5 (baja lógica). La porción de Módulo H diferida a un sprint posterior
—en particular HU-H2, publicación de listas de precios— está en
`docs/specs/spec_modulo_H_diferido.md` §2.3 y §3.4.

---

## 2. Visión General de la implementación

HU-H3 es un circuito de estado con **toda la lógica de negocio concentrada en
un único service**. Las tres superficies de entrada (Route Handlers, Server
Actions, RSC de las pantallas) son wrappers finos que resuelven sesión +
permiso, parsean con Zod y delegan.

```
UI (RSC + Client Components)
  src/app/(dashboard)/compras/ordenes/page.tsx          listado
  src/app/(dashboard)/compras/ordenes/nueva/page.tsx    alta
  src/app/(dashboard)/compras/ordenes/[id]/page.tsx     detalle + acciones + historial
        │
        ├── Server Actions ── src/app/(dashboard)/compras/ordenes/actions.ts
        │
        └── (equivalente HTTP)
             src/app/api/ordenes-compra/route.ts               POST   crear
             src/app/api/ordenes-compra/[id]/estado/route.ts   PATCH  transición
             src/app/api/ordenes-compra/[id]/items/route.ts    PUT    editar ítems
                          │
                          ▼
        src/lib/services/proveedores/orden-compra.service.ts   ◄── toda la lógica
                          │
                          ├── prisma.$transaction  (escritura atómica)
                          └── domainEventBus.emit  (POST-COMMIT, nunca dentro)
                                       │
                                       ├── audit-log.listener.ts   → Módulo D (ledger SHA-256)
                                       └── cuenta-por-pagar.listener.ts → Módulo G (HU-G8)
```

**Superficie real de archivos de HU-H3:**

| Capa | Archivo | Líneas |
|---|---|---|
| Dominio | `src/lib/services/proveedores/orden-compra.service.ts` | 1034 |
| Contratos | `src/lib/schemas/ordenes-compra.schema.ts` | 115 |
| HTTP | `src/app/api/ordenes-compra/route.ts` | 69 |
| HTTP | `src/app/api/ordenes-compra/[id]/estado/route.ts` | 100 |
| HTTP | `src/app/api/ordenes-compra/[id]/items/route.ts` | ~100 |
| Server Actions | `src/app/(dashboard)/compras/ordenes/actions.ts` | 140 |
| Pantalla | `src/app/(dashboard)/compras/ordenes/page.tsx` | 166 |
| Pantalla | `src/app/(dashboard)/compras/ordenes/nueva/page.tsx` | 119 |
| Pantalla | `src/app/(dashboard)/compras/ordenes/[id]/page.tsx` | 473 |
| UI | `TablaOrdenesCompra.tsx`, `FormularioNuevaOrdenCompra.tsx`, `EditorItemsOrdenCompra.tsx`, `EstadoOrdenCompraBadge.tsx`, `DialogEnviarOrdenCompra.tsx`, `DialogConfirmarOrdenCompra.tsx`, `DialogCerrarOrdenCompra.tsx`, `DialogCancelarOrdenCompra.tsx` | 1571 |
| Eventos | `src/lib/events/event-types.ts:534-538`, `audit-log.listener.ts:367-433` | — |
| Datos | `prisma/schema.prisma:755-830`, `prisma/seed.ts:1032-1103` y `1341-1440` | — |

> **Nota de conteo.** El prompt de trabajo hablaba de "las 4 pantallas en
> `app/(dashboard)/compras/ordenes/`". En el código real hay **3 pantallas**
> (`page.tsx`, `nueva/page.tsx`, `[id]/page.tsx`) más `actions.ts`, que no es
> una pantalla sino el archivo de Server Actions. No falta nada: la cuarta
> "pantalla" del circuito (`/compras/recepciones/nueva`) pertenece a HU-H4.

### 2.1. Modelo de datos

`OrdenCompra` (`prisma/schema.prisma:755-792`) con el enum
`EstadoOrdenCompra` de 7 valores (`794-802`) y `OrdenCompraItem`
(`807-830`). El bloque de baja lógica estándar (`is_active`, `deleted_at`,
`deleted_by`, `deletion_reason`) está en ambos modelos y es el que CA5 reutiliza
—no hay un campo `motivo_cancelacion` propio.

`fecha_entrega_comprometida` (`schema.prisma:768`, nullable) se agregó en una
migración dedicada:
`prisma/migrations/20260831151245_add_fecha_entrega_comprometida_orden_compra/migration.sql`.
Es distinta de `fecha_confirmacion`: esta última es *cuándo se confirmó*,
aquella es *para cuándo se comprometió el proveedor*, y solo se setea al
CONFIRMAR.

Las listas de precios (`ListaPrecio` `656-675`, `ListaPrecioVersion`
`687-715`, `ListaPrecioItem` `723-746`) ya existían en el schema pero sin
mecanismo de carga: HU-H2 está diferida. Ver la decisión de "Camino A" en §5.4.

La relación con HU-H4 es por FK: `Recepcion.orden_compra_id`
(`schema.prisma:841`) y `RecepcionItem.orden_compra_item_id` (`879`). **No hay
llamadas de código entre los services de H3 y H4** — ver §6.

---

## 3. Cumplimiento de cada Criterio de Aceptación

### ✅ CA1 — El flujo completo Borrador → … → Cerrada

**Estado: cumplido.** La particularidad es que el flujo está **repartido entre
dos HU**, y eso es intencional.

Las 4 transiciones que gobierna HU-H3 viven en la tabla
`TRANSICIONES` (`orden-compra.service.ts:67-72`):

```typescript
const TRANSICIONES: Record<AccionOrdenCompra, ReglaTransicion> = {
  ENVIAR:    { origenes: ["BORRADOR"],           destino: "ENVIADA"   },
  CONFIRMAR: { origenes: ["ENVIADA"],            destino: "CONFIRMADA"},
  CERRAR:    { origenes: ["RECIBIDA_COMPLETA"],  destino: "CERRADA"   },
  CANCELAR:  { origenes: ["BORRADOR","ENVIADA"], destino: "CANCELADA" },
};
```

Las 2 transiciones del tramo físico (`CONFIRMADA → RECEPCION_PARCIAL →
RECIBIDA_COMPLETA`) **no están acá a propósito**: las gobierna
`recepcion.service.ts` de HU-H4, que resuelve el estado destino en
`recepcion-reglas.ts:15-22` y lo escribe en `recepcion.service.ts:287-301`.
`CERRAR` de H3 simplemente lee el `RECIBIDA_COMPLETA` que H4 dejó.

| Paso | Quién lo ejecuta | Archivo:línea |
|---|---|---|
| — → `BORRADOR` | HU-H3 · `crearOrdenCompra()` | `orden-compra.service.ts:241-337` |
| `BORRADOR` → `ENVIADA` | HU-H3 · acción `ENVIAR` | `orden-compra.service.ts:67`, `343-452` |
| `ENVIADA` → `CONFIRMADA` | HU-H3 · acción `CONFIRMAR` | `orden-compra.service.ts:69`, `358-361` |
| `CONFIRMADA` → `RECEPCION_PARCIAL` | **HU-H4** · `registrarRecepcion()` | `recepcion-reglas.ts:15-22`, `recepcion.service.ts:287-301` |
| `RECEPCION_PARCIAL` → `RECIBIDA_COMPLETA` | **HU-H4** | ídem |
| `RECIBIDA_COMPLETA` → `CERRADA` | HU-H3 · acción `CERRAR` | `orden-compra.service.ts:70`, `362-364` |
| `BORRADOR`/`ENVIADA` → `CANCELADA` | HU-H3 · acción `CANCELAR` | `orden-compra.service.ts:71`, `400-407` |

**Defensas de la máquina de estados:**

- Cualquier transición no listada se rechaza con `409 TRANSICION_INVALIDA`
  desde el service (`344-349`), nunca confiando en el `default` del enum de
  Prisma. Mapeo a HTTP en `[id]/estado/route.ts:34-38`.
- La lectura del estado origen ocurre **dentro** de la misma
  `prisma.$transaction` que hace el `UPDATE` (`343-429`), como pide
  `spec_modulo_H.md` §3.1.
- El `UPDATE` es un `updateMany` condicionado al estado leído
  (`412-420`); si otra request lo movió en el interín, `count === 0` →
  `409` (`421-426`). Concurrencia optimista real, no solo el chequeo previo.
- `CERRADA` y `CANCELADA` son terminales: no figuran como origen de ninguna
  regla, y además una orden con `is_active = false` se rechaza antes
  (`338-343`).

**Seguimiento visible:** la card "Historial de estado" del detalle
(`[id]/page.tsx:429-469`) se alimenta de `obtenerHistorialOrdenCompra()`
(`orden-compra.service.ts:937-1034`), que lee el ledger de auditoría del
Módulo D e **incluye las transiciones de H4** (ver el bug 4 de §7).

**Cómo se verificó:** por ejecución real del circuito completo, no por
fixtures. La evidencia mergeada está en `docs/specs/spec_modulo_G.md:108`, que
documenta que la rama `PROVISORIO → DEFINITIVA` de HU-G8 quedó *"verificada
end-to-end en runtime por el camino real `CONFIRMADA → RECEPCION_PARCIAL →
RECIBIDA_COMPLETA → CERRADA`"*. Ese camino solo se puede recorrer si las 4
transiciones de H3 y las 2 de H4 funcionan encadenadas contra la misma orden.
El detalle numérico de esa corrida está en §6.4.

---

### ✅ CA2 — Bloqueo de edición de ítems una vez enviada

**Estado: cumplido, con defensa en tres capas.**

1. **Regla de dominio.** `asegurarItemsEditables()`
   (`orden-compra.service.ts:101-111`) lanza `ORDEN_ITEMS_BLOQUEADOS` para
   cualquier estado distinto de `BORRADOR`. Está extraída como función
   reutilizable a propósito, para que ningún llamador la reimplemente.
2. **Punto de consumo.** `editarItemsOrdenCompra()` la invoca en `526`, y
   además rechaza antes las órdenes canceladas (`519-524`).
3. **Guarda de concurrencia.** Aun pasando la validación, se hace un
   `updateMany` condicionado a `estado: "BORRADOR"` (`530-538`); si otra
   request envió la orden en el interín, `count === 0` → `409` (`539-544`).
   Sin esto, una edición y un `ENVIAR` simultáneos podían intercalarse.

**En la UI:** el editor de ítems solo se renderiza si `enBorrador`
(`[id]/page.tsx:140`, `349-358`); en cualquier otro estado se muestra la tabla
de solo lectura (`359-411`) con el texto *"El precio unitario quedó congelado al
emitir la orden"* (`345`).

**Semántica de la edición** (`editarItemsOrdenCompra()`, `477-631`): reemplazo
total del set. Los ítems quitados van a **baja lógica** (`562-573`), nunca
`DELETE` físico, con `deletion_reason` automático `"Ítem quitado de la orden
durante la edición en estado BORRADOR"`. Los precios se re-resuelven contra la
lista vigente en cada guardado usando la **misma** función que el alta
(`547-551`) — mientras la orden es borrador todavía no se emitió, así que
re-congelar el precio es lo correcto.

**Cómo se verificó:** ejercitando el editor en la pantalla de detalle contra la
orden semilla y verificando el `409` desde el endpoint. **No hay test
automatizado** — ver §9.1.

---

### ✅ CA3 — Alerta ante incumplimiento de la fecha comprometida

**Estado: cumplido, con una limitación de alcance declarada.**

La alerta es **calculada al leer**, sin persistencia y sin cron
(`estaEntregaVencida()`, `orden-compra.service.ts:659-668`):

```typescript
export function estaEntregaVencida(
  fechaEntregaComprometida: Date | null,
  estado: EstadoOrdenCompra,
): boolean {
  if (!fechaEntregaComprometida) return false;
  if (estado !== "CONFIRMADA" && estado !== "RECEPCION_PARCIAL") return false;
  const inicioDeHoyUTC = new Date();
  inicioDeHoyUTC.setUTCHours(0, 0, 0, 0);
  return new Date(fechaEntregaComprometida) < inicioDeHoyUTC;
}
```

Se expone como `entrega_vencida` tanto en el listado
(`listarOrdenesCompra()`, `726`) como en el detalle (`obtenerOrdenCompra()`,
`906-909`), y se renderiza en dos lugares:

- **Listado:** badge `Entrega vencida` con ícono de alerta
  (`TablaOrdenesCompra.tsx:213-220`).
- **Detalle:** `<Alert variant="destructive">` con la fecha exacta
  (`[id]/page.tsx:276-284`) y el valor de la fecha en rojo con el sufijo
  `· vencida` en la grilla de fechas (`308-319`).

**El dato de origen** se captura obligatoriamente en la transición
`CONFIRMAR`: el schema Zod lo exige (`ordenes-compra.schema.ts:69-72`), el
service lo persiste (`358-361`) y el modal usa `<input type="date">`
(`DialogConfirmarOrdenCompra.tsx:115`).

**Limitación declarada (no es un bug, es alcance):** la alerta solo vive
mientras la orden está en `CONFIRMADA` o `RECEPCION_PARCIAL`. Una vez que llega
a `RECIBIDA_COMPLETA` o `CERRADA` la alerta **desaparece, aunque la mercadería
haya llegado tarde**. Es un semáforo operativo de "esto está atrasado ahora",
no un registro histórico de incumplimiento. Si el incumplimiento tiene que
persistir para evaluación de proveedor, ese dato lo produce HU-H5 por otra vía,
no HU-H3. Ver también §9.4 sobre el borde de las últimas 3 horas del día.

---

### ✅ CA4 — Cada recepción dispara el alta de stock con referencia a OC y proveedor

**Estado: cumplido — pero por un mecanismo distinto al que la spec definía, y
ejecutado íntegramente por HU-H4.**

Lo que hace HU-H3 para este criterio es *habilitarlo*: deja la orden en un
estado recepcionable y provee el modelo con el que H4 trabaja. La ejecución es
de H4:

1. `registrarRecepcion()` corre en una `prisma.$transaction` con nivel de
   aislamiento `Serializable` (`recepcion.service.ts:315`).
2. Dentro de esa transacción, si hay al menos una unidad aceptada, llama a
   `registrarIngresoStockTx()` (`265-278`) pasándole `{ recepcionId }`, lo que
   crea un `MovimientoStock` de INGRESO vinculado a la recepción.
3. En la misma transacción actualiza el estado de la OC (`287-301`).

**La trazabilidad hacia OC y proveedor es real pero indirecta, por FK:**

```
MovimientoStock.recepcion_id      (schema.prisma:378, @unique)
   → Recepcion.orden_compra_id    (schema.prisma:841)
      → OrdenCompra.proveedor_id  (schema.prisma:758)
```

No hay un `proveedor_id` denormalizado en `MovimientoStock`. El criterio
pide "con referencia a la OC y proveedor de origen" y la referencia existe y
es navegable — a dos saltos.

**Divergencia con la spec, declarada:** `spec_modulo_H.md` §4 (línea 321)
define que tras el `COMMIT` se emita `stock:recepcion_confirmada` hacia el
Módulo A, y §2.6 (línea 252) es explícita: *"El Módulo H no escribe directamente
sobre `StockDeposito` ni `MovimientoStock`"*. **La implementación real hace lo
contrario**: escribe el stock dentro de su propia transacción y emite
`inventario:ingreso_stock_registrado` (`recepcion.service.ts:344-349`) solo con
fines de auditoría, no como disparador del alta. El evento
`stock:recepcion_confirmada` no existe en el código.

Esto no es un descuido de H3 ni un incumplimiento de CA4: es la decisión de
atomicidad transaccional de HU-H4 (§6.1), que gana atomicidad real a costa de
apartarse del acoplamiento por evento que la spec proponía. Queda documentado
acá porque quien lea la spec y el código en paralelo va a encontrar la
diferencia.

**Cómo se verificó:** el test de integración de H4
(`src/lib/services/proveedores/recepcion.integration.test.ts`) corre el circuito
completo contra PostgreSQL real —recepción, stock, HU-H5, auditoría,
idempotencia y concurrencia— comparando el `StockDeposito` antes y después
(`38-43`). Está *gated* por la variable de entorno
`HU_H4_INTEGRATION_DATABASE_URL` (`4`, `skip: !DATABASE_URL`): no corre en la
suite por defecto, corre a mano contra una base real.

---

### ✅ CA5 — Cancelación como baja lógica con motivo obligatorio

**Estado: cumplido, en las tres capas.**

**Motivo obligatorio:**
- Contrato Zod: `deletion_reason: z.string().min(1, "El motivo de cancelación
  es obligatorio")` (`ordenes-compra.schema.ts:74-77`). Al ser una
  `discriminatedUnion`, es imposible mandar `accion: "CANCELAR"` sin motivo.
- UI: el botón de confirmación queda deshabilitado hasta que hay texto
  (`DialogCancelarOrdenCompra.tsx:71`, `131`), con el aviso *"Campo obligatorio
  — no se puede confirmar la cancelación sin un motivo"* (`120`).

**Baja lógica, nunca `DELETE`** (`orden-compra.service.ts:400-407`):

```typescript
case "CANCELAR":
  data.is_active       = false;
  data.deleted_at      = ahora;
  data.deleted_by      = usuarioId;
  data.deletion_reason = input.deletion_reason;
  break;
```

…más `estado = "CANCELADA"` (`351-353`), todo en la misma transacción. El
docstring del módulo (`orden-compra.service.ts:17-18`) lo declara como
invariante: ninguna función del archivo invoca `prisma.*.delete()` ni
`deleteMany()`. Verificado por lectura completa del archivo: no aparece ninguna
de las dos.

**Permanencia en el historial:** `listarOrdenesCompra()` **no filtra por
`is_active`** — decisión explícita, documentada en el propio código
(`683-688`): una orden cancelada sigue siendo parte del historial y se ve en la
grilla con su badge. La card del listado lo dice al usuario: *"Incluye las
órdenes canceladas — la baja lógica preserva la fila para trazabilidad"*
(`page.tsx:143-146`). En el detalle aparece un `Alert` con la fecha y el motivo
(`[id]/page.tsx:265-273`).

**Auditoría:** el evento se registra como `DELETE_LOGICO` en el ledger
(`audit-log.listener.ts:398`) —a diferencia del resto de las transiciones, que
van como `UPDATE_ESTADO`— y el motivo queda en `valor_nuevo.deletion_reason`
(`409-411`), desde donde el historial lo muestra como `Motivo: …`
(`orden-compra.service.ts:1012-1013`).

---

## 4. Contratos Zod reales

`src/lib/schemas/ordenes-compra.schema.ts` (115 líneas). Convención del módulo:
los `*_id` se validan solo como UUID de forma; **la existencia contra la base es
responsabilidad del service, nunca del schema** (`7-10`).

| Schema | Líneas | Notas |
|---|---|---|
| `OrdenCompraIdSchema` | 14-16 | UUID de path param |
| `ItemOrdenCompraSchema` | 29-35 | **No incluye `precio_unitario`** — ver §5.1 |
| `CrearOrdenCompraSchema` | 37-43 | `items.min(1)` |
| `EditarItemsOrdenCompraSchema` | 54-58 | Reemplazo total del set |
| `CambiarEstadoOrdenCompraSchema` | 67-78 | `discriminatedUnion("accion")` |
| `ESTADOS_ORDEN_COMPRA` | 91-99 | Los 7 valores del enum |
| `FiltrosListadoOrdenesCompraSchema` | 109-112 | `.catch(undefined)`: un query param corrupto se ignora, no rompe la página |

La `discriminatedUnion` es la pieza clave del diseño: hace **estructuralmente
imposible** confirmar sin fecha o cancelar sin motivo. No hay un campo opcional
que alguien pueda olvidar de validar en el handler.

---

## 5. Decisiones de diseño y por qué se tomaron así

### 5.1. El precio nunca lo envía el cliente

**Decisión.** `ItemOrdenCompraSchema` (`ordenes-compra.schema.ts:29-35`) tiene
exactamente dos campos: `variante_sku_id` y `cantidad_solicitada`. El
`precio_unitario` lo resuelve el servidor contra la `ListaPrecioVersion`
vigente y lo congela por ítem.

**Por qué.** El comentario del propio schema lo dice sin vueltas (`22-27`):
*"enviar el precio en el payload sería una superficie de manipulación de
costos"*. Si el cliente manda el precio, cualquiera con acceso al endpoint puede
emitir una orden a un precio que el proveedor nunca pactó, y el ERP la registra
como legítima. La integridad del costo deja de estar en el sistema y pasa a
estar en la buena fe del front.

**Cómo se implementó.** `resolverContextoPrecios()`
(`orden-compra.service.ts:143-239`) es el **punto único de verdad**, compartido
por el alta y por la edición de ítems. Valida en orden y falla en el primer
problema:

| Paso | Validación | Error | HTTP |
|---|---|---|---|
| 1 | Proveedor existe | `PROVEEDOR_NO_ENCONTRADO` | 404 |
| 1 | Proveedor `HOMOLOGADO`, `is_active`, sin `deleted_at` | `PROVEEDOR_NO_HOMOLOGADO` | 422 |
| 2 | Existe `ListaPrecioVersion` con `publicada = true AND fecha_inicio_vigencia <= now()`, `orderBy desc`, `take(1)` | `PROVEEDOR_SIN_LISTA_VIGENTE` | 422 |
| 3 | Todas las variantes activas (y su producto maestro activo) | `SKU_INVALIDO` | 422 |
| 4 | Todas con precio en esa versión | `SKU_SIN_PRECIO_VIGENTE` | 422 |

El precio se toma del `Map` que devuelve esa función y se escribe en el
`OrdenCompraItem` (`247`). Una vez emitida, **no se recalcula nunca** si la
lista cambia después — la regla de no-retroactividad de
`spec_modulo_H_diferido.md` §3.4, reflejada también en el docstring del modelo
(`schema.prisma:717-722`).

Que el alta y la edición compartan la misma función no es estético: garantiza
que no exista un camino por el cual editar un ítem resuelva el precio con
criterio distinto al del alta.

**Efecto en la UI:** el selector de proveedores del formulario filtra
`estado = HOMOLOGADO` **en el query**, no visualmente
(`listarProveedoresHomologados()`, `742-748`), con el razonamiento explícito de
que la UI no debe ofrecer algo que el service va a rechazar con `422`
(`736-741`).

### 5.2. Permisos granulares y el reparto "Comprador Solicita / Supervisor Emite"

**Decisión de granularidad.** Cinco permisos independientes, no un
`ordenes_compra:administrar`:

```typescript
// orden-compra.service.ts:42-49
export const PERMISO_CREAR_ORDEN_COMPRA = "ordenes_compra:crear";

export const PERMISO_POR_ACCION_ORDEN_COMPRA: Record<AccionOrdenCompra, string> = {
  ENVIAR:    "ordenes_compra:enviar",
  CONFIRMAR: "ordenes_compra:confirmar",
  CERRAR:    "ordenes_compra:cerrar",
  CANCELAR:  "ordenes_compra:cancelar",
};
```

Lo exige `spec_modulo_H.md` §2.5 (línea 190) de forma literal. El mapa vive en
el service para que el Route Handler y la Server Action consuman **el mismo
punto de verdad** en vez de hardcodear strings cada uno.

**Reparto final entre roles.** Está en `prisma/seed.ts:1075-1103`, con el
razonamiento en los comentarios `1076-1082`:

| Permiso | COMPRADOR | SUPERVISOR_COMPRAS |
|---|:---:|:---:|
| `ordenes_compra:crear` | ✅ | ✅ |
| `ordenes_compra:enviar` | ❌ | ✅ |
| `ordenes_compra:confirmar` | ✅ | ✅ |
| `ordenes_compra:cerrar` | ✅ | ✅ |
| `ordenes_compra:cancelar` | ❌ | ✅ |

**De dónde salió.** Es una **corrección al Alcance Funcional §2.1 y §5**: el
Backlog escribía HU-H3 como si el Comprador emitiera la orden de punta a punta,
pero el Alcance define segregación de funciones en el circuito de compras. La
lectura del equipo fue que "emitir" (mandarle la orden al proveedor, que es el
acto que compromete a la empresa frente a un tercero) no puede ser el mismo acto
que "solicitar". De ahí el nombre de la decisión: **Comprador Solicita /
Supervisor Emite**.

Consecuencia concreta en el seed: el rol `SUPERVISOR_COMPRAS`
**no existía** antes de esta HU y se crea acá (`seed.ts:1064-1073`, con el
comentario explícito *"Antes de esta tarea el rol NO existía en el seed — se
crea acá"*).

**Por qué Cancelar quedó exclusivo del Supervisor y Confirmar/Cerrar no.** El
criterio, textual en `seed.ts:1081-1082`, es *"revertir una orden impacta la
negociación — mismo criterio que enviar"*. La lógica:

- **Enviar** y **Cancelar** son los dos actos que **el proveedor ve**: uno
  compromete a la empresa, el otro rompe un compromiso ya comunicado. Ambos
  tocan la relación comercial. Segregados.
- **Confirmar** es registrar un dato que el proveedor devolvió (la fecha que él
  se comprometió a cumplir). Es seguimiento administrativo, no una decisión
  comercial. Ambos roles.
- **Cerrar** es conciliación administrativa contra factura, posterior a que la
  mercadería ya entró. Tampoco es una decisión comercial. Ambos roles.

**Cómo se aplica en runtime.** El permiso se verifica **después** de parsear el
body, porque depende de la acción — por eso el handler usa `withAuth` y hace el
chequeo granular adentro, en vez de `withPermission(<código fijo>)`
(`[id]/estado/route.ts:11-13`, `66-78`). La Server Action hace exactamente lo
mismo (`actions.ts:90-93`).

**Cómo se aplica en la UI.** El detalle resuelve los 5 permisos en paralelo
(`[id]/page.tsx:128-136`) y decide qué mostrar. La segregación no se comunica
con un botón deshabilitado sino con un chip explicativo:

- Comprador viendo un `BORRADOR`: chip ámbar *"Pendiente de aprobación del
  Supervisor de Compras"* (`242-247`), nunca el botón.
- Comprador viendo una orden cancelable: chip *"Solo el Supervisor de Compras
  puede cancelar esta orden"* (`254-259`).

El endpoint revalida igual — la UI no es la defensa (`[id]/page.tsx:9-10`).

### 5.3. El compromiso con HU-G8 se ancla en `CERRADA`, no en `RECIBIDA_COMPLETA`

**La ambigüedad.** El criterio 3 de HU-G8 pide consolidar la Cuenta por Pagar
"definitiva" cuando el compromiso deja de ser estimado y pasa a ser exigible.
Había dos candidatos razonables:

- `RECIBIDA_COMPLETA` — la mercadería ya entró físicamente y está validada.
- `CERRADA` — además hubo conciliación contra la factura del proveedor.

**La resolución.** Se ancló en `CERRADA`. Está implementado en
`cuenta-por-pagar.listener.ts:53-92`, que discrimina **por `payload.accion`,
nunca por `estado_nuevo`** (`17`):

| `accion` de H3 | Efecto en HU-G8 |
|---|---|
| `ENVIAR` | crea `CuentaPorPagar` `PROVISORIO` sobre `cantidad_solicitada` |
| `CERRAR` | consolida a `DEFINITIVA` sobre `RecepcionItem.cantidad_aceptada` |
| `CANCELAR` | cancela la cuenta |
| `CONFIRMAR` | no-op |

Con una guarda adicional documentada en `spec_modulo_G.md:91`:
`estado_anterior === "RECIBIDA_COMPLETA"`, *"para no reaccionar ante otras rutas
hacia `CERRADA` que no correspondan al cierre por conciliación de factura"*.

**Por qué `CERRADA` y no `RECIBIDA_COMPLETA`.** Porque son dos hechos distintos
y solo el segundo genera una obligación de pago exigible:

- `RECIBIDA_COMPLETA` dice *"llegó todo lo pedido y pasó control de calidad"*.
  Es un hecho de depósito.
- `CERRADA` dice *"además conciliamos contra la factura del proveedor"*
  (`spec_modulo_H.md` §2.5, línea 211). Es un hecho administrativo, y es el que
  convierte la recepción en una deuda que Tesorería tiene que pagar.

Consolidar en `RECIBIDA_COMPLETA` habría hecho exigible una deuda que todavía no
tiene factura conciliada detrás.

**Consecuencia arquitectónica no obvia:** esta decisión hizo que **HU-G8 no
necesite ningún evento propio de HU-H4**. Está documentado como hipótesis
confirmada en `spec_modulo_G.md:22`: el evento genérico
`orden_compra:estado_cambiado` de H3 ya cubre `RECIBIDA_COMPLETA → CERRADA`, y
alcanza. Para saber *qué* `Recepcion` asociar, G8 la resuelve por query directa
contra `Recepcion`, no por evento (`spec_modulo_G.md:93`). Un evento menos en el
sistema.

### 5.4. "Camino A" para resolver la dependencia con HU-H2 (diferida)

**El bloqueo.** El criterio de HU-H3 exige armar la orden *"contra la lista de
precios vigente del proveedor"*, pero HU-H2 (publicación de listas por endpoint)
quedó fuera de Sprint 2. Los modelos existían migrados, vacíos de contenido
operativo. `spec_modulo_H.md` §2.4 lo marcó como **advertencia bloqueante**
(línea 152) y planteó dos caminos, exigiendo que el equipo eligiera uno *antes*
de implementar.

**Lo que se eligió: Camino A.** Sembrar la lista de precios directo por Prisma
Client en `prisma/seed.ts`, sin pasar por ningún Route Handler, e implementar
HU-H3 exactamente como estaba especificada.

`prisma/seed.ts:1341-1391` crea:
- una `ListaPrecio` ancla para el proveedor homologado (`1351-1359`);
- una `ListaPrecioVersion` con `publicada: true` y `fecha_inicio_vigencia`
  30 días atrás (`1361-1373`);
- tres `ListaPrecioItem` con precios reales (`1375-1391`).

**Por qué A y no B.** El Camino B era recibir `precio_unitario` en el payload.
La spec ya advertía que *"contradice la regla de que el cliente nunca envía el
precio"* (línea 155). Adoptarlo habría significado escribir un schema Zod
distinto, un service distinto, y después **revertir ambos** cuando HU-H2 llegara
— dejando en el intervalo un endpoint con superficie de manipulación de costos
abierta.

El Camino A tiene la propiedad de que **el código de HU-H3 no cambia cuando
HU-H2 se implemente**. La consulta de "versión vigente"
(`orden-compra.service.ts:140-154`) es exactamente la misma sin importar si la
fila la escribió un seed o un endpoint. HU-H2 va a agregar una forma de crear
`ListaPrecioVersion`; HU-H3 ni se entera.

**Costo aceptado:** en Sprint 2 solo el proveedor semilla homologado tiene
lista vigente. Cualquier otro proveedor homologado que se dé de alta por la UI
va a fallar con `422 PROVEEDOR_SIN_LISTA_VIGENTE` al intentar emitirle una
orden. Es correcto — es exactamente lo que debe pasar mientras HU-H2 no exista.

### 5.5. Otras decisiones menores, pero con razón

- **Numeración server-side.** `generarNumeroOrden()` (`123-130`) genera
  `OC-<año>-<6 dígitos>` contando las órdenes del año dentro de la transacción.
  El `@unique` del schema es la defensa final: ante `P2002` el alta reintenta
  hasta 3 veces con secuencia recalculada (`261`, `289-300`). El cliente nunca
  provee el número.
- **SKU duplicados rechazados en memoria.** Tanto el alta (`248-255`) como la
  edición (`482-488`) rechazan `ITEMS_DUPLICADOS` antes de tocar la base. Vive
  en el service y no en Zod porque es una regla de negocio ("la orden sería
  ambigua"), no una validación de forma.
- **Eventos siempre post-`COMMIT`.** `spec_modulo_H.md` §3.4 lo exige y el
  docstring del módulo lo declara (`20-21`), asumiendo el patrón
  fire-and-forget de Módulo D como **deuda técnica conocida y explícita**, no
  como decisión silenciosa. Los tres `emit` están fuera del bloque de
  transacción: `270-282`, `432-444`, `618-625`.
- **El service nunca llama a `registrarAuditLog()` directo.** Emite el evento y
  el listener reacciona (`audit-log.listener.ts:367-369`). Con
  `ip: "internal-event"` como sentinel, porque no hay request HTTP asociado.
- **Las pantallas llaman al service directo, sin `fetch` HTTP.** Son RSC y
  siguen el patrón del resto del dashboard (`orden-compra.service.ts:636-639`).
  Los Route Handlers existen igual, para consumo externo y verificación con
  Postman.
- **Tope defensivo de 500 variantes** en el selector del formulario
  (`763`), con el razonamiento de que el combobox filtra client-side y no hay
  que mandar el catálogo entero. Paginación server-side queda como mejora
  futura, declarada.

---

## 6. La integración con HU-H4 — cómo se coordinó

### 6.1. H3 y H4 no se llaman entre sí

**La decisión.** Los dos services no tienen ninguna referencia cruzada. Se
comunican por **estado compartido en el modelo** (`OrdenCompra.estado`) y por
**eventos de dominio** hacia el ledger.

Verificable en el código: `orden-compra.service.ts` no importa nada de
`recepcion.service.ts`, y `recepcion.service.ts` escribe el estado de la OC con
su propio `tx.ordenCompra.updateMany()` (`287-295`) en vez de invocar
`cambiarEstadoOrdenCompra()` de H3.

**Por qué.** Fue decisión de Emir, el compañero que implementó HU-H4, por
**atomicidad transaccional de su lado**. La recepción tiene que ser atómica en
un solo bloque: crear la `Recepcion`, sus `RecepcionItem`, las discrepancias,
dar de alta el stock y mover el estado de la OC. O pasa todo o no pasa nada.

Si H4 llamara a `cambiarEstadoOrdenCompra()` de H3, esa función abre **su
propia** `prisma.$transaction` (`343`) — una transacción anidada, o peor, una
segunda transacción independiente que puede commitear cuando la de la recepción
ya falló. Se rompe la atomicidad. La evidencia de cuánto le importaba a H4 está
en el nivel de aislamiento que eligió: `Serializable`
(`recepcion.service.ts:315`), el más estricto de Postgres.

**El precio de la decisión:** H3 no puede validar las transiciones de recepción
con su tabla `TRANSICIONES`. Está asumido y documentado en el propio código
(`orden-compra.service.ts:56-58`): *"Las transiciones CONFIRMADA →
RECEPCION_PARCIAL → RECIBIDA_COMPLETA NO viven acá: las gobierna
`recepcion.service.ts` (HU-H4, Emir)"*. Cada HU es dueña de su tramo de la
máquina de estados, y el contrato entre ambas es el enum.

**El punto de contacto en la UI** sí existe y es de H3: el detalle de la orden
muestra un botón "Registrar recepción" que linkea a la pantalla de H4, visible
solo en `CONFIRMADA`/`RECEPCION_PARCIAL` y con el permiso `recepciones:registrar`
(`[id]/page.tsx:225-235`). Es el único lugar donde H3 importa algo de H4, y es
solo la constante del permiso (`[id]/page.tsx:58`).

### 6.2. El bug de concurrencia que apareció al integrar de verdad

**Cuándo apareció.** No en ninguna prueba aislada de H3 ni de H4. Apareció al
correr el circuito completo end-to-end con las dos HU integradas. El commit lo
dice textual: *"detectado durante integración H3↔H4"*
(commit `0788ac8`).

**Qué se observó.** La cadena SHA-256 del ledger de auditoría del Módulo D
—que debe ser una cadena lineal donde cada registro encadena con el
`hash_actual` del anterior— apareció **bifurcada**: dos registros distintos
compartiendo el mismo `hash_anterior`. La evidencia concreta está anotada en el
código: filas **idx 157/158 y 159/160** del ledger, fechadas 2026-09-03
(`audit-log.service.ts:85-89`).

**Cuál era la causa raíz.** `escribirRegistroAuditLog()`
(`audit-log.service.ts:130-171`) hace dos operaciones que **no son atómicas
entre sí**:

```typescript
const ultimoRegistro = await db.auditLog.findFirst({   // 1. leer último hash
  orderBy: { created_at: "desc" },
  select: { hash_actual: true },
});
const hashAnterior = ultimoRegistro?.hash_actual ?? HASH_GENESIS;
// … calcular hash …
await db.auditLog.create({ /* … */ });                 // 2. escribir
```

Si dos escrituras arrancan casi a la vez, ambas ejecutan el paso 1 antes de que
la primera termine el paso 2. Leen el **mismo** `hash_anterior` y encadenan las
dos desde el mismo punto. La cadena se bifurca.

**Por qué lo reveló la integración y no las pruebas aisladas.** Porque
`registrarRecepcion()` de HU-H4 emite **dos eventos sincrónicos, uno detrás del
otro**, sin `await` entre ellos (`recepcion.service.ts:332-350`):

```typescript
domainEventBus.emit("recepcion:registrada", /* … */);          // 332
if (resultado.recepcion.movimiento_stock) {
  domainEventBus.emit("inventario:ingreso_stock_registrado", /* … */);  // 344
}
```

Ambos tienen handler en `audit-log.listener.ts` y ambos hacen
`void registrarAuditLog(...)` — fire-and-forget, sin esperar. Es decir: **una
sola recepción genera dos escrituras al ledger prácticamente simultáneas**.

Ninguna HU por separado producía ese patrón. H3 emite un evento por transición,
espaciados por la interacción humana. H4 en pruebas unitarias no encadenaba
ambos handlers. Solo el circuito completo, con el listener de auditoría
conectado y una recepción real que además genera movimiento de stock, disparaba
las dos escrituras juntas.

**De quién era el bug: de ninguna de las dos.** Y esto importa. No era un bug de
H3 ni de H4: era una **condición de carrera preexistente en el mecanismo
compartido de auditoría** (Módulo D, HU-A7). El patrón "leer el último hash y
después escribir sin atomicidad" estuvo mal desde el día uno; simplemente ningún
módulo había generado hasta ese momento dos escrituras lo bastante juntas como
para exponerlo. La recepción de H4 fue el **disparador**, no la causa.

Por eso el fix se aplicó en `audit-log.service.ts` y el commit lleva
`Refs: HU-A7`, no `Refs: HU-H3` ni `Refs: HU-H4`.

### 6.3. El fix: cola de serialización en memoria

`audit-log.service.ts:104` y `121-128`:

```typescript
let colaLedger: Promise<unknown> = Promise.resolve();

export async function registrarAuditLog(
  params: RegistrarAuditLogParams,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const ejecucion = colaLedger.then(() => escribirRegistroAuditLog(params, tx));
  colaLedger = ejecucion.catch(() => {});
  return ejecucion;
}
```

Cada llamada se encadena detrás de la anterior. Las escrituras corren
estrictamente de a una y ninguna puede leer un `hash_anterior` obsoleto.

**Tres detalles del diseño, todos deliberados y documentados en `80-103`:**

1. **Por qué alcanza con serializar en memoria** y no hace falta un
   `Serializable` de Postgres ni un `pg_advisory_xact_lock`: el bus de eventos
   de este proyecto es in-process (`domain-event-bus.ts`, un `EventEmitter`), así
   que *toda* invocación —de cualquier módulo, actual o futuro— nace en el mismo
   proceso Node y queda cubierta. **No hay escritura al ledger desde otro
   proceso.** Si eso cambiara (múltiples instancias), el fix deja de alcanzar y
   habría que subir a un lock de base.
2. **Un fallo puntual no rompe la cola.** El `.catch(() => {})` está sobre la
   *continuación* (`colaLedger`), no sobre el valor que se devuelve al llamador
   (`ejecucion`). Si una escritura falla, el llamador recibe el rechazo y la
   siguiente de la cola corre igual.
3. **Corrige la causa raíz para todos los módulos**, no solo el disparador
   puntual de H4. Cualquier módulo que emita dos eventos seguidos —hoy o en el
   futuro— queda cubierto sin tocar nada.

**Cómo se verificó.** Experimento de concurrencia real, no fixtures. Del mensaje
del commit `0788ac8`:

| Escenario | Resultado |
|---|---|
| **Control** (sin el fix), 25 escrituras paralelas | **24 de 25 divergencias** — la cadena se bifurcaba casi siempre |
| **Con el fix**, 25 y 50 escrituras paralelas | **0 divergencias** |
| Suite completa del proyecto | **90/90**, sin regresión |

**Decisión sobre las bifurcaciones ya existentes:** las 2 bifurcaciones que ya
estaban en el ledger (idx 157/158 y 159/160) **quedaron documentadas y sin
alterar**, respetando el append-only. Reescribirlas para "arreglar" la cadena
habría sido manipular un ledger de auditoría, que es exactamente lo que el ledger
existe para impedir. Y no hubo manipulación real que ocultar: fueron un artefacto
de concurrencia, no una alteración de datos.

### 6.4. La verificación del circuito completo con datos reales

La integración quedó validada corriendo el flujo entero contra una orden real,
no con fixtures. El registro de esa corrida está en `spec_modulo_G.md:108` y
`:323`:

- Camino recorrido: `CONFIRMADA → RECEPCION_PARCIAL → RECIBIDA_COMPLETA →
  CERRADA`, con `recepcion.service.ts` dejando el estado y `CERRAR` de HU-H3
  emitiendo el evento que dispara la consolidación en Tesorería.
- Números verificados: una OC de **368000** solicitados, con un ítem donde **3 de
  10 unidades se rechazaron por calidad**, produjo una `CuentaPorPagar`
  `DEFINITIVA` de **320600**, no de 368000 — porque el monto se recalcula sobre
  `RecepcionItem.cantidad_aceptada` (lo recibido *y validado*), no sobre
  `cantidad_solicitada`.

Ese resultado solo es alcanzable si funcionan encadenados: el alta de H3 con
precio congelado, `ENVIAR` (que crea el `PROVISORIO`), `CONFIRMAR`, la recepción
parcial de H4 con discrepancia, la recepción final, y `CERRAR` de H3. Es la
prueba end-to-end más fuerte que tiene la HU.

Complementariamente, el test de integración de H4
(`recepcion.integration.test.ts`) cubre recepción, stock, HU-H5, auditoría,
idempotencia y concurrencia contra PostgreSQL real, incluyendo la aserción de
que `recepciones:registrar` quedó solo en `ADMINISTRADOR` y
`ENCARGADO_DEPOSITO`, y **explícitamente no en `COMPRADOR`** (`49-56`).

---

## 7. Bugs encontrados y corregidos — línea de tiempo real

Reconstruida desde `git log` con fechas de commit. HU-H3 tiene **3 commits
propios** más el fix de auditoría:

| # | Commit | Fecha (local, -0300) | Qué |
|---|---|---|---|
| 1 | `2008498` | 2026-08-31 21:47 | `feat(H3): orden de compra - creación, transiciones, permisos, UI base` |
| 2 | `09fe747` | 2026-08-31 22:48 | `feat(H3): completa CA2, CA3 y botones de confirmar/cerrar` |
| — | `e47001e` | 2026-08-31 22:55 | Merge PR #94 → `develop` |
| 3 | `5806ea6` | 2026-09-02 23:33 | `fix(H3): cierre final - historial con recepciones + hydration mismatch` |
| — | `99d2149` | 2026-09-02 23:39 | Merge PR #107 → `develop` |
| 4 | `0788ac8` | 2026-09-02 23:57 | `fix(auditoria): serializa registrarAuditLog…` |
| — | `9676b14` | 2026-09-03 00:02 | Merge PR #108 → `develop` |

> **Precisión de fechas.** El grueso de la implementación fue el **31/08**, no
> el 2–3/09: esos dos días fueron el cierre (integración con H4 y los fixes
> finales). Y el fix de concurrencia se **commiteó el 02/09 a las 23:57** y se
> mergeó el **03/09 a las 00:02** — a caballo de la medianoche. La evidencia del
> ledger anotada en el código sí está fechada 2026-09-03
> (`audit-log.service.ts:88`), que es cuando ocurrieron las escrituras
> bifurcadas. Decir "se corrigió el 3 de septiembre" es correcto en espíritu;
> el commit es del 2 por cinco minutos.

### Bug 1 — Zona horaria: la fecha de entrega se mostraba un día antes

- **Introducido en:** `2008498` (31/08 21:47).
- **Corregido en:** `09fe747` (31/08 22:48) — mismo día, una hora después.
  Listado textual del commit: *"Fix: fecha de entrega comprometida se mostraba
  un día antes (UTC)"*.
- **Causa raíz.** `fecha_entrega_comprometida` se captura desde un
  `<input type="date">` (`DialogConfirmarOrdenCompra.tsx:115`), que produce una
  **fecha-solo** que Postgres persiste como medianoche UTC. Se renderizaba con
  `formatFecha()`, que usa la zona horaria local del servidor. En Argentina
  (UTC-3), `2026-09-10T00:00:00Z` renderizado en local es `2026-09-09 21:00` →
  se mostraba **09/09**. El usuario cargaba el 10 y el sistema le mostraba el 9.
- **Fix.** Se agregó `formatFechaSolo()` con `timeZone: "UTC"` fijado
  explícitamente (`[id]/page.tsx:95-103`), y se cambió el llamador
  (`170`). El mismo criterio se aplicó al historial
  (`orden-compra.service.ts:1015-1019`), que formatea la fecha del ledger
  también con `timeZone: "UTC"`.
- **Detalle de diseño del fix.** Se agregó una función *nueva* en vez de
  cambiar `formatFecha()`. Es correcto: `fecha_envio`, `fecha_confirmacion` y
  `fecha_cierre` son *instantes* (`new Date()` en el service) y **deben**
  mostrarse en hora local. Solo `fecha_entrega_comprometida` es una fecha-solo.
  Convertir todo a UTC habría cambiado un bug por otro.

### Bug 2 — El cálculo de "vencida" también necesitaba UTC

- **Corregido en:** `09fe747`, junto con el bug 1.
- **Causa raíz.** El mismo problema en la otra dirección: comparar una fecha
  persistida a medianoche UTC contra un `new Date()` local hacía que el propio
  día de entrega contara como vencido.
- **Fix.** `estaEntregaVencida()` (`orden-compra.service.ts:665-667`) normaliza
  el "hoy" con `setUTCHours(0,0,0,0)` antes de comparar, de modo que el día de
  entrega no cuenta como vencido. (Sobre el borde residual de este enfoque, ver
  §9.4.)

### Bug 3 — El historial de estado no incluía las transiciones de recepción de H4

- **Detectado:** al integrar con HU-H4 (que se mergeó el 02/09 18:28,
  commit `90c04ba`).
- **Corregido en:** `5806ea6` (02/09 23:33).
- **Síntoma.** En la card "Historial de estado" del detalle, el seguimiento
  saltaba de `CONFIRMADA` directo a `CERRADA`. Las dos transiciones intermedias
  —`RECEPCION_PARCIAL` y `RECIBIDA_COMPLETA`— no aparecían nunca, aunque el
  ledger las tenía registradas. Eso rompía la promesa de CA1 ("seguimiento hasta
  el cierre").
- **Causa raíz.** El filtro sobre el ledger era de un solo dominio:

  ```typescript
  // antes
  where: { tabla_afectada: "ordenes_compra", registro_id: ordenCompraId }
  ```

  Los eventos de recepción se auditan con `tabla_afectada: "recepciones"` y
  `registro_id` = id de la **`Recepcion`**, no de la OC
  (`audit-log.listener.ts:436-452`). El filtro los excluía por partida doble:
  por tabla y por id.
- **Fix** (`orden-compra.service.ts:937-1034`). Tres cambios encadenados:
  1. Resolver primero qué recepciones tiene la orden (`943-948`), porque el
     ledger las indexa por id de recepción.
  2. Cambiar el filtro a un `OR` sobre los dos dominios (`950-956`).
  3. Normalizar la lectura del estado: las filas de `recepciones` guardan el
     estado de la OC en `valor_nuevo.estado_orden_compra`, no en
     `valor_nuevo.estado` como las de `ordenes_compra`. Se discrimina con
     `esRecepcion` (`987`, `1002-1007`) y se etiqueta el movimiento como
     `"Recepción de mercadería registrada"` (`1010-1011`).
- **Por qué no fue un bug de diseño de H4.** H4 audita correctamente: la
  entidad que creó es una `Recepcion`, así que `registro_id` debe ser el id de
  la recepción. El bug estaba en la *lectura* de H3, que asumía que todo lo
  relevante para una OC estaría bajo `tabla_afectada: "ordenes_compra"`. Fue una
  suposición razonable mientras H3 era la única HU que tocaba la orden — y dejó
  de serlo el día que H4 se integró.

### Bug 4 — Hydration mismatch por `crypto.randomUUID()` en atributos del DOM

- **Corregido en:** `5806ea6` (02/09 23:33), mismo commit que el bug 3.
- **Archivos:** `EditorItemsOrdenCompra.tsx` y `FormularioNuevaOrdenCompra.tsx`.
- **Causa raíz.** Ambos formularios manejan filas dinámicas de ítems y usan
  `crypto.randomUUID()` para la `key` de React. El problema es que ese UUID
  además se **interpolaba en atributos del DOM**:

  ```tsx
  <Label htmlFor={`edit-var-${fila.key}`}>
  <ComboboxFiltrable id={`edit-var-${fila.key}`} />
  ```

  El initializer del `useState` corre **dos veces**: una en el servidor durante
  el SSR y otra en el cliente durante la hidratación. Genera UUIDs distintos en
  cada corrida. React compara el HTML del servidor con el que produce el cliente,
  encuentra `htmlFor`/`id` diferentes y reporta hydration mismatch.
- **Fix.** `useId()` —el hook de React pensado exactamente para esto, que
  produce un id estable entre servidor y cliente— llamado **una sola vez** por
  componente y combinado con el **índice** de la fila
  (`EditorItemsOrdenCompra.tsx:81-88`, `FormularioNuevaOrdenCompra.tsx:55-60`):

  ```tsx
  const editorId = useId();
  // …
  const varId  = `${editorId}-var-${indice}`;
  const cantId = `${editorId}-cant-${indice}`;
  ```

  `crypto.randomUUID()` **queda** como `key` de React —ahí sí es correcto y
  necesario, porque la key debe sobrevivir a reordenamientos y el índice no
  sirve— pero **nunca más toca el DOM**. Es la distinción clave del fix: no se
  eliminó el UUID, se lo sacó de los atributos.
- **Adicional:** en `FormularioNuevaOrdenCompra.tsx` se cambió
  `useState<ItemFila[]>([nuevaFila()])` por
  `useState<ItemFila[]>(() => [nuevaFila()])` — forma lazy, para que
  `nuevaFila()` no se ejecute en cada render.
- **Auditoría del resto del proyecto.** El mismo commit deja constancia de que
  se revisaron los demás formularios: `FormularioRecepcionMercaderia.tsx` (de
  HU-H4) usa el mismo patrón de `randomUUID()` como key, **pero el valor nunca
  llega al DOM**, así que no hay mismatch real y no se tocó. Se documentó en vez
  de "arreglarlo" preventivamente.

### Bug 5 — Bifurcación de la cadena SHA-256 del ledger bajo concurrencia

Cubierto en detalle en §6.2 y §6.3. Resumen para la línea de tiempo:

- **Detectado:** durante la integración H3↔H4, no en pruebas aisladas.
- **Corregido en:** `0788ac8` (02/09 23:57, mergeado 03/09 00:02).
- **Archivo:** `src/lib/services/auditoria/audit-log.service.ts` (+40/−6).
- **Causa raíz:** `findFirst`(último hash) + `create` no atómicos, expuestos por
  los 2 eventos sincrónicos seguidos de `registrarRecepcion()`.
- **Fix:** cola de serialización en memoria (`colaLedger`).
- **Verificación:** 25/50 escrituras paralelas, 0 divergencias contra 24/25 sin
  el fix; suite 90/90.
- **Propiedad importante:** aunque se descubrió por H3↔H4, el fix es de Módulo D
  y beneficia a todos los módulos.

### Búsqueda de bugs adicionales en el historial

Se revisó `git log --all` en el rango 31/08–03/09 filtrando por `H3`,
`orden-compra`, `auditoria`, `hydration` y `zona/timezone`. **No aparecieron
bugs de HU-H3 adicionales a los cinco anteriores.** Hay commits de corrección en
la ventana que pertenecen a otras HU y no tocan H3:

- `ea5b8c5` (03/09 01:18) — `fix(tesoreria): consolidar CxP definitiva sobre
  cantidad_aceptada, no sobre lo pedido`. Es HU-G8: corrige el criterio 4 de esa
  HU. Consume el evento de H3 pero no modifica ningún archivo de H3.
- `df5ff06` (02/09 14:30) — idempotencia de HU-H5.
- `633bf45`, `45af760`, `68071cf` (02–03/09) — UI de proveedores, HU-H1.

---

## 8. Qué NO se implementó, y por qué

### 8.1. El mecanismo de "Orden de Pago" — no lo toca HU-H3, y no existe como tal

Confirmado por búsqueda en todo el repo: la cadena "Orden de Pago" **no aparece
en ningún archivo** de `docs/` ni de `src/`. Lo que HU-G8 modela es
`CuentaPorPagar`, y su propia spec es explícita
(`spec_modulo_G.md:135`): *"No hay modelo `OrdenPago` propio: 'efectivizar' es
este endpoint, que persiste el resultado directamente sobre `CuentaPorPagar`"*.

HU-H3 no toca nada de eso, y no debería: su responsabilidad termina cuando emite
`orden_compra:estado_cambiado`. Quién escuche ese evento y qué haga con él es
problema del consumidor. HU-G8 se suscribe y mantiene su propia máquina de
estados; HU-H3 no sabe que Tesorería existe.

### 8.2. Conciliación contra factura antes de `CERRAR` — no modelada

`spec_modulo_H.md` §2.5 (línea 211) y §5 (línea 338) la definen como *"un
checkbox/flag operativo que el Comprador marca manualmente, no una integración
automática con un sistema de facturación"*.

**En el código no existe ni el flag.** No hay campo en `OrdenCompra`, ni
validación en el service, ni checkbox en `DialogCerrarOrdenCompra.tsx`. El acto
de apretar "Cerrar orden" **es** la afirmación de que se concilió. La
conciliación real ocurre fuera del sistema.

Es una decisión consciente de alcance, no un olvido: modelar un flag que nada
valida habría agregado un campo sin semántica verificable. Pero hay que decirlo
con todas las letras: **HU-H3 no puede demostrar que hubo conciliación**, solo
registra quién declaró que la hubo (y eso sí queda en el ledger, con usuario y
timestamp).

### 8.3. HU-H2 — publicación de listas de precios por endpoint

Diferida por planificación del PO, especificada en
`spec_modulo_H_diferido.md` §2.3. Resuelta para Sprint 2 por el Camino A (§5.4).
No hay endpoint, no hay UI, no hay service. Solo el seed.

### 8.4. Otros faltantes de alcance declarados

- **Paginación server-side del selector de variantes.** Hay un tope defensivo
  de 500 (`orden-compra.service.ts:763`) con la mejora futura declarada en el
  comentario.
- **Outbox transaccional para eventos.** Se adoptó el patrón fire-and-forget de
  Módulo D por consistencia, con el riesgo de pérdida de evento ante caída del
  proceso entre el `COMMIT` y el `emit`. Declarado como **deuda técnica
  conocida** en el docstring del service (`20-21`), tal como
  `spec_modulo_H.md` §3.4 exigía que se hiciera ("no como decisión silenciosa").
- **Evento `stock:recepcion_confirmada`.** No se implementó — ver §3 CA4 y
  §9.2. El alta de stock se resuelve por escritura directa dentro de la
  transacción de H4.

---

## 9. Hallazgos: dónde el código no coincide con lo esperado

Esta sección existe por la misma razón que el documento: si algo no cierra como
se lo contó, se dice. Ninguno de estos puntos invalida un criterio de
aceptación, pero todos son reales y verificables.

### 9.1. HU-H3 no tiene ningún test automatizado propio

**El hallazgo más importante de esta sección.** El proyecto tiene 13 archivos
`*.test.ts`; **ninguno cubre `orden-compra.service.ts`**. No existe
`orden-compra.service.test.ts`.

La verificación de HU-H3 fue:
- **manual y en runtime**, contra la base sembrada;
- **indirecta**, vía el test de integración de HU-H4
  (`recepcion.integration.test.ts`, que ejercita el modelo de OC pero prueba a
  H4) y vía la corrida end-to-end documentada en `spec_modulo_G.md:108`;
- **documentada en mensajes de commit**, no en assertions.

El "90/90 sin regresión" que menciona el commit `0788ac8` es la **suite completa
del proyecto**, no cobertura de H3: confirma que el fix de auditoría no rompió
nada, no que H3 esté testeada.

Reglas de H3 hoy sin test automatizado: la tabla `TRANSICIONES` completa, el
rechazo `409` de items bloqueados, `resolverContextoPrecios()` y sus 4 modos de
falla, `estaEntregaVencida()` (que es una función pura y trivial de testear), el
reintento por colisión de `numero_orden`, y la baja lógica de CA5.

**Recomendación:** `estaEntregaVencida()` y la tabla `TRANSICIONES` son puras y
sin I/O — son el punto de partida más barato y de mayor retorno para cerrar esta
brecha.

### 9.2. La spec define un evento hacia Módulo A que no existe

`spec_modulo_H.md` §4 (línea 321) especifica `stock:recepcion_confirmada` como
el mecanismo de alta de stock, y §2.6 (línea 252) prohíbe explícitamente que
Módulo H escriba sobre `MovimientoStock`. La implementación de HU-H4 hace lo
contrario: escribe el stock dentro de su propia transacción. CA4 se cumple, pero
por un camino distinto al especificado. Ver §3 CA4.

### 9.3. Comentarios obsoletos en el código

Dos lugares donde el código quedó desactualizado respecto de su propio estado:

- **`orden-compra.service.ts:59`** — `// TODO: integración con HU-H4 (Emir) —
  contrato pendiente de acordar.` El contrato **ya se acordó y está
  implementado** (`5806ea6`, más toda la §6). El TODO debería eliminarse.
- **`compras/ordenes/page.tsx:10-12`** — el docstring decía que el split
  Comprador/Supervisor *"se aplica en la tarea de permisos finales, donde el rol
  Supervisor todavía debe crearse en el seed"*. El rol **ya existe**
  (`seed.ts:1064-1073`) y el reparto está aplicado. Un comentario equivalente
  estaba en `Sidebar.tsx:100-104`. **Resuelto el 2026-09-08** junto con §9.5:
  ambos docstrings se reescribieron para reflejar el gate `ordenes_compra:leer`.

Son cosméticos, pero es exactamente el tipo de deriva documentación-vs-código
que este documento intenta no repetir.

### 9.4. `estaEntregaVencida()` puede adelantarse hasta 3 horas el último día

El cálculo usa el inicio del día **en UTC** (`665-666`). En Argentina (UTC-3),
entre las 21:00 y la medianoche local, "hoy en UTC" ya es el día siguiente. Una
orden cuya entrega vence hoy va a marcarse como **vencida a partir de las 21:00
hora local del mismo día de la entrega**, tres horas antes de que efectivamente
lo esté.

Es una ventana chica y del lado conservador (avisa de más, no de menos), pero es
real. La alternativa sería normalizar contra la zona horaria de negocio en vez de
UTC.

### 9.5. Ambas pantallas usan `ordenes_compra:crear` como gate de lectura — RESUELTO

> **Estado: resuelto el 2026-09-08** (rama `feature/hu-h3-mod`). Archivos:
> `prisma/seed.ts`, `src/lib/services/proveedores/orden-compra.service.ts`,
> `src/app/(dashboard)/compras/ordenes/page.tsx`,
> `src/app/(dashboard)/compras/ordenes/[id]/page.tsx`,
> `src/components/layout/Sidebar.tsx`.

**El hallazgo (vigente hasta el fix):** el listado (`page.tsx:98-102`), el
detalle (`[id]/page.tsx:120-124`) y el ítem del sidebar (`Sidebar.tsx:109`)
exigían `ordenes_compra:crear` para poder *ver* las órdenes. Consecuencia: **un
rol de solo lectura no podía abrir la pantalla** — en concreto, el `AUDITOR` no
tenía ningún acceso a Órdenes de Compra pese a que la matriz del Alcance
Funcional §5 (fila "Consultar el historial de precios y órdenes de un proveedor")
le da lectura directa (✓).

**El fix:** se agregó el permiso `ordenes_compra:leer` (UUID
`1a2b3c4d-1111-4a1a-8a1a-000000000020`, `modulo: "MODULO_H"`, upsert idempotente,
mismo patrón que `proveedores:leer` de HU-H1). Reparto según la matriz §5:

| Rol | `ordenes_compra:leer` | Fuente |
| :---- | :---- | :---- |
| Comprador | ✓ directo | `permisosComprador` en `seed.ts` |
| Supervisor de Compras | ✓ directo | `permisosSupervisorCompras` en `seed.ts` |
| Auditor | ✓ directo | bloque `rolPermiso.upsert` propio (criterio "lectura ampliada", igual que `cuentas_por_pagar:leer` y `comprobantes_proveedor:leer`) |
| Personal de Depósito | ✗ (fila `△ solicita`) | sin grant permanente; su consulta puntual la cubre el flujo de recepción (HU-H4) |

Los tres gates de lectura pasaron a `PERMISO_LEER_ORDEN_COMPRA`. **No se tocaron**
los 5 permisos de transición (`crear/enviar/confirmar/cerrar/cancelar`) ni los
gates de escritura — ver §9.6, que sigue vigente.

**Verificación en runtime (2026-09-08, base sembrada):**

- `prisma db seed` corrió limpio (exit 0). En DB: `ordenes_compra:leer` asignado
  a `COMPRADOR`, `SUPERVISOR_COMPRAS` y `AUDITOR`; el `AUDITOR` no tiene ningún
  otro `ordenes_compra:*`.
- Login como `auditor.seed` → `GET /compras/ordenes` **200**, `GET
  /compras/ordenes/<id>` **200**. En una orden en BORRADOR: ningún botón de
  transición, solo los chips de solo lectura ("Pendiente de aprobación…", "Solo
  el Supervisor de Compras puede cancelar…").
- Bypass por API con sesión de Auditor: `PATCH .../estado` con `ENVIAR`,
  `CONFIRMAR` y `CANCELAR` → **403 FORBIDDEN** en los tres; `POST
  /api/ordenes-compra` → **403**.
- Sin regresión: `comprador.seed` y `supervisor.compras.seed` conservan **200**
  en listado y detalle; el Supervisor sigue viendo los botones "Enviar" y
  "Cancelar", el Comprador sigue viendo los chips (split "Comprador Solicita /
  Supervisor Emite" intacto).
- Control negativo: `encargado.seed` (Personal de Depósito, sin el permiso) →
  **307 → /no-autorizado** en listado y detalle; el ítem del sidebar no aparece.

### 9.6. La edición de ítems se autoriza con `ordenes_compra:crear`

`items/route.ts:43-44` y `actions.ts:117-119` usan `PERMISO_CREAR_ORDEN_COMPRA`
para editar ítems, no un permiso propio. Es defendible —editar un borrador es
parte de crearlo— pero significa que **los 5 permisos granulares en realidad
gobiernan 6 operaciones**, y que quien puede crear puede editar cualquier
borrador, incluido el de otro comprador. No hay chequeo de autoría.

### 9.7. Formato inconsistente de `numero_orden` entre el generador y el seed

`generarNumeroOrden()` produce 6 dígitos: `OC-2026-000001`
(`orden-compra.service.ts:126`, `129`). La orden semilla usa 4:
`OC-2026-0001` (`seed.ts:1405`).

No provoca colisión —el generador cuenta por prefijo `OC-2026-` y la semilla
suma 1 al conteo, así que la siguiente es `OC-2026-000002`— pero deja dos
formatos conviviendo en la misma tabla. Cosmético.

### 9.8. Cobertura de fechas del prompt de trabajo

El grueso de HU-H3 se implementó el **31/08**, no el 2–3/09 (§7). Los días 2 y 3
fueron integración con H4 y cierre. Se anota para que la fecha del documento no
se lea como fecha de desarrollo.

---

## 10. Capacidades adicionales no exigidas por los CA

Cosas que están implementadas y funcionan, pero que ningún criterio de
aceptación pedía:

- **Edición de ítems en `BORRADOR`** (`editarItemsOrdenCompra()`, `477-631`,
  más `EditorItemsOrdenCompra.tsx`). CA2 solo exige *bloquear* después de
  enviar; permitir editar antes es agregado. Trae reemplazo total del set, baja
  lógica de los quitados y re-resolución de precios.
- **Concurrencia optimista en todas las mutaciones.** `updateMany` condicionado
  al estado leído en las transiciones (`412-426`) y en la edición de ítems
  (`530-544`). Ningún CA lo pide; `spec_modulo_H.md` §3.1 sí.
- **Reintento automático ante colisión de `numero_orden`** (`289-300`), hasta 3
  intentos.
- **Filtros de la grilla sincronizados con la URL** (`TablaOrdenesCompra.tsx`,
  `FiltrosListadoOrdenesCompraSchema`), con `.catch(undefined)` para que un query
  param corrupto se ignore en vez de romper la página.
- **Chips explicativos de segregación de funciones** en vez de botones
  deshabilitados sin contexto (`[id]/page.tsx:242-247`, `254-259`).
- **Historial multi-dominio.** El seguimiento une eventos de `ordenes_compra` y
  de `recepciones` en una sola línea de tiempo con nombres de usuario resueltos
  (`937-1034`). CA1 pide el flujo, no la visualización de su trazabilidad.
- **Duplicación de superficie HTTP + Server Actions.** Las pantallas usan
  Server Actions; los Route Handlers existen igual para consumo externo y
  verificación con Postman. Ambos delegan en el mismo service, sin duplicar
  reglas.

---

## 11. Referencias cruzadas

| Documento | Qué aporta a HU-H3 |
|---|---|
| `docs/specs/spec_modulo_H.md` §2.4, §2.5, §3.1, §3.4, §3.5 | Contrato original de la HU |
| `docs/specs/spec_modulo_H_diferido.md` §2.3, §3.4 | HU-H2 (listas de precios) y no-retroactividad del precio |
| `docs/specs/spec_modulo_G.md` §2.1, §2.2, §5 | Consumo del evento de H3 por HU-G8; evidencia de la corrida end-to-end |
| `docs/modulos/modulo H/HU5_MODULO_H.md` | HU-H5, que consume las recepciones de H4 sobre órdenes de H3 |
| `docs/modulos/modulo A/HU7_MODULO_A.md` | HU-A7 — el ledger SHA-256 donde vive el fix de concurrencia de §6.3 |
