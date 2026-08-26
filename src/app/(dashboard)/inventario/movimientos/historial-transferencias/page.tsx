import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { FiltrosHistorialTransferenciasSchema } from "@/lib/schemas/inventario.schema";
import { listarTransferenciasRecibidas } from "@/lib/services/inventario/transferencia.service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FiltrosHistorialTransferencias } from "@/components/inventario/FiltrosHistorialTransferencias";
import { HistorialTransferencias } from "@/components/inventario/HistorialTransferencias";

export const metadata = {
  title: "Historial de Transferencias — ERP SWAT",
  description: "Consulta de transferencias de inventario recibidas.",
};

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function valorSimple(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function HistorialTransferenciasPage({ searchParams }: Props) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [puedeTransferir, puedeConfirmar] = await Promise.all([
    usuarioTienePermiso(session.userId, "inventario:transferir_stock"),
    usuarioTienePermiso(session.userId, "inventario:confirmar_recepcion"),
  ]);
  if (!puedeTransferir && !puedeConfirmar) redirect("/no-autorizado");

  const raw = await searchParams;
  const parsed = FiltrosHistorialTransferenciasSchema.safeParse({
    remito: valorSimple(raw.remito),
    desde: valorSimple(raw.desde),
    hasta: valorSimple(raw.hasta),
    page: valorSimple(raw.page),
  });
  const filtros = parsed.success
    ? parsed.data
    : FiltrosHistorialTransferenciasSchema.parse({});

  let resultado;
  let errorConsulta = false;
  try {
    resultado = await listarTransferenciasRecibidas(filtros);
  } catch (error) {
    console.error("[HistorialTransferenciasPage] Error al listar transferencias:", error);
    errorConsulta = true;
    resultado = { registros: [], total: 0, page: filtros.page, page_size: 10 };
  }

  const query = new URLSearchParams();
  if (filtros.remito) query.set("remito", filtros.remito);
  if (filtros.desde) query.set("desde", filtros.desde);
  if (filtros.hasta) query.set("hasta", filtros.hasta);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-xl bg-blue-100 p-2 text-blue-600"><History className="size-5" aria-hidden="true" /></div>
            <div><h1 className="text-xl font-bold tracking-tight text-gray-900">Historial de Transferencias</h1><p className="text-sm text-muted-foreground">Transferencias recibidas entre depósitos.</p></div>
          </div>
          <Link href="/inventario/movimientos" className={buttonVariants({ variant: "outline" })}><ArrowLeft className="size-4" /> Volver a movimientos</Link>
        </div>

        {!parsed.success && <Alert variant="destructive"><AlertDescription>Los filtros indicados no son válidos. Se muestra el historial sin filtros.</AlertDescription></Alert>}
        {errorConsulta && <Alert variant="destructive"><AlertDescription>No se pudo cargar el historial de transferencias.</AlertDescription></Alert>}

        <FiltrosHistorialTransferencias remitoInicial={filtros.remito} desdeInicial={filtros.desde} hastaInicial={filtros.hasta} />
        <Card>
          <CardHeader><CardTitle>Transferencias recibidas</CardTitle><CardDescription>Remitos cuya recepción ya fue confirmada y cuyo stock está disponible en destino.</CardDescription></CardHeader>
          <CardContent>
            <HistorialTransferencias resultado={resultado} queryBase={query.toString()} hayFiltros={Boolean(filtros.remito || filtros.desde || filtros.hasta)} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
