/**
 * @module rol.service
 * @description Orquestador de los Endpoints 2.2.5 (Alta de Rol) y 2.2.6
 * (Actualización de Permisos de un Rol) — Módulo D.2.
 *
 * Cumplimiento normativo:
 *  - RULES.md §1 — Soft Delete estricto en `RolPermiso`: nunca `DELETE` físico.
 *  - spec_modulo_D.md §3.2 — Transacciones atómicas para operaciones multi-tabla.
 *  - spec_modulo_D.md §4.1 — este archivo NUNCA invoca `registrarAuditLog()`
 *    de forma directa. Emite `rol:creado`/`rol:permisos_actualizados` al
 *    Event Bus; `audit-log.listener.ts` es la única vía de escritura a
 *    `AuditLog` (lección de la ronda de unificación de D.3 — no debe
 *    repetirse el patrón de llamada directa en ningún service nuevo).
 *
 * Nota de unicidad (`nombre`): igual que `Usuario.email`/`nombre_usuario`,
 * `Rol.nombre` es `@unique` GLOBAL en el schema (constraint plano de
 * Postgres, no filtrado por `is_active`). Se valida contra TODAS las filas,
 * no solo activas, mismo motivo ya documentado en `usuario.service.ts`.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma, ejecutarConReintentoDeConflicto } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import {
  PERMISO_ROLES_ADMINISTRAR,
  contarAdministradoresFuncionales,
} from "@/lib/auth/with-permission";
import type {
  CrearRolInput,
  ActualizarPermisosRolInput,
} from "@/lib/schemas/auditoria.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface RolCreado {
  rol_id: string;
  nombre: string;
  permisos_asignados: number;
}

export interface RolPermisosActualizados {
  rol_id: string;
  permisos_actuales: number;
  permisos_agregados: number;
  permisos_removidos: number;
}

export interface PermisoListado {
  id: string;
  codigo: string;
  descripcion: string | null;
  modulo: string;
}

export interface RolListado {
  id: string;
  nombre: string;
  descripcion: string | null;
  permisos_count: number;
  permisos?: PermisoListado[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Endpoint 2.2.5 — crearRol
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Da de alta un `Rol` y le asigna sus `Permiso` iniciales.
 *
 * Secuencia:
 *  1. Valida unicidad de `nombre` contra TODAS las filas (ver nota de módulo).
 *  2. Valida que `permiso_ids` no esté vacío y que todos correspondan a
 *     `Permiso` activos existentes (principio de menor privilegio, spec §3.4
 *     — reforzado acá además del `.min(1)` de Zod, para cubrir invocaciones
 *     que no pasen por el Route Handler).
 *  3. Dentro de `prisma.$transaction`: crea `Rol` + N filas `RolPermiso`.
 *  4. Fuera de la transacción: emite `rol:creado` — única vía de escritura
 *     a `AuditLog`, vía `audit-log.listener.ts`.
 *
 * @param input - Datos validados por `CrearRolSchema`.
 * @param usuarioEjecutorId - ID del Administrador autenticado que ejecuta el alta.
 * @param ip - IP del cliente, para el AuditLog.
 * @throws {ServiceError} ROL_DUPLICADO | PERMISOS_INVALIDOS
 */
export async function crearRol(
  input: CrearRolInput,
  usuarioEjecutorId: string,
  ip: string,
): Promise<RolCreado> {
  // 1. Unicidad — contra TODAS las filas (ver nota de módulo)
  const duplicado = await prisma.rol.findFirst({
    where: { nombre: input.nombre },
    select: { id: true },
  });

  if (duplicado) {
    throw new ServiceError("ROL_DUPLICADO", "Ya existe un rol con ese nombre");
  }

  // 2. Permisos: al menos uno, todos deben existir y estar activos
  if (input.permiso_ids.length === 0) {
    throw new ServiceError(
      "PERMISOS_INVALIDOS",
      "Un rol sin permisos no tiene efecto (principio de menor privilegio)",
    );
  }

  const permisoIds = [...new Set(input.permiso_ids)];
  const permisosActivos = await prisma.permiso.findMany({
    where: { id: { in: permisoIds }, is_active: true, deleted_at: null },
    select: { id: true },
  });

  if (permisosActivos.length !== permisoIds.length) {
    throw new ServiceError(
      "PERMISOS_INVALIDOS",
      "Uno o más permisos indicados no existen o no están activos",
    );
  }

  // 3. Transacción atómica: Rol + N RolPermiso
  const rol = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const nuevoRol = await tx.rol.create({
      data: {
        nombre: input.nombre,
        descripcion: input.descripcion ?? null,
      },
    });

    await tx.rolPermiso.createMany({
      data: permisoIds.map((permiso_id) => ({
        rol_id: nuevoRol.id,
        permiso_id,
      })),
    });

    return nuevoRol;
  });

  // 4. Emisión de evento de dominio (FUERA de la transacción). Payload con
  // detalle completo (nombre/descripción, no solo IDs — mismo estándar
  // fijado para `usuario:creado`).
  domainEventBus.emit("rol:creado", {
    rol_id: rol.id,
    nombre: rol.nombre,
    descripcion: rol.descripcion,
    permiso_ids_asignados: permisoIds,
    creado_por: usuarioEjecutorId,
    ip,
  });

  return {
    rol_id: rol.id,
    nombre: rol.nombre,
    permisos_asignados: permisoIds.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Endpoint 2.2.6 — actualizarPermisosRol
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reemplaza el conjunto de `Permiso` activos de un `Rol` (diff completo):
 * soft-delete de los removidos, alta (o reactivación) de los agregados.
 * Nunca `DELETE` físico — mismo patrón ya fijado para `UsuarioRol`.
 *
 * Regla central — protección contra que el sistema quede sin ningún
 * administrador FUNCIONAL (task_cali_roles_permisos.md §4.3, generalizada
 * en runtime, y corregida en una ronda posterior — Caminos B y C):
 * si esta actualización remueve el permiso `roles:administrar` del rol en
 * edición, se cuenta cuántas asignaciones `UsuarioRol` activas —a
 * cualquier usuario OPERATIVO (`estado: ACTIVO`), a través de cualquier
 * OTRO rol activo— también otorgan `roles:administrar`, excluyendo las que
 * dependen del rol que se está editando (`contarAdministradoresFuncionales()`,
 * `lib/auth/with-permission.ts` — único punto de verdad, compartido con
 * `desactivarUsuario()`/`cambiarEstadoUsuario()`). Si ese conteo da 0, se
 * rechaza: la pregunta que protege esta guarda es "¿queda alguien
 * FUNCIONAL en el sistema con este permiso después del cambio?", no "¿el
 * ejecutante en particular lo pierde?" ni "¿alguien más TIENE la fila,
 * aunque no pueda usarla?".
 *
 * Diff + guarda + escritura ocurren TODOS dentro de la MISMA transacción,
 * con aislamiento `Serializable` (Camino B — condición de carrera): sin
 * esto, dos requests concurrentes removiendo `roles:administrar` desde dos
 * roles distintos podrían cada uno leer "el otro todavía existe" antes de
 * que cualquiera confirme su escritura, y ambos permitirse — dejando al
 * sistema en cero pese a que la guarda, evaluada en serie, habría
 * bloqueado al segundo. Bajo `Serializable`, Postgres detecta ese
 * solapamiento de lectura/escritura entre las dos transacciones y aborta
 * una con conflicto de serialización (`P2034`); `ejecutarConReintentoDeConflicto`
 * la reintenta, y en el reintento ya lee el estado real actualizado.
 *
 * @param input - Datos validados por `ActualizarPermisosRolSchema`.
 * @param usuarioEjecutorId - ID del Administrador autenticado que ejecuta el cambio.
 * @param ip - IP del cliente, para el AuditLog.
 * @throws {ServiceError} ROL_NO_ENCONTRADO | PERMISOS_INVALIDOS | SISTEMA_SIN_ADMINISTRADOR
 */
export async function actualizarPermisosRol(
  input: ActualizarPermisosRolInput,
  usuarioEjecutorId: string,
  ip: string,
): Promise<RolPermisosActualizados> {
  // 1. Existencia
  const rolExistente = await prisma.rol.findFirst({
    where: { id: input.rol_id, is_active: true },
    select: { id: true },
  });

  if (!rolExistente) {
    throw new ServiceError("ROL_NO_ENCONTRADO", "El rol indicado no existe o se encuentra dado de baja");
  }

  // 2. Permisos nuevos: todos deben existir y estar activos
  const permisoIdsNuevos = [...new Set(input.permiso_ids)];
  const permisosActivos = await prisma.permiso.findMany({
    where: { id: { in: permisoIdsNuevos }, is_active: true, deleted_at: null },
    select: { id: true },
  });

  if (permisosActivos.length !== permisoIdsNuevos.length) {
    throw new ServiceError(
      "PERMISOS_INVALIDOS",
      "Uno o más permisos indicados no existen o no están activos",
    );
  }

  // 3-5. Diff + guarda de sistema-sin-administrador + escritura: TODO dentro
  // de una única transacción Serializable (ver docstring de la función).
  const { agregados, removidos } = await ejecutarConReintentoDeConflicto(() =>
    prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 3. Diff contra el conjunto activo actual
        const filasActuales = await tx.rolPermiso.findMany({
          where: { rol_id: input.rol_id, is_active: true },
          select: { permiso_id: true },
        });
        const permisoIdsActuales = filasActuales.map((fila) => fila.permiso_id);
        const actualesSet = new Set(permisoIdsActuales);
        const nuevosSet = new Set(permisoIdsNuevos);

        const agregados = permisoIdsNuevos.filter((id) => !actualesSet.has(id));
        const removidos = permisoIdsActuales.filter((id) => !nuevosSet.has(id));

        // 4. Guarda contra sistema sin administrador FUNCIONAL
        const permisoRolesAdministrar = await tx.permiso.findFirst({
          where: { codigo: PERMISO_ROLES_ADMINISTRAR, is_active: true },
          select: { id: true },
        });

        const seRemueveRolesAdministrar =
          !!permisoRolesAdministrar && removidos.includes(permisoRolesAdministrar.id);

        if (seRemueveRolesAdministrar) {
          const otrosAdministradoresFuncionales = await contarAdministradoresFuncionales(
            PERMISO_ROLES_ADMINISTRAR,
            { excluirRolId: input.rol_id },
            tx,
          );

          if (otrosAdministradoresFuncionales === 0) {
            throw new ServiceError(
              "SISTEMA_SIN_ADMINISTRADOR",
              "Esta acción dejaría al sistema sin ningún administrador funcional con el permiso roles:administrar — rechazada para evitar un bloqueo administrativo total",
            );
          }
        }

        // 5. Escritura: soft-delete de removidos + alta/reactivación de agregados
        if (removidos.length > 0) {
          await tx.rolPermiso.updateMany({
            where: { rol_id: input.rol_id, permiso_id: { in: removidos }, is_active: true },
            data: { is_active: false, deleted_at: new Date(), deleted_by: usuarioEjecutorId },
          });
        }

        for (const permisoId of agregados) {
          // `@@unique([rol_id, permiso_id])` es global (no filtrado por
          // is_active) — si ya existía una fila soft-deleteada para este par
          // (un permiso removido y vuelto a agregar), se reactiva en vez de
          // intentar un `create` que chocaría con el constraint.
          const filaExistente = await tx.rolPermiso.findUnique({
            where: { rol_id_permiso_id: { rol_id: input.rol_id, permiso_id: permisoId } },
          });

          if (filaExistente) {
            await tx.rolPermiso.update({
              where: { id: filaExistente.id },
              data: { is_active: true, deleted_at: null, deleted_by: null, deletion_reason: null },
            });
          } else {
            await tx.rolPermiso.create({
              data: { rol_id: input.rol_id, permiso_id: permisoId },
            });
          }
        }

        return { agregados, removidos };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  // 6. Emisión de evento de dominio (FUERA de la transacción)
  domainEventBus.emit("rol:permisos_actualizados", {
    rol_id: input.rol_id,
    actualizado_por: usuarioEjecutorId,
    permisos_agregados: agregados,
    permisos_removidos: removidos,
    ip,
  });

  return {
    rol_id: input.rol_id,
    permisos_actuales: permisoIdsNuevos.length,
    permisos_agregados: agregados.length,
    permisos_removidos: removidos.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Endpoint 3.3 — listarRoles / listarPermisos (soporte de UI, solo lectura)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista los `Rol` activos. `incluirPermisos` agrega el detalle completo de
 * cada `Permiso` asignado — por defecto solo se informa el conteo, para no
 * sobrecargar la respuesta del listado general.
 */
export async function listarRoles(incluirPermisos = false): Promise<RolListado[]> {
  const roles = await prisma.rol.findMany({
    where: { is_active: true },
    include: {
      permisos: {
        where: { is_active: true },
        include: { permiso: true },
      },
    },
    orderBy: { nombre: "asc" },
  });

  return roles.map((rol) => ({
    id: rol.id,
    nombre: rol.nombre,
    descripcion: rol.descripcion,
    permisos_count: rol.permisos.length,
    ...(incluirPermisos
      ? {
          permisos: rol.permisos.map((rolPermiso) => ({
            id: rolPermiso.permiso.id,
            codigo: rolPermiso.permiso.codigo,
            descripcion: rolPermiso.permiso.descripcion,
            modulo: rolPermiso.permiso.modulo,
          })),
        }
      : {}),
  }));
}

/** Lista los `Permiso` activos disponibles (selector de alta/edición de Rol). */
export async function listarPermisos(): Promise<PermisoListado[]> {
  return prisma.permiso.findMany({
    where: { is_active: true, deleted_at: null },
    select: { id: true, codigo: true, descripcion: true, modulo: true },
    orderBy: { codigo: "asc" },
  });
}
