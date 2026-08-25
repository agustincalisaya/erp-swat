/**
 * @module audit-log.listener
 * @description ÚNICA vía de escritura a `AuditLog` de todo el Módulo D
 * (spec_modulo_D.md §4.1) — consume los 8 eventos de dominio y llama
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

  domainEventBus.on("stock:transferencia_recibida", (payload) => {
    void registrarAuditLog({
      usuario_id: payload.usuario_id,
      accion: "TRANSFERENCIA_RECIBIDA",
      tabla_afectada: "transferencias_stock",
      registro_id: payload.transferencia_id,
      ip: "internal-event",
      valor_anterior: { estado: "EN_TRANSITO" },
      valor_nuevo: { estado: "RECIBIDA", ...payload },
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
}
