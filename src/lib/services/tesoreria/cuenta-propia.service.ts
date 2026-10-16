import "server-only";

/**
 * @module cuenta-propia.service
 * @description Capa de dominio de HU-G5 — Cuentas bancarias y cajas propias
 * (spec_modulo_G.md §9.7). Reemplaza el catálogo fijo en código de HU-G10
 * (`src/lib/tesoreria/cuentas-origen.ts`, retirado en esta HU).
 *
 * TODA la lógica de negocio del ciclo de vida de una `CuentaPropia` vive acá:
 * los Route Handlers (`app/api/tesoreria/cuentas-propias/**`) y las Server
 * Actions (`app/(dashboard)/tesoreria/cuentas-propias/actions.ts`) son
 * wrappers finos. Está prohibido reimplementar cualquier regla de acá en esas
 * capas.
 *
 * Reglas transversales aplicadas (spec §9.7, RULES.md §1/§3):
 *  - Ninguna función de este archivo hace borrado físico: no se invoca
 *    `prisma.*.delete` ni `deleteMany`. `darDeBajaCuentaPropia()` es baja
 *    lógica (`is_active=false` + `deleted_*`).
 *  - El CBU y el alias se cifran POR CAMPO con `lib/crypto/aes.ts`
 *    (`encrypt`/`decrypt`, clave `ENCRYPTION_KEY_PROVEEDORES`), persistidos
 *    como `cbu_cifrado/cbu_iv` y `alias_cifrado/alias_iv`. El valor en claro
 *    NUNCA va a la DB, `AuditLog`, logs, eventos ni respuestas.
 *  - La lectura enmascarada devuelve como máximo los 4 caracteres finales; el
 *    revelado en claro exige el permiso `ver_datos_bancarios` y se audita.
 *  - Cada lectura de CBU/alias emite `tesoreria:datos_bancarios_consultados`
 *    desde acá (sin COMMIT que esperar), con actor/cuenta/momento y sin
 *    valores. Las mutaciones emiten sus eventos D.3 DESPUÉS del COMMIT.
 *  - Este servicio NUNCA escribe `AuditLog` directo: `audit-log.listener.ts`
 *    es el único escritor y reacciona a los eventos que emite este archivo.
 */

import { Prisma } from "@prisma/client";
import type { TipoCuentaPropia } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decrypt, encrypt } from "@/lib/crypto/aes";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  CrearCuentaPropiaInput,
  DarDeBajaCuentaPropiaInput,
  EditarCuentaPropiaInput,
} from "@/lib/schemas/cuenta-propia.schema";
import { enmascararUltimos4 } from "@/lib/services/tesoreria/cuenta-propia.mascara";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §9.1/§9.7) — un permiso independiente por acción,
// nunca un único permiso de "administrar" genérico. Punto de verdad compartido
// por los Route Handlers, las Server Actions y la guarda de revelado.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_GESTIONAR_CUENTAS_BANCARIAS = "tesoreria:gestionar_cuentas_bancarias";
export const PERMISO_LEER_CUENTAS_BANCARIAS = "tesoreria:leer_cuentas_bancarias";
export const PERMISO_VER_DATOS_BANCARIOS = "tesoreria:ver_datos_bancarios";

// ──────────────────────────────────────────────────────────────────────────────
// Enmascarado (G5-3) — helper PURO re-exportado desde su módulo hermano
// `cuenta-propia.mascara.ts` (sin `server-only`, verificable por el runner de
// tests). El punto de verdad de la regla de enmascarado es único.
// ──────────────────────────────────────────────────────────────────────────────

export { enmascararUltimos4 } from "@/lib/services/tesoreria/cuenta-propia.mascara";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos (DTOs)
// ──────────────────────────────────────────────────────────────────────────────

export interface CuentaPropiaListado {
  id: string;
  nombre: string;
  tipo: TipoCuentaPropia;
  banco: string | null;
  cbu_enmascarado: string | null;
  alias_enmascarado: string | null;
  tiene_datos_bancarios: boolean;
  is_active: boolean;
  created_at: Date;
}

export interface CuentaPropiaDetalle extends CuentaPropiaListado {
  deleted_at: Date | null;
  deletion_reason: string | null;
}

export interface CuentaPropiaSelector {
  id: string;
  nombre: string;
  tipo: TipoCuentaPropia;
}

export interface CuentaPropiaCreada {
  cuenta_propia_id: string;
  nombre: string;
  tipo: TipoCuentaPropia;
}

export interface CuentaPropiaEditada {
  cuenta_propia_id: string;
  campos_editados: string[];
}

export interface CuentaPropiaDadaDeBaja {
  cuenta_propia_id: string;
  is_active: false;
}

export interface CuentaPropiaRevelada {
  cuenta_propia_id: string;
  cbu: string | null;
  alias: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────────────────────

/** Descifra un par `*_cifrado`/`*_iv` (si existe) y lo enmascara. */
function enmascararCifrado(ciphertext: string | null, iv: string | null): string | null {
  if (!ciphertext || !iv) return null;
  return enmascararUltimos4(decrypt({ ciphertext, iv }));
}

/** Descifra un par `*_cifrado`/`*_iv` (si existe), sin enmascarar. Nunca se loguea. */
function descifrarCampo(ciphertext: string | null, iv: string | null): string | null {
  if (!ciphertext || !iv) return null;
  return decrypt({ ciphertext, iv });
}

/**
 * Emite `tesoreria:datos_bancarios_consultados` UNA vez por cuenta leída. El
 * payload solo lleva actor/cuenta/momento — nunca el valor (spec §9.7, G5-4).
 * Sin transacción de negocio: se publica directo, enmascarando fallos del
 * listener (nunca revierten la lectura).
 */
function emitirConsultaDatosBancarios(cuentaPropiaId: string, usuarioId: string): void {
  try {
    domainEventBus.emit("tesoreria:datos_bancarios_consultados", {
      cuenta_propia_id: cuentaPropiaId,
      usuario_id: usuarioId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "[cuenta-propia.service] Falló la publicación de tesoreria:datos_bancarios_consultados:",
      {
        cuenta_propia_id: cuentaPropiaId,
        error: error instanceof Error ? error.message : "error desconocido",
      },
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Lectura enmascarada (G5-3)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Listado operativo de cuentas propias ACTIVAS (`is_active=true`,
 * `deleted_at=null`), orden estable por nombre. El CBU/alias se descifran para
 * enmascararlos — el valor en claro nunca sale de acá (spec §9.7). Cada cuenta
 * leída deja un asiento `tesoreria:datos_bancarios_consultados` (G5-4).
 */
export async function listarCuentasPropias(usuarioId: string): Promise<CuentaPropiaListado[]> {
  const filas = await prisma.cuentaPropia.findMany({
    where: { is_active: true, deleted_at: null },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      tipo: true,
      banco: true,
      cbu_cifrado: true,
      cbu_iv: true,
      alias_cifrado: true,
      alias_iv: true,
      is_active: true,
      created_at: true,
    },
  });

  const listado: CuentaPropiaListado[] = filas.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    tipo: fila.tipo,
    banco: fila.banco,
    cbu_enmascarado: enmascararCifrado(fila.cbu_cifrado, fila.cbu_iv),
    alias_enmascarado: enmascararCifrado(fila.alias_cifrado, fila.alias_iv),
    tiene_datos_bancarios: fila.cbu_cifrado !== null || fila.alias_cifrado !== null,
    is_active: fila.is_active,
    created_at: fila.created_at,
  }));

  for (const fila of filas) {
    emitirConsultaDatosBancarios(fila.id, usuarioId);
  }

  return listado;
}

/**
 * Detalle enmascarado de una cuenta propia activa. Mismo contrato de
 * enmascarado y auditoría de lectura que `listarCuentasPropias` (G5-3/G5-4).
 *
 * @throws {ServiceError} CUENTA_PROPRIA_NO_ENCONTRADA
 */
export async function obtenerCuentaPropia(
  id: string,
  usuarioId: string,
): Promise<CuentaPropiaDetalle> {
  const fila = await prisma.cuentaPropia.findFirst({
    where: { id, is_active: true, deleted_at: null },
    select: {
      id: true,
      nombre: true,
      tipo: true,
      banco: true,
      cbu_cifrado: true,
      cbu_iv: true,
      alias_cifrado: true,
      alias_iv: true,
      is_active: true,
      deleted_at: true,
      deletion_reason: true,
      created_at: true,
    },
  });

  if (!fila) {
    throw new ServiceError(
      "CUENTA_PROPRIA_NO_ENCONTRADA",
      "La cuenta propia indicada no existe o está inactiva",
    );
  }

  emitirConsultaDatosBancarios(fila.id, usuarioId);

  return {
    id: fila.id,
    nombre: fila.nombre,
    tipo: fila.tipo,
    banco: fila.banco,
    cbu_enmascarado: enmascararCifrado(fila.cbu_cifrado, fila.cbu_iv),
    alias_enmascarado: enmascararCifrado(fila.alias_cifrado, fila.alias_iv),
    tiene_datos_bancarios: fila.cbu_cifrado !== null || fila.alias_cifrado !== null,
    is_active: fila.is_active,
    deleted_at: fila.deleted_at,
    deletion_reason: fila.deletion_reason,
    created_at: fila.created_at,
  };
}

/**
 * Cuentas propias activas para selectores (ej. el formulario de pago de
 * HU-G10). Proyección mínima `{ id, nombre, tipo }`: NO selecciona los campos
 * cifrados, por lo que no descifra ni audita ninguna lectura (spec §9.7).
 */
export async function listarCuentasPropiasActivas(): Promise<CuentaPropiaSelector[]> {
  return prisma.cuentaPropia.findMany({
    where: { is_active: true, deleted_at: null },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, tipo: true },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Alta (G5-1/G5-8)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Alta de una `CuentaPropia`. El cifrado de CBU/alias (por campo, extraído con
 * `encrypt()` con IV NUEVO) ocurre ANTES de la transacción (spec §9.7); el
 * evento `tesoreria:cuenta_propia_creada` se emite post-COMMIT con campos NO
 * sensibles.
 */
export async function crearCuentaPropia(
  input: CrearCuentaPropiaInput,
  usuarioId: string,
): Promise<CuentaPropiaCreada> {
  const banco = input.banco !== undefined && input.banco.length > 0 ? input.banco : null;
  const cbu = input.cbu !== undefined && input.cbu.length > 0 ? encrypt(input.cbu) : null;
  const alias = input.alias !== undefined && input.alias.length > 0 ? encrypt(input.alias) : null;

  const creada = await prisma.$transaction((tx) =>
    tx.cuentaPropia.create({
      data: {
        nombre: input.nombre,
        tipo: input.tipo,
        banco,
        cbu_cifrado: cbu?.ciphertext ?? null,
        cbu_iv: cbu?.iv ?? null,
        alias_cifrado: alias?.ciphertext ?? null,
        alias_iv: alias?.iv ?? null,
      },
      select: { id: true, nombre: true, tipo: true },
    }),
  );

  domainEventBus.emit("tesoreria:cuenta_propia_creada", {
    cuenta_propia_id: creada.id,
    usuario_id: usuarioId,
    nombre: creada.nombre,
    tipo: creada.tipo,
    banco,
  });

  return { cuenta_propia_id: creada.id, nombre: creada.nombre, tipo: creada.tipo };
}

// ──────────────────────────────────────────────────────────────────────────────
// Edición (G5-1/G5-8)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Edición parcial de una `CuentaPropia`. La lectura del estado origen corre
 * DENTRO de la transacción que hace el `updateMany` (race-safe, patrón
 * `editarProveedor`). Un dato sensible solo se RE-CIFRA (IV NUEVO) si su valor
 * cambió; `campos_editados` incluye los NOMBRES `cbu`/`alias`, nunca el valor.
 * Sin cambios → sin escritura ni evento.
 *
 * @throws {ServiceError} CUENTA_PROPRIA_NO_ENCONTRADA
 */
export async function editarCuentaPropia(
  id: string,
  input: EditarCuentaPropiaInput,
  usuarioId: string,
): Promise<CuentaPropiaEditada> {
  const resultado = await prisma.$transaction(async (tx) => {
    const actual = await tx.cuentaPropia.findFirst({
      where: { id },
      select: {
        id: true,
        nombre: true,
        tipo: true,
        banco: true,
        cbu_cifrado: true,
        cbu_iv: true,
        alias_cifrado: true,
        alias_iv: true,
        is_active: true,
        deleted_at: true,
      },
    });
    if (!actual || !actual.is_active || actual.deleted_at !== null) {
      throw new ServiceError(
        "CUENTA_PROPRIA_NO_ENCONTRADA",
        "La cuenta propia indicada no existe o está inactiva",
      );
    }

    const data: Prisma.CuentaPropiaUpdateManyMutationInput = {};
    const camposEditados: string[] = [];
    let cbuCambiado = false;
    let aliasCambiado = false;

    if (input.nombre !== undefined && input.nombre !== actual.nombre) {
      data.nombre = input.nombre;
      camposEditados.push("nombre");
    }
    if (input.tipo !== undefined && input.tipo !== actual.tipo) {
      data.tipo = input.tipo;
      camposEditados.push("tipo");
    }
    if (input.banco !== undefined) {
      const nuevoBanco = input.banco.length > 0 ? input.banco : null;
      if (nuevoBanco !== actual.banco) {
        data.banco = nuevoBanco;
        camposEditados.push("banco");
      }
    }
    if (input.cbu !== undefined) {
      const nuevoCbu = input.cbu.length > 0 ? input.cbu : null;
      const actualCbu = descifrarCampo(actual.cbu_cifrado, actual.cbu_iv);
      if (nuevoCbu !== actualCbu) {
        const cifrado = nuevoCbu !== null ? encrypt(nuevoCbu) : null;
        data.cbu_cifrado = cifrado?.ciphertext ?? null;
        data.cbu_iv = cifrado?.iv ?? null;
        camposEditados.push("cbu");
        cbuCambiado = true;
      }
    }
    if (input.alias !== undefined) {
      const nuevoAlias = input.alias.length > 0 ? input.alias : null;
      const actualAlias = descifrarCampo(actual.alias_cifrado, actual.alias_iv);
      if (nuevoAlias !== actualAlias) {
        const cifrado = nuevoAlias !== null ? encrypt(nuevoAlias) : null;
        data.alias_cifrado = cifrado?.ciphertext ?? null;
        data.alias_iv = cifrado?.iv ?? null;
        camposEditados.push("alias");
        aliasCambiado = true;
      }
    }

    // Sin cambios → sin escritura (Prisma rechaza `updateMany` con `data: {}`)
    // y sin evento: no hay nada nuevo que auditar.
    if (camposEditados.length === 0) {
      return { camposEditados, cbuCambiado, aliasCambiado };
    }

    const cambio = await tx.cuentaPropia.updateMany({
      where: { id, is_active: true, deleted_at: null },
      data,
    });
    if (cambio.count === 0) {
      throw new ServiceError(
        "CUENTA_PROPRIA_NO_ENCONTRADA",
        "La cuenta propia indicada no existe o está inactiva",
      );
    }

    return { camposEditados, cbuCambiado, aliasCambiado };
  });

  if (resultado.camposEditados.length > 0) {
    domainEventBus.emit("tesoreria:cuenta_propia_editada", {
      cuenta_propia_id: id,
      usuario_id: usuarioId,
      campos_editados: resultado.camposEditados,
      cbu_cambiado: resultado.cbuCambiado,
      alias_cambiado: resultado.aliasCambiado,
    });
  }

  return { cuenta_propia_id: id, campos_editados: resultado.camposEditados };
}

// ──────────────────────────────────────────────────────────────────────────────
// Baja lógica (G5-1/G5-8)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Baja lógica de una `CuentaPropia` (RULES.md Regla 1): `is_active=false` +
 * `deleted_at` + `deleted_by` + `deletion_reason`. NUNCA un `DELETE`. El motivo
 * es obligatorio (garantizado por `DarDeBajaCuentaPropiaSchema`).
 *
 * @throws {ServiceError} CUENTA_PROPRIA_NO_ENCONTRADA
 */
export async function darDeBajaCuentaPropia(
  id: string,
  input: DarDeBajaCuentaPropiaInput,
  usuarioId: string,
): Promise<CuentaPropiaDadaDeBaja> {
  const cambio = await prisma.cuentaPropia.updateMany({
    where: { id, is_active: true, deleted_at: null },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: usuarioId,
      deletion_reason: input.deletion_reason,
    },
  });

  if (cambio.count === 0) {
    throw new ServiceError(
      "CUENTA_PROPRIA_NO_ENCONTRADA",
      "La cuenta propia indicada no existe o está inactiva",
    );
  }

  domainEventBus.emit("tesoreria:cuenta_propia_baja_logica", {
    cuenta_propia_id: id,
    usuario_id: usuarioId,
    motivo: input.deletion_reason,
  });

  return { cuenta_propia_id: id, is_active: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Revelado explícito (G5-3) — permiso propio y auditoría de lectura
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Revela el CBU y el alias en claro de una cuenta propia activa. Exige el
 * permiso `tesoreria:ver_datos_bancarios` (independiente del de lectura
 * enmascarada, spec §9.7/G5-3); un actor sin él recibe `FORBIDDEN`. La lectura
 * se audita igual que la enmascarada (G5-4) y el valor NUNCA se loguea.
 *
 * @throws {ServiceError} FORBIDDEN | CUENTA_PROPRIA_NO_ENCONTRADA
 */
export async function revelarDatosBancarios(
  id: string,
  usuarioId: string,
): Promise<CuentaPropiaRevelada> {
  if (!(await usuarioTienePermiso(usuarioId, PERMISO_VER_DATOS_BANCARIOS))) {
    throw new ServiceError(
      "FORBIDDEN",
      "No tenés el permiso para revelar los datos bancarios de la cuenta",
    );
  }

  const fila = await prisma.cuentaPropia.findFirst({
    where: { id, is_active: true, deleted_at: null },
    select: {
      id: true,
      cbu_cifrado: true,
      cbu_iv: true,
      alias_cifrado: true,
      alias_iv: true,
    },
  });
  if (!fila) {
    throw new ServiceError(
      "CUENTA_PROPRIA_NO_ENCONTRADA",
      "La cuenta propia indicada no existe o está inactiva",
    );
  }

  const cbu = descifrarCampo(fila.cbu_cifrado, fila.cbu_iv);
  const alias = descifrarCampo(fila.alias_cifrado, fila.alias_iv);

  emitirConsultaDatosBancarios(fila.id, usuarioId);

  return { cuenta_propia_id: fila.id, cbu, alias };
}
