"use client";

/**
 * @component SidebarNav
 * @description Parte interactiva del Sidebar del dashboard (HU-D9,
 * task_cali_layout_dashboard.md §3). Recibe la lista de secciones YA
 * resuelta y filtrada por permisos desde `Sidebar.tsx` (Server Component)
 * — este componente no resuelve sesión ni permisos, solo estado de UI:
 * qué sección está activa según la ruta actual, y si el sidebar está
 * colapsado en mobile.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";

// Los íconos viajan ya renderizados (`ReactNode`), no como referencia al
// componente: un Server Component no puede pasarle una función (el
// componente de lucide-react en sí) a un Client Component — React solo
// serializa elementos ya renderizados a través de ese límite.
export interface SidebarNavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

export interface SidebarNavSection {
  label: string;
  icon: ReactNode;
  items: SidebarNavItem[];
}

interface SidebarNavProps {
  sections: SidebarNavSection[];
}

/** Activa si la ruta actual es exactamente el href, o una subruta de él. */
function esRutaActiva(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ sections }: SidebarNavProps) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      {/* Botón mobile — abre/cierra el sidebar como off-canvas */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="lg:hidden fixed top-3 left-3 z-40 p-2 rounded-lg bg-white border border-border shadow-sm text-gray-700"
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={abierto}
      >
        {abierto ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {/* Overlay mobile */}
      {abierto && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/30"
          onClick={() => setAbierto(false)}
          aria-hidden="true"
        />
      )}

      <nav
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-30 w-64 shrink-0 bg-white border-r border-border",
          "flex flex-col gap-1 overflow-y-auto p-3 transition-transform lg:translate-x-0",
          abierto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="px-2 py-3 mb-2">
          <span className="text-sm font-bold text-gray-900 tracking-tight">ERP SWAT</span>
          <p className="text-xs text-muted-foreground">Indumentarias</p>
        </div>

        {sections.map((section) => (
          <div key={section.label} className="mb-3">
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.icon}
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const activo = esRutaActiva(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setAbierto(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                      activo
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-muted hover:text-foreground",
                    )}
                    aria-current={activo ? "page" : undefined}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}
