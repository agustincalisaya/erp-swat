# SDD — HU-D8: Tasks de implementación

## Alcance y reglas

- **HU:** HU-D8 (backlog Sprint 5, fila 15) — Personal Operativo: "consultar mi propio historial de acciones registradas en el log de auditoría, para verificar mis propias operaciones sin requerir intervención de un Administrador o Auditor".
- **Contrato normativo:** `docs/specs/spec_modulo_D.md` §8.1 (filas D8-1 a D8-7 y párrafo final). Contexto vigente: §4.1 (append-only), §4.3 (Consola de Auditoría, segregación de funciones), §3.3 (permisos resueltos en cada request).
- **Reglas transversales (`RULES.md`):** solo lectura sobre `AuditLog` (ningún `create`/`update`/`delete` fuera de `registrarAuditLog`); la HU no modifica estado del sistema, por lo que no emite eventos ni escribe auditoría propia.
- No se crea tabla, vista materializada ni copia del log (D8-2).
- **Schema:** el contrato funciona sin cambios de `prisma/schema.prisma`. El índice `(usuario_id, created_at)` fue **aprobado** (C3): T00 deja de ser condicional; la migración la corre el equipo. Fuera de T00, si una task descubre que necesita tocar el schema, **frena y reporta**.
- Esta fase no implementa código ni ejecuta operaciones Git. Este archivo es el backlog técnico ejecutable de HU-D8.

### Relevamiento del estado actual (21/10/2026)

| Pieza | Estado | Brecha frente a §8.1 |
|---|---|---|
| `AuditLog` (`prisma/schema.prisma:208`) | `id`, `usuario_id?`, `accion`, `tabla_afectada`, `registro_id?`, `ip`, `valor_anterior?`, `valor_nuevo?`, `hash_anterior`, `hash_actual @unique`, `created_at`. **Sin `@@index`** y sin columna de módulo. | Sin índice por `(usuario_id, created_at)` (C3). Sin "módulo" (C4). |
| `listarAuditLog()` (`src/lib/services/auditoria/audit-log.service.ts:255`) | Sin `auditoria:leer_forense` fuerza `usuario_id = sesion.userId` y omite `valor_anterior`/`valor_nuevo`. | Rango: `fecha_hasta` con `lte` a medianoche **UTC** (excluye el día final casi completo y no usa hora ART): viola D8-3. Orden solo `created_at desc`, sin desempate `id desc`: viola D8-2. Lee todas las columnas (incluye hashes y payloads) y recién después proyecta; expone `ip`, `usuario_id` y `usuario_nombre` en modo propio. |
| `FiltrosAuditoriaSchema` (`src/lib/schemas/auditoria.schema.ts:794`) | `fecha_desde`/`fecha_hasta` con `z.coerce.date()`; `usuario_id` validado como UUID. | Un `usuario_id` malformado de un usuario sin permiso hoy devuelve 400, o sea que se usa para validar (contra el lineamiento "se ignora"). |
| `listarAccionesDistintas()` (`audit-log.service.ts:316`) | DISTINCT **global** de `accion`; `/auditoria/logs` lo usa también sin permiso forense. | Viola D8-4: un operativo ve tipos de acción de terceros. |
| `GET /api/auditoria/logs` (`src/app/api/auditoria/logs/route.ts`) | `withAuth`; respuesta `{ data, error }`; 400 `VALIDATION_ERROR` con `fieldErrors`; 500 `INTERNAL_ERROR`. | Hereda las brechas del servicio. |
| `/auditoria/logs` (`src/app/(dashboard)/auditoria/logs/page.tsx`) | Consola forense que "degrada" a historial propio sin permiso. Botón de verificación de cadena solo con `auditoria:verificar_cadena`. No hay exportación implementada. | Es la Consola (D.3/§4.3), no una vista propia distinta (D8-7). |
| Sesión | `getServerSession()` (`src/lib/auth/session.ts`) resuelve **solo** `Usuario` interno (cookie `swat_session`, JWT + `Sesion` no revocada + `estado = ACTIVO`). `withAuth` → 401 `UNAUTHORIZED`. | Los clientes web usan otra cookie y otro secreto (`swat_tienda_session`, `JWT_SECRET_CLIENTE_WEB`, `src/lib/auth/sesion-cliente-web.ts`); nunca obtienen sesión interna (ver C2). |
| RBAC | `usuarioTienePermiso()` / `withPermission()` (`src/lib/auth/with-permission.ts`). `auditoria:leer_forense` y `auditoria:verificar_cadena` sembrados (`prisma/seed.ts:815-860`) y asignados **solo al rol AUDITOR**. | — |
| Fechas | `rangoDiasNegocio(desde, hasta)` (`src/lib/utils/fecha-negocio.ts:328`): `[desde 00:00 ART, hasta+1 00:00 ART)`, valida `AAAA-MM-DD` y `desde <= hasta`; ya cubierto por `fecha-negocio.test.ts`. Patrón Zod `DiaSchema` en `comprobantes-repositorio.schema.ts`. | Reutilizable tal cual. |
| Navegación | `src/components/layout/Sidebar.tsx`, sección "Auditoría"; un ítem sin `permiso` es visible para toda sesión interna. `src/proxy.ts` ya protege `/auditoria/:path*`. | Falta ítem "Mi historial". |
| Datos de prueba | El seed no inserta `AuditLog` a mano (§4.1). Solo genera un asiento real para `comprador.seed` (versión crítica HU-H2). Todo login real escribe `LOGIN_EXITOSO` (`tabla_afectada = "sesiones"`) con el `usuario_id` del titular (`audit-log.listener.ts:263`). | Cualquier usuario operativo sembrado (`encargado.seed`, `cajero.seed`, `vendedor.seed`, `operador.pickpack.seed`…) tiene registros apenas inicia sesión. |

### Decisiones de diseño propuestas

| # | Decisión |
|---|---|
| D1 | **Identidad siempre desde la sesión.** `listarHistorialPropio(filtros, usuarioId)` recibe el `usuarioId` de `getServerSession()`/`withAuth`. El schema de entrada **no declara** `usuario_id`/`userId`: Zod (`z.object`, modo strip) los descarta antes del servicio, así que nunca se leen, ni para validar (un `usuario_id=basura` no da 400). |
| D2 | **Proyección explícita con `select`** (constante `SELECT_HISTORIAL_PROPIO`): `id`, `created_at`, `accion`, `tabla_afectada`, `registro_id`. Fuera: `valor_anterior`, `valor_nuevo`, `hash_anterior`, `hash_actual`, `ip`, `usuario_id` y la relación `usuario`. Ninguna columna excluida sale de la base (no se filtra después del `findMany`). |
| D3 | **Filtros:** `fecha_desde`, `fecha_hasta` (`AAAA-MM-DD`, días ART), `accion` (texto exacto), `page` (≥1, default 1), `page_size` (1–100, default 25: misma convención que `FiltrosAuditoriaSchema`). No se aceptan `tabla_afectada`/`registro_id` en la vista propia (fuera de la HU). |
| D4 | **Rango ART semiabierto** con `rangoDiasNegocio`: `created_at: { gte: inicio(desde), lt: inicio(hasta + 1) }`. Con un solo extremo: solo `desde` → `gte`; solo `hasta` → `lt` (no se replica el `rangoDiasNegocio(desde ?? hasta, hasta ?? desde)` de G3, que convierte un extremo suelto en un único día). `desde > hasta` → 400 `VALIDATION_ERROR` (refine Zod; el servicio revalida con `RangeError`). Nunca `lte` a medianoche. |
| D5 | **Orden estable:** `orderBy: [{ created_at: "desc" }, { id: "desc" }]`; paginación `skip/take` en base; `findMany` + `count` con el mismo `where`. |
| D6 | **Acciones del filtro:** `listarAccionesPropias(usuarioId)` → DISTINCT `accion` con `usuario_id = usuarioId`, orden alfabético. La API las devuelve en el mismo payload (`acciones_disponibles`) y la página las obtiene por llamada directa al servicio (patrón del Server Component actual). Una `accion` que el usuario no tiene → 200 con lista vacía, nunca error. |
| D7 | **Endpoint dedicado:** `GET /api/auditoria/mi-historial` con `withAuth` (sin permiso adicional, D8-5). Respuesta `{ data: { registros, total, page, page_size, acciones_disponibles }, error: null }`; 400 `VALIDATION_ERROR` con `fieldErrors`; 401 `UNAUTHORIZED`; 500 `INTERNAL_ERROR`. Mismo envelope que `/api/auditoria/logs`. |
| D8 | **Vista dedicada** `/auditoria/mi-historial`: tabla (Fecha y hora ART con `formatearFechaHoraNegocio`, Acción, Entidad, ID de registro), filtros desde/hasta/acción, paginación por links. Sin columna de usuario, sin IP, sin detalle anterior/nuevo, sin "Verificar cadena", sin exportación, sin buscador de usuarios. Mobile-first. |
| D9 | **Una sola regla para los dos caminos (D8-1).** La rama sin `auditoria:leer_forense` de `listarAuditLog()` delega en `listarHistorialPropio()`, así `GET /api/auditoria/logs` sin permiso devuelve exactamente el mismo DTO reducido. `/auditoria/logs` en modo general sin permiso forense redirige a `/auditoria/mi-historial` (los modos `?modulo=clientes` / `?modulo=proveedores` no cambian). **Ver C1.** |
| D10 | ~~Corrección del modo forense~~ — **ANULADA por el PO (C7)**: el camino forense de `listarAuditLog()` queda exactamente igual; sus defectos se registran como DT-2 a DT-4 (HU-D5). |
| D11 | Sin cambios de seed: los asientos se generan por el flujo real (login → `LOGIN_EXITOSO`, operaciones del rol). Los tests crean registros con `registrarAuditLog()` (única vía de escritura) en base de test. |
| D12 | **`package.json` se edita una única vez, en T01**, con el unitario nuevo en `test` y los scripts `test:integration:d8` / `test:integration:d8-http` (molde de `test:integration:b6` / `b6-http`). |

---

## 1. Resumen ejecutivo

HU-D8 se divide en **5 tasks** (+ T00 condicional) con **2 puntos de parada**. La lógica existente ya fuerza el usuario de la sesión. El trabajo va a lo que falta del contrato: rango ART inclusivo, orden estable, proyección mínima desde la base, selector de acciones propio y una vista/endpoint propios que no se confundan con la Consola Forense. T01 deja las piezas puras (schema + constructor de `where` + `select`), T02 el servicio (**STOP**), T03 el endpoint, T04 la UI y la navegación (**STOP**) y T05 la verificación integral con la evidencia.

---

## 2. Tabla resumida

| ID | Título | Archivo(s) principal(es) | Dependencia | STOP | Riesgo merge |
|---|---|---|---|---|---|
| T00 | *(condicional, C3)* Índice `(usuario_id, created_at)` en `AuditLog` | `prisma/schema.prisma`, migración nueva | Aprobación de C3 | No | Alto (`schema.prisma`) |
| T01 | Schema de filtros + reglas puras del historial propio | `src/lib/schemas/auditoria.schema.ts`, `src/lib/services/auditoria/historial-propio.reglas.ts` (+ test), `package.json` | Aprobación de este TASKS | No | Medio (`package.json`) |
| T02 | Servicio: `listarHistorialPropio`, `listarAccionesPropias`, delegación y corrección forense | `src/lib/services/auditoria/audit-log.service.ts`, `hu-d8.integration.test.ts` | T01 | **Sí** | Medio |
| T03 | Endpoint `GET /api/auditoria/mi-historial` | `src/app/api/auditoria/mi-historial/route.ts`, `hu-d8.http.integration.test.ts` | T02 aprobado | No | Bajo |
| T04 | Vista `/auditoria/mi-historial`, navegación y redirección | `src/app/(dashboard)/auditoria/mi-historial/page.tsx`, `src/components/auditoria/FiltrosHistorialPropio.tsx`, `TablaHistorialPropio.tsx`, `Sidebar.tsx`, `auditoria/logs/page.tsx`, `FiltrosAuditoria.tsx` | T03 | **Sí** | Medio (`Sidebar.tsx`) |
| T05 | Verificación integral, evidencia y nota de spec | `docs/modulos/modulo D/HU8_MODULO_D.md`, `docs/specs/spec_modulo_D.md` (nota aditiva) | T01–T04 | No | Bajo |

### Mapa CA → tasks

| CA | T01 | T02 | T03 | T04 | T05 |
|---|---|---|---|---|---|
| D8-1: usuario forzado; ID de tercero ignorado; mismo criterio en `/api/auditoria/logs` | schema sin `usuario_id` | ✔ | ✔ | ✔ (redirect) | ✔ |
| D8-2: mismo log, `created_at DESC, id DESC`, paginación en base, filtros fecha/acción | `where` + orden | ✔ | ✔ | ✔ | ✔ |
| D8-3: días ART, `[desde, hasta+1)`, 23:59:59.999 incluido, invertido = 400 | ✔ | ✔ | ✔ | ✔ | ✔ |
| D8-4: selector con DISTINCT propio; acción ajena → vacío; sin acciones → lista vacía | | ✔ | ✔ | ✔ | ✔ |
| D8-5: todo usuario interno autenticado, sin permiso extra; no otorga forense | | ✔ | ✔ | ✔ (sidebar) | ✔ |
| D8-6: sin anterior/nuevo/hash/export/verificación; eliminación antes de serializar | `select` | ✔ | ✔ | ✔ | ✔ |
| D8-7: sin búsqueda por otro usuario; no reemplaza la Consola | | | | ✔ | ✔ |

---

## 3. Detalle de tasks

### T00 — Índice de lectura por usuario (aprobado, C3)

- **Aprobado por el PO.** El agente edita el schema; la migración la corre el equipo: `npx prisma migrate dev --name hu_d8_indice_audit_log_usuario_fecha`.
- **Archivos autorizados:** `prisma/schema.prisma` (modelo `AuditLog`), `prisma/migrations/<timestamp>_hu_d8_indice_audit_log_usuario/migration.sql` (nuevo).
- **Cambio:** `@@index([usuario_id, created_at])` en `AuditLog`. Migración solo con `CREATE INDEX`; sin tocar datos ni columnas (append-only intacto).
- **Tests:** `npx prisma migrate dev` en base local; `EXPLAIN` de la consulta de T02 con el índice; regresión de la verificación de cadena (`POST /api/auditoria/verificar-cadena` → `integra: true`).
- **DoD:** migración aplicada en limpio y sobre una base con datos; ningún otro modelo tocado.

---

### T01 — Schema de filtros y reglas puras

- **Objetivo:** dejar sin dependencias de BD las piezas que fijan el contrato: el schema Zod de la vista propia, el constructor del `where` (usuario + rango ART + acción), el orden y la proyección.
- **Dependencia previa:** aprobación de este TASKS (y resolución de C1–C4).
- **Archivos autorizados:**
  - `src/lib/schemas/auditoria.schema.ts`: nuevo `HistorialPropioFiltrosSchema`; `FiltrosAuditoriaSchema` con fechas `AAAA-MM-DD` (D10).
  - `src/lib/services/auditoria/historial-propio.reglas.ts` (nuevo): módulo puro, sin `server-only`, sin alias `@/`; importa `../../utils/fecha-negocio.ts` con ruta relativa (patrón de `posicion-diaria.calculo.ts`).
  - `src/lib/services/auditoria/historial-propio.reglas.test.ts` (nuevo).
  - `package.json`: **única edición (D12).**
- **Archivos prohibidos:** `prisma/**`, `audit-log.service.ts`, `src/app/**`, `src/components/**`, `audit-log.listener.ts`.
- **Cambios previstos:**
  - `HistorialPropioFiltrosSchema = z.object({ fecha_desde: opcional(DiaSchema), fecha_hasta: opcional(DiaSchema), accion: opcional(z.string().trim().min(1).max(100)), page: z.coerce.number().int().min(1).default(1), page_size: z.coerce.number().int().min(1).max(100).default(25) }).refine(desde <= hasta, path ["fecha_hasta"])`. Los helpers `opcional` y `DiaSchema` siguen el molde de `comprobantes-repositorio.schema.ts` (un `?accion=` vacío equivale a no filtrar). **Sin** `usuario_id`, `userId`, `tabla_afectada`, `registro_id`.
  - `FiltrosAuditoriaSchema`: `fecha_desde`/`fecha_hasta` pasan de `z.coerce.date()` a `opcional(DiaSchema)`; resto igual.
  - `historial-propio.reglas.ts`:
    - `export const ORDEN_AUDIT_LOG = [{ created_at: "desc" }, { id: "desc" }] as const;`
    - `export const SELECT_HISTORIAL_PROPIO = { id: true, created_at: true, accion: true, tabla_afectada: true, registro_id: true } as const;`
    - `export function rangoCreatedAt(desde?: string, hasta?: string): { gte?: Date; lt?: Date } | undefined`, con los extremos sueltos de D4 y `RangeError` si `desde > hasta`.
    - `export function construirWhereHistorialPropio(usuarioId: string, f: { fecha_desde?: string; fecha_hasta?: string; accion?: string })`: devuelve `{ usuario_id: usuarioId, accion?, created_at? }`. `usuarioId` es el **único** origen del usuario.
    - `export interface RegistroHistorialPropio { id: string; created_at: Date; accion: string; tabla_afectada: string; registro_id: string | null }`.
- **Tests obligatorios (`historial-propio.reglas.test.ts`):**
  1. Un solo día `2026-10-20`: `gte = 2026-10-20T03:00:00.000Z`, `lt = 2026-10-21T03:00:00.000Z`.
  2. **Borde 23:59 ART:** el instante `2026-10-21T02:59:59.999Z` (20/10 23:59:59.999 ART) cumple `gte <= t < lt` para `hasta = 2026-10-20`; `2026-10-21T03:00:00.000Z` (21/10 00:00 ART) no; `2026-10-20T02:59:59.999Z` (19/10 23:59:59.999 ART) no.
  3. **Regresión del bug `lte` UTC:** un registro del 20/10 a las 15:00 ART (`2026-10-20T18:00:00Z`) queda incluido con `hasta = 2026-10-20`.
  4. Solo `desde` → solo `gte`; solo `hasta` → solo `lt`; ninguno → sin `created_at`.
  5. `desde > hasta` → `RangeError`; `2026-02-30` → `RangeError`.
  6. `construirWhereHistorialPropio("U1", { … })` siempre tiene `usuario_id: "U1"`, aunque el objeto de filtros traiga otra clave `usuario_id` (se fuerza con un cast en el test).
  7. `SELECT_HISTORIAL_PROPIO` no contiene `valor_anterior`, `valor_nuevo`, `hash_anterior`, `hash_actual`, `ip`, `usuario_id`, `usuario`.
  8. Schema: `?usuario_id=no-uuid&userId=x` → parse OK y la salida no tiene esas claves; `fecha_desde > fecha_hasta` → error en `fecha_hasta`; `page_size=101` → error; `accion=` → `undefined`; `fecha_desde=20/10/2026` → error.
- **DoD:** unitarios verdes por ruta directa (`node --experimental-strip-types --test …historial-propio.reglas.test.ts`) y `npx tsc --noEmit`. `tsc` puede fallar en `auditoria/logs/page.tsx` por el cambio de tipo de `FiltrosAuditoriaSchema` (usa `.toISOString()`): se acepta hasta T02/T04, igual que en E16 (C7), o se hace un ajuste mínimo de tipos de esa línea en T01 si el revisor lo prefiere.
- **CA que cubre:** base de D8-1, D8-2, D8-3 y D8-6.
- **Qué NO incluye:** consultas a BD, HTTP, UI.

---

### T02 — Servicio

- **Objetivo:** implementar la lectura propia sobre el ledger real y unificar la rama sin permiso de `listarAuditLog()`.
- **Dependencia previa:** T01.
- **Archivos autorizados:** `src/lib/services/auditoria/audit-log.service.ts`, `src/lib/services/auditoria/hu-d8.integration.test.ts` (nuevo), `src/lib/services/auditoria/audit-log.service.test.ts` (aserciones estructurales nuevas, sin tocar las existentes).
- **Archivos prohibidos:** las funciones de escritura `registrarAuditLog` / `registrarAuditLogIdempotente` / `anexarRegistroAuditLog` y `verificarCadenaIntegridad` (no se modifican), `prisma/**`, `src/app/**`, `src/components/**`.
- **Cambios previstos:**
  - `listarHistorialPropio(filtros: HistorialPropioFiltrosInput, usuarioId: string): Promise<ListadoHistorialPropio>` usa `construirWhereHistorialPropio`, `select: SELECT_HISTORIAL_PROPIO`, `orderBy: ORDEN_AUDIT_LOG`, `skip/take`, y `count` con el mismo `where`. Traduce `RangeError` a `ServiceError("VALIDATION_ERROR")` (defensa en profundidad: el schema ya lo filtra).
  - `listarAccionesPropias(usuarioId: string): Promise<string[]>`: `findMany({ where: { usuario_id }, distinct: ["accion"], select: { accion: true }, orderBy: { accion: "asc" } })`.
  - `listarAuditLog()`: sin `auditoria:leer_forense` → `return listarHistorialPropio({ fecha_desde, fecha_hasta, accion, page, page_size }, sesion.userId)` (descarta `usuario_id`, `tabla_afectada`, `registro_id`). Con permiso: `where.created_at = rangoCreatedAt(...)` y `orderBy: ORDEN_AUDIT_LOG`; el resto queda igual. El tipo de retorno pasa a unión `ListadoAuditLog | ListadoHistorialPropio` o se documenta el DTO reducido (decisión menor, registrar en §11).
  - Docstrings: actualizar el comentario de cabecera (§8.1 / D8) sin reescribir el histórico.
- **Tests obligatorios (`hu-d8.integration.test.ts`, base de test `HU_D8_INTEGRATION_DATABASE_URL`, molde de B6):** fixtures con dos usuarios de test (A operativo sin permiso forense, B tercero) y asientos creados con `registrarAuditLog()` (A: `accion` `HU_D8_PRUEBA_A1` ×3 y `HU_D8_PRUEBA_A2` ×1; B: `HU_D8_PRUEBA_B1` ×2).
  1. A solo ve sus filas; `listarAuditLog({ usuario_id: B.id, … }, sesionA)` devuelve exactamente lo mismo que sin `usuario_id` (ninguna fila de B).
  2. Orden `created_at DESC, id DESC`; páginas `page_size=2` sin solapamiento ni huecos; `total` correcto; página fuera de rango → `registros: []` con `total` intacto.
  3. `accion=HU_D8_PRUEBA_B1` (acción que A no tiene) → `registros: []`, `total: 0`, sin excepción.
  4. `listarAccionesPropias(A)` = `["HU_D8_PRUEBA_A1", "HU_D8_PRUEBA_A2", …acciones reales de A]` y nunca `HU_D8_PRUEBA_B1`.
  5. **Usuario sin registros:** usuario C recién creado por fixture, sin login → `registros: []`, `total: 0`, `listarAccionesPropias(C) = []`.
  6. **Frontera ART relativa:** para una fila real de A, `D = diaNegocioIso(created_at)`: `desde = hasta = D` la incluye; `hasta = D−1` la excluye; `desde = D+1` la excluye.
  7. Proyección: cada registro tiene exactamente las claves `id, created_at, accion, tabla_afectada, registro_id`.
  8. Forense (usuario con permiso de test): `usuario_id = B` devuelve filas de B con `valor_anterior/valor_nuevo`; `hasta = D` incluye filas del día D posteriores a las 00:00 UTC (regresión D10).
  9. Solo lectura: `count` de `audit_logs` y `verificarCadenaIntegridad()` iguales antes y después de las lecturas.
- **Regresión:** `audit-log.service.test.ts` y `audit-log.listener.test.ts`.
- **DoD:** suites verdes; ninguna función de escritura del ledger tocada.
- **CA que cubre:** D8-1, D8-2, D8-3, D8-4, D8-6 (servicio).
- **Qué NO incluye:** ruta HTTP nueva, UI.

---

### T03 — Endpoint `GET /api/auditoria/mi-historial`

- **Dependencia previa:** T02 aprobado (STOP).
- **Archivos autorizados:** `src/app/api/auditoria/mi-historial/route.ts` (nuevo), `src/lib/services/auditoria/hu-d8.http.integration.test.ts` (nuevo).
- **Archivos prohibidos:** servicios (salvo bug detectado → reportar), `src/app/api/auditoria/logs/route.ts` (no hace falta: hereda D9 por el servicio), UI.
- **Diseño:**
  ```ts
  export const GET = withAuth(async (req, session) => {
    const parsed = HistorialPropioFiltrosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    if (!parsed.success) return 400 VALIDATION_ERROR + fieldErrors;
    const [listado, acciones_disponibles] = await Promise.all([
      listarHistorialPropio(parsed.data, session.userId),
      listarAccionesPropias(session.userId),
    ]);
    return 200 { data: { ...listado, acciones_disponibles }, error: null };
  }); // catch → 500 INTERNAL_ERROR
  ```
  Solo `GET`: otros métodos → 405 por defecto de Next. `export const dynamic = "force-dynamic"` no aplica a Route Handlers con cookies; verificar contra `node_modules/next/dist/docs/` antes de agregar cabeceras de caché (sin `Cache-Control` público).
- **Tests obligatorios (`hu-d8.http.integration.test.ts`, servidor real + `HU_D8_INTEGRATION_DATABASE_URL`, molde de `auditoria-ventas.http.integration.test.ts`, login real con `cajero.seed` / `encargado.seed` / `auditor.seed`):**
  1. Sin cookie → 401 `UNAUTHORIZED`.
  2. Solo con cookie de cliente web (`swat_tienda_session` de una cuenta E8) → 401 (C2).
  3. `cajero.seed` → 200; todos los registros pertenecen a `cajero.seed` (oráculo: `prisma.auditLog` por `usuario_id`), incluido su `LOGIN_EXITOSO`.
  4. **ID de tercero:** `?usuario_id=<id de encargado.seed>`, `?userId=<…>` y `?usuario_id=no-es-uuid` → 200 con el mismo resultado que sin parámetro; ninguna fila de `encargado.seed`.
  5. **Borde de un solo día:** `?fecha_desde=D&fecha_hasta=D` con `D` = día ART del `LOGIN_EXITOSO` recién generado → lo incluye; `fecha_hasta=D−1` → lo excluye.
  6. `fecha_desde > fecha_hasta` → 400 `VALIDATION_ERROR` con `fieldErrors.fecha_hasta`; `fecha_desde=2026-02-30` → 400; `page_size=500` → 400.
  7. **Acción ajena:** `?accion=<acción que solo tiene otro usuario>` → 200, `registros: []`, `total: 0`.
  8. `acciones_disponibles` ⊆ DISTINCT de acciones del propio usuario (oráculo en BD).
  9. El JSON crudo no contiene `valor_anterior`, `valor_nuevo`, `hash_anterior`, `hash_actual`, `ip` ni `usuario_id` (búsqueda en el texto del body).
  10. `auditor.seed` en `/api/auditoria/mi-historial` → también solo sus filas (la vista propia no se amplía con permiso forense).
  11. Regresión D9: `cajero.seed` en `GET /api/auditoria/logs?usuario_id=<otro>` → mismo DTO reducido, solo filas propias.
- **DoD:** suite verde contra `next dev` apuntado a la base de test; envelope idéntico al de `/api/auditoria/logs`.
- **CA que cubre:** D8-1, D8-3, D8-4, D8-5, D8-6 (HTTP).

---

### T04 — Vista, navegación y redirección

- **Dependencia previa:** T03.
- **Archivos autorizados:**
  - `src/app/(dashboard)/auditoria/mi-historial/page.tsx` (nuevo)
  - `src/components/auditoria/FiltrosHistorialPropio.tsx` (nuevo, client component)
  - `src/components/auditoria/TablaHistorialPropio.tsx` (nuevo)
  - `src/components/auditoria/historial-propio.ui.test.ts` (nuevo, test de fuente: molde de `catalogo-web-admin.e16.test.ts`)
  - `src/components/layout/Sidebar.tsx` (solo agregar el ítem)
  - `src/app/(dashboard)/auditoria/logs/page.tsx` (redirect + `queryBase` con días string)
  - `src/components/auditoria/FiltrosAuditoria.tsx` (solo si hace falta por el cambio de fechas)
- **Archivos prohibidos:** servicios, rutas API, `TablaAuditLog.tsx` (no se reutiliza para no arrastrar columnas de usuario/IP/detalle), `BotonVerificarCadena.tsx`.
- **Diseño de la vista:**
  - Server Component, `dynamic = "force-dynamic"`, `getServerSession()` (sin sesión → mismo `Alert` que `/auditoria/logs`); parsea `searchParams` con `HistorialPropioFiltrosSchema`; si el parse falla muestra un `Alert` con el error (rango invertido) y lista con filtros por defecto; llama `listarHistorialPropio` + `listarAccionesPropias` con `session.userId`.
  - Encabezado "Mi historial de acciones" + texto "Acciones registradas con tu usuario. Horario de Argentina."
  - `FiltrosHistorialPropio`: `<input type="date">` desde/hasta, `<select>` de acción con `acciones` recibidas del servidor + "Todas", Aplicar/Limpiar → `router.push("/auditoria/mi-historial?…")`. **Sin** campo de usuario.
  - `TablaHistorialPropio`: columnas Fecha y hora (`formatearFechaHoraNegocio`), Acción, Entidad (`tabla_afectada`), ID (`registro_id` en mono, truncado, o "—"). Paginación por links preservando filtros (molde `PaginaLink`). Estado vacío: "No hay acciones registradas para los filtros elegidos." En móvil, lista en tarjetas o tabla con scroll horizontal interno (sin scroll de página).
  - Sin botones de exportación, de verificación de cadena ni de detalle.
- **Navegación:** en `Sidebar.tsx`, sección "Auditoría", ítem `{ label: "Mi historial", href: "/auditoria/mi-historial", icon: History }` **sin `permiso`** (visible para toda sesión interna). Comentario con la referencia a D8-5. No se cambia la visibilidad de "Auditoría Forense" (ver C5).
- **Redirección (D9):** en `/auditoria/logs`, modo general (sin `?modulo=`) y sin `auditoria:leer_forense` → `redirect("/auditoria/mi-historial")`, conservando `fecha_desde`, `fecha_hasta` y `accion`. Ajustar `queryBase` (hoy usa `toISOString().slice(0, 10)` sobre `Date`) a los strings de día.
- **Tests obligatorios:**
  - `historial-propio.ui.test.ts`: la página no importa `BotonVerificarCadena`, `BuscadorUsuarios` ni `listarUsuariosParaFiltro`; `TablaHistorialPropio` no referencia `valor_anterior`, `valor_nuevo`, `ip`, `usuario_nombre`; el ítem del Sidebar no tiene `permiso`; `FiltrosHistorialPropio` no tiene un campo `usuario_id`.
  - Manual en `next dev` (capturas para T05): `cajero.seed` ve "Mi historial" en el menú, filtra por un día y por acción, pagina; entrar a `/auditoria/logs` redirige; `auditor.seed` sigue viendo la Consola completa con su botón de verificación; ancho 375 px sin scroll horizontal de página.
  - `npx tsc --noEmit`, `npm run lint`.
- **DoD:** UI conforme a D8; Consola forense sin regresiones visuales para Auditor.
- **CA que cubre:** D8-5, D8-6, D8-7 (UI) y presentación de D8-2/D8-3/D8-4.

---

### T05 — Verificación integral y evidencia

- **Archivos autorizados:** `docs/modulos/modulo D/HU8_MODULO_D.md` (nuevo, molde `HU16_MODULO_E.md`), `docs/specs/spec_modulo_D.md` (**solo nota aditiva** en §8.1: ruta `GET /api/auditoria/mi-historial`, vista `/auditoria/mi-historial`, DTO reducido y redirección D9).
- **Corridas:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:integration:d8`, `npm run test:integration:d8-http`, regresión `test:integration:b6` / `b6-http` (también leen `audit_logs`), `npm run build`. Verificación de cadena (`integra: true`) antes y después.
- **DoD:** tabla CA → prueba completa; resultados registrados con fecha; decisiones menores en §11.

---

## 4. Dependencias entre tasks

```
(T00 condicional, C3) ─┐
T01 (schema + reglas puras)
  ↓
T02 (servicio + delegación + corrección forense)  ── ⛔ STOP
  ↓
T03 (GET /api/auditoria/mi-historial)
  ↓
T04 (vista + sidebar + redirect)  ── ⛔ STOP
  ↓
T05 (verificación integral + evidencia)
```

- T00 es independiente del resto: puede fusionarse antes o después de T02 sin cambiar código.

---

## 5. Archivos permitidos por tarea

| Tarea | Archivos permitidos |
|---|---|
| T00 | `prisma/schema.prisma` (solo `@@index` en `AuditLog`), migración nueva |
| T01 | `src/lib/schemas/auditoria.schema.ts`, `src/lib/services/auditoria/historial-propio.reglas.ts` (+ test), `package.json` (**única edición**) |
| T02 | `src/lib/services/auditoria/audit-log.service.ts` (solo lectura), `hu-d8.integration.test.ts`, `audit-log.service.test.ts` (aserciones nuevas) |
| T03 | `src/app/api/auditoria/mi-historial/route.ts`, `hu-d8.http.integration.test.ts` |
| T04 | `src/app/(dashboard)/auditoria/mi-historial/page.tsx`, `FiltrosHistorialPropio.tsx`, `TablaHistorialPropio.tsx`, `historial-propio.ui.test.ts`, `Sidebar.tsx`, `auditoria/logs/page.tsx`, `FiltrosAuditoria.tsx` (si hace falta) |
| T05 | `docs/modulos/modulo D/HU8_MODULO_D.md`, `docs/specs/spec_modulo_D.md` (nota aditiva) |

---

## 6. Casos de prueba transversales

| Caso | Dónde |
|---|---|
| Se envía `usuario_id` / `userId` de otro usuario (válido o malformado) → se ignora, 200, solo filas propias | T01 #6/#8, T02 #1, T03 #4 y #11 |
| Rango de un solo día con registro a las 23:59:59.999 ART → incluido; 00:00 del día siguiente → excluido | T01 #1/#2 (instantes exactos), T02 #6 y T03 #5 (frontera con filas reales) |
| Regresión del `lte` a medianoche UTC | T01 #3, T02 #8 |
| Rango invertido / día inexistente / `page_size` > 100 → 400 | T01 #5/#8, T03 #6 |
| Filtro por acción que el usuario no tiene → vacío, 200 | T02 #3, T03 #7 |
| Selector de acciones solo con las propias | T02 #4, T03 #8, T04 manual |
| Usuario sin registros → lista vacía y selector vacío | T02 #5 (servicio; vía HTTP no es reproducible: el login ya escribe `LOGIN_EXITOSO`); en UI, un rango sin datos muestra el estado vacío |
| Sin sesión / sesión de cliente web → 401 | T03 #1/#2 |
| Sin campos forenses en el JSON | T01 #7, T02 #7, T03 #9 |
| Auditor en la vista propia → solo lo suyo | T03 #10 |
| Orden y paginación estables | T02 #2 |
| Ledger intacto (solo lectura) | T02 #9, T05 |

> Nota sobre el borde 23:59: `created_at` lo fija PostgreSQL bajo el lock del ledger (`clock_timestamp()`), y `audit_logs` es append-only. Por eso **no se puede** crear ni reescribir una fila a las 23:59:59.999 ART sin violar §4.1. El borde exacto se prueba sobre el `where` puro (T01). Con filas reales se prueba la frontera relativa al día de un registro existente (T02/T03).

---

## 7. Definition of Done por tarea

1. Cambios implementados solo en los archivos autorizados.
2. Tests obligatorios verdes (si alguno se omite por falta de base de test, se registra la salida).
3. Ninguna escritura sobre `audit_logs` fuera de `registrarAuditLog` (fixtures de test incluidos).
4. Sin cambios de `schema.prisma` / migraciones salvo T00 aprobada.
5. No se amplía el alcance de §8.1.
6. STOP cumplido si corresponde.

---

## 8. Puntos de parada obligatorios

- **STOP después de T02:** revisar `select` mínimo, rango ART semiabierto, orden con desempate, DISTINCT propio, delegación de `listarAuditLog()` y que la corrección forense no cambió nada más.
- **STOP después de T04:** revisar la UI: sin campos ni controles forenses, ítem de menú visible para operativos, redirect de `/auditoria/logs`, Consola intacta para el Auditor.
- **STOP implícito ante schema:** fuera de T00, cualquier necesidad de schema se frena y se reporta.

---

## 9. Conflictos y decisiones — **RESUELTOS por el PO (21/10/2026)**

1. **C1 — Vista y endpoint dedicados. — RESUELTA.** Se crean `GET /api/auditoria/mi-historial` y `/auditoria/mi-historial`. La rama sin `auditoria:leer_forense` de `listarAuditLog()` delega en `listarHistorialPropio()` (la regla vive en un solo lugar). `/auditoria/logs` en modo general sin permiso forense redirige a `/auditoria/mi-historial`. Se actualiza D8-1 en `spec_modulo_D.md` §8.1 (T05 adelantado al inicio de la implementación).
2. **C2 — Cuentas no internas. — RESUELTA.** Se documenta y testea **401** (la cookie `swat_tienda_session` nunca resuelve sesión interna). Sin manejo especial de 403.
3. **C3 — Índice. — RESUELTA (SÍ).** `@@index([usuario_id, created_at])` en `AuditLog`. La migración la corre el equipo (no el agente): `npx prisma migrate dev --name hu_d8_indice_audit_log_usuario_fecha`. Agregar `@@index` no cambia los tipos del cliente Prisma, así que T01–T04 no dependen de que esté aplicada.
4. **C4 — Sin "módulo". — RESUELTA.** Se muestran fecha/hora (ART), acción, entidad (`tabla_afectada`) e ID de registro (`registro_id`).
5. **C5 — Sidebar. — RESUELTA.** Se agrega "Mi historial" sin `permiso` (visible a todo usuario interno). El ítem "Auditoría Forense" **no se toca** → deuda DT-1.
6. **C6 — IP. — RESUELTA.** Excluida de la vista propia. Queda anotada como **posible pedido del PO** (si la quiere ver, se agrega `ip` a `SELECT_HISTORIAL_PROPIO` y a la tabla; no expone datos de terceros).
7. **C7 — Camino forense intacto. — RESUELTA (decisión del PO).** **Se anula D10**: el camino con `auditoria:leer_forense` de `listarAuditLog()` queda **exactamente igual** en comportamiento (mismo schema `FiltrosAuditoriaSchema`, mismo rango `gte`/`lte`, mismo orden, misma proyección, mismo selector global de acciones en la Consola). Sus defectos se registran como deuda de HU-D5 (DT-2 a DT-4), fuera de alcance. Consecuencias para esta HU:
   - `FiltrosAuditoriaSchema` no se modifica. La delegación convierte sus `Date` (medianoche UTC del día pedido por `z.coerce.date()`) al día `AAAA-MM-DD` con `toISOString().slice(0, 10)` antes de aplicar `rangoDiasNegocio`.
   - Por lo mismo, en `GET /api/auditoria/logs` un usuario sin permiso que manda un `usuario_id` **malformado** sigue recibiendo 400 (la validación de forma es compartida con el modo forense y no se cambia). Un `usuario_id` válido de un tercero sí se ignora. La vista y el endpoint propios (`/mi-historial`) no declaran `usuario_id` y nunca dan 400 por él.
   - Los ítems de T01/T02/T04 que mencionaban D10 (cambio de `FiltrosAuditoriaSchema`, test forense #8, ajuste de `queryBase` y de `FiltrosAuditoria.tsx`) **quedan sin efecto**; el test forense pasa a ser de **no-regresión** (mismas filas y misma forma que antes).

---

## 10. Deuda técnica registrada

| ID | Descripción | Origen | Acción sugerida |
|---|---|---|---|
| DT-1 | El ítem "Auditoría Forense" del Sidebar sigue visible para usuarios sin permiso forense (que son redirigidos a "Mi historial"). No se lo puede gatear con `auditoria:leer_forense` porque `Sidebar.tsx` oculta los hijos cuando oculta al padre, y su sub-ítem "Auditoría de Proveedores" (`auditoria:leer_historico`) lo usa el Supervisor de Compras sin permiso forense. | C5 | Soporte de permiso múltiple (OR) en `ItemConfig` o reorganizar la navegación de auditoría en una tarea posterior. |
| DT-2 | **HU-D5 (fuera de alcance, NO arreglar en D8):** `listarAuditLog()` modo forense filtra `fecha_hasta` con `lte` a medianoche **UTC** del día elegido: excluye casi todo el día final y no interpreta hora argentina. | C7 | Migrar el modo forense a `rangoDiasNegocio` (días `AAAA-MM-DD`, `lt` del día siguiente ART), ajustando `FiltrosAuditoriaSchema` y el `queryBase` de `/auditoria/logs`. |
| DT-3 | **HU-D5:** orden forense solo `created_at desc`, sin desempate por `id` (paginación no estable ante empates). Hoy el append fuerza `created_at` estrictamente creciente, pero el orden de lectura no lo garantiza por sí mismo. | C7 | `orderBy: [{ created_at: "desc" }, { id: "desc" }]` (`ORDEN_AUDIT_LOG`). |
| DT-4 | **HU-D5:** la consulta forense usa `include` y trae todas las columnas (incluidos `hash_anterior`/`hash_actual`) para descartarlas después del `findMany`. | C7 | `select` explícito con las columnas del DTO forense. |

---

## 11. Decisiones menores tomadas durante la implementación

Ninguna contradice §8.1 ni las decisiones del PO; se registran para la revisión.

| # | Decisión |
|---|---|
| DM-1 | `listarAuditLog()` devuelve `ListadoAuditLog \| ListadoHistorialPropio`. `/auditoria/logs/page.tsx` castea a `ListadoAuditLog` después del redirect (solo llega con permiso forense). No se agregó un discriminante al JSON para no cambiar la respuesta forense. |
| DM-2 | El código de la rama forense de `listarAuditLog()` se dejó textualmente igual (incluido el ternario `tienePermisoAmpliado ? … : sesion.userId`, hoy siempre verdadero) para garantizar comportamiento idéntico. Limpiarlo queda para DT-2–DT-4. |
| DM-3 | `GET /api/auditoria/logs` mapea `ServiceError("VALIDATION_ERROR")` a 400. Solo lo lanza la rama delegada (p. ej. un año > 9999 que `z.coerce.date()` acepta pero `rangoDiasNegocio` rechaza); el modo forense no lo lanza. Sin esto sería un 500. |
| DM-4 | En `GET /api/auditoria/logs`, un usuario sin permiso que manda `usuario_id` **malformado** sigue recibiendo 400: `FiltrosAuditoriaSchema` es compartido con el modo forense y no se modificó (C7). En `/api/auditoria/mi-historial` nunca hay 400 por `usuario_id`. |
| DM-5 | La vista `/auditoria/mi-historial` ante filtros inválidos (p. ej. desde > hasta) muestra el mensaje de validación y lista sin filtros, en lugar de una página de error. La API sí responde 400. |
| DM-6 | El redirect de `/auditoria/logs` conserva solo `fecha_desde`, `fecha_hasta` y `accion` (lo que entiende la vista propia); descarta `usuario_id`, `tabla_afectada`, `registro_id` y `page`. |
| DM-7 | Los inputs de fecha de la vista propia usan `min`/`max` cruzados para evitar elegir un rango invertido en el navegador; el servidor valida igual. |
| DM-8 | Para las suites de integración se creó la base `swat_erp_test_d8` clonando `swat_erp_test_e16` (sin tocar la base de desarrollo ni la de E16, y sin aplicar migraciones). La suite de servicio deja 3 usuarios de test sin roles (`hu.d8.test.a/b/c`) y 6 asientos `HU_D8_PRUEBA_*` en esa base (append-only). |
| DM-9 | El borde exacto 23:59:59.999 ART se prueba sobre el `where` puro: `created_at` lo fija PostgreSQL y `audit_logs` es append-only, así que no se puede fabricar una fila con esa hora. Con filas reales se prueba la frontera relativa al día de un asiento existente. |
