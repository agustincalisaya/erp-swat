/**
 * @page CuentasPropiasPage
 * @route /tesoreria/cuentas-propias
 *
 * Consola de Tesorería (HU-G5, spec_modulo_G.md §9.7). React Server Component:
 * resuelve sesión + permiso, consulta el servicio directamente (sin fetch HTTP)
 * y delega la grilla interactiva a `ListaCuentasPropias` (Client Component).
 * El CBU/alias llega ya ENMASCARADO desde el servicio (máx. 4 caracteres
 * finales); el revelado explícito exige un permiso distinto y se resuelve por
 * una Server Action dedicada.
 *
 * Gate de acceso: `tesoreria:leer_cuentas_bancarias` (redirect a
 * `/no-autorizado`). La gestión (alta/edición/baja) exige
 * `tesoreria:gestionar_cuentas_bancarias` y el revelado
 * `tesoreria:ver_datos_bancarios` — se resuelven acá para no ofrecer acciones a
 * quien no puede usarlas (el servidor vuelve a validar el permiso).
 */

import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarCuentasPropias,
  PERMISO_GESTIONAR_CUENTAS_BANCARIAS,
  PERMISO_LEER_CUENTAS_BANCARIAS,
  PERMISO_VER_DATOS_BANCARIOS,
} from "@/lib/services/tesoreria/cuenta-propia.service";
import { ListaCuentasPropias } from "@/components/tesoreria/ListaCuentasPropias";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cuentas propias — ERP SWAT",
  description:
    "Consola de Tesorería: cuentas bancarias y cajas propias con datos bancarios cifrados (Módulo G).",
};

export default async function CuentasPropiasPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  // Los tres permisos son independientes: se resuelven en paralelo (sin
  // waterfall). La lectura de cuentas se hace SOLO tras confirmar autorización
  // — así un actor sin permiso no dispara lecturas ni asientos de auditoría.
  const [autorizado, puedeGestionar, puedeRevelar] = await Promise.all([
    usuarioTienePermiso(session.userId, PERMISO_LEER_CUENTAS_BANCARIAS),
    usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CUENTAS_BANCARIAS),
    usuarioTienePermiso(session.userId, PERMISO_VER_DATOS_BANCARIOS),
  ]);
  if (!autorizado) redirect("/no-autorizado");

  const cuentas = await listarCuentasPropias(session.userId);

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-selected text-selected-foreground shrink-0">
            <Landmark className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              Cuentas propias
            </h1>
            <p className="text-sm text-muted-foreground">
              Cuentas bancarias y cajas propias. El CBU y el alias se muestran
              enmascarados; revelarlos requiere el permiso de datos bancarios.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Landmark className="size-4 text-primary" aria-hidden="true" />
              Cuentas activas
            </CardTitle>
            <CardDescription>
              {cuentas.length} cuenta(s) activa(s). Los datos bancarios se cifran
              por campo y se muestran enmascarados.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <ListaCuentasPropias
              cuentas={cuentas}
              puedeGestionar={puedeGestionar}
              puedeRevelar={puedeRevelar}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
