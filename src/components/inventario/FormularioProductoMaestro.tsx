"use client";

/**
 * @component FormularioProductoMaestro
 * @description HU-A1 — Sección 8: alta de `ProductoMaestro` (Paso 1 del
 * flujo). Al crearse con éxito, cede el lugar a `MatrizVariantes` con el
 * `producto_maestro_id`/`codigo_producto` recién creados (Paso 2) — no
 * requiere navegación entre pantallas, es una transición de estado local.
 *
 * UI Stack: Shadcn UI (Card, Form, Input, Button, Alert) + react-hook-form +
 * @hookform/resolvers/zod.
 */

import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, PackagePlus, CheckCircle2, RotateCcw } from "lucide-react";

import {
  CrearProductoMaestroSchema,
  type CrearProductoMaestroInput,
} from "@/lib/schemas/inventario.schema";
import {
  crearProductoMaestro,
  type ProductoMaestroCreado,
} from "@/app/(dashboard)/inventario/productos/actions";
import { MatrizVariantes } from "@/components/inventario/MatrizVariantes";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
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

const DEFAULT_VALUES: CrearProductoMaestroInput = {
  codigo_producto: "",
  nombre: "",
  descripcion: "",
  rubro: "",
  categoria: "",
  unidad_medida: "",
  proveedor_preferente: "",
  costo_estandar_referencia: 0,
};

export function FormularioProductoMaestro() {
  const [productoCreado, setProductoCreado] = useState<ProductoMaestroCreado | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CrearProductoMaestroInput>({
    resolver: zodResolver(CrearProductoMaestroSchema) as unknown as Resolver<CrearProductoMaestroInput>,
    defaultValues: DEFAULT_VALUES,
  });

  async function onSubmit(values: CrearProductoMaestroInput) {
    setServerError(null);
    const resultado = await crearProductoMaestro(values);

    if (resultado.error) {
      setServerError(resultado.error.message);
      return;
    }

    setProductoCreado(resultado.data);
  }

  function handleCargarOtroProducto() {
    setProductoCreado(null);
    setServerError(null);
    form.reset(DEFAULT_VALUES);
  }

  // ── Paso 2: producto ya creado → matriz de variantes ────────────────────
  if (productoCreado) {
    return (
      <div className="space-y-5">
        <Alert className="border-green-200 bg-green-50 text-green-800">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <AlertDescription>
            Producto <span className="font-semibold">{productoCreado.nombre}</span> (código{" "}
            <span className="font-mono">{productoCreado.codigo_producto}</span>) creado
            correctamente. Ahora generá sus variantes.
          </AlertDescription>
        </Alert>

        <MatrizVariantes
          productoMaestroId={productoCreado.id}
          codigoProducto={productoCreado.codigo_producto}
        />

        <Button type="button" variant="outline" onClick={handleCargarOtroProducto} className="gap-2">
          <RotateCcw className="size-4" aria-hidden="true" />
          Cargar otro producto
        </Button>
      </div>
    );
  }

  // ── Paso 1: formulario de alta ───────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <PackagePlus className="size-4 text-blue-500" aria-hidden="true" />
          Datos del Producto Maestro
        </CardTitle>
        <CardDescription>
          El código de producto es el segmento [PRODUCTO] del SKU — no necesita ser único.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="codigo_producto"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código de producto</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: CAMP" maxLength={8} autoComplete="off" />
                    </FormControl>
                    <FormDescription>Solo letras y números, sin espacios ni guiones.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="nombre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Campera Softshell Nivel III" autoComplete="off" />
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="rubro"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rubro</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Indumentaria" autoComplete="off" />
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
                      <Input {...field} placeholder="Ej: Camperas" autoComplete="off" />
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
                      <Input {...field} placeholder="Ej: UNIDAD" autoComplete="off" />
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
                    Creando…
                  </>
                ) : (
                  <>
                    <PackagePlus className="size-4" aria-hidden="true" />
                    Crear producto maestro
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
