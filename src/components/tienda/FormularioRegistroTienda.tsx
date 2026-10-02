"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FormularioRegistroTienda() {
  const router = useRouter(); const [mensaje, setMensaje] = useState<string | null>(null);
  const enviar = async (data: FormData) => {
    const body = { nombre: data.get("nombre"), dni: data.get("dni"), telefono: data.get("telefono"), email: data.get("email"), password: data.get("password"), acepta_tratamiento: data.get("acepta_tratamiento") === "on", acepta_comunicaciones: data.get("acepta_comunicaciones") === "on" };
    const response = await fetch("/api/tienda/cuenta/registro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) return setMensaje(result.error?.message ?? "No se pudo crear la cuenta");
    setMensaje(result.data.vinculacion_pendiente ? "Cuenta creada. Validá tu identidad en la sucursal." : "Cuenta creada correctamente.");
    setTimeout(() => router.push("/tienda/ingresar"), 1000);
  };
  return <form action={enviar} className="space-y-3">
    {[["nombre","Nombre","text"],["dni","DNI","text"],["telefono","Teléfono","tel"],["email","Email","email"],["password","Contraseña","password"]].map(([name,label,type]) => <div key={name}><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} required /></div>)}
    <label className="flex gap-2 text-sm"><input name="acepta_tratamiento" type="checkbox" required />Acepto el tratamiento de mis datos personales (Ley 25.326) para gestionar mi cuenta y mis compras en la tienda web de SWAT Indumentarias.</label>
    <label className="flex gap-2 text-sm"><input name="acepta_comunicaciones" type="checkbox" />Acepto recibir comunicaciones comerciales.</label>
    {mensaje && <p className="text-sm">{mensaje}</p>}<Button className="w-full">Crear cuenta</Button>
  </form>;
}
