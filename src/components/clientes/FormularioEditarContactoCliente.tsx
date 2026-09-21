"use client";

/**
 * @component FormularioEditarContactoCliente
 * @description HU-C2 — formulario de edición de los datos de contacto de un
 * cliente (nombre, teléfono, email). Componente compartido por sus dos puntos
 * de entrada: la ficha (`DatosContactoCliente`) y el Dialog del listado
 * (`EditarClienteDialog`). No asume dónde está montado: el contenedor decide
 * qué hacer al terminar vía `onSuccess` / `onCancel`.
 *
 * El DNI (opcional, solo informativo) se muestra de solo lectura y NUNCA forma
 * parte del formulario ni del payload (inmutable, AC de HU-C2). El submit llama
 * a la Server Action `editarCliente(clienteId, values)`; `clienteId` viaja como
 * ARGUMENTO. Al guardar con éxito hace `router.refresh()` (la action ya
 * revalidó `/clientes` y `/clientes/[id]`) y luego invoca `onSuccess`. Un campo
 * vacío en teléfono/email vacía el dato.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save, X } from "lucide-react";

import { EditarClienteSchema } from "@/lib/schemas/clientes.schema";
import { editarCliente } from "@/app/(dashboard)/clientes/actions";

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
import { Badge } from "@/components/ui/badge";

type FormValues = { nombre: string; telefono: string; email: string };

export interface FormularioEditarContactoClienteProps {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  /** Solo informativo: se muestra de solo lectura, nunca se envía. */
  dni?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function FormularioEditarContactoCliente({
  clienteId,
  nombre,
  telefono,
  email,
  dni,
  onSuccess,
  onCancel,
}: FormularioEditarContactoClienteProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(EditarClienteSchema) as unknown as Resolver<FormValues>,
    defaultValues: { nombre, telefono: telefono ?? "", email: email ?? "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const resultado = await editarCliente(clienteId, values);

    if (resultado.error) {
      setServerError(resultado.error.message);
      return;
    }

    // La action ya revalidó las rutas: refrescar el RSC para mostrar los
    // valores guardados.
    router.refresh();
    onSuccess();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {dni && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">DNI</span>
            <Badge variant="outline" className="font-mono">
              {dni}
            </Badge>
          </div>
        )}

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

        <div className="grid grid-cols-1 sm:grid-cols-2 items-start gap-4">
          <FormField
            control={form.control}
            name="telefono"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Teléfono</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Vacío para quitarlo" autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    placeholder="Vacío para quitarlo"
                    autoComplete="off"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
            className="gap-2"
          >
            <X className="size-4" aria-hidden="true" />
            Cancelar
          </Button>
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
