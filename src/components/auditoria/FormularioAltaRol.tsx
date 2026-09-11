"use client";

/**
 * @component FormularioAltaRol
 * @description Modal con formulario de alta de Rol + selector múltiple de
 * Permisos (Endpoint 2.2.5, task_cali_roles_permisos.md §7).
 *
 * UI Stack: Shadcn UI Dialog, Button, Input, Label, Form.
 * Server Action `crearRolAction` (re-valida en servidor).
 */

import { useState, useTransition, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldPlus, Loader2, Tag } from "lucide-react";

import { CrearRolSchema } from "@/lib/schemas/auditoria.schema";
import { crearRolAction } from "@/app/(dashboard)/auditoria/roles/actions";
import type { RolCreado, PermisoListado } from "@/lib/services/auditoria/rol.service";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
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

type AltaRolFormValues = {
  nombre: string;
  descripcion?: string;
  permiso_ids: string[];
};

interface FormularioAltaRolProps {
  permisos: PermisoListado[];
  onSuccess?: (data: RolCreado) => void;
}

export function FormularioAltaRol({ permisos, onSuccess }: FormularioAltaRolProps) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<AltaRolFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(CrearRolSchema) as any,
    defaultValues: { nombre: "", descripcion: "", permiso_ids: [] },
  });

  const handleClose = useCallback(() => {
    setOpen(false);
    setServerError(null);
    form.reset();
  }, [form]);

  const onSubmit = (data: AltaRolFormValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await crearRolAction(data);
      if (!result.success) {
        if (result.error?.code === "ROL_DUPLICADO") {
          form.setError("nombre", { type: "server", message: "Ya existe un rol con ese nombre" });
          return;
        }
        setServerError(result.error?.message ?? "Error desconocido.");
        return;
      }
      handleClose();
      onSuccess?.(result.data!);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true); }}>
      <DialogTrigger
        render={
          <Button
            id="btn-nuevo-rol"
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          />
        }
      >
        <ShieldPlus className="size-4" />
        Nuevo rol
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-white font-bold text-base">
              <div className="p-1.5 bg-white/20 rounded-lg shrink-0">
                <ShieldPlus className="size-4" aria-hidden="true" />
              </div>
              Alta de rol
            </DialogTitle>
            <DialogDescription className="text-blue-100 text-xs mt-0.5 ml-9">
              Asigná al menos un permiso — un rol sin permisos no tiene efecto
            </DialogDescription>
          </DialogHeader>
        </div>

        <Form {...form}>
          <form
            id="form-alta-rol"
            onSubmit={form.handleSubmit(onSubmit)}
            className="px-6 py-5 space-y-5"
            noValidate
          >
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <Tag className="size-3.5" aria-hidden="true" />
                    Nombre
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="ENCARGADO_DEPOSITO"
                      autoComplete="off"
                      className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Descripción (opcional)
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Gestión operativa de un depósito"
                      autoComplete="off"
                      className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="permiso_ids"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Permisos
                  </FormLabel>
                  <FormControl>
                    <div className="flex flex-col gap-2 rounded-lg border border-input p-3 max-h-56 overflow-y-auto">
                      {permisos.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">
                          No hay permisos activos cargados en el sistema.
                        </p>
                      )}
                      {permisos.map((permiso) => {
                        const checked = field.value?.includes(permiso.id) ?? false;
                        return (
                          <label
                            key={permiso.id}
                            className="flex items-start gap-2 text-sm cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...(field.value ?? []), permiso.id]
                                  : (field.value ?? []).filter((id: string) => id !== permiso.id);
                                field.onChange(next);
                              }}
                              className="size-4 mt-0.5 rounded border-input accent-blue-600"
                            />
                            <span className="flex flex-col">
                              <span className="font-mono text-xs">{permiso.codigo}</span>
                              {permiso.descripcion && (
                                <span className="text-xs text-muted-foreground">
                                  {permiso.descripcion}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter className="gap-2 px-6 pb-6">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="form-alta-rol"
            disabled={isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Creando…
              </>
            ) : (
              <>
                <ShieldPlus className="size-4" aria-hidden="true" />
                Crear rol
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
