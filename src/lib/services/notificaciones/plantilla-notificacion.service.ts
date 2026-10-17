/**
 * HU-F2 — Plantillas de notificación interna (spec_modulo_F.md §2.2,
 * docs/tasks/HU-F2.md §4).
 *
 * Única capa con lógica de negocio de plantillas: Route Handlers
 * (`app/api/notificaciones/plantillas/**`) y Server Actions
 * (`app/(dashboard)/administracion/notificaciones/actions.ts`) son wrappers
 * finos que validan con Zod y delegan acá (spec F §1).
 *
 * Reglas:
 *  - Sin `DELETE` físico (RULES.md Regla N.° 1, spec F §3.4): la baja es un
 *    `UPDATE` de los 4 campos de soft delete y la reactivación los limpia.
 *  - `tipo_evento` es inmutable tras el alta y `@unique` a nivel tabla
 *    (incluidas las dadas de baja): una plantilla por evento en toda su
 *    historia. Una dada de baja se reactiva (task §4.1-bis), nunca se recrea.
 *  - Los eventos `notificacion_plantilla:*` se emiten post-COMMIT; el
 *    `AuditLog` lo escribe exclusivamente `audit-log.listener.ts`.
 *  - HU-F2 solo persiste el texto: los placeholders `{{variable}}` los
 *    resuelve el Motor de Notificaciones (HU-F3, spec F §3.2).
 */
import "server-only";

import { Prisma, type PrioridadNotificacion } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { TIPOS_EVENTO_DOMINIO } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  CrearPlantillaNotificacionInput,
  DarDeBajaPlantillaNotificacionInput,
  EditarPlantillaNotificacionInput,
} from "@/lib/schemas/notificaciones.schema";

/** Permiso único de alta, edición, baja y reactivación (spec F §2.2). */
export const PERMISO_ADMINISTRAR_PLANTILLAS = "notificaciones:administrar_plantillas";

/**
 * PROPUESTA (no está en el spec) — task HU-F2 §8, Punto abierto 4 RESUELTO,
 * opción (i). Eventos declarados en `spec_modulo_E.md` §4 (y en la tabla de
 * consumidores de spec F §3.3) que todavía no existen en `DomainEventMap`.
 * Se aceptan como `tipo_evento` para que se puedan configurar sus plantillas
 * antes de que el evento se emita (el seed ya siembra dos de ellas).
 *
 * BORRAR esta lista cuando HU-E12/HU-E13 agreguen
 * `ecommerce:pedido_listo_para_retiro`, `ecommerce:pedido_vencido_sin_retiro`
 * y `ecommerce:plazo_retiro_por_vencer` al `DomainEventMap` real (y, con él,
 * a `TIPOS_EVENTO_DOMINIO`).
 */
const TIPOS_EVENTO_DECLARADOS_SPRINT_4 = [
  "ecommerce:pedido_listo_para_retiro",
  "ecommerce:pedido_vencido_sin_retiro",
  "ecommerce:plazo_retiro_por_vencer",
] as const;

/** Registro de `tipo_evento` admitidos, ordenado (alimenta también el select de la UI). */
export const TIPOS_EVENTO_PLANTILLA: readonly string[] = [
  ...TIPOS_EVENTO_DOMINIO,
  ...TIPOS_EVENTO_DECLARADOS_SPRINT_4,
].sort();

const TIPOS_EVENTO_ADMITIDOS = new Set<string>(TIPOS_EVENTO_PLANTILLA);

const MENSAJE_NO_ENCONTRADA = "La plantilla indicada no existe";
const MENSAJE_DADA_DE_BAJA =
  "La plantilla está dada de baja. Reactivala antes de modificarla.";

function esP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de resultado
// ──────────────────────────────────────────────────────────────────────────────

export interface PlantillaNotificacionCreada {
  plantilla_id: string;
  tipo_evento: string;
  prioridad_default: PrioridadNotificacion;
}

export interface PlantillaNotificacionEditada {
  plantilla_id: string;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
  prioridad_default: PrioridadNotificacion;
}

export interface PlantillaNotificacionDadaDeBaja {
  plantilla_id: string;
  tipo_evento: string;
  is_active: false;
}

export interface PlantillaNotificacionReactivada {
  plantilla_id: string;
  tipo_evento: string;
  is_active: true;
}

export interface PlantillaNotificacionActiva {
  id: string;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
  prioridad_default: PrioridadNotificacion;
}

export interface PlantillaNotificacionListado {
  id: string;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
  prioridad_default: PrioridadNotificacion;
  is_active: boolean;
  deleted_at: string | null;
  deletion_reason: string | null;
  updated_at: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// §4.1 — Alta
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Alta de una plantilla. `tipo_evento` debe estar en el registro de eventos
 * (`TIPOS_EVENTO_PLANTILLA`) → si no, `422 TIPO_EVENTO_DESCONOCIDO`.
 *
 * La unicidad la garantiza el `@unique` de `tipo_evento` (sin pre-chequeo,
 * así no hay carrera): ante `P2002` se lee la fila existente —incluida una
 * dada de baja, que es justamente lo que hay que distinguir— y se traduce a
 * `409 PLANTILLA_YA_EXISTE` (activa) o `409 PLANTILLA_DADA_DE_BAJA` (con el
 * endpoint de reactivación en el mensaje).
 */
export async function crearPlantillaNotificacion(
  input: CrearPlantillaNotificacionInput,
  usuarioId: string,
): Promise<PlantillaNotificacionCreada> {
  if (!TIPOS_EVENTO_ADMITIDOS.has(input.tipo_evento)) {
    throw new ServiceError(
      "TIPO_EVENTO_DESCONOCIDO",
      `"${input.tipo_evento}" no es un tipo de evento de dominio registrado`,
    );
  }

  let plantilla: { id: string; tipo_evento: string; prioridad_default: PrioridadNotificacion };
  try {
    plantilla = await prisma.plantillaNotificacion.create({
      data: {
        tipo_evento: input.tipo_evento,
        asunto: input.asunto,
        cuerpo: input.cuerpo,
        prioridad_default: input.prioridad_default,
      },
      select: { id: true, tipo_evento: true, prioridad_default: true },
    });
  } catch (error) {
    if (!esP2002(error)) throw error;

    const existente = await prisma.plantillaNotificacion.findUnique({
      where: { tipo_evento: input.tipo_evento },
      select: { id: true, is_active: true },
    });
    if (existente && !existente.is_active) {
      throw new ServiceError(
        "PLANTILLA_DADA_DE_BAJA",
        `La plantilla de "${input.tipo_evento}" está dada de baja. Reactivala con PATCH /api/notificaciones/plantillas/${existente.id}/reactivar en lugar de crear una nueva.`,
      );
    }
    throw new ServiceError(
      "PLANTILLA_YA_EXISTE",
      `Ya existe una plantilla activa para "${input.tipo_evento}"`,
    );
  }

  domainEventBus.emit("notificacion_plantilla:creada", {
    plantilla_id: plantilla.id,
    tipo_evento: plantilla.tipo_evento,
    usuario_id: usuarioId,
    valor_nuevo: {
      asunto: input.asunto,
      cuerpo: input.cuerpo,
      prioridad_default: input.prioridad_default,
    },
  });

  return {
    plantilla_id: plantilla.id,
    tipo_evento: plantilla.tipo_evento,
    prioridad_default: plantilla.prioridad_default,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §4.1-bis — Reactivación
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reactiva una plantilla dada de baja (task §4.1-bis): limpia los 4 campos de
 * soft delete, sin tocar la redacción. `findFirst` distingue inexistente
 * (`404`) de ya activa (`409 PLANTILLA_YA_ACTIVA`); el `updateMany` con guarda
 * `is_active: false` cubre la carrera de dos reactivaciones concurrentes.
 */
export async function reactivarPlantillaNotificacion(
  plantillaId: string,
  usuarioId: string,
): Promise<PlantillaNotificacionReactivada> {
  const tipoEvento = await prisma.$transaction(async (tx) => {
    const actual = await tx.plantillaNotificacion.findFirst({
      where: { id: plantillaId },
      select: { tipo_evento: true, is_active: true },
    });
    if (!actual) throw new ServiceError("PLANTILLA_NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);
    if (actual.is_active) {
      throw new ServiceError("PLANTILLA_YA_ACTIVA", "La plantilla ya está activa");
    }

    const cambio = await tx.plantillaNotificacion.updateMany({
      where: { id: plantillaId, is_active: false },
      data: { is_active: true, deleted_at: null, deleted_by: null, deletion_reason: null },
    });
    if (cambio.count === 0) {
      // Otra request la reactivó entre el `findFirst` y el `updateMany`.
      throw new ServiceError("PLANTILLA_YA_ACTIVA", "La plantilla ya está activa");
    }

    return actual.tipo_evento;
  });

  domainEventBus.emit("notificacion_plantilla:reactivada", {
    plantilla_id: plantillaId,
    tipo_evento: tipoEvento,
    usuario_id: usuarioId,
    valor_anterior: { is_active: false },
    valor_nuevo: { is_active: true },
  });

  return { plantilla_id: plantillaId, tipo_evento: tipoEvento, is_active: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// §4.2 — Edición
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Edita la redacción (`asunto`, `cuerpo`, `prioridad_default`) de una
 * plantilla activa. `tipo_evento` nunca llega acá (`.strict()` del schema).
 * Una dada de baja → `409 PLANTILLA_DADA_DE_BAJA`: la edición no reactiva.
 *
 * El `update` usa la misma guarda `is_active: true` (`updateMany`) para que
 * una baja concurrente no quede editada por detrás. Si los valores enviados
 * son idénticos a los actuales igual se actualiza y se emite el evento
 * (task §8, Punto abierto 8). `valor_nuevo` se relee dentro de la misma
 * transacción, después del `UPDATE`.
 */
export async function editarPlantillaNotificacion(
  plantillaId: string,
  input: EditarPlantillaNotificacionInput,
  usuarioId: string,
): Promise<PlantillaNotificacionEditada> {
  const resultado = await prisma.$transaction(async (tx) => {
    const actual = await tx.plantillaNotificacion.findFirst({
      where: { id: plantillaId },
      select: {
        tipo_evento: true,
        is_active: true,
        asunto: true,
        cuerpo: true,
        prioridad_default: true,
      },
    });
    if (!actual) throw new ServiceError("PLANTILLA_NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);
    if (!actual.is_active) throw new ServiceError("PLANTILLA_DADA_DE_BAJA", MENSAJE_DADA_DE_BAJA);

    const cambio = await tx.plantillaNotificacion.updateMany({
      where: { id: plantillaId, is_active: true },
      data: {
        ...(input.asunto !== undefined ? { asunto: input.asunto } : {}),
        ...(input.cuerpo !== undefined ? { cuerpo: input.cuerpo } : {}),
        ...(input.prioridad_default !== undefined
          ? { prioridad_default: input.prioridad_default }
          : {}),
      },
    });
    if (cambio.count === 0) {
      // Otra request la dio de baja entre el `findFirst` y el `updateMany`.
      throw new ServiceError("PLANTILLA_DADA_DE_BAJA", MENSAJE_DADA_DE_BAJA);
    }

    const nueva = await tx.plantillaNotificacion.findUniqueOrThrow({
      where: { id: plantillaId },
      select: { asunto: true, cuerpo: true, prioridad_default: true },
    });

    return {
      tipo_evento: actual.tipo_evento,
      // Orden de claves estable (spec D §4.2, nota de `JSON.stringify`).
      valor_anterior: {
        asunto: actual.asunto,
        cuerpo: actual.cuerpo,
        prioridad_default: actual.prioridad_default,
      },
      valor_nuevo: {
        asunto: nueva.asunto,
        cuerpo: nueva.cuerpo,
        prioridad_default: nueva.prioridad_default,
      },
    };
  });

  domainEventBus.emit("notificacion_plantilla:actualizada", {
    plantilla_id: plantillaId,
    tipo_evento: resultado.tipo_evento,
    usuario_id: usuarioId,
    valor_anterior: resultado.valor_anterior,
    valor_nuevo: resultado.valor_nuevo,
  });

  return {
    plantilla_id: plantillaId,
    tipo_evento: resultado.tipo_evento,
    ...resultado.valor_nuevo,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §4.3 — Baja lógica
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Baja lógica (RULES.md Regla N.° 1) — patrón de `anularComprobanteProveedor()`
 * (HU-H9). No bloquea notificaciones futuras: el Motor (HU-F3) cae a
 * `DEFAULT_NOTIFICATION_TEXT` para ese `tipo_evento` (spec F §2.2).
 */
export async function darDeBajaPlantillaNotificacion(
  plantillaId: string,
  input: DarDeBajaPlantillaNotificacionInput,
  usuarioId: string,
): Promise<PlantillaNotificacionDadaDeBaja> {
  const ahora = new Date();

  const tipoEvento = await prisma.$transaction(async (tx) => {
    const actual = await tx.plantillaNotificacion.findFirst({
      where: { id: plantillaId },
      select: { tipo_evento: true, is_active: true },
    });
    if (!actual) throw new ServiceError("PLANTILLA_NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);
    if (!actual.is_active) {
      throw new ServiceError("PLANTILLA_YA_DADA_DE_BAJA", "La plantilla ya fue dada de baja");
    }

    const cambio = await tx.plantillaNotificacion.updateMany({
      where: { id: plantillaId, is_active: true },
      data: {
        is_active: false,
        deleted_at: ahora,
        deleted_by: usuarioId,
        deletion_reason: input.deletion_reason,
      },
    });
    if (cambio.count === 0) {
      // Otra request la dio de baja entre el `findFirst` y el `updateMany`.
      throw new ServiceError("PLANTILLA_YA_DADA_DE_BAJA", "La plantilla ya fue dada de baja");
    }

    return actual.tipo_evento;
  });

  domainEventBus.emit("notificacion_plantilla:baja_logica", {
    plantilla_id: plantillaId,
    tipo_evento: tipoEvento,
    usuario_id: usuarioId,
    valor_anterior: { is_active: true },
    valor_nuevo: { is_active: false, deletion_reason: input.deletion_reason },
  });

  return { plantilla_id: plantillaId, tipo_evento: tipoEvento, is_active: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// §4.4 — Lecturas
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Contrato para HU-F3: plantilla activa de un `tipo_evento`, o `null` si no
 * hay (el Motor cae entonces a `DEFAULT_NOTIFICATION_TEXT`). Función interna,
 * sin endpoint ni permiso.
 *
 * Nota para HU-F3: `generarNotificacionClienteWeb()` (`notificacion.service.ts`)
 * hace hoy esta misma consulta inline; debería pasar a consumir esta función.
 * No se modificó acá para mantener el diff de HU-F2 acotado (task §4.4).
 */
export async function obtenerPlantillaActivaPorEvento(
  tipoEvento: string,
): Promise<PlantillaNotificacionActiva | null> {
  return prisma.plantillaNotificacion.findFirst({
    where: { tipo_evento: tipoEvento, is_active: true, deleted_at: null },
    select: { id: true, tipo_evento: true, asunto: true, cuerpo: true, prioridad_default: true },
  });
}

/**
 * Listado para la pantalla de gestión (RSC, task §6). Devuelve activas Y
 * dadas de baja: excepción documentada a RULES.md Regla N.° 1 — quien
 * administra plantillas necesita ver las dadas de baja para reactivarlas
 * (task §6, pregunta F2 resuelta). El permiso lo revalida la RSC.
 */
export async function listarPlantillasNotificacion(): Promise<PlantillaNotificacionListado[]> {
  const filas = await prisma.plantillaNotificacion.findMany({
    orderBy: { tipo_evento: "asc" },
    select: {
      id: true,
      tipo_evento: true,
      asunto: true,
      cuerpo: true,
      prioridad_default: true,
      is_active: true,
      deleted_at: true,
      deletion_reason: true,
      updated_at: true,
    },
  });

  return filas.map((fila) => ({
    ...fila,
    deleted_at: fila.deleted_at?.toISOString() ?? null,
    updated_at: fila.updated_at.toISOString(),
  }));
}
