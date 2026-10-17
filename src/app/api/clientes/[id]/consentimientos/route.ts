import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ClienteIdConsentimientoSchema, RegularizarConsentimientoSchema } from "@/lib/schemas/consentimientos.schema";
import { PERMISO_GESTIONAR_CONSENTIMIENTO, regularizarConsentimientoCliente } from "@/lib/services/clientes/consentimiento.service";

type Context = { params: Promise<{ id: string }> };
const errorJson = (code: string, message: string, status: number) =>
  NextResponse.json({ data: null, error: { code, message } }, { status });

export const POST = withPermission(PERMISO_GESTIONAR_CONSENTIMIENTO,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    if (!ClienteIdConsentimientoSchema.safeParse(id).success) return errorJson("CLIENTE_NO_ENCONTRADO", "Cliente no encontrado", 404);
    const parsed = RegularizarConsentimientoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorJson("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos", 400);
    try {
      const data = await regularizarConsentimientoCliente(id, parsed.data, session.userId);
      return NextResponse.json({ data, error: null }, { status: 201 });
    } catch (error) {
      if (error instanceof ServiceError) {
        const status = error.code === "CLIENTE_NO_ENCONTRADO" ? 404 :
          error.code === "CONSENTIMIENTO_CONFLICTO" || error.code === "CONSENTIMIENTO_INTEGRIDAD" ? 409 :
          error.code === "FORBIDDEN" ? 403 : 400;
        return errorJson(error.code, error.message, status);
      }
      console.error("[POST /api/clientes/[id]/consentimientos] Error inesperado:", error);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  });
