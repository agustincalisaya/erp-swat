/**
 * @page CuentasPorPagarPage
 * @route /tesoreria/cuentas-por-pagar
 *
 * Consola de Tesorería (HU-G10, spec_modulo_G.md §2.4 / §2.5). React Server
 * Component: resuelve sesión + permiso, consulta el servicio directamente
 * (sin fetch HTTP) y delega la grilla interactiva a `ListaCuentasPorPagar`
 * (Client Component). Lista únicamente cuentas en estado `DEFINITIVA`
 * (pendientes de pago); al registrarse el pago la cuenta pasa a `PAGADA` y
 * sale de este listado.
 *
 * Gate de acceso: `cuentas_por_pagar:leer` (redirect a `/no-autorizado`).
 * La acción "Registrar pago" requiere además `cuentas_por_pagar:pagar` — se
 * resuelve acá para no ofrecer el botón a quien no puede usarlo (el servidor
 * vuelve a validar el permiso en la Server Action).
 */

import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { FiltrosListadoCuentasPorPagarSchema } from "@/lib/schemas/cuentas-por-pagar.schema";
import {
  listarCuentasPorPagar,
  PERMISO_LEER_CUENTAS_POR_PAGAR,
  PERMISO_PAGAR_CUENTA_POR_PAGAR,
} from "@/lib/services/tesoreria/cuenta-por-pagar.service";
import { ListaCuentasPorPagar } from "@/components/tesoreria/ListaCuentasPorPagar";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cuentas por Pagar — ERP SWAT",
  description:
    "Consola de Tesorería: registro de pago de cuentas por pagar definitivas (Módulo G).",
};

export default async function CuentasPorPagarPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(
    session.userId,
    PERMISO_LEER_CUENTAS_POR_PAGAR,
  );
  if (!autorizado) redirect("/no-autorizado");

  const puedePagar = await usuarioTienePermiso(
    session.userId,
    PERMISO_PAGAR_CUENTA_POR_PAGAR,
  );

  // `page` / `page_size` los completan los `.default()` del schema.
  const filtros = FiltrosListadoCuentasPorPagarSchema.parse({
    estado: "DEFINITIVA",
    page_size: 100,
  });
  const listado = await listarCuentasPorPagar(filtros);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Wallet className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Cuentas por Pagar
            </h1>
            <p className="text-sm text-muted-foreground">
              Cuentas en estado DEFINITIVA pendientes de pago. Registrar el pago
              imputa comprobantes del proveedor y marca la cuenta como PAGADA.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="size-4 text-blue-500" aria-hidden="true" />
              Pendientes de pago
            </CardTitle>
            <CardDescription>
              {listado.total} cuenta(s) DEFINITIVA(s). Una vez pagada, la cuenta
              sale de este listado.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <ListaCuentasPorPagar
              cuentas={listado.registros}
              puedePagar={puedePagar}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
