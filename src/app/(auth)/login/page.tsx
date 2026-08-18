/**
 * @page LoginPage
 * @route /login
 *
 * HU-3 (task_cali_hu3_login.md §8). `FormularioLogin` usa `useSearchParams`
 * (para el `?redirect=` que agrega `src/proxy.ts`) — requiere boundary
 * `Suspense` para no bloquear el prerender estático de la página.
 */
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { FormularioLogin } from "@/components/auth/FormularioLogin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "Iniciar sesión — ERP SWAT",
  description: "Acceso al sistema ERP SWAT Indumentarias.",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="p-1.5 bg-blue-600/10 rounded-lg shrink-0">
              <ShieldCheck className="size-4 text-blue-600" aria-hidden="true" />
            </div>
            ERP SWAT Indumentarias
          </CardTitle>
          <CardDescription>Ingresá con tu email y contraseña institucional.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <FormularioLogin />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
