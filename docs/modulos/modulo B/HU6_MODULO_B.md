# Especificación Técnica — HU-B6 (Log forense de anulaciones, descuentos, cambios de precio y excepciones de crédito)

## ERP SWAT Indumentarias — Módulo B

**Metodología:** SDD con Paso 0 de relevamiento previo (solo lecturas, sin código) y confirmación explícita de decisiones antes de implementar.
**Stack real:** Next.js (App Router, Route Handler) · Prisma ORM · Zod · PostgreSQL · consulta directa a `AuditLog` (Módulo D), sin bus de eventos propio (HU-B6 es de solo lectura).
**Fuente de este documento:** `docs/tasks/task_HU-B6.md` (con las 10 decisiones de la sección 0/0-bis confirmadas antes de implementar) y el reporte de cierre de la sesión de implementación (rama `feature/HU-B6`, commit `2433f81`, 2026-09-20). **Este documento no fue regenerado por lectura directa del código** — a diferencia de `HU4_MODULO_B.md`/`HU5_MODULO_B.md`, que sí relevaron el código fuente línea por línea, este se arma a partir del reporte de cierre de la propia sesión que implementó la HU. Cualquier detalle que ese reporte no haya mencionado explícitamente queda marcado como no verificado en este documento, y debería confirmarse contra el código antes de tomarlo como definitivo.
**Estado de integración:** pusheado a `origin/feature/HU-B6`. **PR aún no creado** (no está instalado `gh` en el entorno donde se implementó) — abrir desde `https://github.com/agustincalisaya/erp-swat/pull/new/feature/HU-B6`, base `develop`. No mergeado a `develop` al momento de este documento.

**Organización del documento:** Parte 1 (§1–§6) es la referencia técnica del contrato tal como se reportó implementado; Parte 2 (§7–§10) es el historial de desarrollo — Paso 0, decisiones confirmadas y resultado de testing.

---

# PARTE 1 — REFERENCIA TÉCNICA

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Auditor, **necesito** consultar el log forense de todos los eventos sensibles de Ventas (anulaciones, descuentos fuera de margen, cambios manuales de precio y excepciones de crédito) con verificación de integridad de la cadena SHA-256, y **como** Supervisor de Ventas **necesito** consultar los eventos que yo mismo autoricé o que se me escalaron, **para** que exista un canal de auditoría forense del módulo, segregado por rol, sin capacidad de escritura para ninguno de los dos.

Referencia funcional: Backlog HU-B6. Referencia técnica: `spec_modulo_B.md` Rev. 5, §2.6 (contrato corregido en esta misma revisión a partir de esta implementación) · `docs/tasks/task_HU-B6.md` (task confirmada con luz verde antes de implementar).

### 1.1. Notas de alcance (léanse antes que el resto)

- **Sin pantalla propia.** Esta iteración implementa solo el endpoint (`GET /api/ventas/auditoria`) — API primero, pantalla después, mismo criterio incremental que HU-B4/HU-B5. No se pudo confirmar contra el Backlog si se exige pantalla dedicada porque `Product Backlog - SWAT Indumentarias.xlsx` no está en el repositorio.
- **`venta:anulacion_pedido` no devuelve resultados reales.** La anulación de pedido (spec §2.8) no tiene código implementado; el filtro usa el placeholder `ANULACION_PEDIDO`, sin respaldo en ningún handler del listener.
- **El caso "escalado" del Supervisor (solicitante ≠ autorizante) se cubre con un fixture creado a propósito por el propio test**, no con datos preexistentes del seed — no había ninguno.
- **`AGENTS.md` no existe en el repo**, aunque `CLAUDE.md` lo referencia — hallazgo reportado, sin relación directa con esta HU, no resuelto acá.

### 1.2. Criterios de Aceptación

Derivados de `spec_modulo_B.md` §2.6 (Rev. 5) y `docs/tasks/task_HU-B6.md`, según lo reportado por la sesión de implementación:

- [x] **CA1** — `GET /api/ventas/auditoria` responde `200` para Auditor (`auditoria:leer_forense`) con eventos de todos los usuarios del dominio ventas.
- [x] **CA2** — Responde `200` para Supervisor de Ventas (`ventas:leer_log_operativo`) restringido a eventos que autorizó o que se le escalaron (solicitante).
- [x] **CA3** — Responde `403` para un usuario sin ninguno de los dos permisos (`cajero.seed`).
- [x] **CA4** — `verificar_integridad: true` de un Supervisor de Ventas responde `403 VERIFICACION_INTEGRIDAD_NO_DISPONIBLE`, sin ejecutar la verificación.
- [x] **CA5** — `verificar_integridad: true` de un Auditor responde `200` con `verificacion_integridad.integra` calculado sobre la cadena completa de `AuditLog`, contando solo eventos de Módulo B.
- [x] **CA6** — El alcance del Supervisor cubre tanto el caso "autorizante" (columna `usuario_id`) como el caso "escalado" (JSON `valor_nuevo.usuario_solicitante_id`), con al menos un caso real de cada uno verificado en Nivel 3.
- [x] **CA7** — El filtro `pedido_venta_id` funciona tanto para descuento/precio (`registro_id` directo) como para excepción de crédito (`valor_nuevo.pedido_venta_id`, JSON).
- [x] **CA8** — `fecha_hasta` se trata como fin de día (23:59:59.999).
- [x] **CA9** — Sin lógica de negocio en el Route Handler; sin `DELETE` físico; sin ninguna función de Módulo D reutilizada tal cual para el listado o la verificación.

El detalle de qué se verificó y con qué nivel de testing está en §8.

---

## 2. Contrato de API

### 2.1. `GET /api/ventas/auditoria`

`src/app/api/ventas/auditoria/route.ts`. Gate: `withAuth` + resolución manual del nivel de acceso (no `withPermission()` de un solo string, porque el endpoint acepta cualquiera de dos permisos distintos) — `auditoria:leer_forense` tiene precedencia sobre `ventas:leer_log_operativo` cuando la sesión tiene ambos (caso MASTER).

**Query schema** (`ConsultarAuditoriaVentasQuerySchema`, `src/lib/schemas/ventas.schema.ts`):

```typescript
export const ConsultarAuditoriaVentasQuerySchema = z.object({
  pedido_venta_id: z.string().uuid().optional(),
  tipo_evento: z.enum([
    "venta:anulacion_pedido",
    "venta:descuento_fuera_margen",
    "venta:cambio_precio_manual",
    "venta:excepcion_credito_resuelta",
  ]).optional(),
  usuario_id: z.string().uuid().optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(), // fin de día, mismo criterio que HU-A6
  verificar_integridad: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(50).default(20),
});
```

| Status | Código | Cuándo |
|---|---|---|
| `200` | — | Auditor o Supervisor de Ventas con acceso al recurso |
| `400` | `VALIDATION_ERROR` | Query inválido |
| `401` | — | Sin sesión |
| `403` | `FORBIDDEN` | Sin `auditoria:leer_forense` ni `ventas:leer_log_operativo` |
| `403` | `VERIFICACION_INTEGRIDAD_NO_DISPONIBLE` | `verificar_integridad: true` con solo `ventas:leer_log_operativo` |

**Respuesta `200 OK`:**
```json
{
  "data": {
    "registros": ["...AuditLog[]..."],
    "total": 42,
    "page": 1,
    "page_size": 20,
    "verificacion_integridad": { "integra": true }
  },
  "error": null
}
```
`verificacion_integridad` solo presente con `verificar_integridad: true` y sesión Auditor. `valor_anterior`/`valor_nuevo` de cada registro se devuelven tanto para Auditor como para Supervisor.

**Respuesta `403` (verificación pedida por Supervisor):**
```json
{ "data": null, "error": { "code": "VERIFICACION_INTEGRIDAD_NO_DISPONIBLE", "message": "La verificación de integridad de la cadena SHA-256 está reservada al rol Auditor" } }
```

**Sin Server Action equivalente** — no reportada por la sesión de implementación; consistente con la nota de alcance 1.1 (sin pantalla propia todavía).

---

## 3. Capa de servicios — `lib/services/ventas/auditoria-ventas.service.ts`

Archivo nuevo, reportado por la sesión de implementación con dos funciones:

### 3.1. `obtenerLogsVentas(filtros, sesion)`

- Re-chequea el permiso dentro del servicio (defensa en profundidad), aunque el Route Handler ya lo haya validado.
- Filtro de dominio fijo por `accion IN` (mapeo `tipo_evento → AuditLog.accion`, con `ANULACION_PEDIDO` como placeholder sin respaldo real).
- Filtro `pedido_venta_id`: `OR` entre `registro_id = pedido_venta_id` (descuento, cambio de precio) y el path JSON `valor_nuevo.pedido_venta_id = pedido_venta_id` (excepción de crédito).
- **Auditor:** sin filtro de alcance adicional.
- **Supervisor de Ventas:** una sola query con `OR` — `usuario_id = supervisor` (autorizante) **o** el path JSON `valor_nuevo.usuario_solicitante_id = supervisor` (solicitante, solo en los tipos de evento que tienen ese campo) — con paginación (`skip`/`take`) resuelta en la base sobre esa misma query, no en memoria.
- `fecha_hasta` extendido a fin de día antes de aplicarse al `where`.

### 3.2. `verificarCadenaHashesVentas()`

Función propia del dominio ventas — no reutiliza `verificarCadenaHashesInventario()` (Módulo A) ni `verificarCadenaHashesIntegridad()` (Módulo D) tal cual, porque ninguna de las dos acepta parámetros de dominio. Recorre la cadena completa de `AuditLog` (el encadenamiento SHA-256 es único para toda la tabla, no por módulo) pero cuenta y reporta únicamente los eventos de Módulo B.

**No se creó ninguna función en `lib/services/auditoria/` de Módulo D** — todo el servicio vive en `lib/services/ventas/`, mismo patrón que Módulo A.

---

## 4. RBAC

| Permiso | Rol | Nivel de acceso |
|---|---|---|
| `auditoria:leer_forense` | `AUDITOR` (y `MASTER`, si lo tiene) | Ampliado: todos los usuarios del dominio, `verificar_integridad` habilitado |
| `ventas:leer_log_operativo` | `SUPERVISOR_VENTAS` | Restringido: solo eventos propios (autorizante o solicitante), `verificar_integridad` bloqueado |

Un usuario `MASTER` con ambos permisos accede con el nivel de Auditor (`leer_forense` tiene precedencia).

**Sobre `auditoria:leer_historico`:** confirmado durante esta implementación que `seed.ts` sí lo asigna a `AUDITOR`/`MASTER`, a diferencia de lo que afirmaba `spec_modulo_B.md` Rev. 4 ("sin asignar a ningún Rol"). No cambia el gate de este endpoint: sigue siendo `auditoria:leer_forense`, que es el permiso que consumen las rutas y la UI reales de todo el proyecto. `spec_modulo_B.md` ya se corrigió a Rev. 5 con este dato.

---

## 5. Testing — tres niveles (según lo reportado por la sesión de implementación)

**Procedencia:** corrida propia de la sesión que implementó la HU, el 2026-09-20. Este documento no re-ejecutó ni verificó independientemente estos resultados — quedan reportados tal como se comunicaron al cierre.

### 5.1. Nivel 1 — Unitarios (`npm test`: **340/340**, incluye 22 nuevos de HU-B6)

`tsc --noEmit` y `eslint` reportados sin errores. Se agregó el test unitario de HU-B6 a `npm test`.

### 5.2. Nivel 3 — BD real (`npm run test:integration:b6`: **19/19**, sin skips)

- Se corrieron primero `test:integration:b4` (9/9) y `test:integration:b5` (12/12) para repoblar la base (se había reseteado y no tenía eventos de esas suites).
- El test genera sus propios eventos con los servicios reales, sobre tres pedidos: **regular**, **escalado** y **ajeno**.
- **Escalado:** pedido con `registrado_por = supervisor.ventas.seed`, resuelto por "Master Local" (usuario con rol `MASTER` de la base). El Supervisor ve `DESCUENTO_FUERA_MARGEN` y `EXCEPCION_CREDITO_*` solo por el path JSON (como solicitante). No ve `CAMBIO_PRECIO_MANUAL`, porque ese evento no tiene campo de solicitante en su payload — consistente con el diseño (§2.1 del spec, sección "Contrato de alcance").
- **Ajeno:** el Supervisor ve 0 eventos de un pedido que no le corresponde.
- **Integridad:** la cadena reportó `integra: true`, con 14 eventos de Módulo B sobre 21 eventos totales en la cadena.

### 5.3. Nivel 2 — HTTP con login real: **10/10**

Contra el `dev server` local en el puerto 3000. Cubre el alcance por rol contra un oráculo en JS (comparación independiente del resultado esperado) y el rechazo de `verificar_integridad` para el Supervisor. El reporte de cierre no detalla caso por caso (mensaje truncado al citar el puerto); no verificado con más granularidad en este documento.

### 5.4. Regresión

`test:integration:b3`, `b4`, `b5`, `b8`, `b4-http` y `b5-http` — todas reportadas completas sin regresiones.

---

## 6. Capacidades no implementadas / fuera de alcance de esta iteración

- **Pantalla propia** (`/ventas/auditoria` o similar) — no construida, ver 1.1.
- **Server Action equivalente al `GET`** — no reportada.
- **Anulación de pedido (spec §2.8)** — sin código; el `tipo_evento: "venta:anulacion_pedido"` de este endpoint no devuelve resultados reales todavía.
- **Corrección de `spec_modulo_C.md` §2.9 / `spec_modulo_H.md` §2.9** — responsabilidad de los dueños de esos módulos, no de esta HU.
- **Exportación de reportes** — fuera de alcance según `spec_modulo_B.md` §5.

---

# PARTE 2 — HISTORIAL DE DESARROLLO

## 7. Paso 0 — relevamiento previo (solo lecturas, sin código)

Ejecutado contra `docs/tasks/task_HU-B6.md` en su versión previa a las decisiones (sin sección 0), `spec_modulo_B.md` Rev. 4, `schema.prisma`, `seed.ts` y el código real de HU-A6/Módulo D. Confirmó los 3 puntos explícitamente pedidos y agregó varios hallazgos adicionales:

**Los 3 puntos pedidos:**
1. **Shape real de la respuesta paginada:** `{ registros[], total, page, page_size }` en las dos consolas reales (A y D) — ninguna usa `pagina`/`por_pagina`. Ninguna de las dos consolas combina paginación + `verificacion_integridad` en el mismo endpoint hoy (en A, la verificación es una Server Action aparte); ese shape combinado es nuevo, propio de esta HU.
2. **Función de verificación a reutilizar:** ni `verificarCadenaHashesInventario()` (A) ni `verificarCadenaHashesIntegridad()` (D) sirven tal cual — ambas recorren toda la cadena global y no reciben parámetros de dominio.
3. **`accion` real para `venta:anulacion_pedido`:** no existe — sin handler en el listener, sin ruta `api/ventas/[id]/anular`. El proyecto usa `DELETE_LOGICO` como valor genérico para bajas lógicas de otras entidades; cuando se implemente §2.8, es razonable que termine usando ese valor y no `ANULACION_PEDIDO`.

**Otros hallazgos que afectaron el diseño:**
- `z.coerce.boolean()` roto para query params: probado con `?verificar_integridad=false`, `=0` y `=1` — los tres dieron `true`.
- La premisa sobre `auditoria:leer_historico` ("sin asignar a ningún Rol") era falsa: el seed sí lo asigna a `AUDITOR`.
- El filtro por solicitante se puede hacer en una sola query con `OR` (path JSON + columna), soportado por la versión de Prisma/Postgres del proyecto — probado solo con 0 filas en el Paso 0.
- `pedido_venta_id` no siempre es `registro_id`: para excepciones de crédito, `registro_id` es la operación, y el pedido está solo en `valor_nuevo.pedido_venta_id`.
- No existe un gate de "cualquiera de dos permisos" en `withPermission` — hay que resolverlo con `withAuth` + comprobación manual.
- `MASTER` puede tener ambos permisos — hay que definir precedencia.
- La base local se había reseteado (sin eventos de B4/B5); no había fixture para el caso "escalado"; el Backlog `.xlsx` no está en el repo; la Rev. 4 del spec estaba sin commitear.

## 8. Decisiones confirmadas antes de implementar (sección 0 de `task_HU-B6.md`)

Confirmadas explícitamente, una por una, antes de dar luz verde:

1. **Verificación:** función propia `verificarCadenaHashesVentas()`, recorre toda la cadena y cuenta solo Módulo B.
2. **Nombres y shape:** `page`/`page_size`, shape `{ registros, total, page, page_size, verificacion_integridad? }`.
3. **Boolean:** `z.enum(["true","false"]).transform(...)` en lugar de `z.coerce.boolean()`.
4. **Alcance del Supervisor:** una sola query con `OR` y filtro JSON, paginación en base.
5. **Anulación:** placeholder `ANULACION_PEDIDO` sin sumar `DELETE_LOGICO` al filtro.
6. **Gate:** `withAuth` + resolución manual de nivel de acceso; `auditoria:leer_forense` con precedencia sobre `ventas:leer_log_operativo`.
7. **UI:** API primero, pantalla después.
8. **Detalle del evento:** `valor_anterior`/`valor_nuevo` visibles también para el Supervisor.
9. **`fecha_hasta`:** mismo criterio de fin de día que HU-A6.
10. **(agregada tras el Paso 0)** filtro `pedido_venta_id` como `OR` entre `registro_id` y el path JSON `valor_nuevo.pedido_venta_id`.

## 9. Diferencias / puntos abiertos reportados al cierre

- **`spec_modulo_B.md` Rev. 4 seguía sin commitear** al momento del reporte de cierre — no fue tocada por la implementación. Se corrigió a Rev. 5 en un paso posterior (este mismo ciclo de documentación), reflejando los puntos 2, 3, 4, 5, 6 y 9 de §8 más el hallazgo del filtro `pedido_venta_id`.
- **`docs/tasks/task_HU-B6.md`** es la ubicación real del archivo de task, no `claude/task_HU-B6.md` — corregido en este documento y a tener en cuenta para futuras HU.
- **El rol `MASTER` no está en `seed.ts` de forma directa** — según el reporte, los tests del caso "escalado" dependen de que exista un usuario Master recién sembrado; si el seed no lo garantiza de forma determinística, esos subtests podrían saltearse (`skip`) en corridas futuras sin ese usuario. **No verificado en este documento si esto ya está resuelto o sigue como riesgo** — a confirmar contra el código real antes de cerrar el ciclo.
- **`audit_logs` es append-only:** los eventos ad-hoc generados por los tests de Nivel 3 (pedidos y operaciones de prueba, dados de baja lógica al terminar) dejan residuo permanente en la tabla de auditoría — mismo comportamiento ya documentado para HU-B4/HU-B5.
- **PR sin crear** — pendiente abrir manualmente desde el link de GitHub indicado al inicio de este documento.
- **Sin verificar en este documento** (por no haber lectura directa del código): el nombre exacto de los archivos de test, si el Route Handler importa `prisma` directamente en algún punto, y el detalle caso por caso de los 10 tests HTTP de Nivel 2 — el reporte de cierre los resume sin desglosarlos.

## 10. Pendientes

1. **Crear el PR** contra `develop` desde `feature/HU-B6` (commit `2433f81`).
2. **Confirmar el estado del seed de `MASTER`** para que el caso "escalado" no dependa de una siembra manual previa a cada corrida.
3. **Decidir si se construye la pantalla de HU-B6** una vez que se pueda confirmar contra el Backlog (`.xlsx` no está en el repo).
4. **Implementar la anulación de pedido (spec §2.8)** — HU/hallazgo separado; cuando se implemente, revisar si `ANULACION_PEDIDO` sigue siendo el valor correcto de `accion` o si termina siendo `DELETE_LOGICO`.
5. **Verificar este documento contra el código real** una vez que el PR esté abierto — se armó a partir de un reporte de cierre de sesión, no de una lectura línea por línea como `HU4_MODULO_B.md`/`HU5_MODULO_B.md`.