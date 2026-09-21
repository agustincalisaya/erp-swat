"use client";

/**
 * @component SegmentoCliente
 * @description HU-C8 (spec_modulo_C.md §2.8) — sección de segmento comercial de
 * la ficha de un cliente. Client Component; el Server Component padre
 * (`/clientes/[id]`) ya trajo el valor actual y el permiso de lectura.
 *
 * El submit llama a la Server Action `actualizarSegmentoCliente(clienteId,
 * values)`; `clienteId` viaja como ARGUMENTO (el `[id]` del path), nunca dentro
 * del payload del formulario. Al confirmar se hace `router.refresh()` para que
 * el RSC vuelva a resolver el valor guardado (la action ya hizo
 * `revalidatePath`).
 *
 * DIFERENCIA CLAVE con `CanalContactoCliente` (HU-C9): `segmento` es `NOT NULL`
 * con default `MINORISTA`, así que NO existe estado vacío ni centinela `""` —
 * el selector siempre tiene un valor real y precargado
 * (`FormValues = { segmento: SegmentoComercial }`). La operación no es
 * "limpiar" sino reasignar, y el valor actual se PRECARGA en `defaultValues`
 * (requisito duro de producto: el selector nunca arranca en la primera opción
 * fingiendo ser el valor guardado).
 *
 * Nota de implementación: el proyecto no tiene un `<Select>` en
 * `components/ui` — se sigue el precedente del repo (`DireccionesCliente` /
 * `CanalContactoCliente`): un `<select>` nativo con el mismo par de clases del
 * sistema de diseño.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Tags } from "lucide-react";

import { ActualizarSegmentoClienteSchema } from "@/lib/schemas/clientes.schema";
import { actualizarSegmentoCliente } from "@/app/(dashboard)/clientes/actions";
import type { SegmentoComercial } from "@prisma/client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Mismo par de clases que los `<select>` nativos del resto del proyecto. */
const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

/** Etiquetas de presentación del enum `SegmentoComercial`. */
const ETIQUETA_SEGMENTO: Record<SegmentoComercial, string> = {
  MINORISTA: "Minorista",
  MAYORISTA: "Mayorista",
  CLIENTE_FRECUENTE: "Cliente frecuente",
};

/**
 * Tipo del formulario: `segmento` es `NOT NULL`, así que el campo es siempre un
 * valor del enum — sin centinela vacío (a diferencia del canal de contacto,
 * que es nullable).
 */
type FormValues = { segmento: SegmentoComercial };

export function SegmentoCliente({
  clienteId,
  segmento,
}: {
  clienteId: string;
  segmento: SegmentoComercial;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="size-4 text-blue-500" aria-hidden="true" />
          Segmento comercial
        </CardTitle>
        <CardDescription>
          Clasificá a este cliente como minorista, mayorista o cliente frecuente.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <SegmentoForm clienteId={clienteId} segmento={segmento} />
      </CardContent>
    </Card>
  );
}

function SegmentoForm({
  clienteId,
  segmento,
}: {
  clienteId: string;
  segmento: SegmentoComercial;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(
      ActualizarSegmentoClienteSchema,
    ) as unknown as Resolver<FormValues>,
    defaultValues: { segmento },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const resultado = await actualizarSegmentoCliente(clienteId, values);

    if (resultado.error) {
      setServerError(resultado.error.message);
      return;
    }

    // Preserva el valor recién guardado en el selector mientras el RSC
    // re-resuelve el prop con `router.refresh()`.
    form.reset({ segmento: resultado.data.segmento_nuevo });
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {/* Estado visible del valor guardado: precargado desde el RSC. */}
        <p className="text-sm text-muted-foreground">
          Valor actual:{" "}
          <span className="font-medium text-gray-900">
            {ETIQUETA_SEGMENTO[segmento]}
          </span>
        </p>

        <FormField
          control={form.control}
          name="segmento"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Segmento</FormLabel>
              <FormControl>
                <select {...field} className={selectClassName}>
                  <option value="MINORISTA">{ETIQUETA_SEGMENTO.MINORISTA}</option>
                  <option value="MAYORISTA">{ETIQUETA_SEGMENTO.MAYORISTA}</option>
                  <option value="CLIENTE_FRECUENTE">
                    {ETIQUETA_SEGMENTO.CLIENTE_FRECUENTE}
                  </option>
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
              "Guardar segmento"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
