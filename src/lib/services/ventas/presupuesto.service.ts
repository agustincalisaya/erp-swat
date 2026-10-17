import "server-only";

/**
 * @module presupuesto.service
 * @description Capa de dominio de HU-B3 — Cotización/Presupuesto con reserva
 * de stock (spec_modulo_B.md §2.3, §3.1, §3.2).
 *
 * TODA la lógica de negocio de este circuito vive acá: el Route Handler
 * (`app/api/ventas/presupuestos/**`) y las Server Actions
 * (`app/(dashboard)/ventas/presupuestos/actions.ts`) son wrappers finos —
 * resuelven sesión + permiso granular, parsean el body con Zod, invocan una
 * función de este archivo y mapean el resultado/excepción al shape estándar
 * `{ data, error }` (spec §1, §2, "Convenciones generales"). Está prohibido
 * reimplementar cualquier regla de acá en esas capas.
 *
 * Principio arquitectónico no negociable (spec §3.2, heredado de
 * `spec_modulo_A.md` §2.9): este módulo NUNCA implementa lógica de
 * congelamiento, liberación o descuento de stock propia. Toda operación
 * sobre `Reserva`/`StockDeposito` se delega exclusivamente en
 * `crearReserva()` de `lib/services/inventario/reserva.service.ts`.
 *
 * Reglas transversales aplicadas (RULES.md §1/§2):
 *  - Ninguna función de este archivo invoca `prisma.*.delete()` / `deleteMany()`.
 *    El vencimiento de un Presupuesto es baja lógica (`is_active=false` +
 *    `deleted_*` + `estado=VENCIDO`), nunca DELETE físico.
 *  - Los eventos de dominio se emiten DESPUÉS del `COMMIT`, nunca dentro
 *    (spec §3.3, patrón fire-and-forget de Módulo D — deuda técnica conocida).
 */

import { Prisma } from "@prisma/client";
import type { EstadoPresupuesto, EstadoPedidoVenta } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import { crearReserva } from "@/lib/services/inventario/reserva.service";
import type { CrearPresupuestoInput } from "@/lib/schemas/ventas.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §2.3) — un único permiso cubre alta Y aceptación
// (`ventas:emitir_cotizacion`, exclusivo Cajero POS), tal como lo describe el
// propio seed: "Emitir un Presupuesto con congelamiento de stock y aceptar
// su conversión a PedidoVenta". `ventas:leer` gatea las lecturas (listado /
// detalle) — separado de emitir, mismo criterio que `ordenes_compra:leer`.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_VENTAS_EMITIR_COTIZACION = "ventas:emitir_cotizacion";
export const PERMISO_VENTAS_LEER = "ventas:leer";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface PresupuestoCreado {
  presupuesto_id: string;
  estado: "EMITIDO";
  vigencia_hasta: string;
  reservas_generadas: number;
}

export interface PresupuestoAceptado {
  pedido_venta_id: string;
  presupuesto_id: string;
  estado: "RESERVADO";
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.3 — Alta de Presupuesto (congelamiento de stock vía Módulo A)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Da de alta un `Presupuesto` en estado `EMITIDO`, congelando stock por cada
 * ítem cotizado vía el servicio centralizado de Reserva de Módulo A
 * (`crearReserva()`, spec_modulo_A.md §2.9) — nunca reimplementado acá.
 *
 * Secuencia (no es un único `prisma.$transaction`, a propósito):
 *  1. Precondición: `cliente_id` existe y está activo (Módulo C no tiene
 *     capa de servicios propia todavía — consulta ad-hoc contra
 *     `prisma.cliente`, aislada acá y no reutilizada por otro módulo).
 *  2. Por cada ítem, en orden: `crearReserva()` — cada llamada abre y cierra
 *     SU PROPIA `$transaction` (Módulo A es dueño exclusivo de esa
 *     atomicidad; Módulo B no puede ni debe envolverla en la suya).
 *  3. Alta atómica de `Presupuesto` + N `PresupuestoItem`, cada uno
 *     referenciando la `Reserva` ya congelada en el paso 2.
 *
 * Falla parcial (ítem N de M no puede congelarse, ej. `STOCK_INSUFICIENTE`):
 * las Reservas ya congeladas para los ítems 1..N-1 NO se liberan
 * manualmente acá — Módulo B no implementa liberación de stock propia bajo
 * ninguna circunstancia (spec §3.2). Quedan activas pero sin
 * `PresupuestoItem` que las referencie ("huérfanas") hasta que el job de
 * TTL de Módulo A (`liberarReservasVencidas()`) las libere naturalmente al
 * cumplirse su `ttl_horas` — mismo mecanismo de autocuración que ya cubre
 * el resto del sistema, sin que este módulo reimplemente nada.
 */
export async function crearPresupuesto(
  input: CrearPresupuestoInput,
  usuarioId: string,
): Promise<PresupuestoCreado> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: input.cliente_id, is_active: true, deleted_at: null },
    select: { id: true },
  });
  if (!cliente) {
    throw new ServiceError(
      "CLIENTE_NO_ENCONTRADO",
      "El cliente indicado no existe o está inactivo",
    );
  }

  // `ttl_horas` derivado de `vigencia_dias` (spec §2.3) — la Reserva y el
  // Presupuesto comparten la misma ventana temporal nominal. Ver limitación
  // conocida documentada en `reserva.service.ts` (`liberarReservasVencidas`):
  // el cron de Módulo A hoy aplica un TTL fijo de 72h para todo origen,
  // independientemente del `ttl_horas` pasado acá — no es una limitación de
  // este módulo, es una deuda técnica ya documentada de Módulo A.
  const ttlHoras = input.vigencia_dias * 24;
  const motivo = `Presupuesto — cotización institucional (HU-B3, origen ${input.origen_reserva})`;

  const reservaIdPorIndice: string[] = [];
  for (const item of input.items) {
    const reserva = await crearReserva(
      {
        variante_sku_id: item.variante_sku_id,
        deposito_id: item.deposito_id,
        cantidad: item.cantidad,
        origen_reserva: input.origen_reserva,
        motivo,
        ttl_horas: ttlHoras,
      },
      usuarioId,
    );
    reservaIdPorIndice.push(reserva.reserva_id);
  }

  const vigenciaHasta = new Date(Date.now() + ttlHoras * 60 * 60 * 1000);

  const presupuesto = await prisma.$transaction(async (tx) => {
    return tx.presupuesto.create({
      data: {
        cliente_id: input.cliente_id,
        estado: "EMITIDO",
        vigencia_dias: input.vigencia_dias,
        vigencia_hasta: vigenciaHasta,
        condiciones_comerciales: input.condiciones_comerciales,
        creado_por_id: usuarioId,
        items: {
          create: input.items.map((item, indice) => ({
            variante_sku_id: item.variante_sku_id,
            cantidad: item.cantidad,
            precio_cotizado: item.precio_cotizado,
            reserva_id: reservaIdPorIndice[indice],
          })),
        },
      },
      select: { id: true, vigencia_hasta: true },
    });
  });

  // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256).
  domainEventBus.emit("venta:presupuesto_emitido", {
    presupuesto_id: presupuesto.id,
    cliente_id: input.cliente_id,
    vigencia_hasta: presupuesto.vigencia_hasta!.toISOString(),
    reserva_ids: reservaIdPorIndice,
    creado_por_id: usuarioId,
  });

  return {
    presupuesto_id: presupuesto.id,
    estado: "EMITIDO",
    vigencia_hasta: presupuesto.vigencia_hasta!.toISOString(),
    reservas_generadas: reservaIdPorIndice.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Transición perezosa EMITIDO → VENCIDO (spec §2.3/§3.1)
// ──────────────────────────────────────────────────────────────────────────────

interface PresupuestoEstadoActual {
  id: string;
  cliente_id: string;
  estado: EstadoPresupuesto;
  vigencia_hasta: Date | null;
  is_active: boolean;
  deleted_at: Date | null;
}

/**
 * spec §2.3/§3.1: "Presupuesto.estado transiciona a VENCIDO ... por una
 * consulta perezosa al momento de la siguiente lectura del presupuesto".
 * Evaluada en cada lectura individual (`obtenerPresupuesto`) e intento de
 * aceptación (`aceptarPresupuesto`) — NUNCA en el listado completo (evitaría
 * un `UPDATE` por fila en cada carga de grilla).
 *
 * Baja lógica PURA sobre la fila de `Presupuesto`: nunca toca `Reserva` ni
 * `StockDeposito` — esa liberación es responsabilidad exclusiva del job de
 * TTL de Módulo A (spec §3.2), que corre de forma completamente
 * independiente según su propio `fecha_inicio_reserva`.
 *
 * `updateMany` condicionado al estado leído: ante dos lecturas concurrentes
 * del mismo presupuesto vencido, solo una persiste el cambio y emite el
 * evento; la otra recibe `count === 0` y simplemente refleja el resultado ya
 * conocido sin duplicar el evento de dominio.
 */
async function aplicarVencimientoSiCorresponde(
  presupuesto: PresupuestoEstadoActual,
): Promise<PresupuestoEstadoActual> {
  const vencido =
    presupuesto.estado === "EMITIDO" &&
    presupuesto.vigencia_hasta !== null &&
    presupuesto.vigencia_hasta.getTime() <= Date.now();
  if (!vencido) return presupuesto;

  const ahora = new Date();
  await prisma.presupuesto.updateMany({
    where: { id: presupuesto.id, estado: "EMITIDO" },
    data: {
      estado: "VENCIDO",
      is_active: false,
      deleted_at: ahora,
      deletion_reason: "Vencimiento automático de vigencia (HU-B3 §3.1)",
    },
  });

  domainEventBus.emit("venta:presupuesto_vencido", {
    presupuesto_id: presupuesto.id,
    cliente_id: presupuesto.cliente_id,
    vigencia_hasta: presupuesto.vigencia_hasta!.toISOString(),
  });

  return { ...presupuesto, estado: "VENCIDO", is_active: false, deleted_at: ahora };
}

/**
 * Versión pura (sin escritura) del mismo cálculo, para el badge de estado
 * del listado — spec §3.1 no exige persistir el vencimiento en cada carga de
 * grilla, solo reflejarlo. El listado nunca dispara `aplicarVencimientoSiCorresponde()`.
 */
export function calcularEstadoEfectivo(
  estado: EstadoPresupuesto,
  vigenciaHasta: Date | null,
): EstadoPresupuesto {
  if (estado === "EMITIDO" && vigenciaHasta && vigenciaHasta.getTime() <= Date.now()) {
    return "VENCIDO";
  }
  return estado;
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.3/§3.1 — Aceptación (EMITIDO → PedidoVenta RESERVADO)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Genera un `numero_venta` server-side determinístico y único
 * (`V-<año>-<secuencia 6 díg.>`) — mismo patrón que `generarNumeroOrden()`
 * de `orden-compra.service.ts`. El `@unique` de schema es la defensa final:
 * ante una colisión por concurrencia (`P2002`) el llamador reintenta.
 */
async function generarNumeroVenta(tx: Prisma.TransactionClient): Promise<string> {
  const anio = new Date().getFullYear();
  const prefijo = `V-${anio}-`;
  const emitidosEsteAnio = await tx.pedidoVenta.count({
    where: { numero_venta: { startsWith: prefijo } },
  });
  return `${prefijo}${String(emitidosEsteAnio + 1).padStart(6, "0")}`;
}

/**
 * Convierte un `Presupuesto` `EMITIDO` en un `PedidoVenta` `RESERVADO`
 * (spec §2.3, transición `EMITIDO → RESERVADO` de la tabla §3.1).
 *
 * Reutiliza la MISMA `Reserva` de cada `PresupuestoItem` en el
 * `PedidoVentaItem` correspondiente — NUNCA vuelve a invocar `crearReserva()`
 * (spec §2.3: "sin congelar stock una segunda vez"; §3.2: exclusividad de
 * Módulo A). El `Presupuesto` origen queda vinculado (`presupuesto_origen_id`)
 * y su `estado` permanece `EMITIDO` para siempre — el enum `EstadoPresupuesto`
 * no tiene un valor "ACEPTADO"/"CONVERTIDO" (confirmado en el relevamiento
 * contra `schema.prisma` y el propio seed, que deja `presupuestoLicitacion`
 * en `EMITIDO` incluso después de generar su `pedidoVentaLicitacion`).
 *
 * @throws {ServiceError} PRESUPUESTO_NO_ENCONTRADO (404)
 * @throws {ServiceError} PRESUPUESTO_VENCIDO (409) — vigencia ya cumplida;
 *   dispara la misma transición perezosa que `obtenerPresupuesto()`.
 * @throws {ServiceError} TRANSICION_INVALIDA (409) — estado origen distinto
 *   de EMITIDO (BORRADOR nunca llega acá vía el contrato público; VENCIDO
 *   post-transición; o el presupuesto está inactivo).
 * @throws {ServiceError} PRESUPUESTO_YA_CONVERTIDO (409) — ya tiene un
 *   PedidoVenta vinculado (doble aceptación, defendido además por el
 *   `@unique` de `presupuesto_origen_id`).
 */
export async function aceptarPresupuesto(
  presupuestoId: string,
  usuarioId: string,
): Promise<PresupuestoAceptado> {
  const actual = await prisma.presupuesto.findFirst({
    where: { id: presupuestoId },
    select: {
      id: true,
      cliente_id: true,
      estado: true,
      vigencia_hasta: true,
      is_active: true,
      deleted_at: true,
    },
  });
  if (!actual) {
    throw new ServiceError(
      "PRESUPUESTO_NO_ENCONTRADO",
      "El presupuesto indicado no existe",
    );
  }

  const conVencimientoResuelto = await aplicarVencimientoSiCorresponde(actual);
  if (conVencimientoResuelto.estado === "VENCIDO" && actual.estado === "EMITIDO") {
    throw new ServiceError(
      "PRESUPUESTO_VENCIDO",
      `El presupuesto venció el ${actual.vigencia_hasta?.toISOString()}; no admite conversión a pedido`,
    );
  }
  if (
    conVencimientoResuelto.estado !== "EMITIDO" ||
    !conVencimientoResuelto.is_active ||
    conVencimientoResuelto.deleted_at !== null
  ) {
    throw new ServiceError(
      "TRANSICION_INVALIDA",
      `Solo un Presupuesto en estado EMITIDO puede aceptarse (estado actual: ${conVencimientoResuelto.estado})`,
    );
  }

  const yaConvertido = await prisma.pedidoVenta.findFirst({
    where: { presupuesto_origen_id: presupuestoId },
    select: { id: true },
  });
  if (yaConvertido) {
    throw new ServiceError(
      "PRESUPUESTO_YA_CONVERTIDO",
      "Este presupuesto ya fue convertido a un pedido de venta",
    );
  }

  const MAX_INTENTOS_NUMERO_VENTA = 3;
  for (let intento = 1; ; intento++) {
    try {
      const resultado = await prisma.$transaction(async (tx) => {
        const items = await tx.presupuestoItem.findMany({
          where: { presupuesto_id: presupuestoId, is_active: true },
          select: {
            variante_sku_id: true,
            cantidad: true,
            precio_cotizado: true,
            reserva_id: true,
          },
        });

        const itemSinReserva = items.find((it) => !it.reserva_id);
        if (itemSinReserva) {
          // Invariante violada (presupuesto creado fuera de `crearPresupuesto()`,
          // ej. manipulación directa de datos) — defensa, no camino esperado.
          throw new ServiceError(
            "RESERVA_FALTANTE",
            `El ítem de variante ${itemSinReserva.variante_sku_id} no tiene una Reserva de Módulo A asociada`,
          );
        }

        const total = items.reduce(
          (acc, it) => acc + it.cantidad * it.precio_cotizado.toNumber(),
          0,
        );
        const numeroVenta = await generarNumeroVenta(tx);

        const pedido = await tx.pedidoVenta.create({
          data: {
            numero_venta: numeroVenta,
            cliente_id: conVencimientoResuelto.cliente_id,
            presupuesto_origen_id: presupuestoId,
            estado: "RESERVADO",
            total,
            registrado_por_id: usuarioId,
            items: {
              create: items.map((it) => ({
                variante_sku_id: it.variante_sku_id,
                cantidad: it.cantidad,
                precio_unitario: it.precio_cotizado,
                // Reutiliza la MISMA Reserva — nunca se congela de nuevo.
                reserva_id: it.reserva_id,
              })),
            },
          },
          select: { id: true, numero_venta: true },
        });

        return { pedido_venta_id: pedido.id, numero_venta: pedido.numero_venta };
      });

      // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256).
      domainEventBus.emit("venta:presupuesto_aceptado", {
        presupuesto_id: presupuestoId,
        pedido_venta_id: resultado.pedido_venta_id,
        numero_venta: resultado.numero_venta,
        cliente_id: conVencimientoResuelto.cliente_id,
        aceptado_por_id: usuarioId,
      });

      return {
        pedido_venta_id: resultado.pedido_venta_id,
        presupuesto_id: presupuestoId,
        estado: "RESERVADO",
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = error.meta?.target as string[] | string | undefined;
        const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
        if (targetStr.includes("presupuesto_origen_id")) {
          // Doble aceptación concurrente del MISMO presupuesto — no reintentar
          // con otro numero_venta, ya existe un PedidoVenta vinculado.
          throw new ServiceError(
            "PRESUPUESTO_YA_CONVERTIDO",
            "Este presupuesto ya fue convertido a un pedido de venta",
          );
        }
        if (targetStr.includes("numero_venta") && intento < MAX_INTENTOS_NUMERO_VENTA) {
          continue;
        }
      }
      throw error;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Lecturas para la UI (listado / detalle / selectores del formulario de alta).
//
// Solo lectura: no aplican reglas de negocio (salvo la transición perezosa de
// `obtenerPresupuesto`, documentada arriba). Las páginas son React Server
// Components y llaman a estas funciones directamente (sin fetch HTTP), igual
// que el resto del dashboard (`/compras/*`, `/inventario/*`).
// ──────────────────────────────────────────────────────────────────────────────

export interface PresupuestoResumen {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  estado: EstadoPresupuesto;
  vigencia_hasta: Date | null;
  cantidad_items: number;
  total: number;
}

/**
 * Listado de presupuestos para `/ventas/presupuestos`. NO filtra por
 * `is_active`: un presupuesto VENCIDO (baja lógica) sigue siendo parte del
 * historial y debe verse en la grilla con su estado (mismo criterio que
 * `listarOrdenesCompra`, spec §2.4 de Módulo H). El estado mostrado usa
 * `calcularEstadoEfectivo()` (puro, sin escritura) para reflejar un
 * vencimiento que todavía no pasó por una lectura individual.
 */
export async function listarPresupuestos(): Promise<PresupuestoResumen[]> {
  const presupuestos = await prisma.presupuesto.findMany({
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      cliente_id: true,
      estado: true,
      vigencia_hasta: true,
      cliente: { select: { nombre: true } },
      items: {
        where: { is_active: true },
        select: { cantidad: true, precio_cotizado: true },
      },
    },
  });

  return presupuestos.map((p) => ({
    id: p.id,
    cliente_id: p.cliente_id,
    cliente_nombre: p.cliente.nombre,
    estado: calcularEstadoEfectivo(p.estado, p.vigencia_hasta),
    vigencia_hasta: p.vigencia_hasta,
    cantidad_items: p.items.length,
    total: p.items.reduce(
      (acc, it) => acc + it.cantidad * it.precio_cotizado.toNumber(),
      0,
    ),
  }));
}

export interface PresupuestoItemDetalle {
  id: string;
  variante_sku_id: string;
  sku: string;
  descripcion: string;
  deposito_nombre: string;
  cantidad: number;
  precio_cotizado: number;
  subtotal: number;
}

export interface PresupuestoDetalle {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  estado: EstadoPresupuesto;
  vigencia_dias: number;
  vigencia_hasta: Date | null;
  condiciones_comerciales: string | null;
  is_active: boolean;
  deleted_at: Date | null;
  deletion_reason: string | null;
  creado_por_nombre: string | null;
  items: PresupuestoItemDetalle[];
  total: number;
  pedido_venta: { id: string; numero_venta: string; estado: EstadoPedidoVenta } | null;
}

/**
 * Detalle completo de un Presupuesto para `/ventas/presupuestos/[id]`.
 * Aplica la transición perezosa EMITIDO → VENCIDO (spec §2.3/§3.1) antes de
 * proyectar la respuesta — esta es la "próxima lectura" que la spec describe
 * como disparador válido del vencimiento. `null` si no existe.
 */
export async function obtenerPresupuesto(id: string): Promise<PresupuestoDetalle | null> {
  const presupuesto = await prisma.presupuesto.findFirst({
    where: { id },
    select: {
      id: true,
      cliente_id: true,
      estado: true,
      vigencia_dias: true,
      vigencia_hasta: true,
      condiciones_comerciales: true,
      creado_por_id: true,
      is_active: true,
      deleted_at: true,
      deletion_reason: true,
      cliente: { select: { nombre: true } },
      items: {
        where: { is_active: true },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          variante_sku_id: true,
          cantidad: true,
          precio_cotizado: true,
          variante_sku: {
            select: {
              sku: true,
              talle: true,
              color: true,
              modelo: true,
              producto_maestro: { select: { nombre: true } },
            },
          },
          reserva: { select: { deposito: { select: { nombre: true } } } },
        },
      },
      pedido_venta: { select: { id: true, numero_venta: true, estado: true } },
    },
  });
  if (!presupuesto) return null;

  const conVencimientoResuelto = await aplicarVencimientoSiCorresponde({
    id: presupuesto.id,
    cliente_id: presupuesto.cliente_id,
    estado: presupuesto.estado,
    vigencia_hasta: presupuesto.vigencia_hasta,
    is_active: presupuesto.is_active,
    deleted_at: presupuesto.deleted_at,
  });

  const [creador] = await Promise.all([
    prisma.usuario.findFirst({
      where: { id: presupuesto.creado_por_id },
      select: { nombre_completo: true },
    }),
  ]);

  const items: PresupuestoItemDetalle[] = presupuesto.items.map((it) => {
    const precio = it.precio_cotizado.toNumber();
    return {
      id: it.id,
      variante_sku_id: it.variante_sku_id,
      sku: it.variante_sku.sku,
      descripcion: `${it.variante_sku.producto_maestro.nombre} · ${it.variante_sku.modelo} · ${it.variante_sku.talle}/${it.variante_sku.color}`,
      deposito_nombre: it.reserva?.deposito.nombre ?? "—",
      cantidad: it.cantidad,
      precio_cotizado: precio,
      subtotal: precio * it.cantidad,
    };
  });

  return {
    id: presupuesto.id,
    cliente_id: presupuesto.cliente_id,
    cliente_nombre: presupuesto.cliente.nombre,
    estado: conVencimientoResuelto.estado,
    vigencia_dias: presupuesto.vigencia_dias,
    vigencia_hasta: presupuesto.vigencia_hasta,
    condiciones_comerciales: presupuesto.condiciones_comerciales,
    is_active: conVencimientoResuelto.is_active,
    deleted_at: conVencimientoResuelto.deleted_at,
    deletion_reason: presupuesto.deletion_reason,
    creado_por_nombre: creador?.nombre_completo ?? null,
    items,
    total: items.reduce((acc, it) => acc + it.subtotal, 0),
    pedido_venta: presupuesto.pedido_venta,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Selectores del formulario de alta
// ──────────────────────────────────────────────────────────────────────────────

export interface ClienteParaSelector {
  id: string;
  nombre: string;
  dni: string;
}

/**
 * Clientes seleccionables en el formulario de alta de Presupuesto. Consulta
 * ad-hoc contra `prisma.cliente` (Módulo C todavía no tiene capa de
 * servicios propia — hallazgo de relevamiento confirmado, decisión del
 * equipo de no crearla en esta tarea): esta función vive acá, en Módulo B,
 * y no se reexpone como un servicio genérico de "Clientes" reutilizable por
 * otros módulos.
 */
export async function listarClientesParaSelector(): Promise<ClienteParaSelector[]> {
  return prisma.cliente.findMany({
    where: { is_active: true, deleted_at: null, fusionado_en_id: null },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, dni: true },
  });
}

export interface VarianteParaCotizacion {
  id: string;
  sku: string;
  descripcion: string;
}

/** Tope defensivo del selector — mismo criterio que `listarVariantesParaOrden()` de Módulo H. */
const MAX_VARIANTES_SELECTOR = 500;

/**
 * Variantes seleccionables en el formulario de alta de Presupuesto. Consulta
 * propia de Módulo B contra `VarianteSKU` (entidad de Módulo A, de solo
 * lectura acá) — no reutiliza `listarVariantesParaOrden()` de
 * `orden-compra.service.ts` (Módulo H) para no acoplar Ventas a Compras.
 */
export async function listarVariantesParaCotizacion(): Promise<VarianteParaCotizacion[]> {
  const variantes = await prisma.varianteSKU.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      producto_maestro: { is_active: true, deleted_at: null },
    },
    orderBy: { sku: "asc" },
    take: MAX_VARIANTES_SELECTOR,
    select: {
      id: true,
      sku: true,
      talle: true,
      color: true,
      modelo: true,
      producto_maestro: { select: { nombre: true } },
    },
  });

  return variantes.map((v) => ({
    id: v.id,
    sku: v.sku,
    descripcion: `${v.producto_maestro.nombre} · ${v.modelo} · ${v.talle}/${v.color}`,
  }));
}
