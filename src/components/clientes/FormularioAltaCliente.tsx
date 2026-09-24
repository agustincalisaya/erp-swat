"use client";

/**
 * @component FormularioAltaCliente
 * @description HU-C1 — Alta de Cliente con validación de unicidad por DNI
 * (spec_modulo_C.md §2.1). Patrón (a) de `FormularioProductoMaestro.tsx`:
 * react-hook-form + `@hookform/resolvers/zod` + componentes de
 * `src/components/ui/form.tsx`. Las dos decisiones C4 se muestran antes de Guardar.
 *
 * Alcance: SOLO los datos base del cliente. Las direcciones (HU-C3) y el
 * canal de contacto preferido (HU-C9) NO se cargan acá — viven en la ficha
 * del cliente (`/clientes/[id]`), que es a donde se redirige al usuario al
 * confirmar el alta. La decisión de arquitectura es que toda dirección vive
 * en `DireccionCliente` y se gestiona desde la ficha, nunca desde el alta.
 *
 * La respuesta distingue `es_nuevo`: si el DNI ya existía, el formulario
 * muestra el aviso preventivo y el acceso a la ficha sin crear un duplicado.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";

import { CrearClienteSchema, type CrearClienteInput } from "@/lib/schemas/clientes.schema";
import { crearCliente } from "@/app/(dashboard)/clientes/actions";
import { consultarPrevencionAltaAction } from "@/app/(dashboard)/clientes/prevencion.actions";
import { AvisoDniCliente, BotonAltaCliente, dniExistenteActual, type DniExistenteAlta } from "./ControlesAltaCliente";

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
  acepta_tratamiento_datos: false,
  decision_comercial: undefined,
};

export function FormularioAltaCliente() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [dniExistente, setDniExistente] = useState<DniExistenteAlta | null>(null);
  const [revision, setRevision] = useState<{ clave: string; posibles: { cliente_id: string; dni: string; nombre: string; is_active: boolean }[] } | null>(null);

  const form = useForm<CrearClienteInput>({
    resolver: zodResolver(CrearClienteSchema) as unknown as Resolver<CrearClienteInput>,
    defaultValues: DEFAULT_VALUES,
  });

  const [dni, nombre, telefono, email] = useWatch({ control: form.control, name: ["dni", "nombre", "telefono", "email"] });
  const claveActual = JSON.stringify([dni, nombre, telefono, email]);
  const existenteActual = dniExistenteActual(dniExistente, dni);
  useEffect(() => {
    let vigente = true;
    if (!/^\d{7,8}$/.test(dni)) return;
    const timer = setTimeout(() => {
      void consultarPrevencionAltaAction({ dni }).then((resultado) => {
        if (vigente) setDniExistente(resultado.data?.existente
          ? { dni, ...resultado.data.existente } : null);
      }).catch(() => { /* El envío vuelve a comprobar el DNI. */ });
    }, 300);
    return () => { vigente = false; clearTimeout(timer); };
  }, [dni]);

  async function onSubmit(values: CrearClienteInput) {
    setServerError(null);
    const clave = JSON.stringify([values.dni, values.nombre, values.telefono, values.email]);
    if (revision?.clave !== clave) {
      const previo = await consultarPrevencionAltaAction(values);
      if (previo.error) { setServerError(previo.error.message); return; }
      if (previo.data.existente) {
        setDniExistente({ dni: values.dni, ...previo.data.existente });
        return;
      }
      if (previo.data.posibles.length) {
        setRevision({ clave, posibles: previo.data.posibles });
        return;
      }
    }
    const resultado = await crearCliente(values);

    if (resultado.error) {
      if (resultado.error.code === "CONSENTIMIENTO_TRATAMIENTO_REQUERIDO") {
        form.setError("acepta_tratamiento_datos", { message: resultado.error.message });
      } else if (resultado.error.code === "DECISION_COMERCIAL_REQUERIDA") {
        form.setError("decision_comercial", { message: resultado.error.message });
      }
      setServerError(resultado.error.message);
      return;
    }

    // HU-C1 también cubre la carrera en que el DNI aparece después de la
    // consulta preventiva. El formulario muestra el mismo aviso en ese caso.
    const { cliente_id, es_nuevo } = resultado.data;
    if (!es_nuevo) {
      const posterior = await consultarPrevencionAltaAction({ dni: values.dni });
      setDniExistente({ dni: values.dni, id: posterior.data?.existente?.id ?? null,
        is_active: posterior.data?.existente?.is_active ?? null });
      return;
    }
    router.push(`/clientes/${cliente_id}`);
  }

  return (
    <Card>
      {existenteActual && <AvisoDniCliente cliente={existenteActual}
        onIrFicha={(id) => router.push(`/clientes/${id}`)} />}
      {!existenteActual && revision?.clave === claveActual && <Alert role="status" className="border-amber-200 bg-amber-50">
        <AlertDescription>
          Posibles coincidencias por nombre, teléfono o email. El DNI es diferente; podés continuar con el alta.
          {revision.posibles.map((c) => <Button key={c.cliente_id} type="button" variant="link"
            onClick={() => router.push(`/clientes/${c.cliente_id}`)}>{c.nombre} — DNI {c.dni}{c.is_active ? "" : " (inactivo)"}</Button>)}
        </AlertDescription>
      </Alert>}
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

            <div className="space-y-4 border-t border-slate-100 pt-5">
              <FormField
                control={form.control}
                name="acepta_tratamiento_datos"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-start gap-3">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value === true}
                          onChange={(event) => field.onChange(event.target.checked)}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          name={field.name}
                          className="mt-1 size-4"
                        />
                      </FormControl>
                      <FormLabel>
                        El cliente acepta el tratamiento de sus datos personales necesario para
                        registrarlo y operar con él
                      </FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="decision_comercial"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">
                          ¿El cliente acepta recibir comunicaciones comerciales?
                        </legend>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={field.name}
                            value="ACEPTA"
                            checked={field.value === "ACEPTA"}
                            onChange={() => field.onChange("ACEPTA")}
                            className="size-4"
                          />
                          Sí, acepta
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={field.name}
                            value="RECHAZA"
                            checked={field.value === "RECHAZA"}
                            onChange={() => field.onChange("RECHAZA")}
                            className="size-4"
                          />
                          No, rechaza
                        </label>
                      </fieldset>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <p className="text-xs text-muted-foreground">
                Si el DNI ya existe, no se creará otro cliente ni se guardarán estas decisiones.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <BotonAltaCliente enviando={form.formState.isSubmitting}
                bloqueado={!!existenteActual} continuar={revision?.clave === claveActual} />
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
