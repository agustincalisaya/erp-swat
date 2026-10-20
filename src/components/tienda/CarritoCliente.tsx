"use client";

/**
 * @component CarritoCliente
 * @description HU-E1 — interacción del carrito: cambiar cantidad, quitar
 * (baja lógica en el servidor) e iniciar la compra.
 *
 * CA4: cada ítem no comprable muestra un aviso que lo identifica, y si el
 * checkout responde 422 ARTICULO_NO_DISPONIBLE se marcan los ítems que
 * devolvió el servidor (`details.items[]`). CA6: sin sesión, "Ingresar para
 * comprar" lleva al ingreso y vuelve al carrito.
 *
 * HU-E15 (E15-1/E15-2): con sesión vinculada el botón dice "Proceder al pago";
 * el aviso informa el plazo de la reserva en minutos (`plazoReservaMinutos`,
 * leído en el servidor). Sin plazo disponible, o con la cuenta pendiente de
 * vinculación, se conserva el texto genérico.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImageOff, ShoppingBag, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatearPrecio, type ErrorApiTienda } from "@/components/tienda/formato";
import { ETIQUETA_MOTIVO } from "@/lib/services/ecommerce/comprabilidad";
import type { CarritoVista } from "@/lib/services/ecommerce/carrito.service";
import { fotoPublicaProducto } from "@/components/tienda/foto-publica";
import styles from "@/components/tienda/compra.module.css";

/**
 * HU-E15 (E15-2): aviso del plazo de la reserva. Recibe solo minutos (nunca la
 * clave ni las horas). Sin minutos: texto genérico, sin número ni default.
 */
export function AvisoPlazoReserva({ minutos }: { minutos: number | null }) {
  return (
    <p className={styles.summaryNote}>
      {minutos === null
        ? "Al iniciar la compra reservamos el stock por un tiempo limitado mientras completás el pago."
        : `Al proceder al pago reservamos tu stock durante ${minutos} minutos: esa cantidad deja de estar disponible para otros compradores. Si el pago no se confirma en ese plazo, la reserva se libera.`}
    </p>
  );
}

export function CarritoCliente({
  carrito,
  conSesion,
  compraBloqueada = false,
  plazoReservaMinutos = null,
}: {
  carrito: CarritoVista;
  conSesion: boolean;
  compraBloqueada?: boolean;
  plazoReservaMinutos?: number | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<ErrorApiTienda | null>(null);
  const reducirMovimiento = useReducedMotion();

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
      <div className={styles.empty}>
        <span className={styles.emptyIcon}><ShoppingBag aria-hidden="true" size={28} /></span>
        <h2>Tu carrito está vacío</h2>
        <p>Explorá el catálogo y elegí los artículos que querés llevar.</p>
        <Link href="/tienda/catalogo" className={`${buttonVariants({ variant: "outline" })} ${styles.secondaryAction}`}>
          Explorar catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.cartGrid}>
      <ul className={styles.items} aria-label="Artículos del carrito">
        {carrito.items.map((item) => {
          const conProblema = !item.comprable || !item.stock_suficiente || bloqueados.has(item.variante_sku_id);
          const foto = fotoPublicaProducto(item.foto_url);
          return (
            <motion.li key={item.item_id} className={`${styles.item} ${conProblema ? styles.itemProblem : ""}`}
              initial={false} whileHover={reducirMovimiento ? undefined : { y: -2 }} transition={{ duration: 0.18 }}>
                  <div className={styles.photo}>
                    {foto ? <Image src={foto} alt={item.titulo} width={128} height={150} unoptimized /> :
                      <span className={styles.photoFallback}><ImageOff size={23} aria-hidden="true" />Imagen no disponible</span>}
                  </div>
                  <div className={styles.itemInfo}>
                    <h2 className={styles.itemName}>{item.titulo}</h2>
                    <p className={styles.itemMeta}>
                      {item.modelo} · {item.color} · Talle {item.talle} · {item.genero} — {item.sku}
                    </p>
                    {item.precio_unitario !== null && (
                      <p className={styles.unitPrice}>{formatearPrecio(item.precio_unitario)} c/u</p>
                    )}
                    {!item.comprable && item.motivo && (
                      <p className={styles.itemWarning} role="alert">
                        <AlertTriangle className="size-4" aria-hidden />
                        {ETIQUETA_MOTIVO[item.motivo]}. Quitalo para poder continuar.
                      </p>
                    )}
                    {item.comprable && !item.stock_suficiente && (
                      <p className={styles.itemWarning} role="alert">
                        <AlertTriangle className="size-4" aria-hidden />
                        {item.disponible > 0 ? `Solo quedan ${item.disponible} disponibles.` : "Agotado."}
                      </p>
                    )}
                    <div className={styles.itemActions}>
                      <label className={styles.quantityField}>
                        Cantidad
                      <Input
                        type="number"
                        min={1}
                        className={styles.quantityInput}
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
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={styles.removeButton}
                        disabled={pendiente}
                        onClick={() => llamar(`/api/tienda/carrito/items/${item.item_id}`, { method: "DELETE" })}
                      >
                        <Trash2 size={16} aria-hidden="true" /> Quitar
                      </Button>
                    </div>
                  </div>
                  {item.subtotal !== null && item.comprable && (
                    <p className={styles.itemSubtotal} aria-label={`Subtotal ${formatearPrecio(item.subtotal)}`}>{formatearPrecio(item.subtotal)}</p>
                  )}
            </motion.li>
          );
        })}
      </ul>

      <aside aria-label="Resumen de compra">
        <div className={styles.summary}>
            <p className={styles.summaryKicker}>Antes de continuar</p>
            <h2>Resumen de compra</h2>
            <div className={styles.totalRow}>
              <span>Total</span>
              <strong>{formatearPrecio(carrito.total)}</strong>
            </div>
            {/* P3: la cuenta pendiente no tiene acción de checkout → texto genérico. */}
            <AvisoPlazoReserva minutos={compraBloqueada ? null : plazoReservaMinutos} />
            {conSesion && (
              <label className={styles.couponField}>Código de cupón (opcional)
              <Input
                aria-label="Código de cupón"
                className={styles.couponInput}
                value={cuponCodigo}
                maxLength={50}
                disabled={pendiente}
                onChange={(e) => setCuponCodigo(e.target.value.toUpperCase())}
              />
              </label>
            )}
            {!compraBloqueada && (
              <Button className={styles.primaryAction} disabled={pendiente} onClick={iniciarCompra}>
                {pendiente ? "Procesando…" : conSesion ? "Proceder al pago" : "Ingresar para comprar"}
              </Button>
            )}
        </div>

        {error && (
          <Alert variant="destructive" role="alert" className={styles.error}>
            <AlertTitle>No pudimos completar la acción</AlertTitle>
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
