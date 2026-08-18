/**
 * HU-7 — Sección 7: payloads de los eventos de dominio emitidos por
 * `lib/services/inventario/stock.service.ts`. El Módulo D (audit-log.listener.ts)
 * consume estos eventos para construir el `AuditLog` encadenado por SHA-256.
 */

export interface UmbralesConfiguradosPayload {
  stock_deposito_id: string;
  variante_sku_id: string;
  deposito_id: string;
  usuario_id: string;
  punto_pedido: number;
  stock_seguridad: number;
}

export interface UmbralCriticoAlcanzadoPayload {
  stock_deposito_id: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad_resultante: number;
  punto_pedido: number;
  movimiento_id_origen: string;
}

/**
 * HU-A3 — Payload emitido tras la creación atómica del LegajoPrueba.
 * Escucha: futuro audit-log.listener.ts y módulo de notificaciones.
 *
 * Nota: `efectivo_placa` y `efectivo_organismo` NO se incluyen en el payload
 * del evento para evitar que datos cifrados circulen por el bus en memoria.
 * Los listeners que necesiten los datos identificatorios deben leerlos de la
 * BD y descifrarlos bajo demanda.
 */
export interface LegajoPruebaIniciadoPayload {
  legajo_prueba_id: string;
  variante_sku_id: string;
  deposito_origen_id: string;
  movimiento_stock_id: string;
  cantidad: number;
  usuario_id: string;
  ip: string;
}

/**
 * HU-1 (Módulo D) — Payload emitido tras el alta atómica de `Usuario` + `UsuarioRol`.
 * No incluye `password`/`password_hash`/`password_salt` bajo NINGUNA
 * circunstancia (RULES.md §2, spec_modulo_D.md §5.1) — esta prohibición
 * sigue vigente aunque el payload se haya ampliado (ronda de corrección
 * posterior a la unificación del punto de escritura de `AuditLog`, para
 * que `audit-log.listener.ts` pueda reconstruir el detalle forense
 * completo que antes venía de la llamada directa a `registrarAuditLog()`
 * dentro de la transacción de `crearUsuario()`).
 */
export interface UsuarioCreadoPayload {
  usuario_id: string;
  nombre_usuario: string;
  email: string;
  nombre_completo: string;
  /** Estado inicial con el que se creó el usuario (típicamente "ACTIVO"). */
  estado: string;
  creado_por: string;
  rol_ids_asignados: string[];
  ip: string;
}

/**
 * HU-2 (Módulo D) — Payload emitido tras la baja lógica de `Usuario`.
 */
export interface UsuarioBajaLogicaPayload {
  usuario_id: string;
  dado_de_baja_por: string;
  deletion_reason: string;
  ip: string;
}

/**
 * HU-3 (Módulo D) — Payload emitido cuando `iniciarSesion()` alcanza
 * `MAX_INTENTOS_FALLIDOS` y suspende automáticamente al usuario.
 */
export interface UsuarioSuspendidoAutomaticamentePayload {
  usuario_id: string;
  intentos_fallidos: number;
  bloqueado_hasta: Date;
  ip: string;
}

/**
 * HU-3 (Módulo D) — Payload emitido tras un login exitoso (`iniciarSesion()`).
 */
export interface UsuarioSesionIniciadaPayload {
  usuario_id: string;
  sesion_id: string;
  ip: string;
  user_agent: string | null;
}

/**
 * HU-3 (Módulo D) — Payload emitido al cerrar/revocar una sesión
 * (`cerrarSesion()` o `revocarSesionesDeUsuario()`).
 */
export interface UsuarioSesionCerradaPayload {
  usuario_id: string;
  sesion_id: string;
  motivo: string;
}

/**
 * Endpoint 2.2.3 (Módulo D) — Payload emitido tras un cambio manual de
 * `Usuario.estado` (`cambiarEstadoUsuario()`). No se emite si la transición
 * fue idempotente (`estado_anterior === estado_nuevo`).
 */
export interface UsuarioEstadoCambiadoPayload {
  usuario_id: string;
  estado_anterior: string;
  estado_nuevo: string;
  cambiado_por: string;
  motivo: string | null;
  ip: string;
}

/**
 * task_cali_filtro_reactivacion.md §2.4 (Módulo D) — Payload emitido tras la
 * reactivación de un `Usuario` con `estado === "INACTIVO"`. Deliberadamente
 * separado de `UsuarioEstadoCambiadoPayload` (Endpoint 2.2.3) — ver
 * `reactivarUsuario()` en `usuario.service.ts`.
 */
export interface UsuarioReactivadoPayload {
  usuario_id: string;
  reactivado_por: string;
  motivo_reactivacion: string;
  ip: string;
}

/**
 * Endpoint 2.2.5 (Módulo D) — Payload emitido tras el alta atómica de `Rol`
 * + N filas `RolPermiso`. Incluye `nombre`/`descripcion` (no solo IDs —
 * mismo estándar fijado para `usuario:creado`), y `permiso_ids` como lista
 * de IDs (igual que `rol_ids_asignados` en `usuario:creado`: resolver los
 * `codigo` de cada permiso a texto no forma parte de este payload).
 */
export interface RolCreadoPayload {
  rol_id: string;
  nombre: string;
  descripcion: string | null;
  permiso_ids_asignados: string[];
  creado_por: string;
  ip: string;
}

/**
 * Endpoint 2.2.6 (Módulo D) — Payload emitido tras actualizar el conjunto
 * de `Permiso` de un `Rol` existente (diff completo: alta de agregados,
 * soft-delete de removidos).
 */
export interface RolPermisosActualizadosPayload {
  rol_id: string;
  actualizado_por: string;
  permisos_agregados: string[];
  permisos_removidos: string[];
  ip: string;
}

/** Mapa evento → payload, usado por `domain-event-bus.ts` para tipar `emit`/`on`. */
export interface DomainEventMap {
  "stock:umbrales_configurados": UmbralesConfiguradosPayload;
  "stock:umbral_critico_alcanzado": UmbralCriticoAlcanzadoPayload;
  /** HU-A3: se emite tras la transacción atómica de asignación en prueba. */
  "inventario:legajo_prueba_iniciado": LegajoPruebaIniciadoPayload;
  /** HU-1: se emite tras el alta atómica de Usuario + UsuarioRol. */
  "usuario:creado": UsuarioCreadoPayload;
  /** HU-2: se emite tras la baja lógica de Usuario. */
  "usuario:baja_logica": UsuarioBajaLogicaPayload;
  /** HU-3: se emite al alcanzar MAX_INTENTOS_FALLIDOS en el login. */
  "usuario:suspendido_automaticamente": UsuarioSuspendidoAutomaticamentePayload;
  /** HU-3: se emite tras un login exitoso. */
  "usuario:sesion_iniciada": UsuarioSesionIniciadaPayload;
  /** HU-3: se emite al cerrar o revocar una sesión. */
  "usuario:sesion_cerrada": UsuarioSesionCerradaPayload;
  /** Endpoint 2.2.3: se emite tras un cambio manual de Usuario.estado. */
  "usuario:estado_cambiado": UsuarioEstadoCambiadoPayload;
  /** task_cali_filtro_reactivacion.md §2: se emite tras reactivar un Usuario INACTIVO. */
  "usuario:reactivado": UsuarioReactivadoPayload;
  /** Endpoint 2.2.5: se emite tras el alta atómica de Rol + N RolPermiso. */
  "rol:creado": RolCreadoPayload;
  /** Endpoint 2.2.6: se emite tras actualizar los permisos de un Rol. */
  "rol:permisos_actualizados": RolPermisosActualizadosPayload;
}

export type DomainEventName = keyof DomainEventMap;

