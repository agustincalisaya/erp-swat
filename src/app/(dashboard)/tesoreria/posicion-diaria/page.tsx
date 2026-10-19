/**
 * @page PosicionDiariaPage
 * @route /tesoreria/posicion-diaria
 *
 * HU-G7 (spec_modulo_G.md §9.8) — posición diaria consolidada de Tesorería.
 * React Server Component: resuelve sesión + permiso, consulta el servicio
 * directamente (sin fetch HTTP) y delega la presentación a
 * `PosicionDiariaPanel` (liquidez del día elegido vs. proyecciones a estado
 * actual) y al registro append-only de saldo (`FormularioRegistrarSaldo`).
 *
 * Gate de acceso: `tesoreria:leer_reportes` (redirect a `/no-autorizado`);
 * el registro de saldo exige `tesoreria:registrar_saldo_diario` (solo Tesorero
 * Central) — se resuelve acá para no ofrecer una acción inutilizable, y el
 * servidor vuelve a validar el permiso.
 *
 * Nunca expone CBU ni alias: las cuentas se identifican por nombre/ID.
 */

import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { DiaIsoSchema } from "@/lib/schemas/posicion-diaria.schema";
import {
  obtenerPosicionDiaria,
  PERMISO_LEER_REPORTES,
  PERMISO_REGISTRAR_SALDO_DIARIO,
} from "@/lib/services/tesoreria/posicion-diaria.service";
import { diaNegocioIso } from "@/lib/utils/fecha-negocio";
import { SelectorDia } from "@/components/tesoreria/SelectorDia";
import { PosicionDiariaPanel } from "@/components/tesoreria/PosicionDiariaPanel";
import { FormularioRegistrarSaldo } from "@/components/tesoreria/FormularioRegistrarSaldo";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Posición diaria — ERP SWAT",
  description:
    "Consola de Tesorería: posición diaria consolidada de cuentas propias, caja virtual de Mercado Pago y proyecciones (Módulo G).",
};

interface PosicionDiariaPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function PosicionDiariaPage({ searchParams }: PosicionDiariaPageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  // Los dos permisos son independientes: se resuelven en paralelo (sin
  // waterfall) y la lectura del reporte se hace SOLO tras confirmar la
  // autorización de lectura.
  const [autorizado, puedeRegistrar] = await Promise.all([
    usuarioTienePermiso(session.userId, PERMISO_LEER_REPORTES),
    usuarioTienePermiso(session.userId, PERMISO_REGISTRAR_SALDO_DIARIO),
  ]);
  if (!autorizado) redirect("/no-autorizado");

  // Día elegido por `?dia=`; si no viene o no es válido, el día de negocio de
  // Argentina. Se valida con el MISMO schema que la ruta antes de consultar.
  const rawParams = await searchParams;
  const diaParam = typeof rawParams.dia === "string" ? rawParams.dia : undefined;
  const dia = diaParam && DiaIsoSchema.safeParse(diaParam).success ? diaParam : diaNegocioIso();

  const posicion = await obtenerPosicionDiaria(dia);

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-selected text-selected-foreground shrink-0">
              <Wallet className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Posición diaria</h1>
              <p className="text-sm text-muted-foreground">
                Liquidez del día elegido (saldos de cuentas propias + caja virtual de Mercado
                Pago) y proyecciones a estado actual. Fechas en hora de Argentina.
              </p>
            </div>
          </div>
          <SelectorDia dia={dia} />
        </div>

        <PosicionDiariaPanel posicion={posicion} />

        {puedeRegistrar && (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Wallet className="size-4 text-primary" aria-hidden="true" />
                Registrar saldo diario
              </CardTitle>
              <CardDescription>
                Asiento append-only. Una corrección es un nuevo registro del mismo día: prevalece
                el último. El saldo admite como máximo dos decimales.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <FormularioRegistrarSaldo cuentas={posicion.cuentas} diaPorDefecto={dia} />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
