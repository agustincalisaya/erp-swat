# HU-H9 — Registro de Comprobantes de Proveedor

**Módulo:** H (Gestión de Proveedores y Abastecimiento)
**Sprint:** 2 — ampliación incorporada en Revisión 5 de `spec_modulo_H.md`
**SP:** 3
**Spec de referencia:** `spec_modulo_H.md` §2.7, §2.7.1, §3.6, §4, §5
**Task de implementación:** `task_HU-H9.md`

---

## Parte 1 — Contexto y diseño

### 1.1. Origen de la HU

El 04/09, el PO indicó la necesidad de dos secciones no contempladas en el backlog
original de Sprint 2: **Órdenes de Pago** y **Comprobantes de Proveedores**. Tras un
análisis de trazabilidad contra el Product Backlog consolidado y el código ya
implementado de HU-G8 (Módulo G), se confirmó que ninguna HU existente cubría el
registro real de comprobantes fiscales — el spec de Módulo H ya excluía explícitamente
esa integración (`spec_modulo_H.md` §5, Revisión 4: *"una integración real con
comprobantes fiscales... queda fuera de alcance"*).

HU-H9 cubre la mitad de ese pedido (Comprobantes de Proveedores). La otra mitad
(Órdenes de Pago) es HU-G10, en Módulo G, documentada por separado.

### 1.2. Historia de Usuario

**Como** Comprador
**Necesito** una sección para registrar el comprobante fiscal (Factura A, B, C o M) que
envía un proveedor, asociado obligatoriamente a una Orden de Compra existente
**Para** dejar constancia formal de la documentación recibida del proveedor, como
respaldo previo a que Tesorería registre el pago correspondiente

### 1.3. Decisiones de diseño

**Por qué el comprobante se asocia obligatoriamente a una OC, sin carga suelta.**
Decisión del PO al definir el criterio de aceptación: todo comprobante fiscal debe
poder trazarse hasta la compra que lo originó, sin excepción.

**Por qué se restringe la carga a `OrdenCompra.estado ∈ {RECIBIDA_COMPLETA, CERRADA}`.**
No tiene sentido de negocio facturar lo que todavía no se recibió. El rango incluye
`CERRADA` porque el spec no acopla la carga del comprobante a la transición `CERRAR`
(ver 1.4) — son acciones independientes que pueden ocurrir en cualquier orden dentro de
ese rango de estados.

**Por qué `proveedor_id` está desnormalizado en `ComprobanteProveedor`.**
Prisma no admite `@@unique` compuesto sobre un campo alcanzado por relación indirecta.
El criterio de unicidad de HU-H9 (`numero_comprobante` + `tipo` + `proveedor`) exige
que `proveedor_id` sea columna propia del modelo. Se resuelve **siempre server-side**
a partir de `orden_compra.proveedor_id` en el momento de la carga — nunca se recibe del
cliente — y queda congelado (mismo patrón que `OrdenCompraItem.precio_unitario`): si el
proveedor de la OC cambiara por algún mecanismo futuro (no existe hoy), el comprobante
ya emitido no se recalcula. Beneficio adicional: HU-G10 (Módulo G) podrá listar
comprobantes por proveedor sin join contra `OrdenCompra`.

**Por qué el comprobante es inmutable.**
RULES.md Regla N.° 1 (restricción de borrado físico) y coherencia con el resto del
Módulo H: toda corrección es baja lógica del registro erróneo + alta de uno nuevo,
nunca `UPDATE` sobre lo persistido.

**Por qué la anulación es exclusiva de Supervisor de Compras.**
`spec_modulo_H.md` §2.7. Es una acción más sensible que el alta (revierte un comprobante
fiscal ya cargado), y sigue el mismo criterio ya usado en el módulo para acciones de
mayor impacto (ej. `ordenes_compra:enviar`, exclusivo Supervisor).

### 1.4. Explícitamente fuera de alcance

- **Integración AFIP / facturación electrónica real** (consulta de padrones, validación
  de CAE, emisión de comprobantes). HU-H9 es carga manual del comprobante ya emitido
  por el proveedor fuera del sistema. RULES.md Regla N.° 3 exige que, si en el futuro se
  implementa esa integración, se haga detrás de un patrón Adapter/Gateway dedicado —
  `ComprobanteProveedor` es el modelo candidato a extenderse (ej. campos de CAE), no a
  reemplazarse.
- **Asociación a `CuentaPorPagar` y uso como condición de pago** — HU-G10, Módulo G. El
  comprobante queda disponible como insumo; la integración efectiva es responsabilidad
  de ese spec, que deberá preparar el lado de relación correspondiente en
  `CuentaPorPagar` (hoy sin ningún campo hacia comprobantes).
- **Acoplamiento con la transición `CERRAR` de `OrdenCompra`** (§3.1). Cargar el
  comprobante no es condición para cerrar la OC, ni viceversa — son acciones
  independientes. Si en el futuro se decide lo contrario, es una ampliación de
  HU-H3/H4, no de HU-H9.
- **Edición de un comprobante ya creado.** No existe endpoint de `UPDATE` — es
  inmutable por diseño.

---

## Parte 2 — Implementación y testing

### 2.1. Modelo de datos

```prisma
model ComprobanteProveedor {
  id                  String           @id @default(uuid())
  orden_compra_id     String
  proveedor_id        String           // desnormalizado y congelado, ver 1.3
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

Migración: `20260907221911_add_comprobante_proveedor` (aditiva).

### 2.2. Contrato de API

| Endpoint | Permiso | Descripción |
|---|---|---|
| `POST /api/ordenes-compra/[id]/comprobantes` | `comprobantes_proveedor:crear` (Comprador) | Alta. `orden_compra_id` por path param; `proveedor_id` nunca en el body. |
| `GET /api/ordenes-compra/[id]/comprobantes` | `comprobantes_proveedor:leer` | Listado por OC, `is_active=true` por defecto. |
| `GET /api/comprobantes-proveedor` | `comprobantes_proveedor:leer` | Listado global paginado, filtrable por proveedor/OC/tipo. |
| `PATCH /api/comprobantes-proveedor/[id]/anular` | `comprobantes_proveedor:anular` (**exclusivo Supervisor de Compras**) | Baja lógica con `deletion_reason` obligatorio. |

**Códigos de error relevantes:** `ORDEN_NO_RECEPCIONADA` (409, OC fuera de
`{RECIBIDA_COMPLETA, CERRADA}` o inactiva), `COMPROBANTE_DUPLICADO` (409, terna
numero+tipo+proveedor repetida entre activos), `COMPROBANTE_YA_ANULADO` (409),
`COMPROBANTE_NO_ENCONTRADO` (404).

### 2.3. Eventos de dominio

| Evento | Disparado por | Consumidor |
|---|---|---|
| `comprobante_proveedor:registrado` | Alta, post-`COMMIT` | `audit-log.listener.ts` → `AuditLog` (`CREATE`) |
| `comprobante_proveedor:anulado` | Anulación, post-`COMMIT` | `audit-log.listener.ts` → `AuditLog` (`DELETE_LOGICO`) |

Ambos hash-encadenados vía SHA-256, mismo mecanismo del resto del Módulo H. Sin
datos sensibles en el payload.

### 2.4. Frontend

`ComprobantesProveedorCard.tsx` + `FormularioRegistrarComprobante.tsx`, anidados en el
detalle de OC existente (`compras/ordenes/[id]/page.tsx`). La card solo se muestra
cuando `OrdenCompra.estado ∈ {RECIBIDA_COMPLETA, CERRADA}`. Anulación vía modal con
motivo obligatorio, mismo patrón ya usado en el módulo.

### 2.5. Testing — resumen (evidencia completa en `RESULTADO_testing_HU-H9.md`)

| Nivel | Resultado |
|---|---|
| 1 — Unit | 14 casos nuevos, 184/184 en la suite completa. `tsc --noEmit` limpio. |
| 2 — Postman/curl | 14 casos — alta, duplicado, estado inválido, validación, permisos, sesión, listados, anulación y bordes. Esperado == obtenido en todos. |
| 3 — BD (Prisma directo) | Baja lógica con los 4 campos persistidos, sin `DELETE` físico; `proveedor_id` verificado congelado; 2 asientos de auditoría hash-encadenados sin datos sensibles. |

Criterios bloqueados: ninguno.

### 2.6. Correcciones respecto a la task original

Durante la implementación se detectaron dos discrepancias entre `task_HU-H9.md` y el
spec, resueltas a favor del spec:

- Código de error: `ORDEN_NO_RECEPCIONADA` (spec), no `OC_NO_RECEPCIONADA` (task).
- Permiso de anulación: exclusivo Supervisor de Compras (spec), no Comprador +
  Supervisor (task).

### 2.7. Relevamiento funcional post-implementación

Tras el cierre del testing formal, se ejecutó un relevamiento funcional exploratorio de
punta a punta (HU-H3 → HU-H4 → HU-H9, desde la creación de una OC nueva hasta el cierre),
navegando la UI real con los cuatro roles del circuito (Comprador, Supervisor de Compras,
Personal de Depósito, Tesorero Central).

**Resultado: sin hallazgos críticos.** Todos los controles de permisos y de estado que
debían bloquear, bloquearon correctamente; ninguna pantalla se rompió.

Hallazgos relevantes surgidos de este relevamiento:

- **De HU-H9 (corregidos, ver 2.8):** el listado de comprobantes no se actualizaba tras
  el alta sin recargar la página, y faltaba feedback visual de éxito en alta y anulación.
- **De HU-H9 (confirmado como diseño correcto, no bug):** un comprobante puede cargarse
  con la OC ya en `CERRADA` — es el comportamiento buscado (ver 1.3), no un defecto.
- **Fuera del alcance de HU-H9, para seguimiento del equipo:**
  - No existe todavía ninguna pantalla de Tesorería / Cuentas por Pagar — hoy el estado
    `PROVISORIO`/`DEFINITIVA` de HU-G8 solo es verificable por API. Es un vacío esperado
    para el sprint actual, a cubrir por HU-G10/HU-G7.
  - **Punto de negocio a definir con el equipo/PO:** la `CuentaPorPagar` pasa de
    `PROVISORIO` a `DEFINITIVA` recién al ejecutarse el cierre manual de la OC
    (`RECIBIDA_COMPLETA → CERRADA`), no al completarse la recepción total. El código
    de HU-G8 sigue su criterio de aceptación literal, pero esto puede subestimar la
    proyección de caja si una OC recibida completa nunca se cierra formalmente. No
    resuelto en este PR — corresponde a HU-G8, ya implementada y cerrada.
  - Detalles menores de wording y UX (título de pestaña por defecto en pantallas de
    detalle, texto "Emitida" en estado `BORRADOR`, variantes sin precio no filtradas en
    el selector de ítems de OC nueva) — no bloqueantes, candidatos a tasks cosméticas
    aparte.

### 2.8. Fixes de UI post-relevamiento

**Bug 1 — Listado de comprobantes no se refrescaba tras el alta.**
`FormularioRegistrarComprobante.tsx` cerraba el modal (`handleOpenChange(false)`, con el
teardown del `Dialog` y el reseteo de estado que eso dispara) *antes* de llamar a
`router.refresh()`, dejando el refetch sin efecto real hasta una recarga manual (F5).
**Fix:** se reordenó para que `router.refresh()` corra primero, con el componente todavía
montado y estable — mismo patrón ya usado en `PasoTransferencia` (HU-A11). Se agregó
además un toast de éxito (`@/components/ui/toast`), que no existía. Verificado en
runtime: alta visible sin F5, orden por `fecha_emision` desc correcto, casos de error
(duplicado) sin regresión. Diff: 1 archivo, +11/−1.

**Bug 2 (sospechado) — mismo problema en la anulación.**
Se investigó si `DialogAnularComprobante.tsx` (mismo orden aparente `handleClose() →
router.refresh()`) sufría el mismo problema. **Verificado en runtime: no se reproduce.**
El componente usa `<AlertDialog>` con un `onClick` simple (sin `<form>`) y solo 3
`setState` antes del refresh, contra los 8 `setState` y el submit de formulario del
componente de alta — el refresh sobrevive al cierre sin inconvenientes. **No se aplicó
ningún reorden** (no hay problema que corregir). Se agregó igualmente el toast de éxito,
por ser un ítem de UX independiente ya decidido con el equipo, no una corrección de bug.
Diff: 1 archivo, +6/−0.

### 2.9. Dependencias hacia adelante

HU-G10 (Módulo G, Tesorería) consumirá `ComprobanteProveedor` como insumo obligatorio
antes de marcar una `CuentaPorPagar` como pagada. Ese spec deberá definir la cardinalidad
de la relación (¿un comprobante puede respaldar más de una `CuentaPorPagar` de la misma
OC, por ejemplo ante recepciones parciales facturadas por separado?) y agregar el campo
de relación correspondiente en `CuentaPorPagar` — ninguna de las dos cosas se implementó
en este PR.
