/**
 * @module route — POST /api/notificaciones/plantillas
 * @description HU-F2 (spec_modulo_F.md §2.2, task §4.1) — Alta de una
 * PlantillaNotificacion. Wrapper fino (spec F §1): resuelve sesión + permiso
 * `notificaciones:administrar_plantillas`, valida el body con Zod y delega en
 * `crearPlantillaNotificacion()`. NINGUNA regla de negocio vive acá — la
 * validación de `tipo_evento` contra el registro de eventos y la traducción
 * del `P2002` viven en el servicio.
 *
 * Respuestas: 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 409 PLANTILLA_YA_EXISTE · 409 PLANTILLA_DADA_DE_BAJA ·
 * 422 TIPO_EVENTO_DESCONOCIDO · 500 INTERNAL_ERROR.
 * (Los códigos 409/422 son PROPUESTAS aprobadas, no están en el spec.)
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { CrearPlantillaNotificacionSchema } from "@/lib/schemas/notificaciones.schema";
import {
  crearPlantillaNotificacion,
  PERMISO_ADMINISTRAR_PLANTILLAS,
} from "@/lib/services/notificaciones/plantilla-notificacion.service";

const STATUS_POR_CODIGO: Record<string, number> = {
  TIPO_EVENTO_DESCONOCIDO: 422,
  PLANTILLA_YA_EXISTE: 409,
  PLANTILLA_DADA_DE_BAJA: 409,
};

export const POST = withPermission(PERMISO_ADMINISTRAR_PLANTILLAS, async (req: NextRequest, session) => {
  const body = await req.json().catch(() => null);
  const parsed = CrearPlantillaNotificacionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Datos inválidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await crearPlantillaNotificacion(parsed.data, session.userId);
    return NextResponse.json({ data: resultado, error: null }, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: error.code, message: error.message } },
        { status: STATUS_POR_CODIGO[error.code] ?? 400 },
      );
    }
    console.error("[POST /api/notificaciones/plantillas] Error inesperado:", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
