/**
 * @layout TiendaLayout
 * @description HU-E1 — Layout del storefront público (`app/(tienda)/**`).
 * Independiente del layout del ERP (`(dashboard)`): el Cliente Web nunca ve
 * rutas ni navegación del ERP administrativo (spec_modulo_E.md, ⚠️ Alcance).
 * Mobile-first (RULES.md §3).
 */
import Link from "next/link";
import { ShoppingCart, Store } from "lucide-react";
import { BotonSalirTienda } from "@/components/tienda/BotonSalirTienda";
import { obtenerCarrito } from "@/lib/services/ecommerce/carrito.service";
import { resolverContextoTienda } from "@/lib/services/ecommerce/contexto-tienda";

export default async function TiendaLayout({ children }: { children: React.ReactNode }) {
  const contexto = await resolverContextoTienda();
  const carrito = await obtenerCarrito(contexto.carrito).catch(() => null);

  return (
    <div className="min-h-dvh flex flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/tienda/catalogo" className="flex items-center gap-2 font-semibold">
            <Store className="size-5" aria-hidden />
            <span>SWAT Tienda</span>
          </Link>

          <nav className="ml-auto flex items-center gap-2 text-sm">
            {contexto.sesion ? (
              <>
                <span className="hidden text-slate-600 sm:inline">{contexto.sesion.email}</span>
                <BotonSalirTienda />
              </>
            ) : (
              <Link href="/tienda/ingresar" className="rounded-md px-2 py-1 hover:bg-slate-100">
                Ingresar
              </Link>
            )}
            <Link
              href="/tienda/carrito"
              className="relative flex items-center gap-1 rounded-md px-2 py-1 hover:bg-slate-100"
              aria-label={`Carrito: ${carrito?.cantidad_items ?? 0} artículos`}
            >
              <ShoppingCart className="size-5" aria-hidden />
              {carrito && carrito.cantidad_items > 0 && (
                <span className="rounded-full bg-slate-900 px-1.5 text-xs font-medium text-white">
                  {carrito.cantidad_items}
                </span>
              )}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t bg-white py-4 text-center text-xs text-slate-500">
        SWAT Indumentarias — retiro en Sucursal Salta (Click &amp; Collect)
      </footer>
    </div>
  );
}
