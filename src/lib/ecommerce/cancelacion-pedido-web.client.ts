export interface RespuestaCancelacionPedidoWeb {
  data: {
    pedido_venta_id: string;
    estado_ecommerce: "CANCELADO";
    reintegro_iniciado: true;
  } | null;
  error: { code?: string; message?: string } | null;
}

export interface ResultadoCancelacionPedidoWeb {
  ok: boolean;
  status: number;
  json: RespuestaCancelacionPedidoWeb;
}

export async function cancelarPedidoWebApi(
  pedidoId: string,
  motivo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoCancelacionPedidoWeb> {
  try {
    const respuesta = await fetchImpl(`/api/tienda/mis-pedidos/${pedidoId}/cancelar`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motivo: motivo.trim() }),
    });
    const json = (await respuesta.json().catch(() => ({ data: null, error: null }))) as RespuestaCancelacionPedidoWeb;
    return { ok: respuesta.ok, status: respuesta.status, json };
  } catch {
    return {
      ok: false,
      status: 0,
      json: { data: null, error: { message: "No se pudo conectar con el servidor." } },
    };
  }
}

export function mensajeErrorCancelacion(status: number): string {
  if (status === 400) return "Ingresá un motivo válido para cancelar el pedido.";
  if (status === 401) return "Tu sesión venció. Volvé a ingresar para continuar.";
  if (status === 404) return "El pedido ya no está disponible.";
  if (status === 409) return "El pedido cambió de estado y ya no puede cancelarse.";
  if (status === 0) return "No se pudo conectar con el servidor.";
  return "No pudimos cancelar el pedido. Intentá nuevamente.";
}
