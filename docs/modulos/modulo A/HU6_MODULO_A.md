# HU-A6 — Baja lógica de variantes de producto (Soft Delete)

Implementación técnica de la baja lógica de `VarianteSKU` con modal de justificación (Módulo A, Sprint 1). Flujo SDD completo: `explore → propose → spec → design → tasks → apply → verify → archive`.

## Lógica de Soft Delete

- La baja **nunca ejecuta `DELETE`**: es un `UPDATE` sobre los 4 campos de soft delete de `VarianteSKU`:
  `is_active = false`, `deleted_at = now()`, `deleted_by = <usuario de sesión>`, `deletion_reason = <motivo|null>`.
- **Stock remanente**: `stockTotal = SUM(StockDeposito.cantidad WHERE variante_sku_id = <id> AND is_active = true)`.
  - `stockTotal = 0` → baja **silenciosa** (`deletion_reason = null`).
  - `stockTotal > 0` sin motivo → rechazo `MOTIVO_REQUERIDO` (400) **sin tocar la base**.
  - `stockTotal > 0` con motivo → la baja se completa y persiste el motivo.
- No se modifican `StockDeposito` ni `MovimientoStock` como efecto colateral (se preservan para trazabilidad).

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `PATCH` | `/api/inventario/variantes/[id]/baja` | Da de baja lógica una variante (reemplaza el stub GET 501). |

Respuestas (envelope `{ data, error }`):

| Código | Caso |
|--------|------|
| `200` | Baja completada: `{ data: { id, is_active, deleted_at, deletion_reason }, error: null }` |
| `400` | `VALIDATION_ERROR` (body inválido) o `MOTIVO_REQUERIDO` (stock > 0 sin motivo) |
| `401` | `UNAUTHORIZED` (sin sesión) |
| `403` | `FORBIDDEN` (rol sin autorización) |
| `404` | `VARIANTE_NO_ENCONTRADA` (inexistente, ya inactiva o re-baja) |
| `500` | `INTERNAL_ERROR` |

## Autorización

- `withAuth` (sesión JWT activa, usuario `ACTIVO`/`is_active`) + verificación de rol vía Prisma:
  `usuarioPuedeBajarVariante()` acepta roles activos `ADMINISTRADOR` o `ENCARGADO_DEPOSITO` (`UsuarioRol → Rol`, ambos `is_active`).
- No se usa el permiso `inventario:operar` (placeholder deprecado). `AUDITOR` queda excluido (403 y sin botón en UI).

## Evento de dominio y auditoría

- Evento: **`inventario:variante_baja_logica`** (16.º del `DomainEventMap`), emitido **después** de que el `UPDATE` resuelve — nunca dentro de `prisma.$transaction`.
- Payload tipado `VarianteBajaLogicaPayload`: `{ variante_sku_id, usuario_id, deletion_reason, stock_total_al_momento, ip }` (`ip` default `"unknown"` porque `AuditLog.ip` es NOT NULL).
- El service **no escribe `AuditLog` directamente**: el listener `audit-log.listener.ts` (10.º, única vía de escritura) registra `accion: "DELETE_LOGICO"`, `tabla_afectada: "variantes_sku"`, `registro_id`, `ip`, `valor_anterior`/`valor_nuevo` y construye la cadena SHA-256.

## Componentes / archivos clave

| Archivo | Rol |
|---------|-----|
| `src/lib/services/inventario/variante.service.ts` | `darDeBajaVariante(varianteId, usuarioId, motivo?, ip)` + `usuarioPuedeBajarVariante()` |
| `src/lib/schemas/inventario.schema.ts` | `BajaLogicaVarianteSchema` shape-only (`deletion_reason: z.string().trim().min(1).optional()`) |
| `src/lib/events/event-types.ts` | `VarianteBajaLogicaPayload` + entrada del evento |
| `src/lib/events/listeners/audit-log.listener.ts` | Listener de auditoría `DELETE_LOGICO`/`variantes_sku` |
| `src/app/api/inventario/variantes/[id]/baja/route.ts` | `PATCH` con auth + rol + Zod + mapeo de errores |
| `src/app/(dashboard)/inventario/variantes/page.tsx` | Server Component: listado de variantes activas + botón "Dar de baja" (solo autorizados) |
| `src/app/(dashboard)/inventario/variantes/actions.ts` | Server Action `darDeBajaVarianteAction` (sesión, rol, `resolverIp`, `revalidatePath`) |
| `src/components/inventario/ModalJustificacionBaja.tsx` | Modal AlertDialog (Base UI): textarea obligatorio solo si stock > 0, confirmación bloqueada si vacío, paleta azul `blue-*` |

## Verificación

- `npm run lint` y `npm run build`: EXIT 0.
- Integración manual contra PostgreSQL (Docker) + E2E navegador: casos 401/400/200/404/403, soft delete verificado en Prisma Studio y registro en `audit_logs`.
- Sin cambios de schema, sin dependencias nuevas, sin tocar `package.json`.