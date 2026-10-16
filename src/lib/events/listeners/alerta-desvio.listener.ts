import "server-only";

/**
 * @module alerta-desvio.listener
 * @description HU-D6 (spec_modulo_D.md §8.2, task_relos.md D6, D17, D20) —
 * listener reactivo que reevalúa las alertas de indicadores críticos ante los
 * eventos que ya emite el sistema:
 *  - egresos: `gasto_operativo:creado|editado|dado_de_baja` y
 *    `cuenta_por_pagar:estado_cambiado` (solo `PAGAR`);
 *  - stock: `stock:umbral_critico_alcanzado`, `inventario:ingreso_stock_registrado`,
 *    `stock:transferencia_iniciada`, `stock:transferencia_recepcion_confirmada`,
 *    `stock:reserva_congelada`, `stock:reserva_liberada` (salvo `VENTA`) y
 *    `stock:reclasificacion_devuelto` (solo `DISPONIBLE`).
 * No escucha `stock:umbrales_configurados` (límite documentado de D6).
 *
 * PATRÓN DE REFERENCIA: `ingreso-tesoreria.listener.ts` — guard de registro
 * único y handler en una IIFE async con `try/catch` que loguea y NUNCA relanza
 * hacia el bus. Los objetivos de cada evento (`alerta-desvio.disparadores.ts`)
 * se evalúan de a uno, en serie, para no saturar el pool de conexiones; un
 * objetivo que falla no frena a los siguientes. El actor de las alertas es
 * siempre `null` (decisión del Paso 4B) y el origen `EVENTO`.
 *
 * Se registra una única vez vía el auto-registro de `domain-event-bus.ts`
 * (bloque «Sprint 5 · Cluster 6»), después de `audit-log.listener`.
 */
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import {
  objetivosCuentaPorPagar,
  objetivosGastoCreado,
  objetivosGastoDadoDeBaja,
  objetivosGastoEditado,
  objetivosIngresoStock,
  objetivosReclasificacionDevuelto,
  objetivosReservaCongelada,
  objetivosTransferenciaIniciada,
  objetivosTransferenciaRecepcion,
  objetivosUmbralCritico,
  reservasALiberar,
  type ObjetivoEgresos,
  type ObjetivoStock,
} from "@/lib/services/alertas/alerta-desvio.disparadores";
import {
  evaluarEgresos,
  evaluarStock,
  type DependenciasAlertas,
} from "@/lib/services/alertas/alerta-desvio.service";

/** Lo que hay que reevaluar por un evento. */
export type TareaAlerta =
  | { tipo: "EGRESOS"; objetivo: ObjetivoEgresos }
  | { tipo: "STOCK"; objetivo: ObjetivoStock }
  | { tipo: "RESERVA"; reservaId: string };

/** Dependencias inyectables (tests); por defecto, las reales. */
export interface DependenciasListenerAlertas {
  bus: Pick<typeof domainEventBus, "on">;
  evaluarStock: typeof evaluarStock;
  evaluarEgresos: typeof evaluarEgresos;
  /** Relectura de la `Reserva` liberada: su variante y su depósito (D17). */
  leerReserva: (reservaId: string) => Promise<ObjetivoStock | null>;
  /** Se pasan tal cual al servicio (G14, umbrales, reloj, emisor). */
  dependenciasServicio?: Partial<DependenciasAlertas>;
}

async function leerReservaPrisma(reservaId: string): Promise<ObjetivoStock | null> {
  const reserva = await prisma.reserva.findFirst({
    where: { id: reservaId, is_active: true, deleted_at: null },
    select: { variante_sku_id: true, deposito_id: true },
  });
  return reserva ? { varianteSkuId: reserva.variante_sku_id, depositoId: reserva.deposito_id } : null;
}

/** Diagnóstico seguro: código de `ServiceError` o Prisma; nunca el mensaje. */
function codigoDiagnostico(error: unknown): string {
  const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof codigo === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(codigo) ? codigo : "ERROR_REEVALUACION_ALERTA";
}

/** Referencia legible y sin datos personales: `AAAA-MM`, `variante:deposito` o el id de la reserva. */
function referenciaDe(tarea: TareaAlerta): string {
  if (tarea.tipo === "EGRESOS") return `${tarea.objetivo.anio}-${String(tarea.objetivo.mes).padStart(2, "0")}`;
  if (tarea.tipo === "STOCK") return `${tarea.objetivo.varianteSkuId}:${tarea.objetivo.depositoId}`;
  return `reserva:${tarea.reservaId}`;
}

const egresos = (objetivos: ObjetivoEgresos[]): TareaAlerta[] =>
  objetivos.map((objetivo) => ({ tipo: "EGRESOS", objetivo }));
const stock = (objetivos: ObjetivoStock[]): TareaAlerta[] =>
  objetivos.map((objetivo) => ({ tipo: "STOCK", objetivo }));

let registrado = false;
const pendientes = new Set<Promise<void>>();

/**
 * Resuelve cuando terminaron todas las reevaluaciones en curso. Para tests y
 * scripts de corta vida; no cambia el comportamiento del listener.
 */
export async function alertasPendientes(): Promise<void> {
  // `Array.from` y no spread: un `Set` esparcido bajo target ES5 (como lo
  // transpilan los tests de listeners) da `[]` y este bucle no cedería nunca.
  while (pendientes.size > 0) await Promise.allSettled(Array.from(pendientes));
}

export function iniciarAlertaDesvioListener(inyectadas: Partial<DependenciasListenerAlertas> = {}): void {
  if (registrado) return;
  registrado = true;

  const deps: DependenciasListenerAlertas = {
    bus: domainEventBus,
    evaluarStock,
    evaluarEgresos,
    leerReserva: leerReservaPrisma,
    ...inyectadas,
  };
  const opciones = { origen: "EVENTO" as const, dependencias: deps.dependenciasServicio };

  async function ejecutar(evento: string, tarea: TareaAlerta): Promise<void> {
    try {
      if (tarea.tipo === "EGRESOS") {
        const resultado = await deps.evaluarEgresos(tarea.objetivo, opciones);
        if (resultado.estado === "ERROR_FUENTE") {
          console.error("[alerta-desvio.listener] Egresos sin evaluar: falló la fuente (HU-G14 o umbrales):", {
            evento,
            referencia: resultado.referencia,
            codigo_error: resultado.codigo_error,
          });
        }
        return;
      }
      let objetivo: ObjetivoStock | null = tarea.tipo === "STOCK" ? tarea.objetivo : null;
      if (tarea.tipo === "RESERVA") {
        objetivo = await deps.leerReserva(tarea.reservaId);
        if (!objetivo) {
          console.error("[alerta-desvio.listener] No se encontró la reserva liberada para reevaluar su stock:", {
            evento,
            referencia: referenciaDe(tarea),
            codigo_error: "RESERVA_NO_ENCONTRADA",
          });
          return;
        }
      }
      await deps.evaluarStock(objetivo!, opciones);
    } catch (error) {
      console.error("[alerta-desvio.listener] Falló la reevaluación de una alerta:", {
        evento,
        referencia: referenciaDe(tarea),
        codigo_error: codigoDiagnostico(error),
      });
    }
  }

  /** Suscribe `evento`: calcula las tareas y las corre en serie, sin propagar nada al emisor. */
  function escuchar<K extends keyof DomainEventMap>(
    evento: K,
    tareas: (payload: DomainEventMap[K]) => TareaAlerta[],
  ): void {
    deps.bus.on(evento, (payload) => {
      const tarea = (async () => {
        let lista: TareaAlerta[];
        try {
          lista = tareas(payload);
        } catch (error) {
          console.error("[alerta-desvio.listener] Payload inválido:", {
            evento,
            codigo_error: codigoDiagnostico(error),
          });
          return;
        }
        for (const t of lista) await ejecutar(evento, t);
      })();
      pendientes.add(tarea);
      void tarea.finally(() => pendientes.delete(tarea));
    });
  }

  // Egresos (D6).
  escuchar("gasto_operativo:creado", (p) => egresos(objetivosGastoCreado(p)));
  escuchar("gasto_operativo:editado", (p) => egresos(objetivosGastoEditado(p)));
  escuchar("gasto_operativo:dado_de_baja", (p) => egresos(objetivosGastoDadoDeBaja(p)));
  escuchar("cuenta_por_pagar:estado_cambiado", (p) => egresos(objetivosCuentaPorPagar(p)));

  // Stock (D17).
  escuchar("stock:umbral_critico_alcanzado", (p) => stock(objetivosUmbralCritico(p)));
  escuchar("inventario:ingreso_stock_registrado", (p) => stock(objetivosIngresoStock(p)));
  escuchar("stock:transferencia_iniciada", (p) => stock(objetivosTransferenciaIniciada(p)));
  escuchar("stock:transferencia_recepcion_confirmada", (p) => stock(objetivosTransferenciaRecepcion(p)));
  escuchar("stock:reserva_congelada", (p) => stock(objetivosReservaCongelada(p)));
  escuchar("stock:reclasificacion_devuelto", (p) => stock(objetivosReclasificacionDevuelto(p)));
  escuchar("stock:reserva_liberada", (p) =>
    reservasALiberar(p).map((reservaId): TareaAlerta => ({ tipo: "RESERVA", reservaId })),
  );
}
