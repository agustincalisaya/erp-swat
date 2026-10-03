"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccionesCuentaTienda({ permitirBaja }: { permitirBaja: boolean }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const salir = async () => { await fetch("/api/tienda/cuenta/logout", { method: "POST" }); router.push("/tienda/ingresar"); router.refresh(); };
  const baja = async () => {
    const response = await fetch("/api/tienda/cuenta/baja", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo, confirmar: true }) });
    if (response.ok) { router.push("/tienda/ingresar"); router.refresh(); }
  };
  return <div className="space-y-4">
    <Button type="button" variant="outline" onClick={salir}>Cerrar sesión</Button>
    {permitirBaja && <div className="space-y-2 border-t pt-4"><Label htmlFor="motivo-baja">Motivo de la baja</Label><Input id="motivo-baja" value={motivo} onChange={(e) => setMotivo(e.target.value)} required /><Button type="button" variant="destructive" disabled={!motivo.trim()} onClick={baja}>Confirmar baja de mi cuenta</Button></div>}
  </div>;
}
