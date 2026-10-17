/**
 * @layout TiendaLayout
 * @description HU-E1 — Layout del storefront público (`app/(tienda)/**`).
 * Independiente del layout del ERP (`(dashboard)`): el Cliente Web nunca ve
 * rutas ni navegación del ERP administrativo (spec_modulo_E.md, ⚠️ Alcance).
 * Mobile-first (RULES.md §3).
 */
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { BotonSalirTienda } from "@/components/tienda/BotonSalirTienda";
import { MenuTiendaMovil } from "@/components/tienda/MenuTiendaMovil";
import { LogoSwat } from "@/components/tienda/LogoSwat";
import { TiendaMotionProvider } from "@/components/tienda/TiendaMotionProvider";
import { ThemeSelector } from "@/components/theme/ThemeSelector";
import { obtenerCarrito } from "@/lib/services/ecommerce/carrito.service";
import { resolverContextoTienda } from "@/lib/services/ecommerce/contexto-tienda";

export default async function TiendaLayout({ children }: { children: React.ReactNode }) {
  const contexto = await resolverContextoTienda();
  const carrito = await obtenerCarrito(contexto.carrito).catch(() => null);

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-[68px] max-w-[1440px] items-center gap-5 px-5 sm:px-8">
          <Link href="/tienda" aria-label="SWAT Indumentarias, inicio" className="flex min-w-0 items-center gap-2.5">
            <LogoSwat />
          </Link>

          <nav className="ml-8 hidden items-center gap-7 text-xs text-muted-foreground lg:flex" aria-label="Navegación principal">
            <Link href="/tienda" className="transition-colors hover:text-foreground">Inicio</Link>
            <Link href="/tienda/catalogo" className="transition-colors hover:text-foreground">Catálogo</Link>
            <Link href="/tienda#categorias" className="transition-colors hover:text-foreground">Categorías</Link>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 text-sm sm:gap-3">
            <ThemeSelector compactOnMobile />
            {contexto.sesion ? (
              <div className="hidden items-center gap-2 lg:flex">
                <Link href="/tienda/cuenta" className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                  Mi cuenta
                </Link>
                <BotonSalirTienda />
              </div>
            ) : (
              <Link href="/tienda/ingresar" className="hidden rounded-md px-2 py-1 text-xs hover:bg-accent lg:inline-flex">
                Ingresar
              </Link>
            )}
            <Link
              href="/tienda/carrito"
              className="relative flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-accent"
              aria-label={`Carrito: ${carrito?.cantidad_items ?? 0} artículos`}
            >
              <ShoppingCart className="size-4" aria-hidden />
              {carrito && carrito.cantidad_items > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                  {carrito.cantidad_items}
                </span>
              )}
            </Link>
            <MenuTiendaMovil sesion={Boolean(contexto.sesion)} />
          </div>
        </div>
      </header>

      <main className="tienda-main w-full flex-1"><TiendaMotionProvider>{children}</TiendaMotionProvider></main>

      <footer className="border-t bg-background px-5 py-7 text-center text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">SWAT INDUMENTARIAS</span><span className="mx-3">·</span>Retiro en Sucursal Salta (Click &amp; Collect)
      </footer>
    </div>
  );
}
