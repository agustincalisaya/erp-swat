# Especificación Técnica — Módulo H (Gestión de Proveedores y Abastecimiento)
## ERP SWAT Indumentarias — Sprint 2
## Revisión 2 — Actualizado post-análisis de trazabilidad (Product Backlog Consolidado, Entrega 8, HU-H1 a HU-H8)

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod · Argon2id · JWT
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable) · `Documento de Alcance Funcional y Técnico` (sección Módulo H) · `Product Backlog — SWAT Indumentarias.xlsx` (Entrega 8, HU-H1 a HU-H8) · `schema.prisma` · `spec_modulo_D.md`

**Changelog de esta revisión (trazabilidad Backlog → Spec):**
| HU | Estado previo | Acción |
|---|---|---|
| HU-H6 — Consola de Auditoría Forense de Proveedores | Gap — solo se emitían los eventos, sin endpoint de consulta | Añadida sección 2.7 |
| HU-H7 — Vista comparativa de precios entre proveedores | Gap — listada como "fuera de alcance" | Añadida sección 2.8 |
| HU-H8 — Servicio de costo de reposición vigente | Gap — listada como "fuera de alcance" | Añadida sección 2.9 |
| Sección 5 (Fuera de Alcance) | Incluía HU-H7 y HU-H8 como diferidas | HU-H7 y HU-H8 retiradas de esa lista; permanecen únicamente los bloqueos de schema genuinos y las integraciones diferidas a otros módulos |

**Nota de conciliación de esquema (bloqueante — leer antes de programar):** el bloque `MÓDULO H: COMPRAS Y PROVEEDORES (SPRINT 2)` de `schema.prisma` ya define `Proveedor`, `EstadoProveedor`, `OrdenCompra`, `EstadoOrdenCompra`, `OrdenCompraItem`, `Recepcion`, `RecepcionItem`, `RecepcionDiscrepancia`, `TipoDiscrepancia` y `EvaluacionProveedor`. **No existe** en el schema actual un modelo `ListaPrecio` (ni `ListaPrecioVersion`, ni campo equivalente) pese a que HU-H2, HU-H6, HU-H7 y HU-H9 del Backlog y la sección 2.2/3.4/5.1 del Documento de Alcance lo exigen como entidad versionada e inmutable, ni existen en `Proveedor` los campos de datos bancarios que la Regla N.° 2 exige cifrar con AES-256. Este documento especifica el contrato funcional completo de H.2 (Listas de Precios) igualmente, dejando explícita en cada sección la migración de schema pendiente (`Faltante de schema`) que un agente de IA debe generar como *primer paso* antes de implementar los Route Handlers correspondientes. Ningún otro módulo debe verse afectado por esta migración: se trata de nuevos modelos y campos, no de alteraciones sobre entidades ya usadas por Módulo A, D o G.

**Alcance de esta revisión:** las secciones 2.7 a 2.9 incorporan HUs identificadas como brecha de trazabilidad respecto del Product Backlog Consolidado. Su numeración es aditiva; no se renumeran las secciones 2.1–2.6 ni 3.x preexistentes para preservar la estabilidad de referencias cruzadas en documentos ya generados. Las tres secciones nuevas heredan el mismo bloqueo de schema declarado para 2.3 (`ListaPrecio` / `ListaPrecioVersion` / `ListaPrecioItem` inexistentes), dado que las tres dependen de esa entidad para resolver "precio vigente".

---

## 1. Visión General

El Módulo H es la capa del ERP responsable del ciclo completo de abastecimiento de SWAT Indumentarias: homologación y evaluación de proveedores (H.1), administración de listas de precios versionadas (H.2), y emisión, seguimiento y recepción física de órdenes de compra (H.3). Es el único punto de origen de toda variación de costo de reposición que luego consumen el Módulo B (cálculo de margen en el POS) y el Módulo D (KPI de rentabilidad del Tablero de Comando).

Bajo Next.js App Router, el módulo se implementa mediante **Route Handlers** (`app/api/proveedores/**`, `app/api/ordenes-compra/**`) para las integraciones consumidas por otros módulos o clientes no-navegador, y **Server Actions** (`app/(dashboard)/compras/**/actions.ts`) para los formularios de gestión operados por Comprador, Supervisor de Compras y Personal de Depósito. Ambas superficies son wrappers finos: **está prohibido implementar lógica de negocio en el `route.ts` o en la Server Action**. Toda regla de dominio, toda validación de máquina de estados y toda escritura a base de datos se delega exclusivamente en la capa de servicios `lib/services/proveedores/*` (`proveedor.service.ts`, `lista-precios.service.ts`, `orden-compra.service.ts`, `recepcion.service.ts`, `evaluacion.service.ts`). El handler/action se limita a: (1) resolver la sesión y verificar el permiso granular vía `withPermission("proveedores:<accion>")`, (2) parsear y validar el `body` contra el schema Zod correspondiente, (3) invocar la función de servicio, (4) mapear el resultado o la excepción de negocio al shape de respuesta JSON estándar definido en la sección 2.

**Regla N.° 1 aplicada al Módulo H (prohibición absoluta de `DELETE`):** ninguna entidad del módulo —`Proveedor`, la futura `ListaPrecio`/`ListaPrecioVersion`, `OrdenCompra`, `OrdenCompraItem`, `Recepcion`, `RecepcionItem`, `RecepcionDiscrepancia`, `EvaluacionProveedor`— admite una sentencia `DELETE` desde el código de aplicación, bajo ninguna circunstancia ni ningún rol, incluyendo Administrador. Toda baja se implementa como `UPDATE` sobre los campos estándar `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`, conforme al patrón de Repositorio con Baja Lógica ya aplicado en los Módulos A y D. El schema refuerza esta restricción a nivel de integridad referencial: todas las relaciones salientes de las entidades de H usan `onDelete: Restrict` (ver `schema.prisma`, líneas 588–589, 629–630, 664–665, 693–694, 721, 766–767), de modo que ni siquiera un `DELETE` accidental sobre una entidad relacionada (`Usuario`, `VarianteSKU`) podría propagar un borrado en cascada hacia el historial de compras.

**Regla N.° 2 aplicada al Módulo H (cifrado AES-256 y trazabilidad inalterable):** los datos bancarios y de contacto del legajo comercial de un proveedor —alcanzados por la Ley N.° 25.326 cuando el proveedor es una persona física o unipersonal— se cifran en reposo con AES-256 mediante el módulo de cifrado dedicado ya existente (`lib/crypto/aes.ts`, mismo mecanismo aplicado en Módulo A/C), de forma completamente aislada del cálculo de hash SHA-256 de la cadena de auditoría: son dos mecanismos independientes que resuelven dos requisitos distintos (confidencialidad vs. integridad forense) y no deben mezclarse en la misma función ni en el mismo campo. Toda variación crítica de precio y todo cambio de estado de homologación se propagan de forma asíncrona hacia el Módulo D para su encadenamiento SHA-256 (ver sección 4). Toda consulta del legajo comercial completo de un proveedor por parte de un Auditor es en sí misma un evento auditable — no solo las escrituras.

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### Convenciones generales

- **Route Handlers** (`app/api/**/route.ts`): toda respuesta exitosa devuelve `NextResponse.json({ data, error: null }, { status })`; todo error de negocio devuelve `NextResponse.json({ data: null, error: { code, message } }, { status })`, con `status` semántico (`400` validación Zod, `404` entidad no encontrada, `409` conflicto de estado/unicidad, `422` regla de negocio violada sobre un payload sintácticamente válido).
- **Server Actions** (`"use server"`, ej. `app/(dashboard)/compras/**/actions.ts`): no retornan `NextResponse` — retornan el objeto plano `{ data, error: null }` o `{ data: null, error: { code, message } }`, con el mismo shape que su Route Handler equivalente, para que un mismo caso de uso de servicio sea consumible indistintamente desde un formulario server-rendered o desde un cliente API externo.
- Toda ruta requiere sesión autenticada y verificación de permiso granular (Módulo D, RBAC) vía middleware `withPermission("proveedores:<accion>")` u `withPermission("ordenes_compra:<accion>")`, conforme a la matriz de permisos de la sección 5 del Documento de Alcance (Supervisor de Compras, Comprador, Personal de Depósito, Auditor).
- Todo campo `*_id` recibido en un `body` se valida contra el formato `uuid` de Zod; ninguna validación de existencia real contra la base de datos ocurre en el schema Zod — eso es responsabilidad de la capa de servicios (ver sección 3).

### 2.1. Alta de Proveedor y carga de legajo comercial (HU-H1)

**Ruta:** `POST /app/api/proveedores/route.ts`
**Server Action equivalente:** `crearProveedor()` en `app/(dashboard)/compras/proveedores/actions.ts`
**Permiso requerido:** `proveedores:crear` (Comprador, Supervisor de Compras)

**Archivo de schemas:** `src/lib/schemas/proveedores.schema.ts`

```typescript
import { z } from "zod";

export const CrearProveedorSchema = z.object({
  razon_social: z.string().min(2, "La razón social es obligatoria"),
  nombre_fantasia: z.string().optional(),
  cuit: z
    .string()
    .regex(/^\d{2}-\d{8}-\d{1}$/, "El CUIT debe tener el formato NN-NNNNNNNN-N"),
  condiciones_pago: z.string().optional(),
  categorias: z.array(z.string().min(1)).min(1, "Debe indicar al menos una categoría de producto"),
  contacto_nombre: z.string().optional(),
  contacto_email: z.string().email("Email de contacto inválido").optional(),
  contacto_telefono: z.string().optional(),
  // --- Faltante de schema: datos bancarios cifrados AES-256 (Regla N.° 2 / Ley N.° 25.326) ---
  // El agente de IA debe primero migrar `Proveedor` agregando los campos
  // `datos_bancarios_cifrado` (String, ciphertext AES-256) y `datos_bancarios_iv`
  // (String, vector de inicialización), NUNCA un campo `cbu`/`alias_bancario` en
  // texto plano. El schema Zod de entrada modela el dato en claro; el servicio
  // es responsable exclusivo de cifrarlo antes de persistir (ver 3.3).
  datos_bancarios: z
    .object({
      cbu: z.string().length(22, "El CBU debe tener 22 dígitos"),
      alias: z.string().optional(),
      banco: z.string().min(1),
    })
    .optional(),
});
export type CrearProveedorInput = z.infer<typeof CrearProveedorSchema>;
```

**Comportamiento esperado:**
- Alta transaccional (`prisma.$transaction`) del `Proveedor` en estado inicial `PENDIENTE` (default del schema, `schema.prisma` línea 531) — **nunca** se crea directamente en `HOMOLOGADO`; la homologación es una transición explícita posterior (ver 2.2).
- Valida unicidad de `cuit` contra registros `is_active = true` — retorna `409 Conflict` en colisión (`Proveedor.cuit` es `@unique` a nivel de schema, por lo que la colisión también puede surgir como error de base de datos si dos requests concurrentes pasan la validación aplicativa; el servicio debe capturar el error de constraint de Prisma (`P2002`) y traducirlo al mismo shape `409`).
- Si se recibe `datos_bancarios`, el servicio lo cifra con AES-256 (`lib/crypto/aes.ts`) **antes** de construir el objeto de escritura a Prisma; el valor en claro no debe aparecer en ningún log, en ningún payload de evento de dominio, ni en la respuesta HTTP de éxito (ver 3.3).

**Respuesta `201 Created`:**
```json
{ "data": { "proveedor_id": "uuid", "estado": "PENDIENTE" }, "error": null }
```

**Respuesta `409 Conflict` (CUIT duplicado):**
```json
{ "data": null, "error": { "code": "CUIT_DUPLICADO", "message": "Ya existe un proveedor activo con el CUIT 30-12345678-9" } }
```

### 2.2. Homologar / suspender un Proveedor (HU-H1, HU-H5)

**Ruta:** `PATCH /app/api/proveedores/[id]/estado/route.ts`
**Server Action equivalente:** `cambiarEstadoProveedor()` en `app/(dashboard)/compras/proveedores/actions.ts`
**Permiso requerido:** `proveedores:homologar` (Supervisor de Compras directo; Comprador solo puede *solicitar*, sujeto a aprobación — la ruta valida el permiso, la UI de Comprador nunca invoca este endpoint directamente sino un endpoint de solicitud fuera de alcance de este documento).

```typescript
export const CambiarEstadoProveedorSchema = z.object({
  nuevo_estado: z.enum(["HOMOLOGADO", "SUSPENDIDO", "PENDIENTE"]),
  motivo: z
    .string()
    .min(1, "El motivo es obligatorio al suspender un proveedor")
    .optional(),
}).refine(
  (data) => data.nuevo_estado !== "SUSPENDIDO" || (data.motivo && data.motivo.length > 0),
  { message: "El motivo es obligatorio al transicionar a SUSPENDIDO", path: ["motivo"] }
);
export type CambiarEstadoProveedorInput = z.infer<typeof CambiarEstadoProveedorSchema>;
```

**Comportamiento esperado:**
- Transición manual entre los tres valores de `EstadoProveedor` (`schema.prisma` línea 553). La transición automática a `SUSPENDIDO` por caída del puntaje de evaluación por debajo del umbral mínimo **no** pasa por esta ruta — es disparada internamente por `evaluacion.service.ts` tras persistir una nueva `EvaluacionProveedor` (ver 2.4 y 3.2).
- Toda transición de/hacia `HOMOLOGADO` o hacia `SUSPENDIDO` es un evento crítico: genera de forma asíncrona el evento `proveedor:estado_cambiado` hacia el Módulo D para su encadenamiento SHA-256 (sección 4).
- La suspensión bloquea la selección del proveedor en nuevas `OrdenCompra` (validado en 2.5) pero **no** afecta órdenes ya `CONFIRMADA` en curso — esa validación vive exclusivamente en la capa de servicios, nunca a nivel de constraint de base de datos.

**Respuesta `200 OK`:**
```json
{ "data": { "proveedor_id": "uuid", "estado_anterior": "HOMOLOGADO", "estado_nuevo": "SUSPENDIDO" }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (transición inválida):**
```json
{ "data": null, "error": { "code": "TRANSICION_INVALIDA", "message": "Un proveedor PENDIENTE no puede transicionar directamente a SUSPENDIDO" } }
```

### 2.3. Publicación de una nueva versión de Lista de Precios (HU-H2, HU-H6, HU-H9)

**Ruta:** `POST /app/api/proveedores/[id]/lista-precios/route.ts`
**Server Action equivalente:** `publicarListaPrecios()` en `app/(dashboard)/compras/listas-precios/actions.ts`
**Permiso requerido:** `proveedores:publicar_lista` dentro del umbral normal (Comprador, Supervisor de Compras); `proveedores:publicar_lista_critica` por encima del umbral (Supervisor de Compras directo; Comprador solo *solicita*).

**Faltante de schema (bloqueante):** esta sección requiere que el agente de IA agregue a `schema.prisma`, como paso previo a cualquier implementación de código:
- `model ListaPrecio` — cabecera lógica de la lista de un proveedor (1:N con `ListaPrecioVersion`), con `proveedor_id`, bloque estándar de baja lógica y timestamps.
- `model ListaPrecioVersion` — cada versión inmutable: `lista_precio_id`, `fecha_inicio_vigencia` (`DateTime`), `variacion_porcentual_maxima` (`Decimal`, calculada contra la versión anterior en el momento de creación, no recalculada después), `requiere_aprobacion` (`Boolean`), `aprobada_por_id` (`String?`, `onDelete: Restrict` hacia `Usuario`), `publicada` (`Boolean`, `false` mientras está pendiente de aprobación), bloque estándar de baja lógica y timestamps.
- `model ListaPrecioItem` — línea de ítem por `ListaPrecioVersion`: `variante_sku_id` (`onDelete: Restrict` hacia `VarianteSKU`), `precio_unitario` (`Decimal @db.Decimal(10, 2)`).
- Un campo `variacion_umbral_critico` (`Decimal`, parametrizable por Dirección) debe vivir en una entidad de configuración global — **no** hardcodeado en el servicio; si el Módulo D no expone aún dicha entidad de configuración en Sprint 2, se declara explícitamente como dependencia bloqueante en la sección 6.

```typescript
export const PublicarListaPreciosSchema = z.object({
  fecha_inicio_vigencia: z.coerce.date().refine(
    (d) => d >= new Date(new Date().toDateString()),
    "La fecha de vigencia no puede ser anterior al día de hoy"
  ),
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        precio_unitario: z.number().positive("El precio unitario debe ser mayor a 0"),
      })
    )
    .min(1, "La lista debe incluir al menos un ítem"),
});
export type PublicarListaPreciosInput = z.infer<typeof PublicarListaPreciosSchema>;
```

**Comportamiento esperado:**
- **Inmutabilidad estricta (ver 3.4):** esta operación **nunca** ejecuta un `UPDATE` sobre una `ListaPrecioVersion` existente. Siempre inserta una `ListaPrecioVersion` nueva con sus `ListaPrecioItem` asociados, dentro de la misma `prisma.$transaction`.
- El servicio calcula, por cada `variante_sku_id` recibida, la variación porcentual contra el `precio_unitario` de la versión previamente vigente para ese proveedor y esa variante (si existe). El máximo de esas variaciones porcentuales se persiste en `variacion_porcentual_maxima`.
- Si `variacion_porcentual_maxima` supera el umbral parametrizado por Dirección: `publicada = false`, `requiere_aprobacion = true`, la versión queda creada pero **no habilitada** para su uso en nuevas `OrdenCompra` hasta que un Supervisor de Compras la apruebe explícitamente vía un endpoint de aprobación (`PATCH /app/api/proveedores/[id]/lista-precios/[version_id]/aprobar/route.ts`, mismo patrón de la sección 2.2, fuera del detalle de este documento por brevedad pero sujeto a las mismas reglas transaccionales y de evento crítico).
- Si no supera el umbral: `publicada = true` inmediatamente, sin paso de aprobación.
- Solo puede existir una `ListaPrecioVersion` con `publicada = true` y sin `fecha_inicio_vigencia` futura por proveedor en un momento dado — la resolución de "versión vigente" es una consulta (`fecha_inicio_vigencia <= now()` ordenada `desc`, `take(1)`), nunca un flag mutable tipo `es_vigente` que deba reescribirse en cada publicación (evitar condiciones de carrera entre publicaciones concurrentes).
- Toda publicación cuya `variacion_porcentual_maxima` supere el umbral crítico genera, tras el `COMMIT` de la transacción, el evento `proveedor:variacion_precio_critica` hacia el Módulo D (sección 4).

**Respuesta `201 Created` (dentro del umbral, publicación inmediata):**
```json
{ "data": { "lista_precio_version_id": "uuid", "publicada": true, "requiere_aprobacion": false }, "error": null }
```

**Respuesta `201 Created` (supera umbral, pendiente de aprobación):**
```json
{ "data": { "lista_precio_version_id": "uuid", "publicada": false, "requiere_aprobacion": true, "variacion_porcentual_maxima": 23.5 }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (proveedor no homologado):**
```json
{ "data": null, "error": { "code": "PROVEEDOR_NO_HOMOLOGADO", "message": "Solo proveedores en estado HOMOLOGADO pueden publicar listas de precios" } }
```

### 2.4. Emisión de Orden de Compra (HU-H3)

**Ruta:** `POST /app/api/ordenes-compra/route.ts`
**Server Action equivalente:** `crearOrdenCompra()` en `app/(dashboard)/compras/ordenes/actions.ts`
**Permiso requerido:** `ordenes_compra:crear` (Comprador, Supervisor de Compras)

```typescript
export const CrearOrdenCompraSchema = z.object({
  proveedor_id: z.string().uuid(),
  observaciones: z.string().optional(),
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        cantidad_solicitada: z.number().int().positive("La cantidad debe ser mayor a 0"),
      })
    )
    .min(1, "La orden debe incluir al menos un ítem"),
});
export type CrearOrdenCompraInput = z.infer<typeof CrearOrdenCompraSchema>;
```

**Comportamiento esperado:**
- Precondición obligatoria: `Proveedor.estado === "HOMOLOGADO"` y `is_active = true`. En caso contrario, `422` con `code: "PROVEEDOR_NO_HOMOLOGADO"` antes de tocar la base de datos.
- El servicio resuelve la `ListaPrecioVersion` vigente del proveedor (misma consulta descripta en 2.3) y toma de ahí el `precio_unitario` de cada `variante_sku_id` solicitada — **el cliente nunca envía el precio**; enviarlo sería una superficie de manipulación de costos. Si alguna `variante_sku_id` no tiene precio en la lista vigente, `422` con `code: "SKU_SIN_PRECIO_VIGENTE"`.
- Creación transaccional (`prisma.$transaction`) de `OrdenCompra` (estado inicial `BORRADOR`, default de schema) junto con sus N `OrdenCompraItem`, cada uno con el `precio_unitario` resuelto de la lista vigente en ese instante — este valor queda congelado en el ítem y **no** se recalcula si la lista cambia después (regla de no-retroactividad, ver 3.4).
- `numero_orden` se genera server-side de forma determinística y única (`@unique` en schema) — el cliente no lo provee.

**Respuesta `201 Created`:**
```json
{ "data": { "orden_compra_id": "uuid", "numero_orden": "OC-2026-000842", "estado": "BORRADOR" }, "error": null }
```

### 2.5. Transición de estado de Orden de Compra (envío, confirmación, cierre, cancelación)

**Ruta:** `PATCH /app/api/ordenes-compra/[id]/estado/route.ts`
**Server Action equivalente:** `cambiarEstadoOrdenCompra()` en `app/(dashboard)/compras/ordenes/actions.ts`
**Permiso requerido:** `ordenes_compra:enviar` (aprobación de Borrador → Enviada, exclusivo Supervisor de Compras), `ordenes_compra:confirmar`, `ordenes_compra:cerrar`, `ordenes_compra:cancelar` — permisos granulares independientes, no un único `ordenes_compra:administrar`.

```typescript
export const CambiarEstadoOrdenCompraSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("ENVIAR") }),
  z.object({
    accion: z.literal("CONFIRMAR"),
    fecha_entrega_comprometida: z.coerce.date(),
  }),
  z.object({ accion: z.literal("CERRAR") }),
  z.object({
    accion: z.literal("CANCELAR"),
    deletion_reason: z.string().min(1, "El motivo de cancelación es obligatorio"),
  }),
]);
export type CambiarEstadoOrdenCompraInput = z.infer<typeof CambiarEstadoOrdenCompraSchema>;
```

**Comportamiento esperado:** ver máquina de estados completa en la sección 3.1. Puntos de contrato relevantes:
- `ENVIAR` (Borrador → Enviada): a partir de este punto, `OrdenCompraItem` queda bloqueado para edición de cantidades — el servicio rechaza con `409` cualquier intento de mutar ítems de una orden en estado distinto de `BORRADOR`.
- `CANCELAR` es baja lógica: setea `is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason` (reutilizando el `deletion_reason` recibido) **y** `estado = "CANCELADA"` en la misma transacción. La orden permanece consultable — nunca desaparece de los reportes de trazabilidad de negociación.
- `CERRAR` solo es válida desde `RECIBIDA_COMPLETA`, tras conciliación contra factura (fuera de alcance de código en este documento — es un checkbox/flag operativo que el Comprador marca manualmente, no una integración automática con un sistema de facturación).

**Respuesta `409 Conflict` (transición inválida):**
```json
{ "data": null, "error": { "code": "TRANSICION_INVALIDA", "message": "No es posible ENVIAR una orden en estado RECIBIDA_COMPLETA" } }
```

### 2.6. Registrar Recepción física de mercadería (HU-H4)

**Ruta:** `POST /app/api/ordenes-compra/[id]/recepciones/route.ts`
**Server Action equivalente:** `registrarRecepcion()` en `app/(dashboard)/deposito/recepciones/actions.ts`
**Permiso requerido:** `recepciones:registrar` (Personal de Depósito directo; Supervisor de Compras solo *solicita*)

```typescript
export const RegistrarRecepcionSchema = z.object({
  numero_remito_proveedor: z.string().optional(),
  observaciones: z.string().optional(),
  items: z
    .array(
      z.object({
        orden_compra_item_id: z.string().uuid(),
        cantidad_recibida: z.number().int().nonnegative(),
        discrepancias: z
          .array(
            z.object({
              tipo: z.enum(["CANTIDAD", "TALLE", "COLOR", "CALIDAD"]),
              detalle: z.string().min(1, "El detalle de la discrepancia es obligatorio"),
            })
          )
          .optional(),
      })
    )
    .min(1, "La recepción debe incluir al menos un ítem"),
});
export type RegistrarRecepcionInput = z.infer<typeof RegistrarRecepcionSchema>;
```

**Comportamiento esperado:**
- Precondición: `OrdenCompra.estado` debe estar en `CONFIRMADA` o `RECEPCION_PARCIAL`. En cualquier otro estado, `409` con `code: "ORDEN_NO_RECEPCIONABLE"`.
- Cada `orden_compra_item_id` recibido se valida contra el saldo pendiente real: `cantidad_solicitada - SUM(cantidad_recibida de RecepcionItem previos no dados de baja para ese ítem)`. Si `cantidad_recibida` excede ese saldo, `422` con `code: "CANTIDAD_EXCEDE_SALDO_PENDIENTE"` — nunca se acepta silenciosamente un exceso ni se trunca.
- Transacción atómica (`prisma.$transaction`) que, en un único paso: (1) crea `Recepcion`, (2) crea N `RecepcionItem`, (3) crea las `RecepcionDiscrepancia` asociadas si las hubiera, (4) recalcula el saldo pendiente total de la `OrdenCompra` y actualiza su `estado` a `RECEPCION_PARCIAL` (saldo > 0 tras esta recepción) o `RECIBIDA_COMPLETA` (saldo = 0).
- **Tras el `COMMIT`** (nunca dentro de la transacción de Prisma — ver 3.5), se emite el evento `stock:recepcion_confirmada` hacia el Módulo A para el alta de stock disponible (sección 4). El Módulo H no escribe directamente sobre `StockDeposito` ni `MovimientoStock`: esa responsabilidad es exclusiva del Módulo A, que consume el evento.

**Respuesta `201 Created`:**
```json
{ "data": { "recepcion_id": "uuid", "orden_compra_estado": "RECEPCION_PARCIAL", "saldo_pendiente_total": 12 }, "error": null }
```

**Respuesta `422 Unprocessable Entity`:**
```json
{ "data": null, "error": { "code": "CANTIDAD_EXCEDE_SALDO_PENDIENTE", "message": "El ítem admite un máximo de 8 unidades pendientes; se recibieron 12" } }
```

### 2.7. Consola de Auditoría Forense de Proveedores (HU-H6)

**Contexto de trazabilidad:** el Product Backlog Consolidado exige que el Auditor pueda "consultar el historial de variaciones críticas de precios y cambios de homologación de proveedores con verificación SHA-256", con filtro por proveedor, rango de fechas, tipo de evento y usuario responsable. La sección 4 de este documento ya define la emisión de `proveedor:estado_cambiado` y `proveedor:variacion_precio_critica` hacia el `AuditLog` del Módulo D, pero hasta esta revisión no existía el endpoint de lectura correspondiente. Esta sección lo formaliza.

**Ruta:** `GET /app/api/proveedores/auditoria/route.ts`
**Permiso requerido:** `auditoria:leer_historico` sobre el dominio `proveedores` (exclusivo Auditor, conforme matriz RBAC del Documento de Alcance § Módulo H, sección 5 — Supervisor de Compras conserva `✓` para el historial comercial general de la sección 2.8, pero el log de auditoría forense es de acceso exclusivo del Auditor).

**Principio de diseño no negociable:** este endpoint **no** recalcula ni reimplementa el encadenamiento SHA-256. El Módulo H no es propietario del `AuditLog` ni de la lógica de verificación de cadena — ambos son responsabilidad exclusiva del Módulo D (Regla N.° 3 de `RULES.md`, aislamiento de dominio). Este Route Handler es una consulta de conveniencia con **filtro pre-aplicado por dominio** (`modulo_origen = "H"` o equivalente en el schema del `AuditLog`) que delega la resolución de integridad de cadena a la capa de servicios del Módulo D (`lib/services/auditoria/verificacion-cadena.service.ts`, ya definida en `spec_modulo_D.md`) — no ejecuta su propio cálculo de hash.

```typescript
// lib/schemas/proveedores.schema.ts
export const ConsultarAuditoriaProveedoresQuerySchema = z.object({
  proveedor_id: z.string().uuid().optional(),
  tipo_evento: z.enum([
    "proveedor:estado_cambiado",
    "proveedor:variacion_precio_critica",
    "proveedor:legajo_bancario_consultado",
  ]).optional(),
  usuario_id: z.string().uuid().optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  verificar_integridad: z.coerce.boolean().default(false),
  // Si true, el servicio invoca la verificación de cadena del Módulo D sobre
  // el subconjunto de resultados devuelto — operación más costosa, opt-in
  // explícito del cliente, nunca ejecutada por defecto en cada listado.
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(50).default(20),
});
export type ConsultarAuditoriaProveedoresQuery = z.infer<typeof ConsultarAuditoriaProveedoresQuerySchema>;
```

**Comportamiento esperado:**
- Consulta de solo lectura sobre `AuditLog` (Módulo D), filtrada por los `tipo_evento` propios de este módulo (ver enum arriba, alineado 1:1 con la tabla de eventos de la sección 4) — el Route Handler de Módulo H invoca una función expuesta por la capa de servicios del Módulo D (`listarEventosPorDominio(dominio: "proveedores", filtros)`), no accede a la tabla `AuditLog` mediante un `prisma.auditLog.findMany` propio, para no duplicar la capa de acceso a datos de una entidad que no pertenece a este módulo.
- Si `verificar_integridad = true`, el servicio invoca adicionalmente `verificarCadenaHash()` del Módulo D sobre el rango de registros devuelto y expone en la respuesta el resultado (`integra: boolean`, `punto_ruptura_id?: string`) — mismo contrato de verificación que HU-A6/HU-D4, reutilizado sin reimplementación.
- Los registros son append-only por herencia del `AuditLog` — este endpoint no expone, ni indirectamente, ninguna operación de edición o borrado sobre los eventos consultados.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "items": [
      {
        "audit_log_id": "uuid",
        "tipo_evento": "proveedor:variacion_precio_critica",
        "proveedor_id": "uuid",
        "usuario_id": "uuid",
        "valor_anterior": { "precio_unitario_referencia": 4500.00 },
        "valor_nuevo": { "precio_unitario_referencia": 5550.00 },
        "hash_actual": "a1b2c3...",
        "created_at": "2026-08-25T14:20:00.000Z"
      }
    ],
    "paginacion": { "total": 47, "pagina_actual": 1, "total_paginas": 3, "por_pagina": 20 },
    "verificacion_integridad": null
  },
  "error": null
}
```

**Respuesta `200 OK` (con `verificar_integridad = true` y cadena íntegra):**
```json
{
  "data": {
    "items": [ "..." ],
    "paginacion": { "total": 47, "pagina_actual": 1, "total_paginas": 3, "por_pagina": 20 },
    "verificacion_integridad": { "integra": true, "punto_ruptura_id": null }
  },
  "error": null
}
```

---

### 2.8. Vista comparativa de precios entre proveedores (HU-H7)

**Contexto de trazabilidad:** el Backlog exige, para un mismo insumo (SKU o categoría), una comparación entre proveedores que incluya precio unitario vigente, fecha de vigencia, puntaje de evaluación y **tiempo de entrega comprometido histórico**. Esta HU comparte el mismo bloqueo de schema que 2.3 (`ListaPrecioVersion`/`ListaPrecioItem` inexistentes) y adicionalmente requiere una métrica derivada no persistida (tiempo de entrega histórico) que se define a continuación de forma explícita para eliminar cualquier ambigüedad de cálculo.

**Ruta:** `GET /app/api/proveedores/comparativa-precios/route.ts`
**Server Action equivalente:** ninguna — este es un caso de uso de consulta pura, consumido directamente vía Route Handler desde el cliente (patrón ya establecido para vistas de solo lectura de alto volumen de filtros, ver sección 2.6 de `spec_modulo_A.md`).
**Permiso requerido:** `proveedores:comparar_precios` (Comprador y Supervisor de Compras, `✓` directo conforme matriz RBAC del Documento de Alcance § Módulo H, sección 5 — "Consultar el historial de precios y órdenes de un proveedor").

```typescript
export const ComparativaPreciosQuerySchema = z.object({
  variante_sku_id: z.string().uuid().optional(),
  categoria: z.string().min(1).optional(),
}).refine(
  (d) => d.variante_sku_id !== undefined || d.categoria !== undefined,
  { message: "Debe indicarse variante_sku_id o categoria", path: ["variante_sku_id"] }
);
export type ComparativaPreciosQuery = z.infer<typeof ComparativaPreciosQuerySchema>;
```

**Definición determinística de "tiempo de entrega comprometido histórico" (sin ambigüedad de cálculo):** se define como el promedio, en días corridos, de `(Recepcion.fecha_recepcion de la recepción que llevó la OrdenCompra a RECIBIDA_COMPLETA) − (OrdenCompra.fecha_confirmacion)`, calculado sobre el universo de `OrdenCompra` del proveedor con `estado ∈ { RECIBIDA_COMPLETA, CERRADA }` y `is_active = true`, sin límite de ventana temporal salvo que el equipo defina explícitamente un recorte (ej. "últimos 12 meses") como parámetro de configuración — de no existir esa definición, el cálculo es sobre el historial completo. Esta métrica se calcula **on-demand** en el momento de la consulta (agregación SQL vía Prisma `groupBy`/`aggregate`), nunca se persiste ni se cachea, consistente con el principio de "nunca una copia cacheada desactualizada" que HU-H8 (2.9) exige de forma explícita para el costo de reposición y que este documento extiende por coherencia a toda métrica derivada de este módulo.

**Comportamiento esperado:**
1. Resuelve el conjunto de proveedores candidatos: si se recibe `variante_sku_id`, todos los `Proveedor` con `estado = "HOMOLOGADO"` que tengan un `ListaPrecioItem` para esa variante en su `ListaPrecioVersion` vigente (misma consulta de "versión vigente" de 2.3/3.4); si se recibe `categoria`, todos los `Proveedor` homologados cuyo array `categorias` (`schema.prisma` línea 530) contenga ese valor, restringido además a los que tengan al menos un ítem vigente en esa categoría.
2. Para cada proveedor candidato, agrega en una única fila de respuesta: `precio_unitario` (de la lista vigente), `fecha_inicio_vigencia` de esa versión, `puntaje_total` de la `EvaluacionProveedor` más reciente (`fecha_evaluacion desc`, `take(1)`), y `tiempo_entrega_promedio_dias` (definición del párrafo anterior).
3. Proveedores homologados sin evaluación previa exponen `puntaje_total: null` — el frontend es responsable de representar la ausencia de dato, el servicio **no** debe sustituir por `0` (un `0` sería indistinguible de una evaluación real de puntaje mínimo).
4. La respuesta se ordena por `precio_unitario` ascendente por defecto (criterio de "mayor conveniencia económica" del backlog), sin paginación explícita — el universo de proveedores homologados por insumo es acotado por diseño de negocio (no se espera un volumen que requiera paginación; si en producción se detecta lo contrario, es una revisión posterior de este contrato, no una asunción a resolver ahora).

**Respuesta `200 OK`:**
```json
{
  "data": {
    "variante_sku_id": "uuid",
    "proveedores": [
      {
        "proveedor_id": "uuid",
        "razon_social": "Textiles del Norte S.A.",
        "precio_unitario": 4500.00,
        "fecha_inicio_vigencia": "2026-08-01T00:00:00.000Z",
        "puntaje_total": 87.5,
        "tiempo_entrega_promedio_dias": 12.4
      },
      {
        "proveedor_id": "uuid",
        "razon_social": "Confecciones Salta SRL",
        "precio_unitario": 4720.00,
        "fecha_inicio_vigencia": "2026-07-15T00:00:00.000Z",
        "puntaje_total": null,
        "tiempo_entrega_promedio_dias": null
      }
    ]
  },
  "error": null
}
```

**Respuesta `422 Unprocessable Entity` (ningún proveedor homologado para el criterio):**
```json
{ "data": null, "error": { "code": "SIN_PROVEEDORES_COMPARABLES", "message": "No hay proveedores homologados con precio vigente para el criterio indicado" } }
```

---

### 2.9. Servicio de costo de reposición vigente (HU-H8)

**Contexto de trazabilidad:** este endpoint es un servicio **interno de integración**, consumido de forma síncrona por el Módulo B en el momento de confirmar una venta (cálculo de margen) y por el Módulo D para el KPI de rentabilidad del Tablero de Comando. No tiene Server Action equivalente ni formulario de UI propio del Módulo H — es exclusivamente un Route Handler de contrato API interno.

**Ruta:** `GET /app/api/proveedores/costo-reposicion/[variante_sku_id]/route.ts`
**Permiso requerido:** `proveedores:leer_costo_reposicion`, otorgado como permiso de servicio-a-servicio a los llamadores autorizados (Módulo B, Módulo D), no expuesto en ningún menú de navegación de usuario final — la sesión que invoca este endpoint es la del usuario que dispara la operación de venta o de refresco del Tablero de Comando, no un usuario del Módulo H.

```typescript
export const CostoReposicionParamsSchema = z.object({
  variante_sku_id: z.string().uuid(),
});
export type CostoReposicionParams = z.infer<typeof CostoReposicionParamsSchema>;
```

**Regla de resolución de proveedor (desempate — sin ambigüedad):**
1. Se resuelve el conjunto de `Proveedor` con `estado = "HOMOLOGADO"`, `is_active = true`, que tengan un `ListaPrecioItem` para `variante_sku_id` en su `ListaPrecioVersion` vigente (misma consulta de "versión vigente" de 2.3/3.4, evaluada `on-demand`, nunca cacheada — criterio de aceptación explícito del Backlog).
2. Si existe un `proveedor_preferente_id` configurado explícitamente para esa `VarianteSKU` (**faltante de schema adicional**: no existe hoy un campo `proveedor_preferente_id` en `VarianteSKU` ni tabla de configuración equivalente — debe agregarse como parte de la misma migración de 2.3 si se requiere soportar esta preferencia; hasta que exista, el sistema se comporta como si ningún producto tuviera proveedor preferente configurado) y ese proveedor está en el conjunto resuelto en el paso 1, se retorna su precio sin más evaluación.
3. En ausencia de proveedor preferente aplicable, se retorna el `precio_unitario` **mínimo** entre los proveedores candidatos del paso 1 (regla explícita del Backlog: "expone el costo del proveedor de menor precio vigente, salvo configuración explícita de proveedor preferente").
4. Si el conjunto de candidatos del paso 1 está vacío (ninguna variante tiene proveedor homologado con precio vigente), `404` con `code: "SIN_COSTO_REPOSICION_DISPONIBLE"` — el Módulo B debe manejar explícitamente esta ausencia (por ejemplo, impidiendo el cálculo de margen o marcándolo como "no disponible"), nunca asumir un costo `0` ni un valor por defecto silencioso.

**Prohibición explícita de cacheo (cumplimiento literal del criterio de aceptación):** ninguna capa de este endpoint —Route Handler, capa de servicios, ni infraestructura (Redis, memoria de proceso, `revalidate` de Next.js)— debe cachear el resultado de este cálculo más allá de la duración de una única request. El criterio de aceptación de HU-H8 es explícito: "nunca a una copia cacheada desactualizada". Un cambio de `ListaPrecioVersion` (HU-H2) debe reflejarse en la siguiente consulta a este endpoint sin ningún mecanismo de invalidación intermedio que gestionar — la ausencia de caché es la estrategia de invalidación. Esta restricción debe quedar explícita en el docstring de la función de servicio correspondiente para prevenir que una futura optimización de performance introduzca cacheo sin revisar este documento.

**Comportamiento esperado:**
- Operación de **solo lectura**, sin `$transaction` (no escribe ninguna tabla).
- No emite evento de dominio propio — es una consulta pura sin efecto sobre el estado del sistema.
- El Módulo B, al confirmar una venta, invoca este endpoint de forma síncrona antes de calcular el margen; una falla de este endpoint (`404` o error 5xx) es responsabilidad del Módulo B decidir cómo se propaga a la UX de venta — fuera de alcance de este documento.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "variante_sku_id": "uuid",
    "proveedor_id": "uuid",
    "precio_unitario": 4500.00,
    "fecha_inicio_vigencia": "2026-08-01T00:00:00.000Z",
    "criterio_seleccion": "MENOR_PRECIO_VIGENTE"
  },
  "error": null
}
```
*(`criterio_seleccion` es `"MENOR_PRECIO_VIGENTE"` o `"PROVEEDOR_PREFERENTE"`, expuesto explícitamente para que el Módulo D pueda auditar en el Tablero de Comando por qué se seleccionó ese proveedor y no otro, sin tener que inferirlo comparando contra el resto de la cartera.)*

**Respuesta `404 Not Found`:**
```json
{ "data": null, "error": { "code": "SIN_COSTO_REPOSICION_DISPONIBLE", "message": "Ninguna VarianteSKU con proveedor homologado y precio vigente para este SKU" } }
```

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. Máquina de estados de `OrdenCompra`

Transiciones válidas — cualquier transición no listada debe rechazarse con `409 TRANSICION_INVALIDA` desde `orden-compra.service.ts`, **nunca** confiar en el `default` del enum de Prisma como única defensa:

| Estado origen | Transición | Estado destino | Precondición |
|---|---|---|---|
| — | Alta (2.4) | `BORRADOR` | Proveedor `HOMOLOGADO`; todos los ítems con precio vigente resuelto |
| `BORRADOR` | `ENVIAR` (2.5) | `ENVIADA` | Requiere permiso de Supervisor de Compras; congela edición de ítems |
| `ENVIADA` | `CONFIRMAR` (2.5) | `CONFIRMADA` | Requiere `fecha_entrega_comprometida` |
| `CONFIRMADA` | Recepción parcial (2.6) | `RECEPCION_PARCIAL` | Saldo pendiente > 0 tras la recepción |
| `RECEPCION_PARCIAL` | Recepción parcial (2.6) | `RECEPCION_PARCIAL` | Saldo pendiente > 0 tras la recepción (permanece en el mismo estado) |
| `RECEPCION_PARCIAL` | Recepción final (2.6) | `RECIBIDA_COMPLETA` | Saldo pendiente = 0 tras la recepción |
| `CONFIRMADA` | Recepción total en un solo paso (2.6) | `RECIBIDA_COMPLETA` | Saldo pendiente = 0 tras la recepción |
| `RECIBIDA_COMPLETA` | `CERRAR` (2.5) | `CERRADA` | Conciliación contra factura confirmada por el Comprador |
| `BORRADOR` / `ENVIADA` | `CANCELAR` (2.5) | `CANCELADA` | `deletion_reason` obligatorio; es baja lógica, no elimina la fila |

`CERRADA` y `CANCELADA` son estados terminales: ninguna transición sale de ellos. El servicio debe validar el estado origen leído dentro de la misma transacción que realiza el `UPDATE` (usar `prisma.$transaction` con lectura + escritura en el mismo bloque, no una lectura previa fuera de la transacción) para evitar condiciones de carrera entre dos requests concurrentes sobre la misma orden.

### 3.2. Recalculo incremental del puntaje de evaluación de Proveedor

Conforme a HU-H5 y a la sección 3.1 del Documento de Alcance, el puntaje de un `Proveedor` **no** se recalcula en un job batch nocturno: `evaluacion.service.ts` recalcula de forma incremental el agregado ponderado (`puntaje_cumplimiento_plazos`, `puntaje_calidad_recepcion`, `puntaje_documentacion` → `puntaje_total`) inmediatamente después de que se persiste cada `EvaluacionProveedor` nueva (disparada por una `Recepcion` o por una devolución por defecto de fabricación coordinada con el Módulo I). Si el `puntaje_total` resultante cae por debajo del umbral mínimo de homologación parametrizado, el mismo servicio ejecuta, dentro de la transacción que crea la `EvaluacionProveedor`, la transición automática `Proveedor.estado = "SUSPENDIDO"` — sin pasar por el endpoint manual de 2.2 — y encola el mismo evento `proveedor:estado_cambiado` que dispara ese endpoint (payload debe incluir `origen: "AUTOMATICO"` para distinguirlo en el log de auditoría de una suspensión manual).

### 3.3. Cifrado AES-256 aislado para datos bancarios del legajo de Proveedor

- El cifrado/descifrado de `datos_bancarios` vive exclusivamente en `lib/crypto/aes.ts` (módulo ya existente, reutilizado — no se crea una segunda implementación de cifrado para el Módulo H).
- La capa de servicios (`proveedor.service.ts`) es la única autorizada a invocar `encrypt()`/`decrypt()` sobre este campo. Ningún Route Handler, Server Action ni componente de UI cifra o descifra directamente.
- El valor descifrado **nunca** se incluye en: logs de aplicación, payloads de eventos de dominio (sección 4), ni en la respuesta JSON de ningún endpoint salvo el de consulta explícita del legajo bancario por un rol autorizado (fuera de detalle de este documento — endpoint de solo lectura protegido por permiso `proveedores:leer_datos_bancarios`).
- Toda consulta exitosa de `datos_bancarios` descifrados por un Auditor genera, tras resolverse, el evento `proveedor:legajo_bancario_consultado` hacia el Módulo D (sección 4) — el acceso de lectura a un dato cifrado es en sí mismo un evento auditable, igual que en Módulo C.
- Ninguna corrección de `datos_bancarios` se implementa como `UPDATE` directo sobre el campo cifrado existente: se trata como una nueva versión auditada del legajo (mismo principio de no-sobrescritura aplicado a `ListaPrecioVersion` en 3.4), preservando el valor cifrado anterior accesible para reconstrucción forense.

### 3.4. Inmutabilidad estricta de `ListaPrecioVersion` (versionado continuo)

- Ninguna actualización de precio ejecuta `UPDATE` sobre una `ListaPrecioVersion` o `ListaPrecioItem` ya persistidos. Toda modificación de precios —incluida la corrección de un error de tipeo— crea una `ListaPrecioVersion` nueva con nueva `fecha_inicio_vigencia`.
- `OrdenCompraItem.precio_unitario` congela, en el momento de creación de la orden (2.4), el precio de la versión vigente en ese instante. Una publicación posterior de una nueva `ListaPrecioVersion` **no** debe, bajo ninguna implementación, disparar un `UPDATE` sobre `OrdenCompraItem.precio_unitario` de órdenes ya emitidas — verificar explícitamente que ningún trigger, listener de eventos ni job recorra órdenes existentes al publicarse una lista nueva.
- La resolución de "versión vigente" de un proveedor es siempre una consulta derivada (`publicada = true AND fecha_inicio_vigencia <= now()`, ordenada `desc`, `take(1)`) evaluada en el momento de la consulta — nunca un puntero cacheado o un flag `es_vigente` persistido que deba mantenerse sincronizado manualmente entre publicaciones.
- **Extensión de esta revisión (2.8, 2.9):** esta misma consulta derivada es la fuente de verdad única reutilizada por HU-H7 (comparativa de precios) y HU-H8 (costo de reposición). Ninguna de las dos secciones nuevas implementa su propia lógica de resolución de "versión vigente" — ambas invocan la misma función de servicio (`resolverListaPrecioVigente(proveedor_id, variante_sku_id?)`) que ya sirve a 2.3 y 2.4, evitando divergencia de criterio entre los cuatro puntos de consumo.

### 3.5. Transacciones atómicas y separación estricta escritura/evento

- Toda operación de escritura multi-tabla de este módulo (alta de proveedor, publicación de lista, alta de orden, transición de estado, registro de recepción) se ejecuta dentro de un único `prisma.$transaction`. Ninguna escritura parcial debe quedar visible si una validación intermedia falla.
- Los eventos de dominio de la sección 4 se emiten **después** del `COMMIT` exitoso de la transacción, nunca dentro de ella — replicando el patrón fire-and-forget vía `domainEventBus.emit` ya usado en Módulo D (`spec_modulo_D.md`, hallazgo documentado sobre `crearUsuario`). El agente de IA debe evaluar si ese patrón fire-and-forget (con el riesgo de pérdida de evento ante caída del proceso entre el `COMMIT` y el `emit`) es aceptable para este módulo o si Módulo H debe adoptar un outbox transaccional; si no hay decisión explícita del equipo al respecto, implementar el mismo patrón que Módulo D por consistencia, y documentarlo como deuda técnica conocida en el PR, no como decisión silenciosa.
- Las secciones 2.7, 2.8 y 2.9 son de **solo lectura** y quedan explícitamente excluidas de esta regla: no ejecutan `$transaction` ni emiten eventos de dominio (ver nota de cada sección).

### 3.6. Restricción de borrado físico y patrón de baja lógica

- Todas las relaciones de Prisma salientes de las entidades del Módulo H usan `onDelete: Restrict` (ya presente en `schema.prisma`): un intento de eliminar físicamente un `Usuario`, una `VarianteSKU` o cualquier entidad referenciada por una fila de compras falla a nivel de base de datos antes de poder romper el historial de abastecimiento.
- Ninguna función de servicio del Módulo H expone o invoca `prisma.<modelo>.delete()` ni `deleteMany()`, bajo ninguna condición — incluyendo rutas de "deshacer" o rollback manual de un alta errónea, que deben resolverse siempre como una baja lógica adicional (`is_active = false`, `deletion_reason: "Alta errónea — corrección"`), nunca como un borrado real.
- Toda consulta operativa por defecto (listados, selects para formularios, resolución de "proveedor homologado seleccionable") filtra `is_active = true`. Los reportes de auditoría y de costos históricos (HU-H6, HU-H9) son la única excepción explícita — deben poder ver proveedores y listas dados de baja para reconstrucción forense.

---

## 4. Eventos de Dominio (EDA)

**Archivo:** `src/lib/events/event-types.ts` (extiende la tabla ya definida en `spec_modulo_D.md` §5)

El Módulo H es **emisor** hacia el Módulo D (encadenamiento SHA-256) y hacia el Módulo A (alta de stock). No consume eventos propios para su lógica central en el alcance de este documento — la única entrada externa relevante (evaluación de calidad por devoluciones de fabricación del Módulo I) queda fuera de alcance porque el Módulo I no existe aún en este sprint (ver sección 5).

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `proveedor:estado_cambiado` | 2.2 (manual) y 3.2 (automático) | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, usuario_id \| null (null si origen automático), estado_anterior, estado_nuevo, origen: "MANUAL" \| "AUTOMATICO", motivo }` |
| `proveedor:variacion_precio_critica` | 2.3 | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, lista_precio_version_id, usuario_id, variacion_porcentual_maxima, requiere_aprobacion, valor_anterior, valor_nuevo }` — `valor_anterior`/`valor_nuevo` referencian los `precio_unitario` agregados de la variante con mayor variación, no la lista completa |
| `proveedor:legajo_bancario_consultado` | 3.3 | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, usuario_id, rol: "AUDITOR" }` — sin incluir el dato bancario en ningún caso |
| `stock:recepcion_confirmada` | 2.6, tras `COMMIT` | Módulo A (listener de alta de stock, `lib/events/listeners/stock-recepcion.listener.ts`) | `{ recepcion_id, orden_compra_id, proveedor_id, items: [{ variante_sku_id, cantidad_recibida }], deposito_destino_id, recibida_por_id }` |

**Sin eventos nuevos en esta revisión:** las secciones 2.7 (consulta de auditoría), 2.8 (comparativa de precios) y 2.9 (costo de reposición) son operaciones de solo lectura y no agregan filas a esta tabla — 2.7 consume eventos ya existentes (no los emite), y 2.8/2.9 son cálculos on-demand sin persistencia ni notificación de cambio de estado. Esto es consistente con 3.5.

**Regla de exclusión de datos sensibles en el payload (misma convención que `spec_modulo_D.md` §5.1):** ningún evento de este módulo incluye en su payload el valor en claro de `datos_bancarios`, ni `password`/`password_hash` de `Usuario`. El emisor (capa de servicios del Módulo H) es responsable de excluir estos campos antes de publicar al bus; `audit-log.listener.ts` no realiza sanitización adicional sobre eventos entrantes.

**Nota sobre `deposito_destino_id` en `stock:recepcion_confirmada`:** el schema actual de `Recepcion` (`schema.prisma` líneas 646–671) no incluye un campo de depósito destino explícito. Si el Módulo A requiere ese dato para resolver a qué `Deposito` dar de alta el stock recibido, es un **faltante de schema adicional** a resolver junto con el owner del Módulo A antes de implementar este evento — no asumir un depósito por defecto en el código sin esa definición explícita.

---

## 5. Fuera de Alcance (diferido / bloqueado)

- **Modelos `ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem`:** no existen aún en `schema.prisma`. Su migración es prerrequisito bloqueante de las secciones 2.3, 2.4, 2.8 y 2.9, y debe generarse y revisarse como paso separado, no como parte del mismo PR que implementa los Route Handlers.
- **Campos de datos bancarios cifrados en `Proveedor`:** no existen aún en `schema.prisma` (`datos_bancarios_cifrado`, `datos_bancarios_iv`). Prerrequisito bloqueante de 2.1 y 3.3.
- **Campo `proveedor_preferente_id` (o tabla de configuración equivalente) para el desempate de HU-H8 (2.9):** no existe aún en `schema.prisma`. Hasta su definición, el servicio de costo de reposición opera siempre bajo el criterio de menor precio vigente (paso 3 de 2.9), sin excepción por preferencia — esto es un comportamiento válido y documentado, no un bloqueo total de 2.9: la sección es implementable hoy mismo con el criterio de desempate simplificado.
- **Entidad de configuración global para `variacion_umbral_critico` y umbral mínimo de homologación:** este documento asume que existe o existirá una tabla de configuración parametrizable por Dirección (posiblemente en Módulo D). Si no existe al momento de implementar, es una dependencia bloqueante a resolver con el owner de Módulo D — no hardcodear el umbral como constante en `lista-precios.service.ts`.
- **Endpoint de aprobación de `ListaPrecioVersion` pendiente (`.../lista-precios/[version_id]/aprobar`):** mencionado en 2.3 pero no detallado en este documento; se especifica como documento independiente o adenda cuando se resuelva el modelo de datos de 2.3.
- **Integración con Módulo I (devoluciones por defecto de fabricación como insumo de `EvaluacionProveedor`):** el Módulo I no existe en este sprint. `EvaluacionProveedor.devoluciones_fabricacion` (`schema.prisma` línea 750) es nullable y se carga manualmente por ahora, conforme al comentario ya presente en el schema.
- **Conciliación automática contra factura del proveedor (paso previo a `CERRAR`, sección 2.5):** este documento la modela como un flag operativo manual confirmado por el Comprador. Una integración real con comprobantes fiscales (AFIP, vía Módulo G conforme a `RULES.md` Regla N.° 3) queda fuera de alcance.
- **Recorte de ventana temporal configurable para `tiempo_entrega_promedio_dias` (HU-H7, sección 2.8):** este documento define el cálculo sobre el historial completo del proveedor a falta de una definición explícita de ventana (ej. "últimos 12 meses"). Si Dirección define un recorte, es un ajuste de un único parámetro en `lista-precios.service.ts` (o el servicio que se determine sea propietario de esta métrica), no un cambio de contrato de la sección 2.8.
