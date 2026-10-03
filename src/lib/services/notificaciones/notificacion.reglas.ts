/**
 * HU-F3 — Reglas puras del Motor de Notificaciones (spec_modulo_F.md §2.3/§3.2).
 * Sin Prisma ni `server-only`: importables desde `node --test`.
 *
 * Introducido como MÍNIMO por HU-E1 (clave + render) y completado por HU-F3:
 * el núcleo del Motor (`ejecutarMotorNotificaciones`) vive acá con sus
 * dependencias de datos inyectadas (`PuertosMotorNotificaciones`), para poder
 * probarlo con un "prisma" falso. `notificacion.service.ts` lo conecta a Prisma.
 */
import { createHash } from "node:crypto";

export type PrioridadNotificacionValor = "CRITICA" | "ADVERTENCIA" | "INFORMATIVA";

export type VariablesNotificacion = Record<string, string | number | null | undefined>;

/**
 * Texto genérico cuando el evento no tiene `PlantillaNotificacion` activa
 * (spec F §2.2): un evento nunca queda sin notificar por falta de plantilla.
 * Neutral a propósito: lo leen tanto el personal interno como el Cliente Web
 * (HU-F3 task §8, Punto abierto 8 — decidido). Re-exportado por
 * `notificacion.service.ts`, que es su punto de consumo documentado.
 */
export const DEFAULT_NOTIFICATION_TEXT = {
  asunto: "Tenés una novedad",
  cuerpo: "Hay una novedad que requiere tu atención.",
} as const;

/**
 * Clave de idempotencia de una notificación para un evento SIN `evento_id`
 * propio (spec F §2.3): `sha256(tipo_evento:clave_origen:destinatario_id)`.
 * Misma fórmula que los fixtures de `prisma/seed.ts` (bloque HU-F3). Qué se usa
 * como `clave_origen` lo decide cada fila de la tabla de suscripción
 * (`notificacion.listener.ts`) — task §8, Punto abierto 5.
 */
export function calcularClaveIdempotencia(
  tipoEvento: string,
  claveOrigen: string,
  destinatarioId: string,
): string {
  return createHash("sha256").update(`${tipoEvento}:${claveOrigen}:${destinatarioId}`).digest("hex");
}

/**
 * Reemplaza `{{variable}}` por su valor (spec F §3.2): `replaceAll`, sin motor
 * de templating. Una variable sin valor se sustituye por cadena vacía, nunca
 * lanza — una plantilla mal configurada no tumba el procesamiento del evento.
 */
export function renderizarPlantilla(texto: string, variables: VariablesNotificacion): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_coincidencia, nombre: string) => {
    const valor = variables[nombre];
    return valor === null || valor === undefined ? "" : String(valor);
  });
}

/** `P2002` de Prisma (violación de `@unique`), sin importar `@prisma/client`. */
export function esViolacionUnicidad(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// ── Motor ─────────────────────────────────────────────────────────────────────

export interface DestinatariosEvento {
  /** Usuarios puntuales. Se filtra solo `is_active` (el suspendido también recibe). */
  usuario_ids?: readonly string[];
  /** `Rol.nombre` (task §8, Punto abierto 9 — decidido): se expande al generar. */
  roles?: readonly string[];
  cuenta_cliente_web_ids?: readonly string[];
}

export interface GenerarNotificacionesInput {
  tipo_evento: string;
  /** Identificador de la OCURRENCIA del evento (entra en la clave de idempotencia). */
  clave_origen: string;
  variables: VariablesNotificacion;
  /** Prioridad de la tabla de suscripción (spec F §3.3), si no hay plantilla. */
  prioridad_default: PrioridadNotificacionValor;
  destinatarios: DestinatariosEvento;
}

export interface PlantillaParaMotor {
  id: string;
  asunto: string;
  cuerpo: string;
  prioridad_default: PrioridadNotificacionValor;
}

export interface NotificacionNueva {
  plantilla_id: string | null;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
  prioridad: PrioridadNotificacionValor;
  clave_idempotencia: string;
  usuario_destinatario_id?: string;
  cuenta_cliente_web_destinatario_id?: string;
}

/** Acceso a datos del Motor — implementado con Prisma en `notificacion.service.ts`. */
export interface PuertosMotorNotificaciones {
  /** De `ids`, los `Usuario` con `is_active` (sin filtrar `estado`). */
  usuariosActivos(ids: string[]): Promise<string[]>;
  /** `UsuarioRol` activos → `Rol` activo con `nombre` en `roles` → `Usuario` activo. */
  usuariosPorRoles(roles: string[]): Promise<string[]>;
  plantillaActiva(tipoEvento: string): Promise<PlantillaParaMotor | null>;
  crearNotificacion(data: NotificacionNueva): Promise<void>;
}

export interface ResultadoMotor {
  creadas: number;
  duplicadas: number;
  fallidas: number;
}

type DestinatarioResuelto =
  | { tipo: "USUARIO"; id: string }
  | { tipo: "CLIENTE_WEB"; id: string };

/**
 * Núcleo de `generarNotificaciones()` (task §4.8). NUNCA lanza: cualquier
 * error se loguea con contexto y se devuelve contado en `fallidas`. Sin
 * transacción global — cada destinatario es independiente y la idempotencia
 * permite reprocesar el evento sin duplicar.
 */
export async function ejecutarMotorNotificaciones(
  input: GenerarNotificacionesInput,
  puertos: PuertosMotorNotificaciones,
  log: (mensaje: string, error?: unknown) => void = console.error,
): Promise<ResultadoMotor> {
  const resultado: ResultadoMotor = { creadas: 0, duplicadas: 0, fallidas: 0 };
  const contexto = `[notificaciones] ${input.tipo_evento} (origen ${input.clave_origen})`;

  let destinatarios: DestinatarioResuelto[];
  let plantilla: PlantillaParaMotor | null;
  try {
    // 1. Destinatarios: explícitos + expansión de roles, sin duplicados.
    const usuarioIds = new Set<string>();
    const explicitos = [...new Set(input.destinatarios.usuario_ids ?? [])];
    if (explicitos.length > 0) {
      for (const id of await puertos.usuariosActivos(explicitos)) usuarioIds.add(id);
    }
    const roles = [...new Set(input.destinatarios.roles ?? [])];
    if (roles.length > 0) {
      for (const id of await puertos.usuariosPorRoles(roles)) usuarioIds.add(id);
    }
    destinatarios = [
      ...[...usuarioIds].map((id) => ({ tipo: "USUARIO" as const, id })),
      ...[...new Set(input.destinatarios.cuenta_cliente_web_ids ?? [])].map((id) => ({
        tipo: "CLIENTE_WEB" as const,
        id,
      })),
    ];
    if (destinatarios.length === 0) return resultado;

    // 2. Plantilla (HU-F2) o texto por defecto.
    plantilla = await puertos.plantillaActiva(input.tipo_evento);
  } catch (error) {
    log(`${contexto}: no se pudieron resolver destinatarios/plantilla`, error);
    return resultado;
  }

  const asunto = renderizarPlantilla(
    plantilla?.asunto ?? DEFAULT_NOTIFICATION_TEXT.asunto,
    input.variables,
  );
  const cuerpo = renderizarPlantilla(
    plantilla?.cuerpo ?? DEFAULT_NOTIFICATION_TEXT.cuerpo,
    input.variables,
  );
  const prioridad = plantilla?.prioridad_default ?? input.prioridad_default;

  // 3. Una fila por destinatario final; P2002 = no-op; otro error no corta.
  for (const destinatario of destinatarios) {
    try {
      await puertos.crearNotificacion({
        plantilla_id: plantilla?.id ?? null,
        tipo_evento: input.tipo_evento,
        asunto,
        cuerpo,
        prioridad,
        clave_idempotencia: calcularClaveIdempotencia(
          input.tipo_evento,
          input.clave_origen,
          destinatario.id,
        ),
        ...(destinatario.tipo === "USUARIO"
          ? { usuario_destinatario_id: destinatario.id }
          : { cuenta_cliente_web_destinatario_id: destinatario.id }),
      });
      resultado.creadas += 1;
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        resultado.duplicadas += 1;
        continue;
      }
      resultado.fallidas += 1;
      log(`${contexto}: falló la notificación para ${destinatario.tipo} ${destinatario.id}`, error);
    }
  }
  return resultado;
}

// ── Bandeja ───────────────────────────────────────────────────────────────────

/** Shape de paginación del spec F §2.3 (task §8, Punto abierto 7: se copia). */
export function armarPaginacion(total: number, page: number, pageSize: number) {
  return {
    total,
    pagina_actual: page,
    total_paginas: Math.max(1, Math.ceil(total / pageSize)),
    por_pagina: pageSize,
  };
}
