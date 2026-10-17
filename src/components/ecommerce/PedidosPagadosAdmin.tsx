"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type SubmitEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { PedidoPagadoAdminFila, PedidosPagadosAdminPagina } from "@/lib/services/ecommerce/pedidos-pagados-admin.service";
import { formatearFechaHoraNegocio } from "@/lib/utils/fecha-negocio";

const CLASE_TEXTAREA =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const moneda = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const ETIQUETAS_ESTADO: Record<PedidoPagadoAdminFila["estado_ecommerce"], string> = {
  PAGO_CONFIRMADO: "Pago confirmado",
  EN_PREPARACION: "En preparación",
  LISTO_PARA_RETIRO: "Listo para retiro",
  CANCELADO: "Cancelado",
  VENCIDO_SIN_RETIRO: "Vencido sin retiro",
};

type Accion = "cancelar" | "reintentar";
type Seleccion = { accion: Accion; fila: PedidoPagadoAdminFila };
type RespuestaApi = {
  data: null | {
    pedido_venta_id?: string;
    estado_ecommerce?: string;
    reintegro_iniciado?: boolean;
    resultado?: string;
    intento_reutilizado?: boolean;
  };
  error: null | { code?: string; message?: string };
};

async function ejecutarApi(accion: Accion, pedidoId: string, motivo: string) {
  try {
    const response = await fetch(
      accion === "cancelar"
        ? `/api/ecommerce/pedidos/${pedidoId}/cancelar`
        : `/api/ecommerce/pedidos/${pedidoId}/reintegro/reintentar`,
      {
        method: accion === "cancelar" ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      },
    );
    const json = (await response.json().catch(() => ({ data: null, error: null }))) as RespuestaApi;
    return { ok: response.ok, status: response.status, json };
  } catch {
    return { ok: false, status: 0, json: { data: null, error: null } satisfies RespuestaApi };
  }
}

function mensajeError(accion: Accion, status: number, code?: string) {
  if (status === 400) return accion === "cancelar" ? "Ingresá un motivo válido para cancelar el pedido." : "Ingresá un motivo válido para reintentar el reintegro.";
  if (status === 401) return "Tu sesión expiró. Volvé a iniciar sesión.";
  if (status === 403) return "No tenés permiso para realizar esta acción.";
  if (status === 404) return accion === "cancelar" ? "El pedido ya no está disponible." : "El reintegro ya no está disponible.";
  if (status === 409 && code === "REINTEGRO_EN_PROCESO") return "Ya existe un reintegro en proceso para este pedido.";
  if (status === 409 && code === "REINTEGRO_APROBADO") return "El reintegro ya fue completado.";
  if (status === 409 && code === "REINTEGRO_NO_RECHAZADO") return "El estado actual del reintegro ya no permite reintentarlo.";
  if (status === 409) return accion === "cancelar"
    ? "El pedido cambió de estado y ya no puede cancelarse."
    : "El reintegro cambió de estado y ya no puede reintentarse.";
  if (status === 0) return "No se pudo conectar con el servidor.";
  return "No pudimos completar la operación. Intentá nuevamente.";
}

function descripcionCancelacion(fila: PedidoPagadoAdminFila) {
  if (fila.estado_ecommerce === "EN_PREPARACION") {
    return "El pedido ya fue tomado por Pick & Pack y será cancelado administrativamente. Se iniciará el proceso de reintegro.";
  }
  if (fila.estado_ecommerce === "LISTO_PARA_RETIRO") {
    return "El pedido será cancelado, ya no podrá retirarse y se iniciará el proceso de reintegro.";
  }
  return "El pedido será cancelado y se iniciará el proceso de reintegro.";
}

function FormularioAccion({ seleccion, onCerrar, onResultado }: {
  seleccion: Seleccion;
  onCerrar: () => void;
  onResultado: (mensaje: string, refrescar: boolean) => void;
}) {
  const enviandoRef = useRef(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const motivoValido = motivo.trim().length > 0;

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!motivoValido || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    const resultado = await ejecutarApi(seleccion.accion, seleccion.fila.pedido_venta_id, motivo);
    enviandoRef.current = false;
    setEnviando(false);
    if (!resultado.ok) {
      const mensaje = mensajeError(seleccion.accion, resultado.status, resultado.json.error?.code);
      setError(mensaje);
      if (resultado.status === 409) onResultado(mensaje, true);
      return;
    }
    if (seleccion.accion === "cancelar") {
      if (resultado.json.data?.estado_ecommerce !== "CANCELADO" || resultado.json.data.reintegro_iniciado !== true) {
        setError("No pudimos confirmar la cancelación. Actualizá la página e intentá nuevamente.");
        return;
      }
      onResultado("Pedido cancelado correctamente. Se inició el proceso de reintegro.", true);
      return;
    }
    onResultado(
      resultado.json.data?.intento_reutilizado
        ? "Ya existe un reintegro en proceso para este pedido."
        : "Se solicitó un nuevo intento de reintegro.",
      true,
    );
  };

  const reintento = seleccion.accion === "reintentar";
  return (
    <form onSubmit={enviar} className="space-y-4">
      <Alert>
        <AlertDescription>
          {reintento
            ? "Se realizará un nuevo intento de reintegro sobre el pedido."
            : descripcionCancelacion(seleccion.fila)}
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`motivo-${seleccion.accion}-${seleccion.fila.pedido_venta_id}`}>
          {reintento ? "Motivo del reintento" : "Motivo de cancelación"}
        </Label>
        <textarea
          id={`motivo-${seleccion.accion}-${seleccion.fila.pedido_venta_id}`}
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          rows={4}
          required
          disabled={enviando}
          aria-describedby={`ayuda-${seleccion.accion}-${seleccion.fila.pedido_venta_id}`}
          className={CLASE_TEXTAREA}
        />
        <p id={`ayuda-${seleccion.accion}-${seleccion.fila.pedido_venta_id}`} className="text-xs text-muted-foreground">
          El motivo es obligatorio.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCerrar} disabled={enviando}>Volver</Button>
        <Button type="submit" variant={reintento ? "default" : "destructive"} disabled={!motivoValido || enviando}>
          {enviando ? "Procesando…" : reintento ? "Confirmar reintento" : "Confirmar cancelación"}
        </Button>
      </div>
    </form>
  );
}

function EstadoReintegro({ fila }: { fila: PedidoPagadoAdminFila }) {
  if (!fila.reintegro) return <span className="text-muted-foreground">Sin reintegro</span>;
  const texto = fila.reintegro.estado === "PENDIENTE" ? "Reintegro en proceso" :
    fila.reintegro.estado === "APROBADO" ? "Reintegro completado" : "Reintegro rechazado";
  return <Badge variant={fila.reintegro.estado === "RECHAZADO" ? "destructive" : "outline"}>{texto}</Badge>;
}

export function PedidosPagadosAdmin({ pagina }: { pagina: PedidosPagadosAdminPagina }) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bloqueados, setBloqueados] = useState(() => new Set<string>());
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.page_size));

  const resultado = (mensaje: string, refrescar: boolean) => {
    if (seleccion) setBloqueados((actual) => new Set(actual).add(seleccion.fila.pedido_venta_id));
    setSeleccion(null);
    setAviso(mensaje);
    if (refrescar) router.refresh();
  };

  return (
    <div className="space-y-4">
      {aviso && <Alert role="status"><AlertDescription>{aviso}</AlertDescription></Alert>}
      {pagina.items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No hay pedidos pagados para gestionar.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pagina.items.map((fila) => {
            const bloqueado = bloqueados.has(fila.pedido_venta_id);
            return (
              <li key={fila.pedido_venta_id} className="space-y-4 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{fila.numero}</p>
                    <p className="text-sm text-muted-foreground">{formatearFechaHoraNegocio(fila.fecha)}</p>
                  </div>
                  <Badge variant="outline">{ETIQUETAS_ESTADO[fila.estado_ecommerce]}</Badge>
                </div>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Total</dt><dd className="font-medium">{moneda.format(Number(fila.total))}</dd></div>
                  <div><dt className="text-muted-foreground">Reintegro</dt><dd className="mt-1"><EstadoReintegro fila={fila} /></dd></div>
                  {fila.plazo_retiro_vencimiento && (
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Plazo de retiro</dt><dd>{formatearFechaHoraNegocio(fila.plazo_retiro_vencimiento)}</dd></div>
                  )}
                </dl>
                {!bloqueado && (fila.acciones.cancelar_pedido || fila.acciones.reintentar_reintegro) && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    {fila.acciones.reintentar_reintegro && (
                      <Button type="button" variant="outline" onClick={() => { setAviso(null); setSeleccion({ accion: "reintentar", fila }); }}>
                        Reintentar reintegro
                      </Button>
                    )}
                    {fila.acciones.cancelar_pedido && (
                      <Button type="button" variant="destructive" onClick={() => { setAviso(null); setSeleccion({ accion: "cancelar", fila }); }}>
                        Cancelar pedido
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {totalPaginas > 1 && (
        <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Paginación de pedidos pagados">
          {pagina.page > 1 ? <Link className="underline" href={`/ecommerce/pedidos/pagados?page=${pagina.page - 1}`}>Anterior</Link> : <span />}
          <span className="text-muted-foreground">Página {pagina.page} de {totalPaginas}</span>
          {pagina.page < totalPaginas ? <Link className="underline" href={`/ecommerce/pedidos/pagados?page=${pagina.page + 1}`}>Siguiente</Link> : <span />}
        </nav>
      )}
      <Dialog open={seleccion !== null} onOpenChange={(abierto) => !abierto && setSeleccion(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{seleccion ? `${seleccion.accion === "cancelar" ? "Cancelar pedido" : "Reintentar reintegro"} ${seleccion.fila.numero}` : ""}</DialogTitle>
            <DialogDescription>La operación se registrará con el usuario de tu sesión.</DialogDescription>
          </DialogHeader>
          {seleccion && <FormularioAccion key={`${seleccion.accion}-${seleccion.fila.pedido_venta_id}`} seleccion={seleccion} onCerrar={() => setSeleccion(null)} onResultado={resultado} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
