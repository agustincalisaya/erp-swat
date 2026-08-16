```markdown
# Especificación Técnica — Módulo A (Inventario y Depósito)
## ERP SWAT Indumentarias — Sprint 1

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 14+ (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · Zod
**Referencias normativas:** `RULES.md` (Reglas N.° 1, 2 y 3) · `contexto_sprint_1.md` · `schema.prisma`

---

## 1. Visión General

El Módulo A es el subsistema responsable de la gestión del catálogo de indumentaria táctica (`ProductoMaestro` → `VarianteSKU`), el control de existencias por ubicación física (`Deposito` → `StockDeposito`) y el registro inmutable de todo movimiento de stock (`MovimientoStock`), incluyendo la asignación temporal de unidades a efectivos de fuerzas de seguridad bajo el estado "En Prueba" (`LegajoPrueba`).

Bajo la arquitectura Next.js App Router, el módulo se implementa como un conjunto de **Route Handlers** (`app/api/inventario/**/route.ts`) para operaciones invocadas desde clientes externos, dispositivos de escaneo EAN-13/QR o integraciones futuras (Módulo B - POS), y **Server Actions** para mutaciones originadas directamente desde formularios de la PWA (`app/(dashboard)/inventario/**/actions.ts`). Ambas superficies delegan exclusivamente en una **capa de servicios** (`lib/services/inventario/*`) que concentra las reglas de negocio, garantizando que ningún Route Handler ni Server Action contenga lógica de dominio inline.

El módulo no ejecuta jamás sentencias `DELETE` (Regla N.° 1 de `RULES.md`): toda "baja" es una actualización de `is_active`, `deleted_at`, `deleted_by` y `deletion_reason`. Toda mutación exitosa emite un evento de dominio consumido de forma asíncrona por el Módulo D para construir el `AuditLog` encadenado por SHA-256 (Regla N.° 2).

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

**Respuesta `422 Unprocessable Entity` (stock insuficiente):**
```json
{
  "data": null,
  "error": { "code": "STOCK_INSUFICIENTE", "message": "Stock disponible (12) menor a la cantidad solicitada (20)" }
}
```

---

### 2.4. Transición a estado "En Prueba" (vinculación con `LegajoPrueba`)

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

Este patrón aplica a **toda** operación que decremente `StockDeposito.cantidad` (egreso, transferencia — sobre el depósito de origen —, y ajustes negativos). El incremento en depósito de destino (ingreso, transferencia — lado destino) no requiere esta guarda al no existir riesgo de valores negativos, pero debe seguir ejecutándose dentro del mismo `$transaction` para preservar la atomicidad del movimiento completo.

### 3.5. Baja lógica condicionada a stock (`deletion_reason` obligatorio)
La función `darDeBajaVariante(varianteId, usuarioId, motivo?)` debe:
1. Calcular `stockTotal = SUM(StockDeposito.cantidad WHERE variante_sku_id = varianteId AND is_active = true)`.
2. Si `stockTotal > 0 && !motivo`, lanzar `ServiceError("MOTIVO_REQUERIDO")` sin tocar la base.
3. Si la validación pasa, actualizar únicamente los 4 campos de soft delete — nunca modificar `StockDeposito` ni `MovimientoStock` como efecto colateral de la baja.

### 3.6. Cifrado AES-256 aislado en capa de crypto dedicada
Ninguna función de servicio debe invocar primitivas de cifrado (`crypto.createCipheriv`, etc.) directamente. Toda operación de cifrado/descifrado pasa por `lib/crypto/aes.ts`, que centraliza el manejo de la clave (`ENCRYPTION_KEY_LEGAJOS`) y el vector de inicialización, facilitando rotación de claves sin tocar la lógica de negocio.

### 3.7. Restricción de borrado físico (`onDelete: Restrict`)
Como consecuencia directa del `schema.prisma`, cualquier intento de baja física de un `Deposito`, `ProductoMaestro` o `VarianteSKU` con relaciones activas (`StockDeposito`, `MovimientoStock`, `LegajoPrueba`) es rechazado a nivel de motor PostgreSQL. La capa de servicios **no debe** capturar esta excepción de Prisma (`P2003`) para reintentar con cascada; debe propagarla como error `409 Conflict` explícito.

---

## 4. Eventos de Dominio (EDA)

Conforme a `contexto_sprint_1.md` (sección 4), toda operación transaccional exitosa del Módulo A emite un evento al bus interno, consumido de forma **asíncrona** por el Módulo D para construir el `AuditLog` encadenado. En el entorno Node.js de Next.js (Route Handlers ejecutados en runtime `nodejs`, no `edge`), la emisión se implementa mediante un `EventEmitter` interno de proceso para Sprint 1, encapsulado detrás de un Gateway (`lib/events/domain-event-bus.ts`) para permitir su reemplazo futuro por un broker externo (ej. Redis Streams) sin acoplar el dominio, conforme al patrón Adapter exigido en la sección 4 de `RULES.md`.

**Regla de emisión:** el evento se publica **después** de que `prisma.$transaction` resuelva exitosamente (nunca dentro de la transacción, para evitar que un consumidor lento bloquee el commit de base de datos).

| Evento | Disparado por | Payload mínimo |
|---|---|---|
| `stock:producto_creado` | Alta de `ProductoMaestro` + variantes (2.1) | `producto_maestro_id`, `usuario_id`, `variantes_ids[]` |
| `stock:movimiento_registrado` | Ingreso, Transferencia y Ajuste (2.2, 2.3) | `movimiento_id`, `tipo_movimiento`, `variante_sku_id`, `usuario_id`, `cantidad` |
| `stock:legajo_prueba_iniciado` | Transición a "En Prueba" (2.4) | `legajo_prueba_id`, `variante_sku_id`, `usuario_id` (**sin** `efectivo_placa`/`efectivo_organismo` en texto plano) |
| `stock:variante_baja_logica` | Baja lógica de SKU (2.5) | `variante_sku_id`, `usuario_id`, `deletion_reason`, `stock_total_al_momento` |

**Consumo por el Módulo D:** el listener del Módulo D recibe el evento, resuelve `hash_anterior` (último `hash_actual` insertado en `AuditLog`), calcula `hash_actual = SHA256(payload + hash_anterior)` y persiste el registro en `AuditLog`. El Módulo A no calcula ni conoce el hash: su única responsabilidad es emitir el evento con el `valor_anterior`/`valor_nuevo` relevante, preservando el aislamiento de dominio exigido por la Regla N.° 3 de `RULES.md`.
```
