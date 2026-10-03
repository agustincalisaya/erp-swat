"use client";

/**
 * @component CarritoCliente
 * @description HU-E1 — interacción del carrito: cambiar cantidad, quitar
 * (baja lógica en el servidor) e iniciar la compra.
 *
 * CA4: cada ítem no comprable muestra un aviso que lo identifica, y si el
 * checkout responde 422 ARTICULO_NO_DISPONIBLE se marcan los ítems que
 * devolvió el servidor (`details.items[]`). CA6: sin sesión, "Iniciar compra"
 * lleva al ingreso y vuelve al carrito.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatearPrecio, type ErrorApiTienda } from "@/components/tienda/formato";
import { ETIQUETA_MOTIVO } from "@/lib/services/ecommerce/comprabilidad";
import type { CarritoVista } from "@/lib/services/ecommerce/carrito.service";

export function CarritoCliente({ carrito, conSesion, compraBloqueada = false }: { carrito: CarritoVista; conSesion: boolean; compraBloqueada?: boolean }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<ErrorApiTienda | null>(null);

  const bloqueados = new Set(
    error?.code === "ARTICULO_NO_DISPONIBLE" || error?.code === "STOCK_INSUFICIENTE"
      ? (error.details?.items ?? []).map((i) => i.variante_sku_id)
      : [],
  );

  const llamar = (url: string, init: RequestInit) =>
    startTransition(async () => {
      setError(null);
      const res = await fetch(url, init);
      const cuerpo = (await res.json()) as { data: unknown; error: ErrorApiTienda | null };
      if (cuerpo.error) setError(cuerpo.error);
      router.refresh();
    });

  const [cuponCodigo, setCuponCodigo] = useState("");

  const iniciarCompra = () =>
    startTransition(async () => {
      setError(null);
      // HU-E2: solo viaja el código del cupón; el importe lo calcula el servidor (CA5).
      const cupon = cuponCodigo.trim();
      const res = await fetch("/api/tienda/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cupon ? { cupon_codigo: cupon } : {}),
      });
      const cuerpo = (await res.json()) as { data: { pedido_venta_id: string } | null; error: ErrorApiTienda | null };
      if (res.status === 401) {
        router.push("/tienda/ingresar?redirect=/tienda/carrito");
        return;
      }
      // HU-E2: el pedido se reservó pero Mercado Pago no respondió: la pantalla
      // del pedido reintenta generar el pago.
      if (cuerpo.error?.details?.pedido_venta_id) {
        router.push(`/tienda/checkout/pendiente?pedido=${cuerpo.error.details.pedido_venta_id}`);
        return;
      }
      if (cuerpo.error || !cuerpo.data) {
        setError(cuerpo.error ?? { code: "INTERNAL_ERROR", message: "No se pudo iniciar la compra" });
        router.refresh();
        return;
      }
      // El pedido que devolvió ESTE checkout (D10: puede haber varios pendientes).
      router.push(`/tienda/checkout/pendiente?pedido=${cuerpo.data.pedido_venta_id}`);
      router.refresh();
    });

  if (carrito.items.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Tu carrito está vacío.</p>
        <Link href="/tienda/catalogo" className={buttonVariants({ variant: "outline" })}>
          Ver catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <ul className="space-y-3">
        {carrito.items.map((item) => {
          const conProblema = !item.comprable || !item.stock_suficiente || bloqueados.has(item.variante_sku_id);
          return (
            <li key={item.item_id}>
              <Card className={conProblema ? "border-amber-400" : undefined}>
                <CardContent className="flex gap-3 pt-4">
                  {item.foto_url && (
                    <Image
                      src={item.foto_url}
                      alt={item.titulo}
                      width={80}
                      height={80}
                      unoptimized
                      className="size-20 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">{item.titulo}</p>
                    <p className="text-xs text-slate-600">
                      {item.modelo} · {item.color} · Talle {item.talle} · {item.genero} — {item.sku}
                    </p>
                    {item.precio_unitario !== null && (
                      <p className="text-sm">{formatearPrecio(item.precio_unitario)} c/u</p>
                    )}
                    {!item.comprable && item.motivo && (
                      <p className="flex items-center gap-1 text-sm text-amber-700" role="alert">
                        <AlertTriangle className="size-4" aria-hidden />
                        {ETIQUETA_MOTIVO[item.motivo]}. Quitalo para poder continuar.
                      </p>
                    )}
                    {item.comprable && !item.stock_suficiente && (
                      <p className="flex items-center gap-1 text-sm text-amber-700" role="alert">
                        <AlertTriangle className="size-4" aria-hidden />
                        {item.disponible > 0 ? `Solo quedan ${item.disponible} disponibles.` : "Agotado."}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Input
                        type="number"
                        min={1}
                        className="w-20"
                        aria-label={`Cantidad de ${item.sku}`}
                        defaultValue={item.cantidad}
                        disabled={pendiente || !item.comprable}
                        onBlur={(e) => {
                          const cantidad = Number(e.target.value);
                          if (Number.isInteger(cantidad) && cantidad > 0 && cantidad !== item.cantidad) {
                            llamar(`/api/tienda/carrito/items/${item.item_id}`, {
                              method: "PATCH",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ cantidad }),
                            });
                          }
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendiente}
                        onClick={() => llamar(`/api/tienda/carrito/items/${item.item_id}`, { method: "DELETE" })}
                      >
                        <Trash2 aria-hidden /> Quitar
                      </Button>
                    </div>
                  </div>
                  {item.subtotal !== null && item.comprable && (
                    <p className="shrink-0 text-sm font-medium">{formatearPrecio(item.subtotal)}</p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <aside className="space-y-3">
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatearPrecio(carrito.total)}</span>
            </div>
            <p className="text-xs text-slate-600">
              Al iniciar la compra reservamos el stock por un tiempo limitado mientras completás el pago.
            </p>
            {conSesion && (
              <Input
                placeholder="Código de cupón (opcional)"
                aria-label="Código de cupón"
                value={cuponCodigo}
                maxLength={50}
                disabled={pendiente}
                onChange={(e) => setCuponCodigo(e.target.value.toUpperCase())}
              />
            )}
            {!compraBloqueada && (
              <Button className="w-full" disabled={pendiente} onClick={iniciarCompra}>
                {conSesion ? "Iniciar compra" : "Ingresar para comprar"}
              </Button>
            )}
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>No pudimos iniciar la compra</AlertTitle>
            <AlertDescription>
              {error.message}
              {error.details?.items && error.details.items.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {error.details.items.map((i) => (
                    <li key={i.variante_sku_id}>
                      {i.sku}
                      {i.motivo && i.motivo in ETIQUETA_MOTIVO
                        ? ` — ${ETIQUETA_MOTIVO[i.motivo as keyof typeof ETIQUETA_MOTIVO]}`
                        : i.disponible !== undefined
                          ? ` — disponibles: ${i.disponible}`
                          : ""}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}
      </aside>
    </div>
  );
}
