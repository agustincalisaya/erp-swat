import Link from "next/link";
import { SearchX, Home } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

export const metadata = {
  title: "Página no encontrada — ERP SWAT",
  description: "La página que estás buscando no existe o fue movida.",
};

export default function NotFoundPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full">
        <Card className="border-gray-200 shadow-xl shadow-slate-200/50 bg-white">
          <CardHeader className="items-center text-center gap-4 pb-6 pt-8">
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-blue-100 blur-sm opacity-70"></div>
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 border-4 border-white shadow-sm text-blue-600">
                <SearchX className="size-8" aria-hidden="true" />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <CardTitle className="text-4xl font-extrabold text-blue-950 tracking-tight">404</CardTitle>
              <CardTitle className="text-lg font-semibold text-slate-700">Página no encontrada</CardTitle>
            </div>
          </CardHeader>
          
          <CardContent className="text-center">
            <CardDescription className="text-sm text-slate-500 mb-6 px-2">
              La ruta a la que intentás acceder no existe o fue movida.
            </CardDescription>
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-100">
              <p className="text-xs text-slate-600 leading-relaxed">
                Si llegaste acá a través de un botón o link interno del sistema, por favor reportalo a soporte técnico.
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex justify-center pb-8 pt-2">
            <Link 
              href="/home" 
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium transition-colors bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full sm:w-auto"
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