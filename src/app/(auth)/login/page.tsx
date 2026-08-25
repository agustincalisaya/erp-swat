/**
 * @page LoginPage
 * @route /login
 *
 * HU-3 (task_cali_hu3_login.md §8). `FormularioLogin` usa `useSearchParams`
 * (para el `?redirect=` que agrega `src/proxy.ts`) — requiere boundary
 * `Suspense` para no bloquear el prerender estático de la página.
 */
import { Suspense } from "react";
import { ShieldCheck, Package, BarChart3 } from "lucide-react";
import { FormularioLogin } from "@/components/auth/FormularioLogin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

export const metadata = {
  title: "Iniciar sesión — ERP SWAT",
  description: "Acceso al sistema ERP SWAT Indumentarias.",
};

export default function LoginPage() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen w-full bg-zinc-50 dark:bg-black">
      
      {/* 1. PANEL IZQUIERDO: Branding y Contexto (Solo visible en Desktop) */}
      <div className="hidden lg:flex w-1/2 bg-slate-900 relative overflow-hidden flex-col justify-between p-12">
        {/* Elementos decorativos de fondo (luces difuminadas) */}
        <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] rounded-full bg-blue-600/30 blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[400px] h-[400px] rounded-full bg-emerald-600/20 blur-[100px] pointer-events-none" />

        {/* Logo superior */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-xl border border-white/10 backdrop-blur-sm">
            <ShieldCheck className="size-8 text-blue-400" aria-hidden="true" />
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">SWAT Indumentarias</span>
        </div>

        {/* Mensaje central */}
        <div className="relative z-10 space-y-6 max-w-lg">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Gestión inteligente <br /> para tu negocio.
          </h1>
          <p className="text-slate-300 text-lg leading-relaxed">
            Accedé al sistema centralizado para administrar el inventario, realizar auditorías y gestionar los recursos de forma eficiente y segura.
          </p>
          
          <div className="flex gap-4 pt-4">
            <div className="flex items-center gap-2 text-sm text-slate-400 font-medium">
              <Package className="size-4 text-blue-400" /> Control de Stock
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400 font-medium">
              <BarChart3 className="size-4 text-emerald-400" /> Trazabilidad
            </div>
          </div>
        </div>

        {/* Footer del panel */}
        <div className="relative z-10 text-sm text-slate-500 font-medium">
          © {currentYear} ERP SWAT Indumentarias. Uso interno.
        </div>
      </div>

      {/* 2. PANEL DERECHO: Formulario de Login */}
      <div className="flex w-full lg:w-1/2 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          
          {/* Logo para versión Mobile (Se oculta en desktop porque ya está a la izquierda) */}
          <div className="flex flex-col items-center gap-3 lg:hidden mb-8">
            <div className="p-3 bg-blue-600/10 rounded-2xl">
              <ShieldCheck className="size-10 text-blue-600" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">ERP SWAT</h2>
          </div>

          <Card className="border-0 shadow-2xl shadow-blue-900/5 sm:border sm:border-gray-200/60 sm:bg-white/80 sm:backdrop-blur-xl">
            <CardHeader className="space-y-2 pb-6 text-center">
              <CardTitle className="text-2xl font-bold tracking-tight text-zinc-900">
                ¡Hola de nuevo!
              </CardTitle>
              <CardDescription className="text-base text-zinc-500">
                Ingresá tus credenciales para acceder al sistema.
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <Suspense fallback={
                <div className="h-40 flex flex-col items-center justify-center gap-3 text-sm text-zinc-500">
                  <div className="size-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  Cargando formulario...
                </div>
              }>
                <FormularioLogin />
              </Suspense>
            </CardContent>
            
            <CardFooter className="flex justify-center pb-6 border-t border-gray-100 mt-2 pt-6">
              <p className="text-sm text-zinc-500">
                ¿Problemas para ingresar?{" "}
                <a href="#" className="font-medium text-blue-600 hover:text-blue-500 hover:underline transition-colors">
                  Contactá al soporte
                </a>
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
      
    </div>
  );
}