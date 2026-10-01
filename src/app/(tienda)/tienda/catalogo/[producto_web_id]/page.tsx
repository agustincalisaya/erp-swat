/**
 * @page DetalleProductoTienda
 * @route /tienda/catalogo/[producto_web_id]
 * @description HU-E1 (CA1/CA2/CA3) — detalle público de un producto con sus
 * variantes reales de Módulo A, disponible del depósito web y precio vigente.
 */
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SelectorVarianteWeb } from "@/components/tienda/SelectorVarianteWeb";
import { ServiceError } from "@/lib/errors/service-error";
import { ProductoWebIdSchema } from "@/lib/schemas/ecommerce.schema";
import { obtenerDetalleProductoWeb } from "@/lib/services/ecommerce/catalogo-web.service";

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

  return (
    <div className="space-y-4">
      <Link href="/tienda/catalogo" className="text-sm text-slate-600 hover:underline">
        ← Volver al catálogo
      </Link>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          {producto.fotos.map((url, indice) => (
            <Image
              key={url}
              src={url}
              alt={`${producto.titulo} — foto ${indice + 1}`}
              width={800}
              height={800}
              unoptimized
              className="w-full rounded-lg object-cover"
            />
          ))}
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase text-slate-500">{producto.categoria}</p>
            <h1 className="text-2xl font-semibold">{producto.titulo}</h1>
          </div>
          <p className="text-sm text-slate-700">{producto.descripcion}</p>
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
      </div>
    </div>
  );
}
