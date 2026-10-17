"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BotonCerrarSesionCuenta() {
  const router = useRouter();
  const salir = async () => { await fetch("/api/tienda/cuenta/logout", { method: "POST" }); router.push("/tienda/ingresar"); router.refresh(); };
  return <Button type="button" variant="outline" onClick={salir}>Cerrar sesión</Button>;
}

export function AccionesCuentaTienda({ permitirBaja }: { permitirBaja: boolean }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);

  const baja = async () => {
    const response = await fetch("/api/tienda/cuenta/baja", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo, confirmar: true }) });
    if (response.ok) { router.push("/tienda/ingresar"); router.refresh(); }
  };
  const cancelarBaja = () => { setMotivo(""); setConfirmandoBaja(false); };

  if (!permitirBaja) return null;
  return confirmandoBaja ? (
    <div className="space-y-4 border-t pt-4">
      <div className="space-y-2">
        <Label htmlFor="motivo-baja">Motivo de la baja</Label>
        <Input id="motivo-baja" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={cancelarBaja}>Cancelar</Button>
        <Button type="button" variant="destructive" disabled={!motivo.trim()} onClick={baja}>Confirmar baja de mi cuenta</Button>
      </div>
    </div>
  ) : (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="font-medium">Dar de baja mi cuenta</p>
        <p className="text-sm text-muted-foreground">Esta acción desactiva el acceso a tu cuenta.</p>
      </div>
      <Button type="button" variant="destructive" className="sm:shrink-0" aria-expanded={confirmandoBaja} onClick={() => setConfirmandoBaja(true)}>
        Dar de baja mi cuenta
      </Button>
    </div>
  );
}
