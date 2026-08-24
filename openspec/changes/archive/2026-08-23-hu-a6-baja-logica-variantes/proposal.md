# Proposal: HU-A6 — Soft delete of product variants with justification modal

## Intent

Implement HU-A6: logical deletion of `VarianteSKU`. Silent soft delete when stock = 0; mandatory `deletion_reason` via justification modal when stock > 0, re-validated server-side. Emit `inventario:variante_baja_logica` post-operation; audit only via `audit-log.listener.ts`. All code greenfield.

## Scope

**In**
- `darDeBajaVariante(varianteId, usuarioId, motivo?)` in `variante.service.ts`: stock SUM on active `StockDeposito`, silent/justified delete, post-op event.
- `BajaLogicaVarianteSchema` in `inventario.schema.ts` (shape-only).
- `inventario:variante_baja_logica` + `VarianteBajaLogicaPayload` in `event-types.ts`.
- Listener in `audit-log.listener.ts` (`DELETE_LOGICO`, `variantes_sku`).
- `PATCH /api/inventario/variantes/[id]/baja` (replaces GET 501 stub).
- Minimal listing + "Dar de baja" button (`variantes/page.tsx`); server action (`actions.ts`).
- New `src/components/inventario/ModalJustificacionBaja.tsx` (blue Tailwind).

**Out**
- Full variant CRUD; schema/migrations; new deps; `package.json`; forbidden zones (HU-A7, Módulo D, HU-MA2, transfers).

## Capabilities

> `openspec/specs/` empty — all new.

**New**
- `variante-baja-logica`: soft-delete flow for `VarianteSKU` — stock-conditional justification, service contract, PATCH route, minimal listing + modal UI, event emission and audit listener wiring.

**Modified**
- None.

## Approach

Hybrid: PROMPT mandates (event name, `{data,error}`, positional signature) + repo conventions (shape-only schema, lowercase `@@map` `tabla_afectada`, blue modal on `DialogBajaUsuario`, stock validation in service). Models: `desactivarProductoMaestro()` + `productos/[id]/route.ts`.

## Key Decisions (user authority)

1. **`ip` in payload** (default `"unknown"`): `AuditLog.ip` NOT NULL — without it the listener silently drops the record. Route extracts from `x-forwarded-for` (pattern `usuario:baja_logica`).
2. **Auth:** `withAuth` + role check via `prisma.usuarioRol` (`ADMINISTRADOR`/`ENCARGADO_DEPOSITO`) → 403 `FORBIDDEN`; `AUDITOR` excluded. Do NOT modify `with-permission.ts`/`session.ts`.
3. **Verification:** lint + build + manual integration vs Docker Postgres. No `npm test` extension (hot file).
4. **Schema shape-only:** `deletion_reason: z.string().trim().min(1).optional()`; stock cross-validation lives in the service.
5. **Event name:** `inventario:variante_baja_logica` (real convention, not `stock:*`).
6. **`tabla_afectada`:** `"variantes_sku"` (lowercase `@@map`).

## Affected Areas

| Area | Impact | Change |
|------|--------|--------|
| `variante.service.ts` | Mod | `darDeBajaVariante()` |
| `inventario.schema.ts` | Mod | `BajaLogicaVarianteSchema` |
| `event-types.ts` | Mod | payload + map entry |
| `audit-log.listener.ts` | Mod | DELETE_LOGICO listener |
| `baja/route.ts` | Mod | PATCH (was GET 501) |
| `variantes/page.tsx` | Mod | listing + button |
| `variantes/actions.ts` | Mod | baja server action |
| `ModalJustificacionBaja.tsx` | New | justification modal (blue) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Audit `ip` null → silent record loss | Med | `ip` default `"unknown"` |
| Test user lacks role → 403 | Med | Use seeded role-bearing user |
| Re-baja of inactive variant | Low | 404 `VARIANTE_NO_ENCONTRADA` (spec) |
| Stale docs (13 events/no runner; actual 15 + npm test) | Low | Update AGENTS.md/config in apply |

## Rollback Plan

Changes confined to the 8 listed files; `git revert` of change commits; no migrations to undo.

## Dependencies

- None (no new packages). Seeded roles + stock-bearing variants for manual integration.

## Success Criteria

- [ ] Stock = 0 → silent soft delete; only 4 soft-delete fields updated.
- [ ] Stock > 0 without reason → 400 `MOTIVO_REQUERIDO`, DB untouched.
- [ ] Event emitted after operation resolves (never inside `$transaction`); listener writes `DELETE_LOGICO`/`variantes_sku`.
- [ ] Service never calls `registrarAuditLog()`.
- [ ] lint + build pass; forbidden zones untouched.