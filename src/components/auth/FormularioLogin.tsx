"use client";

/**
 * @component FormularioLogin
 * @description Formulario de login (HU-3, task_cali_hu3_login.md §8).
 *
 * Llama directamente a `POST /api/auth/login` vía `fetch` — NO usa Server
 * Action, porque el login es necesariamente un Route Handler (spec §3:
 * "deben ser consumibles antes de que exista cualquier sesión de RSC, y
 * deben poder setear la cookie httpOnly directamente en la respuesta HTTP").
 *
 * Manejo de errores (task §8):
 *  - 401 CREDENCIALES_INVALIDAS → mensaje genérico de formulario.
 *  - 403 CUENTA_SUSPENDIDA → mensaje específico devuelto por el backend
 *    (puede incluir la hora de desbloqueo).
 *  - Error de red → mensaje genérico.
 */

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Loader2, Mail, Lock } from "lucide-react";

import { LoginSchema } from "@/lib/schemas/auth.schema";

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

type LoginFormValues = {
  email: string;
  password: string;
};

export function FormularioLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<LoginFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(LoginSchema) as any,
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (data: LoginFormValues) => {
    setServerError(null);
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } catch {
        setServerError("No se pudo conectar con el servidor. Intentá nuevamente.");
        return;
      }

      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.data) {
        // 401 CREDENCIALES_INVALIDAS y 403 CUENTA_SUSPENDIDA traen su propio
        // `message` desde el backend — se muestra tal cual en ambos casos.
        setServerError(body?.error?.message ?? "No se pudo iniciar sesión.");
        return;
      }

      const redirectTo = searchParams.get("redirect") || "/home";
      router.push(redirectTo);
      router.refresh();
    });
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-5"
        noValidate
      >
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

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
                  autoComplete="username"
                  className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                  autoComplete="current-password"
                  className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          disabled={isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Ingresando…
            </>
          ) : (
            <>
              <LogIn className="size-4" aria-hidden="true" />
              Ingresar
            </>
          )}
        </Button>
      </form>
    </Form>
  );
}