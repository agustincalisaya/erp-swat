"use client";

/**
 * @component CanalContactoCliente
 * @description HU-C9 (spec_modulo_C.md §2.3) — sección de canal de contacto
 * preferido de la ficha de un cliente. Client Component; el Server Component
 * padre (`/clientes/[id]`) ya trajo el valor actual y el permiso de lectura.
 *
 * El submit llama a la Server Action `actualizarCanalContacto(clienteId,
 * values)`; `clienteId` viaja como ARGUMENTO (el `[id]` del path), nunca
 * dentro del payload del formulario. Al confirmar se hace `router.refresh()`
 * para que el RSC vuelva a resolver el valor guardado (la action ya hizo
 * `revalidatePath`).
 *
 * Requisitos duros de producto:
 *  (i)  el selector PRECARGA y muestra el valor actual (`EMAIL`, etc.);
 *  (ii) con `null` renderiza un estado explícito "Sin definir / no elegido"
 *       — una opción líder con `value=""` y una línea de estado visible — de
 *       modo que el selector NUNCA presente `WHATSAPP` como si fuera el valor
 *       guardado. Enviar ese centinela vacío falla el enum de Zod
 *       (`VALIDATION_ERROR`), así que el estado sin definir jamás se persiste
 *       como un valor real.
 *
 * Nota de tipado: `defaultValues` necesita `""` como centinela de `null`, pero
 * `ActualizarCanalContactoInput` tipa el campo como la unión del enum, para la
 * que `""` no es asignable. Se usa un tipo local `FormValues`
 * (`CanalContacto | ""`) y se castea el resolver exactamente como ya lo hace
 * `DireccionesCliente.tsx` (`as unknown as Resolver<...>`).
 *
 * Nota de implementación: el proyecto no tiene un `<Select>` en
 * `components/ui` — se sigue el precedente del repo (`DireccionesCliente`):
 * un `<select>` nativo con el mismo par de clases del sistema de diseño.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MessageCircle } from "lucide-react";

import { ActualizarCanalContactoSchema } from "@/lib/schemas/clientes.schema";
import { actualizarCanalContacto } from "@/app/(dashboard)/clientes/actions";
import type { CanalContacto } from "@prisma/client";

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

/** Etiquetas de presentación del enum `CanalContacto`. */
const ETIQUETA_CANAL: Record<CanalContacto, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  AMBOS: "Ambos",
};

/** Texto explícito del estado `null` (el cliente nunca eligió canal). */
const SIN_DEFINIR = "Sin definir / no elegido";

/**
 * Tipo local del formulario: la unión del enum MÁS el centinela `""` que usa
 * el `<select>` para representar `null`. `""` no es un `CanalContacto`, por
 * eso el schema (que sí es estricto con el enum) lo rechaza al enviar.
 */
type FormValues = { canal_preferido: CanalContacto | "" };

export function CanalContactoCliente({
  clienteId,
  canalPreferido,
}: {
  clienteId: string;
  canalPreferido: CanalContacto | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <MessageCircle className="size-4 text-blue-500" aria-hidden="true" />
          Canal de contacto preferido
        </CardTitle>
        <CardDescription>
          Elegí por dónde se contacta a este cliente: WhatsApp, Email o ambos.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <CanalContactoForm clienteId={clienteId} canalPreferido={canalPreferido} />
      </CardContent>
    </Card>
  );
}

function CanalContactoForm({
  clienteId,
  canalPreferido,
}: {
  clienteId: string;
  canalPreferido: CanalContacto | null;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(
      ActualizarCanalContactoSchema,
    ) as unknown as Resolver<FormValues>,
    defaultValues: { canal_preferido: canalPreferido ?? "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const resultado = await actualizarCanalContacto(clienteId, values);

    if (resultado.error) {
      setServerError(resultado.error.message);
      return;
    }

    // Preserva el valor recién guardado en el selector (no vuelve a "sin
    // definir") mientras el RSC re-resuelve el prop con `router.refresh()`.
    form.reset({ canal_preferido: resultado.data.canal_preferido });
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

        {/* Estado visible del valor guardado: con `null` lo dice explícito. */}
        <p className="text-sm text-muted-foreground">
          Valor guardado:{" "}
          <span className="font-medium text-gray-900">
            {canalPreferido ? ETIQUETA_CANAL[canalPreferido] : SIN_DEFINIR}
          </span>
        </p>

        <FormField
          control={form.control}
          name="canal_preferido"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Canal preferido</FormLabel>
              <FormControl>
                <select {...field} className={selectClassName}>
                  <option value="">{SIN_DEFINIR}</option>
                  <option value="WHATSAPP">{ETIQUETA_CANAL.WHATSAPP}</option>
                  <option value="EMAIL">{ETIQUETA_CANAL.EMAIL}</option>
                  <option value="AMBOS">{ETIQUETA_CANAL.AMBOS}</option>
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
              "Guardar canal"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
