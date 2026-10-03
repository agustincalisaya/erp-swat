/**
 * HU-F3 — Motor de Notificaciones internas (spec_modulo_F.md §2.3, task HU-F3 §4).
 *
 * Dos partes:
 *  - Motor: `generarNotificaciones()` — lo invoca EXCLUSIVAMENTE
 *    `notificacion.listener.ts` (spec F: ningún módulo de negocio crea
 *    `Notificacion` directo). El núcleo puro está en `notificacion.reglas.ts`;
 *    acá solo se le inyecta Prisma. `generarNotificacionClienteWeb()` es el
 *    wrapper que introdujo HU-E1 y se conserva para no romper E1/E2.
 *  - Bandeja: listar, marcar leída (una/todas) y archivar, siempre filtrando
 *    por el `destinatario` que el caller resolvió desde la SESIÓN (nunca desde
 *    query/body). Ajena o inexistente → `404 NOTIFICACION_NO_ENCONTRADA`
 *    (task §8, Punto abierto 8 — decidido: no confirmar existencia).
 *
 * HU-F3 no emite eventos de auditoría (task §2.2, spec F §4): leer/archivar es
 * una acción de bandeja personal, no un evento de negocio.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import type { ListarNotificacionesQuery } from "@/lib/schemas/notificaciones.schema";
import {
  armarPaginacion,
  DEFAULT_NOTIFICATION_TEXT,
  ejecutarMotorNotificaciones,
  type GenerarNotificacionesInput,
  type PrioridadNotificacionValor,
  type PuertosMotorNotificaciones,
  type ResultadoMotor,
  type VariablesNotificacion,
} from "@/lib/services/notificaciones/notificacion.reglas";
import { obtenerPlantillaActivaPorEvento } from "@/lib/services/notificaciones/plantilla-notificacion.service";

export { DEFAULT_NOTIFICATION_TEXT };
export type { GenerarNotificacionesInput, ResultadoMotor };

// ── Motor ─────────────────────────────────────────────────────────────────────

const puertosPrisma: PuertosMotorNotificaciones = {
  async usuariosActivos(ids) {
    const filas = await prisma.usuario.findMany({
      where: { id: { in: ids }, is_active: true },
      select: { id: true },
    });
    return filas.map((fila) => fila.id);
  },
  async usuariosPorRoles(roles) {
    const filas = await prisma.usuarioRol.findMany({
      where: {
        is_active: true,
        rol: { nombre: { in: roles }, is_active: true },
        usuario: { is_active: true },
      },
      select: { usuario_id: true },
    });
    return filas.map((fila) => fila.usuario_id);
  },
  async plantillaActiva(tipoEvento) {
    return obtenerPlantillaActivaPorEvento(tipoEvento);
  },
  async crearNotificacion(data) {
    await prisma.notificacion.create({ data });
  },
};

/**
 * Motor (task §4.8): resuelve destinatarios (usuarios puntuales + roles
 * expandidos + cuentas web), aplica la plantilla de HU-F2 o
 * `DEFAULT_NOTIFICATION_TEXT` y persiste UNA fila por destinatario con el
 * texto ya resuelto. Idempotente por `clave_idempotencia` (P2002 = no-op).
 * Nunca lanza: los errores se loguean y se cuentan en `fallidas`.
 */
export async function generarNotificaciones(
  input: GenerarNotificacionesInput,
): Promise<ResultadoMotor> {
  return ejecutarMotorNotificaciones(input, puertosPrisma);
}

export interface GenerarNotificacionClienteWebInput {
  tipo_evento: string;
  /** Registro de origen del evento — entra en la clave de idempotencia. */
  registro_id: string;
  cuenta_cliente_web_id: string;
  /** Prioridad default del evento (tabla spec F §3.3) si no hay plantilla. */
  prioridad_default: PrioridadNotificacionValor;
  variables: VariablesNotificacion;
}

export type ResultadoGeneracion = "CREADA" | "DUPLICADA" | "FALLIDA";

/**
 * Wrapper de HU-E1/E2 sobre `generarNotificaciones()`: una notificación para
 * un único Cliente Web. Se conserva la firma original (task HU-F3, D2).
 */
export async function generarNotificacionClienteWeb(
  input: GenerarNotificacionClienteWebInput,
): Promise<ResultadoGeneracion> {
  const resultado = await generarNotificaciones({
    tipo_evento: input.tipo_evento,
    clave_origen: input.registro_id,
    variables: input.variables,
    prioridad_default: input.prioridad_default,
    destinatarios: { cuenta_cliente_web_ids: [input.cuenta_cliente_web_id] },
  });
  if (resultado.creadas > 0) return "CREADA";
  if (resultado.duplicadas > 0) return "DUPLICADA";
  return "FALLIDA";
}

// ── Bandeja ───────────────────────────────────────────────────────────────────

/** Destinatario resuelto server-side desde la sesión (task §3). */
export type DestinatarioNotificacion =
  | { tipo: "USUARIO"; usuario_id: string }
  | { tipo: "CLIENTE_WEB"; cuenta_cliente_web_id: string };

export interface NotificacionBandejaItem {
  notificacion_id: string;
  tipo_evento: string;
  prioridad: PrioridadNotificacionValor;
  asunto: string;
  cuerpo: string;
  leida_at: Date | null;
  created_at: Date;
}

export interface BandejaNotificaciones {
  items: NotificacionBandejaItem[];
  no_leidas: number;
  paginacion: ReturnType<typeof armarPaginacion>;
}

export interface NotificacionLeida {
  notificacion_id: string;
  leida_at: Date | null;
}

export interface NotificacionesMarcadas {
  actualizadas: number;
}

export interface NotificacionArchivada {
  notificacion_id: string;
  is_active: false;
}

function filtroDestinatario(destinatario: DestinatarioNotificacion): Prisma.NotificacionWhereInput {
  return destinatario.tipo === "USUARIO"
    ? { usuario_destinatario_id: destinatario.usuario_id }
    : { cuenta_cliente_web_destinatario_id: destinatario.cuenta_cliente_web_id };
}

/** Autor de la baja lógica: el propio destinatario (usuario o cuenta web). */
function idDestinatario(destinatario: DestinatarioNotificacion): string {
  return destinatario.tipo === "USUARIO"
    ? destinatario.usuario_id
    : destinatario.cuenta_cliente_web_id;
}

function noEncontrada(): ServiceError {
  return new ServiceError("NOTIFICACION_NO_ENCONTRADA", "La notificación no existe");
}

/**
 * Bandeja del destinatario (task §4.2): solo activas, CRITICA primero y luego
 * más recientes. El enum de Postgres ordena por declaración
 * (`CRITICA, ADVERTENCIA, INFORMATIVA`), así que `prioridad asc` cumple el
 * "no alfabético" del spec. `no_leidas` es independiente de los filtros.
 */
export async function listarNotificaciones(
  destinatario: DestinatarioNotificacion,
  query: ListarNotificacionesQuery,
): Promise<BandejaNotificaciones> {
  const base: Prisma.NotificacionWhereInput = { ...filtroDestinatario(destinatario), is_active: true };
  const where: Prisma.NotificacionWhereInput = {
    ...base,
    ...(query.solo_no_leidas && { leida_at: null }),
    ...(query.prioridad && { prioridad: query.prioridad }),
  };

  const [filas, total, noLeidas] = await Promise.all([
    prisma.notificacion.findMany({
      where,
      orderBy: [{ prioridad: "asc" }, { created_at: "desc" }],
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        tipo_evento: true,
        prioridad: true,
        asunto: true,
        cuerpo: true,
        leida_at: true,
        created_at: true,
      },
    }),
    prisma.notificacion.count({ where }),
    prisma.notificacion.count({ where: { ...base, leida_at: null } }),
  ]);

  return {
    items: filas.map(({ id, ...resto }) => ({ notificacion_id: id, ...resto })),
    no_leidas: noLeidas,
    paginacion: armarPaginacion(total, query.page, query.page_size),
  };
}

/**
 * Marca leída (task §4.3). Idempotente: si ya estaba leída devuelve su
 * `leida_at` original. No filtra `is_active` (task §8, Punto 11).
 * @throws {ServiceError} NOTIFICACION_NO_ENCONTRADA (inexistente o ajena)
 */
export async function marcarNotificacionLeida(
  id: string,
  destinatario: DestinatarioNotificacion,
): Promise<NotificacionLeida> {
  const propia = { id, ...filtroDestinatario(destinatario) };
  await prisma.notificacion.updateMany({
    where: { ...propia, leida_at: null },
    data: { leida_at: new Date() },
  });
  const fila = await prisma.notificacion.findFirst({
    where: propia,
    select: { id: true, leida_at: true },
  });
  if (!fila) throw noEncontrada();
  return { notificacion_id: fila.id, leida_at: fila.leida_at };
}

/** Marca leídas todas las activas no leídas del destinatario (task §4.4). */
export async function marcarTodasLeidas(
  destinatario: DestinatarioNotificacion,
): Promise<NotificacionesMarcadas> {
  const { count } = await prisma.notificacion.updateMany({
    where: { ...filtroDestinatario(destinatario), is_active: true, leida_at: null },
    data: { leida_at: new Date() },
  });
  return { actualizadas: count };
}

/**
 * Archiva = baja lógica del lado del destinatario (task §4.5): `is_active`,
 * `deleted_at`, `deleted_by`, sin `deletion_reason`. Idempotente.
 * @throws {ServiceError} NOTIFICACION_NO_ENCONTRADA (inexistente o ajena)
 */
export async function archivarNotificacion(
  id: string,
  destinatario: DestinatarioNotificacion,
): Promise<NotificacionArchivada> {
  const propia = { id, ...filtroDestinatario(destinatario) };
  const { count } = await prisma.notificacion.updateMany({
    where: { ...propia, is_active: true },
    data: { is_active: false, deleted_at: new Date(), deleted_by: idDestinatario(destinatario) },
  });
  if (count === 0) {
    const existe = await prisma.notificacion.findFirst({ where: propia, select: { id: true } });
    if (!existe) throw noEncontrada();
  }
  return { notificacion_id: id, is_active: false };
}
