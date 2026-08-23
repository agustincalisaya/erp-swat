# HU-2 — Baja Lógica y Revocación de Accesos (Módulo D)

**Estado:** Completa y verificada end-to-end en runtime.
**Metodología:** Specification-Driven Development (SDD) con Claude Code.
**Documentos fuente:** `RULES.md`, `spec_modulo_D.md`

---

# PARTE 1 — Referencia Técnica (estado actual)

## 1.1. Alcance funcional

**Actor:** Administrador
**Objetivo:** dar de baja lógica un usuario ante egreso de la empresa con revocación inmediata de todas sus sesiones activas.
**Endpoint:** `PATCH /api/auth/usuarios/[id]/baja`

| Criterio de aceptación (Product Backlog) | Estado |
|---|---|
| La baja revoca toda sesión activa de forma instantánea | ✅ Verificado — requirió construir la infraestructura de sesión real (JWT + tabla `Sesion`) para poder cumplirse de verdad |
| Exige motivo obligatorio (ej. "egreso voluntario", "baja disciplinaria") | ✅ Verificado — `400 MOTIVO_REQUERIDO` si falta, antes de tocar la base |
| La cadena SHA-256 del log permanece intacta con todas las acciones ejecutadas por ese usuario mientras estuvo activo | ✅ Verificado, incluso con sabotaje controlado y reversión posterior |
| La baja lógica no elimina ni desvincula registros históricos: `is_active=false`, `deleted_at`, `deleted_by`, `deletion_reason` | ✅ Verificado — `UsuarioRol` y `AuditLog` del usuario permanecen intactos |
| Bloqueo automático tras N intentos fallidos → evento crítico en log + notificación a Admin | ⚠️ Parcial: bloqueo automático (`estado: SUSPENDIDO` tras 5 intentos consecutivos) y evento de auditoría implementados y verificados. La notificación activa a un Administrador **no está implementada** — el evento queda registrado en `AuditLog`, consultable, pero no hay push/email/alerta proactiva |

## 1.2. Modelo de datos relevante

- `Usuario` — `estado: EstadoUsuario` (`ACTIVO`/`SUSPENDIDO`/`BLOQUEADO`/`INACTIVO`), `intentos_fallidos`, `bloqueado_hasta`, soft delete estándar de 4 campos.
- `Sesion` — respaldo de JWT para permitir revocación instantánea (`jwt_id`, `revocada`, `revocada_en`, `revocada_motivo`, `expira_en`). Construida como parte del trabajo necesario para que esta HU pudiera cumplirse de verdad.
- `AuditLog` — ledger append-only con cadena de hashes SHA-256.

## 1.3. Mecanismo de revocación instantánea

Toda transición de `Usuario.estado` hacia `INACTIVO` invoca `revocarSesionesDeUsuario()`, marcando todas las filas `Sesion` activas del usuario como `revocada: true` — dentro de la misma transacción que el cambio de estado, nunca como efecto asíncrono posterior. `getServerSession()` verifica en cada request (sin caché) que la sesión no esté revocada, además de la firma y expiración del JWT.

## 1.4. Idempotencia

Un intento de dar de baja a un usuario ya `INACTIVO` es rechazado con `409 Conflict` — evita sobreescribir `deleted_at`/`deletion_reason` de una baja previa.

---

# PARTE 2 — Historial de Desarrollo (proceso SDD)

## 2.1. El problema que motivó construir infraestructura adicional

En el momento de implementar esta HU, el proyecto todavía no tenía ningún mecanismo real de sesión — por lo tanto, el criterio de aceptación "revocar toda sesión activa de forma instantánea" no podía verificarse de forma genuina: no había nada real que revocar.

Esto llevó a construir, como trabajo derivado necesario (no como alcance nuevo agregado por conveniencia), la autenticación real completa: JWT respaldado por tabla `Sesion`, con verificación en cada request sin caché. La decisión de arquitectura se tomó priorizando explícitamente mantener la garantía de revocación instantánea por sobre la ventaja de un JWT puramente *stateless* (que no requeriría consultar la base en cada request, pero tampoco permitiría revocar antes de la expiración natural del token).

## 2.2. Verificación de la prueba más importante de esta HU

Con la infraestructura de sesión ya construida, se verificó en runtime el caso decisivo: dar de baja a un usuario con una sesión activa, y confirmar que el JWT ya emitido —aunque no hubiera expirado naturalmente— dejaba de ser válido de inmediato (`401` en el request inmediato siguiente). Esto confirmó que la revocación es real y server-side, no un efecto cosmético dependiente de que el cliente borre su propia cookie.

## 2.3. Alcance no cerrado

El criterio de "notificación a Admin" tras el bloqueo automático por intentos fallidos nunca se implementó como mecanismo activo. El evento de auditoría correspondiente sí se genera y es consultable, pero no dispara ningún push, email, u otra alerta proactiva — queda documentado como deuda pendiente, no como cumplido.

## 2.4. Hallazgo de seguridad detectado durante la verificación (preexistente, no introducido en esta tarea)

Bypass de autenticación vía header `x-user-id` sin verificación alguna, presente en el código antes de esta implementación. Cerrado como parte del proceso de verificación del ciclo de vida de usuario (HU-1/HU-2).

---

## Anexo — Metodología de verificación aplicada

La verificación de esta HU no se limitó a confirmar el status code de la respuesta HTTP — se llevó el caso hasta su consecuencia real (intentar usar el JWT ya revocado) para confirmar que la garantía de negocio ("nadie puede seguir operando tras su baja") se cumplía de punta a punta, no solo que la base de datos quedara actualizada.
