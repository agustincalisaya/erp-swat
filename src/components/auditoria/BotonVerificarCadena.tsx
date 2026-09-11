"use client";

/**
 * @component BotonVerificarCadena
 * @description Dispara `POST /api/auditoria/verificar-cadena` y muestra el
 * resultado (task_cali_auditoria_forense.md §5). Solo se renderiza en la
 * página (`page.tsx`) si el usuario tiene `auditoria:verificar_cadena` —
 * este componente no vuelve a chequear el permiso, confía en el gate real
 * del propio Route Handler (`withPermission`), que sí es la barrera efectiva.
 *
 * Sin acción correctiva automática ante una discrepancia — solo reporta
 * (spec_modulo_D.md §4.4: es un procedimiento humano/institucional).
 */

import { useState, useTransition } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

type ResultadoVerificacion =
  | { integra: true; registros_verificados: number }
  | {
      integra: false;
      registros_verificados: number;
      primer_registro_divergente_id: string;
      hash_esperado: string;
      hash_almacenado: string;
    };

export function BotonVerificarCadena() {
  const [resultado, setResultado] = useState<ResultadoVerificacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    setResultado(null);
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/auditoria/verificar-cadena", { method: "POST" });
      } catch {
        setError("No se pudo conectar con el servidor.");
        return;
      }

      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.data) {
        setError(body?.error?.message ?? "No se pudo verificar la cadena.");
        return;
      }

      setResultado(body.data as ResultadoVerificacion);
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={isPending}
        className="gap-2"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ShieldCheck className="size-4" aria-hidden="true" />
        )}
        Verificar integridad de la cadena
      </Button>

      {error && (
        <Alert variant="destructive" className="max-w-sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {resultado && resultado.integra && (
        <Alert className="max-w-sm border-green-200 bg-green-50 text-green-800">
          <ShieldCheck className="size-4" aria-hidden="true" />
          <AlertDescription>
            Cadena íntegra — {resultado.registros_verificados} registro
            {resultado.registros_verificados === 1 ? "" : "s"} verificado
            {resultado.registros_verificados === 1 ? "" : "s"}.
          </AlertDescription>
        </Alert>
      )}

      {resultado && !resultado.integra && (
        <Alert variant="destructive" className="max-w-sm">
          <ShieldAlert className="size-4" aria-hidden="true" />
          <AlertDescription>
            Discrepancia detectada en el registro <code>{resultado.primer_registro_divergente_id}</code>{" "}
            (verificados {resultado.registros_verificados} antes de la falla). Reportar al equipo de
            seguridad institucional — no hay corrección automática.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
