import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { crearClienteTx } from "@/lib/services/clientes/cliente.service";
import { obtenerUsuarioCanalWebId } from "@/lib/services/ecommerce/usuario-canal-web";
import { resolverClienteCreadoEnRegistro } from "@/lib/services/ecommerce/registro-cuenta-web.reglas";
import { obtenerBloqueoMinutosCuentaWeb, obtenerMaxIntentosCuentaWeb } from "@/lib/services/sistema/configuracion.service";
import type { BajaCuentaWebInput, RedefinirPasswordInput, RegistroCuentaWebInput, ValidarVinculacionInput } from "@/lib/schemas/cuenta-cliente-web.schema";

const ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const MINUTOS_RECUPERACION = 15;
const credencialesInvalidas = () => new ServiceError("CREDENCIALES_INVALIDAS", "Email o contraseña incorrectos");
const cuentaBloqueada = () => new ServiceError("CUENTA_BLOQUEADA", "La cuenta está bloqueada temporalmente por intentos fallidos; la recuperación es presencial en sucursal");

export const MENSAJE_ERROR_INTERNO_CUENTA_WEB = "Error interno. Intentá más tarde.";

/** Configuración `ECOMMERCE_CUENTA_WEB_*` ausente o inválida: error operativo 500, no de negocio. */
export class ErrorConfiguracionCuentaWeb extends Error {
  constructor(causa: ServiceError) {
    super(causa.message, { cause: causa });
    this.name = "ErrorConfiguracionCuentaWeb";
  }
}

async function obtenerConfiguracionBloqueo() {
  try {
    return await Promise.all([obtenerMaxIntentosCuentaWeb(), obtenerBloqueoMinutosCuentaWeb()]);
  } catch (error) {
    if (error instanceof ServiceError && error.code.startsWith("CONFIGURACION_")) throw new ErrorConfiguracionCuentaWeb(error);
    throw error;
  }
}

const digestCodigo = (codigo: string) => createHash("sha256").update(codigo.trim().toUpperCase()).digest("hex");
const generarCodigo = () => Array.from({ length: 8 }, () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]).join("");
const baseEvento = (cuentaId: string, clienteId: string, actorTipo: "cuenta" | "usuario", actorId: string) => ({
  cuenta_id: cuentaId, cliente_id: clienteId, actor_tipo: actorTipo, actor_id: actorId, ocurrido_en: new Date().toISOString(),
});

export async function registrarCuentaClienteWeb(input: RegistroCuentaWebInput) {
  const [{ hash }, usuarioId] = await Promise.all([hashPassword(input.password), obtenerUsuarioCanalWebId()]);
  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const existente = await tx.cliente.findUnique({
        where: { dni: input.dni }, select: { id: true, is_active: true, deleted_at: true },
      });
      if (existente && (!existente.is_active || existente.deleted_at)) {
        throw new ServiceError("REGISTRO_WEB_NO_DISPONIBLE", "No es posible completar el registro con los datos indicados.");
      }
      let clienteId: string;
      let pendiente: boolean;
      if (existente) {
        clienteId = existente.id;
        pendiente = true;
      } else {
        const creado = await crearClienteTx(tx, {
          nombre: input.nombre, dni: input.dni, telefono: input.telefono, email: input.email,
          acepta_tratamiento_datos: true,
          decision_comercial: input.acepta_comunicaciones ? "ACEPTA" : "RECHAZA",
        }, usuarioId);
        const concurrente = creado.esNuevo ? undefined : await tx.cliente.findUniqueOrThrow({
          where: { id: creado.cliente.id }, select: { is_active: true, deleted_at: true },
        });
        const resolucion = resolverClienteCreadoEnRegistro(creado, concurrente);
        if (!resolucion.disponible) {
          throw new ServiceError("REGISTRO_WEB_NO_DISPONIBLE", "No es posible completar el registro con los datos indicados.");
        }
        ({ clienteId, pendiente } = resolucion);
      }
      if (await tx.cuentaClienteWeb.findUnique({ where: { cliente_id: clienteId }, select: { id: true } })) {
        throw new ServiceError("CUENTA_WEB_YA_EXISTE", "Ya existe una cuenta web para este DNI");
      }
      const cuenta = await tx.cuentaClienteWeb.create({
        data: { cliente_id: clienteId, email: input.email, password_hash: hash, vinculacion_pendiente: pendiente },
        select: { id: true, cliente_id: true, vinculacion_pendiente: true },
      });
      return cuenta;
    });
    domainEventBus.emit("ecommerce:cuenta_web_registrada", {
      ...baseEvento(resultado.id, resultado.cliente_id, "cuenta", resultado.id),
      vinculacion_pendiente: resultado.vinculacion_pendiente,
      acepta_tratamiento: true,
      acepta_comunicaciones: input.acepta_comunicaciones,
    });
    return { cuenta_id: resultado.id, cliente_id: resultado.cliente_id, vinculacion_pendiente: resultado.vinculacion_pendiente };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const campos = Array.isArray(error.meta?.target) ? error.meta.target.map(String) : [];
      if (campos.includes("cliente_id") || campos.includes("dni")) {
        const cuentaDelDni = await prisma.cuentaClienteWeb.findFirst({ where: { cliente: { dni: input.dni } }, select: { id: true } });
        if (cuentaDelDni) throw new ServiceError("CUENTA_WEB_YA_EXISTE", "Ya existe una cuenta web para este DNI");
      }
      throw new ServiceError("REGISTRO_WEB_NO_DISPONIBLE", "No es posible completar el registro con los datos indicados.");
    }
    throw error;
  }
}

async function registrarFallo(cuentaId: string, passwordValida: boolean, tokenVersion: number) {
  const [maxIntentos, bloqueoMinutos] = await obtenerConfiguracionBloqueo();
  const resultado = await prisma.$transaction(async (tx) => {
    const filas = await tx.$queryRaw<Array<{ id: string; cliente_id: string; intentos_fallidos: number; bloqueada_hasta: Date | null; token_version: number; vinculacion_pendiente: boolean; email: string }>>`
      SELECT id, cliente_id, intentos_fallidos, bloqueada_hasta, token_version, vinculacion_pendiente, email
      FROM cuentas_cliente_web WHERE id = ${cuentaId} AND is_active = true AND deleted_at IS NULL FOR UPDATE`;
    const cuenta = filas[0];
    if (!cuenta || cuenta.token_version !== tokenVersion) throw credencialesInvalidas();
    const ahora = new Date();
    if (cuenta.bloqueada_hasta && cuenta.bloqueada_hasta > ahora) throw cuentaBloqueada();
    const vencido = cuenta.bloqueada_hasta && cuenta.bloqueada_hasta <= ahora;
    if (passwordValida) {
      await tx.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { intentos_fallidos: 0, bloqueada_hasta: null } });
      return { cuenta, bloqueada: false, bloqueadaHasta: null };
    }
    const intentos = (vencido ? 0 : cuenta.intentos_fallidos) + 1;
    const bloqueadaHasta = intentos >= maxIntentos ? new Date(ahora.getTime() + bloqueoMinutos * 60_000) : null;
    await tx.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { intentos_fallidos: intentos, bloqueada_hasta: bloqueadaHasta } });
    return { cuenta: { ...cuenta, intentos_fallidos: intentos }, bloqueada: !!bloqueadaHasta, bloqueadaHasta };
  });
  if (resultado.bloqueada && resultado.bloqueadaHasta) {
    domainEventBus.emit("ecommerce:cuenta_web_bloqueada", {
      ...baseEvento(resultado.cuenta.id, resultado.cuenta.cliente_id, "cuenta", resultado.cuenta.id),
      intentos: resultado.cuenta.intentos_fallidos,
      bloqueada_hasta: resultado.bloqueadaHasta.toISOString(),
    });
    throw cuentaBloqueada();
  }
  if (!passwordValida) throw credencialesInvalidas();
  return resultado.cuenta;
}

export async function autenticarCuentaClienteWeb(email: string, password: string) {
  const cuenta = await prisma.cuentaClienteWeb.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, cliente_id: true, email: true, password_hash: true, token_version: true, bloqueada_hasta: true, vinculacion_pendiente: true, is_active: true, deleted_at: true, cliente: { select: { is_active: true, deleted_at: true } } },
  });
  if (!cuenta || !cuenta.is_active || cuenta.deleted_at || !cuenta.cliente.is_active || cuenta.cliente.deleted_at) throw credencialesInvalidas();
  if (cuenta.bloqueada_hasta && cuenta.bloqueada_hasta > new Date()) throw cuentaBloqueada();
  const valida = await verifyPassword(password, cuenta.password_hash);
  const bloqueada = await registrarFallo(cuenta.id, valida, cuenta.token_version);
  return { cuentaId: bloqueada.id, clienteId: bloqueada.cliente_id, email: bloqueada.email, tokenVersion: bloqueada.token_version, vinculacionPendiente: bloqueada.vinculacion_pendiente };
}

async function emitirRecuperacionTx(tx: Prisma.TransactionClient, cuenta: { id: string; cliente_id: string }, actorUsuarioId: string) {
  const codigo = generarCodigo();
  const expiraEn = new Date(Date.now() + MINUTOS_RECUPERACION * 60_000);
  await tx.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { recuperacion_codigo_digest: digestCodigo(codigo), recuperacion_expira_en: expiraEn, recuperacion_emitida_por_id: actorUsuarioId } });
  return { codigo, expiraEn };
}

export async function habilitarRecuperacionCuentaWeb(cuentaId: string, actorUsuarioId: string) {
  const resultado = await prisma.$transaction(async (tx) => {
    const cuenta = await tx.cuentaClienteWeb.findFirst({ where: { id: cuentaId, is_active: true, deleted_at: null }, select: { id: true, cliente_id: true, vinculacion_pendiente: true } });
    if (!cuenta) throw new ServiceError("CUENTA_WEB_NO_ENCONTRADA", "Cuenta web no encontrada");
    if (cuenta.vinculacion_pendiente) throw new ServiceError("CUENTA_VINCULACION_PENDIENTE", "La cuenta está pendiente de validación de identidad");
    return { cuenta, ...(await emitirRecuperacionTx(tx, cuenta, actorUsuarioId)) };
  });
  domainEventBus.emit("ecommerce:cuenta_web_recuperacion_habilitada", { ...baseEvento(resultado.cuenta.id, resultado.cuenta.cliente_id, "usuario", actorUsuarioId), expira_en: resultado.expiraEn.toISOString() });
  return { codigo: resultado.codigo, expira_en: resultado.expiraEn.toISOString() };
}

export async function validarVinculacionCuentaWeb(cuentaId: string, actorUsuarioId: string, input: ValidarVinculacionInput) {
  const hashDescartado = input.email_reconocido ? null : (await hashPassword(randomBytes(32).toString("hex"))).hash;
  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<Array<{ id: string; cliente_id: string; vinculacion_pendiente: boolean }>>`
        SELECT id, cliente_id, vinculacion_pendiente
        FROM cuentas_cliente_web WHERE id = ${cuentaId} AND is_active = true AND deleted_at IS NULL FOR UPDATE`;
      const cuenta = filas[0];
      if (!cuenta) throw new ServiceError("CUENTA_WEB_NO_ENCONTRADA", "Cuenta web no encontrada");
      if (!cuenta.vinculacion_pendiente) return { cuenta, cambio: false, accesoReasignado: false, recuperacion: null };
      await tx.cuentaClienteWeb.update({
        where: { id: cuenta.id }, data: input.email_reconocido
          ? { vinculacion_pendiente: false }
          : { email: input.email_titular, password_hash: hashDescartado!, token_version: { increment: 1 }, intentos_fallidos: 0, bloqueada_hasta: null, vinculacion_pendiente: false },
      });
      const recuperacion = input.email_reconocido ? null : await emitirRecuperacionTx(tx, cuenta, actorUsuarioId);
      return { cuenta, cambio: true, accesoReasignado: !input.email_reconocido, recuperacion };
    });
    if (resultado.cambio) {
      domainEventBus.emit("ecommerce:cuenta_web_vinculada", { ...baseEvento(resultado.cuenta.id, resultado.cuenta.cliente_id, "usuario", actorUsuarioId), acceso_reasignado: resultado.accesoReasignado });
      if (resultado.recuperacion) domainEventBus.emit("ecommerce:cuenta_web_recuperacion_habilitada", { ...baseEvento(resultado.cuenta.id, resultado.cuenta.cliente_id, "usuario", actorUsuarioId), expira_en: resultado.recuperacion.expiraEn.toISOString() });
    }
    return { cuenta_id: resultado.cuenta.id, vinculacion_pendiente: false, acceso_reasignado: resultado.accesoReasignado, ...(resultado.recuperacion ? { codigo: resultado.recuperacion.codigo, expira_en: resultado.recuperacion.expiraEn.toISOString() } : {}) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ServiceError("REGISTRO_WEB_NO_DISPONIBLE", "No es posible completar el registro con los datos indicados.");
    throw error;
  }
}

export async function redefinirPasswordCuentaWeb(input: RedefinirPasswordInput) {
  const cuenta = await prisma.cuentaClienteWeb.findUnique({ where: { email: input.email }, select: { id: true, cliente_id: true, bloqueada_hasta: true, token_version: true, is_active: true, vinculacion_pendiente: true } });
  if (cuenta?.bloqueada_hasta && cuenta.bloqueada_hasta > new Date()) throw cuentaBloqueada();
  const { hash } = await hashPassword(input.password);
  const actualizado = await prisma.cuentaClienteWeb.updateMany({
    where: { email: input.email, is_active: true, deleted_at: null, vinculacion_pendiente: false, recuperacion_codigo_digest: digestCodigo(input.codigo), recuperacion_expira_en: { gt: new Date() } },
    data: { password_hash: hash, recuperacion_codigo_digest: null, recuperacion_expira_en: null, recuperacion_emitida_por_id: null, intentos_fallidos: 0, bloqueada_hasta: null, token_version: { increment: 1 } },
  });
  if (actualizado.count !== 1 || !cuenta) {
    if (cuenta?.is_active) {
      try { await registrarFallo(cuenta.id, false, cuenta.token_version); }
      catch (error) { if (!(error instanceof ServiceError) || error.code !== "CREDENCIALES_INVALIDAS") throw error; }
    }
    throw new ServiceError("CODIGO_RECUPERACION_INVALIDO", "El código no es válido o venció");
  }
  domainEventBus.emit("ecommerce:cuenta_web_password_redefinida", baseEvento(cuenta.id, cuenta.cliente_id, "cuenta", cuenta.id));
  return { cuenta_id: cuenta.id };
}

export async function darDeBajaCuentaWeb(cuentaId: string, input: BajaCuentaWebInput) {
  const cuenta = await prisma.$transaction(async (tx) => {
    const actual = await tx.cuentaClienteWeb.findFirst({ where: { id: cuentaId, is_active: true, deleted_at: null, vinculacion_pendiente: false }, select: { id: true, cliente_id: true } });
    if (!actual) throw new ServiceError("CUENTA_WEB_NO_ENCONTRADA", "Cuenta web no encontrada");
    await tx.cuentaClienteWeb.update({ where: { id: cuentaId }, data: { is_active: false, deleted_at: new Date(), deleted_by: `cuenta_web:${cuentaId}`, deletion_reason: input.motivo, token_version: { increment: 1 }, recuperacion_codigo_digest: null, recuperacion_expira_en: null, recuperacion_emitida_por_id: null } });
    return actual;
  });
  domainEventBus.emit("ecommerce:cuenta_web_baja", { ...baseEvento(cuenta.id, cuenta.cliente_id, "cuenta", cuenta.id), motivo: input.motivo });
  return { cuenta_id: cuenta.id };
}

export async function buscarCuentaWebPorDni(dni: string) {
  return prisma.cuentaClienteWeb.findFirst({
    where: { cliente: { dni } },
    select: { id: true, email: true, vinculacion_pendiente: true, intentos_fallidos: true, bloqueada_hasta: true, is_active: true, deleted_at: true, created_at: true, cliente: { select: { id: true, nombre: true, dni: true } } },
  });
}
