# Especificación Técnica — HU-B8 (Alta de roles operativos de Ventas)

## ERP SWAT Indumentarias — Módulo B

**Metodología:** Regenerado por relevamiento directo del código (no SDD ex-ante).
**Stack real:** Prisma ORM (seed) · RBAC genérico de Módulo D (`Rol`/`Permiso`/`RolPermiso`/`UsuarioRol`) · PostgreSQL.
**Fuente:** código en `src/` y `prisma/seed.ts` al 2026-09-17. Documento nuevo.

**Nota estructural, léase antes que el resto del documento:** HU-B8 es, por diseño explícito de la tarea, **"puramente de datos/roles"** (`task_HU-B8_roles_operativos_ventas.md:7`): no crea ninguna pantalla, `page.tsx`, `actions.ts` ni Route Handler propio. Su superficie visible es **genérica y ya existente de un módulo distinto** (`/auditoria/roles`, Módulo D). Varias secciones de este documento que en HU-B3/HU-A7 describen archivos propios de la HU, acá describen en cambio la infraestructura de RBAC que HU-B8 alimenta con datos — se aclara en cada sección para no sugerir una pantalla dedicada que no existe.

---

## 1. Historia de Usuario y Criterios de Aceptación

**Como** Administrador del sistema, **necesito** que existan los roles `CAJERO_POS` y `SUPERVISOR_VENTAS` agrupando los permisos granulares `ventas:*` ya sembrados por HU-B1 a HU-B7, y que los usuarios de prueba del módulo tengan esos roles asignados, **para** que un login real de Cajero/Supervisor de Ventas pueda efectivamente pasar `withPermission()` sobre las rutas de Módulo B — sin rol asignado, los permisos ya sembrados quedan inertes y todo login recibe `403`.

**Criterios de Aceptación (verificados contra el código real — no contra el task file, ver discrepancias en §5):**

- [x] **CA1** — Existe el rol `CAJERO_POS` (`Rol.nombre`), agrupando exactamente 6 permisos `ventas:*`.
- [x] **CA2** — Existe el rol `SUPERVISOR_VENTAS`, agrupando esos mismos 6 más 4 permisos exclusivos.
- [x] **CA3** — Los usuarios seed `cajero.seed` y `supervisor.ventas.seed` quedan vinculados a sus roles respectivos vía `UsuarioRol`.
- [x] **CA4** — Un login real con esas credenciales pasa `withPermission()` sobre al menos una ruta real protegida de Módulo B.
- [x] **CA5** — Operación puramente aditiva: ningún `Permiso` nuevo, ningún rol de otro módulo modificado.

---

## 2. Arquitectura de la pantalla

**No existe una pantalla propia de HU-B8.** Relevamiento explícito (grep de `CAJERO_POS`/`SUPERVISOR_VENTAS` sobre todo `src/**/*.tsx`/`*.ts` fuera de `seed.ts` y archivos `*.test.ts`): cero resultados. Los roles que crea HU-B8 no aparecen mencionados por nombre en ningún componente, página o servicio de Módulo B.

Donde sí se hacen visibles, de forma completamente genérica (sin ningún código consciente de que son roles "de Ventas"):

### 2.1. `/auditoria/roles/page.tsx` — React Server Component (Módulo D, HU-D10, preexistente)

- Gate de acceso: `roles:administrar` — sin ese permiso, `redirect("/no-autorizado")` (reemplazó una vista de solo-lectura anterior; ver comentario propio del archivo, línea 48-53).
- `RolesData` (async, `<Suspense>`) llama a `listarRoles(true)` (con permisos incluidos) y `listarPermisos()`, ambos de `lib/services/auditoria/rol.service.ts` — el mismo servicio genérico que ya usan los roles de Módulo A/D/H.
- `listarRoles()` no filtra por módulo ni por prefijo de código de permiso: trae **todos** los roles activos, ordenados por `nombre` — `CAJERO_POS` y `SUPERVISOR_VENTAS` aparecen en esa tabla exactamente igual que `COMPRADOR`, `AUDITOR` o `TESORERO_CENTRAL`, sin ninguna sección o agrupación visual "Módulo B".
- Cada fila muestra `nombre`, `descripcion`, un modal con el detalle de permisos (`RolPermisosModal`) y un editor de permisos (`EditorPermisosRol`) — ambos genéricos, reutilizados sin cambios para estos dos roles nuevos.
- `FormularioAltaRol` permite dar de alta un rol nuevo cualquiera desde la UI — HU-B8 no lo usó (los dos roles se sembraron directo en `seed.ts`, no vía este formulario), pero la capacidad de editar sus permisos después de sembrados sí está disponible ahí, genéricamente.

**No existe `actions.ts` propio de HU-B8.** El `actions.ts` que sí existe (`src/app/(dashboard)/auditoria/roles/actions.ts`) es de Módulo D (HU-D10), consumido genéricamente por `EditorPermisosRol`/`FormularioAltaRol` — no tiene ninguna lógica específica de Ventas.

---

## 3. Capa de "servicios" — `prisma/seed.ts`, no un archivo de `lib/services/`

HU-B8 no agrega funciones a `lib/services/ventas/`. Toda su lógica es de **siembra de datos** dentro de `prisma/seed.ts`, reutilizando el patrón ya existente de otros módulos (`prisma.rol.upsert()` + `prisma.rolPermiso.upsert()` + `prisma.usuarioRol.upsert()`) sin introducir un patrón nuevo — confirmado como el objetivo explícito del Paso 1.1 del task file.

### 3.1. Permisos agrupados (ya sembrados por HU-B1 a HU-B7, sin cambios de HU-B8)

Los 10 permisos `ventas:*` reales, todos con `modulo: "MODULO_B"` (`seed.ts:1490-1511`):

| Constante | Código real | Origen (HU) |
|---|---|---|
| `PERMISO_VENTAS_REGISTRAR_MOSTRADOR_ID` | `ventas:registrar_venta_mostrador` | HU-B1 §2.1 |
| `PERMISO_VENTAS_GESTIONAR_TURNO_CAJA_ID` | `ventas:gestionar_turno_caja` | HU-B2 §2.2 |
| `PERMISO_VENTAS_EMITIR_COTIZACION_ID` | `ventas:emitir_cotizacion` | HU-B3 §2.3 |
| `PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN_ID` | `ventas:aplicar_descuento_margen` | HU-B4 §2.4 |
| `PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO_ID` | `ventas:autorizar_excepcion_descuento` | HU-B4 §2.4 |
| `PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE_ID` | `ventas:gestionar_cuenta_corriente` | HU-B5 §2.5 |
| `PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO_ID` | `ventas:autorizar_excepcion_credito` | HU-B5 §2.5 |
| `PERMISO_VENTAS_LEER_ID` | `ventas:leer` | HU-B7 §2.7 (comentario del código; usado también por HU-B3) |
| `PERMISO_VENTAS_ANULAR_PEDIDO_ID` | `ventas:anular_pedido` | HU-B7 §2.8 |
| `PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID` | `ventas:leer_log_operativo` | HU-B6 §2.6 |

**Estos códigos son los que hay que usar textualmente** — ver §5 sobre por qué no coinciden con lo que el task file de HU-B8 asumía.

### 3.2. Roles creados por HU-B8 (`seed.ts:2481-2499`)

```typescript
const rolCajeroPos = await prisma.rol.upsert({
  where: { id: ROL_CAJERO_POS_ID },
  create: {
    nombre: "CAJERO_POS",
    descripcion: "Operación de punto de venta (Módulo B) — cobro de mostrador, turno de caja y cotizaciones",
  },
});

const rolSupervisorVentas = await prisma.rol.upsert({
  where: { id: ROL_SUPERVISOR_VENTAS_ID },
  create: {
    nombre: "SUPERVISOR_VENTAS",
    descripcion: "Supervisión del circuito de Ventas (Módulo B) — autoriza excepciones de descuento/crédito, anula pedidos y consulta el log operativo",
  },
});
```

### 3.3. Mapeo Rol → Permiso (`seed.ts:2501-2534`)

```typescript
const permisosCajeroPos = [
  PERMISO_VENTAS_REGISTRAR_MOSTRADOR_ID,
  PERMISO_VENTAS_GESTIONAR_TURNO_CAJA_ID,
  PERMISO_VENTAS_EMITIR_COTIZACION_ID,
  PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN_ID,
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE_ID,
  PERMISO_VENTAS_LEER_ID,
]; // 6 permisos

const permisosSupervisorVentas = [
  ...permisosCajeroPos,
  PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO_ID,
  PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO_ID,
  PERMISO_VENTAS_ANULAR_PEDIDO_ID,
  PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID,
]; // 10 permisos (los 6 + 4 exclusivos)
```

**Hallazgo confirmado y documentado en el propio código, no un olvido:** `SUPERVISOR_VENTAS` recibe también `ventas:registrar_venta_mostrador` y `ventas:emitir_cotizacion`, pese a que `spec_modulo_B.md` §2.1/§2.3 los describe como "exclusivo Cajero POS, Supervisor no tiene ✓ directo". El comentario de `seed.ts:311-317` documenta que fue una **decisión explícita del equipo**: el Supervisor puede operar como Cajero de respaldo. No es una regresión de RBAC — es una ampliación deliberada de privilegios del rol superior.

### 3.4. Asignación Usuario → Rol (`seed.ts:2536-2564`)

`cajero.seed` (`nombre_usuario`) → `rolCajeroPos`; `supervisor.ventas.seed` → `rolSupervisorVentas`, ambas vía `prisma.usuarioRol.upsert()`, mismo patrón `@@unique([usuario_id, rol_id])` que el resto del sistema.

### 3.5. Consumo en runtime — `lib/auth/with-permission.ts` (Módulo D, no propio de HU-B8)

`usuarioTienePermiso()`/`withPermission()` resuelven `UsuarioRol → RolPermiso → Permiso` **en cada llamada**, sin cachear en sesión/token (revocación inmediata, spec_modulo_D.md §3.3) — HU-B8 no modifica este mecanismo, solo le da datos reales para operar sobre Ventas.

---

## 4. Contrato de API

**No existe un endpoint propio de HU-B8.** Los roles se consultan/editan a través de los endpoints genéricos de RBAC de Módulo D (HU-D10, "alta de rol" / "actualización de permisos de un rol" — los mismos que sirven `/auditoria/roles`), que HU-B8 no modifica ni extiende.

La verificación real de que el mapeo de HU-B8 "funciona" no pasa por un endpoint propio, sino por rutas **de otras HU** que consumen `withPermission()` con los códigos de la tabla §3.1:

| Ruta protegida | Permiso exigido | ¿Existe hoy? |
|---|---|---|
| `POST /api/ventas/presupuestos` | `ventas:emitir_cotizacion` | **Sí** (HU-B3) — única ruta real ejercitable end-to-end hoy |
| `PATCH /api/ventas/presupuestos/[id]/aceptar` | `ventas:emitir_cotizacion` | Sí (HU-B3) |
| `POST /api/ventas` (HU-B1), `/api/ventas/turnos/**` (HU-B2), `.../override-descuento` (HU-B4), `.../auditoria` (HU-B6), `.../anular` (HU-B7 §2.8) | resto de los 9 permisos restantes | **No** — confirmado en §7 de este documento y en HU3_MODULO_B.md §7 |

Por esta razón, la verificación real de HU-B8 (`rbac-hu-b8.integration.test.ts`) combina: (a) un login HTTP real contra la única ruta existente, y (b) `usuarioTienePermiso()` invocado directamente a nivel de servicio para los 9 permisos restantes, sin pasar por HTTP — documentado explícitamente como limitación de cobertura por ausencia de rutas, no como una falla de HU-B8.

---

## 5. Decisiones de diseño y discrepancias contra la tarea original

**El propio task file de HU-B8 (`docs/tasks/task_HU-B8_roles_operativos_ventas.md`) asumía códigos de permiso y nombres de rol que no coinciden con lo sembrado realmente.** El Paso 1 del task file pedía explícitamente relevar esto antes de codear ("Reportá el listado exacto... no lo des por sentado"); documentar la discrepancia acá es continuar ese mismo criterio, no señalar un error de implementación.

| Asumido por el task file (§1.2/Paso 2) | Código real sembrado (`seed.ts`) |
|---|---|
| `ventas:registrar_venta` | `ventas:registrar_venta_mostrador` |
| `ventas:abrir_turno` + `ventas:cerrar_turno` (dos permisos) | `ventas:gestionar_turno_caja` (uno solo, cubre ambas acciones) |
| `ventas:autorizar_descuento` | `ventas:autorizar_excepcion_descuento` |
| Rol **`Cajero POS`** (con espacio) | Rol **`CAJERO_POS`** (`Rol.nombre`, snake case en mayúsculas — mismo estilo que `COMPRADOR`, `AUDITOR`, `TESORERO_CENTRAL`) |
| Rol **`Supervisor de Ventas`** (con espacios) | Rol **`SUPERVISOR_VENTAS`** |
| (no mencionaba) `ventas:aplicar_descuento_margen`, `ventas:gestionar_cuenta_corriente`, `ventas:autorizar_excepcion_credito` | Sembrados por HU-B4/HU-B5, agrupados igual por HU-B8 |

Esto no representa una desviación del alcance: el Paso 2 del task file listaba los permisos "entre otros" y pedía relevar el listado real antes de agrupar — el mapeo final (§3.3 de este documento) usa los códigos reales, no los asumidos. Se documenta acá para que quien lea el task file original no asuma que esos nombres literales existen en el sistema.

**Pendiente explícitamente no resuelto por esta HU — `cuentas_por_pagar:leer` para `CAJERO_POS`:** `spec_modulo_G.md` §5 (línea 454) menciona `CAJERO_POS` como rol candidato futuro para el permiso `cuentas_por_pagar:leer` ("y `CAJERO_POS` cuando exista — ver §5"), y la misma sección aclara explícitamente: "No se crea el rol `CAJERO_POS`" (desde la perspectiva de Módulo G, escrita antes de que HU-B8 lo creara). Con `CAJERO_POS` ya existiendo desde HU-B8, esa deuda queda técnicamente desbloqueada pero **sigue sin resolverse**: el rol `CAJERO_POS` de HU-B8 **no** tiene asignado `cuentas_por_pagar:leer` — confirmado por `roles-hu-b8.test.ts:71-81`, que incluye un test dedicado exactamente para impedir que se filtre por accidente: *"`cuentas_por_pagar:leer` NO se asigna a CAJERO_POS (fuera de alcance de HU-B8, spec_modulo_G.md §5 queda pendiente)"*. Se documenta acá como pendiente real, no se resuelve en este relevamiento.

**Punto 1.5 del task file (autorización de `CuentaCorrienteOperacion.RETENIDA`) — inaplicable, no ejecutado:** el task file pedía ajustar el mecanismo de autorización de HU-B5 para reconocer `SUPERVISOR_VENTAS` si dependía de rol y no de permiso. Relevamiento confirma que **no existe ningún servicio de Módulo B para `CuentaCorrienteOperacion`** (`grep` sin resultados sobre `src/lib/services/ventas/` y sobre todo `src/` para ese modelo fuera de `schema.prisma`) — HU-B5 no tiene código de aplicación todavía, solo el modelo de datos. El Paso 2.4 del task file quedó, por lo tanto, sin acción posible: no hay mecanismo de autorización (ni por rol ni por permiso) que ajustar, porque no hay servicio.

---

## 6. Filtros/UI real

No aplica una sección propia de filtros de HU-B8: la única UI que refleja sus datos es `/auditoria/roles` (§2.1), que no tiene filtros (lista todos los roles activos sin buscador ni paginación) — comportamiento genérico de Módulo D, sin ninguna adaptación para Ventas.

---

## 7. Capacidades evaluadas y descartadas

- **Pantalla de gestión de roles propia de Ventas** — evaluada explícitamente en el Paso 1.4 del task file ("Releva si ya existe... si no existe, esta HU no construye ninguna pantalla") y descartada a propósito: sí existía una pantalla de Módulo D (`/auditoria/roles`, HU-D10) capaz de mostrar cualquier rol nuevo sin trabajo de frontend adicional, así que HU-B8 no construyó nada — confirmado por la ausencia total de archivos nuevos bajo `app/(dashboard)/ventas/` relacionados a roles.
- **Permiso nuevo para la operación de HU-B8** — descartado a propósito (Paso 5 del task file: "operación puramente aditiva... no modificar `Permiso`"). Confirmado: los 10 permisos `ventas:*` ya existían de HU-B1 a HU-B7; HU-B8 solo los agrupa.
- **Ejercitar por HTTP los 9 permisos sin ruta propia** — evaluado y descartado por ausencia de la ruta, no por decisión de alcance de HU-B8 (ver §4). Cubierto parcialmente a nivel de servicio (`usuarioTienePermiso()` directo) en `rbac-hu-b8.integration.test.ts`.
- **Ajuste del mecanismo de autorización de `CuentaCorrienteOperacion.RETENIDA`** — evaluado (Paso 1.5/2.4 del task file) y no ejecutado por inexistencia del servicio a ajustar (§5).
- **Roles de Módulo C (`Vendedor`, `Administrador de CRM`)** — fuera de alcance explícito del propio task file; no relevados ni tocados por esta tarea.

---

## 8. Navegación — `Sidebar.tsx`

**No hay ítem de Sidebar propio de HU-B8.** Los roles que crea no tienen representación en la sección "Ventas" del Sidebar (que solo lista "Presupuestos", ver HU3_MODULO_B.md §8). Su única superficie de navegación es heredada de Módulo D, sección **"Auditoría"**:

```typescript
{
  label: "Roles y Permisos",
  href: "/auditoria/roles",
  icon: ShieldCheck,
  permiso: "roles:administrar",
}
```

- Gateado por `roles:administrar` (no por ningún permiso `ventas:*`) — coherente con que administrar roles es una capacidad de Módulo D, no de Ventas. Un Supervisor de Ventas con los 10 permisos `ventas:*` **no** ve este ítem a menos que además tenga `roles:administrar`.
- El comentario del propio `Sidebar.tsx` (líneas 7-13) documenta que este ítem y "Usuarios" se ocultan sin `roles:administrar` desde HU-D10 — bloqueo real de acceso vive en el `page.tsx`, el filtro del Sidebar es solo capa de navegación.

---

## 9. Cumplimiento de cada Criterio de Aceptación

| CA | Cumplido por |
|---|---|
| **CA1** — Rol `CAJERO_POS` con 6 permisos | `seed.ts:2481-2489` (alta del rol) + `seed.ts:2501-2516` (asignación) + `roles-hu-b8.test.ts:29-53` (verificación source-regex) |
| **CA2** — Rol `SUPERVISOR_VENTAS` con 10 permisos | `seed.ts:2491-2499` + `seed.ts:2518-2534` + `roles-hu-b8.test.ts:55-69` |
| **CA3** — `UsuarioRol` de `cajero.seed`/`supervisor.ventas.seed` | `seed.ts:2536-2564` + `roles-hu-b8.test.ts:23-27` |
| **CA4** — Login real pasa `withPermission()` | `rbac-hu-b8.integration.test.ts:72-131` (login HTTP real + `POST /api/ventas/presupuestos` con `cajero.seed`, `201`) |
| **CA5** — Puramente aditivo | Ausencia verificada: ningún `Permiso.create`/`update` de código existente en el bloque de HU-B8; ningún `RolPermiso`/`UsuarioRol` de otro módulo tocado |

---

## 10. Capacidades adicionales no exigidas por los CA

- **Test dedicado anti-regresión del pendiente de Módulo G**: `roles-hu-b8.test.ts:71-81` verifica activamente que `cuentas_por_pagar:leer` **no** se filtre a `CAJERO_POS` — protege un pendiente conocido (§5) contra una futura asignación accidental, sin que ningún CA lo exija.
- **Verificación end-to-end con servidor real** (`rbac-hu-b8.integration.test.ts`, opt-in vía `HU_B8_INTEGRATION_BASE_URL`): incluye controles negativos explícitos (`401` sin sesión, `403` con `auditor.seed` sin permiso `ventas:*`) además del camino positivo — no exigido literalmente por ningún CA, pero evita que "siempre deja pasar" se confunda con "el gate realmente funciona".
- **Reutilización íntegra del patrón RBAC existente**: cero código nuevo de infraestructura (ni migración de schema, ni cambios a `with-permission.ts` ni a `rol.service.ts`) — toda la tarea es datos puros sobre tablas ya existentes, confirmando que `Rol`/`Permiso`/`RolPermiso`/`UsuarioRol` ya soportaban el caso sin cambios (Paso 1.3/§4 "fuera de alcance" del task file, confirmado correcto).
