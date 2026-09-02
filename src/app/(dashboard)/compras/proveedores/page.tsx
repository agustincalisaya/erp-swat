/**
 * @page ProveedoresPage
 * @route /compras/proveedores
 *
 * Listado y gestión de proveedores (HU-H1, spec_modulo_H.md §2.1 / §2.2).
 * React Server Component: resuelve sesión + permisos granulares, consulta el
 * servicio directamente (sin fetch HTTP) y delega los filtros interactivos y
 * las acciones a `TablaProveedores` (Client Component sincronizado con la
 * URL).
 *
 * Gate de acceso: `proveedores:leer` (Comprador y Supervisor de Compras —
 * decisión D6 del design). Las acciones de cada fila se habilitan según los
 * permisos que el usuario tenga (crear/editar/homologar/baja).
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Users, Handshake } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarProveedores,
  PERMISO_BAJA,
  PERMISO_CREAR,
  PERMISO_EDITAR,
  PERMISO_HOMOLOGAR,
  PERMISO_LEER,
} from "@/lib/services/proveedores/proveedor.service";
import { FiltrosListadoProveedoresSchema } from "@/lib/schemas/proveedores.schema";
import { TablaProveedores } from "@/components/compras/TablaProveedores";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Proveedores — ERP SWAT",
  description: "Alta, homologación y gestión de proveedores (Módulo H).",
};

async function ProveedoresData({
  searchParams,
  userId,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  userId: string;
}) {
  const filtros = FiltrosListadoProveedoresSchema.parse({
    estado:
      typeof searchParams.estado === "string" ? searchParams.estado : undefined,
  });

  const [proveedores, crear, editar, homologar, baja] = await Promise.all([
    listarProveedores(filtros),
    usuarioTienePermiso(userId, PERMISO_CREAR),
    usuarioTienePermiso(userId, PERMISO_EDITAR),
    usuarioTienePermiso(userId, PERMISO_HOMOLOGAR),
    usuarioTienePermiso(userId, PERMISO_BAJA),
  ]);

  return (
    <TablaProveedores
      proveedores={proveedores}
      filtrosIniciales={{ estado: filtros.estado }}
      permisos={{ crear, editar, homologar, baja }}
    />
  );
}

export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_LEER);
  if (!autorizado) redirect("/no-autorizado");

  const params = await searchParams;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Handshake className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Proveedores
            </h1>
            <p className="text-sm text-muted-foreground">
              Legajo comercial, homologación, suspensión y baja lógica con
              datos bancarios cifrados (AES-256).
            </p>
          </div>
        </div>

        {/* ── Tabla en Card ──────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-blue-500" aria-hidden="true" />
              Proveedores activos
            </CardTitle>
            <CardDescription>
              Solo se listan los proveedores activos. Los dados de baja
              permanecen en la base para trazabilidad, fuera de este listado.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <Suspense
              key={`${params.estado ?? ""}`}
              fallback={
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                  <span className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Cargando proveedores…
                </div>
              }
            >
              <ProveedoresData searchParams={params} userId={session.userId} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}