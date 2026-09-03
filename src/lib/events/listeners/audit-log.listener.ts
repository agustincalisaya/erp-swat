/**
 * @module audit-log.listener
 * @description ÚNICA vía de escritura a `AuditLog` de todo el Módulo D
 * (spec_modulo_D.md §4.1) — consume los 10 eventos de dominio y llama
 * `registrarAuditLog()`. Ningún service invoca `registrarAuditLog()` de
 * forma directa; todos emiten al bus y este listener reacciona.
 *
 * Historial de esta regla (para que quede explícito por qué está unificado
 * así y no se reintroduzca la inconsistencia): en las tareas de HU-1/HU-2
 * (`usuario.service.ts`), `crearUsuario`/`desactivarUsuario`/
 * `cambiarEstadoUsuario` originalmente llamaban `registrarAuditLog()` de
 * forma DIRECTA dentro de su propia `$transaction` — un patrón distinto al
 * ya fijado para `sesion.service.ts` (HU-3), que nunca escribe directo por
 * decisión explícita. `task_cali_auditoria_forense.md` (ronda de corrección
 * posterior a D.3) unificó ambos bajo un solo patrón: los 6 eventos pasan
 * por acá, ningún service escribe `AuditLog` por su cuenta.
 *
 * Se registra una única vez, vía el auto-registro de `domain-event-bus.ts`
 * (import dinámico apenas se crea el singleton del bus) — NO vía
 * `src/instrumentation.ts`. Ver el docstring de `domain-event-bus.ts` para
 * el detalle de por qué ese mecanismo no sirve en este proyecto.
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { registrarAuditLog } from "@/lib/services/auditoria/audit-log.service";

let registrado = false;

export function iniciarAuditLogListener(): void {
  if (registrado) return;
  registrado = true;

  domainEventBus.on("stock:transferencia_iniciada", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "TRANSFERENCIA_DESPACHADA",
      tabla_afectada: "transferencias_stock",
      registro_id: payload.transferencia_id,
      ip: "internal-event",
      valor_nuevo: payload,
    });
  });

  // HU-A11 — recepción total o parcial de una TransferenciaStock. La acción
  // distingue ambos casos (`accion` no es un valor fijo como en el resto de
  // los listeners de este archivo) porque `estado_transferencia` recién se
  // conoce en el payload, no en el nombre del evento — un único evento cubre
  // las dos transiciones posibles (spec de la tarea, punto 4).
  domainEventBus.on("stock:transferencia_recepcion_confirmada", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: payload.estado_transferencia === "RECIBIDA" ? "TRANSFERENCIA_RECIBIDA" : "RECEPCION_PARCIAL",
      tabla_afectada: "transferencias_stock",
      registro_id: payload.transferencia_id,
      ip: "internal-event",
      valor_anterior: { estado: "EN_TRANSITO" },
      valor_nuevo: { estado: payload.estado_transferencia, ...payload },
    });
  });

  domainEventBus.on("stock:transferencia_baja_logica", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "DELETE_LOGICO",
      tabla_afectada: "transferencias_stock",
      registro_id: payload.transferencia_id,
      ip: "internal-event",
      valor_anterior: { is_active: true },
      valor_nuevo: {
        is_active: false,
        deleted_at: payload.deleted_at,
        deletion_reason: payload.deletion_reason,
      },
    });
  });

  domainEventBus.on("usuario:creado", (payload) => {
    // `UsuarioCreadoPayload` ampliado (ronda de corrección post-unificación)
    // para recuperar el detalle forense completo que la llamada directa
    // original registraba — nunca incluye password/hash/salt (payload ya
    // los excluye por diseño, ver `UsuarioCreadoPayload`).
    void registrarAuditLog({
      usuario_id: payload.creado_por,
      accion: "CREATE",
      tabla_afectada: "usuarios",
      registro_id: payload.usuario_id,
      ip: payload.ip,
      valor_anterior: null,
      valor_nuevo: {
        nombre_usuario: payload.nombre_usuario,
        email: payload.email,
        nombre_completo: payload.nombre_completo,
        estado: payload.estado,
        rol_ids: payload.rol_ids_asignados,
      },
    });
  });

  domainEventBus.on("usuario:baja_logica", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.dado_de_baja_por,
      accion: "DELETE_LOGICO",
      tabla_afectada: "usuarios",
      registro_id: payload.usuario_id,
      ip: payload.ip,
      valor_anterior: { is_active: true, estado: "ACTIVO" },
      valor_nuevo: {
        is_active: false,
        estado: "INACTIVO",
        deletion_reason: payload.deletion_reason,
      },
    });
  });

  domainEventBus.on("usuario:estado_cambiado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.cambiado_por,
      accion: "UPDATE_ESTADO",
      tabla_afectada: "usuarios",
      registro_id: payload.usuario_id,
      ip: payload.ip,
      valor_anterior: { estado: payload.estado_anterior },
      valor_nuevo: { estado: payload.estado_nuevo, motivo: payload.motivo },
    });
  });

  domainEventBus.on("usuario:reactivado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.reactivado_por,
      accion: "REACTIVACION",
      tabla_afectada: "usuarios",
      registro_id: payload.usuario_id,
      ip: payload.ip,
      valor_anterior: { estado: "INACTIVO", is_active: false },
      valor_nuevo: {
        estado: "ACTIVO",
        is_active: true,
        motivo_reactivacion: payload.motivo_reactivacion,
      },
    });
  });

  domainEventBus.on("usuario:suspendido_automaticamente", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "SUSPENSION_AUTOMATICA",
      tabla_afectada: "usuarios",
      registro_id: payload.usuario_id,
      ip: payload.ip,
      valor_nuevo: {
        intentos_fallidos: payload.intentos_fallidos,
        bloqueado_hasta: payload.bloqueado_hasta,
      },
    });
  });

  domainEventBus.on("usuario:sesion_iniciada", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "LOGIN_EXITOSO",
      tabla_afectada: "sesiones",
      registro_id: payload.sesion_id,
      ip: payload.ip,
      valor_nuevo: { user_agent: payload.user_agent },
    });
  });

  domainEventBus.on("usuario:sesion_cerrada", (payload) => {
    void (async () => {
      // `usuario:sesion_cerrada` no trae `ip` en su payload (logout/revocación
      // pueden dispararse sin un request HTTP directo del titular, ej. baja
      // lógica ejecutada por un Administrador) — se recupera la IP de origen
      // ya persistida en `Sesion.ip_origen`, ya que `AuditLog.ip` es NOT NULL.
      const sesion = await prisma.sesion.findUnique({
        where: { id: payload.sesion_id },
        select: { ip_origen: true },
      });

      await registrarAuditLog({
        usuario_id: payload.usuario_id,
        accion: "SESION_CERRADA",
        tabla_afectada: "sesiones",
        registro_id: payload.sesion_id,
        ip: sesion?.ip_origen ?? "unknown",
        valor_nuevo: { motivo: payload.motivo },
      });
    })();
  });

  domainEventBus.on("rol:creado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.creado_por,
      accion: "CREATE",
      tabla_afectada: "roles",
      registro_id: payload.rol_id,
      ip: payload.ip,
      valor_anterior: null,
      valor_nuevo: {
        nombre: payload.nombre,
        descripcion: payload.descripcion,
        permiso_ids: payload.permiso_ids_asignados,
      },
    });
  });

  domainEventBus.on("rol:permisos_actualizados", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.actualizado_por,
      accion: "UPDATE_PERMISOS",
      tabla_afectada: "roles",
      registro_id: payload.rol_id,
      ip: payload.ip,
      valor_anterior: { permisos_removidos: payload.permisos_removidos },
      valor_nuevo: { permisos_agregados: payload.permisos_agregados },
    });
  });

  // HU-A6 — baja lógica de VarianteSKU (spec_modulo_A.md §4, spec_modulo_D.md §4).
  // `tabla_afectada` usa el `@@map` en minúsculas (`variantes_sku`), misma
  // convención que el resto de los listeners (`usuarios`, `roles`, `sesiones`).
  // El service nunca llama `registrarAuditLog()` directo — solo emite el evento.
  domainEventBus.on("inventario:variante_baja_logica", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "DELETE_LOGICO",
      tabla_afectada: "variantes_sku",
      registro_id: payload.variante_sku_id,
      ip: payload.ip,
      valor_anterior: { is_active: true },
      valor_nuevo: {
        is_active: false,
        deletion_reason: payload.deletion_reason,
        stock_total_al_momento: payload.stock_total_al_momento,
      },
    });
  });

  // HU-A7 (ronda de corrección) — alta de ProductoMaestro. El payload no
  // trae `ip` (el service de catálogo no la captura); se usa el sentinel
  // "unknown" ya establecido en este archivo para el mismo problema (ver
  // `usuario:sesion_cerrada`), ya que `AuditLog.ip` es NOT NULL. El service
  // nunca llama `registrarAuditLog()` directo — solo emite el evento.
  domainEventBus.on("producto_maestro:creado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "CREATE",
      tabla_afectada: "productos_maestros",
      registro_id: payload.producto_maestro_id,
      ip: "unknown",
      valor_anterior: null,
      valor_nuevo: { nombre: payload.nombre },
    });
  });

  // HU-A7 (ronda de corrección) — generación en lote de VarianteSKU. Evento
  // batch por diseño (un único evento con el conteo total, nunca uno por
  // variante individual) — `registro_id` referencia el ProductoMaestro
  // padre, no existe un id de variante individual en este payload.
  // `ip: "unknown"` por el mismo motivo que el resto de los bloques de
  // Módulo A en este archivo.
  domainEventBus.on("variantes:generadas", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "CREATE",
      tabla_afectada: "variantes_sku",
      registro_id: payload.producto_maestro_id,
      ip: "unknown",
      valor_anterior: null,
      valor_nuevo: { cantidad_generadas: payload.cantidad_generadas },
    });
  });

  // HU-A7 (ronda de corrección) — baja lógica de ProductoMaestro. Mismo
  // patrón que `inventario:variante_baja_logica` (arriba): `valor_anterior`
  // asume `is_active: true` porque el payload no trae snapshot previo.
  // `ip: "unknown"` — este payload tampoco la incluye.
  domainEventBus.on("producto_maestro:desactivado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "DELETE_LOGICO",
      tabla_afectada: "productos_maestros",
      registro_id: payload.producto_maestro_id,
      ip: "unknown",
      valor_anterior: { is_active: true },
      valor_nuevo: {
        is_active: false,
        deletion_reason: payload.deletion_reason,
      },
    });
  });

  // HU-A8 — edición de atributos operativos de ProductoMaestro.
  domainEventBus.on("producto_maestro:actualizado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "UPDATE",
      tabla_afectada: "productos_maestros",
      registro_id: payload.producto_maestro_id,
      ip: "unknown", // mismo sentinel que el resto de eventos producto_maestro:* — el payload no captura IP
      valor_anterior: payload.valor_anterior,
      valor_nuevo: payload.valor_nuevo,
    });
  });

  // HU-A8 — edición de atributos operativos de VarianteSKU.
  domainEventBus.on("inventario:variante_actualizada", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "UPDATE",
      tabla_afectada: "variantes_sku",
      registro_id: payload.variante_sku_id,
      ip: payload.ip,
      valor_anterior: payload.valor_anterior,
      valor_nuevo: payload.valor_nuevo,
    });
  });

  // Configuración de umbrales de reposición sobre StockDeposito (HU-7,
  // `actualizarUmbrales()`). El payload solo trae los valores nuevos (no
  // hay snapshot "antes"), de ahí `valor_anterior: null`. `registro_id`
  // usa `stock_deposito_id` (la fila realmente afectada) en vez de
  // `variante_sku_id`/`deposito_id`, que quedan como contexto en
  // `valor_nuevo`. `ip: "unknown"` — mismo motivo que el resto de esta
  // sección.
  domainEventBus.on("stock:umbrales_configurados", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "UPDATE",
      tabla_afectada: "stock_depositos",
      registro_id: payload.stock_deposito_id,
      ip: "unknown",
      valor_anterior: null,
      valor_nuevo: {
        variante_sku_id: payload.variante_sku_id,
        deposito_id: payload.deposito_id,
        punto_pedido: payload.punto_pedido,
        stock_seguridad: payload.stock_seguridad,
      },
    });
  });

  // HU-2 — ingreso de mercadería por escaneo (crea MovimientoStock tipo
  // INGRESO + incrementa StockDeposito.cantidad). `accion: "INGRESO"` (no
  // "CREATE") a propósito: es el valor que ya existe como opción
  // seleccionable en el filtro "Tipo de movimiento" de
  // `TablaForenseInventario.tsx` (`TIPOS_MOVIMIENTO`), que se traduce 1:1 a
  // `AuditLog.accion` en la consulta de `auditoria.service.ts` — usar
  // "CREATE" dejaría ese filtro sin poder encontrar nunca estos registros.
  // `ip: "unknown"` — mismo motivo que el resto de esta sección.
  domainEventBus.on("inventario:ingreso_stock_registrado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "INGRESO",
      tabla_afectada: "movimientos_stock",
      registro_id: payload.movimiento_id,
      ip: "unknown",
      valor_anterior: null,
      valor_nuevo: {
        deposito_destino_id: payload.deposito_destino_id,
        items: payload.items,
      },
    });
  });

  // HU-H3 — alta de OrdenCompra en BORRADOR (spec_modulo_H.md §2.4). El
  // service nunca llama `registrarAuditLog()` directo: emite el evento y este
  // listener reacciona (misma regla de unificación que el resto del módulo).
  // `tabla_afectada` usa el `@@map` en minúsculas (`ordenes_compra`).
  // `ip: "internal-event"` — mismo sentinel que los listeners de
  // transferencia, que también emiten post-COMMIT desde un service sin
  // request HTTP directo asociado.
  domainEventBus.on("orden_compra:creada", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.creada_por_id,
      accion: "CREATE",
      tabla_afectada: "ordenes_compra",
      registro_id: payload.orden_compra_id,
      ip: "internal-event",
      valor_anterior: null,
      valor_nuevo: {
        numero_orden: payload.numero_orden,
        proveedor_id: payload.proveedor_id,
        estado: payload.estado,
        lista_precio_version_id: payload.lista_precio_version_id,
        items: payload.items,
      },
    });
  });

  // HU-H3 — transición de estado de OrdenCompra (spec_modulo_H.md §2.5).
  // `CANCELAR` es baja lógica → `DELETE_LOGICO`; el resto → `UPDATE_ESTADO`,
  // mismo criterio que `usuario:estado_cambiado` / `stock:transferencia_baja_logica`.
  domainEventBus.on("orden_compra:estado_cambiado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.cambiado_por,
      accion: payload.accion === "CANCELAR" ? "DELETE_LOGICO" : "UPDATE_ESTADO",
      tabla_afectada: "ordenes_compra",
      registro_id: payload.orden_compra_id,
      ip: "internal-event",
      valor_anterior: { estado: payload.estado_anterior },
      valor_nuevo: {
        estado: payload.estado_nuevo,
        accion: payload.accion,
        ...(payload.fecha_entrega_comprometida
          ? { fecha_entrega_comprometida: payload.fecha_entrega_comprometida }
          : {}),
        ...(payload.deletion_reason
          ? { deletion_reason: payload.deletion_reason }
          : {}),
      },
    });
  });

  // HU-H3 — edición de ítems de una OrdenCompra en BORRADOR (CA2). Los ítems
  // quitados se dan de baja lógica en el service (nunca DELETE físico); acá
  // solo se registra el diff completo en el ledger como `UPDATE`.
  domainEventBus.on("orden_compra:items_editados", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.editada_por,
      accion: "UPDATE",
      tabla_afectada: "ordenes_compra",
      registro_id: payload.orden_compra_id,
      ip: "internal-event",
      valor_anterior: { items: payload.items_anteriores },
      valor_nuevo: {
        numero_orden: payload.numero_orden,
        lista_precio_version_id: payload.lista_precio_version_id,
        items: payload.items_nuevos,
      },
    });
  });

  // HU-H4 — alta de la recepción y transición física de la OC, post-COMMIT.
  domainEventBus.on("recepcion:registrada", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.recibida_por_id,
      accion: "CREATE",
      tabla_afectada: "recepciones",
      registro_id: payload.recepcion_id,
      ip: "internal-event",
      valor_anterior: { estado_orden_compra: payload.estado_anterior_oc },
      valor_nuevo: {
        orden_compra_id: payload.orden_compra_id,
        numero_orden: payload.numero_orden,
        deposito_destino_id: payload.deposito_destino_id,
        fecha_recepcion: payload.fecha_recepcion,
        estado_orden_compra: payload.estado_nuevo_oc,
      },
    });
  });

  // HU-H5 — transición de estado de Proveedor (spec_modulo_H.md §3.2
  // automático; §2.2 manual reutiliza el mismo evento, se distingue por
  // `origen`). Emitido post-COMMIT desde `evaluacion.service.ts` cuando el
  // puntaje de evaluación cae por debajo del umbral y el proveedor se
  // suspende automáticamente.
  //
  // SIEMPRE mapea a `UPDATE_ESTADO`, nunca a `DELETE_LOGICO`: suspender un
  // proveedor NO es baja lógica — `is_active` no cambia, el proveedor sigue
  // existiendo y consultable, solo cambia `estado`. A diferencia de
  // `orden_compra:estado_cambiado` (donde `CANCELAR` sí es baja lógica), acá
  // ninguna transición lo es, así que no hay ternario: todo valor de
  // `estado_nuevo` va a `UPDATE_ESTADO`.
  //
  // `usuario_id` puede ser `null` (`origen: "AUTOMATICO"`, sin un usuario
  // humano que dispare la acción); `registrarAuditLog` y `AuditLog.usuario_id`
  // ya lo aceptan (`string | null`). `ip: "internal-event"` — mismo sentinel
  // que `orden_compra:*`, que también emite post-COMMIT desde un service sin
  // request HTTP directo asociado.
  domainEventBus.on("proveedor:estado_cambiado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "UPDATE_ESTADO",
      tabla_afectada: "proveedores",
      registro_id: payload.proveedor_id,
      ip: "internal-event",
      valor_anterior: { estado: payload.estado_anterior },
      valor_nuevo: {
        estado: payload.estado_nuevo,
        origen: payload.origen,
        motivo: payload.motivo,
      },
    });
  });

  // HU-H1 — baja lógica de Proveedor (spec_modulo_H.md §3.5 · RULES.md §1).
  // El service (`darDeBajaProveedor()`) NUNCA llama `registrarAuditLog()`
  // directo: emite `proveedor:baja_logica` post-COMMIT y este listener
  // reacciona (misma regla de unificación que el resto del módulo).
  // `valor_anterior` asume `is_active: true` porque el payload no trae
  // snapshot previo (mismo criterio que `inventario:variante_baja_logica`).
  domainEventBus.on("proveedor:baja_logica", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "DELETE_LOGICO",
      tabla_afectada: "proveedores",
      registro_id: payload.proveedor_id,
      ip: "internal-event",
      valor_anterior: { is_active: true },
      valor_nuevo: {
        is_active: false,
        deletion_reason: payload.motivo,
      },
    });
  });

  // HU-H1 — edición del legajo de Proveedor (`editarProveedor()`). Registra
  // SOLO la metadata del cambio (`campos_editados`): el payload jamás trae
  // datos bancarios, ni en claro ni cifrados (spec §3.3/§4) — el listener no
  // sanitiza, el emisor ya excluyó todo dato sensible.
  domainEventBus.on("proveedor:legajo_editado", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "UPDATE",
      tabla_afectada: "proveedores",
      registro_id: payload.proveedor_id,
      ip: "internal-event",
      valor_anterior: null,
      valor_nuevo: { campos_editados: payload.campos_editados },
    });
  });

  // HU-A10 — congelamiento de Reserva (spec_modulo_A.md §2.9). El service
  // (`reserva.service.ts`) nunca llama `registrarAuditLog()` directo: emite
  // el evento y este listener reacciona (misma regla de unificación que el
  // resto del proyecto). `tabla_afectada` usa el `@@map` en minúsculas
  // (`reservas`); `ip: "internal-event"` — mismo sentinel que los listeners
  // que emiten post-COMMIT desde un service sin request HTTP directo.
  domainEventBus.on("stock:reserva_congelada", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "RESERVA_CONGELADA",
      tabla_afectada: "reservas",
      registro_id: payload.reserva_id,
      ip: "internal-event",
      valor_anterior: null,
      valor_nuevo: {
        variante_sku_id: payload.variante_sku_id,
        deposito_id: payload.deposito_id,
        origen_reserva: payload.origen_reserva,
        cantidad: payload.cantidad,
      },
    });
  });

  // HU-A10 — liberación de Reserva por venta confirmada o por TTL vencido.
  // `usuario_id: null`: la vía TTL la dispara el cron (agente del sistema) y
  // el payload no transporta actor (ver `ReservaLiberadaPayload`); la vía se
  // distingue por `motivo_liberacion`. `registrarAuditLog` y
  // `AuditLog.usuario_id` aceptan `null`.
  domainEventBus.on("stock:reserva_liberada", (payload) => {
    void registrarAuditLog({
      usuario_id: null,
      accion: "RESERVA_LIBERADA",
      tabla_afectada: "reservas",
      registro_id: payload.reserva_id,
      ip: "internal-event",
      valor_anterior: { fecha_fin_reserva: null },
      valor_nuevo: {
        motivo_liberacion: payload.motivo_liberacion,
        variante_sku_id: payload.variante_sku_id,
        cantidad: payload.cantidad,
      },
    });
  });
}
