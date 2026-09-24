import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ScrollText } from "lucide-react";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { FiltrosAuditoriaClientesSchema } from "@/lib/schemas/auditoria-clientes.schema";
import {
  listarAuditoriaClientes,
  listarResponsablesAuditoriaClientes,
  PERMISO_LEER_AUDITORIA_CLIENTES,
} from "@/lib/services/clientes/auditoria-clientes.service";
import { FiltrosAuditoriaClientes } from "@/components/auditoria/FiltrosAuditoriaClientes";
import { TablaAuditoriaClientes } from "@/components/auditoria/TablaAuditoriaClientes";
import { BotonVerificarCadena } from "@/components/auditoria/BotonVerificarCadena";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type Parametros = { [key: string]: string | string[] | undefined };

export async function VistaAuditoriaClientes({ userId, rawParams }: { userId: string; rawParams: Parametros }) {
  const [puedeClientes, puedeVerificar] = await Promise.all([
    usuarioTienePermiso(userId, PERMISO_LEER_AUDITORIA_CLIENTES),
    usuarioTienePermiso(userId, "auditoria:verificar_cadena"),
  ]);
  if (!puedeClientes) redirect("/no-autorizado");

  const parsed = FiltrosAuditoriaClientesSchema.safeParse(rawParams);
  const [resultado, responsables] = await Promise.all([
    parsed.success ? listarAuditoriaClientes(parsed.data, userId) : Promise.resolve(null),
    listarResponsablesAuditoriaClientes(userId),
  ]);
  const queryBase = new URLSearchParams({ modulo: "clientes" });
  if (parsed.success) {
    const filtros = parsed.data;
    if (filtros.cliente_nombre) queryBase.set("cliente_nombre", filtros.cliente_nombre);
    if (filtros.usuario_id) queryBase.set("usuario_id", filtros.usuario_id);
    if (filtros.accion) queryBase.set("accion", filtros.accion);
    if (filtros.fecha_desde) queryBase.set("fecha_desde", filtros.fecha_desde.toISOString().slice(0, 10));
    if (filtros.fecha_hasta) queryBase.set("fecha_hasta", filtros.fecha_hasta.toISOString().slice(0, 10));
    if (filtros.page_size !== 25) queryBase.set("page_size", String(filtros.page_size));
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600"><ScrollText className="size-5" aria-hidden="true" /></div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Auditoría Forense — Clientes</h1>
              <p className="text-sm text-muted-foreground">Altas, modificaciones y bajas lógicas registradas sobre clientes.</p>
            </div>
          </div>
          {puedeVerificar && <BotonVerificarCadena />}
        </div>
        <nav aria-label="Módulo de auditoría" className="flex gap-4 text-sm">
          <Link href="/auditoria/logs" className="text-blue-600 hover:underline">Historial general</Link>
          <span aria-current="page" className="font-semibold">Clientes</span>
        </nav>
        <Suspense fallback={null}><FiltrosAuditoriaClientes responsables={responsables} /></Suspense>
        {!parsed.success && <Alert variant="destructive"><AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription>Los filtros de Clientes no son válidos. Revisá los valores ingresados.</AlertDescription>
        </Alert>}
        {resultado && <Card>
          <CardHeader><CardTitle className="text-sm">Asientos de Clientes</CardTitle></CardHeader>
          <CardContent><TablaAuditoriaClientes resultado={resultado} queryBase={queryBase.toString()} /></CardContent>
        </Card>}
      </div>
    </main>
  );
}
