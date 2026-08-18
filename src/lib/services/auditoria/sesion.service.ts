/**
 * @module sesion.service
 * @description Orquestador de HU-3 (Autenticación real: Login, Logout,
 * Revocación de Sesión) — Módulo D.2.
 *
 * Cumplimiento normativo:
 *  - task_cali_hu3_login.md §0 — JWT + tabla `Sesion` (no JWT puramente
 *    stateless): la revocación instantánea exigida por HU-2 depende de que
 *    exista una fila `Sesion` consultable, no solo de la firma del JWT.
 *  - task_cali_hu3_login.md §4.1 — `iniciarSesion()` encapsula verificación
 *    de password + manejo de intentos fallidos en una única función (nunca
 *    dos llamadas separadas que el Route Handler deba orquestar).
 *  - spec_modulo_D.md §4.1 — Esta capa NUNCA escribe directo a `AuditLog`:
 *    la única vía de inserción es `audit-log.listener.ts`, consumiendo los
 *    eventos de dominio emitidos acá (`domainEventBus.emit`). No se invoca
 *    `registrarAuditLog()` desde este archivo bajo ningún concepto.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { firmarSesionJwt } from "@/lib/auth/jwt";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { LoginInput } from "@/lib/schemas/auth.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes de configuración — nunca hardcodeadas inline en el flujo de login
// (task_cali_hu3_login.md §4.4)
// ──────────────────────────────────────────────────────────────────────────────
export const MAX_INTENTOS_FALLIDOS = 5;
export const DURACION_SUSPENSION_MINUTOS = 15;
export const DURACION_SESION_HORAS = 8;

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface SesionIniciada {
  jwt: string;
  expira_en: Date;
  usuario: {
    usuario_id: string;
    nombre_completo: string;
    roles: string[];
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-3 — iniciarSesion
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Autentica un usuario por email/password, gestiona intentos fallidos y
 * suspensión automática, y — si la autenticación es exitosa — crea la
 * `Sesion` y firma el JWT correspondiente.
 *
 * Secuencia (task_cali_hu3_login.md §3.1):
 *  1. Busca `Usuario` por `email`, `is_active = true`. No revela si el email
 *     existe: mismo mensaje genérico que password incorrecto.
 *  2. Si `estado !== "ACTIVO"` → rechaza sin verificar password.
 *  3. Verifica `password` con `verifyPassword()`.
 *  4. Si falla: incrementa `intentos_fallidos`; al alcanzar
 *     `MAX_INTENTOS_FALLIDOS`, suspende automáticamente y emite
 *     `usuario:suspendido_automaticamente`.
 *  5. Si tiene éxito: resetea `intentos_fallidos`, actualiza `ultimo_login`,
 *     crea `Sesion`, firma el JWT, emite `usuario:sesion_iniciada`.
 *
 * @param input - Datos validados por `LoginSchema`.
 * @param ip - IP del cliente (mismo patrón `resolverIp()` de HU-1/HU-2).
 * @param userAgent - Header `User-Agent` del request, o `null`.
 * @throws {ServiceError} CREDENCIALES_INVALIDAS | CUENTA_SUSPENDIDA
 */
export async function iniciarSesion(
  input: LoginInput,
  ip: string,
  userAgent: string | null,
): Promise<SesionIniciada> {
  // 1. Búsqueda por email — mensaje genérico si no existe (mitiga enumeración)
  const usuario = await prisma.usuario.findFirst({
    where: { email: input.email, is_active: true },
    include: {
      roles: {
        where: { is_active: true },
        include: { rol: { select: { nombre: true } } },
      },
    },
  });

  if (!usuario) {
    throw new ServiceError("CREDENCIALES_INVALIDAS", "Email o contraseña incorrectos");
  }

  // 2. Estado de la cuenta — rechaza antes de verificar password
  if (usuario.estado === "SUSPENDIDO") {
    const mensaje = usuario.bloqueado_hasta
      ? `Cuenta suspendida temporalmente. Intente nuevamente después de las ${usuario.bloqueado_hasta.toLocaleTimeString("es-AR")}.`
      : "Cuenta suspendida temporalmente.";
    throw new ServiceError("CUENTA_SUSPENDIDA", mensaje);
  }

  if (usuario.estado === "BLOQUEADO" || usuario.estado === "INACTIVO") {
    throw new ServiceError("CUENTA_SUSPENDIDA", "Cuenta inactiva. Contacte al administrador.");
  }

  // 3. Verificación de password
  const passwordValido = await verifyPassword(
    input.password,
    usuario.password_hash,
    usuario.password_salt,
  );

  if (!passwordValido) {
    // 4. Intento fallido — incrementa y evalúa suspensión automática
    const intentosFallidos = usuario.intentos_fallidos + 1;

    if (intentosFallidos >= MAX_INTENTOS_FALLIDOS) {
      const bloqueadoHasta = new Date(Date.now() + DURACION_SUSPENSION_MINUTOS * 60_000);

      await prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          intentos_fallidos: intentosFallidos,
          estado: "SUSPENDIDO",
          bloqueado_hasta: bloqueadoHasta,
        },
      });

      domainEventBus.emit("usuario:suspendido_automaticamente", {
        usuario_id: usuario.id,
        intentos_fallidos: intentosFallidos,
        bloqueado_hasta: bloqueadoHasta,
        ip,
      });
    } else {
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { intentos_fallidos: intentosFallidos },
      });
    }

    throw new ServiceError("CREDENCIALES_INVALIDAS", "Email o contraseña incorrectos");
  }

  // 5. Login exitoso — resetea intentos, crea Sesion, firma JWT
  const jti = randomUUID();
  const expiraEn = new Date(Date.now() + DURACION_SESION_HORAS * 60 * 60_000);

  const [, sesion] = await prisma.$transaction([
    prisma.usuario.update({
      where: { id: usuario.id },
      data: { intentos_fallidos: 0, ultimo_login: new Date() },
    }),
    prisma.sesion.create({
      data: {
        usuario_id: usuario.id,
        jwt_id: jti,
        ip_origen: ip,
        user_agent: userAgent,
        expira_en: expiraEn,
      },
    }),
  ]);

  const jwt = await firmarSesionJwt({ usuarioId: usuario.id, jti }, expiraEn);

  domainEventBus.emit("usuario:sesion_iniciada", {
    usuario_id: usuario.id,
    sesion_id: sesion.id,
    ip,
    user_agent: userAgent,
  });

  return {
    jwt,
    expira_en: expiraEn,
    usuario: {
      usuario_id: usuario.id,
      nombre_completo: usuario.nombre_completo,
      roles: usuario.roles.map((usuarioRol) => usuarioRol.rol.nombre),
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-3 — cerrarSesion
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Revoca la `Sesion` identificada por `jti` (logout). Idempotente: si no
 * existe o ya estaba revocada, no falla — logout siempre responde éxito
 * (task_cali_hu3_login.md §3.2).
 *
 * @param jti - Claim `jti` extraído del JWT de la cookie.
 */
export async function cerrarSesion(jti: string): Promise<void> {
  const sesion = await prisma.sesion.findUnique({ where: { jwt_id: jti } });

  if (!sesion || sesion.revocada) return;

  await prisma.sesion.update({
    where: { id: sesion.id },
    data: { revocada: true, revocada_en: new Date(), revocada_motivo: "logout" },
  });

  domainEventBus.emit("usuario:sesion_cerrada", {
    usuario_id: sesion.usuario_id,
    sesion_id: sesion.id,
    motivo: "logout",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-2 / HU-3 — revocarSesionesDeUsuario
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Revoca TODAS las `Sesion` activas (`revocada = false`) de un usuario.
 * Requerida por la integración con HU-2: `desactivarUsuario()` invoca esta
 * función para que la baja lógica sea instantánea también a nivel JWT — no
 * alcanza con que `Usuario.estado = INACTIVO`, porque `proxy.ts` solo valida
 * firma/expiración del JWT y es `getServerSession()` quien consulta `Sesion`
 * (task_cali_hu3_login.md §4.3).
 *
 * Operación de base pura (sin I/O externo) — el llamador la incluye dentro
 * de su propia `$transaction` pasando `tx` (así lo hace `desactivarUsuario()`
 * — confirmado: misma transacción, no una llamada posterior separada).
 *
 * @param usuarioId - Usuario cuyas sesiones se revocan.
 * @param motivo - Ej. "baja_logica_usuario", "cambio_password".
 * @param tx - Cliente de transacción del llamador. Default: `prisma` (uso
 *             standalone fuera de una transacción, si alguna vez hiciera falta).
 */
export async function revocarSesionesDeUsuario(
  usuarioId: string,
  motivo: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const sesionesActivas = await tx.sesion.findMany({
    where: { usuario_id: usuarioId, revocada: false },
    select: { id: true },
  });

  if (sesionesActivas.length === 0) return;

  await tx.sesion.updateMany({
    where: { id: { in: sesionesActivas.map((s) => s.id) } },
    data: { revocada: true, revocada_en: new Date(), revocada_motivo: motivo },
  });

  for (const sesion of sesionesActivas) {
    domainEventBus.emit("usuario:sesion_cerrada", {
      usuario_id: usuarioId,
      sesion_id: sesion.id,
      motivo,
    });
  }
}
