/**
 * HU-7 — Sección 7: payloads de los eventos de dominio emitidos por
 * `lib/services/inventario/stock.service.ts`. El Módulo D (audit-log.listener.ts)
 * consume estos eventos para construir el `AuditLog` encadenado por SHA-256.
 */

/**
 * HU-A1 — Payload emitido tras el alta de un `ProductoMaestro`
 * (`crearProductoMaestro()`, sección 6.1 de task_relos.md).
 */
export interface ProductoMaestroCreadoPayload {
  producto_maestro_id: string;
  nombre: string;
  usuario_id: string;
}

/**
 * HU-A1 — Payload emitido tras la generación en lote de `VarianteSKU`
 * (`generarVariantesMatriz()`, sección 6.2 de task_relos.md). Un único evento
 * con el conteo total — nunca un evento por variante individual.
 */
export interface VariantesGeneradasPayload {
  producto_maestro_id: string;
  cantidad_generadas: number;
  usuario_id: string;
}

/**
 * HU-A1 — Payload emitido tras la baja lógica de un `ProductoMaestro`
 * (`desactivarProductoMaestro()`, sección 5.3 de task_relos.md).
 */
export interface ProductoMaestroDesactivadoPayload {
  producto_maestro_id: string;
  deletion_reason: string | null;
  usuario_id: string;
}

/**
 * HU-A6 — Payload emitido tras la baja lógica de una `VarianteSKU`
 * (`darDeBajaVariante()`, sección 3.5 de spec_modulo_A.md). El evento se
 * emite SOLO después de que el `UPDATE` de soft delete resuelve
 * exitosamente, nunca dentro de `prisma.$transaction` (regla de emisión de
 * spec_modulo_A.md §4). `stock_total_al_momento` es el total de stock activo
 * leído ANTES del update; `ip` mantiene `AuditLog.ip` NOT NULL con default
 * `"unknown"`. El payload nunca incluye datos sensibles (regla de
 * `event-types.ts` y spec_modulo_D.md §5.1).
 */
export interface VarianteBajaLogicaPayload {
  variante_sku_id: string;
  usuario_id: string;
  deletion_reason: string | null;
  stock_total_al_momento: number;
  ip: string;
}

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
 * HU-2 — Payload emitido tras registrar un ingreso de mercadería por
 * escaneo (creación de `MovimientoStock` tipo INGRESO + incremento de
 * `StockDeposito.cantidad`).
 */
export interface IngresoStockRegistradoPayload {
  movimiento_id: string;
  variante_sku_id: string;
  deposito_destino_id: string;
  cantidad: number;
  cantidad_resultante: number;
  usuario_id: string;
}

export interface TransferenciaStockPayload {
  transferencia_id: string;
  remito_id: string;
  movimiento_id: string;
  variante_sku_id: string;
  deposito_origen_id: string;
  deposito_destino_id: string;
  cantidad: number;
  usuario_id: string;
}

export interface TransferenciaStockRecibidaPayload extends TransferenciaStockPayload {
  recibida_at: string;
}

export interface TransferenciaStockBajaPayload {
  transferencia_id: string;
  usuario_id: string;
  deletion_reason: string;
  deleted_at: string;
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

/**
 * HU-H3 (Módulo H) — Payload emitido tras el alta de una `OrdenCompra` en
 * estado `BORRADOR` (`crearOrdenCompra()`, spec_modulo_H.md §2.4). Se emite
 * SOLO después del `COMMIT` de la transacción de alta, nunca dentro de ella
 * (spec §3.4, mismo patrón fire-and-forget que Módulo D — deuda técnica
 * conocida documentada en el PR).
 *
 * spec §4 no enumera un evento propio de OrdenCompra en su tabla (se enfoca
 * en `proveedor:estado_cambiado` y `stock:recepcion_confirmada`), pero
 * RULES.md §2 exige que toda acción que modifica el sistema quede encadenada
 * en el `AuditLog`. Se sigue el precedente ya establecido para `usuario:*`
 * (`usuario:creado` / `usuario:estado_cambiado`).
 *
 * `precio_unitario` viaja como string (serialización de `Prisma.Decimal`).
 */
export interface OrdenCompraCreadaPayload {
  orden_compra_id: string;
  numero_orden: string;
  proveedor_id: string;
  estado: "BORRADOR";
  creada_por_id: string;
  lista_precio_version_id: string;
  items: {
    variante_sku_id: string;
    cantidad_solicitada: number;
    precio_unitario: string;
  }[];
}

/**
 * HU-H3 (Módulo H) — Payload emitido tras una transición de estado de una
 * `OrdenCompra` (`cambiarEstadoOrdenCompra()`, spec_modulo_H.md §2.5). Cubre
 * `ENVIAR` / `CONFIRMAR` / `CERRAR` / `CANCELAR`. `CANCELAR` es baja lógica
 * (spec §2.5): el listener de auditoría lo registra como `DELETE_LOGICO`, el
 * resto como `UPDATE_ESTADO`. Emisión post-`COMMIT` (spec §3.4).
 */
export interface OrdenCompraEstadoCambiadoPayload {
  orden_compra_id: string;
  numero_orden: string;
  estado_anterior: string;
  estado_nuevo: string;
  accion: "ENVIAR" | "CONFIRMAR" | "CERRAR" | "CANCELAR";
  cambiado_por: string;
  /** Presente solo en `CONFIRMAR`. ISO 8601. */
  fecha_entrega_comprometida: string | null;
  /** Presente solo en `CANCELAR` (baja lógica). */
  deletion_reason: string | null;
}

/**
 * HU-H3 (Módulo H) — Payload emitido tras editar los ítems de una
 * `OrdenCompra` en estado `BORRADOR` (`editarItemsOrdenCompra()`, CA2 del
 * Backlog Sprint 2). Emisión post-`COMMIT` (mismo patrón que el resto de
 * `orden_compra:*`). El listener lo registra como `UPDATE` sobre
 * `ordenes_compra`.
 *
 * `precio_unitario` viaja como string (serialización de `Prisma.Decimal`).
 * Se incluyen los ítems antes y después para que el ledger forense pueda
 * reconstruir el diff (altas, bajas lógicas, cambios de cantidad/precio).
 */
export interface OrdenCompraItemsEditadosPayload {
  orden_compra_id: string;
  numero_orden: string;
  editada_por: string;
  lista_precio_version_id: string;
  items_anteriores: {
    variante_sku_id: string;
    cantidad_solicitada: number;
    precio_unitario: string;
  }[];
  items_nuevos: {
    variante_sku_id: string;
    cantidad_solicitada: number;
    precio_unitario: string;
  }[];
}

/**
 * HU-H5 (Módulo H) — Payload emitido tras la transición automática de
 * `Proveedor.estado` a `SUSPENDIDO` por caída de puntaje
 * (`evaluacion.service.ts`, `registrarEvaluacionDesdeRecepcion()`).
 * `usuario_id` es `null` porque el origen es automático, no una acción de un
 * usuario. Reutiliza el mismo evento que el endpoint manual de
 * `spec_modulo_H.md` §2.2 — el listener distingue por `origen`. Emisión
 * post-`COMMIT` (mismo patrón que el resto de eventos de este módulo).
 */
export interface ProveedorEstadoCambiadoPayload {
  proveedor_id: string;
  usuario_id: string | null;
  estado_anterior: string;
  estado_nuevo: string;
  origen: "MANUAL" | "AUTOMATICO";
  motivo: string;
}

/**
 * HU-G8 (Módulo G) — Payload emitido tras cada transición de estado de una
 * `CuentaPorPagar`, por las tres ramas del listener reactivo
 * (`cuenta-por-pagar.listener.ts`: `CREAR` / `DEFINIR` / `CANCELAR`) y por la
 * mutación manual de pago (`marcarCuentaPorPagarPagada()`: `PAGAR`). Único
 * consumidor: `audit-log.listener.ts`, que lo mapea a un asiento
 * `AuditLog` encadenado por SHA-256 (spec_modulo_G.md §3.3 / §4.1). El
 * Módulo H se suscribe además filtrando `accion === "PAGAR"` para reflejar el
 * pago en el historial del proveedor (§2.4).
 *
 * Emisión SIEMPRE post-`COMMIT`, fire-and-forget, nunca dentro de la
 * `prisma.$transaction` que hace la escritura (mismo patrón que el resto de
 * eventos de dominio del proyecto — deuda técnica conocida de Módulo D).
 *
 * `monto_anterior` / `monto_nuevo` son `Prisma.Decimal` serializados a
 * `string` (nunca `number`); las fechas viajan como ISO 8601 o `null`.
 */
export interface CuentaPorPagarEstadoCambiadoPayload {
  cuenta_por_pagar_id: string;
  orden_compra_id: string;
  numero_orden: string;
  proveedor_id: string;
  /** `null` únicamente en `CREAR` (la cuenta nace, no tenía estado previo). */
  estado_anterior: "PROVISORIO" | "DEFINITIVA" | "PAGADA" | "CANCELADA" | null;
  estado_nuevo: "PROVISORIO" | "DEFINITIVA" | "PAGADA" | "CANCELADA";
  accion: "CREAR" | "DEFINIR" | "PAGAR" | "CANCELAR";
  cambiado_por: string;
  /** `null` en `CREAR`; en `DEFINIR` es el monto provisorio previo al recálculo. */
  monto_anterior: string | null;
  monto_nuevo: string;
  /** Presente solo en `DEFINIR` (la `Recepcion` de cierre asociada). */
  recepcion_id: string | null;
  /** Siempre `null` en HU-G8 (`Proveedor.condiciones_pago` es texto libre no parseable). */
  fecha_vencimiento: string | null;
  /** Presente solo en `PAGAR`. ISO 8601. */
  fecha_pago: string | null;
  /** Presente solo en `CANCELAR` — motivo de la cancelación funcional, NO baja lógica. */
  deletion_reason: string | null;
}

/** Mapa evento → payload, usado por `domain-event-bus.ts` para tipar `emit`/`on`. */
export interface DomainEventMap {
  /** HU-A1: se emite tras el alta de un ProductoMaestro. */
  "producto_maestro:creado": ProductoMaestroCreadoPayload;
  /** HU-A1: se emite tras generar variantes en lote (matriz talle×color×género). */
  "variantes:generadas": VariantesGeneradasPayload;
  /** HU-A1: se emite tras la baja lógica de un ProductoMaestro. */
  "producto_maestro:desactivado": ProductoMaestroDesactivadoPayload;
  "stock:umbrales_configurados": UmbralesConfiguradosPayload;
  "stock:umbral_critico_alcanzado": UmbralCriticoAlcanzadoPayload;
  /** HU-2: se emite tras registrar un ingreso de mercadería por escaneo. */
  "inventario:ingreso_stock_registrado": IngresoStockRegistradoPayload;
  /** HU-A5: eventos de transferencia de stock entre depósitos. */
  "stock:transferencia_iniciada": TransferenciaStockPayload;
  "stock:transferencia_recibida": TransferenciaStockRecibidaPayload;
  "stock:transferencia_baja_logica": TransferenciaStockBajaPayload;
  /** HU-A6: baja lógica de una VarianteSKU. */
  "inventario:variante_baja_logica": VarianteBajaLogicaPayload;
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
  /** HU-H3: se emite tras el alta de una OrdenCompra en estado BORRADOR. */
  "orden_compra:creada": OrdenCompraCreadaPayload;
  /** HU-H3: se emite tras una transición de estado de una OrdenCompra. */
  "orden_compra:estado_cambiado": OrdenCompraEstadoCambiadoPayload;
  /** HU-H3: se emite tras editar los ítems de una OrdenCompra en BORRADOR. */
  "orden_compra:items_editados": OrdenCompraItemsEditadosPayload;
  /** HU-H5 (y HU-H1 2.2): se emite tras un cambio de estado de Proveedor, manual o automático. */
  "proveedor:estado_cambiado": ProveedorEstadoCambiadoPayload;
  /** HU-G8: se emite tras cada transición de estado de una CuentaPorPagar (CREAR/DEFINIR/PAGAR/CANCELAR). */
  "cuenta_por_pagar:estado_cambiado": CuentaPorPagarEstadoCambiadoPayload;
}

export type DomainEventName = keyof DomainEventMap;
