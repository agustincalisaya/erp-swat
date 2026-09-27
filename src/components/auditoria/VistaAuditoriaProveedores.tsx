import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ScrollText } from "lucide-react";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ConsultarAuditoriaProveedoresQuerySchema } from "@/app/api/proveedores/auditoria/route";
import {
  listarEventosDeDominioProveedores,
  resolverNombresUsuarios,
  resolverRazonesSocialesProveedores,
} from "@/lib/services/proveedores/auditoria-proveedores.service";
import { TablaAuditoriaProveedores } from "@/components/auditoria/TablaAuditoriaProveedores";
import { BotonVerificarCadena } from "@/components/auditoria/BotonVerificarCadena";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const PERMISO_LEER_HISTORICO = "auditoria:leer_historico";
const PERMISO_VERIFICAR_CADENA = "auditoria:verificar_cadena";

type Parametros = { [key: string]: string | string[] | undefined };

/**
 * @component VistaAuditoriaProveedores
 * @description Rama `?modulo=proveedores` de `/auditoria/logs` (HU-H6),
 * MISMO patrón que `VistaAuditoriaClientes.tsx` (HU-C10): gate exclusivo por
 * `auditoria:leer_historico` (COMPRADOR no lo tiene → `redirect`
 * a `/no-autorizado` si accede por URL directa, no solo se oculta del
 * menú). Reusa el query schema y el service YA implementados en HU-H6
 * (`GET /api/proveedores/auditoria`) — no se reimplementa el filtrado ni la
 * sanitización acá.
 */
export async function VistaAuditoriaProveedores({
  userId,
  rawParams,
}: {
  userId: string;
  rawParams: Parametros;
}) {
  const [puedeProveedores, puedeVerificar] = await Promise.all([
    usuarioTienePermiso(userId, PERMISO_LEER_HISTORICO),
    usuarioTienePermiso(userId, PERMISO_VERIFICAR_CADENA),
  ]);
  if (!puedeProveedores) redirect("/no-autorizado");

  const parsed = ConsultarAuditoriaProveedoresQuerySchema.safeParse(rawParams);

  let resultado = null;
  let nombresPorUsuarioId = new Map<string, string>();
  let razonesSocialesPorProveedorId = new Map<string, string>();
  if (parsed.success) {
    const { proveedor_id, tipo_evento, usuario_id, fecha_desde, fecha_hasta, pagina, por_pagina } = parsed.data;
    resultado = await listarEventosDeDominioProveedores(
      { proveedor_id, tipo_evento, usuario_id, fecha_desde, fecha_hasta },
      { pagina, por_pagina },
    );
    [nombresPorUsuarioId, razonesSocialesPorProveedorId] = await Promise.all([
      resolverNombresUsuarios(resultado.items.map((i) => i.usuario_id)),
      resolverRazonesSocialesProveedores(resultado.items.map((i) => i.proveedor_id)),
    ]);
  }

  const queryBase = new URLSearchParams({ modulo: "proveedores" });
  if (parsed.success) {
    const filtros = parsed.data;
    if (filtros.proveedor_id) queryBase.set("proveedor_id", filtros.proveedor_id);
    if (filtros.tipo_evento) queryBase.set("tipo_evento", filtros.tipo_evento);
    if (filtros.usuario_id) queryBase.set("usuario_id", filtros.usuario_id);
    if (filtros.fecha_desde) queryBase.set("fecha_desde", filtros.fecha_desde.toISOString().slice(0, 10));
    if (filtros.fecha_hasta) queryBase.set("fecha_hasta", filtros.fecha_hasta.toISOString().slice(0, 10));
    if (filtros.por_pagina !== 20) queryBase.set("por_pagina", String(filtros.por_pagina));
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-600">
              <ScrollText className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Auditoría Forense — Proveedores</h1>
              <p className="text-sm text-muted-foreground">
                Cambios de estado, variaciones críticas de precio y aprobaciones de lista de precios (Módulo H).
              </p>
            </div>
          </div>
          {puedeVerificar && <BotonVerificarCadena />}
        </div>

        <nav aria-label="Módulo de auditoría" className="flex gap-4 text-sm">
          <Link href="/auditoria/logs" className="text-blue-600 hover:underline">
            Historial general
          </Link>
          <span aria-current="page" className="font-semibold">
            Proveedores
          </span>
        </nav>

        {!parsed.success && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>Los filtros de Proveedores no son válidos. Revisá los valores ingresados.</AlertDescription>
          </Alert>
        )}

        {resultado && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Asientos de Proveedores</CardTitle>
            </CardHeader>
            <CardContent>
              <TablaAuditoriaProveedores
                resultado={resultado}
                nombresPorUsuarioId={nombresPorUsuarioId}
                razonesSocialesPorProveedorId={razonesSocialesPorProveedorId}
                queryBase={queryBase.toString()}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
