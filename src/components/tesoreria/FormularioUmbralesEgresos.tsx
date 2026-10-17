"use client";

/**
 * @component FormularioUmbralesEgresos
 * @description HU-D6 (task_relos.md D10, D24, D25) — edición de los tres
 * umbrales del % de egresos sobre ingresos. Solo lo renderiza la página para
 * quien tiene `configuracion:administrar`. Valida en cliente con el MISMO
 * schema que el servidor (`UmbralesEgresosSchema`), pero la decisión final es
 * siempre del servidor: `PATCH /api/tesoreria/alertas/umbrales` y, si sale
 * bien, `router.refresh()`. Muestra los errores por campo que devuelve la API.
 */

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { UmbralesEgresosSchema, type UmbralesEgresos } from "@/lib/schemas/alertas-desvio.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Campo = keyof UmbralesEgresos;
type ErroresCampo = Partial<Record<Campo, string>>;

const CAMPOS: { campo: Campo; etiqueta: string; chip: string }[] = [
  { campo: "informativa", etiqueta: "Informativa", chip: "bg-info text-info-foreground" },
  { campo: "advertencia", etiqueta: "Advertencia", chip: "bg-warning text-warning-foreground" },
  { campo: "critica", etiqueta: "Crítica", chip: "bg-danger-soft text-danger-soft-foreground" },
];

interface FormularioUmbralesEgresosProps {
  umbrales: UmbralesEgresos;
}

export function FormularioUmbralesEgresos({ umbrales }: FormularioUmbralesEgresosProps) {
  const router = useRouter();
  const id = useId();
  const [valores, setValores] = useState<Record<Campo, string>>({
    informativa: String(umbrales.informativa),
    advertencia: String(umbrales.advertencia),
    critica: String(umbrales.critica),
  });
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  function erroresDe(fieldErrors: Record<string, string[] | undefined> | undefined): ErroresCampo {
    const resultado: ErroresCampo = {};
    for (const { campo } of CAMPOS) {
      const mensaje = fieldErrors?.[campo]?.[0];
      if (mensaje) resultado[campo] = mensaje;
    }
    return resultado;
  }

  async function guardar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoRef.current) return;
    setErrorGeneral(null);
    setExito(null);

    // Campo vacío → NaN: el schema lo rechaza como "debe ser un número entero".
    const cuerpo = {
      informativa: valores.informativa.trim() === "" ? Number.NaN : Number(valores.informativa),
      advertencia: valores.advertencia.trim() === "" ? Number.NaN : Number(valores.advertencia),
      critica: valores.critica.trim() === "" ? Number.NaN : Number(valores.critica),
    };
    const local = UmbralesEgresosSchema.safeParse(cuerpo);
    if (!local.success) {
      setErrores(erroresDe(local.error.flatten().fieldErrors));
      setErrorGeneral(local.error.issues[0]?.message ?? "Revisá los valores ingresados.");
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const respuesta = await fetch("/api/tesoreria/alertas/umbrales", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local.data),
      });
      const json = (await respuesta.json().catch(() => null)) as {
        data: { hubo_cambio: boolean } | null;
        error: { message?: string; fieldErrors?: Record<string, string[]> } | null;
      } | null;
      if (!respuesta.ok || !json?.data) {
        setErrores(erroresDe(json?.error?.fieldErrors));
        setErrorGeneral(json?.error?.message ?? "No se pudieron guardar los umbrales. Intentá de nuevo.");
        return;
      }
      setErrores({});
      setExito(json.data.hubo_cambio ? "Umbrales guardados." : "Los umbrales ya tenían esos valores: no hubo cambios.");
      router.refresh();
    } catch {
      setErrorGeneral("No se pudo conectar con el servidor. Intentá de nuevo.");
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {CAMPOS.map(({ campo, etiqueta, chip }) => {
          const inputId = `${id}-${campo}`;
          const errorId = `${inputId}-error`;
          return (
            <div key={campo} className="space-y-1.5">
              <Label htmlFor={inputId} className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${chip}`}>{etiqueta}</span>
                <span className="text-xs text-muted-foreground">% de egresos sobre ingresos</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={inputId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  step={1}
                  value={valores[campo]}
                  onChange={(e) => setValores((previo) => ({ ...previo, [campo]: e.target.value }))}
                  disabled={enviando}
                  aria-invalid={errores[campo] ? true : undefined}
                  aria-describedby={errores[campo] ? errorId : undefined}
                />
                <span className="text-sm text-muted-foreground" aria-hidden="true">%</span>
              </div>
              {errores[campo] && (
                <p id={errorId} className="text-xs text-destructive">
                  {errores[campo]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {errorGeneral && (
        <p role="alert" className="text-sm text-destructive">
          {errorGeneral}
        </p>
      )}
      {exito && (
        <p role="status" className="text-sm text-success-foreground">
          {exito}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Enteros de 1 a 1000, estrictamente crecientes. Los cambios aplican en la próxima reevaluación.
        </p>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar umbrales"}
        </Button>
      </div>
    </form>
  );
}
