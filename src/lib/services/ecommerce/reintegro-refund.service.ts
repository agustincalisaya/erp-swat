import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import {
  esErrorTecnicoReintentableMercadoPago,
  solicitarReembolso,
} from "@/lib/integraciones/mercadopago/adapter";
import type { ReembolsoSolicitado } from "@/lib/integraciones/mercadopago/tipos";
import { continuarPasosLocalesReintegroPedidoWeb } from "@/lib/services/ecommerce/reintegro-pedido-web.service";

interface DependenciasRefund {
  solicitarReembolso: (paymentId: string, idempotencyKey: string) => Promise<ReembolsoSolicitado>;
  ahora: () => Date;
}

export interface IntentoRefundPreparado {
  resultado: "LISTO_PARA_F1";
  reintegro_id: string;
  pedido_venta_id: string;
  intento_id: string;
  numero: number;
  origen: "INICIAL" | "REINTENTO_MANUAL";
  payment_id: string;
  clave_idempotencia: string;
}

export type PreparacionRefundResultado =
  | IntentoRefundPreparado
  | { resultado: "PENDIENTE_PASOS_LOCALES"; reintegro_id: string }
  | { resultado: "APROBADO_EXISTENTE"; reintegro_id: string; intento_id: string; refund_id: string }
  | { resultado: "RECHAZADO_EXISTENTE"; reintegro_id: string; intento_id: string; refund_id: string | null };

export type EjecucionRefundResultado =
  | { resultado: "APROBADO" | "APROBADO_EXISTENTE"; reintegro_id: string; intento_id: string; refund_id: string }
  | { resultado: "RECHAZADO" | "RECHAZADO_EXISTENTE"; reintegro_id: string; intento_id: string; refund_id: string | null }
  | { resultado: "PENDIENTE" | "ERROR_TECNICO"; reintegro_id: string; intento_id: string; refund_id: string | null; proximo_reintento_at: Date }
  | { resultado: "PENDIENTE_PASOS_LOCALES"; reintegro_id: string };

export interface ReintentoManualRefundInput {
  reintegro_id: string;
  usuario_id: string;
  motivo: string;
}

export type EjecucionReintentoManualResultado = EjecucionRefundResultado & {
  intento_reutilizado: boolean;
};

type CabeceraBloqueada = {
  id: string;
  pedido_venta_id: string;
  mercadopago_payment_id: string;
  monto_total: Prisma.Decimal;
  estado: "PENDIENTE" | "APROBADO" | "RECHAZADO";
  nota_credito_id: string | null;
  contra_asiento_ingreso_id: string | null;
  intento_aprobado_id: string | null;
};

type IntentoBloqueado = {
  id: string;
  reintegro_id: string;
  numero: number;
  origen: "INICIAL" | "REINTENTO_MANUAL";
  clave_idempotencia: string;
  estado: "PENDIENTE" | "APROBADO" | "RECHAZADO";
  refund_id: string | null;
  intentos_tecnicos: number;
};

const dependenciasPorDefecto: DependenciasRefund = {
  solicitarReembolso,
  ahora: () => new Date(),
};

function claveIntento(pedidoVentaId: string, paymentId: string, numero: number): string {
  return `HU-E13:REFUND:${pedidoVentaId}:${paymentId}:${numero}`;
}

export function calcularDelayRetryMinutos(intentosTecnicos: number): number {
  if (!Number.isInteger(intentosTecnicos) || intentosTecnicos <= 0) {
    throw new ServiceError("INTENTOS_TECNICOS_INVALIDOS", "El contador técnico debe ser positivo");
  }
  return Math.min(5 * 2 ** (intentosTecnicos - 1), 360);
}

function sumarMinutos(fecha: Date, minutos: number): Date {
  return new Date(fecha.getTime() + minutos * 60_000);
}

function emitirReintegroSeguro(payload: DomainEventMap["ecommerce:reintegro_estado_cambiado"]): void {
  try {
    domainEventBus.emit("ecommerce:reintegro_estado_cambiado", payload);
  } catch {
    console.error("[HU-E13] Falló la publicación post-commit del estado de reintegro");
  }
}

async function bloquearCabeceraTx(tx: Prisma.TransactionClient, reintegroId: string): Promise<CabeceraBloqueada> {
  const filas = await tx.$queryRaw<CabeceraBloqueada[]>`
    SELECT id, pedido_venta_id, mercadopago_payment_id, monto_total, estado,
           nota_credito_id, contra_asiento_ingreso_id, intento_aprobado_id
    FROM reintegros_pedido_web
    WHERE id = ${reintegroId}
    FOR UPDATE
  `;
  const cabecera = filas[0];
  if (!cabecera) throw new ServiceError("REINTEGRO_NO_ENCONTRADO", "La saga de reintegro no existe");
  return cabecera;
}

async function bloquearIntentoTx(tx: Prisma.TransactionClient, intentoId: string): Promise<IntentoBloqueado> {
  const filas = await tx.$queryRaw<IntentoBloqueado[]>`
    SELECT id, reintegro_id, numero, origen, clave_idempotencia, estado,
           refund_id, intentos_tecnicos
    FROM reintegro_refund_intentos
    WHERE id = ${intentoId}
    FOR UPDATE
  `;
  const intento = filas[0];
  if (!intento) throw new ServiceError("INTENTO_REFUND_NO_ENCONTRADO", "El intento de refund no existe");
  return intento;
}

async function validarPasosLocalesTx(tx: Prisma.TransactionClient, cabecera: CabeceraBloqueada): Promise<void> {
  if (!cabecera.nota_credito_id || !cabecera.contra_asiento_ingreso_id) {
    throw new ServiceError("PASOS_LOCALES_INCOMPLETOS", "La saga todavía no completó sus efectos locales");
  }
  const [nota, contra, compensacionesTotales, compensacionesCompletas] = await Promise.all([
    tx.comprobanteFiscal.findUnique({
      where: { id: cabecera.nota_credito_id },
      select: { pedido_venta_id: true, tipo_comprobante: true },
    }),
    tx.contraAsientoIngreso.findUnique({
      where: { id: cabecera.contra_asiento_ingreso_id },
      select: { pedido_venta_id: true },
    }),
    tx.reintegroStockCompensacion.count({ where: { reintegro_id: cabecera.id } }),
    tx.reintegroStockCompensacion.count({
      where: {
        reintegro_id: cabecera.id,
        movimiento_stock_id: { not: null },
        completed_at: { not: null },
      },
    }),
  ]);
  if (!nota || nota.pedido_venta_id !== cabecera.pedido_venta_id || nota.tipo_comprobante !== "NOTA_CREDITO") {
    throw new ServiceError("REINTEGRO_INCONSISTENTE", "La Nota de Crédito vinculada no es válida");
  }
  if (!contra || contra.pedido_venta_id !== cabecera.pedido_venta_id) {
    throw new ServiceError("REINTEGRO_INCONSISTENTE", "El contra-asiento vinculado no es válido");
  }
  if (compensacionesTotales === 0 || compensacionesCompletas !== compensacionesTotales) {
    throw new ServiceError("PASOS_LOCALES_INCOMPLETOS", "Las compensaciones de stock están incompletas");
  }
}

async function validarRefundIdTx(tx: Prisma.TransactionClient, intentoId: string, refundId: string): Promise<void> {
  const existente = await tx.reintegroRefundIntento.findUnique({
    where: { refund_id: refundId },
    select: { id: true },
  });
  if (existente && existente.id !== intentoId) {
    throw new ServiceError("REFUND_ID_INCONSISTENTE", "El refund remoto ya pertenece a otro intento");
  }
}

export function crearServicioReintegroRefund(dependencias: Partial<DependenciasRefund> = {}) {
  const deps: DependenciasRefund = { ...dependenciasPorDefecto, ...dependencias };

  async function prepararIntentoRefundAutomatico(reintegroId: string): Promise<PreparacionRefundResultado> {
    const estadoActual = await prisma.reintegroPedidoWeb.findUnique({
      where: { id: reintegroId },
      select: { estado: true },
    });
    if (!estadoActual) throw new ServiceError("REINTEGRO_NO_ENCONTRADO", "La saga de reintegro no existe");
    if (estadoActual.estado === "PENDIENTE") {
      const locales = await continuarPasosLocalesReintegroPedidoWeb(reintegroId);
      if (locales.resultado === "PENDIENTE_INGRESO_ORIGINAL") {
        return { resultado: "PENDIENTE_PASOS_LOCALES", reintegro_id: reintegroId };
      }
    }

    return prisma.$transaction(async (tx) => {
      const cabecera = await bloquearCabeceraTx(tx, reintegroId);
      const aprobado = await tx.reintegroRefundIntento.findFirst({
        where: { reintegro_id: cabecera.id, estado: "APROBADO" },
        orderBy: { numero: "asc" },
      });
      if (cabecera.estado === "APROBADO" || aprobado) {
        if (!aprobado?.refund_id || cabecera.intento_aprobado_id !== aprobado.id) {
          throw new ServiceError("REINTEGRO_INCONSISTENTE", "La aprobación durable del reintegro es inválida");
        }
        return {
          resultado: "APROBADO_EXISTENTE",
          reintegro_id: cabecera.id,
          intento_id: aprobado.id,
          refund_id: aprobado.refund_id,
        };
      }
      const pendiente = await tx.reintegroRefundIntento.findFirst({
        where: { reintegro_id: cabecera.id, estado: "PENDIENTE" },
        orderBy: { numero: "desc" },
      });
      if (pendiente) {
        await validarPasosLocalesTx(tx, cabecera);
        return {
          resultado: "LISTO_PARA_F1",
          reintegro_id: cabecera.id,
          pedido_venta_id: cabecera.pedido_venta_id,
          intento_id: pendiente.id,
          numero: pendiente.numero,
          origen: pendiente.origen,
          payment_id: cabecera.mercadopago_payment_id,
          clave_idempotencia: pendiente.clave_idempotencia,
        };
      }
      if (cabecera.estado === "RECHAZADO") {
        const rechazado = await tx.reintegroRefundIntento.findFirst({
          where: { reintegro_id: cabecera.id, estado: "RECHAZADO" },
          orderBy: { numero: "desc" },
        });
        if (!rechazado) throw new ServiceError("REINTEGRO_INCONSISTENTE", "La saga rechazada no tiene intento rechazado");
        return {
          resultado: "RECHAZADO_EXISTENTE",
          reintegro_id: cabecera.id,
          intento_id: rechazado.id,
          refund_id: rechazado.refund_id,
        };
      }
      await validarPasosLocalesTx(tx, cabecera);
      const cantidadIntentos = await tx.reintegroRefundIntento.count({ where: { reintegro_id: cabecera.id } });
      if (cantidadIntentos !== 0) {
        throw new ServiceError("REINTEGRO_INCONSISTENTE", "La saga pendiente no tiene un intento recuperable");
      }
      const ahora = deps.ahora();
      const numero = 1;
      const creado = await tx.reintegroRefundIntento.create({
        data: {
          reintegro_id: cabecera.id,
          numero,
          origen: "INICIAL",
          clave_idempotencia: claveIntento(cabecera.pedido_venta_id, cabecera.mercadopago_payment_id, numero),
        },
      });
      await tx.reintegroPedidoWeb.update({
        where: { id: cabecera.id },
        data: { proximo_reintento_at: ahora, ultimo_error_codigo: null },
      });
      return {
        resultado: "LISTO_PARA_F1",
        reintegro_id: cabecera.id,
        pedido_venta_id: cabecera.pedido_venta_id,
        intento_id: creado.id,
        numero: creado.numero,
        origen: creado.origen,
        payment_id: cabecera.mercadopago_payment_id,
        clave_idempotencia: creado.clave_idempotencia,
      };
    });
  }

  async function persistirResultado(
    preparado: IntentoRefundPreparado,
    remoto: ReembolsoSolicitado,
  ): Promise<EjecucionRefundResultado> {
    return prisma.$transaction(async (tx) => {
      const cabecera = await bloquearCabeceraTx(tx, preparado.reintegro_id);
      const intento = await bloquearIntentoTx(tx, preparado.intento_id);
      if (intento.reintegro_id !== cabecera.id || intento.clave_idempotencia !== preparado.clave_idempotencia) {
        throw new ServiceError("REINTEGRO_INCONSISTENTE", "El intento no corresponde a la saga");
      }
      if (cabecera.estado === "APROBADO" || intento.estado === "APROBADO") {
        if (!intento.refund_id) throw new ServiceError("REINTEGRO_INCONSISTENTE", "El intento aprobado no tiene refund ID");
        return {
          resultado: "APROBADO_EXISTENTE",
          reintegro_id: cabecera.id,
          intento_id: intento.id,
          refund_id: intento.refund_id,
        };
      }
      if (remoto.payment_id !== cabecera.mercadopago_payment_id || !cabecera.monto_total.equals(remoto.monto)) {
        throw new ServiceError("RESPUESTA_REFUND_INCONSISTENTE", "El refund remoto no coincide con el pago total congelado");
      }
      await validarRefundIdTx(tx, intento.id, remoto.refund_id);
      const ahora = deps.ahora();
      if (remoto.estado === "APROBADO") {
        await tx.reintegroRefundIntento.update({
          where: { id: intento.id },
          data: {
            estado: "APROBADO",
            refund_id: remoto.refund_id,
            error_codigo: null,
            ultimo_intento_at: ahora,
            resuelto_at: ahora,
          },
        });
        await tx.reintegroPedidoWeb.update({
          where: { id: cabecera.id },
          data: {
            estado: "APROBADO",
            intento_aprobado_id: intento.id,
            ultimo_error_codigo: null,
            proximo_reintento_at: null,
            resuelto_at: ahora,
          },
        });
        return { resultado: "APROBADO", reintegro_id: cabecera.id, intento_id: intento.id, refund_id: remoto.refund_id };
      }
      if (intento.estado === "RECHAZADO" || cabecera.estado === "RECHAZADO") {
        return {
          resultado: "RECHAZADO_EXISTENTE",
          reintegro_id: cabecera.id,
          intento_id: intento.id,
          refund_id: intento.refund_id,
        };
      }
      if (remoto.estado === "RECHAZADO") {
        await tx.reintegroRefundIntento.update({
          where: { id: intento.id },
          data: {
            estado: "RECHAZADO",
            refund_id: remoto.refund_id,
            error_codigo: "REFUND_RECHAZADO",
            ultimo_intento_at: ahora,
            resuelto_at: ahora,
          },
        });
        await tx.reintegroPedidoWeb.update({
          where: { id: cabecera.id },
          data: {
            estado: "RECHAZADO",
            ultimo_error_codigo: "REFUND_RECHAZADO",
            proximo_reintento_at: null,
            resuelto_at: ahora,
          },
        });
        return { resultado: "RECHAZADO", reintegro_id: cabecera.id, intento_id: intento.id, refund_id: remoto.refund_id };
      }
      const proximo = sumarMinutos(ahora, 15);
      await tx.reintegroRefundIntento.update({
        where: { id: intento.id },
        data: { refund_id: remoto.refund_id, error_codigo: null, ultimo_intento_at: ahora },
      });
      await tx.reintegroPedidoWeb.update({
        where: { id: cabecera.id },
        data: { estado: "PENDIENTE", ultimo_error_codigo: null, proximo_reintento_at: proximo },
      });
      return {
        resultado: "PENDIENTE",
        reintegro_id: cabecera.id,
        intento_id: intento.id,
        refund_id: remoto.refund_id,
        proximo_reintento_at: proximo,
      };
    });
  }

  async function persistirError(
    preparado: IntentoRefundPreparado,
    error: unknown,
  ): Promise<EjecucionRefundResultado> {
    const errorTecnico = esErrorTecnicoReintentableMercadoPago(error) ? error : null;
    const errorDefinitivo = error instanceof ServiceError ? error : null;
    if (!errorTecnico && !errorDefinitivo) throw error;
    return prisma.$transaction(async (tx) => {
      const cabecera = await bloquearCabeceraTx(tx, preparado.reintegro_id);
      const intento = await bloquearIntentoTx(tx, preparado.intento_id);
      if (cabecera.estado === "APROBADO" || intento.estado === "APROBADO") {
        if (!intento.refund_id) throw new ServiceError("REINTEGRO_INCONSISTENTE", "El intento aprobado no tiene refund ID");
        return {
          resultado: "APROBADO_EXISTENTE",
          reintegro_id: cabecera.id,
          intento_id: intento.id,
          refund_id: intento.refund_id,
        };
      }
      if (intento.estado === "RECHAZADO" || cabecera.estado === "RECHAZADO") {
        return {
          resultado: "RECHAZADO_EXISTENTE",
          reintegro_id: cabecera.id,
          intento_id: intento.id,
          refund_id: intento.refund_id,
        };
      }
      const ahora = deps.ahora();
      const codigo = errorTecnico ? `MP_${errorTecnico.causa}` : errorDefinitivo!.code;
      if (errorTecnico) {
        const intentosTecnicos = intento.intentos_tecnicos + 1;
        const proximo = sumarMinutos(ahora, calcularDelayRetryMinutos(intentosTecnicos));
        await tx.reintegroRefundIntento.update({
          where: { id: intento.id },
          data: {
            intentos_tecnicos: intentosTecnicos,
            error_codigo: codigo,
            ultimo_intento_at: ahora,
          },
        });
        await tx.reintegroPedidoWeb.update({
          where: { id: cabecera.id },
          data: { estado: "PENDIENTE", ultimo_error_codigo: codigo, proximo_reintento_at: proximo },
        });
        return {
          resultado: "ERROR_TECNICO",
          reintegro_id: cabecera.id,
          intento_id: intento.id,
          refund_id: intento.refund_id,
          proximo_reintento_at: proximo,
        };
      }
      await tx.reintegroRefundIntento.update({
        where: { id: intento.id },
        data: {
          estado: "RECHAZADO",
          error_codigo: codigo,
          ultimo_intento_at: ahora,
          resuelto_at: ahora,
        },
      });
      await tx.reintegroPedidoWeb.update({
        where: { id: cabecera.id },
        data: {
          estado: "RECHAZADO",
          ultimo_error_codigo: codigo,
          proximo_reintento_at: null,
          resuelto_at: ahora,
        },
      });
      return {
        resultado: "RECHAZADO",
        reintegro_id: cabecera.id,
        intento_id: intento.id,
        refund_id: intento.refund_id,
      };
    });
  }

  function emitirResultadoSiNuevo(
    preparado: IntentoRefundPreparado,
    resultado: EjecucionRefundResultado,
  ): void {
    if (resultado.resultado !== "APROBADO" && resultado.resultado !== "RECHAZADO") return;
    emitirReintegroSeguro({
      evento_id: `${preparado.intento_id}:${resultado.resultado}`,
      reintegro_id: preparado.reintegro_id,
      intento_refund_id: preparado.intento_id,
      numero_intento: preparado.numero,
      origen_intento: preparado.origen,
      pedido_venta_id: preparado.pedido_venta_id,
      estado_anterior: "PENDIENTE",
      estado_nuevo: resultado.resultado,
      actor_id: null,
      motivo: null,
      timestamp: deps.ahora().toISOString(),
    });
  }

  async function ejecutarPreparado(preparado: IntentoRefundPreparado): Promise<EjecucionRefundResultado> {
    let remoto: ReembolsoSolicitado;
    try {
      remoto = await deps.solicitarReembolso(preparado.payment_id, preparado.clave_idempotencia);
    } catch (error) {
      const resultado = await persistirError(preparado, error);
      emitirResultadoSiNuevo(preparado, resultado);
      return resultado;
    }
    const resultado = await persistirResultado(preparado, remoto);
    emitirResultadoSiNuevo(preparado, resultado);
    return resultado;
  }

  async function continuarRefundPedidoWeb(reintegroId: string): Promise<EjecucionRefundResultado> {
    const preparado = await prepararIntentoRefundAutomatico(reintegroId);
    if (preparado.resultado !== "LISTO_PARA_F1") return preparado;
    return ejecutarPreparado(preparado);
  }

  async function solicitarReintentoManualRefund(input: ReintentoManualRefundInput): Promise<EjecucionReintentoManualResultado> {
    const motivo = input.motivo.trim();
    if (!motivo) throw new ServiceError("MOTIVO_REQUERIDO", "El motivo del reintento es obligatorio");
    let eventoManual: DomainEventMap["ecommerce:reintegro_estado_cambiado"] | null = null;
    let intentoReutilizado = false;
    const preparado = await prisma.$transaction(async (tx): Promise<IntentoRefundPreparado> => {
      const cabecera = await bloquearCabeceraTx(tx, input.reintegro_id);
      const usuario = await tx.usuario.findFirst({
        where: { id: input.usuario_id, is_active: true, deleted_at: null },
        select: { id: true },
      });
      if (!usuario) throw new ServiceError("ACTOR_INVALIDO", "El usuario administrador no está activo");
      const aprobado = await tx.reintegroRefundIntento.findFirst({
        where: { reintegro_id: cabecera.id, estado: "APROBADO" },
        select: { id: true },
      });
      if (cabecera.estado === "APROBADO" || aprobado) {
        throw new ServiceError("REINTEGRO_APROBADO", "El reintegro ya fue aprobado");
      }
      const pendiente = await tx.reintegroRefundIntento.findFirst({
        where: { reintegro_id: cabecera.id, estado: "PENDIENTE" },
        orderBy: { numero: "desc" },
      });
      if (pendiente) {
        if (pendiente.origen !== "REINTENTO_MANUAL") {
          throw new ServiceError("REINTEGRO_EN_PROCESO", "Existe un intento inicial pendiente");
        }
        intentoReutilizado = true;
        return {
          resultado: "LISTO_PARA_F1",
          reintegro_id: cabecera.id,
          pedido_venta_id: cabecera.pedido_venta_id,
          intento_id: pendiente.id,
          numero: pendiente.numero,
          origen: pendiente.origen,
          payment_id: cabecera.mercadopago_payment_id,
          clave_idempotencia: pendiente.clave_idempotencia,
        };
      }
      if (cabecera.estado !== "RECHAZADO") {
        throw new ServiceError("REINTEGRO_NO_RECHAZADO", "El reintegro no admite un reintento manual");
      }
      const intentos = await tx.reintegroRefundIntento.findMany({
        where: { reintegro_id: cabecera.id },
        orderBy: { numero: "desc" },
        select: { numero: true, estado: true },
      });
      if (!intentos.some((intento) => intento.estado === "RECHAZADO")) {
        throw new ServiceError("REINTEGRO_INCONSISTENTE", "No existe un intento rechazado previo");
      }
      await validarPasosLocalesTx(tx, cabecera);
      const numero = (intentos[0]?.numero ?? 0) + 1;
      const ahora = deps.ahora();
      const creado = await tx.reintegroRefundIntento.create({
        data: {
          reintegro_id: cabecera.id,
          numero,
          origen: "REINTENTO_MANUAL",
          clave_idempotencia: claveIntento(cabecera.pedido_venta_id, cabecera.mercadopago_payment_id, numero),
          motivo_reintento: motivo,
          creado_por_id: usuario.id,
        },
      });
      await tx.reintegroPedidoWeb.update({
        where: { id: cabecera.id },
        data: {
          estado: "PENDIENTE",
          ultimo_error_codigo: null,
          proximo_reintento_at: ahora,
          resuelto_at: null,
        },
      });
      eventoManual = {
        evento_id: `${creado.id}:REINTENTO_MANUAL`,
        reintegro_id: cabecera.id,
        intento_refund_id: creado.id,
        numero_intento: creado.numero,
        origen_intento: "REINTENTO_MANUAL",
        pedido_venta_id: cabecera.pedido_venta_id,
        estado_anterior: "RECHAZADO",
        estado_nuevo: "PENDIENTE",
        actor_id: usuario.id,
        motivo,
        timestamp: ahora.toISOString(),
      };
      return {
        resultado: "LISTO_PARA_F1",
        reintegro_id: cabecera.id,
        pedido_venta_id: cabecera.pedido_venta_id,
        intento_id: creado.id,
        numero: creado.numero,
        origen: creado.origen,
        payment_id: cabecera.mercadopago_payment_id,
        clave_idempotencia: creado.clave_idempotencia,
      };
    });
    if (eventoManual) emitirReintegroSeguro(eventoManual);
    return { ...(await ejecutarPreparado(preparado)), intento_reutilizado: intentoReutilizado };
  }

  return {
    prepararIntentoRefundAutomatico,
    continuarRefundPedidoWeb,
    solicitarReintentoManualRefund,
  };
}

const servicioPorDefecto = crearServicioReintegroRefund();

export const prepararIntentoRefundAutomatico = servicioPorDefecto.prepararIntentoRefundAutomatico;
export const continuarRefundPedidoWeb = servicioPorDefecto.continuarRefundPedidoWeb;
export const solicitarReintentoManualRefund = servicioPorDefecto.solicitarReintentoManualRefund;
