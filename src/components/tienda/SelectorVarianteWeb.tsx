"use client";

/**
 * @component SelectorVarianteWeb
 * @description HU-E1 — elegir variante (modelo/color/talle/género reales de
 * Módulo A) y agregarla al carrito vía `POST /api/tienda/carrito/items`. El
 * botón se deshabilita si la variante no es comprable o no tiene stock en el
 * depósito web; el servidor lo revalida igual (defensa en profundidad).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearPrecio, type ErrorApiTienda } from "@/components/tienda/formato";

export interface OpcionVarianteWeb {
  variante_sku_id: string;
  etiqueta: string;
  precio_venta: number | null;
  disponible: number;
  comprable: boolean;
}

export function SelectorVarianteWeb({ variantes }: { variantes: OpcionVarianteWeb[] }) {
  const router = useRouter();
  const inicial = variantes.find((v) => v.comprable && v.disponible > 0) ?? variantes[0];
  const [seleccionada, setSeleccionada] = useState(inicial?.variante_sku_id ?? "");
  const [cantidad, setCantidad] = useState(1);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();

  const variante = variantes.find((v) => v.variante_sku_id === seleccionada);
  if (!variante) return <p className="text-sm text-slate-600">Este producto no tiene variantes disponibles.</p>;

  const agotada = variante.comprable && variante.disponible <= 0;
  const puedeAgregar = variante.comprable && variante.disponible > 0 && cantidad <= variante.disponible;

  const agregar = () => {
    setMensaje(null);
    startTransition(async () => {
      const res = await fetch("/api/tienda/carrito/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variante_sku_id: variante.variante_sku_id, cantidad }),
      });
      const cuerpo = (await res.json()) as { error: ErrorApiTienda | null };
      if (!res.ok || cuerpo.error) {
        setMensaje({ tipo: "error", texto: cuerpo.error?.message ?? "No se pudo agregar al carrito" });
      } else {
        setMensaje({ tipo: "ok", texto: "Agregado al carrito" });
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="variante">Variante</Label>
        <select
          id="variante"
          className="w-full rounded-md border bg-white px-3 py-2 text-sm"
          value={seleccionada}
          onChange={(e) => {
            setSeleccionada(e.target.value);
            setCantidad(1);
            setMensaje(null);
          }}
        >
          {variantes.map((v) => (
            <option key={v.variante_sku_id} value={v.variante_sku_id}>
              {v.etiqueta}
              {!v.comprable ? " — no disponible" : v.disponible <= 0 ? " — agotado" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        {variante.precio_venta !== null ? (
          <p className="text-2xl font-semibold">{formatearPrecio(variante.precio_venta)}</p>
        ) : (
          <p className="text-slate-600">Sin precio disponible</p>
        )}
        <p className="text-sm text-slate-600">
          {!variante.comprable
            ? "Este artículo no está disponible para la compra online."
            : agotada
              ? "Agotado"
              : `${variante.disponible} disponible${variante.disponible === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="w-24 space-y-1">
          <Label htmlFor="cantidad">Cantidad</Label>
          <Input
            id="cantidad"
            type="number"
            min={1}
            max={Math.max(1, variante.disponible)}
            value={cantidad}
            onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <Button className="flex-1" disabled={!puedeAgregar || pendiente} onClick={agregar}>
          {agotada ? "Agotado" : "Agregar al carrito"}
        </Button>
      </div>

      {mensaje && (
        <Alert variant={mensaje.tipo === "error" ? "destructive" : "default"}>
          <AlertDescription>{mensaje.texto}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
