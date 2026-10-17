# Especificación Técnica — HU-E10 (Roles Administrador E-commerce y Operador de Pick & Pack)

## ERP SWAT Indumentarias — Módulo E

**Metodología:** Regenerado por relevamiento directo del código (no SDD ex-ante), mismo patrón que `HU8_MODULO_B.md`.
**Stack real:** Prisma ORM (seed) · RBAC genérico de Módulo D (`Rol`/`Permiso`/`RolPermiso`/`UsuarioRol`) · PostgreSQL 16.
**Fuente:** `docs/tasks/HU-E10.md`, `spec_modulo_E.md` Rev. 1 y `prisma/seed.ts` de `develop` al 2026-09-29 (`0bde541`).
**Spec de referencia (rangos completados en Paso 0):** `spec_modulo_E.md` "⚠️ Alcance del módulo" (líneas 11–17), §2.6 (301–350), §2.10 (493–517), §2.12 (586–674).

**Nota estructural:** HU-E10 es **puramente de datos/roles**. No crea pantalla, `page.tsx`, `actions.ts`, Route Handler, migración ni cambio en `seed.ts`: el bloque "Sprint 4 — HU-E10" ya estaba sembrado en `develop` (PR #194). El trabajo de esta HU es **verificar, testear y documentar evidencia**.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Administrador, **necesito** contar con los roles Administrador E-commerce y Operador de Pick & Pack, con sus permisos granulares, **para** operar el canal online bajo el principio de menor privilegio y segregación de funciones.

- [x] **CA1** — Existen los roles `ADMINISTRADOR_ECOMMERCE` y `OPERADOR_PICK_PACK` con permisos granulares `ecommerce:*` según la matriz (spec E §2.10). → Nivel 1, Nivel 2 caso 3, Nivel 3 consultas 1–2.
- [x] **CA2** — Administrador E-commerce: catálogo, cupones, anular órdenes no abonadas, cancelar pedidos pagados, consultar la cola, historial de todos los clientes, exportar métricas, solicitar acceso al log de pagos (8 permisos). → ídem. *"Priorizar la cola" no tiene permiso propio: ver Punto abierto 1.*
- [x] **CA3** — Operador de Pick & Pack: consultar la cola, preparar, validar QR (3 permisos), sin acceso a facturación ni pagos. → Nivel 1 (exclusiones explícitas), Nivel 2 casos 3–6.
- [x] **CA4** — El Cliente Web no es un rol del RBAC interno. → Nivel 2 caso 7 (`401`), `CuentaClienteWeb` sin relación con `UsuarioRol`.
- [x] **CA5** — Autorización siempre por permiso, nunca por nombre de rol. → grep negativo en Nivel 1.
- [x] **CA6** — Seed idempotente con un usuario de prueba por rol; UUID aleatorios sin colisión. → Nivel 1 (unicidad acotada, ver §5.1), caso 9 (manual, BD descartable).
- [x] **CA7** — Los roles aparecen en la pantalla de gestión de roles de Módulo D, sin frontend nuevo. → QA visual (§5.4).

---

## 2. Arquitectura de la pantalla

**No existe pantalla propia de HU-E10.** Los roles se ven y se editan en `/auditoria/roles` (`src/app/(dashboard)/auditoria/roles/page.tsx`, Módulo D, HU-D10), gateada por `usuarioTienePermiso(session.userId, "roles:administrar")` (línea 157). `listarRoles()` trae todos los roles activos sin agrupar por módulo, así que `ADMINISTRADOR_ECOMMERCE` y `OPERADOR_PICK_PACK` aparecen igual que cualquier otro rol, con `RolPermisosModal`/`EditorPermisosRol` genéricos.

---

## 3. Datos sembrados (`prisma/seed.ts`, sin cambios de esta HU)

### 3.1. Permisos `ecommerce:*` (`modulo: "MODULO_E"`, `seed.ts:482-492` y `3369-3393`)

| Código | UUID | ADMIN_ECOMMERCE | OPERADOR_PICK_PACK |
|---|---|---|---|
| `ecommerce:gestionar_catalogo` | `18494e73-f0b7-4bec-84fb-7b65984c959b` | ✓ | — |
| `ecommerce:gestionar_cupones` | `5c5140b1-8ad0-4e82-9ed2-c87352573aea` | ✓ | — |
| `ecommerce:anular_orden_no_abonada` | `baa5e385-e1a2-49ca-a6fa-8b93d01d998e` | ✓ | — |
| `ecommerce:cancelar_pedido_pagado` | `f8eb98d6-1c61-46b4-bfd1-06c4f7fc7255` | ✓ | — |
| `ecommerce:leer_cola_preparacion` | `248e72a2-0d6e-4a35-a977-edea583806d7` | ✓ | ✓ |
| `ecommerce:preparar_pedido` | `79c4a42c-7382-48f2-97e8-1a7ce26ae2d5` | — | ✓ |
| `ecommerce:validar_retiro_qr` | `8549117c-fca7-47b9-8f73-d4f3f85e777c` | — | ✓ |
| `ecommerce:leer_historial_ordenes` | `1a68c39a-f427-47c8-8923-56413c22a177` | ✓ | — |
| `ecommerce:exportar_metricas` | `c603f9c6-2bf4-4d95-b06c-e339f09ae303` | ✓ | — |
| `ecommerce:solicitar_acceso_log_pagos` | `fe71b5b4-09ba-407a-bff0-1aa64656f656` | ✓ | — |
| `ecommerce:priorizar_cola` | `6481fbee-c5d3-4c40-ad62-261588c1d0cf` | ✓ | — |

`ecommerce:priorizar_cola` se agregó después del cierre de la HU, al resolver el Punto abierto 1 (§6).

### 3.2. Roles, usuarios y asignaciones (`seed.ts:494-501` y `3395-3478`)

| Entidad | Valor | UUID |
|---|---|---|
| Rol | `ADMINISTRADOR_ECOMMERCE` | `5a4b283b-fdaf-4253-ab3e-be13c118d74d` |
| Rol | `OPERADOR_PICK_PACK` | `a0028adb-6bc1-48fe-b3e9-2a626d718d4e` |
| Usuario | `admin.ecommerce.seed` / `admin.ecommerce.seed@erp-swat.local` | `ff9df5a6-2f1a-4285-a935-c6969f933f1a` |
| Usuario | `operador.pickpack.seed` / `operador.pickpack.seed@erp-swat.local` | `62fd609c-ea3b-4e62-b9d2-5ccffad13849` |
| UsuarioRol | admin.ecommerce.seed → ADMINISTRADOR_ECOMMERCE | `c6a749f0-5aa6-4983-83e7-7111b02ae5d7` |
| UsuarioRol | operador.pickpack.seed → OPERADOR_PICK_PACK | `c9bb2cbe-1118-4411-ac03-3dd02880a709` |

Todos los upsert usan `REACTIVAR_REFERENCIA_RBAC` o `update: {}`: re-correr el seed no duplica ni pisa datos.

---

## 4. Contrato de API

**Sin endpoints nuevos** (spec E §2.10). Los consumidores (HU-E4/E5/E7/E11/E12/E13/E6) gatean con `withPermission("ecommerce:<accion>")` o `usuarioTienePermiso(usuario_id, "ecommerce:<accion>")` (`src/lib/auth/with-permission.ts`), que resuelven `UsuarioRol → RolPermiso → Permiso` en cada request, sin caché, filtrando `is_active` en las tres tablas. Hoy no existe ninguna ruta `app/api/ecommerce/**`, por eso el Nivel 2 no tiene casos HTTP positivos.

---

## 5. Testing y evidencia

### 5.1. Nivel 1 — Unit (source-regex, sin DB) — `src/lib/services/ecommerce/roles-hu-e10.test.ts`

Incluido en `npm test`. 6 tests:

1. Los 11 códigos `ecommerce:*` están declarados con su UUID y se siembran con `modulo: "MODULO_E"`.
2. Roles, usuarios y UsuarioRol declarados con sus UUID y vinculados entre sí.
3. `ADMINISTRADOR_ECOMMERCE` = exactamente los 9 de la matriz (incluido `priorizar_cola`), sin `preparar_pedido` ni `validar_retiro_qr`.
4. `OPERADOR_PICK_PACK` = exactamente 3, sin gestión de catálogo/cupones, cancelación, historial, métricas, log de pagos ni `priorizar_cola`.
5. Unicidad de UUID (**acotada** a los 17 UUID de HU-E10, ver nota).
6. Grep negativo: ningún archivo de aplicación de `src/` (se excluyen `*.test.ts`, que nombran los roles solo para verificar el payload de login) contiene `ADMINISTRADOR_ECOMMERCE` ni `OPERADOR_PICK_PACK`.

> **Nota — desvío deliberado respecto de la letra de la task (§8, Nivel 1).** La task pide extraer *todos* los `const <NOMBRE>_ID = "<uuid>"` de `seed.ts` y verificar que no haya valores repetidos. Ese criterio global **falla hoy en `develop` por una deuda preexistente ajena a esta HU**: `MOVIMIENTO_DEVUELTO_SEED_ID` (`seed.ts:83`, HU-A9) y `LISTA_PRECIO_HOMOLOGADO_ID` (`seed.ts:199`, HU-H2) comparten `1a2b3c4d-bbbb-4a1a-8a1a-000000000001` (ver §6, hallazgo 6). Como esta HU no modifica `seed.ts`, la verificación quedó acotada — con aprobación explícita del owner — a: los 16 UUID de HU-E10 (10 permisos, 2 roles, 2 usuarios, 2 UsuarioRol) son distintos entre sí y **ninguna otra constante de `seed.ts` reutiliza ninguno de ellos**. Esto cubre el riesgo concreto de HU-B8 (una constante nueva cayendo sobre un ID ya tomado). Cuando se corrija la colisión `bbbb`, el test puede ampliarse al criterio global.

**Resultado (`npm test`, suite completa):**
```
ℹ tests 478
ℹ pass 478
ℹ fail 0
```

### 5.2. Nivel 2 — Integración (DB local + login real) — `npm run test:integration:e10`

`src/lib/services/ecommerce/rbac-hu-e10.integration.test.ts`. Opt-in vía `HU_E10_INTEGRATION_BASE_URL` (se saltea si no está seteada), mismo patrón que `test:integration:b8`. Requiere `npm run dev` levantado contra una base local con el seed aplicado.

```
HU_E10_INTEGRATION_BASE_URL=http://localhost:3000 npm run test:integration:e10

▶ HU-E10 — login real de admin.ecommerce.seed/operador.pickpack.seed y matriz efectiva de permisos ecommerce:*
  ✔ 1. admin.ecommerce.seed loguea (200 + swat_session) con rol ADMINISTRADOR_ECOMMERCE
  ✔ 2. operador.pickpack.seed loguea (200 + swat_session) con rol OPERADOR_PICK_PACK
  ✔ 5. GET /api/ventas/auditoria con sesión de operador.pickpack.seed devuelve 403
  ✔ 6. GET /api/ventas/auditoria con sesión de admin.ecommerce.seed devuelve 403
  ✔ 7. el Cliente Web (juan.perez@example.com) no puede loguear en el ERP: 401
  ✔ 8. el usuario de sistema canal.web.sistema no puede loguear: 401
  ✔ 3. matriz efectiva: 10 permisos × 2 usuarios = spec_modulo_E.md §2.10
  ✔ 4. ninguno de los dos usuarios tiene permisos ajenos (auditoria:leer_forense, ventas:leer, roles:administrar)
ℹ tests 9  ℹ pass 9  ℹ fail 0
```

Notas:
- Caso 3: 20 aserciones (`usuarioTienePermiso()` × 10 permisos × 2 usuarios), contadas explícitamente en el test.
- Casos 5–6: `GET /api/ventas/auditoria` no usa `withPermission` sino `withAuth` + `resolverNivelAccesoAuditoriaVentas()`, que igual resuelve **por permiso** (`auditoria:leer_forense` o `ventas:leer_log_operativo`) y responde `403` sin ninguno.
- Caso 7: `juan.perez@example.com` existe solo como `Cliente` y `CuentaClienteWeb`, nunca como `Usuario`.
- **Caso 9 (idempotencia) — manual, no automatizado a propósito** (correr el seed desde un test es riesgoso si se apunta a una base compartida). Ejecutado en una base **descartable** creada en el Postgres local (`swat_erp_e10_tmp`): `prisma migrate deploy` → `prisma db seed` ×2 → conteos → `DROP DATABASE`. Conteos idénticos tras ambas corridas:

```
conteo                       | corrida 1 | corrida 2
permisos ecommerce:*         | 10        | 10
roles E10                    | 2         | 2
rol_permisos E10 activos     | 11        | 11
usuarios E10                 | 2         | 2
usuario_roles E10            | 2         | 2
otros roles con ecommerce:*  | 0         | 0
TOTAL permisos               | 69        | 69
TOTAL roles                  | 13        | 13
TOTAL rol_permisos           | 103       | 103
TOTAL usuarios               | 14        | 14
TOTAL usuario_roles          | 13        | 13
```

**Regresión:** `HU_B8_INTEGRATION_BASE_URL=http://localhost:3000 npm run test:integration:b8` → 8/8 en verde.

### 5.3. Nivel 3 — Verificación en BD (solo lectura, base local)

Consultas de la task §8 ejecutadas con `psql` sobre `swat_erp_db` local:

```
-- 1) Matriz efectiva (esperado: 12 filas)
 ADMINISTRADOR_ECOMMERCE | ecommerce:anular_orden_no_abonada
 ADMINISTRADOR_ECOMMERCE | ecommerce:cancelar_pedido_pagado
 ADMINISTRADOR_ECOMMERCE | ecommerce:exportar_metricas
 ADMINISTRADOR_ECOMMERCE | ecommerce:gestionar_catalogo
 ADMINISTRADOR_ECOMMERCE | ecommerce:gestionar_cupones
 ADMINISTRADOR_ECOMMERCE | ecommerce:leer_cola_preparacion
 ADMINISTRADOR_ECOMMERCE | ecommerce:leer_historial_ordenes
 ADMINISTRADOR_ECOMMERCE | ecommerce:priorizar_cola
 ADMINISTRADOR_ECOMMERCE | ecommerce:solicitar_acceso_log_pagos
 OPERADOR_PICK_PACK      | ecommerce:leer_cola_preparacion
 OPERADOR_PICK_PACK      | ecommerce:preparar_pedido
 OPERADOR_PICK_PACK      | ecommerce:validar_retiro_qr
(12 rows)

-- 2) Catálogo de permisos (esperado: 11 filas, MODULO_E)
 ecommerce:anular_orden_no_abonada    | MODULO_E | t
 ecommerce:cancelar_pedido_pagado     | MODULO_E | t
 ecommerce:exportar_metricas          | MODULO_E | t
 ecommerce:gestionar_catalogo         | MODULO_E | t
 ecommerce:gestionar_cupones          | MODULO_E | t
 ecommerce:leer_cola_preparacion      | MODULO_E | t
 ecommerce:leer_historial_ordenes     | MODULO_E | t
 ecommerce:preparar_pedido            | MODULO_E | t
 ecommerce:priorizar_cola             | MODULO_E | t
 ecommerce:solicitar_acceso_log_pagos | MODULO_E | t
 ecommerce:validar_retiro_qr          | MODULO_E | t
(11 rows)

-- 3) Usuarios de prueba (esperado: 2 filas)
 admin.ecommerce.seed   | ACTIVO | ADMINISTRADOR_ECOMMERCE
 operador.pickpack.seed | ACTIVO | OPERADOR_PICK_PACK
(2 rows)

-- 4) Otros roles con ecommerce:* (esperado: 0 filas)
(0 rows)
```

**Re-verificación tras el Punto abierto 1 (03/10/2026):** las consultas 1, 2 y 4 se volvieron a correr sobre una base descartable (`swat_erp_qa_b9`, migrada y sembrada con el seed actual) y dieron exactamente lo de arriba: 12 filas, 11 filas y 0 filas. Un tercer `prisma db seed` sobre la misma base no cambió ningún conteo (permisos `ecommerce:*` 11, `rol_permisos` `ecommerce:*` activos 12, total de permisos 71, total de `rol_permisos` 105): sigue siendo idempotente. Los resultados de §5.2 son los del cierre original (10 permisos, 20 aserciones). Re-corrida con el permiso nuevo, `next dev` sobre `swat_erp_qa_b9`: `test:integration:e10` **9/9** (caso 3: 11 permisos × 2 usuarios = 22 aserciones) y regresión `test:integration:b8` **8/8**.

### 5.4. QA visual — `/auditoria/roles`

Login real con `administrador.seed` (`admin.seed@erp-swat.local`, rol ADMINISTRADOR, `roles:administrar`) → `GET /auditoria/roles` → `200`. La respuesta renderizada contiene:
- `ADMINISTRADOR_ECOMMERCE` con la descripción "Administración del canal web (Módulo E) — …"
- `OPERADOR_PICK_PACK` con la descripción "Preparación y entrega Click & Collect (Módulo E) — …"
- los 10 códigos `ecommerce:*` en el detalle de permisos de ambos roles.

Sin edición de roles (no se ejercitó `rol:permisos_actualizados`). **Capturas de pantalla: pendientes** (a adjuntar al PR — la verificación de arriba se hizo sobre el HTML servido).

---

## 6. Puntos abiertos, hallazgos e inconsistencias (no implementados en esta HU; 1 y 2 resueltos después del cierre)

1. **RESUELTO (Cali + PO, 03/10/2026) — permiso para "priorizar la cola".** Era: spec E §2.12 resolvía "priorizar" con `ecommerce:leer_cola_preparacion` + "rol Administrador"; como el Operador también tiene ese permiso, distinguirlos exigía mirar el nombre del rol, contra CA5. **Decisión:** permiso nuevo `ecommerce:priorizar_cola` (UUID `6481fbee-c5d3-4c40-ad62-261588c1d0cf`, verificado sin colisión contra todo `seed.ts`), `modulo: "MODULO_E"`, asignado **solo** al Administrador E-commerce vía `RolPermiso` (mismo `upsert` + `REACTIVAR_REFERENCIA_RBAC`). Spec E §2.10 (fila nueva en la matriz) y §2.12 (permiso de `PATCH .../prioridad`) corregidos; `roles-hu-e10.test.ts` y `rbac-hu-e10.integration.test.ts` actualizados (11 permisos, 9 del Administrador, 17 UUID). El endpoint de priorización de HU-E12 queda desbloqueado y debe gatear con `withPermission("ecommerce:priorizar_cola")`.
2. **RESUELTO (Cali + PO, 03/10/2026) — Auditor en historial de órdenes y métricas: manda el spec técnico.** Era: el Alcance Funcional Módulo E §5 da ✓ al **Auditor** en "Consultar historial completo de órdenes" y "Exportar métricas de conversión y ventas web", pero spec E §2.10 no incluye al Auditor y el seed no le asigna `ecommerce:leer_historial_ordenes` ni `ecommerce:exportar_metricas` (Nivel 3 consulta 4 = 0 filas). **Decisión:** el spec técnico (§2.10, ya implementado y testeado) es la fuente de verdad. No se agregan permisos al Auditor ni se toca el seed. El Alcance Funcional queda **desactualizado en este punto puntual** (su matriz §5 del Módulo E, filas de historial y métricas para el Auditor); el documento no vive en el repo, así que la corrección ahí queda a cargo de quien lo mantiene.
3. **Hallazgo para HU-E6.** La leyenda de la matriz del Alcance Módulo E §5 define el "△ solicita" como "sujeta a aprobación del **Auditor**": aporta el aprobador que spec E §2.6 deja sin definir. Duración y expiración del acceso siguen sin definirse. Pasar al dueño de HU-E6.
4. **Permiso sin consumidor:** `ecommerce:exportar_metricas` sin endpoint (spec E §5, diferido a Tablero de Comando de Módulo D). Conocido.
5. **Conocidos, fuera de esta HU:** `ventas:validar_identidad_cliente_web` (provisional, no sembrado, HU-E8); roles DevOps y Marketing de Módulo F no sembrados.
6. **Deuda preexistente — colisión de UUID `bbbb` en `seed.ts` (dueño de HU-A9/HU-H2).** `MOVIMIENTO_DEVUELTO_SEED_ID` (`seed.ts:83`) y `LISTA_PRECIO_HOMOLOGADO_ID` (`seed.ts:199`) comparten `1a2b3c4d-bbbb-4a1a-8a1a-000000000001`. Hoy no rompe nada en base (tablas distintas, PK por tabla), pero es el mismo tipo de error que causó el bug de HU-B8 y ya estaba reportada como deuda desde HU-B4. No se corrige acá; motivó el acotamiento del §5.1.

---

## 7. Archivos de esta HU

| Archivo | Cambio |
|---|---|
| `src/lib/services/ecommerce/roles-hu-e10.test.ts` | Nuevo — Nivel 1 |
| `src/lib/services/ecommerce/rbac-hu-e10.integration.test.ts` | Nuevo — Nivel 2 (casos 1–8) |
| `package.json` | `roles-hu-e10.test.ts` agregado a `test`; nuevo script `test:integration:e10` |
| `docs/modulos/modulo E/HU10_MODULO_E.md` | Nuevo — este documento |

Sin cambios en `prisma/seed.ts`, `schema.prisma`, migraciones, Route Handlers, Server Actions ni frontend.
