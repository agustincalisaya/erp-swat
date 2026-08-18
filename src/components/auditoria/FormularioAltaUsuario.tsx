"use client";

/**
 * @component FormularioAltaUsuario
 * @description Modal con formulario de alta de Usuario + asignación de roles (HU-1).
 *
 * UI Stack:
 *  - Shadcn UI: Dialog, Button, Input, Label, Form (FormField/FormItem/FormMessage)
 *  - Paleta Tailwind CSS: blue
 *  - react-hook-form + @hookform/resolvers/zod para validación client-side.
 *  - Server Action `crearUsuarioAction` (re-valida en servidor).
 *
 * El error `409 USUARIO_DUPLICADO` se traduce a un mensaje amigable en el
 * campo correspondiente (spec_modulo_D.md — Componentes UI), no como error
 * genérico de formulario.
 */

import { useState, useTransition, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus, Loader2, Mail, User, Lock, ShieldCheck } from "lucide-react";

import { CrearUsuarioSchema } from "@/lib/schemas/auditoria.schema";
import { crearUsuarioAction } from "@/app/(dashboard)/auditoria/usuarios/actions";
import type { UsuarioCreado } from "@/lib/services/auditoria/usuario.service";
import type { RolActivo } from "@/lib/services/auditoria/usuario.service";

// Shadcn UI
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
  FormDescription,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ──────────────────────────────────────────────────────────────────────────────
// Tipo del formulario
// ──────────────────────────────────────────────────────────────────────────────
type AltaUsuarioFormValues = {
  nombre_usuario: string;
  email: string;
  password: string;
  nombre_completo: string;
  rol_ids: string[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────────────
interface FormularioAltaUsuarioProps {
  roles: RolActivo[];
  onSuccess?: (data: UsuarioCreado) => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────────────────────────
export function FormularioAltaUsuario({ roles, onSuccess }: FormularioAltaUsuarioProps) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<AltaUsuarioFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(CrearUsuarioSchema) as any,
    defaultValues: {
      nombre_usuario: "",
      email: "",
      password: "",
      nombre_completo: "",
      rol_ids: [],
    },
  });

  const handleClose = useCallback(() => {
    setOpen(false);
    setServerError(null);
    form.reset();
  }, [form]);

  const onSubmit = (data: AltaUsuarioFormValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await crearUsuarioAction(data);
      if (!result.success) {
        // 409 USUARIO_DUPLICADO → mensaje amigable en el campo, no error genérico
        if (result.error?.code === "USUARIO_DUPLICADO") {
          form.setError("email", { type: "server", message: "El correo ya está registrado" });
          form.setError("nombre_usuario", {
            type: "server",
            message: "El nombre de usuario ya está registrado",
          });
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
      {/* ── Trigger ──────────────────────────────────────────────────────── */}
      <DialogTrigger
        render={
          <Button
            id="btn-nuevo-usuario"
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          />
        }
      >
        <UserPlus className="size-4" />
        Nuevo usuario
      </DialogTrigger>

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-white font-bold text-base">
              <div className="p-1.5 bg-white/20 rounded-lg shrink-0">
                <UserPlus className="size-4" aria-hidden="true" />
              </div>
              Alta de usuario
            </DialogTitle>
            <DialogDescription className="text-blue-100 text-xs mt-0.5 ml-9">
              Asigná al menos un rol — principio de menor privilegio
            </DialogDescription>
          </DialogHeader>
        </div>

        <Form {...form}>
          <form
            id="form-alta-usuario"
            onSubmit={form.handleSubmit(onSubmit)}
            className="px-6 py-5 space-y-5"
            noValidate
          >
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            {/* Nombre de usuario */}
            <FormField
              control={form.control}
              name="nombre_usuario"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <User className="size-3.5" aria-hidden="true" />
                    Nombre de usuario
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="jperez"
                      autoComplete="off"
                      className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <Mail className="size-3.5" aria-hidden="true" />
                    Email
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="jperez@swat-indumentarias.com"
                      autoComplete="off"
                      className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Nombre completo */}
            <FormField
              control={form.control}
              name="nombre_completo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <User className="size-3.5" aria-hidden="true" />
                    Nombre completo
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Juan Pérez"
                      autoComplete="off"
                      className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Password */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <Lock className="size-3.5" aria-hidden="true" />
                    Contraseña
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder="Mínimo 12 caracteres"
                      autoComplete="new-password"
                      className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                    />
                  </FormControl>
                  <FormDescription>
                    Mínimo 12 caracteres por política de seguridad institucional.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Roles */}
            <FormField
              control={form.control}
              name="rol_ids"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                    <ShieldCheck className="size-3.5" aria-hidden="true" />
                    Roles
                  </FormLabel>
                  <FormControl>
                    <div className="flex flex-col gap-2 rounded-lg border border-input p-3">
                      {roles.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">
                          No hay roles activos cargados en el sistema.
                        </p>
                      )}
                      {roles.map((rol) => {
                        const checked = field.value?.includes(rol.id) ?? false;
                        return (
                          <label
                            key={rol.id}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...(field.value ?? []), rol.id]
                                  : (field.value ?? []).filter((id: string) => id !== rol.id);
                                field.onChange(next);
                              }}
                              className="size-4 rounded border-input accent-blue-600"
                            />
                            {rol.nombre}
                          </label>
                        );
                      })}
                    </div>
                  </FormControl>
                  <FormDescription>Debe asignarse al menos un rol.</FormDescription>
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
            form="form-alta-usuario"
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
                <UserPlus className="size-4" aria-hidden="true" />
                Crear usuario
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
