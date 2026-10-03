/**
 * @page ListaPreciosVentaPage
 * @route /ventas/lista-precios
 *
 * Lista de Precios de Venta versionada (HU-B9, spec_modulo_B.md §2.9).
 * RSC: resuelve sesión + permiso y arma la tabla consultando los servicios
 * directamente (sin fetch HTTP), mismo patrón que `/ventas/cuentas-corrientes`.
 * Gate de acceso: `ventas:gestionar_lista_precios` (exclusivo Supervisor de
 * Ventas), el mismo que exigen las rutas y las Server Actions.
 *
 * Carga de datos (task HU-B9 §6, decisiones del Paso 0 de frontend):
 *  - Variantes: `listarVariantesParaCotizacion()` (activas, con producto activo).
 *  - Precio vigente: `resolverPreciosVentaVigentes()` — una sola consulta.
 *  - Margen: `obtenerConfiguracion()` UNA vez (es el mismo para todas las
 *    variantes); si falta o es inválido, la pantalla sigue editable sin
 *    sugerencias (Alert global).
 *  - Costo: `obtenerCostoReposicionVigente()` por variante (HU-H8 no tiene
 *    versión batch), secuencial por el mismo motivo que la publicación: no
 *    saturar el pool de conexiones.
 *  - Sugerencia: `calcularPrecioSugerido()` (misma función pura que usa
 *    `obtenerSugerenciaPrecio`).
 *
 * Sin historial de versiones: no hay endpoint todavía (Punto abierto 4).
 */

import { redirect } from "next/navigation";
import { Tags, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { listarVariantesParaCotizacion } from "@/lib/services/ventas/presupuesto.service";
import {
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
  resolverPreciosVentaVigentes,
} from "@/lib/services/ventas/lista-precio-venta.service";
import { calcularPrecioSugerido } from "@/lib/services/ventas/lista-precio-venta.calculo";
import { obtenerCostoReposicionVigente } from "@/lib/services/proveedores/costo-reposicion.service";
import { obtenerConfiguracion } from "@/lib/services/sistema/configuracion.service";
import { diaNegocioIso } from "@/lib/utils/fecha-negocio";
import {
  parsearMargen,
  type FilaListaPrecioVenta,
} from "@/components/ventas/lista-precios-venta.calculo";
import { EditorListaPreciosVenta } from "@/components/ventas/EditorListaPreciosVenta";

import { Alert, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lista de precios de venta — ERP SWAT",
  description: "Publicación de versiones de la Lista de Precios de Venta única (Módulo B).",
};

/** Margen de `ConfiguracionSistema`, o el mensaje a mostrar si no se puede usar. */
async function cargarMargen(): Promise<{ margen: number } | { error: string }> {
  try {
    const { valor } = await obtenerConfiguracion("VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA");
    const margen = parsearMargen(valor);
    if (margen === null) {
      return {
        error: `El margen sugerido configurado (VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA = "${valor}") no es un número no negativo.`,
      };
    }
    return { margen };
  } catch (err) {
    if (err instanceof ServiceError && err.code === "CONFIGURACION_NO_ENCONTRADA") {
      return { error: "Falta configurar el margen sugerido (VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA)." };
    }
    throw err;
  }
}

async function cargarFilas(): Promise<{ filas: FilaListaPrecioVenta[]; errorMargen: string | null }> {
  const variantes = await listarVariantesParaCotizacion();
  const [precios, margenResultado] = await Promise.all([
    resolverPreciosVentaVigentes(variantes.map((v) => v.id)),
    cargarMargen(),
  ]);
  const margen = "margen" in margenResultado ? margenResultado.margen : null;

  const filas: FilaListaPrecioVenta[] = [];
  for (const variante of variantes) {
    const costo = (await obtenerCostoReposicionVigente(variante.id))?.precio_unitario ?? null;
    filas.push({
      variante_sku_id: variante.id,
      sku: variante.sku,
      descripcion: variante.descripcion,
      precio_vigente: precios.get(variante.id)?.precio_venta.toNumber() ?? null,
      costo_reposicion: costo,
      precio_sugerido: margen === null ? null : calcularPrecioSugerido(costo, margen),
    });
  }

  return { filas, errorMargen: "error" in margenResultado ? margenResultado.error : null };
}

export default async function ListaPreciosVentaPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeGestionar = await usuarioTienePermiso(
    session.userId,
    PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
  );
  if (!puedeGestionar) redirect("/no-autorizado");

  let datos: Awaited<ReturnType<typeof cargarFilas>> | null = null;
  try {
    datos = await cargarFilas();
  } catch (err) {
    console.error("[ListaPreciosVentaPage] Error al cargar la lista de precios:", err);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Tags className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Lista de precios de venta
            </h1>
            <p className="text-sm text-muted-foreground">
              Precio único para mostrador y e-commerce. Cada publicación crea una versión nueva;
              nunca se modifica la vigente.
            </p>
          </div>
        </div>

        {!datos ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudo cargar la lista de precios. Verificá la conexión con la base de datos.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {datos.errorMargen && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertDescription>
                  {datos.errorMargen} Podés cargar precios igual, pero no se muestran sugerencias.
                </AlertDescription>
              </Alert>
            )}
            <EditorListaPreciosVenta filas={datos.filas} hoy={diaNegocioIso()} />
          </>
        )}
      </div>
    </main>
  );
}
