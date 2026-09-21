/**
 * @page ClienteFichaPage
 * @route /clientes/[id]
 *
 * Ficha mínima de un Cliente (HU-C3, HU-C8 y HU-C9, spec_modulo_C.md §2.3 y
 * §2.8). Server Component: resuelve sesión + permisos, trae el encabezado, el
 * canal de contacto preferido, el segmento comercial y las direcciones (solo
 * lectura) y delega el flujo interactivo de alta a `DireccionesCliente`, el de
 * canal a `CanalContactoCliente` y el de segmento a `SegmentoCliente`. No es un
 * CRUD completo de `Cliente` — edición, consentimiento y baja son
 * HU-C2/C4/C5/C10, fuera de alcance.
 *
 * Cliente inexistente **o** con `is_active === false` ⇒ `notFound()`: ambos
 * casos son indistinguibles a propósito (decisión humana ratificada, sin
 * código `CLIENTE_INACTIVO` ni 409), coherente con el filtro `is_active =
 * true` del contrato global de baja lógica. Se usa `findUnique` +
 * `notFound()` —y no `findUniqueOrThrow()`— para que el caso ausente rinda
 * un `not-found.tsx` limpio en vez de una excepción sin manejar.
 */
import { notFound, redirect } from "next/navigation";
import { Info, UserRound } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { prisma } from "@/lib/db/prisma";
import {
  listarDireccionesCliente,
  PERMISO_LEER,
} from "@/lib/services/clientes/cliente.service";
import { DireccionesCliente } from "@/components/clientes/DireccionesCliente";
import { CanalContactoCliente } from "@/components/clientes/CanalContactoCliente";
import { SegmentoCliente } from "@/components/clientes/SegmentoCliente";
import { ConsentimientosCliente } from "@/components/clientes/ConsentimientosCliente";
import { esAdministradorCrmActivo, obtenerConsentimientosCliente, PERMISO_GESTIONAR_CONSENTIMIENTO } from "@/lib/services/clientes/consentimiento.service";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

/** Ver direcciones dadas de baja es privilegio de Auditoría (RULES.md N.° 1). */
const PERMISO_AUDITORIA = "auditoria:leer_forense";

export default async function ClienteFichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ alta?: string | string[] }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeLeer = await usuarioTienePermiso(session.userId, PERMISO_LEER);
  if (!puedeLeer) redirect("/no-autorizado");

  // Next.js 16: `params` y `searchParams` son Promises. `?alta=recuperado` lo
  // agrega el formulario de alta cuando el DNI ya existía (HU-C1) para avisar
  // acá que se recuperó el registro en lugar de crear un duplicado.
  const { id } = await params;
  const { alta } = await searchParams;
  const altaRecuperada = alta === "recuperado";

  // Encabezado y permiso de auditoría son independientes: en paralelo.
  const [cliente, incluirInactivas] = await Promise.all([
    prisma.cliente.findUnique({
      where: { id },
      select: { id: true, nombre: true, dni: true, is_active: true, canal_preferido: true, segmento: true },
    }),
    usuarioTienePermiso(session.userId, PERMISO_AUDITORIA),
  ]);
  if (!cliente || !cliente.is_active) notFound();

  const direcciones = await listarDireccionesCliente(id, { incluirInactivas });
  const [consentimientos, puedeGestionarConsentimiento, esAdministradorCrm] = await Promise.all([
    obtenerConsentimientosCliente(id),
    usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CONSENTIMIENTO),
    esAdministradorCrmActivo(session.userId),
  ]);

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

        {altaRecuperada && (
          <Alert className="border-amber-200 bg-amber-50">
            <Info className="size-4 text-amber-700" aria-hidden="true" />
            <AlertDescription className="text-amber-900">
              Este DNI ya existía: se recuperó el registro existente, no se creó
              un duplicado.
            </AlertDescription>
          </Alert>
        )}

        <DireccionesCliente clienteId={cliente.id} direcciones={direcciones} />

        <CanalContactoCliente
          clienteId={cliente.id}
          canalPreferido={cliente.canal_preferido}
        />

        <SegmentoCliente clienteId={cliente.id} segmento={cliente.segmento} />
        <ConsentimientosCliente clienteId={cliente.id} lectura={consentimientos} puedeGestionar={puedeGestionarConsentimiento} puedeAdministrar={esAdministradorCrm} />
      </div>
    </main>
  );
}
