/**
 * @page ClienteFichaPage
 * @route /clientes/[id]
 *
 * Ficha mínima de un Cliente (HU-C3, spec_modulo_C.md §2.3). Server
 * Component: resuelve sesión + permisos, trae el encabezado y las
 * direcciones (solo lectura) y delega el flujo interactivo de alta a
 * `DireccionesCliente`. No es un CRUD completo de `Cliente` — edición,
 * consentimiento, segmento y baja son HU-C2/C4/C5/C8/C10, fuera de alcance.
 *
 * Cliente inexistente **o** con `is_active === false` ⇒ `notFound()`: ambos
 * casos son indistinguibles a propósito (decisión humana ratificada, sin
 * código `CLIENTE_INACTIVO` ni 409), coherente con el filtro `is_active =
 * true` del contrato global de baja lógica. Se usa `findUnique` +
 * `notFound()` —y no `findUniqueOrThrow()`— para que el caso ausente rinda
 * un `not-found.tsx` limpio en vez de una excepción sin manejar.
 */
import { notFound, redirect } from "next/navigation";
import { UserRound } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { prisma } from "@/lib/db/prisma";
import {
  listarDireccionesCliente,
  PERMISO_LEER,
} from "@/lib/services/clientes/cliente.service";
import { DireccionesCliente } from "@/components/clientes/DireccionesCliente";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/** Ver direcciones dadas de baja es privilegio de Auditoría (RULES.md N.° 1). */
const PERMISO_AUDITORIA = "auditoria:leer_forense";

export default async function ClienteFichaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeLeer = await usuarioTienePermiso(session.userId, PERMISO_LEER);
  if (!puedeLeer) redirect("/no-autorizado");

  // Next.js 16: `params` es una Promise.
  const { id } = await params;

  // Encabezado y permiso de auditoría son independientes: en paralelo.
  const [cliente, incluirInactivas] = await Promise.all([
    prisma.cliente.findUnique({
      where: { id },
      select: { id: true, nombre: true, dni: true, is_active: true },
    }),
    usuarioTienePermiso(session.userId, PERMISO_AUDITORIA),
  ]);
  if (!cliente || !cliente.is_active) notFound();

  const direcciones = await listarDireccionesCliente(id, { incluirInactivas });

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* ── Encabezado (paleta azul de Módulo C) ─────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <UserRound className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight truncate">
              {cliente.nombre}
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">DNI</span>
              <Badge variant="outline" className="font-mono">
                {cliente.dni}
              </Badge>
            </div>
          </div>
        </div>

        <DireccionesCliente clienteId={cliente.id} direcciones={direcciones} />
      </div>
    </main>
  );
}
