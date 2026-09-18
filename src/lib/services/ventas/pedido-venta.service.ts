import "server-only";

/**
 * @module pedido-venta.service
 * @description Capa de dominio de HU-B4 — Override de descuento y cambio
 * manual de precio sobre un `PedidoVentaItem` ya persistido (spec_modulo_B.md
 * §2.4, §3.1, §4). Primer servicio del módulo que opera directamente sobre
 * `PedidoVenta`/`PedidoVentaItem` post-creación (HU-B3 solo crea, vía
 * `presupuesto.service.ts`).
 *
 * Alcance (docs/tasks/HU-B4.md §0): esta HU NO depende de HU-B1 (venta de
 * mostrador, sin código todavía). El estado de espera de aprobación se
 * modela en el ítem (`requiere_autorizacion`/`autorizado_por_id`), no en un
 * estado propio de `PedidoVenta` — el `PedidoVenta` origen puede venir de
 * cualquier flujo que produzca estas entidades (hoy, exclusivamente HU-B3).
 *
 * `autorizacion_id`: id de CORRELACIÓN generado por este servicio
 * (`crypto.randomUUID()`), no el `id` real de la fila de `AuditLog` — decisión
 * resuelta en `docs/tasks/HU-B4.md` §1.2 tras confirmar contra
 * `domain-event-bus.ts`/`audit-log.listener.ts` que ningún servicio del
 * proyecto escribe `AuditLog` de forma sincrónica (los ~30 handlers ya
 * existentes son `void registrarAuditLog(...)`, fire-and-forget). El id de
 * correlación viaja en el payload del evento y se persiste dentro de
 * `valor_nuevo` del `AuditLog` real (vía el listener), quedando trazable sin
 * violar esa regla no-negociable.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { AutorizarOverrideDescuentoInput } from "@/lib/schemas/ventas.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §2.4) — `ventas:aplicar_descuento_margen` gatea el
// Route Handler (el Cajero es quien invoca la ruta, para solicitar);
// `ventas:autorizar_excepcion_descuento` se valida ACÁ ADENTRO, contra
// `supervisor_credencial.usuario_id`, nunca como segundo gate del Route
// Handler (ver docs/tasks/HU-B4.md §1.3 — sin código real de HU-B6 con el
// que contrastar un patrón de doble gate; `withPermission()` solo acepta un
// único código de permiso).
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN = "ventas:aplicar_descuento_margen";
export const PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO = "ventas:autorizar_excepcion_descuento";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface OverrideDescuentoAutorizado {
  autorizacion_id: string;
  descuento_aplicado: number | null;
  autorizado_por: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.4 — Override de descuento y cambio manual de precio
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Autoriza la excepción de descuento/precio de un `PedidoVentaItem` en
 * espera de aprobación (spec §2.4). Ejecuta las 4 validaciones + el ajuste
 * dentro de una única `prisma.$transaction` (mismo criterio que exige spec
 * §3.1 para las transiciones de estado, evitando condiciones de carrera), y
 * emite el/los evento(s) sensible(s) recién DESPUÉS del `COMMIT` (spec §3.3).
 *
 * @param pedidoVentaId - `id` del `PedidoVenta` (path param).
 * @param input - Body validado por `AutorizarOverrideDescuentoSchema`.
 * @param usuarioSolicitanteId - Usuario de la SESIÓN que invoca el endpoint
 *   (el Cajero) — va al payload del evento como `usuario_solicitante_id`,
 *   nunca se usa para la validación de permiso de autorización (esa corre
 *   contra `input.supervisor_credencial.usuario_id`, spec §2.4).
 * @param dispositivo - Dispositivo de origen para el evento sensible (spec
 *   §4, campo `dispositivo` de `venta:descuento_fuera_margen`). Resuelto por
 *   el Route Handler/Server Action a partir del header `User-Agent` del
 *   request — mismo mecanismo ya usado por `usuario:sesion_iniciada`
 *   (`src/app/api/auth/login/route.ts`), único precedente real de captura de
 *   "dispositivo de origen" encontrado en el proyecto (no existe un patrón
 *   previo llamado literalmente `dispositivo`).
 *
 * @throws {ServiceError} PEDIDO_VENTA_NO_ENCONTRADO (404)
 * @throws {ServiceError} TRANSICION_INVALIDA (409) — sin ítem pendiente que
 *   matchee, o el ítem ya fue autorizado antes.
 * @throws {ServiceError} SIN_PERMISO_AUTORIZACION (403) — el usuario de
 *   `supervisor_credencial.usuario_id` no existe, está inactivo/no ACTIVO, o
 *   no tiene `ventas:autorizar_excepcion_descuento`.
 */
export async function autorizarOverrideDescuento(
  pedidoVentaId: string,
  input: AutorizarOverrideDescuentoInput,
  usuarioSolicitanteId: string,
  dispositivo: string,
): Promise<OverrideDescuentoAutorizado> {
  // Punto 6 de la task (§1.2): generado ANTES del COMMIT, dentro del
  // servicio — es un id de correlación propio de Módulo B, no el `id` real
  // de `AuditLog` (ver DECISIÓN RESUELTA en el docstring del módulo).
  const autorizacionId = crypto.randomUUID();

  const resultado = await prisma.$transaction(async (tx) => {
    const pedido = await tx.pedidoVenta.findFirst({
      where: { id: pedidoVentaId, is_active: true },
      select: { id: true },
    });
    if (!pedido) {
      throw new ServiceError(
        "PEDIDO_VENTA_NO_ENCONTRADO",
        "El pedido de venta indicado no existe",
      );
    }

    // Si `variante_sku_id` no viene (campo opcional del schema), se toma el
    // único/primer ítem pendiente de autorización del pedido — decisión no
    // resuelta literalmente en la spec (documentada en el PR): el caso de
    // referencia del seed (`V-2026-000003`) siempre tiene un único ítem con
    // `requiere_autorizacion: true` por pedido.
    const item = await tx.pedidoVentaItem.findFirst({
      where: {
        pedido_venta_id: pedidoVentaId,
        requiere_autorizacion: true,
        ...(input.variante_sku_id ? { variante_sku_id: input.variante_sku_id } : {}),
      },
      select: {
        id: true,
        variante_sku_id: true,
        precio_unitario: true,
        autorizado_por_id: true,
      },
    });
    if (!item) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        "El pedido no tiene ningún ítem pendiente de autorización que coincida con lo solicitado",
      );
    }
    if (item.autorizado_por_id !== null) {
      throw new ServiceError("TRANSICION_INVALIDA", "Este ítem ya fue autorizado");
    }

    // Permiso de AUTORIZACIÓN — validado contra `supervisor_credencial.usuario_id`,
    // NUNCA contra `usuarioSolicitanteId` (spec §2.4: "la credencial autorizante
    // es la del Supervisor"). Consulta dentro de la MISMA transacción (evita
    // condiciones de carrera con una revocación de permiso concurrente) y
    // exige, en una sola condición, que el usuario exista, esté ACTIVO/`is_active`
    // y tenga el permiso — mismo criterio de "administrador funcional" que
    // `filtroAdministradorFuncional()` de `with-permission.ts`.
    const supervisorId = input.supervisor_credencial.usuario_id;
    const supervisor = await tx.usuario.findFirst({
      where: {
        id: supervisorId,
        is_active: true,
        deleted_at: null,
        estado: "ACTIVO",
        roles: {
          some: {
            is_active: true,
            rol: {
              is_active: true,
              permisos: {
                some: {
                  is_active: true,
                  permiso: {
                    codigo: PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO,
                    is_active: true,
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!supervisor) {
      throw new ServiceError(
        "SIN_PERMISO_AUTORIZACION",
        "Solo un Supervisor de Ventas puede autorizar excepciones de descuento",
      );
    }

    const dataUpdate: Prisma.PedidoVentaItemUpdateInput = {
      autorizado_por: { connect: { id: supervisorId } },
      requiere_autorizacion: false,
    };
    if (input.descuento_porcentual_solicitado !== undefined) {
      dataUpdate.descuento_porcentual = input.descuento_porcentual_solicitado;
    }
    // "precio_lista_modificado" no tiene columna propia en PedidoVentaItem —
    // se persiste como ajuste directo de precio_unitario (docs/tasks/HU-B4.md
    // §1.2, punto 4: mapeo documentado explícitamente por no estar dicho
    // literalmente en la spec).
    let precioAnterior: number | null = null;
    if (input.precio_lista_modificado !== undefined) {
      precioAnterior = item.precio_unitario.toNumber();
      dataUpdate.precio_unitario = input.precio_lista_modificado;
    }

    await tx.pedidoVentaItem.update({ where: { id: item.id }, data: dataUpdate });

    return {
      varianteSkuId: item.variante_sku_id,
      precioAnterior,
      supervisorId,
    };
  });

  // Post-COMMIT: evento(s) sensible(s) → Módulo D (encadenamiento SHA-256
  // reforzado, spec §3.3/§4). Si vinieran ambos campos a la vez, se emiten
  // AMBOS eventos con el MISMO `autorizacion_id` de correlación —
  // docs/tasks/HU-B4.md §1.2, punto 7: no resuelto literalmente en la spec,
  // documentado acá y en el PR.
  const timestamp = new Date().toISOString();

  if (input.descuento_porcentual_solicitado !== undefined) {
    domainEventBus.emit("venta:descuento_fuera_margen", {
      autorizacion_id: autorizacionId,
      pedido_venta_id: pedidoVentaId,
      usuario_solicitante_id: usuarioSolicitanteId,
      usuario_autorizante_id: resultado.supervisorId,
      porcentaje_aplicado: input.descuento_porcentual_solicitado,
      motivo: input.motivo,
      dispositivo,
      timestamp,
    });
  }
  if (input.precio_lista_modificado !== undefined) {
    domainEventBus.emit("venta:cambio_precio_manual", {
      autorizacion_id: autorizacionId,
      pedido_venta_id: pedidoVentaId,
      variante_sku_id: resultado.varianteSkuId,
      usuario_autorizante_id: resultado.supervisorId,
      // `precioAnterior` siempre no-null en esta rama (asignado junto con
      // `precio_lista_modificado !== undefined` arriba).
      precio_anterior: resultado.precioAnterior as number,
      precio_nuevo: input.precio_lista_modificado,
      motivo: input.motivo,
    });
  }

  return {
    autorizacion_id: autorizacionId,
    // Sin campo propio para "precio modificado" en el contrato de respuesta
    // (spec §2.4 solo define `descuento_aplicado`) — `null` cuando la
    // autorización fue exclusivamente un cambio de precio, sin descuento
    // porcentual. Decisión no resuelta literalmente en la spec, documentada
    // en el PR.
    descuento_aplicado: input.descuento_porcentual_solicitado ?? null,
    autorizado_por: resultado.supervisorId,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lecturas para la UI (detalle mínimo de PedidoVenta + selector de Supervisor)
// ──────────────────────────────────────────────────────────────────────────────

export interface PedidoVentaItemDetalle {
  id: string;
  variante_sku_id: string;
  sku: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_porcentual: number | null;
  requiere_autorizacion: boolean;
  autorizado_por_id: string | null;
  autorizado_por_nombre: string | null;
}

export interface PedidoVentaDetalle {
  id: string;
  numero_venta: string;
  cliente_nombre: string | null;
  estado: string;
  total: number;
  items: PedidoVentaItemDetalle[];
}

/**
 * Detalle mínimo de un `PedidoVenta` para `/ventas/pedidos/[id]`
 * (docs/tasks/HU-B4.md §2 — pantalla mínima, no una gestión completa de
 * `PedidoVenta`, fuera de alcance de esta HU). `null` si no existe.
 */
export async function obtenerPedidoVenta(id: string): Promise<PedidoVentaDetalle | null> {
  const pedido = await prisma.pedidoVenta.findFirst({
    where: { id },
    select: {
      id: true,
      numero_venta: true,
      estado: true,
      total: true,
      cliente: { select: { nombre: true } },
      items: {
        where: { is_active: true },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          variante_sku_id: true,
          cantidad: true,
          precio_unitario: true,
          descuento_porcentual: true,
          requiere_autorizacion: true,
          autorizado_por_id: true,
          autorizado_por: { select: { nombre_completo: true } },
          variante_sku: {
            select: {
              sku: true,
              talle: true,
              color: true,
              modelo: true,
              producto_maestro: { select: { nombre: true } },
            },
          },
        },
      },
    },
  });
  if (!pedido) return null;

  return {
    id: pedido.id,
    numero_venta: pedido.numero_venta,
    cliente_nombre: pedido.cliente?.nombre ?? null,
    estado: pedido.estado,
    total: pedido.total.toNumber(),
    items: pedido.items.map((it) => ({
      id: it.id,
      variante_sku_id: it.variante_sku_id,
      sku: it.variante_sku.sku,
      descripcion: `${it.variante_sku.producto_maestro.nombre} · ${it.variante_sku.modelo} · ${it.variante_sku.talle}/${it.variante_sku.color}`,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario.toNumber(),
      descuento_porcentual: it.descuento_porcentual?.toNumber() ?? null,
      requiere_autorizacion: it.requiere_autorizacion,
      autorizado_por_id: it.autorizado_por_id,
      autorizado_por_nombre: it.autorizado_por?.nombre_completo ?? null,
    })),
  };
}

export interface SupervisorParaSelector {
  id: string;
  nombre_completo: string;
}

/**
 * Usuarios ACTIVOS que hoy tienen `ventas:autorizar_excepcion_descuento` —
 * selector nominal del Supervisor autorizante en el Dialog de HU-B4 (decisión
 * de UI confirmada con el usuario: sin re-autenticación por contraseña, el
 * schema del endpoint solo transporta `usuario_id`; el backend igual
 * re-valida el permiso real de ese `usuario_id` dentro de la transacción).
 */
export async function listarSupervisoresVentas(): Promise<SupervisorParaSelector[]> {
  const usuarios = await prisma.usuario.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      estado: "ACTIVO",
      roles: {
        some: {
          is_active: true,
          rol: {
            is_active: true,
            permisos: {
              some: {
                is_active: true,
                permiso: {
                  codigo: PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO,
                  is_active: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { nombre_completo: "asc" },
    select: { id: true, nombre_completo: true },
  });

  return usuarios;
}
