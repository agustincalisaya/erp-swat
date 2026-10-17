/**
 * HU-D6 (Módulo D) — Notificación interna F3 de las alertas (spec_modulo_F.md §6,
 * task_relos.md D11, D21, D22).
 *
 * Módulo puro (runner nativo de Node, imports relativos con `.ts`): decide si
 * una transición notifica, con qué prioridad y con qué variables de texto para
 * la plantilla de HU-F2. Lo usa `notificacion.listener.ts`.
 *
 *  - `alerta_desvio:creada` siempre notifica; `alerta_desvio:nivel_cambiado`
 *    solo si escala a CRITICA; `alerta_desvio:resuelta` nunca.
 *  - Destinatarios: usuarios activos con el permiso `alertas:leer`.
 *  - `clave_origen = evento_id`: un replay del mismo evento no duplica.
 *  - Prioridad = severidad de la alerta, por mapeo explícito.
 *  - Variables sin IDs: indicador, mes legible, severidad y detalle numérico.
 *    `Notificacion` no tiene campo de enlace: la ruta del panel va en el texto
 *    de la plantilla.
 */
import type { GenerarNotificacionesInput, PrioridadNotificacionValor } from "../notificaciones/notificacion.reglas.ts";
import { esEscaladaACritica, type IndicadorAlerta, type SeveridadAlerta } from "./alerta-desvio.reglas.ts";
import {
  detalleLegible,
  ETIQUETA_INDICADOR,
  ETIQUETA_SEVERIDAD,
  etiquetaMes,
  PERMISO_ALERTAS_LEER,
} from "./alerta-desvio.presentacion.ts";

export { etiquetaMes };

/** Permiso del panel y de la recepción de estas notificaciones (D13). */
export const PERMISO_LEER_ALERTAS = PERMISO_ALERTAS_LEER;

/** Ruta del panel, citada en el texto de las plantillas sembradas. */
export const RUTA_PANEL_ALERTAS = "/tesoreria/alertas";

/**
 * Severidad de la alerta → prioridad de la notificación. Mapeo explícito por
 * nombre (no por posición): hoy coinciden literal a literal, y si un enum
 * cambiara, el `Record` exhaustivo hace fallar `tsc`.
 */
const PRIORIDAD_POR_SEVERIDAD: Record<SeveridadAlerta, PrioridadNotificacionValor> = {
  CRITICA: "CRITICA",
  ADVERTENCIA: "ADVERTENCIA",
  INFORMATIVA: "INFORMATIVA",
};

export function prioridadDeSeveridad(severidad: SeveridadAlerta): PrioridadNotificacionValor {
  return PRIORIDAD_POR_SEVERIDAD[severidad];
}

/** Lo que el armado necesita de un payload `alerta_desvio:*` (estructural, sin importar eventos). */
export interface TransicionAlertaNotificable {
  evento_id: string;
  indicador: IndicadorAlerta;
  referencia: string;
  severidad_anterior: SeveridadAlerta | null;
  severidad_nueva: SeveridadAlerta | null;
  detalle: {
    cantidad_actual: number | null;
    punto_pedido: number | null;
    porcentaje_egresos: number | null;
    umbral_aplicado: number | null;
  };
}

/** Variables de las plantillas: `{{indicador}}`, `{{descripcion}}`, `{{severidad}}`, `{{severidad_anterior}}`, `{{detalle}}`. */
export function variablesNotificacionAlerta(t: TransicionAlertaNotificable): Record<string, string> {
  const detalle = detalleLegible({ indicador: t.indicador, ...t.detalle });
  return {
    indicador: ETIQUETA_INDICADOR[t.indicador],
    descripcion:
      t.indicador === "EGRESOS_SOBRE_INGRESOS"
        ? `Egresos sobre ingresos de ${etiquetaMes(t.referencia)}`
        : ETIQUETA_INDICADOR[t.indicador],
    severidad: t.severidad_nueva ? ETIQUETA_SEVERIDAD[t.severidad_nueva] : "",
    severidad_anterior: t.severidad_anterior ? ETIQUETA_SEVERIDAD[t.severidad_anterior] : "",
    detalle,
  };
}

/**
 * Plantillas HU-F2 de las alertas (D22). Las siembra `seedSprint5Cluster6`
 * (upsert con `update: {}`: si el Administrador de Plataforma las edita, el
 * seed no las pisa). `prioridad_default` es obligatoria en el modelo, pero la
 * prioridad efectiva la informa la suscripción (D21).
 */
export const PLANTILLAS_NOTIFICACION_ALERTA = [
  {
    tipo_evento: "alerta_desvio:creada",
    asunto: "Alerta {{severidad}}: {{indicador}}",
    cuerpo: `{{descripcion}}. Nivel {{severidad}}: {{detalle}}. Revisala en Tesorería › Alertas (${RUTA_PANEL_ALERTAS}).`,
    prioridad_default: "ADVERTENCIA",
  },
  {
    tipo_evento: "alerta_desvio:nivel_cambiado",
    asunto: "Alerta escalada a {{severidad}}: {{indicador}}",
    cuerpo: `{{descripcion}} pasó de {{severidad_anterior}} a {{severidad}}: {{detalle}}. Revisala en Tesorería › Alertas (${RUTA_PANEL_ALERTAS}).`,
    prioridad_default: "CRITICA",
  },
] as const satisfies readonly { tipo_evento: string; asunto: string; cuerpo: string; prioridad_default: PrioridadNotificacionValor }[];

export type GeneracionNotificacionAlerta = Omit<GenerarNotificacionesInput, "tipo_evento" | "prioridad_default">;

/**
 * Notificación de una transición, o `null` si no corresponde notificar: solo
 * el alta (`severidad_anterior = null`) o el ascenso a CRITICA, nunca una
 * resolución (`severidad_nueva = null`) ni otro cambio de nivel.
 */
export function notificacionDeAlerta(t: TransicionAlertaNotificable): GeneracionNotificacionAlerta | null {
  if (t.severidad_nueva === null) return null;
  const esAlta = t.severidad_anterior === null;
  if (!esAlta && !esEscaladaACritica(t.severidad_anterior, t.severidad_nueva)) return null;
  return {
    clave_origen: t.evento_id,
    prioridad: prioridadDeSeveridad(t.severidad_nueva),
    variables: variablesNotificacionAlerta(t),
    destinatarios: { permisos: [PERMISO_LEER_ALERTAS] },
  };
}
