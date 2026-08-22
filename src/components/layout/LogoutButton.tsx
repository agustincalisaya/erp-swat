"use client";

/**
 * @component LogoutButton
 * @description Dispara el flujo de logout ya implementado y probado en
 * HU-3 (`POST /api/auth/logout`, task_cali_hu3_login.md §3.2) — mismo
 * patrón de `FormularioLogin.tsx`: Route Handler vía `fetch` (no Server
 * Action), `useTransition` + `router.push` + `router.refresh()`.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        // Logout nunca falla del lado del usuario (mismo criterio que el
        // backend, ver logout/route.ts) — igual redirige a /login.
      }

      router.push("/login");
      router.refresh();
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={isPending}
      className="gap-1.5 text-gray-600 hover:text-red-600"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <LogOut className="size-4" aria-hidden="true" />
      )}
      Cerrar sesión
    </Button>
  );
}
