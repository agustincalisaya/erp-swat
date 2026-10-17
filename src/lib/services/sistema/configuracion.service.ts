/**
 * D.4 — Lectura de `ConfiguracionSistema` (spec_modulo_D.md §6).
 *
 * MÍNIMO introducido por HU-E1 (aprobado por el owner): solo la lectura
 * servidor-a-servidor de §6.3.1 (`obtenerConfiguracion(clave)`). El Route
 * Handler `GET/PATCH /api/configuracion/[clave]` y la mutación
 * (`configuracion:administrar`) siguen siendo alcance de D.4 — no están acá.
 *
 * Sin cache a propósito: HU-E1 exige disponibilidad en tiempo real, y un
 * cambio del depósito del canal web debe verse en el siguiente request.
 * Sin default silencioso (spec §6.3): una clave ausente es un error de
 * configuración, nunca un valor implícito en código.
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { FORMATOS_IMAGEN_CONOCIDOS, type FormatoImagen } from "@/lib/services/ecommerce/validacion-imagen";
import { UmbralesEgresosSchema, type UmbralesEgresos } from "@/lib/schemas/alertas-desvio.schema";

/** Claves sembradas para Sprint 4 (spec_modulo_D.md §6.2). */
export const CLAVE_ECOMMERCE_DEPOSITO_CANAL_WEB_ID = "ECOMMERCE_DEPOSITO_CANAL_WEB_ID";
export const CLAVE_ECOMMERCE_CHECKOUT_TTL_HORAS = "ECOMMERCE_CHECKOUT_TTL_HORAS";
export const CLAVE_ECOMMERCE_CUENTA_WEB_MAX_INTENTOS = "ECOMMERCE_CUENTA_WEB_MAX_INTENTOS";
export const CLAVE_ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS = "ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS";
/** HU-E5 (task_relos.md D4): días sin actividad tras los que un carrito se da de baja. */
export const CLAVE_ECOMMERCE_CARRITO_ABANDONADO_DIAS = "ECOMMERCE_CARRITO_ABANDONADO_DIAS";
/** HU-E11 (task_relos.md D3, D21): fotos del contenido web. */
export const CLAVE_ECOMMERCE_FOTOS_MAX_POR_PRODUCTO = "ECOMMERCE_FOTOS_MAX_POR_PRODUCTO";
export const CLAVE_ECOMMERCE_FOTO_TAMANO_MAX_MB = "ECOMMERCE_FOTO_TAMANO_MAX_MB";
export const CLAVE_ECOMMERCE_FOTO_FORMATOS_PERMITIDOS = "ECOMMERCE_FOTO_FORMATOS_PERMITIDOS";

export interface ConfiguracionValor {
  clave: string;
  valor: string;
  modulo: string;
}

/**
 * Lee un parámetro por `clave` (lectura interna, sin RBAC — spec §6.3.1).
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA
 */
export async function obtenerConfiguracion(clave: string): Promise<ConfiguracionValor> {
  const fila = await prisma.configuracionSistema.findUnique({
    where: { clave },
    select: { clave: true, valor: true, modulo: true },
  });
  if (!fila) {
    throw new ServiceError(
      "CONFIGURACION_NO_ENCONTRADA",
      `No existe el parámetro de configuración ${clave}`,
    );
  }
  return fila;
}

/**
 * Depósito cuyo stock publica el canal web (HU-E1 CA1). Valida que el
 * depósito exista y siga activo: un depósito dado de baja es un error de
 * configuración, no "todo agotado".
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CANAL_WEB_NO_CONFIGURADO
 */
export async function obtenerDepositoCanalWebId(): Promise<string> {
  const { valor } = await obtenerConfiguracion(CLAVE_ECOMMERCE_DEPOSITO_CANAL_WEB_ID);
  const deposito = await prisma.deposito.findFirst({
    where: { id: valor, is_active: true, deleted_at: null },
    select: { id: true },
  });
  if (!deposito) {
    throw new ServiceError(
      "CANAL_WEB_NO_CONFIGURADO",
      "El depósito configurado para el canal web no existe o está inactivo",
    );
  }
  return deposito.id;
}

/**
 * TTL en horas de la reserva del checkout web (spec_modulo_E.md §2.2 paso 3):
 * se pasa explícito a la reserva, nunca el default de 72h.
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CONFIGURACION_INVALIDA
 */
async function obtenerEnteroPositivo(clave: string): Promise<number> {
  const { valor } = await obtenerConfiguracion(clave);
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ServiceError("CONFIGURACION_INVALIDA", `${clave} debe ser un entero positivo (valor actual: "${valor}")`);
  }
  return numero;
}

export async function obtenerTtlCheckoutHoras(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_CHECKOUT_TTL_HORAS);
}

export async function obtenerMaxIntentosCuentaWeb(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_CUENTA_WEB_MAX_INTENTOS);
}

export async function obtenerBloqueoMinutosCuentaWeb(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS);
}

export async function obtenerPlazoCarritoAbandonadoDias(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_CARRITO_ABANDONADO_DIAS);
}

/** HU-E11 — N, máximo de fotos activas por contenido web. */
export async function obtenerFotosMaxPorProducto(): Promise<number> {
  return obtenerEnteroPositivo(CLAVE_ECOMMERCE_FOTOS_MAX_POR_PRODUCTO);
}

/** HU-E11 — tamaño máximo por foto, en bytes (la clave está en MB: × 1024 × 1024, D21). */
export async function obtenerFotoTamanoMaxBytes(): Promise<number> {
  return (await obtenerEnteroPositivo(CLAVE_ECOMMERCE_FOTO_TAMANO_MAX_MB)) * 1024 * 1024;
}

/**
 * HU-E11 — formatos admitidos, CSV (ej. `"JPG,PNG,WEBP"`). Un formato
 * desconocido o una lista vacía es `CONFIGURACION_INVALIDA` (D21).
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CONFIGURACION_INVALIDA
 */
export async function obtenerFotoFormatosPermitidos(): Promise<FormatoImagen[]> {
  const { valor } = await obtenerConfiguracion(CLAVE_ECOMMERCE_FOTO_FORMATOS_PERMITIDOS);
  const formatos = valor.split(",").map((f) => f.trim().toUpperCase()).filter((f) => f !== "");
  const conocidos: readonly string[] = FORMATOS_IMAGEN_CONOCIDOS;
  if (formatos.length === 0 || formatos.some((f) => !conocidos.includes(f))) {
    throw new ServiceError(
      "CONFIGURACION_INVALIDA",
      `${CLAVE_ECOMMERCE_FOTO_FORMATOS_PERMITIDOS} debe ser una lista de ${FORMATOS_IMAGEN_CONOCIDOS.join(", ")} (valor actual: "${valor}")`,
    );
  }
  return [...new Set(formatos)] as FormatoImagen[];
}

// --- Sprint 5 · Cluster 6 ---

/** HU-D6 (task_relos.md D13/D24): umbrales del % de egresos sobre ingresos del mes. */
export const CLAVE_TESORERIA_ALERTA_EGRESOS_INFORMATIVA_PCT = "TESORERIA_ALERTA_EGRESOS_INFORMATIVA_PCT";
export const CLAVE_TESORERIA_ALERTA_EGRESOS_ADVERTENCIA_PCT = "TESORERIA_ALERTA_EGRESOS_ADVERTENCIA_PCT";
export const CLAVE_TESORERIA_ALERTA_EGRESOS_CRITICA_PCT = "TESORERIA_ALERTA_EGRESOS_CRITICA_PCT";

/**
 * Umbrales vigentes de HU-D6, como enteros. Getter estricto, sin valores por
 * defecto (spec D §6.3, D24): una clave ausente, un valor que no sea un entero
 * escrito como dígitos o un conjunto que no cumpla `UmbralesEgresosSchema`
 * (positivos, ≤ 1000, estrictamente crecientes) es un error de configuración.
 *
 * @throws {ServiceError} UMBRALES_EGRESOS_INVALIDOS
 */
export async function obtenerUmbralesEgresos(): Promise<UmbralesEgresos> {
  const claves = {
    informativa: CLAVE_TESORERIA_ALERTA_EGRESOS_INFORMATIVA_PCT,
    advertencia: CLAVE_TESORERIA_ALERTA_EGRESOS_ADVERTENCIA_PCT,
    critica: CLAVE_TESORERIA_ALERTA_EGRESOS_CRITICA_PCT,
  } as const;
  const filas = await prisma.configuracionSistema.findMany({
    where: { clave: { in: Object.values(claves) } },
    select: { clave: true, valor: true },
  });
  const valores = new Map(filas.map((fila) => [fila.clave, fila.valor]));

  const faltantes = Object.values(claves).filter((clave) => !valores.has(clave));
  if (faltantes.length > 0) {
    throw new ServiceError(
      "UMBRALES_EGRESOS_INVALIDOS",
      `Faltan parámetros de configuración: ${faltantes.join(", ")}`,
    );
  }

  // Solo dígitos: "70.0", "1e2" o " 70" no se aceptan como enteros guardados.
  const comoEntero = (valor: string) => (/^\d+$/.test(valor) ? Number(valor) : Number.NaN);
  const resultado = UmbralesEgresosSchema.safeParse({
    informativa: comoEntero(valores.get(claves.informativa)!),
    advertencia: comoEntero(valores.get(claves.advertencia)!),
    critica: comoEntero(valores.get(claves.critica)!),
  });
  if (!resultado.success) {
    const guardados = Object.values(claves).map((clave) => `${clave}="${valores.get(clave)}"`).join(", ");
    throw new ServiceError(
      "UMBRALES_EGRESOS_INVALIDOS",
      `${resultado.error.issues[0]?.message ?? "Umbrales inválidos"} (valores guardados: ${guardados})`,
    );
  }
  return resultado.data;
}

/** D.4 §6.3: mutación de `ConfiguracionSistema`, exclusivo Administrador. */
export const PERMISO_ADMINISTRAR_CONFIGURACION = "configuracion:administrar";

/** Orden FIJO de bloqueo y escritura de las tres claves (evita deadlocks entre ediciones). */
export const ORDEN_CLAVES_UMBRALES_EGRESOS = [
  ["informativa", CLAVE_TESORERIA_ALERTA_EGRESOS_INFORMATIVA_PCT],
  ["advertencia", CLAVE_TESORERIA_ALERTA_EGRESOS_ADVERTENCIA_PCT],
  ["critica", CLAVE_TESORERIA_ALERTA_EGRESOS_CRITICA_PCT],
] as const;

type ConfiguracionActualizadaPayload = import("@/lib/events/event-types").ConfiguracionActualizadaPayload;

/** Operaciones sobre las claves dentro de la transacción (inyectable en tests). */
export interface RepositorioUmbralesTx {
  /** `SELECT … FOR UPDATE` de una clave: bloquea la fila y devuelve su valor (`null` si no existe). */
  bloquearYLeer(clave: string): Promise<string | null>;
  actualizar(clave: string, valor: string, usuarioId: string): Promise<void>;
}

export interface DependenciasUmbralesEgresos {
  ejecutarTransaccion: <T>(fn: (repo: RepositorioUmbralesTx) => Promise<T>) => Promise<T>;
  /** Emisor post-COMMIT de `configuracion:actualizada`. */
  emitir: (payload: ConfiguracionActualizadaPayload) => void | Promise<void>;
}

const DEPENDENCIAS_UMBRALES_REALES: DependenciasUmbralesEgresos = {
  ejecutarTransaccion: (fn) =>
    prisma.$transaction((tx) =>
      fn({
        async bloquearYLeer(clave) {
          const filas = await tx.$queryRaw<{ valor: string }[]>`
            SELECT valor FROM configuraciones_sistema WHERE clave = ${clave} FOR UPDATE`;
          return filas[0]?.valor ?? null;
        },
        async actualizar(clave, valor, usuarioId) {
          await tx.configuracionSistema.update({ where: { clave }, data: { valor, actualizado_por_id: usuarioId } });
        },
      }),
    ),
  // Import diferido: los consumidores que solo leen configuración no cargan el bus.
  emitir: async (payload) => {
    const { domainEventBus } = await import("@/lib/events/domain-event-bus");
    domainEventBus.emit("configuracion:actualizada", payload);
  },
};

export interface ResultadoActualizacionUmbrales {
  umbrales: UmbralesEgresos;
  hubo_cambio: boolean;
  /** Claves de `ConfiguracionSistema` que cambiaron, en el orden fijo. */
  claves_cambiadas: string[];
}

/**
 * Edición de los tres umbrales como conjunto (D10, D24). Valida el conjunto
 * completo (`UmbralesEgresosSchema`), bloquea las tres filas en orden fijo,
 * relee los valores vigentes bajo ese bloqueo y escribe solo las claves que
 * difieren, con `actualizado_por_id`. Bajo el bloqueo, dos ediciones
 * concurrentes se serializan: el resultado final es siempre uno de los dos
 * conjuntos completos, nunca una mezcla. Sin cambios → no escribe ni emite.
 * Después del COMMIT emite `configuracion:actualizada` por clave cambiada; un
 * fallo al emitir se loguea y no revierte. No reevalúa alertas (D10).
 *
 * @throws {ServiceError} UMBRALES_EGRESOS_INVALIDOS — conjunto inválido (`details.fieldErrors`)
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA — falta alguna de las tres claves
 */
export async function actualizarUmbralesEgresos(
  umbrales: UmbralesEgresos,
  usuarioId: string,
  dependencias: Partial<DependenciasUmbralesEgresos> = {},
): Promise<ResultadoActualizacionUmbrales> {
  const deps = { ...DEPENDENCIAS_UMBRALES_REALES, ...dependencias };
  const validacion = UmbralesEgresosSchema.safeParse(umbrales);
  if (!validacion.success) {
    throw new ServiceError(
      "UMBRALES_EGRESOS_INVALIDOS",
      validacion.error.issues[0]?.message ?? "Umbrales inválidos",
      { fieldErrors: validacion.error.flatten().fieldErrors },
    );
  }
  const nuevos = validacion.data;

  const cambios = await deps.ejecutarTransaccion(async (repo) => {
    const anteriores: string[] = [];
    for (const [, clave] of ORDEN_CLAVES_UMBRALES_EGRESOS) {
      const valor = await repo.bloquearYLeer(clave);
      if (valor === null) {
        throw new ServiceError("CONFIGURACION_NO_ENCONTRADA", `No existe el parámetro de configuración ${clave}`);
      }
      anteriores.push(valor);
    }
    const diferencias: { clave: string; valor_anterior: string; valor_nuevo: string }[] = [];
    ORDEN_CLAVES_UMBRALES_EGRESOS.forEach(([campo, clave], i) => {
      const valorNuevo = String(nuevos[campo]);
      if (anteriores[i] !== valorNuevo) diferencias.push({ clave, valor_anterior: anteriores[i]!, valor_nuevo: valorNuevo });
    });
    for (const { clave, valor_nuevo } of diferencias) await repo.actualizar(clave, valor_nuevo, usuarioId);
    return diferencias;
  });

  for (const cambio of cambios) {
    try {
      await deps.emitir({ ...cambio, usuario_id: usuarioId });
    } catch (error) {
      const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
      console.error("[configuracion.service] Falló la emisión de configuracion:actualizada:", {
        clave: cambio.clave,
        codigo_error: typeof codigo === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(codigo) ? codigo : "ERROR_EMISION_EVENTO",
      });
    }
  }

  return { umbrales: nuevos, hubo_cambio: cambios.length > 0, claves_cambiadas: cambios.map((c) => c.clave) };
}
