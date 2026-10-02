"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function FormularioRecuperacionTienda() {
  const router = useRouter(); const [error, setError] = useState<string | null>(null);
  const enviar = async (data: FormData) => { const response = await fetch("/api/tienda/cuenta/redefinir-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) }); const result = await response.json(); if (!response.ok) return setError(result.error?.message ?? "No se pudo redefinir la contraseña"); router.push("/tienda/ingresar"); };
  return <form action={enviar} className="space-y-3">{[["email","Email","email"],["codigo","Código","text"],["password","Nueva contraseña","password"],["confirmacion","Confirmar contraseña","password"]].map(([name,label,type]) => <div key={name}><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} required /></div>)}{error && <p className="text-sm text-red-700">{error}</p>}<Button className="w-full">Redefinir contraseña</Button></form>;
}
