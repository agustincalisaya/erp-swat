/**
 * @module conector-pago.service
 * @description HU-F1 (spec_modulo_F.md §2.1.1–§2.1.5) — Gestión del Conector
 * de Mercado Pago: alta con cifrado AES-256 (pueden coexistir varios
 * INACTIVO), health-check con la puerta de PRODUCCION y la unicidad de un único
 * Conector ACTIVO por entorno controlada al ACTIVAR (P-R5, acordado con Rama
 * el 2026-10-08), bitácora paginada, listado enmascarado para la UI y baja
 * lógica.
 *
 * Reglas: el service NO conoce la API de MP — el health-check se hace SIEMPRE
 * por el Adapter (`lib/integraciones/mercadopago/adapter.ts`, spec F §3.1);
 * nunca se hace `fetch` directo ni se importa el SDK `mercadopago`. Los tres
 * campos sensibles se cifran con `lib/crypto/aes.ts` ANTES de llegar a Prisma
 * y jamás se devuelven, loguean ni emiten en claro (Ley 25.326). Prohibido
 * `prisma.*.delete()`: la baja es lógica (Regla N.° 1).
 */
import "server-only";

import type { EstadoConectorPago, EntornoConectorPago, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decrypt, encrypt } from "@/lib/crypto/aes";
import { ServiceError } from "@/lib/errors/service-error";
import { healthCheck } from "@/lib/integraciones/mercadopago/adapter";
import { obtenerConectorPorId } from "@/lib/integraciones/mercadopago/conector";
import type {
  BitacoraQueryInput,
  CrearConectorMercadoPagoInput,
} from "@/lib/schemas/integraciones.schema";

/** Permiso RBAC de la gestión del Conector (sembrado en MODULO_F). */
export const PERMISO_ADMINISTRAR_CONECTOR = "integraciones:administrar_conector";

// ──────────────────────────────────────────────────────────────────────────────
// DTOs públicos (siempre enmascarados)
// ──────────────────────────────────────────────────────────────────────────────

export interface ConectorEnmascarado {
  conector_id: string;
  nombre: string;
  entorno: EntornoConectorPago;
  estado: EstadoConectorPago;
  is_active: boolean;
  access_token_enmascarado: string;
  public_key_enmascarada: string;
  webhook_secret_enmascarado: string;
  ultimo_health_check_exitoso_at: Date | null;
}

export interface BitacoraItem {
  operacion: string;
  exitosa: boolean;
  detalle_error: string | null;
  created_at: Date;
}

export interface ListadoBitacora {
  items: BitacoraItem[];
  paginacion: {
    total: number;
    pagina_actual: number;
    total_paginas: number;
    por_pagina: number;
  };
}

export interface ConectorDadoDeBaja {
  conector_id: string;
  is_active: false;
  estado: "INACTIVO";
}

// ──────────────────────────────────────────────────────────────────────────────
// Enmascarado
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Enmascara una credencial conservando su prefijo (hasta el primer `-`, o los
 * primeros 6 caracteres) y los últimos 4: `APP_USR-••••••••3f2a` (spec §2.1.1).
 * Nunca devuelve el valor en claro completo.
 */
export function enmascararCredencial(valor: string): string {
  const i = valor.indexOf("-");
  const prefijo = i > 0 ? valor.slice(0, i + 1) : valor.slice(0, 6);
  const sufijo = valor.slice(-4);
  return `${prefijo}••••••••${sufijo}`;
}

function aEnmascarado(c: {
  id: string;
  nombre: string;
  entorno: EntornoConectorPago;
  estado: EstadoConectorPago;
  is_active: boolean;
  ultimo_health_check_exitoso_at: Date | null;
  access_token: string;
  public_key: string;
  webhook_secret: string;
}): ConectorEnmascarado {
  return {
    conector_id: c.id,
    nombre: c.nombre,
    entorno: c.entorno,
    estado: c.estado,
    is_active: c.is_active,
    access_token_enmascarado: enmascararCredencial(c.access_token),
    public_key_enmascarada: enmascararCredencial(c.public_key),
    webhook_secret_enmascarado: enmascararCredencial(c.webhook_secret),
    ultimo_health_check_exitoso_at: c.ultimo_health_check_exitoso_at,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// R3.1 — Alta con cifrado y unicidad por entorno
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Crea un Conector (nace `INACTIVO`) cifrando las 3 credenciales con AES-256
 * ANTES de persistir. El alta NO controla la unicidad: pueden coexistir varios
 * `INACTIVO` en un entorno aunque haya uno `ACTIVO` (P-R5). El invariante "un
 * único ACTIVO por entorno" se controla al activar (`ejecutarHealthCheck`).
 *
 * La respuesta es SIEMPRE enmascarada: el valor en claro no llega a Prisma,
 * ni a la respuesta HTTP, ni a ningún log.
 *
 * @param _usuarioId - Actor de la operación (el modelo `ConectorPago` no tiene
 *   columna de creador; el actor queda trazado por el AuditLog de Módulo D).
 */
export async function crearConector(
  input: CrearConectorMercadoPagoInput,
  _usuarioId: string,
): Promise<ConectorEnmascarado> {
  // Cifrado ANTES de tocar la base: el plaintext nunca llega a Prisma.
  const accessToken = encrypt(input.access_token);
  const publicKey = encrypt(input.public_key);
  const webhookSecret = encrypt(input.webhook_secret);

  const creado = await prisma.conectorPago.create({
    data: {
      nombre: input.nombre,
      entorno: input.entorno,
      estado: "INACTIVO",
      access_token_cifrado: accessToken.ciphertext,
      access_token_iv: accessToken.iv,
      public_key_cifrada: publicKey.ciphertext,
      public_key_iv: publicKey.iv,
      webhook_secret_cifrado: webhookSecret.ciphertext,
      webhook_secret_iv: webhookSecret.iv,
    },
    select: {
      id: true,
      nombre: true,
      entorno: true,
      estado: true,
      is_active: true,
      ultimo_health_check_exitoso_at: true,
    },
  });

  return aEnmascarado({
    ...creado,
    access_token: input.access_token,
    public_key: input.public_key,
    webhook_secret: input.webhook_secret,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// R3.2 — Health-check
// ──────────────────────────────────────────────────────────────────────────────

/**
 * P-R5 — un único Conector `ACTIVO` por entorno. Lanza 409 si hay OTRO activo
 * (el propio Conector, si ya estaba ACTIVO, no cuenta: re-verificarlo es válido).
 *
 * @throws {ServiceError} CONECTOR_ACTIVO_EXISTENTE (409)
 */
async function exigirSinOtroActivo(
  cliente: Prisma.TransactionClient,
  entorno: EntornoConectorPago,
  conectorId: string,
): Promise<void> {
  const otro = await cliente.conectorPago.findFirst({
    where: { entorno, estado: "ACTIVO", is_active: true, deleted_at: null, id: { not: conectorId } },
    select: { id: true },
  });
  if (otro) {
    throw new ServiceError(
      "CONECTOR_ACTIVO_EXISTENTE",
      `Ya existe otro Conector ACTIVO en el entorno ${entorno}: dalo de baja antes de activar este`,
    );
  }
}

/**
 * Descifra las credenciales del Conector y verifica contra MP a través del
 * Adapter (`GET /v1/payment_methods`). Éxito → `estado = ACTIVO` +
 * `ultimo_health_check_exitoso_at`. Fallo → mantiene el estado previo y
 * responde `422 HEALTH_CHECK_FALLIDO`.
 *
 * PRODUCCION no transiciona a `ACTIVO` con un único health-check: el primer
 * éxito persiste `ultimo_health_check_exitoso_at` pero deja el Conector
 * `INACTIVO` y responde `422 HEALTH_CHECK_REQUERIDO`; el segundo éxito lo
 * promueve a `ACTIVO` (decisión de PO, dos pasos).
 *
 * Unicidad (P-R5): si ya hay OTRO Conector `ACTIVO` en el entorno → 409, antes
 * de llamar a MP y otra vez al activar, dentro de una transacción con un lock
 * por entorno (dos activaciones simultáneas no dejan dos `ACTIVO`).
 *
 * @throws {ServiceError} CONECTOR_NO_ENCONTRADO (404) · CONECTOR_ACTIVO_EXISTENTE (409)
 *   · HEALTH_CHECK_FALLIDO (422) · HEALTH_CHECK_REQUERIDO (422)
 */
export async function ejecutarHealthCheck(conectorId: string): Promise<ConectorEnmascarado> {
  const conector = await obtenerConectorPorId(conectorId);
  await exigirSinOtroActivo(prisma, conector.entorno, conector.id);

  const ok = await healthCheck({ conectorId: conector.id, accessToken: conector.access_token });
  if (!ok) {
    // El estado previo se mantiene intacto; el Adapter ya registró el fallo.
    throw new ServiceError("HEALTH_CHECK_FALLIDO", "Mercado Pago rechazó las credenciales del Conector");
  }

  const ahora = new Date();

  if (conector.entorno === "PRODUCCION" && conector.ultimo_health_check_exitoso_at === null) {
    // Primer éxito en PRODUCCION: se registra pero NO se activa (dos pasos).
    await prisma.conectorPago.update({
      where: { id: conector.id },
      data: { ultimo_health_check_exitoso_at: ahora },
    });
    throw new ServiceError(
      "HEALTH_CHECK_REQUERIDO",
      "En PRODUCCION la activación requiere un segundo health-check exitoso",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`conector_activo:${conector.entorno}`}))`;
    await exigirSinOtroActivo(tx, conector.entorno, conector.id);
    await tx.conectorPago.update({
      where: { id: conector.id },
      data: { estado: "ACTIVO", ultimo_health_check_exitoso_at: ahora },
    });
  });

  return aEnmascarado({
    id: conector.id,
    nombre: conector.nombre,
    entorno: conector.entorno,
    estado: "ACTIVO",
    is_active: true,
    ultimo_health_check_exitoso_at: ahora,
    access_token: conector.access_token,
    public_key: conector.public_key,
    webhook_secret: conector.webhook_secret,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// R3.3 — Bitácora paginada
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Bitácora operativa paginada del Conector (`InvocacionConectorPago`, orden
 * `created_at desc`). Sin datos sensibles: solo operación, resultado y fecha.
 *
 * @throws {ServiceError} CONECTOR_NO_ENCONTRADO (404)
 */
export async function listarBitacora(
  conectorId: string,
  { page, page_size }: BitacoraQueryInput,
): Promise<ListadoBitacora> {
  const conector = await prisma.conectorPago.findFirst({
    where: { id: conectorId },
    select: { id: true },
  });
  if (!conector) {
    throw new ServiceError("CONECTOR_NO_ENCONTRADO", "El Conector indicado no existe");
  }

  const where = { conector_id: conectorId };
  const [items, total] = await Promise.all([
    prisma.invocacionConectorPago.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * page_size,
      take: page_size,
      select: { operacion: true, exitosa: true, detalle_error: true, created_at: true },
    }),
    prisma.invocacionConectorPago.count({ where }),
  ]);

  return {
    items,
    paginacion: {
      total,
      pagina_actual: page,
      total_paginas: Math.ceil(total / page_size),
      por_pagina: page_size,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// R4.6 — Listado enmascarado para el Server Component
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista los Conectores vigentes (no dados de baja) con las credenciales
 * enmascaradas. Lector server-only invocado directo por el Server Component
 * del panel (no se expone una ruta pública de listado).
 */
export async function listarConectores(): Promise<ConectorEnmascarado[]> {
  const filas = await prisma.conectorPago.findMany({
    where: { is_active: true, deleted_at: null },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      nombre: true,
      entorno: true,
      estado: true,
      is_active: true,
      ultimo_health_check_exitoso_at: true,
      access_token_cifrado: true,
      access_token_iv: true,
      public_key_cifrada: true,
      public_key_iv: true,
      webhook_secret_cifrado: true,
      webhook_secret_iv: true,
    },
  });

  return filas.map((f) =>
    aEnmascarado({
      id: f.id,
      nombre: f.nombre,
      entorno: f.entorno,
      estado: f.estado,
      is_active: f.is_active,
      ultimo_health_check_exitoso_at: f.ultimo_health_check_exitoso_at,
      access_token: decrypt({ ciphertext: f.access_token_cifrado, iv: f.access_token_iv }),
      public_key: decrypt({ ciphertext: f.public_key_cifrada, iv: f.public_key_iv }),
      webhook_secret: decrypt({ ciphertext: f.webhook_secret_cifrado, iv: f.webhook_secret_iv }),
    }),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// R3.4 — Baja lógica
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Baja lógica (Regla N.° 1): `is_active = false` + `deleted_at` + `deleted_by`
 * + `deletion_reason` Y `estado = INACTIVO` en la misma operación. Nunca se
 * borra la fila ni la bitácora histórica. Prohibido `prisma.*.delete()`.
 *
 * @throws {ServiceError} CONECTOR_NO_ENCONTRADO (404)
 */
export async function darDeBajaConector(
  conectorId: string,
  usuarioId: string,
  deletionReason: string,
): Promise<ConectorDadoDeBaja> {
  const ahora = new Date();

  await prisma.$transaction(async (tx) => {
    const cambio = await tx.conectorPago.updateMany({
      where: { id: conectorId, is_active: true, deleted_at: null },
      data: {
        is_active: false,
        deleted_at: ahora,
        deleted_by: usuarioId,
        deletion_reason: deletionReason,
        estado: "INACTIVO",
      },
    });
    if (cambio.count === 0) {
      throw new ServiceError("CONECTOR_NO_ENCONTRADO", "El Conector indicado no existe o ya está dado de baja");
    }
  });

  return { conector_id: conectorId, is_active: false, estado: "INACTIVO" };
}
