# Archive Report — HU-A6 Soft delete of product variants with justification modal

**Change**: hu-a6-baja-logica-variantes
**Archived**: 2026-08-23 → `openspec/changes/archive/2026-08-23-hu-a6-baja-logica-variantes/`
**Archive mode**: hybrid (OpenSpec filesystem + Engram persistence)
**Verdict at close**: PASS — cycle complete, archive-ready.

## Source of Truth & Traceability

Artifacts read for this report (observation IDs for Engram-backed items; paths for filesystem items):

| Artifact | Source | ID / Path |
|----------|--------|-----------|
| Proposal | filesystem | `openspec/changes/hu-a6-baja-logica-variantes/proposal.md` |
| Spec (delta) | filesystem | `openspec/changes/hu-a6-baja-logica-variantes/specs/variante-baja-logica/spec.md` |
| Design | filesystem | `openspec/changes/hu-a6-baja-logica-variantes/design.md` |
| Tasks | filesystem | `openspec/changes/hu-a6-baja-logica-variantes/tasks.md` |
| Verify report | filesystem | `openspec/changes/hu-a6-baja-logica-variantes/verify-report.md` |
| Apply progress | Engram | observation **#26** `sdd/hu-a6-baja-logica-variantes/apply-progress` |
| Config | filesystem | `openspec/config.yaml` (`rules.archive`: warn on destructive deltas — N/A: new capability, non-destructive copy) |

No `reviewGate` was discovered for this candidate (no `reviews/` artifact exists; the launch prompt carried no structured review state). Per the Native Review Receipt Gate, a structurally absent `reviewGate` proceeds to archive under ordinary repository policy — nothing to read, nothing blocking.

## Final State (at close — per launch-prompt handoff, which outranks intermediate snapshots)

- **Implementation**: 13/13 tasks complete, delivered in 4 Conventional Commits (`e1e7341`, `581890f`, `3423d35`, `c14dc81`) on base `70792f2`.
- **Verification**: `npm run lint` EXIT=0 and `npm run build` EXIT=0. 12/12 spec scenarios COMPLIANT (5/5 requirements). E2E manual browser flow **confirmed by the user** (justification modal validates empty/whitespace motivo with stock > 0; silent direct baja with stock = 0; `auditor.seed` sees no "Dar de baja" button). Prisma Studio verification of soft-delete fields and the `audit_logs` row performed by the user.
- **WARNING resolved**: `Alert variant="destructive"` in `ModalJustificacionBaja.tsx`/`page.tsx` was **kept by explicit user decision** (repo convention — semantic token `text-destructive` from `src/components/ui/alert.tsx`, not literal `red-*` classes; dominant palette remains `blue-*`).
- **User decisions implemented**:
  1. `ip` in event payload with default `"unknown"` (keeps `AuditLog.ip` NOT NULL).
  2. Auth via `withAuth` + `usuarioPuedeBajarVariante()` (active `prisma.usuarioRol` in `ADMINISTRADOR`/`ENCARGADO_DEPOSITO`) — `with-permission.ts`/`session.ts` untouched; `inventario:operar` not used (seed grants it only to `ENCARGADO_DEPOSITO`, which would lock out `ADMINISTRADOR`).
  3. `BajaLogicaVarianteSchema` shape-only (`deletion_reason: z.string().trim().min(1).optional()`); stock cross-validation lives in the service. (The original PROMPT criterion 6 mentioned `superRefine` toward services; it was interpreted per design decision D4 — recorded, not a defect.)
  4. Event named `inventario:variante_baja_logica` (16th `DomainEventMap` entry; real repo convention `inventario:*`, not the `stock:*` prefix in the academic doc).
  5. `tabla_afectada: "variantes_sku"` (lowercase `@@map` convention of `audit-log.listener.ts`; 10th listener registered).
  6. No extension of `npm test` (runner is a hot file; verification = lint + build + manual integration).
- **Known deviation (type-only)**: `VarianteDadaDeBaja.deleted_at: Date | null` vs the `Date` type in design — adjusted to the real Prisma schema (`DateTime?`); no behavior change.
- **Scope integrity**: exactly 8 files changed (verified `git diff 70792f2..HEAD --name-only`): `variante.service.ts` (0→135), `inventario.schema.ts`, `event-types.ts`, `audit-log.listener.ts`, `baja/route.ts` (PATCH replacing GET 501), `page.tsx`, `actions.ts` (0→118), `ModalJustificacionBaja.tsx` (new, 163). Forbidden zones intact (HU-A3 `crypto/aes.ts`, HU-A7 `hash-chain.ts`, Módulo D `auditoria/`, HU-MA2 `escaner/`, `movimiento.service.ts`, `package.json`, `prisma/` all absent from the diff).
- **Environmental notes (no code impact)**: local `JWT_SECRET` generated in `.env` (gitignored, never committed); `npm install` of `@zxing/browser` produced no `package.json`/lock diff. `audit_logs` smoke-test row intentionally retained (append-only ledger — expected evidence).

## Gates

| Gate | Result |
|------|--------|
| Native Review Receipt Gate | `reviewGate` absent → proceed under ordinary repository policy |
| Task Completion Gate | tasks.md 13/13 `[x]`, 0 unchecked implementation tasks |
| CRITICAL verify findings | 0 (verdict `pass`; 0 blockers, 0 critical_findings) |
| Action Context Guard | repo-local mode; all operations within `openspec/` edit scope |
| `rules.archive` (config.yaml) | warn on destructive deltas — N/A (new capability, non-destructive copy) |

## Specs Synced

`openspec/specs/` was empty (only `.gitkeep`); capability `variante-baja-logica` is NEW. The delta spec is a full spec — copied mechanically (shell `Copy-Item` → readback `git diff --no-index` exit 0, zero hunks) to:

- `openspec/specs/variante-baja-logica/spec.md` — 5 requirements, 12 scenarios (byte-identical, 4608 bytes)

No delta merge was required (no pre-existing main spec; no ADDED/MODIFIED/REMOVED/RENAMED sections to reconcile).

## Mechanical Copy Readback (verbatim)

Step 2 (spec sync): `git diff --no-index --no-color -- <delta spec> <tmp>` → exit 0, **no output** (empty diff = pass).
Step 3 (archive move): `git diff --no-index --no-color -- <pre-move snapshot> <archived folder>` → exit 0, **no output** (empty diff = pass). Only git LF→CRLF attribute advisories appeared; no content differences.
Move mechanism: `git mv` rejected the source (untracked `openspec/` directory) → `Move-Item` fallback per contract (`git mv` when tracked, `mv` otherwise). Temp snapshot removed after readback.

## Risks Carried Forward

- **None blocking.** Residual notes: proposal.md Success Criteria checkboxes remain `[ ]` (planning-phase statements, not implementation tasks); `audit_logs` smoke-test row stays in DB by design; uncommitted infra files in the working tree (`.atl/skill-registry.md`, `AGENTS.md`, `.gitignore`, `prompts/` deletion, untracked `openspec/`, `.agents/`, `skills-lock.json`) are the orchestrator's to commit/keep out of the HU-A6 PR.

## SDD Cycle Complete

Planned → specified → designed → tasked → implemented → verified → archived. Change closed.