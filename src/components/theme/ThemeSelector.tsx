"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** The server and hydration render agree; only the menu's selected value waits for mount. */
export function ThemeSelector({ compactOnMobile = false }: { compactOnMobile?: boolean }) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={compactOnMobile ? "w-7 px-0 sm:w-auto sm:px-2.5" : undefined}
          />
        }
        aria-label="Elegir tema"
        data-swat-theme-selector
      >
        {compactOnMobile && <SunMoon className="size-3.5 sm:hidden" aria-hidden />}
        <span className={compactOnMobile ? "hidden sm:inline" : undefined}>Tema</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-swat-theme-selector>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mounted ? theme : ""} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">Claro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Oscuro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">Sistema</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
