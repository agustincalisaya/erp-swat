/** Reductor puro: solo eventos coherentes acreditan decisiones. El id ordena la
 * presentación, nunca resuelve decisiones simultáneas incompatibles. */
export type FinalidadC4 = "VENTA_ASISTIDA" | "COMUNICACIONES_COMERCIALES";
export type EstadoC4 = "PENDIENTE_REGULARIZACION" | "ACEPTADO" | "RECHAZADO" | "REVOCADO" | "ERROR_INTEGRIDAD";
export type TipoEventoC4 = "ACEPTACION_INICIAL" | "RECHAZO_COMERCIAL" | "SOLICITUD_REVOCACION" | "REVOCACION_EJECUTADA" | "SOLICITUD_RECHAZADA" | "NUEVA_ACEPTACION";

export interface ConsentimientoHecho {
  id: string; cliente_id: string; alcance: FinalidadC4 | "AMBOS"; finalidad: string;
  fecha_consentimiento: Date; origen: "LEGADO_SIN_ACREDITACION_EXPRESA" | "EXPRESO";
  registrado_por_id: string | null; registrado_por_nombre?: string | null; is_active: boolean;
}
export interface EventoHecho {
  id: string; cliente_id: string; consentimiento_id: string | null; tipo: TipoEventoC4;
  alcance: FinalidadC4 | "AMBOS"; finalidad: string; fecha_evento: Date;
  usuario_id: string; usuario_nombre?: string | null; solicitud_evento_id: string | null;
  motivo: string | null; is_active: boolean;
}
export interface HistorialC4 {
  id: string; clase: "EVENTO" | "LEGADO"; alcance: FinalidadC4 | "AMBOS";
  resultado: string; fecha: Date; actor: string | null;
  consentimiento_id: string | null; solicitud_evento_id: string | null; motivo: string | null;
}
export interface EstadoFinalidadC4 {
  alcance: FinalidadC4; estado: EstadoC4; fecha_ultima_manifestacion: Date | null;
  usuario_ultima_manifestacion: string | null; solicitudes_pendientes: HistorialC4[];
  consentimiento_vigente_id: string | null; finalidad_vigente: string | null;
  ultima_revocacion_evento_id: string | null; fecha_ultimo_evento: Date | null;
}
export interface LecturaConsentimientosC4 {
  estados: Record<FinalidadC4, EstadoFinalidadC4>; historial: HistorialC4[];
}

const FINALIDADES: FinalidadC4[] = ["VENTA_ASISTIDA", "COMUNICACIONES_COMERCIALES"];
const aplica = (alcance: FinalidadC4 | "AMBOS", finalidad: FinalidadC4) => alcance === finalidad || alcance === "AMBOS";

export function reducirConsentimientos(
  clienteId: string, consentimientos: ConsentimientoHecho[], eventos: EventoHecho[],
): LecturaConsentimientosC4 {
  const porId = new Map(consentimientos.map((fila) => [fila.id, fila]));
  const eventosPorId = new Map(eventos.map((fila) => [fila.id, fila]));
  const historial: HistorialC4[] = [
    ...consentimientos.filter((fila) => fila.origen === "LEGADO_SIN_ACREDITACION_EXPRESA").map((fila): HistorialC4 => ({
      id: fila.id, clase: "LEGADO", alcance: fila.alcance,
      resultado: "Legado: no acredita aceptación expresa", fecha: fila.fecha_consentimiento,
      actor: fila.registrado_por_nombre ?? null, consentimiento_id: fila.id,
      solicitud_evento_id: null, motivo: null,
    })),
    ...eventos.map((fila): HistorialC4 => ({
      id: fila.id, clase: "EVENTO", alcance: fila.alcance, resultado: fila.tipo,
      fecha: fila.fecha_evento, actor: fila.usuario_nombre ?? fila.usuario_id,
      consentimiento_id: fila.consentimiento_id, solicitud_evento_id: fila.solicitud_evento_id,
      motivo: fila.motivo,
    })),
  ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.id.localeCompare(b.id));

  const estados = {} as Record<FinalidadC4, EstadoFinalidadC4>;
  for (const alcance of FINALIDADES) {
    const filas = consentimientos.filter((fila) => aplica(fila.alcance, alcance));
    const hechos = eventos.filter((fila) => aplica(fila.alcance, alcance))
      .sort((a, b) => a.fecha_evento.getTime() - b.fecha_evento.getTime() || a.id.localeCompare(b.id));
    let estado: EstadoC4 = "PENDIENTE_REGULARIZACION";
    let fecha: Date | null = null;
    let usuario: string | null = null;
    let consentimientoActual: string | null = null;
    let finalidadActual: string | null = null;
    let ultimaRevocacion: string | null = null;
    let error = filas.some((fila) => fila.cliente_id !== clienteId ||
      (fila.origen === "EXPRESO" && (fila.alcance === "AMBOS" || !fila.registrado_por_id || !fila.is_active)));
    const solicitudes = new Map<string, EventoHecho>();
    const usados = new Set<string>();

    for (const hecho of hechos) {
      const fila = hecho.consentimiento_id ? porId.get(hecho.consentimiento_id) : null;
      const solicitud = hecho.solicitud_evento_id ? eventosPorId.get(hecho.solicitud_evento_id) : null;
      if (hecho.cliente_id !== clienteId || hecho.alcance !== alcance || !hecho.usuario_id || !hecho.is_active ||
        (hecho.consentimiento_id !== null && (!fila || fila.cliente_id !== clienteId || fila.alcance !== alcance || fila.finalidad !== hecho.finalidad)) ||
        (hecho.solicitud_evento_id !== null && (!solicitud || solicitud.tipo !== "SOLICITUD_REVOCACION" || solicitud.cliente_id !== clienteId || solicitud.alcance !== alcance || solicitud.consentimiento_id !== hecho.consentimiento_id || solicitud.fecha_evento > hecho.fecha_evento))) {
        error = true; continue;
      }
      // La referencia de una solicitud no convierte el UUID en una secuencia
      // temporal. Dos hechos de esta finalidad en el mismo milisegundo son ambiguos.
      if (hechos.some((otro) => otro.id !== hecho.id && otro.fecha_evento.getTime() === hecho.fecha_evento.getTime())) {
        error = true;
      }
      if (hecho.tipo === "ACEPTACION_INICIAL" || hecho.tipo === "NUEVA_ACEPTACION") {
        if (!fila || fila.origen !== "EXPRESO" || !fila.is_active || fila.registrado_por_id !== hecho.usuario_id ||
          fila.fecha_consentimiento.getTime() !== hecho.fecha_evento.getTime() || usados.has(fila.id) ||
          (hecho.tipo === "ACEPTACION_INICIAL" ? estado !== "PENDIENTE_REGULARIZACION" : estado !== "REVOCADO")) error = true;
        else {
          estado = "ACEPTADO"; consentimientoActual = fila.id;
          finalidadActual = fila.finalidad; ultimaRevocacion = null; usados.add(fila.id);
        }
      } else if (hecho.tipo === "RECHAZO_COMERCIAL") {
        if (alcance !== "COMUNICACIONES_COMERCIALES" || fila || estado !== "PENDIENTE_REGULARIZACION") error = true;
        else estado = "RECHAZADO";
      } else if (hecho.tipo === "SOLICITUD_REVOCACION") {
        if (alcance !== "VENTA_ASISTIDA" || estado !== "ACEPTADO" || !fila || fila.id !== consentimientoActual || solicitudes.size) error = true;
        else solicitudes.set(hecho.id, hecho);
      } else if (hecho.tipo === "SOLICITUD_RECHAZADA") {
        if (alcance !== "VENTA_ASISTIDA" || !solicitud || !solicitudes.delete(solicitud.id) || !hecho.motivo?.trim() || estado !== "ACEPTADO") error = true;
      } else if (hecho.tipo === "REVOCACION_EJECUTADA") {
        if (estado !== "ACEPTADO" || !fila || fila.id !== consentimientoActual ||
          (alcance === "VENTA_ASISTIDA" ? !solicitud || !solicitudes.delete(solicitud.id) : !!solicitud)) error = true;
        else {
          estado = "REVOCADO"; consentimientoActual = null;
          finalidadActual = null; ultimaRevocacion = hecho.id;
        }
      } else error = true;
      if (hecho.tipo === "ACEPTACION_INICIAL" || hecho.tipo === "NUEVA_ACEPTACION" ||
        hecho.tipo === "RECHAZO_COMERCIAL" || hecho.tipo === "REVOCACION_EJECUTADA") {
        fecha = hecho.fecha_evento; usuario = hecho.usuario_nombre ?? hecho.usuario_id;
      }
    }
    if (filas.some((fila) => fila.origen === "EXPRESO" && !usados.has(fila.id))) error = true;
    estados[alcance] = {
      alcance, estado: error ? "ERROR_INTEGRIDAD" : estado,
      fecha_ultima_manifestacion: error ? null : fecha,
      usuario_ultima_manifestacion: error ? null : usuario,
      solicitudes_pendientes: error ? [] : [...solicitudes.values()].map((fila) => historial.find((item) => item.clase === "EVENTO" && item.id === fila.id)!),
      consentimiento_vigente_id: error ? null : consentimientoActual,
      finalidad_vigente: error ? null : finalidadActual,
      ultima_revocacion_evento_id: error ? null : ultimaRevocacion,
      fecha_ultimo_evento: error ? null : hechos.at(-1)?.fecha_evento ?? null,
    };
  }
  return { estados, historial };
}
