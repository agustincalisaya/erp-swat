"use client";

/**
 * @component FormularioAltaCliente
 * @description HU-C1 — Alta de Cliente con validación de unicidad por DNI
 * (spec_modulo_C.md §2.1). Patrón (a) de `FormularioProductoMaestro.tsx`:
 * react-hook-form + `@hookform/resolvers/zod` + componentes de
 * `src/components/ui/form.tsx`. Sin campo de dirección (fuera del alcance
 * de esta HU — ver `clientes.schema.ts`) ni de consentimiento (valor fijo
 * que pone `cliente.service.ts`, invisible acá).
 *
 * La respuesta distingue `es_nuevo`: si el DNI ya existía, el mensaje deja
 * claro que se recuperó el registro en vez de crear un duplicado (criterio
 * de aceptación explícito de HU-C1) — nunca se muestra como un error.
 */

import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus, CheckCircle2, RotateCcw } from "lucide-react";

import {
  CrearClienteSchema,
  type CrearClienteInput,
} from "@/lib/schemas/clientes.schema";
import {
  crearCliente,
  type ClienteCreado,
} from "@/app/(dashboard)/clientes/actions";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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

const DEFAULT_VALUES: CrearClienteInput = {
  dni: "",
  nombre: "",
  telefono: "",
  email: "",
};

export function FormularioAltaCliente() {
  const [clienteCreado, setClienteCreado] = useState<ClienteCreado | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CrearClienteInput>({
    resolver: zodResolver(CrearClienteSchema) as unknown as Resolver<CrearClienteInput>,
    defaultValues: DEFAULT_VALUES,
  });

  async function onSubmit(values: CrearClienteInput) {
    setServerError(null);
    const resultado = await crearCliente(values);

    if (resultado.error) {
      setServerError(resultado.error.message);
      return;
    }

    setClienteCreado(resultado.data);
  }

  function handleCargarOtroCliente() {
    setClienteCreado(null);
    setServerError(null);
    form.reset(DEFAULT_VALUES);
  }

  if (clienteCreado) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-5">
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <AlertDescription>
              {clienteCreado.es_nuevo ? (
                <>
                  Cliente con DNI{" "}
                  <span className="font-mono">{clienteCreado.dni}</span> creado
                  correctamente.
                </>
              ) : (
                <>
                  Ya existía un cliente con DNI{" "}
                  <span className="font-mono">{clienteCreado.dni}</span> — se
                  recuperó el registro existente, no se creó un duplicado.
                </>
              )}
            </AlertDescription>
          </Alert>

          <Button type="button" variant="outline" onClick={handleCargarOtroCliente} className="gap-2">
            <RotateCcw className="size-4" aria-hidden="true" />
            Cargar otro cliente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="size-4 text-blue-500" aria-hidden="true" />
          Datos del Cliente
        </CardTitle>
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
                name="dni"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>DNI</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: 30123456" maxLength={8} autoComplete="off" />
                    </FormControl>
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
                      <Input {...field} placeholder="Ej: Juan Pérez" autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="telefono"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Opcional" autoComplete="off" />
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
                      <Input {...field} type="email" placeholder="Opcional" autoComplete="off" />
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
                    <UserPlus className="size-4" aria-hidden="true" />
                    Dar de alta
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
