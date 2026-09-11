import "server-only";

/**
 * @module comprobante-proveedor.service
 * @description Capa de dominio de HU-H9 — Registro de Comprobantes de
 * Proveedor (spec_modulo_H.md §2.7 / §2.7.1 / §3.6).
 *
 * TODA la lógica de negocio vive acá: los Route Handlers
 * (`app/api/ordenes-compra/[id]/comprobantes/**`,
 * `app/api/comprobantes-proveedor/**`) y las Server Actions
 * (`app/(dashboard)/compras/comprobantes/actions.ts`) son wrappers finos
 * (spec §1) — resuelven sesión + permiso granular, parsean con Zod, invocan
 * una función de este archivo y mapean el resultado/excepción al shape
 * estándar `{ data, error }`.
 *
 * Reglas transversales aplicadas (spec §3.4/§3.5/§3.6, RULES.md §1/§2):
 *  - Ninguna función hace un borrado físico: `anularComprobanteProveedor()`
 *    es baja lógica pura (`is_active=false` + `deleted_*`). No se invoca
 *    `prisma.*.delete` ni `deleteMany` bajo ninguna condición.
 *  - `ComprobanteProveedor` es INMUTABLE tras el alta: no hay ninguna
 *    función de edición de campos, ni siquiera para Supervisor de Compras.
 *  - El `proveedor_id` se resuelve SIEMPRE server-side desde
 *    `orden_compra.proveedor_id` y queda desnormalizado/congelado en la fila
 *    (spec §2.7 / §2.7.1). El cliente nunca lo envía.
 *  - Los eventos de dominio se emiten DESPUÉS del `COMMIT`, nunca dentro
 *    (spec §3.4, patrón fire-and-forget de Módulo D — deuda técnica conocida).
 *  - Este servicio NUNCA escribe `AuditLog` directo: `audit-log.listener.ts`
 *    es el único escritor y reacciona a los eventos que emite este archivo.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  AnularComprobanteProveedorInput,
  FiltrosListadoComprobantesProveedorInput,
  RegistrarComprobanteProveedorInput,
} from "@/lib/schemas/comprobantes-proveedor.schema";
import {
  evaluarAnulacion,
  ordenCompraAdmiteComprobante,
  resolverProveedorIdDeOrden,
} from "@/lib/services/proveedores/comprobante-proveedor-reglas";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §2.7 + matriz Alcance §5). Un permiso por acción.
// `comprobantes_proveedor:anular` es EXCLUSIVO de Supervisor de Compras (spec
// §2.7: "una baja lógica sobre un comprobante ya presentado es una corrección
// sensible, no una operación de carga de rutina"). Punto de verdad compartido
// por Route Handlers y Server Actions.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_CREAR = "comprobantes_proveedor:crear";
export const PERMISO_LEER = "comprobantes_proveedor:leer";
export const PERMISO_ANULAR = "comprobantes_proveedor:anular";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface ComprobanteProveedorRegistrado {
  comprobante_id: string;
  orden_compra_id: string;
  proveedor_id: string;
  tipo: string;
  numero_comprobante: string;
}

export interface ComprobanteProveedorAnulado {
  comprobante_id: string;
  is_active: false;
}

export interface ComprobanteProveedorListado {
  id: string;
  orden_compra_id: string;
  proveedor_id: string;
  tipo: string;
  numero_comprobante: string;
  fecha_emision: Date;
  /** `Prisma.Decimal` serializado a string de 2 decimales (mismo patrón que `CuentaPorPagar.monto`). */
  monto_total: string;
  archivo_adjunto_url: string | null;
  registrado_por_id: string;
  registrado_por_nombre: string | null;
  is_active: boolean;
  deleted_at: Date | null;
  deletion_reason: string | null;
  created_at: Date;
  orden_compra: { numero_orden: string; estado: string };
  proveedor: { razon_social: string; nombre_fantasia: string | null; cuit: string };
}

export interface ListadoComprobantesProveedor {
  registros: ComprobanteProveedorListado[];
  total: number;
  page: number;
  page_size: number;
}

// `select` whitelist reutilizado por los tres listados. NUNCA `include`,
// NUNCA `datos_bancarios_cifrado`/`datos_bancarios_iv` del proveedor
// (Alcance §5.1 / spec §3.3).
const COMPROBANTE_LISTADO_SELECT = {
  id: true,
  orden_compra_id: true,
  proveedor_id: true,
  tipo: true,
  numero_comprobante: true,
  fecha_emision: true,
  monto_total: true,
  archivo_adjunto_url: true,
  registrado_por_id: true,
  is_active: true,
  deleted_at: true,
  deletion_reason: true,
  created_at: true,
  orden_compra: { select: { numero_orden: true, estado: true } },
  proveedor: { select: { razon_social: true, nombre_fantasia: true, cuit: true } },
  registrado_por: { select: { nombre_completo: true } },
} satisfies Prisma.ComprobanteProveedorSelect;

type ComprobanteListadoDb = Prisma.ComprobanteProveedorGetPayload<{
  select: typeof COMPROBANTE_LISTADO_SELECT;
}>;

function mapearListado(fila: ComprobanteListadoDb): ComprobanteProveedorListado {
  return {
    id: fila.id,
    orden_compra_id: fila.orden_compra_id,
    proveedor_id: fila.proveedor_id,
    tipo: fila.tipo,
    numero_comprobante: fila.numero_comprobante,
    fecha_emision: fila.fecha_emision,
    monto_total: fila.monto_total.toFixed(2),
    archivo_adjunto_url: fila.archivo_adjunto_url,
    registrado_por_id: fila.registrado_por_id,
    registrado_por_nombre: fila.registrado_por.nombre_completo ?? null,
    is_active: fila.is_active,
    deleted_at: fila.deleted_at,
    deletion_reason: fila.deletion_reason,
    created_at: fila.created_at,
    orden_compra: {
      numero_orden: fila.orden_compra.numero_orden,
      estado: fila.orden_compra.estado,
    },
    proveedor: {
      razon_social: fila.proveedor.razon_social,
      nombre_fantasia: fila.proveedor.nombre_fantasia,
      cuit: fila.proveedor.cuit,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.7 — Alta de comprobante
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Alta de un `ComprobanteProveedor` asociado a una `OrdenCompra` ya recibida.
 *
 * `ordenCompraId` llega SIEMPRE por el path del endpoint — el body no puede
 * sobreescribirlo. `proveedor_id` se resuelve dentro de la transacción a
 * partir de `orden_compra.proveedor_id` y se congela en la fila.
 *
 * Precondiciones (spec §2.7, verificadas DENTRO de la transacción que escribe,
 * para no confiar en una lectura previa desincronizada):
 *  - la OC existe y está `is_active` → si no, `ORDEN_NO_ENCONTRADA` (404).
 *  - `OrdenCompra.estado` ∈ {`RECIBIDA_COMPLETA`, `CERRADA`} → si no,
 *    `ORDEN_NO_RECEPCIONADA` (409). `CANCELADA` incluida en el rechazo.
 *  - no existe otro comprobante activo con el mismo
 *    `numero_comprobante` + `tipo` + `proveedor_id` → si lo hay,
 *    `COMPROBANTE_DUPLICADO` (409). Se valida aplicativamente Y se captura el
 *    `P2002` del `@@unique` de Prisma como defensa final ante la carrera
 *    (mismo patrón que la colisión de `cuit` en §2.1).
 *
 * NO se valida `Proveedor.estado === "HOMOLOGADO"` (spec §2.7): documentar
 * una compra ya recibida no debe bloquearse por una suspensión posterior.
 *
 * Tras el `COMMIT` se emite `comprobante_proveedor:registrado` (spec §4).
 */
export async function registrarComprobanteProveedor(
  ordenCompraId: string,
  input: RegistrarComprobanteProveedorInput,
  usuarioId: string,
): Promise<ComprobanteProveedorRegistrado> {
  let creado: {
    id: string;
    orden_compra_id: string;
    proveedor_id: string;
    tipo: string;
    numero_comprobante: string;
    monto_total: Prisma.Decimal;
  };

  try {
    creado = await prisma.$transaction(async (tx) => {
      const orden = await tx.ordenCompra.findFirst({
        where: { id: ordenCompraId },
        select: {
          id: true,
          numero_orden: true,
          estado: true,
          is_active: true,
          deleted_at: true,
          proveedor_id: true,
        },
      });
      if (!orden || !orden.is_active || orden.deleted_at !== null) {
        throw new ServiceError(
          "ORDEN_NO_ENCONTRADA",
          "La orden de compra indicada no existe",
        );
      }
      if (!ordenCompraAdmiteComprobante(orden)) {
        throw new ServiceError(
          "ORDEN_NO_RECEPCIONADA",
          `La Orden de Compra ${orden.numero_orden} debe estar RECIBIDA_COMPLETA o CERRADA para admitir la carga de un comprobante; estado actual: ${orden.estado}`,
        );
      }

      const proveedorId = resolverProveedorIdDeOrden(orden);

      const duplicado = await tx.comprobanteProveedor.findFirst({
        where: {
          numero_comprobante: input.numero_comprobante,
          tipo: input.tipo,
          proveedor_id: proveedorId,
          is_active: true,
        },
        select: { id: true },
      });
      if (duplicado) {
        throw new ServiceError(
          "COMPROBANTE_DUPLICADO",
          `Ya existe un comprobante ${input.tipo} N.° ${input.numero_comprobante} activo para este proveedor`,
        );
      }

      return tx.comprobanteProveedor.create({
        data: {
          orden_compra_id: orden.id,
          proveedor_id: proveedorId,
          tipo: input.tipo,
          numero_comprobante: input.numero_comprobante,
          fecha_emision: input.fecha_emision,
          monto_total: new Prisma.Decimal(input.monto_total.toFixed(2)),
          archivo_adjunto_url: input.archivo_adjunto_url ?? null,
          registrado_por_id: usuarioId,
        },
        select: {
          id: true,
          orden_compra_id: true,
          proveedor_id: true,
          tipo: true,
          numero_comprobante: true,
          monto_total: true,
        },
      });
    });
  } catch (error) {
    // Carrera de unicidad: dos altas concurrentes que pasan el pre-check
    // aplicativo colisionan en el `@@unique(numero_comprobante, tipo,
    // proveedor_id)` — se traduce al mismo `409 COMPROBANTE_DUPLICADO`.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ServiceError(
        "COMPROBANTE_DUPLICADO",
        `Ya existe un comprobante ${input.tipo} N.° ${input.numero_comprobante} activo para este proveedor`,
      );
    }
    throw error;
  }

  // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256). El
  // handler de `comprobante_proveedor:registrado` vive en
  // `audit-log.listener.ts`; este servicio solo emite.
  domainEventBus.emit("comprobante_proveedor:registrado", {
    comprobante_id: creado.id,
    orden_compra_id: creado.orden_compra_id,
    proveedor_id: creado.proveedor_id,
    tipo: creado.tipo,
    numero_comprobante: creado.numero_comprobante,
    monto_total: creado.monto_total.toFixed(2),
    registrado_por_id: usuarioId,
  });

  return {
    comprobante_id: creado.id,
    orden_compra_id: creado.orden_compra_id,
    proveedor_id: creado.proveedor_id,
    tipo: creado.tipo,
    numero_comprobante: creado.numero_comprobante,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.7 — Anulación de comprobante (baja lógica pura — RULES.md Regla N.° 1)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Baja lógica de un `ComprobanteProveedor`: `UPDATE` de `is_active=false` +
 * `deleted_at` + `deleted_by` + `deletion_reason` (motivo obligatorio,
 * validado en schema). **Nunca** un `DELETE` físico.
 *
 * Precondición (spec §2.7 / §3.6): el comprobante debe estar `is_active`. Si
 * no existe → `COMPROBANTE_NO_ENCONTRADO` (404); si ya está anulado →
 * `COMPROBANTE_YA_ANULADO` (409). La lectura del estado y el `UPDATE`
 * condicionado corren en la misma transacción (race-safe).
 *
 * Tras el `COMMIT` se emite `comprobante_proveedor:anulado` (spec §4).
 */
export async function anularComprobanteProveedor(
  comprobanteId: string,
  input: AnularComprobanteProveedorInput,
  usuarioId: string,
): Promise<ComprobanteProveedorAnulado> {
  const ahora = new Date();

  const contexto = await prisma.$transaction(async (tx) => {
    const actual = await tx.comprobanteProveedor.findFirst({
      where: { id: comprobanteId },
      select: { id: true, is_active: true, orden_compra_id: true, proveedor_id: true },
    });

    const evaluacion = evaluarAnulacion(actual);
    if (!evaluacion.ok) {
      throw new ServiceError(
        evaluacion.code,
        evaluacion.code === "COMPROBANTE_NO_ENCONTRADO"
          ? "El comprobante indicado no existe"
          : "El comprobante ya fue anulado",
      );
    }

    const cambio = await tx.comprobanteProveedor.updateMany({
      where: { id: comprobanteId, is_active: true, deleted_at: null },
      data: {
        is_active: false,
        deleted_at: ahora,
        deleted_by: usuarioId,
        deletion_reason: input.deletion_reason,
      },
    });
    if (cambio.count === 0) {
      // Otra request lo anuló entre el `findFirst` y el `updateMany`.
      throw new ServiceError(
        "COMPROBANTE_YA_ANULADO",
        "El comprobante ya fue anulado",
      );
    }

    return {
      orden_compra_id: actual!.orden_compra_id,
      proveedor_id: actual!.proveedor_id,
    };
  });

  domainEventBus.emit("comprobante_proveedor:anulado", {
    comprobante_id: comprobanteId,
    orden_compra_id: contexto.orden_compra_id,
    proveedor_id: contexto.proveedor_id,
    deletion_reason: input.deletion_reason,
    anulado_por_id: usuarioId,
  });

  return { comprobante_id: comprobanteId, is_active: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.7 — Lectura (listado por OC / listado global)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Listado de comprobantes de una `OrdenCompra`, ordenado por `fecha_emision`
 * desc (spec §3.2 de la task). Filtra `is_active = true` salvo que
 * `incluirAnulados` sea `true` — decisión que el Route Handler toma según el
 * rol de quien consulta (RULES.md Regla N.° 1: solo Auditoría ve inactivos).
 */
export async function listarComprobantesPorOrdenCompra(
  ordenCompraId: string,
  opciones: { incluirAnulados?: boolean } = {},
): Promise<ComprobanteProveedorListado[]> {
  const filas = await prisma.comprobanteProveedor.findMany({
    where: {
      orden_compra_id: ordenCompraId,
      ...(opciones.incluirAnulados ? {} : { is_active: true }),
    },
    orderBy: { fecha_emision: "desc" },
    select: COMPROBANTE_LISTADO_SELECT,
  });
  return filas.map(mapearListado);
}

/**
 * Listado global paginado (spec §3.3 de la task) — insumo de HU-G10
 * (Tesorería) y del listado operativo del Comprador. Filtra `is_active = true`
 * salvo `incluirAnulados`. Paginación estándar del proyecto.
 */
export async function listarComprobantesProveedor(
  filtros: FiltrosListadoComprobantesProveedorInput,
  opciones: { incluirAnulados?: boolean } = {},
): Promise<ListadoComprobantesProveedor> {
  const where: Prisma.ComprobanteProveedorWhereInput = {
    ...(opciones.incluirAnulados ? {} : { is_active: true }),
    ...(filtros.proveedor_id && { proveedor_id: filtros.proveedor_id }),
    ...(filtros.orden_compra_id && { orden_compra_id: filtros.orden_compra_id }),
    ...(filtros.tipo && { tipo: filtros.tipo }),
  };

  const [filas, total] = await Promise.all([
    prisma.comprobanteProveedor.findMany({
      where,
      orderBy: { fecha_emision: "desc" },
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
      select: COMPROBANTE_LISTADO_SELECT,
    }),
    prisma.comprobanteProveedor.count({ where }),
  ]);

  return {
    registros: filas.map(mapearListado),
    total,
    page: filtros.page,
    page_size: filtros.page_size,
  };
}
