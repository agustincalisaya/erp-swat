import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus, listenersRegistrados } from "@/lib/events/domain-event-bus";
import { diaCalendarioUtc, diaNegocioIso, inicioDiaUtc, rangoMesFechaSolo } from "@/lib/utils/fecha-negocio";
import type { GastoOperativoDatos } from "@/lib/events/event-types";
import type { CrearGastoOperativoInput, EditarGastoOperativoInput, DarDeBajaGastoOperativoInput, ListarGastosOperativosInput } from "@/lib/schemas/gasto-operativo.schema";

export const PERMISO_GESTIONAR_GASTOS = "tesoreria:gestionar_gastos";
const seleccion = {
  id: true, categoria_gasto_id: true, monto: true, fecha: true, descripcion: true,
  is_active: true, updated_at: true, categoria: { select: { nombre: true } },
} as const;
type Fila = Prisma.GastoOperativoGetPayload<{ select: typeof seleccion }>;
export type GastoOperativoListado = ReturnType<typeof serializar>;

function serializar(fila: Fila) {
  return { id: fila.id, categoria_gasto_id: fila.categoria_gasto_id,
    categoria_nombre: fila.categoria.nombre, fecha: diaCalendarioUtc(fila.fecha),
    monto: fila.monto.toFixed(2), descripcion: fila.descripcion, is_active: fila.is_active };
}
function datos(fila: Fila): GastoOperativoDatos {
  return { categoria_gasto_id: fila.categoria_gasto_id, fecha: diaCalendarioUtc(fila.fecha),
    monto: fila.monto.toFixed(2), descripcion: fila.descripcion };
}
function validarFecha(fecha: string): Date {
  const dia = inicioDiaUtc(fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha || fecha > diaNegocioIso()) {
    throw new ServiceError("VALIDATION_ERROR", "La fecha debe ser un día real y no posterior a hoy en Argentina");
  }
  return dia;
}
function validarMonto(monto: string): Prisma.Decimal {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(monto)) throw new ServiceError("VALIDATION_ERROR", "Monto inválido");
  const decimal = new Prisma.Decimal(monto);
  if (decimal.lte(0) || decimal.gt("9999999999.99")) throw new ServiceError("VALIDATION_ERROR", "Monto fuera de rango");
  return decimal;
}
async function categoriaActiva(tx: Prisma.TransactionClient, id: string) {
  const categoria = await tx.categoriaGasto.findUnique({ where: { id }, select: { is_active: true } });
  if (!categoria) throw new ServiceError("CATEGORIA_GASTO_NO_ENCONTRADA", "La categoría no existe");
  if (!categoria.is_active) throw new ServiceError("CATEGORIA_GASTO_INACTIVA", "La categoría seleccionada no está activa");
}
async function transaccion<T>(operacion: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let intento = 0; intento < 3; intento++) {
    try { return await prisma.$transaction(operacion, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && intento < 2) continue;
      throw error;
    }
  }
  throw new Error("Transacción no completada");
}
function cabecera(fila: Fila, usuarioId: string) {
  return { gasto_operativo_id: fila.id, categoria_gasto_id: fila.categoria_gasto_id,
    fecha: diaCalendarioUtc(fila.fecha), monto: fila.monto.toFixed(2), usuario_id: usuarioId };
}

export async function crearGastoOperativo(input: CrearGastoOperativoInput, usuarioId: string): Promise<GastoOperativoListado> {
  const fecha = validarFecha(input.fecha);
  const monto = validarMonto(input.monto);
  const descripcion = input.descripcion.trim();
  if (!descripcion) throw new ServiceError("VALIDATION_ERROR", "La descripción es obligatoria");
  const fila = await transaccion(async (tx) => {
    await categoriaActiva(tx, input.categoria_gasto_id);
    return tx.gastoOperativo.create({ data: { categoria_gasto_id: input.categoria_gasto_id, fecha, monto, descripcion,
      registrado_por_id: usuarioId }, select: seleccion });
  });
  await listenersRegistrados;
  domainEventBus.emit("gasto_operativo:creado", cabecera(fila, usuarioId));
  return serializar(fila);
}

export async function editarGastoOperativo(id: string, input: EditarGastoOperativoInput, usuarioId: string): Promise<GastoOperativoListado> {
  const fechaInput = input.fecha === undefined ? undefined : validarFecha(input.fecha);
  const montoInput = input.monto === undefined ? undefined : validarMonto(input.monto);
  const descripcionInput = input.descripcion?.trim();
  if (descripcionInput === "") throw new ServiceError("VALIDATION_ERROR", "La descripción es obligatoria");
  const resultado = await transaccion(async (tx) => {
    const actual = await tx.gastoOperativo.findUnique({ where: { id }, select: seleccion });
    if (!actual) throw new ServiceError("GASTO_OPERATIVO_NO_ENCONTRADO", "El gasto no existe");
    if (!actual.is_active) throw new ServiceError("GASTO_OPERATIVO_DADO_DE_BAJA", "El gasto está dado de baja");
    const categoria_gasto_id = input.categoria_gasto_id ?? actual.categoria_gasto_id;
    if (categoria_gasto_id !== actual.categoria_gasto_id) await categoriaActiva(tx, categoria_gasto_id);
    const fecha = fechaInput ?? actual.fecha;
    const monto = montoInput ?? actual.monto;
    const descripcion = descripcionInput ?? actual.descripcion;
    if (categoria_gasto_id === actual.categoria_gasto_id && fecha.getTime() === actual.fecha.getTime() &&
        monto.eq(actual.monto) && descripcion === actual.descripcion) return { fila: actual, anterior: null };
    const cambio = await tx.gastoOperativo.updateMany({ where: { id, is_active: true, updated_at: actual.updated_at },
      data: { categoria_gasto_id, fecha, monto, descripcion } });
    if (!cambio.count) throw new ServiceError("GASTO_OPERATIVO_DADO_DE_BAJA", "El gasto cambió durante la edición; actualizá la página");
    const fila = await tx.gastoOperativo.findUniqueOrThrow({ where: { id }, select: seleccion });
    return { fila, anterior: datos(actual) };
  });
  if (resultado.anterior) {
    await listenersRegistrados;
    domainEventBus.emit("gasto_operativo:editado", { ...cabecera(resultado.fila, usuarioId),
      valor_anterior: resultado.anterior, valor_nuevo: datos(resultado.fila) });
  }
  return serializar(resultado.fila);
}

export async function darDeBajaGastoOperativo(id: string, input: DarDeBajaGastoOperativoInput, usuarioId: string): Promise<GastoOperativoListado> {
  const motivo = input.deletion_reason.trim();
  if (motivo.length < 5) throw new ServiceError("VALIDATION_ERROR", "El motivo debe tener al menos 5 caracteres");
  const fila = await transaccion(async (tx) => {
    const actual = await tx.gastoOperativo.findUnique({ where: { id }, select: seleccion });
    if (!actual) throw new ServiceError("GASTO_OPERATIVO_NO_ENCONTRADO", "El gasto no existe");
    if (!actual.is_active) throw new ServiceError("GASTO_OPERATIVO_DADO_DE_BAJA", "El gasto ya fue dado de baja");
    const cambio = await tx.gastoOperativo.updateMany({ where: { id, is_active: true, updated_at: actual.updated_at },
      data: { is_active: false, deleted_at: new Date(), deleted_by: usuarioId, deletion_reason: motivo } });
    if (!cambio.count) throw new ServiceError("GASTO_OPERATIVO_DADO_DE_BAJA", "El gasto cambió durante la baja; actualizá la página");
    return tx.gastoOperativo.findUniqueOrThrow({ where: { id }, select: seleccion });
  });
  await listenersRegistrados;
  domainEventBus.emit("gasto_operativo:dado_de_baja", { ...cabecera(fila, usuarioId), motivo });
  return serializar(fila);
}

export async function listarGastosOperativos(input: ListarGastosOperativosInput) {
  const mes = input.mes ?? diaNegocioIso().slice(0, 7);
  const [anio, numeroMes] = mes.split("-").map(Number);
  let rango;
  try { rango = rangoMesFechaSolo(anio, numeroMes); }
  catch { throw new ServiceError("VALIDATION_ERROR", "Mes inválido"); }
  const where: Prisma.GastoOperativoWhereInput = { is_active: true, fecha: { gte: rango.desde, lt: rango.hasta },
    ...(input.categoria_gasto_id ? { categoria_gasto_id: input.categoria_gasto_id } : {}) };
  const [filas, totalRegistros, agregado] = await prisma.$transaction([
    prisma.gastoOperativo.findMany({ where, select: seleccion, orderBy: [{ fecha: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.page_size, take: input.page_size }),
    prisma.gastoOperativo.count({ where }),
    prisma.gastoOperativo.aggregate({ where, _sum: { monto: true } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { mes, items: filas.map(serializar), total: (agregado._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
    total_registros: totalRegistros, page: input.page, page_size: input.page_size };
}
