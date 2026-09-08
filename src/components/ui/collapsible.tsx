"use client";

/**
 * @module ui/collapsible
 * @description Wrapper sobre `@base-ui/react/collapsible` — mismo patrón que el
 * resto de `src/components/ui/` (re-export de primitivas con `data-slot`, ver
 * `tabs.tsx`). Base UI es el sucesor de Radix (mismo equipo); el repo no tiene
 * `@radix-ui/*`, así que el "Collapsible de shadcn" acá se apoya en Base UI.
 *
 * `CollapsiblePanel` anima la altura con la CSS var `--collapsible-panel-height`
 * que expone Base UI y los estados `data-starting-style` / `data-ending-style`.
 * Cuando el panel está cerrado del todo, Base UI lo desmonta (no ocupa espacio).
 */
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "@/lib/utils";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  className,
  ...props
}: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
        className,
      )}
      {...props}
    />
  );
}

function CollapsiblePanel({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cn(
        "overflow-hidden transition-[height] duration-200 ease-out",
        "h-[var(--collapsible-panel-height)] data-[starting-style]:h-0 data-[ending-style]:h-0",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel };
