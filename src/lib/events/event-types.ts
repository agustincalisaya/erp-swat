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

/**
 * HU-H4: recepción física persistida y estado físico de la OC actualizado.
 *
 * B2 (auditoría transversal Módulo H, 2026-09-26): `estado_nuevo_oc` incluía
 * `"RECEPCION_PARCIAL"`, residuo de tipos de un diseño anterior a H4 V2.1
 * (`799ad6b`, PR #128) — `recepcion.service.ts:168` exige que la OC esté
 * `CONFIRMADA` y `:191` siempre fija `RECIBIDA_COMPLETA`; ese valor nunca se
 * produjo desde V2.1. Se retira del tipo (nunca se emitió con ese valor, así
 * que ningún `AuditLog` existente lo persistió con este shape).
 */
export interface RecepcionRegistradaPayload {
  recepcion_id: string;
  orden_compra_id: string;
  numero_orden: string;
  deposito_destino_id: string;
  recibida_por_id: string;
  fecha_recepcion: string;
  estado_anterior_oc: "CONFIRMADA";
  estado_nuevo_oc: "RECIBIDA_COMPLETA";
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
 * HU-G11 (Módulo G) — Payload emitido post-`COMMIT` por
 * `ingreso-tesoreria.listener.ts` al registrar el `IngresoTesoreria` de un
 * cobro web (spec_modulo_G.md §2.6). Único consumidor hoy:
 * `audit-log.listener.ts` (asiento SHA-256). `monto` es `Prisma.Decimal`
 * serializado a `string` (`.toFixed(2)`, nunca `number`); `fecha` ISO 8601.
 * Sin datos sensibles (ni tarjeta, ni credenciales, ni campos cifrados).
 */
export interface IngresoWebRegistradoPayload {
  ingreso_id: string;
  pedido_venta_id: string;
  mercadopago_payment_id: string;
  monto: string;
  fecha: string;
  estado: string;
  caja_virtual: string;
}

/**
 * HU-G11 (Módulo G) — Payload emitido post-`COMMIT` por
 * `ingreso-tesoreria.listener.ts` al registrar el `ContraAsientoIngreso` de un
 * reintegro (spec_modulo_G.md §2.6; origen HU-E13). `ingreso_original_id`
 * referencia el ingreso original, que NUNCA se edita ni se elimina. `monto` es
 * `Prisma.Decimal` serializado a `string` (`.toFixed(2)`).
 */
export interface ContraAsientoIngresoRegistradoPayload {
  contra_asiento_id: string;
  ingreso_original_id: string;
  pedido_venta_id: string;
  monto: string;
  motivo: string;
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
  origen_reserva: "SENIA" | "LICITACION" | "PEDIDO_INSTITUCIONAL" | "CHECKOUT_WEB";
  cantidad: number;
}

/**
 * HU-A10 — Payload emitido tras la liberación de una `Reserva`, por venta
 * confirmada (`confirmarReservaPorVenta()`) o por TTL vencido
 * (`liberarReservasVencidas()`, cron). `motivo_liberacion` distingue la vía.
 * Emisión post-`$transaction` (§4). No incluye `usuario_id`: la vía TTL la
 * dispara el cron (agente del sistema, sin usuario humano); el listener
 * registra la auditoría con `usuario_id: null`.
 *
 * HU-E2: `PAGO_RECHAZADO` = liberación inmediata por rechazo del pago web
 * (`liberarReservasTx()`), RESERVADO → DISPONIBLE como la de TTL.
 *
 * HU-E7: `ANULACION_ORDEN` = liberación por anulación de una orden web no
 * abonada, manual o automática (`liberarReservasTx()`, spec E §2.7).
 */
export interface ReservaLiberadaPayload {
  reserva_id: string;
  motivo_liberacion: "VENTA" | "TTL_VENCIDO" | "PAGO_RECHAZADO" | "ANULACION_ORDEN";
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
 * HU-B9 (Módulo B) — Payload emitido tras publicar una `ListaPrecioVentaVersion`
 * (`publicarVersionListaPrecioVenta()`, spec_modulo_B.md §2.9/§4). Evento
 * SENSIBLE (encadenamiento SHA-256: afecta el precio de todos los canales).
 * Payload literal de spec §4. Punto abierto 3 resuelto: `version_anterior_id`
 * es la versión activa que rige cuando empieza a regir la nueva (`null` si
 * no hay ninguna; las programadas a futuro no cuentan), y alimenta `valor_anterior` del AuditLog.
 * `vigente_desde` viaja como ISO 8601. Emisión post-`COMMIT`.
 */
export interface PrecioVentaVersionPublicadaPayload {
  version_id: string;
  version_anterior_id: string | null;
  lista_id: string;
  publicado_por_id: string;
  vigente_desde: string;
  items_publicados: number;
  items_bajo_costo: number;
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

/** Un hecho histórico C4 ya confirmado; nunca transporta datos personales ni motivo libre. */
export interface ConsentimientoDecisionRegistradaPayload {
  evento_id: string;
  cliente_id: string;
  alcance: "VENTA_ASISTIDA" | "COMUNICACIONES_COMERCIALES";
  tipo: "ACEPTACION_INICIAL" | "RECHAZO_COMERCIAL" | "SOLICITUD_REVOCACION" |
    "REVOCACION_EJECUTADA" | "SOLICITUD_RECHAZADA" | "NUEVA_ACEPTACION";
  fecha_evento: string;
  usuario_id: string;
  consentimiento_id: string | null;
  solicitud_evento_id: string | null;
  contexto: "ALTA" | "REGULARIZACION" | "FICHA";
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
 * HU-C6 (Módulo C) — Payload emitido tras la baja lógica de un `Cliente`
 * (`bajaCliente()`, spec_modulo_C.md §2.6 · RULES.md Regla N.° 1).
 * `deletion_reason` es el motivo obligatorio. Emisión post-`COMMIT`, y solo
 * cuando la baja efectivamente ocurrió (nunca en una doble baja). No incluye
 * datos personales (`dni`/`email`/`telefono`).
 */
export interface ClienteBajaLogicaPayload {
  cliente_id: string;
  usuario_id: string;
  deletion_reason: string;
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

// ──────────────────────────────────────────────────────────────────────────────
// HU-E12 — Pick & Pack / Click & Collect
// ──────────────────────────────────────────────────────────────────────────────

/**
 * HU-E12 — Disponibilidad de un pedido PAGO_CONFIRMADO en la cola de preparación.
 * Se emite post-COMMIT por el caller E2; `admitirPedidoPagoConfirmado` solo
 * devuelve la metadata del evento pendiente porque no controla el commit.
 */
export interface EcommercePedidoAdmitidoColaPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  actor_id: string | null;
  estado_nuevo: "PAGO_CONFIRMADO";
  timestamp: string;
}

/** HU-E12 — Un operador tomó un pedido libre de la cola. */
export interface EcommercePedidoTomadoPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  actor_id: string;
  estado: "EN_PREPARACION";
  timestamp: string;
}

/** HU-E12 — Cambio manual de prioridad en la cola de preparación. */
export interface EcommercePrioridadPreparacionCambiadaPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  actor_id: string;
  prioridad_anterior: number | null;
  prioridad_nueva: number | null;
  timestamp: string;
}

/** HU-E12 — Confirmación de una unidad preparada por escaneo. */
export interface EcommerceUnidadPreparacionConfirmadaPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_item_id: string;
  variante_sku_id: string;
  actor_id: string;
  cantidad_confirmada_anterior: number;
  cantidad_confirmada_nueva: number;
  timestamp: string;
}

/** HU-E12 — Pedido completamente preparado y listo para retiro. */
export interface EcommercePedidoListoParaRetiroPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  actor_id: string;
  estado_anterior: "EN_PREPARACION";
  estado_nuevo: "LISTO_PARA_RETIRO";
  plazo_retiro_vencimiento: string;
  timestamp: string;
  /** HU-E3 T8: destinatario operable, o null sin cuenta web notificable. */
  cliente_web_cuenta_id: string | null;
  numero_venta: string;
}

export interface EcommercePlazoRetiroPorVencerPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  cliente_web_cuenta_id: string | null;
  plazo_retiro_vencimiento: string;
  clave_origen: string;
  actor_tipo: "SISTEMA";
  actor_id: null;
  timestamp: string;
}

export interface EcommercePedidoCanceladoPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  reintegro_id: string;
  numero_venta: string;
  cliente_web_cuenta_id: string | null;
  actor_tipo: "CLIENTE_WEB" | "USUARIO";
  actor_id: string;
  motivo: string;
  estado_anterior: "PAGO_CONFIRMADO" | "EN_PREPARACION" | "LISTO_PARA_RETIRO";
  estado_nuevo: "CANCELADO";
  timestamp: string;
}

export interface EcommercePedidoVencidoSinRetiroPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  reintegro_id: string;
  numero_venta: string;
  cliente_web_cuenta_id: string | null;
  actor_tipo: "SISTEMA";
  actor_id: null;
  motivo: string;
  estado_anterior: "LISTO_PARA_RETIRO";
  estado_nuevo: "VENCIDO_SIN_RETIRO";
  timestamp: string;
}

export interface EcommerceReintegroEstadoCambiadoPayload {
  evento_id: string;
  reintegro_id: string;
  intento_refund_id: string;
  numero_intento: number;
  origen_intento: "INICIAL" | "REINTENTO_MANUAL";
  pedido_venta_id: string;
  estado_anterior: "PENDIENTE" | "RECHAZADO";
  estado_nuevo: "PENDIENTE" | "APROBADO" | "RECHAZADO";
  actor_id: string | null;
  motivo: string | null;
  timestamp: string;
}

// HU-E3 — retiro validado. T2 declara contratos; la emisión corresponde a T6.
export type MotivoRetiroRechazado =
  | "TOKEN_NO_RESUELTO"
  | "PEDIDO_NO_OPERABLE"
  | "ESTADO_NO_LISTO"
  | "PLAZO_VENCIDO"
  | "DNI_NO_COINCIDE"
  | "CLIENTE_NO_OPERABLE";

export interface PedidoEntregadoPayload {
  evento_id: string;
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  actor_id: string;
  estado_anterior: "LISTO_PARA_RETIRO";
  estado_nuevo: "ENTREGADO";
  timestamp: string;
}

export interface RetiroRechazadoPayload {
  evento_id: string;
  actor_id: string;
  motivo: MotivoRetiroRechazado;
  timestamp: string;
  pedido_venta_id?: string;
  pedido_venta_ecommerce_id?: string;
}

/**
 * HU-E1 (spec_modulo_E.md §2.1/§4, criterio de aceptación 4) — motivo por el
 * que un ítem de carrito dejó de ser comprable ("desactivado", decisión D6 de
 * `docs/tasks/HU-E1.md`). `STOCK_INSUFICIENTE` NO está acá a propósito: usa
 * otro código de error y no notifica.
 */
export type MotivoArticuloNoDisponible =
  | "SKU_INACTIVO"
  | "PRODUCTO_INACTIVO"
  | "NO_VISIBLE_WEB"
  | "SIN_PRECIO_VIGENTE"
  | "NO_PUBLICABLE";

/**
 * HU-E1 — Payload emitido por cada ítem afectado cuando el checkout se
 * bloquea con `422 ARTICULO_NO_DISPONIBLE`. Consumidores: Módulo F (HU-F3,
 * notificación ADVERTENCIA al dueño del carrito) y Módulo D (auditoría). Sin
 * PII ni precios (convención de exclusión de spec E §4). `sku` es el código
 * de la variante, para el placeholder de la plantilla (spec F §3.2).
 */
export interface CarritoArticuloNoDisponiblePayload {
  carrito_id: string;
  carrito_item_id: string;
  variante_sku_id: string;
  sku: string;
  motivo: MotivoArticuloNoDisponible;
  cliente_web_cuenta_id: string | null;
  /**
   * HU-E5 (task_relos.md D6) — quién lo disparó: un checkout bloqueado o el
   * aviso proactivo al ocultar / dar de baja el contenido web. Ausente =
   * `"CHECKOUT"` (retrocompatible con HU-E1).
   */
  origen?: OrigenArticuloNoDisponible;
}

export type OrigenArticuloNoDisponible = "CHECKOUT" | "VISIBILIDAD_WEB";

/**
 * HU-E5 (spec_modulo_E.md §2.5) — cambio de `ProductoWebContenido.visibilidad_web`
 * (UPDATE reversible). Solo se emite si el valor cambió (D2). Sin PII.
 */
export interface VisibilidadWebCambiadaPayload {
  producto_web_id: string;
  producto_maestro_id: string;
  visibilidad_anterior: boolean;
  visibilidad_nueva: boolean;
  motivo: string | null;
  actor_id: string;
}

/** HU-E5 (criterio 3, D1) — baja lógica del contenido web. Sin PII. */
export interface ContenidoWebBajaPayload {
  producto_web_id: string;
  producto_maestro_id: string;
  deletion_reason: string;
  actor_id: string;
}

/** HU-E11 (spec E §2.11/§4, task_relos.md D25) — alta del contenido web. Sin PII. */
export interface ContenidoWebCreadoPayload {
  producto_web_id: string;
  producto_maestro_id: string;
  titulo_comercial: string;
  descripcion: string;
  actor_id: string;
}

/** HU-E11 (D25) — edición del contenido web: solo los campos que cambiaron. */
export interface ContenidoWebEditadoPayload {
  producto_web_id: string;
  producto_maestro_id: string;
  antes: { titulo_comercial?: string; descripcion?: string };
  despues: { titulo_comercial?: string; descripcion?: string };
  actor_id: string;
}

/** HU-E11 (D25) — foto subida. `principal_anterior_id`: la que dejó de ser principal en la misma transacción. */
export interface FotoWebSubidaPayload {
  foto_id: string;
  producto_web_id: string;
  url: string;
  formato: "JPG" | "PNG" | "WEBP";
  tamano_bytes: number;
  es_principal: boolean;
  orden: number;
  principal_anterior_id: string | null;
  actor_id: string;
}

/** HU-E11 (D25) — una foto pasa a ser la principal del contenido. */
export interface FotoWebPrincipalCambiadaPayload {
  foto_id: string;
  producto_web_id: string;
  principal_anterior_id: string | null;
  actor_id: string;
}

/** HU-E11 (D25) — baja lógica de una foto. `principal_promovida_id`: la que pasó a principal en la misma transacción. */
export interface FotoWebBajaPayload {
  foto_id: string;
  producto_web_id: string;
  deletion_reason: string;
  era_principal: boolean;
  principal_promovida_id: string | null;
  actor_id: string;
}

/**
 * HU-E7 (spec E §2.7/§4) — evento sensible: orden web no abonada anulada,
 * manual (Administrador E-commerce) o automática por vencimiento de reserva.
 * `usuario_id` ausente en la vía automática (actor de sistema).
 */
export interface OrdenAnuladaPayload {
  pedido_venta_id: string;
  usuario_id?: string;
  deletion_reason: string;
  automatico: boolean;
}

/** HU-E1 (CA7) — fusión del carrito de visitante en el de la cuenta, al iniciar sesión. */
export interface CarritoFusionadoPayload {
  carrito_origen_id: string;
  carrito_destino_id: string;
  cliente_web_cuenta_id: string;
  items_fusionados: number;
}

/**
 * HU-E1 (D1/D10) — checkout parcial confirmado: reservas congeladas,
 * `PedidoVenta` RESERVADO + `PedidoVentaEcommerce` PAGO_PENDIENTE. Sin precios
 * ni PII (convención de spec E §4).
 */
export interface CheckoutIniciadoPayload {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  cliente_web_cuenta_id: string;
  carrito_id: string;
  reserva_ids: string[];
  ttl_expiracion: string;
}

/** HU-E1 (D10) — baja lógica del carrito convertido en pedido (mismo commit del checkout). */
export interface CarritoConvertidoEnPedidoPayload {
  carrito_id: string;
  pedido_venta_id: string;
  cliente_web_cuenta_id: string;
  deleted_at: string;
  deletion_reason: string;
}

/**
 * HU-E2 (CA6) — pago web aprobado y aplicado: stock VENDIDO, `PedidoVenta`
 * FACTURADO con su Factura B y `PedidoVentaEcommerce` PAGO_CONFIRMADO, en un
 * solo commit. Contrato documentado en docs/tasks/HU-E2.md §3.3. Consumidores:
 * Módulo D (auditoría), F3 (notificación al Cliente Web), HU-E6 y HU-G11
 * (owner: Rama) y HU-E12 (owner: Emir). Se emite post-commit y sin outbox:
 * los consumidores DEBEN ser idempotentes por `mercadopago_payment_id`.
 */
export interface PedidoPagoConfirmadoPayload {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  cliente_id: string;
  cliente_web_cuenta_id: string;
  mercadopago_payment_id: string;
  /** `PedidoVenta.total` (neto de cupón). */
  monto: number;
  moneda: "ARS";
  /** ISO-8601 — `date_approved` informado por Mercado Pago. */
  fecha_aprobacion: string;
  comprobante_id: string;
  cupon_aplicacion_id: string | null;
}

/**
 * HU-E2 (CA7) — pago web rechazado: reservas liberadas (PAGO_RECHAZADO),
 * `PedidoVenta` ANULADO, `PedidoVentaEcommerce` PAGO_RECHAZADO (activo) y el
 * carrito del cliente reconstruido. Contrato en docs/tasks/HU-E2.md §3.3.
 */
export interface PagoRechazadoPayload {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  cliente_id: string;
  cliente_web_cuenta_id: string;
  mercadopago_payment_id: string;
  monto: number;
  moneda: "ARS";
  fecha_rechazo: string;
  /** `status_detail` de Mercado Pago. */
  motivo_rechazo: string;
  reserva_ids: string[];
  carrito_id: string;
}

/** HU-E2 — motivos de un pago que no se aplica (o se aplica con alerta). */
export type MotivoPagoAnomalo =
  | "MONTO_DISCREPANTE"
  | "PAGO_TARDIO"
  | "PAGO_DUPLICADO"
  | "PAGO_HUERFANO"
  /** Único motivo emitido con el pago SÍ confirmado (task §3.2, Q3). */
  | "CUPON_LIMITE_EXCEDIDO";

/**
 * HU-E2 — pago informado por Mercado Pago que no se aplicó tal cual (monto
 * distinto, tardío, duplicado, huérfano) o cupón que superó su límite al
 * confirmar. Evento auditado; reembolso manual fuera de E2.
 */
export interface PagoAnomaloPayload {
  motivo: MotivoPagoAnomalo;
  mercadopago_payment_id: string;
  /** `status` de Mercado Pago (ej. "approved"). */
  estado_pago_mp: string;
  pedido_venta_ecommerce_id: string | null;
  pedido_venta_id: string | null;
  monto_informado: number;
  moneda_informada: string;
  monto_esperado: number | null;
}

/**
 * HU-E6 (spec_modulo_E.md §2.6/§4) — se emite post-COMMIT tras insertar el
 * `TransaccionPagoLog` de una transacción de pago web, aprobada o rechazada.
 * Consumidor: Módulo D (auditoría forense). Sin datos de tarjeta y sin el
 * valor de facturación: ese dato viaja SOLO cifrado (AES-256) en la tabla,
 * nunca en el payload del evento (Ley N.° 25.326).
 */
export interface TransaccionPagoRegistradaPayload {
  transaccion_id: string;
  pedido_venta_id: string;
  monto: number;
  /** `ANOMALIA`: pago no aplicado (P-R4: monto discrepante, tardío o duplicado). */
  estado_pago: "APROBADO" | "RECHAZADO" | "PENDIENTE" | "ANOMALIA";
  mercadopago_payment_id: string;
}

/**
 * HU-E6 (spec_modulo_E.md §2.6/§4, R3) — se emite cada vez que un Auditor lee
 * `datos_facturacion_cifrados` de una transacción: la consulta de un dato
 * protegido es en sí misma auditable. No transporta el valor descifrado.
 */
export interface AccesoDatoCifradoAuditadoPayload {
  transaccion_id: string;
  usuario_auditor_id: string;
  timestamp: string;
}

export interface CuentaWebEventoBase {
  cuenta_id: string;
  cliente_id: string;
  actor_tipo: "cuenta" | "usuario";
  actor_id: string;
  ocurrido_en: string;
}
export interface CuentaWebRegistradaPayload extends CuentaWebEventoBase {
  vinculacion_pendiente: boolean;
  acepta_tratamiento: true;
  acepta_comunicaciones: boolean;
}
export interface CuentaWebBloqueadaPayload extends CuentaWebEventoBase { intentos: number; bloqueada_hasta: string }
export interface CuentaWebVinculadaPayload extends CuentaWebEventoBase { acceso_reasignado: boolean }
export interface CuentaWebRecuperacionHabilitadaPayload extends CuentaWebEventoBase { expira_en: string }
export type CuentaWebPasswordRedefinidaPayload = CuentaWebEventoBase;
export interface CuentaWebBajaPayload extends CuentaWebEventoBase { motivo: string }

/**
 * HU-E4 (spec E §4) — base de los eventos de cupón. `actor_tipo`: "usuario"
 * (administración), "cuenta" (Cliente Web en el checkout) o "sistema"
 * (usuario "Canal Web": pago, rechazo, vencimiento, baja automática). Montos
 * como string decimal. Sin DNI ni datos de contacto.
 */
export interface CuponEventoBase {
  cupon_id: string;
  actor_tipo: "usuario" | "cuenta" | "sistema";
  actor_id: string;
  ocurrido_en: string;
}
export interface CuponCreadoPayload extends CuponEventoBase {
  codigo: string;
  tipo_beneficio: string;
  valor: string;
  vigente_desde: string;
  vigente_hasta: string;
  limite_uso_global: number | null;
  limite_uso_por_cliente: number;
}
export interface CuponEditadoPayload extends CuponEventoBase {
  /** Solo los campos cambiados. */
  antes: Record<string, unknown>;
  despues: Record<string, unknown>;
}
export interface CuponBajaPayload extends CuponEventoBase { motivo: string }
export interface CuponAplicadoPayload extends CuponEventoBase {
  aplicacion_id: string;
  pedido_venta_id: string;
  cliente_id: string;
  monto_descontado: string;
  reserva_hasta: string;
}
export interface CuponConsumidoPayload extends CuponEventoBase {
  aplicacion_id: string;
  pedido_venta_id: string;
}
export interface CuponAplicacionLiberadaPayload extends CuponEventoBase {
  aplicacion_id: string;
  pedido_venta_id: string;
  motivo: string;
}

/**
 * HU-F2 (spec_modulo_F.md §4) — redacción auditable de una
 * `PlantillaNotificacion`. Claves en orden estable (spec D §4.2, nota de
 * `JSON.stringify`).
 */
export interface PlantillaNotificacionRedaccion {
  asunto: string;
  cuerpo: string;
  prioridad_default: "CRITICA" | "ADVERTENCIA" | "INFORMATIVA";
}

/** HU-F2 — Payload emitido tras el alta de una `PlantillaNotificacion`. */
export interface NotificacionPlantillaCreadaPayload {
  plantilla_id: string;
  tipo_evento: string;
  usuario_id: string;
  valor_nuevo: PlantillaNotificacionRedaccion;
}

/** HU-F2 — Payload emitido tras editar la redacción de una `PlantillaNotificacion`. */
export interface NotificacionPlantillaActualizadaPayload {
  plantilla_id: string;
  tipo_evento: string;
  usuario_id: string;
  valor_anterior: PlantillaNotificacionRedaccion;
  valor_nuevo: PlantillaNotificacionRedaccion;
}

/** HU-F2 — Payload emitido tras la baja lógica de una `PlantillaNotificacion`. */
export interface NotificacionPlantillaBajaLogicaPayload {
  plantilla_id: string;
  tipo_evento: string;
  usuario_id: string;
  valor_anterior: { is_active: true };
  valor_nuevo: { is_active: false; deletion_reason: string };
}

/** HU-F2 (task §4.1-bis) — Payload emitido tras reactivar una `PlantillaNotificacion`. */
export interface NotificacionPlantillaReactivadaPayload {
  plantilla_id: string;
  tipo_evento: string;
  usuario_id: string;
  valor_anterior: { is_active: false };
  valor_nuevo: { is_active: true };
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
  /** HU-B9: se emite tras publicar una versión de la Lista de Precios de Venta (evento sensible). */
  "precio_venta:version_publicada": PrecioVentaVersionPublicadaPayload;
  /** HU-C1: se emite tras el alta NUEVA de un Cliente (nunca al recuperar uno existente por DNI). */
  "cliente:creado": ClienteCreadoPayload;
  /** HU-C4: un evento histórico confirmado durante regularización o desde la ficha. */
  "consentimiento:decision_registrada": ConsentimientoDecisionRegistradaPayload;
  /** HU-C3: se emite post-COMMIT tras mutar la ficha del cliente (alta de una DireccionCliente, §2.3). */
  "cliente:actualizado": ClienteActualizadoPayload;
  /** HU-C6: se emite post-COMMIT tras la baja lógica de un Cliente (nunca DELETE físico). */
  "cliente:baja_logica": ClienteBajaLogicaPayload;
  /** HU-B2: se emite tras la apertura de un TurnoCaja. */
  "venta:turno_abierto": VentaTurnoAbiertoPayload;
  /** HU-B2: se emite tras el cierre de un TurnoCaja (evento sensible si requiere_justificacion). */
  "venta:turno_cerrado": VentaTurnoCerradoPayload;
  /** HU-B1: se emite tras registrar una venta de mostrador con cobro multimedio. */
  "venta:registrada": VentaRegistradaPayload;
  /** HU-E12: admisión a cola Pick&Pack (evento pendiente producido por E2). */
  "ecommerce:pedido_admitido_cola": EcommercePedidoAdmitidoColaPayload;
  /** HU-E12: un operador tomó un pedido de la cola. */
  "ecommerce:pedido_tomado": EcommercePedidoTomadoPayload;
  /** HU-E12: cambio manual de prioridad de preparación. */
  "ecommerce:prioridad_preparacion_cambiada": EcommercePrioridadPreparacionCambiadaPayload;
  /** HU-E12: confirmación de una unidad preparada por escaneo. */
  "ecommerce:unidad_preparacion_confirmada": EcommerceUnidadPreparacionConfirmadaPayload;
  /** HU-E12: pedido completamente preparado, listo para retiro. */
  "ecommerce:pedido_listo_para_retiro": EcommercePedidoListoParaRetiroPayload;
  "ecommerce:plazo_retiro_por_vencer": EcommercePlazoRetiroPorVencerPayload;
  "ecommerce:pedido_cancelado": EcommercePedidoCanceladoPayload;
  "ecommerce:pedido_vencido_sin_retiro": EcommercePedidoVencidoSinRetiroPayload;
  "ecommerce:reintegro_estado_cambiado": EcommerceReintegroEstadoCambiadoPayload;
  /** HU-E3: retiro completado después del commit B/E. */
  "ecommerce:pedido_entregado": PedidoEntregadoPayload;
  /** HU-E3: intento de retiro rechazado, incluso sin token resuelto. */
  "ecommerce:retiro_rechazado": RetiroRechazadoPayload;
  /** HU-E1: se emite por cada ítem de carrito que bloquea el checkout por estar desactivado (CA4). */
  "ecommerce:carrito_articulo_no_disponible": CarritoArticuloNoDisponiblePayload;
  /** HU-E1: se emite tras fusionar el carrito de visitante con el de la cuenta (CA7). */
  "ecommerce:carrito_fusionado": CarritoFusionadoPayload;
  /** HU-E1: se emite tras el commit del checkout parcial (pedido PAGO_PENDIENTE). */
  "ecommerce:checkout_iniciado": CheckoutIniciadoPayload;
  /** HU-E1: se emite tras dar de baja lógica el carrito convertido en pedido. */
  "ecommerce:carrito_convertido_en_pedido": CarritoConvertidoEnPedidoPayload;
  /** HU-E2: se emite tras el commit de la confirmación de un pago aprobado. */
  "ecommerce:pedido_pago_confirmado": PedidoPagoConfirmadoPayload;
  /** HU-E2: se emite tras el commit del rechazo de un pago (CA7, rechazo auditado). */
  "ecommerce:pago_rechazado": PagoRechazadoPayload;
  /** HU-E2: pago de MP no aplicado (o cupón excedido al confirmar). */
  "ecommerce:pago_anomalo": PagoAnomaloPayload;
  /** HU-E6: se emite post-COMMIT tras registrar una transacción de pago web (aprobada o rechazada). */
  "ecommerce:transaccion_pago_registrada": TransaccionPagoRegistradaPayload;
  /** HU-E6: se emite cada vez que un Auditor lee el dato de facturación cifrado de una transacción. */
  "ecommerce:acceso_dato_cifrado_auditado": AccesoDatoCifradoAuditadoPayload;
  "ecommerce:cuenta_web_registrada": CuentaWebRegistradaPayload;
  "ecommerce:cuenta_web_bloqueada": CuentaWebBloqueadaPayload;
  "ecommerce:cuenta_web_vinculada": CuentaWebVinculadaPayload;
  "ecommerce:cuenta_web_recuperacion_habilitada": CuentaWebRecuperacionHabilitadaPayload;
  "ecommerce:cuenta_web_password_redefinida": CuentaWebPasswordRedefinidaPayload;
  "ecommerce:cuenta_web_baja": CuentaWebBajaPayload;
  /** HU-E4: alta de un cupón desde la administración. */
  "ecommerce:cupon_creado": CuponCreadoPayload;
  /** HU-E4: edición con cambios (solo los campos cambiados). */
  "ecommerce:cupon_editado": CuponEditadoPayload;
  /** HU-E4: baja lógica manual o automática (vencido / agotado). */
  "ecommerce:cupon_baja": CuponBajaPayload;
  /** HU-E4: el checkout creó la aplicación pendiente (reserva del uso). */
  "ecommerce:cupon_aplicado": CuponAplicadoPayload;
  /** HU-E4: pago confirmado, la aplicación pasó a confirmada. */
  "ecommerce:cupon_consumido": CuponConsumidoPayload;
  /** HU-E4: aplicación pendiente dada de baja por rechazo del pago o vencimiento del pedido. */
  "ecommerce:cupon_aplicacion_liberada": CuponAplicacionLiberadaPayload;
  /** HU-E5: se emite tras el commit de un cambio real de visibilidad web (ocultar/mostrar). */
  "ecommerce:visibilidad_web_cambiada": VisibilidadWebCambiadaPayload;
  /** HU-E5: se emite tras el commit de la baja lógica del contenido web. */
  "ecommerce:contenido_web_baja": ContenidoWebBajaPayload;
  /** HU-E11: tras el commit del alta del contenido web. */
  "ecommerce:contenido_web_creado": ContenidoWebCreadoPayload;
  /** HU-E11: tras el commit de una edición real (un no-op no emite). */
  "ecommerce:contenido_web_editado": ContenidoWebEditadoPayload;
  /** HU-E11: tras el commit del alta de una foto. */
  "ecommerce:foto_web_subida": FotoWebSubidaPayload;
  /** HU-E11: tras el commit de un cambio real de foto principal (un no-op no emite). */
  "ecommerce:foto_web_principal_cambiada": FotoWebPrincipalCambiadaPayload;
  /** HU-E11: tras el commit de la baja lógica de una foto. */
  "ecommerce:foto_web_baja": FotoWebBajaPayload;
  /** HU-E7: se emite tras el commit de la anulación de una orden web no abonada (manual o por TTL). */
  "ecommerce:orden_anulada": OrdenAnuladaPayload;
  /** HU-F2: se emite tras el alta de una PlantillaNotificacion. */
  "notificacion_plantilla:creada": NotificacionPlantillaCreadaPayload;
  /** HU-F2: se emite tras editar la redacción de una PlantillaNotificacion. */
  "notificacion_plantilla:actualizada": NotificacionPlantillaActualizadaPayload;
  /** HU-F2: se emite tras la baja lógica de una PlantillaNotificacion (nunca DELETE físico). */
  "notificacion_plantilla:baja_logica": NotificacionPlantillaBajaLogicaPayload;
  /** HU-F2 (task §4.1-bis): se emite tras reactivar una PlantillaNotificacion dada de baja. */
  "notificacion_plantilla:reactivada": NotificacionPlantillaReactivadaPayload;
  /** HU-G11: se emite post-COMMIT tras registrar el IngresoTesoreria de un cobro web. */
  "tesoreria:ingreso_web_registrado": IngresoWebRegistradoPayload;
  /** HU-G11: se emite post-COMMIT tras registrar el contra-asiento de un reintegro (HU-E13). */
  "tesoreria:contra_asiento_ingreso_registrado": ContraAsientoIngresoRegistradoPayload;
}

export type DomainEventName = keyof DomainEventMap;

/**
 * HU-F2 (spec_modulo_F.md §2.2) — registro RUNTIME de los nombres de evento
 * de `DomainEventMap`, para validar `PlantillaNotificacion.tipo_evento` en la
 * capa de servicios (el mapa es solo un tipo y no existe en runtime).
 *
 * Al agregar un evento al mapa hay que agregarlo acá: `satisfies` impide
 * nombres que no estén en el mapa, `_registroCompleto` rompe el typecheck si
 * falta alguno, y `event-types.test.ts` lo verifica contra la fuente.
 */
export const TIPOS_EVENTO_DOMINIO = [
  "producto_maestro:creado",
  "variantes:generadas",
  "producto_maestro:desactivado",
  "stock:umbrales_configurados",
  "stock:umbral_critico_alcanzado",
  "inventario:ingreso_stock_registrado",
  "stock:transferencia_iniciada",
  "stock:transferencia_recepcion_confirmada",
  "stock:transferencia_baja_logica",
  "inventario:variante_baja_logica",
  "usuario:creado",
  "usuario:baja_logica",
  "usuario:suspendido_automaticamente",
  "usuario:sesion_iniciada",
  "usuario:sesion_cerrada",
  "usuario:estado_cambiado",
  "usuario:reactivado",
  "rol:creado",
  "rol:permisos_actualizados",
  "orden_compra:creada",
  "orden_compra:estado_cambiado",
  "orden_compra:items_editados",
  "recepcion:registrada",
  "proveedor:estado_cambiado",
  "cuenta_por_pagar:estado_cambiado",
  "comprobante_proveedor:registrado",
  "comprobante_proveedor:anulado",
  "proveedor:baja_logica",
  "proveedor:legajo_editado",
  "proveedor:variacion_precio_critica",
  "proveedor:lista_precio_aprobada",
  "stock:reserva_congelada",
  "stock:reserva_liberada",
  "stock:reclasificacion_devuelto",
  "stock:reclasificacion_solicitud_creada",
  "stock:reclasificacion_solicitud_aprobada",
  "stock:reclasificacion_solicitud_rechazada",
  "producto_maestro:actualizado",
  "inventario:variante_actualizada",
  "venta:presupuesto_emitido",
  "venta:presupuesto_vencido",
  "venta:presupuesto_aceptado",
  "venta:descuento_fuera_margen",
  "venta:cambio_precio_manual",
  "venta:operacion_cuenta_corriente_registrada",
  "venta:excepcion_credito_resuelta",
  "precio_venta:version_publicada",
  "cliente:creado",
  "consentimiento:decision_registrada",
  "cliente:actualizado",
  "cliente:baja_logica",
  "venta:turno_abierto",
  "venta:turno_cerrado",
  "venta:registrada",
  "ecommerce:pedido_admitido_cola",
  "ecommerce:pedido_tomado",
  "ecommerce:prioridad_preparacion_cambiada",
  "ecommerce:unidad_preparacion_confirmada",
  "ecommerce:pedido_listo_para_retiro",
  "ecommerce:plazo_retiro_por_vencer",
  "ecommerce:pedido_cancelado",
  "ecommerce:pedido_vencido_sin_retiro",
  "ecommerce:reintegro_estado_cambiado",
  "ecommerce:pedido_entregado",
  "ecommerce:retiro_rechazado",
  "ecommerce:carrito_articulo_no_disponible",
  "ecommerce:carrito_fusionado",
  "ecommerce:checkout_iniciado",
  "ecommerce:carrito_convertido_en_pedido",
  "ecommerce:pedido_pago_confirmado",
  "ecommerce:pago_rechazado",
  "ecommerce:pago_anomalo",
  "ecommerce:transaccion_pago_registrada",
  "ecommerce:acceso_dato_cifrado_auditado",
  "ecommerce:cuenta_web_registrada",
  "ecommerce:cuenta_web_bloqueada",
  "ecommerce:cuenta_web_vinculada",
  "ecommerce:cuenta_web_recuperacion_habilitada",
  "ecommerce:cuenta_web_password_redefinida",
  "ecommerce:cuenta_web_baja",
  "ecommerce:cupon_creado",
  "ecommerce:cupon_editado",
  "ecommerce:cupon_baja",
  "ecommerce:cupon_aplicado",
  "ecommerce:cupon_consumido",
  "ecommerce:cupon_aplicacion_liberada",
  "ecommerce:visibilidad_web_cambiada",
  "ecommerce:contenido_web_baja",
  "ecommerce:contenido_web_creado",
  "ecommerce:contenido_web_editado",
  "ecommerce:foto_web_subida",
  "ecommerce:foto_web_principal_cambiada",
  "ecommerce:foto_web_baja",
  "ecommerce:orden_anulada",
  "notificacion_plantilla:creada",
  "notificacion_plantilla:actualizada",
  "notificacion_plantilla:baja_logica",
  "notificacion_plantilla:reactivada",
  "tesoreria:ingreso_web_registrado",
  "tesoreria:contra_asiento_ingreso_registrado",
] as const satisfies readonly DomainEventName[];

/** Falla el typecheck si `TIPOS_EVENTO_DOMINIO` no cubre todas las claves de `DomainEventMap`. */
type EventosFaltantes = Exclude<DomainEventName, (typeof TIPOS_EVENTO_DOMINIO)[number]>;
export const _registroCompleto: [EventosFaltantes] extends [never] ? true : never = true;
