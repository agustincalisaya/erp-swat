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
import { PERMISO_LEER_ORDEN_COMPRA } from "@/lib/services/proveedores/orden-compra.service";
import { FormularioRecepcionMercaderia } from "@/components/compras/FormularioRecepcionMercaderia";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// C1 (auditoría transversal Módulo H, 2026-09-26): esta página no exportaba
// `metadata`, así que la pestaña mostraba el título por defecto de Next
// ("Create Next App"). Título estático, mismo patrón que
// `compras/ordenes/page.tsx`.
export const metadata = {
  title: "Recepción de Mercadería — ERP SWAT",
  description: "Registro de recepción física de mercadería contra una orden de compra confirmada (Módulo H).",
};

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

  const [depositos, proveedores, puedeVerOrdenes] = await Promise.all([
    listarDepositosParaRecepcion(),
    listarProveedoresConOrdenesRecepcionables(),
    usuarioTienePermiso(session.userId, PERMISO_LEER_ORDEN_COMPRA),
  ]);

  // C5 (auditoría transversal Módulo H, 2026-09-26): "Volver a órdenes"
  // apuntaba siempre a `/compras/ordenes`, pero el Encargado de Depósito
  // (único rol operativo de esta pantalla junto con el Administrador) no
  // tiene `ordenes_compra:leer` y esa pantalla lo rechaza. Sin
  // `ordenes_compra:leer`, el link va a Movimientos de Inventario
  // (`/inventario/movimientos`, accesible al Encargado de Depósito vía
  // `usuarioPuedeRegistrarIngresoStock` — mismo rol autorizado que acá).

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link
          href={puedeVerOrdenes ? "/compras/ordenes" : "/inventario/movimientos"}
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {puedeVerOrdenes ? "Volver a órdenes" : "Volver a movimientos de inventario"}
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

