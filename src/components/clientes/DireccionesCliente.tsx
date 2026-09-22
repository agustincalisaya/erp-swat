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
 * HU-C2 agrega la edición por fila (rótulo, tipo, dirección) vía la Server
 * Action `editarDireccionCliente(clienteId, direccionId, values)`. Dar de baja
 * una dirección sigue fuera de alcance. La regla "no dejar al cliente sin
 * FACTURACION" la aplica el service: acá solo se muestra su mensaje de error.
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
import { Loader2, MapPin, Pencil, Plus, Save, X } from "lucide-react";

import {
  AgregarDireccionClienteSchema,
  EditarDireccionClienteSchema,
  type AgregarDireccionClienteInput,
} from "@/lib/schemas/clientes.schema";
import {
  agregarDireccionCliente,
  editarDireccionCliente,
} from "@/app/(dashboard)/clientes/actions";
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
  puedeEditar = false,
  soloLectura = false,
}: {
  clienteId: string;
  direcciones: DireccionClienteListada[];
  /** Solo quien tiene `clientes:editar` ve el botón de edición por fila. */
  puedeEditar?: boolean;
  /** Cliente dado de baja (HU-C6): sin formulario de alta ni edición por fila. */
  soloLectura?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {!soloLectura && (
        <div className="lg:col-span-2">
          <DireccionesForm clienteId={clienteId} />
        </div>
      )}
      <div className={soloLectura ? "lg:col-span-5" : "lg:col-span-3"}>
        <ListaDirecciones
          clienteId={clienteId}
          direcciones={direcciones}
          puedeEditar={puedeEditar && !soloLectura}
        />
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

function ListaDirecciones({
  clienteId,
  direcciones,
  puedeEditar,
}: {
  clienteId: string;
  direcciones: DireccionClienteListada[];
  puedeEditar: boolean;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);

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
                {editandoId === direccion.id ? (
                  <FilaDireccionEdicion
                    clienteId={clienteId}
                    direccion={direccion}
                    onCerrar={() => setEditandoId(null)}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {direccion.rotulo}
                      </span>
                      <Badge
                        variant={direccion.tipo === "FACTURACION" ? "default" : "secondary"}
                        className={
                          direccion.tipo === "FACTURACION"
                            ? "bg-blue-100 text-blue-700"
                            : undefined
                        }
                      >
                        {ETIQUETA_TIPO[direccion.tipo]}
                      </Badge>
                      {direccion.is_active ? null : <Badge variant="outline">Inactiva</Badge>}
                      {puedeEditar && direccion.is_active && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto gap-1"
                          onClick={() => setEditandoId(direccion.id)}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Editar
                        </Button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {direccion.direccion_completa}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type EdicionValues = {
  rotulo: string;
  tipo: "FACTURACION" | "ENVIO";
  direccion_completa: string;
};

/** Edición en línea de una fila: mismos campos y validaciones que el alta. */
function FilaDireccionEdicion({
  clienteId,
  direccion,
  onCerrar,
}: {
  clienteId: string;
  direccion: DireccionClienteListada;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<EdicionValues>({
    resolver: zodResolver(EditarDireccionClienteSchema) as unknown as Resolver<EdicionValues>,
    defaultValues: {
      rotulo: direccion.rotulo,
      tipo: direccion.tipo,
      direccion_completa: direccion.direccion_completa,
    },
  });

  async function onSubmit(values: EdicionValues) {
    setServerError(null);
    const resultado = await editarDireccionCliente(clienteId, direccion.id, values);

    if (resultado.error) {
      // Incluye el 422 DIRECCION_FACTURACION_REQUERIDA del service.
      setServerError(resultado.error.message);
      return;
    }

    onCerrar();
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="rotulo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rótulo</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="off" />
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
        </div>

        <FormField
          control={form.control}
          name="direccion_completa"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dirección</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCerrar}
            disabled={form.formState.isSubmitting}
            className="gap-1"
          >
            <X className="size-4" aria-hidden="true" />
            Cancelar
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={form.formState.isSubmitting}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1"
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Guardando…
              </>
            ) : (
              <>
                <Save className="size-4" aria-hidden="true" />
                Guardar
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
