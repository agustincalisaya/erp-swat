# Design: HU-A6 — Soft delete of product variants with justification modal

## Technical Approach

Stock-aware soft delete as a thin vertical slice following the repo's established patterns: domain logic in `variante.service.ts` (model: `desactivarProductoMaestro()`), shape-only Zod schema (model: `DesactivarProductoMaestroSchema`), `PATCH` route with `withAuth` + `{ data, error }` envelope (model: `productos/[id]/route.ts`), post-op event emission via `domain-event-bus.ts`, audit only through a new listener in `audit-log.listener.ts` (model: `usuario:baja_logica`). UI mirrors `DialogBajaUsuario` in the mandated blue palette. References: `specs/variante-baja-logica/spec.md`; contracts spec_modulo_A.md §2.5/§3.5/§4 and spec_modulo_D.md §4.

## Architecture Decisions

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| D1 | `ip` in payload (user) | Route extracts `x-forwarded-for` first value → 4th optional param `ip = "unknown"` | Service reads headers; constant `"unknown"` | `AuditLog.ip` NOT NULL; keeps service testable; matches existing `resolverIp()` convention |
| D2 | Authorization (user) | `withAuth` + shared `usuarioPuedeBajarVariante()` via `prisma.usuarioRol` (rol `in` `ADMINISTRADOR`/`ENCARGADO_DEPOSITO`, `is_active`) → 403 | `withPermission("inventario:operar")` | Seed grants that permiso only to ENCARGADO_DEPOSITO — ADMINISTRADOR would be locked out. `with-permission.ts`/`session.ts` untouched |
| D3 | Verification (user) | `npm run lint` + `npm run build` + manual Docker integration | Extending `npm test` | Runner is a hot file; no extension |
| D4 | Schema (user) | Shape-only: `deletion_reason: z.string().trim().min(1).optional()` | superRefine w/ DB stock check | Cross-validation belongs in the service (spec A §2.5/§3.5); schema stays thin like `DesactivarProductoMaestroSchema` |
| D5 | Event name (user) | `inventario:variante_baja_logica` | `stock:variante_baja_logica` (docs) | Real convention is `inventario:*` (e.g. `inventario:ingreso_stock_registrado`) |
| D6 | `tabla_afectada` (user) | `"variantes_sku"` | `"VarianteSKU"` (spec D) | Existing listeners use lowercase `@@map` (`usuarios`, `roles`, `sesiones`) |
| D7 | Route id extraction | `pathname.split("/")` segment `len-2` | `pop()` (productos); `context.params` | `[id]` is not last in `[id]/baja`; `withAuth` handler doesn't type params |
| D8 | Role helper placement | Export `usuarioPuedeBajarVariante` from `variante.service.ts` | New file in shared `src/lib/auth/`; duplicated inline checks | Single source of truth for route + action; inventario zone stays self-contained |
| D9 | Modal stock behavior | Listing computes `stockTotal`; button always shown; textarea required only when `stockTotal > 0`, direct confirm when 0 | Modal only for stocked variants | Single code path; server re-validates (defense in depth, R3) |
| D10 | Aggregate null | `_sum.cantidad ?? 0` | Trust non-null | No `StockDeposito` rows → aggregate returns `null` |
| D11 | Button visibility | Page renders "Dar de baja" only when `usuarioPuedeBajarVariante()`; else read-only list | Always render | Authoritative gate is the 403 in route/action; avoids dead buttons |

## Data Flow

```
Browser ──PATCH /api/inventario/variantes/[id]/baja──▶ route.ts
  │  withAuth → 401 · rol check → 403 · Zod safeParse → 400
  ▼
darDeBajaVariante(id, userId, motivo?, ip="unknown")
  ├─ findFirst VarianteSKU {id, is_active:true} → ServiceError VARIANTE_NO_ENCONTRADA
  ├─ stockDeposito.aggregate(_sum.cantidad, activos) → stockTotal (null → 0)
  ├─ stockTotal > 0 && !motivo → ServiceError MOTIVO_REQUERIDO (DB untouched)
  ├─ update VarianteSKU {is_active:false, deleted_at, deleted_by, deletion_reason}
  └─ emit "inventario:variante_baja_logica" ──▶ audit-log.listener
       └─ registrarAuditLog(DELETE_LOGICO, variantes_sku) ──▶ AuditLog (append-only)
```

Event emitted strictly after the op resolves, never inside `$transaction` (mutation is single-table; no transaction needed).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/services/inventario/variante.service.ts` | Modify | `darDeBajaVariante()` + exported `usuarioPuedeBajarVariante()`; `import "server-only"` |
| `src/lib/schemas/inventario.schema.ts` | Modify | `BajaLogicaVarianteSchema` + `BajaLogicaVarianteInput` |
| `src/lib/events/event-types.ts` | Modify | `VarianteBajaLogicaPayload` + map entry (16th) |
| `src/lib/events/listeners/audit-log.listener.ts` | Modify | 10th listener (`inventario:variante_baja_logica`); 9 existing untouched |
| `src/app/api/inventario/variantes/[id]/baja/route.ts` | Modify | `PATCH` replaces GET 501 stub |
| `src/app/(dashboard)/inventario/variantes/page.tsx` | Modify | Server Component: active-variant list (SKU, talle/color/género, producto, stockTotal) + blue tile header |
| `src/app/(dashboard)/inventario/variantes/actions.ts` | Modify | `darDeBajaVarianteAction` (ActionResult envelope, `resolverIp()`, revalidatePath) |
| `src/components/inventario/ModalJustificacionBaja.tsx` | Create | Base UI AlertDialog clone of `DialogBajaUsuario` (blue palette, required textarea, useTransition, server-error Alert) |

## Interfaces / Contracts

```ts
// variante.service.ts
export async function darDeBajaVariante(
  varianteId: string, usuarioId: string, motivo?: string, ip = "unknown",
): Promise<{ id: string; is_active: boolean; deleted_at: Date; deletion_reason: string | null }>;
export async function usuarioPuedeBajarVariante(usuarioId: string): Promise<boolean>;

// inventario.schema.ts
export const BajaLogicaVarianteSchema = z.object({
  deletion_reason: z.string().trim().min(1).optional(),
});

// event-types.ts — 16th map entry
export interface VarianteBajaLogicaPayload {
  variante_sku_id: string;
  usuario_id: string;
  deletion_reason: string | null;
  stock_total_al_momento: number;
  ip: string;
}
"inventario:variante_baja_logica": VarianteBajaLogicaPayload;

// audit-log.listener.ts — new subscription (service never calls registrarAuditLog)
domainEventBus.on("inventario:variante_baja_logica", (p) => {
  void registrarAuditLog({
    usuario_id: p.usuario_id, accion: "DELETE_LOGICO", tabla_afectada: "variantes_sku",
    registro_id: p.variante_sku_id, ip: p.ip,
    valor_anterior: { is_active: true },
    valor_nuevo: { is_active: false, deletion_reason: p.deletion_reason,
                   stock_total_al_momento: p.stock_total_al_momento },
  });
});
```

Route responses: `200 { data: { id, is_active, deleted_at, deletion_reason }, error: null }`; `400 VALIDATION_ERROR` / `MOTIVO_REQUERIDO`; `403 FORBIDDEN`; `404 VARIANTE_NO_ENCONTRADA`; `500 INTERNAL_ERROR`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Service invariants; schema shape | `npm run lint` + `npm run build` (no runner extension, D3) |
| Integration | Docker Postgres: `encargado.seed`/`administrador.seed` (roles OK), `auditor.seed` (403); `VARIANTE_CAMISA_TACTICA_1_ID` (29 u), `VARIANTE_CAMISA_TACTICA_2_ID` (24 u), `VARIANTE_BORCEGOS_1_ID` (33 u) → MOTIVO_REQUERIDO / justified baja; variant with no `StockDeposito` → silent delete; re-baja → 404; `audit_logs` row `DELETE_LOGICO`/`variantes_sku` | curl + psql |
| E2E | Modal: textarea empty-disabled when stock > 0; direct confirm when 0 | Manual browser |

## Threat Matrix

`N/A` — no shell commands, subprocesses, VCS/PR automation, executable-file classification, or process-integration boundary. The only routing surface is an HTTP route handler gated by authz (D2). All rows (documentation-like paths, git selection, commit state, push state, PR commands) are `N/A`: the change neither composes nor executes external commands. No RED tests required.

## Migration / Rollout

No migration required — the 4 soft-delete fields and `AuditLog` already exist; no schema change, no new deps, no feature flags. Rollback: `git revert` of the change commits.

## Open Questions

- None blocking.