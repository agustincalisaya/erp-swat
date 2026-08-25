/**
 * @page NoAutorizadoPage
 * @route /no-autorizado
 *
 * Destino del bloqueo real de acceso (HU-D10,
 * task_cali_bloqueo_url_auditoria.md §1.2) — a donde `redirect()` manda a
 * un usuario con sesión válida pero sin el permiso requerido por la
 * página que intentó abrir directamente por URL. Vive dentro de
 * `(dashboard)` a propósito: conserva Sidebar/Navbar/Footer, para que la
 * persona siga viendo las secciones a las que sí tiene acceso.
 */
import Link from "next/link";
import { ShieldOff, Home } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

export const metadata = {
  title: "No autorizado — ERP SWAT",
  description: "No tenés el permiso requerido para acceder a esta sección.",
};

export default function NoAutorizadoPage() {
  return (
    // Se modificó esta línea: flex, justify-center, items-center y min-h calculado 
    // para centrar la tarjeta vertical y horizontalmente en el espacio disponible.
    <main className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] bg-gray-50/50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-lg w-full">
        <Card className="border-red-100 shadow-sm">
          <CardHeader className="items-center text-center gap-4 pb-6">
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-red-100 blur-sm opacity-70"></div>
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red-50 border-4 border-white shadow-sm text-red-600">
                <ShieldOff className="size-8" aria-hidden="true" />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <CardTitle className="text-2xl text-gray-900">Acceso Denegado</CardTitle>
              <CardDescription className="text-base">
                No contás con los permisos necesarios para ver el contenido de esta página.
              </CardDescription>
            </div>
          </CardHeader>
          
          <CardContent>
            <div className="rounded-lg bg-red-50 p-4 border border-red-100/60">
              <h3 className="text-sm font-medium text-red-800 mb-1">¿Por qué veo esto?</h3>
              <p className="text-sm text-red-700/90 leading-relaxed">
                Tu rol actual no tiene habilitada la visualización de este módulo. Si considerás que deberías tener acceso para realizar tus tareas diarias, contactá al Administrador del sistema para que actualice tu perfil.
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex justify-center pb-8 pt-2">
            <Link 
              href="/home" 
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              <Home className="size-4" />
              Volver al Inicio
            </Link>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}