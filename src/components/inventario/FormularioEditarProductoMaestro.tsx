"use client";

/**
 * @component FormularioEditarProductoMaestro
 * @description HU-A8 — edición de atributos comerciales/logísticos de un
 * `ProductoMaestro` ya existente. Calcado del patrón de
 * `FormularioProductoMaestro.tsx` (HU-A1, Paso 1 del wizard): mismo stack
 * (react-hook-form + zodResolver + Shadcn Form), mismo `AutocompleteInput`
 * con sugerencias de `obtenerRubrosYCategorias()`, mismo manejo de
 * `costo_estandar_referencia` como número, mismo `serverError` inline en
 * `Alert destructive`.
 *
 * Nunca expone talle/color/genero/modelo/sku/codigo_producto como campos
 * editables — `EditarProductoMaestroSchema` ya los excluye por diseño.
 *
 * Solo se envían al service los campos que efectivamente cambiaron respecto
 * del valor cargado (`calcularDiff()`): `editarProductoMaestro()` usa
 * `Object.keys(input)` tal cual como `campos_modificados`/diff de auditoría,
 * así que mandar un campo sin tocar lo reportaría como modificado sin
 * haber cambiado.
 */
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save, ArrowLeft } from "lucide-react";

import {
  EditarProductoMaestroSchema,
  type EditarProductoMaestroInput,
} from "@/lib/schemas/inventario.schema";
import {
  editarProductoMaestro,
  obtenerRubrosYCategorias,
  type ProductoMaestroCreado,
} from "@/app/(dashboard)/inventario/productos/actions";
import { AutocompleteInput } from "@/components/inventario/AutocompleteInput";

import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FormularioEditarProductoMaestroProps {
  producto: ProductoMaestroCreado;
  onExito: () => void;
  onCambiarProducto: () => void;
}

function valoresIniciales(producto: ProductoMaestroCreado): EditarProductoMaestroInput {
  return {
    nombre: producto.nombre,
    descripcion: producto.descripcion ?? "",
    categoria: producto.categoria,
    rubro: producto.rubro,
    unidad_medida: producto.unidad_medida,
    proveedor_preferente: producto.proveedor_preferente ?? "",
    costo_estandar_referencia: producto.costo_estandar_referencia,
  };
}

function calcularDiff(
  valores: EditarProductoMaestroInput,
  original: EditarProductoMaestroInput,
): EditarProductoMaestroInput {
  const diff: EditarProductoMaestroInput = {};
  if (valores.nombre !== original.nombre) diff.nombre = valores.nombre;
  if (valores.descripcion !== original.descripcion) diff.descripcion = valores.descripcion;
  if (valores.categoria !== original.categoria) diff.categoria = valores.categoria;
  if (valores.rubro !== original.rubro) diff.rubro = valores.rubro;
  if (valores.unidad_medida !== original.unidad_medida) diff.unidad_medida = valores.unidad_medida;
  if (valores.proveedor_preferente !== original.proveedor_preferente) {
    diff.proveedor_preferente = valores.proveedor_preferente;
  }
  if (valores.costo_estandar_referencia !== original.costo_estandar_referencia) {
    diff.costo_estandar_referencia = valores.costo_estandar_referencia;
  }
  return diff;
}

export function FormularioEditarProductoMaestro({
  producto,
  onExito,
  onCambiarProducto,
}: FormularioEditarProductoMaestroProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<{ rubros: string[]; categorias: string[] }>({
    rubros: [],
    categorias: [],
  });

  const valoresOriginales = valoresIniciales(producto);

  const form = useForm<EditarProductoMaestroInput>({
    resolver: zodResolver(EditarProductoMaestroSchema) as unknown as Resolver<EditarProductoMaestroInput>,
    defaultValues: valoresOriginales,
  });

  useEffect(() => {
    // Sugerencias de autocompletado — no bloquean la edición si fallan,
    // mismo criterio que `FormularioProductoMaestro.tsx`.
    obtenerRubrosYCategorias().then((respuesta) => {
      if (respuesta.data) setSugerencias(respuesta.data);
    });
  }, []);

  async function onSubmit(valores: EditarProductoMaestroInput) {
    setServerError(null);
    const diff = calcularDiff(valores, valoresOriginales);
    const resultado = await editarProductoMaestro(producto.id, diff);

    if (resultado.error) {
      if (resultado.error.fieldErrors) {
        for (const [campo, mensajes] of Object.entries(resultado.error.fieldErrors)) {
          if (mensajes && mensajes.length > 0) {
            form.setError(campo as keyof EditarProductoMaestroInput, {
              type: "server",
              message: mensajes[0],
            });
          }
        }
      }
      setServerError(resultado.error.message);
      return;
    }

    onExito();
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 overflow-y-auto pr-1"
        noValidate
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Editando <span className="font-medium text-foreground">{producto.nombre}</span>{" "}
            <span className="font-mono text-xs">({producto.codigo_producto})</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={onCambiarProducto}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Elegir otro
          </Button>
        </div>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="nombre"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="unidad_medida"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Unidad de medida</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="descripcion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  rows={3}
                  placeholder="Descripción opcional del producto"
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="rubro"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rubro</FormLabel>
                <FormControl>
                  <AutocompleteInput {...field} value={field.value ?? ""} sugerencias={sugerencias.rubros} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="categoria"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Categoría</FormLabel>
                <FormControl>
                  <AutocompleteInput {...field} value={field.value ?? ""} sugerencias={sugerencias.categorias} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="proveedor_preferente"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Proveedor preferente</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Opcional" autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="costo_estandar_referencia"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Costo estándar de referencia</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    {...field}
                    value={
                      field.value === undefined || Number.isNaN(field.value)
                        ? ""
                        : field.value
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      field.onChange(val === "" ? "" : Number(val));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
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
      </form>
    </Form>
  );
}
