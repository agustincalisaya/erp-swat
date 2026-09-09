import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { FiltrosOrdenesRecepcionablesSchema } from "@/lib/schemas/recepciones.schema";
import { construirQueryRecepciones } from "@/lib/services/proveedores/recepcion-reglas";
import {
  listarDepositosParaRecepcion,
  listarOrdenesRecepcionables,
  listarProveedoresConOrdenesRecepcionables,
  PERMISO_REGISTRAR_RECEPCION,
} from "@/lib/services/proveedores/recepcion.service";
import { FormularioRecepcionMercaderia } from "@/components/compras/FormularioRecepcionMercaderia";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function NuevaRecepcionPage({
  searchParams,
}: {
  searchParams: Promise<{
    orden_compra_id?: string | string[];
    proveedor_id?: string | string[];
    fecha_emision?: string | string[];
    page?: string | string[];
  }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_REGISTRAR_RECEPCION))) {
    redirect("/no-autorizado");
  }

  const params = await searchParams;
  const valorUnico = (valor: string | string[] | undefined) => (
    Array.isArray(valor) ? valor[0] : valor
  );
  const ordenCompraId = valorUnico(params.orden_compra_id);
  const filtros = FiltrosOrdenesRecepcionablesSchema.parse({
    proveedorId: valorUnico(params.proveedor_id),
    fechaEmision: valorUnico(params.fecha_emision),
    page: valorUnico(params.page),
  });

  const listado = await listarOrdenesRecepcionables({ ...filtros, limit: 10 });
  if (listado.page !== filtros.page) {
    const query = construirQueryRecepciones({
      proveedorId: filtros.proveedorId,
      fechaEmision: filtros.fechaEmision,
      page: listado.page,
      ordenCompraId,
    });
    redirect(`/compras/recepciones/nueva${query ? `?${query}` : ""}`);
  }

  const [depositos, proveedores] = await Promise.all([
    listarDepositosParaRecepcion(),
    listarProveedoresConOrdenesRecepcionables(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link href="/compras/ordenes" className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}>
          <ArrowLeft className="size-4" aria-hidden="true" /> Volver a órdenes
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Recepción de mercadería</CardTitle>
            <CardDescription>
              Seleccioná una orden confirmada, revisá sus materiales y elegí el depósito destino.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioRecepcionMercaderia
              key={`${filtros.proveedorId ?? "todos"}-${filtros.fechaEmision ?? "todas"}-${listado.page}`}
              ordenes={listado.ordenes}
              depositos={depositos}
              proveedores={proveedores}
              proveedorSeleccionado={filtros.proveedorId}
              fechaSeleccionada={filtros.fechaEmision}
              page={listado.page}
              totalPages={listado.totalPages}
              ordenInicialId={ordenCompraId}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

