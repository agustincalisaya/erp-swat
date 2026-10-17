"use client";

/**
 * HU-E7 — Backoffice de órdenes web no abonadas (spec E §2.7; task_relos.md
 * D2). Mobile-first: una tarjeta por orden. "Anular orden" pide motivo
 * obligatorio y confirmación explícita, llama al Route Handler y refresca la
 * lista del servidor (la orden anulada sale de la lista).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Fila {
  pedido_venta_id: string;
  numero_venta: string;
  cliente_nombre: string | null;
  total: string;
  estado_ecommerce: "PAGO_PENDIENTE" | "PAGO_RECHAZADO";
  created_at: string;
}

interface Pagina {
  items: Fila[];
  total: number;
  page: number;
  page_size: number;
}

interface RespuestaApi {
  data: { stock_liberado?: boolean } | null;
  error: { code?: string; message?: string; fieldErrors?: Record<string, string[] | undefined> } | null;
}

const MENSAJE_GENERICO = "No se pudo anular la orden. Intentá nuevamente.";
const MENSAJE_POR_STATUS: Record<number, string> = {
  401: "Tu sesión expiró. Volvé a iniciar sesión.",
  403: "No tenés permiso para anular órdenes web.",
  404: "La orden ya no existe o no es un pedido web.",
  409: "La orden ya no se puede anular: puede que se haya pagado o anulado mientras tanto. Actualizá la lista.",
};
const CLASE_TEXTAREA =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const formatoMoneda = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const formatoFecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

async function anularApi(pedidoVentaId: string, motivo: string): Promise<{ ok: boolean; status: number; json: RespuestaApi }> {
  try {
    const respuesta = await fetch(`/api/ecommerce/pedidos/${pedidoVentaId}/anular`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deletion_reason: motivo }),
    });
    const json = (await respuesta.json().catch(() => ({ data: null, error: null }))) as RespuestaApi;
    return { ok: respuesta.ok, status: respuesta.status, json };
  } catch {
    return { ok: false, status: 0, json: { data: null, error: { message: "No se pudo conectar con el servidor." } } };
  }
}

function mensajeError(status: number, json: RespuestaApi): string {
  if (status === 400) return json.error?.fieldErrors?.deletion_reason?.[0] ?? json.error?.message ?? MENSAJE_GENERICO;
  if (status === 0) return json.error?.message ?? MENSAJE_GENERICO;
  return MENSAJE_POR_STATUS[status] ?? MENSAJE_GENERICO;
}

function FormularioAnulacion({ fila, onHecho, onCancelar }: { fila: Fila; onHecho: (aviso: string) => void; onCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeEnviar = motivo.trim().length > 0 && confirmado && !enviando;

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    const { ok, status, json } = await anularApi(fila.pedido_venta_id, motivo.trim());
    setEnviando(false);
    if (!ok) {
      setError(mensajeError(status, json));
      return;
    }
    onHecho(
      json.data?.stock_liberado
        ? `La orden ${fila.numero_venta} se anuló y su stock reservado volvió a estar disponible.`
        : `La orden ${fila.numero_venta} se anuló. No había stock reservado para liberar.`,
    );
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Alert variant="destructive">
        <AlertDescription>
          {fila.estado_ecommerce === "PAGO_PENDIENTE"
            ? "La orden se da de baja (no se borra) y el stock que tiene reservado vuelve a estar disponible."
            : "La orden se da de baja (no se borra). Su stock ya se había liberado cuando se rechazó el pago."}
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="pedido-motivo-anulacion">Motivo de la anulación (obligatorio)</Label>
        <textarea
          id="pedido-motivo-anulacion"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          required
          disabled={enviando}
          placeholder="Ej: El cliente desistió de la compra."
          className={CLASE_TEXTAREA}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={confirmado}
          onChange={(e) => setConfirmado(e.target.checked)}
          disabled={enviando}
        />
        <span>Confirmo que quiero anular la orden {fila.numero_venta}.</span>
      </label>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Volver
        </Button>
        <Button type="submit" variant="destructive" disabled={!puedeEnviar}>
          {enviando ? "Anulando…" : "Anular orden"}
        </Button>
      </div>
    </form>
  );
}

export function PedidosWebAdmin({ pagina }: { pagina: Pagina }) {
  const router = useRouter();
  const [seleccionada, setSeleccionada] = useState<Fila | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.page_size));

  const hecho = (texto: string) => {
    setSeleccionada(null);
    setAviso(texto);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {aviso && (
        <Alert role="status">
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      {pagina.items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No hay órdenes no abonadas.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pagina.items.map((fila) => (
            <li key={fila.pedido_venta_id} className="space-y-3 rounded-lg border p-4" data-pedido-venta-id={fila.pedido_venta_id}>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-medium">{fila.numero_venta}</p>
                  <p className="text-sm text-muted-foreground">{fila.cliente_nombre ?? "Cliente sin identificar"}</p>
                </div>
                <Badge variant={fila.estado_ecommerce === "PAGO_PENDIENTE" ? "secondary" : "outline"}>
                  {fila.estado_ecommerce === "PAGO_PENDIENTE" ? "Pago pendiente" : "Pago rechazado"}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="font-medium">{formatoMoneda.format(Number(fila.total))}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Creada</dt>
                  <dd>{formatoFecha.format(new Date(fila.created_at))}</dd>
                </div>
              </dl>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-destructive"
                onClick={() => {
                  setAviso(null);
                  setSeleccionada(fila);
                }}
              >
                Anular orden
              </Button>
            </li>
          ))}
        </ul>
      )}

      {totalPaginas > 1 && (
        <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Paginación">
          {pagina.page > 1 ? (
            <Link className="underline" href={`/ecommerce/pedidos?page=${pagina.page - 1}`}>
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Página {pagina.page} de {totalPaginas}
          </span>
          {pagina.page < totalPaginas ? (
            <Link className="underline" href={`/ecommerce/pedidos?page=${pagina.page + 1}`}>
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Dialog open={seleccionada !== null} onOpenChange={(abierto) => !abierto && setSeleccionada(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{seleccionada ? `Anular la orden ${seleccionada.numero_venta}` : ""}</DialogTitle>
            {seleccionada && (
              <DialogDescription>
                {seleccionada.cliente_nombre ?? "Cliente sin identificar"} · {formatoMoneda.format(Number(seleccionada.total))}
              </DialogDescription>
            )}
          </DialogHeader>
          {seleccionada && (
            <FormularioAnulacion
              key={seleccionada.pedido_venta_id}
              fila={seleccionada}
              onHecho={hecho}
              onCancelar={() => setSeleccionada(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
