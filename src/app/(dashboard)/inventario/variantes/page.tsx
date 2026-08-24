/**
 * @page VariantesPage
 * @route /inventario/variantes
 * @description HU-A6 — Listado mínimo de variantes activas con baja lógica
 * (Soft Delete). Server Component: calcula `stockTotal` por variante
 * (suma de `StockDeposito.cantidad` activos) y muestra el botón "Dar de
 * baja" solo si el usuario autenticado tiene un rol activo autorizado
 * (`usuarioPuedeBajarVariante()`); el modal de justificación se exige
 * únicamente cuando hay stock remanente (R3). Sin CRUD completo — solo lo
 * necesario para la baja.
 */
import { Boxes, AlertTriangle } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  usuarioPuedeBajarVariante,
} from "@/lib/services/inventario/variante.service";
import { ModalJustificacionBaja } from "@/components/inventario/ModalJustificacionBaja";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata = {
  title: "Variantes — ERP SWAT",
  description: "Listado de variantes de producto con baja lógica.",
};

interface VarianteListada {
  id: string;
  sku: string;
  talle: string;
  color: string;
  genero: string;
  producto: string;
  stockTotal: number;
}

async function obtenerVariantesActivas(): Promise<VarianteListada[]> {
  const variantes = await prisma.varianteSKU.findMany({
    where: { is_active: true },
    orderBy: { sku: "asc" },
    select: {
      id: true,
      sku: true,
      talle: true,
      color: true,
      genero: true,
      producto_maestro: { select: { nombre: true } },
      stock_depositos: {
        where: { is_active: true },
        select: { cantidad: true },
      },
    },
  });

  return variantes.map((v) => ({
    id: v.id,
    sku: v.sku,
    talle: v.talle,
    color: v.color,
    genero: v.genero,
    producto: v.producto_maestro.nombre,
    stockTotal: v.stock_depositos.reduce((acumulado, stock) => acumulado + stock.cantidad, 0),
  }));
}

export default async function VariantesPage() {
  const session = await getServerSession();
  const puedeBajar = session ? await usuarioPuedeBajarVariante(session.userId) : false;

  let variantes: VarianteListada[] = [];
  let errorCarga: string | null = null;
  try {
    variantes = await obtenerVariantesActivas();
  } catch (err) {
    console.error("[VariantesPage] Error al obtener variantes:", err);
    errorCarga = "No se pudieron cargar las variantes. Verificá la conexión con la base de datos.";
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Boxes className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Variantes</h1>
            <p className="text-sm text-muted-foreground">
              Variantes activas y baja lógica con motivo de justificación.
            </p>
          </div>
        </div>

        {errorCarga ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{errorCarga}</AlertDescription>
          </Alert>
        ) : variantes.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">
            No hay variantes activas.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-blue-50 text-xs uppercase tracking-wide text-blue-900">
                <tr>
                  <th className="px-4 py-3 font-semibold">SKU</th>
                  <th className="px-4 py-3 font-semibold">Producto</th>
                  <th className="px-4 py-3 font-semibold">Talle / Color / Género</th>
                  <th className="px-4 py-3 text-right font-semibold">Stock</th>
                  {puedeBajar && (
                    <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {variantes.map((v) => (
                  <tr key={v.id} className="hover:bg-blue-50/40">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{v.sku}</td>
                    <td className="px-4 py-3 text-gray-900">{v.producto}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {v.talle} / {v.color} / {v.genero}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          v.stockTotal > 0
                            ? "inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
                            : "inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600"
                        }
                      >
                        {v.stockTotal}
                      </span>
                    </td>
                    {puedeBajar && (
                      <td className="px-4 py-3 text-right">
                        <ModalJustificacionBaja
                          varianteId={v.id}
                          sku={v.sku}
                          stockTotal={v.stockTotal}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}