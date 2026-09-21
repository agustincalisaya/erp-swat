# HU-C7 — Consulta unificada por DNI (contacto + direcciones + historial de compras)

**Módulo:** C — Gestión de Clientes
**Responsable:** Ramiro V. Castagnaro (Rama) — rama `HU-C7` (PR #184). Verificado en el historial de merges de `develop`.
**Estado:** Implementada (schema Zod de query string, service de solo lectura, ruta REST `GET`, tests unitarios + integración de servicio + HTTP). **100 % backend:** sin Server Action y sin UI — es un endpoint JSON consumido por el POS de Módulo B. Es la única operación de Módulo C estrictamente de **solo lectura**: no emite eventos ni escribe nada. Sin migración ni cambio de schema.

## 1. Objetivo

Resolver en **una única llamada** la ficha unificada de un cliente por DNI: datos de contacto, direcciones, canal de contacto preferido y un resumen del historial de compras real (`PedidoVenta` de Módulo B), para que el POS no tenga que encadenar múltiples requests en el momento de la atención.

**Criterios de aceptación** (fuente: `spec_modulo_C.md §2.7`, líneas 265–307):

1. La consulta se resuelve en una **única llamada** ("evitando múltiples consultas secuenciales en el momento de la atención"): devuelve contacto, direcciones y canal preferido, todos resueltos internamente por el mismo servicio.
2. Bloque de historial de compras: `ultima_compra` (máximo de `fecha_facturacion`), `monto_total_historico` (suma de montos facturados) y `cantidad_operaciones` (conteo), **consultando `PedidoVenta` real** de Módulo B (sin mock), filtrando por `cliente_id` y `estado IN {FACTURADO, REMITO_EMITIDO, CERRADO}`.
3. Es una consulta de **solo lectura** entre módulos: Módulo C no duplica ni cachea estos datos, los resuelve on-demand. **No emite evento propio** (spec §4, l. 420).
4. Si el DNI no corresponde a ningún cliente **activo**, `404` — el POS lo interpreta como "cliente no registrado, ofrecer alta rápida", no como error bloqueante.
5. Endpoint `GET /api/clientes/buscar?dni=<dni>`, permiso `clientes:leer` (Vendedor, Administrador de CRM, Auditor). **Sin Server Action** (spec §2.7, l. 268: "consulta pura para uso en tiempo real desde POS, consumido directamente vía Route Handler").
6. Respuesta `200 OK` con el shape exacto de §2.7: `{ data: { cliente_id, dni, nombre, telefono, email, direcciones: [{ direccion_id, rotulo, tipo }], canal_preferido, historial_compras: { ultima_compra, monto_total_historico, cantidad_operaciones } }, error: null }`.

**Aclaración de alcance (no es una discrepancia, es delimitación):** Tomi aclaró que este endpoint **no** es una pantalla del dashboard ni el punto de entrada de la ficha; es un JSON para el POS. Por eso no hay UI ni Server Action, y no debe agregarse una pantalla por iniciativa propia.

**Discrepancias entre la spec y lo implementado, documentadas explícitamente:**

| Punto | Spec §2.7 | Implementación real | Motivo |
|---|---|---|---|
| Firma de `resolverHistorialCompras` | El nombre del helper en el design/spec aparecía en plural (`clienteIds`) | El helper recibe **un** `clienteId` y resuelve el clúster de fusión internamente | Decisión ratificada de encapsulación; el contrato externo (la respuesta) no cambia. Ver 5.3 |
| Nombre del tipo inferido | La spec fija solo `BuscarClientePorDniQuerySchema` | El tipo se llama `BuscarClientePorDniQueryInput` | Convención del repo (`CrearClienteInput`, `ActualizarSegmentoClienteInput`). Sin impacto de contrato |
| Parámetro ausente `?dni=` | No hay escenario de spec para el parámetro ausente | Devuelve `400 VALIDATION_ERROR` con el mensaje genérico de Zod (`Expected string, received null`), no el mensaje amistoso del regex | El `searchParams.get("dni")` devuelve `null`; el regex solo produce su mensaje para valores malformados no vacíos. Gap E-3 |

## 2. Modelo de datos involucrado

**Sin cambio de schema.** HU-C7 **no** modifica `prisma/schema.prisma`, no agrega migraciones y no toca `seed.ts`. Es **solo lectura**: no escribe ninguna fila.

**`Cliente` — qué lee HU-C7** (`consultarClientePorDni`, `cliente.service.ts:751`): `id`, `dni`, `nombre`, `telefono`, `email`, `canal_preferido`, filtrando `dni` + `is_active = true`. No lee `segmento`, `fusionado_en_id` ni campos `deleted_*` para la respuesta (sí lee `fusionado_en_id` en el helper del historial, ver abajo).

**`DireccionCliente` — qué lee HU-C7:** **reutiliza** `listarDireccionesCliente(clienteId)` (`cliente.service.ts:377`), que ya filtra `is_active = true` y ordena `created_at asc`, y mapea cada fila a `{ direccion_id: id, rotulo, tipo }`. No reimplementa la query de direcciones ni el filtro de baja lógica. La ficha **no** expone `is_active` ni `created_at`.

**`PedidoVenta` — qué lee HU-C7** (`resolverHistorialCompras`, `cliente.service.ts:838`): agrega `_sum.total`, `_max.fecha_facturacion`, `_count._all` sobre `cliente_id IN <clúster>` y `estado IN (FACTURADO, REMITO_EMITIDO, CERRADO)`. Aprovecha el índice `@@index([cliente_id, estado])` (`prisma/schema.prisma:1545`).

**`Cliente` (de nuevo) — clúster de fusión:** `findMany({ where: { fusionado_en_id: clienteId } })` para traer los secundarios fusionados (`:830`).

## 3. Arquitectura de la solución

```
GET /api/clientes/buscar?dni=30123456
   route.ts (withPermission "clientes:leer")                       ← NO hay Server Action; NO hay UI
        │
        ▼
   BuscarClientePorDniQuerySchema.safeParse({ dni: searchParams.get("dni") })
        │  └─ inválido → 400 VALIDATION_ERROR (fieldErrors.dni)
        ▼
   consultarClientePorDni(dni)  [service, cliente.service.ts:750]   ← SOLO LECTURA
        ├─ prisma.cliente.findFirst({ dni, is_active:true }) ── no existe → 404 CLIENTE_NO_ENCONTRADO (con el DNI)
        ├─ listarDireccionesCliente(cliente.id)  → map id→direccion_id   (REUSO de HU-C3)
        └─ resolverHistorialCompras(cliente.id)  [cliente.service.ts:827]
                 ├─ findMany({ fusionado_en_id: clienteId }) → secundarios
                 ├─ clusterIds = [clienteId, ...secundarios]      ← el primario va EXPLÍCITO
                 └─ prisma.pedidoVenta.aggregate({
                        where: { cliente_id: { in: clusterIds },
                                 estado: { in: [FACTURADO, REMITO_EMITIDO, CERRADO] } },
                        _sum: { total }, _max: { fecha_facturacion }, _count: { _all } })
        │
        ▼
   200 { data: { …ficha unificada… }, error: null }     ← CERO eventos, CERO escrituras
```

No hay Server Action ni componente de UI: el único consumidor es HTTP (el POS de Módulo B).

### 3.1 Schema Zod — `src/lib/schemas/clientes.schema.ts`

`BuscarClientePorDniQuerySchema` (`clientes.schema.ts:116`):

| Campo | Validación | Mensaje de error |
|---|---|---|
| `dni` | `z.string().regex(/^\d{7,8}$/)` | "El DNI debe tener 7 u 8 dígitos" |

A diferencia de los schemas de body, este valida el **QUERY STRING** de la URL. Por eso el Route Handler parsea `{ dni: req.nextUrl.searchParams.get("dni") }` en lugar de `await req.json()`: un DNI ausente llega como `null` (no `undefined`) y el regex lo rechaza igual que a cualquier formato inválido. El mensaje de error es idéntico al de `CrearClienteSchema`, para que el POS reciba el mismo texto en el alta y en la consulta.

### 3.2 Service — `src/lib/services/clientes/cliente.service.ts`

| Función | Rol | Escribe | Emite evento |
|---|---|---|---|
| `consultarClientePorDni(dni)` (`:750`) | Resuelve el cliente activo por DNI (si no hay → `CLIENTE_NO_ENCONTRADO` con el DNI en el mensaje); reusa `listarDireccionesCliente`; llama a `resolverHistorialCompras`; arma la ficha. | No | No |
| `resolverHistorialCompras(clienteId)` (`:827`) | Resuelve el clúster de fusión (primario + secundarios) y agrega `PedidoVenta` en **una** query. Devuelve `{ ultima_compra, monto_total_historico, cantidad_operaciones }`. | No | No |

`monto_total_historico` es `number` (no `Decimal`): Prisma serializa `Decimal` a string en JSON, y el contrato exige el número (`458000.00` → `458000`), por eso `Number(aggregate._sum.total ?? 0)`.

### 3.3 Endpoint REST — `GET /api/clientes/buscar` (`src/app/api/clientes/buscar/route.ts`)

Envuelto en `withPermission("clientes:leer", …)` (`:38`). Es una ruta **estática** (`/api/clientes/buscar`, sin `[id]`), así que el handler **omite** el tercer argumento `context` de `withPermission` (es opcional: no hay `params` que resolver). `STATUS_POR_CODIGO = { CLIENTE_NO_ENCONTRADO: 404 }` (`:30`).

| Status | Cuándo | Body |
|---|---|---|
| `200 OK` | Cliente activo encontrado | `{ data: { …ficha unificada §2.7… }, error: null }` |
| `400` | DNI con formato inválido o ausente | `{ data: null, error: { code: "VALIDATION_ERROR", message, fieldErrors: { dni: [...] } } }` |
| `401` | Sin sesión | `{ data: null, error: { code: "UNAUTHORIZED", message } }` |
| `403` | Sesión válida sin `clientes:leer` | `{ data: null, error: { code: "FORBIDDEN", message } }` |
| `404` | DNI válido sin cliente activo | `{ data: null, error: { code: "CLIENTE_NO_ENCONTRADO", message: "No existe un cliente activo con el DNI <dni>" } }` |
| `500` | Error inesperado | `{ data: null, error: { code: "INTERNAL_ERROR", message } }` |

**No hay Server Action** (spec §2.7) y **no hay UI**.

## 4. Eventos de dominio y auditoría

**Esta HU NO emite eventos.** Es una consulta estrictamente de solo lectura:
- No abre `prisma.$transaction`.
- No escribe ninguna fila.
- No toca `event-types.ts` ni `audit-log.listener.ts` (verificado: `git diff develop -- src/lib/events/` vacío).
- La spec §4 (l. 420) lo dice explícitamente: "la consulta unificada por DNI (2.7) es de solo lectura y no emite evento propio".

Por eso la suite de integración de HU-C7 **omite deliberadamente** `iniciarAuditLogListener()`: no hay nada que materializar, y el escenario de doble consulta que verifica que `audit_logs` no gana filas es válido precisamente porque no hay listener escribiendo asientos.

## 5. Decisiones de diseño

### 5.1 `aggregate` en una sola query (no `findMany` + reduce)

El historial se resuelve con `prisma.pedidoVenta.aggregate` (`_sum.total`, `_max.fecha_facturacion`, `_count._all`) en **una** query, no con un `findMany` seguido de un reduce manual. Ventaja: aprovecha el índice `@@index([cliente_id, estado])` y no trae filas ni ítems para sumar. Precedente en el repo: `stock.inventario/stock.service.ts`. Nota de proceso: un sub-agente de exploración afirmó que `aggregate` "no existía" en el proyecto; esa afirmación era **incorrecta** y fue sobrepuesta — el código la usa y el precedente existe.

### 5.2 Filtro por estado: `estado`, no `is_active`

Solo cuentan las operaciones **efectivas**: `FACTURADO`, `REMITO_EMITIDO` y `CERRADO`. `RESERVADO` (todavía no facturado) y `ANULADO` (baja lógica de Módulo B) quedan fuera. **El filtro es por `estado`, no por `is_active`:** `ANULADO` es exactamente la "baja lógica" de un `PedidoVenta` según `schema.prisma` (`:1523`). Esto tiene una consecuencia que se documenta como **flag para Módulo B** (Sección 10): si algún camino de Módulo B soft-deletea un `FACTURADO` **sin** poner `ANULADO`, ese pedido **seguiría contando** en el historial.

Verificado contra el fixture real: el único pedido de María Gómez (`V-2026-000002`, `$380.000`) está `RESERVADO` y **no** cuenta.

### 5.3 El clúster de fusión y el detalle crítico del primario

El historial del cliente **primario** incluye sus propios pedidos **más** los de los clientes secundarios cuyo `fusionado_en_id` apunta a él. HU-C5 re-vincula el historial del duplicado al primario de forma **lógica** (el secundario conserva sus filas, con `fusionado_en_id` seteado), y `spec_modulo_C.md` §5 (l. 432) delega expresamente esa resolución a esta función.

**Detalle crítico (el más sutil de la HU):** el clúster se arma como `clusterIds = [clienteId, ...secundarios.map(s => s.id)]` (`cliente.service.ts:836`) porque el **primario no tiene `fusionado_en_id`** (es `null`). Un `findMany` filtrando `fusionado_en_id = primario` devolvería **solo** secundarios, nunca al propio primario. Sin esa línea explícita, el historial **del propio cliente consultado desaparecería** (solo vería los pedidos de sus secundarios). La suite de integración lo cubre: tras crear un pedido `FACTURADO` para el secundario fusionado, la cantidad del primario pasa de `0` a exactamente `1`.

### 5.4 Se reutiliza `listarDireccionesCliente` (HU-C3), no se reimplementa

La ficha no escribe una query de direcciones nueva: llama a `listarDireccionesCliente(cliente.id)` (que ya filtra `is_active = true` y ordena `created_at asc`) y solo transforma `id` → `direccion_id`, recortando `direccion_completa`, `is_active` y `created_at`. El renombre `id` → `direccion_id` y el recorte de campos son **parte del contrato** de §2.7.

### 5.5 Minimización del payload

La respuesta **no** incluye `segmento`, campos `deleted_*` ni `fusionado_en_id`. HU-C8 y HU-C5 tienen sus propios contratos. Verificado en runtime: el payload de Juan Pérez tiene exactamente 8 claves de nivel `data` (`canal_preferido`, `cliente_id`, `direcciones`, `dni`, `email`, `historial_compras`, `nombre`, `telefono`), y cada dirección exactamente `{ direccion_id, rotulo, tipo }`. (En la base, `Juan.segmento` es `MAYORISTA` y correctamente **no** se expone.)

### 5.6 `null` se propaga tal cual (no se default-ea)

`telefono`, `email` y `canal_preferido` pueden ser `null` y se propagan sin default. En particular, `canal_preferido: null` es significativo ("el cliente nunca eligió canal") y el consumidor (POS) decide su propio fallback.

### 5.7 Solo lectura — sin transacción y sin eventos

El servicio nuevo realiza únicamente `prisma.cliente.findFirst`, `prisma.cliente.findMany` y `prisma.pedidoVenta.aggregate`: ningún `create`/`update`/`delete`/`upsert`/`$transaction`, y el código nuevo no importa el bus de eventos. Esto es lo que hace válido ejecutar la consulta tantas veces como haga falta sin alterar la base ni la cadena de auditoría.

## 6. RBAC

| Permiso | VENDEDOR | ADMINISTRADOR_CRM | AUDITOR |
|---|:---:|:---:|:---:|
| `clientes:leer` | ✅ | ✅ | ✅ |

- **Capa 1 (REST):** `withPermission("clientes:leer")` → `401` sin sesión, `403` sin permiso.
- **Sin capa 2** (no hay Server Action).
- **Trampa de RBAC a documentar:** `cajero.seed` (rol `CAJERO_POS`, sin ningún `clientes:*`) → **`403`**; pero **`auditor.seed` → `200`**, porque el rol AUDITOR **sí** tiene `clientes:leer` (spec §2.7, l. 269: "Vendedor, Administrador de CRM, Auditor"). Es **el inverso** de la expectativa de HU-C8, donde `auditor.seed` da `403`. La suite HTTP lo assertea explícitamente (`consulta-unificada.http.integration.test.ts`, caso 4).

## 7. Cómo se validó

**Tests unitarios (corren en `npm test`):**

| Archivo | Qué cubre |
|---|---|
| `src/lib/schemas/consulta-unificada.schema.test.ts` | Acepta DNIs de 7 y 8 dígitos; rechaza letras, alfanuméricos, puntos/espacios, longitudes fuera de 7-8, vacío, ausente y **`null`**; expone `fieldErrors.dni` para el mapeo 400 |

**Tests de integración (opt-in por env var, `skip` por diseño si no está seteada):**

| Script | Archivo | Env var | Qué cubre |
|---|---|---|---|
| `npm run test:integration:c7` | `consulta-unificada.integration.test.ts` | `HU_C7_INTEGRATION_DATABASE_URL` | (a) Juan Pérez (`30123456`) → 2 direcciones con `direccion_id`, canal WHATSAPP, historial `2 / 458000`, `ultima_compra` comparada contra una lectura a la base; (b) María Gómez (`27555111`) → `0/0/null` (su único pedido está `RESERVADO`); (c) cliente activo sin pedidos → `0/0/null`; (d) **clúster de fusión**: un pedido `FACTURADO` ad-hoc para el secundario fusionado (`27555222`) aparece en el historial del primario; (e) DNI válido sin cliente activo → `CLIENTE_NO_ENCONTRADO` con el DNI en el mensaje; (f) doble consulta idempotente y `audit_logs` sin filas nuevas |
| `npm run test:integration:c7-http` | `consulta-unificada.http.integration.test.ts` | `HU_C7_INTEGRATION_BASE_URL` | Contra un servidor real: `401` sin sesión; `403` con `cajero.seed`; `200` con `vendedor.seed` y el shape exacto de §2.7; `200` con `auditor.seed`; `400` con `fieldErrors.dni`; `404` con el DNI en el mensaje |

**Números reales verificados (contrato de datos de la seed):**
- **Juan Pérez (DNI `30123456`):** `cantidad_operaciones: 2`, `monto_total_historico: 458000` — `V-2026-000001` (`FACTURADO`, $45.000) + `V-2026-000003` (`REMITO_EMITIDO`, $413.000); `ultima_compra` = `MAX(fecha_facturacion)` de la base.
- **María Gómez (DNI `27555111`):** `0 / 0 / null`.
- El secundario fusionado es `Maria Gomez`, DNI `27555222`, `is_active = false` (`fusionado_en_id` = primario).

**Verificado en esta revisión:** `npm test` corre **410 tests, 410 pass, 0 fail, 0 skip**. Los resultados de las suites de integración provienen de los reportes SDD (no los re-ejecuté): verify #169 → `test:integration:c7` 1/1 y `test:integration:c7-http` **7/7** contra un `next start` real; no-regresión de hermanas `c8` 1/1 y `c9` 1/1 (secuenciales).

**Lo que ningún test cubre hoy (gaps honestos del verify #169):**
- **La invariante de solo lectura no tiene guard automatizado en el repo** (E-4/W-2): se probó con un probe de runtime del verificador (**11 llamadas en vivo; `audit_logs` 127→127**, `clientes` 67→67, `direcciones_cliente` 28→28, `pedidos_venta` 5→5, ambos `MAX(updated_at)` sin cambios). Nada en las suites detectaría una escritura futura agregada a estas funciones.
- **`canal_preferido: null` no tiene aserción automatizada** (E-2/W-1): el pass-through es trivial y está probado en runtime por el verificador, pero ningún test lo fija; una regresión que insertara un default no sería detectada.
- **El parámetro ausente (`?dni=` ausente → `400`) no está asserteado** (E-3): se ejerce implícitamente como un error de tipo de `z.string()`, con el mensaje `Expected string, received null`.
- **`Number(Decimal)`** para `monto_total_historico` es exacto para los valores sembrados y `12345.67`; un redondeo IEEE-754 sería teórico y fuera del alcance de `Decimal(12,2)` (E-6).
- **La seed no tiene pedidos para el secundario fusionado** (cero pedidos), así que el comportamiento de fusión se prueba con un pedido ad-hoc del test. El teardown lo **anula** (`estado: "ANULADO"` + bloque de soft delete) además de darlo de baja lógica, **porque la agregación filtra por `estado`, no por `is_active`**: un `FACTURADO` solo soft-deleteado seguiría contando y rompería la idempotencia entre corridas.

**Pitfall operativo de la suite HTTP:** debe correr contra `npm start` (o rutas ya compiladas); un `next dev` frío puede tardar ~29s y consumir el timeout de 30s.

## 8. Cómo probar manualmente

1. Levantar el entorno y la seed (`npx prisma db seed`). El endpoint es de solo lectura: no requiere crear nada.
2. Iniciar sesión como `vendedor.seed@erp-swat.local` (contraseña `abc123456789`).
3. **Ficha de Juan Pérez:** `GET /api/clientes/buscar?dni=30123456`. Esperado `200` con `nombre: "Juan Pérez"`, `telefono: "3874001234"`, `email: "juan.perez@example.com"`, `canal_preferido: "WHATSAPP"`, 2 direcciones (`Casa`/`FACTURACION` y `Depósito`/`ENVIO`, cada una con `direccion_id`), e `historial_compras: { cantidad_operaciones: 2, monto_total_historico: 458000, ultima_compra: <fecha> }`. El payload **no** debe traer `segmento`, `is_active`, `created_at`, `deleted_*` ni `fusionado_en_id`.
4. **Cliente sin compras:** usar el duplicado sembrado `Juan Perez` (DNI `30987654`, id `1a2b3c4d-eeee-4a1a-8a1a-000000000002`) → `historial_compras: { ultima_compra: null, monto_total_historico: 0, cantidad_operaciones: 0 }` y `canal_preferido: null` (el duplicado se sembró sin canal).
5. **María Gómez:** `?dni=27555111` → `0 / 0 / null` (su pedido está `RESERVADO`).
6. **Errores:** `?dni=abc`, `?dni=123` o `?dni=` (vacío) → `400 VALIDATION_ERROR` con `fieldErrors.dni = ["El DNI debe tener 7 u 8 dígitos"]`; `?dni` **ausente** → `400 VALIDATION_ERROR` con el mensaje genérico de Zod (E-3); `?dni=99999999` → `404 CLIENTE_NO_ENCONTRADO` con el DNI en el mensaje; sin sesión → `401`; con `cajero.seed` → `403`; con `auditor.seed` → `200`.
7. **Solo lectura:** repetir la consulta N veces y verificar que `audit_logs` y las tablas de clientes/pedidos no cambian.

## 9. Impacto en otros archivos

| Archivo | Cambio |
|---|---|
| `src/lib/services/clientes/cliente.service.ts` | Se agregaron `consultarClientePorDni`, `resolverHistorialCompras` y sus tipos (`DireccionUnificada`, `ResumenHistorialCompras`, `ConsultaUnificadaCliente`) |
| `src/lib/schemas/clientes.schema.ts` | Se agregó `BuscarClientePorDniQuerySchema` |
| `src/app/api/clientes/buscar/route.ts` | **Nuevo** — `GET` (único export) |
| `package.json` | Scripts `test:integration:c7` y `test:integration:c7-http`; test unitario enumerado en `test` |

**Sin migración, sin cambio de schema y sin cambio de `seed.ts`.** **No** se tocaron `event-types.ts` ni `audit-log.listener.ts` (no emite eventos). **No** se modificó `actions.ts` (no hay Server Action) ni ningún archivo de Módulo B (solo se **lee** `PedidoVenta` vía Prisma).

## 10. Estado actual y pendientes

**Completo y verificable en código:**
- `GET /api/clientes/buscar?dni=` con permiso `clientes:leer` y el shape exacto de §2.7.
- Ficha unificada en una sola llamada: contacto + direcciones + canal + historial.
- Historial real contra `PedidoVenta` con agregación en una query (`aggregate`) y filtro de estados efectivos.
- Clúster de fusión resuelto internamente, con el primario incluido explícitamente.
- Reuso de `listarDireccionesCliente` (HU-C3) con el renombre `id`→`direccion_id`.
- Invariante de solo lectura (sin eventos, sin transacción, sin escrituras) verificada en runtime.
- Cobertura: unitaria (query string) e integración (servicio + HTTP).

**Gaps confirmados:**
- **La invariante de solo lectura no tiene guard automatizado en el repo** (W-2/E-4): probada solo con un probe de runtime (127→127). Deuda de cobertura.
- **`canal_preferido: null` no tiene aserción automatizada** (W-1/E-2).
- **El parámetro ausente devuelve el mensaje genérico de Zod**, no el amistoso del regex (E-3).
- **El fixture del secundario fusionado no tiene pedidos**: el comportamiento de fusión se prueba con un pedido ad-hoc anulado en el teardown.

**Pendientes / territorio de otras HUs:**
- **Flag para Módulo B (importante):** la agregación filtra por `estado`, **no** por `is_active`. Si algún camino de Módulo B soft-deletea un `PedidoVenta` `FACTURADO` **sin** setear `ANULADO`, ese pedido **seguirá contando** en el historial de compras. Módulo B debe anular (`ANULADO`) sus pedidos, no solo soft-deletearlos.
- **La re-vinculación del historial del secundario al primario es de HU-C5** (fusión). HU-C7 solo **lee** el resultado (`fusionado_en_id`); no fusiona ni modifica nada.
- **La consulta unificada es el único punto de integración de Módulo B con Módulo C** (spec §5, l. 429): Módulo B no consume `DireccionCliente` directamente.
- No debe agregarse una pantalla de dashboard ni un punto de entrada en la ficha: Tomi delimitó que es un endpoint JSON para el POS.
