import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarDepositosParaRecepcion,
  listarOrdenesRecepcionables,
  PERMISO_REGISTRAR_RECEPCION,
} from "@/lib/services/proveedores/recepcion.service";
import { FormularioRecepcionMercaderia } from "@/components/compras/FormularioRecepcionMercaderia";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function NuevaRecepcionPage({
  searchParams,
}: {
  searchParams: Promise<{ orden_compra_id?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_REGISTRAR_RECEPCION))) {
    redirect("/no-autorizado");
  }

  const [{ orden_compra_id }, ordenes, depositos] = await Promise.all([
    searchParams,
    listarOrdenesRecepcionables(),
    listarDepositosParaRecepcion(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link href="/compras/ordenes" className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}>
          <ArrowLeft className="size-4" aria-hidden="true" /> Volver a órdenes
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Recepción de mercadería</CardTitle>
            <CardDescription>Registrá una recepción física parcial o completa contra una orden confirmada.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioRecepcionMercaderia ordenes={ordenes} depositos={depositos} ordenInicialId={orden_compra_id} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

