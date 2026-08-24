# Tasks: HU-A6 — Soft delete of product variants with justification modal

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500 (470–530) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

> Over default 400-line guard, under session 800-line budget; single PR, no size:exception.

### Suggested Work Units

| Unit | Goal | PR | Focused test | Runtime harness | Rollback |
|------|------|----|--------------|-----------------|----------|
| 1 | Event type + schema | PR 1 | `npm run build` | N/A — typing only | revert event-types + schema |
| 2 | Service + listener | PR 1 | `npm run build` | N/A — no HTTP surface yet | revert service + listener |
| 3 | PATCH route | PR 1 | `npm run build` | `npm run dev` + curl seeded roles | revert baja route |
| 4 | Modal + action + page | PR 1 | `npm run build` | `npm run dev` + browser flow | revert modal/actions/page |
| 5 | Lint/build/manual verify | PR 1 | `npm run lint` + `npm run build` | Docker psql + curl | verification only |

Threat matrix: all rows `N/A` — no shell/subprocess/VCS boundary; no RED tests.

## Phase 1: Foundation — event typing & schema

- [x] 1.1 `event-types.ts`: add `VarianteBajaLogicaPayload` (`variante_sku_id`, `usuario_id`, `deletion_reason`, `stock_total_al_momento`, `ip`) + 16th map entry `"inventario:variante_baja_logica"`. Verify: build.
- [x] 1.2 `inventario.schema.ts`: add `BajaLogicaVarianteSchema` (shape-only `deletion_reason: z.string().trim().min(1).optional()`) + `BajaLogicaVarianteInput`, mirroring `DesactivarProductoMaestroSchema`. Verify: build.

## Phase 2: Core backend — service & audit listener

- [x] 2.1 `variante.service.ts`: `import "server-only"` + exported `usuarioPuedeBajarVariante(usuarioId)` — `prisma.usuarioRol` active rol in `ADMINISTRADOR`/`ENCARGADO_DEPOSITO`.
- [x] 2.2 Same file: `darDeBajaVariante(varianteId, usuarioId, motivo?, ip="unknown")` — findFirst active → `VARIANTE_NO_ENCONTRADA`; aggregate `_sum.cantidad` (`?? 0`); stock>0 && !motivo → `MOTIVO_REQUERIDO` (no write); update 4 soft-delete fields only; emit `inventario:variante_baja_logica` AFTER op, never in `$transaction`.
- [x] 2.3 `audit-log.listener.ts`: add 10th `on("inventario:variante_baja_logica")` → `registrarAuditLog` (`DELETE_LOGICO`, `variantes_sku`, registro_id, ip, valor_anterior/nuevo); 9 existing untouched. Verify: build.

## Phase 3: API route

- [x] 3.1 `baja/route.ts`: replace GET 501 with `PATCH` — withAuth (401), rol gate (403 `FORBIDDEN`), Zod safeParse (400 `VALIDATION_ERROR`), id from pathname segment len-2, ip from `x-forwarded-for`; map ServiceError → 404/400/500; `{ data, error }` envelope.

## Phase 4: Frontend

- [x] 4.1 `ModalJustificacionBaja.tsx` (NEW): Base UI AlertDialog, blue palette, required textarea only when stockTotal > 0 (confirm disabled when empty), useTransition, server-error Alert.
- [x] 4.2 `actions.ts`: `darDeBajaVarianteAction` — session + rol gate, `resolverIp()`, call service, `revalidatePath`, ActionResult `{ data, error }`.
- [x] 4.3 `page.tsx`: Server Component listing active variants (SKU, talle/color/género, producto, stockTotal) + "Dar de baja" button only if `usuarioPuedeBajarVariante()`; wire modal.

## Phase 5: Verification

- [x] 5.1 `npm run lint` + `npm run build` — zero errors.
- [x] 5.2 Manual Docker (curl PATCH): encargado/administrador → 200 (stock=0 silent, stock>0 with motivo); auditor → 403; no session → 401; stocked w/o motivo → 400 `MOTIVO_REQUERIDO` (DB untouched); re-baja → 404; psql: `audit_logs` row `DELETE_LOGICO`/`variantes_sku`.
- [x] 5.3 Zone check via `git diff --stat`: forbidden files (`hash-chain.ts`, auditoria, escaner, `movimiento.service.ts`, `package.json`, schema/migrations) untouched.
- [x] 5.4 Commit per work unit: Conventional Commits `feat(inventario): …`, no Co-Authored-By, no `.env`.