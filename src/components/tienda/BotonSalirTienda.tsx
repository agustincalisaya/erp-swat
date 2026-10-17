"use client";

/**
 * @component BotonSalirTienda
 * @description HU-E1 — cierra la sesión de Cliente Web (`POST /api/tienda/cuenta/logout`).
 * El carrito queda guardado en la cuenta (CA7).
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function BotonSalirTienda() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pendiente}
      onClick={() =>
        startTransition(async () => {
          await fetch("/api/tienda/cuenta/logout", { method: "POST" });
          router.push("/tienda/catalogo");
          router.refresh();
        })
      }
    >
      Salir
    </Button>
  );
}
