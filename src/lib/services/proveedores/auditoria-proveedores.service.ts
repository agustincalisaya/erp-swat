/**
 * @module auditoria-proveedores.service
 * @description Lista eventos del dominio "proveedores" desde AuditLog (Módulo D).
 *
 * IMPORTANTE — por qué esta función vive en Módulo H y no en Módulo D:
 *   AuditLog (modelo real) NO tiene campo de dominio ni `proveedor_id`.
 *   El filtrado se hace por una lista EXPLÍCITA y CERRADA de
 *   `tabla_afectada` + `accion`, definida en este mismo archivo.
 *   Si en el futuro se agrega una tabla o acción nueva al dominio,
 *   se actualiza TABLAS_DOMINIO_PROVEEDORES / ACCIONES_DOMINIO_PROVEEDORES
 *   en este archivo, NUNCA se toca Módulo D.
 *
 * NO usa listarEventosPorDominio() porque esa función no existe en Módulo D.
 * NO reimplementa el encadenamiento SHA-256 (eso queda en
 * verificarCadenaIntegridad() de Módulo D, que se invoca desde el route).
 *
 * HU-H6 (docs/tasks/sdd/HU-H6) — implementa exclusivamente T1 a T11
 * (`propose_HU-H6_FINAL.md`, `spec_HU-H6_FINAL.md`, `design_HU-H6_FINAL.md`,
 * `tasks_HU-H6_FINAL.md`). La verificación de integridad acotada
 * (`auditoria-integridad.service.ts`) y el endpoint (`route.ts`) son de
 * tareas posteriores (T12 en adelante) y no se tocan desde este archivo.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes de dominio (T2, T3, T4) — Spec §1 y §4.2, verbatim
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tablas físicas (`@@map`) del dominio proveedores. Verificadas carácter por
 * carácter contra `schema.prisma` (Propose §2.2). NO existe `legajos_proveedor`:
 * el legajo comercial vive como campos del propio modelo `Proveedor`
 * (`@@map("proveedores")`).
 */
export const TABLAS_DOMINIO_PROVEEDORES = ["proveedores", "listas_precio_version"] as const;

/**
 * Acciones cerradas del dominio proveedores (Propose §2.2 / Spec §1).
 *
 * `proveedor:legajo_bancario_consultado` se incluye desde el día 1 aunque no
 * tiene emisor real todavía (probable HU-H1) — decisión cerrada, Propose §2.4.
 */
export const ACCIONES_DOMINIO_PROVEEDORES = [
  "proveedor:estado_cambiado",
  "proveedor:variacion_precio_critica",
  "proveedor:lista_precio_aprobada",
  "proveedor:legajo_bancario_consultado",
] as const;

/**
 * Denylist cerrada de claves sensibles (Spec §4.2), verbatim. Comparación
 * case-insensitive vía `esClaveProhibida()`. Conjunto cerrado versionado en
 * código, no configurable en runtime.
 */
const CLAVES_PROHIBIDAS = new Set(
  [
    // Credenciales
    "password",
    "password_hash",
    "contrasena",
    "contraseña",
    "hash_contrasena",
    "hash_password",
    "secret",
    "api_key",
    "access_token",
    "refresh_token",
    "token",
    // Datos bancarios / financieros sensibles
    "datos_bancarios",
    "legajo_bancario",
    "cbu",
    "cvu",
    "alias_bancario",
    "numero_cuenta",
    "cuenta_bancaria",
    "cbu_cvu",
    "datos_bancarios_hash",
  ].map((clave) => clave.toLowerCase()),
);

const MARCA_REDACTADO = "[REDACTADO]";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos (T5)
// ──────────────────────────────────────────────────────────────────────────────

export type AccionDominioProveedores = (typeof ACCIONES_DOMINIO_PROVEEDORES)[number];

export type FiltrosAuditoriaProveedores = {
  proveedor_id?: string;
  tipo_evento?: AccionDominioProveedores;
  usuario_id?: string;
  fecha_desde?: Date;
  fecha_hasta?: Date;
};

export type PaginacionAuditoriaProveedores = {
  /** >= 1 */
  pagina: number;
  /** 1..50 */
  por_pagina: number;
};

export type EventoAuditoriaProveedor = {
  audit_log_id: string;
  tipo_evento: AccionDominioProveedores;
  proveedor_id: string | null;
  usuario_id: string | null;
  valor_anterior: unknown;
  valor_nuevo: unknown;
  hash_actual: string;
  created_at: Date;
};

export type ResultadoListadoAuditoriaProveedores = {
  items: EventoAuditoriaProveedor[];
  paginacion: {
    total: number;
    pagina_actual: number;
    total_paginas: number;
    por_pagina: number;
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Selección de campos de AuditLog usados por este servicio
// ──────────────────────────────────────────────────────────────────────────────

const SELECT_CAMPOS_AUDITORIA = {
  id: true,
  accion: true,
  tabla_afectada: true,
  registro_id: true,
  usuario_id: true,
  valor_anterior: true,
  valor_nuevo: true,
  hash_actual: true,
  created_at: true,
} satisfies Prisma.AuditLogSelect;

type FilaAuditLogDominio = Prisma.AuditLogGetPayload<{ select: typeof SELECT_CAMPOS_AUDITORIA }>;

// ──────────────────────────────────────────────────────────────────────────────
// Traducción canal ↔ accion real (hallazgo post-T11, confirmado contra
// audit-log.listener.ts) — Propose/Spec/Design/Tasks definen
// ACCIONES_DOMINIO_PROVEEDORES/`tipo_evento` con el nombre del CANAL del
// event bus ("proveedor:estado_cambiado", etc.), pero eso NUNCA es lo que
// `audit-log.listener.ts` persiste en `AuditLog.accion` — persiste
// "UPDATE_ESTADO" / "VARIACION_CRITICA" / "LISTA_PRECIO_APROBADA"
// (SCREAMING_SNAKE_CASE, sin ":", verificado línea por línea contra ese
// archivo). El contrato público (`tipo_evento` expuesto al cliente HTTP)
// se mantiene con los nombres de canal — decisión explícita del usuario, no
// se toca Spec. Esta tabla es puramente interna: traduce canal → accion
// real ANTES de construir el `where`, y accion real → canal al mapear la
// fila de vuelta a DTO.
//
// `proveedor:legajo_bancario_consultado` no tiene emisor implementado
// todavía (HU-H1, pendiente) — no hay ningún valor real de `accion` que
// confirmar contra el listener. Se deja `null` explícito a propósito; NO se
// inventa un string. Cuando el emisor exista, actualizar SOLO esta entrada.
// ──────────────────────────────────────────────────────────────────────────────

const ACCION_REAL_POR_CANAL: Record<AccionDominioProveedores, string | null> = {
  "proveedor:estado_cambiado": "UPDATE_ESTADO",
  "proveedor:variacion_precio_critica": "VARIACION_CRITICA",
  "proveedor:lista_precio_aprobada": "LISTA_PRECIO_APROBADA",
  "proveedor:legajo_bancario_consultado": null, // TODO(HU-H1): sin emisor real todavía
};

/** Lista cerrada de valores reales de `accion` a usar en el `where` (nulls descartados). */
const ACCIONES_REALES_DOMINIO_PROVEEDORES: string[] = ACCIONES_DOMINIO_PROVEEDORES.map(
  (canal) => ACCION_REAL_POR_CANAL[canal],
).filter((accion): accion is string => accion !== null);

const CANAL_POR_ACCION_REAL: Record<string, AccionDominioProveedores> = Object.fromEntries(
  ACCIONES_DOMINIO_PROVEEDORES.map((canal) => [ACCION_REAL_POR_CANAL[canal], canal] as const).filter(
    (entrada): entrada is [string, AccionDominioProveedores] => entrada[0] !== null,
  ),
);

// ──────────────────────────────────────────────────────────────────────────────
// Sanitización en lectura (T6, T7) — Spec §4
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Chequeo case-insensitive de `clave` contra `CLAVES_PROHIBIDAS`.
 */
function esClaveProhibida(clave: string): boolean {
  return CLAVES_PROHIBIDAS.has(clave.toLowerCase());
}

/**
 * Sanitizador recursivo (denylist) de `valor_anterior` / `valor_nuevo`.
 *
 * - Recursa sobre objetos y arrays anidados, preservando la forma del JSON.
 * - Reemplaza el VALOR de toda clave prohibida (case-insensitive) por
 *   `'[REDACTADO]'`.
 * - No muta el objeto de Prisma recibido: construye una copia.
 * - Se invoca SOLO sobre `valor_anterior`/`valor_nuevo` desde
 *   `mapearFilaAEvento` — nunca sobre la fila completa — por lo que nunca
 *   toca `hash_actual`, `created_at`, `tipo_evento`, `usuario_id`,
 *   `audit_log_id` ni `proveedor_id`.
 */
export function sanitizarValorAuditoria(valor: unknown): unknown {
  if (valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) return valor.map((item) => sanitizarValorAuditoria(item));

  const resultado: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    resultado[clave] = esClaveProhibida(clave) ? MARCA_REDACTADO : sanitizarValorAuditoria(v);
  }
  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolución de proveedor_id (T8) — Spec §3.4e / Propose §2.5
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve `proveedor_id` desde una fila de `AuditLog` del dominio
 * proveedores. Convención NO uniforme según `tabla_afectada`:
 *
 * - `tabla_afectada === 'proveedores'` (evento `proveedor:estado_cambiado`):
 *   el propio proveedor ES el registro → `proveedor_id = registro_id`.
 * - Cualquier otra tabla del dominio (`listas_precio_version`): el
 *   `registro_id` referencia otra entidad (`lista_precio_version_id`), así
 *   que `proveedor_id` se busca dentro del JSON: primero `valor_nuevo`,
 *   luego `valor_anterior` como fallback, o `null` si no aparece en ninguno.
 */
function resolverProveedorId(fila: FilaAuditLogDominio): string | null {
  if (fila.tabla_afectada === "proveedores") {
    return fila.registro_id;
  }

  const valorNuevo = fila.valor_nuevo as Record<string, unknown> | null;
  const valorAnterior = fila.valor_anterior as Record<string, unknown> | null;

  return (
    (valorNuevo?.proveedor_id as string | undefined) ??
    (valorAnterior?.proveedor_id as string | undefined) ??
    null
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Construcción del `where` (T9) — Spec §3 paso 4a-4c
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Arma el `where` de Prisma para el dominio proveedores.
 *
 * El `OR` de 3 cláusulas para `proveedor_id` NO se simplifica: la convención
 * mixta de `resolverProveedorId()` lo exige tal cual (Propose §2.5 / Spec
 * §3 paso 4b) — `proveedor:estado_cambiado` guarda el proveedor_id en
 * `registro_id`, los demás eventos lo guardan dentro del JSON de
 * `valor_nuevo`/`valor_anterior`.
 *
 * `accion` filtra por los valores REALES persistidos (`ACCION_REAL_POR_CANAL`
 * / `ACCIONES_REALES_DOMINIO_PROVEEDORES`), nunca por el nombre de canal —
 * ver el bloque de traducción más arriba en este archivo.
 */
function construirWhereProveedores(filtros: FiltrosAuditoriaProveedores): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [
    { tabla_afectada: { in: [...TABLAS_DOMINIO_PROVEEDORES] } },
    { accion: { in: ACCIONES_REALES_DOMINIO_PROVEEDORES } },
  ];

  if (filtros.proveedor_id) {
    and.push({
      OR: [
        { tabla_afectada: "proveedores", registro_id: filtros.proveedor_id },
        { valor_nuevo: { path: ["proveedor_id"], equals: filtros.proveedor_id } },
        { valor_anterior: { path: ["proveedor_id"], equals: filtros.proveedor_id } },
      ],
    });
  }

  if (filtros.tipo_evento) {
    // Traduce el canal solicitado a su valor real de `accion`. Si el canal
    // no tiene emisor implementado todavía (`ACCION_REAL_POR_CANAL` → null,
    // caso actual: `proveedor:legajo_bancario_consultado`), el `in: []`
    // fuerza cero resultados en vez de matchear por accidente.
    const accionReal = ACCION_REAL_POR_CANAL[filtros.tipo_evento];
    and.push({ accion: { in: accionReal ? [accionReal] : [] } });
  }
  if (filtros.usuario_id) {
    and.push({ usuario_id: filtros.usuario_id });
  }
  if (filtros.fecha_desde) {
    and.push({ created_at: { gte: filtros.fecha_desde } });
  }
  if (filtros.fecha_hasta) {
    and.push({ created_at: { lte: filtros.fecha_hasta } });
  }

  return { AND: and };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mapeo de fila a DTO (T10) — Spec §3 paso 4e / paso 6
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Aplica `resolverProveedorId()` + `sanitizarValorAuditoria()` sobre
 * `valor_anterior`/`valor_nuevo` y arma el DTO `EventoAuditoriaProveedor`.
 *
 * `tipo_evento` se resuelve traduciendo `fila.accion` (valor real persistido,
 * ej. "UPDATE_ESTADO") de vuelta al nombre de canal público (ej.
 * "proveedor:estado_cambiado") vía `CANAL_POR_ACCION_REAL`. El `where` de
 * `construirWhereProveedores()` ya garantiza que toda fila que llega acá
 * tiene un `accion` mapeado — si esa invariante se rompe, es un bug real
 * (no un dato inesperado del dominio) y se hace explícito con un throw en
 * vez de exponer un `tipo_evento` inventado en el ledger forense.
 */
function mapearFilaAEvento(fila: FilaAuditLogDominio): EventoAuditoriaProveedor {
  const tipoEvento = CANAL_POR_ACCION_REAL[fila.accion];
  if (!tipoEvento) {
    throw new Error(
      `auditoria-proveedores.service: AuditLog.id=${fila.id} tiene accion='${fila.accion}' sin canal de dominio proveedores mapeado (invariante de construirWhereProveedores violado).`,
    );
  }

  return {
    audit_log_id: fila.id,
    tipo_evento: tipoEvento,
    proveedor_id: resolverProveedorId(fila),
    usuario_id: fila.usuario_id,
    valor_anterior: sanitizarValorAuditoria(fila.valor_anterior),
    valor_nuevo: sanitizarValorAuditoria(fila.valor_nuevo),
    hash_actual: fila.hash_actual,
    created_at: fila.created_at,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Función pública principal (T11) — Spec §3 paso 4
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista eventos del dominio "proveedores" desde AuditLog (Módulo D), paginado
 * y filtrado. Solo lectura — no expone ni acepta mutaciones.
 *
 * Orden `created_at DESC, id DESC` (desempate estable para paginación).
 * `valor_anterior`/`valor_nuevo` ya vienen sanitizados (defensa en
 * profundidad, Spec §3.1 / §6.6). `proveedor_id` puede ser `null` si no se
 * pudo resolver por convención.
 */
export async function listarEventosDeDominioProveedores(
  filtros: FiltrosAuditoriaProveedores,
  paginacion: PaginacionAuditoriaProveedores,
): Promise<ResultadoListadoAuditoriaProveedores> {
  const where = construirWhereProveedores(filtros);
  const skip = (paginacion.pagina - 1) * paginacion.por_pagina;

  const [total, filas] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: SELECT_CAMPOS_AUDITORIA,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip,
      take: paginacion.por_pagina,
    }),
  ]);

  const total_paginas = Math.max(1, Math.ceil(total / paginacion.por_pagina));

  return {
    items: filas.map(mapearFilaAEvento),
    paginacion: {
      total,
      pagina_actual: paginacion.pagina,
      total_paginas,
      por_pagina: paginacion.por_pagina,
    },
  };
}
