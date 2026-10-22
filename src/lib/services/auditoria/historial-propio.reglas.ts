/**
 * @module historial-propio.reglas
 * @description HU-D8 — reglas puras del historial propio del usuario interno
 * (spec_modulo_D.md §8.1, `docs/modulos/modulo D/HU8_TASKS.md` T01).
 *
 * Fija en un único lugar, sin tocar la base:
 *  - el `where` (usuario SIEMPRE recibido por parámetro desde la sesión,
 *    rango de días ART semiabierto y acción exacta),
 *  - el orden estable `created_at DESC, id DESC`,
 *  - la proyección mínima (sin `valor_anterior`/`valor_nuevo`, hashes, `ip`
 *    ni usuario): se aplica como `select` de Prisma, así que las columnas
 *    excluidas nunca salen de la base.
 *
 * Módulo PURO: sin `server-only`, sin Prisma en runtime, sin alias `@/...` —
 * importa `fecha-negocio` con ruta relativa y extensión explícita para poder
 * testearse con `node --experimental-strip-types --test` (mismo patrón que
 * `posicion-diaria.calculo.ts`).
 */
import { rangoDiasNegocio } from "../../utils/fecha-negocio.ts";

export const ORDEN_AUDIT_LOG = [{ created_at: "desc" }, { id: "desc" }] as const;

export const SELECT_HISTORIAL_PROPIO = {
  id: true,
  created_at: true,
  accion: true,
  tabla_afectada: true,
  registro_id: true,
} as const;

export interface RegistroHistorialPropio {
  id: string;
  created_at: Date;
  accion: string;
  tabla_afectada: string;
  registro_id: string | null;
}

export interface ListadoHistorialPropio {
  registros: RegistroHistorialPropio[];
  total: number;
  page: number;
  page_size: number;
}

export interface FiltrosWhereHistorialPropio {
  fecha_desde?: string;
  fecha_hasta?: string;
  accion?: string;
}

export interface RangoCreatedAt {
  gte?: Date;
  lt?: Date;
}

export interface WhereHistorialPropio {
  usuario_id: string;
  accion?: string;
  created_at?: RangoCreatedAt;
}

/**
 * Rango de `created_at` para días `AAAA-MM-DD` de Argentina, semiabierto:
 * `[desde 00:00 ART, (hasta + 1) 00:00 ART)` — el día final queda completo,
 * incluido 23:59:59.999. Un extremo suelto acota solo de ese lado (no se
 * convierte en "un único día"). Sin extremos → `undefined`.
 *
 * @throws {RangeError} si un día no es válido o `desde` es posterior a `hasta`
 */
export function rangoCreatedAt(desde?: string, hasta?: string): RangoCreatedAt | undefined {
  if (!desde && !hasta) return undefined;
  const rango = rangoDiasNegocio(desde ?? hasta!, hasta ?? desde!);
  return {
    ...(desde ? { gte: rango.desde } : {}),
    ...(hasta ? { lt: rango.hasta } : {}),
  };
}

/**
 * `where` del historial propio. `usuarioId` es el ÚNICO origen del usuario:
 * cualquier otra clave de `filtros` se ignora, aunque se llame `usuario_id`.
 *
 * @throws {RangeError} propagado de `rangoCreatedAt`
 */
export function construirWhereHistorialPropio(
  usuarioId: string,
  filtros: FiltrosWhereHistorialPropio,
): WhereHistorialPropio {
  const where: WhereHistorialPropio = { usuario_id: usuarioId };
  if (filtros.accion) where.accion = filtros.accion;
  const createdAt = rangoCreatedAt(filtros.fecha_desde, filtros.fecha_hasta);
  if (createdAt) where.created_at = createdAt;
  return where;
}
