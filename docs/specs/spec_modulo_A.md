```markdown
# Especificación Técnica — Módulo A (Inventario y Depósito)
## ERP SWAT Indumentarias — Sprint 1 + Sprint 2
## Revisión 2 — Actualizado post-análisis de trazabilidad (Product Backlog Consolidado, 73 HU)

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 14+ (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · Zod
**Referencias normativas:** `RULES.md` (Reglas N.° 1, 2 y 3) · `schema.prisma` · `Documento_Alcance_Funcional_Tecnico_SWAT_Indumentarias.docx` (§ Módulo A) · `Product Backlog SWAT Indumentarias.xlsx` (Entrega 1)

**Changelog de esta revisión (trazabilidad Backlog → Spec):**
| HU | Estado previo | Acción |
|---|---|---|
| HU-A5 (ampliada) | Gap — no contractualizada | Añadida sección 2.6 |
| HU-A8 | Gap — no contractualizada | Añadida sección 2.7 |
| HU-A9 | Gap — no contractualizada | Añadida sección 2.8 |
| HU-A10 | Gap — no contractualizada | Añadida sección 2.9 |
| HU-A11 | Gap — no contractualizada | Añadida sección 2.10 |
| Ajustes con doble validación (HU-3 backlog) | Parcial — solo patrón AJUSTE genérico | Añadida sección 3.8 |
| HU-A3 (En Prueba) | Cancelada — PO, Sprint Review 21/08/2026 | Sin cambios (ver sección 2.4) |

---

## 1. Visión General

El Módulo A es el subsistema responsable de la gestión del catálogo de indumentaria táctica (`ProductoMaestro` → `VarianteSKU`), el control de existencias por ubicación física (`Deposito` → `StockDeposito`) y el registro inmutable de todo movimiento de stock (`MovimientoStock`). La asignación temporal de unidades a efectivos de fuerzas de seguridad bajo el estado "En Prueba" (`LegajoPrueba`, HU-A3) fue cancelada por decisión del PO en la Sprint Review del 21/08/2026 (ver nota en 2.4).

Bajo la arquitectura Next.js App Router, el módulo se implementa como un conjunto de **Route Handlers** (`app/api/inventario/**/route.ts`) para operaciones invocadas desde clientes externos, dispositivos de escaneo EAN-13/QR o integraciones futuras (Módulo B - POS), y **Server Actions** para mutaciones originadas directamente desde formularios de la PWA (`app/(dashboard)/inventario/**/actions.ts`). Ambas superficies delegan exclusivamente en una **capa de servicios** (`lib/services/inventario/*`) que concentra las reglas de negocio, garantizando que ningún Route Handler ni Server Action contenga lógica de dominio inline.

El módulo no ejecuta jamás sentencias `DELETE` (Regla N.° 1 de `RULES.md`): toda "baja" es una actualización de `is_active`, `deleted_at`, `deleted_by` y `deletion_reason`. Toda mutación exitosa emite un evento de dominio consumido de forma asíncrona por el Módulo D para construir el `AuditLog` encadenado por SHA-256 (Regla N.° 2).

**Alcance de esta revisión:** las secciones 2.6 a 2.10 y 3.8 incorporan HUs identificadas como brecha de trazabilidad respecto del Product Backlog Consolidado. Su numeración de sección es aditiva; no se renumeran las secciones 2.1–2.5 ni 3.1–3.7 preexistentes para preservar la estabilidad de referencias cruzadas en documentos ya generados (Casos de Prueba, DER, Manual de Usuario).

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### Convenciones generales
- **Route Handlers** (`app/api/**/route.ts`): toda respuesta exitosa devuelve `NextResponse.json({ data, error: null }, { status })`; todo error de negocio devuelve `NextResponse.json({ data: null, error: { code, message } }, { status })` con `status` semántico (`400`, `404`, `409`, `422`).
- **Server Actions** (`"use server"`, ej. `app/(dashboard)/inventario/**/actions.ts`): **no** pueden retornar instancias de `NextResponse` — el runtime de Server Actions serializa el valor de retorno vía RPC interno de React/Next, no vía un ciclo HTTP explícito del lado del cliente. Deben retornar el objeto plano y serializable directamente: `return { data, error: null }` o `return { data: null, error: { code, message } }`, con el mismo shape que su Route Handler equivalente para mantener un contrato único consumible por ambas superficies (formularios server-rendered y clientes API externos).
- Todo payload se valida con Zod **antes** de tocar la capa de servicios (`schema.safeParse`); un `!success` retorna `400` (Route Handler) o `{ data: null, error: {...} }` (Server Action) con el `flatten()` del error.
- Toda ruta requiere sesión autenticada y verificación de permiso granular (Módulo D, RBAC) vía middleware `withPermission("inventario:<accion>")`.

---

### 2.1. Alta de Producto Maestro y generación en lote de Variantes SKU

**Ruta:** `POST /app/api/inventario/productos/route.ts`
**Server Action equivalente:** `crearProductoConVariantes()` en `app/(dashboard)/inventario/productos/actions.ts`

```typescript
// lib/schemas/inventario.schema.ts
import { z } from "zod";

export const VarianteInputSchema = z.object({
  talle: z.string().min(1),
  color: z.string().min(1),
  genero: z.string().min(1),
  modelo: z.string().min(1),
  ean_qr: z.string().length(13, "EAN-13 debe tener 13 dígitos"),
});

export const CrearProductoConVariantesSchema = z.object({
  nombre: z.string().min(2),
  rubro: z.string().min(1),
  categoria: z.string().min(1),
  unidad_medida: z.enum(["UNIDAD", "PAR", "KG"]),
  descripcion: z.string().optional(),
  proveedor_preferente: z.string().optional(),
  costo_estandar_referencia: z.number().positive(),
  variantes: z.array(VarianteInputSchema).min(1, "Debe generarse al menos una variante"),
});

export type CrearProductoConVariantesInput = z.infer<typeof CrearProductoConVariantesSchema>;
```

**Comportamiento esperado:**
- El `sku` de cada `VarianteSKU` **no** se recibe del cliente: se calcula server-side siguiendo la regla determinística `[PRODUCTO]-[MODELO]-[TALLE]-[COLOR]-[GENERO]` (normalizado a mayúsculas, sin espacios).
- La creación del `ProductoMaestro` y sus N `VarianteSKU` es atómica (`prisma.$transaction`).

**Respuesta `201 Created`:**
```json
{
  "data": {
    "producto_maestro_id": "uuid",
    "variantes_creadas": [
      { "id": "uuid", "sku": "CAMISA-TACTICA-M-VERDE-MASCULINO", "ean_qr": "7791234567890" }
    ]
  },
  "error": null
}
```

**Errores esperados:** `409 Conflict` si algún `sku` o `ean_qr` colisiona con un registro `is_active = true` existente.

---

### 2.2. Ingreso de Stock (Creación de `MovimientoStock` inmutable)

**Ruta:** `POST /app/api/inventario/movimientos/ingreso/route.ts`

```typescript
export const IngresoStockSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_destino_id: z.string().uuid(),
  cantidad: z.number().int().positive(),
  comprobante_referencia: z.string().min(1, "Todo ingreso requiere comprobante trazable"),
  estado_destino: z.enum([
    "DISPONIBLE", "EN_PRUEBA", "RESERVADO", "VENDIDO",
    "DEVUELTO", "BAJA_MERMA", "EN_TRANSITO",
  ]).default("DISPONIBLE"),
});
```

**Comportamiento esperado:**
- `deposito_origen_id` queda `null` (ingreso externo al sistema).
- `tipo_movimiento = "INGRESO"`.
- La transacción crea el `MovimientoStock` y hace `upsert` sobre `StockDeposito` (incrementando `cantidad`) dentro del mismo `$transaction`.

**Respuesta `201 Created`:**
```json
{
  "data": {
    "movimiento_id": "uuid",
    "stock_resultante": { "deposito_id": "uuid", "cantidad": 48 }
  },
  "error": null
}
```

---

### 2.3. Transferencia entre Depósitos

**Ruta:** `POST /app/api/inventario/movimientos/transferencia/route.ts`

```typescript
export const TransferenciaStockSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_origen_id: z.string().uuid(),
  deposito_destino_id: z.string().uuid(),
  cantidad: z.number().int().positive(),
  comprobante_referencia: z.string().optional(),
}).refine((d) => d.deposito_origen_id !== d.deposito_destino_id, {
  message: "El depósito de origen y destino no pueden ser iguales",
  path: ["deposito_destino_id"],
});
```

**Comportamiento esperado:**
- `tipo_movimiento = "TRANSFERENCIA"`.
- Un único `MovimientoStock` referencia ambos depósitos simultáneamente (`deposito_origen_id` y `deposito_destino_id` no nulos), conforme al modelo del `schema.prisma`.
- La transacción atómica: (a) decrementa `StockDeposito` de origen mediante `updateMany` condicionado (`where: { cantidad: { gte: cantidad_solicitada } }`, ver patrón obligatorio en sección 3.4) — validación y decremento en una sola sentencia, sin `SELECT` previo separado; (b) si `count === 0`, aborta la transacción y lanza `STOCK_INSUFICIENTE`; (c) hace `upsert`/incrementa `StockDeposito` de destino; (d) inserta el `MovimientoStock`.
- Si el stock de origen es insuficiente, la transacción completa revierte (rollback) y se retorna `422`. Esta validación **nunca** se realiza mediante un `findUnique` seguido de una comparación en memoria — ver advertencia de concurrencia en sección 3.4.

**Nota de consistencia con `schema.prisma` (Sprint 2):** el modelo `TransferenciaStock` introducido para HU-A11 formaliza la transferencia como un remito de **dos fases explícitas** (`EN_TRANSITO` → `RECIBIDA`, `enum EstadoTransferencia`), en lugar de un único `MovimientoStock` con decremento/incremento simultáneo. La presente sección 2.3 documenta el contrato de Sprint 1 (transferencia en una sola operación atómica) y permanece vigente para instalaciones que no requieran fase de recepción física separada. La capa de servicios de Sprint 2 (`transferencia-stock.service.ts`) debe decidir cuál de los dos flujos invoca según el parámetro `requiere_confirmacion_destino` — fuera de alcance de esta especificación; ver especificación HU-A11 (2.10) para el detalle del wizard que orquesta la selección.

**Respuesta `422 Unprocessable Entity` (stock insuficiente):**
```json
{
  "data": null,
  "error": { "code": "STOCK_INSUFICIENTE", "message": "Stock disponible (12) menor a la cantidad solicitada (20)" }
}
```

---

### 2.4. Transición a estado "En Prueba" (vinculación con `LegajoPrueba`)

> **[CANCELADO — Sprint Review 21/08/2026]** El Product Owner decidió eliminar por completo esta funcionalidad (HU-A3): no debía haber entrado al sprint. El código fue eliminado del repositorio; esta sección queda como referencia histórica.

**Ruta:** `POST /app/api/inventario/legajos-prueba/route.ts`

```typescript
export const IniciarLegajoPruebaSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_origen_id: z.string().uuid(),
  efectivo_placa: z.string().min(1),
  efectivo_organismo: z.string().min(1),
});
```

**Comportamiento esperado (crítico — cumplimiento Ley N.° 25.326 / Regla N.° 2 de `RULES.md`):**
1. `efectivo_placa` y `efectivo_organismo` se cifran **en el servidor**, dentro de la capa de servicios, con AES-256-GCM, usando una clave de cifrado leída exclusivamente desde variable de entorno (`ENCRYPTION_KEY_LEGAJOS`) inyectada vía secreto de Docker — nunca hardcodeada (Regla de Inyección de Credenciales, sección 3 de `RULES.md`).
2. El texto plano de estos campos **nunca** se persiste en logs, en el `AuditLog.valor_nuevo`, ni se retorna en la respuesta HTTP; el `AuditLog` almacena únicamente el hash/referencia cifrada.
3. La operación es atómica: crea el `LegajoPrueba` con los valores ya cifrados, inserta un `MovimientoStock` (`tipo_movimiento = "AJUSTE"`, `estado_destino = "EN_PRUEBA"`) y actualiza `StockDeposito`.

```typescript
// lib/services/inventario/legajo-prueba.service.ts (esbozo)
import { encryptAES256 } from "@/lib/crypto/aes";

export async function iniciarLegajoPrueba(input: IniciarLegajoPruebaInput, usuarioId: string) {
  const efectivo_placa_cifrado = encryptAES256(input.efectivo_placa);
  const efectivo_organismo_cifrado = encryptAES256(input.efectivo_organismo);

  return prisma.$transaction(async (tx) => {
    const legajo = await tx.legajoPrueba.create({
      data: {
        variante_sku_id: input.variante_sku_id,
        registrado_por_id: usuarioId,
        efectivo_placa: efectivo_placa_cifrado,
        efectivo_organismo: efectivo_organismo_cifrado,
      },
    });
    await tx.movimientoStock.create({
      data: {
        variante_sku_id: input.variante_sku_id,
        deposito_origen_id: input.deposito_origen_id,
        deposito_destino_id: null,
        tipo_movimiento: "AJUSTE",
        estado_destino: "EN_PRUEBA",
        cantidad: 1,
        registrado_por_id: usuarioId,
      },
    });
    return legajo;
  });
}
```

**Respuesta `201 Created`:**
```json
{
  "data": { "legajo_prueba_id": "uuid", "fecha_inicio_prueba": "2026-08-16T14:30:00.000Z" },
  "error": null
}
```
*(Nótese: `efectivo_placa` y `efectivo_organismo` quedan deliberadamente excluidos del payload de respuesta.)*

---

### 2.5. Baja lógica de un SKU (`VarianteSKU`)

**Ruta:** `PATCH /app/api/inventario/variantes/[id]/baja/route.ts`

```typescript
export const BajaLogicaVarianteSchema = z.object({
  deletion_reason: z.string().min(1).optional(),
}).superRefine(async (data, ctx) => {
  // Validación cruzada con stock real ejecutada en la capa de servicios,
  // no en el schema puro (requiere consulta a BD). Ver sección 3.5.
});
```

**Comportamiento esperado:**
- Si `StockDeposito` agregado de la variante (`SUM(cantidad)` en todos los depósitos activos) es `> 0`, `deletion_reason` es **obligatorio**; en caso contrario, la ruta retorna `400` antes de tocar la base.
- La operación **nunca** ejecuta `DELETE`: actualiza `is_active = false`, `deleted_at = now()`, `deleted_by = usuarioId`, `deletion_reason`.
- No afecta los registros históricos de `MovimientoStock` ni `StockDeposito` asociados (se preservan para trazabilidad).

**Respuesta `200 OK`:**
```json
{ "data": { "id": "uuid", "is_active": false, "deleted_at": "2026-08-16T14:31:00.000Z" }, "error": null }
```

**Respuesta `400 Bad Request` (stock positivo sin motivo):**
```json
{
  "data": null,
  "error": { "code": "MOTIVO_REQUERIDO", "message": "La variante posee stock activo (14 unidades); debe indicar deletion_reason" }
}
```

---

### 2.6. Configuración de Punto de Pedido / Stock de Seguridad + Consola de Depósito (HU-A5 ampliada)

**Contexto de trazabilidad:** el Product Backlog Consolidado amplía HU-A5 respecto de la especificación original de Sprint 1, incorporando dos requerimientos previamente no contractualizados: (a) filtros en cascada Depósito → Producto Maestro → Variante para la edición de umbrales, y (b) una tabla operativa de "productos por depósito" con buscador de texto libre y paginación. Esta sección formaliza ambos.

**Ruta (mutación):** `PATCH /app/api/inventario/stock-depositos/[id]/umbrales/route.ts`
**Server Action equivalente:** `actualizarUmbralesStockDeposito()` en `app/(dashboard)/inventario/depositos/actions.ts`

```typescript
// lib/schemas/inventario.schema.ts
export const ActualizarUmbralesSchema = z.object({
  punto_pedido: z.number().int().nonnegative(),
  stock_seguridad: z.number().int().nonnegative(),
}).refine((d) => d.punto_pedido >= d.stock_seguridad, {
  message: "El punto de pedido no puede ser inferior al stock de seguridad",
  path: ["punto_pedido"],
});

export type ActualizarUmbralesInput = z.infer<typeof ActualizarUmbralesSchema>;
```

**Comportamiento esperado (mutación):**
- El recurso objetivo es la fila `StockDeposito` identificada por su `id` (par único `variante_sku_id` + `deposito_id`, `@@unique` en `schema.prisma`), no la `VarianteSKU` de forma aislada — un mismo SKU admite umbrales distintos por depósito.
- La actualización es directa (`UPDATE` de dos columnas), no requiere `$transaction` multi-tabla.
- Emite el evento `stock:umbrales_actualizados` (ver tabla de eventos, sección 4) con `valor_anterior`/`valor_nuevo` de ambos campos.

**Ruta (consulta paginada — "Tabla General → Filtro Depósito → Tabla Filtrada"):** `GET /app/api/inventario/depositos/[id]/productos/route.ts`

```typescript
export const ListarProductosPorDepositoQuerySchema = z.object({
  deposito_id: z.string().uuid(),
  busqueda: z.string().trim().optional(), // filtro de texto libre por nombre de producto o SKU
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(20).default(20), // regla de negocio: máx. 20 ítems/vista
});

export type ListarProductosPorDepositoQuery = z.infer<typeof ListarProductosPorDepositoQuerySchema>;
```

**Comportamiento esperado (consulta):**
- Query parametrizado sobre `StockDeposito` con `where: { deposito_id, is_active: true }`, `include: { variante_sku: { include: { producto_maestro: true } } }`.
- El filtro `busqueda` aplica `ILIKE '%<busqueda>%'` (vía `contains`, `mode: "insensitive"` de Prisma) sobre `producto_maestro.nombre` **y** `variante_sku.sku` en una condición `OR`, evaluado en la misma consulta paginada — **no** se trae el dataset completo a memoria para filtrar client-side.
- Regla de negocio explícita del Backlog: la tabla **no admite más de 20 artículos por vista**; al superar ese umbral se habilita paginación server-side (`skip`/`take` de Prisma calculados desde `pagina`/`por_pagina`).
- La respuesta debe incluir metadatos de paginación (`total`, `pagina_actual`, `total_paginas`) para que el componente de tabla reutilizable (ver sección 2.10) pueda renderizar el control de paginación sin una segunda petición `COUNT`.

**Respuesta `200 OK` (consulta paginada):**
```json
{
  "data": {
    "items": [
      {
        "stock_deposito_id": "uuid",
        "variante_sku": "CAMP-SS3-L-NEG-H",
        "producto_nombre": "Campera Softshell Nivel III",
        "cantidad": 48,
        "punto_pedido": 10,
        "stock_seguridad": 5
      }
    ],
    "paginacion": { "total": 137, "pagina_actual": 1, "total_paginas": 7, "por_pagina": 20 }
  },
  "error": null
}
```

**Nota de diseño — componente de tabla reutilizable:** esta sección define el contrato de datos consumido por el componente de tabla/filtro/buscador/paginación que la sección 2.10 (HU-A11) reutiliza para el historial de movimientos. La forma de la respuesta (`items` + `paginacion`) es el contrato estable que debe respetar cualquier endpoint adicional que reutilice dicho componente de UI, evitando divergencia de shapes entre vistas.

---

### 2.7. Edición de atributos operativos de Producto Maestro y Variante (HU-A8)

**Regla de dominio no negociable:** el `sku` de una `VarianteSKU` es **inmutable** una vez generado. Las cuatro dimensiones que lo componen (`talle`, `color`, `genero`, `modelo`) no admiten edición bajo ninguna circunstancia, dado que el `sku` se deriva determinísticamente de ellas (sección 2.1) y constituye la clave de trazabilidad física (etiquetado EAN-13/QR ya impreso). Cualquier corrección de estas dimensiones se resuelve dando de baja lógica la variante existente (sección 2.5) y creando una nueva.

**Ruta (Producto Maestro):** `PATCH /app/api/inventario/productos/[id]/route.ts`
**Server Action equivalente:** `editarProductoMaestro()` en `app/(dashboard)/inventario/productos/actions.ts`

```typescript
export const EditarProductoMaestroSchema = z.object({
  nombre: z.string().min(2).optional(),
  descripcion: z.string().optional(),
  categoria: z.string().min(1).optional(),
  rubro: z.string().min(1).optional(),
  unidad_medida: z.enum(["UNIDAD", "PAR", "KG"]).optional(),
  proveedor_preferente: z.string().optional(),
  costo_estandar_referencia: z.number().positive().optional(),
}).strict(); // rechaza explícitamente cualquier campo fuera de este set (defensa en profundidad)
```

**Ruta (Variante — solo atributos operativos, nunca dimensiones del SKU):** `PATCH /app/api/inventario/variantes/[id]/route.ts`

```typescript
export const EditarVarianteOperativaSchema = z.object({
  ean_qr: z.string().length(13).optional(), // permitido: completar EAN pendiente (ver comentario schema.prisma)
  proveedor_id: z.string().uuid().optional(),
}).strict();
// Campos deliberadamente ausentes de este schema: talle, color, genero, modelo, sku.
// Su omisión no es un descuido: es la garantía de inmutabilidad a nivel de contrato Zod.
// Un intento de enviar cualquiera de estos campos es rechazado por `.strict()` con 400,
// sin necesidad de lógica condicional adicional en la capa de servicios.
```

**Comportamiento esperado:**
- Ambos endpoints ejecutan un `UPDATE` directo (no requieren `$transaction` multi-tabla salvo el caso de cambio de `costo_estandar_referencia`, ver punto siguiente).
- **Regla de no retroactividad de costeo:** si el payload incluye `costo_estandar_referencia`, la capa de servicios **no** debe recalcular ni tocar el campo `costo_estandar_referencia` de ningún `MovimientoStock` histórico. El valor de costo vigente al momento de cada movimiento pasado permanece congelado en el registro de ese movimiento (o en la tabla de valorización histórica asociada, fuera de alcance de este documento). Este comportamiento debe validarse explícitamente en los Casos de Prueba de esta HU: un cambio de `costo_estandar_referencia` **no debe** alterar el resultado de un reporte de valorización histórica ya generado.
- Toda edición exitosa —sobre Producto Maestro o Variante— emite `stock:producto_actualizado` o `stock:variante_actualizada` respectivamente (ver sección 4), con `valor_anterior` y `valor_nuevo` de únicamente los campos efectivamente modificados (diff, no snapshot completo).
- Permisos: `inventario:productos:editar` (Administrador y Encargado de Depósito, según matriz RBAC del Documento de Alcance § Módulo A, sección 5 — el Alcance no reserva esta acción exclusivamente al Administrador).

**Respuesta `200 OK`:**
```json
{
  "data": {
    "id": "uuid",
    "campos_modificados": ["descripcion", "costo_estandar_referencia"],
    "updated_at": "2026-08-20T10:15:00.000Z"
  },
  "error": null
}
```

**Respuesta `400 Bad Request` (intento de editar dimensión del SKU):**
```json
{
  "data": null,
  "error": { "code": "CAMPO_INMUTABLE", "message": "Unrecognized key(s) in object: 'talle'" }
}
```

---

### 2.8. Reclasificación de unidad en estado "Devuelto" (HU-A9)

**Ruta:** `PATCH /app/api/inventario/variantes/[id]/reclasificar-devuelto/route.ts`
**Server Action equivalente:** `reclasificarUnidadDevuelta()` en `app/(dashboard)/inventario/devoluciones/actions.ts`

```typescript
export const ReclasificarDevueltoSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  cantidad: z.number().int().positive(),
  resultado_control_calidad: z.enum(["APTO", "NO_APTO"]),
  motivo: z.string().min(1).optional(),
  rma_id: z.string().uuid().optional(), // referencia a Módulo I cuando la devolución proviene de un ticket de garantía
}).superRefine((data, ctx) => {
  if (data.resultado_control_calidad === "NO_APTO" && !data.motivo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "motivo es obligatorio cuando resultado_control_calidad = NO_APTO",
      path: ["motivo"],
    });
  }
});

export type ReclasificarDevueltoInput = z.infer<typeof ReclasificarDevueltoSchema>;
```

**Comportamiento esperado:**
- Precondición de estado: la unidad referenciada debe encontrarse en `estado_destino = "DEVUELTO"` en su último `MovimientoStock` para el par `(variante_sku_id, deposito_id)`; en caso contrario, `409 Conflict` con `ESTADO_INVALIDO_PARA_RECLASIFICACION`. La capa de servicios resuelve el estado vigente consultando el `MovimientoStock` más reciente por `created_at` para ese par — **no** existe un campo de estado desnormalizado en `StockDeposito` (el estado es una propiedad del último movimiento, no de la fila de stock agregado).
- Transición determinística según `resultado_control_calidad`:
  - `"APTO"` → `estado_destino = "DISPONIBLE"`, reincorpora la cantidad al stock comercial de ese depósito.
  - `"NO_APTO"` → `estado_destino = "BAJA_MERMA"`, **reutiliza la misma regla de motivo obligatorio de HU-A7** (sección 3.5) — el `superRefine` de este schema es la aplicación explícita de esa regla en este flujo, no una reimplementación paralela.
- La operación es atómica (`prisma.$transaction`): inserta el `MovimientoStock` compensatorio (`tipo_movimiento = "AJUSTE"`, `estado_origen = "DEVUELTO"`, `estado_destino` según el resultado) y, solo si el resultado es `"APTO"`, incrementa `StockDeposito.cantidad` del depósito indicado.
- Si `rma_id` está presente, el evento de dominio emitido (sección 4) incluye esa referencia para que el Módulo I pueda correlacionar el cierre del ticket de garantía con la resolución física del inventario — el Módulo A **no** valida la existencia del RMA contra el Módulo I (aislamiento de dominio, Regla N.° 3 de `RULES.md`); esa validación cruzada es responsabilidad del Módulo I al invocar este endpoint.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "movimiento_id": "uuid",
    "estado_destino": "DISPONIBLE",
    "stock_resultante": { "deposito_id": "uuid", "cantidad": 49 }
  },
  "error": null
}
```

**Respuesta `409 Conflict` (unidad no está en estado Devuelto):**
```json
{
  "data": null,
  "error": { "code": "ESTADO_INVALIDO_PARA_RECLASIFICACION", "message": "La unidad no se encuentra en estado 'Devuelto'" }
}
```

---

### 2.9. Servicio centralizado de Reserva — congelamiento y liberación (HU-A10)

**Principio arquitectónico:** el Módulo A es la **única** fuente de verdad para la máquina de estados de "Reservado". Los módulos consumidores (Módulo B — cotización institucional, Módulo E — checkout web) invocan exclusivamente la interfaz descripta en esta sección; ninguno de los dos implementa lógica de congelamiento/liberación de stock propia. Esta restricción es de cumplimiento obligatorio y debe verificarse retroactivamente contra HU-B3 y HU-E1 al momento de su implementación (nota técnica explícita del Backlog).

**Modelo de datos de referencia (`schema.prisma`):** esta HU se apoya en el modelo `Reserva` (no en `MovimientoStock` como mecanismo primario de congelamiento). `Reserva` mantiene su propio ciclo de vida: `fecha_inicio_reserva` (inicio del TTL), `fecha_fin_reserva` (NULL mientras la reserva está activa; se setea al confirmar venta o liberar por TTL) y `origen_reserva` (`enum OrigenReserva`: `SENIA` | `LICITACION` | `PEDIDO_INSTITUCIONAL`).

**Ruta (congelamiento):** `POST /app/api/inventario/reservas/route.ts`
**Server Action equivalente:** `crearReserva()` en `lib/services/inventario/reserva.service.ts`, invocada internamente por Módulo B/E — no expuesta como Server Action de formulario directo del Módulo A.

```typescript
// lib/schemas/inventario.schema.ts
export const CrearReservaSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  cantidad: z.number().int().positive(),
  origen_reserva: z.enum(["SENIA", "LICITACION", "PEDIDO_INSTITUCIONAL"]),
  motivo: z.string().optional(),
  ttl_horas: z.number().int().positive().optional(),
  // Si se omite, la capa de servicios resuelve el TTL por defecto según origen_reserva:
  // 72h para SENIA/LICITACION/PEDIDO_INSTITUCIONAL (reserva general);
  // el canal E-commerce (checkout web) SIEMPRE provee ttl_horas explícito y acotado
  // (valor menor a 72h), nunca depende del default general.
});

export type CrearReservaInput = z.infer<typeof CrearReservaSchema>;
```

**Comportamiento esperado (congelamiento):**
- Ejecuta el mismo patrón de decremento atómico condicionado descripto en sección 3.4 (`updateMany` con `where: { cantidad: { gte: cantidad } }`) sobre `StockDeposito`, dentro de `prisma.$transaction`.
- Si `count === 0` tras el `updateMany`, aborta y lanza `STOCK_INSUFICIENTE` (`422`) — idéntico contrato de error que ingreso/transferencia.
- Si la validación pasa: decrementa `StockDeposito.cantidad`, crea la fila `Reserva` (`fecha_fin_reserva = null`), e inserta un `MovimientoStock` de auditoría (`tipo_movimiento = "AJUSTE"`, `estado_destino = "RESERVADO"`) para preservar la trazabilidad exigida por la Regla N.° 2 — el modelo `Reserva` es el mecanismo operativo del congelamiento, pero **no reemplaza** la obligación de `MovimientoStock` como registro inmutable auditado.

**Ruta (liberación por venta confirmada):** `PATCH /app/api/inventario/reservas/[id]/confirmar/route.ts`

```typescript
export const ConfirmarReservaSchema = z.object({
  venta_id: z.string().uuid(), // referencia externa del Módulo B/E que originó la confirmación
});
```
- Setea `Reserva.fecha_fin_reserva = now()`. **No** reincrementa `StockDeposito.cantidad` (la unidad transiciona a `VENDIDO`, no vuelve a `DISPONIBLE`). Inserta `MovimientoStock` (`estado_origen = "RESERVADO"`, `estado_destino = "VENDIDO"`, `venta_id` referenciado en el campo STUB ya presente en el modelo).

**Ruta (liberación por TTL vencido — job programado):** `POST /app/api/cron/check-pruebas-vencidas` *(nombre de ruta heredado del diseño original del cron; cubre liberación de Reservas vencidas pese a su nombre histórico — ver nota)*

**Nota de nomenclatura:** el `schema.prisma` documenta explícitamente esta ruta bajo el nombre `/api/cron/check-pruebas-vencidas`, remanente de una fase de diseño previa a la cancelación de HU-A3. Se mantiene el nombre por ya estar referenciado en el comentario del modelo `Reserva` y para no introducir divergencia entre `schema.prisma` y esta especificación; su responsabilidad funcional actual es exclusivamente la liberación de `Reserva` vencidas por TTL, **no** legajos de prueba.

**Comportamiento esperado (liberación por TTL):**
- Job invocado externamente (Vercel Cron / equivalente), fuera del ciclo request-response estándar de Next.js — mismo patrón arquitectónico documentado para reactivación automática en `spec_modulo_D.md` (ausente en Sprint 1, aplicado aquí en Sprint 2).
- Query de selección: `Reserva` con `is_active: true`, `fecha_fin_reserva: null`, y `fecha_inicio_reserva` anterior al umbral TTL vigente para su `origen_reserva` — aprovecha el índice compuesto `@@index([is_active, fecha_fin_reserva, fecha_inicio_reserva])` ya definido en `schema.prisma`.
- Por cada `Reserva` vencida, dentro de `prisma.$transaction`: incrementa `StockDeposito.cantidad` (reversión del congelamiento), setea `Reserva.fecha_fin_reserva = now()`, e inserta un `MovimientoStock` **compensatorio** de tipo `INGRESO` (`estado_origen = "RESERVADO"`, `estado_destino = "DISPONIBLE"`) — el comentario del modelo `Reserva` en `schema.prisma` es explícito respecto de que la reversión es un `INGRESO` compensatorio, no un `AJUSTE`.
- Cada liberación por TTL emite evento auditado hacia Módulo D (regla explícita del Backlog).

**Respuesta `201 Created` (congelamiento):**
```json
{
  "data": { "reserva_id": "uuid", "fecha_inicio_reserva": "2026-08-20T09:00:00.000Z", "ttl_horas": 72 },
  "error": null
}
```

---

### 2.10. Wizard de carga de movimiento + Historial operativo de Depósito (HU-A11)

**Naturaleza de esta HU:** es una capa de **orquestación de UI y consulta**, no de negocio nueva. El criterio de aceptación del Backlog es explícito: el wizard invoca los Server Actions ya existentes (`crearIngreso` de HU-A2, `crearTransferencia` de HU-A4) "sin duplicar ni reimplementar su lógica de negocio, validaciones o manejo de transacciones". En consecuencia, esta sección **no** define un nuevo endpoint de mutación — define el contrato de orquestación client-side y el endpoint de consulta de historial.

**Flujo de wizard (orquestación, sin Route Handler propio):**
1. Paso 1 — selección de `deposito_id` (obligatorio, primer filtro).
2. Paso 2 — selección de `tipo_movimiento` ∈ `{ "INGRESO", "TRANSFERENCIA", "AJUSTE" }`, condiciona qué Server Action se invocará en el paso 3.
3. Paso 3 — selección de producto(s)/variante(s) y cantidad, con el `deposito_id` del paso 1 ya inyectado como `deposito_destino_id` (INGRESO) o `deposito_origen_id` (TRANSFERENCIA/AJUSTE saliente) del schema correspondiente (secciones 2.2, 2.3).

El componente de wizard es responsable únicamente de **secuenciar la recolección de inputs** y de invocar el `schema.safeParse` + Server Action correspondiente al tipo elegido; no contiene lógica de validación de stock, cálculo de SKU, ni manejo de `$transaction` — toda esa responsabilidad permanece en `lib/services/inventario/*.service.ts` según el principio general de la sección 1.

**Ruta (consulta — historial operativo):** `GET /app/api/inventario/movimientos/historial/route.ts`

```typescript
export const HistorialMovimientosQuerySchema = z.object({
  deposito_id: z.string().uuid().optional(),
  variante_sku_id: z.string().uuid().optional(),
  tipo_movimiento: z.enum(["INGRESO", "EGRESO", "TRANSFERENCIA", "AJUSTE"]).optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  busqueda: z.string().trim().optional(), // reutiliza el mismo contrato de filtro de texto de HU-A5 (sección 2.6)
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(20).default(20),
});

export type HistorialMovimientosQuery = z.infer<typeof HistorialMovimientosQuerySchema>;
```

**Comportamiento esperado:**
- Query de solo lectura sobre `MovimientoStock` con `where: { is_active: true, ...filtros }`, ordenado por `created_at DESC`.
- **Distinción explícita de audiencia y alcance respecto de HU-A6:** este endpoint es de uso **operativo**, accesible por el rol Encargado de Depósito bajo el permiso `inventario:movimientos:leer_historico`. Es estructuralmente distinto de la Consola de Auditoría Forense (HU-A6 / Módulo D), que expone verificación de cadena SHA-256 y es de acceso exclusivo del rol Auditor bajo `auditoria:leer_historico`. Este endpoint **no** expone ni calcula hashes de integridad — es una vista de conveniencia operativa sobre datos ya inmutables, no un mecanismo de auditoría forense. Ambos endpoints leen la misma tabla base (`MovimientoStock`) pero exponen superficies de permiso, filtros y garantías distintas; no deben unificarse en un único Route Handler.
- Reutiliza el contrato de respuesta `{ items, paginacion }` definido en la sección 2.6, y el mismo componente de tabla/filtro/buscador/paginación de UI — no se define un componente nuevo.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "items": [
      {
        "movimiento_id": "uuid",
        "tipo_movimiento": "TRANSFERENCIA",
        "variante_sku": "CAMP-SS3-L-NEG-H",
        "deposito_origen": "Depósito Central",
        "deposito_destino": "Showroom",
        "cantidad": 5,
        "registrado_por": "encargado.deposito@swat.local",
        "created_at": "2026-08-20T11:40:00.000Z"
      }
    ],
    "paginacion": { "total": 342, "pagina_actual": 1, "total_paginas": 18, "por_pagina": 20 }
  },
  "error": null
}
```

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

Toda la lógica listada a continuación reside exclusivamente en `lib/services/inventario/*.service.ts`. Los Route Handlers y Server Actions actúan como capa delgada de validación (Zod) y autorización (RBAC), delegando el resto.

### 3.1. Transacciones atómicas con `prisma.$transaction`
Toda operación que modifique **más de una tabla** (`MovimientoStock` + `StockDeposito`, o `LegajoPrueba` + `MovimientoStock`) debe ejecutarse dentro de un único `prisma.$transaction(async (tx) => { ... })`. Si cualquier paso falla (incluida una violación de constraint `onDelete: Restrict`), Prisma revierte la transacción completa; el Route Handler no debe capturar errores parciales ni intentar compensación manual.

### 3.2. Inmutabilidad de `MovimientoStock`
Una vez insertado, un registro de `MovimientoStock` **no admite `UPDATE`** desde ninguna capa de la aplicación. La capa de servicios no debe exponer ningún método `actualizarMovimiento()`. Toda corrección (ej. cantidad mal cargada) se resuelve mediante un **movimiento compensatorio** nuevo (`tipo_movimiento = "AJUSTE"`) que referencia, vía `comprobante_referencia`, el movimiento original a corregir.

### 3.3. Filtrado por defecto de registros inactivos
Todo método de la capa de servicios que liste o busque entidades (`listarProductos`, `buscarVariantePorSku`, `obtenerStockDeposito`, etc.) debe aplicar `where: { is_active: true }` por defecto. Un parámetro explícito `incluirInactivos: boolean` (default `false`) permite a los servicios del **Módulo de Auditoría exclusivamente** consultar el histórico completo; ningún endpoint de operación estándar del Módulo A debe exponer este flag al cliente HTTP sin verificar el permiso `auditoria:leer_historico`.

### 3.4. Validación de existencia, consistencia referencial y concurrencia previa a mutación
Antes de cualquier `INSERT` en `MovimientoStock`, la capa de servicios debe verificar explícitamente que:
- El `VarianteSKU` referenciado tiene `is_active = true`.
- El/los `Deposito` referenciados tienen `is_active = true`.
- En transferencias/egresos, `StockDeposito.cantidad >= cantidad_solicitada`.

**Advertencia de framework — Prisma NO aplica bloqueo pesimista implícito:** `prisma.$transaction` opera por defecto bajo el nivel de aislamiento `READ COMMITTED` de PostgreSQL y **no** ejecuta `SELECT ... FOR UPDATE` de forma automática. Un `findUnique` seguido de un `update` separado dentro de la misma transacción es vulnerable a condiciones de carrera: dos transferencias concurrentes sobre la última unidad de stock pueden leer `cantidad: 1` ambas antes de que cualquiera confirme su decremento, y ambas pasarían la validación.

**Patrón obligatorio — decremento atómico condicionado:** el descuento de stock en depósito de origen debe delegar la validación de suficiencia al propio motor de PostgreSQL, combinando la condición y el decremento en una única sentencia `UPDATE`:

```typescript
const resultado = await tx.stockDeposito.updateMany({
  where: {
    id: stockDepositoId,
    cantidad: { gte: cantidad_solicitada }, // condición evaluada atómicamente por PostgreSQL
  },
  data: {
    cantidad: { decrement: cantidad_solicitada },
  },
});

if (resultado.count === 0) {
  throw new ServiceError("STOCK_INSUFICIENTE");
  // count === 0 indica que, al momento de ejecutar el UPDATE, la fila
  // no cumplía la condición (stock insuficiente o ya decrementado por
  // una transacción concurrente) — nunca asumir que la fila no existe.
}
```

Este patrón aplica a **toda** operación que decremente `StockDeposito.cantidad` (egreso, transferencia — sobre el depósito de origen —, ajustes negativos, y congelamiento de Reserva — sección 2.9). El incremento en depósito de destino (ingreso, transferencia — lado destino, liberación de Reserva por TTL) no requiere esta guarda al no existir riesgo de valores negativos, pero debe seguir ejecutándose dentro del mismo `$transaction` para preservar la atomicidad del movimiento completo.

### 3.5. Baja lógica condicionada a stock (`deletion_reason` obligatorio)
La función `darDeBajaVariante(varianteId, usuarioId, motivo?)` debe:
1. Calcular `stockTotal = SUM(StockDeposito.cantidad WHERE variante_sku_id = varianteId AND is_active = true)`.
2. Si `stockTotal > 0 && !motivo`, lanzar `ServiceError("MOTIVO_REQUERIDO")` sin tocar la base.
3. Si la validación pasa, actualizar únicamente los 4 campos de soft delete — nunca modificar `StockDeposito` ni `MovimientoStock` como efecto colateral de la baja.

### 3.6. Cifrado AES-256 aislado en capa de crypto dedicada
Ninguna función de servicio debe invocar primitivas de cifrado (`crypto.createCipheriv`, etc.) directamente. Toda operación de cifrado/descifrado pasa por `lib/crypto/aes.ts`, que centraliza el manejo de la clave (`ENCRYPTION_KEY_LEGAJOS`) y el vector de inicialización, facilitando rotación de claves sin tocar la lógica de negocio.

**Nota de estado post Sprint 1 (HU-A3 cancelada):** dado que HU-A3 fue cancelada por el PO (sección 2.4), `lib/crypto/aes.ts` no tiene actualmente ningún consumidor activo dentro del Módulo A. Su remoción o retención es una decisión de limpieza técnica pendiente, fuera del alcance de esta especificación (ver seguimiento en la bitácora del equipo).

### 3.7. Restricción de borrado físico (`onDelete: Restrict`)
Como consecuencia directa del `schema.prisma`, cualquier intento de baja física de un `Deposito`, `ProductoMaestro` o `VarianteSKU` con relaciones activas (`StockDeposito`, `MovimientoStock`, `LegajoPrueba`) es rechazado a nivel de motor PostgreSQL. La capa de servicios **no debe** capturar esta excepción de Prisma (`P2003`) para reintentar con cascada; debe propagarla como error `409 Conflict` explícito.

### 3.8. Doble validación por umbral en ajustes manuales de inventario

**Contexto de trazabilidad:** el Product Backlog Consolidado exige, para la HU de ajustes manuales de inventario, un flujo de doble validación (usuario detector + aprobación de Supervisor) cuando el ajuste supera un umbral configurable. La sección 3.2 preexistente documenta únicamente el patrón de `MovimientoStock` compensatorio de tipo `AJUSTE`, sin el circuito de aprobación. Esta sección lo formaliza.

**Umbral:** configurable a nivel de sistema (valor por defecto: **5 unidades**, o su equivalente en monto valorizado — el criterio de equivalencia monetaria queda fuera de alcance de esta HU y se resuelve en Módulo G). El valor configurado se persiste como parámetro de sistema, no hardcodeado.

**Máquina de estados del ajuste (nueva, exclusiva de este flujo):**

| Estado | Descripción | Transición habilitada por |
|---|---|---|
| `PENDIENTE_APROBACION` | Ajuste registrado por un usuario, `cantidad_ajuste` supera el umbral vigente | Creación inicial |
| `APROBADO` | Un Supervisor validó el ajuste | `PATCH .../aprobar` |
| `RECHAZADO` | Un Supervisor rechazó el ajuste | `PATCH .../rechazar` |
| *(sin estado intermedio)* | Ajuste **no** supera el umbral: se aplica de forma directa e inmediata, sin pasar por `PENDIENTE_APROBACION` | Creación inicial |

**Regla crítica de impacto en stock:** un ajuste en estado `PENDIENTE_APROBACION` **no** debe impactar `StockDeposito.cantidad` bajo ninguna circunstancia. El `MovimientoStock` compensatorio solo se inserta (y el `StockDeposito` solo se actualiza) en el momento en que el registro transiciona a `APROBADO`. Esto implica que el registro inicial de un ajuste que excede el umbral se persiste en una tabla/estructura intermedia de solicitud (`AjusteInventarioSolicitud` o equivalente — fuera del alcance de este documento definir el modelo Prisma exacto, remitir a `schema.prisma` para su definición formal) y **no** en `MovimientoStock` directamente, dado que `MovimientoStock` es por definición un registro de un hecho consumado e inmutable (sección 3.2) — persistir ahí un ajuste todavía no aprobado violaría esa invariante.

**Ruta (creación de solicitud de ajuste):** `POST /app/api/inventario/ajustes/route.ts`

```typescript
export const CrearAjusteInventarioSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  cantidad_ajuste: z.number().int(), // admite signo negativo (merma) o positivo (sobrante detectado en conteo físico)
  motivo: z.string().min(1, "Todo ajuste manual requiere motivo obligatorio"),
});
```

**Comportamiento esperado:**
1. La capa de servicios calcula `Math.abs(cantidad_ajuste)` y lo compara contra el umbral configurado.
2. Si `Math.abs(cantidad_ajuste) <= umbral`: aplica el patrón ya descripto en sección 3.2/3.4 de forma directa (crea `MovimientoStock`, actualiza `StockDeposito` dentro de `$transaction`), sin pasar por el circuito de aprobación.
3. Si `Math.abs(cantidad_ajuste) > umbral`: crea únicamente el registro de solicitud en estado `PENDIENTE_APROBACION`; no toca `StockDeposito` ni `MovimientoStock`. Retorna `202 Accepted` (no `201 Created`, para señalar explícitamente al cliente que la operación quedó pendiente de un tercero, no completada).

**Ruta (aprobación):** `PATCH /app/api/inventario/ajustes/[id]/aprobar/route.ts` — requiere permiso `inventario:ajustes:aprobar` (exclusivo de Administrador, conforme matriz RBAC del Documento de Alcance § Módulo A: "Aprobar ajustes que superan el umbral crítico" es acción exclusiva del Administrador, sin equivalente △-solicita para ningún otro rol).

**Comportamiento esperado (aprobación):** dentro de `prisma.$transaction`, aplica atómicamente el patrón de decremento/incremento condicionado (sección 3.4) sobre `StockDeposito`, inserta el `MovimientoStock` compensatorio referenciando el `id` de la solicitud original vía `comprobante_referencia`, y actualiza el estado de la solicitud a `APROBADO`.

**Respuesta `202 Accepted` (ajuste pendiente de aprobación):**
```json
{
  "data": { "ajuste_id": "uuid", "estado": "PENDIENTE_APROBACION", "cantidad_ajuste": -12, "umbral_vigente": 5 },
  "error": null
}
```

**Respuesta `201 Created` (ajuste bajo el umbral, aplicado de forma directa):**
```json
{
  "data": { "movimiento_id": "uuid", "estado": "APLICADO_DIRECTO", "stock_resultante": { "deposito_id": "uuid", "cantidad": 43 } },
  "error": null
}
```

---

## 4. Eventos de Dominio (EDA)

Conforme a `contexto_sprint_1.md` (sección 4), toda operación transaccional exitosa del Módulo A emite un evento al bus interno, consumido de forma **asíncrona** por el Módulo D para construir el `AuditLog` encadenado. En el entorno Node.js de Next.js (Route Handlers ejecutados en runtime `nodejs`, no `edge`), la emisión se implementa mediante un `EventEmitter` interno de proceso para Sprint 1, encapsulado detrás de un Gateway (`lib/events/domain-event-bus.ts`) para permitir su reemplazo futuro por un broker externo (ej. Redis Streams) sin acoplar el dominio, conforme al patrón Adapter exigido en la sección 4 de `RULES.md`.

**Regla de emisión:** el evento se publica **después** de que `prisma.$transaction` resuelva exitosamente (nunca dentro de la transacción, para evitar que un consumidor lento bloquee el commit de base de datos). Esta regla aplica sin excepción a todos los eventos listados a continuación, incluidos los incorporados en esta revisión.

| Evento | Disparado por | Payload mínimo |
|---|---|---|
| `stock:producto_creado` | Alta de `ProductoMaestro` + variantes (2.1) | `producto_maestro_id`, `usuario_id`, `variantes_ids[]` |
| `stock:movimiento_registrado` | Ingreso, Transferencia y Ajuste directo bajo umbral (2.2, 2.3, 3.8) | `movimiento_id`, `tipo_movimiento`, `variante_sku_id`, `usuario_id`, `cantidad` |
| `stock:legajo_prueba_iniciado` | Transición a "En Prueba" (2.4) — **[HISTÓRICO, funcionalidad cancelada]** | `legajo_prueba_id`, `variante_sku_id`, `usuario_id` (**sin** `efectivo_placa`/`efectivo_organismo` en texto plano) |
| `stock:variante_baja_logica` | Baja lógica de SKU (2.5) | `variante_sku_id`, `usuario_id`, `deletion_reason`, `stock_total_al_momento` |
| `stock:umbrales_actualizados` | Actualización de punto de pedido / stock de seguridad (2.6) | `stock_deposito_id`, `usuario_id`, `valor_anterior: { punto_pedido, stock_seguridad }`, `valor_nuevo: { punto_pedido, stock_seguridad }` |
| `stock:producto_actualizado` | Edición de atributos de Producto Maestro (2.7) | `producto_maestro_id`, `usuario_id`, `campos_modificados[]`, `valor_anterior`, `valor_nuevo` |
| `stock:variante_actualizada` | Edición de atributos operativos de Variante (2.7) | `variante_sku_id`, `usuario_id`, `campos_modificados[]`, `valor_anterior`, `valor_nuevo` |
| `stock:reclasificacion_devuelto` | Reclasificación de unidad "Devuelto" (2.8) | `variante_sku_id`, `usuario_id`, `resultado_control_calidad`, `estado_destino`, `rma_id?` |
| `stock:reserva_congelada` | Congelamiento de Reserva (2.9) | `reserva_id`, `variante_sku_id`, `deposito_id`, `usuario_id`, `origen_reserva`, `cantidad` |
| `stock:reserva_liberada` | Liberación de Reserva — por venta confirmada o por TTL vencido (2.9) | `reserva_id`, `motivo_liberacion: "VENTA" \| "TTL_VENCIDO"`, `variante_sku_id`, `cantidad` |
| `stock:ajuste_pendiente_aprobacion` | Solicitud de ajuste que excede el umbral crítico (3.8) | `ajuste_id`, `usuario_id`, `cantidad_ajuste`, `umbral_vigente`, `motivo` |
| `stock:ajuste_aprobado` \| `stock:ajuste_rechazado` | Resolución de un ajuste pendiente por un Supervisor/Administrador (3.8) | `ajuste_id`, `aprobado_por_id`, `movimiento_id?` (solo si aprobado) |

**Nota de trazabilidad HU-A11:** el wizard de carga de movimiento (sección 2.10) **no** emite eventos propios — reutiliza `stock:movimiento_registrado` a través de los Server Actions que ya lo emiten (`crearIngreso`, `crearTransferencia`). Esto es consistente con el criterio de aceptación del Backlog: HU-A11 es una capa de orquestación de UI, no una nueva fuente de eventos de dominio.

**Consumo por el Módulo D:** el listener del Módulo D recibe el evento, resuelve `hash_anterior` (último `hash_actual` insertado en `AuditLog`), calcula `hash_actual = SHA256(payload + hash_anterior)` y persiste el registro en `AuditLog`. El Módulo A no calcula ni conoce el hash: su única responsabilidad es emitir el evento con el `valor_anterior`/`valor_nuevo` relevante, preservando el aislamiento de dominio exigido por la Regla N.° 3 de `RULES.md`.
```
