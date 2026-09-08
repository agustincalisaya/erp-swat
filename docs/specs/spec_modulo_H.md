# Especificación Técnica — Módulo H (Gestión de Proveedores y Abastecimiento)
## ERP SWAT Indumentarias — Sprint 2
## Revisión 5 — Acotada a las HU planificadas para Sprint 2 (HU-H1, HU-H3, HU-H4, HU-H5, HU-H9)

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod · Argon2id · JWT
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable) · `Documento de Alcance Funcional y Técnico` (sección Módulo H) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja **Sprint 2**, no la hoja "Product Backlog Consolidado") · `schema.prisma` · `spec_modulo_D.md`

---

## ⚠️ Por qué este documento existe separado de `spec_modulo_H_diferido.md`

Este documento y su contraparte `spec_modulo_H_diferido.md` fueron un único archivo hasta la Revisión 3. Se separaron por el siguiente motivo, verificado contra la hoja **`Sprint 2`** del Product Backlog (`Product Backlog — SWAT Indumentarias.xlsx`), que es la fuente de planificación real — distinta de la hoja "Product Backlog Consolidado" usada para el análisis de trazabilidad inicial:

> *"Quedan fuera de este sprint por depender de que Proveedores tenga historial real de operación, o de módulos que todavía no se construyen: HU-H2 (listas de precios versionadas), HU-H6 (auditoría de variaciones de proveedores), HU-H7 (comparador de precios) y HU-H8 (costo de reposición expuesto a Módulo B). Se abordan en sprints posteriores."* — Notas y criterios de selección, hoja `Sprint 2`.

El análisis de trazabilidad de la Revisión 2/3 de este spec se hizo contra el backlog consolidado (73 HU totales del proyecto), sin cruzar contra la planificación de sprint. Eso llevó a especificar y a migrar en base de datos (`ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem`) contenido correspondiente a HU-H2/H6/H7/H8, que el PO decidió explícitamente diferir. La migración de schema ya aplicada es aditiva y no afecta a H1/H3/H4/H5 (ver nota más abajo), por lo que se mantiene; lo que se corrige es el **contenido del spec**, separándolo en dos documentos según a qué sprint corresponde cada HU.

**Este documento (`spec_modulo_H.md`) contiene exclusivamente lo planificado para Sprint 2:**
- **HU-H1** — Alta de Proveedor y homologación (secciones 2.1, 2.2)
- **HU-H3** — Emisión de Orden de Compra y seguimiento de estado (secciones 2.4, 2.5)
- **HU-H4** — Registro de Recepción física (sección 2.6)
- **HU-H5** — Evaluación de proveedores, recálculo incremental de puntaje (sección 3.2)
- **HU-H9** — Registro del Comprobante fiscal de Proveedor asociado a una OC (sección 2.7) — **incorporada en la Revisión 5**, no estaba contemplada en la Revisión 4

**`spec_modulo_H_diferido.md` contiene lo que el PO sacó de este sprint:**
- **HU-H2** — Publicación de Lista de Precios versionada
- **HU-H6** — Consola de Auditoría Forense de Proveedores
- **HU-H7** — Vista comparativa de precios entre proveedores
- **HU-H8** — Servicio de costo de reposición vigente

**Nota sobre la migración de schema ya aplicada:** los modelos `ListaPrecio`, `ListaPrecioVersion`, `ListaPrecioItem` y los campos `Proveedor.datos_bancarios_cifrado`/`datos_bancarios_iv` ya existen en `schema.prisma` (migración `20260831050501_add_lista_precio_and_proveedor_bank_data`). Esto **no se revierte** — es aditivo, no rompe nada de H1/H3/H4/H5, y ahorra trabajo cuando se retome H2. Ver el detalle completo de esa migración y sus pendientes (default de `publicada`, cardinalidad `ListaPrecio`↔`Proveedor`) en `spec_modulo_H_diferido.md`, que es el documento propietario de esa entidad. **Este documento (Sprint 2) no depende de esos modelos para H1/H4/H5**, pero **sí tiene una dependencia funcional real en H3** — ver advertencia bloqueante en la sección 2.4.

---

## 1. Visión General

El Módulo H es la capa del ERP responsable del ciclo completo de abastecimiento de SWAT Indumentarias. En el alcance de Sprint 2, cubre: homologación de proveedores (H.1), y emisión, seguimiento y recepción física de órdenes de compra (H.3/H.4), junto con la evaluación incremental de desempeño del proveedor (H.5). Se suma en esta revisión el registro formal del comprobante fiscal (Factura A/B/C/M) que el proveedor envía contra una Orden de Compra ya recibida (H.9), como constancia documental previa a que Tesorería registre el pago — una carga manual por el Comprador, sin integración real con AFIP (ver advertencia de alcance en 2.7 y sección 5). La administración de listas de precios versionadas (H.2) y sus consumidores derivados (H.6, H.7, H.8) se abordan en un sprint posterior — ver `spec_modulo_H_diferido.md`.

Bajo Next.js App Router, el módulo se implementa mediante **Route Handlers** (`app/api/proveedores/**`, `app/api/ordenes-compra/**`) para las integraciones consumidas por otros módulos o clientes no-navegador, y **Server Actions** (`app/(dashboard)/compras/**/actions.ts`) para los formularios de gestión operados por Comprador, Supervisor de Compras y Personal de Depósito. Ambas superficies son wrappers finos: **está prohibido implementar lógica de negocio en el `route.ts` o en la Server Action**. Toda regla de dominio, toda validación de máquina de estados y toda escritura a base de datos se delega exclusivamente en la capa de servicios `lib/services/proveedores/*` (`proveedor.service.ts`, `orden-compra.service.ts`, `recepcion.service.ts`, `evaluacion.service.ts`). El handler/action se limita a: (1) resolver la sesión y verificar el permiso granular vía `withPermission("proveedores:<accion>")`, (2) parsear y validar el `body` contra el schema Zod correspondiente, (3) invocar la función de servicio, (4) mapear el resultado o la excepción de negocio al shape de respuesta JSON estándar definido en la sección 2.

**Regla N.° 1 aplicada al Módulo H (prohibición absoluta de `DELETE`):** ninguna entidad del módulo —`Proveedor`, `OrdenCompra`, `OrdenCompraItem`, `Recepcion`, `RecepcionItem`, `RecepcionDiscrepancia`, `EvaluacionProveedor`— admite una sentencia `DELETE` desde el código de aplicación, bajo ninguna circunstancia ni ningún rol, incluyendo Administrador. Toda baja se implementa como `UPDATE` sobre los campos estándar `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`, conforme al patrón de Repositorio con Baja Lógica ya aplicado en los Módulos A y D. El schema refuerza esta restricción a nivel de integridad referencial: todas las relaciones salientes de las entidades de H usan `onDelete: Restrict` (ver `schema.prisma`, líneas 588–589, 629–630, 664–665, 693–694, 721, 766–767), de modo que ni siquiera un `DELETE` accidental sobre una entidad relacionada (`Usuario`, `VarianteSKU`) podría propagar un borrado en cascada hacia el historial de compras.

**Regla N.° 2 aplicada al Módulo H (cifrado AES-256 y trazabilidad inalterable):** los datos bancarios y de contacto del legajo comercial de un proveedor —alcanzados por la Ley N.° 25.326 cuando el proveedor es una persona física o unipersonal— se cifran en reposo con AES-256 mediante el módulo de cifrado dedicado ya existente (`lib/crypto/aes.ts`, mismo mecanismo aplicado en Módulo A/C), de forma completamente aislada del cálculo de hash SHA-256 de la cadena de auditoría. Todo cambio de estado de homologación se propaga de forma asíncrona hacia el Módulo D para su encadenamiento SHA-256 (ver sección 4).

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
- Transición manual entre los tres valores de `EstadoProveedor` (`schema.prisma` línea 553). La transición automática a `SUSPENDIDO` por caída del puntaje de evaluación por debajo del umbral mínimo **no** pasa por esta ruta — es disparada internamente por `evaluacion.service.ts` tras persistir una nueva `EvaluacionProveedor` (ver 3.2).
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

### 2.4. Emisión de Orden de Compra (HU-H3)

**Ruta:** `POST /app/api/ordenes-compra/route.ts`
**Server Action equivalente:** `crearOrdenCompra()` en `app/(dashboard)/compras/ordenes/actions.ts`
**Permiso requerido:** `ordenes_compra:crear` (Comprador, Supervisor de Compras)

**🔴 Advertencia bloqueante — dependencia real sobre HU-H2 (diferida):** el criterio de aceptación de HU-H3 en el Backlog es explícito: *"El sistema arma la orden contra la lista de precios vigente del proveedor seleccionado"*. Como HU-H2 (publicación de listas de precios) queda fuera de Sprint 2 (ver nota al inicio del documento), **no existirá en este sprint ningún endpoint de usuario para publicar una `ListaPrecioVersion`**. El modelo de datos ya existe (migración aplicada), pero está vacío de contenido operativo salvo que se cargue por otra vía. Este documento define dos caminos posibles — **el equipo debe elegir uno antes de implementar 2.4**, no ambos:

1. **Camino A (recomendado, menor superficie de cambio):** un script de seed (`prisma/seed.ts` o script dedicado, fuera de la capa de aplicación) carga una `ListaPrecio` + `ListaPrecioVersion` (`publicada = true`) + `ListaPrecioItem[]` iniciales por cada `Proveedor` de prueba, directamente vía Prisma Client, sin pasar por ningún Route Handler. HU-H3 se implementa exactamente como está descripta abajo, resolviendo el precio contra esa versión sembrada. Cuando se retome HU-H2 en un sprint posterior, el mecanismo de publicación por endpoint convive sin fricción con los datos ya sembrados (misma tabla, mismo contrato de "versión vigente").
2. **Camino B:** `CrearOrdenCompraSchema` recibe `precio_unitario` explícito por ítem en el payload, sin resolverlo contra ninguna lista. Esto **contradice** la regla de "el cliente nunca envía el precio" que este mismo documento sostiene como principio de integridad de costos, y debería revertirse cuando HU-H2 se implemente. No es la opción recomendada — se documenta como alternativa únicamente si el equipo decide explícitamente no sembrar datos de precio para Sprint 2.

El contrato Zod y el comportamiento esperado que siguen a continuación asumen el **Camino A**. Si el equipo opta por el Camino B, `CrearOrdenCompraSchema` y el punto 2 de "Comportamiento esperado" deben reescribirse — avisar antes de implementar.

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
- El servicio resuelve la `ListaPrecioVersion` vigente del proveedor (`publicada = true AND fecha_inicio_vigencia <= now()`, ordenada `desc`, `take(1)` — el modelo ya existe en schema, ver advertencia arriba sobre cómo se puebla en Sprint 2) y toma de ahí el `precio_unitario` de cada `variante_sku_id` solicitada — **el cliente nunca envía el precio** (Camino A); enviarlo sería una superficie de manipulación de costos. Si alguna `variante_sku_id` no tiene precio en la lista vigente, `422` con `code: "SKU_SIN_PRECIO_VIGENTE"`.
- Creación transaccional (`prisma.$transaction`) de `OrdenCompra` (estado inicial `BORRADOR`, default de schema) junto con sus N `OrdenCompraItem`, cada uno con el `precio_unitario` resuelto de la lista vigente en ese instante — este valor queda congelado en el ítem y **no** se recalcula si la lista cambia después.
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
- **Tras el `COMMIT`** (nunca dentro de la transacción de Prisma — ver 3.4), se emite el evento `stock:recepcion_confirmada` hacia el Módulo A para el alta de stock disponible (sección 4). El Módulo H no escribe directamente sobre `StockDeposito` ni `MovimientoStock`: esa responsabilidad es exclusiva del Módulo A, que consume el evento.

**Respuesta `201 Created`:**
```json
{ "data": { "recepcion_id": "uuid", "orden_compra_estado": "RECEPCION_PARCIAL", "saldo_pendiente_total": 12 }, "error": null }
```

**Respuesta `422 Unprocessable Entity`:**
```json
{ "data": null, "error": { "code": "CANTIDAD_EXCEDE_SALDO_PENDIENTE", "message": "El ítem admite un máximo de 8 unidades pendientes; se recibieron 12" } }
```

### 2.7. Registro de Comprobante de Proveedor (HU-H9)

**⚠️ Alcance — no confundir con integración AFIP:** esta sección especifica la **carga manual** por el Comprador del comprobante fiscal (Factura A/B/C/M) que el proveedor envía en papel/PDF fuera del sistema, como constancia documental de respaldo previo al pago. **No** es facturación electrónica, no consulta el padrón de AFIP ni emite comprobantes: es un registro administrativo. La sección 5 de la Revisión 4 de este documento ya advertía que *"una integración real con comprobantes fiscales (AFIP, vía Módulo G conforme a `RULES.md` Regla N.° 3) queda fuera de alcance"* — HU-H9 es la entidad de comprobante prevista por esa nota, sin la integración AFIP, que sigue diferida (ver sección 5).

**Ruta (alta):** `POST /app/api/ordenes-compra/[id]/comprobantes/route.ts`
**Ruta (listado por OC):** `GET /app/api/ordenes-compra/[id]/comprobantes/route.ts`
**Ruta (listado global, insumo de HU-G10/Tesorería):** `GET /app/api/comprobantes-proveedor/route.ts`
**Ruta (anulación):** `PATCH /app/api/comprobantes-proveedor/[id]/anular/route.ts`
**Server Action equivalente:** `registrarComprobanteProveedor()` / `anularComprobanteProveedor()` / `listarComprobantesProveedor()` en `app/(dashboard)/compras/comprobantes/actions.ts`
**Permiso requerido:** `comprobantes_proveedor:crear` y `comprobantes_proveedor:leer` (Comprador, Supervisor de Compras — mismo par de roles que `proveedores:crear`/`proveedores:leer`); `comprobantes_proveedor:anular` (exclusivo Supervisor de Compras, mismo criterio que `proveedores:baja`: una baja lógica sobre un comprobante ya presentado es una corrección sensible, no una operación de carga de rutina).

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
  // Opcional (criterio de aceptación de HU-H9): URL del archivo digitalizado
  // (PDF/imagen) ya subido a un storage externo — este schema NO recibe el
  // binario, solo la referencia. El mecanismo de subida queda fuera de
  // detalle de este documento (mismo patrón que cualquier campo `*_url` de
  // adjunto en el resto del sistema).
  archivo_adjunto_url: z.string().url("La URL del archivo adjunto es inválida").optional(),
});
export type RegistrarComprobanteProveedorInput = z.infer<typeof RegistrarComprobanteProveedorSchema>;

// Nótese que `proveedor_id` NO forma parte de este schema: igual que
// `precio_unitario` en 2.4, es un dato que el cliente nunca envía — el
// servicio lo deriva siempre de `orden_compra.proveedor_id` (ver
// "Comportamiento esperado" y 2.7.1).

export const AnularComprobanteProveedorSchema = z.object({
  deletion_reason: z.string().min(1, "El motivo de anulación es obligatorio"),
});
export type AnularComprobanteProveedorInput = z.infer<typeof AnularComprobanteProveedorSchema>;
```

**Comportamiento esperado:**
- Precondición de estado (criterio de aceptación de HU-H9): `OrdenCompra.estado` debe ser `RECIBIDA_COMPLETA` o `CERRADA` (los únicos dos estados "iguales o posteriores a `RECIBIDA_COMPLETA`" en la máquina de estados de 3.1) y `OrdenCompra.is_active = true`. En cualquier otro estado — incluida `CANCELADA` — `409 Conflict` con `code: "ORDEN_NO_RECEPCIONADA"`, antes de tocar la base de datos.
- `proveedor_id` se resuelve siempre server-side a partir de `orden_compra.proveedor_id` en el mismo momento de la carga — nunca se recibe en el `body` ni se confía en un valor de cliente (mismo principio de integridad que "el cliente nunca envía el precio" en 2.4). Este valor se desnormaliza en la fila de `ComprobanteProveedor` (ver 2.7.1) y queda congelado: si el proveedor de la OC cambiara por algún mecanismo futuro (no existe hoy), el comprobante ya emitido no se recalcula.
- No se valida `Proveedor.estado === "HOMOLOGADO"` en esta operación: a diferencia de la emisión de una OC nueva (2.4), el comprobante documenta una operación de compra ya recibida — una suspensión posterior del proveedor (2.2) no debe bloquear la carga de su documentación pendiente, mismo criterio que "la suspensión ... no afecta órdenes ya `CONFIRMADA` en curso" (2.2).
- Unicidad (criterio de aceptación de HU-H9): no se admite `numero_comprobante` + `tipo` + `proveedor_id` duplicado entre comprobantes `is_active = true`. El servicio valida esto aplicativamente antes de escribir y además captura `P2002` del constraint `@@unique` de Prisma (ver 2.7.1) y lo traduce al mismo shape `409` — mismo patrón que la colisión de `cuit` en 2.1.
- Alta transaccional (`prisma.$transaction`, 3.4) del `ComprobanteProveedor`; el evento `comprobante_proveedor:registrado` se emite recién después del `COMMIT`, nunca dentro de la transacción (3.4).
- **Inmutabilidad estricta:** no existe ningún endpoint `PATCH`/`PUT` de edición de campos sobre un `ComprobanteProveedor` ya creado — ni siquiera para Supervisor de Compras o Administrador. La única mutación posible post-alta es la anulación por baja lógica (Regla N.° 1): `PATCH .../anular` exige `deletion_reason` obligatorio, setea `is_active = false`, `deleted_at`, `deleted_by`, y emite `comprobante_proveedor:anulado`. Si el comprobante fue cargado con datos erróneos, la corrección es anularlo y cargar uno nuevo — nunca sobreescribir el original (mismo criterio que 3.5 sobre "deshacer" un alta errónea).
- El listado (`GET`) filtra por defecto `is_active = true`, salvo que quien consulta sea Auditor (RULES.md Regla N.° 1).

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

**Respuesta `422 Unprocessable Entity` (anulación sin motivo):**
```json
{ "data": null, "error": { "code": "VALIDATION_ERROR", "message": "El motivo de anulación es obligatorio" } }
```

#### 2.7.1. Modelo de datos nuevo — **PROPUESTA A VALIDAR, no aplicada**

**⚠️ Este modelo todavía no existe en `schema.prisma`.** Es una propuesta de diseño para que el equipo la revise antes de correr `npx prisma migrate dev`; no se aplicó ninguna migración como parte de esta actualización del spec. Confirmado contra `schema.prisma` (Revisión 5): no existe hoy ningún modelo `ComprobanteProveedor` ni equivalente — el campo `MovimientoStock.comprobante_referencia` (`schema.prisma` línea ~376) es un `String?` de texto libre del Módulo A (remitos/movimientos de stock) sin relación alguna con esta entidad; no se reutiliza.

```prisma
/// Comprobante fiscal (Factura A/B/C/M) que un Proveedor envía como respaldo
/// de una OrdenCompra ya recibida (HU-H9, spec_modulo_H.md §2.7). Es carga
/// MANUAL por el Comprador — no hay integración real con AFIP (RULES.md
/// Regla N.° 3; ver advertencia de alcance en §2.7 y §5). Se asocia siempre
/// a una OrdenCompra existente en estado RECIBIDA_COMPLETA o posterior; no
/// se admite carga suelta sin OC de referencia. Inmutable una vez creado:
/// toda corrección es baja lógica + alta de un comprobante nuevo, nunca un
/// UPDATE sobre los campos ya persistidos (RULES.md Regla N.° 1).
model ComprobanteProveedor {
  id                  String           @id @default(uuid())
  orden_compra_id     String
  /// Desnormalizado desde `orden_compra.proveedor_id` en el momento de la
  /// carga (ver 2.7, "Comportamiento esperado"). Se evaluó resolverlo
  /// siempre vía join contra `orden_compra.proveedor_id` para no duplicar
  /// el dato, pero se decidió desnormalizarlo por dos motivos: (1) el
  /// criterio de unicidad de HU-H9 es compuesto
  /// (`numero_comprobante` + `tipo` + `proveedor`) y Prisma solo puede
  /// declarar `@@unique` sobre columnas propias del modelo, no sobre un
  /// campo alcanzado a través de una relación — sin esta columna la
  /// unicidad tendría que validarse únicamente en la capa de aplicación,
  /// perdiendo la garantía a nivel de base de datos que sí tienen `cuit`
  /// en `Proveedor` (línea 602) y `numero_orden` en `OrdenCompra`
  /// (línea 757); (2) HU-G10 (Módulo G, fuera de alcance de este
  /// documento) necesita listar/filtrar comprobantes por proveedor sin
  /// forzar un join adicional contra `OrdenCompra` en cada consulta de
  /// Tesorería. Mismo patrón de congelamiento que
  /// `OrdenCompraItem.precio_unitario` (§2.4): se fija al crear y no se
  /// recalcula después.
  proveedor_id        String
  tipo                TipoComprobante
  numero_comprobante  String
  fecha_emision       DateTime
  monto_total         Decimal          @db.Decimal(12, 2)
  /// URL del archivo digitalizado (PDF/imagen) en un storage externo.
  /// Opcional — criterio de aceptación de HU-H9.
  archivo_adjunto_url String?
  registrado_por_id   String

  // --- Soft delete estricto (RULES.md §1) ---
  is_active       Boolean   @default(true)
  deleted_at      DateTime?
  deleted_by      String?
  deletion_reason String?

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  // --- Relaciones ---
  orden_compra   OrdenCompra @relation(fields: [orden_compra_id], references: [id], onDelete: Restrict)
  proveedor      Proveedor   @relation(fields: [proveedor_id], references: [id], onDelete: Restrict)
  registrado_por Usuario     @relation("ComprobanteProveedorRegistradoPor", fields: [registrado_por_id], references: [id], onDelete: Restrict)

  /// Unicidad compuesta del criterio de aceptación de HU-H9: mismo número +
  /// tipo + proveedor no puede repetirse entre comprobantes activos.
  @@unique([numero_comprobante, tipo, proveedor_id])
  @@index([orden_compra_id])
  @@index([proveedor_id, is_active])
  @@map("comprobantes_proveedor")
}

/// Tipos de comprobante fiscal admitidos por HU-H9 — enum cerrado, no texto
/// libre, para que HU-G10 (Módulo G) pueda discriminar de forma confiable
/// el tratamiento impositivo de cada comprobante.
enum TipoComprobante {
  FACTURA_A
  FACTURA_B
  FACTURA_C
  FACTURA_M
}
```

**Cambios adicionales que implicaría aplicar esta propuesta (no incluidos en el bloque anterior, a confirmar con el equipo):** agregar el campo de relación inversa `comprobantes ComprobanteProveedor[]` tanto a `model OrdenCompra` como a `model Proveedor`, y una migración aditiva (`npx prisma migrate dev --name add_comprobante_proveedor`) que no toca ningún modelo existente de Módulo G ni H.

**Nota para HU-G10 (Módulo G — fuera de alcance de este documento, solo se referencia la relación):** el criterio de aceptación de HU-H9 exige que el comprobante quede disponible como insumo obligatorio para que Tesorería lo asocie a una `CuentaPorPagar` antes de marcarla `PAGADA`. `CuentaPorPagar` ya existe en `schema.prisma` (Módulo G, HU-G8, líneas 994–1019) y hoy no tiene ningún campo de relación hacia comprobantes. El lado que HU-G10 va a necesitar preparar en su propio spec —no se implementa ni se propone como migración acá— es previsiblemente un campo `comprobante_proveedor_id String?` + relación opcional en `CuentaPorPagar` (opcional porque una `CuentaPorPagar` puede existir en estado `PROVISORIO`/`DEFINITIVA` antes de que llegue el comprobante), con `onDelete: Restrict` igual que el resto de las relaciones salientes de Módulo G/H. Queda expresamente fuera de este documento decidir la cardinalidad exacta (¿un comprobante puede respaldar más de una `CuentaPorPagar` de la misma OC, por ejemplo si hay recepciones parciales facturadas por separado?) — eso se resuelve en el spec de HU-G10.

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

### 3.2. Recalculo incremental del puntaje de evaluación de Proveedor (HU-H5)

Conforme a HU-H5 y a la sección 3.1 del Documento de Alcance, el puntaje de un `Proveedor` **no** se recalcula en un job batch nocturno: `evaluacion.service.ts` recalcula de forma incremental el agregado ponderado (`puntaje_cumplimiento_plazos`, `puntaje_calidad_recepcion`, `puntaje_documentacion` → `puntaje_total`) inmediatamente después de que se persiste cada `EvaluacionProveedor` nueva (disparada por una `Recepcion` o por una devolución por defecto de fabricación coordinada con el Módulo I — este último origen queda fuera de alcance porque el Módulo I no existe aún, ver `EvaluacionProveedor.devoluciones_fabricacion` en `schema.prisma`, nullable y cargado manualmente por ahora). Si el `puntaje_total` resultante cae por debajo del umbral mínimo de homologación parametrizado, el mismo servicio ejecuta, dentro de la transacción que crea la `EvaluacionProveedor`, la transición automática `Proveedor.estado = "SUSPENDIDO"` — sin pasar por el endpoint manual de 2.2 — y encola el mismo evento `proveedor:estado_cambiado` que dispara ese endpoint (payload debe incluir `origen: "AUTOMATICO"` para distinguirlo en el log de auditoría de una suspensión manual).

**Faltante de configuración global (bloqueante):** el umbral mínimo de homologación (Decimal, parametrizable por Dirección) debe vivir en una entidad de configuración global — **no** hardcodeado en el servicio. Si el Módulo D no expone aún dicha entidad de configuración en Sprint 2, es una dependencia bloqueante a resolver con el owner de Módulo D antes de implementar esta sección.

### 3.3. Cifrado AES-256 aislado para datos bancarios del legajo de Proveedor

- El cifrado/descifrado de `datos_bancarios` vive exclusivamente en `lib/crypto/aes.ts` (módulo ya existente, reutilizado — no se crea una segunda implementación de cifrado para el Módulo H).
- La capa de servicios (`proveedor.service.ts`) es la única autorizada a invocar `encrypt()`/`decrypt()` sobre este campo. Ningún Route Handler, Server Action ni componente de UI cifra o descifra directamente.
- El valor descifrado **nunca** se incluye en: logs de aplicación, payloads de eventos de dominio (sección 4), ni en la respuesta JSON de ningún endpoint salvo el de consulta explícita del legajo bancario por un rol autorizado (fuera de detalle de este documento — endpoint de solo lectura protegido por permiso `proveedores:leer_datos_bancarios`; el evento de auditoría de esa consulta, `proveedor:legajo_bancario_consultado`, se especifica en `spec_modulo_H_diferido.md` junto con HU-H6, dado que la consola de auditoría que lo consume está diferida).
- Ninguna corrección de `datos_bancarios` se implementa como `UPDATE` directo sobre el campo cifrado existente: se trata como una nueva versión auditada del legajo, preservando el valor cifrado anterior accesible para reconstrucción forense.

### 3.4. Transacciones atómicas y separación estricta escritura/evento

- Toda operación de escritura multi-tabla de este módulo (alta de proveedor, alta de orden, transición de estado, registro de recepción) se ejecuta dentro de un único `prisma.$transaction`. Ninguna escritura parcial debe quedar visible si una validación intermedia falla.
- Los eventos de dominio de la sección 4 se emiten **después** del `COMMIT` exitoso de la transacción, nunca dentro de ella — replicando el patrón fire-and-forget vía `domainEventBus.emit` ya usado en Módulo D (`spec_modulo_D.md`, hallazgo documentado sobre `crearUsuario`). El agente de IA debe evaluar si ese patrón fire-and-forget (con el riesgo de pérdida de evento ante caída del proceso entre el `COMMIT` y el `emit`) es aceptable para este módulo o si Módulo H debe adoptar un outbox transaccional; si no hay decisión explícita del equipo al respecto, implementar el mismo patrón que Módulo D por consistencia, y documentarlo como deuda técnica conocida en el PR, no como decisión silenciosa.

### 3.5. Restricción de borrado físico y patrón de baja lógica

- Todas las relaciones de Prisma salientes de las entidades del Módulo H usan `onDelete: Restrict` (ya presente en `schema.prisma`): un intento de eliminar físicamente un `Usuario`, una `VarianteSKU` o cualquier entidad referenciada por una fila de compras falla a nivel de base de datos antes de poder romper el historial de abastecimiento.
- Ninguna función de servicio del Módulo H expone o invoca `prisma.<modelo>.delete()` ni `deleteMany()`, bajo ninguna condición — incluyendo rutas de "deshacer" o rollback manual de un alta errónea, que deben resolverse siempre como una baja lógica adicional (`is_active = false`, `deletion_reason: "Alta errónea — corrección"`), nunca como un borrado real.
- Toda consulta operativa por defecto (listados, selects para formularios, resolución de "proveedor homologado seleccionable") filtra `is_active = true`.

### 3.6. Ciclo de vida de `ComprobanteProveedor` (HU-H9)

A diferencia de `OrdenCompra` (3.1), `ComprobanteProveedor` no tiene un campo `estado` propio en el modelo propuesto en 2.7.1 — su único ciclo de vida relevante es el patrón estándar de baja lógica (`is_active`) descripto en 3.5, sin estados intermedios: se documenta igual aquí, con el mismo formato de tabla que 3.1, porque el criterio de aceptación de HU-H9 lo exige explícitamente ("inmutable una vez creado: no se edita, solo se anula por baja lógica con motivo obligatorio").

| Estado origen | Transición | Estado destino | Precondición |
|---|---|---|---|
| — | Alta (2.7) | `ACTIVO` (`is_active = true`) | `OrdenCompra.estado` en `RECIBIDA_COMPLETA` o `CERRADA`; sin duplicado de `numero_comprobante` + `tipo` + `proveedor_id` entre comprobantes activos |
| `ACTIVO` | Anulación (2.7) | `ANULADO` (`is_active = false`) | `deletion_reason` obligatorio; requiere permiso `comprobantes_proveedor:anular` (exclusivo Supervisor de Compras) |

`ANULADO` es terminal: no existe transición de vuelta a `ACTIVO`. No hay ninguna transición de edición de campos (`ACTIVO` → `ACTIVO` con datos modificados) — el servicio no expone esa operación bajo ninguna condición (ver 2.7, "Inmutabilidad estricta").

---

## 4. Eventos de Dominio (EDA)

**Archivo:** `src/lib/events/event-types.ts` (extiende la tabla ya definida en `spec_modulo_D.md` §5)

El Módulo H es **emisor** hacia el Módulo D (encadenamiento SHA-256) y hacia el Módulo A (alta de stock). No consume eventos propios para su lógica central en el alcance de este documento.

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `proveedor:estado_cambiado` | 2.2 (manual) y 3.2 (automático) | Módulo D (`audit-log.listener.ts`) | `{ proveedor_id, usuario_id \| null (null si origen automático), estado_anterior, estado_nuevo, origen: "MANUAL" \| "AUTOMATICO", motivo }` |
| `stock:recepcion_confirmada` | 2.6, tras `COMMIT` | Módulo A (listener de alta de stock, `lib/events/listeners/stock-recepcion.listener.ts`) | `{ recepcion_id, orden_compra_id, proveedor_id, items: [{ variante_sku_id, cantidad_recibida }], deposito_destino_id, recibida_por_id }` |
| `comprobante_proveedor:registrado` | 2.7, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ comprobante_id, orden_compra_id, proveedor_id, tipo, numero_comprobante, monto_total, registrado_por_id }` |
| `comprobante_proveedor:anulado` | 2.7, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ comprobante_id, orden_compra_id, proveedor_id, deletion_reason, anulado_por_id }` |

**Eventos diferidos junto con sus HU:** `proveedor:variacion_precio_critica` y `proveedor:legajo_bancario_consultado` no se emiten en Sprint 2 porque dependen de HU-H2 (publicación de listas) y HU-H6 (consola de auditoría) respectivamente, ambas diferidas — ver `spec_modulo_H_diferido.md` sección 4 para su especificación completa.

**Regla de exclusión de datos sensibles en el payload (misma convención que `spec_modulo_D.md` §5.1):** ningún evento de este módulo incluye en su payload el valor en claro de `datos_bancarios`, ni `password`/`password_hash` de `Usuario`. El emisor (capa de servicios del Módulo H) es responsable de excluir estos campos antes de publicar al bus; `audit-log.listener.ts` no realiza sanitización adicional sobre eventos entrantes.

**Nota sobre `deposito_destino_id` en `stock:recepcion_confirmada`:** el schema actual de `Recepcion` (`schema.prisma` líneas 646–671) no incluye un campo de depósito destino explícito. Si el Módulo A requiere ese dato para resolver a qué `Deposito` dar de alta el stock recibido, es un **faltante de schema adicional** a resolver junto con el owner del Módulo A antes de implementar este evento — no asumir un depósito por defecto en el código sin esa definición explícita.

---

## 5. Fuera de Alcance (diferido / bloqueado)

- **HU-H2, HU-H6, HU-H7, HU-H8 completas:** diferidas a un sprint posterior por decisión de planificación del PO (ver nota al inicio de este documento). Especificadas íntegramente en `spec_modulo_H_diferido.md`.
- **Resolución del precio en HU-H3 sin HU-H2 operativa (sección 2.4):** requiere que el equipo elija explícitamente entre Camino A (seed de datos de precio) o Camino B (precio recibido en payload) antes de implementar. Ver advertencia bloqueante en 2.4.
- **Entidad de configuración global para el umbral mínimo de homologación (HU-H5, sección 3.2):** dependencia bloqueante a resolver con el owner de Módulo D si no existe aún en Sprint 2.
- **Endpoint de solicitud de homologación por Comprador (△-solicita, sección 2.2):** mencionado como flujo existente pero no detallado en este documento — fuera de alcance de código.
- **Integración con Módulo I (devoluciones por defecto de fabricación como insumo de `EvaluacionProveedor`, sección 3.2):** el Módulo I no existe en este sprint. `EvaluacionProveedor.devoluciones_fabricacion` es nullable y se carga manualmente por ahora, conforme al comentario ya presente en el schema.
- **Conciliación automática contra factura del proveedor (paso previo a `CERRAR`, sección 2.5):** este documento la modela como un flag operativo manual confirmado por el Comprador. Una integración real con comprobantes fiscales (AFIP, vía Módulo G conforme a `RULES.md` Regla N.° 3) queda fuera de alcance.
- **Integración AFIP / facturación electrónica real (HU-H9, sección 2.7):** HU-H9 especifica exclusivamente la carga **manual** por el Comprador del comprobante ya emitido por el proveedor fuera del sistema — no incluye bajo ninguna forma la emisión de comprobantes, la consulta de padrones de AFIP, ni la validación de CAE. Esto es la misma integración diferida mencionada en el punto anterior (Regla N.° 3): HU-H9 es la entidad de datos que esa nota ya anticipaba, sin cerrar todavía el patrón Adapter/Gateway real hacia AFIP. Si en un sprint futuro se implementa esa integración, `ComprobanteProveedor` (2.7.1) es el modelo candidato a extenderse — no a reemplazarse — con los campos que requiera (ej. CAE, vencimiento de CAE), detrás de un Adapter dedicado, nunca acoplando el dominio directamente al SDK de AFIP.
- **Asociación de `ComprobanteProveedor` a `CuentaPorPagar` (HU-G10, Módulo G):** HU-H9 deja el comprobante disponible como insumo, pero la asociación efectiva a una `CuentaPorPagar` y su uso como condición para que Tesorería marque el pago es HU-G10, fuera de alcance de este documento — ver la nota en 2.7.1 sobre el campo de relación que ese spec va a necesitar preparar en `CuentaPorPagar`.