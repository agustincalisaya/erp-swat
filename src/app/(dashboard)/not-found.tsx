import Link from "next/link";
import { SearchX, Home } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

export const metadata = {
  title: "Página no encontrada — ERP SWAT",
  description: "La página que estás buscando no existe o fue movida.",
};

export default function NotFoundPage() {
  return (
    // Cambiamos min-h-[calc...] por min-h-screen y agregamos un fondo bg-slate-50
    <main className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full">
        <Card className="border-border shadow-xl shadow-foreground/5 bg-card">
          <CardHeader className="items-center text-center gap-4 pb-6 pt-8">
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-selected blur-sm opacity-70"></div>
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-selected border-4 border-card shadow-sm text-selected-foreground">
                <SearchX className="size-8" aria-hidden="true" />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <CardTitle className="text-4xl font-extrabold text-foreground tracking-tight">404</CardTitle>
              <CardTitle className="text-lg font-semibold text-foreground">Página no encontrada</CardTitle>
            </div>
          </CardHeader>
          
          <CardContent className="text-center">
            <CardDescription className="text-sm text-muted-foreground mb-6 px-2">
              La ruta a la que intentás acceder no existe o fue movida.
            </CardDescription>
            <div className="rounded-lg bg-background p-4 border border-border">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Si llegaste acá a través de un botón o link interno del sistema, por favor reportalo a soporte técnico.
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex justify-center pb-8 pt-2">
            <Link 
              href="/home" 
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium transition-colors bg-primary text-primary-foreground rounded-lg shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
            >
              <Home className="size-4" />
              Volver al inicio
            </Link>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}