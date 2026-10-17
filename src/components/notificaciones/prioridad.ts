/** Prioridades de notificación (enum `PrioridadNotificacion`, spec_modulo_F.md §2.2). */
export const PRIORIDADES = ["CRITICA", "ADVERTENCIA", "INFORMATIVA"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = {
  CRITICA: "Crítica",
  ADVERTENCIA: "Advertencia",
  INFORMATIVA: "Informativa",
};
