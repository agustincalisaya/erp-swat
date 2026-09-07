import "server-only";

/**
 * @module evaluacion.service
 * @description Capa de dominio de HU-H5 (Módulo H) — Recálculo incremental
 * del puntaje de evaluación de proveedores (task_relos.md, Sección 6.1).
 *
 * Se invoca internamente desde otro servicio (`recepcion.service.ts`, HU-H4)
 * — no hay Route Handler ni Server Action propios en este PR (task_relos.md
 * Sección 5). Reglas transversales aplicadas (mismo criterio que
 * `orden-compra.service.ts`):
 *  - Toda escritura multi-tabla corre dentro de un único `prisma.$transaction`.
 *  - Los eventos de dominio se emiten DESPUÉS del `COMMIT`, nunca dentro.
 *  - Ninguna función de este archivo hace un borrado físico de fila alguna
 *    — no aplica baja lógica acá: `EvaluacionProveedor` es un registro
 *    histórico que solo se crea, nunca se actualiza ni se borra.
 *  - Este servicio nunca llama al audit log directamente: `audit-log.listener.ts`
 *    reacciona al evento `proveedor:estado_cambiado` (handler pendiente,
 *    ver `event-types.ts`).
 */

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import {
  RegistrarEvaluacionDesdeRecepcionSchema,
  type RegistrarEvaluacionDesdeRecepcionInput,
} from "@/lib/schemas/proveedores.schema";
import {
  calcularPuntajeCalidad,
  calcularPuntajePlazos,
  calcularPuntajeTotal,
} from "@/lib/services/proveedores/evaluacion.calculo";
import {
  PUNTAJE_DOCUMENTACION_DEFAULT,
  UMBRAL_MINIMO_HOMOLOGACION,
} from "@/lib/services/proveedores/evaluacion.constants";

export interface EvaluacionRegistrada {
  evaluacion_id: string;
  proveedor_id: string;
  puntaje_total: number;
  proveedor_suspendido: boolean;
}

/**
 * Registra una nueva `EvaluacionProveedor` a partir de una `Recepcion`
 * (Sección 6.1). Siempre INSERTA un registro nuevo — nunca actualiza uno
 * existente: el puntaje vigente de un proveedor se resuelve por consulta a
 * la evaluación más reciente (`fecha_evaluacion desc`, `take(1)`), no hay
 * campo cacheado.
 *
 * Idempotente por `recepcion_id` (fix de idempotencia/trazabilidad): si ya
 * existe una `EvaluacionProveedor` para esta `Recepcion` — ej. un reintento
 * de red desde `recepcion.service.ts` tras un COMMIT exitoso pero una
 * respuesta perdida — se devuelve la evaluación ya creada tal cual, sin
 * volver a suspender al proveedor ni volver a emitir el evento. La
 * constraint única de `EvaluacionProveedor.recepcion_id` es la garantía de
 * última instancia contra una carrera concurrente; este `findFirst` evita el
 * trabajo redundante en el caso común (no concurrente).
 *
 * Dentro de la transacción:
 *  1. Busca si ya existe una evaluación para este `recepcion_id`; si existe,
 *     corta acá y la devuelve.
 *  2. Lee la `Recepcion` (con `items` y sus `discrepancias` activas) y la
 *     `fecha_entrega_comprometida` de su `OrdenCompra`.
 *  3. Calcula los tres sub-puntajes (funciones puras de `evaluacion.calculo.ts`).
 *  4. Crea el registro de `EvaluacionProveedor`.
 *  5. Si `puntaje_total < UMBRAL_MINIMO_HOMOLOGACION` y el proveedor no está
 *     ya `SUSPENDIDO` (transición idempotente, mismo criterio que
 *     `cambiarEstadoUsuario()`), transiciona `Proveedor.estado = "SUSPENDIDO"`.
 *
 * `input.devoluciones_fabricacion` se persiste tal cual en el registro
 * (insumo manual, Sección 0.4) pero no se incorpora todavía a ninguna
 * fórmula de sub-puntaje: ni `task_relos.md` ni el equipo definieron cómo
 * debería penalizar — queda pendiente de validar junto con el resto de la
 * Sección 0, no se inventa acá una fórmula no especificada.
 */
export async function registrarEvaluacion(
  input: RegistrarEvaluacionDesdeRecepcionInput,
): Promise<EvaluacionRegistrada> {
  const resultado = await prisma.$transaction(async (tx) => {
    const evaluacionExistente = await tx.evaluacionProveedor.findFirst({
      where: { recepcion_id: input.recepcion_id },
      select: { id: true, proveedor_id: true, puntaje_total: true },
    });
    if (evaluacionExistente) {
      return {
        evaluacionId: evaluacionExistente.id,
        proveedorId: evaluacionExistente.proveedor_id,
        puntajeTotal: Number(evaluacionExistente.puntaje_total),
        suspension: null,
      };
    }

    const recepcion = await tx.recepcion.findFirst({
      where: { id: input.recepcion_id },
      select: {
        id: true,
        fecha_recepcion: true,
        orden_compra: {
          select: {
            proveedor_id: true,
            fecha_entrega_comprometida: true,
          },
        },
        items: {
          where: { is_active: true },
          select: {
            id: true,
            discrepancias: {
              where: { is_active: true },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!recepcion) {
      throw new ServiceError(
        "RECEPCION_NO_ENCONTRADA",
        "La recepción indicada no existe",
      );
    }

    const totalItems = recepcion.items.length;
    const itemsConDiscrepancia = recepcion.items.filter(
      (item) => item.discrepancias.length > 0,
    ).length;

    const puntajePlazos = calcularPuntajePlazos(
      recepcion.fecha_recepcion,
      recepcion.orden_compra.fecha_entrega_comprometida,
    );
    const puntajeCalidad = calcularPuntajeCalidad(totalItems, itemsConDiscrepancia);
    const puntajeDocumentacion =
      input.puntaje_documentacion_override ?? PUNTAJE_DOCUMENTACION_DEFAULT;
    const puntajeTotal = calcularPuntajeTotal(
      puntajePlazos,
      puntajeCalidad,
      puntajeDocumentacion,
    );

    const evaluacion = await tx.evaluacionProveedor.create({
      data: {
        proveedor_id: recepcion.orden_compra.proveedor_id,
        recepcion_id: input.recepcion_id,
        puntaje_cumplimiento_plazos: puntajePlazos,
        puntaje_calidad_recepcion: puntajeCalidad,
        puntaje_documentacion: puntajeDocumentacion,
        puntaje_total: puntajeTotal,
        devoluciones_fabricacion: input.devoluciones_fabricacion,
        observaciones: input.observaciones,
        evaluado_por_id: input.usuario_id,
      },
      select: { id: true, proveedor_id: true },
    });

    let suspension: { estado_anterior: string } | null = null;
    if (puntajeTotal < UMBRAL_MINIMO_HOMOLOGACION) {
      const proveedor = await tx.proveedor.findFirst({
        where: { id: recepcion.orden_compra.proveedor_id },
        select: { estado: true },
      });
      if (!proveedor) {
        throw new ServiceError(
          "PROVEEDOR_NO_ENCONTRADO",
          "El proveedor de la orden de compra de esta recepción no existe",
        );
      }
      // Transición idempotente: si ya estaba SUSPENDIDO, no hay cambio de
      // estado que persistir ni evento que emitir (mismo criterio que
      // `cambiarEstadoUsuario()`, `usuario.service.ts`).
      if (proveedor.estado !== "SUSPENDIDO") {
        await tx.proveedor.update({
          where: { id: recepcion.orden_compra.proveedor_id },
          data: { estado: "SUSPENDIDO" },
        });
        suspension = { estado_anterior: proveedor.estado };
      }
    }

    return {
      evaluacionId: evaluacion.id,
      proveedorId: evaluacion.proveedor_id,
      puntajeTotal,
      suspension,
    };
  });

  // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256). Nunca
  // dentro de la transacción (regla transversal del módulo).
  if (resultado.suspension) {
    domainEventBus.emit("proveedor:estado_cambiado", {
      proveedor_id: resultado.proveedorId,
      usuario_id: null,
      estado_anterior: resultado.suspension.estado_anterior,
      estado_nuevo: "SUSPENDIDO",
      origen: "AUTOMATICO",
      motivo: `Puntaje de evaluación (${resultado.puntajeTotal}) por debajo del umbral mínimo (${UMBRAL_MINIMO_HOMOLOGACION})`,
    });
  }

  return {
    evaluacion_id: resultado.evaluacionId,
    proveedor_id: resultado.proveedorId,
    puntaje_total: resultado.puntajeTotal,
    proveedor_suspendido: resultado.suspension !== null,
  };
}

/**
 * Contrato de disparo con HU-H4 (task_relos.md, Sección 0.5): firma exacta
 * que `recepcion.service.ts` invoca una sola vez, inmediatamente después de
 * que su propia transacción de `registrarRecepcion()` haga commit exitoso.
 * Es una llamada intra-módulo (Módulo H llamándose a sí mismo), no pasa por
 * el Event Bus.
 *
 * Delega en `registrarEvaluacion()` — el punto único de verdad del cálculo —
 * construyendo el input mínimo que exige este contrato. `devoluciones_fabricacion`
 * y `puntaje_documentacion_override` no viajan por esta vía todavía (no hay
 * fuente automática para ninguno de los dos, Secciones 0.3/0.4): quedan en
 * `PUNTAJE_DOCUMENTACION_DEFAULT` hasta que se exponga una vía manual.
 */
export async function registrarEvaluacionDesdeRecepcion(
  recepcionId: string,
  usuarioId: string,
): Promise<EvaluacionRegistrada> {
  const input = RegistrarEvaluacionDesdeRecepcionSchema.parse({
    recepcion_id: recepcionId,
    usuario_id: usuarioId,
  });
  return registrarEvaluacion(input);
}
