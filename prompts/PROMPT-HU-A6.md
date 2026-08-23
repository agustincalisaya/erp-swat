# /sdd-new "HU-A6 — Baja lógica (Soft Delete) de variantes de producto con modal de justificación (Módulo A, Sprint 1)"

## Contexto

Proyecto: **SWAT Indumentarias ERP** (Next.js 16 App Router + Prisma v6 + PostgreSQL 16 en Docker + Tailwind CSS v4). Proyecto académico/profesional bajo metodología **Scrum**, Sprint 1.

Módulos en este repo: **Módulo A** (Inventario, SKUs, Depósitos, Movimientos) y **Módulo D** (Seguridad, RBAC, Auditoría Forense).

Estado actual (tras el pull de PRs #18–#22):
- **HU-A3** (legajos de prueba + cifrado AES-256) mergeada — **ZONA AJENA**.
- **Módulo D** terminado y mergeado (RBAC, sesiones, auditoría forense SHA-256) — **ZONA AJENA**.
- **HU-MA2** (ingreso de mercadería por escáner/QR) mergeada — **ZONA AJENA**.
- La infraestructura de eventos de dominio ya existe: `DomainEventMap` tipado en `src/lib/events/event-types.ts` (13 eventos), singleton `domain-event-bus.ts`, y `src/lib/events/listeners/audit-log.listener.ts` (9 listeners) como **ÚNICA vía de escritura** a `AuditLog`.

Falta implementar (foco de esta tarea): la **HU-A6 — Baja lógica (Soft Delete) de variantes de producto con modal de justificación**. Ya está **especificada** en `docs/specs/spec_modulo_A.md` (§2.5, §3.5, §4), pero el código sigue vacío.

Objetivo: implementar la HU-A6 usando el flujo **SDD** (explore → propose → spec → design → tasks → apply → verify → archive), delegando todo el trabajo pesado a los sub-agentes `sdd-*`, y respetando estrictamente las zonas prohibidas.

---

## Requerimientos

### R1 – Validación de stock remanente

1. Antes de procesar la baja de una variante, el backend debe calcular el stock total de la variante consultando la tabla `stock_depositos` (modelo Prisma `StockDeposito`), sumando `cantidad` para esa `variante_sku_id` filtrando **solo registros activos** (`is_active = true`).
2. La consulta y la validación viven en la **capa de servicios** (`src/lib/services/inventario/variante.service.ts`), no en el route handler ni en el schema.

### R2 – Baja lógica silenciosa (stock = 0)

1. Si el stock total es **0**, ejecutar la baja lógica de forma **directa y silenciosa**:
   - `UPDATE` con `is_active = false`, `deleted_at = new Date()`, `deleted_by = <usuario_id de la sesión autenticada>`, `deletion_reason = null`.
2. **Prohibido** el `DELETE` físico (regla de Soft Delete estricta de `RULES.md`).
3. La operación **solo** actualiza los 4 campos de soft delete (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`) — **nunca** modificar `StockDeposito` ni `MovimientoStock` como efecto colateral (se preservan para trazabilidad).

### R3 – Modal de justificación (stock > 0)

1. Si el stock total es **> 0**, el frontend (`src/app/(dashboard)/inventario/variantes/`) debe lanzar un **modal de justificación** que exija un motivo **obligatorio** (ej: "descontinuado con stock a liquidar").
2. **Regla doble (defensa en profundidad):**
   - El **frontend** muestra el modal y no envía la baja sin motivo.
   - El **backend** re-valida: si el stock total > 0 y el motivo viene vacío, rechaza con `ServiceError("MOTIVO_REQUERIDO")` (HTTP 400) **sin tocar la base**.
3. Si el motivo se aprueba, se persiste en `deletion_reason`.

### R4 – Propagación del evento de dominio

1. Al finalizar el `UPDATE` exitoso, emitir el evento de dominio **`inventario:variante_baja_logica`** al bus (`domain-event-bus.ts`).
2. **El evento se emite DESPUÉS** de que la transacción/operación resuelva exitosamente — nunca dentro de `prisma.$transaction` (regla de emisión de la spec A §4).
3. **Quien desarrolla la HU-A6 NO implementa la auditoría.** Solo emite el evento para que el Módulo D (que ya existe) lo atrape. La cadena de hashes SHA-256 la construye el listener de auditoría (`audit-log.listener.ts`).
4. **Nunca** escribir `AuditLog` directamente desde el service.

---

## Criterios de aceptación

| # | Criterio |
| --- | --- |
| 1 | `src/lib/services/inventario/variante.service.ts` implementa `darDeBajaVariante(varianteId, usuarioId, motivo?)` que calcula `stockTotal = SUM(StockDeposito.cantidad WHERE variante_sku_id = <id> AND is_active = true)`. |
| 2 | Si `stockTotal = 0`: la baja es silenciosa; se actualiza solo `is_active = false`, `deleted_at`, `deleted_by` (usuario autenticado) y `deletion_reason = null`. No se ejecuta `DELETE` y no se tocan `StockDeposito` ni `MovimientoStock`. |
| 3 | Si `stockTotal > 0` y no hay `deletion_reason`, el service lanza `ServiceError("MOTIVO_REQUERIDO")` y la ruta responde `400` con el formato `{ data: null, error: { code: "MOTIVO_REQUERIDO", message: "..." } }`, sin modificar la base. |
| 4 | Si `stockTotal > 0` y hay `deletion_reason`, la baja se completa persistiendo el motivo en `deletion_reason`. |
| 5 | La ruta `PATCH /app/api/inventario/variantes/[id]/baja/route.ts` reemplaza al stub actual (GET 501 "En construcción") e implementa el `PATCH` con validación Zod (`BajaLogicaVarianteSchema`) y autorización (`withAuth` / `withPermission`). |
| 6 | Se crea `BajaLogicaVarianteSchema` en `src/lib/schemas/inventario.schema.ts` con `deletion_reason: z.string().min(1).optional()` + superRefine hacia la capa de servicios (validación cruzada con stock real). |
| 7 | El frontend `src/app/(dashboard)/inventario/variantes/` lista variantes activas con un botón "Dar de baja"; si la variante tiene stock > 0 muestra el modal de justificación con texto obligatorio. |
| 8 | Tras el `UPDATE` exitoso, se emite el evento `inventario:variante_baja_logica` (después de la operación, nunca dentro de la transacción) con payload `variante_sku_id`, `usuario_id`, `deletion_reason`, `stock_total_al_momento`. |
| 9 | El service **no** llama a `registrarAuditLog()` directamente; la escritura a `AuditLog` queda exclusivamente en `audit-log.listener.ts`. |
| 10 | `npm run lint` y `npm run build` pasan sin errores. |
| 11 | No se introduce ninguna regresión en HU-A3, HU-A7, Módulo D ni HU-MA2 (zonas prohibidas intactas). |
| 12 | La paleta de colores utilizada en la UI es **si o sí la paleta azul de Tailwind CSS** (ej. `bg-blue-*`, `text-blue-*`, etc.). |

---

## Archivos a modificar/crear

> **Nota de terminología real:** el documento académico usa `variante_producto`, `stock_variante_deposito` y `log_auditoria`, pero el esquema real de Prisma usa `VarianteSKU` (`@@map "variantes_sku"`), `StockDeposito` (`@@map "stock_depositos"`) y `AuditLog` (`@@map "audit_logs"`). Los campos reales de soft delete son `is_active`, `deleted_at`, `deleted_by`, `deletion_reason`. Usar SIEMPRE los nombres reales.

| Archivo | Acción |
| --- | --- |
| `src/lib/services/inventario/variante.service.ts` | **Implementar** `darDeBajaVariante(varianteId, usuarioId, motivo?)`: validación de stock, baja silenciosa o con motivo, y emisión del evento `inventario:variante_baja_logica` **después** de la operación. Actualmente está vacío. |
| `src/lib/schemas/inventario.schema.ts` | **Crear** `BajaLogicaVarianteSchema` (`deletion_reason: z.string().min(1).optional()` + superRefine hacia la capa de servicios). |
| `src/lib/events/event-types.ts` | **Agregar** al `DomainEventMap` el evento `inventario:variante_baja_logica` con su payload tipado `VarianteBajaLogicaPayload` (`variante_sku_id`, `usuario_id`, `deletion_reason`, `stock_total_al_momento`). |
| `src/lib/events/listeners/audit-log.listener.ts` | **Registrar** el listener de `inventario:variante_baja_logica` con `accion: "DELETE_LOGICO"` y `tabla_afectada: "variantes_sku"` (convención `@@map` en minúsculas). NO llamar `registrarAuditLog()` desde el service. |
| `src/app/api/inventario/variantes/[id]/baja/route.ts` | **Reemplazar** el stub GET 501 por un `PATCH` que valida con Zod, autentica con `withAuth`/`withPermission`, llama a `darDeBajaVariante()` y devuelve el formato de respuesta de la spec (`200 OK` o `400 MOTIVO_REQUERIDO`). |
| `src/app/(dashboard)/inventario/variantes/page.tsx` | **Implementar** listado mínimo de variantes activas con botón "Dar de baja" + integración del modal de justificación. (Solo lo necesario para la baja, sin CRUD completo.) |
| `src/app/(dashboard)/inventario/variantes/actions.ts` | **Implementar** la Server Action(s) de la baja (autenticada, con permiso) que orquesta el modal + la llamada al service. Actualmente vacío. |
| `src/components/inventario/` (nuevo) | **Crear** el componente del modal de justificación (ej. `ModalJustificacionBaja.tsx`) reutilizable, con la paleta azul de Tailwind. |

---

## Notas técnicas y restricciones

- **Entorno ya levantado:** PostgreSQL 16 corre en Docker (`swat_erp_postgres`), dependencias instaladas y migraciones Prisma sincronizadas. **No reintentar setup ni ejecutar migraciones destructivas.** `npx prisma migrate status` es solo lectura. No inventar comandos de test (no hay runner configurado; validar con `npm run lint` y `npm run build`).
- **Prohibición absoluta — ZONAS PROHIBIDAS (no tocar, no modificar, no "mejorar"):**
  - **HU-A3 (cifrado AES-256):** `src/lib/crypto/aes.ts`, `ENCRYPTION_KEY_LEGAJOS`, modelo `LegajoPrueba` (`legajos_prueba`), `src/lib/services/inventario/legajo-prueba.service.ts`, `src/app/(dashboard)/inventario/legajos-prueba/`, evento `inventario:legajo_prueba_iniciado`.
  - **HU-A7 (ledger criptográfico SHA-256):** `src/lib/crypto/hash-chain.ts` y toda la lógica de encadenamiento. La HU-A6 **solo emite el evento**; la cadena la construye el listener de auditoría.
  - **Módulo D:** `src/lib/services/auditoria/*`, `src/components/auditoria/*`, `src/app/api/auth/*`, `src/app/api/auditoria/*`, `docs/specs/spec_modulo_D.md`.
  - **HU-MA2 (escáner/QR):** `src/hooks/useBarcodeScanner.ts`, `src/components/inventario/escaner/*`, `src/app/api/inventario/escaner/*`, la sección de ingreso en `movimientos/page.tsx`, `@zxing/browser`.
  - **Transferencias de stock:** `movimiento.service.ts`, `TipoMovimiento.TRANSFERENCIA`, movimientos entre depósitos.
  - **Tu mundo termina al actualizar el estado a `false` y emitir el evento.** No desarrollás la auditoría.
- **Soft Delete estricto (RULES.md):** prohibido el `DELETE` físico. `onDelete: Restrict` en todas las relaciones. Los `SELECT` filtran por defecto `WHERE is_active = true`.
- **Auditoría vía eventos, nunca directa:** ningún service escribe `AuditLog`. Se emite el evento al bus y `audit-log.listener.ts` (única vía de escritura) lo registra.
- **Emisión del evento:** siempre **después** de que la operación resuelva; nunca dentro de `prisma.$transaction`.
- **Evento elegido:** `inventario:variante_baja_logica` (consistente con la convención real del código que usa `inventario:*` para el Módulo A). La spec A §4 lo nombra `stock:variante_baja_logica`; se alinea con el código y se deja constancia de la decisión.
- **Auth/RBAC:** usar `src/lib/auth/session.ts` para obtener `usuario_id` (va a `deleted_by`) y `src/lib/auth/with-permission.ts` (`withAuth` / `withPermission("inventario:operar", handler)`).
- **Paleta de colores:** la UI debe usar **si o sí la paleta azul de Tailwind CSS** (clases `blue-*`).
- **Manejo de errores:** devolver mensajes genéricos al UI; no exponer detalles de la base de datos ni stack traces. Formato de respuesta de la spec: `{ data, error }`.
- **Documentación:** los cambios de comportamiento deben reflejarse en `docs/specs/` siguiendo `cognitive-doc-design`.
- **Commits:** Conventional Commits (`feat`, `fix`, `docs`, `refactor`), sin atribución "Co-Authored-By" de IA. No commitear secretos ni `.env`.

---

## PROMPT por Fase SDD

**Qué debe generar el orchestrator (a través de los sub-agentes):**

1. **Explorar** el estado actual del flujo de baja de variantes: `variante.service.ts` (vacío), la ruta `PATCH /app/api/inventario/variantes/[id]/baja/route.ts` (stub 501), el stub de `variantes/page.tsx` + `actions.ts` vacío, la ausencia del evento `inventario:variante_baja_logica` en `event-types.ts` y del listener en `audit-log.listener.ts`. Revisar `docs/specs/spec_modulo_A.md` §2.5/§3.5/§4 como contrato.
2. **Proponer** implementar `darDeBajaVariante()` en la capa de servicios, el schema `BajaLogicaVarianteSchema`, el evento `inventario:variante_baja_logica`, el listener de auditoría, el `PATCH` en la ruta de baja y el listado mínimo de variantes con modal de justificación.
3. **Especificar** los flujos de usuario detallados: (a) baja con stock = 0 (silenciosa), (b) baja con stock > 0 (modal de justificación obligatorio), (c) rechazo del backend con `MOTIVO_REQUERIDO`, (d) emisión del evento y (e) registro en auditoría por el listener.
4. **Diseñar** la firma de `darDeBajaVariante`, el payload del evento `VarianteBajaLogicaPayload`, el listener (patrón `usuario:baja_logica` como modelo) y el componente del modal de justificación (paleta azul Tailwind).
5. **Tareas** (dividir en unidades de trabajo):
   - Tipar el evento `inventario:variante_baja_logica` en `event-types.ts`.
   - Implementar `darDeBajaVariante()` en `variante.service.ts` (validación de stock, baja, emisión post-transacción).
   - Crear `BajaLogicaVarianteSchema` en `inventario.schema.ts`.
   - Registrar el listener de auditoría en `audit-log.listener.ts`.
   - Implementar el `PATCH` en `variantes/[id]/baja/route.ts` (Zod + `withAuth`/`withPermission`).
   - Implementar el listado mínimo + botón "Dar de baja" en `variantes/page.tsx` y la Server Action en `variantes/actions.ts`.
   - Crear el componente del modal de justificación (paleta azul Tailwind).
6. **Aplicar** las tareas en batches, respetando las zonas prohibidas y la regla de emisión de eventos post-transacción.
7. **Verificar** con `npm run lint` y `npm run build` que todo compila, que la ruta responde según la spec, que el evento se emite tras la operación, que el service no escribe `AuditLog` directo y que no hay regresiones en las zonas prohibidas.
8. **Archivar** el cambio en el artifact store (engram/openspec/both según la pre-flight de la sesión).