"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: ReactNode;
  /**
   * Sub-ítems anidados debajo de este ítem (ej.: "Auditoría del Inventario"
   * bajo "Auditoría Forense" — reorganización de navegación post-HU-A7).
   * Sin patrón previo de anidamiento en el sidebar; este es el primero.
   * Se renderizan siempre expandidos (sin acordeón) para no sumar estado ni
   * complejidad de interacción a un menú con muy pocos niveles.
   */
  children?: SidebarNavItem[];
}

export interface SidebarNavSection {
  label: string;
  icon: ReactNode;
  items: SidebarNavItem[];
}

interface SidebarNavProps {
  sections: SidebarNavSection[];
}

function esRutaActiva(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ sections }: SidebarNavProps) {
  const pathname = usePathname();
  const [abiertoMobile, setAbiertoMobile] = useState(false);
  const [colapsado, setColapsado] = useState(false);

  return (
    <>
      {/* Botón mobile — abre/cierra el sidebar como off-canvas */}
      <button
        type="button"
        onClick={() => setAbiertoMobile((v) => !v)}
        className="lg:hidden fixed top-3 left-3 z-40 p-2 rounded-lg bg-white border border-border shadow-sm text-gray-700"
      >
        {abiertoMobile ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {/* Overlay mobile */}
      {abiertoMobile && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/30"
          onClick={() => setAbiertoMobile(false)}
          aria-hidden="true"
        />
      )}

      <nav
        className={cn(
          "relative fixed lg:static inset-y-0 left-0 z-30 shrink-0 bg-white border-r border-border",
          "flex flex-col transition-all duration-300 ease-in-out py-3", 
          abiertoMobile ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0",
          colapsado ? "lg:w-[72px]" : "lg:w-64"
        )}
      >
        <button
          onClick={() => setColapsado(!colapsado)}
          className="hidden lg:flex absolute top-4 -right-3 z-50 items-center justify-center size-6 rounded-full border border-gray-200 bg-white shadow-sm text-gray-500 hover:text-blue-600 hover:border-blue-200 focus:outline-none"
          title={colapsado ? "Expandir menú" : "Colapsar menú"}
        >
          {colapsado ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />}
        </button>

        {/* HEADER DEL SIDEBAR - LOGO RENOVADO CON AZUL RELUCIENTE */}
        {/* El logo es un enlace al home: conserva las clases exactas del div;
            `block` mantiene el layout de bloque del anchor y Tailwind preflight
            evita el azul/subrayado por defecto de los links. */}
        <Link
          href="/"
          onClick={() => setAbiertoMobile(false)}
          title={colapsado ? "Ir al inicio" : undefined}
          className={cn("block px-4 mb-4 mt-14 lg:mt-0", colapsado ? "text-center px-0" : "")}
        >
          {!colapsado ? (
            <div className="whitespace-nowrap overflow-hidden">
              <span className="text-base font-extrabold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-tight">
                SWAT
              </span>
              <p className="text-xs font-medium text-slate-400">Indumentarias</p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-8 w-8 mx-auto bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs rounded-md shadow-sm shadow-blue-500/30">
              SW
            </div>
          )}
        </Link>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-2">
          <hr className={cn("my-2 border-t border-gray-100", colapsado ? "mx-4" : "mx-2")} aria-hidden="true" />
          {sections.map((section, index) => (
            <div key={section.label} className="mb-4">
              
              {index > 0 && (
                <hr className={cn("my-2 border-t border-gray-100", colapsado ? "mx-4" : "mx-2")} aria-hidden="true" />
              )}

              {/* Título de sección sutil */}
              {!colapsado ? (
                <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-700 whitespace-nowrap">
                  <span className="text-slate-500">{section.icon}</span>
                  {section.label}
                </div>
              ) : (
                <div 
                  className="flex justify-center text-slate-500 py-1"
                  title={section.label} 
                >
                  {section.icon}
                </div>
              )}

              <hr className={cn("my-2 border-t border-gray-100", colapsado ? "mx-4" : "mx-2")} aria-hidden="true" />

              <div className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const activo = esRutaActiva(pathname, item.href);
                  return (
                    <div key={item.href} className="flex flex-col gap-1">
                      <Link
                        href={item.href}
                        onClick={() => setAbiertoMobile(false)}
                        title={colapsado ? item.label : undefined}
                        className={cn(
                          "flex items-center rounded-lg transition-colors group",
                          colapsado ? "justify-center py-2.5 px-0 mx-1" : "gap-3 px-3 py-2",
                          activo
                            ? "bg-blue-50 text-blue-700 font-semibold"
                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium",
                        )}
                        aria-current={activo ? "page" : undefined}
                      >
                        {item.icon}
                        {!colapsado && (
                          <span className="text-sm whitespace-nowrap overflow-hidden transition-all">
                            {item.label}
                          </span>
                        )}
                      </Link>

                      {/* Sub-ítems anidados — siempre expandidos, sin acordeón */}
                      {item.children && item.children.length > 0 && (
                        <div className={cn("flex flex-col gap-1", colapsado ? "mx-1" : "ml-4 border-l border-gray-100 pl-2")}>
                          {item.children.map((child) => {
                            const childActivo = esRutaActiva(pathname, child.href);
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={() => setAbiertoMobile(false)}
                                title={colapsado ? child.label : undefined}
                                className={cn(
                                  "flex items-center rounded-lg transition-colors group",
                                  colapsado ? "justify-center py-2 px-0" : "gap-3 px-3 py-1.5",
                                  childActivo
                                    ? "bg-blue-50 text-blue-700 font-semibold"
                                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 font-medium",
                                )}
                                aria-current={childActivo ? "page" : undefined}
                              >
                                {child.icon}
                                {!colapsado && (
                                  <span className="text-sm whitespace-nowrap overflow-hidden transition-all">
                                    {child.label}
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}