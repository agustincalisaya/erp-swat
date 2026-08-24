```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b986f405c288b40fabc60e0e0420294d87b35077be522bb17a730b525fd4a746
verdict: pass
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 12/12
test_command: npm run lint
test_exit_code: 0
test_output_hash: sha256:5d7be1e496079e9117f5281b95497a4d0a08c9363f16af8dcecf9f476ba5e63a
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:3f1be1f9e9036ecb12ee74c773440852d29280f94987665a0109fb19791a5678
```

## Verification Report

**Change**: hu-a6-baja-logica-variantes
**Version**: spec v1 (`openspec/changes/hu-a6-baja-logica-variantes/specs/variante-baja-logica/spec.md`)
**Mode**: Standard (strict_tdd: false — sin runner de tests; validación lint+build + integración manual Docker + E2E navegador manual confirmado por el usuario, decisión D3 del design y PROMPT-HU-A6.md R1)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 13 |
| Tasks complete | 13 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: ✅ Passed
```text
npm run build → EXIT=0 (Next.js 16.3.0 Turbopack; TypeScript OK en 17.3s; 25 rutas compiladas;
ruta ƒ /api/inventario/variantes/[id]/baja y ƒ /inventario/variantes registradas)
build_output_hash: sha256:3f1be1f9e9036ecb12ee74c773440852d29280f94987665a0109fb19791a5678
```
(No re-ejecutado en esta re-verificación: sin cambios de código desde la corrida previa — `git log` HEAD `c14dc81`, diff `70792f2..HEAD` intacto, working tree solo con infra SDD sin commitear.)

**Tests**: ➖ No hay runner de tests en `package.json` (decisión D3 — archivo caliente, sin extensión; `npm test` NO se inventó ni se extendió). Comando de calidad del proyecto ejecutado:
```text
npm run lint → EXIT=0 (eslint sin errores)
test_output_hash: sha256:5d7be1e496079e9117f5281b95497a4d0a08c9363f16af8dcecf9f476ba5e63a
```
Evidencia runtime: apply-progress §5.2 (curl real contra Docker: 401/400/200/404/403 + fila audit_logs) + re-verificación BD directa + E2E navegador manual (usuario) + Prisma Studio (ver Runtime Evidence).

**Coverage**: ➖ Not available (no runner configurado)

### Runtime Evidence
- `docker ps`: `swat_erp_postgres Up 2 hours (healthy)`; `npx prisma migrate status` → `Database schema is up to date!` (re-verificación previa)
- `SELECT ... FROM audit_logs WHERE tabla_afectada = 'variantes_sku'` → 1 fila: `DELETE_LOGICO | variantes_sku | 407e729d-47c3-404d-a89a-0a9c1f85a3db | ::1 | stock_total=29 | 2026-08-23 22:05:56`
- **NUEVO — E2E navegador manual (confirmado por el usuario, 2026-08-23):** los 4 pasos del checklist (caso stock > 0, caso stock = 0, negativo UI `auditor.seed`) pasaron en el navegador.
- **NUEVO — Prisma Studio (confirmado por el usuario):** soft delete verificado en BD (`is_active: false`, `deleted_at`, `deletion_reason` persistidos) y fila `audit_logs` del evento registrada correctamente.

### Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| REQ-01 Stock-Aware Soft Delete Service | Silent delete on zero stock | Manual Docker 200 silenciosa + código (`deletion_reason: motivo?.trim() \|\| null`) + E2E stock=0 (modal sin textarea, baja directa) | ✅ COMPLIANT |
| REQ-01 | Justified delete on positive stock | Manual Docker 200 con motivo + re-verificación BD (fila audit con stock_total 29) | ✅ COMPLIANT |
| REQ-01 | No motivo rejects without DB write | Manual Docker 400 `MOTIVO_REQUERIDO` + código: throw antes del `update` | ✅ COMPLIANT |
| REQ-01 | Missing or already-deleted variant | Manual Docker re-baja 404 + código: `findFirst { id, is_active: true }` | ✅ COMPLIANT |
| REQ-02 PATCH Baja Route | Authorized operator baja | Manual Docker encargado → 200 `{ data, error: null }` | ✅ COMPLIANT |
| REQ-02 | No session | Manual Docker sin cookie → 401 (withAuth) | ✅ COMPLIANT |
| REQ-02 | Role not authorized | Manual Docker auditor.seed → 403 `FORBIDDEN` | ✅ COMPLIANT |
| REQ-02 | Re-baja | Manual Docker → 404 `VARIANTE_NO_ENCONTRADA` | ✅ COMPLIANT |
| REQ-03 Post-Operation Event | Event after successful baja | Re-verificación BD: fila `audit_logs` con payload (`ip`, `stock_total_al_momento`) + código: emit tras `update`, sin `$transaction` en el archivo | ✅ COMPLIANT |
| REQ-04 Audit Listener | Audit record appended | Re-verificación BD: 1 fila `DELETE_LOGICO`/`variantes_sku` + Prisma Studio | ✅ COMPLIANT |
| REQ-05 Modal UI | Modal opens on stocked variant | E2E navegador manual (usuario): modal abre con textarea vacío y "Confirmar baja" deshabilitado; confirmar → fila desaparece del listado y aparece en Auditoría | ✅ COMPLIANT |
| REQ-05 | Empty motivo blocks confirm | E2E navegador manual (usuario): espacios → sigue deshabilitado; motivo → se habilita; confirmar → baja ejecutada | ✅ COMPLIANT |

**Compliance summary**: 12/12 escenarios COMPLIANT (evidencia runtime/integración + E2E navegador manual confirmado por el usuario + Prisma Studio). La configuración del proyecto permite explícitamente verificación manual (PROMPT-HU-A6.md R1/R3; design Testing Strategy: "Manual browser").

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| C1 stockTotal aggregate | ✅ Implemented | `stockDeposito.aggregate(_sum.cantidad, is_active: true)` con `?? 0` (D10) |
| C2 baja silenciosa stock=0 | ✅ Implemented | update solo 4 campos (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason=null`); sin `DELETE`; no toca `StockDeposito`/`MovimientoStock` |
| C3 MOTIVO_REQUERIDO sin write | ✅ Implemented | `stockTotal > 0 && !motivo?.trim()` → throw antes del update (ruta mapea 400) |
| C4 baja con motivo persiste | ✅ Implemented | `deletion_reason: motivo?.trim() \|\| null` |
| C5 PATCH reemplaza stub 501 | ✅ Implemented | `export const PATCH = withAuth(...)`; sin handler GET; id segmento `len-2` (D7); ip `x-forwarded-for→x-real-ip→unknown` (D1) |
| C6 BajaLogicaVarianteSchema | ✅ Implemented | shape-only `z.string().trim().min(1).optional()` (D4); sin superRefine (validación cruzada en service) |
| C7 listado + botón condicional | ✅ Implemented | Server Component (`page.tsx` sin "use client"); `usuarioPuedeBajarVariante()` gate; stockTotal por fila |
| C8 evento post-operación | ✅ Implemented | emit tras update; cero `prisma.$transaction` en el archivo; payload `{variante_sku_id, usuario_id, deletion_reason, stock_total_al_momento, ip}` (16° entrada del DomainEventMap) |
| C9 service no escribe AuditLog | ✅ Implemented | grep `registrarAuditLog` en `src/lib/services/inventario` → 0 hits; listener 10° (`DELETE_LOGICO`, `variantes_sku`, registro_id, ip, valor_anterior/nuevo); 9 listeners previos intactos |
| C10 lint + build | ✅ Implemented | EXIT=0 ambos (corrida previa, hashes arriba; sin cambios de código desde entonces) |
| C11/C13 no regresiones | ✅ Implemented | `git diff 70792f2..HEAD --name-only` = exactamente los 8 archivos; zonas prohibidas intactas (crypto/, auditoria/, auth/, escaner/, movimiento.service.ts, package.json, prisma/ ausentes del diff); build completo OK |
| C12 paleta azul | ✅ Implemented | Dominante `blue-*` en los 3 archivos; `Alert variant="destructive"` mantenido por decisión del usuario (WARNING 1 resuelto — token semántico `text-destructive` de `ui/alert.tsx`, convención del repo) |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 `ip` en payload, default "unknown" | ✅ Yes | route `resolverIp()`, service 4° parámetro `ip = "unknown"` |
| D2 withAuth + `usuarioPuedeBajarVariante()` (no withPermission) | ✅ Yes | rol activo in ADMINISTRADOR/ENCARGADO_DEPOSITO vía `prisma.usuarioRol`; rationale seed lockout documentado |
| D3 lint + build + manual Docker, sin runner | ✅ Yes | `package.json` intacto; sin `npm test` |
| D4 Schema shape-only, sin superRefine | ✅ Yes | validación cruzada en service (defensa en profundidad) |
| D5 Evento `inventario:variante_baja_logica` | ✅ Yes | no prefijo `stock:*`; convención real del repo |
| D6 `tabla_afectada: "variantes_sku"` | ✅ Yes | convención `@@map` minúsculas del listener |
| D7 id segmento `len-2` del pathname | ✅ Yes | no `pop()` |
| D8 Rol helper exportado del service | ✅ Yes | compartido por route + action |
| D9 Modal condicional a stockTotal | ✅ Yes | textarea solo si `stockTotal > 0`; confirm directo con 0 |
| D10 `_sum ?? 0` | ✅ Yes | aggregate null → 0 |
| D11 Botón solo si `usuarioPuedeBajarVariante()` | ✅ Yes | lista read-only sin rol |

### Manual Browser E2E — EJECUTADO Y CONFIRMADO POR EL USUARIO (2026-08-23)
1. `npm run dev`; login como `encargado.seed` (rol ENCARGADO_DEPOSITO) → `/inventario/variantes`. ✅
2. **Caso stock > 0** (`VARIANTE_CAMISA_TACTICA_1_ID`, 29 u): click "Dar de baja" → modal abre con textarea vacío y "Confirmar baja" **deshabilitado**; escribir solo espacios → sigue deshabilitado; escribir motivo → se habilita; confirmar → fila desaparece del listado y aparece la baja en Auditoría (`DELETE_LOGICO`, `variantes_sku`). ✅
3. **Caso stock = 0**: variante sin `StockDeposito` activo → "Dar de baja" abre modal **sin textarea** y confirmación directa habilitada; confirmar → baja inmediata silenciosa. ✅
4. **Negativo UI**: como `auditor.seed` → el listado NO muestra botón "Dar de baja" (lista read-only); un PATCH manual a la API responde 403. ✅
5. **Prisma Studio**: soft delete verificado (`is_active: false`, `deleted_at`, `deletion_reason` persistidos) y `audit_logs` registró el evento (`DELETE_LOGICO`, `variantes_sku`). ✅

### Issues Found
**CRITICAL**: None — los 2 escenarios REQ-05 pasaron de PARTIAL a COMPLIANT con evidencia runtime E2E manual confirmada por el usuario + verificación Prisma Studio. Bloqueante previo resuelto; 0 blockers, 0 critical_findings.

**WARNING**: None — WARNING 1 (Alert `variant="destructive"` en `ModalJustificacionBaja.tsx` y `page.tsx`) **RESUELTO por decisión del usuario (2026-08-23): mantener `destructive`** (convención del repo). Es el token semántico `text-destructive` de `src/components/ui/alert.tsx` (variante estándar shadcn usada en todo el repo: FormularioProductoMaestro, MatrizVariantes, escaner), sin clases literales `red-*`; la paleta dominante es `blue-*` y el error en rojo es convención/UX estándar. No rompe ningún escenario de spec ni el espíritu del criterio 12. Documentado y cerrado, no bloquea.

**SUGGESTION**:
1. Criterio 6 del PROMPT original mencionaba `superRefine` hacia servicios; se implementó shape-only (D4, alineado a spec REQ-02 y a la instrucción de verify). Dejar constancia en archive de que el contrato original se interpretó según D4.
2. `VarianteDadaDeBaja.deleted_at: Date | null` difiere del tipo `Date` del design (deviation 1 del apply): ajuste de tipo por el schema Prisma real (`DateTime?`), sin cambio de comportamiento.
3. Fila `audit_logs` del smoke test permanece en BD (ledger append-only — no borrar; es evidencia esperada).
4. Working tree tiene cambios sin commitear de infra SDD (`.atl/skill-registry.md`, `AGENTS.md`, `.gitignore`, borrado `prompts/`, untracked `openspec/` `.agents/`, `skills-lock.json`): mantenerlos fuera de los commits del PR HU-A6.

### Verdict
**PASS** — Implementación completa (13/13 tareas), `npm run lint` y `npm run build` EXIT=0 (sin re-ejecución: sin cambios de código desde la corrida previa, HEAD `c14dc81`), 12/12 escenarios COMPLIANT con evidencia runtime: integración Docker (apply §5.2 + re-verificación BD), E2E navegador manual confirmado por el usuario (REQ-05) y Prisma Studio (soft delete + `audit_logs`). Zonas ajenas intactas, 0 blockers, 0 critical_findings. Archive-ready.