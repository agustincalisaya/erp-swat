"use client";

/**
 * @component FormularioRegistrarSaldo
 * @description HU-G7 §9.8 (G7-4) — registro append-only del saldo diario de una
 * cuenta propia (solo Tesorero Central; la página no lo monta sin permiso). La
 * validación REAL vive en el schema Zod del servidor y en el servicio; acá los
 * controles son un espejo de UX. El `saldo` viaja como STRING y se RECHAZA la
 * 3.ª decimal (nunca se redondea): el error del servidor se muestra por campo.
 *
 * Hydration: `useId()` para los `id`/`htmlFor` de los campos.
 */

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Loader2, AlertTriangle, Save } from "lucide-react";

import { registrarSaldoDiarioAction } from "@/app/(dashboard)/tesoreria/posicion-diaria/actions";
import type { CuentaPosicionDto } from "@/lib/services/tesoreria/posicion-diaria.service";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const CAMPO_CLASS =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1 h-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface SaldoFormValues {
  cuenta_id: string;
  fecha: string;
  saldo: string;
}

interface FormularioRegistrarSaldoProps {
  /** Cuentas propias activas (con nombre/ID; nunca CBU/alias). */
  cuentas: CuentaPosicionDto[];
  /** Día del asiento por defecto (el día consultado en la posición). */
  diaPorDefecto: string;
}

export function FormularioRegistrarSaldo({
  cuentas,
  diaPorDefecto,
}: FormularioRegistrarSaldoProps) {
  const router = useRouter();
  const fieldId = useId();
  const [isPending, startTransition] = useTransition();
  const [alertaTop, setAlertaTop] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const form = useForm<SaldoFormValues>({
    defaultValues: {
      cuenta_id: cuentas[0]?.cuenta_id ?? "",
      fecha: diaPorDefecto,
      saldo: "",
    },
  });

  const onSubmit = (values: SaldoFormValues) => {
    setAlertaTop(null);
    setExito(null);
    form.clearErrors();

    startTransition(async () => {
      const res = await registrarSaldoDiarioAction({
        cuenta_id: values.cuenta_id,
        fecha: values.fecha,
        saldo: values.saldo.trim(),
      });

      if (res.error) {
        const { code, message, details } = res.error;
        if (code === "VALIDATION_ERROR" && details && typeof details === "object") {
          const fieldErrors = details as Record<string, string[] | undefined>;
          let campoConError = false;
          for (const [campo, mensajes] of Object.entries(fieldErrors)) {
            const msg = mensajes?.[0];
            if (msg) {
              campoConError = true;
              form.setError(campo as keyof SaldoFormValues, { type: "server", message: msg });
            }
          }
          if (campoConError) return;
        }
        setAlertaTop(message);
        return;
      }

      setExito("Saldo registrado. Se agregó un asiento nuevo del día.");
      form.setValue("saldo", "");
      router.refresh();
    });
  };

  const errorCuenta = form.formState.errors.cuenta_id;
  const errorFecha = form.formState.errors.fecha;
  const errorSaldo = form.formState.errors.saldo;

  if (cuentas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay cuentas propias activas para registrar un saldo.
      </p>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {alertaTop && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription>{alertaTop}</AlertDescription>
        </Alert>
      )}
      {exito && (
        <Alert>
          <AlertDescription>{exito}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* ── Cuenta ──────────────────────────────────────────────── */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${fieldId}-cuenta`}>Cuenta</Label>
          <select
            id={`${fieldId}-cuenta`}
            className={CAMPO_CLASS}
            {...form.register("cuenta_id")}
          >
            {cuentas.map((cuenta) => (
              <option key={cuenta.cuenta_id} value={cuenta.cuenta_id}>
                {cuenta.nombre}
              </option>
            ))}
          </select>
          {errorCuenta && (
            <p className="text-xs text-destructive">{errorCuenta.message as string}</p>
          )}
        </div>

        {/* ── Día ─────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-fecha`}>Día</Label>
          <Input id={`${fieldId}-fecha`} type="date" {...form.register("fecha")} />
          {errorFecha && (
            <p className="text-xs text-destructive">{errorFecha.message as string}</p>
          )}
        </div>
      </div>

      {/* ── Saldo ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-saldo`}>Saldo (hasta 2 decimales)</Label>
        <Input
          id={`${fieldId}-saldo`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          {...form.register("saldo")}
        />
        {errorSaldo && <p className="text-xs text-destructive">{errorSaldo.message as string}</p>}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="gap-2">
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Registrando…
            </>
          ) : (
            <>
              <Save className="size-4" aria-hidden="true" />
              Registrar saldo
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
