/**
 * HU-D6 (Módulo D) — Lectura del panel de alertas (task_relos.md D7, D12, D19).
 *
 * `obtenerPanelAlertas()` es el único punto de entrada de la página
 * `/tesoreria/alertas` y de `GET /api/tesoreria/alertas`: primero reevalúa
 * (`reevaluarAlertasAlAbrirPanel`, D7) y después lista. Así ambos cumplen el
 * criterio de reevaluar al abrir. Si HU-G14 falló, el listado sale igual, con
 * las alertas sin modificar y `fuente_egresos.estado = "NO_DISPONIBLE"`.
 *
 * Listado: solo `is_active` (RULES Regla 1), filtros por estado y nivel,
 * paginación en base con el mismo `where` para el conteo, orden más grave
 * primero y luego más reciente (desempate por `id`). Variante y depósito se
 * traen en la MISMA consulta (join), sin N+1. Las ACTIVAS muestran el valor
 * vigente de esta misma reevaluación (D19); las RESUELTAS, el último desvío
 * registrado, que la resolución no pisa (D28).
 */
import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { FiltrosPanelAlertas, UmbralesEgresos } from "@/lib/schemas/alertas-desvio.schema";
import {
  reevaluarAlertasAlAbrirPanel,
  type DependenciasAlertas,
  type ResultadoReevaluacionPanel,
} from "@/lib/services/alertas/alerta-desvio.service";
import {
  detalleLegible,
  ETIQUETA_ESTADO,
  ETIQUETA_INDICADOR,
  ETIQUETA_SEVERIDAD,
  referenciaLegible,
  type EstadoFuenteEgresos,
} from "@/lib/services/alertas/alerta-desvio.presentacion";
import type { EstadoAlerta, IndicadorAlerta, SeveridadAlerta } from "@/lib/services/alertas/alerta-desvio.reglas";
import { obtenerUmbralesEgresos } from "@/lib/services/sistema/configuracion.service";
import { formatearFechaHoraNegocio } from "@/lib/utils/fecha-negocio";

export interface FilaAlertaPanel {
  id: string;
  indicador: IndicadorAlerta;
  indicador_etiqueta: string;
  referencia: string;
  severidad: SeveridadAlerta;
  severidad_etiqueta: string;
  estado: EstadoAlerta;
  estado_etiqueta: string;
  /** Ya formateado: «Stock 0 (punto de pedido 5)» o «78,4% (umbral 70%)». */
  detalle: string;
  /** `true` si el detalle es el valor vigente de esta reevaluación (solo ACTIVAS, D19). */
  detalle_vigente: boolean;
  desde: string;
  desde_texto: string;
  resuelta_at: string | null;
  resuelta_texto: string | null;
}

export interface PanelAlertas {
  alertas: FilaAlertaPanel[];
  paginacion: { total: number; page: number; page_size: number; total_paginas: number };
  /** `null` si la configuración de umbrales no se pudo leer (el panel muestra el aviso). */
  umbrales: UmbralesEgresos | null;
  fuente_egresos: EstadoFuenteEgresos;
}

export interface OpcionesPanelAlertas {
  dependencias?: Partial<DependenciasAlertas>;
}

const SEVERIDAD_POR_NIVEL = {
  critica: "CRITICA",
  advertencia: "ADVERTENCIA",
  informativa: "INFORMATIVA",
} as const satisfies Record<NonNullable<FiltrosPanelAlertas["nivel"]>, SeveridadAlerta>;

const ESTADO_POR_PESTANA = {
  activas: "ACTIVA",
  resueltas: "RESUELTA",
  todas: null,
} as const satisfies Record<FiltrosPanelAlertas["estado"], EstadoAlerta | null>;

function fuenteEgresosDe(reevaluacion: ResultadoReevaluacionPanel): EstadoFuenteEgresos {
  const egresos = reevaluacion.egresos_mes_actual;
  if (egresos.estado === "EVALUADO") {
    return egresos.porcentaje === null
      ? { estado: "NO_CALCULABLE", referencia: egresos.referencia }
      : { estado: "CALCULABLE", referencia: egresos.referencia, porcentaje: egresos.porcentaje };
  }
  return { estado: "NO_DISPONIBLE", referencia: egresos.referencia };
}

const decimal = (valor: Prisma.Decimal | null) => (valor === null ? null : Number(valor.toString()));

/**
 * Reevalúa (D7) y lista las alertas del panel.
 *
 * @throws el error de base si la reevaluación o la lectura fallan (G14 caído NO lanza).
 */
export async function obtenerPanelAlertas(
  filtros: FiltrosPanelAlertas,
  opciones: OpcionesPanelAlertas = {},
): Promise<PanelAlertas> {
  const reevaluacion = await reevaluarAlertasAlAbrirPanel({ dependencias: opciones.dependencias });

  let umbrales: UmbralesEgresos | null = null;
  try {
    umbrales = await (opciones.dependencias?.obtenerUmbralesEgresos ?? obtenerUmbralesEgresos)();
  } catch (error) {
    const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    console.error("[alerta-desvio.panel] No se pudieron leer los umbrales de egresos:", {
      codigo_error: typeof codigo === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(codigo) ? codigo : "ERROR_UMBRALES",
    });
  }

  const estado = ESTADO_POR_PESTANA[filtros.estado];
  const where: Prisma.AlertaDesvioWhereInput = {
    is_active: true,
    deleted_at: null,
    ...(estado && { estado }),
    ...(filtros.nivel && { severidad: SEVERIDAD_POR_NIVEL[filtros.nivel] }),
  };

  const [filas, total] = await Promise.all([
    prisma.alertaDesvio.findMany({
      where,
      // El enum se ordena por declaración: CRITICA, ADVERTENCIA, INFORMATIVA.
      orderBy: [{ severidad: "asc" }, { created_at: "desc" }, { id: "asc" }],
      skip: (filtros.page - 1) * filtros.page_size,
      take: filtros.page_size,
      select: {
        id: true,
        indicador: true,
        referencia: true,
        severidad: true,
        estado: true,
        cantidad_actual: true,
        punto_pedido: true,
        porcentaje_egresos: true,
        umbral_aplicado: true,
        created_at: true,
        resuelta_at: true,
        variante_sku: { select: { sku: true } },
        deposito: { select: { nombre: true } },
      },
    }),
    prisma.alertaDesvio.count({ where }),
  ]);

  const alertas: FilaAlertaPanel[] = filas.map((fila) => {
    const snapshot = {
      indicador: fila.indicador,
      cantidad_actual: fila.cantidad_actual,
      punto_pedido: fila.punto_pedido,
      porcentaje_egresos: decimal(fila.porcentaje_egresos),
      umbral_aplicado: decimal(fila.umbral_aplicado),
    };
    const vigente = fila.estado === "ACTIVA" ? reevaluacion.valores_vigentes[fila.id] : undefined;
    const detalle = vigente
      ? detalleLegible(
          vigente.indicador === "STOCK_BAJO_PUNTO_PEDIDO"
            ? { ...snapshot, cantidad_actual: vigente.cantidad_actual, punto_pedido: vigente.punto_pedido }
            : { ...snapshot, porcentaje_egresos: vigente.porcentaje_egresos, umbral_aplicado: vigente.umbral_aplicado },
        )
      : detalleLegible(snapshot);
    return {
      id: fila.id,
      indicador: fila.indicador,
      indicador_etiqueta: ETIQUETA_INDICADOR[fila.indicador],
      referencia: referenciaLegible({
        indicador: fila.indicador,
        referencia: fila.referencia,
        sku: fila.variante_sku?.sku,
        deposito: fila.deposito?.nombre,
      }),
      severidad: fila.severidad,
      severidad_etiqueta: ETIQUETA_SEVERIDAD[fila.severidad],
      estado: fila.estado,
      estado_etiqueta: ETIQUETA_ESTADO[fila.estado],
      detalle,
      detalle_vigente: vigente !== undefined,
      desde: fila.created_at.toISOString(),
      desde_texto: formatearFechaHoraNegocio(fila.created_at),
      resuelta_at: fila.resuelta_at?.toISOString() ?? null,
      resuelta_texto: fila.resuelta_at ? formatearFechaHoraNegocio(fila.resuelta_at) : null,
    };
  });

  return {
    alertas,
    paginacion: {
      total,
      page: filtros.page,
      page_size: filtros.page_size,
      total_paginas: Math.max(1, Math.ceil(total / filtros.page_size)),
    },
    umbrales,
    fuente_egresos: fuenteEgresosDe(reevaluacion),
  };
}
