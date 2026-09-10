"use client";

/**
 * @component FormularioRegistroPago
 * @description HU-G10 — registro manual del pago de una Cuenta por Pagar
 * `DEFINITIVA` (spec_modulo_G.md §2.4). Modal disparado por fila desde
 * `ListaCuentasPorPagar`.
 *
 * Conecta con `registrarPagoCuentaPorPagarAction` — wrapper fino sobre
 * `cuenta-por-pagar.service.ts`. La validación real (fecha no futura,
 * comprobantes vigentes de la MISMA OC, no re-imputados, transición de
 * estado) vive en el servidor; acá los controles solo son un espejo de UX.
 *
 * Hydration: `useId()` (una sola llamada) + índice de comprobante para los
 * `id`/`htmlFor`. Los `key` usan el `id` estable del comprobante — nunca
 * `crypto.randomUUID()` en un atributo renderizado.
 */

import { useCallback, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Loader2, AlertTriangle } from "lucide-react";

import {
  obtenerComprobantesDeCuentaAction,
  registrarPagoCuentaPorPagarAction,
  type ComprobanteVigente,
} from "@/app/(dashboard)/tesoreria/cuentas-por-pagar/actions";
import { MarcarPagadaSchema, MEDIOS_PAGO } from "@/lib/schemas/cuentas-por-pagar.schema";
import { listarCuentasOrigen } from "@/lib/tesoreria/cuentas-origen";
import type { CuentaPorPagarPagada } from "@/lib/services/tesoreria/cuenta-por-pagar.service";
import { ModalPagoRegistrado } from "@/components/tesoreria/ModalPagoRegistrado";

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

const MEDIO_PAGO_LABEL: Record<(typeof MEDIOS_PAGO)[number], string> = {
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  EFECTIVO: "Efectivo",
};

/** Traducción de los CÓDIGOS de `motivo` que devuelve el servidor. */
const MOTIVO_LABEL: Record<string, string> = {
  NINGUNO_ENVIADO: "No se envió ningún comprobante",
  ANULADO: "Comprobante anulado",
  DE_OTRA_OC: "Pertenece a otra orden de compra",
  INEXISTENTE: "Comprobante inexistente",
  YA_IMPUTADO: "Ya imputado a otro pago",
};

type RegistroPagoFormValues = {
  fecha_pago: string;
  medio_pago: (typeof MEDIOS_PAGO)[number];
  cuenta_origen_id: string;
  comprobante_proveedor_ids: string[];
  observaciones?: string;
};

interface DetalleComprobanteInvalido {
  id: string;
  motivo: string;
}

/** `YYYY-MM-DD` de hoy en hora local (para `defaultValue` y `max` del date input). */
function hoyLocalISO(): string {
  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function valoresIniciales(): RegistroPagoFormValues {
  return {
    fecha_pago: hoyLocalISO(),
    medio_pago: "TRANSFERENCIA",
    cuenta_origen_id: "",
    comprobante_proveedor_ids: [],
    observaciones: "",
  };
}

interface FormularioRegistroPagoProps {
  cuentaPorPagarId: string;
  numeroOrden: string;
}

export function FormularioRegistroPago({
  cuentaPorPagarId,
  numeroOrden,
}: FormularioRegistroPagoProps) {
  const router = useRouter();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [comprobantes, setComprobantes] = useState<ComprobanteVigente[]>([]);
  const [cargandoComprobantes, setCargandoComprobantes] = useState(false);
  const [errorComprobantes, setErrorComprobantes] = useState<string | null>(null);

  const [alertaTop, setAlertaTop] = useState<string | null>(null);
  const [detallesInvalidos, setDetallesInvalidos] = useState<DetalleComprobanteInvalido[]>([]);
  const [resultado, setResultado] = useState<CuentaPorPagarPagada | null>(null);

  const form = useForm<RegistroPagoFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(MarcarPagadaSchema) as any,
    defaultValues: valoresIniciales(),
  });

  const resetear = useCallback(() => {
    form.reset(valoresIniciales());
    setAlertaTop(null);
    setDetallesInvalidos([]);
    setErrorComprobantes(null);
    setComprobantes([]);
  }, [form]);

  // Carga de comprobantes vigentes: se dispara al abrir el modal (desde
  // `handleOpenChange`), no en un efecto — evita el setState síncrono en
  // el cuerpo del effect y las cascadas de render.
  const cargarComprobantes = useCallback(() => {
    setCargandoComprobantes(true);
    setErrorComprobantes(null);
    obtenerComprobantesDeCuentaAction(cuentaPorPagarId).then((res) => {
      if (res.error) {
        setErrorComprobantes(res.error.message);
        setComprobantes([]);
      } else {
        setComprobantes(res.data);
      }
      setCargandoComprobantes(false);
    });
  }, [cuentaPorPagarId]);

  const handleOpenChange = (abierto: boolean) => {
    setOpen(abierto);
    if (abierto) {
      cargarComprobantes();
    } else {
      resetear();
    }
  };

  const onSubmit = (values: RegistroPagoFormValues) => {
    setAlertaTop(null);
    setDetallesInvalidos([]);

    // El resolver de zod puede haber convertido `fecha_pago` a `Date`
    // (`z.coerce.date()`); se normaliza a `YYYY-MM-DD` para el payload.
    const rawFecha: unknown = values.fecha_pago;
    const fechaPago =
      rawFecha instanceof Date ? rawFecha.toISOString().slice(0, 10) : String(rawFecha ?? "");

    const observaciones = (values.observaciones ?? "").trim();
    const payload = {
      fecha_pago: fechaPago,
      medio_pago: values.medio_pago,
      cuenta_origen_id: values.cuenta_origen_id,
      comprobante_proveedor_ids: values.comprobante_proveedor_ids ?? [],
      ...(observaciones.length > 0 ? { observaciones } : {}),
    };

    startTransition(async () => {
      const res = await registrarPagoCuentaPorPagarAction(cuentaPorPagarId, payload);

      if (res.error) {
        const { code, message, details } = res.error;

        if (code === "COMPROBANTE_PROVEEDOR_REQUERIDO" && Array.isArray(details)) {
          setDetallesInvalidos(details as DetalleComprobanteInvalido[]);
          return;
        }

        if (code === "VALIDATION_ERROR" && details && typeof details === "object") {
          const fieldErrors = details as Record<string, string[] | undefined>;
          for (const [campo, mensajes] of Object.entries(fieldErrors)) {
            const msg = mensajes?.[0];
            if (msg) {
              form.setError(campo as keyof RegistroPagoFormValues, {
                type: "server",
                message: msg,
              });
            }
          }
          return;
        }

        // 409 TRANSICION_INVALIDA / 404 / 403 / errores inesperados:
        // alerta inline no bloqueante, sin redirect ni error boundary.
        setAlertaTop(message);
        return;
      }

      setResultado(res.data);
      handleOpenChange(false);
    });
  };

  const motivoPorId = new Map(detallesInvalidos.map((d) => [d.id, d.motivo]));
  const detalleGlobal = detallesInvalidos.find((d) => d.id === "");
  const errorIds = form.formState.errors.comprobante_proveedor_ids;
  const errorCuenta = form.formState.errors.cuenta_origen_id;
  const errorFecha = form.formState.errors.fecha_pago;
  const errorObs = form.formState.errors.observaciones;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger render={<Button type="button" size="sm" className="gap-1.5" />}>
          <Banknote className="size-3.5" aria-hidden="true" />
          Registrar pago
        </DialogTrigger>

        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="size-4 text-blue-600" aria-hidden="true" />
              Registrar pago — {numeroOrden}
            </DialogTitle>
            <DialogDescription>
              Imputá al menos un comprobante vigente del proveedor y confirmá el
              medio de pago y la cuenta de origen. El pago es todo-o-nada: marca
              la cuenta como PAGADA.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {alertaTop && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertDescription>{alertaTop}</AlertDescription>
              </Alert>
            )}

            {/* ── Comprobantes a imputar ──────────────────────────────── */}
            <div className="space-y-1.5">
              <Label>Comprobantes a imputar</Label>

              {cargandoComprobantes && (
                <p className="text-xs text-muted-foreground">Cargando comprobantes…</p>
              )}
              {errorComprobantes && (
                <p className="text-xs text-destructive">{errorComprobantes}</p>
              )}
              {!cargandoComprobantes &&
                !errorComprobantes &&
                comprobantes.length === 0 && (
                  <p className="text-xs text-amber-600">
                    La orden no tiene comprobantes vigentes. No se puede registrar
                    el pago.
                  </p>
                )}

              {comprobantes.length > 0 && (
                <Controller
                  control={form.control}
                  name="comprobante_proveedor_ids"
                  render={({ field }) => {
                    const seleccionados = field.value ?? [];
                    return (
                      <div className="flex flex-col gap-2 rounded-lg border border-input p-3 max-h-56 overflow-y-auto">
                        {comprobantes.map((comprobante, indice) => {
                          const checkId = `${fieldId}-cbte-${indice}`;
                          const checked = seleccionados.includes(comprobante.id);
                          const motivo = motivoPorId.get(comprobante.id);
                          return (
                            <label
                              key={comprobante.id}
                              htmlFor={checkId}
                              className="flex items-start gap-2 text-sm cursor-pointer"
                            >
                              <input
                                id={checkId}
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...seleccionados, comprobante.id]
                                    : seleccionados.filter((id) => id !== comprobante.id);
                                  field.onChange(next);
                                  setDetallesInvalidos([]);
                                }}
                                className="size-4 mt-0.5 rounded border-input accent-blue-600"
                              />
                              <span className="flex flex-col">
                                <span className="font-mono text-xs">
                                  {comprobante.tipo} · {comprobante.numero_comprobante}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(comprobante.fecha_emision).toLocaleDateString("es-AR")}{" "}
                                  · $ {comprobante.monto_total}
                                </span>
                                {motivo && (
                                  <span className="text-xs text-destructive">
                                    {MOTIVO_LABEL[motivo] ?? motivo}
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  }}
                />
              )}

              {detalleGlobal && (
                <p className="text-xs text-destructive">
                  {MOTIVO_LABEL[detalleGlobal.motivo] ?? detalleGlobal.motivo}
                </p>
              )}
              {errorIds && (
                <p className="text-xs text-destructive">
                  {errorIds.message as string}
                </p>
              )}
            </div>

            {/* ── Medio de pago ───────────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-medio`}>Medio de pago</Label>
              <select
                id={`${fieldId}-medio`}
                className={CAMPO_CLASS}
                {...form.register("medio_pago")}
              >
                {MEDIOS_PAGO.map((medio) => (
                  <option key={medio} value={medio}>
                    {MEDIO_PAGO_LABEL[medio]}
                  </option>
                ))}
              </select>
            </div>

            {/* ── Cuenta de origen ────────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-cuenta`}>Cuenta de origen</Label>
              <select
                id={`${fieldId}-cuenta`}
                className={CAMPO_CLASS}
                {...form.register("cuenta_origen_id")}
              >
                <option value="">Seleccioná una cuenta…</option>
                {listarCuentasOrigen().map((cuenta) => (
                  <option key={cuenta.id} value={cuenta.id}>
                    {cuenta.label}
                  </option>
                ))}
              </select>
              {errorCuenta && (
                <p className="text-xs text-destructive">
                  {errorCuenta.message as string}
                </p>
              )}
            </div>

            {/* ── Fecha de pago ───────────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-fecha`}>Fecha de pago</Label>
              <Input
                id={`${fieldId}-fecha`}
                type="date"
                max={hoyLocalISO()}
                {...form.register("fecha_pago")}
              />
              {errorFecha && (
                <p className="text-xs text-destructive">
                  {errorFecha.message as string}
                </p>
              )}
            </div>

            {/* ── Observaciones ───────────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-obs`}>
                Observaciones{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <textarea
                id={`${fieldId}-obs`}
                rows={3}
                maxLength={500}
                placeholder="Nota interna sobre el pago (máx. 500 caracteres)"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                {...form.register("observaciones")}
              />
              {errorObs && (
                <p className="text-xs text-destructive">
                  {errorObs.message as string}
                </p>
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
              <Button
                type="submit"
                disabled={isPending || cargandoComprobantes || comprobantes.length === 0}
                className="gap-2"
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Registrando…
                  </>
                ) : (
                  <>
                    <Banknote className="size-4" aria-hidden="true" />
                    Registrar pago
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ModalPagoRegistrado
        data={resultado}
        numeroOrden={numeroOrden}
        onClose={() => {
          setResultado(null);
          // El `revalidatePath` de la action dejó el listado stale; recién al
          // cerrar el read-back se refetchea y la cuenta pagada desaparece.
          router.refresh();
        }}
      />
    </>
  );
}
