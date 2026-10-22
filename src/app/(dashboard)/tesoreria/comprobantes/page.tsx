/**
 * @page ComprobantesFiscalesPage
 * @route /tesoreria/comprobantes
 *
 * HU-G3 (spec_modulo_G.md §9.5) — repositorio digital de comprobantes
 * fiscales de mostrador y de la tienda web. React Server Component: resuelve
 * sesión + permiso, consulta el servicio directamente (sin fetch HTTP) y
 * delega filtros (`FiltrosComprobantes`) y tabla (`TablaComprobantes`). Solo
 * lectura: no se pueden modificar ni eliminar comprobantes (G3-5).
 *
 * Gate de acceso: `tesoreria:leer_comprobantes` (redirect a `/no-autorizado`),
 * mismo patrón que `/tesoreria/cuentas-por-pagar`. El Gerente no lo tiene.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AlertTriangle, Receipt } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { FiltrosComprobantesSchema } from "@/lib/schemas/comprobantes-repositorio.schema";
import {
  listarComprobantes,
  PERMISO_LEER_COMPROBANTES,
  type ListadoComprobantes,
} from "@/lib/services/tesoreria/comprobantes-repositorio.service";
import { FiltrosComprobantes } from "@/components/tesoreria/FiltrosComprobantes";
import { TablaComprobantes } from "@/components/tesoreria/TablaComprobantes";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Comprobantes fiscales — ERP SWAT",
  description: "Repositorio de comprobantes fiscales de mostrador y de la tienda web.",
};

interface ComprobantesPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const CLAVES_FILTRO = ["cliente", "fecha_desde", "fecha_hasta", "tipo", "canal"] as const;

export default async function ComprobantesFiscalesPage({ searchParams }: ComprobantesPageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_LEER_COMPROBANTES);
  if (!autorizado) redirect("/no-autorizado");

  const rawParams = await searchParams;
  const parsed = FiltrosComprobantesSchema.safeParse(rawParams);
  const filtros = parsed.success ? parsed.data : FiltrosComprobantesSchema.parse({});

  let error: string | null = parsed.success ? null : (parsed.error.issues[0]?.message ?? "Los filtros no son válidos");
  let resultado: ListadoComprobantes = { registros: [], total: 0, page: filtros.page, page_size: filtros.page_size };
  if (!error) {
    try {
      resultado = await listarComprobantes(filtros);
    } catch (err) {
      if (!(err instanceof ServiceError)) console.error("[ComprobantesFiscalesPage] Error al listar comprobantes:", err);
      error = err instanceof ServiceError ? err.message : "No se pudieron cargar los comprobantes. Intentá nuevamente.";
    }
  }

  const queryBase = new URLSearchParams();
  for (const clave of CLAVES_FILTRO) {
    const valor = filtros[clave];
    if (valor) queryBase.set(clave, valor);
  }

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-selected text-selected-foreground shrink-0">
            <Receipt className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Comprobantes fiscales</h1>
            <p className="text-sm text-muted-foreground">
              Repositorio de los comprobantes de mostrador y de la tienda web. No se pueden modificar ni eliminar.
            </p>
          </div>
        </div>

        <Suspense fallback={null}>
          <FiltrosComprobantes />
        </Suspense>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Receipt className="size-4 text-primary" aria-hidden="true" />
              Comprobantes emitidos
            </CardTitle>
            <CardDescription>
              {resultado.total} comprobante{resultado.total === 1 ? "" : "s"}, del más reciente al más antiguo. Fechas en hora de Argentina.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <TablaComprobantes resultado={resultado} queryBase={queryBase.toString()} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
