import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────────
// HU-1 — Alta de Usuario y Roles
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Schema de entrada para el alta de un `Usuario`.
 *
 * `password` viaja en texto plano únicamente entre el cliente y el borde del
 * servidor (Server Action / Route Handler) — se deriva con Argon2id en
 * `lib/auth/password.ts` antes de tocar la capa de servicios y nunca se
 * persiste ni se loguea (RULES.md §2, spec_modulo_D.md §2.2.1).
 *
 * @see src/lib/services/auditoria/usuario.service.ts
 * @see spec_modulo_D.md §2.2
 */
export const CrearUsuarioSchema = z.object({
  nombre_usuario: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(12, "Mínimo 12 caracteres por política de seguridad institucional"),
  nombre_completo: z.string().min(2),
  rol_ids: z.array(z.string().uuid()).min(1, "Debe asignarse al menos un rol"),
});
export type CrearUsuarioInput = z.infer<typeof CrearUsuarioSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-2 — Baja Lógica y Revocación de Accesos
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Schema de entrada para la baja lógica de un `Usuario` (RULES.md §1).
 * `deletion_reason` es obligatorio: sin motivo no hay baja, ni siquiera a
 * nivel de validación server-side (segunda barrera detrás de la UI).
 *
 * @see spec_modulo_D.md §2.2.4
 */
export const BajaLogicaUsuarioSchema = z.object({
  usuario_id: z.string().uuid(),
  deletion_reason: z.string().min(1, "El motivo de baja es obligatorio para usuarios"),
});
export type BajaLogicaUsuarioInput = z.infer<typeof BajaLogicaUsuarioSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Endpoint 2.2.3 — Cambio de Estado Manual de Usuario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Schema de entrada para la transición manual de `Usuario.estado` entre
 * `ACTIVO`/`SUSPENDIDO`/`BLOQUEADO`. `INACTIVO` queda fuera de este enum
 * deliberadamente: esa transición solo ocurre vía baja lógica
 * (`BajaLogicaUsuarioSchema`, HU-2), nunca por esta vía.
 *
 * `motivo` es opcional (a diferencia de `deletion_reason` en la baja lógica,
 * que es obligatorio) — así lo define `spec_modulo_D.md` §2.2.3.
 *
 * @see spec_modulo_D.md §2.2.3
 * @see task_cali_estado_usuario.md §2
 */
export const CambiarEstadoUsuarioSchema = z.object({
  usuario_id: z.string().uuid(),
  nuevo_estado: z.enum(["ACTIVO", "SUSPENDIDO", "BLOQUEADO"]),
  motivo: z.string().optional(),
});
export type CambiarEstadoUsuarioInput = z.infer<typeof CambiarEstadoUsuarioSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// D.3 — Consola de Auditoría Forense
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Filtros de `GET /api/auditoria/logs`. `usuario_id` puede ser descartado
 * server-side por `listarAuditLog()` según la regla de segregación de
 * funciones (spec_modulo_D.md §4.3) — este schema solo valida forma, no
 * decide permisos.
 *
 * @see spec_modulo_D.md §4.3
 * @see task_cali_auditoria_forense.md §2
 */
export const FiltrosAuditoriaSchema = z
  .object({
    usuario_id: z.string().uuid().optional(),
    tabla_afectada: z.string().optional(),
    registro_id: z.string().optional(),
    fecha_desde: z.coerce.date().optional(),
    fecha_hasta: z.coerce.date().optional(),
    accion: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((data) => !data.fecha_desde || !data.fecha_hasta || data.fecha_desde <= data.fecha_hasta, {
    message: "fecha_desde no puede ser posterior a fecha_hasta",
    path: ["fecha_desde"],
  });
export type FiltrosAuditoriaInput = z.infer<typeof FiltrosAuditoriaSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Endpoints 2.2.5 / 2.2.6 — Gestión de Roles y Permisos
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Schema de entrada para el alta de un `Rol` con sus `Permiso` iniciales.
 * `permiso_ids` exige al menos 1 (principio de menor privilegio — un rol
 * sin permisos no tiene efecto, spec_modulo_D.md §2.2.5 / §3.4).
 */
export const CrearRolSchema = z.object({
  nombre: z.string().min(2),
  descripcion: z.string().optional(),
  permiso_ids: z
    .array(z.string().uuid())
    .min(1, "Un rol sin permisos no tiene efecto (principio de menor privilegio)"),
});
export type CrearRolInput = z.infer<typeof CrearRolSchema>;

/**
 * Schema de entrada para reemplazar el conjunto de `Permiso` de un `Rol`
 * existente (diff completo, spec_modulo_D.md §2.2.6).
 *
 * A diferencia de la definición original en `spec_modulo_D.md` §2.2 (que no
 * tenía `.min(1)`), acá se agrega deliberadamente: un rol no puede quedar
 * sin permisos por esta vía — si ya no debe existir, corresponde su baja
 * lógica (fuera de alcance de esta tarea), no vaciarlo de permisos y
 * dejarlo activo sin efecto (task_cali_roles_permisos.md §2).
 */
export const ActualizarPermisosRolSchema = z.object({
  rol_id: z.string().uuid(),
  permiso_ids: z
    .array(z.string().uuid())
    .min(1, "Un rol no puede quedar sin permisos — usar baja lógica del rol en su lugar si ya no debe existir"),
});
export type ActualizarPermisosRolInput = z.infer<typeof ActualizarPermisosRolSchema>;
