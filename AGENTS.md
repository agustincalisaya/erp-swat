<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — SWAT Indumentarias ERP (Sprint 1 · Módulo A)

Configuración central que el agente debe consultar antes de ejecutar cualquier tarea en este repositorio: contexto del proyecto, reglas de negocio obligatorias, alcance protegido (HU-A6), stack, convenciones de código y metodología de trabajo (SDD).

> **Autoridad superior:** `RULES.md` (Constitución del Proyecto) define las reglas transversales de cumplimiento obligatorio para los 6 desarrolladores y sus agentes. Este archivo la resume y la aterriza al código real. Ante cualquier conflicto, manda `RULES.md`.

---

## 1. Contexto del proyecto

- **Sistema:** SWAT Indumentarias ERP — proyecto académico/profesional bajo metodología **Scrum**, Sprint 1.
- **Módulos en este repo:** Módulo A (Inventario, SKUs, Depósitos, Movimientos) y Módulo D (Seguridad, RBAC, Auditoría Forense).
- **Responsable actual:** Ramiro V. Castagnaro — **HU-A6: Baja lógica (Soft Delete) de variantes de producto con modal de justificación.**
- **Regla de equipo (estado tras el pull de PRs #18–#22):** la HU-A3 (legajos + AES-256) fue completada por Tomás y **mergeada**; la HU-A7 (motor criptográfico) pertenece a otro miembro; el **Módulo D está terminado y mergeado** (PR #19) y la **HU-MA2 (ingreso de mercadería por escáner/QR, Agustín)** también (PR #22). **Todo ese código es ZONA AJENA: no se toca ni se modifica bajo ningún concepto.** HU-A6 sigue sin implementar (spec ya escrita, código vacío).

---

## 2. Skills disponibles (actualizados)

| Skill | Descripción breve | Trigger / Uso recomendado |
|-------|-------------------|---------------------------|
| **_shared** | Referencias compartidas para todos los skills SDD. | - |
| **sdd-init** | Inicializar contexto SDD, testing capabilities y registro. | Primer paso de cualquier cambio SDD. |
| **sdd-explore** | Explorar ideas antes de comprometerse. | Fase de exploración SDD. |
| **sdd-propose** | Crear propuesta SDD (intent, scope, approach). | Fase de propuesta SDD. |
| **sdd-spec** | Escribir especificaciones delta desde propuesta. | Fase de spec SDD. |
| **sdd-design** | Crear diseño técnico desde propuesta. | Fase de diseño SDD. |
| **sdd-tasks** | Desglosar spec y diseño en tareas implementables. | Fase de task-planning SDD. |
| **sdd-apply** | Implementar tareas desde specs y diseño. | Fase de aplicación SDD. |
| **sdd-verify** | Validar implementación contra spec, diseño y tareas. | Fase de verificación SDD. |
| **sdd-archive** | Archivar cambios SDD completados. | Después de verify. |
| **sdd-onboard** | Onboarding guiado del flujo SDD con el código real. | Cuando se quiere aprender el flujo. |
| **work-unit-commits** | Planificar commits como unidades de trabajo revisables. | Antes de aplicar cambios en SDD. |
| **branch-pr** | Crear PRs con checks de issue-first. | Al abrir o preparar PRs. |
| **chained-pr** | Dividir cambios grandes en PRs encadenados. | Cuando el forecast supere 400 líneas o se solicite. |
| **cognitive-doc-design** | Diseñar docs que reduzcan la carga cognitiva. | Al escribir guías, READMEs, RFCs, etc. |
| **comment-writer** | Escribir comentarios cálidos y directos. | Feedback de PR, issues, Slack, etc. |
| **issue-creation** | Crear issues con checks de issue-first. | Al reportar bugs o nuevas funcionalidades. |
| **judgment-day** | Revisión adversarial doble (blind). | Cuando se requiere validación extrema. |
| **rdd-defect-workflow** | Defectos del flujo de revisión (receipts, corrección). | Cuando la review authority falla o bloquea. |
| **systemic-issue-triage** | Atacar issues por causa raíz, no uno por uno. | Triage de bugs, backlog, issues comunitarios. |
| **skill-registry** | Mantener actualizado el registro de skills. | Cuando se añaden/eliminan skills. |
| **skill-creator / skill-improver** | Crear y auditar skills LLM-first. | Skills a medida o mantenimiento. |
| **customize-opencode** | Modificar únicamente la configuración de OpenCode. | Nunca para código de aplicación. |
| **go-testing / gentle-ai-bench** | Testing Go / bench journeys. | No aplicables a este proyecto. |

> **MCP disponibles:** **Context7** para documentación actualizada de librerías (Next.js, Prisma, Zod, Tailwind, Base UI, React), **CodeGraph** para consultas estructurales del codebase y **Engram** para memoria persistente entre sesiones.

---

## 3. Stack tecnológico y arquitectura

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js **16.3.0** (App Router, SSR/ISR/CSR), React 19, TypeScript 5, PWA mobile-first |
| UI | Tailwind CSS v4, shadcn, Base UI (`@base-ui/react`), `lucide-react`, `class-variance-authority` |
| Formularios/validación | react-hook-form + Zod v3 (`zod@^3.25`) |
| Backend | Next.js Server Actions / route handlers, `server-only` para lógica de servidor |
| BD | PostgreSQL 16 (Docker) + Prisma ORM v6 |
| Auth | JWT (`jose`) en cookie httpOnly + `@node-rs/argon2` para hash de contraseñas; sesiones revocables (`Sesion`) |

### Mapa de código clave

| Ruta | Rol |
|------|-----|
| `prisma/schema.prisma` | Esquema autoritativo (Módulos A y D). Modelos PascalCase, campos `snake_case`, `@@map` plural minúsculas. |
| `RULES.md` | Constitución del proyecto (reglas transversales). **Leer antes de escribir cualquier código.** |
| `docs/specs/spec_modulo_A.md` | Spec de comportamiento del Módulo A. |
| `src/lib/services/inventario/` | Lógica de dominio del Módulo A (variante, producto, stock, deposito, movimiento, legajo-prueba). |
| `src/lib/events/` | Bus de eventos de dominio (`domain-event-bus.ts`), tipos (`event-types.ts` — **13 eventos hoy, ninguno de variantes**) y listeners (`listeners/audit-log.listener.ts` — **9 listeners**, única vía de escritura a `AuditLog`). |
| `src/lib/crypto/` | `aes.ts` (HU-A3) y `hash-chain.ts` (HU-A7, evolucionó en el pull). **ZONA PROHIBIDA.** |
| `src/lib/auth/` | Sesión, JWT, RBAC (`with-permission.ts`: `withAuth` / `withPermission("inventario:operar", handler)`). |
| `src/lib/schemas/` | Esquemas Zod por módulo (`inventario.schema.ts`, `auth.schema.ts`, `auditoria.schema.ts`). |
| `src/app/(auth)/` / `src/app/(dashboard)/` | Route groups: login y dashboard (`inventario/*`, `auditoria/*`). |
| `src/app/api/` | Route handlers REST (19): `auth/*`, `auditoria/*`, `inventario/*`. `inventario/variantes/[id]/baja` es **stub 501** — la spec pide `PATCH` (HU-A6). |
| `src/components/auditoria/` | UI del Módulo D (listados, dialogs, editores RBAC). **Zona ajena (Agustín).** |
| `src/components/inventario/escaner/` + `src/hooks/useBarcodeScanner.ts` | Flujo HU-MA2 (escáner/QR, `@zxing/browser`). **Zona ajena.** |
| `src/proxy.ts` | Middleware Next 16 (antes `middleware.ts`): valida JWT y redirige a `/login` en `/inventario/*` y `/auditoria/*`. |
| `src/lib/services/auditoria/` | Módulo D terminado: `usuario`, `rol`, `sesion`, `permiso`, `audit-log` (`registrarAuditLog()` con cadena SHA-256). **Zona ajena.** |

---

## 4. Entorno local (ASUMIDO LISTO Y FUNCIONAL)

El entorno ya está levantado: PostgreSQL 16 corre en Docker, dependencias instaladas y migraciones Prisma sincronizadas. **No reintentar setup ni migraciones destructivas.**

- **Docker:** `docker-compose.yml` → `postgres:16`, contenedor `swat_erp_postgres`, puerto `5432`, usuario/clave `erpswat/erpswat`, BD `swat_erp_db`.
- **DATABASE_URL local esperada:** `postgresql://erpswat:erpswat@localhost:5432/swat_erp_db` (usar la real de `.env`).

| Variable | Descripción | Estado |
|----------|-------------|--------|
| `DATABASE_URL` | Conexión a PostgreSQL 16 (Prisma). | Requerida |
| `JWT_SECRET` | Firma/verificación de JWT (HU-3, 64 hex = 32 bytes). | Requerida |
| `ENCRYPTION_KEY_LEGAJOS` | Clave AES-256 de la HU-A3. **NO modificar ni commitear.** | HU-A3 — no tocar |

*(El `.env.example` del repo ya documenta estas 3 variables; tras el pull no hay variables nuevas. La única dependencia nueva es `@zxing/browser` — escáner HU-MA2, zona ajena.)*

**Comandos útiles:**

```bash
npm run dev       # servidor de desarrollo
npm run lint      # eslint (validación disponible)
npm run build     # compilación de producción
npx prisma migrate status   # verificar sincronización (solo lectura)
npx prisma migrate dev      # solo si un cambio de esquema lo exige
npx prisma db seed          # seed: tsx prisma/seed.ts
```

> **Testing:** a la fecha no hay runner de tests configurado en `package.json`. **No inventar comandos de test** (p. ej. jest/playwright). Validar con `npm run lint` y `npm run build`. Si se incorpora un runner, ejecutarlo antes de `sdd-apply` y `sdd-verify`.

---

## 5. Reglas de negocio transversales CRÍTICAS

1. **Baja lógica (Soft Delete) ESTRICTA — prohibido `DELETE`.** Ningún registro se elimina físicamente. Toda desactivación es un `UPDATE` con `is_active = false`, `deleted_at = now()`, `deleted_by = <usuario>`, `deletion_reason = <justificación si aplica>`. Los `SELECT` filtran por defecto `WHERE is_active = true` (salvo el módulo de Auditoría que consulta histórico).
2. **Restricción referencial estricta:** `onDelete: Restrict` en todas las relaciones. **Prohibida la eliminación en cascada.**
3. **Auditoría forense criptográfica (Ley 25.326):** todo evento crítico genera un registro inmutable en `audit_logs` con cadena de hashes SHA-256 (`hash_anterior` + `hash_actual`). **Regla de oro: ningún service escribe `AuditLog` directamente** — emite un evento de dominio al bus y `audit-log.listener.ts` (única vía de escritura) lo registra. El ledger es append-only: jamás se actualiza ni borra un registro de auditoría.
4. **Inmutabilidad contable:** `MovimientoStock` es inmutable. Una corrección se modela como un nuevo movimiento compensatorio, nunca como UPDATE del original.
5. **Excepciones al soft delete (documentadas en el schema):** `Sesion` (estados propios de sesión) y `AuditLog` (ledger append-only) no llevan `is_active/deleted_at`.
6. **Credenciales:** prohibido hardcodear contraseñas, connection strings o claves. Todo via variables de entorno / secretos de contenedor.
7. **Aislamiento de dominio:** toda integración externa (AFIP, Mercado Pago, WhatsApp) detrás de patrones Adapter/Gateway. El dominio solo habla con interfaces propias.

---

## 6. HU-A6 — Foco exclusivo: Baja lógica de variantes

**Responsable:** Ramiro V. Castagnaro. Trabajar EXCLUSIVAMENTE en esta funcionalidad.

### 6.1 Mapeo terminológico (documento académico → esquema REAL)

| Documento de la HU-A6 | Schema real (Prisma) | Nota |
|----------------------|----------------------|------|
| `variante_producto` | `VarianteSKU` (`@@map "variantes_sku"`) | Tiene `talle`, `color`, `genero`, `modelo`, `sku`, `ean_qr` |
| `id_variante` | `id` (FK en otros modelos: `variante_sku_id`) | UUID |
| `activo` | `is_active` | Boolean default true |
| `fecha_baja` | `deleted_at` | DateTime? null |
| `motivo_baja` | `deletion_reason` | Text? null — **obligatorio si `is_active=false` y stock remanente > 0** |
| *(no estaba en el doc)* | `deleted_by` | **Obligatorio setear** con el `usuario_id` autenticado |
| `stock_variante_deposito.cantidad_disponible` | `StockDeposito.cantidad` (`@@map "stock_depositos"`) | Sumar `cantidad` por `variante_sku_id` |
| `log_auditoria` | `AuditLog` (`@@map "audit_logs"`) | Solo vía eventos, nunca escritura directa |

### 6.2 Estado actual (post-pull) — HU-A6 especificada pero NO implementada

El código de la HU-A6 sigue greenfield:
- `src/lib/services/inventario/variante.service.ts` → **vacío (0 líneas)** — implementar `darDeBajaVariante()`.
- `src/lib/schemas/inventario.schema.ts` → **no existe** `BajaLogicaVarianteSchema` (solo está en la spec).
- `src/app/api/inventario/variantes/[id]/baja/route.ts` → **stub** GET `501 "En construcción"`; la spec exige `PATCH`.
- `src/app/(dashboard)/inventario/variantes/` → `page.tsx` stub y `actions.ts` vacío.
- **No existe** el evento `stock:variante_baja_logica` en `event-types.ts` ni listener asociado.

> **Contrato de referencia (leer antes de implementar):** `docs/specs/spec_modulo_A.md` §2.5 (ruta + schema), §3.5 (`darDeBajaVariante`), §4 (evento) y `docs/specs/spec_modulo_D.md` §4 (consumo del evento por auditoría).

### 6.3 Flujo de criterios de aceptación (alineado a la spec)

1. **Validación de stock remanente:** `stockTotal = SUM(StockDeposito.cantidad WHERE variante_sku_id = <id> AND is_active = true)` (registros activos).
2. **Si stock total = 0:** baja lógica directa y silenciosa. `UPDATE` con `is_active = false`, `deleted_at = new Date()`, `deleted_by = <usuario de sesión>`, `deletion_reason = null`.
3. **Si stock total > 0:** el Frontend (`src/app/(dashboard)/inventario/variantes/`) lanza un **modal de justificación** con texto obligatorio (ej: "descontinuado con stock a liquidar"). El backend **rechaza la baja si el motivo viene vacío** → `ServiceError("MOTIVO_REQUERIDO")` (400) sin tocar la base. Validar con `BajaLogicaVarianteSchema` (Zod: `deletion_reason: z.string().min(1).optional()` + superRefine hacia la capa de servicios).
4. **La baja solo actualiza los 4 campos de soft delete** (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`) — **nunca** modificar `StockDeposito` ni `MovimientoStock` como efecto colateral (se preservan para trazabilidad).
5. **Propagación del evento:** emitir `stock:variante_baja_logica` **después** de que la transacción resuelva (nunca dentro de `$transaction` — regla de emisión de la spec §4).

### 6.4 Patrón de eventos de dominio (seguir la convención existente)

- Los eventos se tipan en `DomainEventMap` (`src/lib/events/event-types.ts`, hoy **13 eventos**) y se emiten vía el singleton `domain-event-bus.ts`.
- **Modelo a imitar:** `usuario:baja_logica` (payload `usuario_id`, `dado_de_baja_por`, `deletion_reason`, `ip`) → listener en `audit-log.listener.ts` con `accion: "DELETE_LOGICO"`, `tabla_afectada: "usuarios"`, `valor_anterior`/`valor_nuevo`.
- **HU-A6 debe:** agregar `stock:variante_baja_logica` al `DomainEventMap` con payload `variante_sku_id`, `usuario_id`, `deletion_reason`, `stock_total_al_momento` (spec A §4); registrar el listener en `audit-log.listener.ts` con `accion: "DELETE_LOGICO"` y `tabla_afectada: "variantes_sku"` (la spec D lo escribe "VarianteSKU", pero la convención real del listener usa el `@@map` en minúsculas) y NO llamar `registrarAuditLog()` desde el service.
- **Inconsistencia conocida de prefijos:** la spec A §4 nombra eventos `stock:*` (ej. `stock:legajo_prueba_iniciado`) pero el código real usa `inventario:*` para el Módulo A. Al implementar, alinear con la spec (contrato documentado) y dejar constancia de la decisión.
- El payload de eventos **nunca** incluye datos sensibles cifrados (regla fijada en `event-types.ts` y spec D §5.1).

### 6.5 Zona PROHIBIDA (no tocar, no modificar, no "mejorar")

- **HU-A3 (Tomás, ya mergeada):** `src/lib/crypto/aes.ts`, `ENCRYPTION_KEY_LEGAJOS`, modelo `LegajoPrueba` (`legajos_prueba`), `src/lib/services/inventario/legajo-prueba.service.ts`, `src/app/(dashboard)/inventario/legajos-prueba/`, evento `inventario:legajo_prueba_iniciado`.
- **HU-A7 (motor criptográfico):** `src/lib/crypto/hash-chain.ts` y toda la lógica de encadenamiento SHA-256 (evolucionó en el pull; sigue prohibido). HU-A6 solo emite eventos; la cadena la construye el listener de auditoría.
- **Módulo D (Agustín, terminado y mergeado):** `src/lib/services/auditoria/*`, `src/components/auditoria/*`, `src/app/api/auth/*`, `src/app/api/auditoria/*`, `docs/specs/spec_modulo_D.md`.
- **HU-MA2 (Agustín, ingreso por escáner/QR):** `src/hooks/useBarcodeScanner.ts`, `src/components/inventario/escaner/*`, `src/app/api/inventario/escaner/*`, la sección de ingreso en `movimientos/page.tsx`, `@zxing/browser`.
- **Transferencias de stock** de otros miembros: `movimiento.service.ts`, `TipoMovimiento.TRANSFERENCIA`, movimientos entre depósitos.

> **Datos para probar la HU-A6:** el `prisma/seed.ts` siembra variantes con stock > 0 (`VARIANTE_CAMISA_TACTICA_1_ID` = 29 u., `VARIANTE_CAMISA_TACTICA_2_ID` = 24 u., `VARIANTE_BORCEGOS_1_ID` = 33 u., etc.) — ideales para validar el caso con modal de justificación.

---

## 7. Metodología SDD (obligatoria)

1. **Usar SDD** para cualquier cambio que implique más de un archivo o afecte la lógica de negocio. Flujo: `explore → propose → spec → design → tasks → apply → verify → archive`.
2. **Delegar el trabajo pesado** a los sub-agentes `sdd-*` vía la herramienta `task` (el orchestrator coordina; los ejecutores no orquestan). No editar archivos directamente salvo lecturas de 1–3 archivos o comandos de estado.
3. **Pre-flight obligatorio** al inicio de cada sesión SDD: modo (`interactive`/`auto`), artifact store (`openspec`/`engram`/`both`), delivery strategy (`ask-on-risk`/`auto-chain`/`single-pr`/`exception-ok`) y review budget de líneas.
4. **Review Workload Guard:** tras `sdd-tasks`, revisar el forecast. Si supera 400 líneas o marca riesgo, aplicar la delivery strategy (posible split en PRs encadenados vía skill `chained-pr` o `size:exception`).
5. **Registro de skills:** refrescar el registro (skill `skill-registry`) antes de delegar, y pasar las rutas resueltas de `SKILL.md` en cada prompt de sub-agente.
6. **Consultar Context7** antes de escribir código que involucre Next.js 16, Prisma 6, Zod, Tailwind v4, Base UI o React 19 (documentación vigente y ejemplos).
7. **Next.js 16:** este proyecto tiene una versión con breaking changes — leer las guías en `node_modules/next/dist/docs/` antes de escribir código. Priorizar Server Actions para mutaciones y React Server Components para UI estática.
8. **Auth/RBAC:** las mutaciones de la HU-A6 deben ejecutarse con sesión autenticada (`src/lib/auth/session.ts`) y verificación de permiso (`src/lib/auth/with-permission.ts`). Tomar `usuario_id` de la sesión para `deleted_by`.
9. **Commits:** Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`), sin atribución "Co-Authored-By" de IA. No commitear secretos ni `.env`.
10. **Documentación:** los cambios que afecten comportamiento deben reflejarse en `docs/specs/` siguiendo `cognitive-doc-design`.
11. **HU-A6 ya tiene especificación técnica** en `docs/specs/spec_modulo_A.md` (§2.5, §3.5, §4) — la fase de diseño SDD debe tomarla como contrato de entrada, no re-escribirla desde cero.

---

## 8. Enlaces a documentación crítica

- **Next.js 16 (App Router)** — `node_modules/next/dist/docs/` (autoritativo en-repo) · <https://nextjs.org/docs>
- **Prisma ORM v6** — <https://www.prisma.io/docs>
- **PostgreSQL 16** — <https://www.postgresql.org/docs/16/>
- **Docker Compose** — <https://docs.docker.com/compose/>
- **Tailwind CSS v4** — <https://tailwindcss.com/docs>
- **Zod v3** — <https://zod.dev/>
- **React 19** — <https://react.dev/>
- **Base UI** — <https://base-ui.com/>
- **react-hook-form** — <https://react-hook-form.com/>

*(Usar la herramienta `context7` para obtener la versión exacta y ejemplos de uso antes de escribir código.)*

---

## 9. Checklist rápido antes de iniciar una tarea (HU-A6)

- [ ] Confirmar que `.env` tenga `DATABASE_URL` y `JWT_SECRET` (no tocar `ENCRYPTION_KEY_LEGAJOS`).
- [ ] Verificar que PostgreSQL siga arriba (`docker compose ps`) y `npx prisma migrate status` OK (solo lectura).
- [ ] Refrescar el registro de skills (`skill-registry`) y confirmar la pre-flight SDD.
- [ ] Releer `RULES.md` y confirmar el alcance: **solo HU-A6** — sin tocar HU-A3, HU-A7, Módulo D ni HU-MA2.
- [ ] Leer `docs/specs/spec_modulo_A.md` §2.5/§3.5/§4 y `docs/specs/spec_modulo_D.md` §4 como contrato HU-A6.
- [ ] Confirmar que el evento `stock:variante_baja_logica` **no exista** aún en `event-types.ts` y que la ruta de baja siga siendo stub 501.
- [ ] Consultar Context7 / docs en `node_modules/next/dist/docs/` para la librería involucrada.
- [ ] Seguir el patrón de eventos existente: tipar en `event-types.ts`, emitir al bus, registrar listener de auditoría — nunca escritura directa a `audit_logs`.
- [ ] Validar con `npm run lint` y `npm run build` antes de `sdd-verify`.
- [ ] Commit con Conventional Commits y, al finalizar, archivar con `sdd-archive` si corresponde.
