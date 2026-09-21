/**
 * @page ClientesPage
 * @route /clientes
 *
 * Listado de clientes activos (Módulo C). React Server Component: resuelve
 * sesión + permisos granulares, consulta `listarClientes()` directamente
 * (sin fetch HTTP, patrón del repo) y delega el render de la tabla a
 * `TablaClientes`.
 *
 * Es la pantalla que faltaba para llegar a la ficha de un cliente
 * (`/clientes/[id]`), donde viven las direcciones (HU-C3) y el canal de
 * contacto preferido (HU-C9). El alta (`/clientes/nuevo`) vuelve acá vía el
 * redirect de la propia ficha.
 *
 * Gate de acceso: `clientes:leer` (Vendedor y Administrador de CRM). El
 * botón "Nuevo cliente" se muestra solo con `clientes:crear`, y el botón
 * "Editar" por fila solo con `clientes:editar` (HU-C2).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { UserPlus, Users } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarClientes,
  PERMISO_CREAR,
  PERMISO_EDITAR,
  PERMISO_LEER,
} from "@/lib/services/clientes/cliente.service";
import { TablaClientes } from "@/components/clientes/TablaClientes";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Clientes — ERP SWAT",
  description: "Listado de clientes activos (Módulo C).",
};

export default async function ClientesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_LEER);
  if (!autorizado) redirect("/no-autorizado");

  const [clientes, puedeCrear, puedeEditar] = await Promise.all([
    listarClientes(),
    usuarioTienePermiso(session.userId, PERMISO_CREAR),
    usuarioTienePermiso(session.userId, PERMISO_EDITAR),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header (paleta azul de Módulo C) ─────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Users className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Clientes
            </h1>
            <p className="text-sm text-muted-foreground">
              Entrá a la ficha de cada cliente para gestionar sus direcciones y
              su canal de contacto preferido.
            </p>
          </div>
        </div>

        {puedeCrear && (
          <div>
            <Link
              href="/clientes/nuevo"
              className={`${buttonVariants()} bg-blue-600 hover:bg-blue-700 text-white gap-2`}
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Nuevo cliente
            </Link>
          </div>
        )}

        {/* ── Tabla en Card ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-blue-500" aria-hidden="true" />
              Clientes activos
            </CardTitle>
            <CardDescription>
              Solo se listan los clientes activos. Los dados de baja permanecen
              en la base para trazabilidad, fuera de este listado.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <TablaClientes clientes={clientes} puedeEditar={puedeEditar} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
