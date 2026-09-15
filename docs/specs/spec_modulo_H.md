# Especificación Técnica — Módulo H (Gestión de Proveedores y Abastecimiento)
## ERP SWAT Indumentarias — Sprint 2 + Sprint 3
## Revisión 6 — Unificación de `spec_modulo_H.md` (Sprint 2) y `spec_modulo_H_diferido.md` en un único documento

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod · Argon2id · JWT
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable) · `Documento de Alcance Funcional y Técnico` (sección Módulo H) · `Product Backlog — SWAT Indumentarias.xlsx` (hojas **Sprint 2** y **Sprint 3**, no la hoja "Product Backlog Consolidado") · `schema.prisma` · `spec_modulo_D.md`

---

## ⚠️ Por qué este documento vuelve a ser uno solo

Este documento y `spec_modulo_H_diferido.md` fueron un único archivo hasta la Revisión 3, se separaron en la Revisión 4/5 porque HU-H2/H6/H7/H8 quedaron fuera de Sprint 2, y se **vuelven a unificar en esta Revisión 6** porque esas cuatro HU ya están planificadas en la hoja `Sprint 3` del Product Backlog. La separación cumplió su propósito (evitar que el equipo de Sprint 2 implementara contenido no priorizado) y ya no aplica: mantenerla habría significado dos documentos "vigentes" a la vez, con el riesgo de que alguien implemente contra el que no corresponde.

**Contenido de este documento, ahora completo:**
- **HU-H1** — Alta de Proveedor y homologación (secciones 2.1, 2.2) — Sprint 2
- **HU-H3** — Emisión de Orden de Compra y seguimiento de estado (secciones 2.4, 2.5) — Sprint 2
- **HU-H4** — Registro de Recepción física (sección 2.6) — Sprint 2
- **HU-H5** — Evaluación de proveedores, recálculo incremental de puntaje (sección 3.2) — Sprint 2
- **HU-H9** — Registro del Comprobante fiscal de Proveedor asociado a una OC (sección 2.7) — Sprint 2
- **HU-H2** — Publicación de Lista de Precios versionada (sección 2.3) — **Sprint 3**
- **HU-H6** — Consola de Auditoría Forense de Proveedores (sección 2.7-bis, renombrada 2.10 para no chocar con HU-H9) — **Sprint 3**
- **HU-H7** — Vista comparativa de precios entre proveedores (sección 2.11) — **Sprint 3**
- **HU-H8** — Servicio de costo de reposición vigente (sección 2.12) — **Sprint 3**

**Nota de renumeración:** el documento diferido original numeraba HU-H6/H7/H8 como 2.7/2.8/2.9, chocando con la HU-H9 de este documento (también 2.7, agregada en la Revisión 5 del documento de Sprint 2, posterior a la separación). Se renumeran a **2.10, 2.11, 2.12** para evitar colisión; todas las referencias cruzadas internas de este documento ya reflejan la numeración nueva. Si algún documento externo del proyecto (Casos de Prueba, DER) cita "sección 2.7" para HU-H6, actualizar esa referencia a 2.10.

**Nota sobre la migración de schema ya aplicada:** los modelos `ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem` y los campos `Proveedor.datos_bancarios_cifrado`/`datos_bancarios_iv` ya existen en `schema.prisma` (migración `20260831050501_add_lista_precio_and_proveedor_bank_data`), aditiva, sin `DROP` ni `ALTER` sobre columnas/tablas preexistentes. Los dos pendientes reales de esa migración —default de `ListaPrecioVersion.publicada` y cardinalidad `ListaPrecio`↔`Proveedor`— se detallan en la sección 2.3 y en la sección 5 de este documento unificado.

**Acción de código para el equipo de Sprint 3, antes de implementar HU-H2:** con la unificación de este documento, la advertencia bloqueante de la sección 2.4 (HU-H3, "Camino A/B") queda resuelta — HU-H2 ya no es una HU diferida sin fecha, es la primera HU planificada de este sprint. Retirar el seed temporal del Camino A cuando HU-H2 tenga su endpoint de publicación operativo, y migrar HU-H3 a resolver el precio contra `ListaPrecioVersion` real (ver nota de actualización en 2.4).

---

## 1. Visión General

El Módulo H es la capa del ERP responsable del ciclo completo de abastecimiento de SWAT Indumentarias: homologación de proveedores (H.1), emisión, seguimiento y recepción física de órdenes de compra (H.3/H.4), evaluación incremental de desempeño del proveedor (H.5), registro formal del comprobante fiscal que el proveedor envía contra una OC ya recibida (H.9), y — desde esta revisión — el ciclo completo de listas de precios versionadas y sus consumidores derivados: publicación (H.2), auditoría forense de variaciones y homologación (H.6), comparación de precios entre proveedores (H.7) y exposición del costo de reposición vigente (H.8).

El subcomponente H.2 (Listas de Precios) es el único punto de origen de toda variación de costo de reposición que luego consumen el Módulo B (cálculo de margen en el POS, todavía no construido) y el Módulo D (KPI de rentabilidad del Tablero de Comando, ya existente desde Sprint 1). HU-H6, HU-H7 y HU-H8 son, en distinta medida, consumidores derivados de H.2: H6 audita sus variaciones críticas, H7 compara precios entre proveedores usando el mismo mecanismo de "versión vigente", y H8 expone el costo de reposición resultante a otros módulos. Las cuatro comparten la misma dependencia de fondo — sin `ListaPrecioVersion` con contenido publicado, ninguna es funcionalmente completable —, razón por la que conviene secuenciarlas dentro del sprint con H2 primero (ver nota de coordinación de equipo del Sprint 3).

Bajo Next.js App Router, el módulo se implementa mediante **Route Handlers** (`app/api/proveedores/**`, `app/api/ordenes-compra/**`) para las integraciones consumidas por otros módulos o clientes no-navegador, y **Server Actions** (`app/(dashboard)/compras/**/actions.ts`) para los formularios de gestión operados por Comprador, Supervisor de Compras y Personal de Depósito. Ambas superficies son wrappers finos: **está prohibido implementar lógica de negocio en el `route.ts` o en la Server Action**. Toda regla de dominio, toda validación de máquina de estados y toda escritura a base de datos se delega exclusivamente en la capa de servicios `lib/services/proveedores/*` (`proveedor.service.ts`, `orden-compra.service.ts`, `recepcion.service.ts`, `evaluacion.service.ts`, y — nuevo en esta revisión — `lista-precios.service.ts`). El handler/action se limita a: (1) resolver la sesión y verificar el permiso granular vía `withPermission("proveedores:<accion>")`, (2) parsear y validar el `body` contra el schema Zod correspondiente, (3) invocar la función de servicio, (4) mapear el resultado o la excepción de negocio al shape de respuesta JSON estándar definido en la sección 2.

**Regla N.° 1 aplicada al Módulo H (prohibición absoluta de `DELETE`):** ninguna entidad del módulo —`Proveedor`, `OrdenCompra`, `OrdenCompraItem`, `Recepcion`, `RecepcionItem`, `RecepcionDiscrepancia`, `EvaluacionProveedor`, `ComprobanteProveedor`, `ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem`— admite una sentencia `DELETE` desde el código de aplicación, bajo ninguna circunstancia ni ningún rol, incluyendo Administrador. Toda baja se implementa como `UPDATE` sobre los campos estándar `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`, conforme al patrón de Repositorio con Baja Lógica ya aplicado en los Módulos A y D. El schema refuerza esta restricción a nivel de integridad referencial: todas las relaciones salientes de las entidades de H usan `onDelete: Restrict`, de modo que ni siquiera un `DELETE` accidental sobre una entidad relacionada (`Usuario`, `VarianteSKU`) podría propagar un borrado en cascada hacia el historial de compras o de precios.

**Regla N.° 2 aplicada al Módulo H (cifrado AES-256 y trazabilidad inalterable):** los datos bancarios y de contacto del legajo comercial de un proveedor —alcanzados por la Ley N.° 25.326 cuando el proveedor es una persona física o unipersonal— se cifran en reposo con AES-256 mediante el módulo de cifrado dedicado ya existente (`lib/crypto/aes.ts`, mismo mecanismo aplicado en Módulo A/C), de forma completamente aislada del cálculo de hash SHA-256 de la cadena de auditoría. Todo cambio de estado de homologación y toda variación crítica de precio se propaga de forma asíncrona hacia el Módulo D para su encadenamiento SHA-256 (sección 4).

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### Convenciones generales

- **Route Handlers** (`app/api/**/route.ts`): toda respuesta exitosa devuelve `NextResponse.json({ data, error: null }, { status })`; todo error de negocio devuelve `NextResponse.json({ data: null, error: { code, message } }, { status })`, con `status` semántico (`400` validación Zod, `404` entidad no encontrada, `409` conflicto de estado/unicidad, `422` regla de negocio violada sobre un payload sintácticamente válido).
- **Server Actions** (`"use server"`, ej. `app/(dashboard)/compras/**/actions.ts`): no retornan `NextResponse` — retornan el objeto plano `{ data, error: null }` o `{ data: null, error: { code, message } }`, con el mismo shape que su Route Handler equivalente, para que un mismo caso de uso de servicio sea consumible indistintamente desde un formulario server-rendered o desde un cliente API externo.
- Toda ruta requiere sesión autenticada y verificación de permiso granular (Módulo D, RBAC) vía middleware `withPermission("proveedores:<accion>")` u `withPermission("ordenes_compra:<accion>")`, conforme a la matriz de permisos de la sección 5 del Documento de Alcance (Supervisor de Compras, Comprador, Personal de Depósito, Auditor).
- Todo campo `*_id` recibido en un `body` se valida contra el formato `uuid` de Zod; ninguna validación de existencia real contra la base de datos ocurre en el schema Zod — eso es responsabilidad de la capa de servicios (ver sección 3).

### 2.1. Alta de Proveedor y carga de legajo comercial (HU-H1) — Sprint 2

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
  // --- Cifrado AES-256 (Regla N.° 2 / Ley N.° 25.326) — schema ya migrado ---
  // `Proveedor.datos_bancarios_cifrado` (String?, ciphertext AES-256) y
  // `Proveedor.datos_bancarios_iv` (String?, vector de inicialización) ya
  // existen en schema.prisma (migración 20260831050501). El schema Zod de
  // entrada sigue modelando el dato en claro: el servicio es responsable
  // exclusivo de cifrarlo antes de persistir (ver 3.3); en ningún punto de
  // este documento el dato en claro debe llegar a `prisma.proveedor.create`.
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
- Alta transaccional (`prisma.$transaction`) del `Proveedor` en estado inicial `PENDIENTE` (default del schema) — **nunca** se crea directamente en `HOMOLOGADO`; la homologación es una transición explícita posterior (ver 2.2).
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

### 2.2. Homologar / suspender un Proveedor (HU-H1, HU-H5) — Sprint 2

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
- Transición manual entre los tres valores de `EstadoProveedor`. La transición automática a `SUSPENDIDO` por caída del puntaje de evaluación por debajo del umbral mínimo **no** pasa por esta ruta — es disparada internamente por `evaluacion.service.ts` tras persistir una nueva `EvaluacionProveedor` (ver 3.2).
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

### 2.3. Publicación de una nueva versión de Lista de Precios (HU-H2) — **Sprint 3**

**Ruta:** `POST /app/api/proveedores/[id]/lista-precios/route.ts`
**Server Action equivalente:** `publicarListaPrecios()` en `app/(dashboard)/compras/listas-precios/actions.ts`
**Permiso requerido:** `proveedores:publicar_lista` dentro del umbral normal (Comprador, Supervisor de Compras); `proveedores:publicar_lista_critica` por encima del umbral (Supervisor de Compras directo; Comprador solo *solicita*).

**Schema ya migrado (migración `20260831050501_add_lista_precio_and_proveedor_bank_data`):** `model ListaPrecio` (cabecera lógica 1:N con `ListaPrecioVersion`, `proveedor_id`, bloque estándar de baja lógica y timestamps, `@@index([proveedor_id])`), `model ListaPrecioVersion` (`lista_precio_id`, `fecha_inicio_vigencia`, `variacion_porcentual_maxima`, `requiere_aprobacion`, `aprobada_por_id`, `aprobada_at`, `publicada`, bloque estándar de baja lógica y timestamps, `@@index([lista_precio_id, publicada, fecha_inicio_vigencia])`) y `model ListaPrecioItem` (`lista_precio_version_id`, `variante_sku_id`, `precio_unitario Decimal @db.Decimal(10, 2)`, `@@index([variante_sku_id])`) existen en `schema.prisma`.

**⚠️ Acción pendiente antes de implementar esta sección:** el campo `ListaPrecioVersion.publicada` fue migrado con `@default(true)`. El contrato funcional exige el comportamiento inverso: toda versión debe nacer con `publicada` resuelto explícitamente por la capa de servicios en el mismo `$transaction` que la crea (`true` si no supera el umbral, `false` si lo supera), nunca por un default de columna — un default `true` es fail-unsafe. Corregir con `ALTER TABLE listas_precio_version ALTER COLUMN publicada SET DEFAULT false` (migración aditiva, sin pérdida de datos) **antes** de implementar el servicio de esta sección. Verificar el estado real de esta corrección al iniciar Sprint 3 — puede haberse aplicado ya como tarea de mantenimiento independiente.

**Pendiente de confirmación de cardinalidad (no bloqueante para implementar, sí para cerrar el modelo de datos):** `ListaPrecio` fue migrado **sin** `@@unique([proveedor_id])` — el Documento de Alcance no es explícito sobre si un proveedor puede tener más de una `ListaPrecio` cabecera (ej. una por categoría de producto) o exactamente una. Mientras no se confirme, la consulta de "versión vigente" (ver 3.4) sigue funcionando correctamente porque resuelve mediante `take(1)` ordenado, pero la cardinalidad 1:1 asumida implícitamente en el resto de esta sección (y en 2.11, 2.12, que hablan de "la lista de precios del proveedor" en singular) depende de disciplina de la capa de servicios, no de un constraint de base de datos. Si el equipo confirma 1:1, aplicar `ALTER TABLE listas_precio ADD CONSTRAINT ... UNIQUE (proveedor_id)` como migración aditiva adicional.

**Faltante de configuración global (bloqueante, distinto de lo anterior):** un campo `variacion_umbral_critico` (`Decimal`, parametrizable por Dirección) debe vivir en una entidad de configuración global — **no** hardcodeado en el servicio. Si el Módulo D no expone aún dicha entidad de configuración, se declara explícitamente como dependencia bloqueante en la sección 5.

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
- Si `variacion_porcentual_maxima` supera el umbral parametrizado por Dirección: `publicada = false`, `requiere_aprobacion = true`, la versión queda creada pero **no habilitada** para su uso en nuevas `OrdenCompra` hasta que un Supervisor de Compras la apruebe explícitamente vía un endpoint de aprobación (`PATCH /app/api/proveedores/[id]/lista-precios/[version_id]/aprobar/route.ts`, mismo patrón de homologación de proveedor de la sección 2.2, fuera del detalle de este documento por brevedad pero sujeto a las mismas reglas transaccionales y de evento crítico).
- Si no supera el umbral: `publicada = true` inmediatamente, sin paso de aprobación.
- Solo puede existir una `ListaPrecioVersion` con `publicada = true` y sin `fecha_inicio_vigencia` futura por proveedor en un momento dado — la resolución de "versión vigente" es una consulta (`fecha_inicio_vigencia <= now()` ordenada `desc`, `take(1)`), nunca un flag mutable tipo `es_vigente` que deba reescribirse en cada publicación (evitar condiciones de carrera entre publicaciones concurrentes).
- Toda publicación cuya `variacion_porcentual_maxima` supere el umbral crítico genera, tras el `COMMIT` de la transacción, el evento `proveedor:variacion_precio_critica` hacia el Módulo D (sección 4).
- **Migrar HU-H3 (sección 2.4) al implementar esta sección:** retirar el seed temporal del "Camino A" y reemplazar el mecanismo de resolución de precio por este endpoint como fuente real de `ListaPrecioVersion` — ver nota de actualización en 2.4.

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

### 2.4. Emisión de Orden de Compra (HU-H3) — Sprint 2

**Ruta:** `POST /app/api/ordenes-compra/route.ts`
**Server Action equivalente:** `crearOrdenCompra()` en `app/(dashboard)/compras/ordenes/actions.ts`
**Permiso requerido:** `ordenes_compra:crear` (Comprador, Supervisor de Compras)

**Nota de actualización (Sprint 3, al implementar HU-H2 — sección 2.3):** esta sección fue implementada originalmente en Sprint 2 bajo el **Camino A** (seed temporal de `ListaPrecioVersion`, ver Revisión 5 de este documento), dado que HU-H2 estaba diferida en ese momento. Con HU-H2 ya planificada en Sprint 3, el equipo debe: (1) confirmar si el seed temporal ya fue retirado, (2) verificar que la resolución de precio de esta sección invoca `resolverListaPrecioVigente(proveedor_id, variante_sku_id?)` (función única definida en 3.4, no una consulta propia), y (3) actualizar esta nota una vez migrado. El contrato Zod y el comportamiento esperado descriptos abajo no cambian — solo cambia el origen de los datos de `ListaPrecioVersion` contra los que resuelven.

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
- El servicio resuelve la `ListaPrecioVersion` vigente del proveedor (`publicada = true AND fecha_inicio_vigencia <= now()`, ordenada `desc`, `take(1)`, vía `resolverListaPrecioVigente()` — ver 3.4) y toma de ahí el `precio_unitario` de cada `variante_sku_id` solicitada — **el cliente nunca envía el precio**; enviarlo sería una superficie de manipulación de costos. Si alguna `variante_sku_id` no tiene precio en la lista vigente, `422` con `code: "SKU_SIN_PRECIO_VIGENTE"`.
- Creación transaccional (`prisma.$transaction`) de `OrdenCompra` (estado inicial `BORRADOR`, default de schema) junto con sus N `OrdenCompraItem`, cada uno con el `precio_unitario` resuelto de la lista vigente en ese instante — este valor queda congelado en el ítem y **no** se recalcula si la lista cambia después.
- `numero_orden` se genera server-side de forma determinística y única (`@unique` en schema) — el cliente no lo provee.

**Respuesta `201 Created`:**
```json
{ "data": { "orden_compra_id": "uuid", "numero_orden": "OC-2026-000842", "estado": "BORRADOR" }, "error": null }
```

### 2.5. Transición de estado de Orden de Compra (envío, confirmación, cierre, cancelación) — Sprint 2

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

### 2.6. Registrar Recepción física de mercadería (HU-H4) — Sprint 2

**Alcance vigente:** HU-H4 V2.1 modela una recepción perfecta, completa y única. El flujo operativo es `CONFIRMADA` → visualizar materiales → seleccionar depósito destino → confirmar recepción → ingresar stock → `RECIBIDA_COMPLETA`.

**Pantalla:** `GET /compras/recepciones/nueva`
**Ruta de escritura:** `POST /api/ordenes-compra/[id]/recepciones`
**Servicios:** `listarOrdenesRecepcionables()` y `registrarRecepcion()` en `src/lib/services/proveedores/recepcion.service.ts`
**Permiso requerido:** `recepciones:registrar` (`ADMINISTRADOR` y `ENCARGADO_DEPOSITO`). Este permiso protege la entrada específica de H4 y no reemplaza ni amplía `ordenes_compra:leer`, perteneciente a H3.

**Listado server-side:** la pantalla presenta una tabla de OC con estado `CONFIRMADA`, activas, no eliminadas y con al menos un `OrdenCompraItem` activo y no eliminado. Cada fila puede desplegar producto, SKU y cantidad solicitada; la única decisión operativa es seleccionar el depósito destino y confirmar.

- Admite los query params opcionales `proveedor_id`, `fecha_emision`, `page` y `orden_compra_id` para la apertura inicial de una OC alcanzable por el listado.
- `proveedor_id` filtra por identificador. El selector ofrece únicamente proveedores que tienen al menos una OC recepcionable, sin ampliar permisos ni modificar H1.
- `fecha_emision` se valida como fecha calendario y se aplica mediante un rango de día completo (`>= inicio`, `< inicio del día siguiente`), no mediante coincidencia parcial de texto.
- `page` debe ser un entero mayor o igual a 1 y vale 1 por defecto. Los filtros se aplican antes del conteo y de la paginación; `take` nunca supera 10 y `skip = (page - 1) * pageSize`.
- El servicio devuelve `{ ordenes, total, page, pageSize, totalPages }`; el `count` usa los mismos filtros sin limitar los resultados. Una página superior al total se normaliza a la última válida y la ruta redirige conservando los filtros.
- El orden es estable: `fecha_emision DESC`, con `numero_orden DESC` como desempate. Los filtros se conservan al paginar y cualquier cambio de filtro vuelve a la página 1.
- Si no hay resultados, se informa «No hay órdenes confirmadas que coincidan con los filtros.» en lugar de mostrar una tabla vacía. El frontend también deshabilita la confirmación si, por defensa, recibe una OC sin ítems.

```typescript
export const RegistrarRecepcionSchema = z.object({
  deposito_destino_id: z.string().uuid(),
  clave_idempotencia: z.string().uuid(),
}).strict();
export type RegistrarRecepcionInput = z.infer<typeof RegistrarRecepcionSchema>;
```

**Comportamiento esperado:**
- La OC debe estar activa, no eliminada y exactamente en `CONFIRMADA`. Cualquier otro estado, incluido el legado histórico `RECEPCION_PARCIAL`, responde `409 ORDEN_NO_RECEPCIONABLE`; por lo tanto, una segunda recepción operativa queda rechazada.
- La OC debe contener al menos un `OrdenCompraItem` activo y no eliminado. El listado excluye órdenes sin líneas recepcionables y `registrarRecepcion()` conserva la defensa adicional `ORDEN_SIN_ITEMS_RECEPCIONABLES`.
- El cliente no envía ítems, cantidades, discrepancias, remito ni observaciones; el schema estricto rechaza esos campos legacy. El backend es la fuente de verdad e incluye todas las líneas activas, sin permitir omitirlas ni agregar líneas ajenas.
- Para cada línea, el backend deriva `cantidad_recibida = cantidad_aceptada = cantidad_solicitada`. No existen cantidades pendientes, diferidas o acumuladas en el flujo vigente.
- Las nuevas recepciones no crean `RecepcionDiscrepancia`; `numero_remito_proveedor` y `observaciones` quedan `null`. Los modelos, campos y datos históricos se conservan sin reutilizarlos para nuevas recepciones.
- La transacción con aislamiento `Serializable` crea una única `Recepcion`, sus `RecepcionItem`, un único ingreso mediante `registrarIngresoStockTx()` y cambia la OC de `CONFIRMADA` a `RECIBIDA_COMPLETA` mediante un `updateMany` condicionado. Los conflictos serializables `P2034` se reintentan y solo una confirmación concurrente puede persistir.
- El stock se incrementa exclusivamente por las cantidades aceptadas, que en V2.1 equivalen a las solicitadas. La trazabilidad queda `MovimientoStock` → `Recepcion` → `OrdenCompra` → `Proveedor`.
- La idempotencia usa `clave_idempotencia` única y el SHA-256 de la intención canónica `{ orden_compra_id, deposito_destino_id }`. Un retry idéntico devuelve la recepción existente sin duplicar recepción, stock, movimiento, transición de OC, auditoría ni evaluación H5; reutilizar la clave con otra intención se rechaza.
- Tras el `COMMIT` se emiten `recepcion:registrada` e `inventario:ingreso_stock_registrado`; luego se invoca una sola vez `registrarEvaluacionDesdeRecepcion(recepcionId, usuarioId)` de HU-H5.

**Integraciones preservadas:**
- **H3:** H4 produce `CONFIRMADA` → `RECIBIDA_COMPLETA`; H3 conserva `RECIBIDA_COMPLETA` → `CERRADA` y el permiso separado `ordenes_compra:leer`.
- **H5:** conserva una evaluación por `Recepcion` y su contrato actual; H4 no modifica el modelo ni el servicio de evaluación.
- **G8:** H4 no crea ni consolida directamente `CuentaPorPagar`. G8 actúa cuando H3 lleva la OC a `CERRADA`.
- **H9:** `RECIBIDA_COMPLETA` y `CERRADA` continúan siendo estados compatibles con el flujo de comprobantes; H4 no modifica H9.
- **Inventario:** H4 reutiliza el núcleo transaccional público existente; no modifica `movimiento.service.ts`.

**Persistencia y fixtures:** HU-H4 V2.1 no requiere cambios en `prisma/schema.prisma` ni en `prisma/migrations/**`. Los campos y estados históricos permanecen por compatibilidad. `prisma/seed.ts` vigente en `develop` es la fuente de verdad y no se modifica; sus IDs compartidos se preservan.

**Respuesta `201 Created`:**
```json
{ "data": { "recepcion_id": "uuid", "estado_orden_compra": "RECIBIDA_COMPLETA", "movimiento_stock_id": "uuid", "idempotente": false, "evaluacion_proveedor": "REGISTRADA" }, "error": null }
```

**Respuesta `409 Conflict` para una segunda recepción operativa:**
```json
{ "data": null, "error": { "code": "ORDEN_NO_RECEPCIONABLE", "message": "La orden OC-2026-0001 no admite recepciones en estado RECIBIDA_COMPLETA" } }
```

### 2.7. Registro de Comprobante de Proveedor (HU-H9) — Sprint 2

**⚠️ Alcance — no confundir con integración AFIP:** esta sección especifica la **carga manual** por el Comprador del comprobante fiscal (Factura A/B/C/M) que el proveedor envía en papel/PDF fuera del sistema, como constancia documental de respaldo previo al pago. **No** es facturación electrónica, no consulta el padrón de AFIP ni emite comprobantes: es un registro administrativo (ver sección 5).

**Ruta (alta):** `POST /app/api/ordenes-compra/[id]/comprobantes/route.ts`
**Ruta (listado por OC):** `GET /app/api/ordenes-compra/[id]/comprobantes/route.ts`
**Ruta (listado global, insumo de HU-G10/Tesorería):** `GET /app/api/comprobantes-proveedor/route.ts`
**Ruta (anulación):** `PATCH /app/api/comprobantes-proveedor/[id]/anular/route.ts`
**Server Action equivalente:** `registrarComprobanteProveedor()` / `anularComprobanteProveedor()` / `listarComprobantesProveedor()` en `app/(dashboard)/compras/comprobantes/actions.ts`
**Permiso requerido:** `comprobantes_proveedor:crear` y `comprobantes_proveedor:leer` (Comprador, Supervisor de Compras); `comprobantes_proveedor:anular` (exclusivo Supervisor de Compras).

**Archivo de schemas:** `src/lib/schemas/comprobantes-proveedor.schema.ts`

```typescript
import { z } from "zod";

export const TIPOS_COMPROBANTE = [
  "FACTURA_A",
  "FACTURA_B",
  "FACTURA_C",
  "FACTURA_M",
] as const;

export const RegistrarComprobanteProveedorSchema = z.object({
  orden_compra_id: z.string().uuid(),
  tipo: z.enum(TIPOS_COMPROBANTE),
  numero_comprobante: z.string().min(1, "El número de comprobante es obligatorio"),
  fecha_emision: z.coerce.date(),
  monto_total: z.coerce
    .number()
    .positive("El monto total debe ser mayor a 0"),
  archivo_adjunto_url: z.string().url("La URL del archivo adjunto es inválida").optional(),
});
export type RegistrarComprobanteProveedorInput = z.infer<typeof RegistrarComprobanteProveedorSchema>;

export const AnularComprobanteProveedorSchema = z.object({
  deletion_reason: z.string().min(1, "El motivo de anulación es obligatorio"),
});
export type AnularComprobanteProveedorInput = z.infer<typeof AnularComprobanteProveedorSchema>;
```

**Comportamiento esperado:**
- Precondición de estado: `OrdenCompra.estado` debe ser `RECIBIDA_COMPLETA` o `CERRADA` y `OrdenCompra.is_active = true`. En cualquier otro estado — incluida `CANCELADA` — `409 Conflict` con `code: "ORDEN_NO_RECEPCIONADA"`.
- `proveedor_id` se resuelve siempre server-side a partir de `orden_compra.proveedor_id` — nunca se recibe en el `body` ni se confía en un valor de cliente.
- No se valida `Proveedor.estado === "HOMOLOGADO"` en esta operación: una suspensión posterior del proveedor no debe bloquear la carga de su documentación pendiente.
- Unicidad: no se admite `numero_comprobante` + `tipo` + `proveedor_id` duplicado entre comprobantes `is_active = true`.
- Alta transaccional (`prisma.$transaction`, 3.4) del `ComprobanteProveedor`; el evento `comprobante_proveedor:registrado` se emite recién después del `COMMIT`.
- **Inmutabilidad estricta:** no existe ningún endpoint `PATCH`/`PUT` de edición de campos sobre un `ComprobanteProveedor` ya creado. La única mutación posible post-alta es la anulación por baja lógica.
- El listado (`GET`) filtra por defecto `is_active = true`, salvo que quien consulta sea Auditor.

**Respuesta `201 Created`:**
```json
{ "data": { "comprobante_id": "uuid", "orden_compra_id": "uuid", "proveedor_id": "uuid", "tipo": "FACTURA_A", "numero_comprobante": "0001-00012345" }, "error": null }
```

**Respuesta `409 Conflict` (OC en estado no admitido):**
```json
{ "data": null, "error": { "code": "ORDEN_NO_RECEPCIONADA", "message": "La Orden de Compra OC-2026-000842 debe estar RECIBIDA_COMPLETA o CERRADA para admitir la carga de un comprobante; estado actual: CONFIRMADA" } }
```

**Respuesta `409 Conflict` (comprobante duplicado):**
```json
{ "data": null, "error": { "code": "COMPROBANTE_DUPLICADO", "message": "Ya existe un comprobante FACTURA_A N.° 0001-00012345 activo para este proveedor" } }
```

#### 2.7.1. Modelo de datos — `ComprobanteProveedor`

```prisma
model ComprobanteProveedor {
  id                  String           @id @default(uuid())
  orden_compra_id     String
  proveedor_id        String
  tipo                TipoComprobante
  numero_comprobante  String
  fecha_emision       DateTime
  monto_total         Decimal          @db.Decimal(12, 2)
  archivo_adjunto_url String?
  registrado_por_id   String

  is_active       Boolean   @default(true)
  deleted_at      DateTime?
  deleted_by      String?
  deletion_reason String?

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  orden_compra   OrdenCompra @relation(fields: [orden_compra_id], references: [id], onDelete: Restrict)
  proveedor      Proveedor   @relation(fields: [proveedor_id], references: [id], onDelete: Restrict)
  registrado_por Usuario     @relation("ComprobanteProveedorRegistradoPor", fields: [registrado_por_id], references: [id], onDelete: Restrict)

  @@unique([numero_comprobante, tipo, proveedor_id])
  @@index([orden_compra_id])
  @@index([proveedor_id, is_active])
  @@map("comprobantes_proveedor")
}

enum TipoComprobante {
  FACTURA_A
  FACTURA_B
  FACTURA_C
  FACTURA_M
}
```

**Nota para HU-G10 (Módulo G):** el criterio de aceptación de HU-H9 exige que el comprobante quede disponible como insumo obligatorio para que Tesorería lo asocie a una `CuentaPorPagar` antes de marcarla `PAGADA`. Queda fuera de este documento decidir la cardinalidad exacta — se resuelve en el spec de HU-G10.

### 2.8. Ciclo de vida de `ComprobanteProveedor` (HU-H9)

| Estado origen | Transición | Estado destino | Precondición |
|---|---|---|---|
| — | Alta (2.7) | `ACTIVO` (`is_active = true`) | `OrdenCompra.estado` en `RECIBIDA_COMPLETA` o `CERRADA`; sin duplicado de `numero_comprobante` + `tipo` + `proveedor_id` entre comprobantes activos |
| `ACTIVO` | Anulación (2.7) | `ANULADO` (`is_active = false`) | `deletion_reason` obligatorio; requiere permiso `comprobantes_proveedor:anular` |

`ANULADO` es terminal: no existe transición de vuelta a `ACTIVO`. No hay transición de edición de campos (`ACTIVO` → `ACTIVO` con datos modificados).

### 2.9. Consola de Auditoría Forense de Proveedores (HU-H6) — **Sprint 3**

**Contexto de trazabilidad:** el Product Backlog exige que el Auditor pueda "consultar el historial de variaciones críticas de precios y cambios de homologación de proveedores con verificación SHA-256", con filtro por proveedor, rango de fechas, tipo de evento y usuario responsable. La sección 2.2 ya define la emisión de `proveedor:estado_cambiado`; esta sección define el endpoint de lectura, y depende además de `proveedor:variacion_precio_critica` (sección 2.3, HU-H2).

**Ruta:** `GET /app/api/proveedores/auditoria/route.ts`
**Permiso requerido:** `auditoria:leer_historico` sobre el dominio `proveedores` (exclusivo Auditor — Supervisor de Compras conserva `✓` para el historial comercial general de la sección 2.10, pero el log de auditoría forense es de acceso exclusivo del Auditor).

**Principio de diseño no negociable:** este endpoint **no** recalcula ni reimplementa el encadenamiento SHA-256. El Módulo H no es propietario del `AuditLog` ni de la lógica de verificación de cadena — ambos son responsabilidad exclusiva del Módulo D (Regla N.° 3 de `RULES.md`). Este Route Handler es una consulta de conveniencia con **filtro pre-aplicado por dominio** (`modulo_origen = "H"` o equivalente en el schema del `AuditLog`) que delega la resolución de integridad de cadena a la capa de servicios del Módulo D (`lib/services/auditoria/verificacion-cadena.service.ts`). **Antes de implementar esta sección, confirmar con el owner del Módulo D que `listarEventosPorDominio(dominio, filtros)` existe o se agrega a su capa de servicios** — este documento asume su existencia pero no la garantiza.

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
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(50).default(20),
});
export type ConsultarAuditoriaProveedoresQuery = z.infer<typeof ConsultarAuditoriaProveedoresQuerySchema>;
```

**Comportamiento esperado:**
- Consulta de solo lectura sobre `AuditLog` (Módulo D), filtrada por los `tipo_evento` propios de este módulo — el Route Handler de Módulo H invoca `listarEventosPorDominio(dominio: "proveedores", filtros)`, no accede a la tabla `AuditLog` mediante un `prisma.auditLog.findMany` propio.
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

### 2.10. Vista comparativa de precios entre proveedores (HU-H7) — **Sprint 3**

**Contexto de trazabilidad:** el Backlog exige, para un mismo insumo (SKU o categoría), una comparación entre proveedores que incluya precio unitario vigente, fecha de vigencia, puntaje de evaluación y **tiempo de entrega comprometido histórico**. Esta HU depende de `ListaPrecioVersion`/`ListaPrecioItem` con contenido real publicado (sección 2.3) y adicionalmente requiere una métrica derivada no persistida (tiempo de entrega histórico) que se define a continuación de forma explícita para eliminar cualquier ambigüedad de cálculo.

**Ruta:** `GET /app/api/proveedores/comparativa-precios/route.ts`
**Server Action equivalente:** ninguna — este es un caso de uso de consulta pura, consumido directamente vía Route Handler desde el cliente.
**Permiso requerido:** `proveedores:comparar_precios` (Comprador y Supervisor de Compras, `✓` directo conforme matriz RBAC del Documento de Alcance § Módulo H).

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

**Definición determinística de "tiempo de entrega comprometido histórico" (sin ambigüedad de cálculo):** se define como el promedio, en días corridos, de `(Recepcion.fecha_recepcion de la recepción que llevó la OrdenCompra a RECIBIDA_COMPLETA) − (OrdenCompra.fecha_confirmacion)`, calculado sobre el universo de `OrdenCompra` del proveedor con `estado ∈ { RECIBIDA_COMPLETA, CERRADA }` y `is_active = true`, sin límite de ventana temporal salvo que el equipo defina explícitamente un recorte (ej. "últimos 12 meses") como parámetro de configuración. Esta métrica se calcula **on-demand** en el momento de la consulta, nunca se persiste ni se cachea. **Confirmar esta fórmula con el equipo antes de implementar** — es una interpretación razonable del criterio de aceptación del Backlog, pero el Backlog no la especifica de forma unívoca (alternativa posible: medir contra `fecha_entrega_comprometida` en vez de `fecha_confirmacion`, para evaluar cumplimiento de plazo en vez de duración real del ciclo).

**Comportamiento esperado:**
1. Resuelve el conjunto de proveedores candidatos: si se recibe `variante_sku_id`, todos los `Proveedor` con `estado = "HOMOLOGADO"` que tengan un `ListaPrecioItem` para esa variante en su `ListaPrecioVersion` vigente (misma consulta de "versión vigente" de 2.3/3.4); si se recibe `categoria`, todos los `Proveedor` homologados cuyo array `categorias` contenga ese valor, restringido además a los que tengan al menos un ítem vigente en esa categoría.
2. Para cada proveedor candidato, agrega en una única fila de respuesta: `precio_unitario` (de la lista vigente), `fecha_inicio_vigencia` de esa versión, `puntaje_total` de la `EvaluacionProveedor` más reciente (`fecha_evaluacion desc`, `take(1)`), y `tiempo_entrega_promedio_dias` (definición del párrafo anterior).
3. Proveedores homologados sin evaluación previa exponen `puntaje_total: null` — el frontend es responsable de representar la ausencia de dato, el servicio **no** debe sustituir por `0`.
4. La respuesta se ordena por `precio_unitario` ascendente por defecto, sin paginación explícita.

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

### 2.11. Servicio de costo de reposición vigente (HU-H8) — **Sprint 3**

**Contexto de trazabilidad:** este endpoint es un servicio **interno de integración**, consumido de forma síncrona por el Módulo B en el momento de confirmar una venta (cálculo de margen) y por el Módulo D para el KPI de rentabilidad del Tablero de Comando. No tiene Server Action equivalente ni formulario de UI propio del Módulo H. **Nota de dependencia:** el Módulo B, consumidor principal de este servicio, tampoco existe todavía — el servicio se implementa y testea completo igual (mismo patrón que HU-A10 en Sprint 2), documentando el contrato para cuando Módulo B exista; el consumo por Módulo D ya se puede validar real hoy.

**Ruta:** `GET /app/api/proveedores/costo-reposicion/[variante_sku_id]/route.ts`
**Permiso requerido:** `proveedores:leer_costo_reposicion`, otorgado como permiso de servicio-a-servicio a los llamadores autorizados (Módulo B, Módulo D), no expuesto en ningún menú de navegación de usuario final.

```typescript
export const CostoReposicionParamsSchema = z.object({
  variante_sku_id: z.string().uuid(),
});
export type CostoReposicionParams = z.infer<typeof CostoReposicionParamsSchema>;
```

**Regla de resolución de proveedor (desempate — sin ambigüedad):**
1. Se resuelve el conjunto de `Proveedor` con `estado = "HOMOLOGADO"`, `is_active = true`, que tengan un `ListaPrecioItem` para `variante_sku_id` en su `ListaPrecioVersion` vigente (misma consulta de "versión vigente" de 2.3/3.4, evaluada `on-demand`, nunca cacheada).
2. Si existe un `proveedor_preferente_id` configurado explícitamente para esa `VarianteSKU` (**faltante de schema**: no existe hoy un campo `proveedor_preferente_id` en `VarianteSKU` ni tabla de configuración equivalente — debe agregarse como parte de una migración futura si se requiere soportar esta preferencia; hasta que exista, el sistema se comporta como si ningún producto tuviera proveedor preferente configurado) y ese proveedor está en el conjunto resuelto en el paso 1, se retorna su precio sin más evaluación.
3. En ausencia de proveedor preferente aplicable, se retorna el `precio_unitario` **mínimo** entre los proveedores candidatos del paso 1.
4. Si el conjunto de candidatos del paso 1 está vacío, `404` con `code: "SIN_COSTO_REPOSICION_DISPONIBLE"` — el Módulo B debe manejar explícitamente esta ausencia, nunca asumir un costo `0` ni un valor por defecto silencioso.

**Prohibición explícita de cacheo (cumplimiento literal del criterio de aceptación):** ninguna capa de este endpoint —Route Handler, capa de servicios, ni infraestructura (Redis, memoria de proceso, `revalidate` de Next.js)— debe cachear el resultado de este cálculo más allá de la duración de una única request. Un cambio de `ListaPrecioVersion` (HU-H2) debe reflejarse en la siguiente consulta a este endpoint sin ningún mecanismo de invalidación intermedio.

**Comportamiento esperado:**
- Operación de **solo lectura**, sin `$transaction`.
- No emite evento de dominio propio.
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
*(`criterio_seleccion` es `"MENOR_PRECIO_VIGENTE"` o `"PROVEEDOR_PREFERENTE"`, expuesto explícitamente para que el Módulo D pueda auditar en el Tablero de Comando por qué se seleccionó ese proveedor y no otro.)*

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
| `CONFIRMADA` | Recepción/control único (2.6) | `RECIBIDA_COMPLETA` | Todos los ítems activos se reciben y aceptan por la cantidad solicitada |
| `RECIBIDA_COMPLETA` | `CERRAR` (2.5) | `CERRADA` | Conciliación contra factura confirmada por el Comprador |
| `BORRADOR` / `ENVIADA` | `CANCELAR` (2.5) | `CANCELADA` | `deletion_reason` obligatorio; es baja lógica, no elimina la fila |

`CERRADA` y `CANCELADA` son estados terminales: ninguna transición sale de ellos. El servicio debe validar el estado origen leído dentro de la misma transacción que realiza el `UPDATE` para evitar condiciones de carrera entre dos requests concurrentes sobre la misma orden.

`RECEPCION_PARCIAL` permanece en el enum y puede visualizarse en datos históricos, pero HU-H4 V2.1 no lo produce ni admite nuevas recepciones desde ese estado.

### 3.2. Recalculo incremental del puntaje de evaluación de Proveedor (HU-H5)

Conforme a HU-H5 y a la sección 3.1 del Documento de Alcance, el puntaje de un `Proveedor` **no** se recalcula en un job batch nocturno: `evaluacion.service.ts` recalcula de forma incremental el agregado ponderado (`puntaje_cumplimiento_plazos`, `puntaje_calidad_recepcion`, `puntaje_documentacion` → `puntaje_total`) inmediatamente después de que se persiste cada `EvaluacionProveedor` nueva (disparada por una `Recepcion` o por una devolución por defecto de fabricación coordinada con el Módulo I — este último origen queda fuera de alcance porque el Módulo I no existe aún, `EvaluacionProveedor.devoluciones_fabricacion` es nullable y se carga manualmente por ahora). Si el `puntaje_total` resultante cae por debajo del umbral mínimo de homologación parametrizado, el mismo servicio ejecuta, dentro de la transacción que crea la `EvaluacionProveedor`, la transición automática `Proveedor.estado = "SUSPENDIDO"` — sin pasar por el endpoint manual de 2.2 — y encola el mismo evento `proveedor:estado_cambiado` que dispara ese endpoint (payload debe incluir `origen: "AUTOMATICO"` para distinguirlo en el log de auditoría de una suspensión manual).

**Faltante de configuración global (bloqueante):** el umbral mínimo de homologación (Decimal, parametrizable por Dirección) debe vivir en una entidad de configuración global — **no** hardcodeado en el servicio. Si el Módulo D no expone aún dicha entidad de configuración, es una dependencia bloqueante a resolver con el owner de Módulo D antes de implementar esta sección.

### 3.3. Cifrado AES-256 aislado para datos bancarios del legajo de Proveedor

- El cifrado/descifrado de `datos_bancarios` vive exclusivamente en `lib/crypto/aes.ts` (módulo ya existente, reutilizado — no se crea una segunda implementación de cifrado para el Módulo H).
- La capa de servicios (`proveedor.service.ts`) es la única autorizada a invocar `encrypt()`/`decrypt()` sobre este campo. Ningún Route Handler, Server Action ni componente de UI cifra o descifra directamente.
- El valor descifrado **nunca** se incluye en: logs de aplicación, payloads de eventos de dominio (sección 4), ni en la respuesta JSON de ningún endpoint salvo el de consulta explícita del legajo bancario por un rol autorizado (endpoint de solo lectura protegido por permiso `proveedores:leer_datos_bancarios`).
- Toda consulta exitosa de `datos_bancarios` descifrados por un Auditor genera, tras resolverse, el evento `proveedor:legajo_bancario_consultado` hacia el Módulo D (sección 4) — el acceso de lectura a un dato cifrado es en sí mismo un evento auditable, igual que en Módulo C. Este evento tiene consumidor real en la consola de auditoría de la sección 2.9 (HU-H6, ahora planificada en Sprint 3).
- Ninguna corrección de `datos_bancarios` se implementa como `UPDATE` directo sobre el campo cifrado existente: se trata como una nueva versión auditada del legajo, preservando el valor cifrado anterior accesible para reconstrucción forense.

### 3.4. Transacciones atómicas, separación estricta escritura/evento e inmutabilidad de `ListaPrecioVersion`

- Toda operación de escritura multi-tabla de este módulo (alta de proveedor, alta de orden, transición de estado, registro de recepción, publicación de lista de precios) se ejecuta dentro de un único `prisma.$transaction`. Ninguna escritura parcial debe quedar visible si una validación intermedia falla.
- Los eventos de dominio de la sección 4 se emiten **después** del `COMMIT` exitoso de la transacción, nunca dentro de ella — replicando el patrón fire-and-forget vía `domainEventBus.emit` ya usado en Módulo D. El agente de IA debe evaluar si ese patrón fire-and-forget (con el riesgo de pérdida de evento ante caída del proceso entre el `COMMIT` y el `emit`) es aceptable para este módulo o si Módulo H debe adoptar un outbox transaccional; si no hay decisión explícita del equipo al respecto, implementar el mismo patrón que Módulo D por consistencia, y documentarlo como deuda técnica conocida en el PR.
- **Inmutabilidad estricta de `ListaPrecioVersion` (versionado continuo — HU-H2):** ninguna actualización de precio ejecuta `UPDATE` sobre una `ListaPrecioVersion` o `ListaPrecioItem` ya persistidos. Toda modificación de precios —incluida la corrección de un error de tipeo— crea una `ListaPrecioVersion` nueva con nueva `fecha_inicio_vigencia`.
- `OrdenCompraItem.precio_unitario` congela, en el momento de creación de la orden (sección 2.4), el precio de la versión vigente en ese instante. Una publicación posterior de una nueva `ListaPrecioVersion` **no** debe, bajo ninguna implementación, disparar un `UPDATE` sobre `OrdenCompraItem.precio_unitario` de órdenes ya emitidas.
- La resolución de "versión vigente" de un proveedor es siempre una consulta derivada (`publicada = true AND fecha_inicio_vigencia <= now()`, ordenada `desc`, `take(1)`) evaluada en el momento de la consulta — nunca un puntero cacheado o un flag `es_vigente` persistido.
- Esta misma consulta derivada es la fuente de verdad única para la sección 2.4 (HU-H3) y las secciones 2.10 y 2.11 de este documento. Ninguna debe implementar su propia lógica de resolución de "versión vigente" — todas invocan la misma función de servicio (`resolverListaPrecioVigente(proveedor_id, variante_sku_id?)`), evitando divergencia de criterio entre los distintos puntos de consumo.

### 3.5. Restricción de borrado físico y patrón de baja lógica

- Todas las relaciones de Prisma salientes de las entidades del Módulo H usan `onDelete: Restrict`: un intento de eliminar físicamente un `Usuario`, una `VarianteSKU` o cualquier entidad referenciada por una fila de compras o de precios falla a nivel de base de datos antes de poder romper el historial.
- Ninguna función de servicio del Módulo H expone o invoca `prisma.<modelo>.delete()` ni `deleteMany()`, bajo ninguna condición — incluyendo rutas de "deshacer" o rollback manual de un alta errónea, que deben resolverse siempre como una baja lógica adicional, nunca como un borrado real.
- Toda consulta operativa por defecto (listados, selects para formularios, resolución de "proveedor homologado seleccionable", resolución de "versión vigente") filtra `is_active = true`.

---

## 4. Eventos de Dominio (EDA)

**Archivo:** `src/lib/events/event-types.ts` (extiende la tabla ya definida en `spec_modulo_D.md` §5)

El Módulo H es **emisor** hacia el Módulo D (encadenamiento SHA-256) y hacia el Módulo A (alta de stock). No consume eventos propios para su lógica central en el alcance de este documento.

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `proveedor:estado_cambiado` | 2.2 (manual) y 3.2 (automático) | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, usuario_id \| null (null si origen automático), estado_anterior, estado_nuevo, origen: "MANUAL" \| "AUTOMATICO", motivo }` |
| `recepcion:registrada` | 2.6, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ recepcion_id, orden_compra_id, numero_orden, deposito_destino_id, recibida_por_id, fecha_recepcion, estado_anterior_oc: "CONFIRMADA", estado_nuevo_oc: "RECIBIDA_COMPLETA" }` |
| `inventario:ingreso_stock_registrado` | 2.6, tras `COMMIT`, solo si hubo cantidad aceptada | Consumidores de Inventario | `{ movimiento_id, deposito_destino_id, items: [{ variante_sku_id, cantidad, estado_destino, cantidad_resultante }], usuario_id }` |
| `comprobante_proveedor:registrado` | 2.7, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ comprobante_id, orden_compra_id, proveedor_id, tipo, numero_comprobante, monto_total, registrado_por_id }` |
| `comprobante_proveedor:anulado` | 2.7, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ comprobante_id, orden_compra_id, proveedor_id, deletion_reason, anulado_por_id }` |
| `proveedor:variacion_precio_critica` | 2.3, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, lista_precio_version_id, usuario_id, variacion_porcentual_maxima, requiere_aprobacion, valor_anterior, valor_nuevo }` — `valor_anterior`/`valor_nuevo` referencian los `precio_unitario` agregados de la variante con mayor variación, no la lista completa |
| `proveedor:legajo_bancario_consultado` | 3.3 (complemento de 3.3, consumido por 2.9 — HU-H6) | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, usuario_id, rol: "AUDITOR" }` — sin incluir el dato bancario en ningún caso |

**Sin eventos nuevos en 2.9, 2.10, 2.11 (HU-H6/H7/H8):** son operaciones de solo lectura — 2.9 consume eventos ya existentes (no los emite), y 2.10/2.11 son cálculos on-demand sin persistencia ni notificación de cambio de estado.

**Nota de trazabilidad HU-A11:** el wizard de carga de movimiento (Módulo A) no emite eventos propios de este módulo — no aplica a Módulo H, se preserva la nota solo por completitud de referencia cruzada con `spec_modulo_A.md`.

**Regla de exclusión de datos sensibles en el payload (misma convención que `spec_modulo_D.md` §5.1):** ningún evento de este módulo incluye en su payload el valor en claro de `datos_bancarios`, ni `password`/`password_hash` de `Usuario`. El emisor (capa de servicios del Módulo H) es responsable de excluir estos campos antes de publicar al bus; `audit-log.listener.ts` no realiza sanitización adicional sobre eventos entrantes.

`Recepcion.deposito_destino_id` es obligatorio. El alta de stock se ejecuta dentro de la misma transacción de H4 mediante el núcleo transaccional de Inventario; los eventos anteriores se emiten únicamente después del commit.

---

## 5. Fuera de Alcance (diferido / bloqueado)

- **Corrección del default de `ListaPrecioVersion.publicada`:** ver advertencia en sección 2.3. Es la primera acción de código a resolver de Sprint 3, independientemente del orden de implementación del resto de HU-H2/H6/H7/H8.
- **Cardinalidad `ListaPrecio` ↔ `Proveedor` (1:1 vs. 1:N):** migrado sin `@@unique([proveedor_id])` por ambigüedad del Documento de Alcance. Confirmar con el equipo antes de considerar el modelo de datos cerrado.
- **Campo `proveedor_preferente_id` (o tabla de configuración equivalente) para el desempate de HU-H8 (2.11):** no existe aún en `schema.prisma`. Hasta su definición, el servicio de costo de reposición opera siempre bajo el criterio de menor precio vigente, sin excepción por preferencia.
- **Entidad de configuración global para `variacion_umbral_critico` (sección 2.3) y para el umbral mínimo de homologación (sección 3.2):** dependencias bloqueantes a resolver con el owner de Módulo D.
- **Endpoint de aprobación de `ListaPrecioVersion` (`.../lista-precios/[version_id]/aprobar`):** mencionado en 2.3 pero no detallado en este documento; se especifica como documento independiente o adenda cuando se resuelva el resto del modelo de datos.
- **Confirmación de la función `listarEventosPorDominio` del Módulo D (sección 2.9):** este documento asume su existencia; verificar con el owner de Módulo D antes de implementar.
- **Confirmación de fórmula de "tiempo de entrega comprometido histórico" (sección 2.10):** interpretación razonable pero no unívoca del criterio de aceptación del Backlog; confirmar antes de implementar.
- **Recorte de ventana temporal configurable para `tiempo_entrega_promedio_dias` (sección 2.10):** este documento define el cálculo sobre el historial completo del proveedor a falta de una definición explícita de ventana (ej. "últimos 12 meses").
- **Dependencia de Módulo B para HU-H8 (sección 2.11):** el consumidor principal de este servicio no existe todavía en el proyecto. Implementable de forma aislada y testeable vía Postman (mismo patrón que HU-A10 en Sprint 2), pero sin consumidor real hasta que Módulo B se construya.
- **Endpoint de solicitud de homologación por Comprador (△-solicita, sección 2.2):** mencionado como flujo existente pero no detallado en este documento — fuera de alcance de código.
- **Integración con Módulo I (devoluciones por defecto de fabricación como insumo de `EvaluacionProveedor`, sección 3.2):** el Módulo I no existe en este sprint. `EvaluacionProveedor.devoluciones_fabricacion` es nullable y se carga manualmente por ahora.
- **Conciliación automática contra factura del proveedor (paso previo a `CERRAR`, sección 2.5):** este documento la modela como un flag operativo manual confirmado por el Comprador.
- **Integración AFIP / facturación electrónica real (HU-H9, sección 2.7):** HU-H9 especifica exclusivamente la carga **manual** por el Comprador del comprobante ya emitido por el proveedor fuera del sistema — no incluye bajo ninguna forma la emisión de comprobantes, la consulta de padrones de AFIP, ni la validación de CAE.
- **Asociación de `ComprobanteProveedor` a `CuentaPorPagar` (HU-G10, Módulo G):** HU-H9 deja el comprobante disponible como insumo, pero la asociación efectiva a una `CuentaPorPagar` es HU-G10, fuera de alcance de este documento.
