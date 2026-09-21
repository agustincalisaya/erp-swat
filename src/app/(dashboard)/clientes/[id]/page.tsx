/**
 * @page ClienteFichaPage
 * @route /clientes/[id]
 *
 * Ficha mínima de un Cliente (HU-C2, HU-C3, HU-C8 y HU-C9, spec_modulo_C.md §2.3 y
 * §2.8). Server Component: resuelve sesión + permisos, trae el encabezado, el
 * canal de contacto preferido, el segmento comercial y las direcciones (solo
 * lectura) y delega el flujo interactivo de alta a `DireccionesCliente`, el de
 * canal a `CanalContactoCliente` y el de segmento a `SegmentoCliente`. HU-C2 agrega
 * la edición de contacto (`DatosContactoCliente`) y de direcciones. HU-C6
 * agrega la baja lógica (`DialogBajaCliente`, permiso `clientes:baja`). No es
 * un CRUD completo de `Cliente` — consentimiento y fusión son HU-C4/C5/C10,
 * fuera de alcance.
 *
 * Cliente inexistente ⇒ `notFound()`. Se usa `findUnique` + `notFound()` —y no
 * `findUniqueOrThrow()`— para que el caso ausente rinda un `not-found.tsx`
 * limpio en vez de una excepción sin manejar.
 *
 * Cliente con `is_active === false` (HU-C6) ⇒ **se muestra en solo lectura**,
 * con badge "Inactivo" y el motivo de la baja: la spec Módulo C §2.3 exige que
 * el historial de un cliente dado de baja permanezca accesible. Sin botones de
 * edición ni de baja. El bloqueo de operaciones NUEVAS sobre un inactivo (y su
 * 404 sin `CLIENTE_INACTIVO`, decisión ratificada en HU-C3) vive en los
 * services de escritura, no en esta lectura.
 */
import { notFound, redirect } from "next/navigation";
import { Ban, Info, UserRound } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { prisma } from "@/lib/db/prisma";
import {
  listarDireccionesCliente,
  PERMISO_BAJA,
  PERMISO_EDITAR,
  PERMISO_LEER,
} from "@/lib/services/clientes/cliente.service";
import { DatosContactoCliente } from "@/components/clientes/DatosContactoCliente";
import { DireccionesCliente } from "@/components/clientes/DireccionesCliente";
import { CanalContactoCliente } from "@/components/clientes/CanalContactoCliente";
import { SegmentoCliente } from "@/components/clientes/SegmentoCliente";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

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
  const [cliente, incluirInactivas, puedeEditar, puedeBaja] = await Promise.all([
    prisma.cliente.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        dni: true,
        telefono: true,
        email: true,
        is_active: true,
        canal_preferido: true,
        segmento: true,
        deletion_reason: true,
      },
    }),
    usuarioTienePermiso(session.userId, PERMISO_AUDITORIA),
    usuarioTienePermiso(session.userId, PERMISO_EDITAR),
    usuarioTienePermiso(session.userId, PERMISO_BAJA),
  ]);
  if (!cliente) notFound();

  // HU-C6: un cliente dado de baja se muestra en solo lectura.
  const inactivo = !cliente.is_active;

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
              {inactivo && <Badge variant="destructive">Inactivo</Badge>}
            </div>
          </div>
        </div>

        {inactivo && (
          <Alert className="border-red-200 bg-red-50">
            <Ban className="size-4 text-red-700" aria-hidden="true" />
            <AlertDescription className="text-red-900">
              Este cliente está dado de baja y no puede operar. Su ficha y su
              historial se conservan en solo lectura.
              {cliente.deletion_reason && (
                <>
                  {" "}
                  <strong>Motivo:</strong> {cliente.deletion_reason}
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        {altaRecuperada && (
          <Alert className="border-amber-200 bg-amber-50">
            <Info className="size-4 text-amber-700" aria-hidden="true" />
            <AlertDescription className="text-amber-900">
              Este DNI ya existía: se recuperó el registro existente, no se creó
              un duplicado.
            </AlertDescription>
          </Alert>
        )}

        <DatosContactoCliente
          clienteId={cliente.id}
          dni={cliente.dni}
          nombre={cliente.nombre}
          telefono={cliente.telefono}
          email={cliente.email}
          puedeEditar={puedeEditar && !inactivo}
          puedeBaja={puedeBaja}
          isActive={cliente.is_active}
        />

        <DireccionesCliente
          clienteId={cliente.id}
          direcciones={direcciones}
          puedeEditar={puedeEditar}
          soloLectura={inactivo}
        />

        {inactivo ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                Preferencias comerciales
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Canal de contacto preferido</dt>
                  <dd className="font-medium text-gray-900">
                    {cliente.canal_preferido ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Segmento</dt>
                  <dd className="font-medium text-gray-900">{cliente.segmento}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ) : (
          <>
            <CanalContactoCliente
              clienteId={cliente.id}
              canalPreferido={cliente.canal_preferido}
            />

            <SegmentoCliente clienteId={cliente.id} segmento={cliente.segmento} />
          </>
        )}
      </div>
    </main>
  );
}
