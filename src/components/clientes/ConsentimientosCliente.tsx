"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registrarTransicionConsentimiento, regularizarConsentimiento } from "@/app/(dashboard)/clientes/consentimientos.actions";
import type { EstadoFinalidadC4, FinalidadC4, LecturaConsentimientosC4 } from "@/lib/services/clientes/consentimiento.estado";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const nombres: Record<FinalidadC4, string> = {
  VENTA_ASISTIDA: "Tratamiento de datos para operar con el cliente",
  COMUNICACIONES_COMERCIALES: "Comunicaciones comerciales",
};
const estados: Record<EstadoFinalidadC4["estado"], string> = {
  PENDIENTE_REGULARIZACION: "Pendiente de regularización",
  ACEPTADO: "Aceptado",
  RECHAZADO: "Rechazado",
  REVOCADO: "Revocado",
  ERROR_INTEGRIDAD: "Error de integridad",
};
const fechaVisible = (fecha: Date) => new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(fecha));
const nombreEvento: Record<string, string> = {
  ACEPTACION_INICIAL: "Aceptación inicial",
  RECHAZO_COMERCIAL: "Rechazo comercial expreso",
  SOLICITUD_REVOCACION: "Solicitud de revocación",
  REVOCACION_EJECUTADA: "Revocación ejecutada",
  SOLICITUD_RECHAZADA: "Solicitud rechazada administrativamente",
  NUEVA_ACEPTACION: "Nueva aceptación expresa",
};

function Regularizacion({ clienteId, finalidad }: { clienteId: string; finalidad: EstadoFinalidadC4 }) {
  const router = useRouter();
  const [decision, setDecision] = useState<"ACEPTA" | "RECHAZA" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  if (finalidad.estado !== "PENDIENTE_REGULARIZACION") return null;

  async function guardar() {
    if (!decision) { setError("Elegí una decisión expresa."); return; }
    setGuardando(true);
    setError(null);
    try {
      const resultado = await regularizarConsentimiento(clienteId, { alcance: finalidad.alcance, decision });
      if (resultado.error) { setError(resultado.error.message); return; }
      router.refresh();
    } catch {
      setError("No se pudo guardar la decisión. Intentá nuevamente.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <fieldset disabled={guardando} className="space-y-2">
        <legend className="text-sm font-medium">Nueva manifestación expresa</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={`decision-${finalidad.alcance}`} checked={decision === "ACEPTA"} onChange={() => setDecision("ACEPTA")} />
          Acepta
        </label>
        {finalidad.alcance === "COMUNICACIONES_COMERCIALES" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={`decision-${finalidad.alcance}`} checked={decision === "RECHAZA"} onChange={() => setDecision("RECHAZA")} />
            Rechaza
          </label>
        )}
      </fieldset>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="button" disabled={guardando || !decision} onClick={guardar}>Registrar decisión</Button>
    </div>
  );
}

type OperacionC4 = "REVOCAR_COMERCIAL" | "SOLICITAR_REVOCACION" | "EJECUTAR_REVOCACION" |
  "RECHAZAR_SOLICITUD" | "NUEVA_ACEPTACION";
const nombreOperacion: Record<OperacionC4, string> = {
  REVOCAR_COMERCIAL: "Revocar comunicaciones comerciales",
  SOLICITAR_REVOCACION: "Solicitar revocación del tratamiento",
  EJECUTAR_REVOCACION: "Ejecutar revocación solicitada",
  RECHAZAR_SOLICITUD: "Rechazar solicitud",
  NUEVA_ACEPTACION: "Registrar nueva aceptación expresa",
};

function TransicionControl({ clienteId, alcance, operacion, consentimientoId, solicitudId, revocacionId }: {
  clienteId: string; alcance: FinalidadC4; operacion: OperacionC4;
  consentimientoId?: string; solicitudId?: string; revocacionId?: string;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [aceptacionExpresa, setAceptacionExpresa] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [completado, setCompletado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requiereMotivo = operacion === "RECHAZAR_SOLICITUD";
  const nuevaAceptacion = operacion === "NUEVA_ACEPTACION";

  async function guardar() {
    if (requiereMotivo && !motivo.trim()) { setError("Indicá el motivo del rechazo."); return; }
    if (nuevaAceptacion && !aceptacionExpresa) { setError("Confirmá la manifestación expresa del cliente."); return; }
    setError(null);
    setGuardando(true);
    try {
      const input = nuevaAceptacion
        ? { operacion, alcance, revocacion_evento_id: revocacionId, aceptacion_expresa: true }
        : { operacion, alcance, consentimiento_id: consentimientoId,
          ...(solicitudId ? { solicitud_evento_id: solicitudId } : {}),
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}) };
      const resultado = await registrarTransicionConsentimiento(clienteId, input);
      if (resultado.error) { setError(resultado.error.message); return; }
      setCompletado(true);
      router.refresh();
    } catch {
      setError("No se pudo guardar la operación. Intentá nuevamente.");
    } finally {
      setGuardando(false);
    }
  }

  return <div className="space-y-2 border-t pt-3">
    <h4 className="text-sm font-medium">{nombreOperacion[operacion]}</h4>
    {nuevaAceptacion ? <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={aceptacionExpresa} disabled={guardando || completado}
        onChange={(event) => setAceptacionExpresa(event.target.checked)} className="mt-1" />
      El cliente manifestó expresamente una nueva aceptación de esta finalidad
    </label> : <label className="block space-y-1 text-sm">
      <span>Motivo {requiereMotivo ? "(obligatorio)" : "(opcional)"}</span>
      <textarea value={motivo} onChange={(event) => setMotivo(event.target.value)}
        disabled={guardando || completado} maxLength={1000} rows={2}
        className="w-full rounded-md border border-input bg-background px-3 py-2" />
    </label>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {completado && <p role="status" className="text-sm text-green-700">Operación registrada.</p>}
    <Button type="button" onClick={guardar}
      disabled={guardando || completado || (nuevaAceptacion && !aceptacionExpresa) || (requiereMotivo && !motivo.trim())}>
      {nombreOperacion[operacion]}
    </Button>
  </div>;
}

export function ConsentimientosCliente({ clienteId, lectura, puedeGestionar, puedeAdministrar }: {
  clienteId: string; lectura: LecturaConsentimientosC4; puedeGestionar: boolean; puedeAdministrar: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Consentimientos</CardTitle>
        <CardDescription>Estado y decisiones registradas por finalidad.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(["VENTA_ASISTIDA", "COMUNICACIONES_COMERCIALES"] as const).map((alcance) => {
          const finalidad = lectura.estados[alcance];
          return (
            <section key={alcance} className="space-y-2 rounded-md border p-4">
              <h3 className="font-medium">{nombres[alcance]}</h3>
              <p className="text-sm">Estado: <strong>{estados[finalidad.estado]}</strong></p>
              {finalidad.estado === "ERROR_INTEGRIDAD" && <p className="text-sm text-red-700">Requiere revisión antes de registrar nuevas decisiones.</p>}
              {finalidad.fecha_ultima_manifestacion && <p className="text-sm">Última manifestación válida: {fechaVisible(finalidad.fecha_ultima_manifestacion)}</p>}
              {finalidad.usuario_ultima_manifestacion && <p className="text-sm">Registrada por: {finalidad.usuario_ultima_manifestacion}</p>}
              {finalidad.solicitudes_pendientes.length > 0 && (
                <div className="text-sm">Solicitudes de revocación pendientes:
                  <ul className="list-disc pl-5">{finalidad.solicitudes_pendientes.map((solicitud) =>
                    <li key={solicitud.id}>{fechaVisible(solicitud.fecha)} · {solicitud.actor} · Solicitud {solicitud.id}</li>)}</ul>
                </div>
              )}
              {puedeGestionar && <Regularizacion clienteId={clienteId} finalidad={finalidad} />}
              {puedeGestionar && finalidad.estado === "ACEPTADO" && finalidad.consentimiento_vigente_id && (
                alcance === "COMUNICACIONES_COMERCIALES" ?
                  <TransicionControl clienteId={clienteId} alcance={alcance} operacion="REVOCAR_COMERCIAL"
                    consentimientoId={finalidad.consentimiento_vigente_id} /> :
                  finalidad.solicitudes_pendientes.length === 0 ?
                    <TransicionControl clienteId={clienteId} alcance={alcance} operacion="SOLICITAR_REVOCACION"
                      consentimientoId={finalidad.consentimiento_vigente_id} /> :
                    puedeAdministrar && finalidad.solicitudes_pendientes.map((solicitud) =>
                      <div key={solicitud.id} className="space-y-3">
                        <TransicionControl clienteId={clienteId} alcance={alcance} operacion="EJECUTAR_REVOCACION"
                          consentimientoId={finalidad.consentimiento_vigente_id!} solicitudId={solicitud.id} />
                        <TransicionControl clienteId={clienteId} alcance={alcance} operacion="RECHAZAR_SOLICITUD"
                          consentimientoId={finalidad.consentimiento_vigente_id!} solicitudId={solicitud.id} />
                      </div>)
              )}
              {puedeGestionar && puedeAdministrar && finalidad.estado === "REVOCADO" && finalidad.ultima_revocacion_evento_id &&
                <TransicionControl clienteId={clienteId} alcance={alcance} operacion="NUEVA_ACEPTACION"
                  revocacionId={finalidad.ultima_revocacion_evento_id} />}
            </section>
          );
        })}
        <section className="space-y-2">
          <h3 className="font-medium">Historial cronológico</h3>
          {lectura.historial.length === 0 ? <p className="text-sm text-muted-foreground">Sin hechos registrados.</p> : (
            <ol className="space-y-2 text-sm">
              {lectura.historial.map((hecho) => <li key={`${hecho.clase}-${hecho.id}`} className="rounded-md border p-3">
                <span className="font-medium">{nombreEvento[hecho.resultado] ?? hecho.resultado}</span> · {hecho.alcance} · {fechaVisible(hecho.fecha)}
                <div>Actor: {hecho.actor ?? "No registrado"}</div>
                {hecho.consentimiento_id && <div>Consentimiento: {hecho.consentimiento_id}</div>}
                {hecho.solicitud_evento_id && <div>Solicitud: {hecho.solicitud_evento_id}</div>}
                {hecho.motivo && <div>Motivo: {hecho.motivo}</div>}
              </li>)}
            </ol>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
