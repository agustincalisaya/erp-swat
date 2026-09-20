"use client";

/**
 * @component DireccionesCliente
 * @description HU-C3 (spec_modulo_C.md §2.3) — sección de direcciones de la
 * ficha de un cliente: alta (FACTURACION / ENVIO) + listado. Client
 * Component; el Server Component padre (`/clientes/[id]`) ya trajo los datos
 * y el permiso de lectura.
 *
 * El alta llama a la Server Action `agregarDireccionCliente(clienteId,
 * values)`; `clienteId` viaja como ARGUMENTO (el `[id]` del path), nunca
 * dentro del payload del formulario. Al confirmar se hace `router.refresh()`
 * para que el listado del RSC se vuelva a resolver (la action ya hizo
 * `revalidatePath`).
 *
 * Alcance deliberadamente mínimo: solo alta y listado. Editar o dar de baja
 * una dirección está fuera del alcance de HU-C3.
 *
 * Nota de implementación: el proyecto no tiene un `<Select>` en
 * `components/ui` — el precedente del repo (`SelectorJerarquicoStock`,
 * `FormularioNuevoPresupuesto`, `FiltrosAuditoria`) es un `<select>` nativo
 * con el mismo par de clases del sistema de diseño. Se sigue ese patrón en
 * vez de introducir un componente nuevo.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MapPin, Plus } from "lucide-react";

import {
  AgregarDireccionClienteSchema,
  type AgregarDireccionClienteInput,
} from "@/lib/schemas/clientes.schema";
import { agregarDireccionCliente } from "@/app/(dashboard)/clientes/actions";
import type { DireccionClienteListada } from "@/lib/services/clientes/cliente.service";

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
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

/** Mismo par de clases que los `<select>` nativos del resto del proyecto. */
const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

const DEFAULT_VALUES: AgregarDireccionClienteInput = {
  rotulo: "",
  tipo: "FACTURACION",
  direccion_completa: "",
};

/** Etiquetas de presentación del enum `TipoDireccionCliente`. */
const ETIQUETA_TIPO: Record<DireccionClienteListada["tipo"], string> = {
  FACTURACION: "Facturación",
  ENVIO: "Envío",
};

export function DireccionesCliente({
  clienteId,
  direcciones,
}: {
  clienteId: string;
  direcciones: DireccionClienteListada[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <DireccionesForm clienteId={clienteId} />
      </div>
      <div className="lg:col-span-3">
        <ListaDirecciones direcciones={direcciones} />
      </div>
    </div>
  );
}

function DireccionesForm({ clienteId }: { clienteId: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AgregarDireccionClienteInput>({
    resolver: zodResolver(
      AgregarDireccionClienteSchema,
    ) as unknown as Resolver<AgregarDireccionClienteInput>,
    defaultValues: DEFAULT_VALUES,
  });

  async function onSubmit(values: AgregarDireccionClienteInput) {
    setServerError(null);
    const resultado = await agregarDireccionCliente(clienteId, values);

    if (resultado.error) {
      setServerError(resultado.error.message);
      return;
    }

    form.reset(DEFAULT_VALUES);
    // La action ya revalidó `/clientes/[id]`: refrescar el RSC para que el
    // listado muestre la dirección recién creada.
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Plus className="size-4 text-blue-500" aria-hidden="true" />
          Agregar dirección
        </CardTitle>
        <CardDescription>
          Cargá una dirección de facturación o de envío para este cliente.
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
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <FormControl>
                    <select {...field} className={selectClassName}>
                      <option value="FACTURACION">{ETIQUETA_TIPO.FACTURACION}</option>
                      <option value="ENVIO">{ETIQUETA_TIPO.ENVIO}</option>
                    </select>
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
                    <Input
                      {...field}
                      placeholder="Ej: Av. Siempreviva 742"
                      autoComplete="off"
                    />
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
                  <>
                    <Plus className="size-4" aria-hidden="true" />
                    Agregar dirección
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

function ListaDirecciones({ direcciones }: { direcciones: DireccionClienteListada[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="size-4 text-blue-500" aria-hidden="true" />
          Direcciones registradas
        </CardTitle>
        <CardDescription>
          {direcciones.length === 1
            ? "1 dirección registrada"
            : `${direcciones.length} direcciones registradas`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {direcciones.length === 0 ? (
          <p className="rounded-lg border border-dashed border-blue-200 bg-blue-50/60 p-4 text-sm text-muted-foreground">
            Este cliente todavía no tiene direcciones cargadas. Empezá por una de tipo
            Facturación: una dirección de Envío no puede ser la única del cliente.
          </p>
        ) : (
          <ul className="space-y-3">
            {direcciones.map((direccion) => (
              <li
                key={direccion.id}
                className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {direccion.rotulo}
                  </span>
                  <Badge
                    variant={direccion.tipo === "FACTURACION" ? "default" : "secondary"}
                    className={
                      direccion.tipo === "FACTURACION" ? "bg-blue-100 text-blue-700" : undefined
                    }
                  >
                    {ETIQUETA_TIPO[direccion.tipo]}
                  </Badge>
                  {direccion.is_active ? null : <Badge variant="outline">Inactiva</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{direccion.direccion_completa}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
