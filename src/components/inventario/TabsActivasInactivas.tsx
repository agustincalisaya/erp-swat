"use client";

/**
 * @component TabsActivasInactivas
 * @description HU-A6 (decisión D5) — Tabs "Activas" (default) / "Inactivas"
 * (reporte solo lectura, Criterio 2) con estado en la URL (`?tab=`): cada
 * Tab renderiza un `next/link` que PRESERVA los filtros activos
 * (`q`, `producto_maestro_id`, `page`) — deep-linkable y RSC-friendly.
 *
 * Requiere estar envuelto en `<Suspense>` desde la página (useSearchParams).
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  TabsRoot,
  TabsList,
  TabsTab,
  TabsIndicator,
} from "@/components/ui/tabs";

interface TabsActivasInactivasProps {
  tab: "activas" | "inactivas";
}

export function TabsActivasInactivas({ tab }: TabsActivasInactivasProps) {
  const searchParams = useSearchParams();

  function hrefPara(valor: "activas" | "inactivas"): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", valor);
    return `?${params.toString()}`;
  }

  return (
    <TabsRoot value={tab}>
      <TabsList aria-label="Estado de las variantes">
        <TabsTab
          value="activas"
          render={<Link href={hrefPara("activas")} />}
        >
          Activas
        </TabsTab>
        <TabsTab
          value="inactivas"
          render={<Link href={hrefPara("inactivas")} />}
        >
          Inactivas
        </TabsTab>
        <TabsIndicator />
      </TabsList>
    </TabsRoot>
  );
}