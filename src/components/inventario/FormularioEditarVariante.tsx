"use client";

/**
 * @component FormularioEditarVariante
 * @description HU-A8 — edición de atributos operativos (`ean_qr`,
 * `proveedor_id`) de una `VarianteSKU` ya existente. Calcado del patrón de
 * `FormularioEditarProductoMaestro.tsx` (mismo stack react-hook-form +
 * zodResolver + Shadcn Form, mismo `serverError` inline en `Alert
 * destructive`, mismo `calcularDiff()`), pero mucho más chico: solo dos
 * campos editables (`EditarVarianteOperativaSchema`), sin `AutocompleteInput`
 * ni campos numéricos. talle/color/genero/modelo/sku/producto_nombre son de
 * solo lectura — `EditarVarianteOperativaSchema` ya los excluye por diseño
 * (inmutabilidad del SKU).
 *
 * `ean_qr`/`proveedor_id` en `VarianteParaEdicion` son `string | null` (nunca
 * un placeholder de texto libre): `VarianteSKU.ean_qr` es `String? @unique`
 * en `schema.prisma`, y `generarVariantesMatriz()` (`producto.service.ts:330`)
 * lo deja en `NULL` cuando no se escaneó nada al crear la variante — no hay
 * ninguna función `generarEanQrPlaceholder()` en el repo que produzca un
 * string tipo "PEND-..." (verificado: no existe).
 *
 * BUG real encontrado y corregido en QA (Fase 2, paso 11): `valoresIniciales()`
 * precarga `null` como `undefined`, NO como `""`. `EditarVarianteOperativaSchema`
 * tiene `ean_qr`/`proveedor_id` como `.optional()` con un `regex`/`.uuid()` —
 * `.optional()` acepta `undefined`, pero un string vacío SÍ es "presente"
 * para Zod y rompe el regex/uuid igual. Con `?? ""` el submit fallaba
 * completo por un campo nunca tocado (bloqueaba, por ejemplo, editar solo
 * `proveedor_id` en cualquier variante con `ean_qr: null`, que es el default
 * de casi todo el seed). El `onChange` de cada campo también normaliza `""`
 * de vuelta a `undefined` cuando el usuario borra el input a mano, mismo
 * criterio que `costo_estandar_referencia` en `FormularioEditarProductoMaestro.tsx`.
 */
import { useEffect, useRef, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save, ArrowLeft, CheckCircle2 } from "lucide-react";

import {
  EditarVarianteOperativaSchema,
  type EditarVarianteOperativaInput,
} from "@/lib/schemas/inventario.schema";
import {
  editarVarianteOperativaAction,
} from "@/app/(dashboard)/inventario/variantes/actions";
import { listarProveedoresParaSelector } from "@/app/(dashboard)/inventario/productos/actions";
import type { VarianteParaEdicion } from "@/lib/services/inventario/variante.service";
import type { ProveedorParaSelector } from "@/lib/services/proveedores/orden-compra.service";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";

import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FormularioEditarVarianteProps {
  variante: VarianteParaEdicion;
  onExito: () => void;
  onCambiarVariante: () => void;
}

function valoresIniciales(variante: VarianteParaEdicion): EditarVarianteOperativaInput {
  return {
    ean_qr: variante.ean_qr ?? undefined,
    proveedor_id: variante.proveedor_id ?? undefined,
  };
}

/**
 * Solo los campos que efectivamente cambiaron — `editarVarianteOperativa()`
 * (servicio) usa `Object.keys(input)` tal cual como `campos_modificados`,
 * mismo motivo que `FormularioEditarProductoMaestro.tsx`.
 */
function calcularDiff(
  valores: EditarVarianteOperativaInput,
  original: EditarVarianteOperativaInput,
): EditarVarianteOperativaInput {
  const diff: EditarVarianteOperativaInput = {};
  if (valores.ean_qr !== original.ean_qr) diff.ean_qr = valores.ean_qr;
  if (valores.proveedor_id !== original.proveedor_id) diff.proveedor_id = valores.proveedor_id;
  return diff;
}

export function FormularioEditarVariante({
  variante,
  onExito,
  onCambiarVariante,
}: FormularioEditarVarianteProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [proveedores, setProveedores] = useState<ProveedorParaSelector[]>([]);
  const [cargandoProveedores, setCargandoProveedores] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const valoresOriginales = valoresIniciales(variante);

  useEffect(() => {
    let vigente = true;
    listarProveedoresParaSelector()
      .then((res) => {
        if (vigente && res.data) setProveedores(res.data);
      })
      .finally(() => {
        if (vigente) setCargandoProveedores(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const form = useForm<EditarVarianteOperativaInput>({
    resolver: zodResolver(EditarVarianteOperativaSchema) as unknown as Resolver<EditarVarianteOperativaInput>,
    defaultValues: valoresOriginales,
  });

  // Si el Dialog se cierra manualmente durante el delay de éxito, evita
  // llamar a onExito()/setState sobre un componente ya desmontado.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function onSubmit(valores: EditarVarianteOperativaInput) {
    setServerError(null);
    const diff = calcularDiff(valores, valoresOriginales);
    const resultado = await editarVarianteOperativaAction(variante.id, diff);

    if (!resultado.success) {
      const error = resultado.error;
      if (error?.fieldErrors) {
        for (const [campo, mensajes] of Object.entries(error.fieldErrors)) {
          if (mensajes && mensajes.length > 0) {
            form.setError(campo as keyof EditarVarianteOperativaInput, {
              type: "server",
              message: mensajes[0],
            });
          }
        }
      }
      setServerError(error?.message ?? "Error desconocido.");
      return;
    }

    setExito(true);
    timeoutRef.current = setTimeout(() => {
      onExito();
    }, 1400);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        className="overflow-y-auto pr-1"
        noValidate
      >
        <fieldset disabled={exito} className="contents space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            <p>
              Editando variante{" "}
              <span className="font-mono text-xs text-foreground">{variante.sku}</span>{" "}
              — <span className="font-medium text-foreground">{variante.producto_nombre}</span>
            </p>
            <p className="text-xs">
              Talle {variante.talle} · {variante.color} · {variante.genero} · {variante.modelo}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={onCambiarVariante}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Elegir otra
          </Button>
        </div>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {exito && (
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <AlertDescription>Variante editada con éxito</AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="ean_qr"
          render={({ field }) => (
            <FormItem>
              <FormLabel>EAN-13</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                  placeholder="13 dígitos"
                  autoComplete="off"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="proveedor_id"
          render={({ field }) => {
            const seleccionEnLista =
              !field.value || proveedores.some((p) => p.id === field.value);
            return (
              <FormItem>
                <FormLabel>Proveedor habitual</FormLabel>
                <FormControl>
                  <ComboboxFiltrable<ProveedorParaSelector>
                    items={proveedores}
                    getId={(p) => p.id}
                    getLabel={(p) => p.nombre_fantasia ?? p.razon_social}
                    value={field.value ?? ""}
                    onChange={(p) => field.onChange(p.id)}
                    placeholder="Buscar proveedor homologado…"
                    cargando={cargandoProveedores}
                    cargandoLabel="Cargando proveedores…"
                    emptyMessage="No hay proveedores homologados."
                  />
                </FormControl>
                <FormDescription>
                  Solo proveedores en estado HOMOLOGADO. Dejalo sin tocar para
                  mantener el actual.
                  {!cargandoProveedores && !seleccionEnLista && (
                    <span className="block text-amber-700">
                      El proveedor actual ya no está homologado — elegí uno
                      homologado para reasignarlo.
                    </span>
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || exito}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Guardando…
              </>
            ) : (
              <>
                <Save className="size-4" aria-hidden="true" />
                Guardar cambios
              </>
            )}
          </Button>
        </div>
        </fieldset>
      </form>
    </Form>
  );
}
