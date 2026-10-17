"use client";

/**
 * @component FormularioCuentaPropia
 * @description HU-G5 §9.7 (G5-1/G5-3) — alta y edición de una cuenta propia.
 * Modal con validación condicional por `tipo`: una `BANCARIA` exige banco, CBU
 * (22 dígitos) y alias; una `CAJA` los admite ausentes. La validación REAL vive
 * en la capa de servicios (`cuenta-propia.service.ts` + schema Zod del
 * servidor); acá los controles solo son un espejo de UX.
 *
 * En edición los campos sensibles (CBU/alias) NO se pre-cargan (llegan
 * enmascarados desde el servidor): dejarlos en blanco significa "sin cambio" —
 * el servicio solo re-cifra lo que efectivamente cambia. Solo se envían los
 * campos modificados.
 *
 * Hydration: `useId()` para los `id`/`htmlFor` de los campos.
 */

import { useCallback, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Landmark, Loader2, AlertTriangle, Plus, Pencil } from "lucide-react";

import {
  editarCuentaPropiaAction,
  registrarCuentaPropiaAction,
} from "@/app/(dashboard)/tesoreria/cuentas-propias/actions";
import { CUENTAS_PROPIAS_TIPOS } from "@/lib/schemas/cuenta-propia.schema";
import type { CuentaPropiaListado } from "@/lib/services/tesoreria/cuenta-propia.service";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const CAMPO_CLASS =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1 h-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const TIPO_LABEL: Record<(typeof CUENTAS_PROPIAS_TIPOS)[number], string> = {
  BANCARIA: "Bancaria",
  CAJA: "Caja",
};

type TipoValor = (typeof CUENTAS_PROPIAS_TIPOS)[number];

interface CuentaPropiaFormValues {
  nombre: string;
  tipo: TipoValor;
  banco: string;
  cbu: string;
  alias: string;
}

function valoresIniciales(cuenta?: CuentaPropiaListado): CuentaPropiaFormValues {
  return {
    nombre: cuenta?.nombre ?? "",
    tipo: cuenta?.tipo ?? "BANCARIA",
    banco: cuenta?.banco ?? "",
    cbu: "",
    alias: "",
  };
}

/** Validación de UX (espejo). El servidor re-valida con Zod siempre. */
function validarValores(
  values: CuentaPropiaFormValues,
  original?: CuentaPropiaListado,
): Partial<Record<keyof CuentaPropiaFormValues, string>> {
  const errores: Partial<Record<keyof CuentaPropiaFormValues, string>> = {};
  const banco = values.banco.trim();
  const cbu = values.cbu.trim();
  const alias = values.alias.trim();

  if (values.nombre.trim().length === 0) {
    errores.nombre = "El nombre es obligatorio";
  }

  // Una cuenta pasa a ser bancaria (alta, o edición que cambia el tipo) y por
  // ende exige los tres datos bancarios. Una edición que conserva una BANCARIA
  // existente puede dejar CBU/alias en blanco (= sin cambio).
  const exigeDatosBancarios =
    values.tipo === "BANCARIA" && (original === undefined || original.tipo !== "BANCARIA");

  if (exigeDatosBancarios) {
    if (banco.length === 0) errores.banco = "El banco es obligatorio para una cuenta bancaria";
    if (cbu.length === 0) {
      errores.cbu = "El CBU es obligatorio para una cuenta bancaria (22 dígitos)";
    }
    if (alias.length === 0) {
      errores.alias = "El alias es obligatorio para una cuenta bancaria";
    }
  }

  if (cbu.length > 0 && !/^\d{22}$/.test(cbu)) {
    errores.cbu = "El CBU debe tener exactamente 22 dígitos";
  }

  return errores;
}

interface FormularioCuentaPropiaProps {
  mode?: "alta" | "edicion";
  cuenta?: CuentaPropiaListado;
}

export function FormularioCuentaPropia({
  mode = "alta",
  cuenta,
}: FormularioCuentaPropiaProps) {
  const router = useRouter();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [alertaTop, setAlertaTop] = useState<string | null>(null);

  const form = useForm<CuentaPropiaFormValues>({
    defaultValues: valoresIniciales(cuenta),
  });
  const esEdicion = mode === "edicion";
  // Tipo actual para las pistas de obligatoriedad. Estado local en vez de
  // `form.watch()`: el React Compiler marca `watch()` de react-hook-form como
  // incompatible (no memoizable de forma segura).
  const [tipoActual, setTipoActual] = useState<TipoValor>(cuenta?.tipo ?? "BANCARIA");

  const resetear = useCallback(() => {
    form.reset(valoresIniciales(cuenta));
    setTipoActual(cuenta?.tipo ?? "BANCARIA");
    setAlertaTop(null);
  }, [form, cuenta]);

  const handleOpenChange = (abierto: boolean) => {
    setOpen(abierto);
    if (!abierto) resetear();
  };

  const onSubmit = (values: CuentaPropiaFormValues) => {
    setAlertaTop(null);
    form.clearErrors();

    const errores = validarValores(values, cuenta);
    const camposConError = Object.entries(errores);
    if (camposConError.length > 0) {
      for (const [campo, mensaje] of camposConError) {
        form.setError(campo as keyof CuentaPropiaFormValues, {
          type: "manual",
          message: mensaje,
        });
      }
      return;
    }

    startTransition(async () => {
      const res = esEdicion
        ? await editarCuentaPropiaAction(cuenta!.id, construirPayloadEdicion(values, cuenta!))
        : await registrarCuentaPropiaAction({
            nombre: values.nombre.trim(),
            tipo: values.tipo,
            banco: values.banco.trim(),
            cbu: values.cbu.trim(),
            alias: values.alias.trim(),
          });

      if (res.error) {
        const { code, message, details } = res.error;
        if (code === "VALIDATION_ERROR" && details && typeof details === "object") {
          const fieldErrors = details as Record<string, string[] | undefined>;
          for (const [campo, mensajes] of Object.entries(fieldErrors)) {
            const msg = mensajes?.[0];
            if (msg) {
              form.setError(campo as keyof CuentaPropiaFormValues, {
                type: "server",
                message: msg,
              });
            }
          }
          return;
        }
        setAlertaTop(message);
        return;
      }

      handleOpenChange(false);
      router.refresh();
    });
  };

  const trigger = esEdicion ? (
    <DialogTrigger render={<Button type="button" variant="outline" size="sm" className="gap-1.5" />}>
      <Pencil className="size-3.5" aria-hidden="true" />
      Editar
    </DialogTrigger>
  ) : (
    <DialogTrigger render={<Button type="button" size="sm" className="gap-1.5" />}>
      <Plus className="size-3.5" aria-hidden="true" />
      Nueva cuenta
    </DialogTrigger>
  );

  const errorNombre = form.formState.errors.nombre;
  const errorBanco = form.formState.errors.banco;
  const errorCbu = form.formState.errors.cbu;
  const errorAlias = form.formState.errors.alias;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="size-4 text-primary" aria-hidden="true" />
            {esEdicion ? `Editar cuenta — ${cuenta?.nombre}` : "Nueva cuenta propia"}
          </DialogTitle>
          <DialogDescription>
            Una cuenta bancaria exige banco, CBU y alias. Una caja puede
            prescindir de ellos. Los datos bancarios se cifran al guardarse.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {alertaTop && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>{alertaTop}</AlertDescription>
            </Alert>
          )}

          {/* ── Nombre ──────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-nombre`}>Nombre</Label>
            <Input id={`${fieldId}-nombre`} autoComplete="off" {...form.register("nombre")} />
            {errorNombre && (
              <p className="text-xs text-destructive">{errorNombre.message as string}</p>
            )}
          </div>

          {/* ── Tipo ────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-tipo`}>Tipo</Label>
            <select
              id={`${fieldId}-tipo`}
              className={CAMPO_CLASS}
              value={tipoActual}
              onChange={(e) => {
                const nuevoTipo = e.target.value as TipoValor;
                setTipoActual(nuevoTipo);
                form.setValue("tipo", nuevoTipo);
              }}
            >
              {CUENTAS_PROPIAS_TIPOS.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {TIPO_LABEL[tipo]}
                </option>
              ))}
            </select>
          </div>

          {/* ── Banco ───────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-banco`}>
              Banco{" "}
              {tipoActual === "BANCARIA" && (
                <span className="font-normal text-muted-foreground">(obligatorio)</span>
              )}
            </Label>
            <Input id={`${fieldId}-banco`} autoComplete="off" {...form.register("banco")} />
            {errorBanco && (
              <p className="text-xs text-destructive">{errorBanco.message as string}</p>
            )}
          </div>

          {/* ── CBU ─────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-cbu`}>
              CBU{" "}
              {tipoActual === "BANCARIA" && (
                <span className="font-normal text-muted-foreground">(22 dígitos)</span>
              )}
            </Label>
            <Input
              id={`${fieldId}-cbu`}
              inputMode="numeric"
              autoComplete="off"
              placeholder={
                esEdicion && cuenta?.cbu_enmascarado
                  ? `${cuenta.cbu_enmascarado} — dejar en blanco para no cambiar`
                  : "22 dígitos"
              }
              {...form.register("cbu")}
            />
            {errorCbu && (
              <p className="text-xs text-destructive">{errorCbu.message as string}</p>
            )}
          </div>

          {/* ── Alias ───────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-alias`}>
              Alias{" "}
              {tipoActual === "BANCARIA" && (
                <span className="font-normal text-muted-foreground">(obligatorio)</span>
              )}
            </Label>
            <Input
              id={`${fieldId}-alias`}
              autoComplete="off"
              placeholder={
                esEdicion && cuenta?.alias_enmascarado
                  ? `${cuenta.alias_enmascarado} — dejar en blanco para no cambiar`
                  : ""
              }
              {...form.register("alias")}
            />
            {errorAlias && (
              <p className="text-xs text-destructive">{errorAlias.message as string}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Guardando…
                </>
              ) : esEdicion ? (
                "Guardar cambios"
              ) : (
                "Crear cuenta"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Payload de edición con SOLO los campos modificados. Los sensibles (CBU/alias)
 * se incluyen únicamente cuando el usuario escribió un valor nuevo (un campo en
 * blanco = sin cambio, no se pisa el dato cifrado existente).
 */
function construirPayloadEdicion(
  values: CuentaPropiaFormValues,
  original: CuentaPropiaListado,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const nombre = values.nombre.trim();
  if (nombre !== original.nombre) payload.nombre = nombre;
  if (values.tipo !== original.tipo) payload.tipo = values.tipo;

  const banco = values.banco.trim();
  if (banco !== (original.banco ?? "")) payload.banco = banco;

  const cbu = values.cbu.trim();
  if (cbu.length > 0) payload.cbu = cbu;

  const alias = values.alias.trim();
  if (alias.length > 0) payload.alias = alias;

  return payload;
}
