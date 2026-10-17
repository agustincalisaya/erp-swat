import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { MesLibroIvaSchema } from "@/lib/schemas/libro-iva.schema";
import { diaCalendarioUtc, diaNegocioIso, rangoMesFechaSolo, rangoMesNegocio } from "@/lib/utils/fecha-negocio";
import { consultarComprobantes } from "@/lib/services/tesoreria/comprobantes-repositorio.service";
import {
  codigoCompra, codigoVenta, contraparteVenta, cuitLibro, DatoLibroIvaInvalido,
  importesLibro, numeroCompra, numeroVentaLibro, serializarLibro,
  type FilaLibroIva, type TipoLibroIva,
} from "./libro-iva.reglas";
import type { FilaLibroIvaVista, LibroIvaVista } from "./libro-iva.constants";

const SELECT_VENTAS = {
  id: true, created_at: true, tipo_comprobante: true, monto_total: true,
  comprobante_original_id: true, pedido_venta_id: true,
  pedido_venta: { select: { numero_venta: true, cliente: { select: { dni: true, nombre: true } } } },
  _count: { select: { notas_credito: true } },
  comprobante_original: { select: {
    id: true, tipo_comprobante: true, pedido_venta_id: true, comprobante_original_id: true,
    pedido_venta: { select: { numero_venta: true } }, _count: { select: { notas_credito: true } },
  } },
} satisfies Prisma.ComprobanteFiscalSelect;

function rangoMesLibro(anio: number, mes: number, fechaSolo: boolean) {
  const rango = (fechaSolo ? rangoMesFechaSolo : rangoMesNegocio)(anio, mes);
  // El helper compartido admite 9999, pero su string "10000-01-01" da Invalid
  // Date. Preservar aquí el rango admitido sin editar el helper de otro cluster.
  if (!Number.isFinite(rango.hasta.getTime())) {
    rango.hasta = new Date(rango.desde);
    rango.hasta.setUTCMonth(rango.hasta.getUTCMonth() + 1);
  }
  return rango;
}

/** Selección por comprobante; ningún join de pagos/ítems, límites ni N+1. */
export async function consultarLibroIva(tipo: TipoLibroIva, periodo: string): Promise<LibroIvaVista> {
  if (!MesLibroIvaSchema.safeParse(periodo).success) throw new ServiceError("VALIDATION_ERROR", "Seleccioná un mes válido (AAAA-MM).");
  const [anio, mes] = periodo.split("-").map(Number);
  const filas: FilaLibroIvaVista[] = [];
  const claves = new Set<string>();
  const incidencias: { comprobante_id: string; motivo: string }[] = [];
  let cantidadIncidencias = 0;
  const agregar = (id: string, proyectar: () => { fila: FilaLibroIva; emisor?: string }) => {
    try {
      const { fila, emisor = "" } = proyectar();
      const clave = [emisor, fila.tipo, fila.pv, fila.numero].join(":");
      if (claves.has(clave)) throw new DatoLibroIvaInvalido("NUMERACION_DUPLICADA");
      claves.add(clave);
      filas.push({ ...fila, id, denominacion: fila.denominacion.replace(/[;\r\n]/g, " ").trim() });
    } catch (error) {
      if (!(error instanceof DatoLibroIvaInvalido)) throw error;
      cantidadIncidencias++;
      if (incidencias.length < 20) incidencias.push({ comprobante_id: id, motivo: error.motivo });
    }
  };

  if (tipo === "VENTAS") {
    const rango = rangoMesLibro(anio!, mes!, false);
    // G3 recibe días inclusivos; las fechas de sus filtros usan el mismo rango argentino.
    const desde = diaNegocioIso(rango.desde);
    const hasta = diaNegocioIso(new Date(rango.hasta.getTime() - 1));
    const comprobantes = await consultarComprobantes({ fecha_desde: desde, fecha_hasta: hasta }, SELECT_VENTAS);
    comprobantes.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const c of comprobantes) agregar(c.id, () => {
      const esNC = c.tipo_comprobante === "NOTA_CREDITO";
      const original = c.comprobante_original;
      if (esNC && (!original || c.comprobante_original_id !== original.id || original.pedido_venta_id !== c.pedido_venta_id || original.comprobante_original_id !== null)) {
        throw new DatoLibroIvaInvalido("VINCULO_NC_INVALIDO");
      }
      if (!esNC && c.comprobante_original_id !== null) throw new DatoLibroIvaInvalido("VINCULO_ORIGINAL_INVALIDO");
      if (c._count.notas_credito > 1 || esNC && original!._count.notas_credito !== 1) {
        throw new DatoLibroIvaInvalido("MULTIPLES_NC_ORIGINAL");
      }
      return { fila: {
        fecha: diaNegocioIso(c.created_at).replace(/-/g, ""),
        tipo: codigoVenta(c.tipo_comprobante, original?.tipo_comprobante),
        ...numeroVentaLibro(esNC ? original!.pedido_venta.numero_venta : c.pedido_venta.numero_venta),
        ...contraparteVenta(c.pedido_venta.cliente), ...importesLibro(c.monto_total, esNC),
      } };
    });
  } else {
    const rango = rangoMesLibro(anio!, mes!, true);
    const comprobantes = await prisma.comprobanteProveedor.findMany({
      where: { is_active: true, fecha_emision: { gte: rango.desde, lt: rango.hasta } },
      select: { id: true, fecha_emision: true, tipo: true, numero_comprobante: true, monto_total: true,
        proveedor: { select: { cuit: true, razon_social: true } } },
      orderBy: [{ fecha_emision: "asc" }, { id: "asc" }],
    });
    for (const c of comprobantes) agregar(c.id, () => {
      const cuit = cuitLibro(c.proveedor.cuit);
      return { emisor: cuit, fila: {
        fecha: diaCalendarioUtc(c.fecha_emision).replace(/-/g, ""), tipo: codigoCompra(c.tipo),
        ...numeroCompra(c.numero_comprobante), tipo_doc: "80", numero_doc: cuit,
        denominacion: c.proveedor.razon_social, ...importesLibro(c.monto_total),
      } };
    });
  }
  if (cantidadIncidencias) throw new ServiceError("LIBRO_IVA_DATOS_INVALIDOS", "Hay comprobantes con datos incompatibles con este libro. Revisá los registros indicados.", {
    incidencias, total_incidencias: cantidadIncidencias, hay_mas: cantidadIncidencias > incidencias.length,
  });
  const suma = (campo: "neto" | "iva" | "total") => filas.reduce((valor, fila) => valor.plus(fila[campo]), new Prisma.Decimal(0)).toFixed(2);
  return { tipo, periodo, filas, totales: {
    comprobantes: filas.length,
    notas_credito: filas.filter((fila) => fila.tipo === "003" || fila.tipo === "008").length,
    neto: suma("neto"), iva: suma("iva"), total: suma("total"),
  } };
}

/** Una sola proyección validada para pantalla, PDF y TXT. */
export async function generarLibroIva(tipo: TipoLibroIva, periodo: string): Promise<string> {
  return serializarLibro((await consultarLibroIva(tipo, periodo)).filas);
}
