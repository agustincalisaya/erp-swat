# HU-D8 — Historial propio del usuario interno: evidencia de cierre

- **HU:** HU-D8 (backlog Sprint 5, fila 15). Personal Operativo: consultar su propio historial de acciones registradas en el log de auditoría, sin intervención de un Administrador o Auditor.
- **Contrato:** `docs/specs/spec_modulo_D.md` §8.1 (D8-1 a D8-7; D8-1 actualizado por decisión del PO, 21/10/2026).
- **Tasks:** `docs/modulos/modulo D/HU8_TASKS.md` (T00–T05, decisiones D1–D12, conflictos C1–C7 resueltos, deuda DT-1 a DT-4, decisiones menores en §11).
- **Estado:** T00–T05 implementadas y verificadas el 21/10/2026. **Pendiente del equipo:** generar y aplicar la migración del índice (T00) con `npx prisma migrate dev --name hu_d8_indice_audit_log_usuario_fecha`.

---

## 1. Qué cambió

| Pieza | Archivo |
|---|---|
| Índice `@@index([usuario_id, created_at])` (migración pendiente) | `prisma/schema.prisma` |
| Schema de filtros sin `usuario_id` | `src/lib/schemas/auditoria.schema.ts` (`HistorialPropioFiltrosSchema`) |
| Reglas puras: `where`, rango ART, orden, `select` | `src/lib/services/auditoria/historial-propio.reglas.ts` |
| Servicio: `listarHistorialPropio`, `listarAccionesPropias`; delegación de la rama sin permiso de `listarAuditLog` | `src/lib/services/auditoria/audit-log.service.ts` |
| Endpoint `GET /api/auditoria/mi-historial` | `src/app/api/auditoria/mi-historial/route.ts` |
| 400 para `VALIDATION_ERROR` de la rama delegada | `src/app/api/auditoria/logs/route.ts` |
| Vista "Mi historial" | `src/app/(dashboard)/auditoria/mi-historial/page.tsx`, `src/components/auditoria/FiltrosHistorialPropio.tsx`, `src/components/auditoria/TablaHistorialPropio.tsx` |
| Redirect de `/auditoria/logs` sin permiso forense | `src/app/(dashboard)/auditoria/logs/page.tsx` |
| Ítem de menú sin permiso | `src/components/layout/Sidebar.tsx` |

El camino forense de `listarAuditLog()` no cambió (código idéntico; verificado por pruebas de no-regresión).

## 2. CA → prueba

| CA | Pruebas |
|---|---|
| D8-1 | `historial-propio.reglas.test.ts` (where forzado; schema descarta `usuario_id`/`userId` malformados); `hu-d8.integration.test.ts` (`listarAuditLog` con `usuario_id` de B = historial propio); `hu-d8.http.integration.test.ts` (ID de tercero válido/malformado ignorado, sin 400; `/api/auditoria/logs` delega; redirect 307 de `/auditoria/logs`) |
| D8-2 | reglas (orden); integración (paginación sin solapamiento ni huecos, página fuera de rango); HTTP (página 1 + 2 = listado completo) |
| D8-3 | reglas (un día, borde 23:59:59.999 ART, regresión `lte` UTC, extremos sueltos, invertido, día inexistente); integración (frontera relativa al día de un asiento real, `ServiceError`); HTTP (un solo día incluye el login de hoy, día anterior lo excluye, 400) |
| D8-4 | integración (acción ajena → vacío, DISTINCT propio, usuario sin registros → `[]`); HTTP (acción del encargado para el cajero → vacío, `acciones_disponibles` = oráculo) |
| D8-5 | HTTP (cajero, encargado y auditor acceden sin permiso extra); `historial-propio.ui.test.ts` (ítem sin `permiso`) |
| D8-6 | reglas (`select` de 5 claves); integración (claves exactas; sin payload, IP ni hash); HTTP (JSON crudo sin `valor_*`, `hash_*`, `ip`, `usuario_*`); UI (tabla y página sin detalle, exportación ni verificación) |
| D8-7 | UI (sin buscador ni campo de usuario); HTTP (auditor en `mi-historial` ve solo lo suyo; Consola forense intacta) |
| C2 (401 cuenta no interna) | HTTP (sin cookie → 401; `swat_tienda_session` real de `juan.perez@example.com` y una falsa → 401) |
| Solo lectura | integración (`count` de `audit_logs` y `verificarCadenaIntegridad()` iguales antes/después) |

## 3. Corridas de verificación (21/10/2026)

Base de test: `swat_erp_test_d8` (clon de `swat_erp_test_e16` con `CREATE DATABASE … TEMPLATE`; **sin** la migración del índice). Servidor HTTP: `next dev -p 3118` con `DATABASE_URL` apuntado a esa base.

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errores, 6 warnings preexistentes (ninguno en archivos de D8) |
| `npm test` | 1281 / 1281 |
| `node --experimental-strip-types --test src/lib/services/auditoria/audit-log.service.test.ts` | 3 / 3 (regresión estructural del ledger) |
| `npm run test:integration:d8` | 14 / 14 |
| `npm run test:integration:d8-http` | 16 / 16 (redirect observado: 307 a `/auditoria/mi-historial?accion=LOGIN_EXITOSO`) |

No se corrió `npm run build` ni las suites de integración de otras HU.
