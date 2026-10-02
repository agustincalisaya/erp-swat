/**
 * @module route — POST /api/tienda/cuenta/login
 * @description HU-E8 (spec_modulo_E.md §2.8) — login de Cliente Web.
 *
 * TODO(HU-E8): wrapper provisional introducido por HU-E1. Toda la lógica de
 * sesión vive en `lib/auth/sesion-cliente-web.ts` (reemplazable por el owner
 * de HU-E8 sin tocar E1).
 *
 * HU-E1 (CA7): después de un login exitoso, el carrito del visitante (cookie
 * `swat_carrito`) se fusiona con el carrito persistente de la cuenta. Una falla
 * de la fusión NO impide el login: se loguea y la cookie queda para reintentar
 * en el próximo login. Si el owner de HU-E8 reemplaza esta ruta, debe conservar
 * la llamada a `fusionarCarritoVisitante()`.
 */
import { NextRequest, NextResponse } from "next/server";
import { IniciarSesionClienteWebSchema } from "@/lib/schemas/ecommerce.schema";
import {
  aplicarCookieSesionClienteWeb,
  iniciarSesionClienteWeb,
} from "@/lib/auth/sesion-cliente-web";
import { ServiceError } from "@/lib/errors/service-error";
import { fusionarCarritoVisitante } from "@/lib/services/ecommerce/carrito.service";
import { ErrorConfiguracionCuentaWeb, MENSAJE_ERROR_INTERNO_CUENTA_WEB } from "@/lib/services/ecommerce/cuenta-cliente-web.service";
import { CARRITO_COOKIE_NAME, leerCookieCarrito } from "@/lib/services/ecommerce/carrito-token";
import { borrarCookieCarrito } from "@/lib/services/ecommerce/contexto-tienda";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = IniciarSesionClienteWebSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Los datos enviados no son válidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const { sesion, jwt } = await iniciarSesionClienteWeb(parsed.data.email, parsed.data.password);

    // HU-E1 (CA7) — fusión del carrito de visitante.
    const tokenVisitante = leerCookieCarrito(req.cookies.get(CARRITO_COOKIE_NAME)?.value);
    let carritoFusionado = false;
    let fusionFallida = false;
    if (tokenVisitante && !sesion.vinculacionPendiente) {
      try {
        carritoFusionado = (await fusionarCarritoVisitante(tokenVisitante, sesion.cuentaId)) !== null;
      } catch (error) {
        fusionFallida = true;
        console.error("[POST /api/tienda/cuenta/login] No se pudo fusionar el carrito de visitante:", error);
      }
    }

    const response = NextResponse.json(
      {
        data: {
          cuenta_id: sesion.cuentaId,
          email: sesion.email,
          vinculacion_pendiente: sesion.vinculacionPendiente,
          carrito_fusionado: carritoFusionado,
        },
        error: null,
      },
      { status: 200 },
    );
    aplicarCookieSesionClienteWeb(response, jwt);
    if (tokenVisitante && !fusionFallida && !sesion.vinculacionPendiente) borrarCookieCarrito(response);
    return response;
  } catch (err) {
    if (err instanceof ErrorConfiguracionCuentaWeb) {
      console.error("[POST /api/tienda/cuenta/login] Configuración inválida:", err);
      return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: MENSAJE_ERROR_INTERNO_CUENTA_WEB } }, { status: 500 });
    }
    if (err instanceof ServiceError) {
      const status = err.code === "CUENTA_BLOQUEADA" ? 423 : 401;
      return NextResponse.json({ data: null, error: { code: err.code, message: err.message } }, { status });
    }
    console.error("[POST /api/tienda/cuenta/login] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
}
