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
import { ThemeSelector } from "@/components/theme/ThemeSelector";

export const metadata = {
  title: "Iniciar sesión — ERP SWAT",
  description: "Acceso al sistema ERP SWAT Indumentarias.",
};

export default function LoginPage() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen w-full bg-sidebar lg:bg-background dark:bg-background">
      
      {/* 1. PANEL IZQUIERDO: Branding y Contexto (Solo visible en Desktop) */}
      <div className="hidden lg:flex w-1/2 bg-sidebar relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] rounded-full bg-transparent blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[400px] h-[400px] rounded-full bg-transparent blur-[100px] pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="p-2 bg-sidebar-accent rounded-xl border border-sidebar-border backdrop-blur-sm">
            <ShieldCheck className="size-8 text-sidebar-primary" aria-hidden="true" />
          </div>
          <span className="text-2xl font-bold text-sidebar-foreground tracking-tight">SWAT Indumentarias</span>
        </div>

        <div className="relative z-10 space-y-6 max-w-lg">
          <h1 className="text-4xl font-bold text-sidebar-foreground leading-tight">
            Gestión inteligente <br /> para tu negocio.
          </h1>
          <p className="text-sidebar-muted-foreground text-lg leading-relaxed">
            Accedé al sistema centralizado para administrar el inventario, realizar auditorías y gestionar los recursos de forma eficiente y segura.
          </p>
          
          <div className="flex gap-4 pt-4">
            <div className="flex items-center gap-2 text-sm text-sidebar-muted-foreground font-medium">
              <Package className="size-4 text-sidebar-primary" /> Control de Stock
            </div>
            <div className="flex items-center gap-2 text-sm text-sidebar-muted-foreground font-medium">
              <BarChart3 className="size-4 text-sidebar-primary" /> Trazabilidad
            </div>
          </div>
        </div>

        <div className="relative z-10 text-sm text-sidebar-muted-foreground font-medium">
          © {currentYear} ERP SWAT Indumentarias. Uso interno.
        </div>
      </div>

      {/* 2. PANEL DERECHO: Formulario de Login */}
      <div className="relative flex w-full lg:w-1/2 items-center justify-center px-4 py-12 sm:px-6 lg:px-8 overflow-hidden lg:overflow-visible">
        <div className="absolute top-4 right-4" data-swat-theme-selector><ThemeSelector /></div>
        
        {/* Luces de fondo (Solo visibles en Mobile) */}
        <div className="absolute top-[-10%] left-[-10%] w-72 h-72 rounded-full bg-transparent blur-[80px] lg:hidden pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-72 h-72 rounded-full bg-transparent blur-[80px] lg:hidden pointer-events-none" />

        <div className="w-full max-w-md relative z-10">
          
          {/* CORRECCIÓN ACÁ: Eliminamos los fondos semi-transparentes y dejamos bg-white puro */}
          <Card className="border-0 shadow-md shadow-foreground/10 lg:shadow-foreground/5 sm:border sm:border-border bg-card overflow-hidden">
            
            {/* Detalle visual: Línea superior de color */}
            <div className="h-1.5 w-full bg-primary" />

            <CardHeader className="space-y-4 pb-6 pt-8 text-center">
              <div className="flex justify-center mb-1">
                <div className="p-3 bg-selected rounded-2xl ring-1 ring-border">
                  <ShieldCheck className="size-8 text-primary" aria-hidden="true" />
                </div>
              </div>
              <div className="space-y-1.5">
                <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
                  ERP SWAT
                </CardTitle>
                <CardDescription className="text-base text-muted-foreground px-2">
                  Ingresá tus credenciales para acceder al sistema.
                </CardDescription>
              </div>
            </CardHeader>
            
            <CardContent>
              <Suspense fallback={
                <div className="h-40 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                  <div className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  Cargando formulario...
                </div>
              }>
                <FormularioLogin />
              </Suspense>
            </CardContent>
            
            {/* CORRECCIÓN ACÁ: bg-gray-50 sólido (sin transparencia) para que contraste bien con el blanco de arriba */}
            <CardFooter className="flex justify-center pb-6 border-t border-border mt-2 pt-6 bg-muted">
              <p className="text-sm text-muted-foreground">
                ¿Problemas para ingresar?{" "}
                <a href="#" className="font-medium text-primary hover:text-primary-hover hover:underline transition-colors">
                  Contactá al soporte
                </a>
              </p>
            </CardFooter>
          </Card>

          <p className="text-center text-sidebar-muted-foreground text-xs mt-8 lg:hidden">
            © {currentYear} ERP SWAT Indumentarias.
          </p>
        </div>
      </div>
      
    </div>
  );
}
