/**
 * @module usuario.service
 * @description Orquestador de HU-1 (Alta de Usuario y Roles), HU-2 (Baja
 * Lógica y Revocación de Accesos) y del Endpoint 2.2.3 (Cambio de Estado
 * Manual) — Módulo D.2.
 *
 * Cumplimiento normativo:
 *  - RULES.md §1 — Soft Delete estricto: `desactivarUsuario` nunca ejecuta
 *    `DELETE`; solo actualiza `is_active`/`deleted_at`/`deleted_by`/`deletion_reason`.
 *  - RULES.md §2 — Contraseña nunca en texto plano (Argon2id vía `lib/auth/password.ts`)
 *    y AuditLog obligatorio en cada alta/baja.
 *  - spec_modulo_D.md §3.2 — Transacciones atómicas para operaciones multi-tabla.
 *
 * Nota de unicidad (email / nombre_usuario): `schema.prisma` define estas
 * columnas con `@unique` GLOBAL (constraint plano de Postgres, no filtrado
 * por `is_active`). Por lo tanto, a diferencia de lo que sugiere una lectura
 * literal de spec_modulo_D.md §2.2.1 ("unicidad contra is_active = true"),
 * un email/nombre_usuario de un usuario dado de baja NO puede reutilizarse:
 * el constraint de base lo impediría igual con un error no controlado. Se
 * valida unicidad contra TODAS las filas (activas o no), consistente con el
 * comportamiento real del schema cerrado.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma, ejecutarConReintentoDeConflicto } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { revocarSesionesDeUsuario } from "@/lib/services/auditoria/sesion.service";
import { ServiceError } from "@/lib/errors/service-error";
import {
  PERMISO_ROLES_ADMINISTRAR,
  esAdministradorFuncional,
  contarAdministradoresFuncionales,
} from "@/lib/auth/with-permission";
import type {
  CrearUsuarioInput,
  BajaLogicaUsuarioInput,
  CambiarEstadoUsuarioInput,
} from "@/lib/schemas/auditoria.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface UsuarioCreado {
  usuario_id: string;
  estado: string;
  roles_asignados: string[];
}

export interface UsuarioDadoDeBaja {
  id: string;
  estado: string;
  deleted_at: Date;
}

export interface UsuarioEstadoCambiado {
  id: string;
  estado_anterior: string;
  estado_nuevo: string;
}

export interface UsuarioListado {
  id: string;
  nombre_usuario: string;
  email: string;
  nombre_completo: string;
  estado: string;
  is_active: boolean;
  created_at: Date;
  roles: string[];
}

export interface RolActivo {
  id: string;
  nombre: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-1 — crearUsuario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Da de alta un `Usuario` y le asigna sus roles iniciales.
 *
 * Secuencia:
 *  1. Valida unicidad de `email`/`nombre_usuario` contra TODAS las filas
 *     (ver nota de módulo — el constraint de Postgres es global).
 *  2. Valida que todos los `rol_ids` correspondan a `Rol` activos existentes
 *     (principio de menor privilegio: nunca se asignan roles inexistentes).
 *  3. Deriva `password_hash`/`password_salt` con Argon2id ANTES de la
 *     transacción (operación CPU/async independiente de la base — spec §5.2).
 *  4. Dentro de `prisma.$transaction`: crea `Usuario` + N filas `UsuarioRol`.
 *  5. Fuera de la transacción: emite `usuario:creado` al Event Bus — única
 *     vía de escritura a `AuditLog` (spec_modulo_D.md §4.1: `audit-log.listener.ts`
 *     consumiendo el evento, nunca una llamada directa a `registrarAuditLog()`
 *     desde este service — unificado en task_cali_auditoria_forense.md, ronda
 *     de corrección post-D.3).
 *
 * @param input - Datos validados por `CrearUsuarioSchema`.
 * @param usuarioEjecutorId - ID del Administrador autenticado que ejecuta el alta.
 * @param ip - IP del cliente, para el AuditLog.
 * @throws {ServiceError} USUARIO_DUPLICADO | ROLES_INVALIDOS
 */
export async function crearUsuario(
  input: CrearUsuarioInput,
  usuarioEjecutorId: string,
  ip: string,
): Promise<UsuarioCreado> {
  // 1. Unicidad — contra TODAS las filas (ver nota de módulo)
  const duplicado = await prisma.usuario.findFirst({
    where: { OR: [{ nombre_usuario: input.nombre_usuario }, { email: input.email }] },
    select: { id: true },
  });

  if (duplicado) {
    throw new ServiceError(
      "USUARIO_DUPLICADO",
      "El correo o nombre de usuario ya está registrado",
    );
  }

  // 2. Roles: deben existir y estar activos (menor privilegio — nunca hardcodeados)
  const rolesActivos = await prisma.rol.findMany({
    where: { id: { in: input.rol_ids }, is_active: true, deleted_at: null },
    select: { id: true },
  });

  if (rolesActivos.length !== new Set(input.rol_ids).size) {
    throw new ServiceError(
      "ROLES_INVALIDOS",
      "Uno o más roles indicados no existen o no están activos",
    );
  }

  // 3. Derivación de contraseña — fuera de la ventana transaccional
  const { hash, salt } = await hashPassword(input.password);

  // 4. Transacción atómica: Usuario + N UsuarioRol
  const usuario = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const nuevoUsuario = await tx.usuario.create({
      data: {
        nombre_usuario: input.nombre_usuario,
        email: input.email,
        password_hash: hash,
        password_salt: salt,
        nombre_completo: input.nombre_completo,
        estado: "ACTIVO",
      },
    });

    await tx.usuarioRol.createMany({
      data: input.rol_ids.map((rol_id) => ({
        usuario_id: nuevoUsuario.id,
        rol_id,
      })),
    });

    return nuevoUsuario;
  });

  // 5. Emisión de evento de dominio (FUERA de la transacción). Payload
  // ampliado a partir del `usuario` recién creado dentro de la transacción
  // — NUNCA incluye `password`/`password_hash`/`password_salt`
  // (RULES.md §2, spec_modulo_D.md §5.1).
  domainEventBus.emit("usuario:creado", {
    usuario_id: usuario.id,
    nombre_usuario: usuario.nombre_usuario,
    email: usuario.email,
    nombre_completo: usuario.nombre_completo,
    estado: usuario.estado,
    creado_por: usuarioEjecutorId,
    rol_ids_asignados: input.rol_ids,
    ip,
  });

  return {
    usuario_id: usuario.id,
    estado: usuario.estado,
    roles_asignados: input.rol_ids,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-2 — desactivarUsuario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Da de baja lógica a un `Usuario` (RULES.md §1 — nunca `DELETE` físico).
 *
 * Secuencia:
 *  1. Verifica que el usuario exista.
 *  2. Verifica que no esté ya inactivo (idempotencia — spec §5.4: preserva
 *     el `deleted_at`/`deletion_reason` del primer registro de baja).
 *  3. Dentro de `prisma.$transaction` (Serializable): si el usuario objetivo
 *     es HOY un administrador funcional (`roles:administrar`, estado
 *     ACTIVO), verifica que quede al menos otro administrador funcional en
 *     el sistema excluyéndolo a él — si no, rechaza (Camino A,
 *     task_cali_roles_permisos.md, ronda de corrección posterior al cierre
 *     de la tarea de Roles/Permisos: hasta esta corrección, CUALQUIER
 *     usuario autenticado —sin ningún permiso— podía dar de baja al único
 *     Administrador del sistema, dejándolo sin forma de auto-recuperarse).
 *     Luego actualiza `estado`, `is_active`, `deleted_at`, `deleted_by`,
 *     `deletion_reason`; revoca todas las `Sesion` activas del usuario
 *     (`revocarSesionesDeUsuario`, HU-3 — task_cali_hu3_login.md §4.3: JWT +
 *     tabla `Sesion`, la baja lógica de `Usuario` por sí sola NO invalida
 *     un JWT ya emitido, hace falta marcar `Sesion.revocada`
 *     explícitamente). No toca `UsuarioRol` ni `AuditLog` — el rastro
 *     histórico del usuario se preserva intacto.
 *  4. Fuera de la transacción: emite `usuario:baja_logica` — única vía de
 *     escritura a `AuditLog` (spec_modulo_D.md §4.1, unificado en
 *     task_cali_auditoria_forense.md), consumido por `audit-log.listener.ts`.
 *
 * La revocación de `Sesion` y la guarda de administrador funcional ocurren
 * DENTRO de la misma transacción que la baja del usuario (no como pasos
 * separados ni como efecto asíncrono de evento) para que todo se confirme
 * o revierta junto — a diferencia del AuditLog, que sí se mueve fuera (ver
 * punto 4). Aislamiento `Serializable` + reintento ante conflicto (Camino
 * B, mismo mecanismo que `actualizarPermisosRol()` — ver docstring de
 * `ejecutarConReintentoDeConflicto` en `lib/db/prisma.ts`): protege contra
 * que dos bajas/suspensiones concurrentes sobre DOS administradores
 * funcionales distintos dejen al sistema en cero sin que ninguna de las
 * dos, evaluada aisladamente, lo haya detectado.
 *
 * @param input - Datos validados por `BajaLogicaUsuarioSchema`.
 * @param usuarioEjecutorId - ID del Administrador autenticado que ejecuta la baja.
 * @param ip - IP del cliente, para el AuditLog.
 * @throws {ServiceError} USUARIO_NO_ENCONTRADO | USUARIO_YA_INACTIVO | SISTEMA_SIN_ADMINISTRADOR
 */
export async function desactivarUsuario(
  input: BajaLogicaUsuarioInput,
  usuarioEjecutorId: string,
  ip: string,
): Promise<UsuarioDadoDeBaja> {
  // 1. Existencia
  const usuarioExistente = await prisma.usuario.findUnique({
    where: { id: input.usuario_id },
    select: { id: true, is_active: true, estado: true },
  });

  if (!usuarioExistente) {
    throw new ServiceError("USUARIO_NO_ENCONTRADO", "El usuario indicado no existe");
  }

  // 2. Idempotencia — no se puede dar de baja dos veces
  if (!usuarioExistente.is_active) {
    throw new ServiceError("USUARIO_YA_INACTIVO", "El usuario ya se encuentra dado de baja");
  }

  // 3. Transacción atómica (Serializable): guarda de administrador
  // funcional + baja lógica + revocación de Sesion
  const usuario = await ejecutarConReintentoDeConflicto(() =>
    prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Solo aplica si el objetivo está HOY genuinamente ACTIVO — si ya
        // estaba SUSPENDIDO/BLOQUEADO no contaba como administrador
        // funcional de todos modos (mismo criterio de
        // `contarAdministradoresFuncionales`), así que darlo de baja no
        // remueve ninguna capacidad administrativa que no estuviera ya
        // fuera de servicio.
        if (usuarioExistente.estado === "ACTIVO") {
          const objetivoEsAdministrador = await esAdministradorFuncional(
            input.usuario_id,
            PERMISO_ROLES_ADMINISTRAR,
            tx,
          );

          if (objetivoEsAdministrador) {
            const otrosAdministradoresFuncionales = await contarAdministradoresFuncionales(
              PERMISO_ROLES_ADMINISTRAR,
              { excluirUsuarioId: input.usuario_id },
              tx,
            );

            if (otrosAdministradoresFuncionales === 0) {
              throw new ServiceError(
                "SISTEMA_SIN_ADMINISTRADOR",
                "Esta baja dejaría al sistema sin ningún administrador funcional con el permiso roles:administrar — rechazada para evitar un bloqueo administrativo total",
              );
            }
          }
        }

        const usuarioActualizado = await tx.usuario.update({
          where: { id: input.usuario_id },
          data: {
            estado: "INACTIVO",
            is_active: false,
            deleted_at: new Date(),
            deleted_by: usuarioEjecutorId,
            deletion_reason: input.deletion_reason,
          },
        });

        // HU-3 (task_cali_hu3_login.md §4.3) — revoca TODAS las Sesion activas
        // del usuario dentro de la MISMA transacción: la baja lógica y la
        // invalidación del JWT deben confirmarse o revertirse juntas.
        await revocarSesionesDeUsuario(usuarioActualizado.id, "baja_logica_usuario", tx);

        return usuarioActualizado;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  // 4. Emisión de evento de dominio (FUERA de la transacción)
  domainEventBus.emit("usuario:baja_logica", {
    usuario_id: usuario.id,
    dado_de_baja_por: usuarioEjecutorId,
    deletion_reason: input.deletion_reason,
    ip,
  });

  return {
    id: usuario.id,
    estado: usuario.estado,
    deleted_at: usuario.deleted_at!,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Endpoint 2.2.3 — cambiarEstadoUsuario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Transición manual de `Usuario.estado` entre `ACTIVO`/`SUSPENDIDO`/`BLOQUEADO`.
 * `INACTIVO` no es alcanzable por esta vía (solo por `desactivarUsuario`, HU-2).
 *
 * Secuencia:
 *  1. Verifica que el usuario exista y esté `is_active = true` (un usuario
 *     dado de baja lógica no cambia de estado por acá).
 *  2. Idempotencia — si `estado_actual === nuevo_estado`, responde sin
 *     efecto: no toca `Sesion`, no emite evento, no escribe `AuditLog`.
 *  3. Dentro de `prisma.$transaction` (Serializable):
 *     - Guarda de administrador funcional (Camino A, task_cali_roles_permisos.md,
 *       ronda de corrección post-cierre de Roles/Permisos): si la transición
 *       es HACIA `SUSPENDIDO`/`BLOQUEADO` (las que revocan sesión —
 *       `ACTIVO` nunca aplica) Y el usuario objetivo está HOY genuinamente
 *       `ACTIVO` y es administrador funcional (`roles:administrar`),
 *       verifica que quede al menos otro administrador funcional
 *       excluyéndolo — mismo criterio que `desactivarUsuario()`
 *       (`contarAdministradoresFuncionales()`, único punto de verdad en
 *       `lib/auth/with-permission.ts`). Antes de esta corrección, cualquier
 *       usuario autenticado —sin ningún permiso— podía suspender/bloquear
 *       al único Administrador del sistema.
 *     - Actualiza `Usuario.estado`.
 *     - Reactivación (`SUSPENDIDO → ACTIVO`): también resetea
 *       `intentos_fallidos = 0` y `bloqueado_hasta = null`.
 *     - Revocación de `Sesion` (task_cali_estado_usuario.md §1 — regla
 *       central de esa tarea): cualquier transición HACIA `SUSPENDIDO` o
 *       `BLOQUEADO` invoca `revocarSesionesDeUsuario()` en la MISMA
 *       transacción — un bloqueo/suspensión manual invalida de inmediato
 *       cualquier sesión activa, igual que la baja lógica de HU-2.
 *       Cualquier transición HACIA `ACTIVO` NO toca `Sesion` en absoluto:
 *       un usuario reactivado no tiene sesiones previas que revivir (ya
 *       fueron revocadas, si correspondía, al momento de la suspensión/
 *       bloqueo).
 *  4. Fuera de la transacción: emite `usuario:estado_cambiado` — única vía
 *     de escritura a `AuditLog` (spec_modulo_D.md §4.1, unificado en
 *     task_cali_auditoria_forense.md), consumido por `audit-log.listener.ts`.
 *
 * Aislamiento `Serializable` + reintento ante conflicto (Camino B — mismo
 * mecanismo que `actualizarPermisosRol()`/`desactivarUsuario()`, ver
 * `ejecutarConReintentoDeConflicto` en `lib/db/prisma.ts`).
 *
 * @param input - Datos validados por `CambiarEstadoUsuarioSchema`.
 * @param usuarioEjecutorId - ID del Administrador autenticado que ejecuta el cambio.
 * @param ip - IP del cliente, para el AuditLog.
 * @throws {ServiceError} USUARIO_NO_ENCONTRADO | SISTEMA_SIN_ADMINISTRADOR
 */
export async function cambiarEstadoUsuario(
  input: CambiarEstadoUsuarioInput,
  usuarioEjecutorId: string,
  ip: string,
): Promise<UsuarioEstadoCambiado> {
  // 1. Existencia + is_active
  const usuarioExistente = await prisma.usuario.findFirst({
    where: { id: input.usuario_id, is_active: true },
    select: { id: true, estado: true },
  });

  if (!usuarioExistente) {
    throw new ServiceError(
      "USUARIO_NO_ENCONTRADO",
      "El usuario indicado no existe o se encuentra dado de baja",
    );
  }

  const estadoAnterior = usuarioExistente.estado;

  // 2. Idempotencia — sin efecto: sin Sesion, sin evento, sin AuditLog
  if (estadoAnterior === input.nuevo_estado) {
    return {
      id: usuarioExistente.id,
      estado_anterior: estadoAnterior,
      estado_nuevo: input.nuevo_estado,
    };
  }

  const suspendeOBloquea = input.nuevo_estado === "SUSPENDIDO" || input.nuevo_estado === "BLOQUEADO";

  // 3. Transacción atómica (Serializable): guarda de administrador
  // funcional + cambio de estado + revocación condicional de Sesion
  const usuario = await ejecutarConReintentoDeConflicto(() =>
    prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Solo aplica en transiciones que apagan el acceso (hacia
        // SUSPENDIDO/BLOQUEADO) y solo si el objetivo está HOY
        // genuinamente ACTIVO — mismo razonamiento que `desactivarUsuario()`.
        if (suspendeOBloquea && estadoAnterior === "ACTIVO") {
          const objetivoEsAdministrador = await esAdministradorFuncional(
            input.usuario_id,
            PERMISO_ROLES_ADMINISTRAR,
            tx,
          );

          if (objetivoEsAdministrador) {
            const otrosAdministradoresFuncionales = await contarAdministradoresFuncionales(
              PERMISO_ROLES_ADMINISTRAR,
              { excluirUsuarioId: input.usuario_id },
              tx,
            );

            if (otrosAdministradoresFuncionales === 0) {
              throw new ServiceError(
                "SISTEMA_SIN_ADMINISTRADOR",
                "Esta acción dejaría al sistema sin ningún administrador funcional con el permiso roles:administrar — rechazada para evitar un bloqueo administrativo total",
              );
            }
          }
        }

        const data: Prisma.UsuarioUpdateInput = { estado: input.nuevo_estado };

        if (input.nuevo_estado === "ACTIVO" && estadoAnterior === "SUSPENDIDO") {
          data.intentos_fallidos = 0;
          data.bloqueado_hasta = null;
        }

        const usuarioActualizado = await tx.usuario.update({
          where: { id: input.usuario_id },
          data,
        });

        // task_cali_estado_usuario.md §1 — regla central: toda transición
        // HACIA SUSPENDIDO o BLOQUEADO revoca sesiones activas dentro de la
        // MISMA transacción. Hacia ACTIVO no se toca Sesion en absoluto.
        if (suspendeOBloquea) {
          await revocarSesionesDeUsuario(usuarioActualizado.id, "cambio_estado_manual", tx);
        }

        return usuarioActualizado;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  // 4. Emisión de evento de dominio (FUERA de la transacción)
  domainEventBus.emit("usuario:estado_cambiado", {
    usuario_id: usuario.id,
    estado_anterior: estadoAnterior,
    estado_nuevo: usuario.estado,
    cambiado_por: usuarioEjecutorId,
    motivo: input.motivo ?? null,
    ip,
  });

  return {
    id: usuario.id,
    estado_anterior: estadoAnterior,
    estado_nuevo: usuario.estado,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Consulta: listarUsuarios
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista usuarios, filtrando por defecto los inactivos (RULES.md §1 / spec §5.5).
 *
 * @param incluirInactivos - Reservado para el módulo de Auditoría. `false` por defecto.
 */
export async function listarUsuarios(incluirInactivos = false): Promise<UsuarioListado[]> {
  const usuarios = await prisma.usuario.findMany({
    where: incluirInactivos ? {} : { is_active: true },
    include: {
      roles: {
        where: { is_active: true },
        include: { rol: { select: { nombre: true } } },
      },
    },
    orderBy: { created_at: "desc" },
  });

  return usuarios.map((usuario) => ({
    id: usuario.id,
    nombre_usuario: usuario.nombre_usuario,
    email: usuario.email,
    nombre_completo: usuario.nombre_completo,
    estado: usuario.estado,
    is_active: usuario.is_active,
    created_at: usuario.created_at,
    roles: usuario.roles.map((usuarioRol) => usuarioRol.rol.nombre),
  }));
}

/**
 * Lista los `Rol` activos disponibles para asignar en el alta de un `Usuario`
 * (selector de `FormularioAltaUsuario`). Lectura mínima de soporte — el CRUD
 * completo de `Rol` (alta/edición de permisos) es 2.2.5/2.2.6 de
 * spec_modulo_D.md, fuera del alcance de HU-1/HU-2.
 */
export async function listarRolesActivos(): Promise<RolActivo[]> {
  const roles = await prisma.rol.findMany({
    where: { is_active: true, deleted_at: null },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });

  return roles;
}
