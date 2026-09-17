# Especificación Técnica — Módulo C (Clientes)
## ERP SWAT Indumentarias — Sprint 3
## Revisión 3 — Sincronización con la entrada de Módulo B al Sprint 3: HU-C7 (2.7) deja de resolver el historial de compras con mock y consulta `PedidoVenta` real; ajustes correspondientes en HU-C3, HU-C5, HU-C8 y sección 5 (Fuera de Alcance) que asumían Módulo B como no construido
## Revisión 2 — Correcciones de auditoría sobre Rev. 1 (HU-C1 a HU-C10): obligatoriedad de dirección de facturación (2.3), detección de posibles duplicados en el alta (2.1/2.5), aclaración de partición de permisos de segmentación/direcciones (2.8), nota sobre discrepancia residual en hoja Consolidado del Backlog

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable) · `Documento de Alcance Funcional y Técnico` (sección Módulo C, vigente al 14/09/2026) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja **Sprint 3**) · `schema.prisma` · `spec_modulo_D.md` · `spec_modulo_H.md` (patrón de referencia para la estructura de este documento)

---

## ⚠️ Directiva del PO — sin condición de IVA ni CUIT/CUIL en Cliente

**Este spec parte de una versión del Alcance posterior a un cambio de criterio del PO (14/09/2026):** una extensión anterior de Módulo C (11/09/2026) había incorporado condición de IVA (Consumidor Final / Responsable Inscripto / Monotributista / Exento) y CUIT/CUIL como datos del cliente, para que el Módulo B derivara automáticamente el tipo de comprobante fiscal. El PO revirtió esa decisión explícitamente para evitar sobrecomplejizar el sistema: **`Cliente` no tiene condición de IVA ni CUIT/CUIL bajo ninguna forma.** La selección del tipo de comprobante (Factura A/Factura B/Ticket) en Módulo B y Módulo G es **manual**, a cargo del Cajero POS al momento de la venta, sin ninguna regla derivada de un dato fiscal del cliente.

Si algún documento del repositorio (spec anterior, PR, comentario de código) todavía refleja la versión con IVA/CUIT, **no es la fuente de verdad** — este documento y el Alcance Funcional vigente (post 14/09/2026) son los que rigen. Reportar cualquier inconsistencia encontrada en el código, no corregirla asumiendo cuál versión es la correcta sin confirmar primero.

**Esto no afecta al Libro de IVA Digital (Módulo G, HU-G4):** ese reporte se construye a partir del comprobante fiscal efectivamente emitido por venta, no de un dato de condición fiscal del lado del cliente, así que sigue siendo un requisito de exportación AFIP válido con independencia de esta directiva.

---

## 1. Visión General

El Módulo C — Clientes constituye la fuente única de verdad sobre la identidad comercial de toda persona que compra en SWAT Indumentarias, sin distinción de a qué organización pertenece: administra sus datos de contacto, su historial de compras y, cuando corresponde, su cuenta corriente. El módulo administra un único tipo de entidad —el Cliente— sin subtipos ni categorías diferenciadas por organismo, fuerza o jerarquía; todo cliente se identifica por su DNI y accede al mismo catálogo general de venta. La única segmentación que el módulo admite es puramente comercial (minorista, mayorista, cliente frecuente — sección 2.4), sin relación con ninguna categorización institucional.

Desde el punto de vista comercial, el objetivo del módulo es agilizar la venta asistida: recuperar de forma instantánea los datos de un cliente recurrente por su DNI reduce el tiempo de atención y el margen de error en la carga de una operación. Desde el punto de vista operativo, sostiene el padrón de clientes que consumen el resto de los módulos —Ventas (B), E-commerce (E), Tesorería (G)— sin necesidad de recargar datos en cada canal.

Bajo Next.js App Router, el módulo se implementa mediante **Route Handlers** (`app/api/clientes/**/route.ts`) para las integraciones consumidas por otros módulos o clientes no-navegador, y **Server Actions** (`app/(dashboard)/clientes/**/actions.ts`) para los formularios operados por Vendedor y Administrador de CRM. Ambas superficies son wrappers finos: **está prohibido implementar lógica de negocio en el `route.ts` o en la Server Action**. Toda regla de dominio se delega exclusivamente en la capa de servicios `lib/services/clientes/*` (`cliente.service.ts`, `consentimiento.service.ts`, `fusion.service.ts`). El handler/action se limita a: (1) resolver la sesión y verificar el permiso granular vía `withPermission("clientes:<accion>")`, (2) parsear y validar el `body` contra el schema Zod correspondiente, (3) invocar la función de servicio, (4) mapear el resultado o la excepción de negocio al shape de respuesta JSON estándar definido en la sección 2.

**Regla N.° 1 aplicada al Módulo C (prohibición absoluta de `DELETE`):** ninguna entidad del módulo —`Cliente`, `DireccionCliente`, `ConsentimientoCliente`— admite una sentencia `DELETE` desde el código de aplicación, bajo ninguna circunstancia ni ningún rol, incluyendo Administrador de CRM. Toda baja se implementa como `UPDATE` sobre los campos estándar `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`. El schema refuerza esta restricción a nivel de integridad referencial: toda relación saliente de las entidades de C usa `onDelete: Restrict`.

**Regla N.° 2 aplicada al Módulo C (protección de datos personales, Ley N.° 25.326):** los datos de contacto de un cliente constituyen información personal alcanzada por la Ley N.° 25.326. El módulo aplica los estándares de protección de datos personales vigentes de forma transversal en el ERP, **sin requerir cifrado ni auditoría reforzada adicionales** más allá del mecanismo transversal de auditoría SHA-256 (sección 2.10) — el módulo no administra categorías de datos sensibles según la definición de la ley (a diferencia de, por ejemplo, los datos bancarios cifrados de Módulo H). Toda alta, modificación o baja lógica sobre un cliente queda registrada de forma inalterable (sección 4).

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### Convenciones generales

- **Route Handlers** (`app/api/**/route.ts`): toda respuesta exitosa devuelve `NextResponse.json({ data, error: null }, { status })`; todo error de negocio devuelve `NextResponse.json({ data: null, error: { code, message } }, { status })`, con `status` semántico (`400` validación Zod, `404` entidad no encontrada, `409` conflicto de estado/unicidad, `422` regla de negocio violada sobre un payload sintácticamente válido).
- **Server Actions** (`"use server"`, ej. `app/(dashboard)/clientes/**/actions.ts`): no retornan `NextResponse` — retornan el objeto plano `{ data, error: null }` o `{ data: null, error: { code, message } }`, con el mismo shape que su Route Handler equivalente.
- Toda ruta requiere sesión autenticada y verificación de permiso granular (Módulo D, RBAC) vía middleware `withPermission("clientes:<accion>")`, conforme a la matriz de permisos de la sección 5 del Documento de Alcance § Módulo C.
- Todo campo `*_id` recibido en un `body` se valida contra el formato `uuid` de Zod; ninguna validación de existencia real contra la base de datos ocurre en el schema Zod — eso es responsabilidad de la capa de servicios.

### 2.1. Alta de Cliente con validación de unicidad por DNI (HU-C1)

**Ruta:** `POST /app/api/clientes/route.ts`
**Server Action equivalente:** `crearCliente()` en `app/(dashboard)/clientes/actions.ts`
**Permiso requerido:** `clientes:crear` (Vendedor, Administrador de CRM)

**Archivo de schemas:** `src/lib/schemas/clientes.schema.ts`

```typescript
import { z } from "zod";

export const CrearClienteSchema = z.object({
  dni: z.string().regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
  nombre: z.string().min(2, "El nombre es obligatorio"),
  telefono: z.string().optional(),
  email: z.string().email("Email inválido").optional(),
  direccion: z.string().optional(),
});
export type CrearClienteInput = z.infer<typeof CrearClienteSchema>;
```

**Comportamiento esperado:**
- El sistema valida la unicidad del DNI antes de crear el registro. Si ya existe un `Cliente` activo con ese `dni`, la operación **no crea un duplicado**: retorna el registro existente (comportamiento idempotente de "recuperar en vez de duplicar", criterio de aceptación explícito de HU-C1) — esto es distinto de un `409 Conflict`; la respuesta es `200 OK` con el registro preexistente, no un error.
- Un cliente dado de alta sin datos adicionales se asume bajo condiciones comerciales estándar por defecto — no existe ningún campo de condición fiscal que default-ear (ver nota de directiva del PO al inicio de este documento).
- Alta transaccional (`prisma.$transaction`) en estado `is_active = true`.
- El alta de un cliente **exige** el registro simultáneo de un `ConsentimientoCliente` (HU-C4, sección 2.4) en la misma transacción — no existe un `Cliente` sin al menos un consentimiento inicial registrado.
- **Alerta de posibles duplicados (no bloqueante):** el servicio de alta ejecuta la verificación de coincidencia aproximada descripta en HU-C5 (sección 2.5) y, de encontrar coincidencias, las incluye en la respuesta bajo `posibles_duplicados` — ver shape debajo. Esto nunca impide ni retrasa la creación del registro.

**Respuesta `201 Created` (alta nueva, sin duplicados detectados):**
```json
{ "data": { "cliente_id": "uuid", "dni": "30123456", "es_nuevo": true, "posibles_duplicados": [] }, "error": null }
```

**Respuesta `201 Created` (alta nueva, con posible duplicado detectado):**
```json
{ "data": { "cliente_id": "uuid", "dni": "30987654", "es_nuevo": true, "posibles_duplicados": [ { "cliente_id": "uuid", "dni": "30123456", "nombre": "Juan Perez" } ] }, "error": null }
```

**Respuesta `200 OK` (DNI ya existente, se recupera el registro):**
```json
{ "data": { "cliente_id": "uuid", "dni": "30123456", "es_nuevo": false }, "error": null }
```

### 2.2. Edición de datos de contacto (HU-C2)

**Ruta:** `PATCH /app/api/clientes/[id]/route.ts`
**Server Action equivalente:** `editarCliente()` en `app/(dashboard)/clientes/actions.ts`
**Permiso requerido:** `clientes:editar` (Vendedor, Administrador de CRM)

```typescript
export const EditarClienteSchema = z.object({
  nombre: z.string().min(2).optional(),
  telefono: z.string().optional(),
  email: z.string().email("Email inválido").optional(),
  direccion: z.string().optional(),
});
export type EditarClienteInput = z.infer<typeof EditarClienteSchema>;
```

**Comportamiento esperado:**
- **El DNI no es editable una vez creado el registro** — el schema de edición no incluye el campo `dni`; si un cliente presenta un DNI distinto, la operación correcta es HU-C5 (fusión de duplicados), nunca una edición directa del campo.
- Toda edición genera un evento de auditoría con `valor_anterior`/`valor_nuevo` hacia el Módulo D (sección 4).
- Solo se actualizan los campos recibidos (`PATCH` parcial) — no se sobreescriben campos no enviados con `null`.

**Respuesta `200 OK`:**
```json
{ "data": { "cliente_id": "uuid", "campos_actualizados": ["telefono", "email"] }, "error": null }
```

**Respuesta `409 Conflict` (intento de editar el DNI):**
```json
{ "data": null, "error": { "code": "DNI_INMUTABLE", "message": "El DNI no puede modificarse una vez creado el registro del cliente" } }
```

### 2.3. Direcciones múltiples y canal de contacto preferido (HU-C3, HU-C9)

**Ruta (alta de dirección):** `POST /app/api/clientes/[id]/direcciones/route.ts`
**Ruta (listado de direcciones):** `GET /app/api/clientes/[id]/direcciones/route.ts`
**Ruta (canal de contacto):** `PATCH /app/api/clientes/[id]/canal-contacto/route.ts`
**Server Action equivalente:** `agregarDireccionCliente()`, `actualizarCanalContacto()` en `app/(dashboard)/clientes/actions.ts`
**Permiso requerido:** `clientes:editar` (mismo permiso que HU-C2 — direcciones y canal de contacto son parte de la ficha editable del cliente, no requieren un permiso separado).

```typescript
export const AgregarDireccionClienteSchema = z.object({
  rotulo: z.string().min(1, "El rótulo es obligatorio (ej. 'Casa', 'Depósito')"),
  tipo: z.enum(["FACTURACION", "ENVIO"]),
  direccion_completa: z.string().min(5, "La dirección es obligatoria"),
});
export type AgregarDireccionClienteInput = z.infer<typeof AgregarDireccionClienteSchema>;

export const ActualizarCanalContactoSchema = z.object({
  canal_preferido: z.enum(["WHATSAPP", "EMAIL", "AMBOS"]),
});
export type ActualizarCanalContactoInput = z.infer<typeof ActualizarCanalContactoSchema>;
```

**Comportamiento esperado:**
- Un cliente puede registrar más de una dirección, cada una con un `rotulo` identificador libre (ej. "Casa", "Depósito", "Sucursal 2") y un `tipo` (`FACTURACION` o `ENVIO`). Las direcciones de tipo `ENVIO` son opcionales y sin límite de cantidad.
- **Obligatoriedad de la dirección de facturación (criterio de aceptación HU-C3):** si un cliente registra al menos una dirección, debe existir entre ellas una de tipo `FACTURACION` — la capa de servicios (`cliente.service.ts` / módulo de direcciones) rechaza el alta de una dirección `ENVIO` como única dirección del cliente si no existe previamente ninguna `FACTURACION` activa. Esta obligatoriedad es puramente estructural (garantizar que exista un domicilio de facturación utilizable por Módulo B/G) y no depende, bajo ninguna forma, de una condición fiscal del cliente (ver directiva del PO al inicio de este documento) — un cliente sin ninguna dirección registrada no está obligado a tener una, la regla solo aplica una vez que decide cargar la primera.
- **Sin condición de IVA:** no existe ningún campo ni regla que condicione la obligatoriedad de una dirección de facturación a una condición fiscal del cliente (ver directiva del PO al inicio de este documento).
- El campo `canal_preferido` es un atributo simple del `Cliente` (no requiere entidad propia), editable en cualquier momento, consumido por el Motor de Notificaciones (Módulo F, todavía no construido — el contrato de lectura queda documentado como integración pendiente, no bloquea esta HU).
- Las direcciones se listan siempre filtradas por `is_active = true` salvo consulta de Auditor.

**Respuesta `201 Created` (alta de dirección):**
```json
{ "data": { "direccion_id": "uuid", "rotulo": "Depósito", "tipo": "ENVIO" }, "error": null }
```

**Respuesta `200 OK` (canal de contacto actualizado):**
```json
{ "data": { "cliente_id": "uuid", "canal_preferido": "AMBOS" }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (primera dirección cargada es de tipo `ENVIO`, sin `FACTURACION` previa):**
```json
{ "data": null, "error": { "code": "DIRECCION_FACTURACION_REQUERIDA", "message": "Debe existir al menos una dirección de tipo FACTURACION antes de registrar una dirección de envío" } }
```

### 2.4. Gestión de consentimiento de tratamiento de datos personales (HU-C4)

**Ruta (alta):** `POST /app/api/clientes/[id]/consentimientos/route.ts`
**Ruta (revocación):** `PATCH /app/api/clientes/[id]/consentimientos/[consentimiento_id]/revocar/route.ts`
**Server Action equivalente:** `registrarConsentimiento()`, `revocarConsentimiento()` en `app/(dashboard)/clientes/actions.ts`
**Permiso requerido:** `clientes:gestionar_consentimiento` (Vendedor, Administrador de CRM)

```typescript
export const RegistrarConsentimientoSchema = z.object({
  alcance: z.enum(["VENTA_ASISTIDA", "COMUNICACIONES_COMERCIALES", "AMBOS"]),
  finalidad: z.string().min(1, "La finalidad debe especificarse"),
});
export type RegistrarConsentimientoInput = z.infer<typeof RegistrarConsentimientoSchema>;

export const RevocarConsentimientoSchema = z.object({
  motivo: z.string().min(1, "El motivo de revocación es obligatorio"),
});
export type RevocarConsentimientoInput = z.infer<typeof RevocarConsentimientoSchema>;
```

**Comportamiento esperado:**
- El consentimiento se modela como **entidad propia** (`ConsentimientoCliente`), no como un campo `boolean` en `Cliente` — criterio de aceptación explícito de HU-C4, necesario para conservar trazabilidad completa de cambios (fecha, alcance, finalidad) a lo largo del tiempo.
- Todo alta de `Cliente` (sección 2.1) exige un `ConsentimientoCliente` inicial en la misma transacción.
- La revocación de un consentimiento de alcance `COMUNICACIONES_COMERCIALES` **no afecta** la operatoria esencial del registro del cliente (puede seguir comprando, seguir siendo consultado por DNI, etc.) — solo deja de ser lícito enviarle comunicaciones comerciales.
- La revocación es baja lógica sobre el `ConsentimientoCliente` (no elimina el registro histórico): `is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason` (reutilizando el campo `motivo` recibido).

**Respuesta `201 Created`:**
```json
{ "data": { "consentimiento_id": "uuid", "alcance": "AMBOS", "fecha_consentimiento": "2026-09-14T10:00:00.000Z" }, "error": null }
```

**Respuesta `200 OK` (revocación):**
```json
{ "data": { "consentimiento_id": "uuid", "revocado": true }, "error": null }
```

### 2.5. Unificación de clientes duplicados (HU-C5)

**Ruta:** `POST /app/api/clientes/fusionar/route.ts`
**Server Action equivalente:** `fusionarClientes()` en `app/(dashboard)/clientes/actions.ts`
**Permiso requerido:** `clientes:fusionar` (exclusivo Administrador de CRM — el Vendedor solo puede *solicitar* la fusión vía un flujo fuera de alcance de este documento, conforme matriz RBAC del Documento de Alcance § Módulo C, sección 5).

```typescript
export const FusionarClientesSchema = z.object({
  cliente_primario_id: z.string().uuid(),
  cliente_secundario_id: z.string().uuid(),
}).refine(
  (d) => d.cliente_primario_id !== d.cliente_secundario_id,
  { message: "El cliente primario y secundario no pueden ser el mismo registro", path: ["cliente_secundario_id"] }
);
export type FusionarClientesInput = z.infer<typeof FusionarClientesSchema>;
```

**Comportamiento esperado:**
- **Detección de posibles duplicados en el alta (criterio de aceptación de HU-C5, ausente en la Rev. 0 de este documento):** el alta de Cliente (2.1) ya resuelve el caso de DNI **idéntico** a uno activo devolviendo el registro existente — eso cubre unicidad exacta, pero no la detección de un *posible* duplicado con datos similares pero no idénticos (ej. mismo nombre y teléfono con un DNI mal tipeado). Esta HU agrega una verificación adicional, de solo alerta, en `cliente.service.ts`: al recibir un alta (2.1), el servicio ejecuta una búsqueda de coincidencia aproximada por `nombre` + (`telefono` o `email`) contra clientes activos con DNI distinto; si encuentra coincidencia, el alta **no se bloquea** — se completa normalmente y la respuesta `201 Created` incluye un campo adicional `posibles_duplicados: [{ cliente_id, dni, nombre }]` para que el Vendedor decida, desde la UI, si conviene iniciar una fusión (este mismo endpoint, 2.5) en vez de operar con dos registros separados. La decisión de fusionar es siempre manual y posterior al alta — la detección es informativa, nunca bloqueante.
- **Ningún registro se elimina ni se reescribe físicamente.** El patrón de fusión (criterio de aceptación explícito de HU-C5) desactiva el `cliente_secundario_id` mediante baja lógica con `deletion_reason: "duplicado"` fijo (no editable por quien ejecuta la fusión, para mantener el motivo estandarizado y filtrable en reportes).
- Las referencias históricas del cliente secundario (fundamentalmente su historial de ventas, cuando exista Módulo B) se **re-vinculan lógicamente** al cliente primario mediante una relación de redirección (`Cliente.fusionado_en_id`, ver 2.5.1) — no se migran físicamente las filas originales de ningún otro módulo.
- Ninguno de los dos registros originales se sobrescribe: el cliente primario conserva sus propios datos de contacto sin mezclarse con los del secundario; el cliente secundario conserva sus datos históricos intactos, solo desactivado y con la relación de redirección.
- **Nota de integración pendiente (Módulo B):** hoy no existen ventas reales que re-vincular, porque Módulo B no está construido. El mecanismo de redirección se implementa y testea con datos de prueba (clientes de prueba con DNI potencialmente duplicado, cargados en el seed) — cuando Módulo B exista, debe consultar `Cliente.fusionado_en_id` para resolver el historial de compras del cliente primario incluyendo lo heredado del secundario.

#### 2.5.1. Campo de redirección — modelo de datos

```prisma
// En el modelo Cliente (ver sección de Modelo de Datos si se agrega en una
// revisión posterior de este documento, o en schema.prisma directamente):
//   fusionado_en_id String?  — referencia al Cliente primario cuando este
//   registro fue desactivado por fusión; null en el caso normal.
//   Relación: fusionado_en Cliente? @relation("FusionCliente", fields: [fusionado_en_id], references: [id], onDelete: Restrict)
```

**Respuesta `200 OK`:**
```json
{ "data": { "cliente_primario_id": "uuid", "cliente_secundario_id": "uuid", "fusion_aplicada": true }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (secundario ya fusionado previamente):**
```json
{ "data": null, "error": { "code": "CLIENTE_YA_FUSIONADO", "message": "El cliente secundario ya fue fusionado previamente hacia otro registro" } }
```

### 2.6. Baja lógica de Cliente (HU-C6)

**Ruta:** `PATCH /app/api/clientes/[id]/baja/route.ts`
**Server Action equivalente:** `darDeBajaCliente()` en `app/(dashboard)/clientes/actions.ts`
**Permiso requerido:** `clientes:baja` (exclusivo Administrador de CRM — el Vendedor solo puede *solicitar*, conforme matriz RBAC sección 5).

```typescript
export const DarDeBajaClienteSchema = z.object({
  deletion_reason: z.string().min(1, "El motivo de baja es obligatorio"),
});
export type DarDeBajaClienteInput = z.infer<typeof DarDeBajaClienteSchema>;
```

**Comportamiento esperado:**
- Exige motivo obligatorio. Setea `is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason`.
- **No afecta en absoluto** la consulta de su historial de compras previo (cuando exista Módulo B), que permanece íntegro y accesible de forma permanente — la baja lógica es reversible en términos de consulta, no de operatoria (un cliente dado de baja no puede operar, pero su historial sigue siendo consultable).

**Respuesta `200 OK`:**
```json
{ "data": { "cliente_id": "uuid", "is_active": false }, "error": null }
```

### 2.7. Consulta unificada por DNI (HU-C7)

**Ruta:** `GET /app/api/clientes/buscar/route.ts?dni=<dni>`
**Server Action equivalente:** ninguna — es un caso de uso de consulta pura para uso en tiempo real desde POS, consumido directamente vía Route Handler.
**Permiso requerido:** `clientes:leer` (Vendedor, Administrador de CRM, Auditor — `✓` directo para los tres conforme matriz RBAC sección 5, "Consultar cliente e historial de compras").

```typescript
export const BuscarClientePorDniQuerySchema = z.object({
  dni: z.string().regex(/^\d{7,8}$/, "El DNI debe tener 7 u 8 dígitos"),
});
export type BuscarClientePorDniQuery = z.infer<typeof BuscarClientePorDniQuerySchema>;
```

**Comportamiento esperado:**
- La consulta se resuelve en una **única llamada** (criterio de aceptación explícito: "evitando múltiples consultas secuenciales en el momento de la atención"): devuelve datos de contacto, direcciones (sección 2.3) y canal de contacto preferido, todos resueltos internamente por el mismo servicio — el cliente de la API (el frontend de POS) no debe encadenar múltiples requests.
- **Bloque de historial de compras (actualizado — Módulo B ya forma parte de este mismo sprint):** el criterio de aceptación exige incluir un resumen del Módulo B (fecha de última compra, monto total histórico, cantidad de operaciones) "recuperado del Módulo B mediante una consulta de solo lectura, sin que ese resumen constituya una copia propia de los datos transaccionales". Con Módulo B priorizado en Sprint 3 (HU-B1/B3 secuenciadas antes que esta HU, ver Sprint Backlog), este bloque **ya no se resuelve con mock**: `resolverHistorialCompras(cliente_id)` consulta directamente `PedidoVenta` de Módulo B (`spec_modulo_B.md` sección 3.1), filtrando por `cliente_id` y `estado` en `{FACTURADO, REMITO_EMITIDO, CERRADO}` (excluyendo `RESERVADO`/`ANULADO`, los únicos dos estados que puede tomar un `PedidoVenta` sin constituir una compra efectiva — `BORRADOR` es un estado de `Presupuesto`, no de `PedidoVenta`, que nace directamente en `RESERVADO`), y agregando `ultima_compra` (máximo de `fecha_facturacion`), `monto_total_historico` (suma de montos facturados) y `cantidad_operaciones` (conteo). Es una consulta de solo lectura entre módulos — Módulo C no duplica ni cachea estos datos en su propio schema, los resuelve on-demand en cada consulta unificada.
- Si el DNI no corresponde a ningún cliente activo, `404` — el frontend de POS interpreta esto como "cliente no registrado, ofrecer alta rápida" (HU-C1), no como un error bloqueante.

**Respuesta `200 OK`:**
```json
{
  "data": {
    "cliente_id": "uuid",
    "dni": "30123456",
    "nombre": "Juan Pérez",
    "telefono": "3874001234",
    "email": "juan.perez@example.com",
    "direcciones": [ { "direccion_id": "uuid", "rotulo": "Casa", "tipo": "ENVIO" } ],
    "canal_preferido": "WHATSAPP",
    "historial_compras": {
      "ultima_compra": "2026-09-10T15:30:00.000Z",
      "monto_total_historico": 128500.00,
      "cantidad_operaciones": 4
    }
  },
  "error": null
}
```

**Respuesta `404 Not Found`:**
```json
{ "data": null, "error": { "code": "CLIENTE_NO_ENCONTRADO", "message": "No existe un cliente activo con el DNI 30123456" } }
```

### 2.8. Segmentación comercial (HU-C8)

**Ruta:** `PATCH /app/api/clientes/[id]/segmento/route.ts`
**Server Action equivalente:** `actualizarSegmentoCliente()` en `app/(dashboard)/clientes/actions.ts`
**Permiso requerido:** `clientes:gestionar_segmento` (Vendedor, Administrador de CRM — conforme matriz RBAC sección 5, "Gestionar segmentación comercial y direcciones de un cliente").

**Nota de diseño sobre la partición de este permiso (aclaración, no una desviación de acceso):** el Alcance Funcional modela "Gestionar segmentación comercial y direcciones de un cliente" como una única fila de matriz con un solo nivel de acceso (Vendedor ✓, Administrador de CRM ✓, Auditor ✗). Este documento la implementa como **dos permisos granulares distintos** — `clientes:gestionar_segmento` aquí, y `clientes:editar` para direcciones (sección 2.3) — en vez de un único permiso combinado `clientes:gestionar_segmento_y_direcciones`. Los dos roles habilitados son idénticos a los que exige el Alcance para ambas acciones, por lo que no hay ninguna divergencia de quién puede hacer qué; la partición es una decisión de granularidad de RBAC (permitir revocar acceso a uno de los dos sin afectar el otro en un futuro cambio de rol), no una ampliación ni restricción de acceso respecto de la matriz vigente. Si el equipo prefiere un único permiso combinado que refleje literalmente la fila del Alcance, es un cambio de nomenclatura sin impacto funcional — reportar antes de implementar si se opta por esa alternativa.

```typescript
export const ActualizarSegmentoClienteSchema = z.object({
  segmento: z.enum(["MINORISTA", "MAYORISTA", "CLIENTE_FRECUENTE"]),
});
export type ActualizarSegmentoClienteInput = z.infer<typeof ActualizarSegmentoClienteSchema>;
```

**Comportamiento esperado:**
- `MINORISTA` es el segmento por defecto de todo cliente que no cumple los criterios de volumen de compra configurados para `MAYORISTA` (default de schema, no requiere una llamada explícita a este endpoint para clientes recién dados de alta).
- `MAYORISTA` se asigna cuando el volumen de compra —histórico o de un pedido puntual de gran volumen— supera el umbral parametrizado por Dirección; habilita las condiciones de precio y plan de pagos de Módulo B (`spec_modulo_B.md` sección 2.5, HU-B5) — la asignación del segmento en sí sigue siendo manual en este sprint (ver "Fuera de Alcance", sección 5), independientemente de que Módulo B ya exista como consumidor.
- `CLIENTE_FRECUENTE` se asigna de forma incremental cuando la frecuencia o el monto acumulado de compras supera el umbral configurado; habilita promociones específicas de Módulo B/E, sin alterar el límite de crédito de la cuenta corriente.
- Un cliente puede migrar de segmento en cualquier momento sin perder su historial de compras ni su cuenta corriente. La segmentación **no** implica ningún tratamiento diferenciado de datos personales ni restricción de catálogo.
- **Faltante de configuración global (no bloqueante para esta HU, sí para su consumo automático futuro):** los umbrales de volumen/frecuencia que determinarían la asignación automática de segmento no existen aún como entidad de configuración parametrizable por Dirección — mientras tanto, la asignación de segmento es manual vía este endpoint, no un cálculo automático disparado por eventos de venta (que no existen, al no existir Módulo B).

**Respuesta `200 OK`:**
```json
{ "data": { "cliente_id": "uuid", "segmento_anterior": "MINORISTA", "segmento_nuevo": "MAYORISTA" }, "error": null }
```

### 2.9. Log de auditoría de Clientes (HU-C10)

**Ruta:** `GET /app/api/clientes/auditoria/route.ts`
**Permiso requerido:** `auditoria:leer_historico` sobre el dominio `clientes` (exclusivo Auditor y Administrador de CRM, conforme matriz RBAC sección 5 — "Consultar el log de auditoría de clientes": `✓` para ambos roles, `✗` para Vendedor).

**Principio de diseño no negociable (mismo criterio que HU-H6, `spec_modulo_H.md` sección 2.9):** este endpoint **no** recalcula ni reimplementa el encadenamiento SHA-256. El Módulo C no es propietario del `AuditLog` ni de la lógica de verificación de cadena — ambos son responsabilidad exclusiva del Módulo D. Este Route Handler delega en `listarEventosPorDominio(dominio: "clientes", filtros)`, la misma función de servicio del Módulo D reutilizada por Módulo H.

```typescript
export const ConsultarAuditoriaClientesQuerySchema = z.object({
  cliente_id: z.string().uuid().optional(),
  tipo_evento: z.enum([
    "cliente:creado",
    "cliente:actualizado",
    "cliente:baja_logica",
    "cliente:fusionado",
    "cliente:consentimiento_registrado",
    "cliente:consentimiento_revocado",
  ]).optional(),
  usuario_id: z.string().uuid().optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  verificar_integridad: z.coerce.boolean().default(false),
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(50).default(20),
});
export type ConsultarAuditoriaClientesQuery = z.infer<typeof ConsultarAuditoriaClientesQuerySchema>;
```

**Comportamiento esperado:**
- Consulta de solo lectura sobre `AuditLog`, filtrada por los `tipo_evento` propios de este módulo (ver enum, alineado 1:1 con la tabla de eventos de la sección 4).
- Mismo contrato de `verificar_integridad` que HU-H6/HU-A6/HU-D4: opt-in explícito, nunca ejecutado por defecto en cada listado.
- Los registros son append-only por herencia del `AuditLog` — este endpoint no expone ninguna operación de edición o borrado.

**Respuesta `200 OK`:** mismo shape que `spec_modulo_H.md` sección 2.9 (paginación + `verificacion_integridad`), sustituyendo el dominio de los eventos.

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. Máquina de estados de baja lógica y fusión de `Cliente`

| Estado / condición | Transición | Resultado | Precondición |
|---|---|---|---|
| — | Alta (2.1) | `is_active = true`, `fusionado_en_id = null` | DNI válido; si ya existe, se recupera el registro existente (no hay transición nueva) |
| `is_active = true` | Baja lógica (2.6) | `is_active = false` | `deletion_reason` obligatorio; exclusivo Administrador de CRM |
| `is_active = true` (como secundario) | Fusión (2.5) | `is_active = false`, `fusionado_en_id = <primario>`, `deletion_reason = "duplicado"` | Exclusivo Administrador de CRM; el cliente primario no cambia de estado |

No existe transición de reactivación (`is_active = false → true`) para `Cliente` en el alcance de este sprint — a diferencia de HU-D7 (Módulo D, reactivación de usuarios), el Backlog no exige esta operación para clientes; si se requiere en un sprint futuro, es una HU nueva a especificar, no una extensión silenciosa de este documento.

### 3.2. Inmutabilidad del DNI y de la relación de fusión

- `Cliente.dni` es inmutable después del alta (ver 2.2) — ninguna función de servicio expone una vía de actualización de este campo, ni siquiera para Administrador de CRM.
- `Cliente.fusionado_en_id`, una vez seteado por una fusión (2.5), es igualmente inmutable — no existe una operación de "deshacer fusión". Si una fusión fue un error, la corrección documentada es un procedimiento manual fuera de alcance de este spec (análogo al criterio de "alta errónea" de `spec_modulo_H.md` sección 3.5), no una reversión automática.

### 3.3. Auditoría transversal SHA-256 (sin cifrado adicional)

- A diferencia de Módulo H (datos bancarios cifrados con AES-256), Módulo C **no cifra** ningún campo de `Cliente` — el Alcance Funcional es explícito: "el módulo no administra categorías de datos sensibles según la definición de la ley" (Ley N.° 25.326, sección 6.1 del Alcance). El único mecanismo de protección aplicado es el encadenamiento SHA-256 transversal del `AuditLog` (Módulo D), igual que el resto del sistema.
- Toda mutación de `Cliente`, `DireccionCliente` o `ConsentimientoCliente` (alta, edición, baja, fusión, registro/revocación de consentimiento) emite su evento correspondiente **después** del `COMMIT` de la transacción que la persiste — nunca dentro de ella, mismo patrón fire-and-forget que el resto del sistema (ver `spec_modulo_H.md` sección 3.4, hallazgo de `spec_modulo_D.md` sobre este mismo patrón).

### 3.4. Restricción de borrado físico y patrón de baja lógica

- Todas las relaciones de Prisma salientes de las entidades del Módulo C usan `onDelete: Restrict`.
- Ninguna función de servicio del Módulo C expone o invoca `prisma.<modelo>.delete()` ni `deleteMany()`, bajo ninguna condición.
- Toda consulta operativa por defecto (listados, búsqueda por DNI) filtra `is_active = true`, salvo que quien consulta sea Auditor (o Administrador de CRM para el log de auditoría, sección 2.9).

---

## 4. Eventos de Dominio (EDA)

**Archivo:** `src/lib/events/event-types.ts` (extiende la tabla ya definida en `spec_modulo_D.md` §5, siguiendo el mismo patrón de namespacing usado por Módulo A `stock:*` y Módulo H `proveedor:*`)

El Módulo C es **emisor** hacia el Módulo D (encadenamiento SHA-256). No consume eventos propios para su lógica central en el alcance de este documento — es, en cambio, **consultado** (no vía eventos, sino vía llamada de solo lectura) por Módulo B, Módulo E y Módulo F cuando esos módulos existan.

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `cliente:creado` | 2.1, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ cliente_id, dni, usuario_id, es_nuevo: boolean }` |
| `cliente:actualizado` | 2.2, 2.3, 2.8, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ cliente_id, usuario_id, campos_modificados[], valor_anterior, valor_nuevo }` |
| `cliente:baja_logica` | 2.6, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ cliente_id, usuario_id, deletion_reason }` |
| `cliente:fusionado` | 2.5, tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ cliente_primario_id, cliente_secundario_id, usuario_id }` |
| `cliente:consentimiento_registrado` | 2.4 (alta), tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ consentimiento_id, cliente_id, usuario_id, alcance, finalidad }` |
| `cliente:consentimiento_revocado` | 2.4 (revocación), tras `COMMIT` | Módulo D (`audit-log.listener.ts`) | `{ consentimiento_id, cliente_id, usuario_id, motivo }` |

**Regla de exclusión de datos sensibles en el payload (misma convención que `spec_modulo_D.md` §5.1 y `spec_modulo_H.md` sección 4):** aunque Módulo C no cifra datos, el payload de eventos igualmente evita incluir el email o teléfono completo del cliente cuando no es estrictamente necesario para el registro de auditoría (preferir `cliente_id` como referencia y dejar que la consulta de detalle, si se necesita, se resuelva contra la tabla `Cliente` vigente, no contra una copia en el log).

**Sin eventos nuevos en HU-C7 y HU-C9:** la consulta unificada por DNI (2.7) es de solo lectura y no emite evento propio; la actualización del canal de contacto preferido (2.3) sí se cubre bajo `cliente:actualizado` (no es un evento separado).

**Sin evento nuevo para la detección de posibles duplicados (2.1):** la verificación de coincidencia aproximada introducida en HU-C5 (ver 2.1 y 2.5) es una consulta de solo lectura ejecutada dentro del flujo de alta — no persiste ningún estado propio ni requiere trazabilidad independiente; el alta en sí ya queda registrada por `cliente:creado`. Solo la fusión efectivamente ejecutada (una decisión humana posterior) emite `cliente:fusionado`.

---

## 5. Fuera de Alcance (diferido / bloqueado)

- **Condición de IVA / CUIT / CUIL como dato de Cliente:** explícitamente descartado por directiva del PO (14/09/2026) — ver nota al inicio de este documento. No reintroducir sin una nueva directiva explícita del PO documentada en `decisions-and-principles.md` o equivalente.
- **Consumo real de HU-C3 (direcciones) por Módulo E (envíos):** Módulo E (E-commerce) no está en el alcance de Sprint 3 — el dato de direcciones se modela y persiste en este sprint, el consumo real por parte de un futuro checkout web queda pendiente de que ese módulo se construya. (El consumo por Módulo B ya no aplica a este ítem: Módulo B, priorizado en este mismo sprint, no consume directamente `DireccionCliente` — su único punto de integración con Módulo C es la consulta unificada de HU-C7, sección 2.7.)
- ~~Consumo real de HU-C7 (historial de compras) por Módulo B~~ — **ya no aplica.** Módulo B fue sumado al alcance de Sprint 3 por directiva del PO con posterioridad a la Revisión 2 de este documento; HU-C7 (sección 2.7) ya consulta `PedidoVenta` real, sin mock.
- **Consumo real de HU-C9 (canal de contacto preferido) por Módulo F (Motor de Notificaciones):** el dato se modela y persiste en este sprint; el consumo real queda pendiente de que ese módulo se construya.
- **Consumo real de HU-C5 (fusión) sobre historial de ventas real:** con Módulo B ya priorizado en este sprint, la re-vinculación de historial de ventas del cliente secundario hacia el primario (`Cliente.fusionado_en_id`, sección 2.5.1) puede validarse contra `PedidoVenta` real una vez que HU-B1/B3 generen datos — HU-C5 está secuenciada después de ambas en el Sprint Backlog para permitir justamente esto. Sigue siendo responsabilidad de `resolverHistorialCompras` (sección 2.7) resolver esa consulta contra Módulo C.
- **Cuenta corriente de Cliente (Alcance § Módulo C, sección 3.3; Backlog HU-B5) — actualizado:** HU-B5 (cuenta corriente + plan de pagos) sí fue priorizada en Sprint 3, sumada junto con el resto de Módulo B. Este documento sigue sin modelar ningún campo de cuenta corriente en `Cliente` — la entidad `CuentaCorrienteCliente` y toda su lógica de negocio son propiedad de `spec_modulo_B.md` (sección 2.5), que la referencia por `cliente_id`; Módulo G sigue siendo el consumidor de su plan de pagos para la proyección de flujo de ingresos, sin cambios respecto de lo ya documentado en el Alcance.
- **Entidad de configuración global para umbrales de segmentación comercial (sección 2.8):** el umbral de volumen/frecuencia que definiría `MAYORISTA`/`CLIENTE_FRECUENTE` de forma automática no existe aún como configuración parametrizable — la asignación de segmento es manual en este sprint.
- **Reactivación de un `Cliente` dado de baja lógica:** no forma parte del alcance de las 10 HU de este sprint (ver nota en sección 3.1) — a diferencia de HU-D7 (Módulo D), no hay una HU equivalente para Cliente en el Backlog actual.
- **Confirmación de la función `listarEventosPorDominio` del Módulo D (sección 2.9):** este documento asume su existencia (ya asumida también por `spec_modulo_H.md` sección 2.9 para HU-H6) — verificar con el owner de Módulo D antes de implementar, una sola vez para ambos módulos si es posible.
