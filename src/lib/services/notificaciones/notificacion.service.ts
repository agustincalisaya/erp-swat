/**
 * HU-F3 — Motor de Notificaciones internas (spec_modulo_F.md §2.3).
 *
 * MÍNIMO introducido por HU-E1 (aprobado por el owner): solo la generación de
 * una notificación para un Cliente Web a partir de un evento de dominio. Lo
 * invoca exclusivamente `notificacion.listener.ts` (spec F: ningún módulo de
 * negocio crea `Notificacion` directo). Pendiente para el owner de HU-F3:
 * destinatarios internos y expansión por rol, bandejas (`/api/notificaciones`,
 * `/api/tienda/notificaciones`), marcar leída/archivar.
 */
import "server-only";

import { Prisma, type PrioridadNotificacion } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  calcularClaveIdempotencia,
  renderizarPlantilla,
} from "@/lib/services/notificaciones/notificacion.reglas";

/**
 * Texto genérico cuando el evento no tiene `PlantillaNotificacion` activa
 * (spec F §2.2): un evento nunca queda sin notificar por falta de plantilla.
 */
export const DEFAULT_NOTIFICATION_TEXT = {
  asunto: "Tenés una novedad",
  cuerpo: "Hay una novedad sobre tu cuenta. Ingresá a la tienda para ver el detalle.",
} as const;

export interface GenerarNotificacionClienteWebInput {
  tipo_evento: string;
  /** Registro de origen del evento — entra en la clave de idempotencia. */
  registro_id: string;
  cuenta_cliente_web_id: string;
  /** Prioridad default del evento (tabla spec F §3.3) si no hay plantilla. */
  prioridad_default: PrioridadNotificacion;
  variables: Record<string, string | number | null | undefined>;
}

export type ResultadoGeneracion = "CREADA" | "DUPLICADA";

/**
 * Persiste UNA notificación interna para un Cliente Web. Idempotente: si ya
 * existe una con la misma `clave_idempotencia` (P2002) es un no-op — un mismo
 * evento nunca notifica dos veces al mismo destinatario (spec F §2.3).
 * Asunto/cuerpo se persisten ya resueltos (editar la plantilla después no
 * altera notificaciones emitidas).
 */
export async function generarNotificacionClienteWeb(
  input: GenerarNotificacionClienteWebInput,
): Promise<ResultadoGeneracion> {
  const plantilla = await prisma.plantillaNotificacion.findFirst({
    where: { tipo_evento: input.tipo_evento, is_active: true, deleted_at: null },
    select: { id: true, asunto: true, cuerpo: true, prioridad_default: true },
  });

  const asunto = plantilla?.asunto ?? DEFAULT_NOTIFICATION_TEXT.asunto;
  const cuerpo = plantilla?.cuerpo ?? DEFAULT_NOTIFICATION_TEXT.cuerpo;

  try {
    await prisma.notificacion.create({
      data: {
        plantilla_id: plantilla?.id ?? null,
        tipo_evento: input.tipo_evento,
        asunto: renderizarPlantilla(asunto, input.variables),
        cuerpo: renderizarPlantilla(cuerpo, input.variables),
        prioridad: plantilla?.prioridad_default ?? input.prioridad_default,
        clave_idempotencia: calcularClaveIdempotencia(
          input.tipo_evento,
          input.registro_id,
          input.cuenta_cliente_web_id,
        ),
        cuenta_cliente_web_destinatario_id: input.cuenta_cliente_web_id,
      },
    });
    return "CREADA";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "DUPLICADA";
    }
    throw error;
  }
}
