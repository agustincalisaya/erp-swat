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
import { ShieldOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = {
  title: "No autorizado — ERP SWAT",
  description: "No tenés el permiso requerido para acceder a esta sección.",
};

export default function NoAutorizadoPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader className="items-center text-center gap-3">
            <div className="p-3 rounded-full bg-red-100 text-red-600">
              <ShieldOff className="size-6" aria-hidden="true" />
            </div>
            <CardTitle className="text-lg">Acceso no autorizado</CardTitle>
            <CardDescription>
              No tenés el permiso requerido para acceder a esta sección. Si creés que esto es un
              error, consultá con un Administrador del sistema.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
