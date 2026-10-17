"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { BotonSalirTienda } from "@/components/tienda/BotonSalirTienda";

export function MenuTiendaMovil({ sesion }: { sesion: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative lg:hidden">
      <button ref={botonRef} type="button" aria-label={abierto ? "Cerrar menú" : "Abrir menú"} aria-expanded={abierto} aria-controls="tienda-menu-movil" onClick={() => setAbierto((valor) => !valor)} className="grid size-10 place-items-center border border-border text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {abierto ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>
      {abierto && (
        <nav id="tienda-menu-movil" aria-label="Navegación móvil" onKeyDown={(evento) => { if (evento.key === "Escape") { setAbierto(false); botonRef.current?.focus(); } }} className="absolute right-0 top-full z-30 mt-3 flex min-w-52 flex-col gap-1 border border-border bg-background p-2 shadow-xl">
          <Link href="/tienda" onClick={() => setAbierto(false)} className="px-3 py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">Inicio</Link>
          <Link href="/tienda/catalogo" onClick={() => setAbierto(false)} className="px-3 py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">Catálogo</Link>
          <Link href="/tienda#categorias" onClick={() => setAbierto(false)} className="px-3 py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">Categorías</Link>
          <div className="my-1 border-t border-border" />
          {sesion ? <><Link href="/tienda/cuenta" onClick={() => setAbierto(false)} className="px-3 py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">Mi cuenta</Link><BotonSalirTienda /></> : <Link href="/tienda/ingresar" onClick={() => setAbierto(false)} className="px-3 py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">Ingresar</Link>}
        </nav>
      )}
    </div>
  );
}
