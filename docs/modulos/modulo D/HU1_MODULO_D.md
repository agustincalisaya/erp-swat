# HU-1 — Alta de Usuario y Roles (Módulo D)

**Estado:** Completa y verificada end-to-end en runtime.
**Metodología:** Specification-Driven Development (SDD) con Claude Code.
**Documentos fuente:** `RULES.md`, `spec_modulo_D.md`

---

# PARTE 1 — Referencia Técnica (estado actual)

## 1.1. Alcance funcional

**Actor:** Administrador
**Objetivo:** dar de alta un usuario del sistema asignándole rol inicial y configurando permisos granulares bajo el principio de menor privilegio.
**Endpoint:** `POST /api/auth/usuarios`

| Criterio de aceptación (Product Backlog) | Estado |
|---|---|
| Alta registra usuario, rol inicial y validación de unicidad de credenciales | ✅ Verificado — unicidad de `email`/`nombre_usuario` **permanente**, no solo contra activos (decisión de negocio explícita, ver Parte 2) |
| La contraseña nunca se almacena en texto plano: función de derivación de clave con sal | ✅ Verificado — Argon2id (`@node-rs/argon2`), formato PHC completo en `password_hash` |
| La asignación de rol genera evento auditado en el Log antes de confirmar la operación | ✅ Verificado — evento `usuario:creado` consumido por el único punto de escritura a `AuditLog` (`audit-log.listener.ts`) |
| El cambio de permisos se aplica de forma inmediata sobre la sesión activa sin requerir nueva autenticación | ⚠️ Cumplido con matiz: los permisos se resuelven contra base en cada request, sin caché — efecto inmediato en el siguiente request, no push activo a una sesión abierta en curso |
| Baja lógica: `is_active=false`, `deleted_at`, `deleted_by`, `deletion_reason`; historial de auditoría persiste | ✅ Verificado |

## 1.2. Modelo de datos relevante

- `Usuario` — `estado: EstadoUsuario`, `intentos_fallidos`, `bloqueado_hasta`, soft delete estándar de 4 campos.
- `UsuarioRol` — tabla pivote N:M entre `Usuario` y `Rol`, con su propio soft delete.
- `Rol`, `Permiso`, `RolPermiso` — RBAC granular necesario para que el alta pueda asignar un rol real.
- `AuditLog` — ledger append-only con cadena de hashes SHA-256, único punto de escritura vía `audit-log.listener.ts`.

## 1.3. Nota técnica — `password_salt`

Argon2id genera y embebe la sal aleatoria dentro del propio string PHC de `password_hash`. `password_salt` replica el mismo valor únicamente para satisfacer el `NOT NULL` del schema — no es una sal derivada independientemente ni se usa por separado en la verificación.

## 1.4. Auditoría — confirmación de exclusión de credenciales

Verificado explícitamente en runtime: el evento `usuario:creado` y la fila resultante en `AuditLog` (`valor_nuevo`) contienen `email`, `nombre_usuario`, `nombre_completo`, `estado` y `rol_ids` — en ningún caso `password`, `password_hash` ni `password_salt`.

## 1.5. Seguridad — hallazgo corregido

Durante la verificación se detectó un bypass de autenticación preexistente vía header `x-user-id` sin verificación alguna — cualquiera que conociera o adivinara el UUID de un usuario `ACTIVO` podía autenticarse como esa persona sin contraseña. Cerrado: el header ya no tiene ningún efecto en ningún entorno; reemplazado en desarrollo por un mock explícito (`x-debug-user-id`) gateado por `NODE_ENV !== "production"`.

---

# PARTE 2 — Historial de Desarrollo (proceso SDD)

## 2.1. Decisiones tomadas antes de implementar

- **Unicidad permanente de `email`/`nombre_usuario`:** decisión de negocio explícita, distinta del patrón general de otras entidades del proyecto — justificada por el valor de trazabilidad forense de no reasignar identidad de usuario (evitar ambigüedad si un email se reutiliza después de una baja).
- **Contraseñas nunca en texto plano en ningún log ni evento:** verificado de forma activa, no asumido — se confirmó en runtime que el payload del evento de auditoría excluye credenciales.

## 2.2. Corrección posterior — payload de auditoría incompleto

Durante una unificación posterior del patrón de escritura a `AuditLog` (todo evento de usuario debía pasar exclusivamente por el listener, sin llamadas directas desde los services), se detectó que el payload original de `usuario:creado` había perdido detalle forense (email, nombre, estado) al depender exclusivamente del evento en vez de una llamada directa con más contexto disponible. Se amplió el payload para recuperar ese detalle, confirmando en runtime que la exclusión de credenciales seguía intacta tras el cambio.

## 2.3. Hallazgo de seguridad detectado durante la verificación (preexistente, no introducido en esta tarea)

Bypass de autenticación vía header `x-user-id` sin verificación alguna, presente en el código antes de esta implementación. Cerrado como parte del proceso de verificación de HU-1.

---

## Anexo — Metodología de verificación aplicada

El hallazgo de seguridad más grave de esta HU (el bypass de `x-user-id`) no se detectó en la primera pasada de implementación, sino al insistir en pruebas de integración end-to-end en runtime, más allá del primer reporte de "funciona correctamente". Un componente marcado como "cerrado" lo está únicamente para lo que se probó explícitamente, no como garantía general.
