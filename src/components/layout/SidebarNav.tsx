"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: ReactNode;
  /**
   * Sub-ítems anidados debajo de este ítem (ej.: "Auditoría del Inventario"
   * bajo "Auditoría Forense" — reorganización de navegación post-HU-A7).
   * Sin patrón previo de anidamiento en el sidebar; este es el primero.
   * Se renderizan siempre expandidos (sin acordeón) para no sumar estado ni
   * complejidad de interacción a un menú con muy pocos niveles. El acordeón
   * vive a nivel de sección (`SidebarNavSection`), no de ítem.
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

/** True si el pathname actual cae dentro de algún ítem (o sub-ítem) de la sección. */
function seccionContieneRuta(
  section: SidebarNavSection,
  pathname: string,
): boolean {
  return section.items.some(
    (item) =>
      esRutaActiva(pathname, item.href) ||
      (item.children?.some((child) => esRutaActiva(pathname, child.href)) ??
        false),
  );
}

/* ------------------------------------------------------------------------- *
 * Preferencia manual de expansión/colapso por sección (persistida)
 *
 * Se modela como store externo (`useSyncExternalStore`) y NO como
 * `useState` + `useEffect`: así no sincronizamos estado dentro de un efecto
 * (regla `react-hooks/set-state-in-effect`) y el snapshot de servidor puede
 * ser vacío, dando una hidratación estable — la preferencia real de
 * localStorage se aplica en el primer commit del cliente.
 * ------------------------------------------------------------------------- */

/** Distinta del rail colapsado (`colapsado`), que es efímero por sesión. */
const LS_SECCIONES_ABIERTAS = "swat:sidebar:secciones-abiertas";

const OVERRIDES_VACIO: Record<string, boolean> = {};
const overridesListeners = new Set<() => void>();
let overridesSnapshot: Record<string, boolean> = OVERRIDES_VACIO;
let overridesHidratado = false;

/** Parseo tolerante: JSON corrupto o valor no-objeto → sin preferencias. */
function parsearOverrides(raw: string | null): Record<string, boolean> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, boolean>)
      : OVERRIDES_VACIO;
  } catch {
    return OVERRIDES_VACIO;
  }
}

function onStorageOverrides(e: StorageEvent) {
  // `key === null` => localStorage.clear() en otra pestaña.
  if (e.key !== null && e.key !== LS_SECCIONES_ABIERTAS) return;
  overridesSnapshot = parsearOverrides(e.key === null ? null : e.newValue);
  overridesListeners.forEach((l) => l());
}

function suscribirOverrides(callback: () => void) {
  if (overridesListeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorageOverrides);
  }
  overridesListeners.add(callback);
  return () => {
    overridesListeners.delete(callback);
    if (overridesListeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorageOverrides);
    }
  };
}

function getOverridesSnapshot(): Record<string, boolean> {
  if (!overridesHidratado && typeof window !== "undefined") {
    overridesHidratado = true;
    overridesSnapshot = parsearOverrides(
      window.localStorage.getItem(LS_SECCIONES_ABIERTAS),
    );
  }
  return overridesSnapshot;
}

function getOverridesServerSnapshot(): Record<string, boolean> {
  return OVERRIDES_VACIO;
}

function setSeccionAbierta(label: string, abierta: boolean) {
  overridesSnapshot = { ...overridesSnapshot, [label]: abierta };
  try {
    window.localStorage.setItem(
      LS_SECCIONES_ABIERTAS,
      JSON.stringify(overridesSnapshot),
    );
  } catch {
    /* localStorage no disponible (modo privado, cuota llena) — no persistimos */
  }
  overridesListeners.forEach((l) => l());
}

export function SidebarNav({ sections }: SidebarNavProps) {
  const pathname = usePathname();
  const [abiertoMobile, setAbiertoMobile] = useState(false);
  const [colapsado, setColapsado] = useState(false);

  const overrides = useSyncExternalStore(
    suscribirOverrides,
    getOverridesSnapshot,
    getOverridesServerSnapshot,
  );

  const seccionActivaLabel =
    sections.find((s) => seccionContieneRuta(s, pathname))?.label ?? null;

  /**
   * Estado efectivo de una sección: la ruta activa SIEMPRE gana (se abre al
   * cargar/navegar aunque el usuario la haya colapsado antes). Si no es la
   * activa, vale la preferencia manual persistida y, por defecto, abierta
   * (mismo comportamiento visual que antes del acordeón).
   */
  function seccionAbierta(label: string): boolean {
    if (label === seccionActivaLabel) return true;
    return overrides[label] ?? true;
  }

  /** Ítems de una sección (con sub-ítems anidados). Idéntico en modo rail y expandido. */
  function renderItems(section: SidebarNavSection) {
    return section.items.map((item) => {
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
            <div
              className={cn(
                "flex flex-col gap-1",
                colapsado ? "mx-1" : "ml-4 border-l border-gray-100 pl-2",
              )}
            >
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
    });
  }

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

              {colapsado ? (
                /* Rail colapsado: sin acordeón — solo el ícono de la sección y
                   los ítems siempre visibles (no hay espacio para header/chevron). */
                <>
                  <div
                    className="flex justify-center text-slate-500 py-1"
                    title={section.label}
                  >
                    {section.icon}
                  </div>
                  <hr className="my-2 border-t border-gray-100 mx-4" aria-hidden="true" />
                  <div className="flex flex-col gap-1">{renderItems(section)}</div>
                </>
              ) : (
                <Collapsible
                  open={seccionAbierta(section.label)}
                  onOpenChange={(open) => setSeccionAbierta(section.label, open)}
                >
                  {/* Título de sección sutil — ahora es el trigger del colapsable */}
                  <CollapsibleTrigger className="group/sec flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-700 whitespace-nowrap">
                    <span className="text-slate-500">{section.icon}</span>
                    <span className="flex-1 text-left">{section.label}</span>
                    <ChevronDown
                      className="size-3.5 shrink-0 text-slate-400 transition-transform duration-200 group-data-[panel-open]/sec:rotate-180"
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>

                  <CollapsiblePanel>
                    <hr className="my-2 border-t border-gray-100 mx-2" aria-hidden="true" />
                    <div className="flex flex-col gap-1">{renderItems(section)}</div>
                  </CollapsiblePanel>
                </Collapsible>
              )}
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
