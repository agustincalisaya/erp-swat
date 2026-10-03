"use client";

/**
 * @component FormularioIngresoTienda
 * @description HU-E1 — login de Cliente Web (`POST /api/tienda/cuenta/login`,
 * mínimo provisional de HU-E8). Al volver, el carrito ya está fusionado (CA7).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FormularioIngresoTienda({ destino }: { destino: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const enviar = (formData: FormData) =>
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/tienda/cuenta/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }),
      });
      const cuerpo = (await res.json()) as { data?: { vinculacion_pendiente?: boolean }; error: { message: string } | null };
      if (!res.ok || cuerpo.error) {
        setError(cuerpo.error?.message ?? "No se pudo ingresar");
        return;
      }
      router.push(cuerpo.data?.vinculacion_pendiente ? "/tienda/cuenta" : destino);
      router.refresh();
    });

  return (
    <form action={enviar} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pendiente}>
        Ingresar
      </Button>
    </form>
  );
}
