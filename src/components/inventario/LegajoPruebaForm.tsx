"use client";

/**
 * @component LegajoPruebaForm
 * @description Modal con formulario para registrar la asignación de una unidad
 * de stock al estado «En Prueba» (HU-A3).
 *
 * UI Stack:
 *  - Shadcn UI: Dialog, Button, Input, Label, Form (FormField/FormItem/FormMessage)
 *  - Paleta Tailwind CSS: blue (bg-blue-600, text-blue-600, border-blue-500)
 *  - react-hook-form + @hookform/resolvers/zod para validación client-side.
 *  - Server Action `iniciarLegajoPruebaAction` (re-valida en servidor).
 */

import { useState, useTransition, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck, Loader2, Lock, Building2, Hash, Package2 } from "lucide-react";

import { IniciarLegajoPruebaSchema } from "@/lib/schemas/inventario.schema";
import {
  iniciarLegajoPruebaAction,
  type LegajoPruebaActionData,
} from "@/app/(dashboard)/inventario/legajos-prueba/actions";

// Shadcn UI
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────────────
// Tipo del formulario (output de Zod — `cantidad` siempre number)
// ──────────────────────────────────────────────────────────────────────────────
type LegajoPruebaFormValues = {
  variante_sku_id: string;
  deposito_origen_id: string;
  cantidad: number;
  efectivo_placa: string;
  efectivo_organismo: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────────────
interface LegajoPruebaFormProps {
  onSuccess?: (data: LegajoPruebaActionData) => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────────────────────────
export function LegajoPruebaForm({ onSuccess }: LegajoPruebaFormProps) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<LegajoPruebaFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(IniciarLegajoPruebaSchema) as any,
    defaultValues: { cantidad: 1 },
  });

  const handleClose = useCallback(() => {
    setOpen(false);
    setServerError(null);
    form.reset();
  }, [form]);

  const onSubmit = (data: LegajoPruebaFormValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await iniciarLegajoPruebaAction(data);
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
        return;
      }
      handleClose();
      onSuccess?.(result.data!);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true); }}>
      {/* ── Trigger ──────────────────────────────────────────────────────── */}
      <DialogTrigger
        render={
          <Button
            id="btn-nueva-asignacion-prueba"
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          />
        }
      >
        <ShieldCheck className="size-4" />
        Nueva asignación en prueba
      </DialogTrigger>

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">
        {/* Header con gradiente azul */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-white font-bold text-base">
              <div className="p-1.5 bg-white/20 rounded-lg shrink-0">
                <ShieldCheck className="size-4" aria-hidden="true" />
              </div>
              Asignar stock en prueba
            </DialogTitle>
            <DialogDescription className="text-blue-100 text-xs mt-0.5 ml-9">
              Los datos del efectivo serán cifrados con AES-256-GCM
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Badge de seguridad */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-blue-50 border-b border-blue-100">
          <Lock className="size-3.5 text-blue-600 shrink-0" aria-hidden="true" />
          <p className="text-xs text-blue-700 font-medium">
            Campos identificatorios protegidos — Ley N.° 25.326 · AES-256-GCM
          </p>
        </div>

        {/* Formulario */}
        <Form {...form}>
          <form
            id="form-legajo-prueba"
            onSubmit={form.handleSubmit(onSubmit)}
            className="px-6 py-5 space-y-5"
            noValidate
          >
            {/* Error del servidor */}
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            {/* Fila: SKU ID + Depósito ID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Variante SKU ID */}
              <FormField
                control={form.control}
                name="variante_sku_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                      <Package2 className="size-3.5" aria-hidden="true" />
                      ID Variante SKU
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="xxxxxxxx-xxxx-…"
                        autoComplete="off"
                        className="font-mono text-xs focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Depósito Origen ID */}
              <FormField
                control={form.control}
                name="deposito_origen_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                      <Building2 className="size-3.5" aria-hidden="true" />
                      ID Depósito Origen
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="xxxxxxxx-xxxx-…"
                        autoComplete="off"
                        className="font-mono text-xs focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Cantidad */}
            <FormField
              control={form.control}
              name="cantidad"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <Hash className="size-3.5" aria-hidden="true" />
                    Cantidad
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={1}
                      className="w-28 focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormDescription>
                    Generalmente 1 unidad para prueba de tallaje.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Divisor — sección cifrada */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 py-0.5 rounded-full bg-gray-100 text-gray-500 inline-flex items-center gap-1.5">
                  <Lock className="size-3" aria-hidden="true" />
                  Datos identificatorios (cifrado AES-256-GCM)
                </span>
              </div>
            </div>

            {/* Placa del efectivo */}
            <FormField
              control={form.control}
              name="efectivo_placa"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <Lock className="size-3.5 text-blue-600" aria-hidden="true" />
                    Placa / Credencial del efectivo
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        placeholder="Ej: 12345-PFA"
                        autoComplete="off"
                        className={cn(
                          "pr-20 border-blue-200 bg-blue-50/40",
                          "focus-visible:border-blue-500 focus-visible:ring-blue-500/30",
                        )}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 pointer-events-none select-none">
                        AES-256
                      </span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Organismo */}
            <FormField
              control={form.control}
              name="efectivo_organismo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <Lock className="size-3.5 text-blue-600" aria-hidden="true" />
                    Organismo de pertenencia
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        placeholder="Ej: Policía Federal Argentina — Div. Logística"
                        autoComplete="off"
                        className={cn(
                          "pr-20 border-blue-200 bg-blue-50/40",
                          "focus-visible:border-blue-500 focus-visible:ring-blue-500/30",
                        )}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 pointer-events-none select-none">
                        AES-256
                      </span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {/* Footer */}
        <DialogFooter className="px-6 pb-6 pt-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="form-legajo-prueba"
            disabled={isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Registrando…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" aria-hidden="true" />
                Confirmar asignación
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
