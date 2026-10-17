/**
 * @page DetalleProductoTienda
 * @route /tienda/catalogo/[producto_web_id]
 * @description HU-E1 (CA1/CA2/CA3) — detalle público de un producto con sus
 * variantes reales de Módulo A, disponible del depósito web y precio vigente.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SelectorVarianteWeb } from "@/components/tienda/SelectorVarianteWeb";
import { GaleriaProducto } from "@/components/tienda/GaleriaProducto";
import { fotoPublicaProducto } from "@/components/tienda/foto-publica";
import { ServiceError } from "@/lib/errors/service-error";
import { ProductoWebIdSchema } from "@/lib/schemas/ecommerce.schema";
import { obtenerDetalleProductoWeb } from "@/lib/services/ecommerce/catalogo-web.service";
import styles from "./detalle.module.css";

export const metadata: Metadata = { title: "Producto | SWAT Indumentarias" };

export default async function DetalleProductoTiendaPage({
  params,
}: {
  params: Promise<{ producto_web_id: string }>;
}) {
  const id = ProductoWebIdSchema.safeParse((await params).producto_web_id);
  if (!id.success) notFound();

  const producto = await obtenerDetalleProductoWeb(id.data).catch((err: unknown) => {
    if (err instanceof ServiceError && err.code === "PRODUCTO_WEB_NO_ENCONTRADO") return null;
    throw err;
  });
  if (!producto) notFound();
  const fotos = producto.fotos.map(fotoPublicaProducto).filter((foto): foto is string => foto !== null);

  return (
    <div className={styles.detail} data-tienda-wide lang="es-AR">
      <div className={styles.inner}>
        <nav className={styles.breadcrumbs} aria-label="Ruta del producto">
          <Link href="/tienda">Inicio</Link><span aria-hidden="true">/</span><Link href="/tienda/catalogo">Catálogo</Link><span aria-hidden="true">/</span><span aria-current="page">{producto.titulo}</span>
        </nav>
        <div className={styles.productLayout}>
          <GaleriaProducto titulo={producto.titulo} fotos={fotos} />
          <div className={styles.productSide}>
            <p className={styles.category}>{producto.categoria}</p>
            <h1>{producto.titulo}</h1>
            <p className={styles.description}>{producto.descripcion}</p>
            <div className={styles.buyPanel}>
              <SelectorVarianteWeb
                variantes={producto.variantes.map((v) => ({
                  variante_sku_id: v.variante_sku_id,
                  etiqueta: `${v.modelo} · ${v.color} · Talle ${v.talle} · ${v.genero}`,
                  precio_venta: v.precio_venta,
                  disponible: v.disponible,
                  comprable: v.comprable,
                }))}
              />
            </div>
            <p className={styles.guidance}>Elegí una variante para ver su precio y disponibilidad actuales.</p>
          </div>
        </div>
        <Link href="/tienda/catalogo" className={styles.backLink}>← Seguir explorando la colección</Link>
      </div>
    </div>
  );
}
