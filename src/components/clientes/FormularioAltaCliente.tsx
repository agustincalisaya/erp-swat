"use client";

/**
 * @component FormularioAltaCliente
 * @description HU-C1 — Alta de Cliente con validación de unicidad por DNI
 * (spec_modulo_C.md §2.1). Patrón (a) de `FormularioProductoMaestro.tsx`:
 * react-hook-form + `@hookform/resolvers/zod` + componentes de
 * `src/components/ui/form.tsx`. Sin campo de consentimiento (valor fijo que
 * pone `cliente.service.ts`, invisible acá).
 *
 * Dirección OPCIONAL (HU-C3 enganchada al alta): rótulo + dirección, con
 * `tipo` fijo en FACTURACION (la primera dirección nunca puede ser ENVIO).
 * Se crea DESPUÉS del cliente, con una segunda llamada a la Server Action
 * `agregarDireccionCliente`, sin tocar la transacción de `crearCliente`. Si
 * esa segunda llamada falla, el cliente sigue mostrándose como creado y se
 * avisa aparte con link a la ficha para reintentar. Si el DNI ya existía
 * (`es_nuevo: false`) la dirección NO se envía.
 *
 * La respuesta distingue `es_nuevo`: si el DNI ya existía, el mensaje deja
 * claro que se recuperó el registro en vez de crear un duplicado (criterio
 * de aceptación explícito de HU-C1) — nunca se muestra como un error.
 */

import { useState } from "react";
import Link from "next/link";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus, CheckCircle2, RotateCcw, AlertTriangle, MapPin } from "lucide-react";

import {
  AltaClienteConDireccionSchema,
  armarDireccionAlta,
  type AltaClienteConDireccionInput,
} from "@/lib/schemas/clientes.schema";
import {
  agregarDireccionCliente,
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

const DEFAULT_VALUES: AltaClienteConDireccionInput = {
  dni: "",
  nombre: "",
  telefono: "",
  email: "",
  rotulo: "",
  direccion_completa: "",
};

/** Resultado de la dirección opcional, para el aviso de la pantalla de éxito. */
type EstadoDireccion = "ninguna" | "guardada" | "fallida" | "omitida_dni_existente";

export function FormularioAltaCliente() {
  const [clienteCreado, setClienteCreado] = useState<ClienteCreado | null>(null);
  const [estadoDireccion, setEstadoDireccion] = useState<EstadoDireccion>("ninguna");
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AltaClienteConDireccionInput>({
    resolver: zodResolver(
      AltaClienteConDireccionSchema,
    ) as unknown as Resolver<AltaClienteConDireccionInput>,
    defaultValues: DEFAULT_VALUES,
  });

  async function onSubmit(values: AltaClienteConDireccionInput) {
    setServerError(null);
    const { rotulo, direccion_completa, ...datosCliente } = values;
    const resultado = await crearCliente(datosCliente);

    if (resultado.error) {
      setServerError(resultado.error.message);
      return;
    }

    const cliente = resultado.data;
    const quiereDireccion = Boolean(rotulo?.trim() && direccion_completa?.trim());
    const direccion = armarDireccionAlta({ rotulo, direccion_completa }, cliente.es_nuevo);

    let estado: EstadoDireccion = "ninguna";
    if (direccion) {
      // Try/catch propio: el cliente ya existe y nunca se muestra como fallido
      // por un error de la dirección.
      try {
        const resDireccion = await agregarDireccionCliente(cliente.cliente_id, direccion);
        estado = resDireccion.error ? "fallida" : "guardada";
      } catch {
        estado = "fallida";
      }
    } else if (quiereDireccion && !cliente.es_nuevo) {
      estado = "omitida_dni_existente";
    }

    setEstadoDireccion(estado);
    setClienteCreado(cliente);
  }

  function handleCargarOtroCliente() {
    setClienteCreado(null);
    setEstadoDireccion("ninguna");
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

          {estadoDireccion === "guardada" && (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <MapPin className="size-4" aria-hidden="true" />
              <AlertDescription>Dirección de facturación guardada.</AlertDescription>
            </Alert>
          )}

          {estadoDireccion === "fallida" && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>
                El cliente se creó, pero la dirección no se pudo guardar. Podés reintentarlo desde{" "}
                <Link href={`/clientes/${clienteCreado.cliente_id}`} className="font-medium underline">
                  la ficha del cliente
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}

          {estadoDireccion === "omitida_dni_existente" && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>
                Este DNI ya existía — no se cargó la dirección. Si necesitás cargarle una dirección,
                hacelo desde{" "}
                <Link href={`/clientes/${clienteCreado.cliente_id}`} className="font-medium underline">
                  la ficha del cliente
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}

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

            <div className="grid grid-cols-1 sm:grid-cols-2 items-start gap-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 items-start gap-4">
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

            {/*
              Dirección opcional (HU-C3). Estos dos campos están duplicados
              intencionalmente respecto a `DireccionesCliente.tsx` para no
              tocar el archivo de un compañero ya mergeado. Unificarlos en un
              componente compartido es una propuesta a coordinar con el
              equipo, no algo a resolver acá. `tipo` no se muestra: en el alta
              siempre es FACTURACION.
            */}
            <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                <MapPin className="size-4 text-blue-500" aria-hidden="true" />
                Dirección de facturación (opcional)
              </legend>

              <FormField
                control={form.control}
                name="rotulo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rótulo</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Casa, Depósito" autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="direccion_completa"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dirección</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Av. Siempreviva 742" autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>

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
