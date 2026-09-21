/**
 * HU-7 — Sección 7: payloads de los eventos de dominio emitidos por
 * `lib/services/inventario/stock.service.ts`. El Módulo D (audit-log.listener.ts)
 * consume estos eventos para construir el `AuditLog` encadenado por SHA-256.
 */

import type { EstadoOrdenCompra } from "@prisma/client";

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
 * `StockDeposito.cantidad`). Desde HU-A11 (multi-ítem) cubre un lote de
 * ítems en un único `MovimientoStock` cabecera — nunca un evento por ítem.
 */
export interface IngresoStockRegistradoItemPayload {
  variante_sku_id: string;
  cantidad: number;
  estado_destino: string;
  cantidad_resultante: number;
}

export interface IngresoStockRegistradoPayload {
  movimiento_id: string;
  deposito_destino_id: string;
  items: IngresoStockRegistradoItemPayload[];
  usuario_id: string;
}

/** HU-A11 (multi-ítem) — línea de una `TransferenciaStock` al despacharse. */
export interface TransferenciaStockItemPayload {
  variante_sku_id: string;
  cantidad: number;
}

export interface TransferenciaStockPayload {
  transferencia_id: string;
  remito_id: string;
  movimiento_id: string;
  deposito_origen_id: string;
  deposito_destino_id: string;
  items: TransferenciaStockItemPayload[];
  usuario_id: string;
}

/**
 * HU-A11 — línea de una `TransferenciaStock` con el estado de recepción
 * alcanzado por ese ítem tras una confirmación (posiblemente parcial).
 */
export interface TransferenciaStockItemRecibidoPayload {
  variante_sku_id: string;
  cantidad_recibida: number;
  estado_item: "PENDIENTE" | "RECIBIDO_PARCIAL" | "RECIBIDO_TOTAL";
}

/**
 * HU-A11 — Payload emitido tras confirmar la recepción (total o parcial) de
 * una `TransferenciaStock`. Reemplaza al antiguo `TransferenciaStockRecibidaPayload`
 * (todo-o-nada): `estado_transferencia` distingue si la cabecera quedó
 * `PARCIAL` o `RECIBIDA`; `recibida_at` solo se completa en este último caso.
 */
export interface TransferenciaStockRecepcionConfirmadaPayload {
  transferencia_id: string;
  remito_id: string;
  movimiento_id: string;
  deposito_origen_id: string;
  deposito_destino_id: string;
  items: TransferenciaStockItemRecibidoPayload[];
  estado_transferencia: "PARCIAL" | "RECIBIDA";
  usuario_id: string;
  recibida_at: string | null;
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
  estado_anterior: EstadoOrdenCompra;
  estado_nuevo: EstadoOrdenCompra;
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

/** HU-H4: recepción física persistida y estado físico de la OC actualizado. */
export interface RecepcionRegistradaPayload {
  recepcion_id: string;
  orden_compra_id: string;
  numero_orden: string;
  deposito_destino_id: string;
  recibida_por_id: string;
  fecha_recepcion: string;
  estado_anterior_oc: "CONFIRMADA" | "RECEPCION_PARCIAL";
  estado_nuevo_oc: "RECEPCION_PARCIAL" | "RECIBIDA_COMPLETA";
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
 * consumidor hoy: `audit-log.listener.ts`, que lo mapea a un asiento
 * `AuditLog` encadenado por SHA-256 (spec_modulo_G.md §3.3 / §4.1). El payload
 * lleva `proveedor_id` para que Módulo H pueda suscribirse filtrando
 * `accion === "PAGAR"` y reflejar el pago en el historial del proveedor
 * (§2.4) — ese listener del lado de H todavía no existe.
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
  /** Presente solo en `PAGAR` (HU-G10). */
  medio_pago: "TRANSFERENCIA" | "CHEQUE" | "EFECTIVO" | null;
  /** Presente solo en `PAGAR` (HU-G10). */
  cuenta_origen_id: string | null;
  /** Presente solo en `PAGAR` (HU-G10). */
  comprobante_proveedor_ids: string[] | null;
  /** Presente solo en `PAGAR` (HU-G10). */
  observaciones: string | null;
}

/**
 * HU-H1 (Módulo H) — Payload emitido tras la baja lógica de un `Proveedor`
 * (`darDeBajaProveedor()`, spec_modulo_H.md §3.5 · RULES.md Regla N.° 1).
 * `motivo` es el `deletion_reason` obligatorio. NUNCA incluye datos
 * bancarios (regla de exclusión de datos sensibles de spec §4).
 * Emisión post-`COMMIT` (spec §3.4).
 */
export interface ProveedorBajaLogicaPayload {
  proveedor_id: string;
  usuario_id: string;
  motivo: string;
}

/**
 * HU-H1 (Módulo H) — Payload emitido tras la edición del legajo de un
 * `Proveedor` (`editarProveedor()`). `campos_editados` es la lista de claves
 * cuyo valor cambió (incluye `"datos_bancarios"` si se reemplazó, NUNCA el
 * valor en claro ni el ciphertext — spec §3.3/§4). Emisión post-`COMMIT`.
 */
export interface ProveedorLegajoEditadoPayload {
  proveedor_id: string;
  usuario_id: string;
  campos_editados: string[];
}

/**
 * HU-H2 (Módulo H) — línea de `ListaPrecioItem` cuya variación porcentual
 * contra el precio previamente vigente superó `UMBRAL_VARIACION_CRITICA_PORCENTUAL`
 * (`lista-precios.constants.ts`). Parte de `ProveedorVariacionPrecioCriticaPayload`.
 */
export interface ProveedorVariacionPrecioCriticaItemPayload {
  lista_precio_item_id: string;
  variante_sku_id: string;
  valor_anterior: number;
  valor_nuevo: number;
  variacion_porcentual: number;
}

/**
 * HU-H2 (Módulo H) — Payload emitido tras publicar una `ListaPrecioVersion`
 * cuya `variacion_porcentual_maxima` supera `UMBRAL_VARIACION_CRITICA_PORCENTUAL`
 * (`publicarNuevaVersionListaPrecio()`, `propose.md` — sección "Cálculo de
 * variación porcentual y evento crítico"). Un único evento agregado por
 * publicación, nunca uno por ítem — `variacion_porcentual_maxima` es un
 * campo singular de la versión. Emisión post-`COMMIT` (mismo patrón
 * fire-and-forget que el resto del proyecto).
 */
export interface ProveedorVariacionPrecioCriticaPayload {
  usuario_id: string;
  timestamp: string;
  proveedor_id: string;
  lista_precio_version_id: string;
  variacion_porcentual_maxima: number;
  items_variacion_critica: ProveedorVariacionPrecioCriticaItemPayload[];
}

/**
 * HU-H2 (Módulo H) — Payload emitido tras la aprobación manual de una
 * `ListaPrecioVersion` que había quedado pendiente por superar el umbral
 * crítico de variación (`aprobarListaPrecioVersion()`, `propose.md` —
 * contrato de función). Emisión post-`COMMIT`.
 */
export interface ProveedorListaPrecioAprobadaPayload {
  usuario_id: string;
  timestamp: string;
  proveedor_id: string;
  lista_precio_version_id: string;
}

/**
 * HU-A10 — Payload emitido tras el congelamiento de una `Reserva`
 * (`crearReserva()`, spec_modulo_A.md §2.9). Se emite SOLO después de que
 * `prisma.$transaction` resuelve, nunca dentro (regla de emisión §4).
 */
export interface ReservaCongeladaPayload {
  reserva_id: string;
  variante_sku_id: string;
  deposito_id: string;
  usuario_id: string;
  origen_reserva: "SENIA" | "LICITACION" | "PEDIDO_INSTITUCIONAL";
  cantidad: number;
}

/**
 * HU-A10 — Payload emitido tras la liberación de una `Reserva`, por venta
 * confirmada (`confirmarReservaPorVenta()`) o por TTL vencido
 * (`liberarReservasVencidas()`, cron). `motivo_liberacion` distingue la vía.
 * Emisión post-`$transaction` (§4). No incluye `usuario_id`: la vía TTL la
 * dispara el cron (agente del sistema, sin usuario humano); el listener
 * registra la auditoría con `usuario_id: null`.
 */
export interface ReservaLiberadaPayload {
  reserva_id: string;
  motivo_liberacion: "VENTA" | "TTL_VENCIDO";
  variante_sku_id: string;
  cantidad: number;
}

/**
 * HU-A9 — Payload emitido tras reclasificar una unidad DEVUELTO
 * (`reclasificarDevuelto()`, spec_modulo_A.md §2.8/§4). Se emite post-COMMIT,
 * tanto en la vía directa (bajo umbral) como al aprobar una solicitud
 * (sobre umbral). Payload superset del mínimo de la spec §4: incluye
 * `movimiento_id`/`deposito_id`/`estado_origen` para que el listener de
 * auditoría registre contra `movimientos_stock`. Nunca transporta datos
 * sensibles.
 */
export interface ReclasificacionDevueltoPayload {
  movimiento_id: string;
  variante_sku_id: string;
  deposito_id: string;
  resultado_control_calidad: "APTO" | "NO_APTO";
  estado_origen: "DEVUELTO";
  estado_destino: "DISPONIBLE" | "BAJA_MERMA";
  motivo?: string;
  rma_id?: string;
  usuario_id: string;
}

/**
 * HU-A9 — Payload emitido cuando una reclasificación supera el umbral y se
 * registra SOLO la `ReclasificacionSolicitud` en `PENDIENTE_APROBACION`
 * (spec_modulo_A.md §3.8). Sin `movimiento_id` ni impacto de stock: la
 * solicitud no es un hecho consumado. `usuario_id` es quien detectó la
 * unidad (solicitante).
 */
export interface ReclasificacionSolicitudCreadaPayload {
  solicitud_id: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad: number;
  motivo?: string;
  rma_id?: string;
  usuario_id: string;
}

/**
 * HU-A9 — Payload emitido cuando un Administrador aprueba una solicitud
 * pendiente (`aprobarSolicitud()`). Se emite junto con
 * `stock:reclasificacion_devuelto` (que transporta el `movimiento_id` real);
 * este payload registra la resolución de la solicitud contra
 * `reclasificacion_solicitudes`.
 */
export interface ReclasificacionSolicitudAprobadaPayload {
  solicitud_id: string;
  movimiento_id?: string;
  variante_sku_id: string;
  estado_destino: "BAJA_MERMA";
  admin_id: string;
}

/**
 * HU-A9 — Payload emitido cuando un Administrador rechaza una solicitud
 * pendiente (`rechazarSolicitud()`). `rechazada_motivo` es obligatorio.
 * Sin movimiento: el rechazo no impacta stock.
 */
export interface ReclasificacionSolicitudRechazadaPayload {
  solicitud_id: string;
  variante_sku_id: string;
  rechazada_motivo: string;
  admin_id: string;
}

/**
 * HU-A8 — Payload emitido tras editar atributos operativos de un
 * ProductoMaestro (`editarProductoMaestro()`, spec_modulo_A.md §2.7).
 * campos_modificados/valor_anterior/valor_nuevo son diff real (solo los
 * campos presentes en el payload de entrada), no un snapshot completo.
 */
export interface ProductoMaestroActualizadoPayload {
  producto_maestro_id: string;
  usuario_id: string;
  campos_modificados: string[];
  valor_anterior: Record<string, unknown>;
  valor_nuevo: Record<string, unknown>;
}

/**
 * HU-H9 (Módulo H) — Payload emitido tras el alta de un `ComprobanteProveedor`
 * (`registrarComprobanteProveedor()`, spec_modulo_H.md §2.7 / §4). Se emite
 * SOLO después del `COMMIT` de la transacción de alta, nunca dentro de ella
 * (spec §3.4, mismo patrón fire-and-forget que el resto del módulo — deuda
 * técnica conocida documentada en el PR). Consumidor: Módulo D
 * (`audit-log.listener.ts`).
 *
 * `monto_total` viaja como string (serialización de `Prisma.Decimal` a 2
 * decimales), mismo criterio que `CuentaPorPagar.monto` en
 * `CuentaPorPagarEstadoCambiadoPayload`. El payload NUNCA incluye datos
 * bancarios del proveedor (regla de exclusión de datos sensibles de spec §4).
 */
export interface ComprobanteProveedorRegistradoPayload {
  comprobante_id: string;
  orden_compra_id: string;
  proveedor_id: string;
  tipo: string;
  numero_comprobante: string;
  monto_total: string;
  registrado_por_id: string;
}

/**
 * HU-H9 (Módulo H) — Payload emitido tras la anulación (baja lógica) de un
 * `ComprobanteProveedor` (`anularComprobanteProveedor()`, spec_modulo_H.md
 * §2.7 / §3.6 / §4 · RULES.md Regla N.° 1). `deletion_reason` es el motivo
 * obligatorio. Emisión post-`COMMIT`.
 */
export interface ComprobanteProveedorAnuladoPayload {
  comprobante_id: string;
  orden_compra_id: string;
  proveedor_id: string;
  deletion_reason: string;
  anulado_por_id: string;
}

/**
 * HU-A8 — Payload emitido tras editar atributos operativos de una
 * VarianteSKU (`editarVarianteOperativa()`, spec_modulo_A.md §2.7). Nunca
 * incluye talle/color/genero/modelo/sku — el schema Zod ya los excluye por
 * diseño antes de que este payload pueda construirse. `ip` presente, mismo
 * criterio que `VarianteBajaLogicaPayload` (evento hermano de esta misma
 * entidad).
 */
export interface VarianteActualizadaPayload {
  variante_sku_id: string;
  usuario_id: string;
  campos_modificados: string[];
  valor_anterior: Record<string, unknown>;
  valor_nuevo: Record<string, unknown>;
  ip: string;
}

/**
 * HU-B3 (Módulo B) — Payload emitido tras el alta de un `Presupuesto` en
 * estado `EMITIDO` (`crearPresupuesto()`, spec_modulo_B.md §2.3/§4). Se
 * emite SOLO después de que TODAS las `Reserva` de Módulo A y el
 * `prisma.$transaction` de alta del propio `Presupuesto` resuelven — nunca
 * dentro de ninguna de las dos (regla de emisión, spec §3.3).
 *
 * `reserva_ids` referencia las reservas de Módulo A congeladas para esta
 * cotización — el payload nunca duplica su lógica, solo la referencia.
 */
export interface PresupuestoEmitidoPayload {
  presupuesto_id: string;
  cliente_id: string;
  vigencia_hasta: string;
  reserva_ids: string[];
  creado_por_id: string;
}

/**
 * HU-B3 (Módulo B) — Payload emitido cuando la lectura perezosa de un
 * `Presupuesto` detecta que su `vigencia_hasta` ya venció sin conversión a
 * `PedidoVenta` (spec §2.3/§3.1: "consulta perezosa al momento de la
 * siguiente lectura del presupuesto"). Marca `Presupuesto.estado = VENCIDO`
 * como baja lógica — NO libera la `Reserva` asociada (eso es exclusivo del
 * job de TTL de Módulo A, spec §3.2); este evento es solo el reflejo de
 * ese hecho sobre la propia fila de `Presupuesto`.
 */
export interface PresupuestoVencidoPayload {
  presupuesto_id: string;
  cliente_id: string;
  vigencia_hasta: string;
}

/**
 * HU-B3 (Módulo B) — Payload emitido tras convertir un `Presupuesto`
 * `EMITIDO` en un `PedidoVenta` `RESERVADO` (`aceptarPresupuesto()`, spec
 * §2.3/§3.1). No enumerado explícitamente en la tabla de eventos de spec §4
 * (que solo lista `venta:presupuesto_emitido`/`venta:presupuesto_vencido`
 * para HU-B3) — se añade siguiendo el mismo precedente ya documentado en
 * `OrdenCompraCreadaPayload`: RULES.md §2 exige que toda acción que
 * modifica el estado del sistema quede encadenada en el `AuditLog`.
 */
export interface PresupuestoAceptadoPayload {
  presupuesto_id: string;
  pedido_venta_id: string;
  numero_venta: string;
  cliente_id: string | null;
  aceptado_por_id: string;
}

/**
 * HU-B4 (Módulo B) — Payload emitido tras autorizar un descuento por fuera
 * del margen habilitado del Cajero (`autorizarOverrideDescuento()`, spec
 * §2.4/§4 — evento SENSIBLE, encadenamiento SHA-256 reforzado). `autorizacion_id`
 * es el id de correlación generado por el servicio (`crypto.randomUUID()`),
 * NO el `id` real de la fila de `AuditLog` que este evento termina
 * materializando — ver DECISIÓN RESUELTA en `pedido-venta.service.ts`.
 */
export interface DescuentoFueraMargenPayload {
  autorizacion_id: string;
  pedido_venta_id: string;
  usuario_solicitante_id: string;
  usuario_autorizante_id: string;
  porcentaje_aplicado: number;
  motivo: string;
  dispositivo: string;
  timestamp: string;
}

/**
 * HU-B4 (Módulo B) — Payload emitido tras un cambio manual de
 * `precio_unitario` de un `PedidoVentaItem` (mapeo de "precio de lista
 * modificado" de spec §2.4, documentado en `docs/tasks/HU-B4.md` §1.2 punto
 * 4 — no hay columna `precio_lista_modificado` propia). Evento SENSIBLE,
 * mismo criterio que `DescuentoFueraMargenPayload`.
 */
export interface CambioPrecioManualPayload {
  autorizacion_id: string;
  pedido_venta_id: string;
  variante_sku_id: string;
  usuario_autorizante_id: string;
  precio_anterior: number;
  precio_nuevo: number;
  motivo: string;
}

/**
 * HU-B5 (Módulo B) — Payload emitido tras registrar una operación a cuenta
 * corriente (`registrarOperacionCuentaCorriente()`, spec §2.5/§4), tanto si
 * quedó `APROBADA` como `RETENIDA`. Los campos `operacion_id` y `estado` son
 * un agregado a la tabla de spec §4 ("payload mínimo": `{ cliente_id,
 * pedido_venta_id, monto, plan_de_pagos? }`) — sin `estado` un consumidor no
 * podría distinguir una operación ya imputada al saldo de una retenida.
 */
export interface OperacionCuentaCorrienteRegistradaPayload {
  operacion_id: string;
  cliente_id: string;
  pedido_venta_id: string;
  monto: number;
  estado: "APROBADA" | "RETENIDA";
  plan_de_pagos?: Array<{ hito: string; porcentaje: number; fecha_estimada?: string }>;
}

/**
 * HU-B5 (Módulo B) — Payload emitido tras resolver (aprobar/rechazar) una
 * operación de cuenta corriente RETENIDA (`resolverExcepcionCredito()`,
 * docs/tasks/task_HU-B5.md §2.3/§2.5). Evento SENSIBLE (encadenamiento
 * SHA-256 hacia Módulo D). No listado en la tabla de spec §4. `autorizacion_id`
 * es el id de CORRELACIÓN (`crypto.randomUUID()`), no el `id` de `AuditLog`.
 * `usuario_solicitante_id` se toma de `PedidoVenta.registrado_por_id`
 * (`CuentaCorrienteOperacion` no tiene columna propia — limitación conocida).
 */
export interface ExcepcionCreditoResueltaPayload {
  autorizacion_id: string;
  operacion_id: string;
  pedido_venta_id: string;
  cliente_id: string;
  usuario_solicitante_id: string;
  usuario_autorizante_id: string;
  decision: "APROBAR" | "RECHAZAR";
  motivo: string;
  monto: number;
}

/**
 * HU-C1 (Módulo C) — Payload emitido tras el alta NUEVA de un `Cliente`
 * (`crearCliente()`, spec_modulo_C.md §2.1/§4). Se emite SOLO cuando
 * `es_nuevo === true` — recuperar un `Cliente` existente por DNI (§3.1: "no
 * hay transición nueva") no dispara este evento, no hay nada que auditar.
 * Emisión post-`COMMIT`, fire-and-forget (mismo patrón que el resto del
 * proyecto — spec §3.3). Nunca incluye `telefono`/`email` (regla de
 * exclusión de datos personales del payload, spec §4).
 */
export interface ClienteCreadoPayload {
  cliente_id: string;
  dni: string;
  usuario_id: string;
  es_nuevo: true;
}

/**
 * Módulo C — Payload emitido tras una mutación de la ficha de un `Cliente`
 * cubierta por §2.3. Hoy tiene DOS consumidores, ambos vía
 * `agregarDireccionCliente()` (HU-C3, alta de una `DireccionCliente`) y
 * `actualizarCanalContacto()` (HU-C9, cambio de `canal_preferido`). Emisión
 * post-`COMMIT`, fire-and-forget (spec §3.3/§4) — jamás dentro de la
 * transacción.
 *
 * `campos_modificados` describe qué cambió sobre el cliente (alta de
 * dirección: `["direcciones"]`; canal de contacto: `["canal_preferido"]`);
 * `valor_nuevo` lleva los datos de la fila creada/actualizada. El payload NO
 * copia `email`/`telefono` del cliente (regla de minimización, spec §4).
 *
 * Nota de implementación: `AuditLog` no tiene columna `campos_modificados`;
 * el handler de auditoría pliega ese array dentro de `valor_nuevo` para que
 * el snapshot forense conserve el detalle (design §5).
 *
 * `accion`/`tabla_afectada`/`registro_id` (HU-C9) son OPCIONALES y
 * ADITIVOS: cuando están ausentes el handler de auditoría deriva el asiento
 * con los valores históricos de HU-C3, de modo que la fila de C3 queda
 * byte-idéntica (design §2, spec auditoría "No-regresión HU-C3").
 */
export interface ClienteActualizadoPayload {
  cliente_id: string;
  usuario_id: string;
  campos_modificados: string[];
  valor_anterior: Record<string, unknown> | null;
  valor_nuevo: Record<string, unknown> | null;
  /** Ausente = comportamiento de HU-C3 (`"CREATE"`). */
  accion?: "CREATE" | "UPDATE";
  /** Ausente = `"direcciones_cliente"` (tabla de HU-C3). */
  tabla_afectada?: string;
  /** Ausente = id de la fila creada (dirección) o `cliente_id`. */
  registro_id?: string;
}

/**
 * HU-B2 (Módulo B) — Payload emitido tras la apertura de un `TurnoCaja`
 * (`abrirTurnoCaja()`, task_relos.md §6.1/§7). Emisión post-escritura
 * (mismo patrón fire-and-forget que el resto del proyecto).
 */
export interface VentaTurnoAbiertoPayload {
  turno_caja_id: string;
  usuario_id: string;
  fondo_fijo_inicial: number;
}

/**
 * HU-B2 (Módulo B) — Payload emitido tras el cierre de un `TurnoCaja`
 * (`cerrarTurnoCaja()`, task_relos.md §6.2/§7). Evento SENSIBLE (encadenamiento
 * SHA-256 reforzado, mismo criterio que HU-B4) cuando `requiere_justificacion:
 * true` — el listener de auditoría distingue la `accion` por este flag.
 *
 * La entrega real de una notificación al Tesorero (AC de la HU) queda fuera
 * de alcance: no existe hoy ningún motor de notificaciones (Módulo F) que
 * consuma este evento — decisión documentada en task_relos.md §0.2.
 */
export interface VentaTurnoCerradoPayload {
  turno_caja_id: string;
  usuario_id: string;
  saldo_esperado: number;
  conteo_fisico_declarado: number;
  diferencia: number;
  requiere_justificacion: boolean;
  justificacion: string | null;
}

/** Línea de cobro de `VentaRegistradaPayload` — mismo shape mínimo del payload de spec §4. */
export interface VentaRegistradaMedioPagoPayload {
  medio: string;
  importe: number;
}

/**
 * HU-B1 (Módulo B) — Payload emitido tras registrar una venta de mostrador
 * (`registrarVentaMostrador()`, spec_modulo_B.md §2.1/§4). Payload LITERAL de
 * spec §4 (`{ pedido_venta_id, cliente_id | null, total, medios_pago[],
 * turno_caja_id, usuario_id }`) — sin campos adicionales de comprobante ni de
 * ítems pendientes de autorización (esos quedan resolubles consultando el
 * `PedidoVenta` por su `id`, no duplicados en el evento). Emisión post-COMMIT
 * (mismo patrón fire-and-forget que el resto del proyecto).
 */
export interface VentaRegistradaPayload {
  pedido_venta_id: string;
  cliente_id: string | null;
  total: number;
  medios_pago: VentaRegistradaMedioPagoPayload[];
  turno_caja_id: string;
  usuario_id: string;
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
  /** HU-A11: se emite tras confirmar una recepción total o parcial. */
  "stock:transferencia_recepcion_confirmada": TransferenciaStockRecepcionConfirmadaPayload;
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
  /** HU-H4: se emite una vez, post-commit, por cada recepción física nueva. */
  "recepcion:registrada": RecepcionRegistradaPayload;
  /** HU-H5 (y HU-H1 2.2): se emite tras un cambio de estado de Proveedor, manual o automático. */
  "proveedor:estado_cambiado": ProveedorEstadoCambiadoPayload;
  /** HU-G8: se emite tras cada transición de estado de una CuentaPorPagar (CREAR/DEFINIR/PAGAR/CANCELAR). */
  "cuenta_por_pagar:estado_cambiado": CuentaPorPagarEstadoCambiadoPayload;
  /** HU-H9: se emite tras el alta de un ComprobanteProveedor contra una OC recibida. */
  "comprobante_proveedor:registrado": ComprobanteProveedorRegistradoPayload;
  /** HU-H9: se emite tras la anulación (baja lógica) de un ComprobanteProveedor. */
  "comprobante_proveedor:anulado": ComprobanteProveedorAnuladoPayload;
  /** HU-H1: se emite tras la baja lógica de un Proveedor (nunca DELETE físico). */
  "proveedor:baja_logica": ProveedorBajaLogicaPayload;
  /** HU-H1: se emite tras la edición del legajo de un Proveedor. */
  "proveedor:legajo_editado": ProveedorLegajoEditadoPayload;
  /** HU-H2: se emite tras publicar una ListaPrecioVersion cuya variación máxima supera el umbral crítico. */
  "proveedor:variacion_precio_critica": ProveedorVariacionPrecioCriticaPayload;
  /** HU-H2: se emite tras aprobar una ListaPrecioVersion pendiente por variación crítica. */
  "proveedor:lista_precio_aprobada": ProveedorListaPrecioAprobadaPayload;
  /** HU-A10: se emite tras el congelamiento de una Reserva (DISPONIBLE → RESERVADO). */
  "stock:reserva_congelada": ReservaCongeladaPayload;
  /** HU-A10: se emite tras la liberación de una Reserva (venta confirmada o TTL vencido). */
  "stock:reserva_liberada": ReservaLiberadaPayload;
  /** HU-A9: se emite tras reclasificar una unidad DEVUELTO (vía directa o aprobación). */
  "stock:reclasificacion_devuelto": ReclasificacionDevueltoPayload;
  /** HU-A9: se emite al crear una solicitud de reclasificación sobre el umbral. */
  "stock:reclasificacion_solicitud_creada": ReclasificacionSolicitudCreadaPayload;
  /** HU-A9: se emite al aprobar una solicitud de reclasificación pendiente. */
  "stock:reclasificacion_solicitud_aprobada": ReclasificacionSolicitudAprobadaPayload;
  /** HU-A9: se emite al rechazar una solicitud de reclasificación pendiente. */
  "stock:reclasificacion_solicitud_rechazada": ReclasificacionSolicitudRechazadaPayload;
  /** HU-A8: se emite tras editar atributos operativos de un ProductoMaestro. */
  "producto_maestro:actualizado": ProductoMaestroActualizadoPayload;
  /** HU-A8: se emite tras editar atributos operativos de una VarianteSKU. */
  "inventario:variante_actualizada": VarianteActualizadaPayload;
  /** HU-B3: se emite tras el alta de un Presupuesto EMITIDO (congelamiento de stock incluido). */
  "venta:presupuesto_emitido": PresupuestoEmitidoPayload;
  /** HU-B3: se emite cuando una lectura perezosa detecta un Presupuesto EMITIDO vencido. */
  "venta:presupuesto_vencido": PresupuestoVencidoPayload;
  /** HU-B3: se emite tras convertir un Presupuesto EMITIDO en un PedidoVenta RESERVADO. */
  "venta:presupuesto_aceptado": PresupuestoAceptadoPayload;
  /** HU-B4: se emite tras autorizar un descuento por fuera del margen habilitado (evento sensible). */
  "venta:descuento_fuera_margen": DescuentoFueraMargenPayload;
  /** HU-B4: se emite tras un cambio manual de precio de lista sobre un PedidoVentaItem (evento sensible). */
  "venta:cambio_precio_manual": CambioPrecioManualPayload;
  /** HU-B5: se emite tras registrar una operación a cuenta corriente (APROBADA o RETENIDA). */
  "venta:operacion_cuenta_corriente_registrada": OperacionCuentaCorrienteRegistradaPayload;
  /** HU-B5: se emite tras aprobar/rechazar una operación de cuenta corriente RETENIDA (evento sensible). */
  "venta:excepcion_credito_resuelta": ExcepcionCreditoResueltaPayload;
  /** HU-C1: se emite tras el alta NUEVA de un Cliente (nunca al recuperar uno existente por DNI). */
  "cliente:creado": ClienteCreadoPayload;
  /** HU-C3: se emite post-COMMIT tras mutar la ficha del cliente (alta de una DireccionCliente, §2.3). */
  "cliente:actualizado": ClienteActualizadoPayload;
  /** HU-B2: se emite tras la apertura de un TurnoCaja. */
  "venta:turno_abierto": VentaTurnoAbiertoPayload;
  /** HU-B2: se emite tras el cierre de un TurnoCaja (evento sensible si requiere_justificacion). */
  "venta:turno_cerrado": VentaTurnoCerradoPayload;
  /** HU-B1: se emite tras registrar una venta de mostrador con cobro multimedio. */
  "venta:registrada": VentaRegistradaPayload;
}

export type DomainEventName = keyof DomainEventMap;
