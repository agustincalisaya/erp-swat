"use client";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
interface CuentaEncontrada { id: string; email: string; vinculacion_pendiente: boolean; bloqueada_hasta: string | null; is_active: boolean; deleted_at: string | null; cliente: { nombre: string } }
interface RespuestaApi { data?: { cuenta?: CuentaEncontrada; codigo?: string } | null; error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> } | null }
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MENSAJE_ERROR_GENERICO = "No se pudo completar la operación. Intentá nuevamente.";

async function llamarApi(url: string, init?: RequestInit): Promise<{ ok: boolean; json: RespuestaApi }> {
  try {
    const r = await fetch(url, init);
    const json: RespuestaApi = await r.json().catch(() => ({}));
    return { ok: r.ok, json };
  } catch {
    return { ok: false, json: { error: { message: "No se pudo conectar con el servidor." } } };
  }
}

export function CuentasWebCliente() {
  const [dni, setDni] = useState(""); const [dniBuscado, setDniBuscado] = useState(""); const [cuenta, setCuenta] = useState<CuentaEncontrada | null>(null); const [codigo, setCodigo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false); const [error, setError] = useState<string | null>(null);
  const [noReconoce, setNoReconoce] = useState(false); const [emailTitular, setEmailTitular] = useState(""); const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const mensajeDe = (json: RespuestaApi) => json.error?.message ?? MENSAJE_ERROR_GENERICO;
  const consultar = async (dniConsulta: string) => {
    const { ok, json } = await llamarApi(`/api/ecommerce/cuentas-web?dni=${encodeURIComponent(dniConsulta)}`);
    if (!ok || !json.data?.cuenta) { setCuenta(null); setError(mensajeDe(json)); return; }
    setCuenta(json.data.cuenta);
  };
  const buscar = async () => { setCargando(true); setError(null); setCodigo(null); setNoReconoce(false); setEmailTitular(""); setErrorEmail(null); setDniBuscado(dni); await consultar(dni); setCargando(false); };
  const editarDni = (valor: string) => { setDni(valor); setCuenta(null); setCodigo(null); setError(null); setNoReconoce(false); setEmailTitular(""); setErrorEmail(null); };
  const recuperar = async () => {
    if (!cuenta) return; setCargando(true); setError(null);
    const { ok, json } = await llamarApi(`/api/ecommerce/cuentas-web/${cuenta.id}/habilitar-recuperacion`, { method: "POST" });
    if (ok && json.data?.codigo) setCodigo(json.data.codigo); else setError(mensajeDe(json));
    setCargando(false);
  };
  const validar = async (reconocido: boolean) => {
    if (!cuenta) return;
    const email = emailTitular.trim();
    if (!reconocido && !EMAIL_VALIDO.test(email)) { setErrorEmail("Ingresá un email válido"); return; }
    setCargando(true); setError(null); setErrorEmail(null);
    const { ok, json } = await llamarApi(`/api/ecommerce/cuentas-web/${cuenta.id}/validar-vinculacion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reconocido ? { email_reconocido: true } : { email_reconocido: false, email_titular: email }) });
    if (!ok) {
      setErrorEmail(json.error?.fieldErrors?.email_titular?.[0] ?? null);
      setError(mensajeDe(json));
    } else {
      setCodigo(json.data?.codigo ?? null); setNoReconoce(false); setEmailTitular("");
      await consultar(dniBuscado);
    }
    setCargando(false);
  };
  const dadaDeBaja = cuenta && (!cuenta.is_active || cuenta.deleted_at);
  const bloqueada = cuenta?.bloqueada_hasta && new Date(cuenta.bloqueada_hasta) > new Date();
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><Input value={dni} onChange={(e) => editarDni(e.target.value)} placeholder="DNI" disabled={cargando}/><Button onClick={buscar} disabled={cargando}>Buscar</Button></div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {cuenta && (
        <div className="space-y-2 rounded border p-4">
          <p>{cuenta.cliente.nombre} — {cuenta.email}</p>
          <p>{dadaDeBaja ? `Dada de baja${cuenta.deleted_at ? ` — ${new Date(cuenta.deleted_at).toLocaleDateString("es-AR")}` : ""}` : cuenta.vinculacion_pendiente ? "Pendiente" : bloqueada ? "Bloqueada" : "Activa"}</p>
          {!dadaDeBaja && (cuenta.vinculacion_pendiente ? (
            <div className="space-y-2">
              <p>¿El titular reconoce este email?</p>
              <div className="flex gap-2">
                <Button onClick={() => validar(true)} disabled={cargando}>El titular reconoce el email</Button>
                <Button variant="outline" onClick={() => { setNoReconoce(true); setError(null); }} disabled={cargando || noReconoce}>No lo reconoce</Button>
              </div>
              {noReconoce && (
                <div className="space-y-2">
                  <Input type="email" value={emailTitular} onChange={(e) => { setEmailTitular(e.target.value); setErrorEmail(null); }} placeholder="Email del titular" disabled={cargando} aria-invalid={!!errorEmail}/>
                  {errorEmail && <p className="text-sm text-destructive">{errorEmail}</p>}
                  <div className="flex gap-2">
                    <Button onClick={() => validar(false)} disabled={cargando}>Confirmar reasignación</Button>
                    <Button variant="outline" onClick={() => { setNoReconoce(false); setEmailTitular(""); setErrorEmail(null); }} disabled={cargando}>Cancelar</Button>
                  </div>
                </div>
              )}
            </div>
          ) : <Button onClick={recuperar} disabled={cargando}>Habilitar recuperación</Button>)}
        </div>
      )}
      {codigo && <div className="rounded border p-4 text-center"><p>Código de un solo uso</p><strong className="text-3xl tracking-widest">{codigo}</strong></div>}
    </div>
  );
}
