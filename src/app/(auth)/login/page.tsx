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
    <div className="flex min-h-screen w-full bg-slate-900 lg:bg-zinc-50 dark:bg-black">
      
      {/* 1. PANEL IZQUIERDO: Branding y Contexto (Solo visible en Desktop) */}
      <div className="hidden lg:flex w-1/2 bg-slate-900 relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] rounded-full bg-blue-600/30 blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[400px] h-[400px] rounded-full bg-emerald-600/20 blur-[100px] pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-xl border border-white/10 backdrop-blur-sm">
            <ShieldCheck className="size-8 text-blue-400" aria-hidden="true" />
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">SWAT Indumentarias</span>
        </div>

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

        <div className="relative z-10 text-sm text-slate-500 font-medium">
          © {currentYear} ERP SWAT Indumentarias. Uso interno.
        </div>
      </div>

      {/* 2. PANEL DERECHO: Formulario de Login */}
      <div className="relative flex w-full lg:w-1/2 items-center justify-center px-4 py-12 sm:px-6 lg:px-8 overflow-hidden lg:overflow-visible">
        
        {/* Luces de fondo (Solo visibles en Mobile) */}
        <div className="absolute top-[-10%] left-[-10%] w-72 h-72 rounded-full bg-blue-500/20 blur-[80px] lg:hidden pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-72 h-72 rounded-full bg-emerald-500/20 blur-[80px] lg:hidden pointer-events-none" />

        <div className="w-full max-w-md relative z-10">
          
          {/* CORRECCIÓN ACÁ: Eliminamos los fondos semi-transparentes y dejamos bg-white puro */}
          <Card className="border-0 shadow-2xl shadow-black/40 lg:shadow-blue-900/5 sm:border sm:border-gray-200/60 bg-white overflow-hidden">
            
            {/* Detalle visual: Línea superior de color */}
            <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 to-emerald-500" />

            <CardHeader className="space-y-4 pb-6 pt-8 text-center">
              <div className="flex justify-center mb-1">
                <div className="p-3 bg-blue-50 rounded-2xl ring-1 ring-blue-100/50">
                  <ShieldCheck className="size-8 text-blue-600" aria-hidden="true" />
                </div>
              </div>
              <div className="space-y-1.5">
                <CardTitle className="text-2xl font-bold tracking-tight text-zinc-900">
                  ERP SWAT
                </CardTitle>
                <CardDescription className="text-base text-zinc-500 px-2">
                  Ingresá tus credenciales para acceder al sistema.
                </CardDescription>
              </div>
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
            
            {/* CORRECCIÓN ACÁ: bg-gray-50 sólido (sin transparencia) para que contraste bien con el blanco de arriba */}
            <CardFooter className="flex justify-center pb-6 border-t border-gray-100 mt-2 pt-6 bg-gray-50">
              <p className="text-sm text-zinc-500">
                ¿Problemas para ingresar?{" "}
                <a href="#" className="font-medium text-blue-600 hover:text-blue-500 hover:underline transition-colors">
                  Contactá al soporte
                </a>
              </p>
            </CardFooter>
          </Card>

          <p className="text-center text-slate-400 text-xs mt-8 lg:hidden">
            © {currentYear} ERP SWAT Indumentarias.
          </p>
        </div>
      </div>
      
    </div>
  );
}