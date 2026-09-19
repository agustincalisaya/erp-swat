"use client";

/**
 * @component FormularioTurnoCaja
 * @description Apertura/cierre de turno de caja con arqueo ciego (HU-B2,
 * task_relos.md §8). Conecta con las Server Actions `abrirTurnoCajaAction` /
 * `cerrarTurnoCajaAction` — wrappers finos sobre `turno-caja.service.ts`, la
 * lógica de negocio no vive acá.
 *
 * Arqueo ciego (task §2/§8): el formulario de cierre NUNCA pide ni muestra
 * `saldo_esperado` antes de que el Cajero envíe su `conteo_fisico_declarado`
 * — ese valor solo puede conocerse porque el backend lo devuelve en la
 * RESPUESTA del cierre, nunca antes. Si la diferencia supera el umbral y no
 * se envió justificación, la Server Action devuelve `JUSTIFICACION_REQUERIDA`
 * (422): el formulario revela el campo de justificación y deja reenviar el
 * MISMO conteo ya declarado, sin pedirlo de nuevo.
 *
 * Mismo patrón que `FormularioNuevoPresupuesto.tsx` (layout visual del
 * módulo, `useState` manual + `useTransition`, sin react-hook-form).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wallet, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";

import { abrirTurnoCajaAction, cerrarTurnoCajaAction } from "@/app/(dashboard)/ventas/turnos/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { TurnoCajaResumenAbierto, TurnoCajaCerrado } from "@/lib/services/ventas/turno-caja.service";

interface FormularioTurnoCajaProps {
  turnoAbierto: TurnoCajaResumenAbierto | null;
}

export function FormularioTurnoCaja({ turnoAbierto }: FormularioTurnoCajaProps) {
  return turnoAbierto ? (
    <FormularioCierreTurno turno={turnoAbierto} />
  ) : (
    <FormularioAperturaTurno />
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Apertura
// ──────────────────────────────────────────────────────────────────────────────

function FormularioAperturaTurno() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fondoInicial, setFondoInicial] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const fondo = Number(fondoInicial);
    if (!Number.isFinite(fondo) || fondo < 0) {
      setError("El fondo fijo inicial debe ser un número mayor o igual a 0.");
      return;
    }

    startTransition(async () => {
      const resultado = await abrirTurnoCajaAction({ fondo_fijo_inicial: fondo });
      if (resultado.error) {
        setError(resultado.error.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="turno-fondo-inicial" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Fondo fijo inicial
        </Label>
        <Input
          id="turno-fondo-inicial"
          type="number"
          min={0}
          step="0.01"
          value={fondoInicial}
          onChange={(e) => setFondoInicial(e.target.value)}
          placeholder="0.00"
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Monto en efectivo con el que arranca la caja — se suma a las ventas
          en efectivo del turno para calcular el saldo esperado al cierre.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <Button
          type="submit"
          disabled={isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Abriendo…
            </>
          ) : (
            <>
              <Wallet className="size-4" />
              Abrir turno
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Cierre — arqueo ciego
// ──────────────────────────────────────────────────────────────────────────────

function FormularioCierreTurno({ turno }: { turno: TurnoCajaResumenAbierto }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [conteoFisico, setConteoFisico] = useState("");
  const [justificacion, setJustificacion] = useState("");
  const [pideJustificacion, setPideJustificacion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<TurnoCajaCerrado | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const conteo = Number(conteoFisico);
    if (!Number.isFinite(conteo) || conteo < 0) {
      setError("El conteo físico declarado debe ser un número mayor o igual a 0.");
      return;
    }

    startTransition(async () => {
      const respuesta = await cerrarTurnoCajaAction(turno.turno_caja_id, {
        conteo_fisico_declarado: conteo,
        ...(justificacion.trim() ? { justificacion: justificacion.trim() } : {}),
      });

      if (respuesta.error) {
        if (respuesta.error.code === "JUSTIFICACION_REQUERIDA") {
          setPideJustificacion(true);
          setError(respuesta.error.message);
          return;
        }
        setError(respuesta.error.message);
        return;
      }

      // Arqueo ciego cumplido: `saldo_esperado` recién se conoce ACÁ, tras
      // la respuesta del cierre — nunca se pidió ni se mostró antes.
      setResultado(respuesta.data);
    });
  };

  if (resultado) {
    return (
      <div className="space-y-4">
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <AlertDescription>Turno cerrado correctamente.</AlertDescription>
        </Alert>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Saldo esperado</dt>
            <dd className="font-semibold text-gray-900">${resultado.saldo_esperado.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Conteo físico declarado</dt>
            <dd className="font-semibold text-gray-900">${resultado.conteo_fisico_declarado.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Diferencia</dt>
            <dd className="font-semibold text-gray-900">${resultado.diferencia.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Justificación</dt>
            <dd className="text-gray-900">{resultado.justificacion ?? "—"}</dd>
          </div>
        </dl>

        <div className="flex items-center justify-end">
          <Button type="button" onClick={() => router.refresh()} className="bg-blue-600 hover:bg-blue-700 text-white">
            Continuar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Alert>
        <Lock className="size-4" aria-hidden="true" />
        <AlertDescription>
          Arqueo ciego: declarás tu conteo físico sin conocer el saldo
          esperado del sistema. El saldo y la diferencia se muestran recién
          después de enviar este formulario.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Fondo fijo inicial</dt>
          <dd className="font-semibold text-gray-900">${turno.fondo_fijo_inicial.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Apertura</dt>
          <dd className="font-semibold text-gray-900">
            {new Date(turno.fecha_apertura).toLocaleString("es-AR")}
          </dd>
        </div>
      </dl>

      <div className="space-y-1.5">
        <Label htmlFor="turno-conteo-fisico" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Conteo físico declarado
        </Label>
        <Input
          id="turno-conteo-fisico"
          type="number"
          min={0}
          step="0.01"
          value={conteoFisico}
          onChange={(e) => setConteoFisico(e.target.value)}
          placeholder="0.00"
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Contá el efectivo real en caja e ingresá el total — el sistema
          calcula el saldo esperado y la diferencia después de enviar.
        </p>
      </div>

      {pideJustificacion && (
        <div className="space-y-1.5">
          <Label htmlFor="turno-justificacion" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Justificación
          </Label>
          <textarea
            id="turno-justificacion"
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
            rows={3}
            placeholder="La diferencia supera el umbral permitido — explicá el motivo para poder cerrar el turno."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button
          type="submit"
          disabled={isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Cerrando…
            </>
          ) : (
            <>
              <Lock className="size-4" />
              Cerrar turno
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
