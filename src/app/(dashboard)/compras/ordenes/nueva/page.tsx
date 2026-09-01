/**
 * @page NuevaOrdenCompraPage
 * @route /compras/ordenes/nueva
 *
 * Formulario de alta de una Orden de Compra en estado BORRADOR (HU-H3,
 * spec_modulo_H.md §2.4). RSC: resuelve sesión + permiso y precarga los
 * selectores (proveedores HOMOLOGADOS, variantes activas). El submit lo
 * maneja `FormularioNuevaOrdenCompra` contra la Server Action
 * `crearOrdenCompraAction`.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, PackagePlus, AlertTriangle } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarProveedoresHomologados,
  listarVariantesParaOrden,
  PERMISO_CREAR_ORDEN_COMPRA,
} from "@/lib/services/proveedores/orden-compra.service";
import { FormularioNuevaOrdenCompra } from "@/components/compras/FormularioNuevaOrdenCompra";

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
  title: "Nueva Orden de Compra — ERP SWAT",
  description: "Alta de una orden de compra en estado borrador (Módulo H).",
};

export default async function NuevaOrdenCompraPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(
    session.userId,
    PERMISO_CREAR_ORDEN_COMPRA,
  );
  if (!autorizado) redirect("/no-autorizado");

  let proveedores;
  let variantes;
  try {
    [proveedores, variantes] = await Promise.all([
      listarProveedoresHomologados(),
      listarVariantesParaOrden(),
    ]);
  } catch (err) {
    console.error("[NuevaOrdenCompraPage] Error al precargar selectores:", err);
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudieron cargar proveedores y variantes. Verificá la conexión
              con la base de datos.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <Link
          href="/compras/ordenes"
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al listado
        </Link>

        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <PackagePlus className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Nueva orden de compra
            </h1>
            <p className="text-sm text-muted-foreground">
              La orden se crea en estado BORRADOR. El precio unitario lo resuelve
              el sistema contra la lista vigente del proveedor.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-sm font-semibold">Datos de la orden</CardTitle>
            <CardDescription>
              Elegí el proveedor homologado y agregá las variantes con su cantidad.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <FormularioNuevaOrdenCompra
              proveedores={proveedores}
              variantes={variantes}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
