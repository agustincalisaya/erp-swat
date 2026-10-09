import "server-only";

import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { continuarRefundPedidoWeb } from "@/lib/services/ecommerce/reintegro-refund.service";
import { iniciarReintegroPedidoWebPaso0 } from "@/lib/services/ecommerce/reintegro-pedido-web.service";

const CLAVE_PLAZO_RETIRO = "ECOMMERCE_PLAZO_RETIRO_DIAS";
const CLAVE_RECORDATORIO = "ECOMMERCE_RECORDATORIO_RETIRO_HORAS";

export interface ErrorMantenimientoHuE13 {
  pedido_venta_id: string;
  codigo: string;
}

export interface ResultadoRecordatoriosHuE13 {
  procesados: number;
  recordatorios_emitidos: number;
  errores: ErrorMantenimientoHuE13[];
}

export interface ResultadoVencimientosHuE13 {
  procesados: number;
  vencidos: number;
  refunds_iniciados: number;
  errores: ErrorMantenimientoHuE13[];
}

export interface ResultadoRetriesHuE13 {
  procesados: number;
  refunds_reintentados: number;
  errores: ErrorMantenimientoHuE13[];
}

function codigoSeguro(error: unknown): string {
  return error instanceof ServiceError ? error.code : "ERROR_INTERNO";
}

function enteroPositivo(valor: string | undefined, clave: string): number {
  const normalizado = valor?.trim();
  if (!normalizado || !/^\d+$/.test(normalizado)) {
    throw new ServiceError("CONFIGURACION_INVALIDA", `La configuración ${clave} debe ser un entero positivo`);
  }
  const numero = Number(normalizado);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new ServiceError("CONFIGURACION_INVALIDA", `La configuración ${clave} debe ser un entero positivo`);
  }
  return numero;
}

async function leerVentanaRecordatorio(): Promise<number> {
  const filas = await prisma.configuracionSistema.findMany({
    where: { clave: { in: [CLAVE_PLAZO_RETIRO, CLAVE_RECORDATORIO] } },
    select: { clave: true, valor: true },
  });
  const valores = new Map(filas.map((fila) => [fila.clave, fila.valor]));
  const dias = enteroPositivo(valores.get(CLAVE_PLAZO_RETIRO), CLAVE_PLAZO_RETIRO);
  const horas = enteroPositivo(valores.get(CLAVE_RECORDATORIO), CLAVE_RECORDATORIO);
  if (horas >= dias * 24) {
    throw new ServiceError("CONFIGURACION_INVALIDA", `${CLAVE_RECORDATORIO} debe ser menor que el plazo de retiro`);
  }
  return horas;
}

export async function procesarRecordatoriosRetiroHuE13(ahora: Date = new Date()): Promise<ResultadoRecordatoriosHuE13> {
  const horas = await leerVentanaRecordatorio();
  const inicioVentanaMaximo = new Date(ahora.getTime() + horas * 60 * 60_000);
  const candidatos = await prisma.pedidoVentaEcommerce.findMany({
    where: {
      estado_ecommerce: "LISTO_PARA_RETIRO",
      plazo_retiro_vencimiento: { gt: ahora, lte: inicioVentanaMaximo },
      is_active: true,
      deleted_at: null,
      pedido_venta: { canal: "WEB", is_active: true, deleted_at: null },
    },
    select: {
      id: true,
      pedido_venta_id: true,
      plazo_retiro_vencimiento: true,
      pedido_venta: {
        select: {
          numero_venta: true,
          cliente: {
            select: {
              cuenta_web: { select: { id: true, is_active: true, deleted_at: true } },
            },
          },
        },
      },
    },
  });
  const errores: ErrorMantenimientoHuE13[] = [];
  let emitidos = 0;
  for (const candidato of candidatos) {
    try {
      const plazo = candidato.plazo_retiro_vencimiento!;
      const plazoIso = plazo.toISOString();
      const claveOrigen = `${candidato.pedido_venta_id}:${plazoIso}`;
      const cuenta = candidato.pedido_venta.cliente?.cuenta_web;
      domainEventBus.emit("ecommerce:plazo_retiro_por_vencer", {
        evento_id: `recordatorio:${claveOrigen}`,
        pedido_venta_id: candidato.pedido_venta_id,
        pedido_venta_ecommerce_id: candidato.id,
        numero_venta: candidato.pedido_venta.numero_venta,
        cliente_web_cuenta_id: cuenta?.is_active && cuenta.deleted_at === null ? cuenta.id : null,
        plazo_retiro_vencimiento: plazoIso,
        clave_origen: claveOrigen,
        actor_tipo: "SISTEMA",
        actor_id: null,
        timestamp: ahora.toISOString(),
      });
      emitidos++;
    } catch (error) {
      errores.push({ pedido_venta_id: candidato.pedido_venta_id, codigo: codigoSeguro(error) });
    }
  }
  return { procesados: candidatos.length, recordatorios_emitidos: emitidos, errores };
}

async function iniciarRefundInicialSiCorresponde(reintegroId: string): Promise<boolean> {
  const cabecera = await prisma.reintegroPedidoWeb.findUniqueOrThrow({
    where: { id: reintegroId },
    select: { estado: true, _count: { select: { intentos_refund: true } } },
  });
  if (cabecera.estado !== "PENDIENTE" || cabecera._count.intentos_refund !== 0) return false;
  await continuarRefundPedidoWeb(reintegroId);
  return true;
}

export async function procesarVencimientosRetiroHuE13(ahora: Date = new Date()): Promise<ResultadoVencimientosHuE13> {
  const candidatos = await prisma.pedidoVentaEcommerce.findMany({
    where: {
      estado_ecommerce: "LISTO_PARA_RETIRO",
      plazo_retiro_vencimiento: { lt: ahora },
      is_active: true,
      deleted_at: null,
      pedido_venta: { canal: "WEB", is_active: true, deleted_at: null },
    },
    select: { pedido_venta_id: true },
  });
  const errores: ErrorMantenimientoHuE13[] = [];
  let vencidos = 0;
  let refundsIniciados = 0;
  for (const candidato of candidatos) {
    try {
      const inicio = await iniciarReintegroPedidoWebPaso0({
        causa: "VENCIMIENTO",
        pedido_venta_id: candidato.pedido_venta_id,
      });
      vencidos++;
      if (await iniciarRefundInicialSiCorresponde(inicio.reintegro_id)) refundsIniciados++;
    } catch (error) {
      errores.push({ pedido_venta_id: candidato.pedido_venta_id, codigo: codigoSeguro(error) });
    }
  }
  return { procesados: candidatos.length, vencidos, refunds_iniciados: refundsIniciados, errores };
}

export async function procesarRetriesRefundHuE13(ahora: Date = new Date()): Promise<ResultadoRetriesHuE13> {
  const candidatos = await prisma.reintegroPedidoWeb.findMany({
    where: {
      estado: "PENDIENTE",
      proximo_reintento_at: { not: null, lte: ahora },
    },
    select: { id: true, pedido_venta_id: true },
  });
  const errores: ErrorMantenimientoHuE13[] = [];
  let reintentados = 0;
  for (const candidato of candidatos) {
    try {
      const pendiente = await prisma.reintegroRefundIntento.findFirst({
        where: { reintegro_id: candidato.id, estado: "PENDIENTE" },
        orderBy: { numero: "desc" },
        select: { id: true },
      });
      if (!pendiente) {
        throw new ServiceError("REINTEGRO_INCONSISTENTE", "La saga elegible no tiene un intento pendiente recuperable");
      }
      await continuarRefundPedidoWeb(candidato.id);
      reintentados++;
    } catch (error) {
      errores.push({ pedido_venta_id: candidato.pedido_venta_id, codigo: codigoSeguro(error) });
    }
  }
  return { procesados: candidatos.length, refunds_reintentados: reintentados, errores };
}
