# Variante Baja Logica Specification

## Purpose

Logical deletion of `VarianteSKU`: silent when stock = 0, mandatory `deletion_reason` when stock > 0. Exposed via `PATCH /api/inventario/variantes/[id]/baja` plus a listing with a justification modal.

## Requirements

### Requirement: Stock-Aware Soft Delete Service

The system SHALL expose `darDeBajaVariante(varianteId, usuarioId, motivo?)`, computing stockTotal over active `StockDeposito`. It MUST throw `VARIANTE_NO_ENCONTRADA` for missing/inactive variants and `MOTIVO_REQUERIDO` when stockTotal > 0 without motivo, updating only the 4 soft-delete fields — never `DELETE` nor `StockDeposito`/`MovimientoStock`.

#### Scenario: Silent delete on zero stock

- GIVEN an active variant with zero active stock
- WHEN `darDeBajaVariante` is called without motivo
- THEN only the 4 soft-delete fields change; `deletion_reason = null`

#### Scenario: Justified delete on positive stock

- GIVEN an active variant with 14 active stock units
- WHEN `darDeBajaVariante` is called with a motivo
- THEN the baja completes and the motivo is persisted in `deletion_reason`

#### Scenario: No motivo rejects without DB write

- GIVEN an active variant with stock greater than 0
- WHEN `darDeBajaVariante` is called without motivo
- THEN `MOTIVO_REQUERIDO` is thrown and no row changes

#### Scenario: Missing or already-deleted variant

- GIVEN a variant id that does not exist or has `is_active = false`
- WHEN `darDeBajaVariante` is called
- THEN `VARIANTE_NO_ENCONTRADA` is thrown and no row is updated

### Requirement: PATCH Baja Route

The system SHALL expose `PATCH /api/inventario/variantes/[id]/baja`. It MUST authenticate (`withAuth`) and restrict to active roles `ADMINISTRADOR`/`ENCARGADO_DEPOSITO` via `prisma.usuarioRol`, and MUST validate the body with `BajaLogicaVarianteSchema`, returning `400 VALIDATION_ERROR` on invalid input. Responses SHALL use the `{ data, error }` envelope.

#### Scenario: Authorized operator baja

- GIVEN an authenticated user with active role `ENCARGADO_DEPOSITO`
- WHEN `PATCH` is sent with a valid body
- THEN the route responds `200` with `{ data: { id, is_active: false, deleted_at }, error: null }`

#### Scenario: No session

- GIVEN no valid session cookie
- WHEN `PATCH` is sent
- THEN the route responds `401` `{ error: { code: "UNAUTHORIZED" } }`

#### Scenario: Role not authorized

- GIVEN an authenticated user whose active roles include only `AUDITOR`
- WHEN `PATCH` is sent
- THEN the route responds `403` `{ error: { code: "FORBIDDEN" } }`

#### Scenario: Re-baja

- GIVEN a variant already soft-deleted
- WHEN `PATCH` is sent again
- THEN the route responds `404` `{ error: { code: "VARIANTE_NO_ENCONTRADA" } }`

### Requirement: Post-Operation Domain Event Emission

The system SHALL emit `inventario:variante_baja_logica` only after the soft-delete resolves successfully, never inside `prisma.$transaction`. The payload MUST contain `variante_sku_id`, `usuario_id`, `deletion_reason`, `stock_total_al_momento`, and `ip` (default `"unknown"`, keeping `AuditLog.ip` non-null).

#### Scenario: Event after successful baja

- GIVEN a soft delete that resolved successfully
- WHEN the operation finishes
- THEN the event is emitted once with the full typed payload, including pre-update stock total

### Requirement: Audit Listener Registration

The system SHALL subscribe `inventario:variante_baja_logica` in `audit-log.listener.ts`, writing `accion: "DELETE_LOGICO"`, `tabla_afectada: "variantes_sku"`, `registro_id`, `ip`, and `valor_anterior`/`valor_nuevo` per the event. Services MUST NOT call `registrarAuditLog()` directly.

#### Scenario: Audit record appended

- GIVEN the event emitted after a successful baja
- WHEN the listener processes it
- THEN one `AuditLog` row is appended (`DELETE_LOGICO`, `variantes_sku`, payload ip)

### Requirement: Minimal Listing and Justification Modal UI

The system SHALL list active variants with a "Dar de baja" button and SHALL open `ModalJustificacionBaja` (Base UI AlertDialog) with a mandatory textarea when the variant has stock, blocking confirmation while empty. The UI MUST use the Tailwind blue palette (`blue-*`) with clear success/error messages.

#### Scenario: Modal opens on stocked variant

- GIVEN an active stocked variant in the listing
- WHEN the user clicks "Dar de baja"
- THEN the modal opens with a required empty textarea and disabled confirm

#### Scenario: Empty motivo blocks confirm

- GIVEN the justification modal is open
- WHEN the textarea is empty or whitespace
- THEN the confirm button stays disabled and no request is sent