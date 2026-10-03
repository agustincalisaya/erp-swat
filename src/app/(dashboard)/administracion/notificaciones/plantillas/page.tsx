/**
 * @page PlantillasNotificacionPage
 * @route /administracion/notificaciones/plantillas
 *
 * Gestión de plantillas de notificación interna (HU-F2, spec_modulo_F.md §2.2,
 * task §6). RSC: resuelve sesión + permiso y lee el servicio directamente (sin
 * endpoint de listado, task §4.4). Gate de acceso:
 * `notificaciones:administrar_plantillas` (exclusivo Administrador de
 * Plataforma), el mismo que exigen las rutas y las Server Actions.
 *
 * Lista activas Y dadas de baja (para poder reactivarlas): excepción
 * documentada a RULES.md Regla N.° 1 (task §6, pregunta F2 resuelta).
 */

import { redirect } from "next/navigation";
import { AlertTriangle, BellRing } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  listarPlantillasNotificacion,
  PERMISO_ADMINISTRAR_PLANTILLAS,
  TIPOS_EVENTO_PLANTILLA,
  type PlantillaNotificacionListado,
} from "@/lib/services/notificaciones/plantilla-notificacion.service";
import { TablaPlantillasNotificacion } from "@/components/notificaciones/TablaPlantillasNotificacion";

import { Alert, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Plantillas de notificación — ERP SWAT",
  description: "Redacción de las notificaciones internas por evento de dominio (Módulo F).",
};

export default async function PlantillasNotificacionPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeAdministrar = await usuarioTienePermiso(
    session.userId,
    PERMISO_ADMINISTRAR_PLANTILLAS,
  );
  if (!puedeAdministrar) redirect("/no-autorizado");

  let plantillas: PlantillaNotificacionListado[] | null = null;
  try {
    plantillas = await listarPlantillasNotificacion();
  } catch (err) {
    console.error("[PlantillasNotificacionPage] Error al cargar las plantillas:", err);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <BellRing className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Plantillas de notificación
            </h1>
            <p className="text-sm text-muted-foreground">
              Redacción de los avisos internos de cada evento del sistema. Los cambios aplican
              desde el próximo evento, sin despliegue.
            </p>
          </div>
        </div>

        {plantillas === null ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudieron cargar las plantillas. Verificá la conexión con la base de datos.
            </AlertDescription>
          </Alert>
        ) : (
          <TablaPlantillasNotificacion
            plantillas={plantillas}
            tiposEvento={TIPOS_EVENTO_PLANTILLA}
          />
        )}
      </div>
    </main>
  );
}
