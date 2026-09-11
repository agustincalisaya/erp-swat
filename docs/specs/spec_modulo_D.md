```markdown
# Especificación Técnica — Módulo D (Seguridad, RBAC y Auditoría Forense)
## ERP SWAT Indumentarias

**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 14+ (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · Zod
**Referencias normativas:** `RULES.md` (Reglas N.° 1, 2 y 3) · `contexto_modulo_d.md` · `schema.prisma`

**Alcance de este documento:** D.2 (Gestión de Seguridad y Accesos — RBAC) y D.3 (Trazabilidad Forense — Log de Auditoría). **D.1 (Panel de Comando BI/Dashboard) queda explícitamente fuera de alcance** en esta etapa — depende de datos de módulos aún no construidos (Ventas, Proveedores) y de decisiones arquitectónicas (CQRS, mecanismo de tiempo real) no resueltas todavía. Se retomará como documento independiente cuando existan los módulos emisores de esos eventos.

**Nota de conciliación de esquema:** este documento usa exclusivamente la entidad `AuditLog` ya presente en `schema.prisma` (Sprint 1). El modelo `LogAuditoria` mencionado en una versión previa de `spec_modulo_D.md` **no se adopta** — perdía el campo `ip` (exigido por la Regla N.° 2 de `RULES.md`) y el campo `hash_anterior` explícito, y ya existe código y specs del Módulo A (`spec_modulo_A.md`, `task_cali.md`) que referencian `AuditLog` por nombre.

---

## 1. Visión General

El Módulo D es la capa transversal de seguridad y trazabilidad del ERP. No genera datos operativos propios: administra el ciclo de vida de `Usuario`, `Rol` y `Permiso` (D.2), y consume de forma asíncrona los eventos de dominio emitidos por los módulos transaccionales — hoy únicamente el Módulo A — para materializar un ledger inmutable en `AuditLog` (D.3).

Bajo Next.js App Router, D.2 se implementa con **Server Actions** para las pantallas de gestión de usuarios/roles (`app/(dashboard)/auditoria/usuarios/actions.ts`, `.../roles/actions.ts`) y **Route Handlers** para el flujo de autenticación (`app/api/auth/**`), que debe ser consumible también por clientes no-navegador. D.3 se implementa como **Route Handlers de solo lectura** (`app/api/auditoria/**`) más un **listener del Event Bus** (`lib/events/listeners/audit-log.listener.ts`) que no expone endpoint propio — se activa exclusivamente por eventos emitidos desde otros módulos.

Ambos subcomponentes respetan la segregación de funciones definida en `contexto_modulo_d.md` (sección 5): un Administrador gestiona usuarios pero no tiene acceso de lectura a la Consola de Auditoría Forense salvo aprobación explícita; un Auditor tiene acceso de solo lectura ampliado a `AuditLog` pero no puede mutar usuarios ni roles. Esto se modela como permisos RBAC granulares independientes, nunca como un único rol que habilite ambas capacidades.

---

## 2. D.2 — Gestión de Seguridad y Accesos (RBAC)

### 2.1. Modelo de estados de `Usuario`

El enum `EstadoUsuario` del schema ya contempla los cuatro estados descriptos en `contexto_modulo_d.md`:

| Estado | Origen | Comportamiento |
|---|---|---|
| `ACTIVO` | Alta inicial o reactivación manual | Usuario opera según sus permisos |
| `SUSPENDIDO` | **Automático**, tras exceder `intentos_fallidos` | Bloqueo temporal; revertido manualmente por un Administrador o automáticamente al expirar `bloqueado_hasta` |
| `BLOQUEADO` | Manual, decisión administrativa (no por intentos fallidos) | Bloqueo indefinido hasta reactivación explícita |
| `INACTIVO` | Baja lógica por egreso del colaborador | Revoca todas las sesiones activas inmediatamente; requiere motivo |

**Regla de transición automática (`SUSPENDIDO`):** la capa de servicios de autenticación (no cubierta en detalle en este documento — pertenece al flujo de login) debe, tras cada intento fallido, incrementar `intentos_fallidos` y, al alcanzar el umbral configurado (constante `MAX_INTENTOS_FALLIDOS`, sugerido `5`), setear `estado = SUSPENDIDO` y `bloqueado_hasta = now() + N minutos`. Este evento se audita obligatoriamente (ver tabla de eventos, sección 4).

### 2.2. Contratos e Interfaces

**Archivo de schemas:** `src/lib/schemas/auditoria.schema.ts`

```typescript
import { z } from "zod";

export const CrearUsuarioSchema = z.object({
  nombre_usuario: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(12, "Mínimo 12 caracteres por política de seguridad institucional"),
  nombre_completo: z.string().min(2),
  rol_ids: z.array(z.string().uuid()).min(1, "Debe asignarse al menos un rol"),
});
export type CrearUsuarioInput = z.infer<typeof CrearUsuarioSchema>;

export const ActualizarRolesUsuarioSchema = z.object({
  usuario_id: z.string().uuid(),
  rol_ids: z.array(z.string().uuid()),
});
export type ActualizarRolesUsuarioInput = z.infer<typeof ActualizarRolesUsuarioSchema>;

export const BajaLogicaUsuarioSchema = z.object({
  usuario_id: z.string().uuid(),
  deletion_reason: z.string().min(1, "El motivo de baja es obligatorio para usuarios"),
});
export type BajaLogicaUsuarioInput = z.infer<typeof BajaLogicaUsuarioSchema>;

export const CambiarEstadoUsuarioSchema = z.object({
  usuario_id: z.string().uuid(),
  nuevo_estado: z.enum(["ACTIVO", "SUSPENDIDO", "BLOQUEADO"]), // INACTIVO solo vía baja lógica (endpoint dedicado)
  motivo: z.string().optional(),
});
export type CambiarEstadoUsuarioInput = z.infer<typeof CambiarEstadoUsuarioSchema>;

export const CrearRolSchema = z.object({
  nombre: z.string().min(2),
  descripcion: z.string().optional(),
  permiso_ids: z.array(z.string().uuid()).min(1, "Un rol sin permisos no tiene efecto (principio de menor privilegio)"),
});
export type CrearRolInput = z.infer<typeof CrearRolSchema>;

export const ActualizarPermisosRolSchema = z.object({
  rol_id: z.string().uuid(),
  permiso_ids: z.array(z.string().uuid()),
});
export type ActualizarPermisosRolInput = z.infer<typeof ActualizarPermisosRolSchema>;
```

#### 2.2.1. Alta de Usuario

**Ruta:** `POST /app/api/auth/usuarios/route.ts` *(bajo `api/auth/` por convención — gestión de identidad, no de auditoría)*
**Server Action equivalente:** `crearUsuario()` en `app/(dashboard)/auditoria/usuarios/actions.ts`

**Comportamiento esperado:**
- El `password` recibido **nunca** se persiste ni se loguea en texto plano. Se deriva con Argon2id (`lib/auth/password.ts`) antes de tocar Prisma; `password_hash` y `password_salt` almacenan el resultado.
- La creación del `Usuario` y sus N filas en `UsuarioRol` es atómica (`prisma.$transaction`).
- Valida unicidad de `nombre_usuario` y `email` contra registros `is_active = true` — retorna `409 Conflict` en colisión.

**Respuesta `201 Created`:**
```json
{ "data": { "usuario_id": "uuid", "estado": "ACTIVO" }, "error": null }
```

#### 2.2.2. Actualizar roles de un Usuario

**Ruta:** `PATCH /app/api/auth/usuarios/[id]/roles/route.ts`

**Comportamiento esperado:**
- Reemplaza el conjunto completo de `UsuarioRol` activos para ese usuario (diff: soft-delete de las filas removidas, alta de las nuevas) — nunca hace `DELETE` físico sobre `UsuarioRol`.
- Operación atómica dentro de `$transaction`.

#### 2.2.3. Cambiar estado de Usuario (activar / suspender / bloquear manualmente)

**Ruta:** `PATCH /app/api/auth/usuarios/[id]/estado/route.ts`

**Comportamiento esperado:**
- Transición manual entre `ACTIVO`, `SUSPENDIDO`, `BLOQUEADO`. La transición a `INACTIVO` **no** pasa por esta ruta (ver 2.2.4).
- Si `nuevo_estado = ACTIVO` y el estado previo era `SUSPENDIDO`, resetea `intentos_fallidos = 0` y `bloqueado_hasta = null`.
- Revoca sesiones activas del usuario si el nuevo estado no es `ACTIVO` (ver `lib/auth/session.ts`).

#### 2.2.4. Baja lógica de Usuario

**Ruta:** `PATCH /app/api/auth/usuarios/[id]/baja/route.ts`

**Comportamiento esperado (Regla N.° 1 de `RULES.md`):**
- Actualiza `estado = INACTIVO`, `is_active = false`, `deleted_at = now()`, `deleted_by = usuarioIdQueEjecuta`, `deletion_reason` (obligatorio, ya validado por Zod).
- Revoca **todas** las sesiones activas de forma inmediata (`contexto_modulo_d.md`, sección 2).
- **No** afecta `UsuarioRol`, `AuditLog` ni ningún registro histórico asociado — el rastro de auditoría del usuario dado de baja se preserva intacto, conforme exige `contexto_modulo_d.md`.
- Nunca ejecuta `DELETE` físico.

**Respuesta `200 OK`:**
```json
{ "data": { "id": "uuid", "estado": "INACTIVO", "deleted_at": "2026-08-17T10:00:00.000Z" }, "error": null }
```

#### 2.2.5. Alta de Rol y asignación de Permisos

**Ruta:** `POST /app/api/auth/roles/route.ts`

**Comportamiento esperado:**
- Crea `Rol` y sus N filas `RolPermiso` en una transacción atómica.
- Valida unicidad de `nombre` contra roles `is_active = true`.

#### 2.2.6. Actualizar permisos de un Rol

**Ruta:** `PATCH /app/api/auth/roles/[id]/permisos/route.ts`

**Comportamiento esperado:**
- Mismo patrón de diff que 2.2.2 (soft-delete de `RolPermiso` removidos, alta de nuevos), nunca `DELETE` físico.
- **Advertencia operativa:** modificar permisos de un rol afecta instantáneamente a todos los usuarios que lo tengan asignado (no requiere que vuelvan a iniciar sesión si la verificación de permisos se resuelve en cada request contra la base — ver 3.3).

---

## 3. Reglas de Negocio Estrictas (Capa de Servicios)

**Archivos:** `src/lib/services/auditoria/usuario.service.ts`, `rol.service.ts`, `permiso.service.ts`

### 3.1. Derivación de credenciales — Argon2id, nunca en la capa de presentación
Ninguna Server Action ni Route Handler invoca primitivas de hashing directamente. `lib/auth/password.ts` centraliza `hashPassword()` y `verifyPassword()` usando Argon2id (`contexto_modulo_d.md`, sección 3), con parámetros de costo (memoria/iteraciones) como constantes versionadas en ese mismo archivo — nunca hardcodeadas inline en el service.

### 3.2. Transacciones atómicas para operaciones multi-tabla
Toda operación que module `Usuario` + `UsuarioRol`, o `Rol` + `RolPermiso`, se ejecuta dentro de un único `prisma.$transaction`, siguiendo el mismo patrón ya establecido en el Módulo A.

### 3.3. Resolución de permisos — verificación en cada request, no cacheada en sesión
`lib/auth/with-permission.ts` resuelve el conjunto de permisos efectivos de un usuario consultando `UsuarioRol` → `RolPermiso` → `Permiso` en cada request (no se cachean en el token de sesión). Esto garantiza que una revocación de permiso (2.2.6) o una baja lógica (2.2.4) tenga efecto inmediato en el siguiente request del usuario afectado, conforme exige `contexto_modulo_d.md` ("revocación inmediata de accesos"). El costo de esta consulta adicional se acepta como trade-off explícito frente a la alternativa de invalidar tokens cacheados, que agrega complejidad de invalidación distribuida fuera de alcance de Sprint actual.

### 3.4. Principio de menor privilegio — validación en creación de Rol
`crearRol()` rechaza (`400`) la creación de un `Rol` sin al menos un `Permiso` asociado — ya reflejado en el `.min(1)` del schema Zod (sección 2.2), pero reforzado también en la capa de servicio para cubrir invocaciones que no pasen por el Route Handler (ej. scripts de seed).

### 3.5. Filtrado por defecto de registros inactivos
Todo listado (`listarUsuarios`, `listarRoles`) aplica `where: { is_active: true }` por defecto, con el mismo flag `incluirInactivos` reservado para el módulo de Auditoría, siguiendo el patrón ya fijado en `spec_modulo_A.md` (sección 3.3).

### 3.6. Restricción de baja física (`onDelete: Restrict`)
Un intento de baja física de un `Rol` o `Permiso` con relaciones activas (`UsuarioRol`, `RolPermiso`) es rechazado por PostgreSQL. La capa de servicios propaga esto como `409 Conflict` — nunca reintenta con cascada, igual que en el Módulo A.

---

## 4. D.3 — Trazabilidad Forense (Log de Auditoría)

### 4.1. Naturaleza append-only de `AuditLog`

`AuditLog` **no tiene** service de escritura expuesto a Route Handlers ni Server Actions de negocio. La única vía de inserción es `lib/events/listeners/audit-log.listener.ts`, que reacciona a eventos del bus emitidos por otros módulos (hoy, Módulo A). Ningún desarrollador debe invocar `prisma.auditLog.create()` fuera de ese listener — de lo contrario se pierde la garantía de que todo evento pase por el mismo punto de cálculo de hash-chain.

### 4.2. Cálculo de la cadena de hashes (`lib/crypto/hash-chain.ts`)

```typescript
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";

interface DatosEventoAuditoria {
  usuario_id: string | null;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
  ip: string;
  valor_anterior: unknown | null;
  valor_nuevo: unknown | null;
}

export async function registrarEventoAuditoria(evento: DatosEventoAuditoria) {
  // 1. Resolver el último hash de la cadena (el registro más reciente por created_at).
  const ultimoRegistro = await prisma.auditLog.findFirst({
    orderBy: { created_at: "desc" },
    select: { hash_actual: true },
  });
  const hashAnterior = ultimoRegistro?.hash_actual ?? "GENESIS"; // primer registro de la cadena

  // 2. Calcular hash_actual = SHA256(payload canónico + hash_anterior).
  const payloadCanonico = JSON.stringify({
    usuario_id: evento.usuario_id,
    accion: evento.accion,
    tabla_afectada: evento.tabla_afectada,
    registro_id: evento.registro_id,
    ip: evento.ip,
    valor_anterior: evento.valor_anterior,
    valor_nuevo: evento.valor_nuevo,
  });
  const hashActual = createHash("sha256")
    .update(payloadCanonico + hashAnterior)
    .digest("hex");

  // 3. Insertar (append-only, nunca update).
  return prisma.auditLog.create({
    data: { ...evento, hash_anterior: hashAnterior, hash_actual: hashActual },
  });
}
```

**Riesgo de concurrencia reconocido:** el `findFirst` + `create` no son atómicos entre sí frente a dos eventos concurrentes, lo que podría producir un `hash_anterior` incorrecto si dos inserciones ocurren dentro de la misma ventana de carrera. Para Sprint actual, el listener del Event Bus procesa eventos de forma **secuencial** (no concurrente) dentro de un mismo proceso Node, lo cual mitiga el riesgo en la práctica. Si en el futuro el Event Bus migra a un broker externo con consumidores paralelos, este cálculo debe moverse a una transacción serializable (`isolationLevel: Serializable` en `$transaction`) o a un lock explícito sobre una fila centinela.

**Convención de campo `JSON.stringify` no canónico:** `JSON.stringify` en JavaScript no garantiza orden de claves estable entre distintas ejecuciones si el objeto se construye de forma no determinística. Los servicios que emiten eventos deben construir `valor_anterior`/`valor_nuevo` con orden de claves consistente (ideal: mismo orden que el schema Prisma del modelo afectado) para que la verificación retroactiva de la cadena (4.4) sea reproducible.

### 4.3. Consola de Auditoría — Interfaz de solo lectura

**Ruta:** `GET /app/api/auditoria/logs/route.ts`

```typescript
export const FiltrosAuditoriaSchema = z.object({
  usuario_id: z.string().uuid().optional(),
  entidad_afectada: z.string().optional(), // reutiliza el valor de tabla_afectada
  entidad_id: z.string().optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  tipo_evento: z.string().optional(), // reutiliza el valor de accion
  page: z.number().int().min(1).default(1),
  page_size: z.number().int().min(1).max(100).default(25),
});
```

**Comportamiento esperado:**
- Requiere permiso `auditoria:leer_forense` — **distinto** del permiso `usuarios:administrar` que gestiona D.2, conforme a la segregación de funciones de `contexto_modulo_d.md` (sección 5): un Administrador no tiene este permiso por defecto.
- Personal Operativo (rol sin `auditoria:leer_forense` pero autenticado) solo puede consultar su propio historial: si el usuario autenticado no tiene el permiso ampliado, el filtro `usuario_id` se fuerza server-side al propio `usuario_id` de la sesión, ignorando cualquier otro valor recibido en el query param.
- Resultado paginado, ordenado por `created_at desc` por defecto.

### 4.4. Verificación de integridad de la cadena

**Ruta:** `POST /app/api/auditoria/verificar-cadena/route.ts`

**Comportamiento esperado:**
- Requiere permiso `auditoria:verificar_cadena` (solo Auditor).
- Recorre `AuditLog` ordenado por `created_at asc`, recalculando `hash_actual` de cada fila con el mismo algoritmo de 4.2 y comparándolo contra el valor persistido, encadenando `hash_anterior` esperado vs. almacenado.
- Ante la primera discrepancia, detiene el recorrido y reporta el `id` del primer registro donde la cadena diverge — no continúa recorriendo (una vez rota la cadena, cualquier hash posterior es sospechoso por definición).

**Respuesta `200 OK` (cadena íntegra):**
```json
{ "data": { "integra": true, "registros_verificados": 4821 }, "error": null }
```

**Respuesta `200 OK` (discrepancia detectada):**
```json
{
  "data": {
    "integra": false,
    "registros_verificados": 1204,
    "primer_registro_divergente_id": "uuid",
    "hash_esperado": "abc123...",
    "hash_almacenado": "def456..."
  },
  "error": null
}
```
*(Nota: este endpoint no ejecuta ninguna corrección automática — solo detecta y reporta. La respuesta ante una discrepancia real es un procedimiento fuera del alcance de código, definido por el equipo de seguridad institucional.)*

---

## 5. Eventos de Dominio (EDA) — Consumidos por D.3

**Archivo:** `src/lib/events/event-types.ts`

D.3 no define eventos propios para emitir — es exclusivamente **consumidor**. Esta tabla documenta los eventos ya definidos en `spec_modulo_A.md` y `task_cali.md` que `audit-log.listener.ts` debe suscribir, más los nuevos que introduce D.2:

| Evento | Origen | Mapeo a `AuditLog` |
|---|---|---|
| `stock:producto_creado` | Módulo A | `accion="CREATE"`, `tabla_afectada="ProductoMaestro"` |
| `stock:movimiento_registrado` | Módulo A | `accion=tipo_movimiento`, `tabla_afectada="MovimientoStock"` |
| `stock:legajo_prueba_iniciado` | Módulo A | `accion="CREATE"`, `tabla_afectada="LegajoPrueba"` (payload **sin** `efectivo_placa`/`efectivo_organismo` en texto plano — ver 5.1) |
| `stock:variante_baja_logica` | Módulo A | `accion="DELETE_LOGICO"`, `tabla_afectada="VarianteSKU"` |
| `stock:umbrales_configurados` | Módulo A (HU-7) | `accion="UPDATE"`, `tabla_afectada="StockDeposito"` |
| `stock:umbral_critico_alcanzado` | Módulo A (HU-7) | `accion="ALERTA_UMBRAL"`, `tabla_afectada="StockDeposito"` |
| `usuario:creado` | Módulo D (D.2) | `accion="CREATE"`, `tabla_afectada="Usuario"` |
| `usuario:estado_cambiado` | Módulo D (D.2) | `accion="UPDATE_ESTADO"`, `tabla_afectada="Usuario"` |
| `usuario:suspendido_automaticamente` | Módulo D (D.2 — flujo de login) | `accion="SUSPENSION_AUTOMATICA"`, `tabla_afectada="Usuario"` |
| `usuario:baja_logica` | Módulo D (D.2) | `accion="DELETE_LOGICO"`, `tabla_afectada="Usuario"` |
| `rol:permisos_actualizados` | Módulo D (D.2) | `accion="UPDATE_PERMISOS"`, `tabla_afectada="Rol"` |

### 5.1. Regla de exclusión de datos sensibles en el payload de auditoría

Ningún evento debe incluir en `valor_anterior`/`valor_nuevo` el contenido en texto plano de campos cifrados (`efectivo_placa`, `efectivo_organismo`) ni credenciales (`password`, `password_hash`, `password_salt`). El emisor del evento (capa de servicios del módulo de origen) es responsable de excluir estos campos **antes** de publicar al bus — `audit-log.listener.ts` no realiza sanitización adicional, confía en que el payload recibido ya está limpio. Esto preserva el aislamiento de dominio: D.3 no necesita conocer qué campos son sensibles en cada módulo emisor.

---

## 6. Fuera de Alcance (diferido)

- **D.1 — Panel de Comando BI/Dashboard:** requiere Módulo B (Ventas) y Módulo H (Proveedores) como emisores de datos reales, además de decisiones no resueltas de arquitectura CQRS y mecanismo de actualización en tiempo real (polling / SSE / WebSockets). Se especificará como documento independiente cuando existan esos módulos.
- **Reactivación automática de `SUSPENDIDO` al expirar `bloqueado_hasta`:** este documento define la transición manual (2.2.3) y la transición automática de entrada a `SUSPENDIDO` (2.1), pero no un job/cron de reactivación automática al vencer el plazo — para Sprint actual, la reactivación es manual vía 2.2.3. Si se requiere automática, es una HU separada (job programado, fuera del ciclo request-response de Next.js).
- **[CANCELADO — Sprint Review 21/08/2026] HU-A3 — Legajos de Prueba (`LegajoPrueba`) / estado `EN_PRUEBA`:** funcionalidad cancelada por decisión del Product Owner (no debía haber entrado al sprint); el código fue eliminado. Las referencias a `stock:legajo_prueba_iniciado` en las tablas de este documento quedan como registro histórico.
```