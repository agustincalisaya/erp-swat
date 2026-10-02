"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
interface CuentaEncontrada { id: string; email: string; vinculacion_pendiente: boolean; bloqueada_hasta: string | null; is_active: boolean; deleted_at: string | null; cliente: { nombre: string } }
export function CuentasWebCliente() {
  const [dni, setDni] = useState(""); const [cuenta, setCuenta] = useState<CuentaEncontrada | null>(null); const [codigo, setCodigo] = useState<string | null>(null);
  const buscar = async () => { const r = await fetch(`/api/ecommerce/cuentas-web?dni=${encodeURIComponent(dni)}`); const j = await r.json(); setCuenta(j.data?.cuenta ?? null); setCodigo(null); };
  const recuperar = async () => { if (!cuenta) return; const r = await fetch(`/api/ecommerce/cuentas-web/${cuenta.id}/habilitar-recuperacion`, { method: "POST" }); const j = await r.json(); setCodigo(j.data?.codigo ?? null); };
  const validar = async (reconocido: boolean) => { if (!cuenta) return; const email = reconocido ? undefined : window.prompt("Email del titular"); if (!reconocido && !email) return; const r = await fetch(`/api/ecommerce/cuentas-web/${cuenta.id}/validar-vinculacion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reconocido ? { email_reconocido: true } : { email_reconocido: false, email_titular: email }) }); const j = await r.json(); if (j.data?.codigo) setCodigo(j.data.codigo); await buscar(); };
  const dadaDeBaja = cuenta && (!cuenta.is_active || cuenta.deleted_at);
  const bloqueada = cuenta?.bloqueada_hasta && new Date(cuenta.bloqueada_hasta) > new Date();
  return <div className="space-y-4"><div className="flex gap-2"><Input value={dni} onChange={(e) => setDni(e.target.value)} placeholder="DNI"/><Button onClick={buscar}>Buscar</Button></div>{cuenta && <div className="space-y-2 rounded border p-4"><p>{cuenta.cliente.nombre} — {cuenta.email}</p><p>{dadaDeBaja ? `Dada de baja${cuenta.deleted_at ? ` — ${new Date(cuenta.deleted_at).toLocaleDateString("es-AR")}` : ""}` : cuenta.vinculacion_pendiente ? "Pendiente" : bloqueada ? "Bloqueada" : "Activa"}</p>{!dadaDeBaja && (cuenta.vinculacion_pendiente ? <><p>¿El titular reconoce este email?</p><Button onClick={() => validar(true)}>Sí, validar identidad</Button><Button variant="outline" onClick={() => validar(false)}>No, reasignar acceso</Button></> : <Button onClick={recuperar}>Habilitar recuperación</Button>)}</div>}{codigo && <div className="rounded border p-4 text-center"><p>Código de un solo uso</p><strong className="text-3xl tracking-widest">{codigo}</strong></div>}</div>;
}
