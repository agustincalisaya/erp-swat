import "server-only";

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { ConsentimientoDecisionRegistradaPayload } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import { ClienteIdConsentimientoSchema, RegularizarConsentimientoSchema, TransicionConsentimientoSchema, type RegularizarConsentimientoInput, type TransicionConsentimientoInput } from "@/lib/schemas/consentimientos.schema";
import { reducirConsentimientos, type ConsentimientoHecho, type EventoHecho } from "./consentimiento.estado";
import { Prisma } from "@prisma/client";

export const PERMISO_GESTIONAR_CONSENTIMIENTO = "clientes:gestionar_consentimiento";
const ROLES_ADMINISTRATIVOS_C4 = ["ADMINISTRADOR", "ADMINISTRADOR_CRM"];
const FINALIDAD: Record<RegularizarConsentimientoInput["alcance"], string> = {
  VENTA_ASISTIDA: "Tratamiento de datos personales para operar con el cliente",
  COMUNICACIONES_COMERCIALES: "Comunicaciones comerciales",
};

/** La consulta y publicación ocurren solo tras el commit. Un fallo del bus o
 * de la lectura de auditoría no revierte una decisión C4 ya confirmada. */
async function publicarDecisionC4(eventoId: string, contexto: "REGULARIZACION" | "FICHA") {
  try {
    const evento = await prisma.eventoConsentimientoCliente.findUnique({ where: { id: eventoId } });
    if (!evento || !evento.is_active || evento.alcance === "AMBOS") {
      console.error("[HU-C4] No se pudo publicar un hecho confirmado para auditoría central");
      return;
    }
    const payload: ConsentimientoDecisionRegistradaPayload = {
      evento_id: evento.id, cliente_id: evento.cliente_id, alcance: evento.alcance,
      tipo: evento.tipo, fecha_evento: evento.fecha_evento.toISOString(),
      usuario_id: evento.usuario_id, consentimiento_id: evento.consentimiento_id,
      solicitud_evento_id: evento.solicitud_evento_id, contexto,
    };
    domainEventBus.emit("consentimiento:decision_registrada", payload);
  } catch {
    console.error("[HU-C4] Falló la publicación de auditoría central de un hecho confirmado");
  }
}

async function leerHechos(clienteId: string, db: Prisma.TransactionClient | typeof prisma) {
  const [filas, eventos] = await Promise.all([
    db.consentimientoCliente.findMany({
      where: { cliente_id: clienteId },
      include: { registrado_por: { select: { nombre_completo: true } } },
    }),
    db.eventoConsentimientoCliente.findMany({
      where: { cliente_id: clienteId },
      include: { usuario: { select: { nombre_completo: true } } },
    }),
  ]);
  const consentimientos: ConsentimientoHecho[] = filas.map((fila) => ({
    ...fila, registrado_por_nombre: fila.registrado_por?.nombre_completo,
  }));
  const hechos: EventoHecho[] = eventos.map((evento) => ({
    ...evento, usuario_nombre: evento.usuario.nombre_completo,
  }));
  return reducirConsentimientos(clienteId, consentimientos, hechos);
}

/** La sesión solo contiene identidad: el rol se resuelve contra asignaciones vigentes. */
export async function esAdministradorCrmActivo(
  usuarioId: string, db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const asignacion = await db.usuarioRol.findFirst({
    where: { usuario_id: usuarioId, is_active: true,
      rol: { nombre: { in: ROLES_ADMINISTRATIVOS_C4 }, is_active: true } },
    select: { id: true },
  });
  return asignacion !== null;
}

async function actorPuedeGestionar(usuarioId: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const usuario = await tx.usuario.findFirst({
    where: { id: usuarioId, is_active: true, deleted_at: null, estado: "ACTIVO" },
    select: { id: true },
  });
  if (!usuario) return false;
  const asignacion = await tx.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId, is_active: true,
      rol: { is_active: true, permisos: { some: { is_active: true,
        permiso: { codigo: PERMISO_GESTIONAR_CONSENTIMIENTO, is_active: true } } } },
    },
    select: { id: true },
  });
  return asignacion !== null;
}

/** Usa el reloj de PostgreSQL, sin fabricar fechas futuras. El timestamp(3)
 * debe superar todos los eventos previos de la finalidad; si no puede, falla
 * antes de escribir para que el reductor no dependa del orden de UUID. */
async function fechaCausal(tx: Prisma.TransactionClient, ultima: Date | null): Promise<Date> {
  for (let intento = 0; intento < 50; intento++) {
    const [reloj] = await tx.$queryRaw<{ fecha: Date }[]>`
      SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS fecha
    `;
    if (reloj && (!ultima || reloj.fecha.getTime() > ultima.getTime())) return reloj.fecha;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new ServiceError("CONSENTIMIENTO_INTEGRIDAD", "No se puede ordenar la nueva decisión después del historial existente");
}

export async function obtenerConsentimientosCliente(clienteId: string) {
  if (!ClienteIdConsentimientoSchema.safeParse(clienteId).success) {
    throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado");
  }
  // HU-C6: lectura pura, SIN filtrar `is_active` del cliente — el historial de
  // consentimientos de un cliente dado de baja debe seguir consultable (spec
  // Módulo C §2.3). Las escrituras (regularizar / transicionar) sí siguen
  // bloqueando inactivos.
  return leerHechos(clienteId, prisma);
}

/** Serializa todas las regularizaciones del cliente con la misma fila bloqueada.
 * El esquema 1A no impone unicidad entre una decisión y todos sus eventos:
 * esta garantía depende de que las escrituras usen este servicio. */
export async function regularizarConsentimientoCliente(clienteId: string, input: unknown, usuarioId: string) {
  if (!ClienteIdConsentimientoSchema.safeParse(clienteId).success) {
    throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado");
  }
  const parsed = RegularizarConsentimientoSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  if (!ClienteIdConsentimientoSchema.safeParse(usuarioId).success) {
    throw new ServiceError("FORBIDDEN", "Actor no válido");
  }
  const { alcance, decision } = parsed.data;
  const resultado = await prisma.$transaction(async (tx) => {
    const bloqueado = await tx.$queryRaw<{ id: string; is_active: boolean }[]>`
      SELECT id, is_active FROM clientes WHERE id = ${clienteId} FOR UPDATE
    `;
    if (!bloqueado[0]?.is_active) throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado");
    // La lectura ocurre después del bloqueo: el segundo envío ve el commit del primero.
    const lectura = await leerHechos(clienteId, tx);
    const estado = lectura.estados[alcance].estado;
    if (estado === "ERROR_INTEGRIDAD") throw new ServiceError("CONSENTIMIENTO_INTEGRIDAD", "No se puede determinar el estado de esta finalidad");
    if (estado !== "PENDIENTE_REGULARIZACION") throw new ServiceError("CONSENTIMIENTO_CONFLICTO", "La finalidad ya no está pendiente de regularización");

    const fecha = new Date();
    const finalidad = FINALIDAD[alcance];
    let consentimientoId: string | null = null;
    if (decision === "ACEPTA") {
      const aceptacion = await tx.consentimientoCliente.create({ data: {
        cliente_id: clienteId, alcance, finalidad, origen: "EXPRESO",
        registrado_por_id: usuarioId, fecha_consentimiento: fecha,
      } });
      consentimientoId = aceptacion.id;
    }
    const evento = await tx.eventoConsentimientoCliente.create({ data: {
      cliente_id: clienteId, consentimiento_id: consentimientoId,
      tipo: decision === "ACEPTA" ? "ACEPTACION_INICIAL" : "RECHAZO_COMERCIAL",
      alcance, finalidad, fecha_evento: fecha, usuario_id: usuarioId,
    } });
    return { cliente_id: clienteId, alcance, estado: decision === "ACEPTA" ? "ACEPTADO" as const : "RECHAZADO" as const,
      consentimiento_id: consentimientoId, evento_id: evento.id, fecha_evento: fecha };
  }, { timeout: 15_000 });
  await publicarDecisionC4(resultado.evento_id, "REGULARIZACION");
  return resultado;
}

/** Única entrada de escritura para las transiciones de etapa 3. Los IDs del
 * formulario son precondiciones: jamás seleccionan por sí solos la aceptación
 * ni la solicitud que se va a modificar. Todas las filas históricas quedan
 * intactas y la decisión se agrega como un evento. */
export async function transicionarConsentimientoCliente(clienteId: string, input: unknown, usuarioId: string) {
  if (!ClienteIdConsentimientoSchema.safeParse(clienteId).success) {
    throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado");
  }
  const parsed = TransicionConsentimientoSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  if (!ClienteIdConsentimientoSchema.safeParse(usuarioId).success) {
    throw new ServiceError("FORBIDDEN", "No tenés permiso para gestionar consentimientos");
  }
  const operacion = parsed.data;
  try {
    const resultado = await prisma.$transaction((tx) =>
      transicionarConsentimientoClienteTx(tx, clienteId, operacion, usuarioId),
    { timeout: 15_000 });
    await publicarDecisionC4(resultado.evento_id, "FICHA");
    return resultado;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ServiceError("SOLICITUD_NO_PENDIENTE", "La solicitud indicada ya fue resuelta");
    }
    throw error;
  }
}

/** Núcleo transaccional reutilizado por la suite C4 para inyectar un fallo en
 * la segunda inserción y comprobar el rollback real de PostgreSQL. El caller
 * debe proporcionar una transacción abierta. */
export async function transicionarConsentimientoClienteTx(
  tx: Prisma.TransactionClient, clienteId: string,
  operacion: TransicionConsentimientoInput, usuarioId: string,
) {
      const bloqueado = await tx.$queryRaw<{ id: string; is_active: boolean }[]>`
        SELECT id, is_active FROM clientes WHERE id = ${clienteId} FOR UPDATE
      `;
      if (!bloqueado[0]?.is_active) throw new ServiceError("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado");
      const lectura = await leerHechos(clienteId, tx);
      const estado = lectura.estados[operacion.alcance];
      if (estado.estado === "ERROR_INTEGRIDAD") {
        throw new ServiceError("CONSENTIMIENTO_INTEGRIDAD", "No se puede determinar el estado de esta finalidad");
      }
      if (!(await actorPuedeGestionar(usuarioId, tx))) {
        throw new ServiceError("FORBIDDEN", "No tenés permiso para gestionar consentimientos");
      }
      const reservada = operacion.operacion === "EJECUTAR_REVOCACION" ||
        operacion.operacion === "RECHAZAR_SOLICITUD" || operacion.operacion === "NUEVA_ACEPTACION";
      if (reservada && !(await esAdministradorCrmActivo(usuarioId, tx))) {
        throw new ServiceError("FORBIDDEN", "Esta operación requiere el rol Administrador CRM activo");
      }

      let tipo: "REVOCACION_EJECUTADA" | "SOLICITUD_REVOCACION" | "SOLICITUD_RECHAZADA" | "NUEVA_ACEPTACION";
      let consentimientoId: string;
      let solicitudId: string | null = null;
      let finalidad: string;
      let motivo: string | null = null;
      if (operacion.operacion === "NUEVA_ACEPTACION") {
        if (estado.estado !== "REVOCADO") {
          throw new ServiceError("CONSENTIMIENTO_CONFLICTO", "La finalidad ya no está revocada");
        }
        if (!estado.ultima_revocacion_evento_id || estado.ultima_revocacion_evento_id !== operacion.revocacion_evento_id) {
          throw new ServiceError("REVOCACION_OBSOLETA", "La revocación indicada ya no es la vigente");
        }
        // El modelo 1A no tiene una FK desde NUEVA_ACEPTACION a la revocación.
        // La vinculación es causal: misma finalidad/cliente, revocación vigente
        // comprobada bajo bloqueo y fecha posterior. El evento referencia la
        // aceptación nueva mediante consentimiento_id.
        tipo = "NUEVA_ACEPTACION";
        finalidad = FINALIDAD[operacion.alcance];
        consentimientoId = "";
      } else {
        if (estado.estado !== "ACEPTADO") {
          throw new ServiceError("CONSENTIMIENTO_CONFLICTO", "La finalidad ya no tiene una aceptación vigente");
        }
        if (!estado.consentimiento_vigente_id || !estado.finalidad_vigente) {
          throw new ServiceError("CONSENTIMIENTO_INTEGRIDAD", "Falta la aceptación vigente");
        }
        if (estado.consentimiento_vigente_id !== operacion.consentimiento_id) {
          throw new ServiceError("ACEPTACION_OBSOLETA", "La aceptación indicada ya no es la vigente");
        }
        consentimientoId = estado.consentimiento_vigente_id;
        finalidad = estado.finalidad_vigente;
        motivo = operacion.motivo ?? null;
        if (operacion.operacion === "REVOCAR_COMERCIAL") {
          tipo = "REVOCACION_EJECUTADA";
        } else if (operacion.operacion === "SOLICITAR_REVOCACION") {
          if (estado.solicitudes_pendientes.length > 0) {
            throw new ServiceError("SOLICITUD_YA_PENDIENTE", "Ya existe una solicitud de revocación pendiente");
          }
          tipo = "SOLICITUD_REVOCACION";
        } else {
          const pendiente = estado.solicitudes_pendientes.find((solicitud) =>
            solicitud.id === operacion.solicitud_evento_id &&
            solicitud.resultado === "SOLICITUD_REVOCACION" &&
            solicitud.consentimiento_id === consentimientoId &&
            solicitud.alcance === "VENTA_ASISTIDA");
          if (!pendiente || estado.solicitudes_pendientes.length !== 1) {
            throw new ServiceError("SOLICITUD_NO_PENDIENTE", "La solicitud indicada ya no está pendiente");
          }
          solicitudId = pendiente.id;
          tipo = operacion.operacion === "EJECUTAR_REVOCACION" ? "REVOCACION_EJECUTADA" : "SOLICITUD_RECHAZADA";
        }
      }

      const fecha = await fechaCausal(tx, estado.fecha_ultimo_evento);
      if (operacion.operacion === "NUEVA_ACEPTACION") {
        const aceptacion = await tx.consentimientoCliente.create({ data: {
          cliente_id: clienteId, alcance: operacion.alcance, finalidad,
          origen: "EXPRESO", registrado_por_id: usuarioId, fecha_consentimiento: fecha,
        } });
        consentimientoId = aceptacion.id;
      }
      const evento = await tx.eventoConsentimientoCliente.create({ data: {
        cliente_id: clienteId, alcance: operacion.alcance, finalidad,
        consentimiento_id: consentimientoId, tipo, fecha_evento: fecha,
        usuario_id: usuarioId, solicitud_evento_id: solicitudId, motivo,
      } });
      return {
        cliente_id: clienteId, alcance: operacion.alcance, operacion: operacion.operacion,
        estado: tipo === "REVOCACION_EJECUTADA" ? "REVOCADO" as const : "ACEPTADO" as const,
        solicitud_pendiente: tipo === "SOLICITUD_REVOCACION",
        consentimiento_id: consentimientoId, solicitud_evento_id: solicitudId,
        evento_id: evento.id, fecha_evento: fecha,
      };
}
