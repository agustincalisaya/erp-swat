# Especificación Técnica — Módulo B (Ventas y Punto de Venta - POS)
## ERP SWAT Indumentarias — Sprint 3
## Revisión 5 — HU-B6 implementada (rama `feature/HU-B6`, commit `2433f81`). Corrige el contrato de 2.6 definido en la Rev. 4 contra lo que confirmó la implementación real: (1) el query schema pasa a `page`/`page_size` (no `pagina`/`por_pagina`) y a `verificar_integridad: z.enum(["true","false"]).transform(...)` (no `z.coerce.boolean()`, que probado contra el endpoint real trataba `?verificar_integridad=false` como `true`); (2) el alcance del Supervisor de Ventas se resuelve con **una sola query con `OR`** y paginación en base — no con el filtrado en memoria que describía la Rev. 4; (3) se agrega el filtro `pedido_venta_id` como `OR` entre `registro_id` (descuento/precio) y el path JSON `valor_nuevo.pedido_venta_id` (excepción de crédito, donde `registro_id` es la operación de cuenta corriente, no el pedido) — caso no contemplado en la Rev. 4; (4) la verificación de integridad se implementa como función propia del dominio ventas (`verificarCadenaHashesVentas()`), porque ni la de Módulo A ni la de Módulo D aceptan parámetros de dominio; (5) se corrige el texto sobre `auditoria:leer_historico`: `seed.ts` **sí** lo asigna a `AUDITOR`/`MASTER` (no "sin asignar a ningún Rol", como decía la Rev. 4) — esto no cambia el permiso real que usa el endpoint (`auditoria:leer_forense`), solo corrige una afirmación inexacta sobre el seed. Detalle completo del relevamiento y las decisiones de implementación en `HU6_MODULO_B.md`.
## Revisión 4 — Corrección de HU-B6 (2.6): el permiso `auditoria:leer_historico` y la función `listarEventosPorDominio` citados en la Rev. 0/2 nunca se implementaron en Módulo D — confirmado contra `seed.ts` (el permiso quedó sembrado como stub, sin asignar a ningún Rol, con comentario explícito del equipo documentando la divergencia) y contra el patrón real ya shippeado de HU-A6 (`spec_modulo_A.md`, `HU7_MODULO_A.md`, en `develop`). El código real usa el permiso `auditoria:leer_forense` (rol AUDITOR) y un servicio propio por módulo que consulta `AuditLog` directamente filtrado por `accion`, sin ninguna función compartida de "por dominio" en Módulo D. Se corrige el contrato de 2.6 en consecuencia, se fija el contrato de alcance del Supervisor de Ventas (sin definir en revisiones anteriores) y se agrega `venta:excepcion_credito_resuelta` al enum `tipo_evento` (evento sensible agregado por HU-B5 en la Rev. 3, ausente del enum original pese a que la sección decía estar "alineada 1:1" con la tabla de eventos de la sección 4).
## Revisión 3 — Correcciones sobre Rev. 2 (HU-B5): endpoint faltante de resolución de excepción de crédito (2.5, `PATCH .../operaciones/[id]/resolver`, cierra el permiso `ventas:autorizar_excepcion_credito` que estaba definido sin ruta propia) y corrección del shape de la respuesta `422 LIMITE_CREDITO_EXCEDIDO` para incluir `error.details.operacion_id`
## Revisión 2 — Correcciones de auditoría sobre Rev. 1: endpoint faltante de anulación de Pedido de Venta (2.8, cierra la fila RBAC "Anular un pedido" del Alcance), contrato de acceso reducido de Supervisor de Ventas al log de auditoría (2.6, antes solo mencionado sin schema/endpoint propio)
## Revisión 1 — Primera especificación técnica del módulo (HU-B1 a HU-B7)

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 16 (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · TypeScript · Zod
**Referencias normativas:** `RULES.md` (Regla N.° 1 — Restricción Estricta de Borrado Físico; Regla N.° 2 — Protección de Datos Personales y Trazabilidad Inalterable) · `Documento de Alcance Funcional y Técnico` (sección Módulo B, vigente) · `Product Backlog — SWAT Indumentarias.xlsx` (hoja **Sprint 3**, HU-B1 a HU-B7 ya actualizadas sin integración real a AFIP) · `schema.prisma` · `spec_modulo_A.md` (sección 2.9, servicio de reserva consumido por este módulo; sección 2.10/HU-A6, patrón real de consola de auditoría forense por dominio) · `spec_modulo_C.md` (integración de datos de cliente) · `spec_modulo_D.md` (RBAC y auditoría) · `spec_modulo_H.md` (patrón de referencia de formato) · `seed.ts` (RBAC real sembrado, incluida la nota de divergencia de `auditoria:leer_historico`)

---

## ⚠️ Directiva del PO — sin integración real con AFIP

Este spec parte de una versión del Backlog posterior a una segunda directiva del PO (misma sesión que la corrección de HU-C3): **se elimina del alcance del proyecto la integración técnica real con el servicio de AFIP** (WSFEV1, autenticación, obtención de CAE real, consulta de contingencia real del servicio externo). El sistema **sigue emitiendo** comprobantes Factura A, Factura B y Ticket, con CAE y código QR — pero ambos son **generados de forma local por el propio sistema**, sin invocar ningún servicio externo de AFIP.

Esto afecta directamente a **HU-B7** (reescrita por completo en el Backlog, SP bajado de 8 a 3) y tiene impacto de redacción menor en **HU-B1** y **HU-B5** (se sacó la palabra "AFIP" de sus criterios de aceptación, sin cambio de comportamiento real). Si algún documento del repositorio (Alcance Funcional, código, comentario) todavía asume una integración real con AFIP en el circuito de Ventas, **no es la fuente de verdad** — este documento y el Backlog vigente (hoja Sprint 3) son los que rigen. Reportar cualquier inconsistencia encontrada, no corregirla asumiendo cuál versión es la correcta sin confirmar primero.

**Esto no afecta al enum `OrigenReserva` de Módulo A.** Es un hallazgo separado, no resuelto por decisión explícita del equipo (ver sección 5, "Fuera de Alcance"): el enum sigue teniendo los valores `SENIA`, `LICITACION`, `PEDIDO_INSTITUCIONAL` tal como están hoy en `schema.prisma`, con residuo terminológico del modelo institucional descartado. Este documento usa esos valores tal cual existen, sin renombrarlos — HU-B3 (cotización + reserva) invoca el servicio de reserva de Módulo A pasando `origen_reserva: "LICITACION"` o `"PEDIDO_INSTITUCIONAL"` para un pedido de cotización previa de gran volumen, hasta que el equipo decida abordar ese rename como tarea aparte.

---

## 1. Visión General

El Módulo B — Ventas y Punto de Venta constituye la capa de realización de negocio del ERP: es el punto exacto en el que el stock administrado por el Módulo A se transforma en ingreso económico. El módulo sostiene un único modelo comercial de venta, aplicable a cualquier cliente sin distinción de a qué organización pertenece — una venta de mostrador ágil en el POS, o una venta con cotización previa y cuenta corriente cuando el volumen o la modalidad de pago del cliente lo justifica. Ambos casos comparten el mismo catálogo, el mismo inventario (Módulo A) y el mismo modelo de dominio de Orden de Venta, diferenciándose únicamente por el subconjunto de estados que efectivamente recorren.

Toda operación de venta atraviesa, conceptualmente, cinco etapas: Cotización/Presupuesto → Pedido/Reserva → Facturación → Remito de Entrega → Cierre. El circuito con cotización previa (HU-B3) recorre las cinco de forma secuencial y documentada; el circuito retail (HU-B1) colapsa la cotización y el pedido en el momento del cobro, y el remito de entrega coincide con la entrega física inmediata del artículo.

Bajo Next.js App Router, el módulo se implementa mediante **Route Handlers** (`app/api/ventas/**/route.ts`) para las integraciones consumidas por otros módulos o clientes no-navegador (POS, PWA de campo), y **Server Actions** (`app/(dashboard)/ventas/**/actions.ts`) para los formularios operados por Cajero POS y Supervisor de Ventas. Ambas superficies son wrappers finos: **está prohibido implementar lógica de negocio en el `route.ts` o en la Server Action**. Toda regla de dominio se delega exclusivamente en la capa de servicios `lib/services/ventas/*` (`presupuesto.service.ts`, `pedido-venta.service.ts`, `turno-caja.service.ts`, `comprobante-fiscal.service.ts`). El handler/action se limita a: (1) resolver la sesión y verificar el permiso granular vía `withPermission("ventas:<accion>")`, (2) parsear y validar el `body` contra el schema Zod correspondiente, (3) invocar la función de servicio, (4) mapear el resultado o la excepción de negocio al shape de respuesta JSON estándar definido en la sección 2.

**Regla N.° 1 aplicada al Módulo B (prohibición absoluta de `DELETE`):** ninguna entidad del módulo —`Presupuesto`, `PedidoVenta`, `PedidoVentaItem`, `TurnoCaja`, `ComprobanteFiscal`— admite una sentencia `DELETE` desde el código de aplicación, bajo ninguna circunstancia ni ningún rol. Toda baja se implementa como `UPDATE` sobre los campos estándar `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`. El schema refuerza esta restricción a nivel de integridad referencial: toda relación saliente de las entidades de B usa `onDelete: Restrict`. Un comprobante fiscal ya emitido (con CAE, aunque simulado) **nunca** admite baja lógica ni edición — su reversión se instrumenta exclusivamente mediante una Nota de Crédito.

**Regla N.° 2 aplicada al Módulo B (protección de datos personales, Ley N.° 25.326):** los datos de contacto de los clientes registrados en una venta constituyen información personal alcanzada por la Ley N.° 25.326. El módulo aplica los estándares de protección de datos personales vigentes de forma transversal en el ERP, **sin cifrado ni auditoría reforzada adicionales** sobre los datos de venta — el módulo no administra categorías de datos sensibles según la definición de la ley (mismo criterio ya aplicado en Módulo C). Toda anulación de pedido, todo descuento por fuera del margen habilitado y todo cambio manual de precio de lista constituyen, en cambio, **eventos sensibles** con encadenamiento SHA-256 hacia el Módulo D (sección 4).

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### Convenciones generales

- **Route Handlers** (`app/api/**/route.ts`): toda respuesta exitosa devuelve `NextResponse.json({ data, error: null }, { status })`; todo error de negocio devuelve `NextResponse.json({ data: null, error: { code, message } }, { status })`, con `status` semántico (`400` validación Zod, `404` entidad no encontrada, `409` conflicto de estado/unicidad, `422` regla de negocio violada sobre un payload sintácticamente válido).
- **Server Actions** (`"use server"`, ej. `app/(dashboard)/ventas/**/actions.ts`): no retornan `NextResponse` — retornan el objeto plano `{ data, error: null }` o `{ data: null, error: { code, message } }`, con el mismo shape que su Route Handler equivalente.
- Toda ruta requiere sesión autenticada y verificación de permiso granular (Módulo D, RBAC) vía middleware `withPermission("ventas:<accion>")`, conforme a la matriz de permisos de la sección 5 del Documento de Alcance § Módulo B (Supervisor de Ventas, Cajero POS, Auditor).
- Todo campo `*_id` recibido en un `body` se valida contra el formato `uuid` de Zod; ninguna validación de existencia real contra la base de datos ocurre en el schema Zod — eso es responsabilidad de la capa de servicios.

### 2.1. Venta de mostrador con cobro multimedio (HU-B1)

**Ruta:** `POST /app/api/ventas/route.ts`
**Server Action equivalente:** `registrarVentaMostrador()` en `app/(dashboard)/ventas/pos/actions.ts`
**Permiso requerido:** `ventas:registrar_venta_mostrador` (exclusivo Cajero POS, conforme matriz RBAC del Alcance — Supervisor de Ventas no tiene `✓` directo para esta acción).

**Precondición de sesión operativa:** requiere un `TurnoCaja` abierto (HU-B2) para el Cajero autenticado — sin turno abierto, `422` antes de tocar stock o cobro.

**Archivo de schemas:** `src/lib/schemas/ventas.schema.ts`

```typescript
import { z } from "zod";

export const MedioPagoSchema = z.object({
  medio: z.enum(["EFECTIVO", "TRANSFERENCIA", "E_CHEQ", "MERCADO_PAGO", "TARJETA", "CUENTA_CORRIENTE"]),
  importe: z.number().positive(),
  referencia: z.string().optional(),
});

export const RegistrarVentaMostradorSchema = z.object({
  cliente_id: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        cantidad: z.number().int().positive(),
        precio_unitario: z.number().positive(),
        descuento_porcentual: z.number().min(0).max(100).optional(),
      })
    )
    .min(1, "La venta debe incluir al menos un ítem"),
  medios_pago: z.array(MedioPagoSchema).min(1, "Debe indicarse al menos un medio de pago"),
  tipo_comprobante: z.enum(["FACTURA_A", "FACTURA_B", "TICKET"]),
}).refine(
  (d) => {
    const totalItems = d.items.reduce((acc, i) => acc + i.precio_unitario * i.cantidad * (1 - (i.descuento_porcentual ?? 0) / 100), 0);
    const totalPagos = d.medios_pago.reduce((acc, m) => acc + m.importe, 0);
    return Math.abs(totalItems - totalPagos) < 0.01;
  },
  { message: "La suma de los medios de pago debe igualar exactamente el importe total de la venta", path: ["medios_pago"] }
);
export type RegistrarVentaMostradorInput = z.infer<typeof RegistrarVentaMostradorSchema>;
```

**Comportamiento esperado:**
- **Cobro multimedio real (criterio de aceptación explícito):** los medios de pago pueden combinarse en proporciones arbitrarias siempre que la suma iguale exactamente el importe total — validado en el `.refine()` del schema, y revalidado en la capa de servicios dentro de la misma transacción por si el precio unitario resuelto server-side difiere del enviado por el cliente.
- Cada medio de pago se persiste como una línea de cobro independiente (`VentaMedioPago`), con su propio importe y referencia — esto permite a Tesorería (Módulo G) conciliar cada medio contra su fuente externa por separado.
- **Selección manual de comprobante, sin regla derivada de condición fiscal del cliente** (directiva del PO, ver `spec_modulo_C.md`): el Cajero elige `tipo_comprobante` explícitamente al confirmar el cobro. El sistema no infiere ni valida el tipo de comprobante contra ningún dato de `Cliente` — Módulo C no tiene condición de IVA ni CUIT/CUIL (ver sección 3.5 sobre esta restricción transversal).
- Egreso de stock definitivo: la capa de servicios invoca el servicio de reserva/venta de Módulo A (`spec_modulo_A.md` sección 2.9, ruta `PATCH /app/api/inventario/reservas/[id]/confirmar/route.ts` si la venta se originó desde una `Reserva` previa, o el flujo de egreso directo de Módulo A si es una venta 100% de mostrador sin reserva previa) para transicionar el stock de `Disponible` a `Vendido` dentro de la misma operación lógica. **No** se reimplementa lógica de descuento de stock en este módulo — Módulo A es la única fuente de verdad (mismo principio arquitectónico que ya rige HU-A10).
- La emisión de comprobante fiscal se delega en `comprobante-fiscal.service.ts` (sección 2.7, HU-B7) dentro de la misma transacción de la venta — ninguna venta queda confirmada sin su comprobante correspondiente ya generado.
- Si se recibe `cliente_id`, el servicio invoca la consulta unificada de Módulo C (`spec_modulo_C.md` sección 2.7, HU-C7) para recuperar datos de contacto — esta es la integración bidireccional explícita del Alcance Funcional ("Recuperación automática de los datos de contacto y el historial de compras del cliente al identificarlo durante la venta").

**Respuesta `201 Created`:**
```json
{
  "data": {
    "pedido_venta_id": "uuid",
    "numero_venta": "V-2026-004821",
    "comprobante_id": "uuid",
    "tipo_comprobante": "FACTURA_B",
    "total": 45000.00
  },
  "error": null
}
```

**Respuesta `422 Unprocessable Entity` (sin turno abierto):**
```json
{ "data": null, "error": { "code": "SIN_TURNO_ABIERTO", "message": "El Cajero POS debe tener un turno de caja abierto para registrar ventas" } }
```

### 2.2. Apertura y cierre de turno con arqueo ciego (HU-B2)

**Ruta (apertura):** `POST /app/api/ventas/turnos/route.ts`
**Ruta (cierre):** `PATCH /app/api/ventas/turnos/[id]/cerrar/route.ts`
**Server Action equivalente:** `abrirTurnoCaja()`, `cerrarTurnoCaja()` en `app/(dashboard)/ventas/turnos/actions.ts`
**Permiso requerido:** `ventas:gestionar_turno_caja` (exclusivo Cajero POS).

```typescript
export const AbrirTurnoCajaSchema = z.object({
  fondo_fijo_inicial: z.number().nonnegative(),
});
export type AbrirTurnoCajaInput = z.infer<typeof AbrirTurnoCajaSchema>;

export const CerrarTurnoCajaSchema = z.object({
  conteo_fisico_declarado: z.number().nonnegative(),
  justificacion: z.string().optional(),
});
export type CerrarTurnoCajaInput = z.infer<typeof CerrarTurnoCajaSchema>;
```

**Comportamiento esperado:**
- **Apertura:** un Cajero solo puede tener un `TurnoCaja` abierto (`fecha_cierre = null`) a la vez — `409` si ya existe uno activo para ese usuario. La apertura habilita las operaciones de cobro de HU-B1 para ese turno y ese Cajero específicamente (validado en 2.1).
- **Cierre con arqueo ciego (criterio de aceptación explícito, no negociable):** el saldo esperado (fondo inicial + total de cobros en efectivo del turno) **no se muestra al Cajero** en ningún punto de la interfaz de cierre hasta que este confirme su `conteo_fisico_declarado`. El servicio recién revela la diferencia (`saldo_esperado - conteo_fisico_declarado`) **después** de recibir la declaración — nunca antes, para no sesgar el conteo.
- Si la diferencia (en valor absoluto) supera el umbral parametrizado por Dirección: `justificacion` pasa a ser obligatoria y el servicio notifica al Tesorero (Módulo G) del hallazgo, sin bloquear el cierre en sí (el turno se cierra igual, con la diferencia y su justificación quedando registradas).
- El acta de cierre (`TurnoCaja` con sus campos de cierre completos) queda registrada de forma inalterable, con evento hacia el Módulo D para su encadenamiento SHA-256 (sección 4) — no se implementa ningún mecanismo de hash propio del módulo.
- Baja lógica únicamente: ningún `TurnoCaja` se elimina físicamente; el historial de cierres es permanente y consultable.

**Respuesta `201 Created` (apertura):**
```json
{ "data": { "turno_caja_id": "uuid", "fondo_fijo_inicial": 5000.00, "fecha_apertura": "2026-09-16T09:00:00.000Z" }, "error": null }
```

**Respuesta `200 OK` (cierre, con diferencia dentro del umbral):**
```json
{ "data": { "turno_caja_id": "uuid", "saldo_esperado": 87500.00, "conteo_fisico_declarado": 87500.00, "diferencia": 0.00, "requiere_justificacion": false }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (diferencia supera umbral sin justificación):**
```json
{ "data": null, "error": { "code": "JUSTIFICACION_REQUERIDA", "message": "La diferencia detectada ($3.200,00) supera el umbral permitido; debe declararse una justificación" } }
```

### 2.3. Cotización/presupuesto con reserva de stock (HU-B3)

**Ruta (alta):** `POST /app/api/ventas/presupuestos/route.ts`
**Ruta (conversión a pedido):** `PATCH /app/api/ventas/presupuestos/[id]/aceptar/route.ts`
**Server Action equivalente:** `crearPresupuesto()`, `aceptarPresupuesto()` en `app/(dashboard)/ventas/presupuestos/actions.ts`
**Permiso requerido:** `ventas:emitir_cotizacion` (exclusivo Cajero POS — Supervisor de Ventas no tiene `✓` directo para emitir, conforme matriz RBAC del Alcance).

```typescript
export const CrearPresupuestoSchema = z.object({
  cliente_id: z.string().uuid(),
  vigencia_dias: z.number().int().positive(),
  condiciones_comerciales: z.string().optional(),
  items: z
    .array(
      z.object({
        variante_sku_id: z.string().uuid(),
        cantidad: z.number().int().positive(),
        precio_cotizado: z.number().positive(),
      })
    )
    .min(1, "El presupuesto debe incluir al menos un ítem"),
});
export type CrearPresupuestoInput = z.infer<typeof CrearPresupuestoSchema>;
```

**Comportamiento esperado:**
- **Congelamiento automático de stock (criterio de aceptación explícito):** al emitir el presupuesto, el servicio invoca el servicio centralizado de reserva de Módulo A (`spec_modulo_A.md` sección 2.9, `POST /app/api/inventario/reservas/route.ts`) para cada ítem cotizado, con `origen_reserva` resuelto según el enum vigente hoy en `schema.prisma` (`"LICITACION"` o `"PEDIDO_INSTITUCIONAL"` — ver nota de directiva al inicio de este documento sobre por qué no se renombra este valor en esta tarea) y `ttl_horas` derivado de `vigencia_dias`. **Módulo B no implementa lógica de congelamiento propia** — es el mismo principio arquitectónico de exclusividad que exige HU-A10, verificado explícitamente en esta sección tal como pide la nota técnica del Backlog.
- Vencimiento automático: si el presupuesto no se convierte en pedido antes de su vigencia, el job de liberación por TTL de Módulo A (sección 2.9 de `spec_modulo_A.md`) libera la reserva sin intervención de este módulo. `Presupuesto.estado` transiciona a `VENCIDO` mediante un evento de dominio disparado por el mismo job o por una consulta perezosa al momento de la siguiente lectura del presupuesto (decisión de implementación a definir por el equipo, no bloqueante).
- **Entregas parciales (criterio de aceptación explícito):** un `PedidoVenta` originado en la aceptación de un presupuesto puede facturarse y remitarse en más de un evento — cada remito repite el ciclo Facturación → Remito hasta agotar el saldo del pedido. El pedido cierra (`estado = CERRADO`) solo cuando la totalidad de lo adjudicado fue facturado y entregado; el histórico de entregas parciales queda siempre consultable.
- Ningún `Presupuesto` ni `PedidoVenta` se elimina físicamente — baja lógica estándar (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`), conforme a la sección 2.4 del Alcance Funcional § Módulo B.

**Respuesta `201 Created` (alta de presupuesto):**
```json
{ "data": { "presupuesto_id": "uuid", "estado": "EMITIDO", "vigencia_hasta": "2026-09-23T23:59:59.000Z", "reservas_generadas": 3 }, "error": null }
```

**Respuesta `200 OK` (aceptación → conversión a pedido):**
```json
{ "data": { "pedido_venta_id": "uuid", "presupuesto_id": "uuid", "estado": "RESERVADO" }, "error": null }
```

### 2.4. Override de descuento y cambio manual de precio (HU-B4)

**Ruta:** `POST /app/api/ventas/[id]/override-descuento/route.ts`
**Server Action equivalente:** `autorizarOverrideDescuento()` en `app/(dashboard)/ventas/pos/actions.ts`
**Permiso requerido:** `ventas:aplicar_descuento_margen` (Cajero POS, dentro de su margen habilitado — validado en 2.1 sin pasar por este endpoint); `ventas:autorizar_excepcion_descuento` (exclusivo Supervisor de Ventas — el Cajero solo puede *solicitar*, conforme matriz RBAC del Alcance, fila "Aplicar descuento por encima del margen habilitado": `△ solicita`).

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

**Comportamiento esperado:**
- El sistema define, por perfil de usuario, un porcentaje máximo de descuento aplicable **sin** intervención de terceros (ej. Cajero POS: hasta 5%, parametrizable — no hardcodeado). Un descuento dentro de ese margen se aplica directamente en HU-B1, sin pasar por este endpoint.
- Cuando el Cajero intenta aplicar un descuento por encima de su margen (o un cambio manual de precio de lista), la operación de venta **queda en espera** — el `PedidoVenta` o la línea de venta en curso transiciona a un estado de espera de aprobación hasta que este endpoint sea invocado exitosamente por un Supervisor de Ventas con su propia credencial.
- **Recargos por financiación en cuotas** siguen la misma lógica de configuración por perfil y el mismo patrón de aprobación — se modelan como un caso más de este mismo endpoint, no como una ruta separada.
- **Evento sensible obligatorio (criterio de aceptación explícito):** toda autorización exitosa por este endpoint genera un evento hacia el Módulo D con encadenamiento SHA-256, incluyendo usuario solicitante, usuario autorizante, porcentaje aplicado, motivo, dispositivo de origen y timestamp (sección 4).

**Respuesta `200 OK`:**
```json
{ "data": { "autorizacion_id": "uuid", "descuento_aplicado": 12.5, "autorizado_por": "uuid" }, "error": null }
```

**Corrección de redacción (HU-B4, decisión resuelta durante la implementación — ver `docs/tasks/HU-B4.md` §1.2):** `autorizacion_id` es un **id de correlación resoluble contra el `AuditLog`** generado por Módulo B (`crypto.randomUUID()`, antes del `COMMIT`), no el `id` real de la fila de `AuditLog`. Módulo D materializa el `AuditLog` de forma asíncrona (fire-and-forget, sin excepción para ningún evento del proyecto — confirmado contra `src/lib/events/domain-event-bus.ts`/`audit-log.listener.ts`), así que ningún endpoint puede devolver sincrónicamente el `id` real de esa fila. El id de correlación viaja en el payload del evento sensible (sección 4) y se persiste dentro de `valor_nuevo` del `AuditLog` ya escrito, quedando plenamente trazable/buscable — sin cambiar el contrato observable por el consumidor (sigue siendo un `uuid` en el mismo campo de la respuesta).

**Respuesta `403 Forbidden` (usuario sin permiso de autorización):**
```json
{ "data": null, "error": { "code": "SIN_PERMISO_AUTORIZACION", "message": "Solo un Supervisor de Ventas puede autorizar excepciones de descuento" } }
```

### 2.5. Cuenta corriente de cliente y plan de pagos (HU-B5)

**Ruta (consulta de cuenta):** `GET /app/api/ventas/cuentas-corrientes/[cliente_id]/route.ts`
**Ruta (registro de operación a cuenta):** `POST /app/api/ventas/cuentas-corrientes/[cliente_id]/operaciones/route.ts`
**Server Action equivalente:** `registrarOperacionCuentaCorrienteAction()` en `app/(dashboard)/ventas/cuentas-corrientes/actions.ts`
**Ruta (resolución de una operación retenida):** `PATCH /app/api/ventas/cuentas-corrientes/operaciones/[id]/resolver/route.ts`
**Server Action equivalente (resolución):** `resolverExcepcionCreditoAction()` en `app/(dashboard)/ventas/cuentas-corrientes/actions.ts`
**Permiso requerido:** `ventas:gestionar_cuenta_corriente` (Cajero POS y Supervisor de Ventas, ambos `✓` directo); `ventas:autorizar_excepcion_credito` (exclusivo Supervisor de Ventas).

```typescript
export const RegistrarOperacionCuentaCorrienteSchema = z.object({
  pedido_venta_id: z.string().uuid(),
  monto: z.number().positive(),
  plan_de_pagos: z
    .array(
      z.object({
        hito: z.string().min(1),
        porcentaje: z.number().positive().max(100),
        fecha_estimada: z.coerce.date().optional(),
      })
    )
    .optional(),
});
export type RegistrarOperacionCuentaCorrienteInput = z.infer<typeof RegistrarOperacionCuentaCorrienteSchema>;
```

**Comportamiento esperado:**
- Cada `Cliente` que opera con cuenta corriente posee una cuenta propia (`CuentaCorrienteCliente`), con un `limite_credito_autorizado` y su historial de movimientos (facturas emitidas, pagos recibidos, notas de crédito).
- **Validación de límite de crédito (criterio de aceptación explícito):** antes de confirmar cualquier operación a cuenta corriente, el servicio valida el saldo disponible contra el límite. Si la operación excede el límite configurado, la venta **queda retenida** (no se rechaza de plano) y requiere autorización explícita de un Supervisor de Ventas — quien puede aprobar la excepción o rechazarla, quedando ambas decisiones registradas.
- El `plan_de_pagos`, cuando se provee, es un cronograma de cobros asociado al `PedidoVenta` — este módulo **modela** el cronograma, pero es el Módulo G (Tesorería) quien lo **consume** para proyectar el flujo de ingresos esperado y registrar cada cobro efectivo contra el hito correspondiente (integración documentada, Módulo G ya existente desde sprints anteriores).
- Un pedido cancelado libera el stock reservado (invocando la liberación de Módulo A, sección 2.9 de `spec_modulo_A.md`) y permanece en el historial con motivo obligatorio — nunca se elimina físicamente.
- **Las facturas ya emitidas nunca se anulan con baja lógica: se revierten mediante Nota de Crédito** (criterio de aceptación explícito, ya sin mención a AFIP tras la directiva del PO — el criterio de fondo, no anular sino revertir, es independiente de si el comprobante está o no validado externamente).

**Respuesta `200 OK` (consulta de cuenta):**
```json
{ "data": { "cliente_id": "uuid", "limite_credito_autorizado": 500000.00, "saldo_actual": 120000.00, "disponible": 380000.00 }, "error": null }
```

**Respuesta `201 Created` (registro de operación dentro del límite, queda `APROBADA`):**
```json
{ "data": { "operacion_id": "uuid", "estado": "APROBADA" }, "error": null }
```

**Respuesta `422 Unprocessable Entity` (excede límite, retenida):**
```json
{ "data": null, "error": { "code": "LIMITE_CREDITO_EXCEDIDO", "message": "La operación excede el límite de crédito disponible; requiere autorización de un Supervisor de Ventas", "details": { "operacion_id": "uuid" } } }
```

**Corrección de contrato (HU-B5):** la operación excedida **no se descarta**: el servicio la persiste en estado `RETENIDA` (sin modificar `saldo_actual`) y confirma la transacción **antes** de responder este `422`; `error.details.operacion_id` es el `id` de esa operación ya creada, para que el llamador pueda navegar a su resolución. La Server Action devuelve el mismo `details`.

**Resolución de una operación retenida — `PATCH .../operaciones/[id]/resolver` (endpoint agregado por HU-B5):** la versión anterior de esta sección definía el permiso `ventas:autorizar_excepcion_credito` pero no exponía ninguna ruta para que el Supervisor de Ventas aprobara o rechazara una operación retenida. Se resuelve con el mismo criterio que 2.4 y 2.8: un `PATCH` dedicado, de un solo propósito, gateado por el permiso exclusivo del Supervisor. `[id]` es el `id` de la `CuentaCorrienteOperacion`.

**Permiso requerido:** `ventas:autorizar_excepcion_credito` — único gate del endpoint. El Cajero POS no tiene acceso bajo ninguna circunstancia (`403`), ni siquiera sobre su propia operación retenida. El usuario autorizante es el de la sesión; el `body` no transporta la credencial de otro usuario.

```typescript
export const ResolverExcepcionCreditoSchema = z.object({
  decision: z.enum(["APROBAR", "RECHAZAR"]),
  motivo: z.string().min(1, "El motivo es obligatorio"),
});
export type ResolverExcepcionCreditoInput = z.infer<typeof ResolverExcepcionCreditoSchema>;
```

**Comportamiento esperado:**
- Solo una `CuentaCorrienteOperacion` en estado `RETENIDA` admite esta transición: `RETENIDA` → `APROBADA` o `RETENIDA` → `RECHAZADA` (ambos estados terminales). Cualquier otro estado origen responde `409 TRANSICION_INVALIDA`. El estado origen se valida con una guardia atómica dentro de la misma transacción que ejecuta el `UPDATE`, para evitar condiciones de carrera entre dos resoluciones simultáneas de la misma operación (mismo criterio que 3.1).
- `decision: "APROBAR"` → `estado = APROBADA`, `autorizado_por_id` = usuario de la sesión, y `saldo_actual` de la `CuentaCorrienteCliente` suma el `monto` de la operación. **No se revalida el límite de crédito al aprobar:** el saldo puede quedar por encima del límite, que es el sentido de la excepción.
- `decision: "RECHAZAR"` → `estado = RECHAZADA`, `autorizado_por_id` = usuario de la sesión; `saldo_actual` no se modifica.
- **Evento sensible obligatorio:** toda resolución emite `venta:excepcion_credito_resuelta` (sección 4) con encadenamiento SHA-256 hacia el Módulo D, después del `COMMIT`. `autorizacion_id` es un id de correlación (`crypto.randomUUID()`, generado antes del `COMMIT`), con el mismo criterio que la corrección de redacción de 2.4.

**Respuesta `200 OK` (`estado` es `APROBADA` o `RECHAZADA` según la `decision`):**
```json
{ "data": { "operacion_id": "uuid", "estado": "APROBADA", "autorizacion_id": "uuid" }, "error": null }
```

**Respuesta `409 Conflict` (la operación no está `RETENIDA`):**
```json
{ "data": null, "error": { "code": "TRANSICION_INVALIDA", "message": "Solo una operación en estado RETENIDA puede resolverse" } }
```

Otros estados: `400 VALIDATION_ERROR` (`id` no UUID, `decision` fuera del enum o `motivo` vacío), `401` sin sesión, `403 FORBIDDEN` sin `ventas:autorizar_excepcion_credito`, `404 OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA`.

### 2.6. Log forense de anulaciones, descuentos, cambios de precio y excepciones de crédito (HU-B6)

**Estado: implementado** (rama `feature/HU-B6`, commit `2433f81` — ver `HU6_MODULO_B.md` para el relevamiento completo). Esta sección refleja el contrato tal como quedó implementado (Rev. 5); las correcciones puntuales sobre la Rev. 4 están marcadas explícitamente donde corresponde.

**Ruta:** `GET /app/api/ventas/auditoria/route.ts`
**Permisos requeridos (dos niveles de acceso distintos sobre el mismo endpoint):**
- `auditoria:leer_forense` (exclusivo Auditor). **Corrección de Rev. 5 sobre el texto de la Rev. 4:** la Rev. 4 afirmaba que `auditoria:leer_historico` quedó "sin asignar a ningún Rol" en `seed.ts`. Confirmado durante la implementación de HU-B6 que esa afirmación es **inexacta**: `seed.ts` sí asigna `auditoria:leer_historico` a `AUDITOR` (y a `MASTER`), pese a que el propio comentario del seed sigue describiéndolo como una "divergencia de nomenclatura conocida y aceptada". Esto **no cambia el permiso real usado por este endpoint**: el código real (rutas, servicios y UI de Módulo A y Módulo D) sigue consumiendo `auditoria:leer_forense` de forma exclusiva, y este endpoint gatea contra ese mismo permiso — `auditoria:leer_historico` no se usa en ningún gate de la aplicación. `auditoria:leer_forense` es el permiso real del rol `AUDITOR` (`spec_modulo_D.md` §4.3, ya usado por la Consola de Auditoría Forense de Módulo A — HU-A6, `spec_modulo_A.md`/`HU7_MODULO_A.md`, implementada y en `develop`). Acceso de lectura **ampliado**: ve los eventos de **todos** los usuarios del módulo y puede invocar `verificar_integridad`. Un usuario con rol `MASTER` que tenga `auditoria:leer_forense` accede con este mismo nivel ampliado (`leer_forense` tiene precedencia sobre `ventas:leer_log_operativo` al resolver el nivel de acceso, para el caso de un usuario con ambos permisos).
- `ventas:leer_log_operativo` (exclusivo Supervisor de Ventas — ya sembrado y asignado a `SUPERVISOR_VENTAS` por HU-B8, `HU8_MODULO_B.md` §3.1/§3.3) — acceso de lectura **restringido**: ver el contrato de alcance más abajo; **sin** capacidad de invocar `verificar_integridad` bajo ninguna circunstancia, reservada exclusivamente al Auditor.

El gate del Route Handler resuelve el nivel de acceso a mano (`withAuth` + `usuarioTienePermiso()`), porque `withPermission()` solo acepta un único código de permiso y este endpoint acepta cualquiera de los dos.

**Principio de diseño (corregido en Rev. 4, confirmado por la implementación):** este endpoint no recalcula ni reimplementa el encadenamiento SHA-256 con una función compartida — no existe ninguna función `listarEventosPorDominio` en Módulo D (nunca se construyó) ni una función de verificación de integridad reutilizable tal cual entre módulos: ni `verificarCadenaHashesInventario()` (A) ni `verificarCadenaHashesIntegridad()` (D) aceptan parámetros de dominio, ambas recorren la cadena global completa. El patrón real y ya probado en este proyecto es el de HU-A6 (`spec_modulo_A.md`, `lib/services/inventario/auditoria.service.ts`, función `obtenerLogsInventario()`): cada módulo escribe su **propio** servicio de solo lectura contra `AuditLog`, con un filtro de dominio fijo por `accion` (equivalente al `where.tabla_afectada = { in: TABLAS_MODULO_A }` de HU-A6), revalidando el permiso como defensa en profundidad aunque la página/route ya lo haya chequeado, y reutilizando de Módulo D solo utilidades chicas (`listarUsuariosParaFiltro()` de `lib/services/auditoria/audit-log.service.ts` para el selector de filtro por usuario). Módulo B sigue el mismo patrón: `lib/services/ventas/auditoria-ventas.service.ts`, con `obtenerLogsVentas(filtros, sesion)` (consulta directa a `prisma.auditLog`, nunca una llamada a una función de Módulo D inexistente) y `verificarCadenaHashesVentas()` (función propia de verificación de integridad — recorre la cadena completa de `AuditLog`, pero cuenta/reporta solo las acciones de Módulo B).

`ACCIONES_MODULO_B` (valores reales de la columna `AuditLog.accion`, confirmados contra `audit-log.listener.ts` vía `HU4_MODULO_B.md` §4.3 y `HU5_MODULO_B.md` §5.3): `DESCUENTO_FUERA_MARGEN`, `CAMBIO_PRECIO_MANUAL`, `EXCEPCION_CREDITO_APROBADA`, `EXCEPCION_CREDITO_RECHAZADA`, y el placeholder `ANULACION_PEDIDO` para la anulación de pedido (sección 2.8), sin código real todavía (`HU3_MODULO_B.md` §7, `HU4_MODULO_B.md` §8) — cuando esa sección tenga implementación, el valor real de `accion` puede terminar siendo otro (por ejemplo `DELETE_LOGICO`, genérico del proyecto), y el mapeo deberá corregirse entonces. El `tipo_evento` del query se mapea a estos valores reales de `accion` dentro del servicio, no al revés.

```typescript
export const ConsultarAuditoriaVentasQuerySchema = z.object({
  pedido_venta_id: z.string().uuid().optional(),
  tipo_evento: z.enum([
    "venta:anulacion_pedido",
    "venta:descuento_fuera_margen",
    "venta:cambio_precio_manual",
    "venta:excepcion_credito_resuelta",
  ]).optional(),
  usuario_id: z.string().uuid().optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(), // tratado como fin de día (23:59:59.999), mismo criterio que HU-A6
  verificar_integridad: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(50).default(20),
});
export type ConsultarAuditoriaVentasQuery = z.infer<typeof ConsultarAuditoriaVentasQuerySchema>;
```

**Corrección de Rev. 5 sobre el query schema (reemplaza lo que decía la Rev. 4):**
- **Naming de paginación:** `page`/`page_size`, no `pagina`/`por_pagina` — es el naming real que usan las otras dos consolas de auditoría del proyecto (Módulo A y Módulo D); `pagina`/`por_pagina` no existe en ningún endpoint de auditoría real, solo aparecía en `spec_modulo_C.md`/`spec_modulo_H.md` (nunca implementadas).
- **`verificar_integridad` vía `z.enum(["true","false"]).transform(...)`, no `z.coerce.boolean()`:** probado directamente contra el endpoint, `z.coerce.boolean()` trata cualquier string no vacío como `true` — `?verificar_integridad=false`, `=0` y `=1` daban los tres `true`. Con `z.coerce.boolean()` un Supervisor de Ventas que mandara `verificar_integridad=false` explícito habría recibido el `403` de todos modos, y un Auditor habría disparado la verificación completa sin pedirlo.

**Corrección de Rev. 4 sobre el enum (sigue vigente):** se agrega `venta:excepcion_credito_resuelta` — evento sensible agregado por HU-B5 en la Rev. 3 de este documento (§2.5/§4), ausente del enum original pese a que este párrafo afirmaba (y sigue afirmando, ahora correctamente) que queda "alineado 1:1 con la tabla de eventos de la sección 4".

**Filtro `pedido_venta_id` (agregado en Rev. 5, caso no contemplado en la Rev. 4):** `pedido_venta_id` no siempre corresponde a `AuditLog.registro_id`. Para `venta:descuento_fuera_margen` y `venta:cambio_precio_manual`, `registro_id` es directamente el pedido (`tabla_afectada: "pedidos_venta"`). Para `venta:excepcion_credito_resuelta`, `registro_id` es la operación de cuenta corriente (`tabla_afectada: "cuenta_corriente_operaciones"`), y el pedido de venta solo aparece dentro de `valor_nuevo.pedido_venta_id` (JSON). El filtro se implementa como un `OR` entre `registro_id = pedido_venta_id` y el path JSON `valor_nuevo.pedido_venta_id = pedido_venta_id` — no como un mapeo directo a `registro_id`.

**Contrato de alcance del Supervisor de Ventas (fijado en Rev. 4, corregido en Rev. 5 sobre el mecanismo de query):** confirmado contra `HU4_MODULO_B.md` §4.3 y `HU5_MODULO_B.md` §5.3 que la columna `AuditLog.usuario_id` es, en los cuatro tipos de evento sensible de este módulo, siempre el **autorizante** (el Supervisor que actuó), nunca el solicitante. En consecuencia:
- **"Eventos que el Supervisor haya autorizado":** `AuditLog.usuario_id = <supervisor de la sesión>` — columna real, sin inspeccionar JSON.
- **"Eventos escalados a su rol"** (match contra `usuario_solicitante_id`): ese campo no es una columna de `AuditLog` — vive dentro de `valor_nuevo` (JSON), y solo existe en dos de los cuatro tipos de evento (`venta:descuento_fuera_margen` y `venta:excepcion_credito_resuelta`; `venta:cambio_precio_manual` no tiene solicitante en su payload y `venta:anulacion_pedido` tampoco, al ejecutarla directo el Supervisor).
- **Mecanismo de query (corregido en Rev. 5):** la Rev. 4 preveía traer un rango candidato y filtrar/paginar en memoria. La implementación real resuelve ambos casos con **una sola query con `OR`** (autorizante por columna, solicitante por path JSON) y paginación (`skip`/`take`) aplicada directamente sobre esa query en la base — sin un segundo paso en memoria.
- `verificar_integridad: true` recibido de un Supervisor de Ventas se sigue rechazando con `403`, sin cambios respecto a la Rev. 3.

**Comportamiento esperado:**
- Consulta de solo lectura sobre `AuditLog`, filtrada por los `tipo_evento` propios de este módulo (ver enum, alineado 1:1 con la tabla de eventos de la sección 4).
- Cada evento incluye usuario responsable, dispositivo de origen (cuando el payload lo incluya — no todos los eventos de este módulo lo tienen, ver `HU5_MODULO_B.md` §5.2), timestamp, `valor_anterior` y `valor_nuevo` cuando corresponde — visibles tanto para el Auditor como para el Supervisor de Ventas (son sus propios eventos).
- **`verificar_integridad: true` recibido de un Supervisor de Ventas se rechaza con `403`**, independientemente del resto del query — no se ignora silenciosamente el flag, se informa explícitamente que esa capacidad no está disponible para su rol (mismo criterio de error explícito que el resto del módulo).
- Mismo contrato de `verificar_integridad` que HU-A6 para el Auditor en cuanto a ser opt-in explícito (nunca ejecutado por defecto en cada listado): a diferencia de HU-A6, la verificación de Módulo B (`verificarCadenaHashesVentas()`) recorre la cadena completa de `AuditLog` (no solo el subconjunto ya paginado), porque el encadenamiento SHA-256 es único para toda la tabla — pero **cuenta y reporta únicamente** sobre las acciones de Módulo B.
- **Segregación de funciones (criterio de aceptación explícito):** tanto el Auditor como el Supervisor de Ventas tienen acceso de lectura sobre este log, pero ninguno de los dos puede ejecutar ni aprobar ninguna operación comercial del módulo a través de este endpoint — es de solo lectura para ambos roles, sin combinación de permisos que otorgue capacidad de escritura.

**Respuesta `200 OK` (shape confirmado por la implementación, corrige lo que decía la Rev. 4):**
```json
{
  "data": {
    "registros": [ "...AuditLog[]..." ],
    "total": 42,
    "page": 1,
    "page_size": 20,
    "verificacion_integridad": { "integra": true }
  },
  "error": null
}
```
`verificacion_integridad` solo está presente cuando `verificar_integridad: true` y la sesión es Auditor.

**Respuesta `403 Forbidden` (Supervisor de Ventas solicitando verificación de integridad):**
```json
{ "data": null, "error": { "code": "VERIFICACION_INTEGRIDAD_NO_DISPONIBLE", "message": "La verificación de integridad de la cadena SHA-256 está reservada al rol Auditor" } }
```

### 2.7. Emisión de comprobante fiscal con CAE y QR simulados (HU-B7)

**⚠️ Alcance redefinido por directiva del PO — ver nota al inicio de este documento.** Esta sección reemplaza por completo lo que originalmente iba a ser una integración real con WSFEV1/AFIP. No existe llamada a ningún servicio externo en esta sección.

**Ruta:** invocada internamente por `comprobante-fiscal.service.ts` desde HU-B1 (venta de mostrador) y desde la conversión de HU-B3 (facturación de un pedido con cotización previa) — no expone un Route Handler propio de alta directa, ya que un comprobante siempre nace asociado a una venta o a un remito parcial, nunca de forma aislada.
**Ruta de consulta:** `GET /app/api/ventas/comprobantes/[id]/route.ts`
**Permiso requerido:** la emisión hereda el permiso de la operación que la origina (`ventas:registrar_venta_mostrador` o el de facturación de HU-B3); la consulta usa `ventas:leer` (todos los roles del módulo tienen `✓` para "Consultar catálogo, precios y disponibilidad de stock", extendido aquí a la consulta de comprobantes propios del pedido).

```typescript
export const EmitirComprobanteFiscalInput = z.object({
  pedido_venta_id: z.string().uuid(),
  tipo_comprobante: z.enum(["FACTURA_A", "FACTURA_B", "TICKET"]),
  monto_total: z.number().positive(),
});
export type EmitirComprobanteFiscalType = z.infer<typeof EmitirComprobanteFiscalInput>;
```

**Comportamiento esperado:**
- El Cajero selecciona manualmente `tipo_comprobante` al confirmar el cobro (validado ya en el schema de HU-B1, sección 2.1) — no hay ninguna regla que lo derive de un dato del cliente.
- El servicio genera de forma **enteramente local**:
  - Un **CAE simulado**: una cadena numérica determinística (ej. hash truncado de `pedido_venta_id` + timestamp) que cumple el formato visual de un CAE real (14 dígitos), pero que **no** proviene de ninguna autorización externa y no debe usarse como constancia fiscal válida fuera del sistema.
  - Un **código QR** con la estructura de datos exigida por la normativa vigente para comprobantes electrónicos argentinos (CUIT emisor, tipo y número de comprobante, importe, CAE), generado y codificado localmente (librería QR estándar, sin llamada de red).
- El comprobante se persiste en `ComprobanteFiscal`, con un campo explícito `es_simulado: true` (o equivalente) que documenta en el propio dato que este comprobante no fue validado ante AFIP — evita que una futura integración real confunda datos históricos simulados con comprobantes reales.
- El repositorio digital archiva el comprobante de forma permanente — no es eliminable bajo ninguna circunstancia (Regla N.° 1).
- **Fuera de alcance explícito (ver sección 5):** la integración real con AFIP (WSFEV1) para obtener un CAE genuino. Si en un sprint futuro se decide implementarla, debe hacerse detrás de un patrón Adapter/Gateway dedicado que reemplace la generación local sin tener que rediseñar el resto del flujo de venta — mismo criterio que `spec_modulo_H.md` ya aplicó a la integración AFIP diferida de HU-H9.

**Respuesta `201 Created` (comprobante emitido, interno a la transacción de HU-B1/HU-B3):**
```json
{
  "data": {
    "comprobante_id": "uuid",
    "tipo_comprobante": "FACTURA_B",
    "cae_simulado": "68031598274563",
    "qr_data_url": "data:image/png;base64,...",
    "es_simulado": true
  },
  "error": null
}
```

### 2.8. Anulación de Pedido de Venta (hallazgo de auditoría — completa la matriz RBAC del Alcance)

**Nota de origen:** esta sección no corresponde a ninguna HU numerada de forma independiente en el Backlog — cubre la transición `RESERVADO → ANULADO` ya definida en la máquina de estados (sección 3.1) y el evento `venta:anulacion_pedido` (sección 4), que la Rev. 0 de este documento dejaba sin endpoint ni permiso explícito pese a que la matriz RBAC del Alcance Funcional § Módulo B ya exige una fila dedicada ("Anular un pedido mediante baja lógica": Supervisor de Ventas `✓`, Cajero POS `△` solicita).

**Sin código todavía (confirmado nuevamente durante la implementación de HU-B6, sección 2.6):** el valor real de `AuditLog.accion` para esta transición no está confirmado contra ningún listener — HU-B6 usa `ANULACION_PEDIDO` como placeholder en su filtro (sección 2.6), a corregir cuando esta sección tenga código real.

**Ruta:** `PATCH /app/api/ventas/[id]/anular/route.ts`
**Server Action equivalente:** `anularPedidoVenta()` en `app/(dashboard)/ventas/pos/actions.ts`
**Permiso requerido:** `ventas:anular_pedido` (exclusivo Supervisor de Ventas, conforme matriz RBAC del Alcance — el Cajero POS solo puede *solicitar* la anulación vía un flujo fuera de alcance de este documento, conforme el patrón de solicitud de HU-C6).

```typescript
export const AnularPedidoVentaSchema = z.object({
  deletion_reason: z.string().min(1, "El motivo de anulación es obligatorio"),
});
export type AnularPedidoVentaInput = z.infer<typeof AnularPedidoVentaSchema>;
```

**Comportamiento esperado:**
- Solo un `PedidoVenta` en estado `RESERVADO` admite esta transición (sección 3.1) — cualquier otro estado origen rechaza con `409 TRANSICION_INVALIDA`, consistente con la regla general de la máquina de estados.
- Exige `deletion_reason` obligatorio. Setea `is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason`, `estado = ANULADO` en la misma transacción.
- **Libera el stock reservado invocando la liberación de Módulo A** (`spec_modulo_A.md` sección 2.9) — mismo principio de exclusividad de Módulo A sobre stock ya citado en la sección 3.2 de este documento. No se reincrementa `StockDeposito` directamente desde este servicio.
- No genera comprobante fiscal bajo ninguna circunstancia (ya establecido en la tabla de estados, sección 3.1).
- Un `PedidoVenta` ya `FACTURADO`, `REMITO_EMITIDO` o `CERRADO` **no admite esta operación** — su reversión, si corresponde, es exclusivamente mediante Nota de Crédito sobre el comprobante ya emitido (sección 2.5, mismo criterio que la baja lógica de facturas).
- Emite `venta:anulacion_pedido` tras el `COMMIT` (evento sensible, ya definido en la sección 4 de este documento — sin cambios sobre ese contrato).

**Respuesta `200 OK`:**
```json
{ "data": { "pedido_venta_id": "uuid", "estado": "ANULADO", "stock_liberado": true }, "error": null }
```

**Respuesta `409 Conflict` (estado origen inválido):**
```json
{ "data": null, "error": { "code": "TRANSICION_INVALIDA", "message": "Solo un Pedido de Venta en estado RESERVADO puede anularse" } }
```

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

### 3.1. Máquina de estados de `Presupuesto` y `PedidoVenta`

Transiciones válidas — cualquier transición no listada debe rechazarse con `409 TRANSICION_INVALIDA`, nunca confiar en el `default` del enum de Prisma como única defensa:

| Estado origen | Transición | Estado destino | Precondición |
|---|---|---|---|
| — | Alta (2.3) | `Presupuesto: BORRADOR` | Cliente existente (Módulo C) |
| `BORRADOR` | El vendedor completa ítems y condiciones | `Presupuesto: EMITIDO` | A partir de aquí corre el plazo de vigencia y se congela el stock (sección 2.3) |
| `EMITIDO` | Vence el plazo sin respuesta | `Presupuesto: VENCIDO` | Baja lógica; libera la reserva de stock asociada vía Módulo A |
| `EMITIDO` | El cliente acepta la cotización (2.3) | `PedidoVenta: RESERVADO` | Se genera el `PedidoVenta`; el `Presupuesto` origen queda vinculado, no se elimina |
| `RESERVADO` | Se emite comprobante por el total o una entrega parcial (2.7) | `PedidoVenta: FACTURADO` (total o parcial) | El stock facturado transiciona de `Reservado` a `Vendido` vía Módulo A |
| `FACTURADO` | Se genera el remito de la entrega física | `PedidoVenta: REMITO_EMITIDO` | Documenta qué cantidad de lo facturado fue efectivamente entregado |
| Con saldo pendiente | Nueva entrega parcial contra el mismo pedido | `REMITO_EMITIDO` (adicional) | Se repite Facturación → Remito tantas veces como entregas parciales existan |
| Sin saldo pendiente | Totalidad adjudicada facturada y entregada | `PedidoVenta: CERRADO` | Cierre definitivo a efectos operativos; histórico permanece accesible |
| `RESERVADO` | El cliente rechaza o hay error de carga (2.8) | `PedidoVenta: ANULADO` (baja lógica) | `deletion_reason` obligatorio; libera stock reservado; no genera comprobante fiscal |

`CERRADO` y `ANULADO` son estados terminales. El servicio valida el estado origen leído dentro de la misma transacción que ejecuta el `UPDATE`, para evitar condiciones de carrera entre requests concurrentes sobre el mismo pedido.

### 3.2. Exclusividad del Módulo A sobre la máquina de estados de stock

**Principio arquitectónico no negociable (heredado de `spec_modulo_A.md` sección 2.9):** el Módulo B **no implementa lógica de congelamiento, liberación o descuento de stock propia** bajo ninguna circunstancia. Toda operación que afecte el estado de una unidad de stock (`Disponible` → `Reservado`, `Reservado` → `Vendido`, `Reservado` → `Disponible` por liberación) se resuelve exclusivamente invocando las rutas ya especificadas en `spec_modulo_A.md` sección 2.9. Esta restricción es de cumplimiento obligatorio, y su verificación explícita contra la implementación real de HU-B3 es un requisito citado textualmente por el propio Backlog al definir HU-A10.

### 3.3. Cifrado y trazabilidad — sin cifrado adicional, con eventos sensibles reforzados

- A diferencia de Módulo H (datos bancarios cifrados), Módulo B **no cifra** ningún campo — mismo criterio que Módulo C: el Alcance es explícito en que "el módulo no administra categorías de datos sensibles según la definición de la ley" (Ley N.° 25.326).
- En cambio, cuatro tipos de evento —anulación de pedido, descuento fuera de margen, cambio manual de precio de lista y resolución de excepción de crédito— son eventos **sensibles** con encadenamiento SHA-256 reforzado (no un simple registro de auditoría estándar): cada uno incorpora usuario responsable, momento exacto, valor anterior, valor nuevo (cuando corresponde) y motivo declarado (dispositivo de origen solo en los eventos cuyo payload lo incluye, ver sección 4).
- Toda mutación relevante (alta, transición de estado, autorización de excepción) emite su evento correspondiente **después** del `COMMIT` de la transacción que la persiste — nunca dentro de ella, mismo patrón fire-and-forget que el resto del sistema (`spec_modulo_H.md` sección 3.4).

### 3.4. Restricción de borrado físico y patrón de baja lógica

- Todas las relaciones de Prisma salientes de las entidades del Módulo B usan `onDelete: Restrict`.
- Ninguna función de servicio del Módulo B expone o invoca `prisma.<modelo>.delete()` ni `deleteMany()`, bajo ninguna condición.
- Un `ComprobanteFiscal` ya emitido (aunque simulado) es la única entidad del módulo con una regla de inmutabilidad más estricta que la baja lógica estándar: **no admite baja lógica en absoluto** — su reversión es siempre una Nota de Crédito nueva, nunca una desactivación del comprobante original.

### 3.5. Sin condición de IVA ni CUIT/CUIL como criterio de negocio

Ninguna regla de este módulo consulta, valida o depende de una condición de IVA, CUIT o CUIL del `Cliente` — ese dato no existe en Módulo C (directiva del PO, ver `spec_modulo_C.md`). La única decisión sobre el tipo de comprobante fiscal es la selección manual del Cajero POS al confirmar el cobro (secciones 2.1 y 2.7).

---

## 4. Eventos de Dominio (EDA)

**Archivo:** `src/lib/events/event-types.ts` (extiende la tabla ya definida en `spec_modulo_D.md` §5, mismo patrón de namespacing que `cliente:*`, `proveedor:*`, `stock:*`)

El Módulo B es **emisor** hacia el Módulo D (encadenamiento SHA-256) y **consumidor de servicios** de Módulo A (reserva/liberación de stock) y Módulo C (datos de cliente) — no consume eventos de esos módulos para su propia lógica, invoca sus funciones de servicio de forma síncrona dentro de sus propias transacciones.

| Evento | Disparado por | Consumidor | Payload mínimo |
|---|---|---|---|
| `venta:registrada` | 2.1, tras `COMMIT` | Módulo D (auditoría estándar), Módulo G (conciliación) | `{ pedido_venta_id, cliente_id \| null, total, medios_pago[], turno_caja_id, usuario_id }` |
| `venta:turno_abierto` / `venta:turno_cerrado` | 2.2, tras `COMMIT` | Módulo D (encadenamiento SHA-256, acta de cierre) | `{ turno_caja_id, usuario_id, fondo_fijo_inicial, saldo_esperado?, conteo_fisico_declarado?, diferencia? }` |
| `venta:presupuesto_emitido` / `venta:presupuesto_vencido` | 2.3, tras `COMMIT` o job de TTL | Módulo D (auditoría estándar) | `{ presupuesto_id, cliente_id, vigencia_hasta, reservas_generadas[] }` |
| `venta:descuento_fuera_margen` | 2.4, tras `COMMIT` — **evento sensible** | Módulo D (encadenamiento SHA-256 reforzado) | `{ pedido_venta_id, usuario_solicitante_id, usuario_autorizante_id, porcentaje_aplicado, motivo, dispositivo, timestamp }` |
| `venta:cambio_precio_manual` | 2.4, tras `COMMIT` — **evento sensible** | Módulo D (encadenamiento SHA-256 reforzado) | `{ pedido_venta_id, variante_sku_id, usuario_autorizante_id, precio_anterior, precio_nuevo, motivo }` |
| `venta:anulacion_pedido` | 2.8 (transición a `ANULADO`), tras `COMMIT` — **evento sensible** | Módulo D (encadenamiento SHA-256 reforzado) | `{ pedido_venta_id, usuario_id, deletion_reason, stock_liberado: boolean }` |
| `venta:comprobante_emitido` | 2.7, tras `COMMIT` | Módulo D (auditoría estándar), Módulo G (conciliación fiscal) | `{ comprobante_id, pedido_venta_id, tipo_comprobante, cae_simulado, es_simulado: true }` |
| `venta:operacion_cuenta_corriente_registrada` | 2.5, tras `COMMIT` | Módulo G (proyección de flujo de ingresos) | `{ operacion_id, cliente_id, pedido_venta_id, monto, estado: "APROBADA" \| "RETENIDA", plan_de_pagos? }` |
| `venta:excepcion_credito_resuelta` | 2.5 (resolución de una operación retenida), tras `COMMIT` — **evento sensible** | Módulo D (encadenamiento SHA-256) | `{ autorizacion_id, operacion_id, pedido_venta_id, cliente_id, usuario_solicitante_id, usuario_autorizante_id, decision, motivo, monto }` |

**Sin eventos nuevos en HU-B6:** la consulta de auditoría (2.6) es de solo lectura y no emite evento propio.

**Regla de exclusión de datos sensibles en el payload (misma convención que `spec_modulo_D.md` §5.1 y `spec_modulo_H.md` sección 4):** ningún evento de este módulo incluye datos de contacto completos del cliente en su payload — se referencia por `cliente_id`, dejando que la consulta de detalle se resuelva contra Módulo C si se necesita.

---

## 5. Fuera de Alcance (diferido / bloqueado)

- **Integración real con AFIP (WSFEV1, CAE real, contingencia real de servicio externo):** explícitamente descartada por directiva del PO en esta misma sesión de planificación — ver nota al inicio de este documento. HU-B7 queda redefinida como emisión simulada de punta a punta. Si se retoma en un sprint futuro, debe implementarse detrás de un patrón Adapter/Gateway dedicado, sin rediseñar el resto del flujo de venta.
- **Renombre del enum `OrigenReserva`** (`LICITACION`, `PEDIDO_INSTITUCIONAL` → posible consolidación futura en un nombre sin residuo institucional): identificado como hallazgo durante la redacción de este spec, pero el equipo decidió explícitamente no abordarlo en este sprint por el riesgo de una migración de eliminación de valores de enum a mitad de sprint. Este documento usa los valores tal como existen hoy en `schema.prisma`. Documentado como deuda técnica conocida, no bloqueante.
- **Tablero de Comando de Módulo D (HU-D3):** el Alcance Funcional (Módulo D.1) describe este panel como consumidor de eventos de todos los módulos operativos, incluido Módulo B. Con Módulo B entrando en este sprint, el Tablero queda desbloqueado como consumidor real de los eventos de la sección 4 — pero esa integración no está priorizada en Sprint 3, así que queda para cuando se planifique.
- **Integración con Módulo E (unificación de catálogo y precios para checkout web):** mencionada en la matriz de integración del Alcance, pero Módulo E no está en Sprint 3 — el modelo de dominio de `PedidoVenta` de este documento ya está diseñado para que una orden web futura se registre como un `PedidoVenta` más con un atributo de canal, sin requerir un circuito de venta paralelo (mismo criterio que el propio Alcance Funcional documenta para Módulo E → Módulo B).
- **Alerta a la cadena de abastecimiento por demanda no prevista (integración Módulo B → Módulo H):** mencionada en la matriz de integración del Alcance, no detallada en este documento — se especifica cuando se prioricen las HU correspondientes de Módulo H que la consuman.
- **Entidad de configuración global para el umbral de arqueo ciego (HU-B2) y para los porcentajes máximos de descuento por perfil (HU-B4):** ambos valores deben ser parametrizables por Dirección, no hardcodeados en el servicio — si el Módulo D no expone aún una entidad de configuración global equivalente a la ya señalada como faltante en `spec_modulo_H.md` sección 5, es una dependencia a resolver con su owner antes de cerrar la implementación de estas dos HU.
- **Exportación de reportes de ventas y comisiones:** la matriz RBAC del Alcance Funcional habilita esta acción para Supervisor de Ventas y Auditor, pero este documento no define ningún endpoint ni contrato para ella — se asume resuelta por el Tablero de Comando de Módulo D u otro mecanismo de reporting centralizado, a confirmar con su owner antes de implementar. Fuera de alcance también de HU-B6.
- **Anulación de Pedido de Venta (§2.8):** sin código todavía — el valor real de `AuditLog.accion` para esa transición sigue sin confirmarse (`ANULACION_PEDIDO` es un placeholder usado por el filtro de HU-B6, sección 2.6).
- **Pantalla propia para HU-B6:** no implementada en esta iteración (API primero, pantalla después — mismo criterio incremental que HU-B4/HU-B5). No se pudo confirmar contra el Backlog si se exige, porque `Product Backlog - SWAT Indumentarias.xlsx` no está en el repositorio.
- **Corrección equivalente pendiente en `spec_modulo_C.md` §2.9 y `spec_modulo_H.md` §2.9:** ambos documentos tienen la misma cita a `listarEventosPorDominio`/`auditoria:leer_historico` corregida acá para Módulo B. Si HU-C10/HU-H6 todavía no tienen código real (no encontrado ningún `HU..._MODULO_C.md`/`HU6_MODULO_H.md` regenerado desde código al momento de esta corrección), deberían recibir la misma corrección antes de implementarse, para no repetir el mismo supuesto no verificado una cuarta vez.