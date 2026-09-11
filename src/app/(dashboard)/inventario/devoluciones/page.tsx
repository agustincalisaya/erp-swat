/**
 * @page DevolucionesPage
 * @route /inventario/devoluciones
 *
 * HU-A9 — Reclasificación de unidades DEVUELTO (spec_modulo_A.md §2.8/§3.8).
 * Server Component: aplica RBAC antes de renderizar (reclasificar exige
 * `inventario:reclasificar`; la sección de solicitudes pendientes solo se
 * muestra a quien tiene `inventario:reclasificar_aprobar` — Administrador).
 *
 * Lista las unidades en estado DEVUELTO (con variante y depósito resueltos)
 * y, para Admin, las solicitudes sobre el umbral pendientes de aprobación.
 * La interacción vive en componentes client (`ModalReclasificacion`,
 * `SolicitudesPendientesPanel`) que invocan Server Actions. Paleta blue.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Undo2, PackageX } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarSolicitudesPendientes,
  listarUnidadesDevueltas,
  type UnidadDevueltaListado,
} from "@/lib/services/inventario/reclasificacion.service";

import { ModalReclasificacion } from "@/components/inventario/ModalReclasificacion";
import { SolicitudesPendientesPanel } from "@/components/inventario/SolicitudesPendientesPanel";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Devoluciones — ERP SWAT",
  description: "Reclasificación de unidades devueltas (HU-A9).",
};

function formatearFecha(iso: Date): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function UnidadesDevueltasTable({
  unidades,
}: {
  unidades: UnidadDevueltaListado[];
}) {
  if (unidades.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/50 p-8 text-center">
        <PackageX className="mx-auto size-8 text-blue-300" aria-hidden="true" />
        <p className="mt-2 text-sm text-blue-700/80">
          No hay unidades en estado DEVUELTO para reclasificar.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-blue-50 text-xs uppercase tracking-wide text-blue-800">
          <tr>
            <th className="px-4 py-3 font-semibold">SKU / Producto</th>
            <th className="px-4 py-3 font-semibold">Cantidad</th>
            <th className="px-4 py-3 font-semibold">Depósito</th>
            <th className="px-4 py-3 font-semibold">Devuelta el</th>
            <th className="px-4 py-3 text-right font-semibold">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {unidades.map((unidad) => (
            <tr key={unidad.id} className="hover:bg-blue-50/40">
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{unidad.sku}</p>
                <p className="text-xs text-gray-600">{unidad.producto_nombre}</p>
              </td>
              <td className="px-4 py-3 text-gray-700">{unidad.cantidad}</td>
              <td className="px-4 py-3 text-gray-700">
                {unidad.deposito_id ? unidad.deposito_id.slice(0, 8) : "—"}
              </td>
              <td className="px-4 py-3 text-gray-700">{formatearFecha(unidad.created_at)}</td>
              <td className="px-4 py-3 text-right">
                <ModalReclasificacion
                  unidad={{
                    id: unidad.id,
                    variante_sku_id: unidad.variante_sku_id,
                    deposito_id: unidad.deposito_id,
                    sku: unidad.sku,
                    producto_nombre: unidad.producto_nombre,
                    cantidad: unidad.cantidad,
                    created_at: unidad.created_at.toISOString(),
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DevolucionesPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  const [puedeReclasificar, puedeAprobar] = await Promise.all([
    usuarioTienePermiso(session.userId, "inventario:reclasificar"),
    usuarioTienePermiso(session.userId, "inventario:reclasificar_aprobar"),
  ]);

  if (!puedeReclasificar) {
    redirect("/no-autorizado");
  }

  const [unidades, solicitudes] = await Promise.all([
    listarUnidadesDevueltas(),
    puedeAprobar ? listarSolicitudesPendientes() : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-blue-900">Devoluciones</h1>
          <p className="text-sm text-gray-600">
            Reclasificación de unidades devueltas: APTO reincorpora al stock, NO_APTO
            da de baja con motivo obligatorio. Sobre el umbral se requiere aprobación.
          </p>
        </div>
        <Link href="/inventario">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
          >
            <Undo2 className="size-3.5" />
            Volver a Inventario
          </Button>
        </Link>
      </div>

      <UnidadesDevueltasTable unidades={unidades} />

      {puedeAprobar && <SolicitudesPendientesPanel solicitudes={solicitudes} />}
    </main>
  );
}