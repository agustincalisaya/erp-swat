"use client";

/**
 * @module ui/tabs
 * @description Wrapper sobre `@base-ui/react/tabs` (HU-A6 Ajustes — UI de
 * Variantes, decisión D5): expone `TabsRoot/List/Tab/Panel/Indicator` con la
 * paleta azul Tailwind (`blue-*`, criterio 11) y el mismo patrón de los otros
 * wrappers de `src/components/ui/` (re-export de primitivas con `data-slot`).
 *
 * Los tabs son navegación real (links que actualizan `?tab=` en la URL), por
 * eso el `Tab` acepta el prop `render` de Base UI para envolver un
 * `next/link` (ver `TabsActivasInactivas.tsx`). El indicador se posiciona
 * dentro del `List` (que es `relative`) con `data-active` del tab activo.
 */
import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

function TabsRoot({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs-root"
      className={cn("w-full", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex w-full items-center gap-1 rounded-xl border border-blue-100 bg-blue-50/60 p-1 sm:w-auto",
        className,
      )}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "relative z-10 inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium text-blue-700 outline-none transition-colors",
        "cursor-pointer select-none hover:text-blue-900 focus-visible:ring-2 focus-visible:ring-blue-500/40",
        "data-active:text-blue-900 data-active:font-semibold",
        "disabled:pointer-events-none disabled:opacity-50 sm:flex-none",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("mt-4", className)}
      {...props}
    />
  );
}

function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute inset-y-1 z-0 rounded-lg bg-white shadow-sm ring-1 ring-blue-200 transition-all",
        className,
      )}
      {...props}
    />
  );
}

export { TabsRoot, TabsList, TabsTab, TabsPanel, TabsIndicator };