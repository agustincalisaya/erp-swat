"use client";

/**
 * @component DatoCifradoViewer
 * @description Client Component que muestra un campo AES-256-GCM cifrado como
 * `***-oculto-***` y permite al Auditor revelarlo bajo demanda invocando
 * `revelarDatoSensibleAction`. Cada click registra automáticamente un evento
 * LECTURA_SENSIBLE en el AuditLog (HU-A7 Criterio 4 — Ley N.° 25.326).
 */

import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revelarDatoSensibleAction } from "@/app/(dashboard)/inventario/auditoria/actions";

interface DatoCifradoViewerProps {
  legajoPruebaId: string;
  campo: "efectivo_placa" | "efectivo_organismo";
  label: string;
}

export function DatoCifradoViewer({
  legajoPruebaId,
  campo,
  label,
}: DatoCifradoViewerProps) {
  const [valorRevelado, setValorRevelado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRevelar = () => {
    startTransition(async () => {
      setError(null);
      const resultado = await revelarDatoSensibleAction({
        legajo_prueba_id: legajoPruebaId,
        campo,
      });

      if (resultado.success && resultado.data) {
        setValorRevelado(resultado.data.valor_descifrado);
      } else {
        setError(resultado.error?.message ?? "Error al descifrar.");
      }
    });
  };

  const handleOcultar = () => {
    setValorRevelado(null);
    setError(null);
  };

  if (error) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-600">
        <ShieldAlert className="size-3.5 shrink-0" />
        {error}
      </span>
    );
  }

  if (valorRevelado) {
    return (
      <span className="flex items-center gap-2">
        <code className="text-xs font-mono bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-md">
          {valorRevelado}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={handleOcultar}
          title={`Ocultar ${label}`}
        >
          <EyeOff className="size-3.5" />
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <code className="text-xs font-mono text-muted-foreground tracking-wider select-none">
        ***-oculto-***
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
        onClick={handleRevelar}
        disabled={isPending}
        title={`Revelar ${label} (se registrará el acceso)`}
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </Button>
    </span>
  );
}
