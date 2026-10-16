/**
 * HU-D6 (Módulo D) — Presentación del panel de alertas (task_relos.md D12,
 * D19, criterio 5). Módulo puro (runner nativo de Node, imports relativos con
 * `.ts`): etiquetas en lenguaje de negocio, referencia legible sin UUID,
 * normalización de los filtros de la URL, armado de los enlaces de las
 * pestañas y la decisión de acceso de la página (con el permiso inyectado).
 */
import {
  FiltrosPanelAlertasSchema,
  type FiltrosPanelAlertas,
} from "../../schemas/alertas-desvio.schema.ts";
import {
  formatearDetalleAlerta,
  parsearReferenciaEgresos,
  type EstadoAlerta,
  type IndicadorAlerta,
  type SeveridadAlerta,
} from "./alerta-desvio.reglas.ts";

// ── Etiquetas ─────────────────────────────────────────────────────────────────

export const ETIQUETA_SEVERIDAD: Record<SeveridadAlerta, string> = {
  CRITICA: "Crítica",
  ADVERTENCIA: "Advertencia",
  INFORMATIVA: "Informativa",
};

export const ETIQUETA_INDICADOR: Record<IndicadorAlerta, string> = {
  STOCK_BAJO_PUNTO_PEDIDO: "Stock bajo el punto de pedido",
  EGRESOS_SOBRE_INGRESOS: "Egresos sobre ingresos",
};

export const ETIQUETA_ESTADO: Record<EstadoAlerta, string> = {
  ACTIVA: "Activa",
  RESUELTA: "Resuelta",
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/** `AAAA-MM` → «octubre 2026»; una referencia inválida se devuelve tal cual. */
export function etiquetaMes(referencia: string): string {
  const periodo = parsearReferenciaEgresos(referencia);
  return periodo ? `${MESES[periodo.mes - 1]} ${periodo.anio}` : referencia;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Referencia para la tabla, nunca con UUID: egresos «Octubre 2026»; stock
 * «SKU · Depósito» (si faltan los datos, un texto genérico).
 */
export function referenciaLegible(alerta: {
  indicador: IndicadorAlerta;
  referencia: string;
  sku?: string | null;
  deposito?: string | null;
}): string {
  if (alerta.indicador === "EGRESOS_SOBRE_INGRESOS") {
    return parsearReferenciaEgresos(alerta.referencia) ? capitalizar(etiquetaMes(alerta.referencia)) : "Mes no identificado";
  }
  return alerta.sku && alerta.deposito ? `${alerta.sku} · ${alerta.deposito}` : "Variante o depósito no disponible";
}

/** Detalle «Stock 0 (punto de pedido 5)» o «78,4% (umbral 70%)»; sin datos, «Sin detalle». */
export function detalleLegible(alerta: {
  indicador: IndicadorAlerta;
  cantidad_actual: number | null;
  punto_pedido: number | null;
  porcentaje_egresos: number | null;
  umbral_aplicado: number | null;
}): string {
  if (alerta.indicador === "STOCK_BAJO_PUNTO_PEDIDO") {
    return alerta.cantidad_actual === null || alerta.punto_pedido === null
      ? "Sin detalle"
      : formatearDetalleAlerta({
          indicador: alerta.indicador,
          cantidad_actual: alerta.cantidad_actual,
          punto_pedido: alerta.punto_pedido,
        });
  }
  return formatearDetalleAlerta({
    indicador: alerta.indicador,
    porcentaje_egresos: alerta.porcentaje_egresos,
    umbral_aplicado: alerta.umbral_aplicado,
  });
}

// ── Estado del mes en curso (criterio 5) ──────────────────────────────────────

export type EstadoFuenteEgresos =
  | { estado: "CALCULABLE"; referencia: string; porcentaje: number }
  | { estado: "NO_CALCULABLE"; referencia: string }
  | { estado: "NO_DISPONIBLE"; referencia: string };

/** Línea de estado del mes en curso que muestra el panel aunque no haya alerta. */
export function textoEstadoMes(fuente: EstadoFuenteEgresos): string {
  const mes = etiquetaMes(fuente.referencia);
  if (fuente.estado === "CALCULABLE") {
    const valor = formatearDetalleAlerta({
      indicador: "EGRESOS_SOBRE_INGRESOS",
      porcentaje_egresos: fuente.porcentaje,
      umbral_aplicado: null,
    });
    return `Egresos sobre ingresos de ${mes}: ${valor}`;
  }
  if (fuente.estado === "NO_CALCULABLE") {
    return `Egresos sobre ingresos de ${mes}: No calculable (los ingresos del mes son cero o negativos)`;
  }
  return `No se pudo calcular el porcentaje de egresos de ${mes}: la fuente del reporte mensual no está disponible. Se muestran los últimos valores guardados.`;
}

// ── Filtros de la URL ─────────────────────────────────────────────────────────

type ParametrosUrl = Record<string, string | string[] | undefined>;

const primero = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

/**
 * Filtros de la PÁGINA a partir de la URL: tolerante, cada parámetro inválido
 * cae en su valor por defecto (la API, en cambio, responde 400).
 */
export function normalizarFiltrosPanel(parametros: ParametrosUrl): FiltrosPanelAlertas {
  const base = FiltrosPanelAlertasSchema.parse({});
  const campo = <K extends keyof FiltrosPanelAlertas>(clave: K): FiltrosPanelAlertas[K] => {
    const crudo = primero(parametros[clave]);
    if (crudo === undefined || crudo === "") return base[clave];
    const intento = FiltrosPanelAlertasSchema.safeParse({ [clave]: crudo });
    return intento.success ? intento.data[clave] : base[clave];
  };
  return { estado: campo("estado"), nivel: campo("nivel"), page: campo("page"), page_size: base.page_size };
}

/**
 * Enlace del panel con los filtros dados. Omite los valores por defecto y
 * vuelve a la página 1 salvo que se pida otra explícitamente.
 */
export function hrefPanel(
  filtros: Pick<FiltrosPanelAlertas, "estado" | "nivel">,
  /** `nivel: null` quita el filtro de nivel. */
  cambios: Partial<Pick<FiltrosPanelAlertas, "estado" | "page">> & { nivel?: FiltrosPanelAlertas["nivel"] | null } = {},
): string {
  const estado = cambios.estado ?? filtros.estado;
  const nivel = cambios.nivel === null ? undefined : (cambios.nivel ?? filtros.nivel);
  const params = new URLSearchParams();
  if (estado !== "activas") params.set("estado", estado);
  if (nivel) params.set("nivel", nivel);
  if (cambios.page && cambios.page > 1) params.set("page", String(cambios.page));
  const query = params.toString();
  return query ? `/tesoreria/alertas?${query}` : "/tesoreria/alertas";
}

// ── Acceso a la página ────────────────────────────────────────────────────────

export const PERMISO_ALERTAS_LEER = "alertas:leer";
export const PERMISO_CONFIGURACION_ADMINISTRAR = "configuracion:administrar";

export type AccesoPanelAlertas =
  | { tipo: "LOGIN" }
  | { tipo: "NO_AUTORIZADO" }
  | { tipo: "PERMITIDO"; puedeEditarUmbrales: boolean };

/**
 * Sin sesión → `/login`; sin `alertas:leer` → `/no-autorizado`; con el
 * permiso, el formulario editable de umbrales solo con `configuracion:administrar`.
 */
export async function resolverAccesoPanelAlertas(
  sesion: { userId: string } | null,
  tienePermiso: (usuarioId: string, codigo: string) => Promise<boolean>,
): Promise<AccesoPanelAlertas> {
  if (!sesion) return { tipo: "LOGIN" };
  if (!(await tienePermiso(sesion.userId, PERMISO_ALERTAS_LEER))) return { tipo: "NO_AUTORIZADO" };
  return { tipo: "PERMITIDO", puedeEditarUmbrales: await tienePermiso(sesion.userId, PERMISO_CONFIGURACION_ADMINISTRAR) };
}
