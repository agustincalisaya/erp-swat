"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type TipoDiscrepancia = "CANTIDAD" | "TALLE" | "COLOR" | "CALIDAD";

interface OrdenRecepcionable {
  orden_compra_id: string;
  numero_orden: string;
  estado: string;
  proveedor: string;
  items: Array<{
    orden_compra_item_id: string;
    sku: string;
    producto: string;
    cantidad_solicitada: number;
    cantidad_recibida: number;
    cantidad_pendiente: number;
  }>;
}

interface DepositoRecepcion {
  id: string;
  nombre: string;
  tipo: string;
}

interface ItemFormulario {
  orden_compra_item_id: string;
  cantidad_recibida: number;
  cantidad_aceptada: number;
  discrepancias: Array<{ tipo: TipoDiscrepancia; detalle: string }>;
}

export function FormularioRecepcionMercaderia({
  ordenes,
  depositos,
  ordenInicialId,
}: {
  ordenes: OrdenRecepcionable[];
  depositos: DepositoRecepcion[];
  ordenInicialId?: string;
}) {
  const router = useRouter();
  const inicial = ordenes.some((orden) => orden.orden_compra_id === ordenInicialId)
    ? ordenInicialId!
    : ordenes[0]?.orden_compra_id ?? "";
  const [ordenId, setOrdenId] = useState(inicial);
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? "");
  const [remito, setRemito] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());
  const [itemsPorOrden, setItemsPorOrden] = useState<Record<string, ItemFormulario[]>>({});
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const orden = useMemo(
    () => ordenes.find((candidata) => candidata.orden_compra_id === ordenId),
    [ordenes, ordenId],
  );
  const items = itemsPorOrden[ordenId] ?? orden?.items.map((item) => ({
    orden_compra_item_id: item.orden_compra_item_id,
    cantidad_recibida: item.cantidad_pendiente,
    cantidad_aceptada: item.cantidad_pendiente,
    discrepancias: [],
  })) ?? [];

  function actualizarItems(nuevos: ItemFormulario[]) {
    setItemsPorOrden((actual) => ({ ...actual, [ordenId]: nuevos }));
  }

  function actualizarCantidad(index: number, campo: "cantidad_recibida" | "cantidad_aceptada", valor: number) {
    actualizarItems(items.map((item, posicion) => {
      if (posicion !== index) return item;
      const cantidad = Math.max(0, valor || 0);
      if (campo === "cantidad_recibida") {
        return {
          ...item,
          cantidad_recibida: cantidad,
          cantidad_aceptada: Math.min(item.cantidad_aceptada, cantidad),
        };
      }
      return { ...item, cantidad_aceptada: cantidad };
    }));
  }

  function agregarDiscrepancia(index: number) {
    actualizarItems(items.map((item, posicion) => posicion === index
      ? { ...item, discrepancias: [...item.discrepancias, { tipo: "CANTIDAD", detalle: "" }] }
      : item));
  }

  function actualizarDiscrepancia(index: number, discrepanciaIndex: number, cambio: Partial<{ tipo: TipoDiscrepancia; detalle: string }>) {
    actualizarItems(items.map((item, posicion) => posicion === index
      ? {
          ...item,
          discrepancias: item.discrepancias.map((discrepancia, posicionDiscrepancia) =>
            posicionDiscrepancia === discrepanciaIndex ? { ...discrepancia, ...cambio } : discrepancia),
        }
      : item));
  }

  function quitarDiscrepancia(index: number, discrepanciaIndex: number) {
    actualizarItems(items.map((item, posicion) => posicion === index
      ? { ...item, discrepancias: item.discrepancias.filter((_, i) => i !== discrepanciaIndex) }
      : item));
  }

  async function enviar(event: FormEvent) {
    event.preventDefault();
    setMensaje(null);
    const itemsRecibidos = items.filter((item) => item.cantidad_recibida > 0);
    if (!ordenId || !depositoId || itemsRecibidos.length === 0) {
      setMensaje({ tipo: "error", texto: "Seleccioná orden, depósito y al menos un ítem recibido." });
      return;
    }
    if (itemsRecibidos.some((item) => (
      item.cantidad_aceptada < item.cantidad_recibida
      && item.discrepancias.length === 0
    ))) {
      setMensaje({
        tipo: "error",
        texto: "Documentá al menos una discrepancia para cada ítem observado.",
      });
      return;
    }

    setEnviando(true);
    try {
      const respuesta = await fetch(`/api/ordenes-compra/${ordenId}/recepciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposito_destino_id: depositoId,
          clave_idempotencia: claveIdempotencia,
          numero_remito_proveedor: remito || undefined,
          observaciones: observaciones || undefined,
          items: itemsRecibidos,
        }),
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) {
        setMensaje({ tipo: "error", texto: cuerpo.error?.message ?? "No se pudo registrar la recepción." });
        return;
      }

      const avisoEvaluacion = cuerpo.data.evaluacion_proveedor === "FALLO"
        ? " La recepción quedó confirmada, pero falló la evaluación del proveedor."
        : "";
      setMensaje({
        tipo: "ok",
        texto: `${cuerpo.data.idempotente ? "Recepción ya registrada" : "Recepción registrada"}: ${cuerpo.data.recepcion_id}.${avisoEvaluacion}`,
      });
      setClaveIdempotencia(crypto.randomUUID());
      router.refresh();
    } catch {
      // La clave se conserva: un retry tras timeout no duplica la recepción.
      setMensaje({ tipo: "error", texto: "No se recibió respuesta. Reintentá: la operación es idempotente." });
    } finally {
      setEnviando(false);
    }
  }

  if (ordenes.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay órdenes confirmadas con cantidades pendientes.</p>;
  }

  return (
    <form onSubmit={enviar} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Orden de compra</span>
          <select className="w-full rounded-md border bg-white px-3 py-2" value={ordenId} onChange={(e) => setOrdenId(e.target.value)}>
            {ordenes.map((item) => <option key={item.orden_compra_id} value={item.orden_compra_id}>{item.numero_orden} · {item.proveedor}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Depósito destino</span>
          <select className="w-full rounded-md border bg-white px-3 py-2" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
            {depositos.map((item) => <option key={item.id} value={item.id}>{item.nombre} ({item.tipo})</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Remito del proveedor</span>
          <input className="w-full rounded-md border px-3 py-2" maxLength={100} value={remito} onChange={(e) => setRemito(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Observaciones</span>
          <input className="w-full rounded-md border px-3 py-2" maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </label>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="font-semibold">Mercadería recibida</h2>
          <p className="text-sm text-muted-foreground">La cantidad física avanza la OC; solo la aceptada ingresa al stock disponible.</p>
        </div>
        {orden?.items.map((itemOrden, index) => {
          const item = items[index];
          return (
            <section key={itemOrden.orden_compra_item_id} className="rounded-lg border p-4 space-y-3">
              <div>
                <p className="font-medium">{itemOrden.producto} <span className="font-mono text-xs">{itemOrden.sku}</span></p>
                <p className="text-xs text-muted-foreground">Solicitado: {itemOrden.cantidad_solicitada} · Recibido antes: {itemOrden.cantidad_recibida} · Pendiente: {itemOrden.cantidad_pendiente}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm space-y-1"><span>Recibida</span><input type="number" min={0} max={itemOrden.cantidad_pendiente} step={1} className="w-full rounded-md border px-3 py-2" value={item.cantidad_recibida} onChange={(e) => actualizarCantidad(index, "cantidad_recibida", Number(e.target.value))} /></label>
                <label className="text-sm space-y-1"><span>Aceptada</span><input type="number" min={0} max={item.cantidad_recibida} step={1} className="w-full rounded-md border px-3 py-2" value={item.cantidad_aceptada} onChange={(e) => actualizarCantidad(index, "cantidad_aceptada", Number(e.target.value))} /></label>
              </div>
              {item.discrepancias.map((discrepancia, discrepanciaIndex) => (
                <div key={discrepanciaIndex} className="grid gap-2 sm:grid-cols-[150px_1fr_auto]">
                  <select className="rounded-md border px-2 py-2 text-sm" value={discrepancia.tipo} onChange={(e) => actualizarDiscrepancia(index, discrepanciaIndex, { tipo: e.target.value as TipoDiscrepancia })}>
                    {(["CANTIDAD", "TALLE", "COLOR", "CALIDAD"] as const).map((tipo) => <option key={tipo}>{tipo}</option>)}
                  </select>
                  <input required className="rounded-md border px-3 py-2 text-sm" placeholder="Detalle obligatorio" value={discrepancia.detalle} onChange={(e) => actualizarDiscrepancia(index, discrepanciaIndex, { detalle: e.target.value })} />
                  <Button type="button" variant="ghost" onClick={() => quitarDiscrepancia(index, discrepanciaIndex)}>Quitar</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => agregarDiscrepancia(index)}>Agregar discrepancia</Button>
            </section>
          );
        })}
      </div>

      {mensaje && <p role="status" className={`rounded-md p-3 text-sm ${mensaje.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{mensaje.texto}</p>}
      <Button type="submit" disabled={enviando || depositos.length === 0}>{enviando ? "Registrando…" : "Confirmar recepción"}</Button>
    </form>
  );
}
