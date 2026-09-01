/**
 * @page OrdenesCompraPage
 * @route /compras/ordenes
 *
 * Listado de órdenes de compra (HU-H3, spec_modulo_H.md §2.4 / §2.5).
 * React Server Component: resuelve sesión + permiso, consulta el servicio
 * directamente (sin fetch HTTP) y delega los filtros interactivos a
 * `TablaOrdenesCompra` (Client Component sincronizado con la URL).
 *
 * Gate de acceso: `ordenes_compra:crear` (decisión para esta pantalla —
 * split Comprador/Supervisor de Compras se aplica en la tarea de permisos
 * finales, donde el rol Supervisor todavía debe crearse en el seed).
 */

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, PackagePlus, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarOrdenesCompra,
  listarProveedoresHomologados,
  PERMISO_CREAR_ORDEN_COMPRA,
} from "@/lib/services/proveedores/orden-compra.service";
import { FiltrosListadoOrdenesCompraSchema } from "@/lib/schemas/ordenes-compra.schema";
import { TablaOrdenesCompra } from "@/components/compras/TablaOrdenesCompra";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Órdenes de Compra — ERP SWAT",
  description: "Emisión y seguimiento de órdenes de compra a proveedores (Módulo H).",
};

async function OrdenesCompraData({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filtros = FiltrosListadoOrdenesCompraSchema.parse({
    estado: typeof searchParams.estado === "string" ? searchParams.estado : undefined,
    proveedor_id:
      typeof searchParams.proveedor_id === "string" ? searchParams.proveedor_id : undefined,
  });

  let ordenes;
  let proveedores;
  try {
    [ordenes, proveedores] = await Promise.all([
      listarOrdenesCompra(filtros),
      listarProveedoresHomologados(),
    ]);
  } catch (err) {
    console.error("[OrdenesCompraPage] Error al obtener el listado:", err);
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertDescription>
          No se pudo cargar el listado de órdenes. Verificá la conexión con la
          base de datos.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TablaOrdenesCompra
      ordenes={ordenes}
      proveedores={proveedores}
      filtrosIniciales={{
        estado: filtros.estado,
        proveedor_id: filtros.proveedor_id,
      }}
    />
  );
}

export default async function OrdenesCompraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(
    session.userId,
    PERMISO_CREAR_ORDEN_COMPRA,
  );
  if (!autorizado) redirect("/no-autorizado");

  const params = await searchParams;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header + CTA ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
              <ClipboardList className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                Órdenes de Compra
              </h1>
              <p className="text-sm text-muted-foreground">
                Emisión en borrador, seguimiento de estado y cancelación con
                baja lógica.
              </p>
            </div>
          </div>
          <div className="pl-12 sm:pl-0">
            <Link
              href="/compras/ordenes/nueva"
              className={`${buttonVariants()} bg-blue-600 hover:bg-blue-700 text-white gap-2`}
            >
              <PackagePlus className="size-4" aria-hidden="true" />
              Nueva orden de compra
            </Link>
          </div>
        </div>

        {/* ── Tabla en Card ──────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="size-4 text-blue-500" aria-hidden="true" />
              Órdenes emitidas
            </CardTitle>
            <CardDescription>
              Incluye las órdenes canceladas — la baja lógica preserva la fila
              para trazabilidad.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <Suspense
              key={`${params.estado ?? ""}::${params.proveedor_id ?? ""}`}
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Cargando órdenes…
                </div>
              }
            >
              <OrdenesCompraData searchParams={params} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
